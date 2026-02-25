'use client';

import { useEffect, useState } from 'react';
import { tileToDisplay } from './tile-utils';
import type { Action, Twin } from '@/lib/types';

interface GameOverlayProps {
  currentAction?: Action;
  twins: Twin[];
  seatNames: string[];
}

export function GameOverlay({ currentAction, twins, seatNames }: GameOverlayProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!currentAction) {
      setVisible(false);
      return;
    }

    const isOverlayAction =
      currentAction.action_type === 'tsumo' ||
      currentAction.action_type === 'ron' ||
      currentAction.action_type === 'ryukyoku' ||
      currentAction.action_type === 'pon' ||
      currentAction.action_type === 'chi' ||
      currentAction.action_type === 'riichi';

    if (isOverlayAction) {
      setVisible(true);
    } else {
      setVisible(false);
    }
  }, [currentAction]);

  if (!visible || !currentAction) return null;

  const payload = currentAction.payload_json || {};
  const seat = currentAction.actor_seat;
  const twinName = twins[seat]?.name || seatNames[seat];

  // ポン/チー/リーチは短めの表示
  if (currentAction.action_type === 'pon' || currentAction.action_type === 'chi' || currentAction.action_type === 'riichi') {
    const labels: Record<string, { text: string; color: string }> = {
      pon: { text: 'ポン！', color: 'text-orange-400' },
      chi: { text: 'チー！', color: 'text-cyan-400' },
      riichi: { text: 'リーチ！', color: 'text-red-400' },
    };
    const label = labels[currentAction.action_type];

    return (
      <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
        <div className="bg-card/95 px-6 py-3 rounded-lg border-2 border-primary shadow-lg animate-overlay-in">
          <p className={`text-lg font-bold ${label.color}`}>{label.text}</p>
          <p className="text-sm text-muted-foreground text-center">{twinName}</p>
        </div>
      </div>
    );
  }

  // ツモ/ロン/流局は大きめの表示
  return (
    <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
      <div className="bg-card/95 p-6 rounded-xl border-2 border-primary shadow-2xl animate-overlay-in min-w-[240px]">
        {currentAction.action_type === 'tsumo' && (
          <div className="text-center">
            <p className="text-2xl font-bold text-primary mb-1">ツモ！</p>
            <p className="text-sm text-muted-foreground mb-2">{twinName}</p>
            {payload.yaku && (
              <div className="space-y-1 mb-2">
                {(payload.yaku as [string, number][]).map(([name, han], i) => (
                  <p key={i} className="text-sm">
                    {name} <span className="text-primary">{han}翻</span>
                  </p>
                ))}
              </div>
            )}
            {payload.han && (
              <p className="text-lg font-semibold">
                {payload.han}翻{payload.fu}符
              </p>
            )}
            {payload.score_level && (
              <p className="text-sm text-primary font-semibold mt-1">{payload.score_level}</p>
            )}
          </div>
        )}

        {currentAction.action_type === 'ron' && (
          <div className="text-center">
            <p className="text-2xl font-bold text-red-400 mb-1">ロン！</p>
            <p className="text-sm text-muted-foreground mb-2">{twinName}</p>
            {payload.tile && (
              <p className="text-xs text-muted-foreground mb-2">
                ロン牌: {tileToDisplay(payload.tile).text}
                {payload.from_seat !== undefined && ` (${twins[payload.from_seat]?.name || seatNames[payload.from_seat]}から)`}
              </p>
            )}
            {payload.yaku && (
              <div className="space-y-1 mb-2">
                {(payload.yaku as [string, number][]).map(([name, han], i) => (
                  <p key={i} className="text-sm">
                    {name} <span className="text-red-400">{han}翻</span>
                  </p>
                ))}
              </div>
            )}
            {payload.han && (
              <p className="text-lg font-semibold">
                {payload.han}翻{payload.fu}符
              </p>
            )}
            {payload.score_level && (
              <p className="text-sm text-red-400 font-semibold mt-1">{payload.score_level}</p>
            )}
          </div>
        )}

        {currentAction.action_type === 'ryukyoku' && (
          <div className="text-center">
            <p className="text-2xl font-bold text-yellow-400 mb-1">流局</p>
            {payload.tenpai_seats && (
              <p className="text-sm mt-2">
                テンパイ: {(payload.tenpai_seats as number[]).length > 0
                  ? (payload.tenpai_seats as number[]).map(s => twins[s]?.name || seatNames[s]).join('・')
                  : '全員ノーテン'}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
