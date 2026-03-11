CREATE TABLE IF NOT EXISTS public.ai_track_thread_state_v1 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID NOT NULL,
  conversation_id TEXT NOT NULL,
  scope_token TEXT NOT NULL,
  scope_epoch INTEGER NOT NULL DEFAULT 1,
  state_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_track_thread_state_v1_user_conversation_idx
  ON public.ai_track_thread_state_v1 (user_id, conversation_id);

CREATE INDEX IF NOT EXISTS ai_track_thread_state_v1_scope_idx
  ON public.ai_track_thread_state_v1 (scope_token, scope_epoch);

ALTER TABLE public.ai_track_thread_state_v1 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "thread_state_owner_select" ON public.ai_track_thread_state_v1;
CREATE POLICY "thread_state_owner_select"
ON public.ai_track_thread_state_v1
FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "thread_state_owner_upsert" ON public.ai_track_thread_state_v1;
CREATE POLICY "thread_state_owner_upsert"
ON public.ai_track_thread_state_v1
FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "thread_state_owner_update" ON public.ai_track_thread_state_v1;
CREATE POLICY "thread_state_owner_update"
ON public.ai_track_thread_state_v1
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE ON public.ai_track_thread_state_v1 TO authenticated;
