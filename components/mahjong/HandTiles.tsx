'use client';

import { tileToDisplay } from './tile-utils';

interface HandTilesProps {
  tiles: string[];
  tsumo?: string;
  highlightTiles?: string[];
}

export function HandTiles({ tiles, tsumo, highlightTiles = [] }: HandTilesProps) {
  const sorted = [...tiles].sort();

  return (
    <div className="flex flex-wrap gap-0.5 items-end">
      {sorted.map((tile, i) => {
        const t = tileToDisplay(tile);
        const isHighlighted = highlightTiles.includes(tile);
        return (
          <div
            key={`${tile}-${i}`}
            className={`
              px-1 py-0.5 bg-amber-50 border rounded shadow text-xs font-bold
              transition-all duration-200
              ${t.isRed ? 'text-red-600' : t.isHonor ? 'text-green-700' : 'text-gray-800'}
              ${isHighlighted ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-400' : 'border-amber-400'}
            `}
            title={tile}
          >
            {t.text}
          </div>
        );
      })}
      {tsumo && (
        <>
          <div className="w-1.5" />
          {(() => {
            const t = tileToDisplay(tsumo);
            const isHighlighted = highlightTiles.includes(tsumo);
            return (
              <div
                className={`
                  px-1 py-0.5 bg-amber-100 border-2 rounded shadow text-xs font-bold
                  transition-all duration-200
                  ${t.isRed ? 'text-red-600' : t.isHonor ? 'text-green-700' : 'text-gray-800'}
                  ${isHighlighted ? 'border-blue-400 ring-1 ring-blue-400' : 'border-primary'}
                `}
                title={`ツモ: ${tsumo}`}
              >
                {t.text}
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
