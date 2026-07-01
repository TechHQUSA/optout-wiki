// src/lib/format.ts
// Shared formatting helpers used across pages/components so presentation
// (e.g. date rendering) stays consistent and build-host-independent.

/**
 * Formats a Date as "Mon D, YYYY" (e.g. "Jul 1, 2026") using UTC so the
 * result is stable regardless of the build/render host's local timezone.
 * Content dates like `lastVerified` are `z.coerce.date()` values that land
 * on UTC midnight — formatting them in local time can shift the displayed
 * calendar day by one on hosts with a negative UTC offset.
 */
export function formatVerified(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}
