-- ユーザープロファイル（Supabase Auth に追加情報）
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Twin（AIキャラクター）
CREATE TABLE twins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  persona_prompt TEXT NOT NULL,
  style_params JSONB DEFAULT '{}',
  is_public BOOLEAN DEFAULT false,
  is_npc BOOLEAN DEFAULT false,
  npc_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ゲーム（対局）
CREATE TABLE games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID REFERENCES auth.users(id),
  mode TEXT NOT NULL,
  status TEXT DEFAULT 'queued',
  rule_set JSONB DEFAULT '{}',
  player_twin_ids UUID[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

-- 局（Hand）
CREATE TABLE hands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID REFERENCES games(id) ON DELETE CASCADE,
  hand_no INTEGER NOT NULL,
  round TEXT NOT NULL,
  honba INTEGER DEFAULT 0,
  kyotaku INTEGER DEFAULT 0,
  dealer_seat INTEGER NOT NULL,
  result_json JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- アクション（1手ごと）
CREATE TABLE actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID REFERENCES games(id) ON DELETE CASCADE,
  hand_id UUID REFERENCES hands(id) ON DELETE CASCADE,
  seq_no INTEGER NOT NULL,
  actor_seat INTEGER NOT NULL,
  action_type TEXT NOT NULL,
  payload_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 思考ログ
CREATE TABLE reasoning_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id UUID REFERENCES actions(id) ON DELETE CASCADE,
  summary_text TEXT NOT NULL,
  detail_text TEXT,
  structured_json JSONB DEFAULT '{}',
  tokens_used INTEGER,
  model_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- オンライン対戦の席状態
CREATE TABLE game_seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID REFERENCES games(id) ON DELETE CASCADE,
  seat INTEGER NOT NULL,
  twin_id UUID REFERENCES twins(id),
  user_id UUID REFERENCES auth.users(id),
  seat_status TEXT DEFAULT 'connected',
  disconnected_at TIMESTAMPTZ,
  last_heartbeat TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス
CREATE INDEX idx_twins_user_id ON twins(user_id);
CREATE INDEX idx_twins_is_public ON twins(is_public) WHERE is_public = true;
CREATE INDEX idx_twins_is_npc ON twins(is_npc) WHERE is_npc = true;
CREATE INDEX idx_games_created_by ON games(created_by);
CREATE INDEX idx_games_status ON games(status);
CREATE INDEX idx_hands_game_id ON hands(game_id);
CREATE INDEX idx_actions_game_id ON actions(game_id);
CREATE INDEX idx_actions_hand_id ON actions(hand_id);
CREATE INDEX idx_reasoning_logs_action_id ON reasoning_logs(action_id);
CREATE INDEX idx_game_seats_game_id ON game_seats(game_id);

-- RLS（Row Level Security）有効化
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE twins ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE hands ENABLE ROW LEVEL SECURITY;
ALTER TABLE actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reasoning_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_seats ENABLE ROW LEVEL SECURITY;

-- Profiles RLS
CREATE POLICY "Public profiles are viewable by everyone" ON profiles
  FOR SELECT USING (true);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Twins RLS
CREATE POLICY "Public twins are viewable by everyone" ON twins
  FOR SELECT USING (is_public = true OR is_npc = true OR auth.uid() = user_id);

CREATE POLICY "Users can create own twins" ON twins
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own twins" ON twins
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own twins" ON twins
  FOR DELETE USING (auth.uid() = user_id);

-- Games RLS
CREATE POLICY "Games are viewable by participants" ON games
  FOR SELECT USING (true);

CREATE POLICY "Users can create games" ON games
  FOR INSERT WITH CHECK (auth.uid() = created_by);

-- Hands RLS
CREATE POLICY "Hands are viewable" ON hands
  FOR SELECT USING (true);

-- Actions RLS
CREATE POLICY "Actions are viewable" ON actions
  FOR SELECT USING (true);

-- Reasoning Logs RLS
CREATE POLICY "Reasoning logs are viewable" ON reasoning_logs
  FOR SELECT USING (true);

-- Game Seats RLS
CREATE POLICY "Game seats are viewable" ON game_seats
  FOR SELECT USING (true);

-- Service Role用のポリシー（Workerから書き込み用）
CREATE POLICY "Service role can do anything on games" ON games
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role can do anything on hands" ON hands
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role can do anything on actions" ON actions
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role can do anything on reasoning_logs" ON reasoning_logs
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role can do anything on game_seats" ON game_seats
  FOR ALL USING (true) WITH CHECK (true);
