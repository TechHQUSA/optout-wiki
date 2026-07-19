-- migrations/0004_software_submissions.sql
-- Software/service recommendation submissions share the submissions table
-- with guides, discriminated by `type`. Guide rows keep type='guide' and
-- NULL in the software-only columns. For type='software' the column reuse
-- is: title=tool name, body=justification (moderator-only, never published),
-- sources=evidence URLs (audits, license page — vetting material), level=NULL.
-- url/summary/tags are the published software fields (matching the shape of
-- src/content/software/software.json entries; `tags` is a JSON string array).
ALTER TABLE submissions ADD COLUMN type TEXT NOT NULL DEFAULT 'guide';
ALTER TABLE submissions ADD COLUMN url TEXT;
ALTER TABLE submissions ADD COLUMN tags TEXT;
ALTER TABLE submissions ADD COLUMN summary TEXT;
CREATE INDEX idx_submissions_type ON submissions(type);
