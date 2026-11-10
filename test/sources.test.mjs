import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverInternal } from '../src/gitlab.mjs';
import { parseAllowlist } from '../src/allowlist.mjs';

const BASE = 'https://gitlab.example.com';
const SHA = (c) => c.repeat(40);

const PROJECTS = [
  { id: 1, path_with_namespace: 'tools/dsh-hello', namespace: { full_path: 'tools' }, web_url: `${BASE}/tools/dsh-hello`, http_url_to_repo: `${BASE}/tools/dsh-hello.git`, default_branch: 'main', topics: ['dsh-plugin'] },
  { id: 2, path_with_namespace: 'tools/not-a-plugin', namespace: { full_path: 'tools' }, web_url: `${BASE}/tools/not-a-plugin`, http_url_to_repo: `${BASE}/tools/not-a-plugin.git`, default_branch: 'main', topics: ['other'] },
  { id: 3, path_with_namespace: 'ai/dsh-memory', namespace: { full_path: 'ai' }, web_url: `${BASE}/ai/dsh-memory`, http_url_to_repo: `${BASE}/ai/dsh-memory.git`, default_branch: 'master', topics: ['dsh-plugin', 'memory'] },
  { id: 4, path_with_namespace: 'ai/dsh-empty', namespace: { full_path: 'ai' }, web_url: `${BASE}/ai/dsh-empty`, http_url_to_repo: `${BASE}/ai/dsh-empty.git`, default_branch: null, topics: ['dsh-plugin'] },
];
const HEADS = { 1: SHA('1'), 3: SHA('3') };

function fakeGitLab() {
  const calls = [];
  const fetchImpl = async (href, { headers }) => {
    calls.push({ href, headers });
    const url = new URL(href);
    const json = (body, extra = {}) => new Response(JSON.stringify(body), { status: 200, headers: extra });
    if (url.pathname === '/api/v4/projects') {
      const matching = PROJECTS.filter((p) => p.topics.includes(url.searchParams.get('topic')) || p.id === 2);
      const page = Number(url.searchParams.get('page'));
      const slice = matching.slice((page - 1) * 2, page * 2);
      return json(slice, { 'x-next-page': page * 2 < matching.length ? String(page + 1) : '' });
    }
    const m = url.pathname.match(/^\/api\/v4\/projects\/(\d+)\/repository\/branches\/(.+)$/);
    if (m && HEADS[m[1]]) return json({ name: decodeURIComponent(m[2]), commit: { id: HEADS[m[1]] } });
    return new Response('not found', { status: 404 });
  };
  return { fetchImpl, calls };
}

test('internal discovery keeps only dsh-plugin topic projects, across pages', async () => {
  const { fetchImpl, calls } = fakeGitLab();
  const found = await discoverInternal({ baseUrl: BASE, token: 'test-token', fetchImpl });
  assert.deepEqual(found.map((c) => c.repositoryUrl), [`${BASE}/tools/dsh-hello`, `${BASE}/ai/dsh-memory`, `${BASE}/ai/dsh-empty`]);
  assert.deepEqual(found[0], {
    origin: 'internal',
    author: 'tools',
    repositoryUrl: `${BASE}/tools/dsh-hello`,
    source: { type: 'git', url: `${BASE}/tools/dsh-hello.git`, commit: SHA('1') },
  });
  assert.equal(found[1].source.commit, SHA('3'));
  assert.match(found[2].discoveryError, /empty/);
  assert.ok(calls.every((c) => c.headers['PRIVATE-TOKEN'] === 'test-token'));
  assert.ok(calls.some((c) => c.href.includes('page=2')));
});

test('internal discovery surfaces API failures', async () => {
  const fetchImpl = async () => new Response('denied', { status: 401 });
  await assert.rejects(discoverInternal({ baseUrl: BASE, token: 'bad', fetchImpl }), /GitLab API 401/);
  const down = async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }); };
  await assert.rejects(discoverInternal({ baseUrl: BASE, fetchImpl: down }), /GitLab request https:\/\/gitlab.example.com\/api\/v4\/projects failed: ECONNREFUSED/);
});

const VALID = {
  plugins: [
    { repository: 'https://github.com/a/dsh-a', author: 'a', approvedBy: 'alice', source: { type: 'npm', package: '@a/dsh-a', version: '1.2.3' }, descriptionZh: '甲' },
    { repository: 'https://github.com/b/dsh-b', author: 'b', approvedBy: 'bob', source: { type: 'git', url: 'https://github.com/b/dsh-b.git', commit: SHA('b') } },
  ],
};

test('allowlist entries become external candidates', () => {
  const { errors, candidates } = parseAllowlist(VALID);
  assert.deepEqual(errors, []);
  assert.deepEqual(candidates.map((c) => [c.origin, c.source.type, c.approvedBy]), [['external', 'npm', 'alice'], ['external', 'git', 'bob']]);
  assert.equal(candidates[0].descriptionZh, '甲');
});

test('allowlist rejects unpinned, unapproved or duplicate entries', () => {
  const bad = structuredClone(VALID);
  bad.plugins[0].source.version = '^1.2.3';
  bad.plugins[1].source.commit = 'main';
  bad.plugins.push({ ...structuredClone(VALID.plugins[0]), approvedBy: '' });
  const { errors, candidates } = parseAllowlist(bad);
  assert.equal(candidates.length, 0);
  assert.ok(errors.some((e) => e.includes('exact version')));
  assert.ok(errors.some((e) => e.includes('40-char commit')));
  assert.ok(errors.some((e) => e.includes('approvedBy')));
  assert.ok(errors.some((e) => e.includes('duplicates')));
  assert.deepEqual(parseAllowlist({}).errors, ['allowlist must have a "plugins" array']);
});
