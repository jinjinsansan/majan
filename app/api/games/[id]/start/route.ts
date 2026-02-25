import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { MahjongEngine, tileToName } from '@/lib/mahjong-engine';
import { decide } from '@/lib/llm';
import type { Twin } from '@/lib/types';

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

    // 対局を実行（非同期で実行、すぐにレスポンスを返す）
    runGame(gameId, orderedTwins, supabase);

    return NextResponse.json({ success: true, gameId });
  } catch (error: any) {
    console.error('Start game error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// 対局実行（簡易版 - Vercel用に5ターンだけ実行）
async function runGame(gameId: string, twins: Twin[], supabase: any) {
  const engine = new MahjongEngine();
  let seqNo = 0;
  let handId: string | null = null;

  try {
    // 最初の局を作成
    const { data: hand } = await supabase
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
    
    handId = hand?.id;

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

    // Vercelタイムアウト対策: 5ターンだけ実行
    const maxTurns = 5;

    for (let turn = 0; turn < maxTurns; turn++) {
      const state = engine.getState();
      const currentSeat = state.currentActor;
      const twin = twins[currentSeat];

      // ツモフェーズ
      if (state.phase === 'draw') {
        const drawnTile = engine.draw();
        if (!drawnTile) {
          // 流局
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

        // 少し待機（リアルタイム感）
        await sleep(100);
      }

      // 打牌フェーズ
      if (state.phase === 'discard') {
        const legalActions = engine.getLegalActions(currentSeat);
        const discardActions = legalActions.filter(a => a.type === 'discard');
        
        if (discardActions.length === 0) continue;

        // 候補手
        const candidates = discardActions.map(a => 
          a.type === 'discard' ? a.tile : ''
        ).filter(Boolean);

        // 全員の手牌（公開手牌ルール）
        const allHands = state.players.map(p => ({
          hand: p.hand.map(t => tileToName(t)),
          tsumo: p.tsumo ? tileToName(p.tsumo) : undefined,
          riichi: p.riichi,
        }));

        // LLMで決定
        let decision;
        try {
          decision = await decide(
            twin,
            { ...state, round: '東1局', doraIndicators: state.doraIndicators },
            candidates.map(c => tileToName(c)),
            allHands
          );
        } catch (e) {
          // フォールバック
          decision = {
            chosen: candidates[0],
            summary: '手牌を整理する。',
            detail: null,
            structured: { risk: 'medium', mode: 'balance', candidates: [] },
            tokensUsed: 0,
            model: 'fallback',
          };
        }

        // 選択された牌を特定
        const chosenTile = candidates.find(c => 
          tileToName(c) === decision.chosen
        ) || candidates[0];

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
            summary_text: decision.summary,
            detail_text: decision.detail,
            structured_json: decision.structured,
            tokens_used: decision.tokensUsed,
            model_name: decision.model,
          });
        }

        // 次のプレイヤーへ
        engine.nextTurn();

        // 少し待機
        await sleep(200);
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
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
