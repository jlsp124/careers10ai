# Deployment

This project deploys in two parts:

- GitHub Pages serves the static frontend from `docs/`.
- Cloudflare Workers serves the backend from `worker/`.

Do not commit secrets, `.dev.vars`, `.env`, or the local `worker/wrangler.toml` file. Keep real Cloudflare IDs in local config only.

## Backend Deploy

Run these from Windows Command Prompt. Commands that require Cloudflare credentials are documented here but should only be run from an authenticated local machine.

```bat
cd /d "%USERPROFILE%\careers10ai\worker"
npm install
npx wrangler login
npx wrangler r2 bucket create careers10ai-files
npx wrangler d1 execute careers10ai-db --remote --file=./schema.sql
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
npx wrangler deploy
```

The local `worker/wrangler.toml` should use:

- Worker name: `careers10ai`
- D1 binding: `DB`
- D1 database name: `careers10ai-db`
- R2 binding: `CAREERS_FILES`
- R2 bucket name: `careers10ai-files`
- `ALLOWED_ORIGINS` with the GitHub Pages and localhost origins

The tracked `worker/wrangler.toml.example` must keep a placeholder `database_id`.

## Frontend Deploy

After the Worker is deployed, update `API_BASE` at the top of:

- `docs/app.js`
- `docs/admin.js`

Set it to the deployed Worker URL.

## Git Commands

```bat
cd /d "%USERPROFILE%\careers10ai"
git status
git add .
git commit -m "Build careers10ai MVP"
git push -u origin mvp-build
```

## GitHub Pages Setup

In GitHub:

Repo Settings -> Pages -> Deploy from branch -> mvp-build -> /docs

Or merge `mvp-build` into `main`, then use:

Repo Settings -> Pages -> Deploy from branch -> main -> /docs
