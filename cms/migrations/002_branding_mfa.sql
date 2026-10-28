-- Per-organization branding and two-step sign-in (TOTP).
ALTER TABLE organizations ADD COLUMN brand_color TEXT NOT NULL DEFAULT '#0f6b66';
ALTER TABLE organizations ADD COLUMN pill_buttons INTEGER NOT NULL DEFAULT 0;
ALTER TABLE organizations ADD COLUMN logo_key TEXT;
ALTER TABLE organizations ADD COLUMN logo_mime TEXT;
ALTER TABLE organizations ADD COLUMN require_mfa INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users ADD COLUMN mfa_secret TEXT;
ALTER TABLE users ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN mfa_last_step INTEGER NOT NULL DEFAULT 0;

CREATE TABLE mfa_recovery_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at INTEGER
);
CREATE INDEX idx_mfa_recovery_user ON mfa_recovery_codes(user_id);
