import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/games/:id/reasoning — 思考ログ
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const cursor = searchParams.get('cursor');
    const limit = Math.min(parseInt(searchParams.get('limit') || '200'), 500);

    // まずアクションIDを取得
    const { data: actions } = await supabase
      .from('actions')
      .select('id')
      .eq('game_id', id);

    if (!actions || actions.length === 0) {
      return NextResponse.json({ reasonings: [], next_cursor: null });
    }

    const actionIds = actions.map(a => a.id);

    let query = supabase
      .from('reasoning_logs')
      .select('*')
      .in('action_id', actionIds)
      .order('created_at', { ascending: true });

    if (cursor) {
      query = query.gt('created_at', cursor);
    }

    query = query.limit(limit);

    const { data: reasonings, error } = await query;

    if (error) throw error;

    const nextCursor = reasonings && reasonings.length === limit
      ? reasonings[reasonings.length - 1].created_at
      : null;

    return NextResponse.json({
      reasonings: reasonings || [],
      next_cursor: nextCursor,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
