// Seed script: Generate test jobs for March 14, 2026
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const dataDir = path.join(require('os').homedir(), 'AppData', 'Roaming', 'interstate-septic-manager', 'data');

function read(name) {
  const p = path.join(dataDir, name + '.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : [];
}
function write(name, data) {
  fs.writeFileSync(path.join(dataDir, name + '.json'), JSON.stringify(data, null, 2));
}

const vehicles = read('vehicles');
const users = read('users');
const driverId = users[0]?.id || '';

// Maine names and addresses for test data
const testCustomers = [
  { name: 'Robert & Linda Thompson', address: '42 Ocean View Dr', city: 'Rockport', state: 'ME', zip: '04856', phone: '(207) 236-4521' },
  { name: 'James & Patricia Williams', address: '18 Pine Ridge Rd', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 236-8834' },
  { name: 'Michael & Susan Davis', address: '7 Harbor Hill Ln', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 594-2217' },
  { name: 'William & Mary Johnson', address: '155 West St', city: 'Rockport', state: 'ME', zip: '04856', phone: '(207) 236-6643' },
  { name: 'Richard & Barbara Anderson', address: '23 Spruce Head Rd', city: 'South Thomaston', state: 'ME', zip: '04858', phone: '(207) 354-8876' },
  { name: 'Thomas & Jennifer Martin', address: '89 Bay View St', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 230-1155' },
  { name: 'Charles & Elizabeth Wilson', address: '310 Commercial St', city: 'Rockport', state: 'ME', zip: '04856', phone: '(207) 236-7729' },
  { name: 'Joseph & Margaret Taylor', address: '5 Mechanic St', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 594-3348' },
  { name: 'David & Nancy Brown', address: '67 Cline Rd', city: 'Spruce Head', state: 'ME', zip: '04859', phone: '(207) 594-5567' },
  { name: 'Daniel & Karen Moore', address: '14 Beechwood St', city: 'Thomaston', state: 'ME', zip: '04861', phone: '(207) 354-2234' },
  { name: 'Mark & Sandra Jackson', address: '201 Main St', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 596-7781' },
  { name: 'Paul & Betty White', address: '38 Lawn Ave', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 593-2119' },
  { name: 'Donald & Dorothy Harris', address: '12 Granite St', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 596-3345' },
  { name: 'Steven & Carol Clark', address: '77 Russell Ave', city: 'Rockport', state: 'ME', zip: '04856', phone: '(207) 236-8851' },
  { name: 'Edward & Ruth Lewis', address: '4 Elm St', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 236-4498' },
  { name: 'George & Sharon Robinson', address: '56 Washington St', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 230-0423' },
  { name: 'Kenneth & Helen Walker', address: '93 Old County Rd', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 594-8812' },
  { name: 'Brian & Diane Young', address: '28 Waldo Ave', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 596-2256' },
  { name: 'Ronald & Laura King', address: '11 Mountain St', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 236-9934' },
  { name: 'Anthony & Deborah Scott', address: '45 Park St', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 594-1178' },
  { name: 'Kevin & Cynthia Green', address: '162 Limerock St', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 596-4456' },
  { name: 'Jason & Angela Adams', address: '8 Sea St', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 230-7712' },
  { name: 'Jeff & Melissa Baker', address: '34 Gurney St', city: 'Rockport', state: 'ME', zip: '04856', phone: '(207) 236-5543' },
  { name: 'Gary & Stephanie Nelson', address: '19 Cross St', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 236-1187' },
  { name: 'Timothy & Rebecca Carter', address: '72 Pearl St', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 236-6621' },
  { name: 'Larry & Janet Mitchell', address: '105 Rankin St', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 594-6634' },
  { name: 'Frank & Virginia Perez', address: '21 Trim St', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 236-3398' },
  { name: 'Scott & Pamela Roberts', address: '6 Glen Cove Dr', city: 'Rockport', state: 'ME', zip: '04856', phone: '(207) 236-4272' },
  { name: 'Raymond & Christine Turner', address: '83 Union St', city: 'Rockport', state: 'ME', zip: '04856', phone: '(207) 236-8814' },
  { name: 'Gregory & Marie Phillips', address: '47 Pleasant St', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 594-9923' },
  { name: 'Patrick & Lisa Campbell', address: '29 Summer St', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 596-3317' },
  { name: 'Jerry & Brenda Parker', address: '15 Knowlton St', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 236-2245' },
  { name: 'Dennis & Amy Evans', address: '51 Chestnut St', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 230-5578' },
  { name: 'Peter & Kathleen Edwards', address: '3 Winter St', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 594-7741' },
  { name: 'Harold & Carolyn Collins', address: '68 Belmont Ave', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 236-0094' },
  { name: 'Douglas & Cheryl Stewart', address: '37 Warrenton St', city: 'Rockport', state: 'ME', zip: '04856', phone: '(207) 236-1176' },
  { name: 'Henry & Jean Sanchez', address: '22 Maple St', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 542-6523' },
  { name: 'Carl & Teresa Morris', address: '91 Camden St', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 594-2289' },
  { name: 'Arthur & Ann Rogers', address: '16 Free St', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 236-7754' },
  { name: 'Ryan & Julie Reed', address: '44 Broadway', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 596-8843' },
  { name: 'Roger & Kathryn Cook', address: '10 Winding Way', city: 'Rockport', state: 'ME', zip: '04856', phone: '(207) 701-1491' },
  { name: 'Ralph & Donna Morgan', address: '58 High St', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 236-5521' },
  { name: 'Nicholas & Martha Bell', address: '33 Bayview St', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 230-3346' },
  { name: 'Wayne & Frances Murphy', address: '70 Rockville St', city: 'Rockport', state: 'ME', zip: '04856', phone: '(207) 236-9987' },
  { name: 'Bruce & Judith Bailey', address: '124 Park Dr', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 594-4456' },
  { name: 'Eugene & Janice Rivera', address: '9 Union St', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 236-8832' },
  { name: 'Roy & Diane Cooper', address: '41 Mechanic St', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 230-2278' },
  { name: 'Philip & Gloria Richardson', address: '87 Talbot Ave', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 594-5598' },
];

const tankTypes = ['Septic', 'Septic', 'Septic', 'Grease Trap', 'Holding Tank', 'Cesspool'];
const tankVolumes = [500, 750, 1000, 1000, 1000, 1200, 1500, 2000];
const confirmStatuses = ['confirmed', 'confirmed', 'confirmed', 'auto_confirmed', 'no_reply', 'unconfirmed', 'left_message'];
const services = ['Septic Pumping', 'Septic Pumping', 'Septic Pumping', 'Grease Trap Cleaning', 'Holding Tank Pump', 'Septic Inspection'];

let customers = read('customers');
let properties = read('properties');
let tanks = read('tanks');
let jobs = read('jobs');

// Remove existing test jobs for March 14
jobs = jobs.filter(j => j.scheduled_date !== '2026-03-14' || !j._test_data);

let custIdx = 0;
const pumpTrucks = vehicles.filter(v => v.capacity_gallons > 0); // Only pump trucks

// Service categories for line items
const serviceCategories = read('service_categories');
const defaultCatId = serviceCategories.length > 0 ? serviceCategories[0].id : '';

pumpTrucks.forEach((truck, truckIdx) => {
  const numJobs = 6 + Math.floor(Math.random() * 3); // 6-8

  for (let j = 0; j < numJobs; j++) {
    if (custIdx >= testCustomers.length) custIdx = 0;
    const tc = testCustomers[custIdx++];

    // Create or find customer
    let cust = customers.find(c => c.name === tc.name);
    if (!cust) {
      cust = {
        id: uuidv4(),
        name: tc.name,
        phone: tc.phone,
        email: '',
        created_at: new Date().toISOString(),
      };
      customers.push(cust);
    }

    // Create or find property
    let prop = properties.find(p => p.customer_id === cust.id && p.address === tc.address);
    if (!prop) {
      prop = {
        id: uuidv4(),
        customer_id: cust.id,
        address: tc.address,
        city: tc.city,
        state: tc.state,
        zip: tc.zip,
        type: 'Residence',
        created_at: new Date().toISOString(),
      };
      properties.push(prop);
    }

    // Create tank if not exists
    let tank = tanks.find(t => t.property_id === prop.id);
    if (!tank) {
      const tType = tankTypes[Math.floor(Math.random() * tankTypes.length)];
      const tVol = tankVolumes[Math.floor(Math.random() * tankVolumes.length)];
      tank = {
        id: uuidv4(),
        property_id: prop.id,
        tank_type: tType,
        volume_gallons: tVol,
        material: 'Concrete',
        notes: '',
        created_at: new Date().toISOString(),
      };
      tanks.push(tank);
    }

    // Generate a time slot
    const hour = 7 + j; // 7am, 8am, etc.
    const time = `${String(hour).padStart(2, '0')}:00`;

    const confStatus = confirmStatuses[Math.floor(Math.random() * confirmStatuses.length)];
    const service = services[Math.floor(Math.random() * services.length)];

    const job = {
      id: uuidv4(),
      customer_id: cust.id,
      property_id: prop.id,
      vehicle_id: truck.id,
      assigned_to: driverId,
      scheduled_date: '2026-03-14',
      scheduled_time: time,
      status: 'scheduled',
      confirmation_status: confStatus,
      service_type: service,
      sort_order: j * 10,
      notes: '',
      helpers: [],
      gallons_pumped: {},
      line_items: [],
      invoice_number: String(7500 + (truckIdx * 10) + j),
      _test_data: true,
      created_at: new Date().toISOString(),
    };

    jobs.push(job);
  }
});

// Write everything back
write('customers', customers);
write('properties', properties);
write('tanks', tanks);
write('jobs', jobs);

console.log(`Seeded ${pumpTrucks.length} trucks with test jobs for 2026-03-14`);
console.log(`Total jobs on March 14: ${jobs.filter(j => j.scheduled_date === '2026-03-14').length}`);
