import { spawn } from 'node:child_process';
import { runCommand } from '../fetch-source.mjs';

export const AUDIT_MARKER = '@@DSH_REGISTRY_AUDIT@@';
const LOG_TAIL = 4000;

const SANDBOX_SCRIPT = `set -eu
mkdir -p /tmp/plugin /tmp/host
tar -xf - -C /tmp/plugin
cd /tmp/plugin
tgz=$(npm pack --silent --pack-destination /tmp | tail -n 1)
cd /tmp/host
npm init -y >/dev/null
npm install --no-fund --no-audit --loglevel=error "/tmp/$tgz"
echo "${AUDIT_MARKER}"
npm audit --json 2>/dev/null || true
`;

export function spawnWithInput(cmd, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString() }));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export function parseAudit(text) {
  try {
    const counts = JSON.parse(text).metadata?.vulnerabilities;
    if (!counts) return null;
    return { low: counts.low ?? 0, moderate: counts.moderate ?? 0, high: counts.high ?? 0, critical: counts.critical ?? 0 };
  } catch {
    return null;
  }
}

export function dockerArgs({ image, registry }) {
  const args = ['run', '--rm', '-i', '--user', 'node', '--memory', '1g', '--cpus', '1', '--pids-limit', '512'];
  if (registry) args.push('-e', `npm_config_registry=${registry}`);
  args.push(image, 'sh', '-c', SANDBOX_SCRIPT);
  return args;
}

export async function sandboxInstall(dir, options, deps = {}) {
  const { run = runCommand, exec = spawnWithInput } = deps;
  const tarball = await run('tar', ['-cf', '-', '--exclude', '.git', '-C', dir, '.'], { encoding: 'buffer' });
  const { code, stdout, stderr } = await exec('docker', dockerArgs(options), tarball);
  const markerAt = stdout.indexOf(AUDIT_MARKER);
  if (code !== 0 || markerAt === -1) {
    return { ok: false, audit: null, log: (stderr || stdout).slice(-LOG_TAIL) };
  }
  return { ok: true, audit: parseAudit(stdout.slice(markerAt + AUDIT_MARKER.length)), log: '' };
}
