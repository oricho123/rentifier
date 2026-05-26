/**
 * Push FB_COOKIES_N from .env to GitHub Actions (requires gh CLI, authenticated).
 *
 * Usage:
 *   pnpm secrets:fb-cookies          # FB_COOKIES_1
 *   pnpm secrets:fb-cookies -- 2     # FB_COOKIES_2
 */
import { spawnSync } from 'node:child_process';

const account = process.argv[2] ?? '1';
if (!/^\d+$/.test(account)) {
  console.error('Usage: pnpm secrets:fb-cookies [-- <account-number>]');
  process.exit(1);
}

const name = `FB_COOKIES_${account}`;
const value = process.env[name];
if (!value?.trim()) {
  console.error(`Missing ${name} in environment. Set it in .env and run with --env-file (see package.json script).`);
  process.exit(1);
}

const r = spawnSync('gh', ['secret', 'set', name], {
  input: value,
  encoding: 'utf-8',
  stdio: ['pipe', 'inherit', 'inherit'],
});

if (r.error) {
  console.error(r.error.message);
  process.exit(1);
}
if (r.status !== 0) {
  process.exit(r.status ?? 1);
}

console.log(`GitHub Actions secret ${name} updated.`);
