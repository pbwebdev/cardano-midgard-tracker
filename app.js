/* Midgard Tracker — pulls live data from the GitHub REST API on each page load.
   No build step. To use as a Pages site, just host the static files. */

const REPO = "anastasia-Labs/midgard";
const API  = "https://api.github.com";

/* ---------- Milestones from Project Catalyst F12 + Gov Action ---------- */
const MILESTONES = [
  {
    n: 1, title: "Technical Architecture Specification",
    desc: "Network topology, consensus algorithm, L1↔L2 communication protocol, transaction handling, data storage, economic & security model.",
    status: "done", when: "Sep 2024", due: "2024-09-30", budget: "75,000 ADA",
    tags: ["spec", "architecture"]
  },
  {
    n: 2, title: "Midgard Protocol Smart Contract — Technical Spec",
    desc: "Full specification of the protocol smart contracts that govern the rollup.",
    status: "done", when: "Dec 2025", due: "2025-12-31", budget: "150,000 ADA",
    tags: ["spec", "onchain"]
  },
  {
    n: 3, title: "State Management Contracts",
    desc: "Aiken implementation of the state-management smart contracts (commitments, fraud-proof anchors).",
    status: "done", when: "Jan 2026", due: "2026-01-31", budget: "150,000 ADA",
    tags: ["onchain", "aiken"]
  },
  {
    n: 4, title: "Outbox & Inbox Smart Contracts",
    desc: "L1↔L2 deposit and withdrawal contracts: forced inclusion, exits, and inbox/outbox message queues.",
    status: "active", when: "Feb 2026", due: "2026-02-28", budget: "25,000 ADA",
    tags: ["onchain", "bridge"]
  },
  {
    n: 5, title: "Layer-2 Node MVP",
    desc: "Network parameterisation, L2 toolkit, Docker infra and Kupo/Ogmios integration. Functional node runnable by operators.",
    status: "pending", when: "Mar 2026", due: "2026-03-31", budget: "25,000 ADA",
    tags: ["node", "offchain", "infra"]
  },
  {
    n: 6, title: "Project Closeout",
    desc: "Closeout video, final report, operator and developer onboarding docs.",
    status: "pending", when: "Apr 2026", due: "2026-04-30", budget: "75,000 ADA",
    tags: ["docs", "release"]
  }
];

const MAINNET_TARGET = new Date("2026-12-31T00:00:00Z");

const STATUS_LABEL = { done: "Completed", active: "In progress", pending: "Pending" };

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
const fmt = (n) => Intl.NumberFormat("en", { notation: n >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n);
const relTime = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  const units = [["y",31536000],["mo",2592000],["d",86400],["h",3600],["m",60]];
  for (const [u, v] of units) if (s >= v) return `${Math.floor(s/v)}${u} ago`;
  return "just now";
};
/* GitHub API wrapper with a 10-minute localStorage cache.
   Keeps us well under the 60-req/hour unauthenticated rate limit and
   makes reloads feel instant. Returns null on rate-limit so callers
   can render a friendly placeholder. */
const CACHE_VERSION = "v2";
const CACHE_TTL_MS = 10 * 60 * 1000;
let rateLimited = false;

async function gh(path) {
  const key = `gh:${CACHE_VERSION}:${path}`;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts < CACHE_TTL_MS) return { data, cached: true };
    }
  } catch {}

  const r = await fetch(`${API}${path}`, { headers: { Accept: "application/vnd.github+json" } });
  if (r.status === 403 || r.status === 429) {
    rateLimited = true;
    showRateLimitBanner(r.headers.get("x-ratelimit-reset"));
    return { data: null, rateLimited: true };
  }
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  const data = await r.json();
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch {}
  return { data, headers: r.headers };
}

function showRateLimitBanner(resetEpoch) {
  if (document.getElementById("rateBanner")) return;
  const resetMs = resetEpoch ? Number(resetEpoch) * 1000 : Date.now() + 60 * 60 * 1000;
  const mins = Math.max(1, Math.round((resetMs - Date.now()) / 60000));
  const b = document.createElement("div");
  b.id = "rateBanner";
  b.className = "rate-banner";
  b.innerHTML = `GitHub API rate limit reached for your IP — live data will return in about <b>${mins} min</b>. Cached values are still shown where available.`;
  document.body.prepend(b);
}

