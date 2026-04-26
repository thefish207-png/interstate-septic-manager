# Field Tech PWA — Architecture Plan

## TL;DR

**Stack:** Vite + Svelte 5 + TypeScript + Supabase JS + Workbox (offline) + Dexie (IndexedDB).
**Hosting:** Vercel free tier on `field.interstateseptic.com` subdomain.
**MVP:** ~30 hours to ship a working "view schedule + mark complete" version.
**Full v1:** ~85-120 hours total across 3 phases.

---

## Stack Justification

**Svelte over React/Vue:** smallest mental load for a solo dev. ~15 KB runtime vs React's 45 KB matters on flaky LTE in midcoast Maine. Reactivity is synchronous which pairs cleanly with Dexie cache.

**Vite + vite-plugin-pwa:** wires up Workbox + manifest + install prompts in one config block.

**Dexie (IndexedDB wrapper):** standard pattern for offline-first PWAs.

**Shared types with desktop app:** generate from Supabase schema (`supabase gen types`) into a `shared/` folder used by both projects. Same field names and shapes everywhere.

---

## Architecture

### File structure
```
field-pwa/
  vite.config.ts
  src/
    main.ts                # mount + register service worker
    app.svelte             # router shell + auth guard
    routes/
      login.svelte
      schedule.svelte      # today's jobs
      job/[id].svelte      # job detail (read)
      job/[id]/complete.svelte
      property/[id]/history.svelte
      disposal.svelte
      settings.svelte
    lib/
      supabase.ts          # client + auth helpers
      db.ts                # Dexie schema (cache + sync queue)
      sync.ts              # background sync drain
      realtime.ts          # subscribe to schedule_items / jobs / day_notes
      camera.ts            # getUserMedia + canvas compress
      signature.ts         # canvas pad → PNG blob
      stores/              # Svelte stores: session, schedule, online
    components/
      JobCard.svelte
      SignaturePad.svelte
      PhotoCapture.svelte
      OfflineBanner.svelte
  public/
    manifest.webmanifest
    icons/                 # 192, 512, maskable, apple-touch
  shared/                  # symlink/submodule with desktop app
    types.ts
    formatters.ts
```

### Auth
- Supabase email/password using existing tech accounts.
- Session in localStorage (Supabase JS handles refresh-token rotation).
- 30-day TTL — techs shouldn't re-auth daily.
- Phase 3: WebAuthn / biometric unlock layer (passkeys on iOS, fingerprint on Android).

### Offline strategy
- **Workbox:** precache app shell, runtime-cache Supabase REST GETs (stale-while-revalidate).
- **Dexie:** mirror `schedule_items`, `jobs`, `customers`, `properties`, `tanks`, `day_notes` + 12mo job history per property on this week's route.
- **Sync queue:** every mutation writes to Dexie `pending_ops` table. A `sync.ts` worker drains when `navigator.onLine` flips true and on a 30s interval.
- **Conflict policy:** last-write-wins on `schedule_items.actual_gallons`/`tech_notes`. Realistic — only one tech edits a job. Toast if server `updated_at` is newer than local base.
- **Initial sync on login:** today + next 7 days of schedule + assigned customers/properties/tanks + 12mo history.

### Realtime
- Subscribed only while app is foregrounded.
- Channels: `schedule_items` filtered to (assigned_to=me OR truck_id=mytruck), `day_notes` for today, `jobs` for properties on today's route.
- Patches Dexie + notifies Svelte stores. Throttled.

---

## Screens (MVP scope)

