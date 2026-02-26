-- Twin アバター画像URL
ALTER TABLE twins ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- アバター画像用ストレージバケット
INSERT INTO storage.buckets (id, name, public)
VALUES ('twin-avatars', 'twin-avatars', true)
ON CONFLICT (id) DO NOTHING;

-- 公開読み取りポリシー
CREATE POLICY "Public access to twin avatars" ON storage.objects
  FOR SELECT USING (bucket_id = 'twin-avatars');
