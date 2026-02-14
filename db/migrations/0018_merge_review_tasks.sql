CREATE TABLE merge_review_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'applied', 'failed')),
  proposal_type text NOT NULL CHECK (proposal_type IN ('ticket', 'customer')),
  ticket_id uuid REFERENCES tickets(id),
  source_ticket_id uuid REFERENCES tickets(id),
  target_ticket_id uuid REFERENCES tickets(id),
  source_customer_id uuid REFERENCES customers(id),
  target_customer_id uuid REFERENCES customers(id),
  reason text,
  confidence double precision CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  metadata jsonb,
  failure_reason text,
  proposed_by_agent_id uuid REFERENCES agent_integrations(id),
  proposed_by_user_id uuid REFERENCES users(id),
  reviewed_by_user_id uuid REFERENCES users(id),
  reviewed_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
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
  )
);

CREATE INDEX idx_merge_review_tasks_status_created_at
  ON merge_review_tasks(status, created_at DESC);

CREATE INDEX idx_merge_review_tasks_ticket_id
  ON merge_review_tasks(ticket_id);

CREATE INDEX idx_merge_review_tasks_source_ticket_id
  ON merge_review_tasks(source_ticket_id);

CREATE INDEX idx_merge_review_tasks_target_ticket_id
  ON merge_review_tasks(target_ticket_id);

CREATE INDEX idx_merge_review_tasks_source_customer_id
  ON merge_review_tasks(source_customer_id);

CREATE INDEX idx_merge_review_tasks_target_customer_id
  ON merge_review_tasks(target_customer_id);
