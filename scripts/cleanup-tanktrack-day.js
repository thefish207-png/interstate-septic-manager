// Removes all data injected by inject-tanktrack-day.js.
// Deletes jobs, temp customers, and temp properties tagged
// with imported_from: 'tanktrack_day_test'.
//
// Run: node scripts/cleanup-tanktrack-day.js

const fs = require('fs');
const DATA = 'C:/Users/thefi/AppData/Roaming/interstate-septic-manager/data';
const TAG = 'tanktrack_day_test';

let customers  = JSON.parse(fs.readFileSync(DATA + '/customers.json',  'utf8'));
let properties = JSON.parse(fs.readFileSync(DATA + '/properties.json', 'utf8'));
let jobs       = JSON.parse(fs.readFileSync(DATA + '/jobs.json',       'utf8'));

const beforeJobs  = jobs.length;
const beforeCusts = customers.length;
const beforeProps = properties.length;

jobs       = jobs.filter(j  => j.imported_from  !== TAG);
customers  = customers.filter(c  => c.imported_from  !== TAG);
properties = properties.filter(p  => p.imported_from !== TAG);

fs.writeFileSync(DATA + '/customers.json',  JSON.stringify(customers,  null, 2));
fs.writeFileSync(DATA + '/properties.json', JSON.stringify(properties, null, 2));
fs.writeFileSync(DATA + '/jobs.json',       JSON.stringify(jobs,       null, 2));

console.log('✓ Cleanup complete');
console.log('  Jobs removed:       ', beforeJobs  - jobs.length);
console.log('  Customers removed:  ', beforeCusts - customers.length);
console.log('  Properties removed: ', beforeProps - properties.length);
