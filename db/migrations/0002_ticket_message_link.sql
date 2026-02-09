ALTER TABLE messages
  ADD COLUMN ticket_id uuid REFERENCES tickets(id);

CREATE INDEX idx_messages_ticket_id ON messages(ticket_id);
