import { expect, test } from 'vitest';
import { safeJsonLd } from '../src/lib/json-ld';

test('escapes every "<" so a </script>-breakout string cannot close the tag', () => {
  const out = safeJsonLd({ name: 'Evil</script><script>alert(1)</script>' });
  expect(out).not.toContain('</script>');
  expect(out).not.toContain('<');
  // Only "<" is escaped (matching what browsers/JSON parsers need) — ">"
  // is left as-is, so the surviving text reads "</script>".
  expect(out).toContain('\\u003c/script>');
});

test('round-trips to the same value once un-escaped by a real JSON parser', () => {
  const data = { name: 'Title with <html> and </script> inside' };
  const out = safeJsonLd(data);
  // A browser's JSON.parse (or Node's) treats < identically to a literal
  // "<" — this proves the escape is content-preserving, not lossy.
  expect(JSON.parse(out)).toEqual(data);
});

test('leaves JSON-LD with no "<" unchanged apart from stringification', () => {
  const data = { '@type': 'WebSite', name: 'OptOut.wiki' };
  expect(safeJsonLd(data)).toBe(JSON.stringify(data));
});
