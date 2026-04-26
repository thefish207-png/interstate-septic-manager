const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const XLSX = require('xlsx');

// ===== SINGLE INSTANCE LOCK =====
// Prevents multiple Electron instances from running and overwriting each other's data
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[APP] Another instance is already running — quitting.');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

let mainWindow;
let userDataPath = app.getPath('userData');
console.log('[APP] userData path:', userDataPath);

// ===== EMBEDDED SEED DATA — GUARANTEES DATA ON STARTUP =====
// Bypasses the Electron fs.readFileSync bug where files read as empty despite being full on disk.
// Data is bundled via require() which uses Node's module system (different code path than fs).
const SEED_DATA = require('./seed_data_embedded');

// Ensure data directory exists
(function ensureDataDir() {
  const appDir = path.join(userDataPath, 'data');
  if (!fs.existsSync(appDir)) fs.mkdirSync(appDir, { recursive: true });
})();

// ===== BUNDLED SUPABASE CONFIG (first-run setup) =====
// In production builds, supabase-config.json is bundled via extraResources.
// On first launch, if userData doesn't have one yet, copy the bundled one
// so the app is pre-configured to point at our cloud.
(function ensureSupabaseConfig() {
  const userConfigPath = path.join(userDataPath, 'supabase-config.json');
  if (fs.existsSync(userConfigPath)) return; // already set up

  // Resources path differs between dev (project root) and packaged (resources/)
  const candidates = [
    path.join(process.resourcesPath || '', 'build-config', 'supabase-config.json'),
    path.join(__dirname, 'build-config', 'supabase-config.json'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        fs.copyFileSync(candidate, userConfigPath);
        console.log('[APP] Bundled supabase-config copied from', candidate);
        return;
      }
    } catch (e) {
      console.warn('[APP] Could not copy bundled config:', e.message);
    }
  }
})();

// ===== SAVED CREDENTIALS (file-based, survives force-quit) =====
const savedCredsPath = path.join(userDataPath, 'saved_creds.json');
function getSavedCreds() {
  try { return JSON.parse(fs.readFileSync(savedCredsPath, 'utf8')); } catch { return null; }
}
function saveCreds(username, password) {
  fs.writeFileSync(savedCredsPath, JSON.stringify({ username, password }));
}
function clearCreds() {
  try { fs.unlinkSync(savedCredsPath); } catch {}
}

// ===== LOCAL JSON DB (IN-MEMORY WITH DISK PERSIST) =====
// All data lives in RAM after startup — completely bypasses Electron fs read bugs.
const _store = {};

function dbPath(collection) {
  const dir = path.join(userDataPath, 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, collection + '.json');
}

// Initialize in-memory store from embedded seed data
(function initStore() {
  const collections = Object.keys(SEED_DATA);
  collections.forEach(name => {
    _store[name] = JSON.parse(JSON.stringify(SEED_DATA[name])); // deep clone
    console.log('[STORE] Loaded ' + name + ': ' + _store[name].length + ' items from embedded seed');
  });

  // Load any user-modified data from disk — disk always wins over seed data
  collections.forEach(name => {
    const p = path.join(userDataPath, 'data', name + '.json');
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8');
        const diskData = JSON.parse(raw);
        if (Array.isArray(diskData)) {
          _store[name] = diskData;
          console.log('[STORE] ' + name + ': loaded from disk (' + diskData.length + ' items)');
        }
      }
    } catch {}
  });

  // One-time migration: imported TankTrack invoices used {amount,total_paid}.
  // Canonical fields are {total,amount_paid}. Rename in place so UI, filters, totals work.
  try {
    const invPath = path.join(userDataPath, 'data', 'invoices.json');
    if (fs.existsSync(invPath)) {
      const invs = _store['invoices'] || [];
      let migrated = 0;
      for (const inv of invs) {
        if (inv.imported_from === 'tanktrack') {
          if (inv.total == null && inv.amount != null) { inv.total = inv.amount; migrated++; }
          if (inv.amount_paid == null && inv.total_paid != null) { inv.amount_paid = inv.total_paid; }
          // Map payment_status from status if missing
          if (!inv.payment_status && inv.status) inv.payment_status = inv.status;
        }
      }
      if (migrated > 0) {
        fs.writeFileSync(invPath, JSON.stringify(invs, null, 2));
        console.log('[MIGRATION] invoices: renamed amount→total / total_paid→amount_paid on ' + migrated + ' rows');
      }
    }
  } catch (err) { console.error('[MIGRATION] invoice rename failed:', err.message); }
})();

function readCollection(collection) {
  if (_store[collection]) return _store[collection];
  // For collections not in seed (payments, schedule_items, etc.), read from disk
  const p = dbPath(collection);
  if (!fs.existsSync(p)) { _store[collection] = []; return []; }
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const data = JSON.parse(raw);
    _store[collection] = data;
    return data;
  } catch {
    _store[collection] = [];
    return [];
  }
}

function writeCollection(collection, data) {
  _store[collection] = data; // always update memory first
  const p = dbPath(collection);
  try { fs.writeFileSync(p, JSON.stringify(data, null, 2)); } catch (err) {
    console.error('[DB] Write failed for ' + collection + ':', err.message);
  }
}

function findById(collection, id) {
  return readCollection(collection).find(item => item.id === id) || null;
}

function broadcastDataChange(collection) {
  const wins = BrowserWindow.getAllWindows();
  wins.forEach(w => {
    if (!w.isDestroyed()) {
      try { w.webContents.send('data-changed', { collection }); } catch {}
    }
  });
}

function upsert(collection, item) {
  const items = readCollection(collection);
  if (item.id) {
    const idx = items.findIndex(i => i.id === item.id);
    if (idx >= 0) {
      items[idx] = { ...items[idx], ...item, updated_at: new Date().toISOString() };
      writeCollection(collection, items);
      broadcastDataChange(collection);
      return items[idx];
    }
  }
  item.id = uuidv4();
  item.created_at = new Date().toISOString();
  item.updated_at = new Date().toISOString();
  items.push(item);
  writeCollection(collection, items);
  broadcastDataChange(collection);
  return item;
}

function remove(collection, id) {
  const items = readCollection(collection).filter(i => i.id !== id);
  writeCollection(collection, items);
  broadcastDataChange(collection);
}

// ===================================================================
// CLOUD-AWARE ASYNC DATA HELPERS
// These wrap the sync helpers above. When signed into Supabase AND the
// table is in _CLOUD_TABLES, they hit Supabase and update the local
// cache. Otherwise they fall through to the local-JSON helpers.
// ===================================================================
const _CLOUD_TABLES = new Set([
  'customers', 'properties', 'tanks', 'tank_types', 'vehicles',
  'truck_day_assignments', 'jobs', 'schedule_items', 'invoices',
  'payments', 'disposal_loads', 'day_notes', 'reminders',
  'service_due_notices', 'users'
]);

// Promoted columns: top-level columns defined in our SQL migrations.
// Anything NOT in this list for a given table goes into the table's
// `data` jsonb catch-all column, so the renderer can write whatever
// fields it wants without breaking the upsert.
const _PROMOTED_COLS = {
  jobs: new Set(['id','scheduled_date','customer_id','property_id','tank_id','vehicle_id',
                 'assigned_user_id','assigned_to','scheduled_time','service_type','notes',
                 'status','line_items','gallons_pumped','completed_at','deleted_at',
                 'customer_confirmed_at','priority','arrival_window','invoice_id',
                 'created_at','updated_at','data']),
  schedule_items: new Set(['id','scheduled_date','customer_id','property_id','tank_id','vehicle_id',
                           'assigned_user_id','service_type','notes','status','sort_order',
                           'estimated_gallons','invoice_id','completed_at','completed_by',
                           'item_type','assigned_to','manifest_number','waste_site','gallons',
                           'tank_type','time_label','deleted_at','created_at','updated_at','data']),
  customers: new Set(['id','name','company','phone','phone_home','phone_work','email','address',
                      'city','state','zip','notes','imported_from','created_at','updated_at']),
  properties: new Set(['id','customer_id','address','city','state','zip','county','company',
                       'notes','imported_from','created_at','updated_at']),
  tanks: new Set(['id','property_id','tank_type','volume_gallons','imported_from','created_at','updated_at']),
  tank_types: new Set(['id','name','waste_code','disposal_label','pumping_price','disposal_price',
                       'generates_disposal','sort_order','created_at','updated_at']),
  vehicles: new Set(['id','name','capacity_gallons','color','default_tech_id','plate','vin',
                     'waste_hauler_id','date_in_service','sort_order','created_at','updated_at']),
  truck_day_assignments: new Set(['id','vehicle_id','user_id','date','created_at','updated_at']),
  invoices: new Set(['id','invoice_number','customer_id','customer_name','billing_company','billing_city',
                     'property_id','property_company','property_address','property_city','svc_date',
                     'total','amount_paid','status','payment_status','payment_method','payment_due_date',
                     'products_services','product_sales','quantity','unit_cost','technician','tech_notes',
                     'job_notes','job_codes','gallons_pumped_total','truck','tank_type','tank_size',
                     'waste_manifest','waste_site','disposal_date','check_numbers','complete','waiting_area',
                     'cancelled','imported_from','job_id','driver_id','vehicle_id','gallons_pumped',
                     'line_items','subtotal','tax_rate','tax_amount','notes','deleted_at',
                     'created_at','updated_at']),
  payments: new Set(['id','customer_id','invoice_id','date','amount','method','reference','notes',
                     'created_at','updated_at']),
  disposal_loads: new Set(['id','date','vehicle_id','user_id','waste_site','manifest_number','gallons',
                           'notes','tank_type','outside_pumper_id','created_at','updated_at','data']),
  day_notes: new Set(['id','date','note','created_at','updated_at']),
  reminders: new Set(['id','customer_id','property_id','due_date','message','resolved','assigned_users',
                      'status','priority','created_at','updated_at','data']),
  service_due_notices: new Set(['id','customer_id','property_id','tank_id','due_date','status',
                                'created_at','updated_at','data']),
  users: new Set(['id','auth_user_id','name','username','phone','role','color','password_hash','email',
                  'deleted_at','created_at','updated_at'])
};

function _splitForCloud(collection, item) {
  const promoted = _PROMOTED_COLS[collection];
  if (!promoted) return { ...item }; // no schema defined — pass through
  const top = {};
  const extras = {};
  for (const [k, v] of Object.entries(item)) {
    if (promoted.has(k)) top[k] = v;
    else extras[k] = v;
  }
  if (Object.keys(extras).length) {
    // Merge extras into existing data jsonb (preserves any existing keys)
    top.data = { ...(item.data || {}), ...extras };
  }
  return top;
}

// Reverse: take a cloud row and merge data jsonb back into top-level
function _unpackFromCloud(row) {
  if (row && row.data && typeof row.data === 'object' && !Array.isArray(row.data)) {
    const { data, ...rest } = row;
    return { ...data, ...rest, data };
  }
  return row;
}

function _isCloudTable(collection) {
  return _CLOUD_TABLES.has(collection);
}

function _cloudReady() {
  // We need _sbSession AND a configured client. _sbSession is module-scoped
  // and lives in the cloud-user block we added later. Use lazy-eval via globalThis.
  return typeof _sbSession !== 'undefined' && _sbSession && typeof _getSbClient === 'function' && !!_getSbClient();
}

// Paginated read — Supabase caps at 1000 rows per query. We page through
// until we get a partial page back.
async function _cloudReadAll(sb, collection) {
  const PAGE = 1000;
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb.from(collection).select('*').range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
    if (from > 100000) break; // safety stop at 100k rows per table
  }
  return all;
}

// Reads return from the in-memory cache (which is hydrated on login and
// kept fresh by the realtime subscription). Only hits Supabase if the
// cache hasn't been populated yet for this collection.
async function readCollectionAsync(collection) {
  // If we have cached data, return it immediately (fast path)
  if (_store[collection]) return _store[collection];

  // Fall through to cloud or local JSON depending on cloud-readiness
  if (_cloudReady() && _isCloudTable(collection)) {
    try {
      const sb = _getSbClient();
      const data = await _cloudReadAll(sb, collection);
      _store[collection] = data;
      return data;
    } catch (e) {
      console.warn('[CLOUD] readCollectionAsync', collection, 'fallback to local:', e.message);
    }
  }
  return readCollection(collection);
}

// Writes are optimistic: cache updates IMMEDIATELY (UI shows the change),
// then cloud write happens in background. If cloud fails, the cache row
// stays — we never silently lose a user's write. Cloud errors retry
// automatically by stripping unknown columns into the `data` jsonb catch-all.
async function upsertAsync(collection, item) {
  const now = new Date().toISOString();
  const row = { ...item };
  if (!row.id) row.id = uuidv4();
  row.updated_at = now;
  if (!row.created_at) row.created_at = now;

  // 1. Optimistic cache update — UI sees the change immediately
  const items = readCollection(collection);
  const idx = items.findIndex(i => i.id === row.id);
  if (idx >= 0) items[idx] = { ...items[idx], ...row };
  else items.push(row);
  _store[collection] = items;
  broadcastDataChange(collection);

  // 2. Cloud write (if available)
  if (_cloudReady() && _isCloudTable(collection)) {
    try {
      const sb = _getSbClient();
      // Split into known columns + data jsonb catch-all so unknown fields
      // (job_type, tech_notes, helpers, etc.) don't break the upsert
      const cloudPayload = _splitForCloud(collection, row);
      const { data, error } = await sb.from(collection).upsert(cloudPayload).select().single();

      if (error) {
        console.warn('[CLOUD] upsertAsync', collection, 'failed (cache kept):', error.message);
        return items.find(i => i.id === row.id) || row;
      }
      // Cloud succeeded — merge authoritative cloud row (with data unpacked) back into cache
      const merged = { ...row, ..._unpackFromCloud(data) };
      const idx2 = items.findIndex(i => i.id === merged.id);
      if (idx2 >= 0) items[idx2] = merged; else items.push(merged);
      _store[collection] = items;
      return merged;
    } catch (e) {
      console.warn('[CLOUD] upsertAsync', collection, 'exception (cache kept):', e.message);
      return items.find(i => i.id === row.id) || row;
    }
  }

  // No cloud — also persist to local JSON so it survives app restart
  if (!_isCloudTable(collection)) {
    return upsert(collection, item);
  }
  // Cloud table but offline — keep cache, write to local JSON as backup
  writeCollection(collection, items);
  return items.find(i => i.id === row.id) || row;
}

async function removeAsync(collection, id) {
  // Optimistic cache removal
  const items = readCollection(collection).filter(i => i.id !== id);
  _store[collection] = items;
  broadcastDataChange(collection);

  if (_cloudReady() && _isCloudTable(collection)) {
    try {
      const sb = _getSbClient();
      const { error } = await sb.from(collection).delete().eq('id', id);
      if (error) console.warn('[CLOUD] removeAsync', collection, 'failed (cache already removed):', error.message);
    } catch (e) {
      console.warn('[CLOUD] removeAsync', collection, 'exception:', e.message);
    }
    return true;
  }
  // Local-only table — also persist to disk
  remove(collection, id);
  return true;
}

async function findByIdAsync(collection, id) {
  // Cache-first: if hydrated, look there
  if (_store[collection]) {
    return _store[collection].find(i => i.id === id) || null;
  }
  // Cache miss — hit cloud
  if (_cloudReady() && _isCloudTable(collection)) {
    try {
      const sb = _getSbClient();
      const { data, error } = await sb.from(collection).select('*').eq('id', id).maybeSingle();
      if (!error) return data || null;
    } catch (e) {
      console.warn('[CLOUD] findByIdAsync', collection, 'exception:', e.message);
    }
  }
  return findById(collection, id);
}

// Pull fresh data for all cloud tables on startup, populating _store.
// Called once after cloud session is restored.
async function _cloudHydrateStore() {
  if (!_cloudReady()) return;
  console.log('[CLOUD] hydrating local store from cloud…');
  const sb = _getSbClient();
  for (const collection of _CLOUD_TABLES) {
    try {
      const data = await _cloudReadAll(sb, collection);
      // Unpack data jsonb back into top-level fields so renderer sees full row
      _store[collection] = data.map(_unpackFromCloud);
      console.log('[CLOUD]   ✓', collection.padEnd(24), data.length);
    } catch (e) {
      console.warn('[CLOUD]   ✗', collection, e.message);
    }
  }
  // Notify renderer that data is fresh
  broadcastDataChange('*');
}

// Set up Supabase realtime subscriptions for shared tables.
// We use a custom raw-websocket client because supabase-js v2.99-2.104
// has a bug where postgres_changes subscriptions silently TIME_OUT with
// ES256-signed JWTs (the new asymmetric key format). The Phoenix protocol
// itself works fine — we just bypass the broken JS wrapper.
const _RT_TABLES = ['schedule_items', 'jobs', 'customers', 'properties',
                    'tanks', 'vehicles', 'truck_day_assignments',
                    'day_notes', 'reminders', 'service_due_notices',
                    'disposal_loads', 'invoices'];
let _rtSocket = null;
let _rtHeartbeatTimer = null;
let _rtReconnectTimer = null;
let _rtRef = 0;
let _rtIntentionalClose = false;

function _rtSend(msg) {
  if (_rtSocket && _rtSocket.readyState === 1) {
    _rtSocket.send(JSON.stringify(msg));
  }
}

function _cloudSubscribeRealtime() {
  if (!_cloudReady()) return;
  _cloudUnsubscribeRealtime(); // clean any prior connection

  const cfg = _getSbConfig();
  if (!cfg) return;

  const wsLib = require('ws');
  const url = cfg.url.replace('https://', 'wss://') + '/realtime/v1/websocket?apikey=' + cfg.anonKey + '&vsn=1.0.0';
  const sock = new wsLib.WebSocket(url);
  _rtSocket = sock;
  _rtIntentionalClose = false;

  sock.on('open', () => {
    console.log('[CLOUD-RT] websocket open, joining channel…');
    const accessToken = _sbSession?.access_token;
    _rtSend({
      topic: 'realtime:ism-shared',
      event: 'phx_join',
      payload: {
        config: {
          broadcast: { ack: false, self: false },
          presence: { key: '' },
          postgres_changes: _RT_TABLES.map(t => ({
            event: '*', schema: 'public', table: t
          }))
        },
        access_token: accessToken
      },
      ref: String(++_rtRef)
    });
    // Heartbeat every 25s (server requires <30s)
    _rtHeartbeatTimer = setInterval(() => {
      _rtSend({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++_rtRef) });
    }, 25000);
  });

  sock.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }

    if (m.event === 'postgres_changes') {
      const change = m.payload.data;
      const tbl = change.table;
      if (!_RT_TABLES.includes(tbl)) return;

      // Update local cache (unpack data jsonb back into top-level)
      const items = readCollection(tbl);
      if (change.type === 'INSERT' || change.type === 'UPDATE') {
        const newRow = _unpackFromCloud(change.record);
        if (newRow && newRow.id) {
          const idx = items.findIndex(i => i.id === newRow.id);
          if (idx >= 0) items[idx] = { ...items[idx], ...newRow }; else items.push(newRow);
          _store[tbl] = items;
        }
      } else if (change.type === 'DELETE') {
        const oldRow = change.old_record;
        if (oldRow && oldRow.id) {
          _store[tbl] = items.filter(i => i.id !== oldRow.id);
        }
      }
      broadcastDataChange(tbl);
    } else if (m.event === 'phx_reply' && m.payload?.status === 'ok' && m.payload.response?.postgres_changes) {
      console.log('[CLOUD-RT] subscribed to', m.payload.response.postgres_changes.length, 'table change streams');
    } else if (m.event === 'system' && m.payload?.status === 'ok') {
      console.log('[CLOUD-RT]', m.payload.message);
    } else if (m.event === 'phx_error' || m.payload?.status === 'error') {
      console.warn('[CLOUD-RT] error:', JSON.stringify(m.payload).slice(0, 300));
    }
  });

  sock.on('error', (e) => {
    console.warn('[CLOUD-RT] socket error:', e.message);
  });

  sock.on('close', (code, reason) => {
    if (_rtHeartbeatTimer) { clearInterval(_rtHeartbeatTimer); _rtHeartbeatTimer = null; }
    _rtSocket = null;
    if (_rtIntentionalClose) {
      console.log('[CLOUD-RT] closed (intentional)');
      return;
    }
    console.log('[CLOUD-RT] closed (code:', code + ') — reconnecting in 5s');
    _rtReconnectTimer = setTimeout(() => {
      if (_cloudReady()) _cloudSubscribeRealtime();
    }, 5000);
  });
}

function _cloudUnsubscribeRealtime() {
  _rtIntentionalClose = true;
  if (_rtHeartbeatTimer) { clearInterval(_rtHeartbeatTimer); _rtHeartbeatTimer = null; }
  if (_rtReconnectTimer) { clearTimeout(_rtReconnectTimer); _rtReconnectTimer = null; }
  if (_rtSocket) {
    try { _rtSocket.close(); } catch {}
    _rtSocket = null;
  }
}

// ===== CONFIRMATION HTTP SERVER =====
let confirmServer = null;

function getServerSettings() {
  try {
    const settings = readCollection('settings')[0] || {};
    return {
      port: parseInt(settings.confirm_server_port) || 3456,
      publicUrl: (settings.confirm_public_url || '').replace(/\/$/, ''),
    };
  } catch { return { port: 3456, publicUrl: '' }; }
}

