-- 6esk v2: durable internal backoffice workflow state.
--
-- 6esk Work is the business operating surface for running the SaaS. These
-- records are internal, but every workflow still belongs to a tenant boundary
-- so support, finance, security, and implementation work cannot become
-- tenantless operational memory.

CREATE TABLE IF NOT EXISTS tenant_backoffice_profiles (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  account_owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  implementation_stage text NOT NULL DEFAULT 'not_started'
    CHECK (implementation_stage IN (
      'not_started',
      'discovery',
      'implementation',
      'uat',
      'launched',
      'blocked',
      'closed'
    )),
  risk_tier text NOT NULL DEFAULT 'standard'
    CHECK (risk_tier IN ('low', 'standard', 'elevated', 'critical')),
  security_status text NOT NULL DEFAULT 'unknown'
    CHECK (security_status IN ('unknown', 'pending', 'ready', 'watch', 'blocked')),
  renewal_date date,
  internal_notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_backoffice_profiles_stage
  ON tenant_backoffice_profiles(implementation_stage, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_backoffice_profiles_risk
  ON tenant_backoffice_profiles(risk_tier, security_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS backoffice_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  case_type text NOT NULL
    CHECK (case_type IN (
      'onboarding',
      'implementation',
      'contract',
      'renewal',
      'incident',
      'security_questionnaire',
      'legal_artifact',
      'data_request',
      'provider_rotation',
      'deliverability',
      'partner_services'
    )),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN (
      'open',
      'in_progress',
      'waiting_on_customer',
      'waiting_on_6esk',
      'resolved',
      'closed',
      'canceled'
    )),
  priority text NOT NULL DEFAULT 'p2'
    CHECK (priority IN ('p0', 'p1', 'p2', 'p3')),
  title text NOT NULL,
  summary text,
  owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  due_at timestamptz,
  external_reference text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  UNIQUE (tenant_id, id),
  CHECK (length(trim(title)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_backoffice_cases_tenant_status
  ON backoffice_cases(tenant_id, status, priority, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_backoffice_cases_type_status
  ON backoffice_cases(case_type, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_backoffice_cases_owner
  ON backoffice_cases(owner_user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS backoffice_case_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  case_id uuid NOT NULL,
  event_type text NOT NULL
    CHECK (event_type IN (
      'created',
      'status_changed',
      'priority_changed',
      'assigned',
      'note_added',
      'artifact_linked',
      'approval_recorded',
      'closed',
      'reopened'
    )),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  from_status text,
  to_status text,
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, case_id)
    REFERENCES backoffice_cases(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_backoffice_case_events_tenant_case
  ON backoffice_case_events(tenant_id, case_id, created_at DESC);

CREATE TABLE IF NOT EXISTS backoffice_case_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  case_id uuid NOT NULL,
  link_type text NOT NULL
    CHECK (link_type IN (
      'contract',
      'dpa',
      'subprocessor',
      'security_evidence',
      'provider_dashboard',
      'r2_object',
      'external_document',
      'incident_evidence',
      'other'
    )),
  label text NOT NULL,
  url text,
  r2_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, case_id)
    REFERENCES backoffice_cases(tenant_id, id) ON DELETE CASCADE,
  CHECK (length(trim(label)) > 0),
  CHECK (url IS NOT NULL OR r2_key IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_backoffice_case_links_tenant_case
  ON backoffice_case_links(tenant_id, case_id, created_at DESC);
