import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

export async function runCommand(cmd, args, options = {}) {
  const { stdout } = await execFileAsync(cmd, args, { maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60 * 1000, ...options });
  return stdout;
}

async function fetchGit(source, dir, run) {
  await mkdir(dir, { recursive: true });
  await run('git', ['init', '--quiet', dir]);
  await run('git', ['-C', dir, 'fetch', '--quiet', '--depth', '1', source.url, source.commit]);
  await run('git', ['-C', dir, 'checkout', '--quiet', 'FETCH_HEAD']);
  const ts = await run('git', ['-C', dir, 'log', '-1', '--format=%ct']);
  return { dir, publishTimestamp: Number(ts.trim()) };
}

async function fetchNpm(source, dir, run) {
  const spec = `${source.package}@${source.version}`;
  const packDir = join(dir, '..', `${source.package.replace(/[@/]/g, '_')}-pack`);
  await mkdir(packDir, { recursive: true });
  await mkdir(dir, { recursive: true });
  const packed = JSON.parse(await run('npm', ['pack', spec, '--json', '--pack-destination', packDir]));
  await run('tar', ['-xzf', join(packDir, packed[0].filename), '-C', dir, '--strip-components', '1']);
  const times = JSON.parse(await run('npm', ['view', spec, 'time', '--json']));
  const published = times?.[source.version];
  return { dir, publishTimestamp: published ? Math.floor(Date.parse(published) / 1000) : null };
}

export async function fetchSource(candidate, dir, { run = runCommand } = {}) {
  const fetcher = candidate.source.type === 'git' ? fetchGit : fetchNpm;
  return fetcher(candidate.source, dir, run);
}

export async function listFiles(dir) {
  return (await readdir(dir).catch(() => [])).filter((f) => f !== '.git');
}
