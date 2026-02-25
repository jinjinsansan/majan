import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/twins/:id
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const supabase = await createClient();

    const { data: twin, error } = await supabase
      .from('twins')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !twin) {
      return NextResponse.json({ error: 'Twin not found' }, { status: 404 });
    }

    return NextResponse.json(twin);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/twins/:id
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 所有権チェック
    const { data: existing } = await supabase
      .from('twins')
      .select('user_id')
      .eq('id', id)
      .single();

    if (!existing || existing.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { name, persona_prompt, style_params, is_public } = body;

    const updateData: Record<string, any> = {};
    if (name !== undefined) updateData.name = name.trim();
    if (persona_prompt !== undefined) updateData.persona_prompt = persona_prompt;
    if (style_params !== undefined) updateData.style_params = style_params;
    if (is_public !== undefined) updateData.is_public = is_public;

    const { data: twin, error } = await supabase
      .from('twins')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(twin);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/twins/:id
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 所有権チェック
    const { data: existing } = await supabase
      .from('twins')
      .select('user_id')
      .eq('id', id)
      .single();

    if (!existing || existing.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { error } = await supabase
      .from('twins')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
