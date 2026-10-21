# SavvyShop Backend — Project State

> **Repo:** https://github.com/wmabra/savvyshop-backend · **Branch:** `master` · **Local path:** `~/savvyshop-backend`
> **Fresh-machine resume:** `git clone && npm install && npm start` (Puppeteer downloads Chromium on install).
> **Last updated:** 2026-10-21 · **Last code change:** 2026-10-05 · **Status:** works locally; Render deploy path configured but **not verified from a clean clone**

## What this is

The comparison/scoring **service** behind the SavvyShop Chrome extension
(`wmabra/savvyshop-extension`). A small Express API that takes a product and returns
cross-retailer comparison + scoring data.

## Stack

- **Express** + **Puppeteer** (headless Chromium) — chosen for Render compatibility
- `node server.js` (default port per `server.js`), `package.json` v1.0.0
- `.puppeteerrc.cjs` pins the Chromium cache location so Render keeps the browser across builds

## Run locally

```bash
cd ~/savvyshop-backend
npm install          # downloads Chromium
npm start            # → Express on the configured port
```

## Deploy

Targeted at **Render** (hence the Puppeteer swap away from Playwright in `6070a7b` and the
`puppeteerrc.cjs` in `fb2a578`). No `render.yaml` is committed — the service was configured
on the Render dashboard. If you redeploy, note that Render's free tier has a small disk and
Chromium needs headroom; the `PUPPETEER_CACHE_DIR` in `.puppeteerrc.cjs` is what makes that work.

## History

| Commit | Change |
| --- | --- |
| `292053b` | Original: Playwright + Express comparison service |
| `6070a7b` | **Switched to Puppeteer** for Render compatibility |
| `fb2a578` | Added `.gitignore`, `.puppeteerrc.cjs`, lockfile; server update (current) |

## Not in the repo

`.cache/` and `node_modules/` (609 MB locally) are gitignored. Nothing secret is needed —
there is no `.env` and no API key in the code path.

## Gotchas

- **`npm install` is slow and large** (~600 MB) because it bundles Chromium. On a fresh machine expect several minutes.
- Scraping depends on live retailer markup; when a retailer changes their DOM the comparison silently degrades rather than erroring. Verify against a real product URL after any deploy.
- There is no test suite. The fastest smoke test is one real comparison request against a Target/Amazon URL.

## Next steps

1. Add `render.yaml` so the deploy is reproducible from the repo.
2. Add a health endpoint check + one recorded-fixture test so DOM changes surface as failures.
3. Confirm the extension's API base URL matches wherever this is actually deployed.
