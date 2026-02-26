'use client';

import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import type { Action } from '@/lib/types';

interface PlaybackControlsProps {
  currentIndex: number;
  totalActions: number;
  isPlaying: boolean;
  playbackSpeed: number;
  actions: Action[];
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
  actions,
  onPlay,
  onPause,
  onPrev,
  onNext,
  onSeek,
  onSpeedChange,
}: PlaybackControlsProps) {
  const speeds = [0.5, 1, 2, 4];

  // 局ごとのアクション開始位置を計算
  const handStartIndices = useMemo(() => {
    const indices: { label: string; index: number; handId: string }[] = [];
    const seenHandIds = new Set<string>();

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      if (action.action_type === 'deal' && action.actor_seat === 0 && !seenHandIds.has(action.hand_id)) {
        seenHandIds.add(action.hand_id);
        const handNum = indices.length + 1;
        indices.push({
          label: `東${handNum}`,
          index: i,
          handId: action.hand_id,
        });
      }
    }

    return indices;
  }, [actions]);

  // 重要局面のインデックスを計算
  const keyMoments = useMemo(() => {
    const moments: { label: string; index: number; type: string }[] = [];

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      if (action.action_type === 'riichi') {
        moments.push({ label: 'リーチ', index: i, type: 'riichi' });
      } else if (action.action_type === 'tsumo') {
        moments.push({ label: 'ツモ', index: i, type: 'tsumo' });
      } else if (action.action_type === 'ron') {
        moments.push({ label: 'ロン', index: i, type: 'ron' });
      } else if (action.action_type === 'ryukyoku') {
        moments.push({ label: '流局', index: i, type: 'ryukyoku' });
      } else if (action.action_type === 'pon') {
        moments.push({ label: 'ポン', index: i, type: 'pon' });
      } else if (action.action_type === 'chi') {
        moments.push({ label: 'チー', index: i, type: 'chi' });
      }
    }

    return moments;
  }, [actions]);

  // 現在の局を特定
  const currentHand = useMemo(() => {
    for (let i = handStartIndices.length - 1; i >= 0; i--) {
      if (currentIndex >= handStartIndices[i].index) return i;
    }
    return 0;
  }, [currentIndex, handStartIndices]);

  // 次の重要局面へジャンプ
  const jumpToNextKeyMoment = () => {
    const next = keyMoments.find(m => m.index > currentIndex);
    if (next) onSeek(next.index);
  };

  // 前の重要局面へジャンプ
  const jumpToPrevKeyMoment = () => {
    const prev = [...keyMoments].reverse().find(m => m.index < currentIndex);
    if (prev) onSeek(prev.index);
  };

  return (
    <div className="border-t bg-card p-3">
      <div className="container mx-auto flex flex-wrap items-center gap-3">
        {/* 再生コントロール */}
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={onPrev}
            disabled={currentIndex === 0}
            title="1手戻る"
          >
            ◀
          </Button>

          {isPlaying ? (
            <Button
              variant="default"
              size="icon"
              className="h-8 w-8"
              onClick={onPause}
              title="停止"
            >
              ⏸
            </Button>
          ) : (
            <Button
              variant="default"
              size="icon"
              className="h-8 w-8"
              onClick={onPlay}
              disabled={currentIndex >= totalActions - 1}
              title="再生"
            >
              ▶
            </Button>
          )}

          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={onNext}
            disabled={currentIndex >= totalActions - 1}
            title="1手進む"
          >
            ▶|
          </Button>
        </div>

        {/* 速度 */}
        <div className="flex items-center gap-0.5">
          {speeds.map((speed) => (
            <Button
              key={speed}
              variant={playbackSpeed === speed ? 'default' : 'ghost'}
              size="sm"
              onClick={() => onSpeedChange(speed)}
              className="h-7 min-w-[2.5rem] px-1 text-xs"
            >
              {speed}x
            </Button>
          ))}
        </div>

        {/* シークバー */}
        <div className="flex-1 flex items-center gap-2 min-w-[150px]">
          <input
            type="range"
            min={0}
            max={Math.max(0, totalActions - 1)}
            value={currentIndex}
            onChange={(e) => onSeek(parseInt(e.target.value))}
            className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer"
          />
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {currentIndex + 1}/{totalActions}
          </span>
        </div>

        {/* 局ジャンプ */}
        <div className="flex items-center gap-0.5">
          <span className="text-xs text-muted-foreground mr-1">局:</span>
          {handStartIndices.map((hand, i) => (
            <Button
              key={hand.handId}
              variant={currentHand === i ? 'default' : 'ghost'}
              size="sm"
              className="text-xs h-7 px-2"
              onClick={() => onSeek(hand.index)}
            >
              {hand.label}
            </Button>
          ))}
        </div>

        {/* 重要局面ジャンプ */}
        {keyMoments.length > 0 && (
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7 px-2"
              onClick={jumpToPrevKeyMoment}
              disabled={!keyMoments.some(m => m.index < currentIndex)}
              title="前の重要局面"
            >
              ◀重要
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7 px-2"
              onClick={jumpToNextKeyMoment}
              disabled={!keyMoments.some(m => m.index > currentIndex)}
              title="次の重要局面"
            >
              重要▶
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
