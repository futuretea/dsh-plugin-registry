import { RISK_LEVELS } from './risk.mjs';

export const MARKET_TITLE = { en: 'Internal DSH Plugin Market', zh: '企业内部 DSH 插件市场' };
export const MARKET_DESCRIPTION = {
  en: 'Internal plugins and approved external plugins, each install-tested in a sandbox and scanned for vulnerable dependencies and leaked secrets.',
  zh: '公司自研插件与审核放行的外部插件，每个都经过沙盒安装实测、依赖漏洞与密钥泄露扫描。',
};

export function gitAuthEnv(gitlabUrl, token) {
  if (!gitlabUrl || !token) return {};
  const basic = Buffer.from(`oauth2:${token}`).toString('base64');
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `http.${new URL(gitlabUrl).origin}/.extraHeader`,
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
    GIT_TERMINAL_PROMPT: '0',
  };
}

export function loadConfig(env = process.env) {
  const maxRisk = env.INDEX_MAX_RISK || 'medium';
  if (!RISK_LEVELS.includes(maxRisk)) throw new Error(`INDEX_MAX_RISK must be one of ${RISK_LEVELS.join(', ')}`);
  return {
    gitlabUrl: env.GITLAB_URL || '',
    gitlabToken: env.GITLAB_TOKEN || '',
    topic: env.DSH_PLUGIN_TOPIC || 'dsh-plugin',
    allowlistPath: env.ALLOWLIST_PATH || 'allowlist.json',
    allowlistProject: env.ALLOWLIST_GITLAB_PROJECT || '',
    allowlistRef: env.ALLOWLIST_REF || '',
    sandbox: { image: env.SANDBOX_IMAGE || 'node:24-alpine', registry: env.NPM_REGISTRY || '' },
    secrets: { bin: env.GITLEAKS_BIN || 'gitleaks' },
    maxRisk,
  };
}
