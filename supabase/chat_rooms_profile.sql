-- 대화방 테이블
CREATE TABLE IF NOT EXISTS chat_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  title text NOT NULL DEFAULT '새 대화',
  summary text,
  last_message_at timestamptz DEFAULT now(),
  message_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE chat_rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chat_rooms: 본인만"
  ON chat_rooms FOR ALL USING (auth.uid() = user_id);

-- 메시지 테이블
CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid REFERENCES chat_rooms(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  is_summarized boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chat_messages: 본인만"
  ON chat_messages FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_room
  ON chat_messages(room_id, created_at DESC);

-- user_profiles 테이블
CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL UNIQUE,
  interests jsonb DEFAULT '[]',
  personality jsonb DEFAULT '[]',
  recurring_themes jsonb DEFAULT '[]',
  values jsonb DEFAULT '[]',
  behavior_patterns jsonb DEFAULT '[]',
  goals jsonb DEFAULT '[]',
  recent_changes jsonb DEFAULT '[]',
  raw_notes text,
  last_analyzed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_profiles: 본인만"
  ON user_profiles FOR ALL USING (auth.uid() = user_id);

-- profile_history: 프로필 변경 이력
CREATE TABLE IF NOT EXISTS profile_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  field_name text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  source text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE profile_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profile_history: 본인만"
  ON profile_history FOR ALL USING (auth.uid() = user_id);
