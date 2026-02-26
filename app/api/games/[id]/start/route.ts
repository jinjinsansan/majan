import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { MahjongEngine, tileToName } from '@/lib/mahjong-engine';
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
        started_at: new Date().toISOString(),
      })
      .eq('id', gameId);

    // 対局を実行
    await runGame(gameId, orderedTwins, supabase);

    return NextResponse.json({ success: true, gameId });
  } catch (error: any) {
    console.error('Start game error:', error);

    // ゲームをfailedに更新
    try {
      const supabase = await createServiceClient();
      await supabase
        .from('games')
        .update({ status: 'failed' })
        .eq('id', gameId);
    } catch {}

    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ─── シャンテン名称 ─────────────────────────────────────────
const SHANTEN_NAMES = ['テンパイ', 'イーシャンテン', 'リャンシャンテン', 'サンシャンテン', 'ヨンシャンテン'];
function shantenLabel(n: number): string {
  return SHANTEN_NAMES[n] || `${n}シャンテン`;
}

// ─── ヒューリスティック思考テキスト生成 ──────────────────────
function buildHeuristicReasoning(
  twin: Twin | undefined,
  tileName: string,
  shanten: number,
  ukeireCount: number,
  shantenBefore: number,
  gameState: any,
  currentSeat: number,
): { summary: string; detail: string | null; mode: string; risk: string } {
  const name = twin?.name || '???';
  const anyRiichi = gameState.players?.some((p: any) => p.riichi && p.seat !== currentSeat);
  const remaining = gameState.remainingTiles;

  // リスク判定
  let risk: 'low' | 'medium' | 'high' = 'medium';
  let mode: 'push' | 'pull' | 'balance' = 'balance';

  if (anyRiichi) {
    risk = 'high';
    mode = shanten <= 1 ? 'push' : 'pull';
  } else if (shanten === 0) {
    risk = 'low';
    mode = 'push';
  } else if (remaining <= 20) {
    risk = shanten <= 1 ? 'medium' : 'high';
    mode = shanten <= 1 ? 'push' : 'pull';
  }

  // サマリー生成
  let summary = '';
  const sl = shantenLabel(shanten);

  if (shanten === 0) {
    summary = `${name}: ${sl}維持。${tileName}切り。受入${ukeireCount}種。`;
  } else if (shanten === 1) {
    if (anyRiichi) {
      summary = `${name}: ${sl}。他家リーチ中だが${tileName}を切って攻め継続。受入${ukeireCount}種。`;
    } else {
      summary = `${name}: ${sl}。${tileName}切りで受入${ukeireCount}種。テンパイまであと一歩。`;
    }
  } else if (shanten === 2) {
    summary = `${name}: ${sl}。${tileName}を切って手牌整理。受入${ukeireCount}種。`;
  } else {
    summary = `${name}: ${sl}。${tileName}を処理して手を進める。`;
  }

  // 詳細テキスト（攻守判断）
  let detail: string | null = null;
  if (anyRiichi) {
    if (mode === 'push') {
      detail = `他家リーチに対し、${sl}のため攻め継続。${tileName}を切って受入を維持。`;
    } else {
      detail = `他家リーチ中で手が遠い。${tileName}を安全牌として処理。`;
    }
  } else if (remaining <= 20 && shanten >= 2) {
    detail = `終盤で手が遠い。無理せず${tileName}を処理。`;
  }

  return { summary, detail, mode, risk };
}

// ─── バッチ書き込みバッファ ──────────────────────────────────
interface ActionBuf {
  game_id: string;
  hand_id: string;
  seq_no: number;
  actor_seat: number;
  action_type: string;
  payload_json: any;
}
interface ReasoningBuf {
  action_seq_no: number; // バッチ内で対応付けるためのキー
  summary_text: string;
  detail_text: string | null;
  structured_json: any;
  tokens_used: number;
  model_name: string;
}

async function flushBatch(
  supabase: any,
  actions: ActionBuf[],
  reasonings: ReasoningBuf[],
) {
  if (actions.length === 0) return;

  // アクションを一括挿入して ID を取得
  const { data: inserted } = await supabase
    .from('actions')
    .insert(actions)
    .select('id, seq_no');

  // 思考ログがあれば対応付けて一括挿入
  if (inserted && reasonings.length > 0) {
    const seqToId = new Map<number, string>();
    for (const row of inserted) {
      seqToId.set(row.seq_no, row.id);
    }

    const reasoningRows = reasonings
      .map(r => {
        const actionId = seqToId.get(r.action_seq_no);
        if (!actionId) return null;
        return {
          action_id: actionId,
          summary_text: r.summary_text,
          detail_text: r.detail_text,
          structured_json: r.structured_json,
          tokens_used: r.tokens_used,
          model_name: r.model_name,
        };
      })
      .filter(Boolean);

    if (reasoningRows.length > 0) {
      await supabase.from('reasoning_logs').insert(reasoningRows);
    }
  }
}

/**
 * 対局実行メインループ
 * 東風戦: 東1局〜東4局 (親連荘あり)
 * 全判断ヒューリスティック（LLMなし）で55秒内完走
 */
async function runGame(gameId: string, twins: Twin[], supabase: any) {
  const engine = new MahjongEngine();
  let seqNo = 0;
  const startTime = Date.now();
  const MAX_RUNTIME_MS = 55000;
  const FLUSH_INTERVAL = 10; // 10アクションごとにDBフラッシュ

  // バッチバッファ
  let actionBuf: ActionBuf[] = [];
  let reasoningBuf: ReasoningBuf[] = [];

  const flush = async () => {
    await flushBatch(supabase, actionBuf, reasoningBuf);
    actionBuf = [];
    reasoningBuf = [];
  };

  const pushAction = (a: ActionBuf, r?: ReasoningBuf) => {
    actionBuf.push(a);
    if (r) reasoningBuf.push(r);
  };

  try {
    // === 東風戦ループ（最大4局 + 親連荘） ===
    while (!engine.isGameOver()) {
      if (Date.now() - startTime > MAX_RUNTIME_MS) {
        console.log('Timeout reached, finishing game');
        break;
      }

      const state = engine.getState();

      // 局レコードを作成
      const { data: hand, error: handError } = await supabase
        .from('hands')
        .insert({
          game_id: gameId,
          hand_no: state.handNumber + 1,
          round: state.round,
          honba: state.honba,
          kyotaku: state.kyotaku,
          dealer_seat: state.dealerSeat,
        })
        .select()
        .single();

      if (handError) throw handError;
      const handId = hand.id;

      // 配牌をアクションとして一括記録
      const initState = engine.getState();
      for (let seat = 0; seat < 4; seat++) {
        seqNo++;
        pushAction({
          game_id: gameId,
          hand_id: handId,
          seq_no: seqNo,
          actor_seat: seat,
          action_type: 'deal',
          payload_json: {
            tiles: initState.players[seat].hand,
            dora_indicators: initState.doraIndicators,
          },
        });
      }
      await flush();

      // === 局内ループ ===
      let handOver = false;
      let handResult: any = null;
      let actionsSinceFlush = 0;

      while (!handOver) {
        if (Date.now() - startTime > MAX_RUNTIME_MS) {
          handOver = true;
          break;
        }

        const currentState = engine.getState();
        const currentSeat = currentState.currentActor;
        const twin = twins[currentSeat];

        // === ツモフェーズ ===
        if (currentState.phase === 'draw') {
          // 流局チェック
          if (engine.isRyukyoku()) {
            handResult = engine.processRyukyoku();
            seqNo++;
            pushAction({
              game_id: gameId,
              hand_id: handId,
              seq_no: seqNo,
              actor_seat: currentSeat,
              action_type: 'ryukyoku',
              payload_json: {
                tenpai_seats: handResult.tenpaiSeats,
                score_changes: handResult.scoreChanges,
              },
            });
            actionsSinceFlush++;
            handOver = true;
            break;
          }

          const drawnTile = engine.draw();
          if (!drawnTile) {
            handResult = engine.processRyukyoku();
            handOver = true;
            break;
          }

          seqNo++;
          pushAction({
            game_id: gameId,
            hand_id: handId,
            seq_no: seqNo,
            actor_seat: currentSeat,
            action_type: 'draw',
            payload_json: { tile: drawnTile },
          });
          actionsSinceFlush++;

          // ツモ和了チェック
          if (engine.canTsumo(currentSeat)) {
            const winResult = engine.executeTsumo(currentSeat);
            if (winResult) {
              seqNo++;
              const yakuNames = winResult.yaku.map(([name, han]: [string, number]) => `${name}(${han}翻)`).join('・');
              pushAction(
                {
                  game_id: gameId,
                  hand_id: handId,
                  seq_no: seqNo,
                  actor_seat: currentSeat,
                  action_type: 'tsumo',
                  payload_json: {
                    tile: drawnTile,
                    yaku: winResult.yaku,
                    han: winResult.han,
                    fu: winResult.fu,
                    score_level: winResult.scoreLevel,
                    score_changes: winResult.scoreChanges,
                  },
                },
                {
                  action_seq_no: seqNo,
                  summary_text: `ツモ和了！${yakuNames} ${winResult.han}翻${winResult.fu}符`,
                  detail_text: `ツモ牌: ${tileToName(drawnTile)}\n役: ${yakuNames}\n${winResult.han}翻${winResult.fu}符\n${winResult.scoreLevel}`,
                  structured_json: {
                    candidates: [],
                    risk: 'low',
                    mode: 'push',
                    target_yaku: winResult.yaku.map(([name]: [string]) => name),
                  },
                  tokens_used: 0,
                  model_name: 'engine',
                },
              );
              actionsSinceFlush++;

              handResult = {
                type: 'agari',
                winResult,
                scoreChanges: winResult.scoreChanges,
                dealerRetains: winResult.winnerSeat === engine.getDealerSeat(),
              };
              handOver = true;
              break;
            }
          }

          // 九種九牌（AIは宣言しない）
          if (engine.canKyushukyuhai(currentSeat)) { /* 続行 */ }

          // === 暗槓チェック ===
          if (engine.canAnkan(currentSeat)) {
            const ankanCandidates = engine.getAnkanCandidates(currentSeat);
            if (ankanCandidates.length > 0) {
              const ankanTile = ankanCandidates[0];
              const success = engine.executeAnkan(currentSeat, ankanTile);
              if (success) {
                seqNo++;
                const kanMeld = engine.getState().players[currentSeat].melds.slice(-1)[0];
                pushAction(
                  {
                    game_id: gameId,
                    hand_id: handId,
                    seq_no: seqNo,
                    actor_seat: currentSeat,
                    action_type: 'kan',
                    payload_json: {
                      kan_type: 'ankan',
                      tiles: kanMeld?.tiles || [],
                    },
                  },
                  {
                    action_seq_no: seqNo,
                    summary_text: `${twin?.name || '???'}が${tileToName(ankanTile)}を暗槓！手牌から4枚揃っているため槓。`,
                    detail_text: null,
                    structured_json: { candidates: [], risk: 'low', mode: 'push', target_yaku: [], is_naki_decision: true },
                    tokens_used: 0,
                    model_name: 'engine',
                  },
                );
                actionsSinceFlush++;

                // 嶺上ツモ後のツモ和了チェック
                if (engine.canTsumo(currentSeat)) {
                  const winResult = engine.executeTsumo(currentSeat);
                  if (winResult) {
                    seqNo++;
                    const yakuNames = winResult.yaku.map(([name, han]: [string, number]) => `${name}(${han}翻)`).join('・');
                    pushAction(
                      {
                        game_id: gameId,
                        hand_id: handId,
                        seq_no: seqNo,
                        actor_seat: currentSeat,
                        action_type: 'tsumo',
                        payload_json: {
                          yaku: winResult.yaku,
                          han: winResult.han,
                          fu: winResult.fu,
                          score_level: winResult.scoreLevel,
                          score_changes: winResult.scoreChanges,
                          rinshan: true,
                        },
                      },
                      {
                        action_seq_no: seqNo,
                        summary_text: `嶺上開花！${yakuNames} ${winResult.han}翻${winResult.fu}符`,
                        detail_text: null,
                        structured_json: { candidates: [], risk: 'low', mode: 'push', target_yaku: winResult.yaku.map(([name]: [string]) => name) },
                        tokens_used: 0,
                        model_name: 'engine',
                      },
                    );
                    actionsSinceFlush++;

                    handResult = {
                      type: 'agari',
                      winResult,
                      scoreChanges: winResult.scoreChanges,
                      dealerRetains: winResult.winnerSeat === engine.getDealerSeat(),
                    };
                    handOver = true;
                    break;
                  }
                }
              }
            }
          }

          // === 加槓チェック ===
          if (!handOver && engine.canKakan(currentSeat)) {
            const kakanCandidates = engine.getKakanCandidates(currentSeat);
            if (kakanCandidates.length > 0) {
              const kakanTile = kakanCandidates[0];
              const success = engine.executeKakan(currentSeat, kakanTile);
              if (success) {
                seqNo++;
                const kanMeld = engine.getState().players[currentSeat].melds.find(m => m.type === 'kakan');
                pushAction(
                  {
                    game_id: gameId,
                    hand_id: handId,
                    seq_no: seqNo,
                    actor_seat: currentSeat,
                    action_type: 'kan',
                    payload_json: {
                      kan_type: 'kakan',
                      tile: kakanTile,
                      tiles: kanMeld?.tiles || [],
                    },
                  },
                  {
                    action_seq_no: seqNo,
                    summary_text: `${twin?.name || '???'}が${tileToName(kakanTile)}を加槓！ポンした牌に4枚目を追加。`,
                    detail_text: null,
                    structured_json: { candidates: [], risk: 'low', mode: 'push', target_yaku: [], is_naki_decision: true },
                    tokens_used: 0,
                    model_name: 'engine',
                  },
                );
                actionsSinceFlush++;

                // 嶺上ツモ後のツモ和了チェック
                if (engine.canTsumo(currentSeat)) {
                  const winResult = engine.executeTsumo(currentSeat);
                  if (winResult) {
                    seqNo++;
                    pushAction({
                      game_id: gameId,
                      hand_id: handId,
                      seq_no: seqNo,
                      actor_seat: currentSeat,
                      action_type: 'tsumo',
                      payload_json: {
                        yaku: winResult.yaku,
                        han: winResult.han,
                        fu: winResult.fu,
                        score_level: winResult.scoreLevel,
                        score_changes: winResult.scoreChanges,
                        rinshan: true,
                      },
                    });
                    actionsSinceFlush++;
                    handResult = {
                      type: 'agari',
                      winResult,
                      scoreChanges: winResult.scoreChanges,
                      dealerRetains: winResult.winnerSeat === engine.getDealerSeat(),
                    };
                    handOver = true;
                    break;
                  }
                }
              }
            }
          }
        }

        // === 打牌フェーズ ===
        if (engine.getState().phase === 'discard') {
          const updatedState = engine.getState();
          const candidates = engine.getDiscardCandidates(currentSeat);

          // リーチ判定
          const canRiichi = engine.canRiichi(currentSeat);
          const riichiCandidates = canRiichi ? engine.getRiichiDiscardCandidates(currentSeat) : [];

          // ヒューリスティック打牌選択
          const hResult = engine.chooseBestDiscardHeuristic(currentSeat);
          let chosenTile = hResult.tile;

          // リーチ可能時: リーチ候補を優先
          if (canRiichi && riichiCandidates.length > 0) {
            if (!riichiCandidates.includes(chosenTile)) {
              chosenTile = riichiCandidates[0];
            }
          }

          // 思考テキスト生成
          const tileName = tileToName(chosenTile);
          const reasoning = buildHeuristicReasoning(
            twin, tileName, hResult.shanten, hResult.ukeireCount,
            hResult.shantenBefore, updatedState, currentSeat,
          );

          // リーチ実行
          let isRiichi = false;
          if (canRiichi && riichiCandidates.some(rc => rc === chosenTile)) {
            engine.executeRiichi(currentSeat, chosenTile);
            isRiichi = true;

            seqNo++;
            pushAction({
              game_id: gameId,
              hand_id: handId,
              seq_no: seqNo,
              actor_seat: currentSeat,
              action_type: 'riichi',
              payload_json: { tile: chosenTile },
            });
            actionsSinceFlush++;
          } else {
            engine.discard(chosenTile);
          }

          // 打牌アクション + 思考ログ
          seqNo++;
          pushAction(
            {
              game_id: gameId,
              hand_id: handId,
              seq_no: seqNo,
              actor_seat: currentSeat,
              action_type: 'discard',
              payload_json: { tile: chosenTile },
            },
            {
              action_seq_no: seqNo,
              summary_text: reasoning.summary,
              detail_text: reasoning.detail,
              structured_json: {
                risk: reasoning.risk,
                mode: reasoning.mode,
                candidates: [],
                target_yaku: [],
                shanten: hResult.shanten,
                ukeire_count: hResult.ukeireCount,
              },
              tokens_used: 0,
              model_name: 'heuristic',
            },
          );
          actionsSinceFlush++;

          // 定期フラッシュ
          if (actionsSinceFlush >= FLUSH_INTERVAL) {
            await flush();
            actionsSinceFlush = 0;
          }

          // === 鳴き・ロンチェック ===
          const discardedTile = chosenTile;
          const discarderSeat = currentSeat;

          // ロンチェック
          const ronCandidates = engine.getRonCandidates(discardedTile, discarderSeat);
          if (ronCandidates.length > 0) {
            const ronSeat = ronCandidates[0];
            const winResult = engine.executeRon(ronSeat);
            if (winResult) {
              seqNo++;
              const yakuNames = winResult.yaku.map(([name, han]: [string, number]) => `${name}(${han}翻)`).join('・');
              pushAction(
                {
                  game_id: gameId,
                  hand_id: handId,
                  seq_no: seqNo,
                  actor_seat: ronSeat,
                  action_type: 'ron',
                  payload_json: {
                    tile: discardedTile,
                    from_seat: discarderSeat,
                    yaku: winResult.yaku,
                    han: winResult.han,
                    fu: winResult.fu,
                    score_level: winResult.scoreLevel,
                    score_changes: winResult.scoreChanges,
                  },
                },
                {
                  action_seq_no: seqNo,
                  summary_text: `ロン！${yakuNames} ${winResult.han}翻${winResult.fu}符`,
                  detail_text: `ロン牌: ${tileToName(discardedTile)} (${twins[discarderSeat]?.name}から)\n役: ${yakuNames}\n${winResult.han}翻${winResult.fu}符`,
                  structured_json: {
                    candidates: [],
                    risk: 'low',
                    mode: 'push',
                    target_yaku: winResult.yaku.map(([name]: [string]) => name),
                  },
                  tokens_used: 0,
                  model_name: 'engine',
                },
              );
              actionsSinceFlush++;

              handResult = {
                type: 'agari',
                winResult,
                scoreChanges: winResult.scoreChanges,
                dealerRetains: winResult.winnerSeat === engine.getDealerSeat(),
              };
              handOver = true;
              break;
            }
          }

          // === 大明槓/ポン/チーチェック（全てヒューリスティック） ===
          if (!handOver) {
            let called = false;

            // 大明槓
            const daiminkanCandidates = engine.getDaiminkanCandidates(discardedTile, discarderSeat);
            if (daiminkanCandidates.length > 0) {
              for (const kanSeat of daiminkanCandidates) {
                const kanTwin = twins[kanSeat];
                const nakiTendency = kanTwin?.style_params?.naki_tendency ?? 50;
                if (Math.random() * 100 < nakiTendency) {
                  const success = engine.executeDaiminkan(kanSeat, discardedTile);
                  if (success) {
                    seqNo++;
                    const kanMeld = engine.getState().players[kanSeat].melds.slice(-1)[0];
                    pushAction(
                      {
                        game_id: gameId,
                        hand_id: handId,
                        seq_no: seqNo,
                        actor_seat: kanSeat,
                        action_type: 'kan',
                        payload_json: {
                          kan_type: 'daiminkan',
                          tile: discardedTile,
                          tiles: kanMeld?.tiles || [],
                          from_seat: discarderSeat,
                        },
                      },
                      {
                        action_seq_no: seqNo,
                        summary_text: `${kanTwin?.name || '???'}が${tileToName(discardedTile)}を大明槓！`,
                        detail_text: null,
                        structured_json: { candidates: [], risk: 'medium', mode: 'push', target_yaku: [], is_naki_decision: true },
                        tokens_used: 0,
                        model_name: 'engine',
                      },
                    );
                    actionsSinceFlush++;

                    // 嶺上ツモ和了チェック
                    if (engine.canTsumo(kanSeat)) {
                      const winResult = engine.executeTsumo(kanSeat);
                      if (winResult) {
                        seqNo++;
                        pushAction({
                          game_id: gameId,
                          hand_id: handId,
                          seq_no: seqNo,
                          actor_seat: kanSeat,
                          action_type: 'tsumo',
                          payload_json: {
                            yaku: winResult.yaku,
                            han: winResult.han,
                            fu: winResult.fu,
                            score_level: winResult.scoreLevel,
                            score_changes: winResult.scoreChanges,
                            rinshan: true,
                          },
                        });
                        actionsSinceFlush++;
                        handResult = {
                          type: 'agari',
                          winResult,
                          scoreChanges: winResult.scoreChanges,
                          dealerRetains: winResult.winnerSeat === engine.getDealerSeat(),
                        };
                        handOver = true;
                      }
                    }

                    called = true;
                    break;
                  }
                }
              }
            }

            // ポン（ヒューリスティック: naki_tendency確率）
            const ponCandidates = !called ? engine.getPonCandidates(discardedTile, discarderSeat) : [];
            if (ponCandidates.length > 0) {
              for (const ponSeat of ponCandidates) {
                const ponTwin = twins[ponSeat];
                const nakiTendency = ponTwin?.style_params?.naki_tendency ?? 50;
                const shouldPon = Math.random() * 100 < nakiTendency;

                if (shouldPon) {
                  const success = engine.executePon(ponSeat, discardedTile);
                  if (success) {
                    seqNo++;
                    const ponMeld = engine.getState().players[ponSeat].melds.slice(-1)[0];
                    pushAction(
                      {
                        game_id: gameId,
                        hand_id: handId,
                        seq_no: seqNo,
                        actor_seat: ponSeat,
                        action_type: 'pon',
                        payload_json: {
                          tile: discardedTile,
                          tiles: ponMeld?.tiles || [discardedTile],
                          from_seat: discarderSeat,
                        },
                      },
                      {
                        action_seq_no: seqNo,
                        summary_text: `${ponTwin?.name || '???'}が${tileToName(discardedTile)}をポン！手牌に2枚あり鳴いて面子完成。`,
                        detail_text: null,
                        structured_json: { candidates: [], risk: 'medium', mode: 'push', target_yaku: [], is_naki_decision: true },
                        tokens_used: 0,
                        model_name: 'engine',
                      },
                    );
                    actionsSinceFlush++;

                    called = true;
                    break;
                  }
                }
              }
            }

            // チー（ヒューリスティック: naki_tendency * 0.7確率）
            if (!called) {
              const nextSeat = (discarderSeat + 1) % 4;
              if (engine.canChi(nextSeat, discardedTile)) {
                const chiTwin = twins[nextSeat];
                const nakiTendency = chiTwin?.style_params?.naki_tendency ?? 50;
                const shouldChi = Math.random() * 100 < nakiTendency * 0.7;

                if (shouldChi) {
                  const chiOptions = engine.getChiOptions(nextSeat, discardedTile);
                  if (chiOptions.length > 0) {
                    const chosenOption = chiOptions[0];
                    const success = engine.executeChi(nextSeat, chosenOption);
                    if (success) {
                      seqNo++;
                      const chiMeld = engine.getState().players[nextSeat].melds.slice(-1)[0];
                      pushAction(
                        {
                          game_id: gameId,
                          hand_id: handId,
                          seq_no: seqNo,
                          actor_seat: nextSeat,
                          action_type: 'chi',
                          payload_json: {
                            tile: discardedTile,
                            tiles: chiMeld?.tiles || chosenOption,
                            from_seat: discarderSeat,
                          },
                        },
                        {
                          action_seq_no: seqNo,
                          summary_text: `${chiTwin?.name || '???'}が${tileToName(discardedTile)}をチー！順子を完成させる。`,
                          detail_text: null,
                          structured_json: { candidates: [], risk: 'medium', mode: 'push', target_yaku: [], is_naki_decision: true },
                          tokens_used: 0,
                          model_name: 'engine',
                        },
                      );
                      actionsSinceFlush++;

                      called = true;
                    }
                  }
                }
              }
            }

            // 鳴かなかった場合は次のターンへ
            if (!called) {
              engine.nextTurn();
            }
          }
        }
      }

      // 局終了時にバッファをフラッシュ
      await flush();

      // 局結果を保存
      if (handResult) {
        await supabase
          .from('hands')
          .update({
            result_json: {
              type: handResult.type,
              winner_seat: handResult.winResult?.winnerSeat,
              loser_seat: handResult.winResult?.loserSeat,
              yaku: handResult.winResult?.yaku?.map(([name]: [string, number]) => name),
              han: handResult.winResult?.han,
              fu: handResult.winResult?.fu,
              score_changes: handResult.scoreChanges,
            },
          })
          .eq('id', handId);

        // 次の局へ
        const dealerRetains = handResult.dealerRetains ?? false;
        if (!engine.advanceToNextHand(dealerRetains)) {
          break; // ゲーム終了
        }
      } else {
        // タイムアウトなどで局が未完了
        break;
      }
    }

    // ゲーム終了
    const finalState = engine.getState();
    await supabase
      .from('games')
      .update({
        status: 'finished',
        finished_at: new Date().toISOString(),
        rule_set: {
          players: 4,
          format: 'tonpu',
          aka_dora: true,
          kuitan: true,
          atozuke: true,
          double_ron: false,
          tobi: true,
          open_hand: true,
          final_scores: finalState.players.map(p => p.score),
        },
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
