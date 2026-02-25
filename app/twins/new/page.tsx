'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';

const PERSONALITY_TAGS = [
  { id: 'aggressive', label: '攻撃的', emoji: '⚔️' },
  { id: 'cautious', label: '慎重', emoji: '🛡️' },
  { id: 'logical', label: '理詰め', emoji: '🧠' },
  { id: 'emotional', label: '感情派', emoji: '💫' },
  { id: 'balanced', label: 'バランス型', emoji: '⚖️' },
];

const PLAY_STYLES = [
  { id: 'speed', label: 'スピード重視', desc: '鳴き多め・早上がり' },
  { id: 'power', label: '打点重視', desc: '門前・高打点' },
  { id: 'balance', label: 'バランス', desc: '状況に応じて' },
  { id: 'defense', label: '守備型', desc: '放銃回避重視' },
  { id: 'push', label: '押し型', desc: 'リスクを取って攻める' },
];

const FAVORITE_YAKU = [
  'タンヤオ', 'ピンフ', '三色同順', '一盃口', '混一色', 
  '清一色', 'リーチ', '七対子', 'チャンタ', '一気通貫',
  '役牌', 'ホンイツ', 'トイトイ', '対々和'
];

const RIICHI_TIMING = [
  { id: 'early', label: '早い', desc: 'テンパイ即リーチ' },
  { id: 'late', label: '遅い', desc: '好形・高打点待ち' },
  { id: 'situational', label: '状況依存', desc: '場況で判断' },
];

const NAKI_TENDENCY = [
  { id: 'high', label: '多い', desc: '積極的に鳴く' },
  { id: 'low', label: '少ない', desc: '門前派' },
  { id: 'situational', label: '状況依存', desc: '必要に応じて' },
];

