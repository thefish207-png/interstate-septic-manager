// Interstate Septic Manager — JSON → Supabase data migration
// One-shot script that pushes existing local JSON data into the Supabase tables.
//
// PREREQUISITE: Run supabase/migrations/0001_initial_schema.sql in the Supabase
// SQL editor first (Dashboard → SQL Editor → New Query → paste → Run).
//
// USAGE:
//   node scripts/migrate-json-to-supabase.js              (dry run — shows counts)
//   node scripts/migrate-json-to-supabase.js --apply      (actually inserts)
//   node scripts/migrate-json-to-supabase.js --apply --only=customers,properties
//   node scripts/migrate-json-to-supabase.js --apply --truncate   (clears tables first)

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------- config ----------
const DATA_DIR = path.join(os.homedir(), 'AppData', 'Roaming', 'interstate-septic-manager');
const CONFIG_PATH = path.join(DATA_DIR, 'supabase-config.json');
const JSON_DIR = path.join(DATA_DIR, 'data');

if (!fs.existsSync(CONFIG_PATH)) {
  console.error('Missing supabase-config.json at', CONFIG_PATH);
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const supabase = createClient(config.url, config.anonKey, {
  auth: { persistSession: false }
});

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const TRUNCATE = args.includes('--truncate');
const ONLY = (args.find(a => a.startsWith('--only=')) || '').replace('--only=', '').split(',').filter(Boolean);

// ---------- helpers ----------
function readJson(filename) {
  const p = path.join(JSON_DIR, filename);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error('Failed to parse', filename, e.message);
    return [];
  }
}

async function chunkInsert(table, rows, chunkSize = 500) {
  if (!rows.length) return { inserted: 0, errors: [] };
  let inserted = 0;
  const errors = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error, count } = await supabase
      .from(table)
      .upsert(chunk, { onConflict: 'id', count: 'exact' });
    if (error) {
      errors.push({ chunkStart: i, message: error.message, details: error.details });
      console.error(`  ✗ ${table} chunk ${i}-${i + chunk.length}: ${error.message}`);
    } else {
      inserted += chunk.length;
      process.stdout.write(`  ✓ ${table}: ${inserted}/${rows.length}\r`);
    }
  }
  console.log('');
  return { inserted, errors };
}

function clean(obj, allowedKeys) {
  const result = {};
  for (const k of allowedKeys) {
    if (obj[k] !== undefined) result[k] = obj[k];
  }
  return result;
}

function dateOrNull(v) {
  if (!v) return null;
  if (typeof v === 'string' && v.length >= 10) return v.slice(0, 10);
  return null;
}

