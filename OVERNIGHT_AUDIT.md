# Overnight Audit — Master Bug & Improvement List

Generated: 2026-04-26
Audit scope: cloud sync, RLS, edge cases, dark theme, error handling, performance, PWA architecture

## TL;DR

| Category | Critical | High | Medium | Low |
|---|---:|---:|---:|---:|
| Cloud-bypass bugs (silent data loss) | **10** | 4 | 0 | 0 |
| Dark-theme inconsistencies | 0 | ~30 | ~15 | ~10 |
| Edge case warnings | 0 | 3 | 0 | 0 |
| RLS / security gaps | 0 | 1 | 0 | 0 |
| Performance | TBD | TBD | TBD | TBD |
| Error handling | TBD | TBD | TBD | TBD |

---

# 🔴 CRITICAL — Silent data loss / writes never reach cloud

These IPC handlers in `main.js` still use the SYNC helpers (`readCollection`, `writeCollection`, `upsert`, `remove`) on cloud-synced tables. Any write through them updates ONLY local JSON, never the cloud. Wife's PC won't see those changes; your PC will lose them on next hydrate (because cloud rehydrates the cache).

| # | Handler | Lines | Tables affected | Impact |
|---|---|---|---|---|
| C1 | `restore-trash-item` | 1719-1778 | jobs, invoices, schedule_items, payments, service_due_notices, disposal_loads | Restore from trash only un-deletes locally; row stays soft-deleted in cloud |
| C2 | `backfill-invoices` | 2023-2075 | invoices | New invoices created locally only — cloud never sees them, wife creates duplicates |
| C3 | `auth-setup` | 3783-3796 | users | Fresh-install admin creation goes to local only — new user doesn't exist on second PC |
| C4 | `save-user` | 3821-3830 | users | Local-only user creation/role changes |
| C5 | `change-password` | 3832-3842 | users | Password change only on this PC; can't login on other PC |
| C6 | `schedule-service-due-notifications` | 2429-2437 | service_due_notices | Reminder schedules vanish from cloud |
| C7 | `import-execute-tanktrack` | 4825-4960 | customers, properties, tanks | Massive bulk imports stay local-only |
| C8 | `import-invoices-tanktrack` | 4965-5094 | invoices | Invoice imports stay local-only |
| C9 | `seed-test-data` | 4455-4625 | jobs (and others via cascade) | Demo data leaks; can't actually scrub from other PCs |
| C10 | `unseed-test-data` | 4631-4703 | many | Cleanup is purely local; demo records reappear after hydrate |

**Same root cause as the bulk-delete bug we just fixed.** Same fix pattern: replace sync calls with their async cloud-aware equivalents (`readCollectionAsync`, `upsertAsync`, `removeAsync`, `findByIdAsync`).

# 🟠 HIGH — Inconsistent state (stale reads in user-visible flows)

| # | Handler | Lines | Tables read | Impact |
|---|---|---|---|---|
| H1 | `get-invoice-filter-options` | 2002-2021 | customers, properties, vehicles, users | Invoice page filter dropdowns miss recently-added entities |
| H2 | `send-service-due-notification` | 2371-2427 | service_due_notices, customers, properties | Emails go to stale customer addresses |
| H3 | `get-ar-report` | 3207-3336 | invoices, customers | AR aging numbers won't match between PCs |
| H4 | `ensure-filter-lead` | 2158-2183 | customers, properties | Lead stamped with stale name/address |

# 🟡 MEDIUM — Background tasks doing local-only writes

| # | Function | Lines | Tables | Impact |
|---|---|---|---|---|
| M1 | `get-tank-types` (auto-seed) | 3681-3708 | tank_types | First-run defaults seeded locally only |
| M2 | `checkJobReminders()` (timer) | 4294-4374 | jobs | "reminder_sent" flag local-only — duplicate emails from other PC |
| M3 | `checkDueNotices()` (timer) | 4182-4266 | service_due_notices | Sent-state flags local-only — duplicate emails |

---

# 🎨 DARK THEME — Hardcoded light colors against dark UI

