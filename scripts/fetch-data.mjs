// Fetches Midgard repo data from the GitHub API at build time and writes
// it to data.json. Runs daily via .github/workflows/fetch-data.yml.
//
// Using build-time fetching means every visitor gets the same cached
// snapshot, so the page never hits GitHub from the browser and the
// 60-req/hour unauthenticated rate limit can never be tripped.
//
// Requires Node 20+ (built-in fetch). No npm deps.

import { writeFile, mkdir, readdir, unlink, stat } from "node:fs/promises";
import { join } from "node:path";

const REPO              = "anastasia-Labs/midgard";
// We aggregate activity across ALL branches, not just one. The Midgard
// team confirmed work is happening in parallel across many branches and
// every commit counts toward "progress" — picking a single branch would
// understate the team's real output.
const TOKEN             = process.env.GITHUB_TOKEN;
const OUT               = "data.json";
const AVATAR_DIR        = "assets/avatars";
// Avatars are essentially static. Refresh each file at most once per week
// so daily runs only hit the network when a NEW contributor appears.
const AVATAR_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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

// Pull commits across every branch, dedupe by SHA, sort newest first.
// Used to power both the "recent commits" list and the weekly sparkline.
// (`/stats/commit_activity` only covers the default branch, so we build
// the sparkline ourselves by bucketing this combined commit set.)
async function allBranchCommits() {
  const branches = await gh(`/repos/${REPO}/branches?per_page=100`);
  if (!branches) return [];
  console.log(`Fetching commits across ${branches.length} branches…`);

  // Two pages of 100 commits per branch → up to 200 commits per branch.
  // Most branches share most of their history so the unique set easily
  // covers the trailing 52 weeks once deduplicated.
  const pages = await Promise.all(
    branches.flatMap(b => [
      gh(`/repos/${REPO}/commits?sha=${encodeURIComponent(b.name)}&per_page=100&page=1`),
      gh(`/repos/${REPO}/commits?sha=${encodeURIComponent(b.name)}&per_page=100&page=2`)
    ])
  );

  const seen = new Set();
  const unique = [];
  for (const page of pages) {
    if (!page) continue;
    for (const c of page) {
      if (c.sha && !seen.has(c.sha)) {
        seen.add(c.sha);
        unique.push(c);
      }
    }
  }
  unique.sort((a, b) =>
    new Date(b.commit?.author?.date || 0) - new Date(a.commit?.author?.date || 0)
  );
  return unique;
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
  combinedCommits,
  contributors,
  prs,
  issues,
  releases
] = await Promise.all([
  gh(`/repos/${REPO}`),
  gh(`/repos/${REPO}/languages`),
  allBranchCommits(),
  gh(`/repos/${REPO}/contributors?per_page=100&anon=1`),
  gh(`/repos/${REPO}/pulls?state=open&per_page=10&sort=updated`),
  gh(`/repos/${REPO}/issues?state=open&per_page=10&sort=updated`),
  gh(`/repos/${REPO}/releases?per_page=5`)
]);

const commits = combinedCommits.slice(0, 15);
const commitActivity = bucketWeekly(combinedCommits);

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
  scope: "all-branches",
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
  commitActivity
};

await writeFile(OUT, JSON.stringify(slim, null, 2) + "\n");
console.log(`Wrote ${OUT} — all branches: ${combinedCommits.length} unique commits sampled, ${slim.commits.length} most recent listed, ${slim.contributors.length} contributors, ${slim.prs.length} PRs, ${slim.issues.length} issues, ${slim.releases.length} releases.`);
