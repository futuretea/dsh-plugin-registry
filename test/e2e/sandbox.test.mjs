import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fetchSource } from '../../src/fetch-source.mjs';
import { sandboxInstall } from '../../src/checks/install.mjs';
import { makeGitRepo, pluginManifest, tempDir } from '../helpers.mjs';

const OPTIONS = { image: process.env.SANDBOX_IMAGE ?? 'node:24-alpine', registry: process.env.NPM_REGISTRY };

async function installRepo(manifest) {
  const repo = await makeGitRepo({ 'README.md': '# e2e', 'package.json': manifest, 'index.js': 'module.exports = {};\n' });
  const dir = join(await tempDir(), 'src');
  await fetchSource({ source: { type: 'git', ...repo } }, dir);
  return sandboxInstall(dir, OPTIONS);
}

test('a valid plugin installs in the docker sandbox', { timeout: 300_000 }, async () => {
  const result = await installRepo(pluginManifest());
  assert.equal(result.ok, true, result.log);
  assert.deepEqual(result.audit, { low: 0, moderate: 0, high: 0, critical: 0 });
});

test('a plugin with an unresolvable dependency fails to install', { timeout: 300_000 }, async () => {
  const result = await installRepo(pluginManifest({ dependencies: { 'dsh-registry-e2e-no-such-package-0d1f': '1.0.0' } }));
  assert.equal(result.ok, false);
  assert.match(result.log, /404|not found|E404/i);
});

test('a plugin depending on a known-vulnerable package gets audit findings', { timeout: 300_000 }, async () => {
  const result = await installRepo(pluginManifest({ dependencies: { lodash: '4.17.15' } }));
  assert.equal(result.ok, true, result.log);
  assert.ok(result.audit.high + result.audit.critical > 0, JSON.stringify(result.audit));
});
