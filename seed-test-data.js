// The addresses below are invented and must stay that way. They used to be
// real streets from the book, in a public repository, sitting under names
// that were made up - which made the file look safe when it was not.
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
  { name: 'Test Household 1', address: '1 Sample Ridge Way', city: 'Rockport', state: 'ME', zip: '04856', phone: '(207) 236-4521' },
  { name: 'Test Household 2', address: '2 Sample Ridge Way', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 236-8834' },
  { name: 'Test Household 3', address: '3 Sample Ridge Way', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 594-2217' },
  { name: 'Test Household 4', address: '4 Sample Ridge Way', city: 'Rockport', state: 'ME', zip: '04856', phone: '(207) 236-6643' },
  { name: 'Test Household 5', address: '5 Sample Ridge Way', city: 'South Thomaston', state: 'ME', zip: '04858', phone: '(207) 354-8876' },
  { name: 'Test Household 6', address: '6 Sample Ridge Way', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 230-1155' },
  { name: 'Test Household 7', address: '7 Sample Ridge Way', city: 'Rockport', state: 'ME', zip: '04856', phone: '(207) 236-7729' },
  { name: 'Test Household 8', address: '8 Sample Ridge Way', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 594-3348' },
  { name: 'Test Household 9', address: '9 Sample Ridge Way', city: 'Spruce Head', state: 'ME', zip: '04859', phone: '(207) 594-5567' },
  { name: 'Test Household 10', address: '10 Sample Ridge Way', city: 'Thomaston', state: 'ME', zip: '04861', phone: '(207) 354-2234' },
  { name: 'Test Household 11', address: '11 Sample Ridge Way', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 596-7781' },
  { name: 'Test Household 12', address: '12 Sample Ridge Way', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 593-2119' },
  { name: 'Test Household 13', address: '13 Sample Ridge Way', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 596-3345' },
  { name: 'Test Household 14', address: '14 Sample Ridge Way', city: 'Rockport', state: 'ME', zip: '04856', phone: '(207) 236-8851' },
  { name: 'Test Household 15', address: '15 Sample Ridge Way', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 236-4498' },
  { name: 'Test Household 16', address: '16 Sample Ridge Way', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 230-0423' },
  { name: 'Test Household 17', address: '17 Sample Ridge Way', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 594-8812' },
  { name: 'Test Household 18', address: '18 Sample Ridge Way', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 596-2256' },
  { name: 'Test Household 19', address: '19 Sample Ridge Way', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 236-9934' },
  { name: 'Test Household 20', address: '20 Sample Ridge Way', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 594-1178' },
  { name: 'Test Household 21', address: '21 Sample Ridge Way', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 596-4456' },
  { name: 'Test Household 22', address: '22 Sample Ridge Way', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 230-7712' },
  { name: 'Test Household 23', address: '23 Sample Ridge Way', city: 'Rockport', state: 'ME', zip: '04856', phone: '(207) 236-5543' },
  { name: 'Test Household 24', address: '24 Sample Ridge Way', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 236-1187' },
  { name: 'Test Household 25', address: '25 Sample Ridge Way', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 236-6621' },
  { name: 'Test Household 26', address: '26 Sample Ridge Way', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 594-6634' },
  { name: 'Test Household 27', address: '27 Sample Ridge Way', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 236-3398' },
  { name: 'Test Household 28', address: '28 Sample Ridge Way', city: 'Rockport', state: 'ME', zip: '04856', phone: '(207) 236-4272' },
  { name: 'Test Household 29', address: '29 Sample Ridge Way', city: 'Rockport', state: 'ME', zip: '04856', phone: '(207) 236-8814' },
  { name: 'Test Household 30', address: '30 Sample Ridge Way', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 594-9923' },
  { name: 'Test Household 31', address: '31 Sample Ridge Way', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 596-3317' },
  { name: 'Test Household 32', address: '32 Sample Ridge Way', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 236-2245' },
  { name: 'Test Household 33', address: '33 Sample Ridge Way', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 230-5578' },
  { name: 'Test Household 34', address: '34 Sample Ridge Way', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 594-7741' },
  { name: 'Test Household 35', address: '35 Sample Ridge Way', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 236-0094' },
  { name: 'Test Household 36', address: '36 Sample Ridge Way', city: 'Rockport', state: 'ME', zip: '04856', phone: '(207) 236-1176' },
  { name: 'Test Household 37', address: '37 Sample Ridge Way', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 542-6523' },
  { name: 'Test Household 38', address: '38 Sample Ridge Way', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 594-2289' },
  { name: 'Test Household 39', address: '39 Sample Ridge Way', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 236-7754' },
  { name: 'Test Household 40', address: '40 Sample Ridge Way', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 596-8843' },
  { name: 'Test Household 41', address: '41 Sample Ridge Way', city: 'Rockport', state: 'ME', zip: '04856', phone: '(207) 701-1491' },
  { name: 'Test Household 42', address: '42 Sample Ridge Way', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 236-5521' },
  { name: 'Test Household 43', address: '43 Sample Ridge Way', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 230-3346' },
  { name: 'Test Household 44', address: '44 Sample Ridge Way', city: 'Rockport', state: 'ME', zip: '04856', phone: '(207) 236-9987' },
  { name: 'Test Household 45', address: '45 Sample Ridge Way', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 594-4456' },
  { name: 'Test Household 46', address: '46 Sample Ridge Way', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 236-8832' },
  { name: 'Test Household 47', address: '47 Sample Ridge Way', city: 'Camden', state: 'ME', zip: '04843', phone: '(207) 230-2278' },
  { name: 'Test Household 48', address: '48 Sample Ridge Way', city: 'Rockland', state: 'ME', zip: '04841', phone: '(207) 594-5598' },
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
