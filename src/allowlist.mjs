import { readFile } from 'node:fs/promises';
import { gitlabFetch } from './gitlab.mjs';

const SHA = /^[0-9a-f]{40}$/;
const NPM_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const EXACT_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

const str = (v) => typeof v === 'string' && v.trim().length > 0;

function entryErrors(entry, i) {
  const at = `plugins[${i}]`;
  const errors = [];
  if (!str(entry?.repository)) errors.push(`${at}.repository is required`);
  if (!str(entry?.author)) errors.push(`${at}.author is required`);
  if (!str(entry?.approvedBy)) errors.push(`${at}.approvedBy is required`);
  const source = entry?.source;
  if (source?.type === 'npm') {
    if (!NPM_NAME.test(source.package ?? '')) errors.push(`${at}.source.package must be a valid npm package name`);
    if (!EXACT_VERSION.test(source.version ?? '')) errors.push(`${at}.source.version must be an exact version (no ranges)`);
  } else if (source?.type === 'git') {
    if (!str(source.url)) errors.push(`${at}.source.url is required`);
    if (!SHA.test(source.commit ?? '')) errors.push(`${at}.source.commit must be a full 40-char commit sha`);
  } else {
    errors.push(`${at}.source.type must be "npm" or "git"`);
  }
  return errors;
}

const sourceKey = (s) => (s.type === 'npm' ? `npm:${s.package}` : `git:${s.url}`);

export function parseAllowlist(data) {
  if (!Array.isArray(data?.plugins)) return { errors: ['allowlist must have a "plugins" array'], candidates: [] };
  const errors = data.plugins.flatMap(entryErrors);
  const seen = new Set();
  data.plugins.forEach((entry, i) => {
    if (!entry?.source?.type) return;
    const key = sourceKey(entry.source);
    if (seen.has(key)) errors.push(`plugins[${i}] duplicates an earlier entry (${key})`);
    seen.add(key);
  });
  if (errors.length) return { errors, candidates: [] };
  const candidates = data.plugins.map((entry) => ({
    origin: 'external',
    author: entry.author,
    repositoryUrl: entry.repository,
    source: { ...entry.source },
    approvedBy: entry.approvedBy,
    ...(str(entry.descriptionZh) ? { descriptionZh: entry.descriptionZh } : {}),
  }));
  return { errors, candidates };
}

export async function loadAllowlist(path) {
  return parseAllowlist(JSON.parse(await readFile(path, 'utf8')));
}

export async function fetchAllowlistFromGitLab({ baseUrl, token, project, file = 'allowlist.json', ref = '', fetchImpl = fetch }) {
  const url = new URL(`/api/v4/projects/${encodeURIComponent(project)}/repository/files/${encodeURIComponent(file)}/raw`, baseUrl);
  if (ref) url.searchParams.set('ref', ref);
  const res = await gitlabFetch(fetchImpl, url.href, token);
  if (!res.ok) throw new Error(`could not read allowlist ${project}/${file} from GitLab (HTTP ${res.status})`);
  let data;
  try {
    data = JSON.parse(await res.text());
  } catch {
    return { errors: [`allowlist ${project}/${file} is not valid JSON`], candidates: [] };
  }
  return parseAllowlist(data);
}
