import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default async function PublicTwinsPage() {
  const supabase = await createClient();
  
  // 公開TwinとNPCを取得
  const { data: twins } = await supabase
    .from('twins')
    .select('*')
    .or('is_public.eq.true,is_npc.eq.true')
    .order('created_at', { ascending: false });

  const publicTwins = twins?.filter(t => !t.is_npc) || [];
  const npcs = twins?.filter(t => t.is_npc) || [];

  const npcEmoji: Record<string, string> = {
    speed: '⚡',
    power: '💪',
    defense: '🛡️',
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
          <h1 className="text-3xl font-bold">👥 公開Twin</h1>
          <p className="text-muted-foreground">
            他のユーザーが作成したTwinを対局に招待できます
          </p>
        </div>
        <Link href="/twins/new">
          <Button>+ 新しいTwinを作成</Button>
        </Link>
      </div>

      {/* NPC Section */}
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">🤖 NPC（運営提供）</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {npcs.map((twin) => (
            <Card key={twin.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span>{npcEmoji[twin.npc_type] || '🤖'}</span>
                  {twin.name}
                </CardTitle>
                <CardDescription>
                  {twin.npc_type === 'speed' && 'スピード重視・鳴き多め'}
                  {twin.npc_type === 'power' && '打点重視・門前派'}
                  {twin.npc_type === 'defense' && '守備重視・放銃回避'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground line-clamp-3">
                  {twin.persona_prompt?.slice(0, 150)}...
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Public Twins Section */}
      <section>
        <h2 className="text-xl font-semibold mb-4">🎭 ユーザー作成Twin</h2>
        {publicTwins.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {publicTwins.map((twin) => (
              <Card key={twin.id}>
                <CardHeader>
                  <CardTitle>{twin.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground line-clamp-3">
                    {twin.persona_prompt?.slice(0, 150)}...
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    作成: {new Date(twin.created_at).toLocaleDateString('ja-JP')}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="text-center py-8">
            <CardContent>
              <p className="text-muted-foreground mb-4">
                まだ公開されているTwinがありません
              </p>
              <Link href="/twins/new">
                <Button variant="outline">最初の公開Twinを作成</Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </section>
    </main>
  );
}
