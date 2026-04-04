const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const XLSX = require('xlsx');

// ===== SINGLE INSTANCE LOCK =====
// Prevents multiple Electron instances from running and overwriting each other's data
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[APP] Another instance is already running — quitting.');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

let mainWindow;
let userDataPath = app.getPath('userData');
console.log('[APP] userData path:', userDataPath);

// ===== EMBEDDED SEED DATA — GUARANTEES DATA ON STARTUP =====
// Bypasses the Electron fs.readFileSync bug where files read as empty despite being full on disk.
// Data is bundled via require() which uses Node's module system (different code path than fs).
const SEED_DATA = require('./seed_data_embedded');

// Ensure data directory exists
(function ensureDataDir() {
  const appDir = path.join(userDataPath, 'data');
  if (!fs.existsSync(appDir)) fs.mkdirSync(appDir, { recursive: true });
})();

// ===== SAVED CREDENTIALS (file-based, survives force-quit) =====
const savedCredsPath = path.join(userDataPath, 'saved_creds.json');
function getSavedCreds() {
  try { return JSON.parse(fs.readFileSync(savedCredsPath, 'utf8')); } catch { return null; }
}
function saveCreds(username, password) {
  fs.writeFileSync(savedCredsPath, JSON.stringify({ username, password }));
}
function clearCreds() {
  try { fs.unlinkSync(savedCredsPath); } catch {}
}

// ===== LOCAL JSON DB (IN-MEMORY WITH DISK PERSIST) =====
// All data lives in RAM after startup — completely bypasses Electron fs read bugs.
const _store = {};

function dbPath(collection) {
  const dir = path.join(userDataPath, 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, collection + '.json');
}

// Initialize in-memory store from embedded seed data
(function initStore() {
  const collections = Object.keys(SEED_DATA);
  collections.forEach(name => {
    _store[name] = JSON.parse(JSON.stringify(SEED_DATA[name])); // deep clone
    console.log('[STORE] Loaded ' + name + ': ' + _store[name].length + ' items from embedded seed');
  });

  // Load any user-modified data from disk — disk always wins over seed data
  collections.forEach(name => {
    const p = path.join(userDataPath, 'data', name + '.json');
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8');
        const diskData = JSON.parse(raw);
        if (Array.isArray(diskData)) {
          _store[name] = diskData;
          console.log('[STORE] ' + name + ': loaded from disk (' + diskData.length + ' items)');
        }
      }
    } catch {}
  });
})();

function readCollection(collection) {
  if (_store[collection]) return _store[collection];
  // For collections not in seed (payments, schedule_items, etc.), read from disk
  const p = dbPath(collection);
  if (!fs.existsSync(p)) { _store[collection] = []; return []; }
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const data = JSON.parse(raw);
    _store[collection] = data;
    return data;
  } catch {
    _store[collection] = [];
    return [];
  }
}

function writeCollection(collection, data) {
  _store[collection] = data; // always update memory first
  const p = dbPath(collection);
  try { fs.writeFileSync(p, JSON.stringify(data, null, 2)); } catch (err) {
    console.error('[DB] Write failed for ' + collection + ':', err.message);
  }
}

function findById(collection, id) {
  return readCollection(collection).find(item => item.id === id) || null;
}

function upsert(collection, item) {
  const items = readCollection(collection);
  if (item.id) {
    const idx = items.findIndex(i => i.id === item.id);
    if (idx >= 0) {
      items[idx] = { ...items[idx], ...item, updated_at: new Date().toISOString() };
      writeCollection(collection, items);
      return items[idx];
    }
  }
  item.id = uuidv4();
  item.created_at = new Date().toISOString();
  item.updated_at = new Date().toISOString();
  items.push(item);
  writeCollection(collection, items);
  return item;
}

function remove(collection, id) {
  const items = readCollection(collection).filter(i => i.id !== id);
  writeCollection(collection, items);
}

// ===== CONFIRMATION HTTP SERVER =====
let confirmServer = null;

function getServerSettings() {
  try {
    const settings = readCollection('settings')[0] || {};
    return {
      port: parseInt(settings.confirm_server_port) || 3456,
      publicUrl: (settings.confirm_public_url || '').replace(/\/$/, ''),
    };
  } catch { return { port: 3456, publicUrl: '' }; }
}

