# Developer notes — Cardano Midgard Tracker

This is the build playbook for this tracker, and a template for the next one. It captures *why* things are the way they are so future-you (or another agent) can move quickly without re-deriving the architecture.

---

## 1. What this site is

A static, single-page **development tracker** that mirrors the structure of [engineering.iog.io/leios](https://engineering.iog.io/leios) for a specific Cardano-ecosystem project.

It shows:
- Live GitHub activity for the upstream repo (commits, contributors, open PRs/issues, languages, stars, forks, 52-week sparkline)
- Hard-coded promised milestones with **due-date slippage badges** ("due in 12d" / "47d overdue")
- A countdown to the project's headline target (here, EOY 2026 mainnet)
- An ecosystem section listing publicly-named partners
- Curated videos
- Resources / external links

**It is independent.** Not affiliated with the project being tracked. The footer states this.

---

## 2. Stack

**Zero build step.** Pure HTML + CSS + vanilla JS, hosted on GitHub Pages.

```
index.html        single page — all markup, head metadata, structured data, GA, cookie banner
styles.css        single stylesheet, no preprocessor, CSS custom properties for theming
app.js            single script — milestone data, GitHub API client, all rendering
assets/           favicons, hero background, social card image
sitemap.xml       single-URL sitemap with image entry
robots.txt        allow-all + sitemap pointer
CNAME             custom domain (one line)
.github/workflows/deploy.yml   GitHub Pages deploy on push to main
```

### Why no build step
- The page reads live data from the GitHub REST API in the visitor's browser. Upstream commits show up on next refresh — no rebuild needed.
- A build step would add ops burden (Node, lockfile, CI minutes) without buying anything until traffic gets high enough to trip GitHub's 60-req/hour unauthenticated limit per visitor IP.
- See "Scaling up" below for when to flip to build-time fetching.

### CSS architecture
- One file, top-down. CSS custom properties in `:root` for `--bg`, `--panel`, `--border`, `--text`, `--muted`, `--accent`, `--accent-dim`, `--accent-fade`, `--radius`, `--max` (max-width), font stacks.
- Components are class-based (`.metric`, `.milestone`, `.eco-card`, etc.) — no BEM, no utility framework. Easy to copy a section between projects.
- Responsive via `@media (max-width: 900px)` and `820px` breakpoints. Mostly single-column collapse.

### JS architecture
`app.js` has four parts:

1. **Config + milestone data** (`REPO`, `MILESTONES`, `MAINNET_TARGET`). Hard-coded — this is the only place to edit when milestones move.
2. **`gh(path)` wrapper** — fetches GitHub REST with a versioned localStorage cache (10-min TTL, key prefix `gh:v2:`). Detects 403/429 rate limits and surfaces a sticky yellow banner with a countdown to reset time. Bump `CACHE_VERSION` if you change the shape of cached data.
3. **Renderers** — `renderMilestones`, `renderCountdown`, `renderMetricsAndRepo`, `renderCommits`, `renderIssuesAndPRs`, `renderReleases`, `fetchSparkline`, `renderAvatars`. Each is self-contained; failure of one doesn't break the others.
4. **`init()`** — runs once, kicks everything off in parallel via `Promise.all`.

---

## 3. Required components for every tracker site

These are non-negotiable baseline. Don't ship without them.

### Accessibility (WCAG 2.0 AA)
- `<a class="skip-link" href="#top">Skip to main content</a>` as the first body element
- `:focus-visible` outline in brand accent color across all interactive elements
- `@media (prefers-reduced-motion: reduce)` that nukes all transitions/animations
- Descriptive `alt` text on every meaningful image; `alt=""` only when image is purely decorative *and* a text label is adjacent
- Semantic landmarks: `<header>`, `<nav>`, `<main id="top">`, `<footer>`
- Heading hierarchy: one `h1` in the hero, `h2` per section, `h3` inside cards

### SEO
- `<link rel="canonical">` to the live URL
- Full Open Graph: `og:site_name`, `og:title`, `og:description`, `og:type`, `og:url`, `og:locale`, `og:image` (with `:secure_url`, `:type`, `:width=1200`, `:height=630`, `:alt`)
- Full Twitter Card: `twitter:card="summary_large_image"`, `:site`, `:creator`, `:title`, `:description`, `:image`, `:image:alt`
- JSON-LD `@graph` with **four nodes**: `WebSite`, `Organization` (publisher), `WebPage`, `SoftwareApplication` (the project being tracked, with `author` → Organization for the team building it, `codeRepository`, `programmingLanguage`, `sameAs`)
- `theme-color`, `color-scheme="dark"`, `robots="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"`
- `sitemap.xml` and `robots.txt` at the root
- The OG/Twitter image should be a real 1200×630 social card, not a reuse of the hero photo

### Analytics + GDPR
- GA4 via gtag.js
- **Google Consent Mode v2** with all four storage types defaulted to `denied` BEFORE the gtag.js script tag loads
- Read saved choice from `localStorage` *before* `gtag('js', ...)` so returning visitors don't get cookieless pings
- Cookie banner with **equally prominent** Accept all / Reject all buttons (CNIL guidance — no dark patterns)
- Persist choice in `localStorage` under a versioned key
- "Cookie settings" link in the footer to re-open the banner

### Favicon set
- `.ico`, 16x16, 32x32, apple-touch (180x180), android-chrome 192/512, and a `site.webmanifest`
- The manifest's `icons[].src` paths must be **relative** (`android-chrome-192x192.png`), not absolute (`/android-chrome-192x192.png`) — absolute paths 404 on GitHub Pages project sites
- Set `theme_color` to the project's accent color, `background_color` to the bg color

---

## 4. Page structure (in order)

1. **Sticky topbar** — brand mark (32×32 favicon image + wordmark) + nav links + green CTA pill linking to the upstream GitHub repo
2. **Hero** — full-bleed background image, status pill, h1 with `project / tagline`, lede paragraph with links, "last refreshed" timestamp, EOY countdown card
3. **Activity strip** — 52-week commit sparkline + top contributors avatar row (full-width band, no card)
4. **Metrics row** — 6 metric cards with brand-green left border (commits, contributors, open PRs, open issues, stars, forks)
5. **What is X?** — plain-English paragraph + 3 benefit cards with brand-tinted icon boxes (aimed at newcomers — mandatory)
6. **Promised milestones** — numbered list with slippage badges; source attribution shows combined funding total
7. **Work area allocation + Tech stack** — two-column: hard-coded FTE list + live language % bars
8. **Ecosystem** — partner cards with logo (favicon or `apple-touch-icon`) + role badge ("Building on" / "Partner") + 1-liner. Always end with a dashed "Your project here?" placeholder.
9. **Releases** — empty-state-friendly list of GitHub releases (most projects have none yet)
10. **Recent commits** — 15-row list with SHA, message, author, relative time
11. **Open PRs + Recent issues** — two-column
12. **Videos** — horizontal-scroll carousel showing 3 cards at a time on desktop, snap-scrolling
13. **Resources** — auto-fill grid of external link cards
14. **Footer** — independence disclaimer, source repo link, "Built with ❤️ on Cardano — a site by LearnCardano · Built by Mesh With Us", cookie settings link

---

## 5. How the data is wired

### Milestones (`MILESTONES` array in app.js)
Each entry has `n`, `title`, `desc`, `status` (`done`/`active`/`pending`), `when` (display string), `due` (ISO date), `budget`, `tags`. The `slippageBadge()` function compares `due` vs `Date.now()` and renders "due in Nd" (green) or "Nd overdue" (red). `status: 'done'` skips the slippage badge.

### GitHub API endpoints used
- `/repos/{repo}` — stars, forks, open_issues_count
- `/repos/{repo}/languages` — tech stack bars
- `/repos/{repo}/commits?per_page=15` — recent commits list
- `/repos/{repo}/contributors?per_page=100&anon=1` — total contributor count, total commit count (sum of `contributions`), avatar row
- `/repos/{repo}/pulls?state=open&per_page=10&sort=updated` — open PRs
- `/repos/{repo}/issues?state=open&per_page=10&sort=updated` — open issues (filter out items with a `pull_request` field)
- `/repos/{repo}/releases?per_page=5` — tagged releases
- `/repos/{repo}/stats/commit_activity` — 52-week sparkline (this endpoint may return `202 Accepted` on the first call while GitHub computes the stats — retry with backoff)

### Rate-limit handling
Unauthenticated GitHub API = 60 req/hour per IP. The page makes ~7 calls per uncached visit. The 10-min localStorage cache means a returning visitor pays 0. If a 403 comes back, `showRateLimitBanner()` reads `x-ratelimit-reset`, computes minutes until reset, and renders a sticky yellow banner.

---

## 6. Replicating this for a new project — checklist

When Pete commissions another tracker like this:

- [ ] **Fork or copy** this repo to `pbwebdev/cardano-<project>-tracker`
- [ ] Update `REPO` constant in `app.js` to the upstream GitHub repo
- [ ] Replace `MILESTONES` array with the new project's milestones (extract from Catalyst proposal + governance action PDF)
- [ ] Update `MAINNET_TARGET` (or rename to the relevant target date)
- [ ] Replace `assets/favicon*`, `assets/android-chrome-*`, `assets/apple-touch-icon.png`, `assets/hero-bg.jpg`, `assets/twitter-card.png`
- [ ] Update brand accent colors in `:root` of styles.css to match the project's visual identity
- [ ] Update wordmark text + nav labels in the topbar
- [ ] Update hero h1, lede, and links
- [ ] Rewrite the "What is X?" three-card section for the new project
- [ ] Rewrite ecosystem cards — only include publicly-confirmed partners (and check for any falling-outs before listing co-developers)
- [ ] Curate 3–4 YouTube videos
- [ ] Update Resources cards (Catalyst proposal URL, gov action URL, scope PDF, team site, X account)
- [ ] Search-and-replace `midgard-tracker.learncardano.io` → new subdomain everywhere (canonical, OG, JSON-LD, sitemap, robots, CNAME)
- [ ] Search-and-replace `G-38SC0LMJ06` → new GA4 property ID
- [ ] Update `og:image` / Twitter card to the new social card (1200×630)
- [ ] Update JSON-LD: change `SoftwareApplication` node's `name`, `description`, `codeRepository`, `programmingLanguage`, `author`, `sameAs`
- [ ] Update social handles in `twitter:site` and `twitter:creator`
- [ ] Bump `CACHE_VERSION` in app.js to `v1` (fresh repo, fresh cache namespace)
- [ ] Update the Mesh With Us ASCII art comment if there's a project codename (don't remove the attribution)
- [ ] Update `README.md` and this `DEVELOPMENT.md`'s opening paragraph
- [ ] Create the GA4 property + cookie banner test (Accept / Reject paths both work)
- [ ] Set up the GitHub repo: push, enable Pages with Source = "GitHub Actions"
- [ ] Add the CNAME DNS record at the registrar pointing the subdomain to `pbwebdev.github.io`
- [ ] After DNS resolves, enable "Enforce HTTPS" in the Pages settings
- [ ] Submit `sitemap.xml` to Google Search Console + Bing Webmaster
- [ ] Validate: rich results test, Twitter card validator, OpenGraph debugger

