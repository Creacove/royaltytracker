-- Smart Ingestion: Column Mappings Table
-- Stores learnable rules for mapping raw CSV/PDF headers to internal canonical fields.

CREATE TABLE IF NOT EXISTS public.column_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE, -- Null for system-wide defaults
  raw_header TEXT NOT NULL,
  canonical_field TEXT NOT NULL,
  confidence NUMERIC(5,2) NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT true,
  scope TEXT NOT NULL DEFAULT 'system' CHECK (scope IN ('system', 'user')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Prevent duplicate mappings for the same scope
  CONSTRAINT uq_column_mapping UNIQUE (user_id, raw_header)
);

-- Enable RLS
ALTER TABLE public.column_mappings ENABLE ROW LEVEL SECURITY;

-- Policies
-- 1. System mappings are visible to everyone
CREATE POLICY "System mappings are viewable by everyone" 
  ON public.column_mappings FOR SELECT 
  USING (scope = 'system');

-- 2. Users can view their own mappings
CREATE POLICY "Users can view own mappings" 
  ON public.column_mappings FOR SELECT 
  USING (auth.uid() = user_id);

-- 3. Users can create/edit their own mappings
CREATE POLICY "Users can insert own mappings" 
  ON public.column_mappings FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own mappings" 
  ON public.column_mappings FOR UPDATE 
  USING (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX idx_column_mappings_lookup ON public.column_mappings (raw_header);
CREATE INDEX idx_column_mappings_user ON public.column_mappings (user_id);

-- Seed Data: Initial Smart Mappings (European Languages)
INSERT INTO public.column_mappings (raw_header, canonical_field, scope, confidence) VALUES
  -- English (Synonyms)
  ('track title', 'track_title', 'system', 100),
  ('song title', 'track_title', 'system', 95),
  ('work title', 'track_title', 'system', 95),
  ('artist name', 'track_artist', 'system', 100),
  ('performer', 'track_artist', 'system', 90),
  ('usage count', 'usage_count', 'system', 100),
  ('stream count', 'usage_count', 'system', 100),
  ('quantity', 'usage_count', 'system', 100),
  ('gross revenue', 'gross_revenue', 'system', 100),
  ('total revenue', 'gross_revenue', 'system', 100),
  ('net revenue', 'net_revenue', 'system', 100),
  ('payable', 'net_revenue', 'system', 90),
  ('publisher share', 'publisher_share', 'system', 100),
  ('our share', 'publisher_share', 'system', 85),
  ('territory', 'territory', 'system', 100),
  ('country', 'territory', 'system', 100),
  
  -- French
  ('titre', 'track_title', 'system', 100),
  ('oeuvre', 'track_title', 'system', 90),
  ('artiste', 'track_artist', 'system', 100),
  ('interprete', 'track_artist', 'system', 90),
  ('montant', 'net_revenue', 'system', 80), -- Ambiguous, but usually net in statements
  ('montant net', 'net_revenue', 'system', 100),
  ('montant brut', 'gross_revenue', 'system', 100),
  ('pays', 'territory', 'system', 100),
  ('territoire', 'territory', 'system', 100),
  ('quantite', 'usage_count', 'system', 100),
  
  -- Spanish
  ('titulo', 'track_title', 'system', 100),
  ('artista', 'track_artist', 'system', 100),
  ('pais', 'territory', 'system', 100),
  ('territorio', 'territory', 'system', 100),
  ('cantidad', 'usage_count', 'system', 100),
  ('importe', 'net_revenue', 'system', 80),
  ('importe neto', 'net_revenue', 'system', 100),
  
  -- German
  ('titel', 'track_title', 'system', 100),
  ('werktitel', 'track_title', 'system', 100),
  ('kunstler', 'track_artist', 'system', 100),
  ('interpret', 'track_artist', 'system', 100),
  ('land', 'territory', 'system', 100),
  ('gebiet', 'territory', 'system', 90),
  ('anzahl', 'usage_count', 'system', 100),
  ('betrag', 'net_revenue', 'system', 80),
  ('nettobetrag', 'net_revenue', 'system', 100)
ON CONFLICT (user_id, raw_header) DO NOTHING;