function startConfirmServer() {
  if (confirmServer) return;
  const { port } = getServerSettings();

  confirmServer = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost`);

    if (url.pathname === '/confirm') {
      const token = url.searchParams.get('token');
      const notices = readCollection('service_due_notices');
      const idx = notices.findIndex(n => n.confirm_token === token);

      if (idx === -1) {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end(confirmPage('Not Found', 'This confirmation link is invalid or has already been used.', '#e53935'));
        return;
      }

      const notice = notices[idx];
      const customers = readCollection('customers');
      const cust = customers.find(c => c.id === notice.customer_id) || {};
      const serviceType = notice.service_type || 'Septic Service';

      if (notice.status === 'confirmed') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(confirmPage('Already Confirmed', `Your ${serviceType} service appointment has already been confirmed. We look forward to seeing you!`, '#43a047'));
        return;
      }

      notices[idx] = { ...notice, status: 'confirmed', confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      writeCollection('service_due_notices', notices);

      // Notify the renderer that a confirmation came in
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sdn-confirmed', { id: notice.id, customerName: cust.name || '' });
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(confirmPage(
        'Appointment Confirmed!',
        `Thank you${cust.name ? ', ' + cust.name : ''}! We've received your confirmation for <strong>${serviceType}</strong> service. We'll be in touch to finalize your appointment time. You will no longer receive reminder emails for this notice.`,
        '#2e7d32'
      ));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(confirmPage('Interstate Septic', 'Customer confirmation portal.', '#2e7d32'));
  });

  confirmServer.listen(port, '0.0.0.0', () => {
    console.log(`[CONFIRM SERVER] Listening on port ${port}`);
  });

  confirmServer.on('error', (err) => {
    console.error('[CONFIRM SERVER] Error:', err.message);
  });
}

function stopConfirmServer() {
  if (confirmServer) { confirmServer.close(); confirmServer = null; }
}

function restartConfirmServer() {
  stopConfirmServer();
  startConfirmServer();
}

function confirmPage(title, message, color) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f5f5f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: white; border-radius: 12px; padding: 48px 40px; max-width: 480px; width: 90%; text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,0.10); }
    .icon { font-size: 56px; margin-bottom: 20px; }
    h1 { color: ${color}; font-size: 26px; margin-bottom: 14px; }
    p { color: #555; font-size: 16px; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${color === '#e53935' ? '❌' : '✅'}</div>
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

// ===== SYSTEM TRAY =====
let tray = null;

function createTrayIcon() {
  // Build a 16x16 green square as BGRA bitmap
  const size = 16;
  const data = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4]     = 50;  // B
    data[i * 4 + 1] = 125; // G
    data[i * 4 + 2] = 46;  // R (#2e7d32)
    data[i * 4 + 3] = 255; // A
  }
  return nativeImage.createFromBitmap(data, { width: size, height: size });
}

function createTray() {
  if (tray) return;
  tray = new Tray(createTrayIcon());
  tray.setToolTip('Interstate Septic Manager');
  updateTrayMenu();
  tray.on('double-click', () => showMainWindow());
}

function updateTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: 'Open Interstate Septic Manager', click: () => showMainWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

// ===== WINDOW =====
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Interstate Septic Manager',
  });
  mainWindow.loadFile('src/index.html');

  // Closing the window minimizes to tray instead of quitting
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      tray?.displayBalloon({
        title: 'Interstate Septic Manager',
        content: 'Running in the background. Double-click the tray icon to reopen.',
        iconType: 'info',
      });
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  startConfirmServer();
  // Auto-start on login setting (Windows only)
  try {
    const settings = readCollection('settings')[0] || {};
    app.setLoginItemSettings({ openAtLogin: settings.auto_start === true });
  } catch {}
  // Check for due service notices on startup (after 10s delay) and then every hour
  setTimeout(() => { checkDueNotices(); }, 10000);
  setInterval(() => { checkDueNotices(); }, 3600000);
  // Check job reminders on startup (after 12s delay) and then every hour
  setTimeout(() => { checkJobReminders(); }, 12000);
  setInterval(() => { checkJobReminders(); }, 3600000);
  // Check reminder alerts every 60 seconds
  setTimeout(() => { checkReminderAlerts(); }, 5000);
  setInterval(() => { checkReminderAlerts(); }, 60000);
});

// Don't quit when all windows close — stay in tray
app.on('window-all-closed', () => {
  // intentionally empty — tray keeps app alive
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ===== CUSTOMERS =====
ipcMain.handle('get-customers', async (e, search) => {
  let customers = readCollection('customers');
  const properties = readCollection('properties');
  if (search) {
    const s = search.toLowerCase();
    // Search customers by name, phone, email, or by property address
    const propertyCustomerIds = properties
      .filter(p => (p.address || '').toLowerCase().includes(s))
      .map(p => p.customer_id);
    customers = customers.filter(c =>
      (c.name || '').toLowerCase().includes(s) ||
      (c.phone || '').toLowerCase().includes(s) ||
      (c.email || '').toLowerCase().includes(s) ||
      propertyCustomerIds.includes(c.id)
    );
  }
  // Attach property count and balance
  customers = customers.map(c => {
    const custProps = properties.filter(p => p.customer_id === c.id);
    const primary = custProps[0];
    const addr = primary ? `${primary.address || ''}${primary.city ? ', ' + primary.city : ''}${primary.state ? ' ' + primary.state : ''}` : '';
    return { ...c, property_count: custProps.length, primary_address: addr.trim() };
  });
  customers.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return { data: customers };
});

ipcMain.handle('get-customer', async (e, id) => {
  const customer = findById('customers', id);
  if (customer) {
    customer.properties = readCollection('properties').filter(p => p.customer_id === id);
  }
  return { data: customer };
});

ipcMain.handle('save-customer', async (e, data) => {
  const saved = upsert('customers', data);
  return { success: true, data: saved };
});

ipcMain.handle('delete-customer', async (e, id) => {
  // Also delete associated properties and tanks
  const properties = readCollection('properties').filter(p => p.customer_id === id);
  properties.forEach(p => {
    const tanks = readCollection('tanks').filter(t => t.property_id !== p.id);
    writeCollection('tanks', tanks);
  });
  const remainingProps = readCollection('properties').filter(p => p.customer_id !== id);
  writeCollection('properties', remainingProps);
  remove('customers', id);
  return { success: true };
});

// ===== PROPERTIES =====
ipcMain.handle('get-properties', async (e, customerId) => {
  let properties = readCollection('properties');
  if (customerId) properties = properties.filter(p => p.customer_id === customerId);
  const tanks = readCollection('tanks');
  properties = properties.map(p => ({
    ...p,
    tanks: tanks.filter(t => t.property_id === p.id),
    tank_count: tanks.filter(t => t.property_id === p.id).length,
  }));
  return { data: properties };
});

ipcMain.handle('get-property', async (e, id) => {
  const property = findById('properties', id);
  if (property) {
    property.tanks = readCollection('tanks').filter(t => t.property_id === id);
    property.customer = findById('customers', property.customer_id);
  }
  return { data: property };
});

ipcMain.handle('save-property', async (e, data) => {
  const saved = upsert('properties', data);
  return { success: true, data: saved };
});

ipcMain.handle('delete-property', async (e, id) => {
  // Also delete tanks under this property
  const remainingTanks = readCollection('tanks').filter(t => t.property_id !== id);
  writeCollection('tanks', remainingTanks);
  remove('properties', id);
  return { success: true };
});

// ===== TANKS =====
ipcMain.handle('get-tanks', async (e, propertyId) => {
  let tanks = readCollection('tanks');
  if (propertyId) tanks = tanks.filter(t => t.property_id === propertyId);
  return { data: tanks };
});

ipcMain.handle('save-tank', async (e, data) => {
  const saved = upsert('tanks', data);
  return { success: true, data: saved };
});

ipcMain.handle('delete-tank', async (e, id) => {
  remove('tanks', id);
  return { success: true };
});

// ===== VEHICLES =====
ipcMain.handle('get-vehicles', async () => {
  const vehicles = readCollection('vehicles');
  vehicles.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  return { data: vehicles };
});

ipcMain.handle('save-vehicle', async (e, data) => {
  const saved = upsert('vehicles', data);
  return { success: true, data: saved };
});

ipcMain.handle('delete-vehicle', async (e, id) => {
  remove('vehicles', id);
  return { success: true };
});

// ===== TRUCK DAY ASSIGNMENTS =====
ipcMain.handle('get-truck-day-assignments', async (e, date) => {
  const all = readCollection('truck_day_assignments');
  return { data: date ? all.filter(a => a.date === date) : all };
});

ipcMain.handle('save-truck-day-assignment', async (e, data) => {
  // data: { vehicle_id, date, user_id }  — upsert by vehicle_id+date
  const all = readCollection('truck_day_assignments');
  const idx = all.findIndex(a => a.vehicle_id === data.vehicle_id && a.date === data.date);
  if (idx >= 0) {
    all[idx] = { ...all[idx], user_id: data.user_id, updated_at: new Date().toISOString() };
  } else {
    all.push({ id: require('crypto').randomUUID(), ...data, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  }
  writeCollection('truck_day_assignments', all);
  return { success: true };
});

// ===== JOBS =====
ipcMain.handle('get-jobs', async (e, filters) => {
  let jobs = readCollection('jobs');
  const customers = readCollection('customers');
  const users = readCollection('users');
  const vehicles = readCollection('vehicles');
  const properties = readCollection('properties');

  if (filters?.date) {
    jobs = jobs.filter(j => j.scheduled_date === filters.date);
  }
  if (filters?.dateFrom && filters?.dateTo) {
    jobs = jobs.filter(j => j.scheduled_date >= filters.dateFrom && j.scheduled_date <= filters.dateTo);
  }
  if (filters?.assignedTo) jobs = jobs.filter(j => j.assigned_to === filters.assignedTo);
  if (filters?.vehicleId) jobs = jobs.filter(j => j.vehicle_id === filters.vehicleId);
  if (filters?.status) jobs = jobs.filter(j => j.status === filters.status);
  if (filters?.customerId) jobs = jobs.filter(j => j.customer_id === filters.customerId);
  if (filters?.propertyId) jobs = jobs.filter(j => j.property_id === filters.propertyId);

  const tanks = readCollection('tanks');
  // Join customer, user, vehicle, property, tanks
  jobs = jobs.map(j => {
    const prop = properties.find(p => p.id === j.property_id) || null;
    return {
      ...j,
      customers: customers.find(c => c.id === j.customer_id) || null,
      users: users.find(u => u.id === j.assigned_to) || null,
      vehicle: vehicles.find(v => v.id === j.vehicle_id) || null,
      property: prop ? { ...prop, tanks: tanks.filter(t => t.property_id === prop.id) } : null,
    };
  });

  jobs.sort((a, b) => {
    const d = (a.scheduled_date || '').localeCompare(b.scheduled_date || '');
    if (d !== 0) return d;
    return (a.scheduled_time || '').localeCompare(b.scheduled_time || '');
  });

  return { data: jobs };
});

ipcMain.handle('get-job', async (e, id) => {
  const job = findById('jobs', id);
  if (job) {
    job.customers = findById('customers', job.customer_id);
    job.users = findById('users', job.assigned_to);
    job.vehicle = findById('vehicles', job.vehicle_id);
    const prop = findById('properties', job.property_id);
    if (prop) {
      prop.tanks = readCollection('tanks').filter(t => t.property_id === prop.id);
    }
    job.property = prop;
  }
  return { data: job };
});

ipcMain.handle('save-job', async (e, data) => {
  const isNew = !data.id;
  const saved = upsert('jobs', data);

  // Auto-create/sync invoice
  if (isNew) {
    // Generate next invoice number
    const invoices = readCollection('invoices');
    let nextNum = 1;
    if (invoices.length > 0) {
      const nums = invoices.map(i => parseInt((i.invoice_number || '0').replace(/\D/g, '')) || 0);
      nextNum = Math.max(...nums) + 1;
    }
    const invoiceNumber = String(nextNum);

    const customer = findById('customers', saved.customer_id);
    const property = findById('properties', saved.property_id);
    const totalGal = Object.values(saved.gallons_pumped || {}).reduce((s, g) => s + (parseInt(g) || 0), 0);
    const lineItems = saved.line_items || [];
    const subtotal = lineItems.reduce((s, li) => s + ((li.qty || 0) * (li.unit_price || 0)), 0);

    upsert('invoices', {
      invoice_number: invoiceNumber,
      job_id: saved.id,
      customer_id: saved.customer_id,
      property_id: saved.property_id,
      svc_date: saved.scheduled_date || null,
      vehicle_id: saved.vehicle_id || null,
      driver_id: saved.assigned_to || null,
      gallons_pumped: totalGal,
      job_codes: saved.service_type || '',
      complete: saved.status === 'completed',
      line_items: lineItems,
      subtotal,
      tax_rate: 0,
      tax_amount: 0,
      total: subtotal,
      status: 'draft',
      payment_status: 'unpaid',
      payment_method: '',
      amount_paid: 0,
      billing_company: customer?.company || customer?.name || '',
      property_address: property?.address || '',
      property_city: property?.city || '',
      notes: '',
    });

    // Send job confirmation email if scheduled date is set
    if (saved.scheduled_date && customer?.email) {
      (async () => {
        try {
          const settingsPath = path.join(userDataPath, 'settings.json');
          if (fs.existsSync(settingsPath)) {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            if (settings.smtp_host) {
              const transporter = nodemailer.createTransport({
                host: settings.smtp_host,
                port: parseInt(settings.smtp_port) || 587,
                secure: parseInt(settings.smtp_port) === 465,
                auth: { user: settings.smtp_user, pass: settings.smtp_pass },
              });

              const companyName = settings.company_name || 'Interstate Septic';
              const companyPhone = settings.company_phone || '';
              const propAddr = property ? `${property.address || ''}, ${property.city || ''} ${property.state || ''} ${property.zip || ''}`.trim() : 'your property';
              const scheduledDate = new Date(saved.scheduled_date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

              const html = `
                <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
                  <h2 style="color:#1b5e20;">${companyName}</h2>
                  <p>Dear ${customer.name || 'Valued Customer'},</p>
                  <p>Your service appointment has been scheduled!</p>
                  <div style="background:#f0f7ff;padding:16px;border-left:4px solid #2196F3;border-radius:4px;margin:20px 0;">
                    <p style="margin:8px 0;"><strong>Service Date:</strong> ${scheduledDate}</p>
                    <p style="margin:8px 0;"><strong>Service Type:</strong> ${saved.service_type || 'Service'}</p>
                    <p style="margin:8px 0;"><strong>Property:</strong> ${propAddr}</p>
                    ${saved.notes ? `<p style="margin:8px 0;"><strong>Notes:</strong> ${saved.notes}</p>` : ''}
                  </div>
                  <p>If you need to reschedule or have any questions, please contact us.</p>
                  ${companyPhone ? `<p>Phone: <strong>${companyPhone}</strong></p>` : ''}
                  <p>Thank you for choosing ${companyName}!</p>
                  <hr style="border:none;border-top:1px solid #ddd;margin:20px 0;">
                  <p style="font-size:12px;color:#999;">This is an automated confirmation from ${companyName}.</p>
                </div>`;

              await transporter.sendMail({
                from: settings.smtp_user,
                to: customer.email,
                subject: `Service Appointment Confirmation - ${companyName}`,
                html,
              });
              console.log('[MAIL] Job confirmation sent to ' + customer.email);
            }
          }
        } catch (err) {
          console.error('[MAIL ERROR] Job confirmation:', err.message);
        }
      })();
    }
  } else {
    // Sync existing draft invoice linked to this job
    const invoices = readCollection('invoices');
    const linked = invoices.find(i => i.job_id === saved.id && i.status === 'draft');
    if (linked) {
      const customer = findById('customers', saved.customer_id);
      const property = findById('properties', saved.property_id);
      const totalGal = Object.values(saved.gallons_pumped || {}).reduce((s, g) => s + (parseInt(g) || 0), 0);
      const lineItems = saved.line_items || [];
      const subtotal = lineItems.reduce((s, li) => s + ((li.qty || 0) * (li.unit_price || 0)), 0);

      upsert('invoices', {
        id: linked.id,
        customer_id: saved.customer_id,
        property_id: saved.property_id,
        svc_date: saved.scheduled_date || null,
        vehicle_id: saved.vehicle_id || null,
        driver_id: saved.assigned_to || null,
        gallons_pumped: totalGal,
        job_codes: saved.service_type || '',
        complete: saved.status === 'completed',
        line_items: lineItems,
        subtotal,
        total: subtotal + (linked.tax_amount || 0),
        billing_company: customer?.company || customer?.name || '',
        property_address: property?.address || '',
        property_city: property?.city || '',
      });
    }
  }

  return { success: true, data: saved };
});

ipcMain.handle('update-job-status', async (e, id, status) => {
  const jobs = readCollection('jobs');
  const idx = jobs.findIndex(j => j.id === id);
  if (idx >= 0) {
    jobs[idx].status = status;
    jobs[idx].updated_at = new Date().toISOString();
    if (status === 'completed') jobs[idx].completed_at = new Date().toISOString();
    writeCollection('jobs', jobs);

    // Sync complete flag on linked invoice
    const invoices = readCollection('invoices');
    const linked = invoices.find(i => i.job_id === id);
    if (linked) {
      linked.complete = (status === 'completed');
      linked.updated_at = new Date().toISOString();
      writeCollection('invoices', invoices);
    }

    return { success: true };
  }
  return { success: false, error: 'Job not found' };
});

ipcMain.handle('delete-job', async (e, id) => {
  remove('jobs', id);
  // Auto-delete linked invoice
  const invoices = readCollection('invoices');
  const linked = invoices.find(i => i.job_id === id);
  if (linked) remove('invoices', linked.id);
  return { success: true };
});

// ===== INVOICES =====
ipcMain.handle('get-invoices', async (e, filters) => {
  let invoices = readCollection('invoices');
  const customers = readCollection('customers');
  const properties = readCollection('properties');
  const vehicles = readCollection('vehicles');
  const users = readCollection('users');

  // Filtering
  if (filters?.status) invoices = invoices.filter(i => i.status === filters.status);
  if (filters?.customerId) invoices = invoices.filter(i => i.customer_id === filters.customerId);
  if (filters?.dateFrom) invoices = invoices.filter(i => (i.svc_date || i.created_at?.split('T')[0] || '') >= filters.dateFrom);
  if (filters?.dateTo) invoices = invoices.filter(i => (i.svc_date || i.created_at?.split('T')[0] || '') <= filters.dateTo);
  if (filters?.creationDateFrom) invoices = invoices.filter(i => (i.created_at?.split('T')[0] || '') >= filters.creationDateFrom);
  if (filters?.creationDateTo) invoices = invoices.filter(i => (i.created_at?.split('T')[0] || '') <= filters.creationDateTo);
  if (filters?.paymentStatus) invoices = invoices.filter(i => i.payment_status === filters.paymentStatus);
  if (filters?.paymentMethod) invoices = invoices.filter(i => i.payment_method === filters.paymentMethod);
  if (filters?.vehicleId) invoices = invoices.filter(i => i.vehicle_id === filters.vehicleId);
  if (filters?.driverId) invoices = invoices.filter(i => i.driver_id === filters.driverId);
  if (filters?.propertyCity) invoices = invoices.filter(i => i.property_city === filters.propertyCity);
  if (filters?.complete === true) invoices = invoices.filter(i => i.complete === true);
  if (filters?.complete === false) invoices = invoices.filter(i => !i.complete);
  if (filters?.jobCodes) invoices = invoices.filter(i => (i.job_codes || '').toLowerCase().includes(filters.jobCodes.toLowerCase()));
  if (filters?.wasteSiteId) invoices = invoices.filter(i => i.waste_site_id === filters.wasteSiteId);

  // Join related data
  const jobs = readCollection('jobs');
  invoices = invoices.map(i => {
    const cust = customers.find(c => c.id === i.customer_id) || null;
    const prop = properties.find(p => p.id === i.property_id) || null;
    const veh = vehicles.find(v => v.id === i.vehicle_id) || null;
    const drv = users.find(u => u.id === i.driver_id) || null;
    // Ensure job_id exists — fallback: find job by matching customer + svc_date
    let jobId = i.job_id;
    if (!jobId && i.customer_id && i.svc_date) {
      const matchJob = jobs.find(j => j.customer_id === i.customer_id && j.scheduled_date === i.svc_date);
      if (matchJob) jobId = matchJob.id;
    }
    return {
      ...i,
      job_id: jobId || null,
      customers: cust,
      property: prop,
      vehicle: veh,
      driver: drv,
      // Ensure display fields are populated from joins if not stored
      billing_company: i.billing_company || cust?.company || cust?.name || '',
      billing_city: cust?.city || prop?.city || '',
      property_address: i.property_address || prop?.address || '',
      property_city: i.property_city || prop?.city || '',
    };
  });

  // Sorting
  const sortField = filters?.sortField || 'svc_date';
  const sortDir = filters?.sortDir === 'asc' ? 1 : -1;
  invoices.sort((a, b) => {
    let va = a[sortField] ?? '';
    let vb = b[sortField] ?? '';
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sortDir;
    return String(va).localeCompare(String(vb)) * sortDir;
  });

  // Totals (before pagination)
  const totals = {
    count: invoices.length,
    invoice_total: invoices.reduce((s, i) => s + (i.total || 0), 0),
    amount_paid: invoices.reduce((s, i) => s + (i.amount_paid || 0), 0),
  };

  // Pagination
  const page = filters?.page || 1;
  const perPage = filters?.perPage || 25;
  const total = invoices.length;
  const start = (page - 1) * perPage;
  const paged = invoices.slice(start, start + perPage);

  return { data: paged, total, page, perPage, totals };
});

ipcMain.handle('get-invoice', async (e, id) => {
  const invoice = findById('invoices', id);
  if (invoice) {
    invoice.customers = findById('customers', invoice.customer_id);
    invoice.property = findById('properties', invoice.property_id);
    invoice.vehicle = findById('vehicles', invoice.vehicle_id);
    invoice.driver = findById('users', invoice.driver_id);
  }
  return { data: invoice };
});

ipcMain.handle('save-invoice', async (e, data) => {
  const saved = upsert('invoices', data);
  return { success: true, data: saved };
});

ipcMain.handle('delete-invoice', async (e, id) => {
  const invoices = readCollection('invoices');
  const inv = invoices.find(i => i.id === id);
  // Stamp the linked job so backfill won't recreate the invoice
  if (inv?.job_id) {
    const jobs = readCollection('jobs');
    const idx = jobs.findIndex(j => j.id === inv.job_id);
    if (idx >= 0) {
      jobs[idx] = { ...jobs[idx], invoice_suppressed: true, updated_at: new Date().toISOString() };
      writeCollection('jobs', jobs);
    }
  }
  remove('invoices', id);
  return { success: true };
});

ipcMain.handle('get-next-invoice-number', async () => {
  const invoices = readCollection('invoices');
  if (invoices.length === 0) return { number: '1' };
  const nums = invoices.map(i => parseInt((i.invoice_number || '0').replace(/\D/g, '')) || 0);
  const next = Math.max(...nums) + 1;
  return { number: String(next) };
});

ipcMain.handle('get-invoice-filter-options', async () => {
  const customers = readCollection('customers');
  const properties = readCollection('properties');
  const vehicles = readCollection('vehicles');
  const users = readCollection('users');
  const wasteSites = readCollection('waste_sites');

  const cities = [...new Set(properties.map(p => p.city).filter(Boolean))].sort();
  const states = [...new Set(properties.map(p => p.state).filter(Boolean))].sort();
  const counties = [...new Set(properties.map(p => p.county).filter(Boolean))].sort();
  const zips = [...new Set(properties.map(p => p.zip).filter(Boolean))].sort();

  return {
    customers: customers.map(c => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)),
    vehicles: vehicles.map(v => ({ id: v.id, name: v.name })).sort((a, b) => a.name.localeCompare(b.name)),
    drivers: users.map(u => ({ id: u.id, name: u.name })).sort((a, b) => a.name.localeCompare(b.name)),
    wasteSites: wasteSites.map(w => ({ id: w.id, name: w.name })).sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    cities, states, counties, zips,
  };
});

ipcMain.handle('backfill-invoices', async () => {
  const jobs = readCollection('jobs');
  const invoices = readCollection('invoices');
  const customers = readCollection('customers');
  const properties = readCollection('properties');
  const linkedJobIds = new Set(invoices.map(i => i.job_id).filter(Boolean));

  let created = 0;
  let nextNum = 1;
  if (invoices.length > 0) {
    const nums = invoices.map(i => parseInt((i.invoice_number || '0').replace(/\D/g, '')) || 0);
    nextNum = Math.max(...nums) + 1;
  }

  for (const job of jobs) {
    if (linkedJobIds.has(job.id)) continue; // already has invoice
    if (job.invoice_suppressed) continue; // invoice was manually deleted
    const customer = customers.find(c => c.id === job.customer_id);
    const property = properties.find(p => p.id === job.property_id);
    const totalGal = Object.values(job.gallons_pumped || {}).reduce((s, g) => s + (parseInt(g) || 0), 0);
    const lineItems = job.line_items || [];
    const subtotal = lineItems.reduce((s, li) => s + ((li.qty || 0) * (li.unit_price || 0)), 0);

    upsert('invoices', {
      invoice_number: String(nextNum++),
      job_id: job.id,
      customer_id: job.customer_id,
      property_id: job.property_id,
      svc_date: job.scheduled_date || null,
      vehicle_id: job.vehicle_id || null,
      driver_id: job.assigned_to || null,
      gallons_pumped: totalGal,
      job_codes: job.service_type || '',
      complete: job.status === 'completed',
      line_items: lineItems,
      subtotal,
      tax_rate: 0,
      tax_amount: 0,
      total: subtotal,
      status: 'draft',
      payment_status: 'unpaid',
      payment_method: '',
      amount_paid: 0,
      billing_company: customer?.company || customer?.name || '',
      property_address: property?.address || '',
      property_city: property?.city || '',
      notes: '',
    });
    created++;
  }
  return { created };
});

// ===== PAYMENTS / ACCOUNTING =====
ipcMain.handle('get-customer-balance', async (e, customerId) => {
  const invoices = readCollection('invoices').filter(i => i.customer_id === customerId);
  const totalInvoiced = invoices.reduce((s, i) => s + (parseFloat(i.total) || 0), 0);
  const totalPaid = invoices.reduce((s, i) => s + (parseFloat(i.amount_paid) || 0), 0);
  const balance = totalInvoiced - totalPaid;

  const now = Date.now();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  const overdue = invoices.some(i => {
    if (i.payment_status === 'paid') return false;
    const svcDate = i.svc_date ? new Date(i.svc_date).getTime() : null;
    return svcDate && (now - svcDate) > thirtyDays && (parseFloat(i.total) || 0) > (parseFloat(i.amount_paid) || 0);
  });

  return { balance, totalInvoiced, totalPaid, overdue, invoiceCount: invoices.length };
});

ipcMain.handle('get-payments', async (e, customerId) => {
  const payments = readCollection('payments').filter(p => p.customer_id === customerId);
  payments.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return { data: payments };
});

ipcMain.handle('save-payment', async (e, data) => {
  const saved = upsert('payments', data);

  // Update linked invoice amount_paid
  if (data.invoice_id) {
    const invoices = readCollection('invoices');
    const payments = readCollection('payments').filter(p => p.invoice_id === data.invoice_id);
    const totalPaidForInv = payments.reduce((s, p) => {
      if (p.type === 'refund') return s - (parseFloat(p.amount) || 0);
      return s + (parseFloat(p.amount) || 0);
    }, 0);

    const inv = invoices.find(i => i.id === data.invoice_id);
    if (inv) {
      inv.amount_paid = Math.max(0, totalPaidForInv);
      const invTotal = parseFloat(inv.total) || 0;
      if (inv.amount_paid >= invTotal && invTotal > 0) {
        inv.payment_status = 'paid';
      } else if (inv.amount_paid > 0) {
        inv.payment_status = 'partial';
      } else {
        inv.payment_status = 'unpaid';
      }
      writeCollection('invoices', invoices);
    }
  }

  return { success: true, data: saved };
});

ipcMain.handle('delete-payment', async (e, id) => {
  const payments = readCollection('payments');
  const payment = payments.find(p => p.id === id);
  const invoiceId = payment?.invoice_id;
  const filtered = payments.filter(p => p.id !== id);
  writeCollection('payments', filtered);

  // Recalculate invoice amount_paid
  if (invoiceId) {
    const invoices = readCollection('invoices');
    const remaining = filtered.filter(p => p.invoice_id === invoiceId);
    const totalPaidForInv = remaining.reduce((s, p) => {
      if (p.type === 'refund') return s - (parseFloat(p.amount) || 0);
      return s + (parseFloat(p.amount) || 0);
    }, 0);
    const inv = invoices.find(i => i.id === invoiceId);
    if (inv) {
      inv.amount_paid = Math.max(0, totalPaidForInv);
      const invTotal = parseFloat(inv.total) || 0;
      if (inv.amount_paid >= invTotal && invTotal > 0) {
        inv.payment_status = 'paid';
      } else if (inv.amount_paid > 0) {
        inv.payment_status = 'partial';
      } else {
        inv.payment_status = 'unpaid';
      }
      writeCollection('invoices', invoices);
    }
  }

  return { success: true };
});

// ===== REMINDERS =====
ipcMain.handle('get-reminders', async (e, filters) => {
  let reminders = readCollection('reminders');
  const users = readCollection('users');

  if (filters?.status) reminders = reminders.filter(r => r.status === filters.status);
  if (filters?.userId) reminders = reminders.filter(r => (r.assigned_users || []).includes(filters.userId));

  reminders = reminders.map(r => ({
    ...r,
    assigned_user_names: (r.assigned_users || []).map(uid => {
      const u = users.find(x => x.id === uid);
      return u ? { id: u.id, name: u.name, color: u.color || '#1565c0' } : null;
    }).filter(Boolean),
  }));

  reminders.sort((a, b) => {
    // Done at bottom, then by due_date ascending
    if (a.status === 'done' && b.status !== 'done') return 1;
    if (a.status !== 'done' && b.status === 'done') return -1;
    return (a.due_date || '').localeCompare(b.due_date || '') || (a.due_time || '').localeCompare(b.due_time || '');
  });
  return { data: reminders };
});

ipcMain.handle('save-reminder', async (e, data) => {
  const saved = upsert('reminders', data);
  return { success: true, data: saved };
});

ipcMain.handle('delete-reminder', async (e, id) => {
  remove('reminders', id);
  return { success: true };
});

ipcMain.handle('update-reminder-status', async (e, id, status) => {
  const reminders = readCollection('reminders');
  const idx = reminders.findIndex(r => r.id === id);
  if (idx >= 0) {
    reminders[idx].status = status;
    reminders[idx].updated_at = new Date().toISOString();
    if (status === 'done') reminders[idx].completed_at = new Date().toISOString();
    writeCollection('reminders', reminders);
    return { success: true };
  }
  return { success: false, error: 'Reminder not found' };
});

// ===== SERVICE CONTRACTS =====
ipcMain.handle('get-service-contracts', async (e, filters) => {
  let contracts = readCollection('service_contracts');
  const customers = readCollection('customers');
  const properties = readCollection('properties');
  if (filters?.customerId) contracts = contracts.filter(c => c.customer_id === filters.customerId);
  if (filters?.propertyId) contracts = contracts.filter(c => c.property_id === filters.propertyId);
  if (filters?.status) contracts = contracts.filter(c => c.status === filters.status);
  contracts = contracts.map(c => ({
    ...c,
    customer: customers.find(cu => cu.id === c.customer_id) || null,
    property: properties.find(p => p.id === c.property_id) || null,
  }));
  contracts.sort((a, b) => (b.start_date || '').localeCompare(a.start_date || ''));
  return { data: contracts };
});

ipcMain.handle('save-service-contract', async (e, data) => {
  const saved = upsert('service_contracts', data);
  return { success: true, data: saved };
});

ipcMain.handle('delete-service-contract', async (e, id) => {
  remove('service_contracts', id);
  return { success: true };
});

// ===== SERVICE DUE NOTICES =====
ipcMain.handle('get-service-due-notices', async (e, filters) => {
  let notices = readCollection('service_due_notices');
  const customers = readCollection('customers');
  const properties = readCollection('properties');
  const jobs = readCollection('jobs');
  const today = new Date().toISOString().split('T')[0];

  if (filters?.id) notices = notices.filter(n => n.id === filters.id);
  if (filters?.customerId) notices = notices.filter(n => n.customer_id === filters.customerId);
  if (filters?.propertyId) notices = notices.filter(n => n.property_id === filters.propertyId);
  if (filters?.status) {
    if (filters.status === 'overdue') {
      notices = notices.filter(n => n.status === 'pending' && n.due_date && n.due_date <= today);
    } else {
      notices = notices.filter(n => n.status === filters.status);
    }
  }
  if (filters?.dueDateFrom) notices = notices.filter(n => n.due_date >= filters.dueDateFrom);
  if (filters?.dueDateTo) notices = notices.filter(n => n.due_date <= filters.dueDateTo);
  if (filters?.search) {
    const q = filters.search.toLowerCase();
    notices = notices.filter(n => {
      const cust = customers.find(c => c.id === n.customer_id);
      const prop = properties.find(p => p.id === n.property_id);
      return (cust?.name || '').toLowerCase().includes(q) ||
             (prop?.address || '').toLowerCase().includes(q) ||
             (n.service_type || '').toLowerCase().includes(q);
    });
  }

  notices = notices.map(n => {
    const cust = customers.find(c => c.id === n.customer_id) || null;
    const prop = properties.find(p => p.id === n.property_id) || null;
    const job = n.job_id ? jobs.find(j => j.id === n.job_id) || null : null;
    const is_overdue = n.status === 'pending' && n.due_date && n.due_date <= today;
    const daysUntilDue = n.due_date ? Math.ceil((new Date(n.due_date) - new Date(today)) / 86400000) : null;
    return { ...n, customer: cust, property: prop, job, is_overdue, days_until_due: daysUntilDue };
  });

  // Sort: overdue first, then by due date ascending
  notices.sort((a, b) => {
    if (a.is_overdue && !b.is_overdue) return -1;
    if (!a.is_overdue && b.is_overdue) return 1;
    return (a.due_date || '').localeCompare(b.due_date || '');
  });

  return { data: notices };
});

ipcMain.handle('save-service-due-notice', async (e, data) => {
  const saved = upsert('service_due_notices', data);
  return { success: true, data: saved };
});

ipcMain.handle('delete-service-due-notice', async (e, id) => {
  remove('service_due_notices', id);
  return { success: true };
});

ipcMain.handle('send-service-due-notification', async (e, id, daysBeforeDue) => {
  const settingsPath = path.join(userDataPath, 'settings.json');
  if (!fs.existsSync(settingsPath)) return { success: false, error: 'SMTP not configured' };
  
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  if (!settings.smtp_host) return { success: false, error: 'SMTP not configured' };

  const notices = readCollection('service_due_notices');
  const notice = notices.find(n => n.id === id);
  if (!notice) return { success: false, error: 'Notice not found' };

  const customers = readCollection('customers');
  const properties = readCollection('properties');
  const cust = customers.find(c => c.id === notice.customer_id);
  const prop = properties.find(p => p.id === notice.property_id);

  if (!cust?.email) return { success: false, error: 'Customer has no email' };

  try {
    const transporter = nodemailer.createTransport({
      host: settings.smtp_host,
      port: parseInt(settings.smtp_port) || 587,
      secure: parseInt(settings.smtp_port) === 465,
      auth: { user: settings.smtp_user, pass: settings.smtp_pass },
    });

    const companyName = settings.company_name || 'Interstate Septic';
    const companyPhone = settings.company_phone || '';
    const serviceType = notice.service_type || 'Septic Service';
    const propAddr = prop ? `${prop.address || ''}, ${prop.city || ''} ${prop.state || ''} ${prop.zip || ''}`.trim() : 'your property';

    const daysText = daysBeforeDue === 0 ? 'today' : `in ${daysBeforeDue} day${daysBeforeDue > 1 ? 's' : ''}`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <h2 style="color:#1b5e20;">${companyName}</h2>
        <p>Dear ${cust.name || 'Valued Customer'},</p>
        <p>This is a reminder that your <strong>${serviceType}</strong> service at <strong>${propAddr}</strong> is due <strong>${daysText}</strong>.</p>
        <p>Please contact us to schedule your appointment at your earliest convenience.</p>
        ${companyPhone ? `<p>Phone: <strong>${companyPhone}</strong></p>` : ''}
        <p>Thank you for your business!</p>
        <hr style="border:none;border-top:1px solid #ddd;margin:20px 0;">
        <p style="font-size:12px;color:#999;">This is a reminder from ${companyName}.</p>
      </div>`;

    await transporter.sendMail({
      from: settings.smtp_user,
      to: cust.email,
      subject: `${serviceType} Reminder (${daysText}) - ${companyName}`,
      html,
    });

    return { success: true, message: `Notification sent to ${cust.email}` };
  } catch (err) {
    console.error('[MAIL ERROR]', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('schedule-service-due-notifications', async (e, id, schedule) => {
  const notices = readCollection('service_due_notices');
  const notice = notices.find(n => n.id === id);
  if (!notice) return { success: false, error: 'Notice not found' };

  notice.notification_schedule = schedule || [];
  writeCollection('service_due_notices', notices);
  return { success: true, data: notice };
});

// ===== DISPOSAL LOADS =====
ipcMain.handle('get-disposal-loads', async (e, filters) => {
  let loads = readCollection('disposal_loads');
  const customers = readCollection('customers');
  const users = readCollection('users');

  if (filters?.dateFrom && filters?.dateTo) {
    loads = loads.filter(l => l.disposal_date >= filters.dateFrom && l.disposal_date <= filters.dateTo);
  }

  loads = loads.map(l => ({
    ...l,
    customers: customers.find(c => c.id === l.customer_id) || null,
    users: users.find(u => u.id === l.driver) || null,
  }));

  loads.sort((a, b) => (b.disposal_date || '').localeCompare(a.disposal_date || ''));
  return { data: loads };
});

ipcMain.handle('get-next-disposal-number', async () => {
  const loads = readCollection('disposal_loads');
  const nums = loads
    .map(l => parseInt((l.disposal_number || '').toString().replace(/\D/g, '')) || 0)
    .filter(n => n > 0);
  const highest = nums.length > 0 ? Math.max(...nums) : 999;
  return { data: Math.max(highest + 1, 1000) };
});

ipcMain.handle('save-disposal-load', async (e, data) => {
  // Auto-assign a disposal number if this is a new record without one
  if (!data.id && !data.disposal_number) {
    const loads = readCollection('disposal_loads');
    const nums = loads
      .map(l => parseInt((l.disposal_number || '').toString().replace(/\D/g, '')) || 0)
      .filter(n => n > 0);
    const highest = nums.length > 0 ? Math.max(...nums) : 999;
    data.disposal_number = String(Math.max(highest + 1, 1000));
  }
  const saved = upsert('disposal_loads', data);
  return { success: true, data: saved };
});

ipcMain.handle('delete-disposal-load', async (e, id) => {
  remove('disposal_loads', id);
  return { success: true };
});

ipcMain.handle('get-disposal-summary', async (e, period) => {
  let loads = readCollection('disposal_loads');
  const customers = readCollection('customers');

  loads = loads.filter(l => l.disposal_date >= period.from && l.disposal_date <= period.to);
  loads = loads.map(l => ({
    ...l,
    customers: customers.find(c => c.id === l.customer_id) || null,
  }));
  loads.sort((a, b) => (a.disposal_date || '').localeCompare(b.disposal_date || ''));

  const totalGallons = loads.reduce((sum, l) => sum + (l.volume_gallons || 0), 0);
  return { data: { loads, totalGallons, totalLoads: loads.length } };
});

// ===== SCHEDULE ITEMS (manifests & driver changes on schedule) =====
ipcMain.handle('get-schedule-items', async (e, vehicleId, date) => {
  let items = readCollection('schedule_items');
  if (vehicleId) items = items.filter(i => i.vehicle_id === vehicleId);
  if (date) items = items.filter(i => i.scheduled_date === date);
  items.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  return { data: items };
});

ipcMain.handle('save-schedule-item', async (e, data) => {
  const saved = upsert('schedule_items', data);
  return { success: true, data: saved };
});

ipcMain.handle('delete-schedule-item', async (e, id) => {
  remove('schedule_items', id);
  return { success: true };
});

ipcMain.handle('get-next-manifest-number', async () => {
  const items = readCollection('schedule_items');
  const manifests = items.filter(i => i.item_type === 'manifest' && i.manifest_number);
  const nums = manifests.map(m => parseInt(m.manifest_number) || 0);
  const highest = nums.length > 0 ? Math.max(...nums) : 999;
  return { data: Math.max(highest + 1, 1000) };
});

// ===== WASTE SITES =====
ipcMain.handle('get-waste-sites', async () => {
  const sites = readCollection('waste_sites');
  sites.sort((a, b) => {
    if (a.is_default && !b.is_default) return -1;
    if (!a.is_default && b.is_default) return 1;
    return (a.name || '').localeCompare(b.name || '');
  });
  return { data: sites };
});

ipcMain.handle('save-waste-site', async (e, data) => {
  // If setting as default, clear default on all others first
  if (data.is_default) {
    const sites = readCollection('waste_sites');
    sites.forEach(s => { s.is_default = false; });
    writeCollection('waste_sites', sites);
  }
  const saved = upsert('waste_sites', data);
  return { success: true, data: saved };
});

ipcMain.handle('delete-waste-site', async (e, id) => {
  remove('waste_sites', id);
  return { success: true };
});

ipcMain.handle('get-default-waste-site', async () => {
  const sites = readCollection('waste_sites');
  const defaultSite = sites.find(s => s.is_default);
  return { data: defaultSite || null };
});

// ===== OUTSIDE PUMPERS =====
ipcMain.handle('get-outside-pumpers', async () => {
  const pumpers = readCollection('outside_pumpers');
  pumpers.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return { data: pumpers };
});

ipcMain.handle('save-outside-pumper', async (e, data) => {
  const saved = upsert('outside_pumpers', data);
  return { success: true, data: saved };
});

ipcMain.handle('delete-outside-pumper', async (e, id) => {
  remove('outside_pumpers', id);
  return { success: true };
});

// ===== SEED TEST DATA =====
// ===== DEP REPORTS =====
ipcMain.handle('get-dep-reports', async () => {
  const reports = readCollection('dep_reports');
  reports.sort((a, b) => (b.generated_at || '').localeCompare(a.generated_at || ''));
  return { data: reports };
});

ipcMain.handle('generate-dep-report', async (e, period) => {
  let loads = readCollection('disposal_loads');
  const customers = readCollection('customers');

  loads = loads.filter(l => l.disposal_date >= period.from && l.disposal_date <= period.to);
  loads = loads.map(l => ({
    ...l,
    customers: customers.find(c => c.id === l.customer_id) || null,
  }));
  loads.sort((a, b) => (a.disposal_date || '').localeCompare(b.disposal_date || ''));

  const totalGallons = loads.reduce((sum, l) => sum + (l.volume_gallons || 0), 0);

  const report = {
    report_period: period.label,
    total_gallons: totalGallons,
    total_loads: loads.length,
    report_data: loads,
    generated_at: new Date().toISOString(),
  };

  const saved = upsert('dep_reports', report);
  return { success: true, data: saved };
});

ipcMain.handle('send-dep-report', async (e, reportId) => {
  const reports = readCollection('dep_reports');
  const idx = reports.findIndex(r => r.id === reportId);
  if (idx >= 0) {
    reports[idx].sent_at = new Date().toISOString();
    writeCollection('dep_reports', reports);
    return { success: true };
  }
  return { success: false, error: 'Report not found' };
});

// ===== SETTINGS =====
ipcMain.handle('get-settings', async () => {
  const settingsPath = path.join(userDataPath, 'settings.json');
  if (fs.existsSync(settingsPath)) {
    return { data: JSON.parse(fs.readFileSync(settingsPath, 'utf8')) };
  }
  return { data: null };
});

ipcMain.handle('save-settings', async (e, data) => {
  const settingsPath = path.join(userDataPath, 'settings.json');
  data.updated_at = new Date().toISOString();
  fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2));
  return { success: true, data };
});

