import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUDIT_MARKER, dockerArgs, parseAudit, sandboxInstall } from '../src/checks/install.mjs';

const OPTIONS = { image: 'node:24-alpine', registry: 'https://npm.example.com/' };

test('sandbox runs as non-root with resource limits and the configured registry', () => {
  const args = dockerArgs(OPTIONS);
  assert.deepEqual(args.slice(0, 4), ['run', '--rm', '-i', '--user']);
  assert.ok(args.includes('--memory') && args.includes('--pids-limit'));
  assert.ok(args.includes('npm_config_registry=https://npm.example.com/'));
  assert.ok(!args.includes('-v'), 'source must be streamed, not bind-mounted');
});

test('audit counts are parsed; malformed output yields null', () => {
  const text = JSON.stringify({ metadata: { vulnerabilities: { low: 1, moderate: 2, high: 0, critical: 3, total: 6 } } });
  assert.deepEqual(parseAudit(text), { low: 1, moderate: 2, high: 0, critical: 3 });
  assert.equal(parseAudit('npm ERR! offline'), null);
  assert.equal(parseAudit('{}'), null);
});

const run = async () => Buffer.from('tar');

test('install success requires exit 0 and the audit marker', async () => {
  const audit = JSON.stringify({ metadata: { vulnerabilities: { low: 0, moderate: 0, high: 1, critical: 0 } } });
  const exec = async () => ({ code: 0, stdout: `added 1 package\n${AUDIT_MARKER}\n${audit}`, stderr: '' });
  assert.deepEqual(await sandboxInstall('/x', OPTIONS, { run, exec }), { ok: true, audit: { low: 0, moderate: 0, high: 1, critical: 0 }, log: '' });
});

test('install failure keeps the tail of the log', async () => {
  const exec = async () => ({ code: 1, stdout: '', stderr: 'npm error 404 Not Found - nope' });
  const result = await sandboxInstall('/x', OPTIONS, { run, exec });
  assert.equal(result.ok, false);
  assert.match(result.log, /404 Not Found/);
});
