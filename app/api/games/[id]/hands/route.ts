import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/games/:id/hands — 局一覧
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const supabase = await createClient();

    const { data: hands, error } = await supabase
      .from('hands')
      .select('*')
      .eq('game_id', id)
      .order('hand_no', { ascending: true });

    if (error) throw error;

    return NextResponse.json(hands || []);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