// ===== TANK TYPES =====
const DEFAULT_TANK_TYPES = [
  { name: 'Septic Tank',          waste_code: 'S',  disposal_label: 'Septic Tank Waste Disposal',       pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 1  },
  { name: 'Septic Tank+Filter',   waste_code: 'S',  disposal_label: 'Septic Tank Waste Disposal',       pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 2  },
  { name: 'Holding Tank',         waste_code: 'H',  disposal_label: 'Holding Tank Waste Disposal',      pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 3  },
  { name: 'Grease Trap',          waste_code: 'G',  disposal_label: 'Grease Trap Waste Disposal',       pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 4  },
  { name: 'Interior Grease Trap', waste_code: 'Ig', disposal_label: 'Grease Trap Waste Disposal',       pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 5  },
  { name: 'Cesspool',             waste_code: 'C',  disposal_label: 'Cesspool Waste Disposal',          pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 6  },
  { name: 'Aerobic System',       waste_code: 'As', disposal_label: 'Aerobic System Waste Disposal',    pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 7  },
  { name: 'Pump Chamber',         waste_code: 'P',  disposal_label: 'Septic Waste Disposal',            pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 8  },
  { name: 'Distribution Box',     waste_code: 'Db', disposal_label: '',                                 pumping_price: 250, disposal_price: 0,   generates_disposal: false, sort_order: 9  },
  { name: 'Drain Clearing',       waste_code: 'Dc', disposal_label: '',                                 pumping_price: 250, disposal_price: 0,   generates_disposal: false, sort_order: 10 },
  { name: 'Wet Well',             waste_code: 'Ls', disposal_label: 'Wet Well Waste Disposal',          pumping_price: 250, disposal_price: 140, generates_disposal: true,  sort_order: 11 },
  { name: 'Other',                waste_code: '',   disposal_label: 'Waste Disposal',                   pumping_price: 250, disposal_price: 140, generates_disposal: false, sort_order: 99 },
];

