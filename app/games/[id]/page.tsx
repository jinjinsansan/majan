'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';
import { MahjongTable } from '@/components/mahjong/MahjongTable';
import { PlaybackControls } from '@/components/mahjong/PlaybackControls';
import { PlayerAvatar } from '@/components/mahjong/PlayerAvatar';
import type { Game, Twin, Action, ReasoningLog } from '@/lib/types';

type ViewMode = 'latest' | 'replay';

export default function GamePage() {
  const params = useParams();
  const id = params.id as string;
  const [game, setGame] = useState<Game | null>(null);
  const [twins, setTwins] = useState<Twin[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [reasonings, setReasonings] = useState<ReasoningLog[]>([]);
  const [currentActionIndex, setCurrentActionIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(0.25);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode | null>(null);
  const [highlightTiles, setHighlightTiles] = useState<string[]>([]);
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null);

  const seatNames = ['東', '南', '西', '北'];
  const seatColors = ['text-red-400', 'text-blue-400', 'text-green-400', 'text-yellow-400'];

  // ゲームデータを読み込む
  const loadGame = useCallback(async () => {
    try {
      const supabase = createClient();

      const { data: gameData, error: gameError } = await supabase
        .from('games')
        .select('*')
        .eq('id', id)
        .single();

      if (gameError) throw gameError;
      setGame(gameData);

      if (gameData.player_twin_ids) {
        const { data: twinsData } = await supabase
          .from('twins')
          .select('*')
          .in('id', gameData.player_twin_ids);

        const orderedTwins = gameData.player_twin_ids.map((twinId: string) =>
          twinsData?.find(t => t.id === twinId)
        ).filter(Boolean);
        setTwins(orderedTwins);
      }

      const { data: actionsData } = await supabase
        .from('actions')
        .select('*')
        .eq('game_id', id)
        .order('seq_no', { ascending: true });

      setActions(actionsData || []);

      if (actionsData && actionsData.length > 0) {
        const actionIds = actionsData.map(a => a.id);
        const CHUNK = 80;
        const allReasonings: ReasoningLog[] = [];

        for (let i = 0; i < actionIds.length; i += CHUNK) {
          const chunk = actionIds.slice(i, i + CHUNK);
          const { data: reasoningsData } = await supabase
            .from('reasoning_logs')
            .select('*')
            .in('action_id', chunk);
          if (reasoningsData) allReasonings.push(...reasoningsData);
        }

        setReasonings(allReasonings);
      }

      return gameData;
    } catch (err: any) {
      setError(err.message || 'ゲームの読み込みに失敗しました');
      return null;
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadGame();
  }, [loadGame]);

  // After loading, auto-enter replay/latest mode
  useEffect(() => {
    if (!loading && game) {
      const hasActions = actions.length > 0;

      if (viewMode === null) {
        if (game.status === 'finished' || game.status === 'running') {
          if (hasActions) {
            // 配牌をスキップして最初の打牌から表示（全員の手牌が見える位置）
            const firstMeaningfulIndex = actions.findIndex(
              a => a.action_type !== 'deal' && a.action_type !== 'draw'
            );
            const startIndex = firstMeaningfulIndex >= 0 ? firstMeaningfulIndex : 0;
            setViewMode('replay');
            setCurrentActionIndex(startIndex);
            setIsPlaying(true);
          } else {
            setViewMode('latest');
          }
        }
      }

      // actionsがあとから読み込まれた場合のフォールバック
      if (viewMode === 'latest' && game.status === 'finished' && hasActions) {
        const firstMeaningfulIndex = actions.findIndex(
          a => a.action_type !== 'deal' && a.action_type !== 'draw'
        );
        const startIndex = firstMeaningfulIndex >= 0 ? firstMeaningfulIndex : 0;
        setViewMode('replay');
        setCurrentActionIndex(startIndex);
        setIsPlaying(true);
      }
    }
  }, [loading, game, viewMode, actions.length]);

  // Supabase Realtime
  useEffect(() => {
    if (game?.status === 'running' && viewMode === 'latest') {
      const supabase = createClient();

      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }

      const channel = supabase
        .channel(`game-${id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'actions',
            filter: `game_id=eq.${id}`,
          },
          async (payload) => {
            const newAction = payload.new as Action;
            setActions(prev => {
              if (prev.some(a => a.id === newAction.id)) return prev;
              const updated = [...prev, newAction].sort((a, b) => a.seq_no - b.seq_no);
              setCurrentActionIndex(updated.length - 1);
              return updated;
            });

            const { data: reasoningData } = await supabase
              .from('reasoning_logs')
              .select('*')
              .eq('action_id', newAction.id);

            if (reasoningData && reasoningData.length > 0) {
              setReasonings(prev => {
                const existingIds = new Set(prev.map(r => r.id));
                const newOnes = reasoningData.filter(r => !existingIds.has(r.id));
                return newOnes.length > 0 ? [...prev, ...newOnes] : prev;
              });
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'games',
            filter: `id=eq.${id}`,
          },
          async (payload) => {
            const updated = payload.new as Game;
            setGame(prev => prev ? { ...prev, ...updated } : null);

            if (updated.status === 'finished' || updated.status === 'failed') {
              await loadGame();
            }
          }
        )
        .subscribe();

      channelRef.current = channel;

      return () => {
        supabase.removeChannel(channel);
        channelRef.current = null;
      };
    }
  }, [game?.status, viewMode, id, loadGame]);

  // 自動再生
  useEffect(() => {
    if (!isPlaying || currentActionIndex >= actions.length - 1) {
      setIsPlaying(false);
      return;
    }

    const currentAction = actions[currentActionIndex];
    const actionType = currentAction?.action_type;
    const isQuickAction = actionType === 'deal' || actionType === 'draw';
    const delay = isQuickAction ? 100 : (1000 / playbackSpeed);

    const timer = setTimeout(() => {
      setCurrentActionIndex(prev => Math.min(prev + 1, actions.length - 1));
    }, delay);

    return () => clearTimeout(timer);
  }, [isPlaying, currentActionIndex, actions.length, playbackSpeed]);

  // 対局開始
  const startGame = async () => {
    setStarting(true);
    setError(null);

    try {
      const response = await fetch(`/api/games/${id}/start`, { method: 'POST' });
      const contentType = response.headers.get('content-type');
      let result;

      if (contentType?.includes('application/json')) {
        result = await response.json();
      } else {
        const text = await response.text();
        throw new Error(`サーバーエラー: ${text.slice(0, 100)}`);
      }

      if (!response.ok) {
        throw new Error(result.error || '対局の開始に失敗しました');
      }

      await new Promise(resolve => setTimeout(resolve, 500));
      const gameData = await loadGame();

      if (gameData && gameData.status !== 'queued') {
        setViewMode('latest');
        setCurrentActionIndex(Math.max(0, (actions.length || 1) - 1));
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  };

  const watchLive = () => {
    setViewMode('latest');
    setCurrentActionIndex(Math.max(0, actions.length - 1));
    setIsPlaying(false);
  };

  const replayFromStart = () => {
    setViewMode('replay');
    setCurrentActionIndex(0);
    setIsPlaying(false);
  };

  const currentReasoning = actions[currentActionIndex]
    ? reasonings.find(r => r.action_id === actions[currentActionIndex].id) || null
    : null;

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-felt">
        <div className="text-center">
          <div className="text-4xl mb-4 animate-pulse">🀄</div>
          <p className="text-muted-foreground">読み込み中...</p>
        </div>
      </main>
    );
  }

  if (error && !game) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-felt">
        <Card className="max-w-md bg-card/80 backdrop-blur-sm">
          <CardContent className="pt-6 text-center">
            <p className="text-destructive mb-4">{error}</p>
            <Link href="/dashboard">
              <Button>ダッシュボードへ</Button>
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!game) return null;

  // queued 状態 → 対局準備画面
  if (game.status === 'queued') {
    return (
      <main className="min-h-screen flex flex-col bg-felt tile-pattern">
        <header className="border-b border-border/30 p-2 sm:p-4">
          <div className="container mx-auto">
            <Link href="/dashboard" className="text-xs sm:text-sm text-muted-foreground hover:text-foreground">
              ← ダッシュボード
            </Link>
            <h1 className="text-lg sm:text-xl font-bold mt-1">
              <span className="text-gold">対局</span>準備中
            </h1>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center p-4">
          <Card className="max-w-md w-full text-center p-4 sm:p-8 bg-card/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-xl">対局準備完了</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* プレイヤーカード（アバター付き） */}
              <div className="grid grid-cols-2 gap-3">
                {twins.map((twin, i) => (
                  <div key={twin.id} className="flex items-center gap-2 p-2.5 bg-muted/30 rounded-lg border border-border/30">
                    <PlayerAvatar
                      avatarUrl={twin.avatar_url}
                      name={twin.name}
                      seatWind={seatNames[i]}
                      seatColor={seatColors[i]}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <p className={`text-xs font-medium ${seatColors[i]}`}>{seatNames[i]}</p>
                      <p className="text-sm truncate">{twin.name}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-lg text-xs text-yellow-400/80">
                公開手牌ルール: 全プレイヤーの手牌が表示されます
              </div>
              {error && (
                <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                  {error}
                </div>
              )}
              <Button onClick={startGame} size="lg" className="w-full" disabled={starting}>
                {starting ? '開始中...' : '対局開始'}
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  if (viewMode === null) {
    return null;
  }

  // 観戦画面
  return (
    <main className="min-h-screen flex flex-col bg-felt">
      {/* ヘッダー */}
      <header className="border-b border-border/30 px-2 sm:px-4 py-1.5 sm:py-2">
        <div className="container mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2 sm:gap-3">
            <Link href="/dashboard" className="text-xs sm:text-sm text-muted-foreground hover:text-foreground">
              ← 戻る
            </Link>
            {game.status === 'running' && (
              <span className="inline-flex items-center gap-1.5 text-xs">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span className="text-green-400 font-medium">LIVE</span>
              </span>
            )}
            {game.status === 'finished' && (
              <span className="text-[10px] sm:text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded">終了</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {game.status === 'running' && viewMode === 'replay' && (
              <Button variant="ghost" size="sm" className="text-xs text-green-400" onClick={watchLive}>
                LIVE観戦
              </Button>
            )}
            {viewMode === 'latest' && (
              <Button variant="ghost" size="sm" className="text-xs" onClick={replayFromStart}>
                最初から
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* MahjongTable */}
      <div className="flex-1 overflow-auto p-1.5 sm:p-4">
        <div className="container mx-auto max-w-5xl">
          <MahjongTable
            twins={twins}
            actions={actions.slice(0, currentActionIndex + 1)}
            currentAction={actions[currentActionIndex]}
            currentReasoning={currentReasoning}
            highlightTiles={highlightTiles}
          />
        </div>
      </div>

      {/* プレイバック */}
      {actions.length > 0 && (
        <PlaybackControls
          currentIndex={currentActionIndex}
          totalActions={actions.length}
          isPlaying={isPlaying}
          playbackSpeed={playbackSpeed}
          actions={actions}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onPrev={() => setCurrentActionIndex(prev => Math.max(0, prev - 1))}
          onNext={() => setCurrentActionIndex(prev => Math.min(actions.length - 1, prev + 1))}
          onSeek={(index) => setCurrentActionIndex(index)}
          onSpeedChange={setPlaybackSpeed}
        />
      )}
    </main>
  );
}
