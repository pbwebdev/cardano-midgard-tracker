/* Midgard Tracker — reads from data.json, a build-time snapshot of the
   GitHub API refreshed hourly by .github/workflows/fetch-data.yml.
   No browser-side API calls = no per-visitor rate limit. */

const DATA_URL = "data.json";

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
const STATUS_LABEL   = { done: "Completed", active: "In progress", pending: "Pending" };
const REPO_SLUG      = "anastasia-Labs/midgard";

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
const fmt = (n) => Intl.NumberFormat("en", { notation: n >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n);
const relTime = (iso) => {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  const units = [["y",31536000],["mo",2592000],["d",86400],["h",3600],["m",60]];
  for (const [u, v] of units) if (s >= v) return `${Math.floor(s/v)}${u} ago`;
  return "just now";
};
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

/* ---------- renderers ---------- */
function slippageBadge(m) {
  if (m.status === "done") return "";
  const due = new Date(m.due + "T00:00:00Z").getTime();
  const days = Math.round((due - Date.now()) / 86_400_000);
  if (days > 0)   return `<span class="slip-badge ontime">due in ${days}d</span>`;
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

function renderAvatars(contributors) {
  const top = (contributors || []).slice(0, 12).filter(c => c.login);
  $("avatarRow").innerHTML = top.map(c => `
    <a href="${c.html_url}" target="_blank" rel="noopener" title="${escapeHtml(c.login)} · ${c.contributions} commits">
      <img loading="lazy" src="${c.avatar_url}&s=64" alt="${escapeHtml(c.login)}" />
    </a>
  `).join("") || `<span class="muted">No contributors yet.</span>`;
}

function renderMetrics(d) {
  const r = d.repo || {};
  $("m-stars").textContent       = fmt(r.stargazers_count ?? 0);
  $("m-forks").textContent       = fmt(r.forks_count ?? 0);
  $("m-open-issues").textContent = fmt(r.open_issues_count ?? 0);
  $("m-contributors").textContent = fmt(d.contributors?.length ?? 0);
  const totalCommits = (d.contributors || []).reduce((a,c) => a + (c.contributions||0), 0);
  $("m-commits").textContent = fmt(totalCommits);
  $("m-open-prs").textContent = (d.prs?.length ?? 0) >= 10 ? `${d.prs.length}+` : fmt(d.prs?.length ?? 0);
}

function renderStack(langs) {
  if (!langs) return;
  const total = Object.values(langs).reduce((a,b)=>a+b,0);
  $("stackList").innerHTML = Object.entries(langs)
    .sort((a,b)=>b[1]-a[1])
    .slice(0,6)
    .map(([name, bytes]) => {
      const pct = (bytes/total*100);
      return `<li><div style="flex:1">
        <div style="display:flex;justify-content:space-between"><span>${escapeHtml(name)}</span><b>${pct.toFixed(1)}%</b></div>
        <span class="stack-bar" style="width:${pct}%"></span>
      </div></li>`;
    }).join("");
}

function renderCommits(commits) {
  if (!commits?.length) { $("commitList").innerHTML = `<li class="muted">No commits yet.</li>`; return; }
  $("commitList").innerHTML = commits.map(c => `
    <li>
      <a class="commit-sha" href="${c.html_url}" target="_blank" rel="noopener">${c.sha.slice(0,7)}</a>
      <span class="commit-msg" title="${escapeHtml(c.message)}">${escapeHtml(c.message.split("\n")[0])}</span>
      <span class="commit-meta">${escapeHtml(c.authorName || "—")} · ${relTime(c.authorDate)}</span>
    </li>
  `).join("");
}

function renderIssuesAndPRs(prs, issues) {
  $("prList").innerHTML = (prs && prs.length) ? prs.map(pr => `
    <li>
      <span class="issue-num">#${pr.number}</span>
      <a class="issue-title" href="${pr.html_url}" target="_blank" rel="noopener">${escapeHtml(pr.title)}</a>
      <span class="commit-meta">${relTime(pr.updated_at)}</span>
    </li>
  `).join("") : `<li class="muted">No open pull requests.</li>`;

  $("issueList").innerHTML = (issues && issues.length) ? issues.map(i => `
    <li>
      <span class="issue-num">#${i.number}</span>
      <a class="issue-title" href="${i.html_url}" target="_blank" rel="noopener">${escapeHtml(i.title)}</a>
      <span class="commit-meta">${relTime(i.updated_at)}</span>
    </li>
  `).join("") : `<li class="muted">No open issues.</li>`;
}

function renderReleases(releases) {
  if (!releases?.length) {
    $("releaseList").innerHTML = `<li class="muted">No tagged releases yet. <a href="https://github.com/${REPO_SLUG}/tags" target="_blank" rel="noopener">View tags →</a></li>`;
    return;
  }
  $("releaseList").innerHTML = releases.map(r => `
    <li>
      <a class="release-tag" href="${r.html_url}" target="_blank" rel="noopener">${escapeHtml(r.tag_name)}</a>
      <span class="release-name">${escapeHtml(r.name || "")}</span>
      <span class="commit-meta">${relTime(r.published_at)}${r.prerelease ? " · pre-release" : ""}</span>
    </li>
  `).join("");
}

/* ---------- boot ---------- */
(async function init() {
  renderMilestones();
  renderCountdown();

  let data = null;
  try {
    // Bypass HTTP cache so we always pick up the freshest hourly snapshot.
    const r = await fetch(`${DATA_URL}?t=${Math.floor(Date.now() / 60000)}`, { cache: "no-store" });
    if (r.ok) data = await r.json();
  } catch (e) { console.error("Failed to load data.json", e); }

  if (!data) {
    const banner = document.createElement("div");
    banner.className = "rate-banner";
    banner.innerHTML = `Couldn't load <code>data.json</code> — live activity is unavailable. Try again in a few minutes.`;
    document.body.prepend(banner);
    $("lastUpdated").textContent = "—";
    return;
  }

  $("lastUpdated").textContent = new Date(data.fetchedAt).toLocaleString();

  renderMetrics(data);
  renderStack(data.languages);
  renderCommits(data.commits);
  renderAvatars(data.contributors);
  renderIssuesAndPRs(data.prs, data.issues);
  renderReleases(data.releases);
  renderSparkline(data.commitActivity);
})();