export default function NewTwinPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Form state
  const [name, setName] = useState('');
  const [personalities, setPersonalities] = useState<string[]>([]);
  const [playStyle, setPlayStyle] = useState('balance');
  const [favoriteYaku, setFavoriteYaku] = useState<string[]>([]);
  const [riichiTiming, setRiichiTiming] = useState('situational');
  const [nakiTendency, setNakiTendency] = useState('situational');
  const [freePrompt, setFreePrompt] = useState('');
  const [isPublic, setIsPublic] = useState(false);

  const togglePersonality = (id: string) => {
    setPersonalities(prev => 
      prev.includes(id) 
        ? prev.filter(p => p !== id)
        : [...prev, id]
    );
  };

  const toggleYaku = (yaku: string) => {
    setFavoriteYaku(prev =>
      prev.includes(yaku)
        ? prev.filter(y => y !== yaku)
        : [...prev, yaku]
    );
  };

  const generatePersonaPrompt = () => {
    const personalityText = personalities
      .map(p => PERSONALITY_TAGS.find(t => t.id === p)?.label)
      .filter(Boolean)
      .join('、');
    
    const styleText = PLAY_STYLES.find(s => s.id === playStyle)?.label || '';
    const styleDesc = PLAY_STYLES.find(s => s.id === playStyle)?.desc || '';
    
    const riichiText = RIICHI_TIMING.find(r => r.id === riichiTiming)?.desc || '';
    const nakiText = NAKI_TENDENCY.find(n => n.id === nakiTendency)?.desc || '';
    
    return `あなたは「${name}」という麻雀AIです。

【性格】
${personalityText || '特になし'}

【打ち筋】
- スタイル: ${styleText}（${styleDesc}）
- リーチ判断: ${riichiText}
- 鳴き判断: ${nakiText}
${favoriteYaku.length > 0 ? `- 好きな役: ${favoriteYaku.join('、')}` : ''}

【追加設定】
${freePrompt || '特になし'}

【重要なルール】
- 必ず提示された候補手の中から選択すること
- JSON形式で返答すること
- 公開手牌ルール（全員の手牌が見える）であることを意識すること`;
  };

  const generateStyleParams = () => {
    const aggression = playStyle === 'power' ? 85 
      : playStyle === 'push' ? 90
      : playStyle === 'speed' ? 70
      : playStyle === 'defense' ? 25
      : 50;
    
    const defense = playStyle === 'defense' ? 95
      : playStyle === 'push' ? 20
      : playStyle === 'power' ? 30
      : playStyle === 'speed' ? 40
      : 50;
    
    const nakiValue = nakiTendency === 'high' ? 85
      : nakiTendency === 'low' ? 20
      : 50;

    return {
      aggression,
      defense,
      naki_tendency: nakiValue,
      riichi_speed: riichiTiming,
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim()) {
      setError('Twin名を入力してください');
      return;
    }
    
    if (freePrompt.length < 500) {
      setError('自由プロンプトは500文字以上入力してください');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('ログインしてください');

      const { error: insertError } = await supabase
        .from('twins')
        .insert({
          user_id: user.id,
          name: name.trim(),
          persona_prompt: generatePersonaPrompt(),
          style_params: generateStyleParams(),
          is_public: isPublic,
        });

      if (insertError) throw insertError;

      router.push('/dashboard');
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'Twin作成に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="container mx-auto p-6 max-w-3xl">
      <div className="mb-6">
        <Link href="/dashboard" className="text-muted-foreground hover:text-foreground">
          ← ダッシュボードに戻る
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">🎭 新しいTwinを作成</CardTitle>
          <CardDescription>
            あなただけのAI雀士を作成しましょう。性格や打ち筋を設定すると、
            そのキャラクターが対局で自動的にプレイします。
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-6">
            {error && (
              <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                {error}
              </div>
            )}

            {/* Twin Name */}
            <div className="space-y-2">
              <Label htmlFor="name">Twin名 *</Label>
              <Input
                id="name"
                placeholder="例: 速攻太郎、慎重花子"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={20}
                required
              />
            </div>

            {/* Personality Tags */}
            <div className="space-y-2">
              <Label>性格タグ（複数選択可）</Label>
              <div className="flex flex-wrap gap-2">
                {PERSONALITY_TAGS.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => togglePersonality(tag.id)}
                    className={`px-3 py-2 rounded-md border text-sm transition-colors ${
                      personalities.includes(tag.id)
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background hover:bg-accent'
                    }`}
                  >
                    {tag.emoji} {tag.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Play Style */}
            <div className="space-y-2">
              <Label>打ち筋</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {PLAY_STYLES.map((style) => (
                  <button
                    key={style.id}
                    type="button"
                    onClick={() => setPlayStyle(style.id)}
                    className={`p-3 rounded-md border text-left transition-colors ${
                      playStyle === style.id
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background hover:bg-accent'
                    }`}
                  >
                    <div className="font-medium text-sm">{style.label}</div>
                    <div className="text-xs opacity-70">{style.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Favorite Yaku */}
            <div className="space-y-2">
              <Label>好きな役（複数選択可）</Label>
              <div className="flex flex-wrap gap-2">
                {FAVORITE_YAKU.map((yaku) => (
                  <button
                    key={yaku}
                    type="button"
                    onClick={() => toggleYaku(yaku)}
                    className={`px-3 py-1 rounded-md border text-sm transition-colors ${
                      favoriteYaku.includes(yaku)
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background hover:bg-accent'
                    }`}
                  >
                    {yaku}
                  </button>
                ))}
              </div>
            </div>

            {/* Riichi Timing */}
            <div className="space-y-2">
              <Label>リーチ判断</Label>
              <div className="flex gap-2">
                {RIICHI_TIMING.map((timing) => (
                  <button
                    key={timing.id}
                    type="button"
                    onClick={() => setRiichiTiming(timing.id)}
                    className={`flex-1 p-3 rounded-md border text-center transition-colors ${
                      riichiTiming === timing.id
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background hover:bg-accent'
                    }`}
                  >
                    <div className="font-medium text-sm">{timing.label}</div>
                    <div className="text-xs opacity-70">{timing.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Naki Tendency */}
            <div className="space-y-2">
              <Label>鳴き判断</Label>
              <div className="flex gap-2">
                {NAKI_TENDENCY.map((tendency) => (
                  <button
                    key={tendency.id}
                    type="button"
                    onClick={() => setNakiTendency(tendency.id)}
                    className={`flex-1 p-3 rounded-md border text-center transition-colors ${
                      nakiTendency === tendency.id
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background hover:bg-accent'
                    }`}
                  >
                    <div className="font-medium text-sm">{tendency.label}</div>
                    <div className="text-xs opacity-70">{tendency.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Free Prompt */}
            <div className="space-y-2">
              <Label htmlFor="freePrompt">
                自由プロンプト * <span className="text-muted-foreground text-xs">(500〜3000文字)</span>
              </Label>
              <Textarea
                id="freePrompt"
                placeholder="このTwinの詳しい性格、思考パターン、口癖、好きなこと嫌いなことなどを自由に記述してください。詳しく書くほどキャラが立ちます。"
                value={freePrompt}
                onChange={(e) => setFreePrompt(e.target.value)}
                rows={6}
                minLength={500}
                maxLength={3000}
                required
              />
              <p className="text-xs text-muted-foreground text-right">
                {freePrompt.length} / 3000
              </p>
            </div>

            {/* Public Setting */}
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="isPublic"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                className="w-4 h-4"
              />
              <Label htmlFor="isPublic" className="cursor-pointer">
                このTwinを公開する（他のユーザーが対局に招待できます）
              </Label>
            </div>
          </CardContent>

          <CardFooter className="flex gap-4">
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? '作成中...' : 'Twinを作成'}
            </Button>
            <Link href="/dashboard">
              <Button type="button" variant="outline">キャンセル</Button>
            </Link>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