function startConfirmServer() {
  if (confirmServer) return;
  const { port } = getServerSettings();

  confirmServer = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost`);

    if (url.pathname === '/confirm') {
      const token = url.searchParams.get('token');
      const notices = readCollection('service_due_notices');
      const idx = notices.findIndex(n => n.confirm_token === token);

      if (idx === -1) {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end(confirmPage('Not Found', 'This confirmation link is invalid or has already been used.', '#e53935'));
        return;
      }

      const notice = notices[idx];
      const customers = readCollection('customers');
      const cust = customers.find(c => c.id === notice.customer_id) || {};
      const serviceType = notice.service_type || 'Septic Service';

      if (notice.status === 'confirmed') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(confirmPage('Already Confirmed', `Your ${serviceType} service appointment has already been confirmed. We look forward to seeing you!`, '#43a047'));
        return;
      }

      notices[idx] = { ...notice, status: 'confirmed', confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      writeCollection('service_due_notices', notices);

      // Notify the renderer that a confirmation came in
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sdn-confirmed', { id: notice.id, customerName: cust.name || '' });
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(confirmPage(
        'Appointment Confirmed!',
        `Thank you${cust.name ? ', ' + cust.name : ''}! We've received your confirmation for <strong>${serviceType}</strong> service. We'll be in touch to finalize your appointment time. You will no longer receive reminder emails for this notice.`,
        '#2e7d32'
      ));
      return;
    }

    // Job appointment confirmation
    if (url.pathname === '/confirm-job') {
      const jobId = url.searchParams.get('id');
      const jobs = readCollection('jobs');
      const idx = jobs.findIndex(j => j.id === jobId);
      if (idx === -1) {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end(confirmPage('Not Found', 'This confirmation link is invalid.', '#e53935'));
        return;
      }
      const job = jobs[idx];
      if (job.customer_confirmed_at) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(confirmPage('Already Confirmed', 'Your appointment has already been confirmed. We look forward to seeing you!', '#43a047'));
        return;
      }
      jobs[idx] = { ...job, customer_confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      writeCollection('jobs', jobs);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('job-confirmed', { id: job.id });
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(confirmPage('Appointment Confirmed!', 'Thank you! We\'ve received your confirmation and look forward to seeing you on your scheduled date.', '#2e7d32'));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(confirmPage('Interstate Septic', 'Customer confirmation portal.', '#2e7d32'));
  });

  confirmServer.listen(port, '0.0.0.0', () => {
    console.log(`[CONFIRM SERVER] Listening on port ${port}`);
  });

  confirmServer.on('error', (err) => {
    console.error('[CONFIRM SERVER] Error:', err.message);
  });
}

function stopConfirmServer() {
  if (confirmServer) {
    confirmServer.closeAllConnections?.(); // Node 18.2+
    confirmServer.close();
    confirmServer = null;
  }
}

function restartConfirmServer() {
  stopConfirmServer();
  startConfirmServer();
}

function confirmPage(title, message, color) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f5f5f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: white; border-radius: 12px; padding: 48px 40px; max-width: 480px; width: 90%; text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,0.10); }
    .icon { font-size: 56px; margin-bottom: 20px; }
    h1 { color: ${color}; font-size: 26px; margin-bottom: 14px; }
    p { color: #555; font-size: 16px; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${color === '#e53935' ? '❌' : '✅'}</div>
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

// ===== SYSTEM TRAY =====
let tray = null;

function createTrayIcon() {
  // Build a 16x16 green square as BGRA bitmap
  const size = 16;
  const data = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4]     = 50;  // B
    data[i * 4 + 1] = 125; // G
    data[i * 4 + 2] = 46;  // R (#2e7d32)
    data[i * 4 + 3] = 255; // A
  }
  return nativeImage.createFromBitmap(data, { width: size, height: size });
}

function createTray() {
  if (tray) return;
  tray = new Tray(createTrayIcon());
  tray.setToolTip('Interstate Septic Manager');
  updateTrayMenu();
  tray.on('double-click', () => showMainWindow());
}

function updateTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: 'Open Interstate Septic Manager', click: () => showMainWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

// ===== WINDOW =====
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
    title: 'Interstate Septic Manager',
    autoHideMenuBar: true,
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('src/index.html');

  // Ctrl+= / Ctrl+- / Ctrl+0 and Ctrl+MouseWheel zoom
  const clampZoom = (lvl) => Math.max(-3, Math.min(5, lvl));
  const notifyZoom = () => {
    const wc = mainWindow.webContents;
    const pct = Math.round(Math.pow(1.2, wc.getZoomLevel()) * 100);
    wc.send('zoom-changed', { level: wc.getZoomLevel(), percent: pct });
  };
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown') return;
    if (!(input.control || input.meta)) return;
    const wc = mainWindow.webContents;
    if (input.key === '=' || input.key === '+') {
      wc.setZoomLevel(clampZoom(wc.getZoomLevel() + 0.5));
      notifyZoom();
    } else if (input.key === '-' || input.key === '_') {
      wc.setZoomLevel(clampZoom(wc.getZoomLevel() - 0.5));
      notifyZoom();
    } else if (input.key === '0') {
      wc.setZoomLevel(0);
      notifyZoom();
    }
  });
  mainWindow.webContents.on('zoom-changed', (_e, direction) => {
    const wc = mainWindow.webContents;
    const delta = direction === 'in' ? 0.5 : -0.5;
    wc.setZoomLevel(clampZoom(wc.getZoomLevel() + delta));
    notifyZoom();
  });

  // Built-in find-in-page: the renderer calls window.api.findInPage(text, forward)
  // and window.api.stopFindInPage() to dismiss.
  ipcMain.handle('find-in-page', (_e, { text, forward = true, findNext = false }) => {
    if (!text) return;
    mainWindow.webContents.findInPage(text, { forward, findNext, matchCase: false });
  });
  ipcMain.handle('stop-find-in-page', () => {
    mainWindow.webContents.stopFindInPage('clearSelection');
  });
  mainWindow.webContents.on('found-in-page', (_e, result) => {
    mainWindow.webContents.send('find-in-page-result', {
      matches: result.matches,
      activeMatch: result.activeMatchOrdinal,
    });
  });

  // Closing the main window quits the app
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      app.isQuitting = true;
      app.quit();
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  startConfirmServer();
  // Auto-start on login setting (Windows only)
  try {
    const settings = readCollection('settings')[0] || {};
    app.setLoginItemSettings({ openAtLogin: settings.auto_start === true });
  } catch {}
  // Check for due service notices on startup (after 10s delay) and then every hour
  setTimeout(() => { checkDueNotices(); }, 10000);
  setInterval(() => { checkDueNotices(); }, 3600000);
  // Check job reminders on startup (after 12s delay) and then every hour
  setTimeout(() => { checkJobReminders(); }, 12000);
  setInterval(() => { checkJobReminders(); }, 3600000);
  // Check reminder alerts every 60 seconds
  setTimeout(() => { checkReminderAlerts(); }, 5000);
  setInterval(() => { checkReminderAlerts(); }, 60000);
  // Auto-update check (skipped in dev because there's no GH release to compare against)
  setTimeout(() => { setupAutoUpdater(); }, 8000);
});

// ===== AUTO-UPDATER (electron-updater + GitHub Releases) =====
function setupAutoUpdater() {
  if (!app.isPackaged) {
    console.log('[UPDATER] dev mode — skipping auto-update check');
    return;
  }
  let autoUpdater;
  try { autoUpdater = require('electron-updater').autoUpdater; }
  catch (e) { console.warn('[UPDATER] electron-updater not available:', e.message); return; }

  autoUpdater.logger = console;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => console.log('[UPDATER] checking for update…'));
  autoUpdater.on('update-available', (info) => {
    console.log('[UPDATER] update available:', info.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-available', { version: info.version, notes: info.releaseNotes || '' });
    }
  });
  autoUpdater.on('update-not-available', () => console.log('[UPDATER] up to date'));
  autoUpdater.on('error', (err) => console.warn('[UPDATER] error:', err?.message || err));
  autoUpdater.on('download-progress', (p) => {
    console.log('[UPDATER] downloading:', Math.round(p.percent) + '%');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-progress', { percent: p.percent, transferred: p.transferred, total: p.total });
    }
  });
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[UPDATER] update downloaded:', info.version, '— ready to install on next restart');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-ready', { version: info.version });
    }
  });

  // Check now, then every 6 hours
  autoUpdater.checkForUpdates().catch(e => console.warn('[UPDATER] initial check failed:', e?.message || e));
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(e => console.warn('[UPDATER] periodic check failed:', e?.message || e));
  }, 6 * 60 * 60 * 1000);
}

ipcMain.handle('install-update-now', async () => {
  try {
    const autoUpdater = require('electron-updater').autoUpdater;
    autoUpdater.quitAndInstall(false, true);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// ===== POPUP WINDOWS =====
ipcMain.handle('open-popup-window', async (e, { page, id, title }) => {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 700,
    minHeight: 500,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    title: title || ('ISM — ' + (page || 'Page')),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });
  const query = { popup: '1', page: page || 'schedule' };
  if (id) query.id = id;
  win.loadFile('src/index.html', { query });

  // Drag-to-reattach: detect when popup is dragged near main window's tab bar
  let _dockTimer = null;

  function clearDockTimer() {
    if (_dockTimer) { clearTimeout(_dockTimer); _dockTimer = null; }
  }

  function notifyNear(near) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try { mainWindow.webContents.send('popup-near-tabbar', { near, page: page || 'schedule' }); } catch {}
    }
  }

  win.on('move', () => {
    clearDockTimer();
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const [px, py] = win.getPosition();
    const [pw] = win.getSize();
    const [mx, my] = mainWindow.getPosition();
    const [mw] = mainWindow.getSize();

    // Tab bar is approximately 85px from top of main window (title bar + menu + tab bar)
    const tabBarY = my + 85;
    const xOverlap = px < mx + mw && px + pw > mx;
    // Only dock when popup top edge is within a tight band right at the tab bar
    const nearTabBar = xOverlap && py >= tabBarY - 10 && py <= tabBarY + 30;

    notifyNear(nearTabBar);

    if (nearTabBar) {
      _dockTimer = setTimeout(() => {
        // Auto-dock: open as tab in main, close popup
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('dock-page', page || 'schedule');
          mainWindow.focus();
        }
        win.destroy();
      }, 800);
    }
  });

  win.on('closed', () => {
    clearDockTimer();
    notifyNear(false);
  });

  return { success: true };
});

// Dock a popup window back as a tab in the main window
ipcMain.handle('dock-to-main', async (e, page) => {
  // Find the main window (not a popup)
  const wins = BrowserWindow.getAllWindows();
  const mainWin = wins.find(w => !w.isDestroyed() && !w.webContents.getURL().includes('popup=1'));
  if (mainWin) {
    mainWin.webContents.send('dock-page', page);
    mainWin.focus();
  }
  // Close the popup that sent this
  const senderWin = BrowserWindow.fromWebContents(e.sender);
  if (senderWin && !senderWin.isDestroyed()) senderWin.close();
  return { success: true };
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  stopConfirmServer();
  if (tray) { tray.destroy(); tray = null; }
});

app.on('quit', () => {
  process.exit(0);
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ===== CUSTOMERS =====
ipcMain.handle('get-customers', async (e, search) => {
  let customers = await readCollectionAsync('customers');
  const properties = await readCollectionAsync('properties');

  // Index properties by customer_id once (O(n)) so the per-customer join is O(1)
  // instead of O(customers × properties) — the naive nested filter was locking the
  // UI for 1–2s with 4k customers × 4k properties.
  const propsByCust = new Map();
  for (const p of properties) {
    if (!p.customer_id) continue;
    const arr = propsByCust.get(p.customer_id);
    if (arr) arr.push(p); else propsByCust.set(p.customer_id, [p]);
  }

  if (search) {
    const s = search.toLowerCase();
    const propertyCustomerIds = new Set(
      properties.filter(p => (p.address || '').toLowerCase().includes(s)).map(p => p.customer_id)
    );
    customers = customers.filter(c =>
      (c.name || '').toLowerCase().includes(s) ||
      (c.phone || '').toLowerCase().includes(s) ||
      (c.email || '').toLowerCase().includes(s) ||
      propertyCustomerIds.has(c.id)
    );
  }

  // Attach property count and primary address (O(1) lookup per customer)
  customers = customers.map(c => {
    const custProps = propsByCust.get(c.id) || [];
    const primary = custProps[0];
    const addr = primary ? `${primary.address || ''}${primary.city ? ', ' + primary.city : ''}${primary.state ? ' ' + primary.state : ''}` : '';
    return { ...c, property_count: custProps.length, primary_address: addr.trim() };
  });
  customers.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return { data: customers };
});

// Lightweight customer list for autocompletes / job-modal search. Returns
// only the fields the dropdown actually needs, which cuts the IPC payload
// from ~1.6MB to ~300KB on 4k customers and removes the typing lag.
ipcMain.handle('get-customers-lite', async () => {
  const customers = await readCollectionAsync('customers');
  const properties = await readCollectionAsync('properties');
  const firstPropByCust = new Map();
  for (const p of properties) {
    if (!p.customer_id) continue;
    if (firstPropByCust.has(p.customer_id)) continue;
    firstPropByCust.set(p.customer_id, p);
  }
  const out = new Array(customers.length);
  for (let i = 0; i < customers.length; i++) {
    const c = customers[i];
    const p = firstPropByCust.get(c.id);
    let addr = '';
    if (p) {
      addr = (p.address || '');
      if (p.city) addr += (addr ? ', ' : '') + p.city;
      if (p.state) addr += ' ' + p.state;
    }
    out[i] = {
      id: c.id,
      name: c.name || '',
      phone: c.phone || '',
      phone_cell: c.phone_cell || '',
      email: c.email || '',
      primary_address: addr,
    };
  }
  out.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return { data: out };
});

ipcMain.handle('get-customer', async (e, id) => {
  const customer = await findByIdAsync('customers', id);
  if (customer) {
    const properties = await readCollectionAsync('properties');
    customer.properties = properties.filter(p => p.customer_id === id);
  }
  return { data: customer };
});

ipcMain.handle('save-customer', async (e, data) => {
  const saved = await upsertAsync('customers', data);
  return { success: true, data: saved };
});

ipcMain.handle('delete-customer', async (e, id) => {
  // Cascade delete: properties + tanks under this customer
  const properties = await readCollectionAsync('properties');
  const childProps = properties.filter(p => p.customer_id === id);
  for (const p of childProps) {
    const tanks = await readCollectionAsync('tanks');
    const childTanks = tanks.filter(t => t.property_id === p.id);
    for (const t of childTanks) await removeAsync('tanks', t.id);
    await removeAsync('properties', p.id);
  }
  await removeAsync('customers', id);
  return { success: true };
});

// ===== PROPERTIES =====
ipcMain.handle('get-properties', async (e, customerId) => {
  let properties = await readCollectionAsync('properties');
  if (customerId) properties = properties.filter(p => p.customer_id === customerId);
  const tanks = await readCollectionAsync('tanks');
  properties = properties.map(p => ({
    ...p,
    tanks: tanks.filter(t => t.property_id === p.id),
    tank_count: tanks.filter(t => t.property_id === p.id).length,
  }));
  return { data: properties };
});

ipcMain.handle('get-property', async (e, id) => {
  const property = await findByIdAsync('properties', id);
  if (property) {
    const tanks = await readCollectionAsync('tanks');
    property.tanks = tanks.filter(t => t.property_id === id);
    property.customer = await findByIdAsync('customers', property.customer_id);
  }
  return { data: property };
});

ipcMain.handle('save-property', async (e, data) => {
  const saved = await upsertAsync('properties', data);
  return { success: true, data: saved };
});

ipcMain.handle('delete-property', async (e, id) => {
  // Cascade: delete child tanks first
  const tanks = await readCollectionAsync('tanks');
  const childTanks = tanks.filter(t => t.property_id === id);
  for (const t of childTanks) await removeAsync('tanks', t.id);
  await removeAsync('properties', id);
  return { success: true };
});

// ===== TANKS =====
ipcMain.handle('get-tanks', async (e, propertyId) => {
  let tanks = await readCollectionAsync('tanks');
  if (propertyId) tanks = tanks.filter(t => t.property_id === propertyId);
  return { data: tanks };
});

ipcMain.handle('save-tank', async (e, data) => {
  const saved = await upsertAsync('tanks', data);
  return { success: true, data: saved };
});

ipcMain.handle('delete-tank', async (e, id) => {
  await removeAsync('tanks', id);
  return { success: true };
});

// ===== VEHICLES =====
ipcMain.handle('get-vehicles', async () => {
  const vehicles = await readCollectionAsync('vehicles');
  vehicles.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  return { data: vehicles };
});

ipcMain.handle('save-vehicle', async (e, data) => {
  const saved = await upsertAsync('vehicles', data);
  return { success: true, data: saved };
});

ipcMain.handle('delete-vehicle', async (e, id) => {
  await removeAsync('vehicles', id);
  return { success: true };
});

ipcMain.handle('reorder-vehicles', async (e, orderedIds) => {
  const items = await readCollectionAsync('vehicles');
  const byId = Object.fromEntries(items.map(v => [v.id, v]));
  for (let idx = 0; idx < orderedIds.length; idx++) {
    const id = orderedIds[idx];
    if (byId[id] && byId[id].sort_order !== idx) {
      await upsertAsync('vehicles', { ...byId[id], sort_order: idx });
    }
  }
  return { success: true };
});

// ===== TRUCK DAY ASSIGNMENTS =====
ipcMain.handle('get-truck-day-assignments', async (e, date) => {
  const all = await readCollectionAsync('truck_day_assignments');
  return { data: date ? all.filter(a => a.date === date) : all };
});

ipcMain.handle('save-truck-day-assignment', async (e, data) => {
  // upsert by vehicle_id+date composite key
  const all = await readCollectionAsync('truck_day_assignments');
  const existing = all.find(a => a.vehicle_id === data.vehicle_id && a.date === data.date);
  if (existing) {
    await upsertAsync('truck_day_assignments', { ...existing, user_id: data.user_id });
  } else {
    await upsertAsync('truck_day_assignments', { ...data });
  }
  return { success: true };
});

// ===== JOBS =====
ipcMain.handle('get-jobs', async (e, filters) => {
  let jobs = (await readCollectionAsync('jobs')).filter(j => !j.deleted_at);
  const customers = await readCollectionAsync('customers');
  const users = await readCollectionAsync('users');
  const vehicles = await readCollectionAsync('vehicles');
  const properties = await readCollectionAsync('properties');

  if (filters?.date) {
    jobs = jobs.filter(j => j.scheduled_date === filters.date);
  }
  if (filters?.dateFrom && filters?.dateTo) {
    jobs = jobs.filter(j => j.scheduled_date >= filters.dateFrom && j.scheduled_date <= filters.dateTo);
  }
  if (filters?.assignedTo) jobs = jobs.filter(j => j.assigned_to === filters.assignedTo);
  if (filters?.vehicleId) jobs = jobs.filter(j => j.vehicle_id === filters.vehicleId);
  if (filters?.status) jobs = jobs.filter(j => j.status === filters.status);
  if (filters?.customerId) jobs = jobs.filter(j => j.customer_id === filters.customerId);
  if (filters?.propertyId) jobs = jobs.filter(j => j.property_id === filters.propertyId);

  const tanks = await readCollectionAsync('tanks');
  // Join customer, user, vehicle, property, tanks
  jobs = jobs.map(j => {
    const prop = properties.find(p => p.id === j.property_id) || null;
    return {
      ...j,
      customers: customers.find(c => c.id === j.customer_id) || null,
      users: users.find(u => u.id === j.assigned_to) || null,
      vehicle: vehicles.find(v => v.id === j.vehicle_id) || null,
      property: prop ? { ...prop, tanks: tanks.filter(t => t.property_id === prop.id) } : null,
    };
  });

  jobs.sort((a, b) => {
    const d = (a.scheduled_date || '').localeCompare(b.scheduled_date || '');
    if (d !== 0) return d;
    return (a.scheduled_time || '').localeCompare(b.scheduled_time || '');
  });

  return { data: jobs };
});

ipcMain.handle('get-job', async (e, id) => {
  const job = await findByIdAsync('jobs', id);
  if (job) {
    job.customers = await findByIdAsync('customers', job.customer_id);
    job.users = await findByIdAsync('users', job.assigned_to);
    job.vehicle = await findByIdAsync('vehicles', job.vehicle_id);
    const prop = await findByIdAsync('properties', job.property_id);
    if (prop) {
      const tanks = await readCollectionAsync('tanks');
      prop.tanks = tanks.filter(t => t.property_id === prop.id);
    }
    job.property = prop;
  }
  return { data: job };
});

// ===== APPOINTMENT CONFIRMATION EMAIL =====
// Returns a promise resolving to {status, reason?, to?, error?} so the caller
// can surface the outcome to the renderer instead of silently failing.
//   status = 'sent' | 'skipped' | 'failed'
async function sendJobConfirmEmail(job, customer, property, reason) {
  if (!job.scheduled_date) return { status: 'skipped', reason: 'Job has no scheduled date' };
  if (!customer) return { status: 'skipped', reason: 'No customer record' };
  // Never email demo/test data. Demo jobs, demo customers, and demo
  // properties are flagged with _test_data=true by the seeder so they
  // can be cascade-deleted; use that same flag to silence any outbound
  // mail no matter which path triggered the save.
  if (job._test_data || customer._test_data || (property && property._test_data)) {
    console.log(`[MAIL] Skipped job confirm: demo/test data (job ${job.id})`);
    return { status: 'skipped', reason: 'Demo/test data — no email sent' };
  }
  if (!customer.email || !customer.email.trim()) {
    console.log(`[MAIL] Skipped job confirm: customer "${customer.name}" has no email`);
    return { status: 'skipped', reason: `Customer "${customer.name || 'Unknown'}" has no email address on file` };
  }

  try {
    const settingsPath = path.join(userDataPath, 'settings.json');
    if (!fs.existsSync(settingsPath)) return { status: 'skipped', reason: 'settings.json not found' };
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (!settings.smtp_host) return { status: 'skipped', reason: 'SMTP not configured (Settings → SMTP Host is empty)' };
    if (settings.confirm_email_enabled === false) return { status: 'skipped', reason: 'Confirmation emails are disabled in Settings' };
    if (reason === 'reschedule' && !settings.confirm_email_send_on_reschedule) {
      return { status: 'skipped', reason: 'Reschedule emails are disabled in Settings' };
    }

    const transporter = nodemailer.createTransport({
      host: settings.smtp_host,
      port: parseInt(settings.smtp_port) || 587,
      secure: parseInt(settings.smtp_port) === 465,
      auth: { user: settings.smtp_user, pass: settings.smtp_pass },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
    });

    const companyName = settings.company_name || 'Interstate Septic Systems';
    const fromName = settings.confirm_email_from_name || companyName;
    const subject = reason === 'reschedule'
      ? (settings.confirm_email_subject || `Your Appointment Has Been Rescheduled — ${companyName}`).replace(/\{company\}/g, companyName)
      : (settings.confirm_email_subject || `Your Appointment Confirmation — ${companyName}`).replace(/\{company\}/g, companyName);

    const html = buildJobConfirmEmail(job, customer, property, settings);

    await transporter.sendMail({
      from: `"${fromName}" <${settings.smtp_user}>`,
      to: customer.email,
      subject,
      html,
    });
    console.log(`[MAIL] Job confirm (${reason}) sent to ${customer.email}`);
    return { status: 'sent', to: customer.email };
  } catch (err) {
    console.error('[MAIL ERROR] Job confirmation:', err.message);
    return { status: 'failed', error: err.message, to: customer.email };
  }
}

function buildJobConfirmEmail(job, customer, property, settings) {
  const companyName = settings.company_name || 'Interstate Septic Systems';
  const companyAddr = settings.company_address || '';
  const companyPhone = settings.company_phone || '';

  const firstName = (customer.name || 'Valued Customer').split(/\s+/)[0];

  const propAddr = property
    ? [property.address, property.city, property.state].filter(Boolean).join(', ')
    : (job.property_address || 'your property');

  const dateStr = job.scheduled_date
    ? new Date(job.scheduled_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    : 'TBD';

  let timeStr = '';
  const timeRaw = (job.scheduled_time || '').trim();
  if (timeRaw) {
    const m = timeRaw.match(/^(\d{1,2}):(\d{2})/);
    if (m) {
      const h = parseInt(m[1]), mm = m[2];
      timeStr = ` at ${h > 12 ? h - 12 : h || 12}:${mm} ${h >= 12 ? 'PM' : 'AM'}`;
    } else {
      timeStr = ` at ${timeRaw}`;
    }
  }

  // Build service list from line items or service_type
  const lineItems = job.line_items || [];
  let services = lineItems.map(li => li.description).filter(Boolean);
  if (!services.length && job.service_type) {
    services = job.service_type.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (!services.length) services = ['Septic Service'];

  // Policy bullets — one non-empty line per bullet
  const policyLines = (settings.confirm_email_policy || '').split('\n').map(l => l.trim()).filter(Boolean);

  // Footer
  const footerText = settings.confirm_email_footer || 'Please respond at least 48 hours before your appointment if you need to reschedule or cancel.';

  // Confirm button URL
  const { publicUrl, port } = getServerSettings();
  const confirmUrl = publicUrl ? `${publicUrl}:${port}/confirm-job?id=${job.id}` : null;
  const phoneClean = companyPhone.replace(/\D/g, '');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;">
<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;background:#ffffff;padding:32px 28px;">

  <div style="text-align:center;margin-bottom:28px;padding-bottom:20px;border-bottom:1px solid #e0e0e0;">
    <h2 style="margin:0 0 6px;font-size:22px;font-weight:bold;color:#111;">${companyName}</h2>
    ${companyAddr ? `<p style="margin:2px 0;font-size:13px;color:#666;">${companyAddr}</p>` : ''}
    ${companyPhone ? `<p style="margin:4px 0;"><a href="tel:${phoneClean}" style="color:#1565c0;font-size:14px;">${companyPhone}</a></p>` : ''}
  </div>

  <p style="margin:0 0 12px;">Dear ${firstName},</p>
  <p style="margin:0 0 12px;">Your new appointment for service at <strong>${propAddr}</strong> is scheduled on <strong>${dateStr}${timeStr}</strong>.</p>
  <p style="margin:0 0 20px;">We look forward to seeing you then.</p>

  ${services.length ? `
  <p style="margin:0 0 8px;">Your scheduled services include:</p>
  <ul style="margin:0 0 20px;padding-left:22px;color:#1565c0;">
    ${services.map(s => `<li style="margin-bottom:5px;">${s}</li>`).join('')}
  </ul>` : ''}

  ${policyLines.length ? `
  <p style="margin:0 0 8px;font-weight:bold;">Attention: Possible Additional Costs Explained Below</p>
  <ul style="margin:0 0 20px;padding-left:22px;color:#b71c1c;">
    ${policyLines.map(l => `<li style="margin-bottom:8px;">${l}</li>`).join('')}
  </ul>` : ''}

  ${companyPhone ? `<p style="margin:0 0 12px;">If you have any questions, please call us at <a href="tel:${phoneClean}" style="color:#1565c0;">${companyPhone}</a></p>` : ''}

  <p style="margin:0 0 28px;">${footerText}</p>

  <div style="text-align:center;margin-bottom:24px;">
    ${confirmUrl
      ? `<a href="${confirmUrl}" style="display:inline-block;background:#2e7d32;color:#fff;padding:14px 36px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:15px;">Agree &amp; Confirm</a>`
      : (companyPhone ? `<a href="tel:${phoneClean}" style="display:inline-block;background:#2e7d32;color:#fff;padding:14px 36px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:15px;">Call to Confirm: ${companyPhone}</a>` : '')
    }
  </div>

  <hr style="border:none;border-top:1px solid #eee;margin:0 0 16px;">
  <p style="font-size:11px;color:#bbb;text-align:center;margin:0;">This is an automated message from ${companyName}. Please do not reply directly to this email.</p>
</div>
</body>
</html>`;
}

function shouldSendJobConfirm(settings) {
  // Send if SMTP is configured AND confirm emails are enabled (default on if not set)
  return !!(settings.smtp_host && settings.confirm_email_enabled !== false);
}

