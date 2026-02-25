'use client';

import { useMemo } from 'react';
import type { Twin, Action } from '@/lib/types';

// 牌を表示用テキストに変換
function tileToDisplay(tile: string): { text: string; isRed: boolean; isHonor: boolean } {
  if (!tile || tile.length < 2) return { text: '?', isRed: false, isHonor: false };

  const suitChar = tile.slice(-1);
  const numStr = tile.slice(0, -1);

  // 字牌
  if (suitChar === 'z') {
    const honors: Record<string, string> = {
      '1': '東', '2': '南', '3': '西', '4': '北',
      '5': '白', '6': '發', '7': '中'
    };
    return { text: honors[numStr] || '?', isRed: false, isHonor: true };
  }

  // 数牌
  const suitNames: Record<string, string> = { 'm': '萬', 'p': '筒', 's': '索' };
  const suitName = suitNames[suitChar] || '?';

  // 赤ドラ（0 = 赤5）
  if (numStr === '0') {
    return { text: '5' + suitName, isRed: true, isHonor: false };
  }

  return { text: numStr + suitName, isRed: false, isHonor: false };
}

// ドラ表示牌→ドラ牌テキスト
function doraIndicatorToDisplay(tile: string): string {
  const t = tileToDisplay(tile);
  return t.text;
}

interface MahjongTableProps {
  twins: Twin[];
  actions: Action[];
  currentAction?: Action;
}

interface ReconstructedPlayer {
  hand: string[];
  discards: string[];
  melds: { type: string; tiles: string[] }[];
  riichi: boolean;
  score: number;
  tsumo?: string;
}

// アクションから現在の状態を再構築
function reconstructState(actions: Action[]) {
  const players: ReconstructedPlayer[] = [
    { hand: [], discards: [], melds: [], riichi: false, score: 25000, tsumo: undefined },
    { hand: [], discards: [], melds: [], riichi: false, score: 25000, tsumo: undefined },
    { hand: [], discards: [], melds: [], riichi: false, score: 25000, tsumo: undefined },
    { hand: [], discards: [], melds: [], riichi: false, score: 25000, tsumo: undefined },
  ];

  let currentActor = 0;
  let round = '東1局';
  let honba = 0;
  let kyotaku = 0;
  let remainingTiles = 70;
  let doraIndicators: string[] = [];
  let lastEvent: string | null = null;
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
            // 局が変わった → 状態リセット
            for (let i = 0; i < 4; i++) {
              players[i].hand = [];
              players[i].discards = [];
              players[i].melds = [];
              players[i].riichi = false;
              players[i].tsumo = undefined;
            }
            remainingTiles = 70;
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
          // ツモ牌を切った場合
          if (players[seat].tsumo === payload.tile) {
            players[seat].tsumo = undefined;
          } else {
            // 手出し: ツモ牌を手牌に入れてから切る
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
        players[seat].score -= 1000;
        kyotaku++;
        lastEvent = `${seat}番席がリーチ！`;
        break;

      case 'tsumo':
        if (payload.score_changes) {
          const changes = payload.score_changes as number[];
          for (let i = 0; i < 4; i++) {
            players[i].score += changes[i] || 0;
          }
        }
        lastEvent = `${seat}番席がツモ和了！`;
        break;

      case 'ron':
        if (payload.score_changes) {
          const changes = payload.score_changes as number[];
          for (let i = 0; i < 4; i++) {
            players[i].score += changes[i] || 0;
          }
        }
        lastEvent = `${seat}番席がロン！`;
        break;

      case 'pon':
        if (payload.tiles) {
          players[seat].melds.push({ type: 'pon', tiles: payload.tiles });
          // 手牌から2枚除去
          for (const t of payload.tiles.slice(1)) {
            const idx = players[seat].hand.indexOf(t);
            if (idx >= 0) players[seat].hand.splice(idx, 1);
          }
          // 捨て牌から鳴いた牌を除去
          if (payload.from_seat !== undefined) {
            const fromDiscards = players[payload.from_seat].discards;
            if (fromDiscards.length > 0) fromDiscards.pop();
          }
        }
        lastEvent = `${seat}番席がポン！`;
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
        lastEvent = `${seat}番席がチー！`;
        break;

      case 'ryukyoku':
        if (payload.score_changes) {
          const changes = payload.score_changes as number[];
          for (let i = 0; i < 4; i++) {
            players[i].score += changes[i] || 0;
          }
        }
        lastEvent = '流局';
        break;
    }

    currentActor = seat;
  });

  return { players, currentActor, round, honba, kyotaku, remainingTiles, doraIndicators, lastEvent };
}

