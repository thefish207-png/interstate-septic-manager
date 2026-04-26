// Comprehensive edge-case test suite for the Interstate Septic Manager cloud backend.
// Runs many scenarios against the real Supabase project and logs results.
// Output is collected into edge-case-results.md for human review.

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const ws = require('ws');
const cfg = JSON.parse(fs.readFileSync(path.join(require('os').homedir(), 'AppData/Roaming/interstate-septic-manager/supabase-config.json'), 'utf8'));

const RESULTS = [];
function log(section, name, status, details) {
  RESULTS.push({ section, name, status, details: details || '' });
  const emoji = status === 'PASS' ? '✓' : (status === 'FAIL' ? '✗' : '⚠');
  console.log(`${emoji} [${section}] ${name}: ${status}${details ? ' — ' + details : ''}`);
}

async function withClient(email) {
  const c = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false, storageKey: email } });
  const { error } = await c.auth.signInWithPassword({ email, password: 'Issi5646' });
  if (error) throw new Error('login failed for ' + email + ': ' + error.message);
  return c;
}

// ============================================================
// TEST 1: Concurrent UPDATE — two users editing same job
// ============================================================
async function test_concurrentUpdate() {
  const SECTION = 'CONCURRENCY';
  const tyler = await withClient('tyler@interstate-septic.app');
  const jen = await withClient('jen.monroe@interstate-septic.app');

  // Tyler creates a job
  const id = require('crypto').randomUUID();
  await tyler.from('jobs').insert({ id, scheduled_date: '2026-04-26', status: 'scheduled', notes: 'concurrent-edit-test' });

  // Both edit simultaneously
  const [tylerRes, jenRes] = await Promise.all([
    tyler.from('jobs').update({ notes: 'tyler edit' }).eq('id', id),
    jen.from('jobs').update({ notes: 'jen edit' }).eq('id', id)
  ]);

  // Read final state
  const { data: final } = await tyler.from('jobs').select('notes').eq('id', id).single();

  if (final.notes === 'tyler edit' || final.notes === 'jen edit') {
    log(SECTION, 'Concurrent UPDATE on same job', 'PASS', `Last-write-wins: "${final.notes}" (no error, no data corruption)`);
  } else {
    log(SECTION, 'Concurrent UPDATE on same job', 'FAIL', `Unexpected final value: "${final.notes}"`);
  }

  await tyler.from('jobs').delete().eq('id', id);
}

// ============================================================
// TEST 2: Rapid create-delete-create
// ============================================================
async function test_rapidCreateDelete() {
  const SECTION = 'CONCURRENCY';
  const tyler = await withClient('tyler@interstate-septic.app');

  const id = require('crypto').randomUUID();
  // Insert
  await tyler.from('jobs').insert({ id, scheduled_date: '2026-04-26', status: 'scheduled', notes: 'rapid-1' });
  // Delete immediately
  await tyler.from('jobs').delete().eq('id', id);
  // Re-insert with same ID
  const { error } = await tyler.from('jobs').insert({ id, scheduled_date: '2026-04-26', status: 'scheduled', notes: 'rapid-2' });

  if (error) {
    log(SECTION, 'Rapid create-delete-create with same ID', 'FAIL', error.message);
  } else {
    log(SECTION, 'Rapid create-delete-create with same ID', 'PASS', 'Re-insert with same UUID succeeded');
    await tyler.from('jobs').delete().eq('id', id);
  }
}

