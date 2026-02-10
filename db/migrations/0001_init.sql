CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE mailbox_type AS ENUM ('platform', 'personal');
CREATE TYPE mailbox_access AS ENUM ('owner', 'member', 'viewer');
CREATE TYPE message_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE ticket_status AS ENUM ('new', 'open', 'pending', 'solved', 'closed');
CREATE TYPE ticket_priority AS ENUM ('low', 'normal', 'high', 'urgent');
CREATE TYPE csat_rating AS ENUM ('satisfied', 'unsatisfied');

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  role_id uuid REFERENCES roles(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mailboxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type mailbox_type NOT NULL,
  address text NOT NULL UNIQUE,
  owner_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mailbox_memberships (
  mailbox_id uuid REFERENCES mailboxes(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  access_level mailbox_access NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mailbox_id, user_id)
);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox_id uuid REFERENCES mailboxes(id) ON DELETE CASCADE,
  direction message_direction NOT NULL,
  message_id text,
  thread_id text,
  in_reply_to text,
  reference_ids text[],
  from_email text NOT NULL,
  to_emails text[] NOT NULL DEFAULT '{}',
  cc_emails text[] NOT NULL DEFAULT '{}',
  bcc_emails text[] NOT NULL DEFAULT '{}',
  subject text,
  preview_text text,
  r2_key_raw text,
  r2_key_html text,
  r2_key_text text,
  size_bytes integer,
  received_at timestamptz,
  sent_at timestamptz,
  is_read boolean NOT NULL DEFAULT false,
  is_starred boolean NOT NULL DEFAULT false,
  is_pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid REFERENCES messages(id) ON DELETE CASCADE,
  filename text NOT NULL,
  content_type text,
  size_bytes integer,
  r2_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox_id uuid REFERENCES mailboxes(id),
  requester_email text NOT NULL,
  subject text,
  status ticket_status NOT NULL DEFAULT 'new',
  priority ticket_priority NOT NULL DEFAULT 'normal',
  assigned_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  solved_at timestamptz,
  closed_at timestamptz
);

CREATE TABLE ticket_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES tickets(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_user_id uuid REFERENCES users(id),
  data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES tickets(id) ON DELETE CASCADE,
  message_id uuid REFERENCES messages(id),
  author_user_id uuid REFERENCES users(id),
  body_text text,
  body_html text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sla_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_response_target_minutes integer NOT NULL,
  resolution_target_minutes integer NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE csat_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES tickets(id) ON DELETE CASCADE,
  rating csat_rating NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mailbox_memberships_user_id ON mailbox_memberships(user_id);
CREATE INDEX idx_messages_mailbox_id ON messages(mailbox_id);
CREATE INDEX idx_messages_thread_id ON messages(thread_id);
CREATE INDEX idx_messages_message_id ON messages(message_id);
CREATE INDEX idx_messages_received_at ON messages(received_at);
CREATE INDEX idx_messages_sent_at ON messages(sent_at);
CREATE INDEX idx_attachments_message_id ON attachments(message_id);
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_assigned_user_id ON tickets(assigned_user_id);
CREATE INDEX idx_ticket_events_ticket_id ON ticket_events(ticket_id);
CREATE INDEX idx_replies_ticket_id ON replies(ticket_id);