// ===== TEST SMTP =====
// Sends a test email using either live form values (passed from the Settings
// screen before saving) or the currently saved settings. Renders a realistic
// sample appointment-confirmation email so the recipient can verify the layout.
ipcMain.handle('send-test-email', async (e, payload) => {
  payload = payload || {};
  const to = (payload.to || 'tyler.interstateseptic@gmail.com').trim();

  // Merge live form overrides over saved settings so we test the exact config
  // the user is looking at without forcing them to save first.
  let saved = {};
  try {
    const p = path.join(userDataPath, 'settings.json');
    if (fs.existsSync(p)) saved = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {}
  const s = { ...saved, ...(payload.settings || {}) };

  if (!s.smtp_host) return { success: false, error: 'SMTP Host is empty. Enter smtp.gmail.com (or your provider) first.' };
  if (!s.smtp_user) return { success: false, error: 'SMTP User is empty.' };
  if (!s.smtp_pass) return { success: false, error: 'SMTP Password is empty. For Gmail this must be a 16-character App Password.' };

  const port = parseInt(s.smtp_port) || 587;
  const secure = port === 465;
  const companyName = s.company_name || 'Interstate Septic Systems';
  const fromName = s.confirm_email_from_name || companyName;

  try {
    const transporter = nodemailer.createTransport({
      host: s.smtp_host,
      port,
      secure,
      auth: { user: s.smtp_user, pass: s.smtp_pass },
      // Short timeouts so we don't hang the UI for 60s on a bad host
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
    });

    // Verify reachability/auth first for a clearer error before sendMail
    try {
      await transporter.verify();
    } catch (vErr) {
      return { success: false, error: `SMTP verify failed: ${vErr.message}` };
    }

    // Build a realistic sample appointment email so the user sees what a
    // real confirmation looks like.
    const sampleJob = {
      id: 'test-' + Date.now(),
      scheduled_date: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
      scheduled_time: '07:30',
      service_type: 'Septic Pumping, Filter Cleaning',
      line_items: [
        { description: 'Septic Tank Pumping (1,000 gal)' },
        { description: 'Effluent Filter Cleaning' },
      ],
      property_address: '123 Sample Rd, Camden, ME',
    };
    const sampleCustomer = { name: 'Test Customer', email: to };
    const sampleProperty = { address: '123 Sample Rd', city: 'Camden', state: 'ME', zip: '04843' };

    const html = `
      <div style="max-width:620px;margin:0 auto;font-family:Arial,sans-serif;">
        <div style="background:#1b5e20;color:#fff;padding:12px 20px;border-radius:6px 6px 0 0;font-size:14px;font-weight:bold;">
          ✅ SMTP TEST — Interstate Septic Manager
        </div>
        <div style="border:1px solid #e0e0e0;border-top:none;padding:16px 20px;background:#f9fdf9;font-size:13px;color:#333;border-radius:0 0 6px 6px;margin-bottom:20px;">
          <p style="margin:0 0 6px;">If you're reading this, your SMTP settings are working and confirmation emails will be delivered to your customers.</p>
          <p style="margin:0 0 6px;"><strong>Host:</strong> ${s.smtp_host} &nbsp; <strong>Port:</strong> ${port} &nbsp; <strong>User:</strong> ${s.smtp_user}</p>
          <p style="margin:0;color:#666;">A sample appointment confirmation is shown below, exactly as customers will receive it.</p>
        </div>
        ${buildJobConfirmEmail(sampleJob, sampleCustomer, sampleProperty, s)}
      </div>
    `;

    const info = await transporter.sendMail({
      from: `"${fromName}" <${s.smtp_user}>`,
      to,
      subject: `[TEST] Appointment Confirmation — ${companyName}`,
      html,
    });

    console.log(`[MAIL] Test email sent to ${to}: ${info.messageId}`);
    return { success: true, messageId: info.messageId, to };
  } catch (err) {
    console.error('[MAIL ERROR] test email:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('save-job', async (e, data) => {
  const isNew = !data.id;
  const saved = await upsertAsync('jobs', data);

  // Auto-create/sync invoice
  if (isNew) {
    // Generate next invoice number
    const invoices = await readCollectionAsync('invoices');
    let nextNum = 1;
    if (invoices.length > 0) {
      const nums = invoices.map(i => parseInt((i.invoice_number || '0').replace(/\D/g, '')) || 0);
      nextNum = Math.max(...nums) + 1;
    }
    const invoiceNumber = String(nextNum);

    const customer = await findByIdAsync('customers', saved.customer_id);
    const property = await findByIdAsync('properties', saved.property_id);
    const totalGal = Object.values(saved.gallons_pumped || {}).reduce((s, g) => s + (parseInt(g) || 0), 0);
    const lineItems = saved.line_items || [];
    const subtotal = lineItems.reduce((s, li) => s + ((li.qty || 0) * (li.unit_price || 0)), 0);

    await upsertAsync('invoices', {
      invoice_number: invoiceNumber,
      job_id: saved.id,
      customer_id: saved.customer_id,
      property_id: saved.property_id,
      svc_date: saved.scheduled_date || null,
      vehicle_id: saved.vehicle_id || null,
      driver_id: saved.assigned_to || null,
      gallons_pumped: totalGal,
      job_codes: saved.service_type || '',
      complete: saved.status === 'completed',
      line_items: lineItems,
      subtotal,
      tax_rate: 0,
      tax_amount: 0,
      total: subtotal,
      status: 'draft',
      payment_status: 'unpaid',
      payment_method: '',
      amount_paid: 0,
      billing_company: customer?.company || customer?.name || '',
      property_address: property?.address || '',
      property_city: property?.city || '',
      notes: '',
    });

    // Send appointment confirmation email (new job)
    var emailResult = await sendJobConfirmEmail(saved, customer, property, 'new');
  } else {
    // Sync existing draft invoice linked to this job
    const invoices = await readCollectionAsync('invoices');
    const linked = invoices.find(i => i.job_id === saved.id && i.status === 'draft');
    const customer = await findByIdAsync('customers', saved.customer_id);
    const property = await findByIdAsync('properties', saved.property_id);
    if (linked) {
      const totalGal = Object.values(saved.gallons_pumped || {}).reduce((s, g) => s + (parseInt(g) || 0), 0);
      const lineItems = saved.line_items || [];
      const subtotal = lineItems.reduce((s, li) => s + ((li.qty || 0) * (li.unit_price || 0)), 0);

      await upsertAsync('invoices', {
        id: linked.id,
        customer_id: saved.customer_id,
        property_id: saved.property_id,
        svc_date: saved.scheduled_date || null,
        vehicle_id: saved.vehicle_id || null,
        driver_id: saved.assigned_to || null,
        gallons_pumped: totalGal,
        job_codes: saved.service_type || '',
        complete: saved.status === 'completed',
        line_items: lineItems,
        subtotal,
        total: subtotal + (linked.tax_amount || 0),
        billing_company: customer?.company || customer?.name || '',
        property_address: property?.address || '',
        property_city: property?.city || '',
      });
    }

    // Send reschedule confirmation if date changed and setting is on
    var emailResult = null;
    if (saved.scheduled_date && saved.scheduled_date !== data._prevScheduledDate) {
      emailResult = await sendJobConfirmEmail(saved, customer, property, 'reschedule');
    }
  }

  return { success: true, data: saved, email: emailResult || null };
});

ipcMain.handle('update-job-status', async (e, id, status) => {
  const job = await findByIdAsync('jobs', id);
  if (!job) return { success: false, error: 'Job not found' };
  const updates = { ...job, status, updated_at: new Date().toISOString() };
  if (status === 'completed') updates.completed_at = new Date().toISOString();
  await upsertAsync('jobs', updates);

  // Sync complete flag on linked invoice
  const invoices = await readCollectionAsync('invoices');
  const linked = invoices.find(i => i.job_id === id);
  if (linked) {
    await upsertAsync('invoices', { ...linked, complete: (status === 'completed') });
  }
  return { success: true };
});

ipcMain.handle('delete-job', async (e, id) => {
  const job = await findByIdAsync('jobs', id);
  if (job) {
    const now = new Date().toISOString();
    await upsertAsync('jobs', { ...job, deleted_at: now });
    // Soft-delete linked invoice so it disappears from reports/invoices
    const invoices = await readCollectionAsync('invoices');
    const linkedInv = invoices.find(i => i.job_id === id && !i.deleted_at);
    if (linkedInv) await upsertAsync('invoices', { ...linkedInv, deleted_at: now });
  }
  return { success: true };
});

ipcMain.handle('bulk-delete-customers', async (e, ids) => {
  const sendProgress = (p) => { try { e.sender.send('bulk-delete-progress', p); } catch (_) {} };
  const idSet = new Set(ids);
  sendProgress({ stage: 'reading', message: 'Loading data…' });

  const customers = readCollection('customers').filter(c => !idSet.has(c.id));
  const allProperties = readCollection('properties');
  const removedPropIds = new Set(allProperties.filter(p => idSet.has(p.customer_id)).map(p => p.id));
  const properties = allProperties.filter(p => !idSet.has(p.customer_id));
  const tanks = readCollection('tanks').filter(t => !removedPropIds.has(t.property_id));

  sendProgress({ stage: 'saving', message: 'Writing to disk…', total: ids.length, current: ids.length });
  await new Promise(r => setImmediate(r));
  writeCollection('customers', customers);
  writeCollection('properties', properties);
  writeCollection('tanks', tanks);
  broadcastDataChange('customers');
  broadcastDataChange('properties');
  broadcastDataChange('tanks');
  sendProgress({ stage: 'done', deleted: ids.length });
  return { success: true, deleted: ids.length };
});

ipcMain.handle('bulk-delete-invoices', async (e, ids) => {
  const sendProgress = (p) => { try { e.sender.send('bulk-delete-progress', p); } catch (_) {} };
  const idSet = new Set(ids);
  sendProgress({ stage: 'reading', message: 'Loading data…' });
  const invoices = readCollection('invoices').filter(i => !idSet.has(i.id));
  sendProgress({ stage: 'saving', message: 'Writing to disk…', total: ids.length, current: ids.length });
  await new Promise(r => setImmediate(r));
  writeCollection('invoices', invoices);
  broadcastDataChange('invoices');
  sendProgress({ stage: 'done', deleted: ids.length });
  return { success: true, deleted: ids.length };
});

ipcMain.handle('bulk-cancel-invoices', async (e, ids, cancel) => {
  const idSet = new Set(ids);
  const now = new Date().toISOString();
  const invoices = readCollection('invoices').map(i =>
    idSet.has(i.id) ? { ...i, cancelled: !!cancel, cancelled_at: cancel ? now : null, updated_at: now } : i
  );
  writeCollection('invoices', invoices);
  broadcastDataChange('invoices');
  return { success: true, updated: ids.length };
});

ipcMain.handle('bulk-delete-jobs', async (e, ids) => {
  const sendProgress = (p) => { try { e.sender.send('bulk-delete-progress', p); } catch (_) {} };
  const idSet = new Set(ids);
  sendProgress({ stage: 'reading', message: 'Loading data…' });

  const jobs = readCollection('jobs').slice();
  const invoices = readCollection('invoices').slice();
  const now = new Date().toISOString();

  for (let i = 0; i < jobs.length; i++) {
    if (idSet.has(jobs[i].id)) {
      jobs[i] = { ...jobs[i], deleted_at: now, updated_at: now };
    }
  }
  for (let i = 0; i < invoices.length; i++) {
    if (idSet.has(invoices[i].job_id) && !invoices[i].deleted_at) {
      invoices[i] = { ...invoices[i], deleted_at: now, updated_at: now };
    }
  }

  sendProgress({ stage: 'saving', message: 'Writing to disk…', total: ids.length, current: ids.length });
  await new Promise(r => setImmediate(r));
  writeCollection('jobs', jobs);
  writeCollection('invoices', invoices);
  broadcastDataChange('jobs');
  broadcastDataChange('invoices');
  sendProgress({ stage: 'done', deleted: ids.length });
  return { success: true, deleted: ids.length };
});

ipcMain.handle('purge-trash-item', async (e, id, type) => {
  if (type === 'job') {
    remove('jobs', id);
    const invoices = readCollection('invoices');
    const linked = invoices.find(i => i.job_id === id);
    if (linked) remove('invoices', linked.id);
  } else if (type === 'manifest') {
    remove('schedule_items', id);
  } else if (type === 'payment') {
    remove('payments', id);
  } else if (type === 'invoice') {
    remove('invoices', id);
  } else if (type === 'service_due_notice') {
    remove('service_due_notices', id);
  } else if (type === 'disposal_load') {
    remove('disposal_loads', id);
  }
  return { success: true };
});

ipcMain.handle('restore-trash-item', async (e, id, type) => {
  if (type === 'job') {
    const jobs = readCollection('jobs');
    const job = jobs.find(j => j.id === id);
    if (job) {
      upsert('jobs', { ...job, deleted_at: null });
      // Restore linked invoice if it was soft-deleted with this job
      const invoices = readCollection('invoices');
      const linkedInv = invoices.find(i => i.job_id === id && i.deleted_at);
      if (linkedInv) upsert('invoices', { ...linkedInv, deleted_at: null });
    }
  } else if (type === 'manifest') {
    const items = readCollection('schedule_items');
    const item = items.find(i => i.id === id);
    if (item) upsert('schedule_items', { ...item, deleted_at: null });
  } else if (type === 'payment') {
    const payments = readCollection('payments');
    const payment = payments.find(p => p.id === id);
    if (payment) {
      upsert('payments', { ...payment, deleted_at: null });
      // Recalculate invoice with payment restored
      if (payment.invoice_id) {
        const allPmts = readCollection('payments').filter(p => p.invoice_id === payment.invoice_id && !p.deleted_at);
        const totalPaid = allPmts.reduce((s, p) => p.type === 'refund' ? s - (parseFloat(p.amount) || 0) : s + (parseFloat(p.amount) || 0), 0);
        const invoices = readCollection('invoices');
        const inv = invoices.find(i => i.id === payment.invoice_id);
        if (inv) {
          inv.amount_paid = Math.max(0, totalPaid);
          const invTotal = parseFloat(inv.total) || 0;
          inv.payment_status = inv.amount_paid >= invTotal && invTotal > 0 ? 'paid' : inv.amount_paid > 0 ? 'partial' : 'unpaid';
          writeCollection('invoices', invoices);
        }
      }
    }
  } else if (type === 'invoice') {
    const invoices = readCollection('invoices');
    const inv = invoices.find(i => i.id === id);
    if (inv) {
      upsert('invoices', { ...inv, deleted_at: null });
      // Clear invoice_suppressed on the linked job so it doesn't confuse backfill
      if (inv.job_id) {
        const jobs = readCollection('jobs');
        const idx = jobs.findIndex(j => j.id === inv.job_id);
        if (idx >= 0 && jobs[idx].invoice_suppressed) {
          jobs[idx] = { ...jobs[idx], invoice_suppressed: false, updated_at: new Date().toISOString() };
          writeCollection('jobs', jobs);
        }
      }
    }
  } else if (type === 'service_due_notice') {
    const notices = readCollection('service_due_notices');
    const notice = notices.find(n => n.id === id);
    if (notice) upsert('service_due_notices', { ...notice, deleted_at: null });
  } else if (type === 'disposal_load') {
    const loads = readCollection('disposal_loads');
    const load = loads.find(l => l.id === id);
    if (load) upsert('disposal_loads', { ...load, deleted_at: null });
  }
  return { success: true };
});

ipcMain.handle('get-trash', async () => {
  const allJobs = readCollection('jobs').filter(j => j.deleted_at);
  const allItems = readCollection('schedule_items').filter(i => i.deleted_at && i.item_type === 'manifest');
  const allPayments = readCollection('payments').filter(p => p.deleted_at);
  const allInvoices = readCollection('invoices').filter(i => i.deleted_at);
  const allNotices = readCollection('service_due_notices').filter(n => n.deleted_at);
  const allLoads = readCollection('disposal_loads').filter(l => l.deleted_at);
  const customers = readCollection('customers');
  const properties = readCollection('properties');
  const vehicles = readCollection('vehicles');
  const invoices = readCollection('invoices');

  const trashJobs = allJobs.map(j => {
    const customer = customers.find(c => c.id === j.customer_id) || {};
    const property = properties.find(p => p.id === j.property_id) || {};
    return {
      ...j,
      trash_type: 'job',
      customer_name: customer.name || '',
      customer_phone: customer.phone_cell || customer.phone || '',
      customer_email: customer.email || '',
      property_address: property.address || '',
      property_city: property.city || '',
      property_state: property.state || '',
    };
  });

  const trashManifests = allItems.map(i => {
    const vehicle = vehicles.find(v => v.id === i.vehicle_id) || {};
    return {
      ...i,
      trash_type: 'manifest',
      vehicle_name: vehicle.name || '',
      customer_names: i.snapshot_customer_names || '',
      addresses: i.snapshot_addresses || '',
    };
  });

  const trashPayments = allPayments.map(p => {
    const customer = customers.find(c => c.id === p.customer_id) || {};
    const invoice = invoices.find(i => i.id === p.invoice_id) || {};
    return {
      ...p,
      trash_type: 'payment',
      customer_name: customer.name || '',
      invoice_number: invoice.invoice_number || '',
    };
  });

  const trashInvoices = allInvoices.map(inv => {
    const customer = customers.find(c => c.id === inv.customer_id) || {};
    const property = properties.find(p => p.id === inv.property_id) || {};
    return {
      ...inv,
      trash_type: 'invoice',
      customer_name: customer.name || '',
      customer_phone: customer.phone_cell || customer.phone || '',
      customer_email: customer.email || '',
      property_address: property.address || '',
      property_city: property.city || '',
      property_state: property.state || '',
    };
  });

  const trashNotices = allNotices.map(n => {
    const customer = customers.find(c => c.id === n.customer_id) || {};
    const property = properties.find(p => p.id === n.property_id) || {};
    return {
      ...n,
      trash_type: 'service_due_notice',
      customer_name: customer.name || '',
      customer_phone: customer.phone_cell || customer.phone || '',
      customer_email: customer.email || '',
      property_address: property.address || '',
      property_city: property.city || '',
      property_state: property.state || '',
    };
  });

  const trashLoads = allLoads.map(l => {
    const customer = customers.find(c => c.id === l.customer_id) || {};
    return {
      ...l,
      trash_type: 'disposal_load',
      customer_name: customer.name || '',
    };
  });

  const all = [...trashJobs, ...trashManifests, ...trashPayments, ...trashInvoices, ...trashNotices, ...trashLoads]
    .sort((a, b) => (b.deleted_at || '').localeCompare(a.deleted_at || ''));
  return { data: all };
});

// ===== INVOICES =====
ipcMain.handle('get-invoices', async (e, filters) => {
  let invoices = (await readCollectionAsync('invoices')).filter(i => !i.deleted_at);
  const customers = await readCollectionAsync('customers');
  const properties = await readCollectionAsync('properties');
  const vehicles = await readCollectionAsync('vehicles');
  const users = await readCollectionAsync('users');

  // Filtering
  if (filters?.status) invoices = invoices.filter(i => i.status === filters.status);
  if (filters?.customerId) invoices = invoices.filter(i => i.customer_id === filters.customerId);
  if (filters?.dateFrom) invoices = invoices.filter(i => (i.svc_date || i.created_at?.split('T')[0] || '') >= filters.dateFrom);
  if (filters?.dateTo) invoices = invoices.filter(i => (i.svc_date || i.created_at?.split('T')[0] || '') <= filters.dateTo);
  if (filters?.creationDateFrom) invoices = invoices.filter(i => (i.created_at?.split('T')[0] || '') >= filters.creationDateFrom);
  if (filters?.creationDateTo) invoices = invoices.filter(i => (i.created_at?.split('T')[0] || '') <= filters.creationDateTo);
  if (filters?.paymentStatus) invoices = invoices.filter(i => i.payment_status === filters.paymentStatus);
  if (filters?.paymentMethod) invoices = invoices.filter(i => i.payment_method === filters.paymentMethod);
  if (filters?.vehicleId) invoices = invoices.filter(i => i.vehicle_id === filters.vehicleId);
  if (filters?.driverId) invoices = invoices.filter(i => i.driver_id === filters.driverId);
  if (filters?.propertyCity) invoices = invoices.filter(i => i.property_city === filters.propertyCity);
  if (filters?.complete === true) invoices = invoices.filter(i => i.complete === true);
  if (filters?.complete === false) invoices = invoices.filter(i => !i.complete);
  if (filters?.jobCodes) invoices = invoices.filter(i => (i.job_codes || '').toLowerCase().includes(filters.jobCodes.toLowerCase()));
  if (filters?.wasteSiteId) invoices = invoices.filter(i => i.waste_site_id === filters.wasteSiteId);
  // Waiting area: derive from empty truck on TankTrack-imported rows missing the flag
  const isWaiting = (i) => (i.waiting_area === true)
    || (i.waiting_area == null && i.imported_from === 'tanktrack' && !(i.truck || '').trim());
  if (filters?.waitingArea === 'only') invoices = invoices.filter(isWaiting);
  else if (filters?.waitingArea === 'hide') invoices = invoices.filter(i => !isWaiting(i));
  // Default: include waiting-area invoices (town contracts etc. are real invoices)

  // Cancelled: hidden by default, matches TankTrack UI behavior
  if (filters?.cancelled === 'only') invoices = invoices.filter(i => i.cancelled === true);
  else if (filters?.cancelled === 'include') {} // show all
  else invoices = invoices.filter(i => i.cancelled !== true);

  // Join related data (exclude soft-deleted jobs from the lookup)
  const jobs = (await readCollectionAsync('jobs')).filter(j => !j.deleted_at);
  invoices = invoices.map(i => {
    const cust = customers.find(c => c.id === i.customer_id) || null;
    const prop = properties.find(p => p.id === i.property_id) || null;
    const veh = vehicles.find(v => v.id === i.vehicle_id) || null;
    const drv = users.find(u => u.id === i.driver_id) || null;
    // Ensure job_id exists — fallback: find job by matching customer + svc_date
    let jobId = i.job_id;
    if (!jobId && i.customer_id && i.svc_date) {
      const matchJob = jobs.find(j => j.customer_id === i.customer_id && j.scheduled_date === i.svc_date);
      if (matchJob) jobId = matchJob.id;
    }
    return {
      ...i,
      job_id: jobId || null,
      customers: cust,
      property: prop,
      vehicle: veh,
      driver: drv,
      // Ensure display fields are populated from joins if not stored
      billing_company: i.billing_company || cust?.company || cust?.name || '',
      billing_city: cust?.city || prop?.city || '',
      property_address: i.property_address || prop?.address || '',
      property_city: i.property_city || prop?.city || '',
    };
  });

  // Sorting
  const sortField = filters?.sortField || 'svc_date';
  const sortDir = filters?.sortDir === 'asc' ? 1 : -1;
  invoices.sort((a, b) => {
    let va = a[sortField] ?? '';
    let vb = b[sortField] ?? '';
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sortDir;
    return String(va).localeCompare(String(vb)) * sortDir;
  });

  // Totals (before pagination)
  const totals = {
    count: invoices.length,
    invoice_total: invoices.reduce((s, i) => s + (Number(i.total) || 0), 0),
    amount_paid: invoices.reduce((s, i) => s + (Number(i.amount_paid) || 0), 0),
    gallons_pumped: invoices.reduce((s, i) => s + (Number(i.gallons_pumped_total) || 0), 0),
    product_sales: invoices.reduce((s, i) => s + (Number(i.product_sales) || 0), 0),
  };

  const total = invoices.length;
  return { data: invoices, total, page: 1, perPage: total, totals };
});

ipcMain.handle('get-invoice', async (e, id) => {
  const invoice = await findByIdAsync('invoices', id);
  if (invoice) {
    invoice.customers = await findByIdAsync('customers', invoice.customer_id);
    invoice.property = await findByIdAsync('properties', invoice.property_id);
    invoice.vehicle = await findByIdAsync('vehicles', invoice.vehicle_id);
    invoice.driver = await findByIdAsync('users', invoice.driver_id);
  }
  return { data: invoice };
});

ipcMain.handle('save-invoice', async (e, data) => {
  const saved = await upsertAsync('invoices', data);
  return { success: true, data: saved };
});

ipcMain.handle('delete-invoice', async (e, id) => {
  const invoices = await readCollectionAsync('invoices');
  const inv = invoices.find(i => i.id === id);
  if (!inv) return { success: true };
  // Stamp the linked job so backfill won't recreate the invoice
  if (inv.job_id) {
    const job = await findByIdAsync('jobs', inv.job_id);
    if (job) await upsertAsync('jobs', { ...job, invoice_suppressed: true });
  }
  // Soft-delete so it lands in the recycling bin
  await upsertAsync('invoices', { ...inv, deleted_at: new Date().toISOString() });
  return { success: true };
});

ipcMain.handle('get-next-invoice-number', async () => {
  const invoices = await readCollectionAsync('invoices');
  if (invoices.length === 0) return { number: '1' };
  const nums = invoices.map(i => parseInt((i.invoice_number || '0').replace(/\D/g, '')) || 0);
  const next = Math.max(...nums) + 1;
  return { number: String(next) };
});

ipcMain.handle('get-invoice-filter-options', async () => {
  const customers = readCollection('customers');
  const properties = readCollection('properties');
  const vehicles = readCollection('vehicles');
  const users = readCollection('users');
  const wasteSites = readCollection('waste_sites');

  const cities = [...new Set(properties.map(p => p.city).filter(Boolean))].sort();
  const states = [...new Set(properties.map(p => p.state).filter(Boolean))].sort();
  const counties = [...new Set(properties.map(p => p.county).filter(Boolean))].sort();
  const zips = [...new Set(properties.map(p => p.zip).filter(Boolean))].sort();

  return {
    customers: customers.map(c => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)),
    vehicles: vehicles.map(v => ({ id: v.id, name: v.name })).sort((a, b) => a.name.localeCompare(b.name)),
    drivers: users.map(u => ({ id: u.id, name: u.name })).sort((a, b) => a.name.localeCompare(b.name)),
    wasteSites: wasteSites.map(w => ({ id: w.id, name: w.name })).sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    cities, states, counties, zips,
  };
});

ipcMain.handle('backfill-invoices', async () => {
  // Skip deleted jobs so backfill doesn't recreate invoices for things in the trash
  const jobs = readCollection('jobs').filter(j => !j.deleted_at);
  const invoices = readCollection('invoices'); // keep all (incl deleted) so we don't re-link job_ids
  const customers = readCollection('customers');
  const properties = readCollection('properties');
  const linkedJobIds = new Set(invoices.map(i => i.job_id).filter(Boolean));

  let created = 0;
  let nextNum = 1;
  if (invoices.length > 0) {
    const nums = invoices.map(i => parseInt((i.invoice_number || '0').replace(/\D/g, '')) || 0);
    nextNum = Math.max(...nums) + 1;
  }

  for (const job of jobs) {
    if (linkedJobIds.has(job.id)) continue; // already has invoice
    if (job.invoice_suppressed) continue; // invoice was manually deleted
    const customer = customers.find(c => c.id === job.customer_id);
    const property = properties.find(p => p.id === job.property_id);
    const totalGal = Object.values(job.gallons_pumped || {}).reduce((s, g) => s + (parseInt(g) || 0), 0);
    const lineItems = job.line_items || [];
    const subtotal = lineItems.reduce((s, li) => s + ((li.qty || 0) * (li.unit_price || 0)), 0);

    upsert('invoices', {
      invoice_number: String(nextNum++),
      job_id: job.id,
      customer_id: job.customer_id,
      property_id: job.property_id,
      svc_date: job.scheduled_date || null,
      vehicle_id: job.vehicle_id || null,
      driver_id: job.assigned_to || null,
      gallons_pumped: totalGal,
      job_codes: job.service_type || '',
      complete: job.status === 'completed',
      line_items: lineItems,
      subtotal,
      tax_rate: 0,
      tax_amount: 0,
      total: subtotal,
      status: 'draft',
      payment_status: 'unpaid',
      payment_method: '',
      amount_paid: 0,
      billing_company: customer?.company || customer?.name || '',
      property_address: property?.address || '',
      property_city: property?.city || '',
      notes: '',
    });
    created++;
  }
  return { created };
});

// ===== PAYMENTS / ACCOUNTING =====
ipcMain.handle('get-customer-balance', async (e, customerId) => {
  const invoices = readCollection('invoices').filter(i => i.customer_id === customerId && !i.deleted_at);
  const totalInvoiced = invoices.reduce((s, i) => s + (parseFloat(i.total) || 0), 0);
  const totalPaid = invoices.reduce((s, i) => s + (parseFloat(i.amount_paid) || 0), 0);
  const balance = totalInvoiced - totalPaid;

  const now = Date.now();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  const overdue = invoices.some(i => {
    if (i.payment_status === 'paid') return false;
    const svcDate = i.svc_date ? new Date(i.svc_date).getTime() : null;
    return svcDate && (now - svcDate) > thirtyDays && (parseFloat(i.total) || 0) > (parseFloat(i.amount_paid) || 0);
  });

  return { balance, totalInvoiced, totalPaid, overdue, invoiceCount: invoices.length };
});

ipcMain.handle('get-payments', async (e, customerId) => {
  const payments = (await readCollectionAsync('payments')).filter(p => p.customer_id === customerId && !p.deleted_at);
  payments.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return { data: payments };
});

ipcMain.handle('save-payment', async (e, data) => {
  const saved = await upsertAsync('payments', data);

  // Update linked invoice amount_paid
  if (data.invoice_id) {
    const invoices = await readCollectionAsync('invoices');
    const payments = (await readCollectionAsync('payments')).filter(p => p.invoice_id === data.invoice_id && !p.deleted_at);
    const totalPaidForInv = payments.reduce((s, p) => {
      if (p.type === 'refund') return s - (parseFloat(p.amount) || 0);
      return s + (parseFloat(p.amount) || 0);
    }, 0);

    const inv = invoices.find(i => i.id === data.invoice_id);
    if (inv) {
      const updated = { ...inv, amount_paid: Math.max(0, totalPaidForInv) };
      const invTotal = parseFloat(inv.total) || 0;
      if (updated.amount_paid >= invTotal && invTotal > 0) {
        updated.payment_status = 'paid';
      } else if (updated.amount_paid > 0) {
        updated.payment_status = 'partial';
      } else {
        updated.payment_status = 'unpaid';
      }
      await upsertAsync('invoices', updated);
    }
  }

  return { success: true, data: saved };
});

ipcMain.handle('delete-payment', async (e, id) => {
  const payment = await findByIdAsync('payments', id);
  if (!payment) return { success: true };
  const invoiceId = payment.invoice_id;

  // Soft-delete: stamp deleted_at so it lands in the recycling bin
  await upsertAsync('payments', { ...payment, deleted_at: new Date().toISOString() });

  // Recalculate invoice amount_paid excluding the now-deleted payment
  if (invoiceId) {
    const allPayments = (await readCollectionAsync('payments')).filter(p => p.invoice_id === invoiceId && !p.deleted_at);
    const totalPaid = allPayments.reduce((s, p) => p.type === 'refund' ? s - (parseFloat(p.amount) || 0) : s + (parseFloat(p.amount) || 0), 0);
    const inv = await findByIdAsync('invoices', invoiceId);
    if (inv) {
      const updated = { ...inv, amount_paid: Math.max(0, totalPaid) };
      const invTotal = parseFloat(inv.total) || 0;
      updated.payment_status = updated.amount_paid >= invTotal && invTotal > 0 ? 'paid' : updated.amount_paid > 0 ? 'partial' : 'unpaid';
      await upsertAsync('invoices', updated);
    }
  }

  return { success: true };
});

// ===== AUTOMATIC FILTER CLEANINGS (AFC) =====

// ensure-filter-lead: create a lead if none exists for this job yet
ipcMain.handle('ensure-filter-lead', async (e, data) => {
  const leads = readCollection('filter_leads');
  const exists = leads.find(l => l.job_id === data.job_id);
  if (!exists) {
    const customers = readCollection('customers');
    const properties = readCollection('properties');
    const cust = customers.find(c => c.id === data.customer_id) || {};
    const prop = properties.find(p => p.id === data.property_id) || {};
    // Check if this customer already has an active AFC
    const afcs = readCollection('afcs');
    const hasAfc = afcs.some(a => a.customer_id === data.customer_id && a.property_id === data.property_id && a.status === 'active');
    upsert('filter_leads', {
      job_id: data.job_id,
      customer_id: data.customer_id,
      property_id: data.property_id,
      scheduled_date: data.scheduled_date,
      customer_name: cust.name || '',
      property_address: prop.address || '',
      property_city: prop.city || '',
      has_afc: hasAfc,
      status: 'pending', // pending | approved | declined | no_answer
      notes: '',
    });
  }
  return { success: true };
});

ipcMain.handle('get-filter-leads', async (e, filters) => {
  let leads = readCollection('filter_leads');
  const customers = readCollection('customers');
  const properties = readCollection('properties');
  const jobs = readCollection('jobs').filter(j => !j.deleted_at);
  if (filters?.status) leads = leads.filter(l => l.status === filters.status);
  leads = leads.map(l => {
    const customer = customers.find(c => c.id === l.customer_id) || {};
    const property = properties.find(p => p.id === l.property_id) || {};
    const job = jobs.find(j => j.id === l.job_id) || {};
    return { ...l, customer, property, job };
  });
  leads.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  return { data: leads };
});

ipcMain.handle('save-filter-lead', async (e, data) => {
  const saved = upsert('filter_leads', data);
  return { success: true, data: saved };
});

ipcMain.handle('delete-filter-lead', async (e, id) => {
  remove('filter_leads', id);
  return { success: true };
});

ipcMain.handle('get-afcs', async (e, filters) => {
  let afcs = readCollection('afcs');
  const customers = readCollection('customers');
  const properties = readCollection('properties');
  if (filters?.status) afcs = afcs.filter(a => a.status === filters.status);
  if (filters?.customerId) afcs = afcs.filter(a => a.customer_id === filters.customerId);
  afcs = afcs.map(a => {
    const customer = customers.find(c => c.id === a.customer_id) || {};
    const property = properties.find(p => p.id === a.property_id) || {};
    return { ...a, customer, property };
  });
  afcs.sort((a, b) => (a.next_service_date || '').localeCompare(b.next_service_date || ''));
  return { data: afcs };
});

ipcMain.handle('save-afc', async (e, data) => {
  const saved = upsert('afcs', data);
  return { success: true, data: saved };
});

ipcMain.handle('delete-afc', async (e, id) => {
  remove('afcs', id);
  return { success: true };
});

// ===== REMINDERS =====
ipcMain.handle('get-reminders', async (e, filters) => {
  let reminders = await readCollectionAsync('reminders');
  const users = await readCollectionAsync('users');

  if (filters?.status) reminders = reminders.filter(r => r.status === filters.status);
  if (filters?.userId) reminders = reminders.filter(r => (r.assigned_users || []).includes(filters.userId));

  reminders = reminders.map(r => ({
    ...r,
    assigned_user_names: (r.assigned_users || []).map(uid => {
      const u = users.find(x => x.id === uid);
      return u ? { id: u.id, name: u.name, color: u.color || '#1565c0' } : null;
    }).filter(Boolean),
  }));

  reminders.sort((a, b) => {
    // Done at bottom, then by due_date ascending
    if (a.status === 'done' && b.status !== 'done') return 1;
    if (a.status !== 'done' && b.status === 'done') return -1;
    return (a.due_date || '').localeCompare(b.due_date || '') || (a.due_time || '').localeCompare(b.due_time || '');
  });
  return { data: reminders };
});

ipcMain.handle('save-reminder', async (e, data) => {
  const saved = await upsertAsync('reminders', data);
  return { success: true, data: saved };
});

ipcMain.handle('delete-reminder', async (e, id) => {
  await removeAsync('reminders', id);
  return { success: true };
});

ipcMain.handle('update-reminder-status', async (e, id, status) => {
  const r = await findByIdAsync('reminders', id);
  if (!r) return { success: false, error: 'Reminder not found' };
  const updated = { ...r, status };
  if (status === 'done') updated.completed_at = new Date().toISOString();
  await upsertAsync('reminders', updated);
  return { success: true };
});

// ===== SERVICE CONTRACTS =====
ipcMain.handle('get-service-contracts', async (e, filters) => {
  let contracts = readCollection('service_contracts');
  const customers = readCollection('customers');
  const properties = readCollection('properties');
  if (filters?.customerId) contracts = contracts.filter(c => c.customer_id === filters.customerId);
  if (filters?.propertyId) contracts = contracts.filter(c => c.property_id === filters.propertyId);
  if (filters?.status) contracts = contracts.filter(c => c.status === filters.status);
  contracts = contracts.map(c => ({
    ...c,
    customer: customers.find(cu => cu.id === c.customer_id) || null,
    property: properties.find(p => p.id === c.property_id) || null,
  }));
  contracts.sort((a, b) => (b.start_date || '').localeCompare(a.start_date || ''));
  return { data: contracts };
});

ipcMain.handle('save-service-contract', async (e, data) => {
  const saved = upsert('service_contracts', data);
  return { success: true, data: saved };
});

ipcMain.handle('delete-service-contract', async (e, id) => {
  remove('service_contracts', id);
  return { success: true };
});

// ===== SERVICE DUE NOTICES =====
ipcMain.handle('get-service-due-notices', async (e, filters) => {
  let notices = (await readCollectionAsync('service_due_notices')).filter(n => !n.deleted_at);
  const customers = await readCollectionAsync('customers');
  const properties = await readCollectionAsync('properties');
  const jobs = (await readCollectionAsync('jobs')).filter(j => !j.deleted_at);
  const today = new Date().toISOString().split('T')[0];

  if (filters?.id) notices = notices.filter(n => n.id === filters.id);
  if (filters?.customerId) notices = notices.filter(n => n.customer_id === filters.customerId);
  if (filters?.propertyId) notices = notices.filter(n => n.property_id === filters.propertyId);
  if (filters?.status) {
    if (filters.status === 'overdue') {
      notices = notices.filter(n => n.status === 'pending' && n.due_date && n.due_date <= today);
    } else {
      notices = notices.filter(n => n.status === filters.status);
    }
  }
  if (filters?.serviceType) notices = notices.filter(n => n.service_type === filters.serviceType);
  if (filters?.dueDateFrom) notices = notices.filter(n => n.due_date >= filters.dueDateFrom);
  if (filters?.dueDateTo) notices = notices.filter(n => n.due_date <= filters.dueDateTo);
  if (filters?.search) {
    const q = filters.search.toLowerCase();
    notices = notices.filter(n => {
      const cust = customers.find(c => c.id === n.customer_id);
      const prop = properties.find(p => p.id === n.property_id);
      return (cust?.name || '').toLowerCase().includes(q) ||
             (prop?.address || '').toLowerCase().includes(q) ||
             (n.service_type || '').toLowerCase().includes(q);
    });
  }

  notices = notices.map(n => {
    const cust = customers.find(c => c.id === n.customer_id) || null;
    const prop = properties.find(p => p.id === n.property_id) || null;
    const job = n.job_id ? jobs.find(j => j.id === n.job_id) || null : null;
    const is_overdue = n.status === 'pending' && n.due_date && n.due_date <= today;
    const daysUntilDue = n.due_date ? Math.ceil((new Date(n.due_date) - new Date(today)) / 86400000) : null;
    return { ...n, customer: cust, property: prop, job, is_overdue, days_until_due: daysUntilDue };
  });

  // Sort: overdue first, then by due date ascending
  notices.sort((a, b) => {
    if (a.is_overdue && !b.is_overdue) return -1;
    if (!a.is_overdue && b.is_overdue) return 1;
    return (a.due_date || '').localeCompare(b.due_date || '');
  });

  return { data: notices };
});

ipcMain.handle('save-service-due-notice', async (e, data) => {
  const saved = await upsertAsync('service_due_notices', data);
  return { success: true, data: saved };
});

ipcMain.handle('delete-service-due-notice', async (e, id) => {
  const notice = await findByIdAsync('service_due_notices', id);
  if (!notice) return { success: true };
  // Soft-delete so it lands in the recycling bin
  await upsertAsync('service_due_notices', { ...notice, deleted_at: new Date().toISOString() });
  return { success: true };
});

ipcMain.handle('send-service-due-notification', async (e, id, daysBeforeDue) => {
  const settingsPath = path.join(userDataPath, 'settings.json');
  if (!fs.existsSync(settingsPath)) return { success: false, error: 'SMTP not configured' };
  
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  if (!settings.smtp_host) return { success: false, error: 'SMTP not configured' };

  const notices = readCollection('service_due_notices');
  const notice = notices.find(n => n.id === id);
  if (!notice) return { success: false, error: 'Notice not found' };

  const customers = readCollection('customers');
  const properties = readCollection('properties');
  const cust = customers.find(c => c.id === notice.customer_id);
  const prop = properties.find(p => p.id === notice.property_id);

  if (!cust?.email) return { success: false, error: 'Customer has no email' };

  try {
    const transporter = nodemailer.createTransport({
      host: settings.smtp_host,
      port: parseInt(settings.smtp_port) || 587,
      secure: parseInt(settings.smtp_port) === 465,
      auth: { user: settings.smtp_user, pass: settings.smtp_pass },
    });

    const companyName = settings.company_name || 'Interstate Septic';
    const companyPhone = settings.company_phone || '';
    const serviceType = notice.service_type || 'Septic Service';
    const propAddr = prop ? `${prop.address || ''}, ${prop.city || ''} ${prop.state || ''} ${prop.zip || ''}`.trim() : 'your property';

    const daysText = daysBeforeDue === 0 ? 'today' : `in ${daysBeforeDue} day${daysBeforeDue > 1 ? 's' : ''}`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <h2 style="color:#1b5e20;">${companyName}</h2>
        <p>Dear ${cust.name || 'Valued Customer'},</p>
        <p>This is a reminder that your <strong>${serviceType}</strong> service at <strong>${propAddr}</strong> is due <strong>${daysText}</strong>.</p>
        <p>Please contact us to schedule your appointment at your earliest convenience.</p>
        ${companyPhone ? `<p>Phone: <strong>${companyPhone}</strong></p>` : ''}
        <p>Thank you for your business!</p>
        <hr style="border:none;border-top:1px solid #ddd;margin:20px 0;">
        <p style="font-size:12px;color:#999;">This is a reminder from ${companyName}.</p>
      </div>`;

    await transporter.sendMail({
      from: settings.smtp_user,
      to: cust.email,
      subject: `${serviceType} Reminder (${daysText}) - ${companyName}`,
      html,
    });

    return { success: true, message: `Notification sent to ${cust.email}` };
  } catch (err) {
    console.error('[MAIL ERROR]', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('schedule-service-due-notifications', async (e, id, schedule) => {
  const notices = readCollection('service_due_notices');
  const notice = notices.find(n => n.id === id);
  if (!notice) return { success: false, error: 'Notice not found' };

  notice.notification_schedule = schedule || [];
  writeCollection('service_due_notices', notices);
  return { success: true, data: notice };
});

// ===== DISPOSAL LOADS =====
ipcMain.handle('get-disposal-loads', async (e, filters) => {
  let loads = (await readCollectionAsync('disposal_loads')).filter(l => !l.deleted_at);
  const customers = await readCollectionAsync('customers');
  const users = await readCollectionAsync('users');

  if (filters?.dateFrom && filters?.dateTo) {
    loads = loads.filter(l => l.disposal_date >= filters.dateFrom && l.disposal_date <= filters.dateTo);
  }

  loads = loads.map(l => ({
    ...l,
    customers: customers.find(c => c.id === l.customer_id) || null,
    users: users.find(u => u.id === l.driver) || null,
  }));

  loads.sort((a, b) => (b.disposal_date || '').localeCompare(a.disposal_date || ''));
  return { data: loads };
});

ipcMain.handle('get-next-disposal-number', async () => {
  const loads = await readCollectionAsync('disposal_loads');
  const nums = loads
    .map(l => parseInt((l.disposal_number || '').toString().replace(/\D/g, '')) || 0)
    .filter(n => n > 0);
  const highest = nums.length > 0 ? Math.max(...nums) : 999;
  return { data: Math.max(highest + 1, 1000) };
});

ipcMain.handle('save-disposal-load', async (e, data) => {
  if (!data.id && !data.disposal_number) {
    const loads = await readCollectionAsync('disposal_loads');
    const nums = loads
      .map(l => parseInt((l.disposal_number || '').toString().replace(/\D/g, '')) || 0)
      .filter(n => n > 0);
    const highest = nums.length > 0 ? Math.max(...nums) : 999;
    data.disposal_number = String(Math.max(highest + 1, 1000));
  }
  const saved = await upsertAsync('disposal_loads', data);
  return { success: true, data: saved };
});

ipcMain.handle('delete-disposal-load', async (e, id) => {
  const load = await findByIdAsync('disposal_loads', id);
  if (load) await upsertAsync('disposal_loads', { ...load, deleted_at: new Date().toISOString() });
  return { success: true };
});

ipcMain.handle('get-disposal-summary', async (e, period) => {
  let loads = (await readCollectionAsync('disposal_loads')).filter(l => !l.deleted_at);
  const customers = await readCollectionAsync('customers');

  loads = loads.filter(l => l.disposal_date >= period.from && l.disposal_date <= period.to);
  loads = loads.map(l => ({
    ...l,
    customers: customers.find(c => c.id === l.customer_id) || null,
  }));
  loads.sort((a, b) => (a.disposal_date || '').localeCompare(b.disposal_date || ''));

  const totalGallons = loads.reduce((sum, l) => sum + (l.volume_gallons || 0), 0);
  return { data: { loads, totalGallons, totalLoads: loads.length } };
});

// ===== SCHEDULE ITEMS (manifests & driver changes on schedule) =====
ipcMain.handle('get-schedule-items', async (e, vehicleId, date) => {
  let items = (await readCollectionAsync('schedule_items')).filter(i => !i.deleted_at);
  if (vehicleId) items = items.filter(i => i.vehicle_id === vehicleId);
  if (date) items = items.filter(i => i.scheduled_date === date);
  items.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  return { data: items };
});

ipcMain.handle('save-schedule-item', async (e, data) => {
  const saved = await upsertAsync('schedule_items', data);
  return { success: true, data: saved };
});

ipcMain.handle('delete-schedule-item', async (e, id) => {
  const items = await readCollectionAsync('schedule_items');
  const item = items.find(i => i.id === id);
  if (item && item.item_type === 'manifest') {
    const customers = await readCollectionAsync('customers');
    const properties = await readCollectionAsync('properties');
    const jobs = await readCollectionAsync('jobs');
    const stampedJobs = jobs.filter(j => j.manifest_number && String(j.manifest_number) === String(item.manifest_number));
    const custNames = [...new Set(stampedJobs.map(j => customers.find(c => c.id === j.customer_id)?.name || '').filter(Boolean))];
    const addrs = [...new Set(stampedJobs.map(j => {
      const p = properties.find(p => p.id === j.property_id) || {};
      return [p.address, p.city, p.state].filter(Boolean).join(', ');
    }).filter(Boolean))];
    await upsertAsync('schedule_items', {
      ...item,
      deleted_at: new Date().toISOString(),
      snapshot_customer_names: custNames.join(', '),
      snapshot_addresses: addrs.join(' | '),
    });
  } else if (item) {
    await removeAsync('schedule_items', id);
  }
  return { success: true };
});

// ===== DAY NOTES =====
ipcMain.handle('get-day-note', async (e, date) => {
  const notes = await readCollectionAsync('day_notes');
  const note = notes.find(n => n.date === date) || null;
  return { data: note };
});

ipcMain.handle('save-day-note', async (e, data) => {
  // Upsert by date — one note per day
  const notes = await readCollectionAsync('day_notes');
  const existing = notes.find(n => n.date === data.date);
  if (existing) {
    await upsertAsync('day_notes', { ...existing, ...data });
  } else {
    await upsertAsync('day_notes', data);
  }
  return { success: true };
});

ipcMain.handle('delete-day-note', async (e, date) => {
  const notes = await readCollectionAsync('day_notes');
  const existing = notes.find(n => n.date === date);
  if (existing) await removeAsync('day_notes', existing.id);
  return { success: true };
});

ipcMain.handle('get-next-manifest-number', async () => {
  const items = await readCollectionAsync('schedule_items');
  const manifests = items.filter(i => i.item_type === 'manifest' && i.manifest_number);
  const nums = manifests.map(m => parseInt(m.manifest_number) || 0);
  const highest = nums.length > 0 ? Math.max(...nums) : 999;
  return { data: Math.max(highest + 1, 1000) };
});

// ===== WASTE SITES =====
ipcMain.handle('get-waste-sites', async () => {
  const sites = readCollection('waste_sites');
  sites.sort((a, b) => {
    if (a.is_default && !b.is_default) return -1;
    if (!a.is_default && b.is_default) return 1;
    return (a.name || '').localeCompare(b.name || '');
  });
  return { data: sites };
});

ipcMain.handle('save-waste-site', async (e, data) => {
  // If setting as default, clear default on all others first
  if (data.is_default) {
    const sites = readCollection('waste_sites');
    sites.forEach(s => { s.is_default = false; });
    writeCollection('waste_sites', sites);
  }
  const saved = upsert('waste_sites', data);
  return { success: true, data: saved };
});

ipcMain.handle('delete-waste-site', async (e, id) => {
  remove('waste_sites', id);
  return { success: true };
});

ipcMain.handle('get-default-waste-site', async () => {
  const sites = readCollection('waste_sites');
  const defaultSite = sites.find(s => s.is_default);
  return { data: defaultSite || null };
});

// ===== OUTSIDE PUMPERS =====
ipcMain.handle('get-outside-pumpers', async () => {
  const pumpers = readCollection('outside_pumpers');
  pumpers.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return { data: pumpers };
});

ipcMain.handle('save-outside-pumper', async (e, data) => {
  const saved = upsert('outside_pumpers', data);
  return { success: true, data: saved };
});

ipcMain.handle('delete-outside-pumper', async (e, id) => {
  remove('outside_pumpers', id);
  return { success: true };
});

// ===== SEED TEST DATA =====
// ===== DEP REPORTS =====
// ===== P&L SNAPSHOTS =====
ipcMain.handle('get-pl-snapshots', async () => {
  const snaps = readCollection('pl_snapshots');
  snaps.sort((a, b) => (b.month || '').localeCompare(a.month || ''));
  return { data: snaps };
});

ipcMain.handle('delete-pl-snapshot', async (e, id) => {
  remove('pl_snapshots', id);
  return { success: true };
});

ipcMain.handle('save-pl-snapshot', async (e, data) => {
  // Upsert by month — one snapshot per month
  const snaps = readCollection('pl_snapshots');
  const idx = snaps.findIndex(s => s.month === data.month);
  if (idx >= 0) snaps[idx] = { ...snaps[idx], ...data, id: snaps[idx].id };
  else snaps.push({ ...data, id: uuidv4() });
  writeCollection('pl_snapshots', snaps);
  return { success: true };
});

ipcMain.handle('import-pl-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Import QuickBooks P&L Export',
    filters: [{ name: 'QuickBooks Export', extensions: ['csv', 'xlsx', 'xls'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths[0]) return { canceled: true };

  const filePath = filePaths[0];
  const ext = path.extname(filePath).toLowerCase();
  let rows = [];

  try {
    if (ext === '.csv') {
      const text = fs.readFileSync(filePath, 'utf8');
      rows = text.split(/\r?\n/).map(line => line.split(',').map(c => c.replace(/^"|"$/g, '').trim()));
    } else {
      const wb = XLSX.readFile(filePath);
      const ws = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    }
  } catch (e) {
    return { error: 'Could not read file: ' + e.message };
  }

  // Parse QuickBooks P&L export format
  // Detect month columns from header row (e.g. "Jan 26", "Feb 26", "Mar 26")
  const MONTH_RE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s*['']?(\d{2,4})$/i;
  const MONTH_NAMES = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };

  let headerRowIdx = -1;
  let monthCols = []; // [{colIdx, month:'2026-01', label:'Jan 26'}]

  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const row = rows[i];
    const found = [];
    for (let j = 0; j < row.length; j++) {
      const m = String(row[j]).trim().match(MONTH_RE);
      if (m) {
        const mn = MONTH_NAMES[m[1].toLowerCase()];
        const yr = parseInt(m[2]) + (m[2].length === 2 ? 2000 : 0);
        found.push({ colIdx: j, month: `${yr}-${String(mn).padStart(2,'0')}`, label: row[j] });
      }
    }
    if (found.length > 0) { headerRowIdx = i; monthCols = found; break; }
  }

  // If no month columns found, treat as single-period: find amount column
  const singlePeriod = monthCols.length === 0;
  if (singlePeriod) {
    // Try to detect a "Total" or single amount column
    // Look for a header row with a date range or "Total"
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const row = rows[i];
      for (let j = 0; j < row.length; j++) {
        if (/total|amount|\d{4}/i.test(String(row[j]))) {
          monthCols = [{ colIdx: j, month: null, label: String(row[j]) }];
          headerRowIdx = i;
          break;
        }
      }
      if (monthCols.length) break;
    }
  }

  // Walk rows below header and collect expense/income categories
  const parseAmt = v => {
    if (v === null || v === undefined || v === '') return null;
    const s = String(v).replace(/[$,\s]/g, '').replace(/\((.+)\)/, '-$1');
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  };

  // Build per-month expense buckets
  const byMonth = {}; // month -> { categories: [{name, amount}], totalExpenses, totalIncome }
  const initMonth = m => { if (!byMonth[m]) byMonth[m] = { categories: [], totalExpenses: 0, totalIncome: 0 }; };

  let inExpenseSection = false;
  let inIncomeSection = false;

  for (let i = (headerRowIdx + 1); i < rows.length; i++) {
    const row = rows[i];
    const label = String(row[0] || '').trim();
    if (!label) continue;

    const labelLower = label.toLowerCase().replace(/\s+/g,' ');

    // Section detection
    if (/^\s*expense/i.test(label)) { inExpenseSection = true; inIncomeSection = false; continue; }
    if (/^\s*income|^\s*revenue/i.test(label)) { inIncomeSection = true; inExpenseSection = false; continue; }
    if (/^net (ordinary|income|profit|loss)/i.test(label)) { inExpenseSection = false; inIncomeSection = false; }

    // Total rows
    const isTotalExpense = /^total\s+expense/i.test(label.replace(/\s+/g,' '));
    const isTotalIncome = /^total\s+(income|revenue)/i.test(label.replace(/\s+/g,' '));

    for (const col of monthCols) {
      const amt = parseAmt(row[col.colIdx]);
      if (amt === null) continue;
      const m = col.month || 'unknown';
      initMonth(m);

      if (isTotalExpense) { byMonth[m].totalExpenses = Math.abs(amt); }
      else if (isTotalIncome) { byMonth[m].totalIncome = amt; }
      else if (inExpenseSection && !labelLower.startsWith('total')) {
        // Individual expense line
        const clean = label.replace(/^\s+/, '');
        byMonth[m].categories.push({ name: clean, amount: Math.abs(amt) });
      }
    }
  }

  // Build snapshots
  const snapshots = Object.entries(byMonth).map(([month, data]) => ({
    month,
    label: monthCols.find(c => c.month === month)?.label || month,
    categories: data.categories,
    total_expenses: data.totalExpenses || data.categories.reduce((s,c) => s + c.amount, 0),
    qb_income: data.totalIncome,
    imported_at: new Date().toISOString(),
    source_file: path.basename(filePath),
  }));

  if (snapshots.length === 0) return { error: 'Could not parse any monthly data from this file. Make sure you export a P&L by Month from QuickBooks (Reports → Company & Financial → Profit & Loss Standard → set dates → Columns: Month → Export to Excel/CSV).' };

  // Save each month
  const existing = readCollection('pl_snapshots');
  for (const snap of snapshots) {
    const idx = existing.findIndex(s => s.month === snap.month);
    if (idx >= 0) existing[idx] = { ...existing[idx], ...snap };
    else existing.push({ ...snap, id: uuidv4() });
  }
  writeCollection('pl_snapshots', existing);

  return { success: true, count: snapshots.length, months: snapshots.map(s => s.label || s.month) };
});

// ===== EXPENSE SNAPSHOTS (AI-extracted from PDFs) =====
ipcMain.handle('get-expense-snapshots', async () => {
  const snaps = readCollection('expense_snapshots');
  snaps.sort((a, b) => (b.period_start || '').localeCompare(a.period_start || ''));
  return { data: snaps };
});

ipcMain.handle('delete-expense-snapshot', async (_e, id) => {
  remove('expense_snapshots', id);
  return { success: true };
});

ipcMain.handle('save-expense-snapshot', async (_e, data) => {
  const snaps = readCollection('expense_snapshots');
  if (data.id) {
    const idx = snaps.findIndex(s => s.id === data.id);
    if (idx >= 0) snaps[idx] = { ...snaps[idx], ...data };
    else snaps.push(data);
  } else {
    snaps.push({ ...data, id: uuidv4(), imported_at: new Date().toISOString() });
  }
  writeCollection('expense_snapshots', snaps);
  return { success: true };
});

ipcMain.handle('import-expense-pdf-ai', async (evt) => {
  const send = (step, message, extra = {}) => {
    try { evt.sender.send('expense-import-progress', { step, message, ...extra }); } catch {}
  };
  const settingsPath = path.join(userDataPath, 'settings.json');
  const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) : {};
  const apiKey = settings.anthropic_api_key;
  if (!apiKey) {
    return { error: 'No Anthropic API key set. Go to Settings and paste your key (starts with sk-ant-).' };
  }

  send('picking', 'Choose a PDF…');
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Import Expense PDF',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths[0]) { send('cancelled', ''); return { canceled: true }; }
  const filePath = filePaths[0];

  send('reading', 'Reading PDF from disk…', { file: path.basename(filePath) });
  let pdfBase64, pdfSizeKb;
  try {
    const buf = fs.readFileSync(filePath);
    pdfSizeKb = Math.round(buf.length / 1024);
    pdfBase64 = buf.toString('base64');
  } catch (e) {
    send('error', 'Could not read PDF: ' + e.message);
    return { error: 'Could not read PDF: ' + e.message };
  }
  send('read_done', `Read ${pdfSizeKb} KB — preparing upload to Claude…`);

  let Anthropic;
  try {
    Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');
  } catch (e) {
    send('error', 'Anthropic SDK not installed: ' + e.message);
    return { error: 'Anthropic SDK not installed: ' + e.message };
  }

  const client = new Anthropic({ apiKey });
  send('calling', `Uploading PDF and asking Claude to extract line items — this may take 30–90 seconds for a full year…`);

  const systemPrompt = `You are an expert bookkeeper extracting P&L data from a QuickBooks Profit & Loss PDF for a septic-pumping company.

Your job: extract EXPENSE line items (primary goal), AND also capture income totals per period (secondary goal — used for historical revenue when invoice data is unavailable).

The PDF may contain MULTIPLE period columns (e.g. "Jan-Dec 25" AND "Jan-Dec 24" for prior-year comparison). Extract every period column as a separate entry in \`periods\`, and give each line item an \`amounts\` array aligned to that periods array.

Return ONLY valid JSON matching this schema (no prose, no markdown fences):
{
  "periods": [
    { "label": "2025", "period_type": "year|quarter|month|custom", "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" }
  ],
  "line_items": [
    {
      "code": "<account code from PDF, e.g. '824', may be empty>",
      "name": "<line item name exactly as shown in PDF>",
      "parent_category": "<parent header the line appears under, e.g. 'AUTOMOBILE EXPENSE', 'PAYROLL EXPENSE', 'INSURANCE', 'COST OF OPERATIONS', 'OFFICE EXPENSE', 'UTILITIES', 'TAXES', 'PROFESSIONAL FEES', etc. — use the exact header as printed>",
      "amounts": [<number aligned to periods[0]>, <number aligned to periods[1]>]
    }
  ],
  "income_by_period": [<total income for periods[0]>, <total income for periods[1]>],
  "totals_by_period": [<grand TOTAL EXPENSE for periods[0]>, <grand TOTAL EXPENSE for periods[1]>],
  "net_by_period": [<net income for periods[0]>, <net income for periods[1]>]
}

Rules:
- \`line_items\` contains ONLY EXPENSE rows. Do NOT include income accounts in line_items.
- \`income_by_period\` captures the "Total Income" row grand total per period.
- \`totals_by_period\` captures the "Total Expense" row grand total per period.
- \`net_by_period\` captures Net Income (income minus expense) per period.
- Amounts are positive numbers in USD for income/expense (strip $ and commas). Net income may be negative.
- Exclude subtotal rows (lines starting with "Total ...") from line_items. Only include leaf expense line items.
- \`parent_category\` must be the uppercase header the line item falls under in the PDF (e.g. "AUTOMOBILE EXPENSE"). For ungrouped lines at the bottom of the Expense section (with no header), use "OTHER".
- If only one period column exists, \`periods\` has length 1 and each amounts array has length 1.`;

  const t0 = Date.now();
  let resp;
  try {
    resp = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
          { type: 'text', text: 'Extract ALL expense line items with their parent category headers and every period column. Ignore income. Return JSON per the schema.' },
        ],
      }],
    });
  } catch (e) {
    send('error', 'Claude API error: ' + (e.message || String(e)));
    return { error: 'Claude API error: ' + (e.message || String(e)) };
  }
  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
  send('received', `Claude responded in ${elapsedSec}s — parsing extracted JSON…`);

  const text = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  let parsed;
  try {
    // Strip markdown fences if Claude added any
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    send('error', 'Could not parse AI response as JSON.');
    return { error: 'Could not parse AI response as JSON.', raw: text };
  }

  const nLines = Array.isArray(parsed.line_items) ? parsed.line_items.length : (parsed.categories?.length || 0);
  const nPeriods = Array.isArray(parsed.periods) ? parsed.periods.length : 1;
  send('done', `Found ${nLines} line items across ${nPeriods} period${nPeriods!==1?'s':''}.`);

  return {
    success: true,
    extracted: parsed,
    source_file: path.basename(filePath),
    usage: resp.usage || null,
  };
});

