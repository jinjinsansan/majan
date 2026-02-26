'use client';

import { useMemo } from 'react';
import { PlayerSeat } from './PlayerSeat';
import { MahjongTile } from './MahjongTile';
import { tileToDisplay } from './tile-utils';
import type { Twin, Action, ReasoningLog } from '@/lib/types';

interface MahjongTableProps {
  twins: Twin[];
  actions: Action[];
  currentAction?: Action;
  currentReasoning?: ReasoningLog | null;
  highlightTiles?: string[];
}

interface ReconstructedPlayer {
  hand: string[];
  discards: string[];
  melds: { type: string; tiles: string[] }[];
  riichi: boolean;
  riichiDiscardIndex: number | undefined;
  score: number;
  tsumo?: string;
}

// アクションから現在の状態を再構築
function reconstructState(actions: Action[]) {
  const players: ReconstructedPlayer[] = [
    { hand: [], discards: [], melds: [], riichi: false, riichiDiscardIndex: undefined, score: 25000, tsumo: undefined },
    { hand: [], discards: [], melds: [], riichi: false, riichiDiscardIndex: undefined, score: 25000, tsumo: undefined },
    { hand: [], discards: [], melds: [], riichi: false, riichiDiscardIndex: undefined, score: 25000, tsumo: undefined },
    { hand: [], discards: [], melds: [], riichi: false, riichiDiscardIndex: undefined, score: 25000, tsumo: undefined },
  ];

  let currentActor = 0;
  let round = '東1局';
  let honba = 0;
  let kyotaku = 0;
  let remainingTiles = 70;
  let doraIndicators: string[] = [];
  let handCount = 0;
  let currentHandId: string | null = null;
  let dealerSeat = 0;

  actions.forEach(action => {
    const seat = action.actor_seat;
    const payload = action.payload_json || {};

    switch (action.action_type) {
      case 'deal':
        // 新しい局が始まったかチェック
        if (action.hand_id !== currentHandId) {
          if (currentHandId !== null) {
            for (let i = 0; i < 4; i++) {
              players[i].hand = [];
              players[i].discards = [];
              players[i].melds = [];
              players[i].riichi = false;
              players[i].riichiDiscardIndex = undefined;
              players[i].tsumo = undefined;
            }
            remainingTiles = 70;
            kyotaku = 0;
          }
          currentHandId = action.hand_id;
          if (seat === 0) {
            handCount++;
            dealerSeat = handCount <= 4 ? handCount - 1 : 0;
            round = `東${Math.min(handCount, 4)}局`;
          }
        }
        if (payload.tiles && Array.isArray(payload.tiles)) {
          players[seat].hand = [...payload.tiles];
        }
        if (payload.dora_indicators) {
          doraIndicators = payload.dora_indicators;
        }
        break;

      case 'draw':
        if (payload.tile) {
          players[seat].tsumo = payload.tile;
        }
        remainingTiles--;
        break;

      case 'discard':
        if (payload.tile) {
          players[seat].discards.push(payload.tile);
          if (players[seat].tsumo === payload.tile) {
            players[seat].tsumo = undefined;
          } else {
            if (players[seat].tsumo) {
              players[seat].hand.push(players[seat].tsumo!);
              players[seat].tsumo = undefined;
            }
            const idx = players[seat].hand.indexOf(payload.tile);
            if (idx >= 0) players[seat].hand.splice(idx, 1);
          }
        }
        break;

      case 'riichi':
        players[seat].riichi = true;
        // リーチ宣言牌は次の打牌のインデックス（現在の捨て牌数）
        players[seat].riichiDiscardIndex = players[seat].discards.length;
        players[seat].score -= 1000;
        kyotaku++;
        break;

      case 'tsumo':
        if (payload.score_changes) {
          const changes = payload.score_changes as number[];
          for (let i = 0; i < 4; i++) {
            players[i].score += changes[i] || 0;
          }
        }
        break;

      case 'ron':
        if (payload.score_changes) {
          const changes = payload.score_changes as number[];
          for (let i = 0; i < 4; i++) {
            players[i].score += changes[i] || 0;
          }
        }
        break;

      case 'pon':
        if (payload.tiles) {
          players[seat].melds.push({ type: 'pon', tiles: payload.tiles });
          for (const t of payload.tiles.slice(1)) {
            const idx = players[seat].hand.indexOf(t);
            if (idx >= 0) players[seat].hand.splice(idx, 1);
          }
          if (payload.from_seat !== undefined) {
            const fromDiscards = players[payload.from_seat].discards;
            if (fromDiscards.length > 0) fromDiscards.pop();
          }
        }
        break;

      case 'chi':
        if (payload.tiles) {
          players[seat].melds.push({ type: 'chi', tiles: payload.tiles });
          for (const t of payload.tiles.slice(1)) {
            const idx = players[seat].hand.indexOf(t);
            if (idx >= 0) players[seat].hand.splice(idx, 1);
          }
          if (payload.from_seat !== undefined) {
            const fromDiscards = players[payload.from_seat].discards;
            if (fromDiscards.length > 0) fromDiscards.pop();
          }
        }
        break;

      case 'kan':
        if (payload.kan_type === 'ankan') {
          // 暗槓: 手牌から4枚取り出して副露に
          if (payload.tiles) {
            players[seat].melds.push({ type: 'ankan', tiles: payload.tiles });
            for (const t of payload.tiles) {
              const idx = players[seat].hand.indexOf(t);
              if (idx >= 0) players[seat].hand.splice(idx, 1);
            }
            // ツモ牌からも除外
            if (players[seat].tsumo && payload.tiles.includes(players[seat].tsumo!)) {
              players[seat].tsumo = undefined;
            }
          }
        } else if (payload.kan_type === 'kakan') {
          // 加槓: 既存ポンに1枚追加
          const ponMeldIdx = players[seat].melds.findIndex(
            m => m.type === 'pon' && m.tiles.some(t => t.replace(/0/, '5') === (payload.tile || '').replace(/0/, '5'))
          );
          if (ponMeldIdx >= 0) {
            players[seat].melds[ponMeldIdx] = {
              type: 'kakan',
              tiles: [...players[seat].melds[ponMeldIdx].tiles, payload.tile!],
            };
          }
          // 手牌/ツモから除外
          if (players[seat].tsumo === payload.tile) {
            players[seat].tsumo = undefined;
          } else {
            const idx = players[seat].hand.indexOf(payload.tile!);
            if (idx >= 0) players[seat].hand.splice(idx, 1);
          }
        } else if (payload.kan_type === 'daiminkan') {
          // 大明槓: 他家の捨て牌+手牌3枚
          if (payload.tiles) {
            players[seat].melds.push({ type: 'kan', tiles: payload.tiles });
            // 手牌から3枚除外（鳴いた牌除く）
            const calledTile = payload.tile || payload.tiles[0];
            const handTiles = payload.tiles.filter(t => t !== calledTile);
            for (const t of handTiles) {
              const idx = players[seat].hand.indexOf(t);
              if (idx >= 0) players[seat].hand.splice(idx, 1);
            }
            // 捨て牌から除外
            if (payload.from_seat !== undefined) {
              const fromDiscards = players[payload.from_seat].discards;
              if (fromDiscards.length > 0) fromDiscards.pop();
            }
          }
        }
        break;

      case 'ryukyoku':
        if (payload.score_changes) {
          const changes = payload.score_changes as number[];
          for (let i = 0; i < 4; i++) {
            players[i].score += changes[i] || 0;
          }
        }
        break;
    }

    currentActor = seat;
  });

  return { players, currentActor, round, honba, kyotaku, remainingTiles, doraIndicators, dealerSeat };
}

