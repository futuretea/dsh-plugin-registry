const PER_PAGE = 100;

export async function gitlabFetch(fetchImpl, url, token) {
  const headers = token ? { 'PRIVATE-TOKEN': token } : {};
  try {
    return await fetchImpl(url, { headers });
  } catch (err) {
    const { origin, pathname } = new URL(url);
    throw new Error(`GitLab request ${origin}${pathname} failed: ${err.cause?.code ?? err.cause?.message ?? err.message}`);
  }
}

async function getJson(fetchImpl, url, token) {
  const res = await gitlabFetch(fetchImpl, url, token);
  if (!res.ok) throw new Error(`GitLab API ${res.status} for ${new URL(url).pathname}`);
  return { body: await res.json(), nextPage: res.headers.get('x-next-page') };
}

async function listTopicProjects({ baseUrl, token, topic, fetchImpl }) {
  const projects = [];
  let page = '1';
  while (page) {
    const url = new URL('/api/v4/projects', baseUrl);
    url.search = new URLSearchParams({ topic, archived: 'false', simple: 'true', per_page: String(PER_PAGE), page }).toString();
    const { body, nextPage } = await getJson(fetchImpl, url.href, token);
    projects.push(...body.filter((p) => Array.isArray(p.topics) && p.topics.includes(topic)));
    page = nextPage || '';
  }
  return projects;
}

async function headCommit({ baseUrl, token, fetchImpl }, project) {
  const path = `/api/v4/projects/${project.id}/repository/branches/${encodeURIComponent(project.default_branch)}`;
  const { body } = await getJson(fetchImpl, new URL(path, baseUrl).href, token);
  return body.commit.id;
}

export async function discoverInternal({ baseUrl, token, topic = 'dsh-plugin', fetchImpl = fetch }) {
  const ctx = { baseUrl, token, topic, fetchImpl };
  const projects = await listTopicProjects(ctx);
  const candidates = [];
  for (const project of projects) {
    const candidate = {
      origin: 'internal',
      author: project.namespace?.full_path ?? project.path_with_namespace.split('/').slice(0, -1).join('/'),
      repositoryUrl: project.web_url,
      source: { type: 'git', url: project.http_url_to_repo, commit: null },
    };
    if (!project.default_branch) {
      candidates.push({ ...candidate, discoveryError: 'repository is empty (no default branch)' });
      continue;
    }
    try {
      candidate.source.commit = await headCommit(ctx, project);
      candidates.push(candidate);
    } catch (err) {
      candidates.push({ ...candidate, discoveryError: err.message });
    }
  }
  return candidates;
}
