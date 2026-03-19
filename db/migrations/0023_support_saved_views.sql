CREATE TABLE IF NOT EXISTS support_saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_support_saved_views_user_name
  ON support_saved_views(user_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_support_saved_views_user_updated
  ON support_saved_views(user_id, updated_at DESC);
