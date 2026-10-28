-- Complaint Management System: initial schema.
-- Conventions: ids are random UUID text; every timestamp is INTEGER milliseconds since the Unix epoch (UTC);
-- every tenant table carries org_id and all queries filter by it.

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  work_days TEXT NOT NULL DEFAULT '[1,2,3,4,5]',
  work_start TEXT NOT NULL DEFAULT '09:00',
  work_end TEXT NOT NULL DEFAULT '17:00',
  allow_anonymous INTEGER NOT NULL DEFAULT 1,
  ai_enabled INTEGER NOT NULL DEFAULT 1,
  assignment_strategy TEXT NOT NULL DEFAULT 'workload' CHECK (assignment_strategy IN ('manual','round_robin','workload','rules')),
  at_risk_pct INTEGER NOT NULL DEFAULT 75,
  critical_unassigned_minutes INTEGER NOT NULL DEFAULT 60,
  reopen_threshold INTEGER NOT NULL DEFAULT 2,
  retention_days INTEGER NOT NULL DEFAULT 2555,
  ref_prefix TEXT NOT NULL DEFAULT 'CMP',
  created_at INTEGER NOT NULL
);

CREATE TABLE holidays (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  date TEXT NOT NULL,          -- YYYY-MM-DD in the organization's calendar
  name TEXT NOT NULL,
  UNIQUE (org_id, date)
);

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (org_id, key)
);

CREATE TABLE role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE departments (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  manager_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE (org_id, name)
);

CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (org_id, name)
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role_id TEXT NOT NULL REFERENCES roles(id),
  department_id TEXT REFERENCES departments(id),
  location TEXT,
  skills TEXT NOT NULL DEFAULT '[]',      -- JSON array of category ids
  available INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  last_assigned_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_users_org ON users(org_id, role_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                    -- sha256 of the cookie token
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active_org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES categories(id),
  department_id TEXT REFERENCES departments(id),
  sensitive INTEGER NOT NULL DEFAULT 0,
  default_priority TEXT NOT NULL DEFAULT 'Medium' CHECK (default_priority IN ('Low','Medium','High','Critical')),
  ack_minutes INTEGER NOT NULL DEFAULT 240,
  first_response_minutes INTEGER NOT NULL DEFAULT 480,
  resolution_minutes INTEGER NOT NULL DEFAULT 4800,
  keywords TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (org_id, name)
);

CREATE TABLE counters (
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, name)
);

CREATE TABLE complaints (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ref TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category_id TEXT REFERENCES categories(id),
  department_id TEXT REFERENCES departments(id),
  location_id TEXT REFERENCES locations(id),
  incident_at INTEGER,
  channel TEXT NOT NULL DEFAULT 'web' CHECK (channel IN ('web','email','phone','walk_in','social','other')),
  priority TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low','Medium','High','Critical')),
  status TEXT NOT NULL DEFAULT 'Submitted',
  sensitive INTEGER NOT NULL DEFAULT 0,
  related_ref TEXT,
  complainant_user_id TEXT REFERENCES users(id),
  complainant_name TEXT,
  complainant_email TEXT,
  complainant_phone TEXT,
  contact_method TEXT NOT NULL DEFAULT 'email' CHECK (contact_method IN ('email','sms','none')),
  is_anonymous INTEGER NOT NULL DEFAULT 0,
  consent_at INTEGER,
  access_code_hash TEXT NOT NULL,
  assignee_id TEXT REFERENCES users(id),
  resolution_summary TEXT,
  reopen_count INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,       -- optimistic concurrency
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  acknowledged_at INTEGER,
  first_response_at INTEGER,
  resolved_at INTEGER,
  closed_at INTEGER,
  ack_due_at INTEGER,
  first_response_due_at INTEGER,
  resolution_due_at INTEGER,
  sla_total_minutes INTEGER NOT NULL DEFAULT 0,
  sla_paused_at INTEGER,
  sla_paused_remaining_minutes INTEGER,
  UNIQUE (org_id, ref)
);
CREATE INDEX idx_complaints_org_status ON complaints(org_id, status);
CREATE INDEX idx_complaints_assignee ON complaints(org_id, assignee_id, status);
CREATE INDEX idx_complaints_created ON complaints(org_id, created_at);
CREATE INDEX idx_complaints_due ON complaints(org_id, resolution_due_at);
CREATE INDEX idx_complaints_dept ON complaints(org_id, department_id);
CREATE INDEX idx_complaints_category ON complaints(org_id, category_id);

