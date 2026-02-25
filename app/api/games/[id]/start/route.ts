import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { MahjongEngine } from '@/lib/mahjong-engine';
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

    // 対局を実行
    await runGame(gameId, orderedTwins, supabase);

    return NextResponse.json({ success: true, gameId });
  } catch (error: any) {
    console.error('Start game error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// 対局実行（超簡易版 - 配牌だけ表示）
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
      
      const { error: actionError } = await supabase.from('actions').insert({
        game_id: gameId,
        hand_id: handId,
        seq_no: seqNo,
        actor_seat: seat,
        action_type: 'deal',
        payload_json: { tiles: player.hand },
      });

      if (actionError) {
        console.error('Action insert error:', actionError);
      }
    }

    // 簡易版: 3ターンだけ実行（LLMなし、ランダム打牌）
    for (let turn = 0; turn < 3; turn++) {
      const state = engine.getState();
      const currentSeat = state.currentActor;

      // ツモ
      if (state.phase === 'draw') {
        const drawnTile = engine.draw();
        if (!drawnTile) break;

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

      // 打牌（ランダム）
      if (state.phase === 'discard') {
        const player = state.players[currentSeat];
        const tiles = [...player.hand];
        if (player.tsumo) tiles.push(player.tsumo);
        
        const randomTile = tiles[Math.floor(Math.random() * tiles.length)];
        
        engine.discard(randomTile);
        seqNo++;

        const { data: action } = await supabase
          .from('actions')
          .insert({
            game_id: gameId,
            hand_id: handId,
            seq_no: seqNo,
            actor_seat: currentSeat,
            action_type: 'discard',
            payload_json: { tile: randomTile },
          })
          .select()
          .single();

        // 簡易思考ログ
        if (action) {
          await supabase.from('reasoning_logs').insert({
            action_id: action.id,
            summary_text: `${twins[currentSeat]?.name || '???'}が${randomTile}を切った。`,
            structured_json: { risk: 'medium', mode: 'balance', candidates: [] },
            model_name: 'random',
          });
        }

        engine.nextTurn();
      }
    }

    // ゲーム終了（デモ）
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
