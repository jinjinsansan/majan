import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default async function DashboardPage() {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    redirect('/login');
  }

  // Get user's twins
  const { data: twins } = await supabase
    .from('twins')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  // Get recent games
  const { data: games } = await supabase
    .from('games')
    .select('*')
    .eq('created_by', user.id)
    .order('created_at', { ascending: false })
    .limit(5);

  // Get user profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  return (
    <main className="container mx-auto p-6 max-w-6xl">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold">ダッシュボード</h1>
          <p className="text-muted-foreground">
            ようこそ、{profile?.display_name || user.email}さん
          </p>
        </div>
        <form action="/api/auth/logout" method="POST">
          <Button variant="outline" type="submit">ログアウト</Button>
        </form>
      </div>

      {/* Quick Actions */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-8">
        <Link href="/twins/new">
          <Card className="hover:border-primary transition-colors cursor-pointer h-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="text-2xl">🎭</span>
                Twin作成
              </CardTitle>
              <CardDescription>
                新しいAIキャラクターを作成する
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/games/new">
          <Card className="hover:border-primary transition-colors cursor-pointer h-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="text-2xl">🀄</span>
                対局開始
              </CardTitle>
              <CardDescription>
                Twinを選んで対局を始める
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/twins">
          <Card className="hover:border-primary transition-colors cursor-pointer h-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="text-2xl">👥</span>
                公開Twin
              </CardTitle>
              <CardDescription>
                他のユーザーのTwinを探す
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>

      {/* My Twins */}
      <section className="mb-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">マイTwin</h2>
          <Link href="/twins/new">
            <Button variant="outline" size="sm">+ 新規作成</Button>
          </Link>
        </div>
        
        {twins && twins.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {twins.map((twin) => (
              <Link key={twin.id} href={`/twins/${twin.id}/edit`}>
                <Card className="hover:border-primary transition-colors cursor-pointer">
                  <CardHeader>
                    <CardTitle className="text-lg">{twin.name}</CardTitle>
                    <CardDescription className="line-clamp-2">
                      {twin.persona_prompt.slice(0, 100)}...
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex gap-2 text-xs">
                      {twin.is_public && (
                        <span className="px-2 py-1 bg-green-500/20 text-green-400 rounded">
                          公開中
                        </span>
                      )}
                      {!twin.is_public && (
                        <span className="px-2 py-1 bg-gray-500/20 text-gray-400 rounded">
                          非公開
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <Card className="text-center py-8">
            <CardContent>
              <p className="text-muted-foreground mb-4">
                まだTwinがありません
              </p>
              <Link href="/twins/new">
                <Button>最初のTwinを作成</Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </section>

      {/* Recent Games */}
      <section>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">最近の対局</h2>
          <Link href="/games">
            <Button variant="outline" size="sm">すべて見る</Button>
          </Link>
        </div>
        
        {games && games.length > 0 ? (
          <div className="space-y-2">
            {games.map((game) => (
              <Link key={game.id} href={`/games/${game.id}`}>
                <Card className="hover:border-primary transition-colors cursor-pointer">
                  <CardContent className="py-4 flex justify-between items-center">
                    <div>
                      <p className="font-medium">
                        対局 #{game.id.slice(0, 8)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {new Date(game.created_at).toLocaleString('ja-JP')}
                      </p>
                    </div>
                    <span className={`px-3 py-1 rounded text-sm ${
                      game.status === 'finished' 
                        ? 'bg-green-500/20 text-green-400'
                        : game.status === 'running'
                        ? 'bg-blue-500/20 text-blue-400'
                        : 'bg-gray-500/20 text-gray-400'
                    }`}>
                      {game.status === 'finished' ? '終了' 
                        : game.status === 'running' ? '進行中'
                        : game.status === 'queued' ? '待機中'
                        : game.status}
                    </span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <Card className="text-center py-8">
            <CardContent>
              <p className="text-muted-foreground mb-4">
                まだ対局がありません
              </p>
              <Link href="/games/new">
                <Button>対局を始める</Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </section>
    </main>
  );
}