// Batch version: upload multiple PDFs at once. Processes them sequentially and
// reports per-file progress via `expense-import-progress` with an `index`/`total`.
ipcMain.handle('import-expense-pdf-ai-batch', async (evt) => {
  const send = (step, message, extra = {}) => {
    try { evt.sender.send('expense-import-progress', { step, message, ...extra }); } catch {}
  };
  const settingsPath = path.join(userDataPath, 'settings.json');
  const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) : {};
  const apiKey = settings.anthropic_api_key;
  if (!apiKey) {
    return { error: 'No Anthropic API key set. Go to Settings and paste your key (starts with sk-ant-).' };
  }

  send('picking', 'Choose one or more PDFs…');
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Batch Import Expense PDFs',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (canceled || !filePaths || filePaths.length === 0) { send('cancelled', ''); return { canceled: true }; }

  let Anthropic;
  try {
    Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');
  } catch (e) {
    send('error', 'Anthropic SDK not installed: ' + e.message);
    return { error: 'Anthropic SDK not installed: ' + e.message };
  }
  const client = new Anthropic({ apiKey });

  const systemPrompt = `You are an expert bookkeeper extracting P&L data from a QuickBooks Profit & Loss PDF for a septic-pumping company.

Your job: extract EXPENSE line items (primary goal), AND also capture income totals per period (secondary goal — used for historical revenue when invoice data is unavailable).

The PDF may contain MULTIPLE period columns (e.g. "Jan-Dec 25" AND "Jan-Dec 24" for prior-year comparison). Extract every period column as a separate entry in \`periods\`, and give each line item an \`amounts\` array aligned to that periods array.

Return ONLY valid JSON matching this schema (no prose, no markdown fences):
{
  "periods": [
    { "label": "2025", "period_type": "year|quarter|month|custom", "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" }
  ],
  "line_items": [
    {
      "code": "<account code from PDF, e.g. '824', may be empty>",
      "name": "<line item name exactly as shown in PDF>",
      "parent_category": "<parent header the line appears under, e.g. 'AUTOMOBILE EXPENSE', 'PAYROLL EXPENSE', 'INSURANCE', 'COST OF OPERATIONS', 'OFFICE EXPENSE', 'UTILITIES', 'TAXES', 'PROFESSIONAL FEES', etc. — use the exact header as printed>",
      "amounts": [<number aligned to periods[0]>, <number aligned to periods[1]>]
    }
  ],
  "income_by_period": [<total income for periods[0]>, <total income for periods[1]>],
  "totals_by_period": [<grand TOTAL EXPENSE for periods[0]>, <grand TOTAL EXPENSE for periods[1]>],
  "net_by_period": [<net income for periods[0]>, <net income for periods[1]>]
}

Rules:
- \`line_items\` contains ONLY EXPENSE rows. Do NOT include income accounts in line_items.
- \`income_by_period\` captures the "Total Income" row grand total per period.
- \`totals_by_period\` captures the "Total Expense" row grand total per period.
- \`net_by_period\` captures Net Income (income minus expense) per period.
- Amounts are positive numbers in USD for income/expense (strip $ and commas). Net income may be negative.
- Exclude subtotal rows (lines starting with "Total ...") from line_items. Only include leaf expense line items.
- \`parent_category\` must be the uppercase header the line item falls under in the PDF. For ungrouped lines at the bottom of the Expense section (with no header), use "OTHER".
- If only one period column exists, \`periods\` has length 1 and each amounts array has length 1.`;

  const total = filePaths.length;

  // Read every PDF from disk up front so the API calls all kick off together.
  const jobs = [];
  for (const fp of filePaths) {
    const base = path.basename(fp);
    try {
      const buf = fs.readFileSync(fp);
      jobs.push({ base, pdfBase64: buf.toString('base64'), sizeKB: Math.round(buf.length / 1024) });
    } catch (e) {
      jobs.push({ base, error: 'Could not read PDF: ' + e.message });
    }
  }

  send('batch_start', `Uploading ${total} PDF${total !== 1 ? 's' : ''} to Claude in parallel…`, {
    total,
    files: jobs.map(j => j.base),
  });

  // Cap concurrency conservatively — Anthropic low-tier limits are 30k input + 8k
  // output tokens/min. Each QB P&L extraction uses ~4-6k input and ~2-3k output,
  // so 3 in flight keeps us under the output-token ceiling. Files that still hit
  // a 429 are retried with exponential backoff rather than being dropped.
  const CONCURRENCY = 3;
  const MAX_RETRIES = 5;
  let completed = 0;
  let cursor = 0;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function callClaude(job) {
    return client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: job.pdfBase64 } },
          { type: 'text', text: 'Extract ALL expense line items with their parent category headers and every period column. Ignore income. Return JSON per the schema.' },
        ],
      }],
    });
  }

  async function processOne(job) {
    const { base } = job;
    if (job.error) return { file: base, error: job.error };

    const t0 = Date.now();
    let resp;
    let lastErr;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        resp = await callClaude(job);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        const msg = (e && e.message) ? e.message : String(e);
        const status = e && (e.status || e.statusCode);
        const isRateLimit = status === 429 || /rate[_\s-]?limit|429/i.test(msg);
        const isOverloaded = status === 529 || /overloaded/i.test(msg);
        if (!isRateLimit && !isOverloaded) {
          break; // non-retryable error — bail immediately
        }
        // Honor `retry-after` header when the SDK surfaces it, otherwise back off
        // exponentially with jitter: 8s, 16s, 32s, 64s, 128s.
        const retryAfterSec = parseFloat(e && e.headers && (e.headers['retry-after'] || e.headers['x-ratelimit-reset'])) || 0;
        const backoffSec = retryAfterSec > 0
          ? Math.min(retryAfterSec, 120)
          : Math.min(8 * Math.pow(2, attempt) + Math.random() * 2, 128);
        send('batch_progress', `Waiting ${backoffSec.toFixed(0)}s (rate-limited) — ${base}`, { file: base, retry: attempt + 1 });
        await sleep(backoffSec * 1000);
      }
    }
    if (lastErr) {
      return { file: base, error: 'Claude API error: ' + (lastErr.message || String(lastErr)) };
    }

    const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
    const text = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    let parsed;
    try {
      const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return { file: base, error: 'Could not parse AI response as JSON.', raw: text, elapsedSec };
    }
    return { file: base, extracted: parsed, usage: resp.usage || null, elapsedSec };
  }

  async function worker() {
    while (true) {
      const myIdx = cursor++;
      if (myIdx >= jobs.length) return;
      const job = jobs[myIdx];
      const result = await processOne(job);
      completed++;
      const tag = result.error ? '(error)' : `(${result.elapsedSec}s)`;
      send('batch_progress', `${completed}/${total} ${tag} — ${job.base}`, {
        index: completed,
        total,
        file: job.base,
        error: result.error || null,
      });
      results[myIdx] = result;
    }
  }

  const results = new Array(jobs.length);
  const workers = Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, () => worker());
  await Promise.all(workers);

  const okCount = results.filter(r => !r.error).length;
  const errCount = total - okCount;
  send('done', `Processed ${total} file${total !== 1 ? 's' : ''} — ${okCount} ok${errCount ? `, ${errCount} failed` : ''}.`, { total, okCount, errCount });
  return { success: true, results };
});