export function MahjongTable({ twins, actions, currentAction }: MahjongTableProps) {
  const state = useMemo(() => reconstructState(actions), [actions]);
  const seatNames = ['東', '南', '西', '北'];
  const seatColors = ['text-red-400', 'text-blue-400', 'text-green-400', 'text-yellow-400'];

  return (
    <div className="h-full flex flex-col">
      {/* 局情報ヘッダー */}
      <div className="text-center py-2 border-b flex items-center justify-center gap-4">
        <span className="font-semibold">{state.round}</span>
        {state.honba > 0 && <span className="text-sm text-muted-foreground">{state.honba}本場</span>}
        {state.kyotaku > 0 && <span className="text-sm text-yellow-400">供託{state.kyotaku}</span>}
        <span className="text-sm text-muted-foreground">残り{state.remainingTiles}枚</span>
        <div className="text-xs bg-yellow-500/10 text-yellow-400 px-2 py-0.5 rounded">
          公開手牌ルール
        </div>
      </div>

      {/* 卓エリア */}
      <div className="flex-1 relative bg-green-900/30 rounded-lg m-4 min-h-[500px]">
        {/* 中央: ドラ表示 + イベント */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center z-10">
          <div className="bg-card p-3 rounded-lg shadow">
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

          {/* 最新イベント表示 */}
          {currentAction && (currentAction.action_type === 'tsumo' || currentAction.action_type === 'ron' || currentAction.action_type === 'ryukyoku') && (
            <div className="mt-2 bg-card/95 p-4 rounded-lg border-2 border-primary shadow-lg animate-pulse">
              {currentAction.action_type === 'tsumo' && (
                <div>
                  <p className="text-lg font-bold text-primary">ツモ！</p>
                  <p className="text-sm text-muted-foreground">
                    {twins[currentAction.actor_seat]?.name}
                  </p>
                  {currentAction.payload_json?.yaku && (
                    <p className="text-xs mt-1">
                      {(currentAction.payload_json.yaku as string[]).join('・')}
                    </p>
                  )}
                  {currentAction.payload_json?.han && (
                    <p className="text-sm font-semibold mt-1">
                      {currentAction.payload_json.han}翻{currentAction.payload_json.fu}符
                    </p>
                  )}
                </div>
              )}
              {currentAction.action_type === 'ron' && (
                <div>
                  <p className="text-lg font-bold text-red-400">ロン！</p>
                  <p className="text-sm text-muted-foreground">
                    {twins[currentAction.actor_seat]?.name}
                  </p>
                  {currentAction.payload_json?.yaku && (
                    <p className="text-xs mt-1">
                      {(currentAction.payload_json.yaku as string[]).join('・')}
                    </p>
                  )}
                  {currentAction.payload_json?.han && (
                    <p className="text-sm font-semibold mt-1">
                      {currentAction.payload_json.han}翻{currentAction.payload_json.fu}符
                    </p>
                  )}
                </div>
              )}
              {currentAction.action_type === 'ryukyoku' && (
                <div>
                  <p className="text-lg font-bold text-yellow-400">流局</p>
                  {currentAction.payload_json?.tenpai_seats && (
                    <p className="text-xs mt-1">
                      テンパイ: {(currentAction.payload_json.tenpai_seats as number[]).map(s => seatNames[s]).join('・') || 'なし'}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 各席 */}
        {[0, 1, 2, 3].map((seat) => {
          const twin = twins[seat];
          const player = state.players[seat];
          const isCurrentActor = state.currentActor === seat;

          // 席の位置設定
          const positions: Record<number, string> = {
            0: 'bottom-2 left-1/2 -translate-x-1/2',
            1: 'top-1/2 right-2 -translate-y-1/2',
            2: 'top-2 left-1/2 -translate-x-1/2',
            3: 'top-1/2 left-2 -translate-y-1/2',
          };

          const discardPositions: Record<number, string> = {
            0: 'bottom-28 left-1/2 -translate-x-1/2',
            1: 'top-1/2 right-28 -translate-y-1/2',
            2: 'top-28 left-1/2 -translate-x-1/2',
            3: 'top-1/2 left-28 -translate-y-1/2',
          };

          return (
            <div key={seat}>
              {/* プレイヤー情報 + 手牌 */}
              <div className={`absolute ${positions[seat]}`}>
                <div className={`bg-card p-3 rounded-lg ${isCurrentActor ? 'ring-2 ring-primary' : ''}`}>
                  {/* 名前・点数 */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`font-bold ${seatColors[seat]}`}>{seatNames[seat]}</span>
                    <span className="text-sm truncate max-w-[100px]">{twin?.name || '???'}</span>
                    {player.riichi && (
                      <span className="text-xs bg-red-500/20 text-red-400 px-1 rounded flex items-center gap-0.5">
                        🏮 立直
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">{player.score.toLocaleString()}点</p>

                  {/* 副露（鳴き牌） */}
                  {player.melds.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-1">
                      {player.melds.map((meld, mi) => (
                        <div key={mi} className="flex gap-0.5 bg-muted/50 px-1 py-0.5 rounded">
                          <span className="text-[9px] text-muted-foreground mr-0.5">
                            {meld.type === 'pon' ? 'ポン' : meld.type === 'chi' ? 'チー' : 'カン'}
                          </span>
                          {meld.tiles.map((tile, ti) => {
                            const t = tileToDisplay(tile);
                            return (
                              <div
                                key={ti}
                                className={`px-0.5 bg-amber-50 border border-amber-400 rounded text-[10px] font-bold ${t.isRed ? 'text-red-600' : t.isHonor ? 'text-green-700' : 'text-gray-800'}`}
                              >
                                {t.text}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 手牌（公開手牌ルール） */}
                  <div className="flex flex-wrap gap-0.5">
                    {player.hand.sort().map((tile, i) => {
                      const t = tileToDisplay(tile);
                      return (
                        <div
                          key={i}
                          className={`px-1 py-0.5 bg-amber-50 border border-amber-400 rounded shadow text-xs font-bold ${t.isRed ? 'text-red-600' : t.isHonor ? 'text-green-700' : 'text-gray-800'}`}
                          title={tile}
                        >
                          {t.text}
                        </div>
                      );
                    })}
                    {/* ツモ牌 */}
                    {player.tsumo && (
                      <>
                        <div className="w-1" /> {/* スペーサー */}
                        {(() => {
                          const t = tileToDisplay(player.tsumo);
                          return (
                            <div
                              className={`px-1 py-0.5 bg-amber-100 border-2 border-primary rounded shadow text-xs font-bold ${t.isRed ? 'text-red-600' : t.isHonor ? 'text-green-700' : 'text-gray-800'}`}
                              title={`ツモ: ${player.tsumo}`}
                            >
                              {t.text}
                            </div>
                          );
                        })()}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* 捨て牌 */}
              <div className={`absolute ${discardPositions[seat]}`}>
                <div className="flex flex-wrap gap-0.5 max-w-[200px] justify-center">
                  {player.discards.slice(-12).map((tile, i) => {
                    const t = tileToDisplay(tile);
                    const isLastDiscard = i === player.discards.slice(-12).length - 1 &&
                      currentAction?.action_type === 'discard' &&
                      currentAction?.actor_seat === seat;
                    return (
                      <div
                        key={i}
                        className={`px-0.5 bg-gray-200 border rounded text-[10px] font-bold
                          ${t.isRed ? 'text-red-500' : 'text-gray-700'}
                          ${isLastDiscard ? 'border-primary bg-primary/10' : 'border-gray-400'}
                        `}
                        title={tile}
                      >
                        {t.text}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
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
            {currentAction.action_type === 'ryukyoku' && '— 流局'}
          </span>
        </div>
      )}
    </div>
  );
}
