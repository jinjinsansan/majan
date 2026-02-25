import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default async function GamesHistoryPage() {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    redirect('/login');
  }

  // 自分が作成した対局を取得
  const { data: games } = await supabase
    .from('games')
    .select('*')
    .eq('created_by', user.id)
    .order('created_at', { ascending: false });

  // Twin情報を取得（名前表示用）
  const allTwinIds = games?.flatMap(g => g.player_twin_ids || []) || [];
  const uniqueTwinIds = [...new Set(allTwinIds)];
  
  const { data: twins } = await supabase
    .from('twins')
    .select('id, name')
    .in('id', uniqueTwinIds.length > 0 ? uniqueTwinIds : ['']);

  const twinMap = new Map(twins?.map(t => [t.id, t.name]) || []);

  const statusLabels: Record<string, { label: string; color: string }> = {
    queued: { label: '待機中', color: 'bg-gray-500/20 text-gray-400' },
    matching: { label: 'マッチング中', color: 'bg-blue-500/20 text-blue-400' },
    running: { label: '進行中', color: 'bg-green-500/20 text-green-400' },
    finished: { label: '終了', color: 'bg-purple-500/20 text-purple-400' },
    failed: { label: 'エラー', color: 'bg-red-500/20 text-red-400' },
  };

  return (
    <main className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <Link href="/dashboard" className="text-muted-foreground hover:text-foreground">
          ← ダッシュボードに戻る
        </Link>
      </div>

      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold">🀄 対局履歴</h1>
          <p className="text-muted-foreground">
            過去の対局を観戦できます
          </p>
        </div>
        <Link href="/games/new">
          <Button>+ 新しい対局を作成</Button>
        </Link>
      </div>

      {games && games.length > 0 ? (
        <div className="space-y-3">
          {games.map((game) => {
            const status = statusLabels[game.status] || statusLabels.queued;
            const playerNames = game.player_twin_ids
              ?.map((id: string) => twinMap.get(id) || '???')
              .join(' vs ') || '不明';

            return (
              <Link key={game.id} href={`/games/${game.id}`}>
                <Card className="hover:border-primary transition-colors cursor-pointer">
                  <CardContent className="py-4">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="font-medium mb-1">
                          {playerNames}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {new Date(game.created_at).toLocaleString('ja-JP')}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className={`px-3 py-1 rounded text-sm ${status.color}`}>
                          {status.label}
                        </span>
                        {game.mode === 'ai_only' && (
                          <p className="text-xs text-muted-foreground mt-1">
                            AI対局
                          </p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      ) : (
        <Card className="text-center py-12">
          <CardContent>
            <div className="text-4xl mb-4">🀄</div>
            <p className="text-muted-foreground mb-4">
              まだ対局がありません
            </p>
            <Link href="/games/new">
              <Button>最初の対局を始める</Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
