// One-shot import: parses the legacy InterstateCustomersWorkOrders CSV
// into work_order_history.json so the app can show prior-software history
// on each customer detail page.
//
// Each CSV row becomes one work order. The script also tries to match
// each row's CustomerName to an existing customer in customers.json (by
// normalized name) and stamps `matched_customer_id` on the row. Unmatched
// rows are still searchable in the History page.
//
// Run with: node scripts/import-work-order-history.js [path-to-csv]
// Default CSV path: C:/Users/thefi/Desktop/InterstateCustomersWorkOrders.csv

const fs = require('fs');
const path = require('path');

const DATA = 'C:/Users/thefi/AppData/Roaming/interstate-septic-manager/data';
const CSV_PATH = process.argv[2] ||
  'C:/Users/thefi/Desktop/InterstateCustomersWorkOrders.csv';

if (!fs.existsSync(CSV_PATH)) {
  console.error('CSV not found at', CSV_PATH);
  process.exit(1);
}
if (!fs.existsSync(DATA)) {
  console.error('Data directory not found at', DATA);
  process.exit(1);
}

console.log('Reading CSV from', CSV_PATH);
const txt = fs.readFileSync(CSV_PATH, 'utf8');
console.log('CSV size:', (txt.length / 1024 / 1024).toFixed(2), 'MB');

