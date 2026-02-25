'use client';

import { useMemo } from 'react';
import { PlayerSeat } from './PlayerSeat';
import { GameOverlay } from './GameOverlay';
import { tileToDisplay } from './tile-utils';
import type { Twin, Action } from '@/lib/types';

interface MahjongTableProps {
  twins: Twin[];
  actions: Action[];
  currentAction?: Action;
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

export function MahjongTable({ twins, actions, currentAction, highlightTiles = [] }: MahjongTableProps) {
  const state = useMemo(() => reconstructState(actions), [actions]);
  const seatNames = ['東', '南', '西', '北'];
  const seatColors = ['text-red-400', 'text-blue-400', 'text-green-400', 'text-yellow-400'];

  return (
    <div className="h-full flex flex-col">
      {/* 局情報ヘッダー */}
      <div className="text-center py-2 border-b flex items-center justify-center gap-4 flex-wrap">
        <span className="font-semibold text-lg">{state.round}</span>
        {state.honba > 0 && <span className="text-sm text-muted-foreground">{state.honba}本場</span>}
        {state.kyotaku > 0 && (
          <span className="text-sm text-yellow-400 flex items-center gap-1">
            供託{state.kyotaku}
          </span>
        )}
        <span className="text-sm text-muted-foreground">残り{state.remainingTiles}枚</span>
        <div className="text-xs bg-yellow-500/10 text-yellow-400 px-2 py-0.5 rounded border border-yellow-500/30">
          公開手牌ルール
        </div>
      </div>

      {/* 卓エリア */}
      <div className="flex-1 relative bg-green-900/30 rounded-lg m-4 min-h-[500px]">
        {/* 中央: ドラ表示 */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center z-10">
          <div className="bg-card p-3 rounded-lg shadow-lg">
            <p className="text-xs text-muted-foreground mb-1">ドラ表示</p>
            <div className="flex gap-1 justify-center">
              {state.doraIndicators.length > 0 ? (
                state.doraIndicators.map((tile, i) => {
                  const t = tileToDisplay(tile);
                  return (
                    <div key={i} className={`px-1.5 py-0.5 bg-amber-50 border border-amber-400 rounded text-sm font-bold ${t.isRed ? 'text-red-600' : 'text-gray-800'}`}>
                      {t.text}
                    </div>
                  );
                })
              ) : (
                <span className="text-sm opacity-50">-</span>
              )}
            </div>
          </div>
        </div>

        {/* イベントオーバーレイ */}
        <GameOverlay
          currentAction={currentAction}
          twins={twins}
          seatNames={seatNames}
        />

        {/* 各席 */}
        {[0, 1, 2, 3].map((seat) => (
          <PlayerSeat
            key={seat}
            seat={seat}
            twin={twins[seat]}
            hand={state.players[seat].hand}
            tsumo={state.players[seat].tsumo}
            discards={state.players[seat].discards}
            melds={state.players[seat].melds}
            riichi={state.players[seat].riichi}
            riichiDiscardIndex={state.players[seat].riichiDiscardIndex}
            score={state.players[seat].score}
            isCurrentActor={state.currentActor === seat}
            isLatestDiscard={
              currentAction?.action_type === 'discard' &&
              currentAction?.actor_seat === seat
            }
            highlightTiles={highlightTiles}
            seatName={seatNames[seat]}
            seatColor={seatColors[seat]}
          />
        ))}
      </div>

      {/* 最新アクション表示 */}
      {currentAction && (
        <div className="text-center py-2 border-t">
          <span className="text-sm">
            <span className={seatColors[currentAction.actor_seat]}>
              {twins[currentAction.actor_seat]?.name || seatNames[currentAction.actor_seat]}
            </span>
            {' '}
            {currentAction.action_type === 'discard' && `が ${tileToDisplay(currentAction.payload_json?.tile || '').text} を切った`}
            {currentAction.action_type === 'draw' && 'がツモった'}
            {currentAction.action_type === 'riichi' && 'がリーチ！'}
            {currentAction.action_type === 'tsumo' && 'がツモ和了！'}
            {currentAction.action_type === 'ron' && 'がロン！'}
            {currentAction.action_type === 'pon' && 'がポン！'}
            {currentAction.action_type === 'chi' && 'がチー！'}
            {currentAction.action_type === 'kan' && `が${currentAction.payload_json?.kan_type === 'ankan' ? '暗槓' : currentAction.payload_json?.kan_type === 'kakan' ? '加槓' : '大明槓'}！`}
            {currentAction.action_type === 'ryukyoku' && '— 流局'}
          </span>
        </div>
      )}
    </div>
  );
}
