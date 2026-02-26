'use client';

import { cn } from '@/lib/utils';
import { parseTile } from './tile-utils';

interface MahjongTileProps {
  tile: string;
  size?: 'sm' | 'md' | 'lg';
  isHighlighted?: boolean;
  isTsumo?: boolean;
  isRiichi?: boolean;
  className?: string;
}

// ─── Size definitions ───────────────────────────────────────────
const sizeConfig = {
  sm: { outer: 'w-6 h-8', circleSize: 3, bambooH: 4, bambooW: 1.5, gap: 0.5 },
  md: { outer: 'w-[30px] h-10', circleSize: 4, bambooH: 5, bambooW: 2, gap: 0.5 },
  lg: { outer: 'w-9 h-12', circleSize: 5, bambooH: 6, bambooW: 2.5, gap: 1 },
} as const;

// ─── Man (萬子) rendering ───────────────────────────────────────
const manNumerals: Record<number, string> = {
  1: '一', 2: '二', 3: '三', 4: '四', 5: '五',
  6: '六', 7: '七', 8: '八', 9: '九',
};

function ManFace({ num, size, isRed }: { num: number; size: 'sm' | 'md' | 'lg'; isRed: boolean }) {
  const color = isRed ? 'text-red-600' : 'text-red-700';
  return (
    <div className="flex flex-col items-center justify-center h-full leading-none">
      <span
        className={cn(
          'font-black',
          size === 'sm' ? 'text-[10px]' : size === 'md' ? 'text-xs' : 'text-sm',
          color,
        )}
      >
        {manNumerals[num] || num}
      </span>
      <span
        className={cn(
          'font-bold leading-none',
          size === 'sm' ? 'text-[5px]' : size === 'md' ? 'text-[6px]' : 'text-[7px]',
          color,
        )}
      >
        萬
      </span>
    </div>
  );
}

// ─── Pin (筒子) rendering ───────────────────────────────────────
// Layouts: each sub-array is a row on a 3x3 virtual grid.
// 1 = circle present, 0 = empty space.
const pinLayouts: Record<number, number[][]> = {
  1: [[0, 0, 0], [0, 1, 0], [0, 0, 0]],
  2: [[0, 1, 0], [0, 0, 0], [0, 1, 0]],
  3: [[0, 0, 1], [0, 1, 0], [1, 0, 0]],
  4: [[1, 0, 1], [0, 0, 0], [1, 0, 1]],
  5: [[1, 0, 1], [0, 1, 0], [1, 0, 1]],
  6: [[1, 0, 1], [1, 0, 1], [1, 0, 1]],
  7: [[1, 1, 1], [0, 1, 0], [1, 1, 1]],
  8: [[1, 1, 1], [1, 0, 1], [1, 1, 1]],
  9: [[1, 1, 1], [1, 1, 1], [1, 1, 1]],
};

