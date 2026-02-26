'use client';

import { MahjongTile } from './MahjongTile';

interface HandTilesProps {
  tiles: string[];
  tsumo?: string;
  highlightTiles?: string[];
  tileSize?: 'sm' | 'md' | 'lg';
}

export function HandTiles({ tiles, tsumo, highlightTiles = [], tileSize = 'md' }: HandTilesProps) {
  const sorted = [...tiles].sort();

  return (
    <div className="flex flex-wrap items-end gap-[1px]">
      {sorted.map((tile, i) => (
        <MahjongTile
          key={`hand-${tile}-${i}`}
          tile={tile}
          size={tileSize}
          isHighlighted={highlightTiles.includes(tile)}
        />
      ))}
      {tsumo && (
        <>
          <div className="w-1 sm:w-2" aria-hidden="true" />
          <MahjongTile
            tile={tsumo}
            size={tileSize}
            isTsumo
            isHighlighted={highlightTiles.includes(tsumo)}
          />
        </>
      )}
    </div>
  );
}
