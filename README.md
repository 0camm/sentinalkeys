# Sentinel keys

- Repo root has one folder for each deploy target: `public/` (Cloudflare Pages) and `backend/` (Render).
- Delete every other file/folder in the GitHub repo before pushing this — do not merge it on top of the old structure.

## Render

- Root Directory: backend
- Build Command: npm install
- Start Command: npm start
- Env vars: see backend/.env.example

## Cloudflare Pages

- Root directory: leave blank
- Build command: leave blank
- Build output directory: public
- Edit public/config.js with your real Render URL before first deploy
