'use client';

import { useState, useEffect, useCallback } from 'react';
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
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ゲームデータを読み込む
  const loadGame = useCallback(async () => {
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
      console.log('Game loaded:', gameData);

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
        console.log('Twins loaded:', orderedTwins.length);
      }

      // アクションログを取得
      const { data: actionsData, error: actionsError } = await supabase
        .from('actions')
        .select('*')
        .eq('game_id', id)
        .order('seq_no', { ascending: true });
      
      if (actionsError) {
        console.error('Actions error:', actionsError);
      }
      
      console.log('Actions loaded:', actionsData?.length || 0);
      setActions(actionsData || []);

      // 思考ログを取得
      if (actionsData && actionsData.length > 0) {
        const { data: reasoningsData } = await supabase
          .from('reasoning_logs')
          .select('*')
          .in('action_id', actionsData.map(a => a.id));
        
        setReasonings(reasoningsData || []);
        console.log('Reasonings loaded:', reasoningsData?.length || 0);

        // 最新位置へ
        setCurrentActionIndex(actionsData.length - 1);
      }

      return gameData;
    } catch (err: any) {
      console.error('Load game error:', err);
      setError(err.message || 'ゲームの読み込みに失敗しました');
      return null;
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadGame();
  }, [loadGame]);

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
      console.log('Starting game:', id);
      
      const response = await fetch(`/api/games/${id}/start`, {
        method: 'POST',
      });
      
      // レスポンスのContent-Typeをチェック
      const contentType = response.headers.get('content-type');
      let result;
      
      if (contentType?.includes('application/json')) {
        result = await response.json();
      } else {
        const text = await response.text();
        console.error('Non-JSON response:', text);
        throw new Error(`サーバーエラー: ${text.slice(0, 100)}`);
      }
      
      console.log('Start result:', result);
      
      if (!response.ok) {
        throw new Error(result.error || '対局の開始に失敗しました');
      }
      
      // 少し待ってからデータを再読み込み
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // データを再読み込み
      await loadGame();
      
    } catch (err: any) {
      console.error('Start game error:', err);
      setError(err.message);
    } finally {
      setStarting(false);
    }
  };

  // 手動リロード
  const reloadData = async () => {
    setLoading(true);
    await loadGame();
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
          <div className="flex items-center gap-4">
            <Button variant="outline" size="sm" onClick={reloadData}>
              🔄 更新
            </Button>
            {game.status === 'running' && (
              <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                LIVE
              </span>
            )}
          </div>
        </div>
      </header>

      {/* デバッグ情報 */}
      <div className="bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
        Status: {game.status} | Actions: {actions.length} | Twins: {twins.length} | Index: {currentActionIndex}
      </div>

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

                  <Button 
                    onClick={startGame} 
                    size="lg" 
                    className="w-full"
                    disabled={starting}
                  >
                    {starting ? '開始中...' : '🀄 対局開始'}
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
      {game.status !== 'queued' && actions.length > 0 && (
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