function PinFace({ num, size, isRed }: { num: number; size: 'sm' | 'md' | 'lg'; isRed: boolean }) {
  const layout = pinLayouts[num];
  if (!layout) return <span>?</span>;

  const { circleSize, gap } = sizeConfig[size];
  const fillColor = isRed ? 'bg-red-500' : 'bg-teal-600';

  return (
    <div
      className="flex flex-col items-center justify-center h-full"
      style={{ gap: `${gap}px` }}
    >
      {layout.map((row, ri) => (
        <div key={ri} className="flex items-center justify-center" style={{ gap: `${gap}px` }}>
          {row.map((cell, ci) => (
            <div
              key={ci}
              className={cn(
                'rounded-full flex-shrink-0',
                cell ? fillColor : 'bg-transparent',
              )}
              style={{
                width: `${circleSize}px`,
                height: `${circleSize}px`,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Sou (索子) rendering ───────────────────────────────────────
// bambooLayouts[n] = array of rows, each value is the number of sticks in that row
const bambooLayouts: Record<number, number[]> = {
  2: [1, 1],
  3: [1, 1, 1],
  4: [2, 2],
  5: [2, 1, 2],
  6: [2, 2, 2],
  7: [3, 1, 3],
  8: [3, 2, 3],
  9: [3, 3, 3],
};

function SouFace({ num, size, isRed }: { num: number; size: 'sm' | 'md' | 'lg'; isRed: boolean }) {
  const stickColor = isRed ? 'bg-red-500' : 'bg-green-700';
  const borderColor = isRed ? 'border-red-500' : 'border-green-700';
  const dotColor = isRed ? 'bg-red-500' : 'bg-green-700';
  const dotBg = isRed ? 'bg-red-50' : 'bg-green-50';

  // 1s is the special tile -- concentric circle (stylized bird)
  if (num === 1) {
    return (
      <div className="flex items-center justify-center h-full">
        <div
          className={cn(
            'rounded-full border-2 flex items-center justify-center',
            borderColor,
            dotBg,
            size === 'sm' ? 'w-3.5 h-3.5' : size === 'md' ? 'w-4 h-4' : 'w-5 h-5',
          )}
        >
          <div
            className={cn(
              'rounded-full',
              dotColor,
              size === 'sm' ? 'w-1.5 h-1.5' : size === 'md' ? 'w-2 h-2' : 'w-2.5 h-2.5',
            )}
          />
        </div>
      </div>
    );
  }

  const layout = bambooLayouts[num];
  if (!layout) return <span>?</span>;

  const { bambooH, bambooW, gap } = sizeConfig[size];

  return (
    <div
      className="flex flex-col items-center justify-center h-full"
      style={{ gap: `${gap}px` }}
    >
      {layout.map((count, ri) => (
        <div key={ri} className="flex items-center justify-center" style={{ gap: `${gap + 0.5}px` }}>
          {Array.from({ length: count }).map((_, bi) => (
            <div
              key={bi}
              className={cn('rounded-[0.5px] flex-shrink-0', stickColor)}
              style={{
                width: `${bambooW}px`,
                height: `${bambooH}px`,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Jihai (字牌) rendering ─────────────────────────────────────
const honorChars: Record<number, string> = {
  1: '東', 2: '南', 3: '西', 4: '北',
  5: '白', 6: '發', 7: '中',
};

const honorColors: Record<number, string> = {
  1: 'text-blue-700',
  2: 'text-blue-700',
  3: 'text-blue-700',
  4: 'text-blue-700',
  5: 'text-gray-400',
  6: 'text-green-700',
  7: 'text-red-600',
};

function HonorFace({ num, size }: { num: number; size: 'sm' | 'md' | 'lg' }) {
  const char = honorChars[num];
  if (!char) return <span>?</span>;

  // 白 (haku) -- white dragon rendered as an empty bordered rectangle
  if (num === 5) {
    return (
      <div className="flex items-center justify-center h-full">
        <div
          className={cn(
            'border-2 border-gray-300 rounded-sm',
            size === 'sm' ? 'w-3 h-4' : size === 'md' ? 'w-4 h-5' : 'w-5 h-6',
          )}
        />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-full">
      <span
        className={cn(
          'font-black leading-none',
          size === 'sm' ? 'text-[11px]' : size === 'md' ? 'text-sm' : 'text-base',
          honorColors[num],
        )}
      >
        {char}
      </span>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────
export function MahjongTile({
  tile,
  size = 'md',
  isHighlighted = false,
  isTsumo = false,
  isRiichi = false,
  className,
}: MahjongTileProps) {
  const parsed = parseTile(tile);
  const s = sizeConfig[size];

  function renderFace() {
    switch (parsed.suit) {
      case 'm':
        return <ManFace num={parsed.num} size={size} isRed={parsed.isRed} />;
      case 'p':
        return <PinFace num={parsed.num} size={size} isRed={parsed.isRed} />;
      case 's':
        return <SouFace num={parsed.num} size={size} isRed={parsed.isRed} />;
      case 'z':
        return <HonorFace num={parsed.num} size={size} />;
      default:
        return <span className="text-gray-400">?</span>;
    }
  }

  return (
    <div
      className={cn(
        // Base tile shape -- physical mahjong tile look
        'relative inline-flex items-center justify-center',
        'bg-amber-50 border rounded-sm shadow-sm select-none',
        'transition-all duration-150',
        s.outer,

        // Default border
        'border-gray-300',

        // Red dora gets a subtle red background tint
        parsed.isRed && 'bg-red-50',

        // Highlighted state -- blue ring
        isHighlighted && 'ring-2 ring-blue-400 border-blue-400',

        // Tsumo state -- primary border with slight lift
        isTsumo && 'border-2 border-primary shadow-md -translate-y-0.5',

        // Riichi rotation
        isRiichi && 'rotate-90',

        className,
      )}
      title={tile}
    >
      {/* Tile face content */}
      <div className="w-full h-full flex items-center justify-center p-[1px]">
        {renderFace()}
      </div>

      {/* Subtle 3D edge -- bottom and right edges for depth */}
      <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gray-400/30 rounded-b-sm" />
      <div className="absolute top-0 bottom-0 right-0 w-[1px] bg-gray-400/20 rounded-r-sm" />
    </div>
  );
}
