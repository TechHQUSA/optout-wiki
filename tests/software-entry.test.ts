// tests/software-entry.test.ts
// generateSoftwareEntry: submission row -> commit-ready software.json entry.
import { expect, test } from 'vitest';
import { generateSoftwareEntry } from '../functions/_shared/software-entry.js';

const base = {
  title: 'Mullvad VPN',
  category: 'Network',
  url: 'https://mullvad.net',
  summary: 'Anonymous, no-account VPN.',
  tags: '["vpn","no-logs"]',
};

test('produces id slug from name and a parseable pretty JSON entry', () => {
  const { id, json } = generateSoftwareEntry(base);
  expect(id).toBe('mullvad-vpn');
  const entry = JSON.parse(json);
  expect(entry).toEqual({
    id: 'mullvad-vpn',
    name: 'Mullvad VPN',
    category: 'Network',
    url: 'https://mullvad.net',
    summary: 'Anonymous, no-account VPN.',
    tags: ['vpn', 'no-logs'],
  });
  // pretty-printed (2-space) for pasting into software.json
  expect(json).toContain('\n  "id"');
});

test('tags: missing, malformed JSON, non-array JSON, and non-string entries degrade cleanly', () => {
  expect(JSON.parse(generateSoftwareEntry({ ...base, tags: undefined }).json).tags).toEqual([]);
  expect(JSON.parse(generateSoftwareEntry({ ...base, tags: 'not-json' }).json).tags).toEqual([]);
  expect(JSON.parse(generateSoftwareEntry({ ...base, tags: '{"a":1}' }).json).tags).toEqual([]);
  expect(JSON.parse(generateSoftwareEntry({ ...base, tags: '["ok",7,null,"x"]' }).json).tags).toEqual(['ok', 'x']);
  // already-parsed array accepted too (defensive: caller may pre-parse)
  expect(JSON.parse(generateSoftwareEntry({ ...base, tags: ['a', 'b'] }).json).tags).toEqual(['a', 'b']);
});

test('weird characters in fields survive via JSON escaping, no injection into the snippet', () => {
  const { json } = generateSoftwareEntry({
    ...base,
    title: 'Tool "X" <script>',
    summary: 'line1\nline2 \\ "quoted"',
  });
  const entry = JSON.parse(json);
  expect(entry.name).toBe('Tool "X" <script>');
  expect(entry.summary).toBe('line1\nline2 \\ "quoted"');
});

test('empty/degenerate name still yields a non-empty id (slugify fallback)', () => {
  const { id } = generateSoftwareEntry({ ...base, title: '!!!' });
  expect(id).toBe('guide'); // slugify's documented fallback
});
