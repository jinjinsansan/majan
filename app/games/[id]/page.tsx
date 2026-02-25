'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';
import { MahjongTable } from '@/components/mahjong/MahjongTable';
import { ReasoningPanel } from '@/components/reasoning/ReasoningPanel';
import { PlaybackControls } from '@/components/mahjong/PlaybackControls';
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
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode | null>(null);
  const [highlightTiles, setHighlightTiles] = useState<string[]>([]);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

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
        const { data: reasoningsData } = await supabase
          .from('reasoning_logs')
          .select('*')
          .in('action_id', actionsData.map(a => a.id));

        setReasonings(reasoningsData || []);
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

  // ポーリング（running中 & 続きから観戦モード）
  useEffect(() => {
    if (game?.status === 'running' && viewMode === 'latest') {
      pollRef.current = setInterval(async () => {
        const supabase = createClient();

        const { data: gameData } = await supabase
          .from('games')
          .select('status')
          .eq('id', id)
          .single();

        if (gameData) {
          setGame(prev => prev ? { ...prev, status: gameData.status } : null);
        }

        const lastSeq = actions.length > 0 ? actions[actions.length - 1].seq_no : 0;
        const { data: newActions } = await supabase
          .from('actions')
          .select('*')
          .eq('game_id', id)
          .gt('seq_no', lastSeq)
          .order('seq_no', { ascending: true });

        if (newActions && newActions.length > 0) {
          const allActions = [...actions, ...newActions];
          setActions(allActions);
          setCurrentActionIndex(allActions.length - 1);

          const { data: newReasonings } = await supabase
            .from('reasoning_logs')
            .select('*')
            .in('action_id', newActions.map(a => a.id));

          if (newReasonings) {
            setReasonings(prev => [...prev, ...newReasonings]);
          }
        }

        if (gameData?.status === 'finished' || gameData?.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current);
          await loadGame();
        }
      }, 3000);

      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }
  }, [game?.status, viewMode, id, actions, loadGame]);

  // 自動再生
  useEffect(() => {
    if (!isPlaying || currentActionIndex >= actions.length - 1) {
      setIsPlaying(false);
      return;
    }

    const timer = setTimeout(() => {
      setCurrentActionIndex(prev => Math.min(prev + 1, actions.length - 1));
    }, 1000 / playbackSpeed);

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

  // 「続きから観戦」
  const watchLive = () => {
    setViewMode('latest');
    setCurrentActionIndex(Math.max(0, actions.length - 1));
    setIsPlaying(false);
  };

  // 「最初から再生」
  const replayFromStart = () => {
    setViewMode('replay');
    setCurrentActionIndex(0);
    setIsPlaying(true);
  };

  // 候補ハイライト
  const handleHighlight = (tiles: string[]) => {
    setHighlightTiles(tiles);
    setTimeout(() => setHighlightTiles([]), 3000);
  };

  // 現在のアクションまでの思考ログを取得
  const currentReasonings = reasonings.filter(r => {
    const actionIndex = actions.findIndex(a => a.id === r.action_id);
    return actionIndex <= currentActionIndex;
  });

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">🀄</div>
          <p className="text-muted-foreground">読み込み中...</p>
        </div>
      </main>
    );
  }

  if (error && !game) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Card className="max-w-md">
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
      <main className="min-h-screen flex flex-col">
        <header className="border-b p-4">
          <div className="container mx-auto">
            <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
              ← ダッシュボード
            </Link>
            <h1 className="text-xl font-semibold mt-1">対局準備中</h1>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <Card className="max-w-md text-center p-8">
            <CardHeader>
              <CardTitle>対局準備完了</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                {twins.map((twin, i) => (
                  <div key={twin.id} className="p-2 bg-muted rounded">
                    <span className="text-muted-foreground">
                      {['東', '南', '西', '北'][i]}:
                    </span>{' '}
                    {twin.name}
                  </div>
                ))}
              </div>
              <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded text-sm text-yellow-400">
                ⚠️ この対局は公開手牌ルールです。全プレイヤーの手牌が常に表示されます。
              </div>
              {error && (
                <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                  {error}
                </div>
              )}
              <Button onClick={startGame} size="lg" className="w-full" disabled={starting}>
                {starting ? '開始中...' : '🀄 対局開始'}
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  // finished/running でまだ viewMode を選択していない場合
  if (viewMode === null && actions.length > 0) {
    return (
      <main className="min-h-screen flex flex-col">
        <header className="border-b p-4">
          <div className="container mx-auto">
            <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
              ← ダッシュボード
            </Link>
            <h1 className="text-xl font-semibold mt-1">
              {game.status === 'running' ? '対局中' : '対局終了'}
            </h1>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <Card className="max-w-md text-center p-8">
            <CardHeader>
              <CardTitle>
                {game.status === 'running' ? '対局が進行中です' : '対局が終了しました'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                {twins.map((twin, i) => (
                  <div key={twin.id} className="p-2 bg-muted rounded">
                    <span className="text-muted-foreground">
                      {['東', '南', '西', '北'][i]}:
                    </span>{' '}
                    {twin.name}
                  </div>
                ))}
              </div>

              {/* 最終スコア表示（finished時） */}
              {game.status === 'finished' && game.rule_set?.final_scores && (
                <div className="p-3 bg-muted rounded">
                  <p className="text-xs text-muted-foreground mb-2">最終スコア</p>
                  <div className="grid grid-cols-2 gap-1 text-sm">
                    {(game.rule_set.final_scores as number[]).map((score, i) => (
                      <div key={i} className="flex justify-between">
                        <span>{twins[i]?.name || ['東','南','西','北'][i]}</span>
                        <span className={score >= 25000 ? 'text-green-400' : 'text-red-400'}>
                          {score.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-sm text-muted-foreground">
                {actions.length}アクション記録済み
              </p>

              <div className="flex flex-col gap-2">
                <Button onClick={watchLive} size="lg" className="w-full">
                  {game.status === 'running' ? '続きから観戦' : '最新状態を見る'}
                </Button>
                <Button onClick={replayFromStart} variant="outline" size="lg" className="w-full">
                  最初から再生
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  // viewMode が null で actions が 0 の場合 → そのまま観戦開始
  if (viewMode === null) {
    setViewMode('latest');
  }

  // 観戦画面
  return (
    <main className="min-h-screen flex flex-col">
      {/* ヘッダー */}
      <header className="border-b p-3">
        <div className="container mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
              ← ダッシュボード
            </Link>
            <div className="flex items-center gap-2">
              {twins.map((twin, i) => (
                <span key={twin.id} className="text-xs">
                  <span className={['text-red-400','text-blue-400','text-green-400','text-yellow-400'][i]}>
                    {['東','南','西','北'][i]}
                  </span>
                  :{twin.name}
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {game.status === 'running' && (
              <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                LIVE
              </span>
            )}
            {game.status === 'finished' && (
              <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">終了</span>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => setViewMode(null)}
            >
              モード切替
            </Button>
          </div>
        </div>
      </header>

      {/* メインコンテンツ */}
      <div className="flex-1 flex overflow-hidden">
        {/* 卓ビュー */}
        <div className="flex-1 p-4 overflow-auto">
          <MahjongTable
            twins={twins}
            actions={actions.slice(0, currentActionIndex + 1)}
            currentAction={actions[currentActionIndex]}
            highlightTiles={highlightTiles}
          />
        </div>

        {/* 思考ログパネル */}
        <div className="w-80 border-l overflow-auto">
          <ReasoningPanel
            twins={twins}
            reasonings={currentReasonings}
            actions={actions.slice(0, currentActionIndex + 1)}
            onHighlight={handleHighlight}
          />
        </div>
      </div>

      {/* 再生コントロール */}
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
