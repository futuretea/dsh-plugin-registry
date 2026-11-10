import { relative } from 'node:path';
import { runCommand } from '../fetch-source.mjs';

export async function scanSecrets(dir, { bin = 'gitleaks' } = {}, { run = runCommand } = {}) {
  const args = ['dir', dir, '--no-banner', '--redact', '--report-format', 'json', '--report-path', '-', '--exit-code', '0', '--log-level', 'error'];
  const findings = JSON.parse((await run(bin, args)) || '[]');
  return findings.map((f) => ({ rule: f.RuleID, file: relative(dir, f.File) || f.File, line: f.StartLine }));
}
