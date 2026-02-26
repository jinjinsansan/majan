'use client';

import Image from 'next/image';

interface PlayerAvatarProps {
  avatarUrl?: string;
  name: string;
  seatWind: string;
  seatColor: string;
  size?: 'sm' | 'md' | 'lg';
  isActive?: boolean;
}

// デフォルトアバター（風ごとに異なるカラー）
const defaultAvatarColors: Record<string, string> = {
  '東': 'from-red-500 to-red-700',
  '南': 'from-blue-500 to-blue-700',
  '西': 'from-green-500 to-green-700',
  '北': 'from-yellow-500 to-yellow-700',
};

const sizeConfig = {
  sm: { container: 'w-8 h-8', text: 'text-xs', wind: 'text-[8px]' },
  md: { container: 'w-12 h-12', text: 'text-sm', wind: 'text-[10px]' },
  lg: { container: 'w-16 h-16', text: 'text-base', wind: 'text-xs' },
};

export function PlayerAvatar({
  avatarUrl,
  name,
  seatWind,
  seatColor,
  size = 'md',
  isActive = false,
}: PlayerAvatarProps) {
  const s = sizeConfig[size];
  const initial = name.charAt(0) || '?';

  return (
    <div className="relative flex-shrink-0">
      {avatarUrl ? (
        <div
          className={[
            s.container,
            'rounded-full overflow-hidden border-2 transition-all duration-300',
            isActive ? 'border-primary avatar-glow' : 'border-border',
          ].join(' ')}
        >
          <Image
            src={avatarUrl}
            alt={name}
            width={64}
            height={64}
            className="w-full h-full object-cover"
            unoptimized
          />
        </div>
      ) : (
        <div
          className={[
            s.container,
            'rounded-full flex items-center justify-center border-2 transition-all duration-300',
            `bg-gradient-to-br ${defaultAvatarColors[seatWind] || 'from-gray-500 to-gray-700'}`,
            isActive ? 'border-primary avatar-glow' : 'border-border',
          ].join(' ')}
        >
          <span className={`${s.text} font-bold text-white drop-shadow-sm`}>
            {initial}
          </span>
        </div>
      )}

      {/* 風表示バッジ */}
      <span
        className={[
          'absolute -bottom-0.5 -right-0.5 rounded-full bg-background border',
          'flex items-center justify-center',
          s.wind,
          seatColor,
          'font-bold',
          size === 'sm' ? 'w-3.5 h-3.5' : size === 'md' ? 'w-4.5 h-4.5 px-0.5' : 'w-5 h-5',
        ].join(' ')}
      >
        {seatWind}
      </span>
    </div>
  );
}
