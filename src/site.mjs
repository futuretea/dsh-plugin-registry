import { readFile } from 'node:fs/promises';

const TEMPLATE = new URL('./site/template.html', import.meta.url);

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const escapeJsonForScript = (s) => s.replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export async function renderSite(index, { generatedAt }) {
  const template = await readFile(TEMPLATE, 'utf8');
  const data = escapeJsonForScript(JSON.stringify({ generatedAt, index }));
  const title = escapeHtml(index.title.zh ?? index.title.en);
  return template.replace('__TITLE__', () => title).replace('__DATA__', () => data);
}
