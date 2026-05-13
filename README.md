# Midgard Development Tracker

A one-page, Leios-inspired public tracker for [anastasia-Labs/midgard](https://github.com/anastasia-Labs/midgard) — Cardano's first permissionless optimistic rollup L2.

The site is **static HTML/CSS/JS**. There is no build step. All live data (commits, issues, PRs, contributors, stars, language breakdown) is fetched from the public GitHub REST API directly in the visitor's browser — so the site is always current without server infrastructure.

## Layout

- **Hero** — status, project description, links
- **Activity metrics** — commits, contributors, open PRs, open issues, stars, forks
- **Promised milestones** — six milestones from the Catalyst F12 proposal and the [Cardano governance action](https://www.cardanocube.com/governance/gov_actions/gov_action13tfag48nf94rtjcdq7c06vhkslmxxw9h6c88sl7q5g5nnewcsvlqqfgyy3v), with status, due dates and ADA budget
- **Work area allocation** — 8 FTE split from the Midgard Project Scope (Onchain 4, Offchain 2, DA 1, Node 0, Tx Builder 1, Testnet 0)
- **Tech stack** — language % from GitHub
- **Recent commits / open PRs / open issues** — live
- **Videos** — curated Midgard explainers from YouTube
- **Resources** — repo, gov action, Catalyst proposal, scope PDF, Anastasia Labs, X

## Auto-updates

Upstream Midgard commits show up automatically — `app.js` hits the GitHub API on every page load, so a visitor refreshing the page sees the latest data. **No redeploy is needed when the Midgard repo changes.**

`.github/workflows/deploy.yml` only runs when *this tracker repo* changes (push to `main`) or when you trigger it manually. If we later add build-time enrichment (baked changelogs, generated milestone progress, OG images), we can add a polling workflow that triggers redeploys on upstream commits — but it isn't needed today.

## Deploying

1. Create a new GitHub repo and push these files to `main`.
2. In **Settings → Pages**, set **Source = GitHub Actions**.
3. Push — `deploy.yml` will publish the site.
4. (Optional) Edit `app.js` if you want to point the tracker at a fork instead of `anastasia-Labs/midgard`.

## Local preview

```sh
# Any static server works.
python -m http.server 8080
# or
npx serve .
```

Then open <http://localhost:8080>.

## Notes / future ideas

- The unauthenticated GitHub API has a 60-req/hour limit per visitor IP. The page makes ~5 requests per load — fine for typical traffic. If you embed this in a high-traffic site, switch to a build-time prefetch and bake the JSON into the page.
- A commit-activity sparkline (using `/repos/{repo}/stats/commit_activity`) would be a nice next addition.
- Milestone progress could be auto-inferred from labelled GitHub issues / project board columns.

## Credits

- Brand cues (green tree-of-life mark, MIDGARD wordmark) from Anastasia Labs' public materials.
- Layout inspired by [engineering.iog.io/leios](https://engineering.iog.io/leios).

This is an **independent community tracker**, not affiliated with Anastasia Labs.
