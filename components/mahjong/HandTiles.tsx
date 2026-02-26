'use client';

import { MahjongTile } from './MahjongTile';

interface HandTilesProps {
  tiles: string[];
  tsumo?: string;
  highlightTiles?: string[];
}

export function HandTiles({ tiles, tsumo, highlightTiles = [] }: HandTilesProps) {
  const sorted = [...tiles].sort();

  return (
    <div className="flex flex-wrap items-end">
      {sorted.map((tile, i) => (
        <MahjongTile
          key={`hand-${tile}-${i}`}
          tile={tile}
          size="md"
          isHighlighted={highlightTiles.includes(tile)}
        />
      ))}
      {tsumo && (
        <>
          <div className="w-2" aria-hidden="true" />
          <MahjongTile
            tile={tsumo}
            size="md"
            isTsumo
            isHighlighted={highlightTiles.includes(tsumo)}
          />
        </>
      )}
    </div>
  );
}
