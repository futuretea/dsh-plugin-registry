import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generate } from '../src/generate.mjs';
import { loadConfig, gitAuthEnv } from '../src/config.mjs';
import { validateIndex } from '../src/index-format.mjs';
import { makeGitRepo, pluginManifest, tempDir } from './helpers.mjs';

const BASE = 'https://gitlab.example.com';
const clean = { low: 0, moderate: 0, high: 0, critical: 0 };

async function setup() {
  const hello = await makeGitRepo({ 'README.md': '# hi', 'package.json': pluginManifest({ description: 'Hello </script><img src=x onerror=alert(1)>' }) });
  const untagged = await makeGitRepo({ 'README.md': '# no', 'package.json': pluginManifest({ name: 'untagged' }) });
  const external = await makeGitRepo({ 'README.md': '# ext', 'package.json': pluginManifest({ name: 'dsh-ext', keywords: ['search'] }) });
  const unlisted = await makeGitRepo({ 'README.md': '# x', 'package.json': pluginManifest({ name: 'dsh-unlisted' }) });
  const projects = [
    { id: 1, path_with_namespace: 'tools/dsh-hello', namespace: { full_path: 'tools' }, web_url: `${BASE}/tools/dsh-hello`, http_url_to_repo: hello.url, default_branch: 'main', topics: ['dsh-plugin'] },
    { id: 2, path_with_namespace: 'tools/untagged', namespace: { full_path: 'tools' }, web_url: `${BASE}/tools/untagged`, http_url_to_repo: untagged.url, default_branch: 'main', topics: [] },
  ];
  const fetchImpl = async (href) => {
    const url = new URL(href);
    if (url.pathname === '/api/v4/projects') return Response.json(projects);
    if (url.pathname === '/api/v4/projects/1/repository/branches/main') return Response.json({ commit: { id: hello.commit } });
    return new Response('nope', { status: 404 });
  };
  const dir = await tempDir();
  const allowlistPath = join(dir, 'allowlist.json');
  await writeFile(allowlistPath, JSON.stringify({ plugins: [{ repository: 'https://github.com/ext/dsh-ext', author: 'ext', approvedBy: 'alice', descriptionZh: '外部搜索', source: { type: 'git', url: external.url, commit: external.commit } }] }));
  return { fetchImpl, allowlistPath, outDir: join(dir, 'public'), unlisted };
}

test('generate writes a valid index, report and escaped browse page', async () => {
  const { fetchImpl, allowlistPath, outDir, unlisted } = await setup();
  const config = { ...loadConfig({ GITLAB_URL: BASE, GITLAB_TOKEN: 't' }), allowlistPath };
  const logs = [];
  const steps = { sandboxInstall: async () => ({ ok: true, audit: clean, log: '' }) };
  await generate(config, { outDir, fetchImpl, steps, log: (l) => logs.push(l), now: new Date('2026-11-10T00:00:00Z') });

  const index = JSON.parse(await readFile(join(outDir, 'index.json'), 'utf8'));
  assert.deepEqual(validateIndex(index), []);
  assert.deepEqual(index.plugins.map((p) => [p.name, p.metadata.category]), [['dsh-ext', 'external'], ['dsh-hello', 'internal']]);
  assert.equal(index.plugins[0].description.zh, '外部搜索');
  assert.ok(!JSON.stringify(index).includes(unlisted.url), 'unlisted external plugin must not appear');
  assert.ok(!JSON.stringify(index).includes('untagged'), 'untagged repository must not appear');

  const report = JSON.parse(await readFile(join(outDir, 'report.json'), 'utf8'));
  assert.equal(report.plugins.length, 2);
  assert.ok(report.plugins.every((p) => p.included));

  const html = await readFile(join(outDir, 'index.html'), 'utf8');
  const data = html.match(/<script type="application\/json" id="market-data">([\s\S]*?)<\/script>/)[1];
  assert.ok(!data.includes('</script>'), 'embedded data must not close the script tag');
  assert.equal(JSON.parse(data).index.plugins.length, 2);
  assert.ok(logs.some((l) => l.includes('1 internal, 1 external')));
});

test('allowlist can be read from a GitLab project instead of a local file', async () => {
  const { allowlistPath, outDir } = await setup();
  const raw = await readFile(allowlistPath, 'utf8');
  const seen = [];
  const fetchImpl = async (href, { headers }) => {
    const url = new URL(href);
    seen.push({ path: url.pathname, ref: url.searchParams.get('ref'), token: headers['PRIVATE-TOKEN'] });
    if (url.pathname === '/api/v4/projects/platform%2Fdsh-plugin-registry/repository/files/allowlist.json/raw') return new Response(raw);
    if (url.pathname === '/api/v4/projects') return Response.json([]);
    return new Response('nope', { status: 404 });
  };
  const config = loadConfig({ GITLAB_URL: BASE, GITLAB_TOKEN: 't', ALLOWLIST_GITLAB_PROJECT: 'platform/dsh-plugin-registry', ALLOWLIST_REF: 'main' });
  const steps = { sandboxInstall: async () => ({ ok: true, audit: clean, log: '' }) };
  const { index } = await generate(config, { outDir, fetchImpl, steps, log: () => {} });
  assert.deepEqual(index.plugins.map((p) => p.name), ['dsh-ext']);
  assert.deepEqual(seen[0], { path: '/api/v4/projects/platform%2Fdsh-plugin-registry/repository/files/allowlist.json/raw', ref: 'main', token: 't' });

  const missing = loadConfig({ GITLAB_URL: BASE, ALLOWLIST_GITLAB_PROJECT: 'platform/other' });
  await assert.rejects(generate(missing, { outDir, fetchImpl, log: () => {} }), /could not read allowlist platform\/other\/allowlist.json from GitLab \(HTTP 404\)/);
});

test('generate refuses an invalid allowlist instead of publishing', async () => {
  const { fetchImpl, allowlistPath, outDir } = await setup();
  await writeFile(allowlistPath, JSON.stringify({ plugins: [{ repository: 'r', author: 'a', source: { type: 'npm', package: 'x', version: 'latest' } }] }));
  const config = { ...loadConfig({}), allowlistPath };
  await assert.rejects(generate(config, { outDir, fetchImpl, log: () => {} }), /allowlist is invalid[\s\S]*approvedBy[\s\S]*exact version/);
});

test('git auth header is scoped to the GitLab origin only', () => {
  const env = gitAuthEnv('https://gitlab.example.com/some/path', 'secret-token');
  assert.equal(env.GIT_CONFIG_KEY_0, 'http.https://gitlab.example.com/.extraHeader');
  assert.equal(env.GIT_CONFIG_VALUE_0, `Authorization: Basic ${Buffer.from('oauth2:secret-token').toString('base64')}`);
  assert.deepEqual(gitAuthEnv('', 'x'), {});
  assert.throws(() => loadConfig({ INDEX_MAX_RISK: 'none' }), /INDEX_MAX_RISK/);
});