/* ---------- renderers ---------- */
function slippageBadge(m) {
  if (m.status === "done") return "";
  const now = Date.now();
  const due = new Date(m.due + "T00:00:00Z").getTime();
  const days = Math.round((due - now) / 86_400_000);
  if (days > 0)  return `<span class="slip-badge ontime">due in ${days}d</span>`;
  if (days === 0) return `<span class="slip-badge ontime">due today</span>`;
  return `<span class="slip-badge late">${-days}d overdue</span>`;
}
function renderMilestones() {
  $("milestoneList").innerHTML = MILESTONES.map(m => `
    <li class="milestone ${m.status}">
      <div class="milestone-num">M${m.n}</div>
      <div>
        <h3>${m.title}</h3>
        <p>${m.desc}</p>
        <div class="milestone-tags">
          ${m.tags.map(t => `<span class="milestone-tag">${t}</span>`).join("")}
        </div>
      </div>
      <div class="milestone-meta">
        <b>${m.when}</b>
        ${m.budget}<br>
        <span class="status-badge ${m.status}">${STATUS_LABEL[m.status]}</span>
        ${slippageBadge(m)}
      </div>
    </li>
  `).join("");
}

function renderCountdown() {
  const days = Math.max(0, Math.round((MAINNET_TARGET.getTime() - Date.now()) / 86_400_000));
  $("cdDays").textContent = days.toLocaleString();
}

function renderSparkline(weeks) {
  // weeks: array of {week, total, days[]}
  if (!Array.isArray(weeks) || !weeks.length) return;
  const svg = $("sparkline");
  const W = 520, H = 56, gap = 1;
  const n = weeks.length;
  const barW = (W - gap * (n - 1)) / n;
  const max = Math.max(1, ...weeks.map(w => w.total));
  svg.innerHTML = weeks.map((w, i) => {
    const h = Math.max(1, (w.total / max) * (H - 4));
    const x = i * (barW + gap);
    const y = H - h;
    const d = new Date(w.week * 1000);
    return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${h.toFixed(2)}" rx="1" fill="currentColor" opacity="${0.35 + 0.65 * (w.total / max)}"><title>${d.toISOString().slice(0,10)} · ${w.total} commits</title></rect>`;
  }).join("");
}

