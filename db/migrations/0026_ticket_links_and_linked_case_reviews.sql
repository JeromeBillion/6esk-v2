CREATE TABLE ticket_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_type text NOT NULL CHECK (relationship_type IN ('linked_case')),
  source_ticket_id uuid NOT NULL REFERENCES tickets(id),
  target_ticket_id uuid NOT NULL REFERENCES tickets(id),
  source_channel text NOT NULL CHECK (source_channel IN ('email', 'whatsapp', 'voice')),
  target_channel text NOT NULL CHECK (target_channel IN ('email', 'whatsapp', 'voice')),
  source_customer_id uuid REFERENCES customers(id),
  target_customer_id uuid REFERENCES customers(id),
  reason text,
  actor_user_id uuid REFERENCES users(id),
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_ticket_id <> target_ticket_id)
);

CREATE UNIQUE INDEX idx_ticket_links_pair_relationship
  ON ticket_links (
    LEAST(source_ticket_id, target_ticket_id),
    GREATEST(source_ticket_id, target_ticket_id),
    relationship_type
  );

CREATE INDEX idx_ticket_links_source_ticket
  ON ticket_links(source_ticket_id, created_at DESC);

CREATE INDEX idx_ticket_links_target_ticket
  ON ticket_links(target_ticket_id, created_at DESC);

ALTER TABLE merge_review_tasks
  DROP CONSTRAINT IF EXISTS merge_review_tasks_proposal_type_check;

ALTER TABLE merge_review_tasks
  DROP CONSTRAINT IF EXISTS merge_review_tasks_check;

ALTER TABLE merge_review_tasks
  ADD CONSTRAINT merge_review_tasks_proposal_type_check
  CHECK (proposal_type IN ('ticket', 'customer', 'linked_case'));

ALTER TABLE merge_review_tasks
  ADD CONSTRAINT merge_review_tasks_check
  CHECK (
    (
      proposal_type = 'ticket'
      AND source_ticket_id IS NOT NULL
      AND target_ticket_id IS NOT NULL
      AND source_customer_id IS NULL
      AND target_customer_id IS NULL
    )
    OR (
      proposal_type = 'customer'
      AND source_customer_id IS NOT NULL
      AND target_customer_id IS NOT NULL
      AND source_ticket_id IS NULL
      AND target_ticket_id IS NULL
    )
    OR (
      proposal_type = 'linked_case'
      AND source_ticket_id IS NOT NULL
      AND target_ticket_id IS NOT NULL
    )
  );
