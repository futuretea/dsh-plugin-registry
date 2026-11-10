import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { fetchSource } from '../src/fetch-source.mjs';
import { checkMetadata } from '../src/checks/metadata.mjs';
import { makeGitRepo, pluginManifest, tempDir } from './helpers.mjs';

const gitCandidate = (repo) => ({ origin: 'internal', source: { type: 'git', url: repo.url, commit: repo.commit } });

async function checkRepo(files) {
  const repo = await makeGitRepo(files);
  const dir = join(await tempDir(), 'src');
  const fetched = await fetchSource(gitCandidate(repo), dir);
  return { fetched, meta: await checkMetadata(gitCandidate(repo), dir) };
}

test('git source is fetched at the pinned commit and passes L1-L3', async () => {
  const { fetched, meta } = await checkRepo({ 'README.md': '# hello', 'package.json': pluginManifest() });
  assert.equal(fetched.publishTimestamp, Date.parse('2026-11-01T00:00:00Z') / 1000);
  assert.deepEqual(meta, { level: 3, manifest: pluginManifest(), error: null });
});

test('each metadata level reports the first failing check', async () => {
  const cases = [
    [{}, 0, /empty/],
    [{ 'package.json': pluginManifest() }, 0, /README/],
    [{ 'README.md': 'x', 'package.json': '{oops' }, 1, /not valid JSON/],
    [{ 'README.md': 'x', 'package.json': pluginManifest({ description: '' }) }, 1, /missing description/],
    [{ 'README.md': 'x', 'package.json': pluginManifest({ engines: {} }) }, 2, /engines\.dsh/],
  ];
  for (const [files, level, error] of cases) {
    const { meta } = await checkRepo(files);
    assert.equal(meta.level, level, String(error));
    assert.match(meta.error, error);
  }
});

test('npm source must match the approved package name and version', async () => {
  const dir = await tempDir();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'README.md'), 'x');
  await writeFile(join(dir, 'package.json'), JSON.stringify(pluginManifest({ version: '1.0.1' })));
  const candidate = { source: { type: 'npm', package: 'dsh-hello', version: '1.0.0' } };
  const meta = await checkMetadata(candidate, dir);
  assert.equal(meta.level, 2);
  assert.match(meta.error, /version "1.0.1" does not match "1.0.0"/);
});

test('npm fetch packs the exact approved version', async () => {
  const calls = [];
  const run = async (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    if (args[0] === 'pack') return JSON.stringify([{ filename: 'dsh-hello-1.0.0.tgz' }]);
    if (args[0] === 'view') return JSON.stringify({ '1.0.0': '2026-10-01T00:00:00.000Z' });
    return '';
  };
  const dir = join(await tempDir(), 'src');
  const fetched = await fetchSource({ source: { type: 'npm', package: 'dsh-hello', version: '1.0.0' } }, dir, { run });
  assert.equal(fetched.publishTimestamp, Date.parse('2026-10-01T00:00:00Z') / 1000);
  assert.ok(calls[0].startsWith('npm pack dsh-hello@1.0.0 --json'));
  assert.ok(calls.some((c) => c.startsWith('tar -xzf') && c.includes('dsh-hello-1.0.0.tgz')));
});
