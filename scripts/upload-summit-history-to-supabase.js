// Uploads the locally-imported Summit History (legacy work-order CSV) to
// Supabase so every authenticated user of ISM sees the same data.
//
// PREREQUISITE: First run supabase/migrations/0006_summit_history.sql in
// the Supabase SQL editor (Dashboard → SQL Editor → paste → Run).
//
// USAGE:
//   node scripts/upload-summit-history-to-supabase.js \
//     --user owner_username --pass yourPassword
//
//   # or pull from env:
//   set ISM_USER=owner_username
//   set ISM_PASS=yourPassword
//   node scripts/upload-summit-history-to-supabase.js
//
//   # additional flags:
//   --truncate                    delete existing cloud rows first (clean slate)
//   --only=customers              upload only the customers table
//   --only=orders                 upload only the work-order table

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = path.join(os.homedir(), 'AppData', 'Roaming', 'interstate-septic-manager');
const CONFIG_PATH = path.join(DATA_DIR, 'supabase-config.json');
const JSON_DIR = path.join(DATA_DIR, 'data');
const SUPABASE_DOMAIN = 'interstate-septic.app';

if (!fs.existsSync(CONFIG_PATH)) {
  console.error('Missing supabase-config.json at', CONFIG_PATH);
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

// ---------- args ----------
const args = process.argv.slice(2);
function arg(name, def) {
  const a = args.find(x => x.startsWith('--' + name + '='));
  return a ? a.replace('--' + name + '=', '') : def;
}
const user = arg('user', process.env.ISM_USER);
const pass = arg('pass', process.env.ISM_PASS);
const TRUNCATE = args.includes('--truncate');
const ONLY = (args.find(a => a.startsWith('--only=')) || '').replace('--only=', '');
const SESSION_PATH = path.join(DATA_DIR, 'supabase-session.json');

// ---------- main ----------
(async () => {
  const sb = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false } });

  if (user && pass) {
    const email = `${user.toLowerCase().trim()}@${SUPABASE_DOMAIN}`;
    console.log('Signing in with password as', email);
    const { error } = await sb.auth.signInWithPassword({ email, password: pass });
    if (error) { console.error('Sign-in failed:', error.message); process.exit(1); }
    console.log('Signed in OK.');
  } else if (fs.existsSync(SESSION_PATH)) {
    console.log('Using saved Supabase session from', SESSION_PATH);
    const sess = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'));
    const { error } = await sb.auth.setSession({
      access_token: sess.access_token,
      refresh_token: sess.refresh_token,
    });
    if (error) {
      console.error('Could not restore session:', error.message);
      console.error('Pass --user/--pass to sign in fresh.');
      process.exit(1);
    }
    const { data: u } = await sb.auth.getUser();
    console.log('Restored session for', u?.user?.email || '(unknown email)');
  } else {
    console.error('No saved session and no --user/--pass provided.');
    console.error('Run with: node scripts/upload-summit-history-to-supabase.js --user OWNER --pass PASSWORD');
    process.exit(1);
  }

  if (!ONLY || ONLY === 'customers') {
    await uploadCustomers(sb);
  }
  if (!ONLY || ONLY === 'orders') {
    await uploadOrders(sb);
  }

  console.log('Done.');
  process.exit(0);
})().catch(err => {
  console.error('Upload failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});

// ---------- customers (~22k rows) ----------
async function uploadCustomers(sb) {
  const file = path.join(JSON_DIR, 'work_order_history_customers.json');
  if (!fs.existsSync(file)) {
    console.error('Missing', file, '— run import-work-order-history.js first.');
    return;
  }
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log('\n=== Customers ===');
  console.log('Local rows:', rows.length);

  if (TRUNCATE) {
    console.log('Truncating existing rows...');
    const { error } = await sb.from('work_order_history_customers').delete().neq('legacy_customer_id', '___sentinel___');
    if (error) console.warn('Truncate warning:', error.message);
  }

  const cleaned = rows.map(r => ({
    legacy_customer_id: String(r.legacy_customer_id || ''),
    name: r.name || null,
    name_norm: r.name_norm || null,
    phone: r.phone || null,
    email: r.email || null,
    address: r.address || null,
    count: r.count || 0,
    matched_customer_id: r.matched_customer_id || null,
    first_date: r.first_date || null,
    last_date: r.last_date || null,
  })).filter(r => r.legacy_customer_id);

  await chunkUpsert(sb, 'work_order_history_customers', cleaned, 'legacy_customer_id', 1000);
}

// ---------- orders (~107k rows) ----------
async function uploadOrders(sb) {
  const file = path.join(JSON_DIR, 'work_order_history.json');
  if (!fs.existsSync(file)) {
    console.error('Missing', file, '— run import-work-order-history.js first.');
    return;
  }
  console.log('\n=== Work Orders ===');
  console.log('Reading', file, '...');
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log('Local rows:', rows.length);

  if (TRUNCATE) {
    console.log('Truncating existing rows...');
    const { error } = await sb.from('work_order_history').delete().neq('legacy_work_order_id', '___sentinel___');
    if (error) console.warn('Truncate warning:', error.message);
  }

  const cleaned = rows.map(r => ({
    legacy_work_order_id: r.legacy_work_order_id ? String(r.legacy_work_order_id) : null,
    legacy_customer_id: r.legacy_customer_id ? String(r.legacy_customer_id) : null,
    customer_name: r.customer_name || null,
    customer_name_norm: r.customer_name_norm || null,
    customer_phone: r.customer_phone || null,
    customer_email: r.customer_email || null,
    job_address: r.job_address || null,
    scheduled_date: r.scheduled_date || null,
    scheduled_time: r.scheduled_time || null,
    job_description: r.job_description || null,
    task_type: r.task_type || null,
    job_status: r.job_status || null,
    job_comments: r.job_comments || null,
    planned_gallons: r.planned_gallons,
    tank_location: r.tank_location || null,
    disposal_site: r.disposal_site || null,
    disposal_amount: r.disposal_amount,
    material_description: r.material_description || null,
    matched_customer_id: r.matched_customer_id || null,
  })).filter(r => r.legacy_work_order_id);

  await chunkUpsert(sb, 'work_order_history', cleaned, 'legacy_work_order_id', 1000);
}

async function chunkUpsert(sb, table, rows, conflictCol, chunkSize) {
  let inserted = 0;
  const t0 = Date.now();
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await sb.from(table).upsert(chunk, { onConflict: conflictCol });
    if (error) {
      console.error(`\n  ✗ ${table} chunk ${i}-${i + chunk.length}: ${error.message}`);
      if (error.details) console.error('   ', error.details);
      throw new Error('Upload failed at row ' + i);
    }
    inserted += chunk.length;
    const pct = ((100 * inserted) / rows.length).toFixed(1);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    process.stdout.write(`  ✓ ${table}: ${inserted}/${rows.length} (${pct}% — ${elapsed}s)\r`);
  }
  console.log(`\n  Total: ${inserted} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
