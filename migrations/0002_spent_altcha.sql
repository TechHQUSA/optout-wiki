-- migrations/0002_spent_altcha.sql
-- Tracks consumed ALTCHA challenge signatures so a solved proof-of-work
-- payload can be used at most once (single-use), closing the replay window
-- that existed while a challenge's `expires` TTL was still valid. Rows are
-- swept once they're older than the challenge TTL — past that point the
-- signature's own expiry check in verifySolution() already rejects it, so
-- the nonce row can never be legitimately needed again (see
-- functions/_shared/altcha.js).
CREATE TABLE spent_altcha_signatures (
  signature TEXT PRIMARY KEY,
  spent_at  INTEGER NOT NULL
);
