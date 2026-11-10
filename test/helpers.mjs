import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from '../src/fetch-source.mjs';

export async function tempDir(prefix = 'dsh-registry-test-') {
  return mkdtemp(join(tmpdir(), prefix));
}

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_AUTHOR_DATE: '2026-11-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-11-01T00:00:00Z',
};

export async function makeGitRepo(files) {
  const dir = await tempDir('dsh-registry-repo-');
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(dir, name, '..'), { recursive: true });
    await writeFile(join(dir, name), typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
  await runCommand('git', ['init', '--quiet', dir]);
  await runCommand('git', ['-C', dir, 'add', '-A'], { env: GIT_ENV });
  await runCommand('git', ['-C', dir, 'commit', '--quiet', '--allow-empty', '-m', 'init'], { env: GIT_ENV });
  const commit = (await runCommand('git', ['-C', dir, 'rev-parse', 'HEAD'])).trim();
  return { url: `file://${dir}`, commit };
}

export const pluginManifest = (overrides = {}) => ({
  name: 'dsh-hello',
  version: '1.0.0',
  description: 'Says hello',
  keywords: ['demo'],
  engines: { dsh: '^0.2.0' },
  ...overrides,
});
