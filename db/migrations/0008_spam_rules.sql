CREATE TYPE spam_rule_type AS ENUM ('allow', 'block');
CREATE TYPE spam_rule_scope AS ENUM ('sender', 'domain', 'subject', 'body');

ALTER TABLE messages
  ADD COLUMN is_spam boolean NOT NULL DEFAULT false,
  ADD COLUMN spam_reason text;

CREATE TABLE spam_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_type spam_rule_type NOT NULL,
  scope spam_rule_scope NOT NULL,
  pattern text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_spam_rules_active ON spam_rules(is_active);
