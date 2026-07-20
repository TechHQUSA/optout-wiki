// src/lib/staleness.ts
// Stage-5 re-verification policy, in one place: a published guide is DUE
// for re-verification 90 days after lastVerified (public badge + admin
// due-section + stale-guides.json), and the test suite hard-fails at 180
// days so a stale guide can't quietly stay published for two quarters.
// "Now" is always passed in (build time / test time) — staleness on a
// static site is computed at build, which is the documented trade-off:
// the clock only advances when the site is rebuilt.

export const STALE_AFTER_DAYS = 90;
export const HARD_CEILING_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days between `date` and `now` (floor; negative clamps to 0). */
export function daysSince(date: Date, now: number): number {
  return Math.max(0, Math.floor((now - date.getTime()) / DAY_MS));
}

export function isStale(lastVerified: Date, now: number): boolean {
  return daysSince(lastVerified, now) > STALE_AFTER_DAYS;
}
