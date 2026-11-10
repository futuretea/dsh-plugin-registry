export const INDEX_FORMAT = 1;

const SOURCE_TYPES = new Set(['git', 'npm']);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;

function checkLocalized(value, path, errors) {
  if (!isObject(value) || Object.keys(value).length === 0) {
    errors.push(`${path} must be a non-empty localized object`);
    return;
  }
  for (const [lang, text] of Object.entries(value)) {
    if (typeof text !== 'string') errors.push(`${path}.${lang} must be a string`);
  }
}

function checkVersion(version, path, errors) {
  if (!isObject(version)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (!isNonEmptyString(version.version)) errors.push(`${path}.version must be a non-empty string`);
  if (!Number.isInteger(version.publishTimestamp)) errors.push(`${path}.publishTimestamp must be an integer (unix seconds)`);
  const source = version.source;
  if (!isObject(source) || !SOURCE_TYPES.has(source.type)) {
    errors.push(`${path}.source.type must be one of ${[...SOURCE_TYPES].join(', ')}`);
  } else if (source.type === 'git') {
    if (!isNonEmptyString(source.url)) errors.push(`${path}.source.url is required for git sources`);
    if (!/^[0-9a-f]{40}$/.test(source.commit ?? '')) errors.push(`${path}.source.commit must be a 40-char commit sha`);
  }
  if (!isObject(version.engines) || !isNonEmptyString(version.engines.dsh)) {
    errors.push(`${path}.engines.dsh must be a non-empty string`);
  }
}

function checkPlugin(plugin, path, errors) {
  if (!isObject(plugin)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (!isNonEmptyString(plugin.name)) errors.push(`${path}.name must be a non-empty string`);
  checkLocalized(plugin.title, `${path}.title`, errors);
  checkLocalized(plugin.description, `${path}.description`, errors);
  if (!isNonEmptyString(plugin.author)) errors.push(`${path}.author must be a non-empty string`);
  if (!isObject(plugin.repository) || !isNonEmptyString(plugin.repository.url)) {
    errors.push(`${path}.repository.url must be a non-empty string`);
  }
  const meta = plugin.metadata;
  if (!isObject(meta)) {
    errors.push(`${path}.metadata must be an object`);
  } else {
    for (const key of ['keywords', 'labels']) {
      if (!Array.isArray(meta[key]) || !meta[key].every(isNonEmptyString)) {
        errors.push(`${path}.metadata.${key} must be an array of strings`);
      }
    }
    if (!isObject(meta.sortKeys) || !Object.values(meta.sortKeys).every((v) => typeof v === 'number')) {
      errors.push(`${path}.metadata.sortKeys must map keys to numbers`);
    }
  }
  if (!Array.isArray(plugin.versions) || plugin.versions.length === 0) {
    errors.push(`${path}.versions must be a non-empty array`);
  } else {
    plugin.versions.forEach((v, i) => checkVersion(v, `${path}.versions[${i}]`, errors));
  }
}

export function validateIndex(index) {
  const errors = [];
  if (!isObject(index)) return ['index must be an object'];
  if (index.format !== INDEX_FORMAT) errors.push(`format must be ${INDEX_FORMAT}`);
  checkLocalized(index.title, 'title', errors);
  checkLocalized(index.description, 'description', errors);
  if (!isObject(index.metadata)) errors.push('metadata must be an object');
  if (!Array.isArray(index.plugins)) {
    errors.push('plugins must be an array');
  } else {
    const seen = new Set();
    index.plugins.forEach((p, i) => {
      checkPlugin(p, `plugins[${i}]`, errors);
      if (seen.has(p?.name)) errors.push(`plugins[${i}].name "${p.name}" is duplicated`);
      seen.add(p?.name);
    });
  }
  return errors;
}

export const LABEL_TITLES = {
  'install-verified': { en: 'Install verified', zh: '安装已验证' },
  'install-failed': { en: 'Install failed', zh: '安装失败' },
  'risk-low': { en: 'Low risk', zh: '低风险' },
  'risk-medium': { en: 'Medium risk', zh: '中风险' },
  'risk-high': { en: 'High risk', zh: '高风险' },
  'risk-critical': { en: 'Critical risk', zh: '严重风险' },
  'risk-unknown': { en: 'Risk unknown', zh: '风险待定' },
  'source-internal': { en: 'Internal plugin', zh: '公司自研' },
  'source-external': { en: 'Approved external plugin', zh: '外部放行' },
};

const CATEGORY_TITLES = {
  internal: { en: 'Internal plugins', zh: '公司自研' },
  external: { en: 'Approved external plugins', zh: '外部放行' },
};

export function toIndexPlugin(result) {
  const { candidate, manifest, publishTimestamp, labels } = result;
  const description = { en: manifest.description };
  if (candidate.descriptionZh) description.zh = candidate.descriptionZh;
  const source = candidate.source.type === 'git'
    ? { type: 'git', url: candidate.source.url, commit: candidate.source.commit }
    : { type: 'npm' };
  return {
    name: manifest.name,
    title: { en: candidate.displayName ?? manifest.name },
    description,
    author: candidate.author,
    repository: { url: candidate.repositoryUrl },
    metadata: {
      category: candidate.origin,
      keywords: Array.isArray(manifest.keywords) ? manifest.keywords.filter(isNonEmptyString) : [],
      labels,
      sortKeys: { publishTimestamp },
    },
    versions: [{
      version: manifest.version,
      publishTimestamp,
      source,
      engines: { dsh: manifest.engines.dsh },
    }],
  };
}

export function buildIndex(results, { title, description }) {
  const plugins = results
    .filter((r) => r.included)
    .map(toIndexPlugin)
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    format: INDEX_FORMAT,
    title,
    description,
    metadata: {
      categories: CATEGORY_TITLES,
      labels: LABEL_TITLES,
      sortKeys: { publishTimestamp: { title: { en: 'Last published', zh: '最近发布' }, order: 'desc' } },
    },
    plugins,
  };
}
