-- Public access request intake for invite workflow.

CREATE TABLE IF NOT EXISTS public.access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  company_name TEXT,
  message TEXT,
  source TEXT NOT NULL DEFAULT 'auth_page',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'approved', 'declined')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_access_requests_created_at
  ON public.access_requests (created_at DESC);

ALTER TABLE public.access_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins can read access requests" ON public.access_requests;
CREATE POLICY "Platform admins can read access requests"
ON public.access_requests FOR SELECT
TO authenticated
USING (public.is_platform_admin(auth.uid()));