ipcMain.handle('get-tank-types', async () => {
  let types = readCollection('tank_types');
  if (!types || types.length === 0) {
    types = DEFAULT_TANK_TYPES.map((t, i) => ({ id: uuidv4(), ...t }));
    writeCollection('tank_types', types);
  }
  // Patch: Pump Chamber should generate septic disposal (old data had it disabled)
  let patched = false;
  types = types.map(tt => {
    if (tt.name === 'Pump Chamber' && !tt.generates_disposal) {
      patched = true;
      return { ...tt, generates_disposal: true, disposal_label: 'Septic Waste Disposal', disposal_price: 140 };
    }
    return tt;
  });
  if (patched) writeCollection('tank_types', types);
  return { data: types.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)) };
});

ipcMain.handle('save-tank-type', async (e, data) => {
  const saved = upsert('tank_types', data);
  return { success: true, data: saved };
});

ipcMain.handle('delete-tank-type', async (e, id) => {
  deleteItem('tank_types', id);
  return { success: true };
});

// ===== SERVICE CATEGORIES & PRODUCTS =====
ipcMain.handle('get-service-categories', async () => {
  const cats = readCollection('service_categories');
  const products = readCollection('service_products');
  // Attach products to each category
  const result = cats.map(c => ({
    ...c,
    products: products.filter(p => p.category_id === c.id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
  }));
  result.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  return { data: result };
});

ipcMain.handle('save-service-category', async (e, data) => {
  const saved = upsert('service_categories', data);
  return { success: true, data: saved };
});

ipcMain.handle('delete-service-category', async (e, id) => {
  // Also delete products in this category
  const remaining = readCollection('service_products').filter(p => p.category_id !== id);
  writeCollection('service_products', remaining);
  remove('service_categories', id);
  return { success: true };
});

ipcMain.handle('get-service-products', async (e, categoryId) => {
  let products = readCollection('service_products');
  if (categoryId) products = products.filter(p => p.category_id === categoryId);
  products.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  return { data: products };
});

ipcMain.handle('save-service-product', async (e, data) => {
  const saved = upsert('service_products', data);
  return { success: true, data: saved };
});

ipcMain.handle('delete-service-product', async (e, id) => {
  remove('service_products', id);
  return { success: true };
});

// ===== USERS (TECHS) =====
ipcMain.handle('get-users', async () => {
  const users = readCollection('users');
  users.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return { data: users };
});

ipcMain.handle('delete-user', async (e, id) => {
  remove('users', id);
  return { success: true };
});

// ===== AUTH =====
ipcMain.handle('auth-needs-setup', async () => {
  const users = readCollection('users');
  // Need setup if no users have a username/password set
  const hasAuth = users.some(u => u.username && u.password_hash);
  return { needsSetup: !hasAuth };
});

ipcMain.handle('auth-setup', async (e, data) => {
  // First time setup - create admin account
  const salt = bcrypt.genSaltSync(10);
  const hash = bcrypt.hashSync(data.password, salt);
  const user = {
    name: data.name,
    phone: data.phone || '',
    username: data.username.toLowerCase(),
    password_hash: hash,
    role: 'admin',
  };
  const saved = upsert('users', user);
  return { success: true, data: { id: saved.id, name: saved.name, role: saved.role, username: saved.username } };
});

ipcMain.handle('auth-login', async (e, username, password) => {
  const users = readCollection('users');
  const user = users.find(u => u.username && u.username.toLowerCase() === username.toLowerCase());
  if (!user) return { success: false, error: 'Invalid username or password.' };
  if (!user.password_hash) return { success: false, error: 'Account not set up. Contact admin.' };

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) return { success: false, error: 'Invalid username or password.' };

  // Save credentials to file so they survive force-quit
  saveCreds(username, password);
  return { success: true, data: { id: user.id, name: user.name, role: user.role, username: user.username } };
});