// ===== SQUARE =====
function squareRequest(method, path, body, accessToken) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'connect.squareup.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Square-Version': '2024-01-17',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function getSquareCreds() {
  const settingsPath = path.join(userDataPath, 'settings.json');
  const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) : {};
  return { accessToken: settings.square_access_token || '', locationId: settings.square_location_id || '' };
}

// Search Square customers by email or name
ipcMain.handle('square-search-customers', async (e, query) => {
  const { accessToken } = getSquareCreds();
  if (!accessToken) return { error: 'Square access token not configured in Settings.' };
  const body = { query: { filter: { email_address: { fuzzy: query } } } };
  const res = await squareRequest('POST', '/v2/customers/search', body, accessToken);
  if (res.status !== 200) {
    // Try name search fallback
    const res2 = await squareRequest('POST', '/v2/customers/search', { query: { filter: { reference_id: { exact: query } } } }, accessToken);
    return res2.body;
  }
  return res.body;
});

// List stored cards for a Square customer
ipcMain.handle('square-list-cards', async (e, squareCustomerId) => {
  const { accessToken } = getSquareCreds();
  if (!accessToken) return { error: 'Square access token not configured in Settings.' };
  const res = await squareRequest('GET', `/v2/cards?customer_id=${encodeURIComponent(squareCustomerId)}&include_disabled=false`, null, accessToken);
  if (res.status !== 200) return { error: res.body?.errors?.[0]?.detail || 'Square API error', body: res.body };
  return res.body; // { cards: [...] }
});

// Charge a stored card
ipcMain.handle('square-charge', async (e, { squareCustomerId, cardId, amountCents, note }) => {
  const { accessToken, locationId } = getSquareCreds();
  if (!accessToken) return { error: 'Square access token not configured in Settings.' };
  if (!locationId) return { error: 'Square location ID not configured in Settings.' };
  const body = {
    idempotency_key: uuidv4(),
    source_id: cardId,
    customer_id: squareCustomerId,
    amount_money: { amount: amountCents, currency: 'USD' },
    location_id: locationId,
    note: note || 'Septic service payment',
  };
  const res = await squareRequest('POST', '/v2/payments', body, accessToken);
  if (res.status !== 200) return { error: res.body?.errors?.[0]?.detail || 'Square charge failed', body: res.body };
  return res.body; // { payment: { id, status, receipt_url, ... } }
});

// Test Square connection
ipcMain.handle('square-test', async () => {
  const { accessToken, locationId } = getSquareCreds();
  if (!accessToken) return { error: 'No access token configured.' };
  const res = await squareRequest('GET', `/v2/locations/${locationId || 'me'}`, null, accessToken);
  if (res.status === 200) return { success: true, name: res.body?.location?.name || res.body?.locations?.[0]?.name || 'Connected' };
  return { error: res.body?.errors?.[0]?.detail || 'Connection failed' };
});

