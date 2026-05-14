// Fetches Midgard repo data from the GitHub API at build time and writes
// it to data.json. Runs hourly via .github/workflows/fetch-data.yml.
//
// Using build-time fetching means every visitor gets the same cached
// snapshot, so the page never hits GitHub from the browser and the
// 60-req/hour unauthenticated rate limit can never be tripped.
//
// Requires Node 20+ (built-in fetch). No npm deps.

import { writeFile } from "node:fs/promises";

const REPO  = "anastasia-Labs/midgard";
const TOKEN = process.env.GITHUB_TOKEN;
const OUT   = "data.json";

const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {})
};

async function gh(path, { allow202 = false } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`https://api.github.com${path}`, { headers });
    if (r.status === 202 && allow202) {
      // Stats endpoints sometimes return 202 while GitHub computes.
      await new Promise(res => setTimeout(res, 2000));
      continue;
    }
    if (!r.ok) {
      console.error(`HTTP ${r.status} for ${path}`);
      return null;
    }
    return r.json();
  }
  return null;
}

const [
  repo,
  languages,
  commits,
  contributors,
  prs,
  issues,
  releases,
  commitActivity
] = await Promise.all([
  gh(`/repos/${REPO}`),
  gh(`/repos/${REPO}/languages`),
  gh(`/repos/${REPO}/commits?per_page=15`),
  gh(`/repos/${REPO}/contributors?per_page=100&anon=1`),
  gh(`/repos/${REPO}/pulls?state=open&per_page=10&sort=updated`),
  gh(`/repos/${REPO}/issues?state=open&per_page=10&sort=updated`),
  gh(`/repos/${REPO}/releases?per_page=5`),
  gh(`/repos/${REPO}/stats/commit_activity`, { allow202: true })
]);

// Slim each response down to only the fields the page actually renders.
// Keeps data.json small (typically <30 KB) so the page loads instantly.
const slim = {
  fetchedAt: new Date().toISOString(),
  repo: repo && {
    stargazers_count: repo.stargazers_count,
    forks_count:      repo.forks_count,
    open_issues_count: repo.open_issues_count
  },
  languages,
  commits: (commits || []).map(c => ({
    sha:       c.sha,
    html_url:  c.html_url,
    message:   c.commit.message,
    authorName: c.commit.author?.name || "",
    authorDate: c.commit.author?.date || ""
  })),
  contributors: (contributors || []).map(c => ({
    login:        c.login,
    html_url:     c.html_url,
    avatar_url:   c.avatar_url,
    contributions: c.contributions
  })),
  prs: (prs || []).map(p => ({
    number:     p.number,
    title:      p.title,
    html_url:   p.html_url,
    updated_at: p.updated_at
  })),
  issues: (issues || []).filter(i => !i.pull_request).map(i => ({
    number:     i.number,
    title:      i.title,
    html_url:   i.html_url,
    updated_at: i.updated_at
  })),
  releases: (releases || []).map(r => ({
    tag_name:     r.tag_name,
    name:         r.name,
    html_url:     r.html_url,
    published_at: r.published_at,
    prerelease:   r.prerelease
  })),
  commitActivity: (commitActivity || []).map(w => ({ week: w.week, total: w.total }))
};

await writeFile(OUT, JSON.stringify(slim, null, 2) + "\n");
console.log(`Wrote ${OUT} — ${slim.commits.length} commits, ${slim.contributors.length} contributors, ${slim.prs.length} PRs, ${slim.issues.length} issues, ${slim.releases.length} releases.`);