50+ instances of hardcoded `background:#fafafa`, `background:white`, `border:1px solid #e0e0e0`, `color:#999`/`#555`/`#333` in inline styles in `renderer.js`. They render as ugly white boxes/grey text against the dark theme.

## High-visibility offenders (user sees these constantly)

### Customer Detail panel (the bulk of the issue)
- **L1864** Contact-notes list: `background:#fafafa`
- **L1929** Additional contacts: `background:#fafafa`
- **L2166** Tank `<details>` accordion: light borders + `background:#f5f5f5`
- **L2194, L2222** Property notes / Directions textareas: `border:1px solid #ddd`
- **L2258** Current Appointments cards: `background:#fafafa`
- **L2284** Service Due Notice rows: `background:#fafafa`
- **L2305** Service Contract rows: `background:#fafafa`
- **L2324, L2331** Prior Jobs rows: `background:#fafafa`
- **L2700** Receipts cards: `background:#fafafa`
- **L2722** Address line: `color:#333` (looks gray on dark)

### Job Modal (Create New Job — visible every time you add a job)
- **L7580** Customer autocomplete dropdown: `background:white;border:1px solid #ccc`
- **L7906, L7930, L7937** Autocomplete items: `color:#999`, `border-bottom:1px solid #f0f0f0`
- **L7683** Truck "None" button: `background:#e0e0e0`

### Job Detail / Work Order
- **L8720, L8726, L8744, L8848** Sidebar separators: `border-top:1px solid #eee`
- **L8732** Payment cards: `border:1px solid #eee`
- **L8796** Helper-tech chips: `background:#f0f0f0`
- **L8832** Service-product picker: `background:#f5f5f5`

### Jobs List page (filter bar)
- **L1497, L1499, L1509, L1517, L1531, L1534** Search + filter selects + date inputs: all use `border:1px solid #ccc`

### Invoices List
- **L9733** Top header: `border-bottom:1px solid #e0e0e0;background:#fafafa`
- **L7000** Manifest detail table: `background:#f5f5f5`

### Disposals List (very prominent — sits under dark sidebar)
- **L10715** Top toolbar: `background:#fff`
- **L10722** Date range strip: `background:#f5f5f5`
- **L10737** Table header row: `background:#f0f0f0`
- **L10750** Totals row: `background:#e8e8e8`
- **L10775** Row hover: `background:#f9f9f9`
- **L11196** Pumper info banner: `background:#f5f5f5`
- **L11522, L11528, L11540, L11544** Disposal Detail modal: section bg `#f8f9fa`, text `#888`/`#999`/`#1a1a1a`

### Service Due Notices Page
- **L11943** Stats bar: `background:#fafafa;border-bottom:1px solid #e0e0e0`
- **L3489, L3491, L3593** SDN modal preset cards: `background:#fff`, `border:1px solid #ddd`

### AFC (Filter Cleanings) Page
- **L14708, L14752** Lead and AFC cards: `background:white;border:1px solid #e0e0e0`
- **L14792, L14849** AFC modal header: `background:#f9f9f9`

## Medium offenders

- Reports / AR (L12740, L12777, L12792, L12799, L12772-12796) — text colors and borders
- Reminders Board (L12176-12196) — done-state bg, label colors
- Settings (L15347, L15425, L15709) — SMTP setup, test box, tank types header
- Bulk delete + AI Optimizer overlays (L1369-1375, L5416-5422, L4565-4569) — modal cards still `background:white`
- Schedule map route panel (L4671) — `background:white`

## Low offenders (rarely seen)
- Vehicle drag handle, Square/Mapbox loading spinners, etc.

## Quick-win pattern
**Search-and-replace approach**: ~70% of the issue is `background:#fafafa` and `border:1px solid #e0e0e0`. A single regex sweep replacing those with `var(--bg-white)` and `var(--border)` would fix the bulk of it.

---

# ⚠️ EDGE CASE WARNINGS (from automated test suite)

| # | Test | Status | Concern |
|---|---|---|---|
| E1 | Soft-deleted job can still be edited | WARN | After deletion, anyone can still modify it. Should block writes when `deleted_at` is set. |
| E2 | Owner can change `auth_user_id` on user row | WARN | Could break login or accidentally point a user record at the wrong auth account. RLS should restrict this column. |
| E3 | `schedule_item` allows NULL `scheduled_date` | WARN | UI may break or show in wrong place. Add NOT NULL constraint or default. |

