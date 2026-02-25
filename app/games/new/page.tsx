'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';
import type { Twin } from '@/lib/types';

export default function NewGamePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [myTwins, setMyTwins] = useState<Twin[]>([]);
  const [publicTwins, setPublicTwins] = useState<Twin[]>([]);
  const [npcs, setNpcs] = useState<Twin[]>([]);
  
  // 席の選択状態（0=東, 1=南, 2=西, 3=北）
  const [seats, setSeats] = useState<(string | null)[]>([null, null, null, null]);
  const seatNames = ['東家', '南家', '西家', '北家'];

  useEffect(() => {
    loadTwins();
  }, []);

  const loadTwins = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      router.push('/login');
      return;
    }

    // 自分のTwinを取得
    const { data: mine } = await supabase
      .from('twins')
      .select('*')
      .eq('user_id', user.id);
    
    // 公開Twinを取得
    const { data: pub } = await supabase
      .from('twins')
      .select('*')
      .eq('is_public', true)
      .eq('is_npc', false)
      .neq('user_id', user.id);
    
    // NPCを取得
    const { data: npc } = await supabase
      .from('twins')
      .select('*')
      .eq('is_npc', true);

    setMyTwins(mine || []);
    setPublicTwins(pub || []);
    setNpcs(npc || []);
  };

  const selectTwin = (seatIndex: number, twinId: string) => {
    const newSeats = [...seats];
    newSeats[seatIndex] = twinId;
    setSeats(newSeats);
  };

  const clearSeat = (seatIndex: number) => {
    const newSeats = [...seats];
    newSeats[seatIndex] = null;
    setSeats(newSeats);
  };

  const getTwinById = (id: string): Twin | undefined => {
    return [...myTwins, ...publicTwins, ...npcs].find(t => t.id === id);
  };

  const canStart = seats.filter(s => s !== null).length === 4;

  const handleStart = async () => {
    if (!canStart) return;
    
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) throw new Error('ログインしてください');

      // ゲームを作成
      const { data: game, error: gameError } = await supabase
        .from('games')
        .insert({
          created_by: user.id,
          mode: 'ai_only',
          status: 'queued',
          rule_set: {
            players: 4,
            format: 'tonpu',
            aka_dora: true,
            kuitan: true,
            atozuke: true,
            double_ron: false,
            tobi: true,
            open_hand: true,
          },
          player_twin_ids: seats,
        })
        .select()
        .single();

      if (gameError) throw gameError;

      // ゲームページへリダイレクト
      router.push(`/games/${game.id}`);
    } catch (err: any) {
      setError(err.message || '対局の作成に失敗しました');
      setLoading(false);
    }
  };

  return (
    <main className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <Link href="/dashboard" className="text-muted-foreground hover:text-foreground">
          ← ダッシュボードに戻る
        </Link>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-2xl">🀄 対局を作成</CardTitle>
          <CardDescription>
            4人のTwinを選んで対局を開始します
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* 公開手牌ルール警告 */}
          <div className="p-4 mb-6 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-sm">
            <p className="text-yellow-400">
              ⚠️ この対局は<strong>公開手牌ルール</strong>です。
              全プレイヤーの手牌が常に表示される完全情報対局となります。
            </p>
          </div>

          {error && (
            <div className="p-3 mb-6 rounded-md bg-destructive/10 text-destructive text-sm">
              {error}
            </div>
          )}

          {/* 席選択 */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            {seats.map((twinId, idx) => (
              <div key={idx} className="p-4 rounded-lg border bg-card">
                <div className="flex justify-between items-center mb-3">
                  <span className="font-semibold">{seatNames[idx]}</span>
                  {twinId && (
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => clearSeat(idx)}
                    >
                      ✕
                    </Button>
                  )}
                </div>
                
                {twinId ? (
                  <div className="p-3 rounded bg-primary/10 border border-primary/30">
                    <p className="font-medium">{getTwinById(twinId)?.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {getTwinById(twinId)?.npc_type && `NPC: ${getTwinById(twinId)?.npc_type}`}
                    </p>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">未選択</p>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Twin選択パネル */}
      <div className="space-y-6">
        {/* マイTwin */}
        {myTwins.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold mb-3">🎭 マイTwin</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {myTwins.map((twin) => (
                <TwinCard 
                  key={twin.id} 
                  twin={twin} 
                  seats={seats}
                  onSelect={(seatIdx) => selectTwin(seatIdx, twin.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* NPC */}
        <div>
          <h3 className="text-lg font-semibold mb-3">🤖 NPC</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {npcs.map((twin) => (
              <TwinCard 
                key={twin.id} 
                twin={twin} 
                seats={seats}
                onSelect={(seatIdx) => selectTwin(seatIdx, twin.id)}
              />
            ))}
          </div>
        </div>

        {/* 公開Twin */}
        {publicTwins.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold mb-3">👥 公開Twin</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {publicTwins.map((twin) => (
                <TwinCard 
                  key={twin.id} 
                  twin={twin} 
                  seats={seats}
                  onSelect={(seatIdx) => selectTwin(seatIdx, twin.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 開始ボタン */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t">
        <div className="container mx-auto max-w-4xl flex gap-4">
          <Button 
            className="flex-1" 
            size="lg"
            disabled={!canStart || loading}
            onClick={handleStart}
          >
            {loading ? '作成中...' : `対局開始（${seats.filter(s => s).length}/4人選択済み）`}
          </Button>
        </div>
      </div>
      
      {/* 下部の余白 */}
      <div className="h-24" />
    </main>
  );
}

// Twin選択カード
function TwinCard({ 
  twin, 
  seats, 
  onSelect 
}: { 
  twin: Twin; 
  seats: (string | null)[]; 
  onSelect: (seatIdx: number) => void;
}) {
  const isSelected = seats.includes(twin.id);
  const emptySeats = seats.map((s, i) => s === null ? i : -1).filter(i => i >= 0);
  const seatNames = ['東', '南', '西', '北'];
  
  const npcEmoji: Record<string, string> = {
    speed: '⚡',
    power: '💪',
    defense: '🛡️',
  };

  return (
    <div 
      className={`p-3 rounded-lg border transition-colors ${
        isSelected 
          ? 'bg-primary/20 border-primary' 
          : 'bg-card hover:border-primary/50'
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        {twin.npc_type && (
          <span>{npcEmoji[twin.npc_type] || '🤖'}</span>
        )}
        <span className="font-medium truncate">{twin.name}</span>
      </div>
      
      {isSelected ? (
        <p className="text-xs text-primary">選択済み ✓</p>
      ) : (
        <div className="flex gap-1 flex-wrap">
          {emptySeats.map(seatIdx => (
            <Button
              key={seatIdx}
              variant="outline"
              size="sm"
              className="text-xs h-7 px-2"
              onClick={() => onSelect(seatIdx)}
            >
              {seatNames[seatIdx]}に配置
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
