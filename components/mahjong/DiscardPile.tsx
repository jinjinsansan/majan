'use client';

import { MahjongTile } from './MahjongTile';

interface DiscardPileProps {
  discards: string[];
  isLatestDiscard?: boolean;
  latestTile?: string;
  riichiIndex?: number;
  tileSize?: 'sm' | 'md' | 'lg';
}

export function DiscardPile({ discards, isLatestDiscard, latestTile, riichiIndex, tileSize = 'sm' }: DiscardPileProps) {
  const visibleDiscards = discards.slice(-18);

  // Split into rows of 6
  const rows: string[][] = [];
  for (let i = 0; i < visibleDiscards.length; i += 6) {
    rows.push(visibleDiscards.slice(i, i + 6));
  }

  return (
    <div className="flex flex-col gap-0.5">
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} className="flex gap-0.5">
          {row.map((tile, colIndex) => {
            const flatIndex = rowIndex * 6 + colIndex;
            const actualIndex = discards.length - visibleDiscards.length + flatIndex;
            const isLast = isLatestDiscard && flatIndex === visibleDiscards.length - 1;
            const isRiichiTile = riichiIndex !== undefined && actualIndex === riichiIndex;

            return (
              <MahjongTile
                key={`discard-${tile}-${flatIndex}`}
                tile={tile}
                size={tileSize}
                isRiichi={isRiichiTile}
                isHighlighted={isLast}
                className={isLast ? 'animate-fade-in' : ''}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
