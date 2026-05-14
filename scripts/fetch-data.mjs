// Fetches Midgard repo data from the GitHub API at build time and writes
// it to data.json. Runs hourly via .github/workflows/fetch-data.yml.
//
// Using build-time fetching means every visitor gets the same cached
// snapshot, so the page never hits GitHub from the browser and the
// 60-req/hour unauthenticated rate limit can never be tripped.
//
// Requires Node 20+ (built-in fetch). No npm deps.

import { writeFile, mkdir, readdir, unlink, stat } from "node:fs/promises";
import { join } from "node:path";

const REPO              = "anastasia-Labs/midgard";
const TOKEN             = process.env.GITHUB_TOKEN;
const OUT               = "data.json";
const AVATAR_DIR        = "assets/avatars";
// Avatars are essentially static — same person, same photo for months.
// Refresh each file at most once per day so the hourly run only hits the
// network when a NEW contributor appears or an existing one is genuinely due.
const AVATAR_MAX_AGE_MS = 24 * 60 * 60 * 1000;

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

// Download each contributor's avatar to assets/avatars/<login>.png so we can
// serve them from our own origin (under Cloudflare cache). Stale files for
// contributors who no longer appear are removed each run.
async function isFresh(path) {
  try {
    const s = await stat(path);
    return (Date.now() - s.mtimeMs) < AVATAR_MAX_AGE_MS;
  } catch { return false; }
}

async function downloadAvatar(url, login) {
  const path = join(AVATAR_DIR, `${login}.png`);
  if (await isFresh(path)) return `${AVATAR_DIR}/${login}.png`;
  try {
    const u = new URL(url);
    u.searchParams.set("s", "36");
    const r = await fetch(u.toString());
    if (!r.ok) { console.error(`avatar ${login}: HTTP ${r.status}`); return null; }
    const buf = Buffer.from(await r.arrayBuffer());
    await writeFile(path, buf);
    console.log(`refreshed avatar ${login}`);
    return `${AVATAR_DIR}/${login}.png`;
  } catch (e) {
    console.error(`avatar ${login}: ${e.message}`);
    return null;
  }
}

await mkdir(AVATAR_DIR, { recursive: true });
const kept = new Set();
const enrichedContributors = await Promise.all(
  (contributors || []).map(async (c) => {
    if (!c.login || !c.avatar_url) return c;
    const localPath = await downloadAvatar(c.avatar_url, c.login);
    if (localPath) { kept.add(`${c.login}.png`); c.local_avatar = localPath; }
    return c;
  })
);

// Cleanup avatars belonging to contributors who left the project.
try {
  for (const f of await readdir(AVATAR_DIR)) {
    if (f.endsWith(".png") && !kept.has(f)) {
      await unlink(join(AVATAR_DIR, f));
      console.log(`removed stale avatar ${f}`);
    }
  }
} catch (e) { /* dir might not exist on first run */ }

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
  contributors: enrichedContributors.map(c => ({
    login:         c.login,
    html_url:      c.html_url,
    avatar_url:    c.local_avatar || c.avatar_url,
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
