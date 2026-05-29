# careers10ai

Clean scaffold for a GitHub Pages frontend and a Cloudflare Worker backend.

## Project structure

- `docs/` contains the static frontend served by GitHub Pages.
- `worker/` contains the Cloudflare Worker backend.
- `worker/src/` contains Worker TypeScript source code.

## Frontend

GitHub Pages should be configured to serve from the `docs/` folder. The full frontend application has not been built yet.

## Backend

The backend is deployed separately from `worker/` with Wrangler.

Secrets must be set with `wrangler secret put` and must not be committed. Do not commit `.dev.vars`, `.env`, API tokens, passwords, Cloudflare account IDs, database IDs, bucket credentials, or deployment-specific origins.

Cloudflare R2 will store uploaded files. Cloudflare D1 will store metadata.

## Worker commands

From `worker/`:

```sh
npm install
npm run dev
npm run deploy
npm run db:schema
```

Copy `wrangler.toml.example` to `wrangler.toml` for local deployment configuration, then replace placeholders locally.
