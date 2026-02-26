import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createServiceClient } from '@/lib/supabase/server';
import { randomUUID } from 'node:crypto';

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { prompt, twinName } = await request.json();

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'プロンプトが必要です' }, { status: 400 });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // DALL-E 3 でアニメ風アバター生成
    const imagePrompt = [
      'Anime-style character portrait for a mahjong player.',
      'Clean illustration, bust-up shot, expressive face, vibrant colors.',
      'Character personality:',
      twinName ? `Name: ${twinName}.` : '',
      prompt.slice(0, 500),
      'Style: Japanese anime/manga illustration, detailed eyes, clean lineart, colorful.',
      'Background: simple gradient or abstract pattern.',
      'No text, no watermarks, no mahjong tiles in the image.',
    ].filter(Boolean).join(' ');

    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt: imagePrompt,
      n: 1,
      size: '1024x1024',
      quality: 'standard',
    });

    const imageUrl = response.data?.[0]?.url;
    if (!imageUrl) {
      return NextResponse.json({ error: '画像生成に失敗しました' }, { status: 500 });
    }

    // 画像をダウンロードしてSupabase Storageにアップロード
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      return NextResponse.json({ error: '画像のダウンロードに失敗しました' }, { status: 500 });
    }

    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    const fileName = `${randomUUID()}.png`;
    const supabase = await createServiceClient();

    // バケットが存在しない場合は作成
    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets?.find(b => b.id === 'twin-avatars')) {
      await supabase.storage.createBucket('twin-avatars', { public: true });
    }

    const { error: uploadError } = await supabase.storage
      .from('twin-avatars')
      .upload(fileName, imageBuffer, {
        contentType: 'image/png',
        upsert: true,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      // フォールバック: DALL-E URLを直接返す（一時的）
      return NextResponse.json({ url: imageUrl });
    }

    const { data: { publicUrl } } = supabase.storage
      .from('twin-avatars')
      .getPublicUrl(fileName);

    return NextResponse.json({ url: publicUrl });
  } catch (err: any) {
    console.error('Avatar generation error:', err);
    return NextResponse.json(
      { error: err.message || 'アバター生成に失敗しました' },
      { status: 500 },
    );
  }
}
