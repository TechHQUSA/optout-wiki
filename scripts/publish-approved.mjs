// scripts/publish-approved.mjs
//
// Batch publisher for approved moderation submissions. Approving a submission
// in /admin marks the D1 row `approved`; this script turns approved rows into
// committed guide markdown, which the static build publishes. Git stays the
// source of truth (no publishing credential lives on the edge — by design).
//
// Flow:
//   1. Pull `approved` rows from D1 (read-only).
//   2. Materialize a guide .md for any that lacks a file (with `[ADD …]`
//      placeholders for the summary + source labels, which aren't submitted).
//   3. Classify every approved guide file as ready (no placeholders) or blocked
//      (placeholders still present — a human must fill them).
//   4. Dry-run by default: print the plan. With `--deploy`: git-commit the
//      ready files, build, and deploy. Blocked guides are never published.
//
// Usage:
//   npm run publish-approved            # dry run — show what would publish
//   npm run publish-approved -- --deploy # commit ready guides + build + deploy
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateGuideMarkdown } from '../functions/_shared/guide-markdown.js';
import { hasUnfilledPlaceholders, parseApprovedRows } from './publish-lib.mjs';

const PROJECT = 'optout-wiki';
const GUIDES_DIR = 'src/content/guides';
const DEPLOY = process.argv.includes('--deploy');

const sh = (cmd) => execSync(cmd, { encoding: 'utf8' });
const today = new Date().toISOString().slice(0, 10);

function queryApproved() {
  const out = sh(
    `wrangler d1 execute ${PROJECT} --remote --json --command ` +
      `"SELECT id,title,category,level,body,sources FROM submissions WHERE status='approved'"`,
  );
  return parseApprovedRows(out);
}

function gitHasChange(file) {
  return sh(`git status --porcelain -- "${file}"`).trim() !== '';
}

const rows = queryApproved();
if (rows.length === 0) {
  console.log('No approved submissions in the queue. Nothing to publish.');
  process.exit(0);
}

const created = [];
const blocked = [];
const ready = []; // { file } — no placeholders, safe to publish

for (const row of rows) {
  const { filename, markdown } = generateGuideMarkdown(row, today);
  const file = join(GUIDES_DIR, filename);
  if (!existsSync(file)) {
    writeFileSync(file, markdown);
    created.push(file);
  }
  const content = readFileSync(file, 'utf8');
  if (hasUnfilledPlaceholders(content)) blocked.push(file);
  else if (gitHasChange(file)) ready.push(file);
}

console.log(`\nApproved submissions: ${rows.length}`);
if (created.length) console.log(`\nCreated (fill the [ADD …] placeholders, then re-run):\n  ${created.join('\n  ')}`);
const stillBlocked = blocked.filter((f) => !created.includes(f));
if (stillBlocked.length) console.log(`\nBlocked — still has placeholders:\n  ${stillBlocked.join('\n  ')}`);
if (ready.length) console.log(`\nReady to publish:\n  ${ready.join('\n  ')}`);
if (!ready.length) {
  console.log('\nNothing ready to publish yet.');
  process.exit(0);
}

if (!DEPLOY) {
  console.log(`\n(dry run) Re-run with --deploy to commit these ${ready.length} guide(s), build, and deploy.`);
  process.exit(0);
}

console.log(`\nPublishing ${ready.length} guide(s)…`);
sh(`git add ${ready.map((f) => `"${f}"`).join(' ')}`);
sh(`git commit -m "content: publish ${ready.length} approved guide(s)"`);
console.log('Building…');
sh('npm run build');
console.log('Deploying…');
const deployOut = sh(`wrangler pages deploy dist --project-name ${PROJECT} --branch main --commit-dirty=true`);
console.log(deployOut.split('\n').filter((l) => l.includes('Deployment complete')).join('\n') || deployOut);
console.log('\nDone.');