// ===== AR REPORT =====
ipcMain.handle('get-ar-report', async () => {
  const invoices = readCollection('invoices').filter(i => !i.deleted_at);
  const customers = readCollection('customers');
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  // Build per-customer AR. Group by customer_id when present; otherwise
  // fall back to a normalized customer_name key so orphan invoices still
  // aggregate under a real customer label instead of collapsing into "Unknown".
  const custById = new Map(customers.map(c => [c.id, c]));
  const norm = s => (s || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
  const byCustomer = {};
  invoices.forEach(inv => {
    const balance = (parseFloat(inv.total) || 0) - (parseFloat(inv.amount_paid) || 0);
    if (balance <= 0.005) return; // fully paid
    const cust = inv.customer_id ? custById.get(inv.customer_id) : null;
    const invName = inv.customer_name || inv.billing_company || '';
    const invCity = inv.billing_city || inv.property_city || '';
    const displayName = (cust && cust.name) || invName || 'Unknown';
    const displayCity = (cust && cust.city) || invCity || '';
    const key = inv.customer_id || ('name:' + norm(displayName));
    if (!byCustomer[key]) byCustomer[key] = {
      customerId: inv.customer_id || null,
      name: displayName,
      city: displayCity,
      current: 0, d30: 0, d60: 0, d90: 0, total: 0, oldest: null,
    };
    const row = byCustomer[key];
    row.total += balance;
    if (!row.name || row.name === 'Unknown') row.name = displayName;
    if (!row.city) row.city = displayCity;
    const svcDate = inv.svc_date ? new Date(inv.svc_date) : (inv.created_at ? new Date(inv.created_at) : null);
    const ageMs = svcDate ? now - svcDate.getTime() : 0;
    const ageDays = ageMs / DAY;
    if (ageDays < 30) row.current += balance;
    else if (ageDays < 60) row.d30 += balance;
    else if (ageDays < 90) row.d60 += balance;
    else row.d90 += balance;
    if (!row.oldest || (svcDate && svcDate < row.oldest)) row.oldest = svcDate;
  });

  const rows = Object.values(byCustomer).map(r => ({
    ...r,
    oldest: r.oldest ? r.oldest.toISOString().split('T')[0] : null,
  })).sort((a, b) => b.total - a.total);

  const totals = rows.reduce((acc, r) => {
    acc.current += r.current; acc.d30 += r.d30; acc.d60 += r.d60; acc.d90 += r.d90; acc.total += r.total;
    return acc;
  }, { current: 0, d30: 0, d60: 0, d90: 0, total: 0 });

  // Daily AR snapshot — record once per day so we can show 30-day deltas
  const snapshots = readCollection('ar_snapshots');
  const todayStr = new Date().toISOString().split('T')[0];
  const last = snapshots[snapshots.length - 1];
  if (!last || last.date !== todayStr) {
    snapshots.push({ date: todayStr, ...totals });
    // Keep last ~400 days
    if (snapshots.length > 400) snapshots.splice(0, snapshots.length - 400);
    writeCollection('ar_snapshots', snapshots);
  }

  // Find nearest snapshot to a target offset; window is +/- tolerance days
  const findNearest = (daysAgo, tolDays) => {
    const targetMs = Date.now() - daysAgo * DAY;
    let past = null, bestDiff = Infinity;
    for (const s of snapshots) {
      const diff = Math.abs(new Date(s.date).getTime() - targetMs);
      if (diff < bestDiff && diff <= tolDays * DAY) { bestDiff = diff; past = s; }
    }
    return past;
  };

  const past30 = findNearest(30, 7);
  const deltas = past30 ? {
    current: totals.current - (past30.current || 0),
    d30: totals.d30 - (past30.d30 || 0),
    d60: totals.d60 - (past30.d60 || 0),
    d90: totals.d90 - (past30.d90 || 0),
    total: totals.total - (past30.total || 0),
    since: past30.date,
  } : null;

  const past7 = findNearest(7, 2);
  const delta7 = past7 ? {
    total: totals.total - (past7.total || 0),
    since: past7.date,
  } : null;

  // Collection ratio (last 30d): new billing vs. what was collected
  // Collected = Billed - (AR_now - AR_30d_ago)
  const cutoff30 = Date.now() - 30 * DAY;
  const billed30d = invoices.reduce((sum, i) => {
    const svc = i.svc_date ? new Date(i.svc_date).getTime() : 0;
    return svc >= cutoff30 ? sum + (parseFloat(i.total) || 0) : sum;
  }, 0);
  const collection = past30 ? {
    billed: billed30d,
    collected: billed30d - (totals.total - (past30.total || 0)),
    ratio: billed30d > 0 ? (billed30d - (totals.total - (past30.total || 0))) / billed30d : null,
    since: past30.date,
  } : null;

  // Historical collection ratios — one per pair of snapshots ~30 days apart
  const collectionHistory = [];
  const sortedSnaps = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 1; i < sortedSnaps.length; i++) {
    const s1 = sortedSnaps[i];
    const s1Ms = new Date(s1.date).getTime();
    // Find snapshot ~30d before s1 (within 7d tolerance)
    let s0 = null, best = Infinity;
    for (let j = 0; j < i; j++) {
      const cand = sortedSnaps[j];
      const diff = Math.abs((s1Ms - new Date(cand.date).getTime()) - 30*DAY);
      if (diff < best && diff <= 7*DAY) { best = diff; s0 = cand; }
    }
    if (!s0) continue;
    const fromMs = new Date(s0.date).getTime();
    const billed = invoices.reduce((sum, inv) => {
      const svc = inv.svc_date ? new Date(inv.svc_date).getTime() : 0;
      return (svc > fromMs && svc <= s1Ms) ? sum + (parseFloat(inv.total) || 0) : sum;
    }, 0);
    const collected = billed - (s1.total - s0.total);
    const ratio = billed > 0 ? collected / billed : null;
    collectionHistory.push({ date: s1.date, from: s0.date, billed, collected, ratio });
  }

  return { data: rows, totals, deltas, delta7, collection, collectionHistory };
});

ipcMain.handle('get-dep-reports', async () => {
  const reports = readCollection('dep_reports');
  reports.sort((a, b) => (b.generated_at || '').localeCompare(a.generated_at || ''));
  return { data: reports };
});

ipcMain.handle('generate-dep-report', async (e, period) => {
  let loads = readCollection('disposal_loads').filter(l => !l.deleted_at);
  const customers = readCollection('customers');

  loads = loads.filter(l => l.disposal_date >= period.from && l.disposal_date <= period.to);
  loads = loads.map(l => ({
    ...l,
    customers: customers.find(c => c.id === l.customer_id) || null,
  }));
  loads.sort((a, b) => (a.disposal_date || '').localeCompare(b.disposal_date || ''));

  const totalGallons = loads.reduce((sum, l) => sum + (l.volume_gallons || 0), 0);

  const report = {
    report_period: period.label,
    total_gallons: totalGallons,
    total_loads: loads.length,
    report_data: loads,
    generated_at: new Date().toISOString(),
  };

  const saved = upsert('dep_reports', report);
  return { success: true, data: saved };
});

ipcMain.handle('send-dep-report', async (e, reportId) => {
  const reports = readCollection('dep_reports');
  const idx = reports.findIndex(r => r.id === reportId);
  if (idx >= 0) {
    reports[idx].sent_at = new Date().toISOString();
    writeCollection('dep_reports', reports);
    return { success: true };
  }
  return { success: false, error: 'Report not found' };
});

// ===== SETTINGS =====
ipcMain.handle('get-settings', async () => {
  const settingsPath = path.join(userDataPath, 'settings.json');
  if (fs.existsSync(settingsPath)) {
    return { data: JSON.parse(fs.readFileSync(settingsPath, 'utf8')) };
  }
  return { data: null };
});

ipcMain.handle('save-settings', async (e, data) => {
  const settingsPath = path.join(userDataPath, 'settings.json');
  const existing = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) : {};
  const merged = { ...existing, ...data, updated_at: new Date().toISOString() };
  fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2));
  return { success: true, data: merged };
});

// ===== GEOCODING SERVICE =====
// All geocoding lives in main process so API keys (Mapbox token) never
// reach the renderer. Providers are tried in a priority order based on
// settings. Results always include a `provider` and `accuracy` field so
// callers can see which tier answered.
//
// Supported modes:
//   osm     — Nominatim free-form → Nominatim structured
//   mapbox  — Mapbox address-only → Mapbox place (town) fallback
//   hybrid  — Nominatim free-form → Mapbox free-form (best of both)
//   auto    — (default) hybrid if mapbox_token present, else osm
//
// Nominatim public endpoint requires ~1 req/sec per user. We serialize all
// Nominatim requests through a single promise chain in this module.
let _nominatimChain = Promise.resolve();
async function _rateLimitedNominatim(url) {
  const run = async () => {
    await new Promise(r => setTimeout(r, 1100));
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'InterstateSepticManager/1.0' }
    });
    if (!resp.ok) throw new Error('nominatim HTTP ' + resp.status);
    return await resp.json();
  };
  const next = _nominatimChain.then(run, run); // continue even on prior error
  _nominatimChain = next.catch(() => {});
  return next;
}

async function _geocodeNominatimFreeForm(fullAddr) {
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q='
    + encodeURIComponent(fullAddr);
  const data = await _rateLimitedNominatim(url);
  if (data && data.length > 0) {
    return {
      lat: parseFloat(data[0].lat),
      lng: parseFloat(data[0].lon),
      approximate: false,
      provider: 'nominatim',
      accuracy: data[0].type || 'unknown',
      place_name: data[0].display_name || '',
    };
  }
  return null;
}

async function _geocodeNominatimStructured(parts) {
  if (!parts || !parts.street || !parts.city) return null;
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us'
    + '&street=' + encodeURIComponent(parts.street)
    + '&city=' + encodeURIComponent(parts.city)
    + '&state=' + encodeURIComponent(parts.state || 'Maine');
  const data = await _rateLimitedNominatim(url);
  if (data && data.length > 0) {
    return {
      lat: parseFloat(data[0].lat),
      lng: parseFloat(data[0].lon),
      approximate: false,
      provider: 'nominatim-structured',
      accuracy: data[0].type || 'unknown',
      place_name: data[0].display_name || '',
    };
  }
  return null;
}

async function _geocodeMapbox(fullAddr, token, opts) {
  if (!token) return null;
  // types=address,poi first (houses/businesses); if nothing, caller falls through
  const types = (opts && opts.types) || 'address,poi';
  const url = 'https://api.mapbox.com/geocoding/v5/mapbox.places/'
    + encodeURIComponent(fullAddr)
    + '.json?limit=1&country=us'
    + '&types=' + encodeURIComponent(types)
    + '&access_token=' + encodeURIComponent(token);
  const resp = await fetch(url);
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error('mapbox HTTP ' + resp.status + (body ? ' — ' + body.slice(0, 200) : ''));
  }
  const data = await resp.json();
  if (data && Array.isArray(data.features) && data.features.length > 0) {
    const f = data.features[0];
    // Mapbox returns center as [lng, lat]
    const lng = f.center[0];
    const lat = f.center[1];
    // accuracy: 'rooftop' | 'point' | 'parcel' | 'interpolated' | 'street' | 'intersection' | undefined
    const acc = (f.properties && f.properties.accuracy) || (f.place_type && f.place_type[0]) || 'unknown';
    // Anything looser than a real address-level hit gets flagged approximate
    const loose = ['street', 'intersection', 'place', 'locality', 'region'];
    const approximate = loose.includes(acc) || (f.relevance != null && f.relevance < 0.75);
    return {
      lat,
      lng,
      approximate,
      provider: 'mapbox',
      accuracy: acc,
      place_name: f.place_name || '',
      relevance: f.relevance,
    };
  }
  return null;
}

// Town-center fallback as absolute last resort so the marker shows up
// somewhere instead of vanishing. Uses Mapbox if token is present (more
// reliable for US town names), else Nominatim.
async function _geocodeTownCenter(parts, token) {
  if (!parts || !parts.city) return null;
  const query = parts.city + ', ' + (parts.state || 'Maine');
  if (token) {
    const r = await _geocodeMapbox(query, token, { types: 'place,locality' });
    if (r) return { ...r, approximate: true, accuracy: 'town-center' };
  }
  const data = await _rateLimitedNominatim(
    'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=' + encodeURIComponent(query)
  );
  if (data && data.length > 0) {
    return {
      lat: parseFloat(data[0].lat),
      lng: parseFloat(data[0].lon),
      approximate: true,
      provider: 'nominatim',
      accuracy: 'town-center',
      place_name: data[0].display_name || '',
    };
  }
  return null;
}

ipcMain.handle('geocode-address', async (e, parts) => {
  // parts = { freeForm, street, city, state }
  try {
    if (!parts || !parts.freeForm) return { notFound: true, error: 'no address provided' };

    const settingsPath = path.join(userDataPath, 'settings.json');
    const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) : {};
    const token = (settings.mapbox_token || '').trim();
    let mode = settings.geocoding_provider || 'auto';
    if (mode === 'auto') mode = token ? 'hybrid' : 'osm';

    // Jitter helper for town-center fallback so multiple approximate jobs
    // in the same town don't stack on one pixel (~0.2 mile spread)
    const jitter = (c) => ({
      ...c,
      lat: c.lat + (Math.random() - 0.5) * 0.006,
      lng: c.lng + (Math.random() - 0.5) * 0.006,
    });

    const tiers = [];
    if (mode === 'mapbox') {
      tiers.push(() => _geocodeMapbox(parts.freeForm, token));
    } else if (mode === 'osm') {
      tiers.push(() => _geocodeNominatimFreeForm(parts.freeForm));
      tiers.push(() => _geocodeNominatimStructured(parts));
    } else { // hybrid
      tiers.push(() => _geocodeNominatimFreeForm(parts.freeForm));
      tiers.push(() => _geocodeMapbox(parts.freeForm, token));
      tiers.push(() => _geocodeNominatimStructured(parts));
    }

    for (const tryTier of tiers) {
      try {
        const r = await tryTier();
        if (r) return { ...r, notFound: false };
      } catch (err) {
        console.warn('[GEOCODE] tier error:', err.message);
        // continue to next tier
      }
    }

    // Last resort: town-center
    try {
      const tc = await _geocodeTownCenter(parts, token);
      if (tc) {
        console.log('[GEOCODE] Town-center fallback for:', parts.freeForm);
        return { ...jitter(tc), notFound: false };
      }
    } catch (err) {
      console.warn('[GEOCODE] town-center error:', err.message);
    }

    console.log('[GEOCODE] No match at any tier:', parts.freeForm);
    return { notFound: true };
  } catch (err) {
    return { notFound: true, error: err.message };
  }
});

// Quick provider-health check for the Settings → Test button.
ipcMain.handle('test-mapbox-token', async (e, token) => {
  const t = (token || '').trim();
  if (!t) return { success: false, error: 'No token provided.' };
  try {
    // Probe with a deliberately rural Maine address likely missing from OSM
    const url = 'https://api.mapbox.com/geocoding/v5/mapbox.places/'
      + encodeURIComponent('8 Raccoon Ln, Cushing, ME')
      + '.json?limit=1&country=us&types=address&access_token=' + encodeURIComponent(t);
    const resp = await fetch(url);
    if (resp.status === 401) return { success: false, error: 'Token rejected (401 Unauthorized). Double-check it was copied correctly.' };
    if (resp.status === 403) return { success: false, error: 'Token forbidden (403). Check that the token has the geocoding scope enabled.' };
    if (!resp.ok) return { success: false, error: 'HTTP ' + resp.status + ' from Mapbox.' };
    const data = await resp.json();
    if (data && Array.isArray(data.features) && data.features.length > 0) {
      const f = data.features[0];
      return {
        success: true,
        match: f.place_name,
        lat: f.center[1],
        lng: f.center[0],
        accuracy: (f.properties && f.properties.accuracy) || (f.place_type && f.place_type[0]) || 'unknown',
        relevance: f.relevance,
      };
    }
    return { success: true, match: null, note: 'Token valid but this specific address returned no hit (Mapbox will still handle other addresses fine).' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('clear-geocode-cache', async () => {
  writeCollection('geocode_cache', []);
  return { success: true };
});

// ===== MOTIVE GPS =====
ipcMain.handle('get-motive-locations', async () => {
  const settingsPath = path.join(userDataPath, 'settings.json');
  const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) : {};
  const apiKey = settings.motive_api_key;
  if (!apiKey) return { error: 'No Motive API key configured', vehicles: [] };
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.gomotive.com',
      path: '/v3/vehicle_locations?per_page=100',
      method: 'GET',
      headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' },
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { resolve({ error: 'Parse error', vehicles: [] }); }
      });
    });
    req.on('error', (e) => resolve({ error: e.message, vehicles: [] }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ error: 'Timeout', vehicles: [] }); });
    req.end();
  });
});

// ===== TANK TYPES =====
const DEFAULT_TANK_TYPES = [
  { name: 'Septic Tank',                        waste_code: 'S',  disposal_label: 'Septic Tank Waste Disposal',            pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 1  },
  { name: 'Septic Tank+Filter',                 waste_code: 'S',  disposal_label: 'Septic Tank Waste Disposal',            pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 2  },
  { name: 'Septic Tank w/ Intank Pump',         waste_code: 'S',  disposal_label: 'Septic Tank Waste Disposal',            pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 3  },
  { name: 'Septic Tank w/ Intank Pump+Filter',  waste_code: 'S',  disposal_label: 'Septic Tank Waste Disposal',            pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 4  },
  { name: 'Holding Tank',                       waste_code: 'H',  disposal_label: 'Holding Tank Waste Disposal',           pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 5  },
  { name: 'Cesspool',                           waste_code: 'C',  disposal_label: 'Cesspool Waste Disposal',               pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 6  },
  { name: 'Aerobic System',                     waste_code: 'As', disposal_label: 'Aerobic System Waste Disposal',         pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 7  },
  { name: 'Grease Trap',                        waste_code: 'G',  disposal_label: 'Grease Trap Waste Disposal',            pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 8  },
  { name: 'Interior Grease Trap',               waste_code: 'Ig', disposal_label: 'Grease Trap Waste Disposal',            pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 9  },
  { name: 'Grinder Pump Station',               waste_code: 'Ps', disposal_label: 'Pump Station Waste Disposal',           pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 10 },
  { name: 'Separate Pump Station',              waste_code: 'S',  disposal_label: 'Septic Waste Disposal',                 pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 11 },
  { name: 'Septic/Sewer Pump Station',          waste_code: 'Ps', disposal_label: 'Pump Station Waste Disposal',           pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 12 },
  { name: 'Pump Chamber',                       waste_code: 'P',  disposal_label: 'Septic Waste Disposal',                 pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 13 },
  { name: 'Wet Well',                           waste_code: 'Ls', disposal_label: 'Wet Well Waste Disposal',               pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 14 },
  { name: 'Treatment Plant',                    waste_code: 'Tp', disposal_label: 'Treatment Plant Waste Disposal',        pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 15 },
  { name: 'Vault Toilet',                       waste_code: 'Vt', disposal_label: 'Vault Toilet Waste Disposal',           pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 16 },
  { name: 'Portable Toilets',                   waste_code: 'Pt', disposal_label: 'Portable Toilet Waste Disposal',        pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 17 },
  { name: 'Fuji Tank',                          waste_code: 'Fj', disposal_label: 'Fuji Tank Waste Disposal',              pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 18 },
  { name: 'Leachate',                           waste_code: '',   disposal_label: 'Leachate Disposal',                     pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 19 },
  { name: 'Manhole/Sewage',                     waste_code: 'Mh', disposal_label: 'Sewage Waste Disposal',                 pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 20 },
  { name: 'Lobster / Fish Waste',               waste_code: '',   disposal_label: 'Fish Waste Disposal',                   pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 21 },
  { name: 'Seaweed Waste',                      waste_code: 'Sw', disposal_label: 'Seaweed Waste Disposal',                pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 22 },
  { name: 'Brewery',                            waste_code: 'Br', disposal_label: 'Brewery Waste Disposal',                pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 23 },
  { name: 'Water/Non Hazardous Liquids',        waste_code: '',   disposal_label: 'Non Hazardous Liquid Disposal',         pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 24 },
  { name: 'Boat Bottom Wash',                   waste_code: 'B',  disposal_label: 'Boat Wash Disposal',                    pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 25 },
  { name: 'Water',                              waste_code: '',   disposal_label: '',                                      pumping_price: 250, disposal_price: 0,   generates_disposal: false, sort_order: 26 },
  { name: 'Distribution Box',                   waste_code: 'Db', disposal_label: '',                                      pumping_price: 250, disposal_price: 0,   generates_disposal: false, sort_order: 27 },
  { name: 'Drain Clearing',                     waste_code: 'Dc', disposal_label: '',                                      pumping_price: 250, disposal_price: 0,   generates_disposal: false, sort_order: 28 },
  { name: 'Other',                              waste_code: '',   disposal_label: 'Waste Disposal',                        pumping_price: 250, disposal_price: 140, generates_disposal: false, sort_order: 99 },
];

ipcMain.handle('get-tank-types', async () => {
  let types = readCollection('tank_types');
  if (!types || types.length === 0) {
    types = DEFAULT_TANK_TYPES.map((t, i) => ({ id: uuidv4(), ...t }));
    writeCollection('tank_types', types);
  }
  // Patch: Pump Chamber should generate septic disposal (old data had it disabled)
  let patched = false;
  types = types.map(tt => {
    if (tt.name === 'Pump Chamber' && !tt.generates_disposal) {
      patched = true;
      return { ...tt, generates_disposal: true, disposal_label: 'Septic Waste Disposal', disposal_price: 140 };
    }
    return tt;
  });
  if (patched) writeCollection('tank_types', types);
  // Patch: add any missing default types not yet in the collection (by name)
  const existingNames = new Set(types.map(t => t.name));
  let addedDefaults = false;
  for (const dt of DEFAULT_TANK_TYPES) {
    if (!existingNames.has(dt.name)) {
      types.push({ id: uuidv4(), ...dt });
      addedDefaults = true;
    }
  }
  if (addedDefaults) writeCollection('tank_types', types);
  return { data: types.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)) };
});

ipcMain.handle('save-tank-type', async (e, data) => {
  const saved = await upsertAsync('tank_types', data);
  return { success: true, data: saved };
});

ipcMain.handle('delete-tank-type', async (e, id) => {
  await removeAsync('tank_types', id);
  return { success: true };
});

// ===== SERVICE CATEGORIES & PRODUCTS =====
ipcMain.handle('get-service-categories', async () => {
  const cats = readCollection('service_categories');
  const products = readCollection('service_products');
  // Attach products to each category
  const result = cats.map(c => ({
    ...c,
    products: products.filter(p => p.category_id === c.id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
  }));
  result.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  return { data: result };
});

ipcMain.handle('save-service-category', async (e, data) => {
  const saved = upsert('service_categories', data);
  return { success: true, data: saved };
});

ipcMain.handle('delete-service-category', async (e, id) => {
  // Also delete products in this category
  const remaining = readCollection('service_products').filter(p => p.category_id !== id);
  writeCollection('service_products', remaining);
  remove('service_categories', id);
  return { success: true };
});

ipcMain.handle('get-service-products', async (e, categoryId) => {
  let products = readCollection('service_products');
  if (categoryId) products = products.filter(p => p.category_id === categoryId);
  products.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  return { data: products };
});

ipcMain.handle('save-service-product', async (e, data) => {
  const saved = upsert('service_products', data);
  return { success: true, data: saved };
});

ipcMain.handle('delete-service-product', async (e, id) => {
  remove('service_products', id);
  return { success: true };
});

// ===== USERS (TECHS) =====
ipcMain.handle('get-users', async () => {
  const users = await readCollectionAsync('users');
  users.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return { data: users };
});

ipcMain.handle('delete-user', async (e, id) => {
  await removeAsync('users', id);
  return { success: true };
});

// ===== AUTH =====
ipcMain.handle('auth-needs-setup', async () => {
  const users = readCollection('users');
  // Need setup if no users have a username/password set
  const hasAuth = users.some(u => u.username && u.password_hash);
  return { needsSetup: !hasAuth };
});

ipcMain.handle('auth-setup', async (e, data) => {
  // First time setup - create admin account
  const salt = bcrypt.genSaltSync(10);
  const hash = bcrypt.hashSync(data.password, salt);
  const user = {
    name: data.name,
    phone: data.phone || '',
    username: data.username.toLowerCase(),
    password_hash: hash,
    role: 'admin',
  };
  const saved = upsert('users', user);
  return { success: true, data: { id: saved.id, name: saved.name, role: saved.role, username: saved.username } };
});

ipcMain.handle('auth-login', async (e, username, password) => {
  const users = readCollection('users');
  const user = users.find(u => u.username && u.username.toLowerCase() === username.toLowerCase());
  if (!user) return { success: false, error: 'Invalid username or password.' };
  if (!user.password_hash) return { success: false, error: 'Account not set up. Contact admin.' };

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) return { success: false, error: 'Invalid username or password.' };

  // Save credentials to file so they survive force-quit
  saveCreds(username, password);
  return { success: true, data: { id: user.id, name: user.name, role: user.role, username: user.username } };
});

ipcMain.handle('get-saved-creds', async () => {
  return getSavedCreds();
});

ipcMain.handle('clear-saved-creds', async () => {
  clearCreds();
  return { success: true };
});

ipcMain.handle('save-user', async (e, data) => {
  // If password is provided, hash it
  if (data.password && data.password.trim()) {
    const salt = bcrypt.genSaltSync(10);
    data.password_hash = bcrypt.hashSync(data.password, salt);
  }
  delete data.password; // Never store plain password
  const saved = upsert('users', data);
  return { success: true, data: saved };
});

ipcMain.handle('change-password', async (e, userId, newPassword) => {
  const users = readCollection('users');
  const idx = users.findIndex(u => u.id === userId);
  if (idx < 0) return { success: false, error: 'User not found.' };

  const salt = bcrypt.genSaltSync(10);
  users[idx].password_hash = bcrypt.hashSync(newPassword, salt);
  users[idx].updated_at = new Date().toISOString();
  writeCollection('users', users);
  return { success: true };
});

// =====================================================================
// CLOUD USER MANAGEMENT (Supabase) — owner-only operations
// Maintains a logged-in Supabase session for owner; all CRUD operations
// run as the owner via RLS.
// =====================================================================
const { createClient: _sbCreateClient } = require('@supabase/supabase-js');
const SUPABASE_DOMAIN = 'interstate-septic.app';
const supabaseConfigPath = path.join(userDataPath, 'supabase-config.json');
let _sbClient = null;
let _sbSession = null;

function _getSbConfig() {
  if (!fs.existsSync(supabaseConfigPath)) return null;
  try { return JSON.parse(fs.readFileSync(supabaseConfigPath, 'utf8')); } catch { return null; }
}

function _getSbClient() {
  if (_sbClient) return _sbClient;
  const cfg = _getSbConfig();
  if (!cfg || !cfg.url || !cfg.anonKey) return null;
  _sbClient = _sbCreateClient(cfg.url, cfg.anonKey, { auth: { persistSession: false } });
  return _sbClient;
}

// Session persistence — writes refresh+access token to a file in userData
const _sbSessionPath = path.join(userDataPath, 'supabase-session.json');

function _saveSbSession(session) {
  if (!session) return;
  try {
    fs.writeFileSync(_sbSessionPath, JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
      user_id: session.user?.id
    }, null, 2));
  } catch (e) {
    console.warn('[CLOUD] could not save session:', e.message);
  }
}

function _clearSbSession() {
  try { if (fs.existsSync(_sbSessionPath)) fs.unlinkSync(_sbSessionPath); } catch {}
}