---

## 7. Things deliberately not done (and why)

- **No JS framework, no bundler, no TypeScript.** A static page that lives 2+ years and is maintained occasionally is hostile to framework churn. Vanilla doesn't break.
- **No build-time GitHub fetching (yet).** Acceptable while audience is small. Switch when *visible* visitor count grows past ~50/hour or when API rate limit banners start showing for real users — at that point, add a scheduled Action that hits the API server-side and writes the responses into a JSON file the page reads.
- **No upstream watcher workflow.** Originally had one polling the upstream repo's HEAD SHA and dispatching deploys. Removed at Pete's instruction once we confirmed live client-side fetching makes it redundant. Re-add it only when introducing build-time enrichment (changelog generation, OG image generation per commit, etc.).
- **No privacy policy page.** Audience is small (1–2/day); Consent Mode v2 + the banner is proportionate. Add a stub if audience grows or if a regulator asks.
- **No CMS.** Milestones, ecosystem, videos, copy all live in source. Each project change = one PR. This is a feature, not a bug — there's no untracked content.

---

## 8. Maintenance triggers

| Event | What to update |
|---|---|
| Upstream milestone shipped | Flip `status` to `"done"` in `MILESTONES` |
| Upstream milestone date slips | Update `when` and `due` |
| New ecosystem partner publicly announced | Add `<a class="eco-card">` block, get logo URL (favicon or apple-touch-icon from their site) |
| Ecosystem partner drops out / dispute | Remove the card entirely — do not leave a struck-through entry |
| Project reaches mainnet | Update `MAINNET_TARGET` to the next horizon (or remove the countdown), update status pill, update the "What is X?" lede |
| New explainer video released | Replace the weakest of the existing 4 in the video grid |
| GitHub API surface shape changes | Bump `CACHE_VERSION` to invalidate stale client caches |
