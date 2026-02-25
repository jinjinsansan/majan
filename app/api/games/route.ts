import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/games — 自分が作成した対局一覧
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: games, error } = await supabase
      .from('games')
      .select('*')
      .eq('created_by', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json(games);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/games — 対局作成
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { player_twin_ids, mode } = body;

    if (!player_twin_ids || player_twin_ids.length !== 4) {
      return NextResponse.json({ error: '4人のTwinを選択してください' }, { status: 400 });
    }

    // Twinの存在確認
    const { data: twins, error: twinsError } = await supabase
      .from('twins')
      .select('id, user_id, is_npc, is_public')
      .in('id', player_twin_ids);

    if (twinsError || !twins || twins.length !== 4) {
      return NextResponse.json({ error: '無効なTwinが含まれています' }, { status: 400 });
    }

    // 自分のTwinが最低1つ含まれているか確認
    const hasOwnTwin = twins.some(t => t.user_id === user.id);
    if (!hasOwnTwin) {
      return NextResponse.json({ error: '自分のTwinを最低1つ含めてください' }, { status: 400 });
    }

    const { data: game, error } = await supabase
      .from('games')
      .insert({
        created_by: user.id,
        mode: mode || 'ai_only',
        status: 'queued',
        rule_set: {
          players: 4,
          format: 'tonpu',
          aka_dora: true,
          kuitan: true,
          atozuke: true,
          double_ron: false,
          tobi: true,
          open_hand: true,
        },
        player_twin_ids,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(game, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