// ============================================================
// TEST 3: RLS — tech can't write customer/invoice
// ============================================================
async function test_rlsEnforcement() {
  const SECTION = 'RLS';
  const tech = await withClient('chris.bissonnette@interstate-septic.app');

  // Tech tries to write to customers (only office/owner allowed)
  const { error: custErr } = await tech.from('customers').insert({ id: require('crypto').randomUUID(), name: 'TECH SHOULD NOT CREATE' });
  if (custErr) log(SECTION, 'Tech blocked from creating customers', 'PASS', 'RLS rejected: ' + custErr.message);
  else log(SECTION, 'Tech blocked from creating customers', 'FAIL', 'Tech was able to create a customer (RLS hole)');

  // Tech tries to write to invoices (financial — only office/owner allowed)
  const { error: invErr } = await tech.from('invoices').insert({ id: require('crypto').randomUUID(), total: 1000 });
  if (invErr) log(SECTION, 'Tech blocked from creating invoices', 'PASS', 'RLS rejected: ' + invErr.message);
  else log(SECTION, 'Tech blocked from creating invoices', 'FAIL', 'Tech created an invoice (RLS hole)');

  // Tech tries to read invoices (work order context — should be allowed)
  const { error: readErr } = await tech.from('invoices').select('id').limit(1);
  if (readErr) log(SECTION, 'Tech can READ invoices for work order context', 'FAIL', 'Read rejected: ' + readErr.message);
  else log(SECTION, 'Tech can READ invoices for work order context', 'PASS', 'Read allowed by RLS');

  // Tech tries to write to vehicles (settings — only owner allowed)
  const { error: vehErr } = await tech.from('vehicles').insert({ id: require('crypto').randomUUID(), name: 'TECH SHOULD NOT CREATE' });
  if (vehErr) log(SECTION, 'Tech blocked from creating vehicles (settings)', 'PASS', 'RLS rejected: ' + vehErr.message);
  else log(SECTION, 'Tech blocked from creating vehicles', 'FAIL', 'Tech created a vehicle (settings RLS hole)');

  // Tech tries to write to tank_types (settings — only owner allowed)
  const { error: ttErr } = await tech.from('tank_types').insert({ id: require('crypto').randomUUID(), name: 'TECH SHOULD NOT CREATE' });
  if (ttErr) log(SECTION, 'Tech blocked from creating tank_types (settings)', 'PASS', 'RLS rejected: ' + ttErr.message);
  else log(SECTION, 'Tech blocked from creating tank_types', 'FAIL', 'Tech created a tank_type (settings RLS hole)');

  // Office user — should be able to create customers but NOT vehicles
  const office = await withClient('jen.monroe@interstate-septic.app');
  const officeCustId = require('crypto').randomUUID();
  const { error: oCustErr } = await office.from('customers').insert({ id: officeCustId, name: 'OFFICE TEST CUST' });
  if (oCustErr) log(SECTION, 'Office can create customers', 'FAIL', 'Office rejected: ' + oCustErr.message);
  else { log(SECTION, 'Office can create customers', 'PASS'); await office.from('customers').delete().eq('id', officeCustId); }

  const { error: oVehErr } = await office.from('vehicles').insert({ id: require('crypto').randomUUID(), name: 'OFFICE SHOULD NOT' });
  if (oVehErr) log(SECTION, 'Office blocked from creating vehicles (settings)', 'PASS', 'RLS rejected: ' + oVehErr.message);
  else log(SECTION, 'Office blocked from creating vehicles', 'FAIL', 'Office created a vehicle (RLS hole)');
}

// ============================================================
// TEST 4: Cascading delete (customers → properties → tanks)
// ============================================================
async function test_cascadeDelete() {
  const SECTION = 'INTEGRITY';
  const owner = await withClient('tyler@interstate-septic.app');

  const cid = require('crypto').randomUUID();
  const pid = require('crypto').randomUUID();
  const tid = require('crypto').randomUUID();
  await owner.from('customers').insert({ id: cid, name: 'CASCADE TEST CUST' });
  await owner.from('properties').insert({ id: pid, customer_id: cid, address: '1 Test St' });
  await owner.from('tanks').insert({ id: tid, property_id: pid, tank_type: 'Septic Tank' });

  // Delete the customer
  await owner.from('customers').delete().eq('id', cid);

  // Check properties
  const { data: props } = await owner.from('properties').select('id').eq('id', pid);
  // Check tanks
  const { data: tanks } = await owner.from('tanks').select('id').eq('id', tid);

  if (props.length === 0 && tanks.length === 0) {
    log(SECTION, 'Customer delete cascades to properties + tanks', 'PASS', 'Both children deleted automatically by FK CASCADE');
  } else if (props.length === 0 && tanks.length > 0) {
    log(SECTION, 'Customer delete cascades to properties + tanks', 'PARTIAL', `Property gone but tank orphaned (tank.property_id is now invalid)`);
    await owner.from('tanks').delete().eq('id', tid);
  } else {
    log(SECTION, 'Customer delete cascades to properties + tanks', 'FAIL', `Properties remaining: ${props.length}, tanks remaining: ${tanks.length}`);
    await owner.from('tanks').delete().eq('id', tid);
    await owner.from('properties').delete().eq('id', pid);
  }
}

