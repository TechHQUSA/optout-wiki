// tests/url.test.ts
import { expect, test } from 'vitest';
import { httpUrl } from '../src/lib/url';

test('accepts http and https URLs', () => {
  expect(httpUrl.safeParse('http://example.com/a').success).toBe(true);
  expect(httpUrl.safeParse('https://example.com/b').success).toBe(true);
});

test('rejects javascript: and data: URLs', () => {
  expect(httpUrl.safeParse('javascript:alert(1)').success).toBe(false);
  expect(httpUrl.safeParse('data:text/html,<script>').success).toBe(false);
});

test('rejects mailto: and non-URL strings', () => {
  expect(httpUrl.safeParse('mailto:a@b.com').success).toBe(false);
  expect(httpUrl.safeParse('not a url').success).toBe(false);
  expect(httpUrl.safeParse('').success).toBe(false);
});
