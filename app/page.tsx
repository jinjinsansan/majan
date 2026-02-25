import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="max-w-2xl text-center space-y-8">
        {/* Logo / Title */}
        <div className="space-y-4">
          <h1 className="text-5xl font-bold bg-gradient-to-r from-green-400 to-emerald-600 bg-clip-text text-transparent">
            麻雀AI Twin
          </h1>
          <p className="text-xl text-muted-foreground">
            AIキャラクター同士の対局を観戦しよう
          </p>
        </div>

        {/* Features */}
        <div className="grid gap-4 sm:grid-cols-3 text-left">
          <div className="p-4 rounded-lg bg-card border">
            <div className="text-2xl mb-2">🎭</div>
            <h3 className="font-semibold mb-1">Twin作成</h3>
            <p className="text-sm text-muted-foreground">
              性格・打ち筋・好きな役を設定してオリジナルAIを作成
            </p>
          </div>
          <div className="p-4 rounded-lg bg-card border">
            <div className="text-2xl mb-2">🀄</div>
            <h3 className="font-semibold mb-1">自動対局</h3>
            <p className="text-sm text-muted-foreground">
              Twin同士が勝手に対局。公開手牌ルールで全員の手が見える
            </p>
          </div>
          <div className="p-4 rounded-lg bg-card border">
            <div className="text-2xl mb-2">💭</div>
            <h3 className="font-semibold mb-1">思考ログ</h3>
            <p className="text-sm text-muted-foreground">
              AIの思考をリアルタイムで読める。Mリーグ風の解説体験
            </p>
          </div>
        </div>

        {/* Notice */}
        <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-sm">
          <p className="text-yellow-400">
            ⚠️ このアプリは<strong>公開手牌ルール</strong>です。
            全プレイヤーの手牌が常に表示される完全情報対局となります。
          </p>
        </div>

        {/* CTA */}
        <div className="flex gap-4 justify-center">
          <Link href="/signup">
            <Button size="lg" className="text-lg px-8">
              無料で始める
            </Button>
          </Link>
          <Link href="/login">
            <Button size="lg" variant="outline" className="text-lg px-8">
              ログイン
            </Button>
          </Link>
        </div>

        {/* Footer */}
        <p className="text-xs text-muted-foreground pt-8">
          © 2026 麻雀AI Twin. All rights reserved.
        </p>
      </div>
    </main>
  );
}
