import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/games/:id — 対局概要
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const supabase = await createClient();

    const { data: game, error } = await supabase
      .from('games')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Twins情報も取得
    const { data: twins } = await supabase
      .from('twins')
      .select('id, name, npc_type, is_npc, style_params')
      .in('id', game.player_twin_ids);

    // 席順に並べ替え
    const orderedTwins = game.player_twin_ids.map((twinId: string) =>
      twins?.find(t => t.id === twinId)
    ).filter(Boolean);

    return NextResponse.json({ ...game, twins: orderedTwins });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
