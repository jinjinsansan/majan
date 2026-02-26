import Link from 'next/link';
import { Button } from '@/components/ui/button';

// 装飾用の牌データ
const decorativeTiles = [
  { char: '一', sub: '萬', color: 'text-red-600' },
  { char: '發', sub: '', color: 'text-green-600' },
  { char: '中', sub: '', color: 'text-red-600' },
  { char: '九', sub: '萬', color: 'text-red-600' },
  { char: '白', sub: '', color: 'text-gray-400' },
];

function DecoTile({ char, sub, color, className }: { char: string; sub: string; color: string; className?: string }) {
  return (
    <div className={`inline-flex flex-col items-center justify-center w-12 h-16 sm:w-14 sm:h-20 bg-amber-50 border border-gray-300 rounded-sm shadow-lg select-none ${className}`}>
      <span className={`font-black text-lg sm:text-xl leading-none ${color}`}>{char}</span>
      {sub && <span className={`font-bold text-[7px] sm:text-[8px] leading-none ${color}`}>{sub}</span>}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gray-400/30 rounded-b-sm" />
      <div className="absolute top-0 bottom-0 right-0 w-[1px] bg-gray-400/20 rounded-r-sm" />
    </div>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col">
      {/* ヒーローセクション */}
      <section className="flex-1 flex flex-col items-center justify-center p-6 sm:p-8 bg-felt tile-pattern relative overflow-hidden">
        {/* 背景装飾 */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background/80" />

        <div className="relative z-10 max-w-3xl text-center space-y-8">
          {/* 装飾牌 */}
          <div className="flex items-center justify-center gap-2 sm:gap-3 mb-4">
            {decorativeTiles.map((tile, i) => (
              <DecoTile
                key={i}
                char={tile.char}
                sub={tile.sub}
                color={tile.color}
                className={`transform ${
                  i === 0 ? '-rotate-6' :
                  i === 1 ? '-rotate-3' :
                  i === 2 ? 'rotate-0 scale-110 shadow-xl' :
                  i === 3 ? 'rotate-3' :
                  'rotate-6'
                } hover:-translate-y-1 transition-transform`}
              />
            ))}
          </div>

          {/* タイトル */}
          <div className="space-y-3">
            <h1 className="text-4xl sm:text-6xl font-black tracking-tight">
              <span className="bg-gradient-to-r from-emerald-400 via-green-300 to-emerald-500 bg-clip-text text-transparent">
                麻雀AI
              </span>
              <span className="text-gold"> Twin</span>
            </h1>
            <p className="text-base sm:text-xl text-muted-foreground max-w-lg mx-auto">
              あなただけのAI雀士を作って、対局を観戦しよう
            </p>
          </div>

          {/* 特徴カード */}
          <div className="grid gap-3 sm:gap-4 sm:grid-cols-3 text-left">
            <div className="p-4 sm:p-5 rounded-xl bg-card/80 backdrop-blur-sm border border-border/50 hover:border-primary/50 transition-all hover:shadow-lg hover:shadow-primary/5">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                <span className="text-xl">🎭</span>
              </div>
              <h3 className="font-bold text-sm sm:text-base mb-1">AIキャラ作成</h3>
              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                性格・打ち筋を設定してアニメ風アバター付きのAI雀士を作成
              </p>
            </div>
            <div className="p-4 sm:p-5 rounded-xl bg-card/80 backdrop-blur-sm border border-border/50 hover:border-primary/50 transition-all hover:shadow-lg hover:shadow-primary/5">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                <span className="text-xl">🀄</span>
              </div>
              <h3 className="font-bold text-sm sm:text-base mb-1">自動対局観戦</h3>
              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                Twin同士が自動で対局。漫画のような臨場感で観戦できる
              </p>
            </div>
            <div className="p-4 sm:p-5 rounded-xl bg-card/80 backdrop-blur-sm border border-border/50 hover:border-primary/50 transition-all hover:shadow-lg hover:shadow-primary/5">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                <span className="text-xl">💭</span>
              </div>
              <h3 className="font-bold text-sm sm:text-base mb-1">AI思考を読む</h3>
              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                アバターの横に吹き出しで思考が表示。麻雀漫画のような体験
              </p>
            </div>
          </div>

          {/* 注意書き */}
          <div className="inline-block p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/20 text-xs sm:text-sm">
            <p className="text-yellow-400/80">
              全プレイヤーの手牌が見える<strong>公開手牌ルール</strong>です
            </p>
          </div>

          {/* CTA */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/signup">
              <Button size="lg" className="text-base sm:text-lg px-8 w-full sm:w-auto bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20">
                無料で始める
              </Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="outline" className="text-base sm:text-lg px-8 w-full sm:w-auto border-border/50 hover:bg-card/50">
                ログイン
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* フッター */}
      <footer className="py-4 text-center border-t border-border/30">
        <p className="text-xs text-muted-foreground">
          &copy; 2026 麻雀AI Twin
        </p>
      </footer>
    </main>
  );
}
