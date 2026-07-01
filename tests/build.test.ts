// tests/build.test.ts
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { expect, test } from 'vitest';

test('astro build produces dist/index.html', () => {
  execSync('npm run build', { stdio: 'inherit' });
  expect(existsSync('dist/index.html')).toBe(true);
});
