import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

// GET /api/twins — 自分のTwin一覧
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: twins, error } = await supabase
      .from('twins')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json(twins);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/twins — Twin作成
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name, persona_prompt, style_params, is_public } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Twin名は必須です' }, { status: 400 });
    }

    if (!persona_prompt || persona_prompt.length < 500) {
      return NextResponse.json({ error: '自由プロンプトは500文字以上必要です' }, { status: 400 });
    }

    const { data: twin, error } = await supabase
      .from('twins')
      .insert({
        user_id: user.id,
        name: name.trim(),
        persona_prompt,
        style_params: style_params || {},
        is_public: is_public || false,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(twin, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
