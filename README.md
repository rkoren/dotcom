# dotcom

Personal project portal — a static site that renders public JSON published by my
other projects.

Live at: https://main.d8uzh33r2jpoz.amplifyapp.com

## What's here

| Page | Project | Source |
|---|---|---|
| `/dimaggio` | [dimaggio-watch](https://github.com/rkoren/dimaggio-watch) | live |
| `/cbb` | [cbb-model](https://github.com/rkoren/cbb-model) | pending |
| `/v2f` | vegas-to-fantasy | pending |

## Local development

```sh
python3 -m http.server 8000 --directory site
```

Pages fetch public cross-origin JSON, so this exercises the real CORS path — no
proxy or mocks needed.

## Design

No build step: plain HTML, CSS and vanilla JS, served straight from `site/`.
Each project publishes its own JSON on its own schedule; this repo only renders
it, so a broken scraper degrades one page instead of failing a deploy.

See [CLAUDE.md](./CLAUDE.md) for the full contract.
