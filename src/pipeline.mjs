import { join } from 'node:path';
import { fetchSource as defaultFetch } from './fetch-source.mjs';
import { checkMetadata as defaultMetadata } from './checks/metadata.mjs';
import { sandboxInstall as defaultInstall } from './checks/install.mjs';
import { scanSecrets as defaultScan } from './checks/secrets.mjs';
import { classifyRisk, isRiskAllowed } from './risk.mjs';

const DEFAULT_STEPS = { fetchSource: defaultFetch, checkMetadata: defaultMetadata, sandboxInstall: defaultInstall, scanSecrets: defaultScan };

function emptyResult(candidate) {
  return {
    candidate, level: 0, manifest: null, publishTimestamp: null,
    install: null, audit: null, secrets: [], risk: 'unknown',
    labels: [`source-${candidate.origin}`], included: false, reasons: [],
  };
}

async function verifyCandidate(candidate, dir, options, steps) {
  const result = emptyResult(candidate);
  if (candidate.discoveryError) {
    result.reasons.push(`L1: ${candidate.discoveryError}`);
    return result;
  }
  let fetched;
  try {
    fetched = await steps.fetchSource(candidate, dir, options.fetch);
  } catch (err) {
    result.reasons.push(`L1: could not fetch source (${err.message.split('\n')[0]})`);
    return result;
  }
  result.publishTimestamp = fetched.publishTimestamp;
  const meta = await steps.checkMetadata(candidate, dir);
  Object.assign(result, { level: meta.level, manifest: meta.manifest });
  if (meta.error) {
    result.reasons.push(meta.error);
    return result;
  }
  const install = await steps.sandboxInstall(dir, options.sandbox);
  result.install = { ok: install.ok, log: install.log };
  result.audit = install.audit;
  result.secrets = await steps.scanSecrets(dir, options.secrets);
  if (install.ok) {
    result.level = 4;
    result.risk = classifyRisk({ audit: install.audit, secrets: result.secrets });
    result.labels.push('install-verified', `risk-${result.risk}`);
  } else {
    result.labels.push('install-failed');
    result.reasons.push('L4: installation failed in the sandbox');
  }
  if (result.secrets.length) result.reasons.push(`security: ${result.secrets.length} potential secret(s) found`);
  if (install.ok && !isRiskAllowed(result.risk, options.maxRisk)) {
    result.reasons.push(`security: risk "${result.risk}" exceeds the allowed maximum "${options.maxRisk}"`);
  }
  const hasTimestamp = Number.isInteger(result.publishTimestamp);
  if (!hasTimestamp) result.reasons.push('L3: publish time could not be determined');
  result.included = install.ok && isRiskAllowed(result.risk, options.maxRisk) && hasTimestamp;
  return result;
}

export async function verifyAll(candidates, workRoot, options, steps = {}) {
  const allSteps = { ...DEFAULT_STEPS, ...steps };
  const results = [];
  const names = new Set();
  for (const [i, candidate] of candidates.entries()) {
    const result = await verifyCandidate(candidate, join(workRoot, String(i)), options, allSteps);
    const name = result.manifest?.name;
    if (result.included && names.has(name)) {
      result.included = false;
      result.reasons.push(`name "${name}" is already used by another plugin`);
    }
    if (result.included) names.add(name);
    options.onResult?.(result);
    results.push(result);
  }
  return results;
}
