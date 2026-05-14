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
// Track the active development branch, not the repo default. The Midgard
// team explicitly asked the tracker to follow tx-validation as their
// canonical "progress" branch.
const BRANCH            = "tx-validation";
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

async function gh(path) {
  const r = await fetch(`https://api.github.com${path}`, { headers });
  if (!r.ok) { console.error(`HTTP ${r.status} for ${path}`); return null; }
  return r.json();
}

// Branch-scoped commit total via the Link "rel=last" page index trick:
// requesting per_page=1 + reading the last-page number = total count.
async function branchCommitTotal() {
  const r = await fetch(`https://api.github.com/repos/${REPO}/commits?sha=${BRANCH}&per_page=1`, { headers });
  if (!r.ok) return null;
  const m = (r.headers.get("link") || "").match(/[?&]page=(\d+)>;\s*rel="last"/);
  return m ? parseInt(m[1], 10) : null;
}

// Pull up to 500 commits from the branch, used both to populate the
// "recent commits" list and to build a branch-scoped weekly sparkline
// (the /stats/commit_activity endpoint only covers the default branch).
async function branchCommitHistory() {
  const pages = await Promise.all([1, 2, 3, 4, 5].map(p =>
    gh(`/repos/${REPO}/commits?sha=${BRANCH}&per_page=100&page=${p}`)
  ));
  return pages.flat().filter(Boolean);
}

function bucketWeekly(commits) {
  const buckets = new Map();
  for (const c of commits) {
    const iso = c.commit?.author?.date;
    if (!iso) continue;
    const d = new Date(iso);
    // Snap to start of UTC week (Sunday).
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    const key = Math.floor(d.getTime() / 1000);
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  const thisWeek = new Date();
  thisWeek.setUTCHours(0, 0, 0, 0);
  thisWeek.setUTCDate(thisWeek.getUTCDate() - thisWeek.getUTCDay());
  const weeks = [];
  for (let i = 51; i >= 0; i--) {
    const w = new Date(thisWeek);
    w.setUTCDate(w.getUTCDate() - i * 7);
    const key = Math.floor(w.getTime() / 1000);
    weeks.push({ week: key, total: buckets.get(key) || 0 });
  }
  return weeks;
}

const [
  repo,
  languages,
  branchCommits,
  branchTotal,
  contributors,
  prs,
  issues,
  releases
] = await Promise.all([
  gh(`/repos/${REPO}`),
  gh(`/repos/${REPO}/languages`),
  branchCommitHistory(),
  branchCommitTotal(),
  gh(`/repos/${REPO}/contributors?per_page=100&anon=1`),
  gh(`/repos/${REPO}/pulls?state=open&per_page=10&sort=updated`),
  gh(`/repos/${REPO}/issues?state=open&per_page=10&sort=updated`),
  gh(`/repos/${REPO}/releases?per_page=5`)
]);

const commits = (branchCommits || []).slice(0, 15);
const commitActivity = bucketWeekly(branchCommits || []);

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
  branch: BRANCH,
  repo: repo && {
    stargazers_count: repo.stargazers_count,
    forks_count:      repo.forks_count,
    open_issues_count: repo.open_issues_count,
    branch_total_commits: branchTotal
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
  commitActivity
};

await writeFile(OUT, JSON.stringify(slim, null, 2) + "\n");
console.log(`Wrote ${OUT} — tracking ${BRANCH}: ${slim.commits.length} recent of ${branchTotal ?? "?"} branch commits, ${slim.contributors.length} contributors, ${slim.prs.length} PRs, ${slim.issues.length} issues, ${slim.releases.length} releases.`);
