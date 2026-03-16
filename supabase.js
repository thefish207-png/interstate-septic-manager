const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

let supabase = null;

function getConfigPath(userDataPath) {
  return path.join(userDataPath, 'supabase-config.json');
}

function initSupabase(userDataPath) {
  const configPath = getConfigPath(userDataPath);
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (config.url && config.anonKey) {
      supabase = createClient(config.url, config.anonKey);
      return supabase;
    }
  }
  return null;
}

function saveSupabaseConfig(userDataPath, url, anonKey) {
  const configPath = getConfigPath(userDataPath);
  fs.writeFileSync(configPath, JSON.stringify({ url, anonKey }, null, 2));
  supabase = createClient(url, anonKey);
  return supabase;
}

function getSupabase() {
  return supabase;
}

module.exports = { initSupabase, saveSupabaseConfig, getSupabase };