## What passed (good news)

- ✅ Concurrent updates to same job: last-write-wins, no corruption
- ✅ Rapid create-delete-create with same UUID
- ✅ All RLS rules enforced (tech blocked from creating customers/invoices/vehicles/tank_types)
- ✅ Tech CAN read invoices for work order context (correct)
- ✅ Office blocked from settings tables (vehicles)
- ✅ Customer delete cascades to properties + tanks
- ✅ Bulk insert 100 jobs in 83ms (fast)
- ✅ Pagination 4535 customers in 715ms (fast)
- ✅ Date handling (valid + invalid + null + year boundaries)
- ✅ Unicode/emoji round-trip
- ✅ 10KB notes round-trip
- ✅ Realtime INSERT/UPDATE/DELETE all fire
- ✅ Login case-insensitive
- ✅ Wrong password rejected
- ✅ Unknown columns properly routed to `data` jsonb
- ✅ Customer without name rejected (NOT NULL works)

---

---

# 🛡️ ERROR HANDLING — Silent failures across the IPC layer

The biggest finding: **ALL save handlers return `success: true` even when the cloud write fails.** Renderer has no idea. This is the #1 reason "things disappear" without explanation.

## CRITICAL

| # | Issue | Location | Impact |
|---|---|---|---|
| EH1 | `writeCollection` swallows disk write errors | main.js:151-157 | Disk-full or perms error logged but caller thinks success — in-memory cache and disk diverge. Data lost on next restart. |
| EH2 | `upsertAsync` cloud-fail returns "success" | main.js:337-384 | Every save handler returns `{success:true, data}` on cloud error. UI shows "saved" toast but row never reaches Supabase. |
| EH3 | `removeAsync` cloud-fail invisible | main.js:386-405 | Cache row removed optimistically; cloud still has it; reappears on next hydrate (same root cause as the user's "deleted jobs come back" bug we just fixed at the cache level — but the underlying cloud-error visibility issue remains). |
| EH4 | `_cloudHydrateStore` per-table failures leave empty cache | main.js:427-443 | If one table fails to hydrate, `_store[collection]` stays empty even if disk has rows. Renderer sees nothing. |
| EH5 | `confirm` HTTP server: read-modify-write race + bypasses cloud | main.js:582-647 | Two customers clicking confirmation links concurrently → one update lost. AND confirmations only write to local JSON, never cloud. |
| EH6 | `restore-trash-item` for `payment` writes invoice via sync | main.js:1734-1752 | Restored payment + recomputed invoice balance never sync. |
| EH7 | `purge-trash-item` mixed sync/async paths | main.js:1699-1717 | invoice/SDN/disposal_load branches use sync `remove()`. Cloud row persists; reappears on hydrate. |

## HIGH

| # | Issue | Location | Impact |
|---|---|---|---|
| EH8 | `save-job` invoice auto-create no error path | main.js:1505-1597 | If linked-invoice upsert fails, job save still returns success. User has a job with no invoice and doesn't know. |
| EH9 | `bulk-delete-*` ignores per-item failures | main.js:1628-1697 | Returns `{success:true, deleted:N}` even if half failed silently. |
| EH10 | `send-email`/SDN notification: settings.json read without try | main.js:4102-4133, 2371-2427 | Corrupt settings.json crashes IPC; renderer sees generic Electron error. |
| EH11 | `generate-pdf` uncaught loadURL/finish-load failure | main.js:4079-4098 | If page never finishes loading, renderer hangs forever waiting on `await window.api.generatePdf()`. |
| EH12 | `cloud-users-create` partial-rollback silent | main.js:3984-4022 | Profile insert succeeded but signup failed; rollback's own error is unawaited. Could leave orphan profile rows. |
| EH13 | `cloud-login` ignores profile fetch error | main.js:3937 | Returns `success:true` with null user data, breaks `created_by` stamping silently. |
| EH14 | autoUpdater errors only logged | main.js:878-881 | User never told an update check failed. |

## MEDIUM

| # | Issue | Notes |
|---|---|---|
| EH15 | No input validation on most save handlers | Null/undefined payload throws inside `upsertAsync`. Add guard at top of each handler. |
| EH16 | `auth-login`/`auth-setup`/`change-password` no try/catch | bcrypt throws on null inputs. |
| EH17 | `delete-customer` cascade not transactional | Loop of removeAsync per child. If one tank fails, customer half-deleted. No rollback. |
| EH18 | `import-execute-tanktrack` mutates arrays outside try | Partial state could leak if a row throws mid-loop. |
| EH19 | `square-*` handlers no outer try/catch | Network errors reject the IPC promise instead of returning `{error}`. |

## Hot spots to fix first
1. **EH2 / EH3** — propagate cloud errors back to UI (every save handler is affected)
2. **EH1** — fix `writeCollection` silent disk failure
3. **EH5** — confirmation HTTP server bypassing cloud + race condition
4. **EH6, EH7** — trash restore/purge use mixed sync/async

---

# 🎯 RECOMMENDED FIX PRIORITY

## Round 1: Stop the data loss (1-2 hours)
1. **Convert C1-C10 cloud-bypass handlers** — biggest category of silent data loss
2. **Make EH2/EH3 propagate cloud errors** — the root cause of "where did my edit go?"
3. **Fix EH5** confirmation server cloud bypass

## Round 2: Make failures visible (2-3 hours)
4. **EH1** writeCollection error propagation
5. **EH8, EH9** save-job invoice and bulk-delete error reporting
6. **EH10-EH13** add try/catch to settings reads, PDF gen, cloud-users, cloud-login

## Round 3: Dark theme sweep (2-3 hours)
7. Replace `background:#fafafa` → `var(--bg-white)` everywhere (regex sweep)
8. Replace `border:1px solid #e0e0e0` → `var(--border)` everywhere
9. Replace text colors `#999`/`#555`/`#333` → `var(--text-light)`/`var(--text-muted)`/`var(--text)`
10. Hand-fix the highly-visible specific spots (Customer Detail panel, Job modal autocomplete, Disposals page table)

## Round 4: Schema hardening (1 hour)
11. **E1** block edits on soft-deleted jobs (RLS policy update)
12. **E2** restrict `auth_user_id` column from being writable by users (RLS column-level policy)
13. **E3** add NOT NULL or DEFAULT to `schedule_items.scheduled_date`

## Round 5: Performance + UX polish (rolling, after rounds 1-4)
- Findings from renderer audit (still running)
- Aesthetic improvement brainstorm

---

# 📱 PHONE APP PLAN — see PWA_PLAN.md

Comprehensive architecture plan for the field-tech PWA created in a separate file. Key recommendations:
- **Stack:** Vite + Svelte + TypeScript + Supabase JS + Workbox + Dexie
- **Hosting:** Vercel free tier on `field.interstateseptic.com`
- **MVP:** ~30 hours to ship "view schedule + mark complete" version
- **Full v1:** ~85-120 hours total across 3 phases

---

---

# 🌐 NETWORK / RESILIENCE AUDIT (separate audit)

30+ findings — top critical:
- **F3.1** writeCollection non-atomic — force-quit during write = silent data corruption. **FIXED via tmp+rename pattern**
- **F1.2** No timeouts on cloud calls — UI freezes forever on flaky connections. **FIXED via _withTimeout(15s)**
- **F2.1** Cloud hydrate is fire-and-forget — renderer reads stale empty cache before hydrate completes
- **F4.1** Field-name migration runs on local file only, not cloud-hydrated data — invoices show $0 totals
- **F6.5** Silent try/catch swallowing — corrupt JSON → silently reverts to seed (data loss masked)
- **F2.4** ipcMain.handle re-registered on every createWindow — uncaught exception on second window
- **F6.1** No log file (electron-log missing) — remote bug reports impossible

# 🧬 DATA INTEGRITY AUDIT (separate audit)

20 findings — top critical:
- **C1** Vehicle deletion leaves orphan jobs/schedule_items/assignments. **FIXED — now blocks delete with error**
- **C2** User hard-delete leaves orphan job assignments + breaks attribution. **FIXED — now soft-delete**
- **C3** purge-trash-item still mixed sync/async. **PARTIALLY FIXED — needs cascade to payments**
- **C4** bulk-delete-customers doesn't cascade to invoices/payments/jobs/reminders/AFCs
- **H1** save-job only syncs DRAFT invoices — finalized invoices silently desync from job
- **H2** Floating-point money math — 0.1+0.2=0.30000000000000004 → wrong payment_status. **FIXED — _money() rounding helper applied to job/invoice creation; needs to spread to all money operations**
- **H3** update-job-status had no state validation. **FIXED — validates status, clears stale completed_at**
- **H5** Customer rename doesn't propagate to invoice.billing_company snapshot
- **M1** Invoice number generator is racy — two simultaneous saves get same number

---

# 🔧 ROUND 1 FIXES — APPLIED IN THIS OVERNIGHT SESSION

| # | Fix | What it solves |
|---|---|---|
| F1 | `auth-setup` → cloud-aware | Fresh installs sync admin user to cloud |
| F2 | `save-user` → cloud-aware | New users sync across PCs |
| F3 | `change-password` → cloud-aware | Password changes persist across PCs |
| F4 | `restore-trash-item` → fully cloud-aware | Restored items un-delete in cloud |
| F5 | `schedule-service-due-notifications` → cloud-aware | Reminder schedules sync |
| F6 | `backfill-invoices` → cloud-aware | New invoices sync to cloud |
| F7 | `delete-vehicle` → blocks when in use | No more orphan jobs pointing at deleted trucks |
| F8 | `delete-user` → soft-delete instead of hard | Preserves attribution on historical jobs |
| F9 | `get-users` → filters out soft-deleted users | Deleted users hidden from dropdowns |
| F10 | `update-job-status` → state validation + clears stale completed_at | No more invalid statuses or lying timestamps |
| F11 | `_money()` helper added + applied to invoice subtotal computations | Eliminates floating-point money drift |
| F12 | `writeCollection` → atomic (tmp+rename) | Force-quit no longer corrupts JSON files |
| F13 | `_withTimeout()` helper + applied to cloud upsert/delete | UI no longer freezes forever on hung cloud calls |
| F14 | Dark-theme CSS overrides for ~50 hardcoded inline styles | Major visual cleanup; PDFs unaffected (separate window) |

# 🚧 ROUND 2 FIXES — STILL TODO

| # | Issue | Effort |
|---|---|---|
| T1 | Convert `import-execute-tanktrack` to cloud | 30 min |
| T2 | Convert `import-invoices-tanktrack` to cloud | 30 min |
| T3 | Convert `seed-test-data` / `unseed-test-data` to cloud | 20 min |
| T4 | Convert `get-tank-types` auto-seed to cloud | 10 min |
| T5 | Hydrate-then-render fix (F2.1) | 30 min |
| T6 | Add `electron-log` for log files (F6.1) | 20 min |
| T7 | Move ipcMain.handle out of createWindow (F2.4) | 15 min |
| T8 | Customer rename → invoice billing snapshot sync (H5) | 30 min |
| T9 | Money rounding in payments / balance recompute (H2 cont.) | 20 min |
| T10 | bulk-delete-customers full cascade (C4) | 30 min |
| T11 | bulk-cancel-invoices payment_status void (M7) | 15 min |
| T12 | Field-name migration on cloud-hydrated data (F4.1) | 30 min |
| T13 | Concurrent confirm HTTP server cloud bypass (EH5) | 30 min |
| T14 | propagate cloud errors back to UI on save (EH2/EH3 — biggest UX impact) | 1 hr |

# 📅 LATER ROUNDS (lower priority)

- All "Medium" and "Low" findings from each audit
- Performance fixes (cache invalidation, bulk endpoints, debouncing)
- Aesthetic improvements from IMPROVEMENTS.md
- Mobile / responsive breakpoints
- Accessibility (aria, keyboard nav)
- Reporting features

---

*Audits completed in overnight session: cloud-bypass, dark theme, edge cases, RLS, error handling, network resilience, data integrity, PWA architecture.*
*Round 1 fixes applied: 14 items. v0.2.5 release pending build.*
