'use client';

import { HandTiles } from './HandTiles';
import { MeldTiles } from './MeldTiles';
import { DiscardPile } from './DiscardPile';
import type { Twin } from '@/lib/types';

interface PlayerSeatProps {
  seat: number;
  twin?: Twin;
  hand: string[];
  tsumo?: string;
  discards: string[];
  melds: { type: string; tiles: string[] }[];
  riichi: boolean;
  riichiDiscardIndex?: number;
  score: number;
  isCurrentActor: boolean;
  isLatestDiscard: boolean;
  highlightTiles?: string[];
  seatName: string;
  seatColor: string;
}

export function PlayerSeat({
  seat,
  twin,
  hand,
  tsumo,
  discards,
  melds,
  riichi,
  riichiDiscardIndex,
  score,
  isCurrentActor,
  isLatestDiscard,
  highlightTiles = [],
  seatName,
  seatColor,
}: PlayerSeatProps) {
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
    <div>
      {/* プレイヤー情報 + 手牌 */}
      <div className={`absolute ${positions[seat]}`}>
        <div className={`bg-card p-3 rounded-lg transition-all duration-300 ${
          isCurrentActor ? 'ring-2 ring-primary shadow-lg' : ''
        }`}>
          {/* 名前・点数 */}
          <div className="flex items-center gap-2 mb-2">
            <span className={`font-bold ${seatColor}`}>{seatName}</span>
            <span className="text-sm truncate max-w-[100px]">{twin?.name || '???'}</span>
            {riichi && (
              <span className="text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded flex items-center gap-0.5 animate-pulse">
                立直
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm text-muted-foreground">{score.toLocaleString()}点</span>
            {riichi && (
              <span className="text-xs text-red-400" title="リーチ棒 1000点">🀫</span>
            )}
          </div>

          {/* 副露 */}
          <MeldTiles melds={melds} />

          {/* 手牌 */}
          <HandTiles tiles={hand} tsumo={tsumo} highlightTiles={highlightTiles} />
        </div>
      </div>

      {/* 捨て牌 */}
      <div className={`absolute ${discardPositions[seat]}`}>
        <DiscardPile
          discards={discards}
          isLatestDiscard={isLatestDiscard}
          riichiIndex={riichiDiscardIndex}
        />
      </div>
    </div>
  );
}
