'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';
import { MahjongTable } from '@/components/mahjong/MahjongTable';
import { ReasoningPanel } from '@/components/reasoning/ReasoningPanel';
import { PlaybackControls } from '@/components/mahjong/PlaybackControls';
import type { Game, Twin, Action, ReasoningLog } from '@/lib/types';

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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadGame();
    // Realtime subscription for live updates
    const supabase = createClient();
    const channel = supabase
      .channel(`game:${id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'actions',
        filter: `game_id=eq.${id}`,
      }, (payload) => {
        setActions(prev => [...prev, payload.new as Action]);
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'reasoning_logs',
      }, (payload) => {
        setReasonings(prev => [...prev, payload.new as ReasoningLog]);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);

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

  const loadGame = async () => {
    try {
      const supabase = createClient();
      
      // ゲーム情報を取得
      const { data: gameData, error: gameError } = await supabase
        .from('games')
        .select('*')
        .eq('id', id)
        .single();

      if (gameError) throw gameError;
      setGame(gameData);

      // Twinsを取得
      if (gameData.player_twin_ids) {
        const { data: twinsData } = await supabase
          .from('twins')
          .select('*')
          .in('id', gameData.player_twin_ids);
        
        // 席順に並べ替え
        const orderedTwins = gameData.player_twin_ids.map((twinId: string) =>
          twinsData?.find(t => t.id === twinId)
        ).filter(Boolean);
        setTwins(orderedTwins);
      }

      // アクションログを取得
      const { data: actionsData } = await supabase
        .from('actions')
        .select('*')
        .eq('game_id', id)
        .order('seq_no', { ascending: true });
      
      setActions(actionsData || []);

      // 思考ログを取得
      const { data: reasoningsData } = await supabase
        .from('reasoning_logs')
        .select('*')
        .in('action_id', (actionsData || []).map(a => a.id));
      
      setReasonings(reasoningsData || []);

      // 最新位置へ
      if (actionsData && actionsData.length > 0) {
        setCurrentActionIndex(actionsData.length - 1);
      }
    } catch (err: any) {
      setError(err.message || 'ゲームの読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  // 対局開始（AI対局を実行）
  const startGame = async () => {
    try {
      const response = await fetch(`/api/games/${id}/start`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error('対局の開始に失敗しました');
      
      // ゲーム状態を更新
      const supabase = createClient();
      await supabase
        .from('games')
        .update({ status: 'running', started_at: new Date().toISOString() })
        .eq('id', id);
      
      setGame(prev => prev ? { ...prev, status: 'running' } : null);
    } catch (err: any) {
      setError(err.message);
    }
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

  if (error || !game) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <p className="text-destructive mb-4">{error || 'ゲームが見つかりません'}</p>
            <Link href="/dashboard">
              <Button>ダッシュボードへ</Button>
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col">
      {/* ヘッダー */}
      <header className="border-b p-4">
        <div className="container mx-auto flex justify-between items-center">
          <div>
            <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
              ← ダッシュボード
            </Link>
            <h1 className="text-xl font-semibold mt-1">
              {game.status === 'queued' ? '対局準備中' : 
               game.status === 'running' ? '対局中' : 
               game.status === 'finished' ? '対局終了' : game.status}
            </h1>
          </div>
          <div className="text-sm text-muted-foreground">
            {game.status === 'running' && (
              <span className="inline-flex items-center gap-2">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                LIVE
              </span>
            )}
          </div>
        </div>
      </header>

      {/* メインコンテンツ */}
      <div className="flex-1 flex">
        {/* 卓ビュー */}
        <div className="flex-1 p-4">
          {game.status === 'queued' ? (
            <div className="h-full flex items-center justify-center">
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
                    ⚠️ 公開手牌ルール
                  </div>

                  <Button onClick={startGame} size="lg" className="w-full">
                    🀄 対局開始
                  </Button>
                </CardContent>
              </Card>
            </div>
          ) : (
            <MahjongTable 
              twins={twins}
              actions={actions.slice(0, currentActionIndex + 1)}
              currentAction={actions[currentActionIndex]}
            />
          )}
        </div>

        {/* 思考ログパネル */}
        <div className="w-80 border-l overflow-auto">
          <ReasoningPanel 
            twins={twins}
            reasonings={currentReasonings}
            actions={actions.slice(0, currentActionIndex + 1)}
          />
        </div>
      </div>

      {/* 再生コントロール */}
      {game.status !== 'queued' && (
        <PlaybackControls
          currentIndex={currentActionIndex}
          totalActions={actions.length}
          isPlaying={isPlaying}
          playbackSpeed={playbackSpeed}
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
