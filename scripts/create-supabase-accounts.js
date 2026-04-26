// Interstate Septic Manager — Bulk-create Supabase auth accounts for all users
//
// PREREQUISITES:
//   1. Run supabase/migrations/0001 and 0002 in the SQL Editor
//   2. In Supabase Dashboard → Authentication → Sign In / Up:
//      - Email Sign Up: ENABLED
//      - Confirm email: DISABLED  (we're using synthetic emails)
//
// USAGE:
//   node scripts/create-supabase-accounts.js                          (dry run)
//   node scripts/create-supabase-accounts.js --apply --password=Septic2026
//   node scripts/create-supabase-accounts.js --apply --password=Septic2026 --skip=nick.cole
//   node scripts/create-supabase-accounts.js --apply --password=Septic2026 --only=tyler

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = path.join(os.homedir(), 'AppData', 'Roaming', 'interstate-septic-manager');
const CONFIG_PATH = path.join(DATA_DIR, 'supabase-config.json');

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const supabase = createClient(config.url, config.anonKey, { auth: { persistSession: false } });

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const password = (args.find(a => a.startsWith('--password=')) || '').replace('--password=', '');
const skipList = (args.find(a => a.startsWith('--skip=')) || '').replace('--skip=', '').split(',').filter(Boolean);
const onlyList = (args.find(a => a.startsWith('--only=')) || '').replace('--only=', '').split(',').filter(Boolean);

// Synthetic email domain — we use this because Supabase Auth requires email format.
// Users never see or use this; they log in with username + password.
const EMAIL_DOMAIN = 'interstate-septic.app';

function normalizeUsername(s) {
  return (s || '').toLowerCase().replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, '');
}

async function main() {
  if (APPLY && !password) {
    console.error('✗ --apply requires --password=YourTempPassword');
    process.exit(1);
  }
  if (password && password.length < 6) {
    console.error('✗ Password must be at least 6 characters');
    process.exit(1);
  }

  console.log('Interstate Septic — Account creation');
  console.log('Mode:', APPLY ? 'APPLY' : 'DRY RUN');
  console.log('');

  // Fetch all users from public.users
  const { data: users, error } = await supabase
    .from('users')
    .select('id, username, name, role, auth_user_id')
    .order('username');

  if (error) {
    console.error('Cannot read users:', error.message);
    process.exit(1);
  }

  console.log(`Found ${users.length} users in public.users\n`);

  const results = [];

  for (const u of users) {
    const username = normalizeUsername(u.username || u.name);
    if (!username) {
      console.log(`  ⚠ skipping user ${u.id} — no username/name`);
      continue;
    }

    if (onlyList.length && !onlyList.includes(username)) continue;
    if (skipList.includes(username)) {
      console.log(`  → skipping ${username} (per --skip)`);
      continue;
    }

    if (u.auth_user_id) {
      console.log(`  ✓ ${username.padEnd(18)} already linked (auth_user_id: ${u.auth_user_id.slice(0, 8)}...)`);
      results.push({ username, action: 'already_linked', role: u.role });
      continue;
    }

    const email = `${username}@${EMAIL_DOMAIN}`;

    if (!APPLY) {
      console.log(`  ${username.padEnd(18)} → would create as ${email} (role: ${u.role})`);
      results.push({ username, action: 'would_create', role: u.role });
      continue;
    }

    // Try to sign up
    const { data: signupData, error: signupError } = await supabase.auth.signUp({
      email,
      password
    });

    if (signupError) {
      if (signupError.message.includes('already registered')) {
        console.log(`  ⚠ ${username.padEnd(18)} email already registered — try password reset in dashboard`);
        results.push({ username, action: 'already_exists', role: u.role });
      } else {
        console.error(`  ✗ ${username.padEnd(18)} ${signupError.message}`);
        results.push({ username, action: 'failed', error: signupError.message });
      }
      continue;
    }

    console.log(`  ✓ ${username.padEnd(18)} created (auth id: ${signupData.user.id.slice(0, 8)}...)`);
    results.push({ username, action: 'created', role: u.role });

    // Sign out so the next signUp starts fresh
    await supabase.auth.signOut();
  }

  console.log('\n=== SUMMARY ===');
  console.table(results);

  if (APPLY) {
    console.log('\nShare these credentials with each person:');
    console.log('────────────────────────────────────────');
    for (const r of results) {
      if (r.action === 'created' || r.action === 'already_linked' || r.action === 'already_exists') {
        console.log(`  Username: ${r.username.padEnd(18)} Password: ${password}      Role: ${r.role}`);
      }
    }
    console.log('────────────────────────────────────────');
    console.log('\nTell users to log in with their USERNAME (not the @interstate-septic.app email).');
    console.log('We will add a "change password" feature in the app shortly.');
  } else {
    console.log('\nDry run complete. To create accounts, re-run with:');
    console.log('  node scripts/create-supabase-accounts.js --apply --password=YourTempPassword');
  }
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
