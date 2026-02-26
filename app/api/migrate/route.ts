import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

// ワンタイムマイグレーション: avatar_url カラムを追加
// POST /api/migrate で実行後、このファイルを削除してください
export async function POST() {
  try {
    const supabase = await createServiceClient();

    // avatar_url カラム追加（既存なら無視）
    const { error } = await supabase.rpc('exec_sql', {
      sql: 'ALTER TABLE twins ADD COLUMN IF NOT EXISTS avatar_url TEXT;',
    });

    // rpc が使えない場合はフォールバック: 既にカラムがあるかテスト
    if (error) {
      // カラムが存在するか確認
      const { data, error: testError } = await supabase
        .from('twins')
        .select('avatar_url')
        .limit(1);

      if (testError && testError.message.includes('avatar_url')) {
        return NextResponse.json({
          status: 'needs_manual_migration',
          message: 'Supabase SQLエディタで実行してください: ALTER TABLE twins ADD COLUMN IF NOT EXISTS avatar_url TEXT;',
        });
      }

      return NextResponse.json({ status: 'ok', message: 'avatar_url カラムは既に存在します' });
    }

    return NextResponse.json({ status: 'ok', message: 'マイグレーション完了' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
