import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listFiles } from '../fetch-source.mjs';

const str = (v) => typeof v === 'string' && v.trim().length > 0;
const README = /^readme(\.[a-z]+)?$/i;

function l1(files) {
  if (files.length === 0) return 'L1: repository is empty';
  if (!files.some((f) => README.test(f))) return 'L1: README is missing';
  return null;
}

function l2(manifest) {
  if (!manifest) return 'L2: package.json is missing or not valid JSON';
  const missing = ['name', 'version', 'description'].filter((k) => !str(manifest[k]));
  return missing.length ? `L2: package.json is missing ${missing.join(', ')}` : null;
}

function l3(manifest, candidate) {
  if (!str(manifest.engines?.dsh)) return 'L3: package.json engines.dsh is not declared';
  const { source } = candidate;
  if (source.type === 'npm') {
    if (manifest.name !== source.package) return `L3: package name "${manifest.name}" does not match "${source.package}"`;
    if (manifest.version !== source.version) return `L3: package version "${manifest.version}" does not match "${source.version}"`;
  }
  return null;
}

async function readManifest(dir) {
  try {
    const parsed = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function checkMetadata(candidate, dir) {
  const files = await listFiles(dir);
  const manifest = await readManifest(dir);
  const failure = l1(files) ?? l2(manifest) ?? l3(manifest, candidate);
  const level = failure ? Number(failure[1]) - 1 : 3;
  return { level, manifest: level >= 2 ? manifest : null, error: failure };
}
