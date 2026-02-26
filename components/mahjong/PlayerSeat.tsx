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
  compact?: boolean;
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
  compact = false,
}: PlayerSeatProps) {
  const tileSize = compact ? 'sm' : 'sm' as const;
  const handTileSize = compact ? 'sm' : 'md' as const;

  return (
    <div
      className={[
        'bg-card rounded-lg border flex flex-col gap-1.5 sm:gap-2 transition-all duration-200',
        'p-2 sm:p-3',
        isCurrentActor ? 'ring-2 ring-primary shadow-lg' : '',
      ].join(' ')}
    >
      {/* Header: seat wind, name, score, riichi badge */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        <span className={`font-bold text-sm sm:text-base ${seatColor}`}>{seatName}</span>
        <span className="text-xs sm:text-sm truncate flex-1 min-w-0">{twin?.name || '???'}</span>
        <span className="text-xs sm:text-sm text-muted-foreground whitespace-nowrap">{score.toLocaleString()}点</span>
        {riichi && (
          <span className="text-[10px] sm:text-xs bg-red-500/20 text-red-400 px-1 sm:px-1.5 py-0.5 rounded animate-pulse">
            立直
          </span>
        )}
      </div>

      {/* Melds */}
      {melds.length > 0 && <MeldTiles melds={melds} tileSize={tileSize} />}

      {/* Hand tiles + tsumo */}
      <div className="min-h-[2rem] sm:min-h-[2.75rem] overflow-x-auto">
        <HandTiles tiles={hand} tsumo={tsumo} tileSize={handTileSize} />
      </div>

      {/* Discard pile (compact) */}
      {discards.length > 0 && (
        <div>
          <p className="text-[10px] text-muted-foreground mb-0.5">捨牌</p>
          <DiscardPile
            discards={discards}
            riichiIndex={riichiDiscardIndex}
            tileSize={tileSize}
          />
        </div>
      )}
    </div>
  );
}