// ============================================================
// TEST 5: Bulk insert under load (100 jobs)
// ============================================================
async function test_bulkInsert() {
  const SECTION = 'PERFORMANCE';
  const owner = await withClient('tyler@interstate-septic.app');

  const ids = [];
  const rows = [];
  for (let i = 0; i < 100; i++) {
    const id = require('crypto').randomUUID();
    ids.push(id);
    rows.push({ id, scheduled_date: '2026-04-26', status: 'scheduled', notes: `bulk-test-${i}` });
  }

  const t0 = Date.now();
  const { error } = await owner.from('jobs').insert(rows);
  const dt = Date.now() - t0;

  if (error) log(SECTION, 'Bulk insert 100 jobs in single call', 'FAIL', error.message);
  else log(SECTION, 'Bulk insert 100 jobs in single call', 'PASS', `${dt}ms total (${(dt/100).toFixed(1)}ms per row)`);

  // Cleanup
  await owner.from('jobs').delete().in('id', ids);
}

// ============================================================
// TEST 6: Date / timezone handling
// ============================================================
async function test_dateHandling() {
  const SECTION = 'DATA_INTEGRITY';
  const owner = await withClient('tyler@interstate-septic.app');

  const id1 = require('crypto').randomUUID();
  // ISO datestring
  const { error: e1 } = await owner.from('jobs').insert({ id: id1, scheduled_date: '2026-04-26', status: 'scheduled', notes: 'date-test-1' });
  if (e1) log(SECTION, 'Plain date YYYY-MM-DD', 'FAIL', e1.message);
  else log(SECTION, 'Plain date YYYY-MM-DD', 'PASS');

  const id2 = require('crypto').randomUUID();
  const { error: e2 } = await owner.from('jobs').insert({ id: id2, scheduled_date: '2026-12-31', status: 'scheduled', notes: 'year-boundary-test' });
  if (e2) log(SECTION, 'Year boundary date 2026-12-31', 'FAIL', e2.message);
  else log(SECTION, 'Year boundary date 2026-12-31', 'PASS');

  const id3 = require('crypto').randomUUID();
  // Empty string for nullable date
  const { error: e3 } = await owner.from('jobs').insert({ id: id3, scheduled_date: null, status: 'scheduled', notes: 'null-date-test' });
  if (e3) log(SECTION, 'NULL scheduled_date', 'FAIL', e3.message);
  else log(SECTION, 'NULL scheduled_date', 'PASS');

  const id4 = require('crypto').randomUUID();
  const { error: e4 } = await owner.from('jobs').insert({ id: id4, scheduled_date: 'not-a-date', status: 'scheduled', notes: 'invalid-date-test' });
  if (e4) log(SECTION, 'Invalid date string rejected', 'PASS', 'Postgres rejected: ' + e4.message);
  else { log(SECTION, 'Invalid date string rejected', 'FAIL', 'Garbage date was accepted!'); await owner.from('jobs').delete().eq('id', id4); }

  // Cleanup
  for (const id of [id1, id2, id3]) await owner.from('jobs').delete().eq('id', id);
}

// ============================================================
// TEST 7: Unicode and special characters
// ============================================================
async function test_specialChars() {
  const SECTION = 'DATA_INTEGRITY';
  const owner = await withClient('tyler@interstate-septic.app');

  const id = require('crypto').randomUUID();
  const trickyName = `O'Brien & "Smith" — émoji 🚽 \n newline \t tab`;
  await owner.from('customers').insert({ id, name: trickyName });
  const { data } = await owner.from('customers').select('name').eq('id', id).single();

  if (data.name === trickyName) log(SECTION, 'Unicode/special chars round-trip cleanly', 'PASS');
  else log(SECTION, 'Unicode/special chars round-trip cleanly', 'FAIL', `Got back: ${JSON.stringify(data.name)}`);

  await owner.from('customers').delete().eq('id', id);
}

