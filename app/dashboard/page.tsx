import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default async function DashboardPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: twins } = await supabase
    .from('twins')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  const { data: games } = await supabase
    .from('games')
    .select('*')
    .eq('created_by', user.id)
    .order('created_at', { ascending: false })
    .limit(5);

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  return (
    <main className="min-h-screen bg-felt tile-pattern">
      <div className="container mx-auto p-4 sm:p-6 max-w-6xl">
        {/* ヘッダー */}
        <div className="flex justify-between items-center mb-6 sm:mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">
              <span className="text-gold">卓</span>
              <span className="text-foreground ml-1">ダッシュボード</span>
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              ようこそ、{profile?.display_name || user.email}さん
            </p>
          </div>
          <form action="/api/auth/logout" method="POST">
            <Button variant="outline" type="submit" size="sm" className="border-border/50">
              ログアウト
            </Button>
          </form>
        </div>

        {/* クイックアクション */}
        <div className="grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3 mb-6 sm:mb-8">
          <Link href="/twins/new">
            <Card className="hover:border-primary/50 transition-all cursor-pointer h-full bg-card/80 backdrop-blur-sm group">
              <CardHeader className="pb-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-2 group-hover:bg-primary/20 transition-colors">
                  <span className="text-xl">🎭</span>
                </div>
                <CardTitle className="text-base">Twin作成</CardTitle>
                <CardDescription className="text-xs">
                  新しいAI雀士を作成する
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/games/new">
            <Card className="hover:border-primary/50 transition-all cursor-pointer h-full bg-card/80 backdrop-blur-sm group">
              <CardHeader className="pb-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-2 group-hover:bg-primary/20 transition-colors">
                  <span className="text-xl">🀄</span>
                </div>
                <CardTitle className="text-base">対局開始</CardTitle>
                <CardDescription className="text-xs">
                  Twinを選んで対局を始める
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/twins">
            <Card className="hover:border-primary/50 transition-all cursor-pointer h-full bg-card/80 backdrop-blur-sm group">
              <CardHeader className="pb-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-2 group-hover:bg-primary/20 transition-colors">
                  <span className="text-xl">👥</span>
                </div>
                <CardTitle className="text-base">公開Twin</CardTitle>
                <CardDescription className="text-xs">
                  他のユーザーのTwinを探す
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        </div>

        {/* マイTwin */}
        <section className="mb-6 sm:mb-8">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2">
              <span className="text-gold">雀</span> マイTwin
            </h2>
            <Link href="/twins/new">
              <Button variant="outline" size="sm" className="border-border/50 text-xs">+ 新規作成</Button>
            </Link>
          </div>

          {twins && twins.length > 0 ? (
            <div className="grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
              {twins.map((twin) => (
                <Link key={twin.id} href={`/twins/${twin.id}/edit`}>
                  <Card className="hover:border-primary/50 transition-all cursor-pointer bg-card/80 backdrop-blur-sm group">
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-3">
                        {/* アバター */}
                        {twin.avatar_url ? (
                          <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-border group-hover:border-primary/50 transition-colors flex-shrink-0">
                            <Image
                              src={twin.avatar_url}
                              alt={twin.name}
                              width={48}
                              height={48}
                              className="w-full h-full object-cover"
                              unoptimized
                            />
                          </div>
                        ) : (
                          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary/40 to-primary/20 flex items-center justify-center border-2 border-border group-hover:border-primary/50 transition-colors flex-shrink-0">
                            <span className="text-lg font-bold">{twin.name.charAt(0)}</span>
                          </div>
                        )}
                        <div className="min-w-0">
                          <CardTitle className="text-base truncate">{twin.name}</CardTitle>
                          <CardDescription className="text-xs line-clamp-1 mt-0.5">
                            {twin.persona_prompt.slice(0, 60)}...
                          </CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="flex gap-2 text-xs">
                        {twin.is_public ? (
                          <span className="px-2 py-0.5 bg-primary/10 text-primary rounded">公開</span>
                        ) : (
                          <span className="px-2 py-0.5 bg-muted text-muted-foreground rounded">非公開</span>
                        )}
                        {twin.style_params?.aggression != null && (
                          <span className="px-2 py-0.5 bg-muted text-muted-foreground rounded">
                            攻{twin.style_params.aggression}
                          </span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          ) : (
            <Card className="text-center py-8 bg-card/80 backdrop-blur-sm">
              <CardContent>
                <p className="text-muted-foreground mb-4 text-sm">まだTwinがありません</p>
                <Link href="/twins/new">
                  <Button size="sm">最初のTwinを作成</Button>
                </Link>
              </CardContent>
            </Card>
          )}
        </section>

        {/* 最近の対局 */}
        <section>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2">
              <span className="text-gold">局</span> 最近の対局
            </h2>
            <Link href="/games">
              <Button variant="outline" size="sm" className="border-border/50 text-xs">すべて見る</Button>
            </Link>
          </div>

          {games && games.length > 0 ? (
            <div className="space-y-2">
              {games.map((game) => (
                <Link key={game.id} href={`/games/${game.id}`}>
                  <Card className="hover:border-primary/50 transition-all cursor-pointer bg-card/80 backdrop-blur-sm">
                    <CardContent className="py-3 sm:py-4 flex justify-between items-center">
                      <div>
                        <p className="font-medium text-sm">
                          対局 #{game.id.slice(0, 8)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(game.created_at).toLocaleString('ja-JP')}
                        </p>
                      </div>
                      <span className={`px-2.5 py-1 rounded text-xs font-medium ${
                        game.status === 'finished'
                          ? 'bg-primary/15 text-primary'
                          : game.status === 'running'
                          ? 'bg-blue-500/15 text-blue-400'
                          : game.status === 'failed'
                          ? 'bg-red-500/15 text-red-400'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {game.status === 'finished' ? '終了'
                          : game.status === 'running' ? '進行中'
                          : game.status === 'queued' ? '待機中'
                          : game.status === 'failed' ? '失敗'
                          : game.status}
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          ) : (
            <Card className="text-center py-8 bg-card/80 backdrop-blur-sm">
              <CardContent>
                <p className="text-muted-foreground mb-4 text-sm">まだ対局がありません</p>
                <Link href="/games/new">
                  <Button size="sm">対局を始める</Button>
                </Link>
              </CardContent>
            </Card>
          )}
        </section>
      </div>
    </main>
  );
}
