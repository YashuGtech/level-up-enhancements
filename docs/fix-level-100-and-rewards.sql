-- ─── Run ONCE in the Supabase SQL editor ─────────────────────────────
-- Fixes two issues:
--   1. Players blocked from playing Level 100 (or stuck above 100).
--   2. Ensures every successful level win pays exactly 200 GTC.
--
-- Safe to re-run. Does NOT touch wallets or completed transactions.

-- ── 1. Settings: lock the prize at 200 GTC + cap at 100 levels ───────
-- The app reads these keys from public.settings (key/value JSONB).
INSERT INTO public.settings (key, value) VALUES
  ('level_cap',              to_jsonb(100)),
  ('level_win_prize_gtc',    to_jsonb(200)),
  ('level_skip_prize_gtc',   to_jsonb(200)),
  ('game_enabled',           to_jsonb(true))
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- ── 2. Allow current_level to reach 101 (the "all done" sentinel) ────
-- Some installs have a CHECK constraint capping current_level at 100,
-- which prevents the client from showing the congratulations screen.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.users'::regclass
       AND contype  = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%current_level%<=%100%'
  LOOP
    EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

-- ── 3. Unstick players who somehow landed above 101 ──────────────────
UPDATE public.users
   SET current_level = 101
 WHERE current_level > 101;

-- ── 4. Unstick anyone whose current_level was nulled / zeroed ────────
UPDATE public.users
   SET current_level = 1
 WHERE current_level IS NULL OR current_level < 1;

-- ── 5. (Optional sanity) — distribution of player progress ───────────
-- SELECT current_level, count(*) FROM public.users
--  GROUP BY current_level ORDER BY current_level;
