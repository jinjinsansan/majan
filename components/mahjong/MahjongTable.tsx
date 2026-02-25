'use client';

import { useMemo } from 'react';
import type { Twin, Action } from '@/lib/types';

// 牌をテキスト表示用に変換
function tileToText(tile: string): string {
  const suit = tile.slice(-1);
  const num = tile.slice(0, -1);
  
  if (suit === 'z') {
    const honors: Record<string, string> = {
      '1': '東', '2': '南', '3': '西', '4': '北',
      '5': '白', '6': '發', '7': '中'
    };
    return honors[num] || tile;
  }
  
  const suitChars: Record<string, string> = {
    'm': '萬', 'p': '筒', 's': '索'
  };
  
  // 赤ドラは赤い5として表示
  if (num === '0') {
    return '5' + suitChars[suit]?.charAt(0);
  }
  
  return num + suitChars[suit]?.charAt(0);
}

interface MahjongTableProps {
  twins: Twin[];
  actions: Action[];
  currentAction?: Action;
}

// アクションから現在の状態を再構築
function reconstructState(actions: Action[]) {
  const players = [
    { hand: [] as string[], discards: [] as string[], melds: [] as any[], riichi: false, score: 25000 },
    { hand: [] as string[], discards: [] as string[], melds: [] as any[], riichi: false, score: 25000 },
    { hand: [] as string[], discards: [] as string[], melds: [] as any[], riichi: false, score: 25000 },
    { hand: [] as string[], discards: [] as string[], melds: [] as any[], riichi: false, score: 25000 },
  ];
  
  let currentActor = 0;
  let round = '東1局';
  let honba = 0;
  let remainingTiles = 70;
  let doraIndicators: string[] = [];

  actions.forEach(action => {
    const seat = action.actor_seat;
    const payload = action.payload_json || {};

    switch (action.action_type) {
      case 'deal':
        // 配牌
        if (payload.tiles && Array.isArray(payload.tiles)) {
          players[seat].hand = [...payload.tiles];
        }
        break;
      case 'draw':
        if (payload.tile) {
          players[seat].hand.push(payload.tile);
        }
        remainingTiles--;
        break;
      case 'discard':
        if (payload.tile) {
          players[seat].discards.push(payload.tile);
          const idx = players[seat].hand.indexOf(payload.tile);
          if (idx >= 0) players[seat].hand.splice(idx, 1);
        }
        break;
      case 'riichi':
        players[seat].riichi = true;
        break;
      // TODO: chi, pon, kan, tsumo, ron
    }

    currentActor = seat;
  });

  return { players, currentActor, round, honba, remainingTiles, doraIndicators };
}

export function MahjongTable({ twins, actions, currentAction }: MahjongTableProps) {
  const state = useMemo(() => {
    console.log('Reconstructing state from', actions.length, 'actions');
    const result = reconstructState(actions);
    console.log('State:', result.players.map(p => p.hand.length));
    return result;
  }, [actions]);
  const seatNames = ['東', '南', '西', '北'];
  const seatColors = ['text-red-400', 'text-blue-400', 'text-green-400', 'text-yellow-400'];

  return (
    <div className="h-full flex flex-col">
      {/* 局情報ヘッダー */}
      <div className="text-center py-2 border-b">
        <span className="font-semibold">{state.round}</span>
        {state.honba > 0 && <span className="ml-2 text-sm text-muted-foreground">{state.honba}本場</span>}
        <span className="ml-4 text-sm text-muted-foreground">残り{state.remainingTiles}枚</span>
      </div>

      {/* 卓エリア */}
      <div className="flex-1 relative bg-green-900/30 rounded-lg m-4 min-h-[400px]">
        {/* 中央: ドラ表示 */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
          <div className="bg-card p-3 rounded-lg shadow">
            <p className="text-xs text-muted-foreground mb-1">ドラ表示</p>
            <div className="flex gap-1 justify-center">
              {state.doraIndicators.length > 0 ? (
                state.doraIndicators.map((tile, i) => (
                  <span key={i} className="text-2xl">{tileToEmoji(tile)}</span>
                ))
              ) : (
                <span className="text-2xl opacity-50">🀫</span>
              )}
            </div>
          </div>
        </div>

        {/* 各席 */}
        {[0, 1, 2, 3].map((seat) => {
          const twin = twins[seat];
          const player = state.players[seat];
          const isCurrentActor = state.currentActor === seat;
          
          // 席の位置設定
          const positions: Record<number, string> = {
            0: 'bottom-2 left-1/2 -translate-x-1/2', // 東（下）
            1: 'top-1/2 right-2 -translate-y-1/2',   // 南（右）
            2: 'top-2 left-1/2 -translate-x-1/2',    // 西（上）
            3: 'top-1/2 left-2 -translate-y-1/2',    // 北（左）
          };

          const discardPositions: Record<number, string> = {
            0: 'bottom-24 left-1/2 -translate-x-1/2',
            1: 'top-1/2 right-24 -translate-y-1/2',
            2: 'top-24 left-1/2 -translate-x-1/2',
            3: 'top-1/2 left-24 -translate-y-1/2',
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
                    {player.riichi && <span className="text-xs bg-red-500/20 text-red-400 px-1 rounded">立直</span>}
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">{player.score.toLocaleString()}点</p>
                  
                  {/* 手牌（公開手牌ルール） */}
                  <div className="flex flex-wrap gap-1 max-w-[320px]">
                    {player.hand.sort().map((tile, i) => (
                      <span 
                        key={i} 
                        className="inline-block w-7 h-10 bg-amber-50 border border-amber-200 rounded text-center leading-10 text-lg shadow-sm"
                        title={tile}
                      >
                        {tileToText(tile)}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* 捨て牌 */}
              <div className={`absolute ${discardPositions[seat]}`}>
                <div className="flex flex-wrap gap-0.5 max-w-[200px] justify-center">
                  {player.discards.slice(-12).map((tile, i) => (
                    <span 
                      key={i} 
                      className="inline-block w-6 h-8 bg-gray-200 border border-gray-300 rounded text-center leading-8 text-xs shadow-sm text-gray-700"
                      title={tile}
                    >
                      {tileToText(tile)}
                    </span>
                  ))}
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
            {currentAction.action_type === 'discard' && `が ${currentAction.payload_json?.tile} を切った`}
            {currentAction.action_type === 'draw' && 'がツモった'}
            {currentAction.action_type === 'riichi' && 'がリーチ！'}
            {currentAction.action_type === 'tsumo' && 'がツモ和了！'}
            {currentAction.action_type === 'ron' && 'がロン！'}
          </span>
        </div>
      )}
    </div>
  );
}