// ---------- CSV parser (handles quoted fields with embedded newlines/commas/quotes) ----------
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuote = false; }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuote = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\r') {
        // ignore
      } else if (c === '\n') {
        row.push(field); field = '';
        rows.push(row); row = [];
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

console.log('Parsing CSV...');
const t0 = Date.now();
const rows = parseCsv(txt);
console.log('Parsed', rows.length, 'rows in', ((Date.now() - t0) / 1000).toFixed(1), 's');

const header = rows.shift();
const idx = {};
header.forEach((h, i) => { idx[h] = i; });

// Required columns
const required = [
  'CustomerID', 'CustomerName', 'CustomerPhone', 'CustomerEmail',
  'JobAddress', 'WorkOrderID', 'ScheduleDate', 'ScheduledTime',
  'JobDescription', 'TaskType', 'JobStatus', 'JobComments',
  'PlannedGallons', 'TankLocation', 'DisposalSite', 'DisposalAmount',
  'MaterialDescription'
];
for (const col of required) {
  if (idx[col] === undefined) {
    console.error('Missing column:', col);
    process.exit(1);
  }
}

// ---------- Load existing customers for matching ----------
const customersPath = path.join(DATA, 'customers.json');
const customers = fs.existsSync(customersPath)
  ? JSON.parse(fs.readFileSync(customersPath, 'utf8'))
  : [];
console.log('Loaded', customers.length, 'existing customers for matching');

const norm = (s) =>
  (s || '').toString().trim().toLowerCase()
    .replace(/[.,;"'`]/g, '')
    .replace(/\s+/g, ' ');

// Build name index on existing customers
const custByName = new Map();
for (const c of customers) {
  const k = norm(c.name);
  if (!k) continue;
  if (!custByName.has(k)) custByName.set(k, c.id);
  // Also try common variations: "LAST FIRST" ↔ "FIRST LAST"
  const parts = k.split(' ');
  if (parts.length === 2) {
    const swapped = parts[1] + ' ' + parts[0];
    if (!custByName.has(swapped)) custByName.set(swapped, c.id);
  }
}

const NULLISH = new Set(['NULL', 'null', '', undefined, null]);
const cleanField = (v) => {
  if (NULLISH.has(v)) return null;
  const s = String(v).trim();
  return s.length === 0 || s === 'NULL' ? null : s;
};
const cleanNum = (v) => {
  const c = cleanField(v);
  if (c === null) return null;
  const n = Number(c);
  return Number.isFinite(n) ? n : null;
};

// ---------- Transform rows ----------
console.log('Transforming rows...');
const orders = [];
const customerStats = new Map(); // legacy_customer_id -> { name, address, phone, email, count }
let matchedCount = 0;

for (const r of rows) {
  if (r.length < header.length) continue; // malformed/blank row
  const legacyCustomerId = cleanField(r[idx['CustomerID']]);
  const customerName = cleanField(r[idx['CustomerName']]);
  if (!legacyCustomerId && !customerName) continue;

  const phone = cleanField(r[idx['CustomerPhone']]);
  const email = cleanField(r[idx['CustomerEmail']]);
  const address = cleanField(r[idx['JobAddress']]);
  const nameNorm = norm(customerName);
  const matchedId = nameNorm ? (custByName.get(nameNorm) || null) : null;
  if (matchedId) matchedCount++;

  const order = {
    legacy_work_order_id: cleanField(r[idx['WorkOrderID']]),
    legacy_customer_id: legacyCustomerId,
    customer_name: customerName,
    customer_name_norm: nameNorm,
    customer_phone: phone,
    customer_email: email,
    job_address: address,
    scheduled_date: cleanField(r[idx['ScheduleDate']]),
    scheduled_time: cleanField(r[idx['ScheduledTime']]),
    job_description: cleanField(r[idx['JobDescription']]),
    task_type: cleanField(r[idx['TaskType']]),
    job_status: cleanField(r[idx['JobStatus']]),
    job_comments: cleanField(r[idx['JobComments']]),
    planned_gallons: cleanNum(r[idx['PlannedGallons']]),
    tank_location: cleanField(r[idx['TankLocation']]),
    disposal_site: cleanField(r[idx['DisposalSite']]),
    disposal_amount: cleanNum(r[idx['DisposalAmount']]),
    material_description: cleanField(r[idx['MaterialDescription']]),
    matched_customer_id: matchedId,
  };
  orders.push(order);

  // Track unique customers
  const key = legacyCustomerId || nameNorm;
  if (!customerStats.has(key)) {
    customerStats.set(key, {
      legacy_customer_id: legacyCustomerId,
      name: customerName,
      name_norm: nameNorm,
      phone, email,
      address,
      count: 0,
      matched_customer_id: matchedId,
      first_date: order.scheduled_date,
      last_date: order.scheduled_date,
    });
  }
  const stat = customerStats.get(key);
  stat.count++;
  if (order.scheduled_date) {
    if (!stat.first_date || order.scheduled_date < stat.first_date) stat.first_date = order.scheduled_date;
    if (!stat.last_date || order.scheduled_date > stat.last_date) stat.last_date = order.scheduled_date;
  }
}

console.log('Total work orders:', orders.length);
console.log('Unique legacy customers:', customerStats.size);
console.log('Rows matched to current customers:', matchedCount, '(' + (100 * matchedCount / orders.length).toFixed(1) + '%)');
const matchedCust = [...customerStats.values()].filter(c => c.matched_customer_id).length;
console.log('Unique legacy customers matched:', matchedCust, '/', customerStats.size);

// ---------- Backup existing files if present ----------
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const targets = ['work_order_history.json', 'work_order_history_customers.json'];
for (const f of targets) {
  const p = path.join(DATA, f);
  if (fs.existsSync(p)) {
    const bak = path.join(DATA, f.replace('.json', '.backup_' + ts + '.json'));
    fs.copyFileSync(p, bak);
    console.log('Backed up', f, '→', path.basename(bak));
  }
}

// ---------- Write output files ----------
const customersOut = [...customerStats.values()].sort((a, b) =>
  (a.name || '').localeCompare(b.name || ''));

const ordersPath = path.join(DATA, 'work_order_history.json');
const customersOutPath = path.join(DATA, 'work_order_history_customers.json');

fs.writeFileSync(ordersPath, JSON.stringify(orders));
fs.writeFileSync(customersOutPath, JSON.stringify(customersOut));

const ordersMb = (fs.statSync(ordersPath).size / 1024 / 1024).toFixed(2);
const customersMb = (fs.statSync(customersOutPath).size / 1024 / 1024).toFixed(2);
console.log('Wrote', ordersPath, '(' + ordersMb + ' MB)');
console.log('Wrote', customersOutPath, '(' + customersMb + ' MB)');
console.log('Done.');