ipcMain.handle('get-saved-creds', async () => {
  return getSavedCreds();
});

ipcMain.handle('clear-saved-creds', async () => {
  clearCreds();
  return { success: true };
});

ipcMain.handle('save-user', async (e, data) => {
  // If password is provided, hash it
  if (data.password && data.password.trim()) {
    const salt = bcrypt.genSaltSync(10);
    data.password_hash = bcrypt.hashSync(data.password, salt);
  }
  delete data.password; // Never store plain password
  const saved = upsert('users', data);
  return { success: true, data: saved };
});

ipcMain.handle('change-password', async (e, userId, newPassword) => {
  const users = readCollection('users');
  const idx = users.findIndex(u => u.id === userId);
  if (idx < 0) return { success: false, error: 'User not found.' };

  const salt = bcrypt.genSaltSync(10);
  users[idx].password_hash = bcrypt.hashSync(newPassword, salt);
  users[idx].updated_at = new Date().toISOString();
  writeCollection('users', users);
  return { success: true };
});

// ===== PDF GENERATION =====
ipcMain.handle('generate-pdf', async (e, html, filename, options = {}) => {
  const isLandscape = html.includes('size: landscape') || html.includes('data-landscape');

  // Determine save path — show Save As dialog unless skipDialog is set
  let savePath;
  if (options.skipDialog) {
    savePath = options.forcePath || path.join(userDataPath, filename || 'export.pdf');
  } else {
    const settings = (() => { try { return readCollection('settings')[0] || {}; } catch { return {}; } })();
    const defaultDir = settings.default_pdf_folder || app.getPath('documents');
    const dialogResult = await dialog.showSaveDialog(mainWindow, {
      title: 'Save PDF',
      defaultPath: path.join(defaultDir, filename || 'export.pdf'),
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    });
    if (dialogResult.canceled || !dialogResult.filePath) return { success: false, canceled: true };
    savePath = dialogResult.filePath;
  }

  const pdfWindow = new BrowserWindow({ show: false, width: isLandscape ? 1056 : 816, height: isLandscape ? 816 : 1056 });
  pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  return new Promise((resolve) => {
    pdfWindow.webContents.on('did-finish-load', async () => {
      setTimeout(async () => {
        try {
          const pdfData = await pdfWindow.webContents.printToPDF({
            printBackground: true,
            marginsType: 0,
            landscape: isLandscape,
            margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
          });
          fs.writeFileSync(savePath, pdfData);
          pdfWindow.close();
          resolve({ success: true, path: savePath });
        } catch (err) {
          pdfWindow.close();
          resolve({ success: false, error: err.message });
        }
      }, 500);
    });
  });
});