// ============================================================
// TEST 8: Realtime — verify INSERT/UPDATE/DELETE all fire
// ============================================================
async function test_realtimeAllEvents() {
  const SECTION = 'REALTIME';
  const subClient = await withClient('tyler@interstate-septic.app');
  const writeClient = await withClient('jen.monroe@interstate-septic.app');

  const url = cfg.url.replace('https://', 'wss://') + '/realtime/v1/websocket?apikey=' + cfg.anonKey + '&vsn=1.0.0';
  const sock = new ws.WebSocket(url);
  const accessToken = (await subClient.auth.getSession()).data.session.access_token;
  let received = { INSERT: false, UPDATE: false, DELETE: false };
  let ref = 0;

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('socket open timeout')), 8000);
    sock.on('open', () => {
      clearTimeout(timeout);
      sock.send(JSON.stringify({
        topic: 'realtime:rt-test',
        event: 'phx_join',
        payload: {
          config: { broadcast: { ack: false, self: false }, presence: { key: '' },
            postgres_changes: [{ event: '*', schema: 'public', table: 'jobs' }] },
          access_token: accessToken
        },
        ref: String(++ref)
      }));
      resolve();
    });
    sock.on('error', reject);
  });

  sock.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.event === 'postgres_changes') {
      received[m.payload.data.type] = true;
    }
  });

  await new Promise(r => setTimeout(r, 2500));

  const id = require('crypto').randomUUID();
  await writeClient.from('jobs').insert({ id, scheduled_date: '2026-04-26', status: 'scheduled', notes: 'rt-events' });
  await new Promise(r => setTimeout(r, 1500));
  await writeClient.from('jobs').update({ notes: 'rt-events-updated' }).eq('id', id);
  await new Promise(r => setTimeout(r, 1500));
  await writeClient.from('jobs').delete().eq('id', id);
  await new Promise(r => setTimeout(r, 2000));

  log(SECTION, 'Realtime INSERT event received', received.INSERT ? 'PASS' : 'FAIL');
  log(SECTION, 'Realtime UPDATE event received', received.UPDATE ? 'PASS' : 'FAIL');
  log(SECTION, 'Realtime DELETE event received', received.DELETE ? 'PASS' : 'FAIL');

  sock.close();
}

// ============================================================
// TEST 9: Username normalization edge cases
// ============================================================
async function test_usernameEdgeCases() {
  const SECTION = 'AUTH';
  // Test: email with uppercase login attempt
  const c = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false } });
  const { error: e1 } = await c.auth.signInWithPassword({ email: 'TYLER@interstate-septic.app', password: 'Issi5646' });
  if (e1) log(SECTION, 'Login with uppercase email letters', 'FAIL', e1.message + ' (case-sensitive matching may confuse users)');
  else log(SECTION, 'Login with uppercase email letters', 'PASS', 'Case-insensitive');

  // Test: wrong password rate limiting
  const c2 = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false } });
  const t0 = Date.now();
  const { error } = await c2.auth.signInWithPassword({ email: 'tyler@interstate-septic.app', password: 'WRONGWRONG' });
  const dt = Date.now() - t0;
  if (error) log(SECTION, 'Wrong password rejected', 'PASS', `${dt}ms response — ${error.message}`);
  else log(SECTION, 'Wrong password rejected', 'FAIL', 'Wrong password accepted!');
}

// ============================================================
// TEST 10: Schedule_items with all renderer fields (data jsonb test)
// ============================================================
async function test_scheduleItemAllFields() {
  const SECTION = 'SCHEMA';
  const owner = await withClient('tyler@interstate-septic.app');

  const id = require('crypto').randomUUID();
  // The renderer might send these — but several aren't real columns
  const payload = {
    id,
    scheduled_date: '2026-04-26',
    item_type: 'manifest',
    notes: 'sched-item-test',
    manifest_number: '1234',
    waste_site: 'Juniper Ridge',
    gallons: 4400,
    tank_type: 'Septic',
    time_label: '9:00 AM',
    sort_order: 5,
    // Unknowns:
    custom_field_one: 'hello',
    custom_field_two: { nested: true },
    helpers: ['user1', 'user2']
  };

  const { error } = await owner.from('schedule_items').insert(payload);
  if (error) log(SECTION, 'Direct insert with unknown columns FAILS (proves data jsonb is needed)', 'PASS', error.message);
  else { log(SECTION, 'Direct insert with unknown columns', 'NOTE', 'Cloud accepted unknown columns directly'); await owner.from('schedule_items').delete().eq('id', id); }

  // Now try with split: known cols at top, unknowns in data
  const id2 = require('crypto').randomUUID();
  const split = {
    id: id2,
    scheduled_date: '2026-04-26',
    item_type: 'manifest',
    notes: 'sched-split-test',
    manifest_number: '1234',
    waste_site: 'Juniper Ridge',
    gallons: 4400,
    tank_type: 'Septic',
    time_label: '9:00 AM',
    sort_order: 5,
    data: { custom_field_one: 'hello', custom_field_two: { nested: true }, helpers: ['user1', 'user2'] }
  };
  const { error: e2 } = await owner.from('schedule_items').insert(split);
  if (e2) log(SECTION, 'Insert with unknowns moved into data jsonb', 'FAIL', e2.message);
  else log(SECTION, 'Insert with unknowns moved into data jsonb', 'PASS');
  await owner.from('schedule_items').delete().eq('id', id2);
}

