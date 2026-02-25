'use client';

import { tileToDisplay } from './tile-utils';

interface DiscardPileProps {
  discards: string[];
  isLatestDiscard?: boolean;
  latestTile?: string;
  riichiIndex?: number; // リーチ宣言牌のインデックス
}

export function DiscardPile({ discards, isLatestDiscard, latestTile, riichiIndex }: DiscardPileProps) {
  // 6列表示
  const visibleDiscards = discards.slice(-18);

  return (
    <div className="flex flex-wrap gap-0.5 max-w-[200px] justify-center">
      {visibleDiscards.map((tile, i) => {
        const t = tileToDisplay(tile);
        const actualIndex = discards.length - visibleDiscards.length + i;
        const isLast = isLatestDiscard && i === visibleDiscards.length - 1;
        const isRiichiTile = riichiIndex !== undefined && actualIndex === riichiIndex;

        return (
          <div
            key={`${tile}-${i}`}
            className={`
              px-0.5 bg-gray-200 border rounded text-[10px] font-bold
              transition-all duration-200
              ${t.isRed ? 'text-red-500' : 'text-gray-700'}
              ${isLast ? 'border-primary bg-primary/10 animate-fade-in' : 'border-gray-400'}
              ${isRiichiTile ? 'rotate-90 mx-0.5' : ''}
            `}
            title={tile}
          >
            {t.text}
          </div>
        );
      })}
    </div>
  );
}
