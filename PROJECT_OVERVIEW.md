# Project Overview — Cardano Midgard Tracker

**Audience:** other AI agents (and humans) who need to understand this codebase quickly enough to make changes without breaking it. If you are about to edit a file, read this first.

**Live site:** <https://midgard-tracker.learncardano.io>
**Repo:** <https://github.com/pbwebdev/cardano-midgard-tracker>
**Maintainer:** Pete (`pbwebdev`), git identity `Pete <peter@pbwebdev.com.au>`. Use that identity for any commits made on his behalf.

---

## 1. What this site is

A one-page, public, independent **development tracker** for [anastasia-Labs/midgard](https://github.com/anastasia-Labs/midgard) — Cardano's first permissionless optimistic rollup Layer 2. Inspired visually by [engineering.iog.io/leios](https://engineering.iog.io/leios).

It exists to give the Cardano community a single accountable view of:

- The six promised milestones from Project Catalyst Fund 12 and the Cardano governance treasury action (combined ₳2,662,096 committed)
- Live development activity (commits, contributors, open PRs/issues) aggregated **across every branch** of the upstream Midgard repo, not just the default
- The ecosystem of projects building on or alongside Midgard (Sundial, BitcoinOS, Tesseract, Fairway)
- A countdown to the EOY 2026 mainnet target

Pete commissions tracker-style microsites like this regularly for Cardano-ecosystem projects. The architectural choices here are validated patterns intended for reuse — see [`DEVELOPMENT.md`](./DEVELOPMENT.md) for the replication checklist.

---

## 2. Tech stack

**Pure static HTML / CSS / JavaScript. No framework, no build step.**

| Layer | Choice | Notes |
| --- | --- | --- |
| Markup | Hand-written HTML5 in `index.html` | Single source of truth for the page |
| Styles | CSS, **fully inlined** inside `<style>` in `<head>` of `index.html` | No separate `styles.css` — inlining removed one render-blocking request and was the single largest FCP win. Edits go inside the `<style>` block. |
| Client JS | Vanilla ES2020+ in `app.js` | Plain functions and template strings, no JSX, no TS, no bundler. Loaded with `defer`. |
| Data refresh | Node 20 script `scripts/fetch-data.mjs` | Built-in `fetch`, no npm deps. Runs in GitHub Actions, writes `data.json`. |
| CI/CD | GitHub Actions (`.github/workflows/*`) | Pinned to commit SHAs for supply-chain safety. |
| Hosting | GitHub Pages | Static files only. |
| CDN / TLS / Cache | Cloudflare proxy in front of Pages | Custom subdomain via `CNAME`. |
| Analytics | GA4 + Cloudflare Web Analytics | Both **self-hosted** and **deferred-on-interaction** to keep them off the critical path. |
| Consent | Google Consent Mode v2 + a hand-rolled cookie banner | Default-denied, GDPR-safe. |

There is deliberately no React, no Tailwind, no TypeScript, no bundler. If you are tempted to introduce one, don't — the maintenance/perf cost is not justified for a single-page tracker that updates via a server-side cron.

---

## 3. File layout

```
cardano-midgard-tracker/
├── index.html                # The entire UI: markup, inline <style>, inline <script>s (cookie banner, easter egg)
├── app.js                    # All runtime logic — reads data.json, renders sections, parallax, video fade-in
├── data.json                 # Build-time GitHub API snapshot. Committed. Refreshed daily by Action.
├── sitemap.xml               # Static sitemap, references hero card image
├── robots.txt                # Allow all, points to sitemap
├── CNAME                     # midgard-tracker.learncardano.io
├── README.md                 # Public-facing project description
├── DEVELOPMENT.md            # Architecture + replication checklist
├── PROJECT_OVERVIEW.md       # This file
├── .gitignore                # Excludes .env*, *.pem, secrets.json, etc.
├── assets/
│   ├── hero-bg.webp          # Hero parallax background (preloaded, fetchpriority=high)
│   ├── twitter-card.webp     # OG / Twitter social card
│   ├── midgard-logo-48x48.webp
│   ├── pete.webp             # Easter-egg character
│   ├── sundial-logo.webp     # Self-hosted ecosystem partner logos
│   ├── bitcoinos-logo.webp
│   ├── tesseract-logo.webp
│   ├── fairway-logo.webp
│   ├── gtag.js               # Self-hosted Google Analytics snapshot (refresh quarterly)
│   ├── cf-beacon.js          # Self-hosted Cloudflare Web Analytics beacon
│   ├── favicon.ico, *.png, site.webmanifest
│   └── avatars/              # 22 contributor avatars (PNG, s=36). Refreshed daily by Action.
├── scripts/
│   └── fetch-data.mjs        # Node 20 script — pulls GitHub data + avatars, writes data.json
└── .github/workflows/
    ├── deploy.yml            # Static deploy to GitHub Pages on push to main
    └── fetch-data.yml        # Daily cron — runs fetch-data.mjs and commits diffs
```

---

## 4. Data flow

```
┌──────────────────┐  daily 06:00 UTC  ┌──────────────────────┐
│ anastasia-Labs/  │ ────────────────► │ fetch-data.yml       │
│ midgard (GitHub) │     authenticated │  → fetch-data.mjs    │
└──────────────────┘     GH API         └──────────┬───────────┘
                                                   │
                              writes data.json     │   downloads new avatars
                              + assets/avatars/*   │   (per-file 24h TTL)
                                                   ▼
                                          ┌────────────────────┐
                                          │ git commit + push  │
                                          │ → triggers deploy  │
                                          └─────────┬──────────┘
                                                    │
                                                    ▼
                                          ┌────────────────────┐
                                          │ deploy.yml         │
                                          │ → GitHub Pages     │
                                          └─────────┬──────────┘
                                                    │
                                                    ▼
                                          ┌────────────────────┐
                                          │ Cloudflare proxy   │
                                          │ midgard-tracker.   │
                                          │ learncardano.io    │
                                          └─────────┬──────────┘
                                                    │
                                                    ▼
                                          ┌────────────────────┐
                                          │ Visitor browser    │
                                          │ index.html + app.js│
                                          │ fetch(data.json)   │
                                          └────────────────────┘
```

**Critical property:** the visitor's browser **never** calls the GitHub API. All upstream data is pre-fetched server-side and baked into `data.json`. This means:

- No per-visitor rate limit can ever be tripped
- Data freshness is bounded by the cron cadence (currently daily, was hourly originally — upstream commit pace is low enough that daily is fine)
- The page works even if GitHub is down

**Multi-branch aggregation:** `fetch-data.mjs` enumerates every branch via `GET /repos/{repo}/branches` then fetches two pages of commits per branch and deduplicates by SHA. This gives a true "all branches" view because the Midgard team works across many parallel branches and any single-branch view understates progress. Approximate scale: ~1,800 unique commits across ~25 branches.

---

## 5. `index.html` structure

The file is large (~900 lines) because the CSS is inlined. Skim the section markers to navigate:

1. ASCII-art comment (Mesh With Us credits — must never be stripped by any future build step)
2. `<head>` — meta tags, OG / Twitter cards, JSON-LD `@graph`, preloads, preconnects, inline `<style>`, Consent Mode v2 init
3. `<header class="topbar">` — sticky brand + nav + GitHub CTA
4. `<main>`:
   - `.hero` with parallax `.hero-image` and EOY countdown
   - `.activity-strip` — sparkline + top contributor avatars, with the "all branches tracked" footnote
   - `#metrics` — six metric cards (commits / contributors / open PRs / open issues / stars / forks)
   - `#about` — three-benefit explainer for newcomers
   - `#milestones` — six milestones from Catalyst F12 + gov action with slippage badges
   - Two-col: FTE allocation + language stack
   - `#ecosystem` — partner cards (Sundial, BitcoinOS, Tesseract, Fairway + "your project here")
   - `#releases` — auto-populated from GitHub releases (currently empty state)
   - `#commits` — last 15 unique commits across all branches
   - `#issues` — open PRs + open issues, two columns
   - `#videos` — horizontal-snap carousel of curated YouTube embeds (thumbnails only, no iframe = no third-party cookies)
   - `#resources` — link grid (repo, gov action, Catalyst, spec PDF, social)
5. `<footer>` — credits + cookie-settings link + easter-egg padlock trigger
6. Cookie consent banner
7. Easter-egg `<aside id="petEgg" inert>` (Pete slides in from bottom-right on 5-padlock-clicks or typing "beware")
8. Three inline `<script>` blocks: cookie consent, easter egg, deferred analytics loader

---

## 6. `app.js`

Single IIFE-ish module loaded with `defer`. No top-level await.

| Function | Purpose |
| --- | --- |
| `MILESTONES` constant | Hard-coded milestone array. ISO `due` dates drive the slippage badge. **Edit here when milestones land/shift, never in HTML.** |
| `escapeHtml`, `safeUrl` | Defense-in-depth — every interpolated string goes through these. `safeUrl` blocks `javascript:` / `data:` schemes. |
| `renderMilestones` | Builds the milestone list with slippage pills |
| `renderCountdown` | EOY 2026 day counter |
| `renderMetrics`, `renderStack`, `renderCommits`, `renderAvatars`, `renderIssuesAndPRs`, `renderReleases` | Each renders one section from `data.json` |
| `renderSparkline` | 52-week SVG bar chart from `commitActivity` weekly buckets |
| Hero parallax IIFE | Mouse-driven `translate3d` on `.hero-image` with rAF lerping. Cached `innerWidth/Height` to avoid forced reflow. Disabled under `prefers-reduced-motion` and `(pointer: coarse)`. |
| Video fade-in IIFE | `IntersectionObserver` adds `.is-visible` to video thumbs when scrolled in |
| `init()` IIFE | Fetches `data.json` (with cache-busting), dispatches to renderers |

---

## 7. Deployment & hosting

### GitHub Pages

- Source: `main` branch, served as-is (no Jekyll, no build)
- Custom domain set via the `CNAME` file → `midgard-tracker.learncardano.io`
- HTTPS enforced
- Two workflows under `.github/workflows/`:
  - **`deploy.yml`** — fires on push to `main` and on manual dispatch. Uses `actions/checkout`, `actions/upload-pages-artifact`, `actions/deploy-pages`, all pinned to commit SHAs with `# vX.Y.Z` comments.
  - **`fetch-data.yml`** — daily cron at 06:00 UTC. Runs `node scripts/fetch-data.mjs` with `GITHUB_TOKEN` (authenticated, 1000 req/hr is plenty for ~50 calls). If `data.json` or any avatar changed, the workflow commits and pushes back to `main`, which in turn triggers `deploy.yml`.

### Cloudflare

The site sits behind Cloudflare on the `learncardano.io` zone (orange-cloud proxy on for the `midgard-tracker` CNAME). Cloudflare gives us:

- TLS termination and HTTP/3
- Edge caching with overrides set in **Page Rules** (legacy UI):
  - `midgard-tracker.learncardano.io/assets/*` → Browser Cache TTL: 1 year (filenames are content-stable, so long TTL is safe)
  - `midgard-tracker.learncardano.io/*` → Browser Cache TTL: 1 year (catch-all). Note: HTML and `data.json` are still respected by Cloudflare's origin headers; the Pages `max-age=600` keeps the edge from over-caching the dynamic root.
- Security response headers via **Transform Rules → Modify Response Header**:
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=()`
  - `Content-Security-Policy: upgrade-insecure-requests; block-all-mixed-content` (minimal — see DEVELOPMENT.md for the full version if tightening is needed)
- Web Analytics — **manually injected** via the self-hosted `assets/cf-beacon.js`, NOT via Cloudflare's automatic JS injection (which would defeat the self-hosting). If you re-enable auto-injection in CF, remove the manual loader to avoid double tracking.

To invalidate caches after a deploy, purge `midgard-tracker.learncardano.io` from Cloudflare (Caching → Configuration → Purge Everything for this hostname).

### Updating credentials and frozen third-party JS

- **No deploy keys or PATs are needed.** Workflows use the auto-provided `secrets.GITHUB_TOKEN`.
- **`assets/gtag.js`** is a frozen snapshot of `https://www.googletagmanager.com/gtag/js?id=G-38SC0LMJ06`. Refresh quarterly: `curl -fsSL "https://www.googletagmanager.com/gtag/js?id=G-38SC0LMJ06" -o assets/gtag.js && git commit -am "chore: refresh gtag.js"`.
- **`assets/cf-beacon.js`** is a frozen snapshot of `https://static.cloudflareinsights.com/beacon.min.js`. Same refresh pattern when Cloudflare ships updates.

---

## 8. Quality baselines (every change must preserve)

- **Lighthouse / PageSpeed** — Performance 95+, Accessibility 95+, Best Practices 100, SEO 100 (mobile and desktop)
- **WCAG 2.0 Level AA** — skip link, `:focus-visible` outline, `prefers-reduced-motion` honoured, alt text on every meaningful image, sufficient contrast, link distinguishability beyond colour (underlines on text-content links, `↗` indicator on external)
- **Security headers** — A+ on securityheaders.com
- **GDPR** — Consent Mode v2 default-denied, equally-prominent Accept and Reject
- **Cache rules** — assets cache long, `data.json` and root short

If a change would regress any of these, flag it and propose a mitigation rather than just shipping.

---

## 9. Things that look weird but are intentional

- **FluidTokens is not in the ecosystem section.** They had a falling out with Anastasia Labs over non-payment for Midgard work. Do not re-add unless Pete explicitly asks.
- **Catch-all `/*` Cloudflare cache rule with 1-year TTL.** It looks dangerous, but the origin's `Cache-Control: max-age=600` on HTML and `data.json` is what actually governs those resources at the edge. The 1-year browser TTL is the worst-case for visitors who came in once and never came back — acceptable trade-off for a low-traffic informational site.
- **GA and CF beacon both load deferred-on-interaction.** This is to keep them off the critical render path. It means very-quick bouncers (< first scroll/click) won't show up in analytics. Accepted trade-off.
- **Inline everything** (CSS, scripts) instead of separate files. Maintains worse than separate files, but kills one render-blocking request — that was the single biggest FCP win at the time of inlining. Don't undo.
- **The 🔒 padlock in the footer next to "Mesh With Us"** is an easter egg trigger, not a real lock or security feature.
- **Activity is aggregated across every branch** of the upstream Midgard repo, not just the default. The Midgard team explicitly asked for this — single-branch numbers misrepresent progress because they work in many parallel branches.

---

## 10. Where to make common changes

| You want to… | Edit |
| --- | --- |
| Update a milestone | `MILESTONES` array in `app.js`, not the HTML |
| Add/remove an ecosystem partner | Card markup in `#ecosystem` section of `index.html`, plus a new logo WebP in `assets/` |
| Tweak styling | The inline `<style>` block in `index.html` |
| Change the cron cadence | `cron:` line in `.github/workflows/fetch-data.yml` |
| Update meta description / OG card | `<head>` in `index.html` (description, OG, Twitter, JSON-LD all in one block) |
| Add a new section | Markup in `index.html` + matching render function in `app.js` + matching styles inline + (optional) nav link in topbar |
| Refresh Google Analytics script | `curl` command in section 7 of this doc |
| Change cache rules | Cloudflare dashboard → learncardano.io zone → Rules → Page Rules |
| Change security headers | Cloudflare dashboard → learncardano.io zone → Rules → Transform Rules → Modify Response Header |
