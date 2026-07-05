-- migrations/0003_moderation_audit.sql
-- Adds a lightweight audit trail for moderation decisions: who approved or
-- rejected a submission, and when. Populated only on approve/reject — a
-- deleted row has nothing to audit (matches the site's minimal-data
-- philosophy: don't retain more than the feature needs).
ALTER TABLE submissions ADD COLUMN moderated_by TEXT;
ALTER TABLE submissions ADD COLUMN moderated_at INTEGER;
