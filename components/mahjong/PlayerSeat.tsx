'use client';

import { HandTiles } from './HandTiles';
import { MeldTiles } from './MeldTiles';
import { DiscardPile } from './DiscardPile';
import { PlayerAvatar } from './PlayerAvatar';
import { ThoughtBubble } from './ThoughtBubble';
import type { Twin, ReasoningLog } from '@/lib/types';

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
  reasoning?: ReasoningLog | null;
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
  reasoning,
}: PlayerSeatProps) {
  const tileSize = compact ? 'sm' : 'sm' as const;
  const handTileSize = compact ? 'sm' : 'md' as const;

  return (
    <div
      className={[
        'bg-card/80 backdrop-blur-sm rounded-xl border flex flex-col gap-1.5 sm:gap-2 transition-all duration-300',
        'p-2 sm:p-3',
        isCurrentActor ? 'ring-2 ring-primary/70 shadow-lg shadow-primary/10' : 'border-border/50',
      ].join(' ')}
    >
      {/* ヘッダー: アバター + 名前 + スコア */}
      <div className="flex items-center gap-2 sm:gap-3">
        <PlayerAvatar
          avatarUrl={twin?.avatar_url}
          name={twin?.name || '???'}
          seatWind={seatName}
          seatColor={seatColor}
          size={compact ? 'sm' : 'md'}
          isActive={isCurrentActor}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs sm:text-sm font-semibold truncate">{twin?.name || '???'}</span>
            {riichi && (
              <span className="text-[9px] sm:text-[10px] bg-red-500/20 text-red-400 px-1 py-0.5 rounded font-medium animate-pulse flex-shrink-0">
                立直
              </span>
            )}
          </div>
          <span className="text-[10px] sm:text-xs text-muted-foreground">{score.toLocaleString()}点</span>
        </div>
      </div>

      {/* 思考吹き出し */}
      {reasoning && isCurrentActor && (
        <ThoughtBubble
          reasoning={reasoning}
          seatColor={seatColor}
          compact={compact}
        />
      )}

      {/* 副露 */}
      {melds.length > 0 && <MeldTiles melds={melds} tileSize={tileSize} />}

      {/* 手牌 + ツモ */}
      <div className="min-h-[2rem] sm:min-h-[2.75rem] overflow-x-auto">
        <HandTiles tiles={hand} tsumo={tsumo} tileSize={handTileSize} />
      </div>

      {/* 捨て牌 */}
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