function numOrZero(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function intOrZero(v) {
  const n = parseInt(v, 10);
  return isNaN(n) ? 0 : n;
}

// ---------- transformers (match SQL schema) ----------
const transformers = {
  users: row => ({
    id: row.id,
    name: row.name,
    username: row.username,
    phone: row.phone || null,
    role: row.role || 'tech',
    color: row.color || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  }),

  customers: row => ({
    id: row.id,
    name: row.name || '(unnamed)',
    company: row.company || null,
    phone: row.phone || null,
    phone_home: row.phone_home || null,
    phone_work: row.phone_work || null,
    email: row.email || null,
    address: row.address || null,
    city: row.city || null,
    state: row.state || null,
    zip: row.zip || null,
    notes: row.notes || null,
    imported_from: row.imported_from || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  }),

  properties: row => ({
    id: row.id,
    customer_id: row.customer_id || null,
    address: row.address || null,
    city: row.city || null,
    state: row.state || null,
    zip: row.zip || null,
    county: row.county || null,
    company: row.company || null,
    notes: row.notes || null,
    imported_from: row.imported_from || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  }),

  tank_types: row => ({
    id: row.id,
    name: row.name,
    waste_code: row.waste_code || null,
    disposal_label: row.disposal_label || null,
    pumping_price: numOrZero(row.pumping_price),
    disposal_price: numOrZero(row.disposal_price),
    generates_disposal: row.generates_disposal !== false,
    sort_order: intOrZero(row.sort_order)
  }),

  tanks: row => ({
    id: row.id,
    property_id: row.property_id || null,
    tank_type: row.tank_type || null,
    volume_gallons: intOrZero(row.volume_gallons),
    imported_from: row.imported_from || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  }),

  vehicles: row => ({
    id: row.id,
    name: row.name,
    capacity_gallons: intOrZero(row.capacity_gallons),
    color: row.color || null,
    default_tech_id: row.default_tech_id || null,
    plate: row.plate || null,
    vin: row.vin || null,
    waste_hauler_id: row.waste_hauler_id || null,
    date_in_service: dateOrNull(row.date_in_service),
    sort_order: intOrZero(row.sort_order),
    created_at: row.created_at,
    updated_at: row.updated_at
  }),

  truck_day_assignments: row => ({
    id: row.id,
    vehicle_id: row.vehicle_id,
    user_id: row.user_id || null,
    date: dateOrNull(row.date),
    created_at: row.created_at,
    updated_at: row.updated_at
  }),

  invoices: row => ({
    id: row.id,
    invoice_number: row.invoice_number || null,
    customer_id: row.customer_id || null,
    customer_name: row.customer_name || null,
    billing_company: row.billing_company || null,
    billing_city: row.billing_city || null,
    property_id: row.property_id || null,
    property_company: row.property_company || null,
    property_address: row.property_address || null,
    property_city: row.property_city || null,
    svc_date: dateOrNull(row.svc_date),
    total: numOrZero(row.total),
    amount_paid: numOrZero(row.amount_paid),
    status: row.status || null,
    payment_status: row.payment_status || null,
    payment_method: row.payment_method || null,
    payment_due_date: dateOrNull(row.payment_due_date),
    products_services: row.products_services || null,
    product_sales: numOrZero(row.product_sales),
    quantity: row.quantity ? String(row.quantity) : null,
    unit_cost: row.unit_cost ? String(row.unit_cost) : null,
    technician: row.technician || null,
    tech_notes: row.tech_notes || null,
    job_notes: row.job_notes || null,
    job_codes: row.job_codes || null,
    gallons_pumped_total: intOrZero(row.gallons_pumped_total),
    truck: row.truck || null,
    tank_type: row.tank_type || null,
    tank_size: intOrZero(row.tank_size),
    waste_manifest: row.waste_manifest || null,
    waste_site: row.waste_site || null,
    disposal_date: dateOrNull(row.disposal_date),
    check_numbers: row.check_numbers || null,
    complete: row.complete === true,
    waiting_area: row.waiting_area === true,
    cancelled: row.cancelled === true,
    imported_from: row.imported_from || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  }),

  schedule_items: row => ({
    id: row.id,
    scheduled_date: dateOrNull(row.scheduled_date || row.date),
    customer_id: row.customer_id || null,
    property_id: row.property_id || null,
    tank_id: row.tank_id || null,
    vehicle_id: row.vehicle_id || null,
    assigned_user_id: row.assigned_user_id || row.user_id || null,
    service_type: row.service_type || null,
    notes: row.notes || null,
    status: row.status || 'scheduled',
    sort_order: intOrZero(row.sort_order),
    estimated_gallons: row.estimated_gallons || null,
    invoice_id: row.invoice_id || null,
    completed_at: row.completed_at || null,
    completed_by: row.completed_by || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  }),

  jobs: row => ({
    id: row.id,
    scheduled_date: dateOrNull(row.scheduled_date || row.date),
    customer_id: row.customer_id || null,
    property_id: row.property_id || null,
    tank_id: row.tank_id || null,
    vehicle_id: row.vehicle_id || null,
    assigned_user_id: row.assigned_user_id || row.user_id || null,
    notes: row.notes || null,
    status: row.status || 'scheduled',
    data: row,  // catch-all
    created_at: row.created_at,
    updated_at: row.updated_at
  }),

  payments: row => ({
    id: row.id,
    customer_id: row.customer_id || null,
    invoice_id: row.invoice_id || null,
    date: dateOrNull(row.date),
    amount: numOrZero(row.amount),
    method: row.method || null,
    reference: row.reference || null,
    notes: row.notes || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  }),

  disposal_loads: row => ({
    id: row.id,
    date: dateOrNull(row.date),
    vehicle_id: row.vehicle_id || null,
    user_id: row.user_id || null,
    waste_site: row.waste_site || null,
    manifest_number: row.manifest_number || null,
    gallons: intOrZero(row.gallons),
    notes: row.notes || null,
    data: row,
    created_at: row.created_at,
    updated_at: row.updated_at
  }),

  day_notes: row => ({
    id: row.id,
    date: dateOrNull(row.date),
    note: row.note || row.notes || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  }),

  reminders: row => ({
    id: row.id,
    customer_id: row.customer_id || null,
    property_id: row.property_id || null,
    due_date: dateOrNull(row.due_date || row.date),
    message: row.message || row.note || null,
    resolved: row.resolved === true,
    created_at: row.created_at,
    updated_at: row.updated_at
  }),

  service_due_notices: row => ({
    id: row.id,
    customer_id: row.customer_id || null,
    property_id: row.property_id || null,
    tank_id: row.tank_id || null,
    due_date: dateOrNull(row.due_date),
    status: row.status || null,
    data: row,
    created_at: row.created_at,
    updated_at: row.updated_at
  })
};

// ---------- migration order (respects FK dependencies) ----------
const tables = [
  { name: 'users', file: 'users.json' },
  { name: 'customers', file: 'customers.json' },
  { name: 'properties', file: 'properties.json' },
  { name: 'tank_types', file: 'tank_types.json' },
  { name: 'tanks', file: 'tanks.json' },
  { name: 'vehicles', file: 'vehicles.json' },
  { name: 'truck_day_assignments', file: 'truck_day_assignments.json' },
  { name: 'invoices', file: 'invoices.json' },
  { name: 'schedule_items', file: 'schedule_items.json' },
  { name: 'jobs', file: 'jobs.json' },
  { name: 'payments', file: 'payments.json' },
  { name: 'disposal_loads', file: 'disposal_loads.json' },
  { name: 'day_notes', file: 'day_notes.json' },
  { name: 'reminders', file: 'reminders.json' },
  { name: 'service_due_notices', file: 'service_due_notices.json' }
];

// ---------- main ----------
async function main() {
  console.log('Interstate Septic — JSON → Supabase migration');
  console.log('URL:', config.url);
  console.log('Mode:', APPLY ? 'APPLY' : 'DRY RUN');
  if (TRUNCATE) console.log('Truncate: YES (will clear tables before insert)');
  if (ONLY.length) console.log('Only:', ONLY.join(', '));
  console.log('');

  // Verify connection
  const { error: pingError } = await supabase.from('users').select('id').limit(1);
  if (pingError && pingError.message.includes('relation "public.users" does not exist')) {
    console.error('✗ Schema not found. Run supabase/migrations/0001_initial_schema.sql in the Supabase SQL Editor first.');
    process.exit(1);
  }
  if (pingError) {
    console.error('✗ Cannot connect:', pingError.message);
    process.exit(1);
  }
  console.log('✓ Connected to Supabase\n');

  const results = [];
  for (const { name, file } of tables) {
    if (ONLY.length && !ONLY.includes(name)) continue;

    const rawRows = readJson(file);
    const transformer = transformers[name];
    if (!transformer) {
      console.log(`  → ${name}: skipped (no transformer)`);
      continue;
    }
    const rows = rawRows
      .filter(r => r && r.id)  // require id
      .map(transformer);

    console.log(`Table: ${name} — ${rows.length} records from ${file}`);

    if (!APPLY) {
      results.push({ table: name, rows: rows.length, applied: false });
      continue;
    }

    if (!rows.length) {
      console.log('  (empty, skipping)\n');
      continue;
    }

    if (TRUNCATE) {
      const { error: delError } = await supabase.from(name).delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (delError) {
        console.warn(`  ⚠ truncate failed: ${delError.message}`);
      }
    }

    const { inserted, errors } = await chunkInsert(name, rows);
    results.push({ table: name, rows: rows.length, inserted, errors: errors.length });
    console.log('');
  }

  console.log('\n=== SUMMARY ===');
  console.table(results);

  if (!APPLY) {
    console.log('\nThis was a DRY RUN. To actually push data, re-run with --apply');
  }
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