export function MahjongTable({ twins, actions, currentAction, currentReasoning, highlightTiles = [] }: MahjongTableProps) {
  const state = useMemo(() => reconstructState(actions), [actions]);
  const seatNames = ['東', '南', '西', '北'];
  const seatColors = ['text-red-400', 'text-blue-400', 'text-green-400', 'text-yellow-400'];

  // Build action description text
  const actionText = useMemo(() => {
    if (!currentAction) return null;
    const actorName = twins[currentAction.actor_seat]?.name || seatNames[currentAction.actor_seat];
    const payload = currentAction.payload_json || {};

    switch (currentAction.action_type) {
      case 'discard':
        return `${actorName} が ${tileToDisplay(payload.tile || '').text} を切った`;
      case 'draw':
        return `${actorName} がツモった`;
      case 'riichi':
        return `${actorName} がリーチ!`;
      case 'tsumo':
        return `${actorName} がツモ和了!`;
      case 'ron':
        return `${actorName} がロン!`;
      case 'pon':
        return `${actorName} がポン!`;
      case 'chi':
        return `${actorName} がチー!`;
      case 'kan': {
        const kanLabel = payload.kan_type === 'ankan' ? '暗槓'
          : payload.kan_type === 'kakan' ? '加槓' : '大明槓';
        return `${actorName} が${kanLabel}!`;
      }
      case 'ryukyoku':
        return '流局';
      default:
        return null;
    }
  }, [currentAction, twins, seatNames]);

  // Agari overlay info
  const agariInfo = useMemo(() => {
    if (!currentAction) return null;
    const payload = currentAction.payload_json || {};
    const actorName = twins[currentAction.actor_seat]?.name || seatNames[currentAction.actor_seat];

    if (currentAction.action_type === 'tsumo') {
      return {
        label: 'ツモ!',
        labelColor: 'text-primary',
        actor: actorName,
        yaku: payload.yaku as [string, number][] | undefined,
        han: payload.han as number | undefined,
        fu: payload.fu as number | undefined,
        scoreLevel: payload.score_level as string | undefined,
      };
    }
    if (currentAction.action_type === 'ron') {
      return {
        label: 'ロン!',
        labelColor: 'text-red-400',
        actor: actorName,
        yaku: payload.yaku as [string, number][] | undefined,
        han: payload.han as number | undefined,
        fu: payload.fu as number | undefined,
        scoreLevel: payload.score_level as string | undefined,
        fromTile: payload.tile ? tileToDisplay(payload.tile).text : undefined,
        fromPlayer: payload.from_seat !== undefined
          ? (twins[payload.from_seat]?.name || seatNames[payload.from_seat])
          : undefined,
      };
    }
    if (currentAction.action_type === 'ryukyoku') {
      const tenpaiSeats = payload.tenpai_seats as number[] | undefined;
      return {
        label: '流局',
        labelColor: 'text-yellow-400',
        actor: null,
        tenpaiPlayers: tenpaiSeats && tenpaiSeats.length > 0
          ? tenpaiSeats.map(s => twins[s]?.name || seatNames[s]).join(' / ')
          : '全員ノーテン',
      };
    }
    return null;
  }, [currentAction, twins, seatNames]);

  // Reasoning display
  const reasoning = currentReasoning;
  const structured = reasoning?.structured_json;

  return (
    <div className="flex flex-col gap-3">
      {/* Game info bar */}
      <div className="flex items-center justify-center gap-4 flex-wrap py-2 px-4 bg-card rounded-lg border">
        <span className="font-semibold text-lg">{state.round}</span>
        {state.honba > 0 && <span className="text-sm text-muted-foreground">{state.honba}本場</span>}
        {state.kyotaku > 0 && (
          <span className="text-sm text-yellow-400">供託{state.kyotaku}</span>
        )}
        <span className="text-sm text-muted-foreground">残り{state.remainingTiles}枚</span>
        {state.doraIndicators.length > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">ドラ:</span>
            {state.doraIndicators.map((tile, i) => (
              <MahjongTile key={i} tile={tile} size="sm" />
            ))}
          </div>
        )}

        {/* Current action description */}
        {actionText && (
          <>
            <span className="text-muted-foreground">|</span>
            <span className="text-sm">
              <span className={currentAction ? seatColors[currentAction.actor_seat] : ''}>
                {actionText}
              </span>
            </span>
          </>
        )}
      </div>

      {/* Agari / Ryukyoku overlay */}
      {agariInfo && (
        <div className="bg-card border-2 border-primary rounded-lg p-4 text-center animate-overlay-in">
          <p className={`text-2xl font-bold ${agariInfo.labelColor} mb-1`}>{agariInfo.label}</p>
          {agariInfo.actor && (
            <p className="text-sm text-muted-foreground mb-2">{agariInfo.actor}</p>
          )}
          {'fromTile' in agariInfo && agariInfo.fromTile && (
            <p className="text-xs text-muted-foreground mb-2">
              ロン牌: {agariInfo.fromTile}
              {'fromPlayer' in agariInfo && agariInfo.fromPlayer && ` (${agariInfo.fromPlayer}から)`}
            </p>
          )}
          {'tenpaiPlayers' in agariInfo && (
            <p className="text-sm mt-1">テンパイ: {agariInfo.tenpaiPlayers}</p>
          )}
          {agariInfo.yaku && (
            <div className="flex flex-wrap justify-center gap-2 my-2">
              {agariInfo.yaku.map(([name, han], i) => (
                <span key={i} className="text-sm">
                  {name} <span className={agariInfo.labelColor}>{han}翻</span>
                </span>
              ))}
            </div>
          )}
          {agariInfo.han && (
            <p className="text-lg font-semibold">
              {agariInfo.han}翻{agariInfo.fu}符
            </p>
          )}
          {agariInfo.scoreLevel && (
            <p className={`text-sm font-semibold mt-1 ${agariInfo.labelColor}`}>{agariInfo.scoreLevel}</p>
          )}
        </div>
      )}

      {/* 2x2 Player grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((seat) => (
          <PlayerSeat
            key={seat}
            twin={twins[seat]}
            hand={state.players[seat].hand}
            tsumo={state.players[seat].tsumo}
            discards={state.players[seat].discards}
            melds={state.players[seat].melds}
            riichi={state.players[seat].riichi}
            riichiDiscardIndex={state.players[seat].riichiDiscardIndex}
            score={state.players[seat].score}
            isCurrentActor={state.currentActor === seat}
            seatName={seatNames[seat]}
            seatColor={seatColors[seat]}
          />
        ))}
      </div>

      {/* Integrated reasoning section */}
      {reasoning && (
        <div className="bg-card rounded-lg border p-4 animate-fade-in">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-sm font-semibold text-muted-foreground">思考</span>
            {currentAction && (
              <span className={`text-sm font-semibold ${seatColors[currentAction.actor_seat]}`}>
                {twins[currentAction.actor_seat]?.name || seatNames[currentAction.actor_seat]}
              </span>
            )}

            {structured?.risk && (
              <span className={`text-xs px-1.5 py-0.5 rounded ${
                structured.risk === 'high' ? 'bg-red-500/20 text-red-400' :
                structured.risk === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                'bg-green-500/20 text-green-400'
              }`}>
                {structured.risk === 'high' ? '危険'
                  : structured.risk === 'medium' ? '注意' : '安全'}
              </span>
            )}

            {structured?.mode && (
              <span className={`text-xs px-1.5 py-0.5 rounded ${
                structured.mode === 'push' ? 'bg-red-500/10 text-red-300' :
                structured.mode === 'pull' ? 'bg-blue-500/10 text-blue-300' :
                'bg-gray-500/10 text-gray-300'
              }`}>
                {structured.mode === 'push' ? '押し'
                  : structured.mode === 'pull' ? '引き' : 'バランス'}
              </span>
            )}

            {structured?.target_yaku && structured.target_yaku.length > 0 && (
              <div className="flex gap-1 ml-auto">
                {structured.target_yaku.map((yaku, i) => (
                  <span
                    key={i}
                    className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded"
                  >
                    {yaku}
                  </span>
                ))}
              </div>
            )}
          </div>

          <p className="text-sm leading-relaxed">{reasoning.summary_text}</p>

          {structured?.candidates && structured.candidates.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {structured.candidates.map((candidate, i) => (
                <span
                  key={i}
                  className="text-xs p-1.5 rounded bg-muted/50 inline-flex items-center gap-1.5"
                >
                  <span className="font-bold text-primary bg-primary/10 px-1 rounded">
                    {candidate.tile}
                  </span>
                  <span className="text-muted-foreground">{candidate.reason_short}</span>
                </span>
              ))}
            </div>
          )}

          {reasoning.detail_text && (
            <details className="mt-2">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
                詳細を見る
              </summary>
              <div className="mt-2 p-2 bg-muted/50 rounded text-xs leading-relaxed whitespace-pre-wrap">
                {reasoning.detail_text}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
