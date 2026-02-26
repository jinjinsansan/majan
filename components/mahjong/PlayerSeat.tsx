'use client';

import { HandTiles } from './HandTiles';
import { MeldTiles } from './MeldTiles';
import { DiscardPile } from './DiscardPile';
import type { Twin } from '@/lib/types';

interface PlayerSeatProps {
  twin?: Twin;
  hand: string[];
  tsumo?: string;
  discards: string[];
  melds: { type: string; tiles: string[] }[];
  riichi: boolean;
  riichiDiscardIndex?: number;
  score: number;
  isCurrentActor: boolean;
  seatName: string;
  seatColor: string;
}

export function PlayerSeat({
  twin,
  hand,
  tsumo,
  discards,
  melds,
  riichi,
  riichiDiscardIndex,
  score,
  isCurrentActor,
  seatName,
  seatColor,
}: PlayerSeatProps) {
  return (
    <div
      className={[
        'bg-card rounded-lg border p-3 flex flex-col gap-2 transition-all duration-200',
        isCurrentActor ? 'ring-2 ring-primary shadow-lg' : '',
      ].join(' ')}
    >
      {/* Header: seat wind, name, score, riichi badge */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`font-bold text-base ${seatColor}`}>{seatName}</span>
        <span className="text-sm truncate max-w-[120px]">{twin?.name || '???'}</span>
        <span className="text-sm text-muted-foreground ml-auto">{score.toLocaleString()}点</span>
        {riichi && (
          <span className="text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded animate-pulse">
            立直
          </span>
        )}
      </div>

      {/* Melds */}
      {melds.length > 0 && <MeldTiles melds={melds} />}

      {/* Hand tiles + tsumo */}
      <div className="min-h-[2.75rem]">
        <HandTiles tiles={hand} tsumo={tsumo} />
      </div>

      {/* Discard pile (compact) */}
      {discards.length > 0 && (
        <div>
          <p className="text-[10px] text-muted-foreground mb-0.5">捨牌</p>
          <DiscardPile
            discards={discards}
            riichiIndex={riichiDiscardIndex}
          />
        </div>
      )}
    </div>
  );
}
