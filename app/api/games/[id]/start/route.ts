import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { MahjongEngine, tileToName } from '@/lib/mahjong-engine';
import { decide, decideNaki } from '@/lib/llm';
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

/**
 * 対局実行メインループ
 * 東風戦: 東1局〜東4局 (親連荘あり)
 */
async function runGame(gameId: string, twins: Twin[], supabase: any) {
  const engine = new MahjongEngine();
  let seqNo = 0;
  const useLLM = !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
  const startTime = Date.now();
  const MAX_RUNTIME_MS = 55000; // 55秒でタイムアウト（5秒余裕）
  let totalTokensUsed = 0;
  const MAX_TOKENS_PER_GAME = 50000; // 1ゲームあたりのトークン上限

  try {
    // === 東風戦ループ（最大4局 + 親連荘） ===
    while (!engine.isGameOver()) {
      // タイムアウトチェック
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

      // 配牌をアクションとして記録
      const initState = engine.getState();
      for (let seat = 0; seat < 4; seat++) {
        seqNo++;
        await supabase.from('actions').insert({
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

      // === 局内ループ ===
      let handOver = false;
      let handResult: any = null;

      while (!handOver) {
        // タイムアウトチェック
        if (Date.now() - startTime > MAX_RUNTIME_MS) {
          handOver = true;
          break;
        }

        const currentState = engine.getState();
        const currentSeat = currentState.currentActor;
        const twin = orderedTwins[currentSeat];

        // === ツモフェーズ ===
        if (currentState.phase === 'draw') {
          // 流局チェック（山がない）
          if (engine.isRyukyoku()) {
            handResult = engine.processRyukyoku();
            seqNo++;
            await supabase.from('actions').insert({
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
          await supabase.from('actions').insert({
            game_id: gameId,
            hand_id: handId,
            seq_no: seqNo,
            actor_seat: currentSeat,
            action_type: 'draw',
            payload_json: { tile: drawnTile },
          });

          // ツモ和了チェック
          if (engine.canTsumo(currentSeat)) {
            const winResult = engine.executeTsumo(currentSeat);
            if (winResult) {
              seqNo++;
              const { data: action } = await supabase.from('actions').insert({
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
              }).select().single();

              // 思考ログ（和了）
              if (action) {
                const yakuNames = winResult.yaku.map(([name, han]) => `${name}(${han}翻)`).join('・');
                await supabase.from('reasoning_logs').insert({
                  action_id: action.id,
                  summary_text: `ツモ和了！${yakuNames} ${winResult.han}翻${winResult.fu}符`,
                  detail_text: `ツモ牌: ${tileToName(drawnTile)}\n役: ${yakuNames}\n${winResult.han}翻${winResult.fu}符\n${winResult.scoreLevel}`,
                  structured_json: {
                    candidates: [],
                    risk: 'low',
                    mode: 'push',
                    target_yaku: winResult.yaku.map(([name]) => name),
                  },
                  tokens_used: 0,
                  model_name: 'engine',
                });
              }

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

          // 九種九牌チェック
          if (engine.canKyushukyuhai(currentSeat)) {
            // MVPではAIは九種九牌を宣言しない（続行）
          }

          // === 暗槓チェック ===
          if (engine.canAnkan(currentSeat)) {
            const ankanCandidates = engine.getAnkanCandidates(currentSeat);
            // 暗槓は基本的に有利なので自動実行
            if (ankanCandidates.length > 0) {
              const ankanTile = ankanCandidates[0];
              const success = engine.executeAnkan(currentSeat, ankanTile);
              if (success) {
                seqNo++;
                const kanMeld = engine.getState().players[currentSeat].melds.slice(-1)[0];
                const { data: kanAction } = await supabase.from('actions').insert({
                  game_id: gameId,
                  hand_id: handId,
                  seq_no: seqNo,
                  actor_seat: currentSeat,
                  action_type: 'kan',
                  payload_json: {
                    kan_type: 'ankan',
                    tiles: kanMeld?.tiles || [],
                  },
                }).select().single();

                if (kanAction) {
                  await supabase.from('reasoning_logs').insert({
                    action_id: kanAction.id,
                    summary_text: `${twin?.name || '???'}が${tileToName(ankanTile)}を暗槓！`,
                    detail_text: null,
                    structured_json: {
                      candidates: [],
                      risk: 'low',
                      mode: 'push',
                      target_yaku: [],
                      is_naki_decision: true,
                    },
                    tokens_used: 0,
                    model_name: 'engine',
                  });
                }

                // 嶺上ツモ後のツモ和了チェック
                if (engine.canTsumo(currentSeat)) {
                  const winResult = engine.executeTsumo(currentSeat);
                  if (winResult) {
                    seqNo++;
                    const { data: tsumoAction } = await supabase.from('actions').insert({
                      game_id: gameId,
                      hand_id: handId,
                      seq_no: seqNo,
                      actor_seat: currentSeat,
                      action_type: 'tsumo',
                      payload_json: {
                        tile: engine.getState().players[currentSeat].tsumo,
                        yaku: winResult.yaku,
                        han: winResult.han,
                        fu: winResult.fu,
                        score_level: winResult.scoreLevel,
                        score_changes: winResult.scoreChanges,
                        rinshan: true,
                      },
                    }).select().single();

                    if (tsumoAction) {
                      const yakuNames = winResult.yaku.map(([name, han]) => `${name}(${han}翻)`).join('・');
                      await supabase.from('reasoning_logs').insert({
                        action_id: tsumoAction.id,
                        summary_text: `嶺上開花！${yakuNames} ${winResult.han}翻${winResult.fu}符`,
                        structured_json: { candidates: [], risk: 'low', mode: 'push', target_yaku: winResult.yaku.map(([name]) => name) },
                        tokens_used: 0,
                        model_name: 'engine',
                      });
                    }

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
            // 加槓も基本的に有利なので自動実行
            if (kakanCandidates.length > 0) {
              const kakanTile = kakanCandidates[0];
              const success = engine.executeKakan(currentSeat, kakanTile);
              if (success) {
                seqNo++;
                const kanMeld = engine.getState().players[currentSeat].melds.find(m => m.type === 'kakan');
                const { data: kanAction } = await supabase.from('actions').insert({
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
                }).select().single();

                if (kanAction) {
                  await supabase.from('reasoning_logs').insert({
                    action_id: kanAction.id,
                    summary_text: `${twin?.name || '???'}が${tileToName(kakanTile)}を加槓！`,
                    detail_text: null,
                    structured_json: {
                      candidates: [],
                      risk: 'low',
                      mode: 'push',
                      target_yaku: [],
                      is_naki_decision: true,
                    },
                    tokens_used: 0,
                    model_name: 'engine',
                  });
                }

                // 嶺上ツモ後のツモ和了チェック
                if (engine.canTsumo(currentSeat)) {
                  const winResult = engine.executeTsumo(currentSeat);
                  if (winResult) {
                    seqNo++;
                    await supabase.from('actions').insert({
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
          const player = updatedState.players[currentSeat];
          const candidates = engine.getDiscardCandidates(currentSeat);

          let chosenTile: string;
          let reasoning = {
            summary: '',
            detail: null as string | null,
            structured: {
              risk: 'medium' as const,
              mode: 'balance' as const,
              candidates: [] as any[],
              target_yaku: [] as string[],
            },
            tokensUsed: 0,
            model: 'fallback',
          };

          // リーチ判定
          const canRiichi = engine.canRiichi(currentSeat);
          const riichiCandidates = canRiichi ? engine.getRiichiDiscardCandidates(currentSeat) : [];

          if (useLLM && twin && totalTokensUsed < MAX_TOKENS_PER_GAME) {
            try {
              const allHands = updatedState.players.map(p => ({
                hand: p.hand.map(t => tileToName(t)),
                tsumo: p.tsumo ? tileToName(p.tsumo) : undefined,
                riichi: p.riichi,
                melds: p.melds.map(m => ({
                  type: m.type,
                  tiles: m.tiles.map(t => tileToName(t)),
                })),
              }));

              const candidateNames = candidates.map(t => tileToName(t));

              const decision = await decide(
                twin,
                {
                  ...updatedState,
                  round: updatedState.round,
                  remainingTiles: updatedState.remainingTiles,
                },
                candidateNames,
                allHands,
                process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai'
              );

              totalTokensUsed += decision.tokensUsed;
              chosenTile = candidates.find(t => tileToName(t) === decision.chosen) || candidates[0];
              reasoning = {
                summary: decision.summary,
                detail: decision.detail,
                structured: decision.structured as any,
                tokensUsed: decision.tokensUsed,
                model: decision.model,
              };
            } catch (llmError) {
              console.error('LLM error:', llmError);
              chosenTile = candidates[Math.floor(Math.random() * candidates.length)];
              reasoning.summary = `${twin?.name || '???'}が${tileToName(chosenTile)}を切った。`;
              reasoning.model = 'fallback';
            }
          } else {
            chosenTile = candidates[Math.floor(Math.random() * candidates.length)];
            reasoning.summary = `${twin?.name || '???'}が${tileToName(chosenTile)}を切った。`;
            reasoning.model = 'random';
          }

          // リーチ実行（テンパイかつリーチ可能な牌を切る場合）
          let isRiichi = false;
          if (canRiichi && riichiCandidates.some(rc => rc === chosenTile)) {
            engine.executeRiichi(currentSeat, chosenTile);
            isRiichi = true;

            seqNo++;
            await supabase.from('actions').insert({
              game_id: gameId,
              hand_id: handId,
              seq_no: seqNo,
              actor_seat: currentSeat,
              action_type: 'riichi',
              payload_json: { tile: chosenTile },
            });
          } else {
            engine.discard(chosenTile);
          }

          // 打牌アクション記録
          seqNo++;
          const { data: action } = await supabase.from('actions').insert({
            game_id: gameId,
            hand_id: handId,
            seq_no: seqNo,
            actor_seat: currentSeat,
            action_type: 'discard',
            payload_json: { tile: chosenTile },
          }).select().single();

          // 思考ログ保存
          if (action) {
            await supabase.from('reasoning_logs').insert({
              action_id: action.id,
              summary_text: reasoning.summary || `${tileToName(chosenTile)}を切る。`,
              detail_text: reasoning.detail,
              structured_json: reasoning.structured,
              tokens_used: reasoning.tokensUsed,
              model_name: reasoning.model,
            });
          }

          // === 鳴き・ロンチェック ===
          const discardedTile = chosenTile;
          const discarderSeat = currentSeat;

          // ロンチェック（頭ハネ: 打牌者の下家から順）
          const ronCandidates = engine.getRonCandidates(discardedTile, discarderSeat);
          if (ronCandidates.length > 0) {
            const ronSeat = ronCandidates[0]; // 頭ハネ
            const winResult = engine.executeRon(ronSeat);
            if (winResult) {
              seqNo++;
              const { data: ronAction } = await supabase.from('actions').insert({
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
              }).select().single();

              if (ronAction) {
                const yakuNames = winResult.yaku.map(([name, han]) => `${name}(${han}翻)`).join('・');
                await supabase.from('reasoning_logs').insert({
                  action_id: ronAction.id,
                  summary_text: `ロン！${yakuNames} ${winResult.han}翻${winResult.fu}符`,
                  detail_text: `ロン牌: ${tileToName(discardedTile)} (${twins[discarderSeat]?.name}から)\n役: ${yakuNames}\n${winResult.han}翻${winResult.fu}符`,
                  structured_json: {
                    candidates: [],
                    risk: 'low',
                    mode: 'push',
                    target_yaku: winResult.yaku.map(([name]) => name),
                  },
                  tokens_used: 0,
                  model_name: 'engine',
                });
              }

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

          // === 大明槓/ポン/チーチェック ===
          if (!handOver) {
            let called = false;

            // 大明槓チェック（ポンより優先）
            const daiminkanCandidates = engine.getDaiminkanCandidates(discardedTile, discarderSeat);
            if (daiminkanCandidates.length > 0) {
              for (const kanSeat of daiminkanCandidates) {
                const kanTwin = orderedTwins[kanSeat];
                // 大明槓の判断: naki_tendencyに基づく
                const nakiTendency = kanTwin?.style_params?.naki_tendency ?? 50;
                const shouldKan = Math.random() * 100 < nakiTendency;

                if (shouldKan) {
                  const success = engine.executeDaiminkan(kanSeat, discardedTile);
                  if (success) {
                    seqNo++;
                    const kanMeld = engine.getState().players[kanSeat].melds.slice(-1)[0];
                    const { data: kanAction } = await supabase.from('actions').insert({
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
                    }).select().single();

                    if (kanAction) {
                      await supabase.from('reasoning_logs').insert({
                        action_id: kanAction.id,
                        summary_text: `${kanTwin?.name || '???'}が${tileToName(discardedTile)}を大明槓！`,
                        detail_text: null,
                        structured_json: {
                          candidates: [],
                          risk: 'medium',
                          mode: 'push',
                          target_yaku: [],
                          is_naki_decision: true,
                        },
                        tokens_used: 0,
                        model_name: 'engine',
                      });
                    }

                    // 嶺上ツモ後のツモ和了チェック
                    if (engine.canTsumo(kanSeat)) {
                      const winResult = engine.executeTsumo(kanSeat);
                      if (winResult) {
                        seqNo++;
                        await supabase.from('actions').insert({
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

            // ポンチェック（大明槓されなかった場合）
            const ponCandidates = !called ? engine.getPonCandidates(discardedTile, discarderSeat) : [];
            if (ponCandidates.length > 0) {
              for (const ponSeat of ponCandidates) {
                const ponTwin = orderedTwins[ponSeat];
                let shouldPon = false;

                if (useLLM && ponTwin && totalTokensUsed < MAX_TOKENS_PER_GAME) {
                  try {
                    const nakiDecision = await decideNaki(
                      ponTwin,
                      engine.getState(),
                      'pon',
                      discardedTile,
                      process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai'
                    );
                    shouldPon = nakiDecision.shouldCall;
                    totalTokensUsed += 100; // 鳴き判断の概算トークン
                  } catch {
                    // NPC style_params based fallback
                    const nakiTendency = ponTwin.style_params?.naki_tendency ?? 50;
                    shouldPon = Math.random() * 100 < nakiTendency;
                  }
                } else {
                  const nakiTendency = ponTwin?.style_params?.naki_tendency ?? 50;
                  shouldPon = Math.random() * 100 < nakiTendency;
                }

                if (shouldPon) {
                  const success = engine.executePon(ponSeat, discardedTile);
                  if (success) {
                    seqNo++;
                    const ponMeld = engine.getState().players[ponSeat].melds.slice(-1)[0];
                    const { data: ponAction } = await supabase.from('actions').insert({
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
                    }).select().single();

                    if (ponAction) {
                      await supabase.from('reasoning_logs').insert({
                        action_id: ponAction.id,
                        summary_text: `${ponTwin?.name || '???'}が${tileToName(discardedTile)}をポン！`,
                        detail_text: null,
                        structured_json: {
                          candidates: [],
                          risk: 'medium',
                          mode: 'push',
                          target_yaku: [],
                          is_naki_decision: true,
                        },
                        tokens_used: 0,
                        model_name: 'engine',
                      });
                    }

                    called = true;
                    // ポン後は打牌フェーズに戻る（nextTurnしない）
                    break;
                  }
                }
              }
            }

            // チーチェック（上家のみ、ポンされなかった場合）
            if (!called) {
              const nextSeat = (discarderSeat + 1) % 4;
              if (engine.canChi(nextSeat, discardedTile)) {
                const chiTwin = orderedTwins[nextSeat];
                let shouldChi = false;

                if (useLLM && chiTwin && totalTokensUsed < MAX_TOKENS_PER_GAME) {
                  try {
                    const nakiDecision = await decideNaki(
                      chiTwin,
                      engine.getState(),
                      'chi',
                      discardedTile,
                      process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai'
                    );
                    shouldChi = nakiDecision.shouldCall;
                    totalTokensUsed += 100; // 鳴き判断の概算トークン
                  } catch {
                    const nakiTendency = chiTwin.style_params?.naki_tendency ?? 50;
                    shouldChi = Math.random() * 100 < nakiTendency * 0.7; // チーはポンより控えめ
                  }
                } else {
                  const nakiTendency = chiTwin?.style_params?.naki_tendency ?? 50;
                  shouldChi = Math.random() * 100 < nakiTendency * 0.7;
                }

                if (shouldChi) {
                  const chiOptions = engine.getChiOptions(nextSeat, discardedTile);
                  if (chiOptions.length > 0) {
                    const chosenOption = chiOptions[0]; // 最初の選択肢
                    const success = engine.executeChi(nextSeat, chosenOption);
                    if (success) {
                      seqNo++;
                      const chiMeld = engine.getState().players[nextSeat].melds.slice(-1)[0];
                      const { data: chiAction } = await supabase.from('actions').insert({
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
                      }).select().single();

                      if (chiAction) {
                        await supabase.from('reasoning_logs').insert({
                          action_id: chiAction.id,
                          summary_text: `${chiTwin?.name || '???'}が${tileToName(discardedTile)}をチー！`,
                          detail_text: null,
                          structured_json: {
                            candidates: [],
                            risk: 'medium',
                            mode: 'push',
                            target_yaku: [],
                            is_naki_decision: true,
                          },
                          tokens_used: 0,
                          model_name: 'engine',
                        });
                      }

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
          total_tokens_used: totalTokensUsed,
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