async function fetchSparkline() {
  // Stats endpoints can return 202 while GitHub computes — retry briefly.
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${API}/repos/${REPO}/stats/commit_activity`, { headers: { Accept: "application/vnd.github+json" } });
    if (r.status === 202) { await new Promise(res => setTimeout(res, 1500)); continue; }
    if (!r.ok) return;
    const data = await r.json();
    renderSparkline(data);
    return;
  }
}

function renderAvatars(contributors) {
  const top = contributors.slice(0, 12).filter(c => c.login);
  $("avatarRow").innerHTML = top.map(c => `
    <a href="${c.html_url}" target="_blank" rel="noopener" title="${escapeHtml(c.login)} · ${c.contributions} commits">
      <img loading="lazy" src="${c.avatar_url}&s=64" alt="${escapeHtml(c.login)}" />
    </a>
  `).join("") || `<span class="muted">No contributors yet.</span>`;
}

async function renderReleases() {
  try {
    const { data } = await gh(`/repos/${REPO}/releases?per_page=5`);
    if (!data) { $("releaseList").innerHTML = `<li class="muted">Rate limited — try again later.</li>`; return; }
    if (!data.length) {
      $("releaseList").innerHTML = `<li class="muted">No tagged releases yet. <a href="https://github.com/${REPO}/tags" target="_blank" rel="noopener">View tags →</a></li>`;
      return;
    }
    $("releaseList").innerHTML = data.map(r => `
      <li>
        <a class="release-tag" href="${r.html_url}" target="_blank" rel="noopener">${escapeHtml(r.tag_name)}</a>
        <span class="release-name">${escapeHtml(r.name || "")}</span>
        <span class="commit-meta">${relTime(r.published_at)}${r.prerelease ? " · pre-release" : ""}</span>
      </li>
    `).join("");
  } catch (e) {
    $("releaseList").innerHTML = `<li class="muted">Could not load releases.</li>`;
  }
}

async function renderMetricsAndRepo() {
  try {
    const { data: repo } = await gh(`/repos/${REPO}`);
    if (!repo) return;
    $("m-stars").textContent     = fmt(repo.stargazers_count);
    $("m-forks").textContent     = fmt(repo.forks_count);
    $("m-open-issues").textContent = fmt(repo.open_issues_count);

    // languages
    const { data: langs } = await gh(`/repos/${REPO}/languages`);
    if (!langs) return;
    const total = Object.values(langs).reduce((a,b)=>a+b,0);
    $("stackList").innerHTML = Object.entries(langs)
      .sort((a,b)=>b[1]-a[1])
      .slice(0,6)
      .map(([name, bytes]) => {
        const pct = (bytes/total*100);
        return `<li><div style="flex:1">
          <div style="display:flex;justify-content:space-between"><span>${name}</span><b>${pct.toFixed(1)}%</b></div>
          <span class="stack-bar" style="width:${pct}%"></span>
        </div></li>`;
      }).join("");
  } catch (e) { console.error(e); }
}

async function renderCommits() {
  try {
    // total commit count via per_page=1 + Link last page
    const { data: commits } = await gh(`/repos/${REPO}/commits?per_page=15`);
    if (!commits) { $("commitList").innerHTML = `<li class="muted">Rate limited — try again later. View on <a href="https://github.com/${REPO}/commits" target="_blank" rel="noopener">GitHub →</a></li>`; return; }
    $("commitList").innerHTML = commits.map(c => `
      <li>
        <a class="commit-sha" href="${c.html_url}" target="_blank" rel="noopener">${c.sha.slice(0,7)}</a>
        <span class="commit-msg" title="${c.commit.message.replace(/"/g,'&quot;')}">${escapeHtml(c.commit.message.split("\n")[0])}</span>
        <span class="commit-meta">${escapeHtml(c.commit.author?.name || "—")} · ${relTime(c.commit.author?.date)}</span>
      </li>
    `).join("");

    // try to extract total commits count from a HEAD comparison fallback — cheaper: contributors
    const { data: contributors } = await gh(`/repos/${REPO}/contributors?per_page=100&anon=1`);
    if (!contributors) return;
    $("m-contributors").textContent = fmt(contributors.length);
    const totalCommits = contributors.reduce((a,c)=>a + (c.contributions||0), 0);
    $("m-commits").textContent = fmt(totalCommits);
    renderAvatars(contributors);
  } catch(e) { console.error(e); $("commitList").innerHTML = `<li class="muted">Could not load commits (rate-limited?). View on <a href="https://github.com/${REPO}/commits" target="_blank" rel="noopener">GitHub →</a></li>`; }
}

async function renderIssuesAndPRs() {
  try {
    const { data: prs }    = await gh(`/repos/${REPO}/pulls?state=open&per_page=10&sort=updated`);
    const { data: issues } = await gh(`/repos/${REPO}/issues?state=open&per_page=10&sort=updated`);
    if (!prs || !issues) {
      $("prList").innerHTML = $("issueList").innerHTML = `<li class="muted">Rate limited — try again later.</li>`;
      return;
    }
    const realIssues = issues.filter(i => !i.pull_request);
    $("m-open-prs").textContent = prs.length >= 10 ? `${prs.length}+` : fmt(prs.length);
    $("prList").innerHTML = prs.length ? prs.map(pr => `
      <li>
        <span class="issue-num">#${pr.number}</span>
        <a class="issue-title" href="${pr.html_url}" target="_blank" rel="noopener">${escapeHtml(pr.title)}</a>
        <span class="commit-meta">${relTime(pr.updated_at)}</span>
      </li>
    `).join("") : `<li class="muted">No open pull requests.</li>`;
    $("issueList").innerHTML = realIssues.length ? realIssues.map(i => `
      <li>
        <span class="issue-num">#${i.number}</span>
        <a class="issue-title" href="${i.html_url}" target="_blank" rel="noopener">${escapeHtml(i.title)}</a>
        <span class="commit-meta">${relTime(i.updated_at)}</span>
      </li>
    `).join("") : `<li class="muted">No open issues.</li>`;
  } catch (e) { console.error(e); }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

/* ---------- boot ---------- */
(async function init() {
  renderMilestones();
  renderCountdown();
  $("lastUpdated").textContent = new Date().toLocaleString();
  await Promise.all([
    renderMetricsAndRepo(),
    renderCommits(),
    renderIssuesAndPRs(),
    renderReleases(),
    fetchSparkline()
  ]);
})();