1. **Login** — email + password, "Remember me" on by default. Big touch targets. Shows last-sync timestamp if returning offline.
2. **Today's Schedule** — vertical job-card list ordered by route position. Each: customer, address, tank type, scheduled time, status. Pull-to-refresh. Header shows today's truck + teammates.
3. **Job Detail** — customer + property block, tank specs (size, type, last pumped, last volume), property notes, deep-link to Maps. "Start Job" → flips status to in-progress.
4. **Complete Job** — gallons (numeric pad), notes, 1-4 photos, signature, optional GPS stamp. "Mark Complete" → sync queue → toast → back to schedule.
5. **Property History** — reverse-chronological past jobs at this property (date, gallons, tech, notes excerpt).
6. **Disposal Log** — quick-add form (date, gallons, manifest #, photo of manifest, destination=Juniper Ridge). Recent loads listed below.
7. **Settings/Profile** — name, today's truck (read-only), force-resync, storage usage, sign out, GPS toggle, app version, last sync time.
8. **Offline indicator** (global) — thin bar when offline showing pending sync count.

---

## Hosting

- **Vercel free tier**: HTTPS, edge CDN (fast first-load on Maine cell towers), preview deploys per branch, GitHub auto-deploy on push to main.
- **Subdomain**: `field.interstateseptic.com` or whatever the company domain is. Vercel handles DNS + cert.
- **HTTPS mandatory**: service workers, camera, GPS, Add-to-Home-Screen all require it.

---

## Implementation Phases

### Phase 1 — MVP (online-only) [~30 hrs]
- Vite + Svelte + Supabase scaffolding
- Login screen
- Today's schedule (live fetch, no cache)
- Job detail (read-only)
- Complete job: gallons + notes only (no photos/sig yet)
- Deploy to Vercel + custom subdomain
- Field test with 2 techs for one week

### Phase 2 — Offline + media [~50 hrs]
- vite-plugin-pwa + manifest + Add-to-Home-Screen prompt
- Service worker app-shell precaching
- Dexie cache + sync queue
- Photo capture (camera API + ~500KB JPEG compress)
- Signature pad
- Property history screen
- Realtime subscriptions
- Offline banner + pending-ops counter

### Phase 3 — Disposal + polish [~25 hrs]
- Disposal log + manifest photo upload to Supabase Storage
- GPS location stamp (opt-in)
- Settings screen
- Biometric/passkey unlock
- Web Push notifications (via Supabase Edge Function)
- "Who else is working today" coordination view

---

## Risks

1. **iOS PWA limits** — Safari caps IndexedDB at ~1GB and evicts after 7 days of non-use. Mitigation: cheap re-sync on launch + prompt Add-to-Home-Screen (extends storage policy).
2. **Photo storage cost** — 4 photos/job × 50 jobs/week × 4 trucks = ~800/wk. At 500KB ≈ 1.6GB/month. Supabase free tier is 1GB; budget Pro tier ($25/mo for 100GB).
3. **RLS gaps** — verify `disposal_loads` insert allowed for tech role. Confirm `actual_gallons`/`tech_notes` columns exist on `schedule_items` (may need migration).
4. **Realtime cost** — 15 phones × 3 channels = 45 concurrent connections. Within Supabase Pro limits, monitor.
5. **Signature legal validity** — talk to a lawyer if they ever become invoice-grade signatures.
6. **Truck assignment source of truth** — confirm techs are assigned to a truck for each day in `truck_day_assignments` table.
7. **Camera permission on iOS** — must be triggered from user gesture; first denial is sticky. Onboarding should request explicitly with explanation.
8. **Background Sync API** — Chrome yes, Safari no. Fallback: sync on foreground + every 30s while open + on `online` event.
9. **Shared types** — git submodule fragile; symlink works dev-only. Cleanest: private npm package OR pre-build copy script. Decide before Phase 2.
10. **Time zone** — `scheduled_date` is `date` type. Make sure local-time formatting doesn't shift the day on phones set to non-Eastern TZ.

---

## Recommendation

Start Phase 1 immediately after the desktop app is stable. Ship MVP within 30 hours of focused work. Get 2 techs using it. Iterate from real truck feedback before investing in offline machinery. Phase 2 only after MVP proves field traction.
