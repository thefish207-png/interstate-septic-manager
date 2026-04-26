// One-shot merge: populates emails, phones, and tanks from the TankTrack
// customer XLSX into the existing customers.json / properties.json / tanks.json.
// Creates timestamped backups of all three files first.
//
// Run with: node scripts/merge-tanktrack-xlsx.js "<path to xlsx>"
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const xlsx = require('../node_modules/xlsx');

const uuid = () => crypto.randomUUID();
const DATA = 'C:/Users/thefi/AppData/Roaming/interstate-septic-manager/data';
const XLSX_PATH = process.argv[2] ||
  'C:/Users/thefi/Desktop/TankTrack Backup File 2026-04-22 (1)2222222222222222222222222222.xlsx';

// --- Backup first ---
const ts = new Date().toISOString().replace(/[:.]/g, '-');
for (const f of ['customers.json', 'properties.json', 'tanks.json']) {
  const src = path.join(DATA, f);
  const bak = path.join(DATA, f.replace('.json', '.backup_before_xlsx_merge_' + ts + '.json'));
  fs.copyFileSync(src, bak);
  console.log('Backed up', f, '→', path.basename(bak));
}

const wb = xlsx.readFile(XLSX_PATH);
const xlsxRows = xlsx.utils.sheet_to_json(wb.Sheets['Customers'], { defval: '' });

let customers = JSON.parse(fs.readFileSync(DATA + '/customers.json', 'utf8'));
let properties = JSON.parse(fs.readFileSync(DATA + '/properties.json', 'utf8'));
let tanks = JSON.parse(fs.readFileSync(DATA + '/tanks.json', 'utf8'));