async function _restoreSbSession() {
  if (!fs.existsSync(_sbSessionPath)) return null;
  let saved;
  try { saved = JSON.parse(fs.readFileSync(_sbSessionPath, 'utf8')); }
  catch { return null; }
  if (!saved.access_token || !saved.refresh_token) return null;

  const sb = _getSbClient();
  if (!sb) return null;
  const { data, error } = await sb.auth.setSession({
    access_token: saved.access_token,
    refresh_token: saved.refresh_token
  });
  if (error || !data.session) {
    _clearSbSession();
    return null;
  }
  _sbSession = data.session;
  // Save refreshed tokens
  _saveSbSession(data.session);
  return data.session;
}

function _normalizeUsername(s) {
  return (s || '').toLowerCase().replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, '');
}

ipcMain.handle('cloud-config-status', async () => {
  const cfg = _getSbConfig();
  return {
    configured: !!(cfg && cfg.url && cfg.anonKey),
    url: cfg?.url || null,
    signedIn: !!_sbSession,
    sessionUser: _sbSession?.user?.email || null
  };
});

ipcMain.handle('cloud-login', async (e, username, password) => {
  const sb = _getSbClient();
  if (!sb) return { success: false, error: 'Supabase not configured' };
  const u = _normalizeUsername(username);
  const email = `${u}@${SUPABASE_DOMAIN}`;
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return { success: false, error: error.message };
  _sbSession = data.session;
  _saveSbSession(data.session);
  // Look up role
  const { data: profile } = await sb.from('users').select('id, name, role, username, color, phone').eq('auth_user_id', data.user.id).single();
  // Hydrate local cache and subscribe to realtime — non-blocking
  _cloudHydrateStore().catch(e => console.warn('[CLOUD] hydrate error:', e.message));
  setTimeout(() => _cloudSubscribeRealtime(), 100);
  return { success: true, user: profile, session: { expires_at: data.session.expires_at } };
});

ipcMain.handle('cloud-logout', async () => {
  _cloudUnsubscribeRealtime();
  const sb = _getSbClient();
  if (sb) await sb.auth.signOut();
  _sbSession = null;
  _clearSbSession();
  return { success: true };
});

ipcMain.handle('cloud-restore-session', async () => {
  const session = await _restoreSbSession();
  if (!session) return { success: false };
  const sb = _getSbClient();
  const { data: profile, error } = await sb.from('users').select('id, name, role, username, color, phone').eq('auth_user_id', session.user.id).single();
  if (error || !profile) {
    _clearSbSession();
    _sbSession = null;
    return { success: false };
  }
  // Hydrate local cache and subscribe to realtime
  _cloudHydrateStore().catch(e => console.warn('[CLOUD] hydrate error:', e.message));
  setTimeout(() => _cloudSubscribeRealtime(), 100);
  return { success: true, user: profile, session: { expires_at: session.expires_at } };
});

ipcMain.handle('cloud-users-list', async () => {
  const sb = _getSbClient();
  if (!sb || !_sbSession) return { success: false, error: 'Not signed in to cloud' };
  const { data, error } = await sb.from('users')
    .select('id, username, name, phone, role, color, auth_user_id, created_at, updated_at')
    .order('role', { ascending: true })
    .order('username');
  if (error) return { success: false, error: error.message };
  return { success: true, data: data.map(u => ({ ...u, linked: !!u.auth_user_id })) };
});

ipcMain.handle('cloud-users-create', async (e, payload) => {
  const sb = _getSbClient();
  if (!sb || !_sbSession) return { success: false, error: 'Not signed in to cloud' };
  if (!payload.username || !payload.name || !payload.role || !payload.password) {
    return { success: false, error: 'Username, name, role, and password are required' };
  }
  if (!['owner','office','tech'].includes(payload.role)) {
    return { success: false, error: 'Invalid role' };
  }
  if (payload.password.length < 6) {
    return { success: false, error: 'Password must be at least 6 characters' };
  }

  const username = _normalizeUsername(payload.username);
  const email = `${username}@${SUPABASE_DOMAIN}`;

  // 1. Insert public.users row first so trigger has a target
  const { data: insertData, error: insertErr } = await sb.from('users').insert({
    username,
    name: payload.name,
    role: payload.role,
    phone: payload.phone || null,
    color: payload.color || null
  }).select().single();
  if (insertErr) return { success: false, error: 'Profile create failed: ' + insertErr.message };

  // 2. Sign up the auth account using a separate client (preserves owner session)
  const cfg = _getSbConfig();
  const signupClient = _sbCreateClient(cfg.url, cfg.anonKey, { auth: { persistSession: false } });
  const { error: signupErr } = await signupClient.auth.signUp({ email, password: payload.password });
  if (signupErr) {
    // Rollback the profile insert
    await sb.from('users').delete().eq('id', insertData.id);
    return { success: false, error: 'Auth account create failed: ' + signupErr.message };
  }
  await signupClient.auth.signOut();

  return { success: true, data: { ...insertData, linked: true } };
});

ipcMain.handle('cloud-users-update', async (e, userId, updates) => {
  const sb = _getSbClient();
  if (!sb || !_sbSession) return { success: false, error: 'Not signed in to cloud' };
  const allowed = {};
  if (updates.name !== undefined) allowed.name = updates.name;
  if (updates.phone !== undefined) allowed.phone = updates.phone;
  if (updates.role !== undefined) {
    if (!['owner','office','tech'].includes(updates.role)) {
      return { success: false, error: 'Invalid role' };
    }
    allowed.role = updates.role;
  }
  if (updates.color !== undefined) allowed.color = updates.color;
  if (updates.username !== undefined) {
    allowed.username = _normalizeUsername(updates.username);
  }
  const { data, error } = await sb.from('users').update(allowed).eq('id', userId).select().single();
  if (error) return { success: false, error: error.message };
  return { success: true, data };
});

ipcMain.handle('cloud-users-delete', async (e, userId) => {
  const sb = _getSbClient();
  if (!sb || !_sbSession) return { success: false, error: 'Not signed in to cloud' };
  const { error } = await sb.from('users').delete().eq('id', userId);
  if (error) return { success: false, error: error.message };
  // NOTE: this does not remove auth.users — that requires service role.
  // The orphaned auth account stays but cannot log in (its public.users row is gone,
  // and the app rejects logins without a linked profile).
  return { success: true };
});

// ===== PDF GENERATION =====
ipcMain.handle('generate-pdf', async (e, html, filename, options = {}) => {
  const isLandscape = html.includes('size: landscape') || html.includes('data-landscape');

  // Determine save path — show Save As dialog unless skipDialog is set
  let savePath;
  if (options.skipDialog) {
    savePath = options.forcePath || path.join(userDataPath, filename || 'export.pdf');
  } else {
    const settings = (() => { try { return readCollection('settings')[0] || {}; } catch { return {}; } })();
    const defaultDir = settings.default_pdf_folder || app.getPath('documents');
    const dialogResult = await dialog.showSaveDialog(mainWindow, {
      title: 'Save PDF',
      defaultPath: path.join(defaultDir, filename || 'export.pdf'),
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    });
    if (dialogResult.canceled || !dialogResult.filePath) return { success: false, canceled: true };
    savePath = dialogResult.filePath;
  }

  const pdfWindow = new BrowserWindow({ show: false, width: isLandscape ? 1056 : 816, height: isLandscape ? 816 : 1056 });
  pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  return new Promise((resolve) => {
    pdfWindow.webContents.on('did-finish-load', async () => {
      setTimeout(async () => {
        try {
          const pdfData = await pdfWindow.webContents.printToPDF({
            printBackground: true,
            marginsType: 0,
            landscape: isLandscape,
            margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
          });
          fs.writeFileSync(savePath, pdfData);
          pdfWindow.close();
          resolve({ success: true, path: savePath });
        } catch (err) {
          pdfWindow.close();
          resolve({ success: false, error: err.message });
        }
      }, 500);
    });
  });
});

// ===== EMAIL =====
ipcMain.handle('send-email', async (e, to, subject, body, attachmentPath) => {
  const settingsPath = path.join(userDataPath, 'settings.json');
  if (!fs.existsSync(settingsPath)) return { success: false, error: 'Email not configured. Go to Settings.' };
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

  if (!settings.smtp_host) return { success: false, error: 'Email not configured. Go to Settings.' };

  const transporter = nodemailer.createTransport({
    host: settings.smtp_host,
    port: parseInt(settings.smtp_port) || 587,
    secure: parseInt(settings.smtp_port) === 465,
    auth: { user: settings.smtp_user, pass: settings.smtp_pass },
  });

  const mailOptions = {
    from: settings.smtp_user,
    to,
    subject,
    html: body,
  };

  if (attachmentPath && fs.existsSync(attachmentPath)) {
    mailOptions.attachments = [{ path: attachmentPath }];
  }

  try {
    await transporter.sendMail(mailOptions);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ===== SERVICE DUE NOTICE AUTO-EMAIL CHECK =====
function buildReminderEmail(cust, prop, serviceType, label, dueDate, companyName, companyPhone, confirmToken) {
  const propAddr = prop
    ? `${prop.address || ''}, ${prop.city || ''} ${prop.state || ''} ${prop.zip || ''}`.trim()
    : 'your property';

  let timingText;
  if (label === 'Day Of') {
    timingText = `<strong>today</strong>`;
  } else if (label && label.includes('After')) {
    timingText = `<strong>overdue</strong> — it was due on ${dueDate}`;
  } else {
    timingText = `due on <strong>${dueDate}</strong> (${label ? label.toLowerCase() : 'soon'})`;
  }

  const { publicUrl, port } = getServerSettings();
  const baseUrl = publicUrl || `http://localhost:${port}`;
  const confirmUrl = confirmToken ? `${baseUrl}/confirm?token=${confirmToken}` : null;

  const confirmBlock = confirmUrl ? `
    <div style="margin:24px 0;text-align:center;">
      <a href="${confirmUrl}" style="display:inline-block;background:#2e7d32;color:white;text-decoration:none;padding:14px 28px;border-radius:6px;font-size:16px;font-weight:bold;">
        ✓ Confirm / I'll Schedule My Appointment
      </a>
      <p style="margin-top:10px;font-size:12px;color:#999;">Clicking this button will stop further reminders for this notice.</p>
    </div>` : '';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="color:#1b5e20;">${companyName}</h2>
      <p>Dear ${cust.name || 'Valued Customer'},</p>
      <p>This is a friendly reminder that your <strong>${serviceType}</strong> service at <strong>${propAddr}</strong> is ${timingText}.</p>
      <p>Please contact us at your earliest convenience to schedule your appointment.</p>
      ${companyPhone ? `<p>Phone: <strong>${companyPhone}</strong></p>` : ''}
      ${confirmBlock}
      <p>Thank you for your business!</p>
      <hr style="border:none;border-top:1px solid #ddd;margin:20px 0;">
      <p style="font-size:12px;color:#999;">This is an automated reminder from ${companyName}. If you have already scheduled your appointment, you may disregard this message.</p>
    </div>`;

  const subject = label === 'Day Of'
    ? `${serviceType} Service Due Today - ${companyName}`
    : `${serviceType} Reminder: ${label} - ${companyName}`;

  return { html, subject };
}

async function checkDueNotices() {
  try {
    const settingsPath = path.join(userDataPath, 'settings.json');
    if (!fs.existsSync(settingsPath)) return;
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (!settings.smtp_host) return;

    let notices = readCollection('service_due_notices').filter(n => !n.deleted_at);
    const customers = readCollection('customers');
    const properties = readCollection('properties');
    const today = new Date().toISOString().split('T')[0];

    const companyName = settings.company_name || 'Interstate Septic';
    const companyPhone = settings.company_phone || '';

    const transporter = nodemailer.createTransport({
      host: settings.smtp_host,
      port: parseInt(settings.smtp_port) || 587,
      secure: parseInt(settings.smtp_port) === 465,
      auth: { user: settings.smtp_user, pass: settings.smtp_pass },
    });

    let dirty = false;

    for (let i = 0; i < notices.length; i++) {
      const n = notices[i];
      if (n.email_enabled === false || n.method === 'mail' || n.method === 'phone') continue;
      if (n.status === 'confirmed') continue; // Customer confirmed — stop all reminders

      const cust = customers.find(c => c.id === n.customer_id);
      const prop = properties.find(p => p.id === n.property_id);
      if (!cust?.email) continue;

      const serviceType = n.service_type || 'Septic Service';

      // --- Process auto-schedule items ---
      if (Array.isArray(n.notification_schedule) && n.notification_schedule.length > 0) {
        let scheduleDirty = false;
        const updatedSchedule = n.notification_schedule.map(item => {
          if (item.sent || !item.send_date || item.send_date > today) return item;
          return { ...item, _pendingSend: true };
        });

        for (let s = 0; s < updatedSchedule.length; s++) {
          const item = updatedSchedule[s];
          if (!item._pendingSend) continue;
          const { html, subject } = buildReminderEmail(cust, prop, serviceType, item.label, n.due_date, companyName, companyPhone, n.confirm_token);
          try {
            await transporter.sendMail({ from: settings.smtp_user, to: cust.email, subject, html });
            const { _pendingSend, ...rest } = item;
            updatedSchedule[s] = { ...rest, sent: true, sent_at: new Date().toISOString() };
            scheduleDirty = true;
            console.log(`[SDN] Sent "${item.label}" reminder to ${cust.email} for notice ${n.id}`);
          } catch (err) {
            const { _pendingSend, ...rest } = item;
            updatedSchedule[s] = rest; // remove flag but don't mark sent so it retries
            console.error(`[SDN] Failed to send "${item.label}" to ${cust.email}:`, err.message);
          }
        }

        if (scheduleDirty) {
          notices[i] = { ...n, notification_schedule: updatedSchedule, updated_at: new Date().toISOString() };
          dirty = true;
        }
        continue; // Skip legacy fallback for notices with a schedule
      }

      // --- Legacy fallback: send once when due_date arrives ---
      if (n.status === 'pending' && n.due_date && n.due_date <= today) {
        const { html, subject } = buildReminderEmail(cust, prop, serviceType, 'Day Of', n.due_date, companyName, companyPhone, n.confirm_token);
        try {
          await transporter.sendMail({ from: settings.smtp_user, to: cust.email, subject, html });
          notices[i] = { ...n, status: 'sent', sent_date: new Date().toISOString(), updated_at: new Date().toISOString() };
          dirty = true;
        } catch (err) {
          console.error(`[SDN] Failed to send legacy reminder to ${cust.email}:`, err.message);
        }
      }
    }

    if (dirty) writeCollection('service_due_notices', notices);
  } catch (err) {
    console.error('checkDueNotices error:', err.message);
  }
}

ipcMain.handle('check-due-notices', async () => {
  await checkDueNotices();
  return { success: true };
});

ipcMain.handle('restart-confirm-server', async () => {
  restartConfirmServer();
  const { port } = getServerSettings();
  return { success: true, port };
});

ipcMain.handle('get-confirm-server-status', async () => {
  const { port, publicUrl } = getServerSettings();
  return { running: !!confirmServer, port, publicUrl };
});

ipcMain.handle('set-auto-start', async (e, enabled) => {
  app.setLoginItemSettings({ openAtLogin: !!enabled });
  return { success: true, enabled: !!enabled };
});

ipcMain.handle('get-auto-start', async () => {
  const { openAtLogin } = app.getLoginItemSettings();
  return { enabled: openAtLogin };
});

async function checkJobReminders() {
  try {
    const settingsPath = path.join(userDataPath, 'settings.json');
    if (!fs.existsSync(settingsPath)) return;
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (!settings.smtp_host) return;

    const jobs = readCollection('jobs').filter(j => !j.deleted_at);
    const customers = readCollection('customers');
    const properties = readCollection('properties');

    // Calculate tomorrow's date
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    // Find jobs scheduled for tomorrow that haven't had reminders sent yet
    const jobsForTomorrow = jobs.filter(j =>
      j.scheduled_date === tomorrowStr && 
      (!j.reminder_sent || j.reminder_sent !== tomorrowStr)
    );

    if (jobsForTomorrow.length === 0) return;

    const transporter = nodemailer.createTransport({
      host: settings.smtp_host,
      port: parseInt(settings.smtp_port) || 587,
      secure: parseInt(settings.smtp_port) === 465,
      auth: { user: settings.smtp_user, pass: settings.smtp_pass },
    });

    const companyName = settings.company_name || 'Interstate Septic';
    const companyPhone = settings.company_phone || '';

    for (const job of jobsForTomorrow) {
      const cust = customers.find(c => c.id === job.customer_id);
      const prop = properties.find(p => p.id === job.property_id);
      if (!cust?.email) continue;

      const scheduledDate = new Date(job.scheduled_date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      const propAddr = prop ? `${prop.address || ''}, ${prop.city || ''} ${prop.state || ''} ${prop.zip || ''}`.trim() : 'your property';

      const html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <h2 style="color:#1b5e20;">${companyName}</h2>
          <p>Dear ${cust.name || 'Valued Customer'},</p>
          <p>This is a friendly reminder of your scheduled service appointment <strong>tomorrow (${scheduledDate})</strong>.</p>
          <div style="background:#f0f7ff;padding:16px;border-left:4px solid #2196F3;border-radius:4px;margin:20px 0;">
            <p style="margin:8px 0;"><strong>Service Date:</strong> ${scheduledDate}</p>
            <p style="margin:8px 0;"><strong>Service Type:</strong> ${job.service_type || 'Service'}</p>
            <p style="margin:8px 0;"><strong>Property:</strong> ${propAddr}</p>
            ${job.notes ? `<p style="margin:8px 0;"><strong>Notes:</strong> ${job.notes}</p>` : ''}
          </div>
          <p>If you need to reschedule, please contact us as soon as possible.</p>
          ${companyPhone ? `<p>Phone: <strong>${companyPhone}</strong></p>` : ''}
          <p>We look forward to serving you!</p>
          <hr style="border:none;border-top:1px solid #ddd;margin:20px 0;">
          <p style="font-size:12px;color:#999;">This is an automated reminder from ${companyName}.</p>
        </div>`;

      try {
        await transporter.sendMail({
          from: settings.smtp_user,
          to: cust.email,
          subject: `Appointment Reminder for Tomorrow - ${companyName}`,
          html,
        });
        // Mark reminder as sent
        job.reminder_sent = tomorrowStr;
        job.updated_at = new Date().toISOString();
      } catch (err) {
        console.error(`Failed to send job reminder email to ${cust.email}:`, err.message);
      }
    }

    writeCollection('jobs', jobs);
  } catch (err) {
    console.error('checkJobReminders error:', err.message);
  }
}

// ===== REMINDER ALERTS =====
const _firedReminderAlerts = new Set();

function checkReminderAlerts() {
  try {
    const reminders = readCollection('reminders');
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    for (const r of reminders) {
      if (r.status === 'done' || !r.alert_before || !r.due_date) continue;
      if (_firedReminderAlerts.has(r.id)) continue;

      // Build the reminder datetime
      const rDateStr = r.due_date;
      const rTimeStr = r.due_time || '09:00'; // default to 9am if no time
      const reminderDT = new Date(`${rDateStr}T${rTimeStr}:00`);

      // Calculate alert time based on alert_before setting
      let alertDT;
      switch (r.alert_before) {
        case '15m':
          alertDT = new Date(reminderDT.getTime() - 15 * 60 * 1000);
          break;
        case '1h':
          alertDT = new Date(reminderDT.getTime() - 60 * 60 * 1000);
          break;
        case 'start_of_day':
          alertDT = new Date(`${rDateStr}T08:00:00`);
          break;
        case '1d':
          alertDT = new Date(reminderDT.getTime() - 24 * 60 * 60 * 1000);
          break;
        case '7d':
          alertDT = new Date(reminderDT.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        default:
          continue;
      }

      // Fire if alert time has passed but we haven't fired yet
      if (now >= alertDT) {
        _firedReminderAlerts.add(r.id);
        const alertLabel = { '15m': '15 min before', '1h': '1 hour before', 'start_of_day': 'Start of day', '1d': 'Day before', '7d': '7 days before' }[r.alert_before] || '';
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('reminder-alert', {
            id: r.id,
            message: r.message,
            due_date: r.due_date,
            due_time: r.due_time,
            alertLabel
          });
        }
      }
    }
  } catch (err) {
    console.error('checkReminderAlerts error:', err.message);
  }
}

// ===== FILE OPERATIONS =====
ipcMain.handle('show-save-dialog', async (e, options) => {
  return await dialog.showSaveDialog(mainWindow, options);
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Default PDF Save Folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };
  return { folderPath: result.filePaths[0] };
});

ipcMain.handle('open-file', async (e, filePath) => {
  shell.openPath(filePath);
});

// ===== SEED TEST DATA =====
ipcMain.handle('seed-test-data', async () => {
  const vehicles = readCollection('vehicles');
  if (vehicles.length === 0) return { success: false, error: 'No vehicles found. Add trucks first.' };

  const today = new Date().toISOString().split('T')[0]; // e.g. 2026-03-14

  // If there are previous demo jobs for today, silently clean them up first
  // (user might be re-running the demo) instead of blocking. Real jobs are
  // left alone — demo jobs just stack on top of them.
  const existingJobs = readCollection('jobs');
  const stalePrevDemoToday = existingJobs.filter(j => j._test_data && j.scheduled_date === today);
  if (stalePrevDemoToday.length > 0) {
    await unseedAllTestData();
    console.log(`[DEMO] Cleaned up ${stalePrevDemoToday.length} previous demo jobs before re-seeding`);
  }

  // NEW APPROACH: sample REAL customers + their REAL properties + REAL tanks
  // from the existing database. Tag ONLY the job record with _test_data:true.
  // Customers/properties/tanks are never modified, never flagged, never
  // touched — so there is NOTHING about them to clean up on unseed.
  //
  // Safety guarantees:
  //   - No confirmation emails: sendJobConfirmEmail early-returns on
  //     job._test_data (see line ~766).
  //   - Unseed cascade: demoJobIds is built from j._test_data. Every
  //     downstream collection (invoices, payments, schedule_items,
  //     reminders, service_due_notices, filter_leads, disposal_loads)
  //     is cleaned by demoJobIds.has(job_id). demoCustIds/demoPropIds/
  //     demoTankIds stay empty, so the base customer/property/tank
  //     collections get zero deletions.
  //   - Using real addresses means demo jobs geocode cleanly and show
  //     on the map the way real jobs do.

  const allCustomers = readCollection('customers').filter(c => !c._test_data && !c.deleted_at);
  const allProperties = readCollection('properties').filter(p => !p._test_data && !p.deleted_at);
  const allTanks = readCollection('tanks').filter(t => !t._test_data);

  if (allCustomers.length === 0) {
    return { success: false, error: 'No customers in the database yet. Import customers first, then use + Demo.' };
  }

  // Index: customer_id → [properties with a usable address]
  const propsByCust = new Map();
  for (const p of allProperties) {
    if (!p.customer_id || !p.address || !p.city) continue;
    if (!propsByCust.has(p.customer_id)) propsByCust.set(p.customer_id, []);
    propsByCust.get(p.customer_id).push(p);
  }

  // Index: property_id → [tanks with real, non-zero volume]
  // We intentionally drop tanks whose volume is 0 / null / blank here —
  // those produce work orders that show "0 gal" for the job, which is
  // what bit us on the first pass.
  const tanksByProp = new Map();
  for (const t of allTanks) {
    if (!t.property_id) continue;
    const vol = parseInt(t.volume_gallons) || 0;
    if (vol <= 0) continue; // skip blank/zero-capacity tanks
    if (!tanksByProp.has(t.property_id)) tanksByProp.set(t.property_id, []);
    tanksByProp.get(t.property_id).push(t);
  }

  // Prefer customers whose property is already in the geocode cache —
  // they'll show on the map instantly, no Nominatim roundtrip needed.
  const geocodeCache = readCollection('geocode_cache');
  const cachedAddrs = new Set(geocodeCache.map(g => (g.address || '').toLowerCase().trim()));
  const fullAddrOf = (p) =>
    [p.address, p.city, p.state || 'ME'].filter(Boolean).join(', ').toLowerCase().trim();

  // Build the pool of (customer, property) pairs usable for a demo job.
  // REQUIREMENT: the property must have at least one real tank with a
  // real volume_gallons value. Otherwise the job card would show "0 gal"
  // and the route panel's planned-gallons total would be wrong.
  const pool = [];
  for (const cust of allCustomers) {
    const props = propsByCust.get(cust.id);
    if (!props || props.length === 0) continue;

    // Candidate properties under this customer that have usable tanks
    const viable = props.filter(p => tanksByProp.has(p.id));
    if (viable.length === 0) continue; // this customer has no tank data — skip

    // Prefer a viable property that's already geocoded
    const prop = viable.find(p => cachedAddrs.has(fullAddrOf(p))) || viable[0];
    pool.push({ customer: cust, property: prop, geocoded: cachedAddrs.has(fullAddrOf(prop)) });
  }

  if (pool.length === 0) {
    return {
      success: false,
      error: 'No customers with both a property address AND tank volume data were found. '
        + 'Import your tank data first (TankTrack merge or Tanks tab), then use + Demo.'
    };
  }

  // Shuffle, but float geocoded ones to the front so most of today's demo
  // jobs render on the map on the first click.
  pool.sort(() => Math.random() - 0.5);
  pool.sort((a, b) => (b.geocoded ? 1 : 0) - (a.geocoded ? 1 : 0));

  const confirmStatuses = ['confirmed', 'confirmed', 'confirmed', 'no_reply', 'auto_confirmed', 'unconfirmed', 'left_message'];
  const times = ['07:00', '07:30', '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00'];
  const ttConfig = readCollection('tank_types');
  const ttMap = {};
  ttConfig.forEach(tt => { ttMap[tt.name] = tt; });
  const pumpUnitPrice = 250;
  const dispUnitPrice = 140;

  // Pick the first 4 vehicles with capacity (pump trucks)
  const pumpTrucks = vehicles.filter(v => v.capacity_gallons > 0).slice(0, 4);
  if (pumpTrucks.length === 0) return { success: false, error: 'No trucks with capacity found.' };

  let poolIdx = 0;
  const seededJobs = [];

  for (const truck of pumpTrucks) {
    const jobCount = 6 + Math.floor(Math.random() * 3); // 6-8 jobs per truck
    for (let i = 0; i < jobCount; i++) {
      if (poolIdx >= pool.length) break;
      const { customer, property } = pool[poolIdx++];

      // Guaranteed non-empty by the pool filter above — every pooled
      // property has at least one tank with volume_gallons > 0.
      const jobTanks = tanksByProp.get(property.id);
      const tankVol = jobTanks.reduce((s, t) => s + (parseInt(t.volume_gallons) || 0), 0);
      const allItems = jobTanks.flatMap(t => {
        const tQty = Math.max(1, Math.round(((t.volume_gallons || 0) / 1000) * 100) / 100);
        const tt = ttMap[t.tank_type] || {};
        const pumpP = tt.pumping_price ?? pumpUnitPrice;
        const dispP = tt.disposal_price ?? dispUnitPrice;
        const lines = [{ description: 'Pumping', qty: tQty, unit_price: pumpP }];
        if (tt.generates_disposal !== false && (tt.disposal_label || tt.generates_disposal)) {
          lines.push({ description: tt.disposal_label || 'Waste Disposal', qty: tQty, unit_price: dispP });
        }
        return lines;
      });
      const total = Math.round(allItems.reduce((s, li) => s + li.qty * li.unit_price, 0) * 100) / 100;

      const job = upsert('jobs', {
        customer_id: customer.id,    // ← REAL customer id, never modified
        property_id: property.id,    // ← REAL property id, never modified
        vehicle_id: truck.id,
        assigned_to: truck.default_tech_id || '',
        scheduled_date: today,
        scheduled_time: times[i % times.length],
        service_type: 'Septic Pumping',
        status: 'scheduled',
        confirmation_status: confirmStatuses[Math.floor(Math.random() * confirmStatuses.length)],
        sort_order: i * 10,
        gallons: tankVol,
        line_items: allItems,
        total,
        _test_data: true,            // ← ONLY the job is tagged
      });
      seededJobs.push(job);
    }
  }

  return {
    success: true,
    data: {
      customers: 0,                 // no customers created — uses existing
      properties: 0,                // no properties created
      tanks: 0,                     // no tanks created
      jobs: seededJobs.length,
      date: today,
      pool_size: pool.length,
      mode: 'real_customers',
    }
  };
});

