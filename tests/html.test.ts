import { expect, test } from 'vitest';
import { escapeHtml } from '../functions/_shared/html.js';

test('escapes the five HTML-significant characters', () => {
  expect(escapeHtml(`<script>alert("x")&'`)).toBe('&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;');
});

test('neutralizes a </textarea> breakout and coerces non-strings', () => {
  expect(escapeHtml('</textarea>')).toBe('&lt;/textarea&gt;');
  expect(escapeHtml(42)).toBe('42');
  expect(escapeHtml(null)).toBe('null');
});