// ============================================================
// TEST 11: Soft-delete survives realtime UPDATE (no resurrection)
// ============================================================
async function test_softDeletePersists() {
  const SECTION = 'INTEGRITY';
  const owner = await withClient('tyler@interstate-septic.app');

  const id = require('crypto').randomUUID();
  await owner.from('jobs').insert({ id, scheduled_date: '2026-04-26', status: 'scheduled', notes: 'soft-del-test' });
  await owner.from('jobs').update({ deleted_at: new Date().toISOString() }).eq('id', id);

  // Now another user "edits" the deleted job
  const other = await withClient('jen.monroe@interstate-septic.app');
  const { error } = await other.from('jobs').update({ notes: 'edited after delete' }).eq('id', id);

  const { data: final } = await owner.from('jobs').select('deleted_at, notes').eq('id', id).single();

  if (final.deleted_at && final.notes === 'edited after delete') {
    log(SECTION, 'Soft-deleted job CAN still be edited (no protection)', 'WARN', 'After deletion, anyone can still edit. Consider blocking.');
  } else if (final.deleted_at) {
    log(SECTION, 'Soft-deleted job stays deleted', 'PASS', 'deleted_at preserved');
  } else {
    log(SECTION, 'Soft-deleted job stays deleted', 'FAIL', 'deleted_at was cleared by edit');
  }

  await owner.from('jobs').delete().eq('id', id);
}

// ============================================================
// TEST 12: Long string handling
// ============================================================
async function test_longStrings() {
  const SECTION = 'DATA_INTEGRITY';
  const owner = await withClient('tyler@interstate-septic.app');

  const id = require('crypto').randomUUID();
  const longNotes = 'X'.repeat(10000); // 10KB
  const { error } = await owner.from('jobs').insert({ id, scheduled_date: '2026-04-26', status: 'scheduled', notes: longNotes });
  if (error) log(SECTION, 'Insert 10KB notes field', 'FAIL', error.message);
  else {
    const { data } = await owner.from('jobs').select('notes').eq('id', id).single();
    if (data.notes.length === 10000) log(SECTION, 'Insert 10KB notes field', 'PASS', '10KB round-trip clean');
    else log(SECTION, 'Insert 10KB notes field', 'FAIL', 'Truncated to ' + data.notes.length);
    await owner.from('jobs').delete().eq('id', id);
  }
}

// ============================================================
// TEST 13: Missing required fields
// ============================================================
async function test_missingRequired() {
  const SECTION = 'SCHEMA';
  const owner = await withClient('tyler@interstate-septic.app');

  // schedule_items.scheduled_date is NULL-able per schema, but maybe shouldn't be?
  const id = require('crypto').randomUUID();
  const { error } = await owner.from('schedule_items').insert({ id, notes: 'no-date' });
  if (error) log(SECTION, 'schedule_item without scheduled_date', 'NOTE', 'Rejected: ' + error.message);
  else { log(SECTION, 'schedule_item without scheduled_date', 'WARN', 'Allowed — null scheduled_date may cause UI issues'); await owner.from('schedule_items').delete().eq('id', id); }

  // Customer without name
  const id2 = require('crypto').randomUUID();
  const { error: e2 } = await owner.from('customers').insert({ id: id2 });
  if (e2) log(SECTION, 'Customer without name rejected', 'PASS', 'Rejected: ' + e2.message);
  else { log(SECTION, 'Customer without name rejected', 'FAIL', 'Allowed — broken record!'); await owner.from('customers').delete().eq('id', id2); }
}