// ===== EMAIL =====
ipcMain.handle('send-email', async (e, to, subject, body, attachmentPath) => {
  const settingsPath = path.join(userDataPath, 'settings.json');
  if (!fs.existsSync(settingsPath)) return { success: false, error: 'Email not configured. Go to Settings.' };
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

  if (!settings.smtp_host) return { success: false, error: 'Email not configured. Go to Settings.' };

  const transporter = nodemailer.createTransport({
    host: settings.smtp_host,
    port: parseInt(settings.smtp_port) || 587,
    secure: parseInt(settings.smtp_port) === 465,
    auth: { user: settings.smtp_user, pass: settings.smtp_pass },
  });

  const mailOptions = {
    from: settings.smtp_user,
    to,
    subject,
    html: body,
  };

  if (attachmentPath && fs.existsSync(attachmentPath)) {
    mailOptions.attachments = [{ path: attachmentPath }];
  }

  try {
    await transporter.sendMail(mailOptions);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ===== SERVICE DUE NOTICE AUTO-EMAIL CHECK =====
function buildReminderEmail(cust, prop, serviceType, label, dueDate, companyName, companyPhone, confirmToken) {
  const propAddr = prop
    ? `${prop.address || ''}, ${prop.city || ''} ${prop.state || ''} ${prop.zip || ''}`.trim()
    : 'your property';

  let timingText;
  if (label === 'Day Of') {
    timingText = `<strong>today</strong>`;
  } else if (label && label.includes('After')) {
    timingText = `<strong>overdue</strong> — it was due on ${dueDate}`;
  } else {
    timingText = `due on <strong>${dueDate}</strong> (${label ? label.toLowerCase() : 'soon'})`;
  }

  const { publicUrl, port } = getServerSettings();
  const baseUrl = publicUrl || `http://localhost:${port}`;
  const confirmUrl = confirmToken ? `${baseUrl}/confirm?token=${confirmToken}` : null;

  const confirmBlock = confirmUrl ? `
    <div style="margin:24px 0;text-align:center;">
      <a href="${confirmUrl}" style="display:inline-block;background:#2e7d32;color:white;text-decoration:none;padding:14px 28px;border-radius:6px;font-size:16px;font-weight:bold;">
        ✓ Confirm / I'll Schedule My Appointment
      </a>
      <p style="margin-top:10px;font-size:12px;color:#999;">Clicking this button will stop further reminders for this notice.</p>
    </div>` : '';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="color:#1b5e20;">${companyName}</h2>
      <p>Dear ${cust.name || 'Valued Customer'},</p>
      <p>This is a friendly reminder that your <strong>${serviceType}</strong> service at <strong>${propAddr}</strong> is ${timingText}.</p>
      <p>Please contact us at your earliest convenience to schedule your appointment.</p>
      ${companyPhone ? `<p>Phone: <strong>${companyPhone}</strong></p>` : ''}
      ${confirmBlock}
      <p>Thank you for your business!</p>
      <hr style="border:none;border-top:1px solid #ddd;margin:20px 0;">
      <p style="font-size:12px;color:#999;">This is an automated reminder from ${companyName}. If you have already scheduled your appointment, you may disregard this message.</p>
    </div>`;

  const subject = label === 'Day Of'
    ? `${serviceType} Service Due Today - ${companyName}`
    : `${serviceType} Reminder: ${label} - ${companyName}`;

  return { html, subject };
}

async function checkDueNotices() {
  try {
    const settingsPath = path.join(userDataPath, 'settings.json');
    if (!fs.existsSync(settingsPath)) return;
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (!settings.smtp_host) return;

    let notices = readCollection('service_due_notices');
    const customers = readCollection('customers');
    const properties = readCollection('properties');
    const today = new Date().toISOString().split('T')[0];

    const companyName = settings.company_name || 'Interstate Septic';
    const companyPhone = settings.company_phone || '';

    const transporter = nodemailer.createTransport({
      host: settings.smtp_host,
      port: parseInt(settings.smtp_port) || 587,
      secure: parseInt(settings.smtp_port) === 465,
      auth: { user: settings.smtp_user, pass: settings.smtp_pass },
    });

    let dirty = false;

    for (let i = 0; i < notices.length; i++) {
      const n = notices[i];
      if (n.email_enabled === false || n.method === 'mail' || n.method === 'phone') continue;
      if (n.status === 'confirmed') continue; // Customer confirmed — stop all reminders

      const cust = customers.find(c => c.id === n.customer_id);
      const prop = properties.find(p => p.id === n.property_id);
      if (!cust?.email) continue;

      const serviceType = n.service_type || 'Septic Service';

      // --- Process auto-schedule items ---
      if (Array.isArray(n.notification_schedule) && n.notification_schedule.length > 0) {
        let scheduleDirty = false;
        const updatedSchedule = n.notification_schedule.map(item => {
          if (item.sent || !item.send_date || item.send_date > today) return item;
          return { ...item, _pendingSend: true };
        });

        for (let s = 0; s < updatedSchedule.length; s++) {
          const item = updatedSchedule[s];
          if (!item._pendingSend) continue;
          const { html, subject } = buildReminderEmail(cust, prop, serviceType, item.label, n.due_date, companyName, companyPhone, n.confirm_token);
          try {
            await transporter.sendMail({ from: settings.smtp_user, to: cust.email, subject, html });
            const { _pendingSend, ...rest } = item;
            updatedSchedule[s] = { ...rest, sent: true, sent_at: new Date().toISOString() };
            scheduleDirty = true;
            console.log(`[SDN] Sent "${item.label}" reminder to ${cust.email} for notice ${n.id}`);
          } catch (err) {
            const { _pendingSend, ...rest } = item;
            updatedSchedule[s] = rest; // remove flag but don't mark sent so it retries
            console.error(`[SDN] Failed to send "${item.label}" to ${cust.email}:`, err.message);
          }
        }

        if (scheduleDirty) {
          notices[i] = { ...n, notification_schedule: updatedSchedule, updated_at: new Date().toISOString() };
          dirty = true;
        }
        continue; // Skip legacy fallback for notices with a schedule
      }

      // --- Legacy fallback: send once when due_date arrives ---
      if (n.status === 'pending' && n.due_date && n.due_date <= today) {
        const { html, subject } = buildReminderEmail(cust, prop, serviceType, 'Day Of', n.due_date, companyName, companyPhone, n.confirm_token);
        try {
          await transporter.sendMail({ from: settings.smtp_user, to: cust.email, subject, html });
          notices[i] = { ...n, status: 'sent', sent_date: new Date().toISOString(), updated_at: new Date().toISOString() };
          dirty = true;
        } catch (err) {
          console.error(`[SDN] Failed to send legacy reminder to ${cust.email}:`, err.message);
        }
      }
    }

    if (dirty) writeCollection('service_due_notices', notices);
  } catch (err) {
    console.error('checkDueNotices error:', err.message);
  }
}

ipcMain.handle('check-due-notices', async () => {
  await checkDueNotices();
  return { success: true };
});

ipcMain.handle('restart-confirm-server', async () => {
  restartConfirmServer();
  const { port } = getServerSettings();
  return { success: true, port };
});

ipcMain.handle('get-confirm-server-status', async () => {
  const { port, publicUrl } = getServerSettings();
  return { running: !!confirmServer, port, publicUrl };
});

ipcMain.handle('set-auto-start', async (e, enabled) => {
  app.setLoginItemSettings({ openAtLogin: !!enabled });
  return { success: true, enabled: !!enabled };
});

ipcMain.handle('get-auto-start', async () => {
  const { openAtLogin } = app.getLoginItemSettings();
  return { enabled: openAtLogin };
});

async function checkJobReminders() {
  try {
    const settingsPath = path.join(userDataPath, 'settings.json');
    if (!fs.existsSync(settingsPath)) return;
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (!settings.smtp_host) return;

    const jobs = readCollection('jobs');
    const customers = readCollection('customers');
    const properties = readCollection('properties');
    
    // Calculate tomorrow's date
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    // Find jobs scheduled for tomorrow that haven't had reminders sent yet
    const jobsForTomorrow = jobs.filter(j => 
      j.scheduled_date === tomorrowStr && 
      (!j.reminder_sent || j.reminder_sent !== tomorrowStr)
    );

    if (jobsForTomorrow.length === 0) return;

    const transporter = nodemailer.createTransport({
      host: settings.smtp_host,
      port: parseInt(settings.smtp_port) || 587,
      secure: parseInt(settings.smtp_port) === 465,
      auth: { user: settings.smtp_user, pass: settings.smtp_pass },
    });

    const companyName = settings.company_name || 'Interstate Septic';
    const companyPhone = settings.company_phone || '';

    for (const job of jobsForTomorrow) {
      const cust = customers.find(c => c.id === job.customer_id);
      const prop = properties.find(p => p.id === job.property_id);
      if (!cust?.email) continue;

      const scheduledDate = new Date(job.scheduled_date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      const propAddr = prop ? `${prop.address || ''}, ${prop.city || ''} ${prop.state || ''} ${prop.zip || ''}`.trim() : 'your property';

      const html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <h2 style="color:#1b5e20;">${companyName}</h2>
          <p>Dear ${cust.name || 'Valued Customer'},</p>
          <p>This is a friendly reminder of your scheduled service appointment <strong>tomorrow (${scheduledDate})</strong>.</p>
          <div style="background:#f0f7ff;padding:16px;border-left:4px solid #2196F3;border-radius:4px;margin:20px 0;">
            <p style="margin:8px 0;"><strong>Service Date:</strong> ${scheduledDate}</p>
            <p style="margin:8px 0;"><strong>Service Type:</strong> ${job.service_type || 'Service'}</p>
            <p style="margin:8px 0;"><strong>Property:</strong> ${propAddr}</p>
            ${job.notes ? `<p style="margin:8px 0;"><strong>Notes:</strong> ${job.notes}</p>` : ''}
          </div>
          <p>If you need to reschedule, please contact us as soon as possible.</p>
          ${companyPhone ? `<p>Phone: <strong>${companyPhone}</strong></p>` : ''}
          <p>We look forward to serving you!</p>
          <hr style="border:none;border-top:1px solid #ddd;margin:20px 0;">
          <p style="font-size:12px;color:#999;">This is an automated reminder from ${companyName}.</p>
        </div>`;

      try {
        await transporter.sendMail({
          from: settings.smtp_user,
          to: cust.email,
          subject: `Appointment Reminder for Tomorrow - ${companyName}`,
          html,
        });
        // Mark reminder as sent
        job.reminder_sent = tomorrowStr;
        job.updated_at = new Date().toISOString();
      } catch (err) {
        console.error(`Failed to send job reminder email to ${cust.email}:`, err.message);
      }
    }

    writeCollection('jobs', jobs);
  } catch (err) {
    console.error('checkJobReminders error:', err.message);
  }
}

// ===== REMINDER ALERTS =====
const _firedReminderAlerts = new Set();

function checkReminderAlerts() {
  try {
    const reminders = readCollection('reminders');
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    for (const r of reminders) {
      if (r.status === 'done' || !r.alert_before || !r.due_date) continue;
      if (_firedReminderAlerts.has(r.id)) continue;

      // Build the reminder datetime
      const rDateStr = r.due_date;
      const rTimeStr = r.due_time || '09:00'; // default to 9am if no time
      const reminderDT = new Date(`${rDateStr}T${rTimeStr}:00`);

      // Calculate alert time based on alert_before setting
      let alertDT;
      switch (r.alert_before) {
        case '15m':
          alertDT = new Date(reminderDT.getTime() - 15 * 60 * 1000);
          break;
        case '1h':
          alertDT = new Date(reminderDT.getTime() - 60 * 60 * 1000);
          break;
        case 'start_of_day':
          alertDT = new Date(`${rDateStr}T08:00:00`);
          break;
        case '1d':
          alertDT = new Date(reminderDT.getTime() - 24 * 60 * 60 * 1000);
          break;
        case '7d':
          alertDT = new Date(reminderDT.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        default:
          continue;
      }

      // Fire if alert time has passed but we haven't fired yet
      if (now >= alertDT) {
        _firedReminderAlerts.add(r.id);
        const alertLabel = { '15m': '15 min before', '1h': '1 hour before', 'start_of_day': 'Start of day', '1d': 'Day before', '7d': '7 days before' }[r.alert_before] || '';
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('reminder-alert', {
            id: r.id,
            message: r.message,
            due_date: r.due_date,
            due_time: r.due_time,
            alertLabel
          });
        }
      }
    }
  } catch (err) {
    console.error('checkReminderAlerts error:', err.message);
  }
}

// ===== FILE OPERATIONS =====
ipcMain.handle('show-save-dialog', async (e, options) => {
  return await dialog.showSaveDialog(mainWindow, options);
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Default PDF Save Folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };
  return { folderPath: result.filePaths[0] };
});

ipcMain.handle('open-file', async (e, filePath) => {
  shell.openPath(filePath);
});

