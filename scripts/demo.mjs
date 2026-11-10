// Generates a demo market from throwaway local plugin repos using the real
// sandbox (docker) and secret scanner (gitleaks). Usage: node scripts/demo.mjs [outDir]
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from '../src/fetch-source.mjs';
import { loadConfig } from '../src/config.mjs';
import { generate } from '../src/generate.mjs';

const BASE = 'https://gitlab.demo.internal';
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 'demo', GIT_AUTHOR_EMAIL: 'demo@example.com', GIT_COMMITTER_NAME: 'demo', GIT_COMMITTER_EMAIL: 'demo@example.com' };

async function repo(name, manifest, extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), `dsh-demo-${name}-`));
  const files = { 'README.md': `# ${name}\n`, 'index.js': 'module.exports = {};\n', 'package.json': JSON.stringify({ name, version: '1.0.0', engines: { dsh: '^0.2.0' }, ...manifest }, null, 2), ...extra };
  for (const [file, content] of Object.entries(files)) {
    await mkdir(join(dir, file, '..'), { recursive: true });
    await writeFile(join(dir, file), content);
  }
  await runCommand('git', ['init', '--quiet', dir]);
  await runCommand('git', ['-C', dir, 'add', '-A'], { env: GIT_ENV });
  await runCommand('git', ['-C', dir, 'commit', '--quiet', '-m', 'init'], { env: GIT_ENV });
  return { url: `file://${dir}`, commit: (await runCommand('git', ['-C', dir, 'rev-parse', 'HEAD'])).trim() };
}

const internalSpecs = [
  ['dsh-oa-worklog', 'tools', { description: 'Sync OA work logs into a DSH sidebar with a weekly Gantt view.', keywords: ['oa', 'productivity'] }],
  ['dsh-gitlab-review', 'devops', { description: 'Review GitLab merge requests from a DSH session.', keywords: ['gitlab', 'code-review'] }],
  ['dsh-legacy-report', 'finance', { description: 'Legacy report exporter.', dependencies: { lodash: '4.17.15' } }],
  ['dsh-leaky-bot', 'ops', { description: 'Bot with a hard-coded key.' }, { 'config.js': `module.exports = { key: "${['AKIA', 'QWERTYUIOPASDFGH'].join('')}" };\n` }],
  ['dsh-broken', 'ops', { description: 'Depends on a package that does not exist.', dependencies: { 'dsh-demo-no-such-package-7c1e': '1.0.0' } }],
];

const projects = [];
const heads = {};
for (const [i, [name, group, manifest, extra]] of internalSpecs.entries()) {
  const r = await repo(name, manifest, extra);
  projects.push({ id: i + 1, path_with_namespace: `${group}/${name}`, namespace: { full_path: group }, web_url: `${BASE}/${group}/${name}`, http_url_to_repo: r.url, default_branch: 'main', topics: ['dsh-plugin'] });
  heads[i + 1] = r.commit;
}
const fetchImpl = async (href) => {
  const m = new URL(href).pathname.match(/^\/api\/v4\/projects(?:\/(\d+)\/repository\/branches\/main)?$/);
  if (!m) return new Response('not found', { status: 404 });
  return m[1] ? Response.json({ commit: { id: heads[m[1]] } }) : Response.json(projects);
};

const ext = await repo('dsh-web-search', { description: 'Web search with cited, structured JSON evidence.', keywords: ['search'] });
const workDir = await mkdtemp(join(tmpdir(), 'dsh-demo-allowlist-'));
const allowlistPath = join(workDir, 'allowlist.json');
await writeFile(allowlistPath, JSON.stringify({ plugins: [{ repository: 'https://github.com/example/dsh-web-search', author: 'example', approvedBy: 'security-team', descriptionZh: '网页搜索，返回带引用的结构化 JSON 证据。', source: { type: 'git', ...ext } }] }));

const config = { ...loadConfig({ ...process.env, GITLAB_URL: BASE, GITLAB_TOKEN: 'demo' }), allowlistPath, allowlistProject: '' };
await generate(config, { outDir: process.argv[2] ?? join(tmpdir(), 'dsh-demo-public'), fetchImpl });
