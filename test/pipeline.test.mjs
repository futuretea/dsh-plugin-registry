import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyRisk, dependencyRisk, isRiskAllowed } from '../src/risk.mjs';
import { verifyAll } from '../src/pipeline.mjs';
import { makeGitRepo, pluginManifest, tempDir } from './helpers.mjs';

const clean = { low: 0, moderate: 0, high: 0, critical: 0 };
const secret = [{ rule: 'aws-access-token', file: 'a.js', line: 1 }];

test('dependency risk follows the worst audit finding', () => {
  assert.equal(dependencyRisk(null), 'unknown');
  assert.equal(dependencyRisk(clean), 'low');
  assert.equal(dependencyRisk({ ...clean, low: 4 }), 'low');
  assert.equal(dependencyRisk({ ...clean, moderate: 1 }), 'medium');
  assert.equal(dependencyRisk({ ...clean, high: 1, moderate: 3 }), 'high');
  assert.equal(dependencyRisk({ ...clean, critical: 1 }), 'critical');
});

test('secrets raise risk to at least high', () => {
  assert.equal(classifyRisk({ audit: clean, secrets: secret }), 'high');
  assert.equal(classifyRisk({ audit: null, secrets: secret }), 'high');
  assert.equal(classifyRisk({ audit: { ...clean, critical: 1 }, secrets: secret }), 'critical');
  assert.equal(classifyRisk({ audit: clean, secrets: [] }), 'low');
});

test('unknown risk is never allowed', () => {
  assert.equal(isRiskAllowed('medium', 'medium'), true);
  assert.equal(isRiskAllowed('high', 'medium'), false);
  assert.equal(isRiskAllowed('unknown', 'critical'), false);
});

const fakeAwsKey = () => ['AKIA', 'QWERTYUIOPASDFGH'].join('');

async function candidateFor(files) {
  const repo = await makeGitRepo({ 'README.md': '# p', ...files });
  return { origin: 'internal', author: 'tools', repositoryUrl: repo.url, source: { type: 'git', ...repo } };
}

test('pipeline verifies, labels and filters candidates end to end', async () => {
  const candidates = [
    await candidateFor({ 'package.json': pluginManifest({ name: 'good' }) }),
    await candidateFor({ 'package.json': pluginManifest({ name: 'leaky' }), 'src/config.js': `export const key = "${fakeAwsKey()}";\n` }),
    await candidateFor({ 'package.json': pluginManifest({ name: 'broken-install' }) }),
    await candidateFor({ 'package.json': pluginManifest({ name: 'vulnerable' }) }),
    await candidateFor({ 'package.json': pluginManifest({ name: 'no-engine', engines: {} }) }),
    await candidateFor({ 'package.json': pluginManifest({ name: 'good' }) }),
    { origin: 'internal', author: 'x', repositoryUrl: 'u', source: { type: 'git', url: 'u', commit: null }, discoveryError: 'repository is empty (no default branch)' },
  ];
  const audits = { vulnerable: { ...clean, high: 2 } };
  const sandboxInstall = async (dir) => {
    const { name } = JSON.parse(await readFile(`${dir}/package.json`, 'utf8'));
    return name === 'broken-install' ? { ok: false, audit: null, log: 'E404' } : { ok: true, audit: audits[name] ?? clean, log: '' };
  };
  const results = await verifyAll(candidates, await tempDir(), { maxRisk: 'medium' }, { sandboxInstall });
  const view = results.map((r) => [r.manifest?.name ?? null, r.level, r.included, r.labels.join(',')]);
  assert.deepEqual(view, [
    ['good', 4, true, 'source-internal,install-verified,risk-low'],
    ['leaky', 4, false, 'source-internal,install-verified,risk-high'],
    ['broken-install', 3, false, 'source-internal,install-failed'],
    ['vulnerable', 4, false, 'source-internal,install-verified,risk-high'],
    ['no-engine', 2, false, 'source-internal'],
    ['good', 4, false, 'source-internal,install-verified,risk-low'],
    [null, 0, false, 'source-internal'],
  ]);
  assert.deepEqual(results[1].secrets, [{ rule: 'aws-access-token', file: 'src/config.js', line: 1 }]);
  assert.ok(!JSON.stringify(results).includes(fakeAwsKey()), 'secret values must not be kept');
  assert.match(results[5].reasons.at(-1), /already used/);
  assert.match(results[6].reasons[0], /empty/);
  assert.match(results[2].reasons[0], /L4/);
});
