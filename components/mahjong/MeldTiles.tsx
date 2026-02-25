'use client';

import { tileToDisplay } from './tile-utils';

interface MeldTilesProps {
  melds: { type: string; tiles: string[] }[];
}

export function MeldTiles({ melds }: MeldTilesProps) {
  if (melds.length === 0) return null;

  const meldLabels: Record<string, string> = {
    pon: 'ポン',
    chi: 'チー',
    kan: 'カン',
    ankan: '暗槓',
    kakan: '加槓',
  };

  return (
    <div className="flex flex-wrap gap-1 mb-1">
      {melds.map((meld, mi) => (
        <div key={mi} className="flex gap-0.5 bg-muted/50 px-1 py-0.5 rounded items-center">
          <span className="text-[9px] text-muted-foreground mr-0.5">
            {meldLabels[meld.type] || meld.type}
          </span>
          {meld.tiles.map((tile, ti) => {
            const t = tileToDisplay(tile);
            return (
              <div
                key={ti}
                className={`px-0.5 bg-amber-50 border border-amber-400 rounded text-[10px] font-bold ${
                  t.isRed ? 'text-red-600' : t.isHonor ? 'text-green-700' : 'text-gray-800'
                }`}
              >
                {t.text}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
