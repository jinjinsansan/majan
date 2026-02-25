'use client';

import { Button } from '@/components/ui/button';

interface PlaybackControlsProps {
  currentIndex: number;
  totalActions: number;
  isPlaying: boolean;
  playbackSpeed: number;
  onPlay: () => void;
  onPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (index: number) => void;
  onSpeedChange: (speed: number) => void;
}

export function PlaybackControls({
  currentIndex,
  totalActions,
  isPlaying,
  playbackSpeed,
  onPlay,
  onPause,
  onPrev,
  onNext,
  onSeek,
  onSpeedChange,
}: PlaybackControlsProps) {
  const speeds = [1, 2, 4, 8];

  return (
    <div className="border-t bg-card p-4">
      <div className="container mx-auto flex items-center gap-4">
        {/* 再生/停止 */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={onPrev}
            disabled={currentIndex === 0}
          >
            ◀
          </Button>
          
          {isPlaying ? (
            <Button
              variant="default"
              size="icon"
              onClick={onPause}
            >
              ⏸
            </Button>
          ) : (
            <Button
              variant="default"
              size="icon"
              onClick={onPlay}
              disabled={currentIndex >= totalActions - 1}
            >
              ▶
            </Button>
          )}
          
          <Button
            variant="outline"
            size="icon"
            onClick={onNext}
            disabled={currentIndex >= totalActions - 1}
          >
            ▶
          </Button>
        </div>

        {/* 速度 */}
        <div className="flex items-center gap-1">
          {speeds.map((speed) => (
            <Button
              key={speed}
              variant={playbackSpeed === speed ? 'default' : 'ghost'}
              size="sm"
              onClick={() => onSpeedChange(speed)}
              className="w-10"
            >
              {speed}x
            </Button>
          ))}
        </div>

        {/* シークバー */}
        <div className="flex-1 flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={Math.max(0, totalActions - 1)}
            value={currentIndex}
            onChange={(e) => onSeek(parseInt(e.target.value))}
            className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer"
          />
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {currentIndex + 1} / {totalActions}
          </span>
        </div>

        {/* 局ジャンプ（簡易版） */}
        <div className="flex items-center gap-1">
          <span className="text-sm text-muted-foreground">局:</span>
          {['東1', '東2', '東3', '東4'].map((round, i) => (
            <Button
              key={round}
              variant="ghost"
              size="sm"
              className="text-xs px-2"
              onClick={() => {
                // TODO: 局の開始位置へジャンプ
              }}
            >
              {round}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