-- Timeline: comments, internal notes, messages, status changes, SLA and escalation events.
-- Append-only (enforced by triggers below).
CREATE TABLE complaint_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  complaint_id TEXT NOT NULL REFERENCES complaints(id),
  type TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user','complainant','system')),
  actor_id TEXT,
  actor_name TEXT,
  visibility TEXT NOT NULL CHECK (visibility IN ('public','internal')),
  body TEXT,
  data TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_events_complaint ON complaint_events(complaint_id, created_at);

CREATE TABLE assignments (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  complaint_id TEXT NOT NULL REFERENCES complaints(id),
  from_user_id TEXT,
  to_user_id TEXT,
  by_user_id TEXT,
  strategy TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_assignments_complaint ON assignments(complaint_id);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  complaint_id TEXT NOT NULL REFERENCES complaints(id),
  uploader_kind TEXT NOT NULL CHECK (uploader_kind IN ('user','complainant')),
  uploader_id TEXT,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  visibility TEXT NOT NULL CHECK (visibility IN ('public','internal')),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_attachments_complaint ON attachments(complaint_id);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  complaint_id TEXT NOT NULL REFERENCES complaints(id),
  title TEXT NOT NULL,
  owner_id TEXT REFERENCES users(id),
  due_at INTEGER,
  done_at INTEGER,
  created_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_tasks_owner ON tasks(owner_id, done_at);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  complaint_id TEXT NOT NULL REFERENCES complaints(id),
  proposed_resolution TEXT NOT NULL,
  requested_by TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by TEXT REFERENCES users(id),
  decision_comment TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE INDEX idx_approvals_pending ON approvals(org_id, status);

CREATE TABLE workflow_transitions (
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  permission TEXT,
  requires_comment INTEGER NOT NULL DEFAULT 0,
  requires_evidence INTEGER NOT NULL DEFAULT 0,
  requires_approval INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (org_id, from_status, to_status)
);

CREATE TABLE escalations (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  complaint_id TEXT NOT NULL REFERENCES complaints(id),
  rule_key TEXT NOT NULL,
  level INTEGER NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  acknowledged_by TEXT REFERENCES users(id),
  acknowledged_at INTEGER,
  UNIQUE (complaint_id, rule_key, level)    -- makes the worker idempotent
);
CREATE INDEX idx_escalations_open ON escalations(org_id, acknowledged_at);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  dedupe_key TEXT,
  read_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_notifications_dedupe ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX idx_notifications_user ON notifications(user_id, read_at, created_at);

CREATE TABLE message_templates (
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (org_id, key)
);

-- External messages waiting to be sent, with retry state. Doubles as the communication history.
CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  complaint_id TEXT REFERENCES complaints(id),
  channel TEXT NOT NULL CHECK (channel IN ('email','sms')),
  to_addr TEXT NOT NULL,
  template TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  provider TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  next_attempt_at INTEGER NOT NULL,
  sent_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_outbox_due ON outbox(status, next_attempt_at);

CREATE TABLE audit_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT,
  actor_id TEXT,
  actor_label TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  data TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE INDEX idx_audit_org ON audit_events(org_id, seq);

CREATE TABLE surveys (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  complaint_id TEXT NOT NULL UNIQUE REFERENCES complaints(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE kb_articles (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  published INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE saved_views (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE saved_reports (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  config TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE ai_recommendations (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  complaint_id TEXT NOT NULL REFERENCES complaints(id),
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  rationale TEXT,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  decided_by TEXT REFERENCES users(id),
  decided_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_ai_complaint ON ai_recommendations(complaint_id);

CREATE TABLE rate_limits (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);

-- History is never edited or deleted.
CREATE TRIGGER complaint_events_no_update BEFORE UPDATE ON complaint_events BEGIN SELECT RAISE(ABORT, 'complaint_events is append-only'); END;
CREATE TRIGGER complaint_events_no_delete BEFORE DELETE ON complaint_events BEGIN SELECT RAISE(ABORT, 'complaint_events is append-only'); END;
CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
CREATE TRIGGER assignments_no_update BEFORE UPDATE ON assignments BEGIN SELECT RAISE(ABORT, 'assignments is append-only'); END;
CREATE TRIGGER assignments_no_delete BEFORE DELETE ON assignments BEGIN SELECT RAISE(ABORT, 'assignments is append-only'); END;