// ===== SEED TEST DATA =====
ipcMain.handle('seed-test-data', async () => {
  const vehicles = readCollection('vehicles');
  if (vehicles.length === 0) return { success: false, error: 'No vehicles found. Add trucks first.' };

  const existingJobs = readCollection('jobs');
  const today = new Date().toISOString().split('T')[0]; // e.g. 2026-03-14
  const todayJobs = existingJobs.filter(j => j.scheduled_date === today);
  if (todayJobs.length > 0) return { success: false, error: `Already ${todayJobs.length} jobs for ${today}. Delete them first or pick another date.` };

  const maineNames = [
    'Robert & Linda Thompson', 'James & Susan Mitchell', 'David & Nancy Anderson',
    'Michael & Karen Roberts', 'William & Patricia Clark', 'Richard & Barbara Lewis',
    'Charles & Margaret Walker', 'Thomas & Dorothy Hall', 'Daniel & Sandra Young',
    'Paul & Betty Allen', 'Mark & Helen King', 'Steven & Ruth Wright',
    'Edward & Sharon Hill', 'Brian & Laura Scott', 'George & Diane Green',
    'Kenneth & Cynthia Adams', 'Ronald & Kathleen Baker', 'Timothy & Deborah Nelson',
    'Jeffrey & Carolyn Carter', 'Gary & Janet Campbell', 'Dennis & Martha Parker',
    'Peter & Ann Evans', 'Larry & Marie Edwards', 'Frank & Virginia Collins',
    'Raymond & Judy Stewart', 'Jerry & Cheryl Morris', 'Douglas & Teresa Murphy',
    'Henry & Gloria Rogers', 'Carl & Jean Reed', 'Arthur & Rose Cook',
    'Wayne & Alice Morgan', 'Roy & Frances Bell', 'Eugene & Evelyn Howard'
  ];
  // Real midcoast Maine addresses for accurate geocoding
  const maineAddresses = [
    { address: '18 Simmons Rd', city: 'Camden', zip: '04843' },
    { address: '104 Main St', city: 'Rockland', zip: '04841' },
    { address: '22 Pascal Ave', city: 'Rockport', zip: '04856' },
    { address: '85 Beechwood St', city: 'Thomaston', zip: '04861' },
    { address: '574 West St', city: 'Rockport', zip: '04856' },
    { address: '40 Knox St', city: 'Thomaston', zip: '04861' },
    { address: '15 Spruce Head Rd', city: 'South Thomaston', zip: '04858' },
    { address: '126 Moore Rd', city: 'Warren', zip: '04864' },
    { address: '2966 Atlantic Hwy', city: 'Waldoboro', zip: '04572' },
    { address: '33 Elm St', city: 'Camden', zip: '04843' },
    { address: '250 Camden St', city: 'Rockland', zip: '04841' },
    { address: '11 Mountain St', city: 'Camden', zip: '04843' },
    { address: '44 Mechanic St', city: 'Rockland', zip: '04841' },
    { address: '68 Old County Rd', city: 'Rockland', zip: '04841' },
    { address: '1 Pie Ln', city: 'Waldoboro', zip: '04572' },
    { address: '190 Union St', city: 'Rockport', zip: '04856' },
    { address: '12 Island Ave', city: 'Spruce Head', zip: '04859' },
    { address: '75 Cross St', city: 'Rockland', zip: '04841' },
    { address: '365 Main St', city: 'Rockland', zip: '04841' },
    { address: '48 Sea St', city: 'Camden', zip: '04843' },
    { address: '100 Limerock St', city: 'Rockland', zip: '04841' },
    { address: '5 Lighthouse Rd', city: 'Owls Head', zip: '04854' },
    { address: '23 Wadsworth St', city: 'Thomaston', zip: '04861' },
    { address: '88 Washington St', city: 'Camden', zip: '04843' },
    { address: '15 River Rd', city: 'Cushing', zip: '04563' },
    { address: '42 Friendship St', city: 'Waldoboro', zip: '04572' },
    { address: '9 Clark Island Rd', city: 'Saint George', zip: '04860' },
    { address: '31 Gleason Hill Rd', city: 'Union', zip: '04862' },
    { address: '156 Wallston Rd', city: 'Tenants Harbor', zip: '04860' },
    { address: '77 Port Clyde Rd', city: 'Saint George', zip: '04860' },
    { address: '210 Park St', city: 'Rockland', zip: '04841' },
    { address: '14 Bayview St', city: 'Camden', zip: '04843' },
    { address: '55 Buttermilk Ln', city: 'Thomaston', zip: '04861' },
  ];
  const phones = () => `(207) ${Math.floor(Math.random()*900+100)}-${Math.floor(Math.random()*9000+1000)}`;
  const tankTypes = ['Septic', 'Septic', 'Septic', 'Grease Trap', 'Holding Tank', 'Cesspool'];
  const tankVolumes = [1000, 1000, 1000, 1000, 1000, 1000, 750, 750, 1500, 1500, 1500, 750];
  const confirmStatuses = ['confirmed', 'confirmed', 'confirmed', 'no_reply', 'auto_confirmed', 'unconfirmed', 'left_message'];
  const times = ['07:00', '07:30', '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00'];

  let nameIdx = 0;
  const seededCustomers = [];
  const seededProperties = [];
  const seededTanks = [];
  const seededJobs = [];

  // Pick the first 4 vehicles with capacity (pump trucks)
  const pumpTrucks = vehicles.filter(v => v.capacity_gallons > 0).slice(0, 4);
  if (pumpTrucks.length === 0) return { success: false, error: 'No trucks with capacity found.' };

  for (const truck of pumpTrucks) {
    const jobCount = 6 + Math.floor(Math.random() * 3); // 6-8 jobs per truck
    for (let i = 0; i < jobCount; i++) {
      if (nameIdx >= maineNames.length) break;
      const name = maineNames[nameIdx];
      const addr = maineAddresses[nameIdx % maineAddresses.length];
      nameIdx++;

      // Create customer
      const cust = upsert('customers', {
        name: name,
        phone: phones(),
        email: name.split(' ')[0].toLowerCase() + '@email.com',
        _test_data: true,
      });
      seededCustomers.push(cust);

      // Create property
      const prop = upsert('properties', {
        customer_id: cust.id,
        address: addr.address,
        city: addr.city,
        state: 'ME',
        zip: addr.zip,
        _test_data: true,
      });
      seededProperties.push(prop);

      // Create 1-2 tanks
      const numTanks = Math.random() < 0.2 ? 2 : 1;
      for (let t = 0; t < numTanks; t++) {
        const tank = upsert('tanks', {
          property_id: prop.id,
          tank_type: tankTypes[Math.floor(Math.random() * tankTypes.length)],
          volume_gallons: tankVolumes[Math.floor(Math.random() * tankVolumes.length)],
          _test_data: true,
        });
        seededTanks.push(tank);
      }

      // Create job with pricing based on tank volume
      // Qty = volume / 1000 so a 1500 gal tank = qty 1.5 at $250/unit pumping, $140/unit disposal
      const jobTanks = seededTanks.filter(t => t.property_id === prop.id);
      const tankVol = jobTanks.reduce((s, t) => s + (t.volume_gallons || 0), 0) || 1000;
      const pumpUnitPrice = 250;
      const dispUnitPrice = 140;
      const ttConfig = readCollection('tank_types');
      const ttMap = {};
      ttConfig.forEach(tt => { ttMap[tt.name] = tt; });
      const allItems = jobTanks.flatMap(t => {
        const tQty = Math.max(1, Math.round(((t.volume_gallons || 0) / 1000) * 100) / 100);
        const tt = ttMap[t.tank_type] || {};
        const pumpP = tt.pumping_price ?? pumpUnitPrice;
        const dispP = tt.disposal_price ?? dispUnitPrice;
        const lines = [{ description: 'Pumping', qty: tQty, unit_price: pumpP }];
        if (tt.generates_disposal !== false && (tt.disposal_label || tt.generates_disposal)) {
          lines.push({ description: tt.disposal_label || 'Waste Disposal', qty: tQty, unit_price: dispP });
        }
        return lines;
      });
      const total = Math.round(allItems.reduce((s, li) => s + li.qty * li.unit_price, 0) * 100) / 100;
      const job = upsert('jobs', {
        customer_id: cust.id,
        property_id: prop.id,
        vehicle_id: truck.id,
        assigned_to: truck.default_tech_id || '',
        scheduled_date: today,
        scheduled_time: times[i % times.length],
        service_type: 'Septic Pumping',
        status: 'scheduled',
        confirmation_status: confirmStatuses[Math.floor(Math.random() * confirmStatuses.length)],
        sort_order: i * 10,
        gallons: tankVol,
        line_items: allItems,
        total,
        _test_data: true,
      });
      seededJobs.push(job);
    }
  }

  return {
    success: true,
    data: {
      customers: seededCustomers.length,
      properties: seededProperties.length,
      tanks: seededTanks.length,
      jobs: seededJobs.length,
      date: today,
    }
  };
});

// ===== UNSEED TEST DATA =====
ipcMain.handle('unseed-test-data', async () => {
  const collections = ['jobs', 'customers', 'properties', 'tanks'];
  const counts = {};
  for (const col of collections) {
    const items = readCollection(col);
    const kept = items.filter(i => !i._test_data);
    const removed = items.length - kept.length;
    counts[col] = removed;
    writeCollection(col, kept);
  }
  return {
    success: true,
    data: counts,
  };
});

// ===== GEOCODE CACHE =====
ipcMain.handle('get-geocode-cache', async () => {
  return { success: true, data: readCollection('geocode_cache') };
});

ipcMain.handle('save-geocode-cache', async (e, entry) => {
  // entry = { address, lat, lng }
  if (!entry.address) return { success: false };
  const existing = readCollection('geocode_cache');
  const idx = existing.findIndex(c => c.address === entry.address);
  if (idx >= 0) {
    existing[idx] = { ...existing[idx], ...entry };
  } else {
    existing.push({ id: uuidv4(), ...entry });
  }
  writeCollection('geocode_cache', existing);
  return { success: true };
});

// ===== TANKTRACK IMPORT =====
ipcMain.handle('import-select-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select TankTrack Backup File',
    filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };
  return { filePath: result.filePaths[0] };
});

