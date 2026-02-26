'use client';

import { useMemo, useState, useEffect } from 'react';
import { PlayerSeat } from './PlayerSeat';
import { PlayerAvatar } from './PlayerAvatar';
import { MahjongTile } from './MahjongTile';
import { ThoughtBubble } from './ThoughtBubble';
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
          if (payload.tiles) {
            players[seat].melds.push({ type: 'ankan', tiles: payload.tiles });
            for (const t of payload.tiles) {
              const idx = players[seat].hand.indexOf(t);
              if (idx >= 0) players[seat].hand.splice(idx, 1);
            }
            if (players[seat].tsumo && payload.tiles.includes(players[seat].tsumo!)) {
              players[seat].tsumo = undefined;
            }
          }
        } else if (payload.kan_type === 'kakan') {
          const ponMeldIdx = players[seat].melds.findIndex(
            m => m.type === 'pon' && m.tiles.some(t => t.replace(/0/, '5') === (payload.tile || '').replace(/0/, '5'))
          );
          if (ponMeldIdx >= 0) {
            players[seat].melds[ponMeldIdx] = {
              type: 'kakan',
              tiles: [...players[seat].melds[ponMeldIdx].tiles, payload.tile!],
            };
          }
          if (players[seat].tsumo === payload.tile) {
            players[seat].tsumo = undefined;
          } else {
            const idx = players[seat].hand.indexOf(payload.tile!);
            if (idx >= 0) players[seat].hand.splice(idx, 1);
          }
        } else if (payload.kan_type === 'daiminkan') {
          if (payload.tiles) {
            players[seat].melds.push({ type: 'kan', tiles: payload.tiles });
            const calledTile = payload.tile || payload.tiles[0];
            const handTiles = payload.tiles.filter(t => t !== calledTile);
            for (const t of handTiles) {
              const idx = players[seat].hand.indexOf(t);
              if (idx >= 0) players[seat].hand.splice(idx, 1);
            }
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

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return isMobile;
}

export function MahjongTable({ twins, actions, currentAction, currentReasoning, highlightTiles = [] }: MahjongTableProps) {
  const state = useMemo(() => reconstructState(actions), [actions]);
  const seatNames = ['東', '南', '西', '北'];
  const seatColors = ['text-red-400', 'text-blue-400', 'text-green-400', 'text-yellow-400'];
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState(0);

  // モバイルでは現在のアクターに自動切替
  useEffect(() => {
    if (isMobile && currentAction) {
      setActiveTab(currentAction.actor_seat);
    }
  }, [isMobile, currentAction]);

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
        actorSeat: currentAction.actor_seat,
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
        actorSeat: currentAction.actor_seat,
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
        actorSeat: -1,
        tenpaiPlayers: tenpaiSeats && tenpaiSeats.length > 0
          ? tenpaiSeats.map(s => twins[s]?.name || seatNames[s]).join(' / ')
          : '全員ノーテン',
      };
    }
    return null;
  }, [currentAction, twins, seatNames]);

  return (
    <div className="flex flex-col gap-2 sm:gap-3">
      {/* ゲーム情報バー */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1 sm:gap-4 py-2 px-3 sm:px-4 bg-card/80 backdrop-blur-sm rounded-xl border border-border/50">
        <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
          <span className="font-bold text-base sm:text-lg text-gold">{state.round}</span>
          {state.honba > 0 && <span className="text-xs sm:text-sm text-muted-foreground">{state.honba}本場</span>}
          {state.kyotaku > 0 && (
            <span className="text-xs sm:text-sm text-yellow-400">供託{state.kyotaku}</span>
          )}

          {/* 牌山残り（視覚的） */}
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-0.5">
              <div className="w-3 h-4 bg-amber-50/80 border border-gray-400/30 rounded-[1px]" />
              <div className="w-3 h-4 bg-amber-50/60 border border-gray-400/20 rounded-[1px] -ml-1" />
              <div className="w-3 h-4 bg-amber-50/40 border border-gray-400/10 rounded-[1px] -ml-1" />
            </div>
            <span className="text-xs sm:text-sm font-medium">
              残<span className={`ml-0.5 ${state.remainingTiles <= 10 ? 'text-red-400 font-bold' : 'text-muted-foreground'}`}>
                {state.remainingTiles}
              </span>枚
            </span>
          </div>

          {state.doraIndicators.length > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] sm:text-xs text-muted-foreground">ドラ:</span>
              {state.doraIndicators.map((tile, i) => (
                <MahjongTile key={i} tile={tile} size="sm" />
              ))}
            </div>
          )}
        </div>

        {actionText && (
          <span className="text-xs sm:text-sm font-medium">
            <span className={currentAction ? seatColors[currentAction.actor_seat] : ''}>
              {actionText}
            </span>
          </span>
        )}
      </div>

      {/* 和了/流局オーバーレイ */}
      {agariInfo && (
        <div className="bg-card/90 backdrop-blur-sm border-2 border-primary/50 rounded-xl p-4 sm:p-5 text-center animate-overlay-in">
          {/* 和了プレイヤーのアバター */}
          {agariInfo.actor && agariInfo.actorSeat >= 0 && (
            <div className="flex justify-center mb-2">
              <PlayerAvatar
                avatarUrl={twins[agariInfo.actorSeat]?.avatar_url}
                name={agariInfo.actor}
                seatWind={seatNames[agariInfo.actorSeat]}
                seatColor={seatColors[agariInfo.actorSeat]}
                size="lg"
                isActive
              />
            </div>
          )}
          <p className={`text-2xl sm:text-3xl font-black ${agariInfo.labelColor} mb-1`}>{agariInfo.label}</p>
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
            <p className="text-xs sm:text-sm mt-1">テンパイ: {agariInfo.tenpaiPlayers}</p>
          )}
          {agariInfo.yaku && (
            <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2 my-2">
              {agariInfo.yaku.map(([name, han], i) => (
                <span key={i} className="text-xs sm:text-sm bg-card/50 px-2 py-0.5 rounded">
                  {name} <span className={agariInfo.labelColor}>{han}翻</span>
                </span>
              ))}
            </div>
          )}
          {agariInfo.han && (
            <p className="text-lg sm:text-xl font-bold">
              {agariInfo.han}翻{agariInfo.fu}符
            </p>
          )}
          {agariInfo.scoreLevel && (
            <p className={`text-sm font-bold mt-1 ${agariInfo.labelColor}`}>{agariInfo.scoreLevel}</p>
          )}
        </div>
      )}

      {/* モバイル: プレイヤータブ */}
      {isMobile && (
        <div className="flex gap-1 bg-card/60 rounded-xl p-1 border border-border/30">
          {[0, 1, 2, 3].map((seat) => (
            <button
              key={seat}
              onClick={() => setActiveTab(seat)}
              className={[
                'flex-1 flex items-center justify-center gap-1.5 py-1.5 px-1 rounded-lg transition-all text-xs',
                activeTab === seat
                  ? 'bg-card border border-border shadow-sm'
                  : 'hover:bg-card/50',
                state.currentActor === seat ? 'ring-1 ring-primary/50' : '',
              ].join(' ')}
            >
              <PlayerAvatar
                avatarUrl={twins[seat]?.avatar_url}
                name={twins[seat]?.name || '???'}
                seatWind={seatNames[seat]}
                seatColor={seatColors[seat]}
                size="sm"
                isActive={state.currentActor === seat}
              />
              <span className={`truncate ${seatColors[seat]} font-medium`}>
                {twins[seat]?.name?.slice(0, 4) || '???'}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* プレイヤーグリッド */}
      {isMobile ? (
        /* モバイル: 選択中のプレイヤーのみ表示 */
        <div className="animate-fade-in" key={activeTab}>
          <PlayerSeat
            twin={twins[activeTab]}
            hand={state.players[activeTab].hand}
            tsumo={state.players[activeTab].tsumo}
            discards={state.players[activeTab].discards}
            melds={state.players[activeTab].melds}
            riichi={state.players[activeTab].riichi}
            riichiDiscardIndex={state.players[activeTab].riichiDiscardIndex}
            score={state.players[activeTab].score}
            isCurrentActor={state.currentActor === activeTab}
            seatName={seatNames[activeTab]}
            seatColor={seatColors[activeTab]}
            compact={false}
            reasoning={currentAction?.actor_seat === activeTab ? currentReasoning : null}
          />
        </div>
      ) : (
        /* PC: 2x2 グリッド */
        <div className="grid grid-cols-2 gap-2 sm:gap-3">
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
              reasoning={currentAction?.actor_seat === seat ? currentReasoning : null}
            />
          ))}
        </div>
      )}

      {/* PC版: 全体の思考パネル（現在のアクター以外の直近の思考もサマリ表示） */}
      {!isMobile && currentReasoning && currentAction && (
        <div className="bg-card/60 backdrop-blur-sm rounded-xl border border-border/30 p-3 animate-fade-in">
          <div className="flex items-center gap-2 mb-1.5">
            <PlayerAvatar
              avatarUrl={twins[currentAction.actor_seat]?.avatar_url}
              name={twins[currentAction.actor_seat]?.name || '???'}
              seatWind={seatNames[currentAction.actor_seat]}
              seatColor={seatColors[currentAction.actor_seat]}
              size="sm"
              isActive
            />
            <span className={`text-sm font-semibold ${seatColors[currentAction.actor_seat]}`}>
              {twins[currentAction.actor_seat]?.name}の思考
            </span>

            {currentReasoning.structured_json?.risk && (
              <span className={`text-[10px] px-1 py-0.5 rounded ${
                currentReasoning.structured_json.risk === 'high' ? 'bg-red-500/20 text-red-400' :
                currentReasoning.structured_json.risk === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                'bg-green-500/20 text-green-400'
              }`}>
                {currentReasoning.structured_json.risk === 'high' ? '危険'
                  : currentReasoning.structured_json.risk === 'medium' ? '注意' : '安全'}
              </span>
            )}

            {currentReasoning.structured_json?.target_yaku?.map((yaku: string, i: number) => (
              <span key={i} className="text-[10px] bg-primary/20 text-primary px-1 py-0.5 rounded">
                {yaku}
              </span>
            ))}
          </div>

          <p className="text-sm leading-relaxed">{currentReasoning.summary_text}</p>

          {currentReasoning.structured_json?.candidates?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {currentReasoning.structured_json.candidates.map((c: any, i: number) => (
                <span key={i} className="text-xs p-1.5 rounded bg-muted/30 inline-flex items-center gap-1">
                  <span className="font-bold text-primary bg-primary/10 px-1 rounded">{c.tile}</span>
                  <span className="text-muted-foreground">{c.reason_short}</span>
                </span>
              ))}
            </div>
          )}

          {currentReasoning.detail_text && (
            <div className="mt-2 p-2 bg-muted/20 rounded text-xs leading-relaxed whitespace-pre-wrap border-l-2 border-primary/30 text-muted-foreground max-h-32 overflow-y-auto">
              {currentReasoning.detail_text}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
