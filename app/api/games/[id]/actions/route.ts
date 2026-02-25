import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/games/:id/actions — アクションログ（ページネーション対応）
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const cursor = parseInt(searchParams.get('cursor') || '0');
    const limit = Math.min(parseInt(searchParams.get('limit') || '500'), 1000);

    let query = supabase
      .from('actions')
      .select('*')
      .eq('game_id', id)
      .order('seq_no', { ascending: true });

    if (cursor > 0) {
      query = query.gt('seq_no', cursor);
    }

    query = query.limit(limit);

    const { data: actions, error } = await query;

    if (error) throw error;

    const nextCursor = actions && actions.length === limit
      ? actions[actions.length - 1].seq_no
      : null;

    return NextResponse.json({
      actions: actions || [],
      next_cursor: nextCursor,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