// ============================================================
// TEST 14: Pagination — read all 4500+ customers
// ============================================================
async function test_pagination() {
  const SECTION = 'PERFORMANCE';
  const owner = await withClient('tyler@interstate-septic.app');

  const t0 = Date.now();
  let total = 0;
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await owner.from('customers').select('id').range(from, from + PAGE - 1);
    if (error) { log(SECTION, 'Paginate all customers', 'FAIL', error.message); return; }
    if (!data || data.length === 0) break;
    total += data.length;
    if (data.length < PAGE) break;
    from += PAGE;
  }
  const dt = Date.now() - t0;
  log(SECTION, `Paginate all customers (${total} rows)`, total > 4000 ? 'PASS' : 'FAIL', `${dt}ms (${(total/dt*1000).toFixed(0)} rows/sec)`);
}

// ============================================================
// TEST 15: Ownership transfer — change auth_user_id on user row
// ============================================================
async function test_userIdConflict() {
  const SECTION = 'AUTH';
  const owner = await withClient('tyler@interstate-septic.app');
  // Try to change tyler's auth_user_id to point at a different auth user
  // This SHOULD fail or at least not work silently
  const fakeId = require('crypto').randomUUID();
  const { error } = await owner.from('users').update({ auth_user_id: fakeId }).eq('username', 'tyler');
  if (error) log(SECTION, 'Cannot change auth_user_id on user', 'PASS', 'Blocked: ' + error.message);
  else {
    log(SECTION, 'Cannot change auth_user_id on user', 'WARN', 'Owner CAN change auth_user_id — could break login or impersonate');
    // restore
    const session = (await owner.auth.getSession()).data.session;
    await owner.from('users').update({ auth_user_id: session.user.id }).eq('username', 'tyler');
  }
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log('Starting edge-case test suite at', new Date().toISOString(), '\n');

  const tests = [
    ['concurrentUpdate', test_concurrentUpdate],
    ['rapidCreateDelete', test_rapidCreateDelete],
    ['rlsEnforcement', test_rlsEnforcement],
    ['cascadeDelete', test_cascadeDelete],
    ['bulkInsert', test_bulkInsert],
    ['dateHandling', test_dateHandling],
    ['specialChars', test_specialChars],
    ['realtimeAllEvents', test_realtimeAllEvents],
    ['usernameEdgeCases', test_usernameEdgeCases],
    ['scheduleItemAllFields', test_scheduleItemAllFields],
    ['softDeletePersists', test_softDeletePersists],
    ['longStrings', test_longStrings],
    ['missingRequired', test_missingRequired],
    ['pagination', test_pagination],
    ['userIdConflict', test_userIdConflict]
  ];

  for (const [name, fn] of tests) {
    try { await fn(); }
    catch (e) { log('ERROR', name, 'CRASH', e.message); }
  }

  // Summary
  console.log('\n=== SUMMARY ===');
  const counts = { PASS: 0, FAIL: 0, WARN: 0, NOTE: 0, PARTIAL: 0, CRASH: 0 };
  RESULTS.forEach(r => counts[r.status] = (counts[r.status] || 0) + 1);
  Object.entries(counts).forEach(([k, v]) => v && console.log(`  ${k}: ${v}`));

  // Write results to markdown
  let md = '# Edge-Case Test Results\n\n';
  md += `Generated: ${new Date().toISOString()}\n\n`;
  md += `**Summary:** ${counts.PASS || 0} pass, ${counts.FAIL || 0} fail, ${counts.WARN || 0} warn, ${counts.NOTE || 0} note, ${counts.PARTIAL || 0} partial, ${counts.CRASH || 0} crash\n\n`;
  const sections = [...new Set(RESULTS.map(r => r.section))];
  for (const sec of sections) {
    md += `## ${sec}\n\n`;
    md += '| Status | Test | Details |\n|---|---|---|\n';
    for (const r of RESULTS.filter(x => x.section === sec)) {
      md += `| ${r.status} | ${r.name} | ${(r.details || '').replace(/\|/g, '\\|')} |\n`;
    }
    md += '\n';
  }
  fs.writeFileSync(path.join(__dirname, '..', 'edge-case-results.md'), md);
  console.log('\nResults written to edge-case-results.md');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
