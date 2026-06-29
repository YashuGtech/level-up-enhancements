-- ──────────────────────────────────────────────────────────────────────
-- FIX LEVEL 100 + EVERY WIN PAYS 200 GTC
-- Run ONCE in Supabase SQL editor.  Safe to re-run.  Does NOT touch
-- wallets, deposits, or completed transactions.
-- Build tag:  v2026.06.29-lvl100-fix
-- ──────────────────────────────────────────────────────────────────────

-- ── 1. Lock settings: cap 100, every level win pays exactly 200 GTC ──
INSERT INTO public.settings (key, value) VALUES
  ('level_cap',            to_jsonb(100)),
  ('level_win_prize_gtc',  to_jsonb(200)),
  ('level_skip_prize_gtc', to_jsonb(200)),
  ('game_enabled',         to_jsonb(true)),
  ('build_tag',            to_jsonb('v2026.06.29-lvl100-fix'))
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- ── 2. Strip CHECK constraints that block level 100 / 101 ────────────
--    Any historical "current_level <= 100" or "level_index <= 99" check
--    silently blocks players from reaching/playing level 100.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conrelid::regclass::text AS tbl, conname
      FROM pg_constraint
     WHERE conrelid IN ('public.users'::regclass, 'public.game_sessions'::regclass)
       AND contype = 'c'
       AND (
            pg_get_constraintdef(oid) ILIKE '%current_level%<=%100%'
         OR pg_get_constraintdef(oid) ILIKE '%level_index%<%100%'
         OR pg_get_constraintdef(oid) ILIKE '%level_index%<=%99%'
       )
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname);
  END LOOP;
END $$;

-- ── 3. Unstick players (>101 → 101, null/0 → 1) ──────────────────────
UPDATE public.users SET current_level = 101 WHERE current_level > 101;
UPDATE public.users SET current_level = 1   WHERE current_level IS NULL OR current_level < 1;

-- ── 4. Make sure level 100 EXISTS and is ENABLED ─────────────────────
--    The "Could not start game" error on Lv 100 happens when no row in
--    public.levels matches level_index=100 (or it's disabled).  This
--    copies the highest enabled level into slot 100 if missing, so
--    players can actually play it.
DO $$
DECLARE
  has_index_col BOOLEAN;
  src_id UUID;
  new_id UUID;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='levels' AND column_name='level_index'
  ) INTO has_index_col;

  -- Add level_index column if the table doesn't have it yet
  IF NOT has_index_col THEN
    ALTER TABLE public.levels ADD COLUMN level_index INTEGER;
    CREATE UNIQUE INDEX IF NOT EXISTS levels_level_index_key
      ON public.levels(level_index) WHERE level_index IS NOT NULL;
  END IF;

  -- If level 100 is missing, clone the highest enabled level into slot 100
  IF NOT EXISTS (SELECT 1 FROM public.levels WHERE level_index = 100 AND enabled = TRUE) THEN
    SELECT id INTO src_id
      FROM public.levels
     WHERE enabled = TRUE AND level_index IS NOT NULL
     ORDER BY level_index DESC NULLS LAST
     LIMIT 1;

    IF src_id IS NOT NULL THEN
      INSERT INTO public.levels (
        name, duration_seconds, gravity, jump_strength, scroll_speed,
        pipe_gap, enabled, weight, repeat_loop, reward_per_coin, bg_color,
        level_index
      )
      SELECT 'Level 100 — Final', duration_seconds, gravity, jump_strength,
             scroll_speed, pipe_gap, TRUE, weight, TRUE, reward_per_coin,
             bg_color, 100
        FROM public.levels WHERE id = src_id
      RETURNING id INTO new_id;

      -- Copy obstacles too
      INSERT INTO public.level_objects (level_id, obj_type, x_time, y, props)
      SELECT new_id, obj_type, x_time, y, props
        FROM public.level_objects WHERE level_id = src_id;
    END IF;
  ELSE
    -- Ensure it's enabled
    UPDATE public.levels SET enabled = TRUE WHERE level_index = 100;
  END IF;
END $$;

-- ── 5. Sanity check — should return 1 row with enabled=true ──────────
-- SELECT level_index, name, enabled FROM public.levels WHERE level_index = 100;
-- SELECT key, value FROM public.settings
--  WHERE key IN ('level_cap','level_win_prize_gtc','build_tag');
