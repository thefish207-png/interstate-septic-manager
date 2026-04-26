// Temporary injection of TankTrack April 23 schedule into ISM.
// Creates jobs (and any missing customers/properties) tagged with
// imported_from: 'tanktrack_day_test' so cleanup-tanktrack-day.js
// can remove everything in one shot.
// NO emails are triggered — job creation alone does not fire confirmations.
//
// Run: node scripts/inject-tanktrack-day.js
// Undo: node scripts/cleanup-tanktrack-day.js

const fs = require('fs');
const crypto = require('crypto');
const uuid = () => crypto.randomUUID();
const DATA = 'C:/Users/thefi/AppData/Roaming/interstate-septic-manager/data';
const TAG = 'tanktrack_day_test';
const DATE = '2026-04-23';
const now = new Date().toISOString();

let customers  = JSON.parse(fs.readFileSync(DATA + '/customers.json',  'utf8'));
let properties = JSON.parse(fs.readFileSync(DATA + '/properties.json', 'utf8'));
let jobs       = JSON.parse(fs.readFileSync(DATA + '/jobs.json',       'utf8'));

// ── Vehicle IDs ──────────────────────────────────────────────────────────────
const V_2016 = '129ebf19-b26d-4f62-894b-016ec624df63'; // 2016 Mack  4400g
const V_2014 = '140f1d5e-f640-462a-915a-c64af2f55ae2'; // 2014 Mack  4400g
const V_04KW = '0af2343a-04c4-4a3c-94bf-9daa0855c143'; // 2004 Kenworth 4200g

// ── Known customer/property IDs (matched above) ───────────────────────────────
const KNOWN = {
  'trina_johnson':       { cust: 'ca3a01f1-c05a-4778-94fe-fd6fbc381476', prop: '0adfe812-d666-4ef1-b570-25f9ea3d5646' },
  'rowland':             { cust: '29dad219-851f-4a0f-b902-2038d40cc7d1', prop: 'dd928716-34fc-4235-b095-773040e3642c' },
  'karen_beal':          { cust: 'e8bddcdf-9b10-4dff-986c-3665605ab826', prop: '819fe797-b168-4c88-a351-8a86655aab60' },
  'mcnichol':            { cust: 'd4b328ca-d57d-45c7-89cc-c77a2f35c02d', prop: '47795634-c533-4bf9-aed1-8337d2ce3f14' },
  'heller':              { cust: 'aaa2c9ce-2d02-41fc-88d4-202f7c8979df', prop: 'f7db38f8-baf6-4686-8833-85a9693d5a9b' },
  'brandt':              { cust: '8d3c53a3-f7d6-4a11-922b-16f78a43c07c', prop: '2abaa536-61d7-4bff-aea8-308d5313d14b' },
};

// ── Helper: find-or-create temp customer + property ───────────────────────────
// Each unique address gets its own property even if the customer name matches.
const custCache = new Map(); // name → custId
function tempCustProp(name, address, city, state, zip) {
  // Reuse customer if same name already created this run
  let custId = custCache.get(name);
  if (!custId) {
    const existing = customers.find(c => c.name === name && c.imported_from === TAG);
    custId = existing ? existing.id : uuid();
    if (!existing) {
      customers.push({
        id: custId, name, company: name, phone: '', email: '',
        address, city, state, zip,
        imported_from: TAG, created_at: now, updated_at: now,
      });
    }
    custCache.set(name, custId);
  }
  // Always create a unique property per address
  const propId = uuid();
  properties.push({
    id: propId, customer_id: custId,
    address, city, state, zip,
    imported_from: TAG, created_at: now, updated_at: now,
  });
  return { cust: custId, prop: propId };
}

// ── Build the schedule ─────────────────────────────────────────────────────────
// Each entry: { vehicle, name, address, city, gal, knownKey, notes, sortOrder }
// knownKey = key into KNOWN map (uses existing cust/prop), or null = create temp

const schedule = [
  // ── 2016 Mack ──
  { v: V_2016, known: 'trina_johnson', gal: 1000, sort: 10 },
  { v: V_2016, known: 'rowland',       gal: 1000, sort: 20 },
  { v: V_2016, known: 'karen_beal',    gal: 1000, sort: 30 },
  { v: V_2016, known: 'mcnichol',      gal: 1000, sort: 40 },

  // ── 2014 Mack ──
  {
    v: V_2014, gal: 750,  sort: 10,
    name: "Tops'1 Farm", address: '364 Bremen Rd', city: 'Waldoboro', state: 'ME', zip: '04572',
    notes: 'House & Cottage',
  },
  {
    v: V_2014, gal: 3000, sort: 20,
    name: "Tops'1 Farm", address: '365 Bremen Rd', city: 'Waldoboro', state: 'ME', zip: '04572',
    notes: 'Events Barn & Campground',
  },
  {
    v: V_2014, gal: 1000, sort: 30,
    name: "Tops'1 Farm", address: '661 Bremen Rd', city: 'Waldoboro', state: 'ME', zip: '04572-6147',
    notes: 'Cabin / Rental Property - call on way',
  },
  { v: V_2014, known: 'heller',  gal: 1000, sort: 40 },
  { v: V_2014, known: 'brandt',  gal: 750,  sort: 50 },

  // ── 2004 Kenworth ──
  {
    v: V_04KW, gal: 4200, sort: 10,
    name: 'North Haven Treatment Plant',
    address: 'North Haven Rd (AT TREATMENT PLANT)', city: 'North Haven', state: 'ME', zip: '04853',
    notes: '9:30 AM & 3:45 PM appointment',
  },
  {
    v: V_04KW, gal: 4200, sort: 20,
    name: 'North Haven Treatment Plant',
    address: 'North Haven Rd (AT TREATMENT PLANT)', city: 'North Haven', state: 'ME', zip: '04853',
    notes: 'Job #2 Disposal',
  },
];

// ── Inject jobs ────────────────────────────────────────────────────────────────
const created = [];
for (const entry of schedule) {
  let custId, propId;
  if (entry.known) {
    ({ cust: custId, prop: propId } = KNOWN[entry.known]);
  } else {
    ({ cust: custId, prop: propId } = tempCustProp(
      entry.name, entry.address, entry.city, entry.state, entry.zip, entry.gal
    ));
  }

  const job = {
    id: uuid(),
    customer_id: custId,
    property_id: propId,
    vehicle_id: entry.v,
    date: DATE,
    status: 'scheduled',
    gallons_quoted: entry.gal,
    notes: entry.notes || '',
    sort_order: entry.sort,
    dump_after: false,
    imported_from: TAG,
    created_at: now,
    updated_at: now,
  };
  jobs.push(job);
  created.push(job.id);
  console.log('  Created job:', entry.name || entry.known, '-', entry.gal + 'g');
}

// ── Save ───────────────────────────────────────────────────────────────────────
fs.writeFileSync(DATA + '/customers.json',  JSON.stringify(customers,  null, 2));
fs.writeFileSync(DATA + '/properties.json', JSON.stringify(properties, null, 2));
fs.writeFileSync(DATA + '/jobs.json',       JSON.stringify(jobs,       null, 2));

console.log('\n✓ Injected', created.length, 'jobs for', DATE);
console.log('  Run cleanup-tanktrack-day.js when done to remove all test data.');
