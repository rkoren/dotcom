# dotcom

Personal project portal. Static site on AWS Amplify, one page per project.

## Architecture: the publish contract

The portal reads **public HTTPS JSON only**. It never imports project code, never runs a
pipeline at build time, and never needs AWS credentials at runtime. Each project publishes
its own JSON on its own schedule; this repo just renders it.

A broken scraper must degrade one page to an error message — it must never fail a deploy.

## No build step

Plain HTML, CSS, vanilla JS. No framework, no bundler, no package.json, no node_modules.
`amplify.yml` has empty build commands and serves `site/` directly.

**This is deliberate, not unfinished.** Don't add Vite/React/Tailwind. Don't add an SPA
rewrite rule — pages are real .html files, and a `/<*>` → `/index.html` rewrite (which the
old dimaggio-watch app used) would mask genuine 404s.

Styling is intentionally barebones 2000s HTML for now. Restyling is a later, separate pass.

## Data sources

| Page | URL |
|---|---|
| /dimaggio | `https://dimaggio-watch-data-674325521451.s3.us-east-1.amazonaws.com/streaks.json` |
| /v2f | `s3://v2f-674325521451-us-east-1-an/v2f/public/…` (public prefix only) |
| /cbb | `s3://reilly-cbb-model-data/public/…` (public prefix only) |

Bucket policies are scoped to the `public/` prefix. **Never open these buckets wholesale:**
`reilly-cbb-model-data` is the DVC remote + MLflow history, `v2f/raw/` is scraped payloads.

## ⚠️ dimaggio-watch: retire the app, never the data stack

`/dimaggio` consumes `streaks.json`. The Lambda `dimaggio-watch-refresh`, its three
EventBridge rules (`-quick`/`-live`/`-full`), the S3 bucket, and the `dimaggio-watch-data`
CloudFormation stack **must keep running**. Only the Amplify app `dbw7nhc4vlkk0` and the
`dimaggiowatch.com` domain get retired.

Also: the committed `dimaggio-watch/site/data/streaks.json` is schema-stale (11 keys vs the
live payload's 15). Build against the live URL, never that file.

## Every page needs three states

`loading` · `error` (show the URL that failed — never a blank page) · `generatedAt` rendered
as "updated 4m ago" so a dead pipeline is visible. `site/lib.js` provides all three.

## Tests

A local-only suite lives at `./tests/run.sh` (gitignored, so it won't be in a
fresh clone). Plain node, no deps. Syntax-checks every script and exercises the
render / error / pending paths against a recorded payload. If you have it, keep
it passing and extend it when a page gains a real data source.

## Working agreement

- **No commits or pushes without explicit approval.**
- After initial setup, all work happens on branches off `main`.

## AWS

Account `674325521451`, region `us-east-1`, profile `default`.
Amplify app: _(not yet created)_.
Domain: `*.amplifyapp.com` for now. `rkoren.com` was available at $16/yr and deferred.