const norm = (s) =>
  (s || '').toString().trim().toLowerCase().replace(/[.,;"']/g, '').replace(/\s+/g, ' ');

const normAddr = (s) =>
  norm(
    (s || '')
      .toString()
      .replace(/\brd\b/gi, 'road')
      .replace(/\bst\b/gi, 'street')
      .replace(/\bave\b/gi, 'avenue')
      .replace(/\bln\b/gi, 'lane')
      .replace(/\bdr\b/gi, 'drive')
      .replace(/\bhwy\b/gi, 'highway')
  );

// Build indexes
const custByName = new Map();
for (const c of customers) {
  const k = norm(c.name);
  if (!k) continue;
  if (!custByName.has(k)) custByName.set(k, c);
}

const propByAddr = new Map(); // key = customer_id + '|' + normalized address
for (const p of properties) {
  const k = (p.customer_id || '') + '|' + normAddr(p.address);
  if (!propByAddr.has(k)) propByAddr.set(k, p);
}

// Group XLSX rows by customer (First + Last Name)
const xlsxByCust = new Map();
for (const r of xlsxRows) {
  const name = ((r['First Name'] || '') + ' ' + (r['Last Name'] || '')).trim();
  if (!name) continue;
  const k = norm(name);
  if (!xlsxByCust.has(k)) xlsxByCust.set(k, { name, rows: [] });
  xlsxByCust.get(k).rows.push(r);
}

const now = new Date().toISOString();
const stats = { custUpdated: 0, custCreated: 0, propUpdated: 0, propCreated: 0, tanksCreated: 0 };

for (const [k, group] of xlsxByCust) {
  const firstRow = group.rows[0];
  const email = (firstRow.Email || '').toString().trim();
  const cell = (firstRow['Cell Phone'] || '').toString().trim();
  const home = (firstRow['Home Phone'] || '').toString().trim();
  const work = (firstRow['Work Phone'] || '').toString().trim();
  const contactNotes = (firstRow['Contact Notes[Private]'] || '').toString().trim();

  let cust = custByName.get(k);
  if (!cust) {
    // Create new customer (was in XLSX but not in DB — no prior invoice history)
    cust = {
      id: uuid(),
      name: group.name,
      company: (firstRow['Billing Company'] || '').toString().trim() || group.name,
      phone: cell || home || work,
      phone_cell: cell,
      phone_home: home,
      phone_work: work,
      email,
      address:
        (firstRow['Billing Address 1'] || '').toString().trim() ||
        (firstRow['Property Address 1'] || '').toString().trim(),
      city:
        (firstRow['Billing City'] || '').toString().trim() ||
        (firstRow['Property City'] || '').toString().trim(),
      state:
        (firstRow['Billing State'] || '').toString().trim() ||
        (firstRow['Property State'] || '').toString().trim(),
      zip:
        (firstRow['Billing Zip Code'] || '').toString().trim() ||
        (firstRow['Property Zip Code'] || '').toString().trim(),
      notes: contactNotes,
      imported_from: 'tanktrack_xlsx_merge',
      created_at: now,
      updated_at: now,
    };
    customers.push(cust);
    custByName.set(k, cust);
    stats.custCreated++;
  } else {
    // Fill in blank fields only — never overwrite existing data
    let changed = false;
    if (email && !(cust.email || '').trim()) { cust.email = email; changed = true; }
    if (cell && !cust.phone_cell) { cust.phone_cell = cell; changed = true; }
    if (home && !cust.phone_home) { cust.phone_home = home; changed = true; }
    if (work && !cust.phone_work) { cust.phone_work = work; changed = true; }
    if ((cell || home || work) && !(cust.phone || '').trim()) {
      cust.phone = cell || home || work;
      changed = true;
    }
    if (contactNotes && !(cust.notes || '').trim()) { cust.notes = contactNotes; changed = true; }
    if (changed) { cust.updated_at = now; stats.custUpdated++; }
  }

  // Each XLSX row is a property belonging to this customer
  for (const r of group.rows) {
    const addr = (r['Property Address 1'] || '').toString().trim();
    if (!addr) continue;

    const propKey = cust.id + '|' + normAddr(addr);
    let prop = propByAddr.get(propKey);

    // If no match under this customer, try a looser match: any property at this
    // address (covers the case where the property was rebuilt under a slightly
    // different customer_id than the XLSX customer would hash to).
    if (!prop) {
      for (const [kk, pp] of propByAddr) {
        if (kk.endsWith('|' + normAddr(addr))) { prop = pp; break; }
      }
    }

    const propFields = {
      address: addr,
      address2: (r['Property Address 2'] || '').toString().trim() || undefined,
      company: (r['Property Company'] || '').toString().trim() || undefined,
      city: (r['Property City'] || '').toString().trim(),
      state: (r['Property State'] || '').toString().trim(),
      zip: (r['Property Zip Code'] || '').toString().trim(),
      county: (r['Property County'] || '').toString().trim() || undefined,
      township: (r['Property Township'] || '').toString().trim() || undefined,
      parcel: (r['Property Parcel #'] || '').toString().trim() || undefined,
      permit: (r['Property Permit #'] || '').toString().trim() || undefined,
      directions: (r['Directions'] || '').toString().trim() || undefined,
      notes: (r['Property Notes'] || '').toString().trim() || undefined,
    };

    if (!prop) {
      prop = {
        id: uuid(),
        customer_id: cust.id,
        ...propFields,
        imported_from: 'tanktrack_xlsx_merge',
        created_at: now,
        updated_at: now,
      };
      for (const kk of Object.keys(prop)) if (prop[kk] === undefined) delete prop[kk];
      properties.push(prop);
      propByAddr.set(propKey, prop);
      stats.propCreated++;
    } else {
      // Relink to this customer if the property existed orphaned/under a different id
      if (prop.customer_id !== cust.id && !prop.customer_id) {
        prop.customer_id = cust.id;
      }
      let changed = false;
      for (const field of [
        'address2', 'company', 'city', 'state', 'zip',
        'county', 'township', 'parcel', 'permit', 'directions', 'notes',
      ]) {
        if (propFields[field] && !(prop[field] || '').toString().trim()) {
          prop[field] = propFields[field];
          changed = true;
        }
      }
      if (changed) { prop.updated_at = now; stats.propUpdated++; }
    }

    // Explode Tank 1 and Tank 2 columns into individual tank records
    for (let t = 1; t <= 2; t++) {
      const cap = r['Tank ' + t + ' Capacity'];
      const type = r['Tank ' + t + ' Type/Source'];
      if (!cap && !type) continue;
      const tank = {
        id: uuid(),
        property_id: prop.id,
        name: (r['Tank ' + t + ' Name'] || '').toString().trim() || undefined,
        tank_type: (type || '').toString().trim(),
        volume_gallons: parseInt(cap) || 0,
        has_filter: /yes|true/i.test((r['Tank ' + t + ' Filter?'] || '').toString()) || undefined,
        filter_type: (r['Tank ' + t + ' Filter Type'] || '').toString().trim() || undefined,
        depth: (r['Tank ' + t + ' Depth'] || '').toString().trim() || undefined,
        hose_length: (r['Tank ' + t + ' Hose Length'] || '').toString().trim() || undefined,
        has_riser: /yes|true/i.test((r['Tank ' + t + ' Riser?'] || '').toString()) || undefined,
        pump_frequency: parseInt(r['Tank ' + t + ' Pump Frequency']) || undefined,
        pump_frequency_unit: (r['Tank ' + t + ' Pump Frequency Unit'] || '').toString().trim() || undefined,
        notes: (r['Tank ' + t + ' Notes'] || '').toString().trim() || undefined,
        imported_from: 'tanktrack_xlsx_merge',
        created_at: now,
        updated_at: now,
      };
      for (const kk of Object.keys(tank)) if (tank[kk] === undefined) delete tank[kk];
      tanks.push(tank);
      stats.tanksCreated++;
    }
  }
}

fs.writeFileSync(DATA + '/customers.json', JSON.stringify(customers, null, 2));
fs.writeFileSync(DATA + '/properties.json', JSON.stringify(properties, null, 2));
fs.writeFileSync(DATA + '/tanks.json', JSON.stringify(tanks, null, 2));

console.log('');
console.log('===== IMPORT COMPLETE =====');
console.log('Customers updated (filled blank fields):', stats.custUpdated);
console.log('Customers created (new from XLSX):', stats.custCreated);
console.log('Properties updated:', stats.propUpdated);
console.log('Properties created:', stats.propCreated);
console.log('Tanks created:', stats.tanksCreated);
console.log('');
console.log('Final customers.json:', customers.length);
console.log('Final properties.json:', properties.length);
console.log('Final tanks.json:', tanks.length);
