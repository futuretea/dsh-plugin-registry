#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/config.mjs';
import { generate, readAllowlist } from '../src/generate.mjs';

const USAGE = `Usage: dsh-plugin-registry [--out <dir>] [--allowlist <file>] [--check-allowlist]

Discovers internal plugins (GitLab topic) and approved external plugins (allowlist),
verifies them and writes index.json, index.html and report.json to --out.

  --out <dir>          output directory (default: public)
  --allowlist <file>   allowlist file (default: $ALLOWLIST_PATH or allowlist.json)
  --check-allowlist    only validate the allowlist file and exit
  -h, --help           show this help

Environment: GITLAB_URL, GITLAB_TOKEN, DSH_PLUGIN_TOPIC, ALLOWLIST_GITLAB_PROJECT
(read allowlist.json from that GitLab project instead of a local file), ALLOWLIST_REF,
SANDBOX_IMAGE, NPM_REGISTRY, GITLEAKS_BIN, INDEX_MAX_RISK (low|medium|high|critical).`;

async function main() {
  const { values } = parseArgs({
    options: {
      out: { type: 'string', default: 'public' },
      allowlist: { type: 'string' },
      'check-allowlist': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  const config = loadConfig();
  if (values.allowlist) config.allowlistPath = values.allowlist;
  if (values['check-allowlist']) {
    const { errors, candidates } = await readAllowlist(config);
    if (errors.length) throw new Error(`allowlist is invalid:\n- ${errors.join('\n- ')}`);
    console.log(`allowlist ok: ${candidates.length} approved external plugin(s)`);
    return;
  }
  await generate(config, { outDir: values.out });
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
