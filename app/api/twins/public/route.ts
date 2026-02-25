import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/twins/public — 公開Twin一覧（NPC含む）
export async function GET() {
  try {
    const supabase = await createClient();

    const { data: twins, error } = await supabase
      .from('twins')
      .select('*')
      .or('is_public.eq.true,is_npc.eq.true')
      .order('is_npc', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json(twins);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
