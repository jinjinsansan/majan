'use client';

import { MahjongTile } from './MahjongTile';

interface MeldTilesProps {
  melds: { type: string; tiles: string[] }[];
}

const meldLabels: Record<string, string> = {
  pon: '\u30DD\u30F3',
  chi: '\u30C1\u30FC',
  kan: '\u30AB\u30F3',
  ankan: '\u6697\u69D3',
  kakan: '\u52A0\u69D3',
};

export function MeldTiles({ melds }: MeldTilesProps) {
  if (melds.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 mb-1">
      {melds.map((meld, mi) => (
        <div
          key={mi}
          className="flex gap-0.5 bg-muted/50 px-1 py-0.5 rounded items-center"
        >
          <span className="text-[9px] text-muted-foreground mr-0.5">
            {meldLabels[meld.type] || meld.type}
          </span>
          {meld.tiles.map((tile, ti) => (
            <MahjongTile
              key={`meld-${mi}-${tile}-${ti}`}
              tile={tile}
              size="sm"
            />
          ))}
        </div>
      ))}
    </div>
  );
}
