ALTER TABLE tickets
ADD COLUMN IF NOT EXISTS ticket_number bigint;

WITH numbered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS seq
  FROM tickets
  WHERE ticket_number IS NULL
),
base AS (
  SELECT COALESCE(MAX(ticket_number), 1000) AS max_ticket_number
  FROM tickets
)
UPDATE tickets t
SET ticket_number = base.max_ticket_number + numbered.seq
FROM numbered, base
WHERE t.id = numbered.id;

CREATE SEQUENCE IF NOT EXISTS tickets_ticket_number_seq;

SELECT setval(
  'tickets_ticket_number_seq',
  COALESCE((SELECT MAX(ticket_number) FROM tickets), 1000),
  true
);

ALTER TABLE tickets
ALTER COLUMN ticket_number SET DEFAULT nextval('tickets_ticket_number_seq');

ALTER TABLE tickets
ALTER COLUMN ticket_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_ticket_number ON tickets(ticket_number);
