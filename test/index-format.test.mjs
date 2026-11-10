import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildIndex, validateIndex } from '../src/index-format.mjs';

const sample = JSON.parse(await readFile(new URL('./fixtures/dsh-so-sample.json', import.meta.url), 'utf8'));

const META = { title: { en: 'Internal', zh: '内部' }, description: { en: 'Internal market', zh: '内部市场' } };

function result(overrides = {}) {
  return {
    included: true,
    candidate: {
      origin: 'internal',
      author: 'platform/tools',
      repositoryUrl: 'https://gitlab.example.com/platform/tools/dsh-hello',
      source: { type: 'git', url: 'https://gitlab.example.com/platform/tools/dsh-hello.git', commit: 'a'.repeat(40) },
    },
    manifest: { name: 'dsh-hello', version: '1.0.0', description: 'Hello plugin', keywords: ['demo'], engines: { dsh: '^0.2.0' } },
    publishTimestamp: 1793607054,
    labels: ['install-verified', 'risk-low', 'source-internal'],
    ...overrides,
  };
}

test('validator accepts real dsh.so index entries (git and npm sources)', () => {
  assert.deepEqual(validateIndex(sample), []);
  assert.deepEqual(sample.plugins.map((p) => p.versions[0].source.type).sort(), ['git', 'npm']);
});

test('built index has the same structure as dsh.so and passes validation', () => {
  const npmResult = result({
    candidate: { origin: 'external', author: 'someone', repositoryUrl: 'https://github.com/someone/dsh-x', source: { type: 'npm', package: 'dsh-x', version: '2.0.0' }, descriptionZh: '外部插件' },
    manifest: { name: 'dsh-x', version: '2.0.0', description: 'External', engines: { dsh: '*' } },
  });
  const index = buildIndex([result(), npmResult, result({ included: false, manifest: { ...result().manifest, name: 'dsh-skip' } })], META);
  assert.deepEqual(validateIndex(index), []);
  assert.deepEqual(Object.keys(index).sort(), Object.keys(sample).sort());
  assert.deepEqual(index.plugins.map((p) => p.name), ['dsh-hello', 'dsh-x']);
  const ref = sample.plugins[0];
  for (const plugin of index.plugins) {
    assert.deepEqual(Object.keys(plugin).sort(), Object.keys(ref).sort());
    assert.deepEqual(Object.keys(plugin.versions[0]).sort(), Object.keys(ref.versions[0]).sort());
  }
  assert.deepEqual(index.plugins[1].versions[0].source, { type: 'npm' });
  assert.deepEqual(index.plugins[1].description, { en: 'External', zh: '外部插件' });
  assert.equal(index.plugins[0].versions[0].source.commit, 'a'.repeat(40));
});

test('validator reports broken entries', () => {
  const broken = structuredClone(sample);
  broken.format = 2;
  broken.plugins[0].versions[0].source.commit = 'main';
  delete broken.plugins[1].versions[0].engines;
  broken.plugins.push(structuredClone(sample.plugins[1]));
  const errors = validateIndex(broken);
  assert.ok(errors.includes('format must be 1'));
  assert.ok(errors.some((e) => e.includes('source.commit')));
  assert.ok(errors.some((e) => e.includes('engines.dsh')));
  assert.ok(errors.some((e) => e.includes('duplicated')));
});
