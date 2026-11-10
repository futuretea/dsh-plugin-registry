import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOTS = ['bin', 'src', 'scripts', 'test'];

async function listModules(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(entries.map(async (e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'fixtures' ? [] : listModules(path);
    return path.endsWith('.mjs') ? [path] : [];
  }));
  return files.flat();
}

const files = (await Promise.all(ROOTS.map(listModules))).flat();
let failed = 0;
for (const file of files) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed += 1;
    process.stderr.write(r.stderr);
  }
}
console.log(`lint: checked ${files.length} files, ${failed} failed`);
process.exit(failed ? 1 : 0);
