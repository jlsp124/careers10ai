# careers10ai

Careers AI Desk is a small assignment support desk for Grade 10 careers-class file help. Students create lightweight accounts, upload assignment files with instructions, and later download finished files uploaded by an admin.

## Project Structure

- `docs/` contains the static GitHub Pages frontend.
- `worker/` contains the Cloudflare Worker backend.
- `worker/src/` contains Worker TypeScript source code.

## Frontend

GitHub Pages should serve the site from `docs/`.

Before publishing the frontend, update the `API_BASE` value at the top of both files:

- `docs/app.js`
- `docs/admin.js`

Use the deployed Worker URL, for example:

```js
const API_BASE = "https://careers10ai.jlsp124waitlist2026x7.workers.dev";
```

## Backend

The backend is deployed separately from `worker/` with Wrangler.

Cloudflare R2 stores uploaded and finished files. Cloudflare D1 stores request metadata, users, and file records.

Secrets must be set with `wrangler secret put` and must not be committed. Do not commit `.dev.vars`, `.env`, API tokens, passwords, Cloudflare account IDs, database IDs, bucket credentials, or deployment-specific origins.

The local `worker/wrangler.toml` file is intentionally gitignored. Use `worker/wrangler.toml.example` as the safe template.

The Worker expects these bindings:

- `DB` for Cloudflare D1 metadata.
- `CAREERS_FILES` for Cloudflare R2 file storage.
- `ADMIN_PASSWORD` set with `wrangler secret put`.
- `SESSION_SECRET` set with `wrangler secret put`.
- `ALLOWED_ORIGINS` configured in Wrangler vars.

## Deployment And Testing

See `DEPLOYMENT.md` for deployment commands and GitHub Pages setup.

See `TEST_PLAN.md` for the manual MVP acceptance test plan.
