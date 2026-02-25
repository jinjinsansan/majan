-- Supabase Realtime を有効化
-- games テーブル（ステータス変更をリアルタイム通知）
ALTER PUBLICATION supabase_realtime ADD TABLE games;

-- actions テーブル（新しいアクションをリアルタイム通知）
ALTER PUBLICATION supabase_realtime ADD TABLE actions;
