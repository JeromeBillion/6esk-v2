CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_solved_at ON tickets(solved_at);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