ipcMain.handle('import-preview-tanktrack', async (e, filePath, limit) => {
  try {
    const wb = XLSX.readFile(filePath);
    if (!wb.Sheets['Customers']) return { error: 'No "Customers" sheet found in this file.' };

    const raw = XLSX.utils.sheet_to_json(wb.Sheets['Customers']);
    const total = raw.length;

    // Group rows by unique customer (first+last+billing address) — TankTrack has 1 row per property
    const custMap = new Map();
    for (const row of raw) {
      const firstName = (row['First Name'] || '').trim();
      const lastName = (row['Last Name'] || '').trim();
      if (!firstName && !lastName) continue;
      const name = [firstName, lastName].filter(Boolean).join(' ');
      const billingAddr = (row['Billing Address 1'] || '').trim();
      const key = (name + '|' + billingAddr).toLowerCase();

      if (!custMap.has(key)) {
        custMap.set(key, {
          name,
          phone: row['Cell Phone'] || row['Home Phone'] || row['Work Phone'] || '',
          email: (row['Email'] || '').trim(),
          contact_method: _mapContactMethod(row['E-Contact Method']),
          address: billingAddr,
          address2: (row['Billing Address 2'] || '').trim(),
          city: (row['Billing City'] || '').trim(),
          state: (row['Billing State'] || 'ME').trim(),
          zip: (row['Billing Zip Code'] || '').trim(),
          notes: (row['Contact Notes[Private]'] || '').trim(),
          properties: [],
        });
      }

      const propAddr = (row['Property Address 1'] || '').trim();
      if (!propAddr) continue;

      const prop = {
        address: propAddr,
        address2: (row['Property Address 2'] || '').trim(),
        city: (row['Property City'] || '').trim(),
        state: (row['Property State'] || 'ME').trim(),
        zip: (row['Property Zip Code'] || '').trim(),
        county: (row['Property County'] || '').trim(),
        property_type: row['Property Type'] === 'C' ? 'Commercial' : row['Property Type'] === 'R' ? 'Residential' : '',
        directions: (row['Directions'] || '').trim(),
        notes: (row['Property Notes'] || '').trim(),
        last_appointment_date: row['Last Appointment Date'] || null,
        next_appointment_date: row['Next Appointment Date'] || null,
        service_due_date: row['Service Due Date'] || null,
        tanks: [],
      };

      // Tank 1
      if (row['Tank 1 Capacity'] > 0 || (row['Tank 1 Type/Source'] && row['Tank 1 Type/Source'] !== 'Drain Clearing')) {
        prop.tanks.push(_parseTank(row, 1));
      }
      // Tank 2
      if (row['Tank 2 Capacity'] > 0 || (row['Tank 2 Type/Source'] && row['Tank 2 Type/Source'] !== 'Drain Clearing' && row['Tank 2 Type/Source'] !== '')) {
        prop.tanks.push(_parseTank(row, 2));
      }

      custMap.get(key).properties.push(prop);
    }

    const customers = Array.from(custMap.values());
    const preview = limit ? customers.slice(0, limit) : customers;

    // Check for invoice data
    const hasInvoices = !!wb.Sheets['Invoices'];
    const invoiceCount = hasInvoices ? XLSX.utils.sheet_to_json(wb.Sheets['Invoices']).length : 0;

    return {
      totalRows: total,
      uniqueCustomers: customers.length,
      previewCustomers: preview,
      previewCount: preview.length,
      hasInvoices,
      invoiceCount,
    };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('import-execute-tanktrack', async (e, filePath, maxCustomers) => {
  try {
    const wb = XLSX.readFile(filePath);
    const raw = XLSX.utils.sheet_to_json(wb.Sheets['Customers']);
    const existingCustomers = readCollection('customers');
    const existingProperties = readCollection('properties');

    // Group by customer
    const custMap = new Map();
    for (const row of raw) {
      const firstName = (row['First Name'] || '').trim();
      const lastName = (row['Last Name'] || '').trim();
      if (!firstName && !lastName) continue;
      const name = [firstName, lastName].filter(Boolean).join(' ');
      const billingAddr = (row['Billing Address 1'] || '').trim();
      const key = (name + '|' + billingAddr).toLowerCase();

      if (!custMap.has(key)) {
        custMap.set(key, { name, row, properties: [] });
      }

      const propAddr = (row['Property Address 1'] || '').trim();
      if (propAddr) custMap.get(key).properties.push(row);
    }

    const allCustomers = Array.from(custMap.values());
    const toImport = maxCustomers ? allCustomers.slice(0, maxCustomers) : allCustomers;

    let imported = 0, skipped = 0, propsCreated = 0, tanksCreated = 0;

    for (const cust of toImport) {
      const row = cust.row;
      const name = cust.name;

      // Check for duplicate by name + billing address
      const billingAddr = (row['Billing Address 1'] || '').trim();
      const isDup = existingCustomers.some(ec =>
        ec.name?.toLowerCase() === name.toLowerCase() &&
        (ec.address || '').toLowerCase() === billingAddr.toLowerCase()
      );
      if (isDup) { skipped++; continue; }

      // Create customer
      const customer = upsert('customers', {
        name,
        phone: row['Cell Phone'] || row['Home Phone'] || row['Work Phone'] || '',
        email: (row['Email'] || '').trim(),
        contact_method: _mapContactMethod(row['E-Contact Method']),
        address: billingAddr,
        address2: (row['Billing Address 2'] || '').trim(),
        city: (row['Billing City'] || '').trim(),
        state: (row['Billing State'] || 'ME').trim(),
        zip: (row['Billing Zip Code'] || '').trim(),
        notes: (row['Contact Notes[Private]'] || '').trim(),
        imported_from: 'tanktrack',
      });
      existingCustomers.push(customer);
      imported++;

      // Create properties + tanks for this customer
      for (const propRow of cust.properties) {
        const propAddr = (propRow['Property Address 1'] || '').trim();
        if (!propAddr) continue;

        // Check for duplicate property
        const propDup = existingProperties.some(ep =>
          ep.customer_id === customer.id &&
          (ep.address || '').toLowerCase() === propAddr.toLowerCase()
        );
        if (propDup) continue;

        const property = upsert('properties', {
          customer_id: customer.id,
          address: propAddr,
          address2: (propRow['Property Address 2'] || '').trim(),
          city: (propRow['Property City'] || '').trim(),
          state: (propRow['Property State'] || 'ME').trim(),
          zip: (propRow['Property Zip Code'] || '').trim(),
          county: (propRow['Property County'] || '').trim(),
          property_type: propRow['Property Type'] === 'C' ? 'Commercial' : propRow['Property Type'] === 'R' ? 'Residential' : '',
          directions: (propRow['Directions'] || '').trim(),
          notes: (propRow['Property Notes'] || '').trim(),
          last_appointment_date: propRow['Last Appointment Date'] || null,
          next_appointment_date: propRow['Next Appointment Date'] || null,
          service_due_date: propRow['Service Due Date'] || null,
          imported_from: 'tanktrack',
        });
        existingProperties.push(property);
        propsCreated++;

        // Tank 1
        if (propRow['Tank 1 Capacity'] > 0 || (propRow['Tank 1 Type/Source'] && propRow['Tank 1 Type/Source'] !== 'Drain Clearing')) {
          upsert('tanks', { property_id: property.id, ..._parseTank(propRow, 1), imported_from: 'tanktrack' });
          tanksCreated++;
        }
        // Tank 2
        if (propRow['Tank 2 Capacity'] > 0 || (propRow['Tank 2 Type/Source'] && propRow['Tank 2 Type/Source'] !== 'Drain Clearing' && propRow['Tank 2 Type/Source'] !== '')) {
          upsert('tanks', { property_id: property.id, ..._parseTank(propRow, 2), imported_from: 'tanktrack' });
          tanksCreated++;
        }
      }
    }

    return { success: true, imported, skipped, propsCreated, tanksCreated };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('import-invoices-tanktrack', async (e, filePath) => {
  try {
    const wb = XLSX.readFile(filePath);
    if (!wb.Sheets['Invoices']) return { error: 'No Invoices sheet found.' };
    const raw = XLSX.utils.sheet_to_json(wb.Sheets['Invoices']);

    const customers = readCollection('customers');
    const properties = readCollection('properties');
    const existingInvoices = readCollection('invoices');
    let imported = 0, skipped = 0;

    for (const row of raw) {
      const invNum = String(row['Invoice Number'] || '').trim();
      if (!invNum) continue;

      // Skip if invoice number already exists
      if (existingInvoices.some(ei => ei.invoice_number === invNum)) { skipped++; continue; }

      // Match customer
      const fullName = (row['Full Name'] || [row['First Name'], row['Last Name']].filter(Boolean).join(' ')).trim();
      const cust = customers.find(c => c.name?.toLowerCase() === fullName.toLowerCase());

      // Match property
      const propAddr = (row['Property Address 1'] || '').trim();
      let prop = null;
      if (cust && propAddr) {
        prop = properties.find(p => p.customer_id === cust.id && p.address?.toLowerCase() === propAddr.toLowerCase());
      }

      const totalAmount = parseFloat(row['Total Invoice Amount']) || 0;
      const totalPaid = parseFloat(row['Total Amount Paid']) || 0;

      const invoice = upsert('invoices', {
        invoice_number: invNum,
        customer_id: cust?.id || null,
        customer_name: fullName,
        property_id: prop?.id || null,
        svc_date: row['Date of Service'] || null,
        amount: totalAmount,
        total_paid: totalPaid,
        status: totalPaid >= totalAmount ? 'paid' : totalPaid > 0 ? 'partial' : 'unpaid',
        payment_method: (row['Payment Method'] || '').trim(),
        payment_due_date: row['Payment Due Date'] || null,
        products_services: (row['Products/Services'] || '').trim(),
        quantity: parseInt(row['Quantity']) || 1,
        unit_cost: parseFloat(row['Unit Cost']) || 0,
        technician: (row['Technician'] || '').trim(),
        tech_notes: (row['Technician Notes'] || '').trim(),
        job_notes: (row['Job Notes'] || '').trim(),
        gallons_pumped_total: parseInt(row['Gallons Pumped']) || 0,
        truck: (row['Truck'] || '').trim(),
        tank_type: (row['Tank Type'] || '').trim(),
        tank_size: parseInt(row['Tank Size']) || 0,
        waste_manifest: (row['Waste Manifest #'] || '').trim(),
        waste_site: (row['Waste Site'] || '').trim(),
        disposal_date: row['Disposal Date'] || null,
        check_numbers: (row['Check Numbers'] || '').trim(),
        imported_from: 'tanktrack',
      });
      existingInvoices.push(invoice);
      imported++;
    }

    return { success: true, imported, skipped };
  } catch (err) {
    return { error: err.message };
  }
});

function _mapContactMethod(val) {
  if (!val) return '';
  const v = val.toLowerCase();
  if (v.includes('email') && v.includes('text')) return 'email_text';
  if (v.includes('email')) return 'email';
  if (v.includes('text')) return 'text';
  if (v.includes('phone') || v.includes('call')) return 'phone';
  return val;
}

function _parseTank(row, num) {
  const prefix = `Tank ${num} `;
  const typeSource = (row[prefix + 'Type/Source'] || '').trim();
  let tankType = 'Septic Tank';
  if (typeSource.includes('Filter')) tankType = 'Septic Tank+Filter';
  else if (typeSource.includes('Holding')) tankType = 'Holding Tank';
  else if (typeSource.includes('Grease')) tankType = 'Grease Trap';
  else if (typeSource.includes('Pump')) tankType = 'Pump Chamber';
  else if (typeSource.includes('Distribution')) tankType = 'Distribution Box';
  else if (typeSource.includes('Drain')) tankType = 'Drain Clearing';
  else if (typeSource.includes('Septic')) tankType = 'Septic Tank';
  else if (typeSource) tankType = typeSource;

  const filterVal = (row[prefix + 'Filter?'] || '').toLowerCase();
  let filter = 'unknown';
  if (filterVal === 'yes' || filterVal === 'true') filter = 'yes';
  else if (filterVal === 'no' || filterVal === 'false' || filterVal === 'n/a') filter = 'no';

  const riserVal = (row[prefix + 'Riser?'] || '').toLowerCase();
  let riser = 'unknown';
  if (riserVal === 'yes' || riserVal === 'true') riser = 'yes';
  else if (riserVal === 'no' || riserVal === 'false') riser = 'no';

  const freqVal = parseInt(row[prefix + 'Pump Frequency']) || 0;
  const freqUnit = (row[prefix + 'Pump Frequency Unit'] || '').toLowerCase();
  let pumpFreq = '';
  if (freqVal > 0 && freqUnit.includes('year')) {
    pumpFreq = freqVal === 1 ? '1 year' : freqVal + ' years';
  }

  return {
    tank_name: (row[prefix + 'Name'] || '').trim(),
    tank_type: tankType,
    volume_gallons: parseInt(row[prefix + 'Capacity']) || 0,
    depth_inches: parseInt(row[prefix + 'Depth']) || null,
    hose_length_ft: parseInt(row[prefix + 'Hose Length']) || null,
    filter,
    filter_type: (row[prefix + 'Filter Type'] || '').trim(),
    riser,
    pump_frequency: pumpFreq,
    notes: (row[prefix + 'Notes'] || '').trim(),
  };
}
