# ISM Field — Phase 1 PWA MVP

Single-file Progressive Web App for field techs. Works on iPhone/Android via browser. Install as a "home screen app" for full-screen experience.

## What it does (Phase 1)

- **Sign in** with username + password (same accounts as desktop app)
- **View today's schedule** filtered to the logged-in tech
- **Tap a job** to see full details: customer info (tap-to-call), property + map link, tank info
- **Mark complete** with actual gallons + notes
- **Offline indicator** (banner appears when offline)

## What it does NOT do yet (Phase 2 / 3)

- Photos / signature capture
- True offline (works only online for now)
- Disposal log
- Push notifications

## How to use right now (testing)

### Option A — Run locally on your dev PC

1. Open a terminal in this folder: `cd field-pwa`
2. Start a tiny HTTP server: `npx --yes http-server -p 8080`
3. On phone (must be on same Wi-Fi), open `http://<your-PC-IP>:8080/`
4. Tap browser menu → "Add to Home Screen" to install as PWA

### Option B — Deploy to Vercel (recommended)

1. Push to GitHub (already done — `field-pwa/` folder in the repo)
2. On vercel.com: New Project → import this repo → Root Directory = `field-pwa` → Deploy
3. Get a `.vercel.app` URL; can later add a custom subdomain like `field.interstateseptic.com`
4. Techs visit the URL on their phone, log in, tap "Add to Home Screen"

## Login credentials

Same as desktop app. Tech accounts already exist:
- chris.bissonnette / Issi5646
- clyde.collins / Issi5646
- (etc — see desktop Cloud Users panel)

## Architecture notes

- Single HTML file, ~600 lines. Loads Supabase JS from CDN (`esm.sh/@supabase/supabase-js@2`).
- Supabase URL + anon key are baked into the HTML (safe — RLS protects access).
- Auth session persists in browser localStorage (key: `ism-field-session`). Survives page reloads.
- Tech-role users see only their own assigned jobs (RLS enforces this).
- `data` jsonb on the `jobs` table stores `actual_gallons` and `tech_notes` from the field.

## Roadmap (per `PWA_PLAN.md` in repo root)

**Phase 1** (this file) — sign in, view schedule, mark complete. ✓ Done.
**Phase 2** — Photos (camera API), signature pad, IndexedDB offline cache, sync queue, install-as-PWA prompt, manifest icons, service worker.
**Phase 3** — Disposal log, GPS stamp, push notifications, biometric unlock, "who's on the road today" coordination view.

For Phase 2+, this single-file MVP should be migrated to Vite + Svelte (per the plan) for maintainability.
