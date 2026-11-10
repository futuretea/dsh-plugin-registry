import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchAllowlistFromGitLab, loadAllowlist } from './allowlist.mjs';
import { discoverInternal } from './gitlab.mjs';
import { verifyAll } from './pipeline.mjs';
import { buildIndex, validateIndex } from './index-format.mjs';
import { renderSite } from './site.mjs';
import { runCommand } from './fetch-source.mjs';
import { MARKET_DESCRIPTION, MARKET_TITLE, gitAuthEnv } from './config.mjs';

function reportEntry(r) {
  return {
    name: r.manifest?.name ?? null,
    origin: r.candidate.origin,
    repository: r.candidate.repositoryUrl,
    source: r.candidate.source,
    approvedBy: r.candidate.approvedBy ?? null,
    level: r.level,
    risk: r.risk,
    labels: r.labels,
    included: r.included,
    reasons: r.reasons,
    audit: r.audit,
    secrets: r.secrets,
    installLog: r.install?.log || '',
  };
}

export async function readAllowlist(config, { fetchImpl = fetch } = {}) {
  if (!config.allowlistProject) return loadAllowlist(config.allowlistPath);
  if (!config.gitlabUrl) throw new Error('ALLOWLIST_GITLAB_PROJECT requires GITLAB_URL');
  return fetchAllowlistFromGitLab({
    baseUrl: config.gitlabUrl, token: config.gitlabToken, project: config.allowlistProject, ref: config.allowlistRef, fetchImpl,
  });
}

async function writeAtomic(path, content) {
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, content);
  await rename(tmp, path);
}

export async function collectCandidates(config, { log, fetchImpl = fetch }) {
  const allowlist = await readAllowlist(config, { fetchImpl });
  if (allowlist.errors.length) throw new Error(`allowlist is invalid:\n- ${allowlist.errors.join('\n- ')}`);
  let internal = [];
  if (config.gitlabUrl) {
    internal = await discoverInternal({ baseUrl: config.gitlabUrl, token: config.gitlabToken, topic: config.topic, fetchImpl });
  } else {
    log('GITLAB_URL is not set: skipping internal plugin discovery');
  }
  log(`candidates: ${internal.length} internal, ${allowlist.candidates.length} external`);
  return [...internal, ...allowlist.candidates];
}

export async function generate(config, { outDir, log = console.log, fetchImpl, steps, now = new Date() }) {
  const candidates = await collectCandidates(config, { log, fetchImpl });
  const workRoot = join(tmpdir(), `dsh-registry-${process.pid}-${Date.now()}`);
  const env = { ...process.env, ...gitAuthEnv(config.gitlabUrl, config.gitlabToken) };
  const run = (cmd, args, opts) => runCommand(cmd, args, { env, ...opts });
  try {
    const results = await verifyAll(candidates, workRoot, {
      fetch: { run },
      sandbox: config.sandbox,
      secrets: config.secrets,
      maxRisk: config.maxRisk,
      onResult: (r) => log(`${r.included ? 'included' : 'excluded'}: ${r.manifest?.name ?? r.candidate.repositoryUrl}${r.reasons.length ? ` (${r.reasons.join('; ')})` : ''}`),
    }, steps);
    const index = buildIndex(results, { title: MARKET_TITLE, description: MARKET_DESCRIPTION });
    const errors = validateIndex(index);
    if (errors.length) throw new Error(`generated index is invalid:\n- ${errors.join('\n- ')}`);
    const generatedAt = now.toISOString();
    await mkdir(outDir, { recursive: true });
    await writeAtomic(join(outDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
    await writeAtomic(join(outDir, 'report.json'), `${JSON.stringify({ generatedAt, maxRisk: config.maxRisk, plugins: results.map(reportEntry) }, null, 2)}\n`);
    await writeAtomic(join(outDir, 'index.html'), await renderSite(index, { generatedAt }));
    log(`wrote ${index.plugins.length} of ${results.length} plugins to ${outDir}`);
    return { index, results };
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
}
