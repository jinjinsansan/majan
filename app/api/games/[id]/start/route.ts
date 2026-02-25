import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { MahjongEngine, tileToName } from '@/lib/mahjong-engine';
import { decide } from '@/lib/llm';
import type { Twin } from '@/lib/types';

export const maxDuration = 60; // Vercel Pro: 60秒まで

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: gameId } = await params;

  try {
    const supabase = await createServiceClient();

    // ゲーム情報を取得
    const { data: game, error: gameError } = await supabase
      .from('games')
      .select('*')
      .eq('id', gameId)
      .single();

    if (gameError || !game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    if (game.status !== 'queued') {
      return NextResponse.json({ error: 'Game already started' }, { status: 400 });
    }

    // Twinsを取得
    const { data: twins } = await supabase
      .from('twins')
      .select('*')
      .in('id', game.player_twin_ids);

    if (!twins || twins.length !== 4) {
      return NextResponse.json({ error: 'Invalid twins' }, { status: 400 });
    }

    // 席順に並べ替え
    const orderedTwins: Twin[] = game.player_twin_ids.map((twinId: string) =>
      twins.find(t => t.id === twinId)
    );

    // ゲームステータスを更新
    await supabase
      .from('games')
      .update({ 
        status: 'running', 
        started_at: new Date().toISOString() 
      })
      .eq('id', gameId);

    // 対局を実行
    await runGame(gameId, orderedTwins, supabase);

    return NextResponse.json({ success: true, gameId });
  } catch (error: any) {
    console.error('Start game error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// 対局実行（LLM使用版）
async function runGame(gameId: string, twins: Twin[], supabase: any) {
  const engine = new MahjongEngine();
  let seqNo = 0;

  try {
    // 最初の局を作成
    const { data: hand, error: handError } = await supabase
      .from('hands')
      .insert({
        game_id: gameId,
        hand_no: 1,
        round: '東1局',
        honba: 0,
        kyotaku: 0,
        dealer_seat: 0,
      })
      .select()
      .single();
    
    if (handError) {
      console.error('Hand creation error:', handError);
      throw handError;
    }

    const handId = hand.id;

    // 初期手牌をアクションとして記録
    const initialState = engine.getState();
    
    for (let seat = 0; seat < 4; seat++) {
      const player = initialState.players[seat];
      seqNo++;
      
      await supabase.from('actions').insert({
        game_id: gameId,
        hand_id: handId,
        seq_no: seqNo,
        actor_seat: seat,
        action_type: 'deal',
        payload_json: { tiles: player.hand },
      });
    }

    // メインループ: 最大70ターン（東風戦1局分）
    // Vercel Proプランでは60秒まで実行可能
    const maxTurns = 70;
    const useLLM = !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);

    for (let turn = 0; turn < maxTurns; turn++) {
      const state = engine.getState();
      const currentSeat = state.currentActor;
      const twin = twins[currentSeat];

      // ツモ
      if (state.phase === 'draw') {
        const drawnTile = engine.draw();
        if (!drawnTile) {
          // 流局
          console.log('Ryuukyoku - no more tiles');
          break;
        }

        seqNo++;
        await supabase.from('actions').insert({
          game_id: gameId,
          hand_id: handId,
          seq_no: seqNo,
          actor_seat: currentSeat,
          action_type: 'draw',
          payload_json: { tile: drawnTile },
        });
      }

      // 打牌
      if (state.phase === 'discard') {
        const updatedState = engine.getState();
        const player = updatedState.players[currentSeat];
        const tiles = [...player.hand];
        if (player.tsumo) tiles.push(player.tsumo);
        
        let chosenTile: string;
        let reasoning = {
          summary: '',
          detail: null as string | null,
          structured: { risk: 'medium', mode: 'balance', candidates: [] as any[] },
          tokensUsed: 0,
          model: 'fallback',
        };

        if (useLLM && twin) {
          // LLMで決定
          try {
            const allHands = updatedState.players.map(p => ({
              hand: p.hand.map(t => tileToName(t)),
              tsumo: p.tsumo ? tileToName(p.tsumo) : undefined,
              riichi: p.riichi,
            }));

            const candidates = tiles.map(t => tileToName(t));

            const decision = await decide(
              twin,
              { ...updatedState, round: '東1局', remainingTiles: updatedState.wall?.length || 0 },
              candidates,
              allHands,
              process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai'
            );

            // 選択された牌を特定
            chosenTile = tiles.find(t => tileToName(t) === decision.chosen) || tiles[0];
            reasoning = {
              summary: decision.summary,
              detail: decision.detail,
              structured: decision.structured,
              tokensUsed: decision.tokensUsed,
              model: decision.model,
            };
          } catch (llmError) {
            console.error('LLM error, falling back to random:', llmError);
            chosenTile = tiles[Math.floor(Math.random() * tiles.length)];
            reasoning.summary = '（LLMエラー）ランダムに選択。';
            reasoning.model = 'fallback';
          }
        } else {
          // ランダム
          chosenTile = tiles[Math.floor(Math.random() * tiles.length)];
          reasoning.summary = `${twin?.name || '???'}が${tileToName(chosenTile)}を切った。`;
          reasoning.model = 'random';
        }

        // 打牌実行
        engine.discard(chosenTile);
        seqNo++;

        const { data: action } = await supabase
          .from('actions')
          .insert({
            game_id: gameId,
            hand_id: handId,
            seq_no: seqNo,
            actor_seat: currentSeat,
            action_type: 'discard',
            payload_json: { tile: chosenTile },
          })
          .select()
          .single();

        // 思考ログを保存
        if (action) {
          await supabase.from('reasoning_logs').insert({
            action_id: action.id,
            summary_text: reasoning.summary,
            detail_text: reasoning.detail,
            structured_json: reasoning.structured,
            tokens_used: reasoning.tokensUsed,
            model_name: reasoning.model,
          });
        }

        engine.nextTurn();
      }
    }

    // ゲーム終了
    await supabase
      .from('games')
      .update({ 
        status: 'finished', 
        finished_at: new Date().toISOString() 
      })
      .eq('id', gameId);

  } catch (error) {
    console.error('Game execution error:', error);
    await supabase
      .from('games')
      .update({ status: 'failed' })
      .eq('id', gameId);
    throw error;
  }
}
