'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';
import type { Twin } from '@/lib/types';

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

export default function EditTwinPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [twin, setTwin] = useState<Twin | null>(null);
  
  // Form state
  const [name, setName] = useState('');
  const [personaPrompt, setPersonaPrompt] = useState('');
  const [isPublic, setIsPublic] = useState(false);

  useEffect(() => {
    loadTwin();
  }, [id]);

  const loadTwin = async () => {
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        router.push('/login');
        return;
      }

      const { data, error } = await supabase
        .from('twins')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !data) {
        setError('Twinが見つかりません');
        return;
      }

      // 自分のTwinかチェック
      if (data.user_id !== user.id) {
        setError('このTwinを編集する権限がありません');
        return;
      }

      setTwin(data);
      setName(data.name);
      setPersonaPrompt(data.persona_prompt);
      setIsPublic(data.is_public);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim()) {
      setError('Twin名を入力してください');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const supabase = createClient();
      
      const { error: updateError } = await supabase
        .from('twins')
        .update({
          name: name.trim(),
          persona_prompt: personaPrompt,
          is_public: isPublic,
        })
        .eq('id', id);

      if (updateError) throw updateError;

      router.push('/dashboard');
      router.refresh();
    } catch (err: any) {
      setError(err.message || '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('本当にこのTwinを削除しますか？この操作は取り消せません。')) {
      return;
    }

    setDeleting(true);
    setError(null);

    try {
      const supabase = createClient();
      
      const { error: deleteError } = await supabase
        .from('twins')
        .delete()
        .eq('id', id);

      if (deleteError) throw deleteError;

      router.push('/dashboard');
      router.refresh();
    } catch (err: any) {
      setError(err.message || '削除に失敗しました');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">🎭</div>
          <p className="text-muted-foreground">読み込み中...</p>
        </div>
      </main>
    );
  }

  if (error && !twin) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <p className="text-destructive mb-4">{error}</p>
            <Link href="/dashboard">
              <Button>ダッシュボードへ</Button>
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="container mx-auto p-6 max-w-3xl">
      <div className="mb-6">
        <Link href="/dashboard" className="text-muted-foreground hover:text-foreground">
          ← ダッシュボードに戻る
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">🎭 Twinを編集</CardTitle>
          <CardDescription>
            {twin?.name} の設定を変更します
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleSave}>
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

            {/* Persona Prompt */}
            <div className="space-y-2">
              <Label htmlFor="personaPrompt">
                キャラクター設定（LLMに渡すプロンプト）
              </Label>
              <Textarea
                id="personaPrompt"
                placeholder="このTwinの性格、打ち筋、思考パターンなどを記述..."
                value={personaPrompt}
                onChange={(e) => setPersonaPrompt(e.target.value)}
                rows={12}
              />
              <p className="text-xs text-muted-foreground text-right">
                {personaPrompt.length} 文字
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

          <CardFooter className="flex justify-between">
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting || saving}
            >
              {deleting ? '削除中...' : '🗑️ 削除'}
            </Button>
            
            <div className="flex gap-4">
              <Link href="/dashboard">
                <Button type="button" variant="outline">キャンセル</Button>
              </Link>
              <Button type="submit" disabled={saving || deleting}>
                {saving ? '保存中...' : '💾 保存'}
              </Button>
            </div>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