// ===== UNSEED TEST DATA =====
// Comprehensive cascade: removes every demo-tagged record AND every dependent
// record that links to it (invoices, payments, schedule_items, reminders,
// service_due_notices, filter_leads, afcs, disposal_loads, day_notes).
async function unseedAllTestData() {
  const counts = {};

  // 1. Collect IDs of every demo-tagged seed entity across the 4 base collections
  const demoCustIds = new Set();
  const demoPropIds = new Set();
  const demoTankIds = new Set();
  const demoJobIds = new Set();

  for (const c of readCollection('customers')) if (c._test_data) demoCustIds.add(c.id);
  for (const p of readCollection('properties')) {
    if (p._test_data || demoCustIds.has(p.customer_id)) demoPropIds.add(p.id);
  }
  for (const t of readCollection('tanks')) {
    if (t._test_data || demoPropIds.has(t.property_id)) demoTankIds.add(t.id);
  }
  for (const j of readCollection('jobs')) {
    if (j._test_data || demoCustIds.has(j.customer_id) || demoPropIds.has(j.property_id)) {
      demoJobIds.add(j.id);
    }
  }

  // 2. Base collections — remove tagged or linked rows
  const custKept = readCollection('customers').filter(c => !demoCustIds.has(c.id));
  counts.customers = demoCustIds.size;
  writeCollection('customers', custKept);

  const propKept = readCollection('properties').filter(p => !demoPropIds.has(p.id));
  counts.properties = demoPropIds.size;
  writeCollection('properties', propKept);

  const tankKept = readCollection('tanks').filter(t => !demoTankIds.has(t.id));
  counts.tanks = demoTankIds.size;
  writeCollection('tanks', tankKept);

  const jobKept = readCollection('jobs').filter(j => !demoJobIds.has(j.id));
  counts.jobs = demoJobIds.size;
  writeCollection('jobs', jobKept);

  // 3. Dependent collections — cascade delete anything referencing demo records
  const cascade = (colName, predicate) => {
    const items = readCollection(colName);
    const kept = items.filter(i => !predicate(i));
    const removed = items.length - kept.length;
    if (removed > 0) {
      counts[colName] = removed;
      writeCollection(colName, kept);
    }
  };

  cascade('invoices', i =>
    demoJobIds.has(i.job_id) ||
    demoCustIds.has(i.customer_id) ||
    demoPropIds.has(i.property_id) ||
    i._test_data
  );
  cascade('payments', p => demoJobIds.has(p.job_id) || demoCustIds.has(p.customer_id) || p._test_data);
  cascade('schedule_items', s => demoJobIds.has(s.job_id) || s._test_data);
  cascade('reminders', r => demoJobIds.has(r.job_id) || demoCustIds.has(r.customer_id) || r._test_data);
  cascade('service_due_notices', n =>
    demoJobIds.has(n.job_id) || demoCustIds.has(n.customer_id) || demoPropIds.has(n.property_id) || n._test_data
  );
  cascade('filter_leads', f =>
    demoJobIds.has(f.job_id) || demoCustIds.has(f.customer_id) || demoPropIds.has(f.property_id) || f._test_data
  );
  cascade('afcs', a => demoCustIds.has(a.customer_id) || a._test_data);
  cascade('disposal_loads', d => demoJobIds.has(d.job_id) || d._test_data);
  cascade('day_notes', d => d._test_data);
  cascade('ar_snapshots', a => a._test_data);

  console.log('[DEMO] Cascade removed:', counts);
  return counts;
}

ipcMain.handle('unseed-test-data', async () => {
  const counts = await unseedAllTestData();
  return { success: true, data: counts };
});

// ===== GEOCODE CACHE =====
ipcMain.handle('get-geocode-cache', async () => {
  return { success: true, data: readCollection('geocode_cache') };
});

ipcMain.handle('save-geocode-cache', async (e, entry) => {
  // entry = { address, lat, lng }
  if (!entry.address) return { success: false };
  const existing = readCollection('geocode_cache');
  const idx = existing.findIndex(c => c.address === entry.address);
  if (idx >= 0) {
    existing[idx] = { ...existing[idx], ...entry };
  } else {
    existing.push({ id: uuidv4(), ...entry });
  }
  writeCollection('geocode_cache', existing);
  return { success: true };
});

// ===== TANKTRACK IMPORT =====
ipcMain.handle('import-select-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select TankTrack Backup File',
    filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };
  return { filePath: result.filePaths[0] };
});

ipcMain.handle('import-preview-tanktrack', async (e, filePath, limit) => {
  try {
    const wb = XLSX.readFile(filePath);
    if (!wb.Sheets['Customers']) return { error: 'No "Customers" sheet found in this file.' };

    const raw = XLSX.utils.sheet_to_json(wb.Sheets['Customers']);
    const total = raw.length;

    // Group rows by unique customer (first+last+billing address) — TankTrack has 1 row per property
    const custMap = new Map();
    for (const row of raw) {
      const firstName = (row['First Name'] || '').trim();
      const lastName = (row['Last Name'] || '').trim();
      if (!firstName && !lastName) continue;
      const name = [firstName, lastName].filter(Boolean).join(' ');
      const billingAddr = (row['Billing Address 1'] || '').trim();
      const key = (name + '|' + billingAddr).toLowerCase();

      if (!custMap.has(key)) {
        custMap.set(key, {
          name,
          phone: row['Cell Phone'] || row['Home Phone'] || row['Work Phone'] || '',
          email: (row['Email'] || '').trim(),
          contact_method: _mapContactMethod(row['E-Contact Method']),
          address: billingAddr,
          address2: (row['Billing Address 2'] || '').trim(),
          city: (row['Billing City'] || '').trim(),
          state: (row['Billing State'] || 'ME').trim(),
          zip: (row['Billing Zip Code'] || '').trim(),
          notes: (row['Contact Notes[Private]'] || '').trim(),
          properties: [],
        });
      }

      const propAddr = (row['Property Address 1'] || '').trim();
      if (!propAddr) continue;

      const prop = {
        address: propAddr,
        address2: (row['Property Address 2'] || '').trim(),
        city: (row['Property City'] || '').trim(),
        state: (row['Property State'] || 'ME').trim(),
        zip: (row['Property Zip Code'] || '').trim(),
        county: (row['Property County'] || '').trim(),
        property_type: row['Property Type'] === 'C' ? 'Commercial' : row['Property Type'] === 'R' ? 'Residential' : '',
        directions: (row['Directions'] || '').trim(),
        notes: (row['Property Notes'] || '').trim(),
        last_appointment_date: row['Last Appointment Date'] || null,
        next_appointment_date: row['Next Appointment Date'] || null,
        service_due_date: row['Service Due Date'] || null,
        tanks: [],
      };

      // Tank 1
      if (row['Tank 1 Capacity'] > 0 || (row['Tank 1 Type/Source'] && row['Tank 1 Type/Source'] !== 'Drain Clearing')) {
        prop.tanks.push(_parseTank(row, 1));
      }
      // Tank 2
      if (row['Tank 2 Capacity'] > 0 || (row['Tank 2 Type/Source'] && row['Tank 2 Type/Source'] !== 'Drain Clearing' && row['Tank 2 Type/Source'] !== '')) {
        prop.tanks.push(_parseTank(row, 2));
      }

      custMap.get(key).properties.push(prop);
    }

    const customers = Array.from(custMap.values());
    const preview = limit ? customers.slice(0, limit) : customers;

    // Check for invoice data
    const hasInvoices = !!wb.Sheets['Invoices'];
    const invoiceCount = hasInvoices ? XLSX.utils.sheet_to_json(wb.Sheets['Invoices']).length : 0;

    return {
      totalRows: total,
      uniqueCustomers: customers.length,
      previewCustomers: preview,
      previewCount: preview.length,
      hasInvoices,
      invoiceCount,
    };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('import-execute-tanktrack', async (e, filePath, maxCustomers) => {
  const sendProgress = (p) => { try { e.sender.send('import-progress', p); } catch (_) {} };
  try {
    sendProgress({ stage: 'reading', message: 'Reading Excel file…' });
    const wb = XLSX.readFile(filePath);
    const raw = XLSX.utils.sheet_to_json(wb.Sheets['Customers']);

    // Work on copies in memory — write ONCE at the end to avoid O(n²) disk writes
    const customers = readCollection('customers').slice();
    const properties = readCollection('properties').slice();
    const tanks = readCollection('tanks').slice();

    sendProgress({ stage: 'grouping', message: 'Grouping rows by customer…' });

    // Safe string coercion — Excel gives numbers/dates as non-strings
    const s = (v) => (v == null ? '' : String(v).trim());

    // Group by customer
    const custMap = new Map();
    for (const row of raw) {
      const firstName = s(row['First Name']);
      const lastName = s(row['Last Name']);
      if (!firstName && !lastName) continue;
      const name = [firstName, lastName].filter(Boolean).join(' ');
      const billingAddr = s(row['Billing Address 1']);
      const key = (name + '|' + billingAddr).toLowerCase();

      if (!custMap.has(key)) {
        custMap.set(key, { name, row, properties: [] });
      }

      const propAddr = s(row['Property Address 1']);
      if (propAddr) custMap.get(key).properties.push(row);
    }

    const allCustomers = Array.from(custMap.values());
    const toImport = maxCustomers ? allCustomers.slice(0, maxCustomers) : allCustomers;
    const total = toImport.length;

    // Build dup-check index once (avoid O(n*m) per-row scans)
    const custIndex = new Set(customers.map(c =>
      `${(c.name || '').toLowerCase()}|${(c.address || '').toLowerCase()}`
    ));

    let imported = 0, skipped = 0, propsCreated = 0, tanksCreated = 0;
    const now = new Date().toISOString();

    for (let i = 0; i < toImport.length; i++) {
      const cust = toImport[i];
      const row = cust.row;
      const name = cust.name;
      const billingAddr = s(row['Billing Address 1']);
      const dupKey = `${name.toLowerCase()}|${billingAddr.toLowerCase()}`;

      if (custIndex.has(dupKey)) { skipped++; }
      else {
        const customer = {
          id: uuidv4(),
          name,
          phone: s(row['Cell Phone']) || s(row['Home Phone']) || s(row['Work Phone']),
          email: s(row['Email']),
          contact_method: _mapContactMethod(row['E-Contact Method']),
          address: billingAddr,
          address2: s(row['Billing Address 2']),
          city: s(row['Billing City']),
          state: s(row['Billing State']) || 'ME',
          zip: s(row['Billing Zip Code']),
          notes: s(row['Contact Notes[Private]']),
          imported_from: 'tanktrack',
          created_at: now,
          updated_at: now,
        };
        customers.push(customer);
        custIndex.add(dupKey);
        imported++;

        const propsSeen = new Set();
        for (const propRow of cust.properties) {
          const propAddr = s(propRow['Property Address 1']);
          if (!propAddr) continue;
          const pKey = propAddr.toLowerCase();
          if (propsSeen.has(pKey)) continue;
          propsSeen.add(pKey);

          const property = {
            id: uuidv4(),
            customer_id: customer.id,
            address: propAddr,
            address2: s(propRow['Property Address 2']),
            city: s(propRow['Property City']),
            state: s(propRow['Property State']) || 'ME',
            zip: s(propRow['Property Zip Code']),
            county: s(propRow['Property County']),
            property_type: propRow['Property Type'] === 'C' ? 'Commercial' : propRow['Property Type'] === 'R' ? 'Residential' : '',
            directions: s(propRow['Directions']),
            notes: s(propRow['Property Notes']),
            last_appointment_date: propRow['Last Appointment Date'] || null,
            next_appointment_date: propRow['Next Appointment Date'] || null,
            service_due_date: propRow['Service Due Date'] || null,
            imported_from: 'tanktrack',
            created_at: now,
            updated_at: now,
          };
          properties.push(property);
          propsCreated++;

          if (propRow['Tank 1 Capacity'] > 0 || (propRow['Tank 1 Type/Source'] && propRow['Tank 1 Type/Source'] !== 'Drain Clearing')) {
            tanks.push({ id: uuidv4(), property_id: property.id, ..._parseTank(propRow, 1), imported_from: 'tanktrack', created_at: now, updated_at: now });
            tanksCreated++;
          }
          if (propRow['Tank 2 Capacity'] > 0 || (propRow['Tank 2 Type/Source'] && propRow['Tank 2 Type/Source'] !== 'Drain Clearing' && propRow['Tank 2 Type/Source'] !== '')) {
            tanks.push({ id: uuidv4(), property_id: property.id, ..._parseTank(propRow, 2), imported_from: 'tanktrack', created_at: now, updated_at: now });
            tanksCreated++;
          }
        }
      }

      // Yield every 25 rows so progress events flush and UI stays responsive
      if ((i + 1) % 25 === 0 || i === toImport.length - 1) {
        sendProgress({ stage: 'importing', current: i + 1, total, imported, skipped, propsCreated, tanksCreated });
        await new Promise(r => setImmediate(r));
      }
    }

    sendProgress({ stage: 'saving', message: 'Writing to disk…', current: total, total });
    writeCollection('customers', customers);
    writeCollection('properties', properties);
    writeCollection('tanks', tanks);
    broadcastDataChange('customers');
    broadcastDataChange('properties');
    broadcastDataChange('tanks');

    sendProgress({ stage: 'done', imported, skipped, propsCreated, tanksCreated });
    return { success: true, imported, skipped, propsCreated, tanksCreated };
  } catch (err) {
    sendProgress({ stage: 'error', error: err.message });
    return { error: err.message };
  }
});

ipcMain.handle('import-invoices-tanktrack', async (e, filePath) => {
  try {
    const wb = XLSX.readFile(filePath);
    if (!wb.Sheets['Invoices']) return { error: 'No Invoices sheet found.' };
    const raw = XLSX.utils.sheet_to_json(wb.Sheets['Invoices']);
    const sendProgress = (p) => { try { e.sender.send('import-progress', p); } catch (_) {} };

    sendProgress({ stage: 'reading', message: 'Indexing customers & properties…' });
    const customers = readCollection('customers');
    const properties = readCollection('properties');
    const invoices = readCollection('invoices').slice();

    // Build lookup indexes once
    const custByName = new Map();
    for (const c of customers) custByName.set((c.name || '').toLowerCase(), c);
    const propsByCust = new Map();
    for (const p of properties) {
      const list = propsByCust.get(p.customer_id) || [];
      list.push(p);
      propsByCust.set(p.customer_id, list);
    }
    const invoiceNumbers = new Set(invoices.map(i => i.invoice_number));

    const total = raw.length;
    let imported = 0, skipped = 0, updated = 0;
    const now = new Date().toISOString();

    // Safe string coercion — Excel gives numbers/dates as non-strings
    const s = (v) => (v == null ? '' : String(v).trim());

    // Index existing invoices by number for in-place update of complete/waiting_area
    const invByNumber = new Map();
    for (const inv of invoices) if (inv.invoice_number) invByNumber.set(inv.invoice_number, inv);

    for (let i = 0; i < raw.length; i++) {
      const row = raw[i];
      const invNum = s(row['Invoice Number']);
      if (!invNum) { /* no progress-meaningful work */ }
      else if (invoiceNumbers.has(invNum)) {
        // Sync fields that the importer now derives (complete, waiting_area)
        const existing = invByNumber.get(invNum);
        if (existing) {
          const newComplete = s(row['Job Completed?']).toLowerCase().startsWith('y');
          const newWaiting = !s(row['Truck']);
          if (existing.complete !== newComplete || existing.waiting_area !== newWaiting) {
            existing.complete = newComplete;
            existing.waiting_area = newWaiting;
            existing.updated_at = now;
            updated++;
          }
        }
        skipped++;
      }
      else {
        const billingCompany = s(row['Billing Company']) || s(row['Company']) || s(row['Company Name']);
        const propertyCompany = s(row['Property Company']);
        const fullName = s(row['Full Name'])
          || [s(row['First Name']), s(row['Last Name'])].filter(Boolean).join(' ')
          || billingCompany
          || propertyCompany;
        const cust = custByName.get(fullName.toLowerCase());
        const propAddr = s(row['Property Address 1']) || s(row['Property Address']);
        let prop = null;
        if (cust && propAddr) {
          const list = propsByCust.get(cust.id) || [];
          prop = list.find(p => (p.address || '').toLowerCase() === propAddr.toLowerCase()) || null;
        }
        const totalAmount = parseFloat(row['Total Invoice Amount']) || 0;
        const totalPaid = parseFloat(row['Total Amount Paid']) || 0;
        const paymentStatus = totalPaid >= totalAmount && totalAmount > 0 ? 'paid' : totalPaid > 0 ? 'partial' : 'unpaid';
        invoices.push({
          id: uuidv4(),
          invoice_number: invNum,
          customer_id: cust?.id || null,
          customer_name: fullName,
          billing_company: billingCompany || fullName,
          billing_city: s(row['Billing City']) || cust?.city || '',
          property_id: prop?.id || null,
          property_company: propertyCompany,
          property_address: s(row['Property Address 1']) || prop?.address || '',
          property_city: s(row['Property City']) || prop?.city || '',
          svc_date: row['Date of Service'] || null,
          total: totalAmount,
          amount_paid: totalPaid,
          status: paymentStatus,
          payment_status: paymentStatus,
          payment_method: s(row['Payment Method']),
          payment_due_date: row['Payment Due Date'] || null,
          products_services: s(row['Products/Services']),
          product_sales: parseFloat(row['Product Sales']) || 0,
          quantity: s(row['Quantity']),
          unit_cost: s(row['Unit Cost']),
          technician: s(row['Technician']),
          tech_notes: s(row['Technician Notes']),
          job_notes: s(row['Job Notes']),
          job_codes: s(row['Job Codes']),
          gallons_pumped_total: parseInt(row['Gallons Pumped']) || 0,
          truck: s(row['Truck']),
          tank_type: s(row['Tank Type']),
          tank_size: parseInt(row['Tank Size']) || 0,
          waste_manifest: s(row['Waste Manifest #']),
          waste_site: s(row['Waste Site']),
          disposal_date: row['Disposal Date'] || null,
          check_numbers: s(row['Check Numbers']),
          complete: s(row['Job Completed?']).toLowerCase().startsWith('y'),
          waiting_area: !s(row['Truck']),
          imported_from: 'tanktrack',
          created_at: now,
          updated_at: now,
        });
        invoiceNumbers.add(invNum);
        imported++;
      }

      if ((i + 1) % 50 === 0 || i === raw.length - 1) {
        sendProgress({ stage: 'importing', current: i + 1, total, imported, skipped });
        await new Promise(r => setImmediate(r));
      }
    }

    sendProgress({ stage: 'saving', message: 'Writing invoices to disk…', current: total, total });
    writeCollection('invoices', invoices);
    broadcastDataChange('invoices');
    sendProgress({ stage: 'done', imported, skipped, updated });
    return { success: true, imported, skipped, updated };
  } catch (err) {
    try { e.sender.send('import-progress', { stage: 'error', error: err.message }); } catch (_) {}
    return { error: err.message };
  }
});

function _mapContactMethod(val) {
  if (!val) return '';
  const v = val.toLowerCase();
  if (v.includes('email') && v.includes('text')) return 'email_text';
  if (v.includes('email')) return 'email';
  if (v.includes('text')) return 'text';
  if (v.includes('phone') || v.includes('call')) return 'phone';
  return val;
}

function _parseTank(row, num) {
  const prefix = `Tank ${num} `;
  const s = (v) => (v == null ? '' : String(v).trim());
  const typeSource = s(row[prefix + 'Type/Source']);
  let tankType = 'Septic Tank';
  if (typeSource.includes('Filter')) tankType = 'Septic Tank+Filter';
  else if (typeSource.includes('Holding')) tankType = 'Holding Tank';
  else if (typeSource.includes('Grease')) tankType = 'Grease Trap';
  else if (typeSource.includes('Pump')) tankType = 'Pump Chamber';
  else if (typeSource.includes('Distribution')) tankType = 'Distribution Box';
  else if (typeSource.includes('Drain')) tankType = 'Drain Clearing';
  else if (typeSource.includes('Septic')) tankType = 'Septic Tank';
  else if (typeSource) tankType = typeSource;

  const filterVal = s(row[prefix + 'Filter?']).toLowerCase();
  let filter = 'unknown';
  if (filterVal === 'yes' || filterVal === 'true') filter = 'yes';
  else if (filterVal === 'no' || filterVal === 'false' || filterVal === 'n/a') filter = 'no';

  const riserVal = s(row[prefix + 'Riser?']).toLowerCase();
  let riser = 'unknown';
  if (riserVal === 'yes' || riserVal === 'true') riser = 'yes';
  else if (riserVal === 'no' || riserVal === 'false') riser = 'no';

  const freqVal = parseInt(row[prefix + 'Pump Frequency']) || 0;
  const freqUnit = s(row[prefix + 'Pump Frequency Unit']).toLowerCase();
  let pumpFreq = '';
  if (freqVal > 0 && freqUnit.includes('year')) {
    pumpFreq = freqVal === 1 ? '1 year' : freqVal + ' years';
  }

  return {
    tank_name: s(row[prefix + 'Name']),
    tank_type: tankType,
    volume_gallons: parseInt(row[prefix + 'Capacity']) || 0,
    depth_inches: parseInt(row[prefix + 'Depth']) || null,
    hose_length_ft: parseInt(row[prefix + 'Hose Length']) || null,
    filter,
    filter_type: s(row[prefix + 'Filter Type']),
    riser,
    pump_frequency: pumpFreq,
    notes: s(row[prefix + 'Notes']),
  };
}
