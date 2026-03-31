// ===== STATE =====
let currentPage = 'dashboard';
let navHistory = []; // stack of { action, label } for back button

function navPush(label, action) {
  navHistory.push({ label, action });
  if (navHistory.length > 20) navHistory.shift(); // prevent unbounded growth
}

let _navGoingBack = false;
async function navBack() {
  if (navHistory.length > 0) {
    const prev = navHistory.pop();
    _navGoingBack = true;
    await eval(prev.action);
    _navGoingBack = false;
  }
}

function navBackButton() {
  if (navHistory.length === 0) return '';
  const prev = navHistory[navHistory.length - 1];
  return `<button class="btn btn-secondary" onclick="navBack()">&#8592; ${prev.label}</button>`;
}
let allCustomers = [];
let allJobs = [];
let currentUser = null; // { id, name, role, username }

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
});

// ===== AUTH =====
async function checkAuth() {
  currentUser = { id: 1, name: 'Admin', role: 'admin', username: 'admin' };
  enterApp();
}

function showScreen(screen) {
  document.getElementById('loginScreen').style.display = screen === 'login' ? 'flex' : 'none';
  document.getElementById('setupScreen').style.display = screen === 'setup' ? 'flex' : 'none';
  document.getElementById('appShell').style.display = screen === 'app' ? 'flex' : 'none';

  if (screen === 'login') {
    // Pre-fill saved credentials from localStorage as fallback
    const savedUser = localStorage.getItem('ism_saved_username') || '';
    const savedPass = localStorage.getItem('ism_saved_password') || '';
    document.getElementById('loginUsername').value = savedUser;
    document.getElementById('loginPassword').value = savedPass;
    document.getElementById('loginError').style.display = 'none';
    if (!savedUser) {
      setTimeout(() => document.getElementById('loginUsername').focus(), 100);
    } else {
      setTimeout(() => document.getElementById('loginPassword').focus(), 100);
    }
  }
  if (screen === 'setup') {
    setTimeout(() => document.getElementById('setupName').focus(), 100);
  }
}

async function doSetup() {
  const name = document.getElementById('setupName').value.trim();
  const phone = document.getElementById('setupPhone').value.trim();
  const username = document.getElementById('setupUsername').value.trim();
  const password = document.getElementById('setupPassword').value;
  const confirm = document.getElementById('setupPasswordConfirm').value;
  const errorEl = document.getElementById('setupError');

  if (!name || !username || !password) {
    errorEl.textContent = 'Name, username, and password are required.';
    errorEl.style.display = 'block';
    return;
  }
  if (password.length < 4) {
    errorEl.textContent = 'Password must be at least 4 characters.';
    errorEl.style.display = 'block';
    return;
  }
  if (password !== confirm) {
    errorEl.textContent = 'Passwords do not match.';
    errorEl.style.display = 'block';
    return;
  }

  const result = await window.api.authSetup({ name, phone, username, password });
  if (result.success) {
    currentUser = result.data;
    enterApp();
  } else {
    errorEl.textContent = result.error || 'Setup failed.';
    errorEl.style.display = 'block';
  }
}

async function doLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errorEl = document.getElementById('loginError');

  if (!username || !password) {
    errorEl.textContent = 'Enter your username and password.';
    errorEl.style.display = 'block';
    return;
  }

  const result = await window.api.authLogin(username, password);
  if (result.success) {
    currentUser = result.data;
    // Save credentials so they pre-fill next time
    localStorage.setItem('ism_saved_username', username);
    localStorage.setItem('ism_saved_password', password);
    enterApp();
  } else {
    errorEl.textContent = result.error || 'Login failed.';
    errorEl.style.display = 'block';
  }
}

function enterApp() {
  showScreen('app');

  // Show user info in sidebar
  document.getElementById('sidebarUserName').textContent = currentUser.name;
  document.getElementById('sidebarUserRole').textContent = currentUser.role;
  document.getElementById('sidebarUser').style.display = 'flex';

  // Gate nav items by role
  applyPermissions();

  setupNavigation();
  navigateTo('schedule');
  updateReminderBadge();

  // Listen for reminder alerts from main process
  if (window.api.onReminderAlert) {
    window.api.onReminderAlert((data) => {
      showToast(`🔔 Reminder: ${data.message}`, 'info', 8000);
      updateReminderBadge();
    });
  }
}

async function updateReminderBadge() {
  try {
    const { data: reminders } = await window.api.getReminders();
    const today = new Date().toISOString().split('T')[0];
    // Count all pending reminders due today or past due (any user or unassigned)
    const dueReminders = reminders.filter(r =>
      r.status === 'pending' && r.due_date && r.due_date <= today
    );
    const navBtn = document.querySelector('.nav-item[data-page="reminders"]');
    if (!navBtn) return;
    const existing = navBtn.querySelector('.reminder-nav-badge');
    if (existing) existing.remove();
    if (dueReminders.length > 0) {
      navBtn.insertAdjacentHTML('beforeend', `<span class="reminder-nav-badge" style="background:#f44336;color:white;font-size:9px;font-weight:700;padding:1px 5px;border-radius:8px;margin-left:6px;">${dueReminders.length}</span>`);
    }
  } catch (e) { /* ignore */ }
}

function applyPermissions() {
  // Techs can only see: Dashboard, Schedule, Customers (read only)
  // Admin sees everything
  if (currentUser.role === 'tech') {
    document.querySelectorAll('.nav-item').forEach(item => {
      const page = item.dataset.page;
      const techPages = ['dashboard', 'schedule', 'customers'];
      if (!techPages.includes(page)) {
        item.style.display = 'none';
      }
    });
  } else {
    // Admin sees all
    document.querySelectorAll('.nav-item').forEach(item => {
      item.style.display = '';
    });
  }
}

function isAdmin() {
  return currentUser && currentUser.role === 'admin';
}

function doLogout() {
  currentUser = null;
  document.getElementById('sidebarUser').style.display = 'none';
  // Reset nav visibility
  document.querySelectorAll('.nav-item').forEach(item => {
    item.style.display = '';
  });
  showScreen('login');
}

// Enter key handlers for login/setup
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (document.getElementById('loginScreen').style.display === 'flex') {
      doLogin();
    } else if (document.getElementById('setupScreen').style.display === 'flex') {
      doSetup();
    }
  }
});

// ===== NAVIGATION =====
function setupNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      navigateTo(item.dataset.page);
    });
  });
}

function navigateTo(page) {
  currentPage = page;

  // Clean up schedule map if leaving schedule
  if (scheduleMapInstance) {
    scheduleMapInstance.remove();
    scheduleMapInstance = null;
    scheduleMapVisible = false;
    const mapEl = document.getElementById('scheduleMapContainer');
    if (mapEl) mapEl.remove();
  }

  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
  });

  document.querySelectorAll('.page').forEach(p => { p.classList.remove('active'); p.style.display = ''; });
  const pageEl = document.getElementById('page-' + page);
  if (pageEl) pageEl.classList.add('active');

  const titles = {
    dashboard: 'Dashboard',
    customers: 'Customers',
    schedule: 'Schedule',
    invoices: 'Invoices',
    vehicles: 'Vehicles',
    wastesites: 'Waste Sites',
    disposal: 'Disposal Tracking',
    dep: 'DEP Reports',
    reports: 'Reports',
    reminders: 'Reminders',
    sdn: 'Service Due Notices',
    settings: 'Settings',
  };
  document.getElementById('pageTitle').textContent = titles[page] || page;

  const loaders = {
    dashboard: loadDashboard,
    customers: loadCustomers,
    schedule: loadSchedule,
    invoices: loadInvoices,
    vehicles: loadVehicles,
    wastesites: loadWasteSites,
    disposal: loadDisposal,
    dep: loadDepReports,
    reports: loadReports,
    reminders: loadReminders,
    sdn: loadServiceDueNotices,
    settings: loadSettings,
  };
  if (loaders[page]) loaders[page]();
  updatePageActions(page);
}

function updatePageActions(page) {
  const container = document.getElementById('pageActions');
  const actions = {
    customers: isAdmin() ? '<button class="btn btn-primary" onclick="openCustomerModal()">+ New Customer</button>' : '',
    schedule: '',
    invoices: '',
    vehicles: isAdmin() ? '<button class="btn btn-primary" onclick="openVehicleModal()">+ New Vehicle</button>' : '',
    wastesites: isAdmin() ? '<button class="btn btn-primary" onclick="openWasteSiteModal()">+ Add Waste Site</button>' : '',
    disposal: '<button class="btn btn-secondary" onclick="exportDisposalPdf()" style="margin-right:6px;">&#128196; Export PDF</button><button class="btn btn-primary" onclick="openDisposalModal()">+ Log Disposal</button>',
    dep: isAdmin() ? '<button class="btn btn-primary" onclick="openDepReportModal()">+ Generate Report</button>' : '',
    reminders: isAdmin() ? '<button class="btn btn-primary" onclick="openReminderModal()">+ New Reminder</button>' : '',
    reports: '<button class="btn btn-secondary" onclick="exportReportPdf()">&#128196; Export PDF</button>',
    sdn: '<button class="btn btn-primary" onclick="openServiceDueNoticeModal()">+ New Service Due Notice</button>',
  };
  container.innerHTML = actions[page] || '';
}

// ===== MODAL =====
function openModal(title, bodyHtml, footerHtml) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHtml;
  document.getElementById('modalFooter').innerHTML = footerHtml || '';
  document.getElementById('modalOverlay').classList.add('active');
  // Auto-focus first input
  setTimeout(() => {
    const firstInput = document.querySelector('#modalBody input:not([type=hidden]), #modalBody textarea, #modalBody select');
    if (firstInput) firstInput.focus();
  }, 100);
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
}

document.getElementById('modalOverlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal();
});

// ===== TOAST =====
function showToast(message, type = '', duration = 3500) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

// ===== DASHBOARD =====
async function loadDashboard() {
  const today = new Date().toISOString().split('T')[0];

  const { data: jobs } = await window.api.getJobs({ date: today });
  document.getElementById('statJobsToday').textContent = jobs.length;

  if (jobs.length > 0) {
    document.getElementById('dashboardJobs').innerHTML = `
      <table class="data-table">
        <thead><tr><th>Time</th><th>Customer</th><th>Type</th><th>Tech</th><th>Status</th></tr></thead>
        <tbody>
          ${jobs.map(j => `
            <tr onclick="navigateTo('schedule')">
              <td>${j.scheduled_time || 'TBD'}</td>
              <td>${j.customers?.name || 'N/A'}</td>
              <td>${j.job_type}</td>
              <td>${j.users?.name || 'Unassigned'}</td>
              <td><span class="badge badge-${j.status.replace('_','-')}">${formatStatus(j.status)}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>`;
  } else {
    document.getElementById('dashboardJobs').innerHTML = `
      <div class="empty-state"><div class="empty-icon">&#128197;</div><p>No jobs scheduled for today</p></div>`;
  }

  const { data: unpaid } = await window.api.getInvoices({ status: 'sent' });
  const { data: overdue } = await window.api.getInvoices({ status: 'overdue' });
  document.getElementById('statUnpaid').textContent = (unpaid?.length || 0) + (overdue?.length || 0);

  const { data: reminders } = await window.api.getReminders({ status: 'pending' });
  document.getElementById('statReminders').textContent = reminders?.length || 0;

  if (reminders && reminders.length > 0) {
    const upcoming = reminders.slice(0, 5);
    document.getElementById('dashboardReminders').innerHTML = `
      <table class="data-table">
        <thead><tr><th>Due</th><th>Customer</th><th>Type</th></tr></thead>
        <tbody>
          ${upcoming.map(r => `
            <tr onclick="navigateTo('reminders')">
              <td>${r.due_date}</td>
              <td>${r.customers?.name || 'N/A'}</td>
              <td>${formatStatus(r.type)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>`;
  } else {
    document.getElementById('dashboardReminders').innerHTML = `
      <div class="empty-state"><div class="empty-icon">&#128276;</div><p>No upcoming reminders</p></div>`;
  }

  const monthStart = today.substring(0, 7) + '-01';
  const { data: summary } = await window.api.getDisposalSummary({ from: monthStart, to: today });
  document.getElementById('statDisposal').textContent = summary?.totalGallons?.toLocaleString() || '0';

  // Loose Ends — sorted newest first
  const { data: allJobs } = await window.api.getJobs({});
  const looseEnds = (allJobs || []).filter(j => j.loose_end).sort((a, b) => (b.scheduled_date || '').localeCompare(a.scheduled_date || ''));
  document.getElementById('statLooseEnds').textContent = looseEnds.length;

  if (looseEnds.length > 0) {
    document.getElementById('dashboardLooseEnds').innerHTML = `
      <div style="max-height:400px;overflow-y:auto;">
        ${looseEnds.map(j => `
          <div onclick="openJobDetail('${j.id}')" style="cursor:pointer;padding:10px 14px;border-bottom:1px solid #eee;display:flex;gap:12px;align-items:flex-start;" onmouseover="this.style.background='#fff3e0'" onmouseout="this.style.background=''">
            <div style="color:#e65100;font-size:18px;flex-shrink:0;">&#9888;</div>
            <div style="flex:1;min-width:0;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;">
                <span style="font-weight:700;font-size:13px;">${esc(j.customers?.name || 'N/A')}</span>
                <span style="font-size:11px;color:var(--text-light);">${j.scheduled_date || ''}</span>
              </div>
              <div style="font-size:12px;color:var(--text-light);margin-bottom:4px;">${esc(j.properties?.address || '')}</div>
              ${j.loose_end_note ? `<div style="font-size:13px;color:#c62828;font-weight:600;background:#fff3e0;padding:4px 8px;border-radius:4px;border-left:3px solid #e65100;">${esc(j.loose_end_note)}</div>` : `<div style="font-size:12px;color:var(--text-light);font-style:italic;">No note provided</div>`}
              ${j.status === 'completed' ? '<span style="font-size:10px;background:#e8f5e9;color:#2e7d32;padding:1px 6px;border-radius:3px;margin-top:4px;display:inline-block;">Completed</span>' : ''}
            </div>
          </div>
        `).join('')}
      </div>`;
  } else {
    document.getElementById('dashboardLooseEnds').innerHTML = `
      <div class="empty-state"><div class="empty-icon">&#9888;</div><p>No loose ends — all clear!</p></div>`;
  }
}

// ===== CUSTOMERS =====
let currentCustomerId = null;
let currentPropertyId = null;
let lastServiceCategoryId = '';

async function loadCustomers(search = '') {
  navHistory = []; // reset nav stack on top-level page
  currentCustomerId = null;
  currentPropertyId = null;
  const page = document.getElementById('page-customers');
  const { data: customers } = await window.api.getCustomers(search);
  allCustomers = customers;

  page.innerHTML = `
    <div class="search-bar">
      <input type="text" id="customerSearch" placeholder="Search customers by name, phone, email, or property address..." value="${search}" oninput="debounceCustomerSearch()">
    </div>
    ${customers.length === 0 ? `
      <div class="empty-state">
        <div class="empty-icon">&#128101;</div>
        <p>No customers yet. Add your first customer to get started.</p>
        <button class="btn btn-primary" onclick="openCustomerModal()">+ Add Customer</button>
      </div>
    ` : `
      <div class="card" style="padding:0;overflow:hidden;">
        <table class="data-table">
          <thead>
            <tr><th>Name</th><th>Address</th><th>Email</th><th>Phone</th><th>Balance</th></tr>
          </thead>
          <tbody>
            ${customers.map(c => `
              <tr onclick="openCustomerDetail('${c.id}')">
                <td><strong>${esc(c.name)}</strong></td>
                <td style="font-size:12px;">${esc(c.primary_address || '')}</td>
                <td>${esc(c.email || '')}</td>
                <td>${esc(c.phone || '')}</td>
                <td class="${(c.balance || 0) > 0 ? 'text-danger' : ''}">$${(c.balance || 0).toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `}
  `;
}

let customerSearchTimeout;
function debounceCustomerSearch() {
  clearTimeout(customerSearchTimeout);
  customerSearchTimeout = setTimeout(() => {
    loadCustomers(document.getElementById('customerSearch').value);
  }, 300);
}

function openCustomerModal(customer = null) {
  const isEdit = !!customer;
  const c = customer || {};
  openModal(isEdit ? 'Edit Customer' : 'New Customer', `
    <input type="hidden" id="customerId" value="${c.id || ''}">
    <div class="form-group">
      <label>Customer Name *</label>
      <input type="text" id="customerName" value="${esc(c.name || '')}" placeholder="John & Jane Doe">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Phone</label>
        <input type="text" id="customerPhone" value="${esc(c.phone || '')}" placeholder="(207) 555-1234">
      </div>
      <div class="form-group">
        <label>Email</label>
        <input type="email" id="customerEmail" value="${esc(c.email || '')}" placeholder="customer@email.com">
      </div>
    </div>
    <div class="form-group">
      <label>Billing Address</label>
      <input type="text" id="customerAddress" value="${esc(c.address || '')}" placeholder="123 Main Street">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>City</label>
        <input type="text" id="customerCity" value="${esc(c.city || '')}" placeholder="Camden">
      </div>
      <div class="form-group" style="max-width:80px;">
        <label>State</label>
        <input type="text" id="customerState" value="${esc(c.state || 'ME')}" placeholder="ME" maxlength="2">
      </div>
      <div class="form-group" style="max-width:100px;">
        <label>Zip</label>
        <input type="text" id="customerZip" value="${esc(c.zip || '')}" placeholder="04843">
      </div>
    </div>
    <div class="form-group">
      <label>Contact Method</label>
      <select id="customerContactMethod">
        <option value="Email & Text" ${c.contact_method === 'Email & Text' ? 'selected' : ''}>Email & Text</option>
        <option value="Email" ${c.contact_method === 'Email' ? 'selected' : ''}>Email Only</option>
        <option value="Text" ${c.contact_method === 'Text' ? 'selected' : ''}>Text Only</option>
        <option value="Phone" ${c.contact_method === 'Phone' ? 'selected' : ''}>Phone Call</option>
      </select>
    </div>
    <div class="form-group">
      <label>Notes</label>
      <textarea id="customerNotes" placeholder="Private notes about this customer...">${esc(c.notes || '')}</textarea>
    </div>
  `, `
    ${isEdit ? '<button class="btn btn-danger" onclick="deleteCustomer()">Delete</button>' : ''}
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveCustomer()">Save</button>
  `);
}

async function saveCustomer() {
  const data = {
    name: document.getElementById('customerName').value.trim(),
    phone: document.getElementById('customerPhone').value.trim(),
    email: document.getElementById('customerEmail').value.trim(),
    address: document.getElementById('customerAddress').value.trim(),
    city: document.getElementById('customerCity').value.trim(),
    state: document.getElementById('customerState').value.trim(),
    zip: document.getElementById('customerZip').value.trim(),
    contact_method: document.getElementById('customerContactMethod').value,
    notes: document.getElementById('customerNotes').value.trim(),
  };

  const id = document.getElementById('customerId').value;
  if (id) data.id = id;

  if (!data.name) {
    showToast('Customer name is required.', 'error');
    return;
  }

  const result = await window.api.saveCustomer(data);
  if (result.success) {
    closeModal();
    showToast(id ? 'Customer updated.' : 'Customer added.', 'success');
    if (currentCustomerId) {
      openCustomerDetail(currentCustomerId);
    } else {
      loadCustomers();
    }
  } else {
    showToast(result.error || 'Failed to save.', 'error');
  }
}

async function deleteCustomer() {
  const id = document.getElementById('customerId').value;
  if (!id || !confirm('Delete this customer and all their properties/tanks? This cannot be undone.')) return;

  const result = await window.api.deleteCustomer(id);
  if (result.success) {
    closeModal();
    showToast('Customer deleted.', 'success');
    loadCustomers();
  } else {
    showToast(result.error || 'Failed to delete.', 'error');
  }
}

// ===== CUSTOMER DETAIL =====
async function openCustomerDetail(id, selectedPropertyId = null) {
  currentCustomerId = id;
  currentPage = 'customers';
  document.querySelectorAll('.page').forEach(p => { p.classList.remove('active'); p.style.display = ''; });
  document.getElementById('page-customers').classList.add('active');
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.page === 'customers'));

  const { data: customer } = await window.api.getCustomer(id);
  if (!customer) return;

  const { data: properties } = await window.api.getProperties(id);
  const { data: customerJobs } = await window.api.getJobs({ customerId: id });
  const { data: contracts } = await window.api.getServiceContracts({ customerId: id });
  const { data: notices } = await window.api.getServiceDueNotices({ customerId: id });
  const acctInfo = await window.api.getCustomerBalance(id);

  // Auto-select property
  const prop = selectedPropertyId
    ? properties.find(p => p.id === selectedPropertyId) || properties[0]
    : properties[0];
  currentPropertyId = prop?.id || null;

  const today = new Date().toISOString().split('T')[0];
  const upcomingJobs = customerJobs.filter(j => j.scheduled_date >= today && j.status !== 'completed').sort((a, b) => (a.scheduled_date || '').localeCompare(b.scheduled_date || ''));
  const pastJobs = customerJobs.filter(j => j.scheduled_date < today || j.status === 'completed').sort((a, b) => (b.scheduled_date || '').localeCompare(a.scheduled_date || ''));

  // Tank totals
  const tanks = prop?.tanks || [];
  const totalTankGal = tanks.reduce((s, t) => s + (t.volume_gallons || 0), 0);

  document.getElementById('pageTitle').textContent = customer.name;
  document.getElementById('pageActions').innerHTML = `
    ${navBackButton() || `<button class="btn btn-secondary" onclick="loadCustomers()">&#8592; ALL CONTACTS</button>`}
    ${isAdmin() ? `<button class="btn btn-secondary" onclick="openCustomerModal(${JSON.stringify(customer).replace(/"/g, '&quot;')})">Edit</button>` : ''}
  `;

  const page = document.getElementById('page-customers');
  page.innerHTML = `
    <div style="display:grid;grid-template-columns:320px 1fr 320px;gap:16px;padding:4px 0;">

      <!-- ====== LEFT: CONTACT ====== -->
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div class="card" style="padding:16px;">
          <div style="font-size:10px;color:#1565c0;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">&#128100; Contact</div>
          <div style="display:flex;align-items:center;gap:10px;margin:0 0 12px 0;">
            <h2 style="margin:0;font-size:20px;flex:1;">${esc(customer.name)}</h2>
            <div class="acct-icon ${acctInfo.overdue ? 'overdue' : ''}" onclick="openCustomerAccounting('${id}')" title="Accounting — Click to view activity">
              <span style="font-size:18px;font-weight:800;">$</span>
              ${acctInfo.overdue ? '<span class="acct-overdue-badge">!</span>' : ''}
              <span class="${acctInfo.balance > 0 ? 'acct-balance-negative' : 'acct-balance-positive'}" style="font-size:12px;font-weight:700;">
                ${acctInfo.balance !== 0 ? (acctInfo.balance > 0 ? '-' : '+') + '$' + Math.abs(acctInfo.balance).toFixed(2) : '$0.00'}
              </span>
            </div>
          </div>

          <div style="font-size:13px;line-height:1.8;">
            ${customer.address ? `<div>${esc(customer.address)}</div>` : ''}
            ${customer.city || customer.state || customer.zip ? `<div>${esc(customer.city || '')}${customer.state ? ', ' + esc(customer.state) : ''} ${esc(customer.zip || '')}</div>` : ''}
            ${customer.phone ? `<div style="margin-top:4px;"><strong>${esc(customer.phone)}</strong></div>` : ''}
            ${customer.email ? `<div>${esc(customer.email)}</div>` : ''}
            <div style="color:var(--text-light);font-size:12px;">E-Contact Method: ${esc(customer.contact_method || 'Email & Text')}</div>
          </div>

          <details style="margin-top:12px;border-top:1px solid #eee;padding-top:8px;" ${customer.notes ? 'open' : ''}>
            <summary style="cursor:pointer;font-weight:600;font-size:12px;color:var(--text-light);">Contact Notes &#128172;</summary>
            <textarea style="width:100%;min-height:60px;margin-top:6px;font-size:12px;border:1px solid #ddd;border-radius:4px;padding:6px;resize:vertical;"
              onblur="window.api.saveCustomer({id:'${id}',notes:this.value})">${esc(customer.notes || '')}</textarea>
          </details>
        </div>

        <!-- Other Linked Properties -->
        <div class="card" style="padding:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <span style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-light);">Properties</span>
            <button class="btn btn-sm btn-primary" onclick="openPropertyModal()" style="font-size:10px;padding:3px 8px;">+ New Property</button>
          </div>
          ${properties.map(p => `
            <div style="padding:6px 8px;margin-bottom:4px;border-radius:4px;cursor:pointer;font-size:12px;border-left:3px solid ${p.id === prop?.id ? '#1565c0' : '#ddd'};background:${p.id === prop?.id ? '#e3f2fd' : '#fafafa'};"
              onclick="openCustomerDetail('${id}', '${p.id}')">
              <div style="font-weight:600;">${esc(p.address || 'No Address')}</div>
              <div style="color:var(--text-light);font-size:11px;">${esc(p.city || '')}${p.state ? ', ' + esc(p.state) : ''} ${esc(p.zip || '')}</div>
            </div>
          `).join('')}
          ${properties.length === 0 ? '<div style="color:var(--text-light);font-size:12px;padding:8px 0;">No properties yet.</div>' : ''}
        </div>
      </div>

      <!-- ====== CENTER: PROPERTY ====== -->
      <div style="display:flex;flex-direction:column;gap:12px;">
        ${prop ? `
        <div class="card" style="padding:16px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;">
            <div>
              <div style="font-size:10px;color:#1565c0;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">&#127968; Property</div>
              <div style="font-size:16px;font-weight:700;">${esc(prop.address || '')}</div>
              <div style="font-size:13px;color:var(--text-light);">${esc(prop.city || '')}${prop.state ? ', ' + esc(prop.state) : ''} ${esc(prop.zip || '')}</div>
              ${prop.county ? `<div style="font-size:12px;color:var(--text-light);">${esc(prop.county)}</div>` : ''}
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
              <a href="#" onclick="event.preventDefault();openPropertyModal(${JSON.stringify(prop).replace(/"/g, '&quot;')})" style="font-size:12px;">Edit</a>
              <a href="#" onclick="event.preventDefault();openReassignPropertyModal('${prop.id}','${id}')" style="font-size:12px;color:#e65100;">Change Owner</a>
            </div>
          </div>

          ${properties.length > 1 ? `
          <div style="margin-top:8px;">
            <select class="form-control" style="font-size:12px;padding:4px 8px;" onchange="openCustomerDetail('${id}', this.value)">
              ${properties.map(p2 => `<option value="${p2.id}" ${p2.id === prop.id ? 'selected' : ''}>${esc(p2.address || 'No Address')}</option>`).join('')}
            </select>
          </div>
          ` : ''}

          <div style="margin-top:10px;">
            <select class="form-control" style="font-size:12px;padding:4px 8px;width:auto;"
              onchange="window.api.saveProperty({id:'${prop.id}',property_type:this.value})">
              ${['Residential','Commercial','Multi-Family','Vacant Land','Municipal'].map(t => `<option value="${t}" ${prop.property_type === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>
        </div>

        <!-- TANKS -->
        <div class="card" style="padding:16px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <div style="font-weight:700;font-size:14px;">${tanks.length} Tank${tanks.length !== 1 ? 's' : ''} &nbsp; <span style="color:var(--text-light);">${totalTankGal.toLocaleString()} Gallons</span></div>
            <button class="btn btn-sm" style="background:#2e7d32;color:white;font-size:10px;padding:3px 8px;" onclick="openTankModal()">+ New Tank</button>
          </div>
          ${tanks.length === 0 ? '<div style="color:var(--text-light);font-size:12px;padding:8px 0;">No tanks. Add one above.</div>' : ''}
          ${tanks.map(t => `
            <details style="border:1px solid #e0e0e0;border-radius:6px;margin-bottom:8px;overflow:hidden;" open>
              <summary style="padding:8px 12px;background:#f5f5f5;cursor:pointer;display:flex;justify-content:space-between;align-items:center;">
                <span style="font-weight:600;font-size:13px;">${(t.volume_gallons || 0).toLocaleString()} Gallons &nbsp; <span style="font-weight:400;color:var(--text-light);">${esc(t.tank_type || 'Tank')}</span></span>
                <span style="display:flex;gap:4px;">
                  ${t.filter === 'yes' ? '<span class="badge" style="background:#e3f2fd;color:#1565c0;font-size:9px;">Filter</span>' : ''}
                  ${t.riser === 'yes' ? '<span class="badge" style="background:#e8f5e9;color:#2e7d32;font-size:9px;">Riser</span>' : ''}
                  ${t.reachable_from_driveway === 'yes' ? '<span class="badge" style="background:#fff3e0;color:#e65100;font-size:9px;">Driveway</span>' : ''}
                </span>
              </summary>
              <div style="padding:10px 12px;font-size:12px;line-height:1.8;">
                ${t.tank_name ? `<div><strong>Name:</strong> ${esc(t.tank_name)}</div>` : ''}
                ${t.notes ? `<div><strong>Notes:</strong> ${esc(t.notes)}</div>` : ''}
                <div><strong>Filter:</strong> ${esc(t.filter || 'Unknown')} &nbsp; <strong>Pump Frequency:</strong> ${esc(t.pump_frequency || 'N/A')}</div>
                ${t.last_pump_date ? `<div><strong>Last Pumped:</strong> ${t.last_pump_date}</div>` : ''}
                ${t.depth_inches ? `<div><strong>Depth:</strong> ${t.depth_inches}" &nbsp; <strong>Hose:</strong> ${t.hose_length_ft || '?'} ft</div>` : ''}
                <div style="margin-top:6px;">
                  <button class="btn btn-sm btn-secondary" style="font-size:10px;padding:2px 8px;" onclick="openTankModal(${JSON.stringify(t).replace(/"/g, '&quot;')})">Edit Tank</button>
                  <button class="btn btn-sm" style="font-size:10px;padding:2px 8px;color:#c62828;" onclick="if(confirm('Delete this tank?')){window.api.deleteTank('${t.id}');openCustomerDetail('${id}','${prop.id}')}">Delete</button>
                </div>
              </div>
            </details>
          `).join('')}
        </div>

        <!-- Property Notes -->
        <div class="card" style="padding:16px;">
          <details ${prop.notes ? 'open' : ''}>
            <summary style="cursor:pointer;font-weight:700;font-size:13px;">Property Notes &#128221;</summary>
            <textarea style="width:100%;min-height:80px;margin-top:8px;font-size:12px;border:1px solid #ddd;border-radius:4px;padding:8px;resize:vertical;"
              onblur="window.api.saveProperty({id:'${prop.id}',notes:this.value})">${esc(prop.notes || '')}</textarea>
          </details>
        </div>

        <!-- Tank Location Diagram -->
        <div class="card" style="padding:16px;">
          <div style="font-weight:700;font-size:13px;margin-bottom:8px;">Tank Location Diagram</div>
          <div id="tankDiagramZone" class="tank-diagram-dropzone"
            ondragover="event.preventDefault();this.classList.add('dragover')"
            ondragleave="this.classList.remove('dragover')"
            ondrop="handleTankDiagramDrop(event,'${prop.id}','${id}')"
            onclick="document.getElementById('tankDiagramInput').click()">
            ${prop.tank_diagram
              ? `<img src="${prop.tank_diagram}" style="max-width:100%;max-height:300px;border-radius:4px;">`
              : `<div style="text-align:center;padding:24px;color:var(--text-light);">
                  <div style="font-size:24px;margin-bottom:6px;">&#128206;</div>
                  <div style="font-size:12px;">Drop gif, jpg, jpeg, and png images here<br>or <span style="color:#1565c0;text-decoration:underline;">Browse your files</span></div>
                </div>`
            }
          </div>
          <input type="file" id="tankDiagramInput" accept="image/*" style="display:none;" onchange="handleTankDiagramFile(this.files[0],'${prop.id}','${id}')">
          ${prop.tank_diagram ? `<button class="btn btn-sm" style="margin-top:6px;font-size:10px;color:#c62828;" onclick="window.api.saveProperty({id:'${prop.id}',tank_diagram:''});openCustomerDetail('${id}','${prop.id}')">Remove Image</button>` : ''}
        </div>

        <!-- Directions -->
        <div class="card" style="padding:16px;">
          <div style="font-weight:700;font-size:13px;margin-bottom:6px;">Directions</div>
          <textarea style="width:100%;min-height:60px;font-size:12px;border:1px solid #ddd;border-radius:4px;padding:8px;resize:vertical;"
            onblur="window.api.saveProperty({id:'${prop.id}',directions:this.value})">${esc(prop.directions || '')}</textarea>
        </div>
        ` : `
        <div class="card" style="padding:24px;text-align:center;">
          <div style="font-size:32px;margin-bottom:8px;">&#127968;</div>
          <p style="color:var(--text-light);">No properties yet.</p>
          <button class="btn btn-primary" onclick="openPropertyModal()">+ Add Property</button>
        </div>
        `}
      </div>

      <!-- ====== RIGHT: SERVICES ====== -->
      <div style="display:flex;flex-direction:column;gap:12px;">
        <!-- Schedule Appointment -->
        <button class="btn btn-primary" style="width:100%;font-weight:700;font-size:13px;padding:10px;" onclick="openJobModal({customer_id:'${id}',property_id:'${prop?.id || ''}'})">+ SCHEDULE APPOINTMENT</button>

        <!-- Current Appointments -->
        <div class="card" style="padding:12px;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
            <span style="font-size:16px;">&#128197;</span>
            <span style="font-weight:700;font-size:13px;">${upcomingJobs.length} Current Appointment${upcomingJobs.length !== 1 ? 's' : ''}</span>
          </div>
          ${upcomingJobs.length === 0 ? '<div style="color:var(--text-light);font-size:12px;">No upcoming appointments.</div>' : ''}
          ${upcomingJobs.slice(0, 10).map(j => `
            <div style="padding:6px 8px;margin-bottom:4px;border-radius:4px;cursor:pointer;background:#fafafa;border-left:3px solid var(--primary);" onclick="openJobDetail('${j.id}')">
              <div style="display:flex;justify-content:space-between;">
                <div style="font-weight:600;font-size:12px;">${esc(j.customers?.name || customer.name)}</div>
                <div style="font-size:11px;color:var(--text-light);">${j.scheduled_date || ''}</div>
              </div>
              <div style="font-size:11px;color:var(--text-light);">${esc(j.service_type || 'Pumping')}</div>
              ${j.invoice_number ? `<div style="font-size:11px;color:#1565c0;">${esc(j.invoice_number)}</div>` : ''}
            </div>
          `).join('')}
        </div>

        <!-- Service Due Notices -->
        <div style="display:flex;gap:4px;margin-bottom:4px;">
          <button class="btn" style="flex:1;font-weight:700;font-size:11px;padding:6px 4px;background:#ff8f00;color:white;" onclick="quickCreateSdn('${id}','${prop?.id || ''}','Pumping',3,'years')">Pump / 3yr</button>
          <button class="btn" style="flex:1;font-weight:700;font-size:11px;padding:6px 4px;background:#ff8f00;color:white;" onclick="quickCreateSdn('${id}','${prop?.id || ''}','Pumping',5,'years')">Pump / 5yr</button>
        </div>
        <button class="btn" style="width:100%;font-weight:700;font-size:12px;padding:8px;background:#ff8f00;color:white;" onclick="openServiceDueNoticeModal(null,'${id}','${prop?.id || ''}')">+ NEW SERVICE DUE NOTICE</button>
        <div class="card" style="padding:12px;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
            <span style="font-size:16px;">&#9989;</span>
            <span style="font-weight:700;font-size:13px;">${notices.length} Service Due Notice${notices.length !== 1 ? 's' : ''} (SDN)</span>
          </div>
          ${notices.length === 0 ? '<div style="color:var(--text-light);font-size:12px;">No service due notices.</div>' : ''}
          ${notices.map(n => {
            const statusColors = { pending: '#ff9800', sent: '#2196f3', scheduled: '#4caf50', completed: '#388e3c', dismissed: '#9e9e9e' };
            return `
            <div style="padding:6px 8px;margin-bottom:4px;border-radius:4px;background:#fafafa;border-left:3px solid ${statusColors[n.status] || '#ccc'};cursor:pointer;" onclick="openServiceDueNoticeModal(${JSON.stringify(n).replace(/"/g, '&quot;')},'${id}','${prop?.id || ''}')">
              <div style="display:flex;justify-content:space-between;">
                <span style="font-weight:600;font-size:12px;">${esc(n.service_type || 'Service')}</span>
                <span class="badge" style="font-size:9px;background:${n.status === 'pending' ? (n.email_enabled !== false ? '#388e3c' : '#9e9e9e') : (statusColors[n.status] || '#ccc')};color:white;">${n.status === 'pending' ? (n.email_enabled !== false ? 'Email ON' : 'Email OFF') : esc((n.status || '').toUpperCase())}</span>
              </div>
              <div style="font-size:11px;color:var(--text-light);">Due: ${n.due_date || 'N/A'}</div>
            </div>`;
          }).join('')}
        </div>

        <!-- Service Contracts -->
        <button class="btn" style="width:100%;font-weight:700;font-size:12px;padding:8px;background:#2e7d32;color:white;" onclick="openServiceContractModal(null,'${id}','${prop?.id || ''}')">+ NEW SERVICE CONTRACT</button>
        <div class="card" style="padding:12px;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
            <span style="font-size:16px;">&#128197;</span>
            <span style="font-weight:700;font-size:13px;">${contracts.length} Service Contract${contracts.length !== 1 ? 's' : ''}</span>
          </div>
          ${contracts.length === 0 ? '<div style="color:var(--text-light);font-size:12px;">No service contracts.</div>' : ''}
          ${contracts.map(c => {
            const cColors = { active: '#4caf50', expired: '#ff9800', cancelled: '#f44336' };
            return `
            <div style="padding:6px 8px;margin-bottom:4px;border-radius:4px;background:#fafafa;border-left:3px solid ${cColors[c.status] || '#ccc'};cursor:pointer;" onclick="openServiceContractModal(${JSON.stringify(c).replace(/"/g, '&quot;')},'${id}','${prop?.id || ''}')">
              <div style="display:flex;justify-content:space-between;">
                <span style="font-weight:600;font-size:12px;">${esc(c.contract_type || 'Contract')}</span>
                <span class="badge" style="font-size:9px;background:${cColors[c.status] || '#ccc'};color:white;">${esc((c.status || 'active').toUpperCase())}</span>
              </div>
              <div style="font-size:11px;color:var(--text-light);">${c.start_date || ''} — ${c.end_date || ''} &nbsp; ${c.frequency || ''}</div>
              ${c.price ? `<div style="font-size:11px;font-weight:600;">$${Number(c.price).toFixed(2)}</div>` : ''}
            </div>`;
          }).join('')}
        </div>

        <!-- Prior Jobs -->
        <div class="card" style="padding:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <span style="font-weight:700;font-size:13px;">&#128203; ${pastJobs.length} Prior Job${pastJobs.length !== 1 ? 's' : ''}</span>
            ${pastJobs.length > 5 ? `<a href="#" onclick="event.preventDefault();document.getElementById('priorJobsFull').style.display='block';this.style.display='none'" style="font-size:11px;">See All</a>` : ''}
          </div>
          ${pastJobs.length === 0 ? '<div style="color:var(--text-light);font-size:12px;">No prior jobs.</div>' : ''}
          ${pastJobs.slice(0, 5).map(j => `
            <div style="padding:4px 8px;margin-bottom:3px;border-radius:4px;cursor:pointer;background:#fafafa;font-size:12px;border-left:3px solid ${j.status === 'completed' ? 'var(--success)' : '#ccc'};" onclick="openJobDetail('${j.id}')">
              <div style="display:flex;justify-content:space-between;"><span>${esc(j.property?.address || '')}</span><span style="color:var(--text-light);font-size:11px;">${j.scheduled_date || ''}</span></div>
            </div>
          `).join('')}
          ${pastJobs.length > 5 ? `
          <div id="priorJobsFull" style="display:none;">
            ${pastJobs.slice(5).map(j => `
              <div style="padding:4px 8px;margin-bottom:3px;border-radius:4px;cursor:pointer;background:#fafafa;font-size:12px;border-left:3px solid ${j.status === 'completed' ? 'var(--success)' : '#ccc'};" onclick="openJobDetail('${j.id}')">
                <div style="display:flex;justify-content:space-between;"><span>${esc(j.property?.address || '')}</span><span style="color:var(--text-light);font-size:11px;">${j.scheduled_date || ''}</span></div>
              </div>
            `).join('')}
          </div>` : ''}
        </div>
      </div>
    </div>
  `;
}

// Tank diagram drag-drop and file upload handlers
async function handleTankDiagramDrop(e, propertyId, customerId) {
  e.preventDefault();
  e.currentTarget.classList.remove('dragover');
  const file = e.dataTransfer?.files?.[0];
  if (file && file.type.startsWith('image/')) {
    await saveTankDiagramFile(file, propertyId, customerId);
  }
}

async function handleTankDiagramFile(file, propertyId, customerId) {
  if (!file || !file.type.startsWith('image/')) return;
  await saveTankDiagramFile(file, propertyId, customerId);
}

async function saveTankDiagramFile(file, propertyId, customerId) {
  const reader = new FileReader();
  reader.onload = async (ev) => {
    // Resize to max 800px wide using canvas
    const img = new Image();
    img.onload = async () => {
      const maxW = 800;
      let w = img.width, h = img.height;
      if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      await window.api.saveProperty({ id: propertyId, tank_diagram: dataUrl });
      openCustomerDetail(customerId, propertyId);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

// ===== REASSIGN PROPERTY TO DIFFERENT CUSTOMER =====
async function openReassignPropertyModal(propertyId, currentOwnerId) {
  const { data: allCustomers } = await window.api.getCustomers();
  const others = allCustomers.filter(c => c.id !== currentOwnerId).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  openModal('Change Property Owner', `
    <p style="font-size:13px;margin-bottom:12px;">Reassign this property to a different contact. All tanks stay with the property.</p>
    <div class="form-group">
      <label>New Owner *</label>
      <select id="reassignCustomerId" class="form-control">
        <option value="">-- Select Customer --</option>
        ${others.map(c => `<option value="${c.id}">${esc(c.name)}${c.phone ? ' — ' + esc(c.phone) : ''}</option>`).join('')}
      </select>
    </div>
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" style="background:#e65100;" onclick="reassignProperty('${propertyId}')">Transfer Ownership</button>
  `);
}

async function reassignProperty(propertyId) {
  const newCustomerId = document.getElementById('reassignCustomerId').value;
  if (!newCustomerId) { showToast('Select a customer.', 'error'); return; }
  const result = await window.api.saveProperty({ id: propertyId, customer_id: newCustomerId });
  if (result.success) {
    closeModal();
    showToast('Property reassigned.', 'success');
    openCustomerDetail(newCustomerId, propertyId);
  }
}

// ===== CUSTOMER ACCOUNTING =====
async function openCustomerAccounting(customerId, activeTab = 'activity') {
  const { data: customer } = await window.api.getCustomer(customerId);
  const { data: invoices } = await window.api.getInvoices({ customerId });
  const { data: payments } = await window.api.getPayments(customerId);
  const acctInfo = await window.api.getCustomerBalance(customerId);
  const { data: settings } = await window.api.getSettings();
  const { data: properties } = await window.api.getProperties(customerId);

  const companyName = settings?.company_name || 'Interstate Septic Systems';
  const companyAddress = settings?.company_address || '';
  const companyPhone = settings?.company_phone || '';

  const allInvoices = invoices || [];
  const allPayments = payments || [];
  const firstProp = properties?.[0];
  const addrLine = firstProp ? `${firstProp.address || ''}, ${firstProp.city || ''}${firstProp.state ? ', ' + firstProp.state : ''}` : '';

  // Build activity rows: invoices + payments merged by date
  const activityRows = [];
  let runningBalance = 0;
  const sortedInv = [...allInvoices].sort((a, b) => (a.svc_date || '').localeCompare(b.svc_date || ''));
  const sortedPay = [...allPayments].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  let iIdx = 0, pIdx = 0;
  while (iIdx < sortedInv.length || pIdx < sortedPay.length) {
    const invDate = iIdx < sortedInv.length ? (sortedInv[iIdx].svc_date || '9999') : '9999';
    const payDate = pIdx < sortedPay.length ? (sortedPay[pIdx].date || '9999') : '9999';
    if (invDate <= payDate && iIdx < sortedInv.length) {
      const inv = sortedInv[iIdx++];
      const invTotal = parseFloat(inv.total) || 0;
      runningBalance += invTotal;
      activityRows.push({ date: inv.svc_date || '', invNum: inv.invoice_number || '', invId: inv.id, desc: inv.job_codes || 'Service', invAmt: invTotal, amtPaid: '', balance: runningBalance, type: 'invoice', status: inv.payment_status || 'unpaid' });
    } else if (pIdx < sortedPay.length) {
      const pay = sortedPay[pIdx++];
      const payAmt = parseFloat(pay.amount) || 0;
      const sign = pay.type === 'refund' ? 1 : -1;
      runningBalance += sign * payAmt;
      const linkedInv = allInvoices.find(i => i.id === pay.invoice_id);
      activityRows.push({ date: pay.date || '', invNum: linkedInv?.invoice_number || '', invId: pay.invoice_id, desc: (pay.type === 'refund' ? 'Refund' : 'Payment') + (pay.method ? ' — ' + pay.method : '') + (pay.check_number ? ' #' + pay.check_number : ''), invAmt: '', amtPaid: pay.type === 'refund' ? -payAmt : payAmt, balance: runningBalance, type: pay.type || 'payment', paymentId: pay.id, notes: pay.notes || '' });
    }
  }

  currentPage = 'customers';
  currentCustomerId = customerId;
  document.querySelectorAll('.page').forEach(p => { p.classList.remove('active'); p.style.display = ''; });
  document.getElementById('page-customers').classList.add('active');
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.page === 'customers'));

  const page = document.getElementById('page-customers');
  document.getElementById('pageTitle').textContent = customer.name + ' — Accounting';
  document.getElementById('pageActions').innerHTML = `
    <button class="btn btn-secondary" onclick="openCustomerDetail('${customerId}')">&#8592; Back to ${esc(customer.name)}</button>
  `;

  // --- ACTIVITY TAB CONTENT ---
  const activityHtml = `
    <div class="card acct-panel" style="border-radius:0 0 6px 6px;margin-top:0;">
      <table class="data-table" style="width:100%;font-size:13px;">
        <thead>
          <tr style="background:#1a237e;color:#fff;">
            <th style="padding:10px 12px;">Date</th>
            <th style="padding:10px 12px;">Inv #</th>
            <th style="padding:10px 12px;">Description</th>
            <th style="padding:10px 12px;text-align:right;">Inv Amt</th>
            <th style="padding:10px 12px;text-align:right;">Amt Paid</th>
            <th style="padding:10px 12px;text-align:right;">Balance</th>
            <th style="padding:10px 8px;width:36px;"></th>
          </tr>
        </thead>
        <tbody>
          ${activityRows.length === 0 ? '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-light);">No activity yet.</td></tr>' : ''}
          ${activityRows.map((r, idx) => {
            const isPayRow = r.type === 'payment' || r.type === 'refund';
            const rowBg = isPayRow ? '#e8f5e9' : (idx % 2 === 0 ? '#fff' : '#f8f9fa');
            let statusCell = '';
            if (r.type === 'invoice') {
              if (r.status === 'paid') statusCell = '<span style="background:#2e7d32;color:#fff;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:700;">P</span>';
              else if (r.status === 'partial') statusCell = '<span style="background:#e65100;color:#fff;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:700;">$</span>';
              else statusCell = '<span style="background:#c62828;color:#fff;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:700;">U</span>';
            } else if (isPayRow) {
              statusCell = '<span style="background:#2e7d32;width:8px;height:100%;display:inline-block;border-radius:2px;">&nbsp;</span>';
            }
            const invLink = r.invId ? `<a href="#" onclick="event.preventDefault();openInvoiceModal(null,'${r.invId}')" style="color:#1565c0;font-weight:600;">${esc(r.invNum)}</a>` : '';
            const delLink = r.paymentId ? `<a href="#" onclick="event.preventDefault();deletePaymentConfirm('${r.paymentId}','${customerId}')" style="color:#c62828;font-size:11px;" title="Delete">&#10005;</a>` : '';
            const balColor = r.balance > 0.01 ? '#c62828' : '#2e7d32';
            return `<tr style="background:${rowBg};"><td style="padding:8px 12px;">${r.date}</td><td style="padding:8px 12px;">${invLink}<div style="margin-top:2px;">${statusCell}</div></td><td style="padding:8px 12px;">${esc(r.desc)}</td><td style="padding:8px 12px;text-align:right;font-weight:600;">${r.invAmt !== '' ? '$' + parseFloat(r.invAmt).toFixed(2) : ''}</td><td style="padding:8px 12px;text-align:right;color:#2e7d32;font-weight:600;">${r.amtPaid !== '' ? '$' + parseFloat(r.amtPaid).toFixed(2) : ''}</td><td style="padding:8px 12px;text-align:right;font-weight:700;color:${balColor};">$${Math.abs(r.balance).toFixed(2)}</td><td style="padding:8px 4px;text-align:center;">${delLink}</td></tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div style="padding:12px 16px;font-size:12px;color:#555;display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-top:8px;">
      <span>C = Complete,</span>
      <span><span style="background:#c62828;color:#fff;padding:1px 5px;border-radius:3px;font-weight:700;font-size:11px;">U</span> = Unpaid / has Balance,</span>
      <span>P = Paid in full,</span>
      <span>&#8960; = No Charge,</span>
      <span><span style="display:inline-block;width:10px;height:10px;background:#2e7d32;border-radius:2px;vertical-align:middle;"></span> = Linked Payment/Invoice,</span>
      <span><span style="display:inline-block;width:10px;height:10px;background:#1565c0;border-radius:2px;vertical-align:middle;"></span> = Unapplied Funds,</span>
      <span><span style="background:#c62828;color:#fff;padding:1px 5px;border-radius:3px;font-weight:700;font-size:11px;">B</span> = Bad Debt</span>
      <span><span style="background:#e65100;color:#fff;padding:1px 5px;border-radius:3px;font-weight:700;font-size:11px;">N</span> = Contains a note</span>
    </div>`;

  // --- MONTHLY STATEMENT TAB CONTENT ---
  const now = new Date();
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const curMonth = now.getMonth();
  const curYear = now.getFullYear();
  const stmtFrom = `${curYear}-${String(curMonth + 1).padStart(2, '0')}-01`;
  const stmtTo = now.toISOString().split('T')[0];
  const stmtLabel = `${monthNames[curMonth]} ${curYear}`;

  // Filter activity for current month
  const monthInvoices = allInvoices.filter(i => i.svc_date && i.svc_date >= stmtFrom && i.svc_date <= stmtTo);
  const monthPayments = allPayments.filter(p => p.date && p.date >= stmtFrom && p.date <= stmtTo);
  const newCharges = monthInvoices.reduce((s, i) => s + (parseFloat(i.total) || 0), 0);
  const lessPayments = monthPayments.filter(p => p.type !== 'refund').reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  const prevBalance = acctInfo.balance - newCharges + lessPayments;
  const balanceDue = acctInfo.balance;

  // Build statement rows
  // Fetch tech notes for invoices with linked jobs
  const stmtJobNotes = {};
  for (const inv of monthInvoices) {
    if (inv.job_id) {
      try {
        const { data: job } = await window.api.getJob(inv.job_id);
        if (job?.tech_notes) stmtJobNotes[inv.id] = job.tech_notes;
      } catch (e) { /* ignore */ }
    }
  }

  const stmtRows = [];
  monthInvoices.forEach(inv => {
    let desc = inv.job_codes || 'Service';
    if (stmtJobNotes[inv.id]) desc += '<br><em style="color:#555;font-size:11px;">Notes: ' + esc(stmtJobNotes[inv.id]) + '</em>';
    stmtRows.push({ date: inv.svc_date, invNum: inv.invoice_number || '', invId: inv.id, desc, payments: '', charges: parseFloat(inv.total) || 0 });
  });
  monthPayments.forEach(pay => {
    const linkedInv = allInvoices.find(i => i.id === pay.invoice_id);
    const desc = (pay.type === 'refund' ? 'Refund' : 'Payment') + (pay.method ? ': ' + pay.method.charAt(0).toUpperCase() + pay.method.slice(1) : '') + (linkedInv ? ' Inv #' + linkedInv.invoice_number : '');
    stmtRows.push({ date: pay.date, invNum: '', invId: null, desc, payments: parseFloat(pay.amount) || 0, charges: '' });
  });
  stmtRows.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const totalStmtPayments = stmtRows.reduce((s, r) => s + (r.payments || 0), 0);
  const totalStmtCharges = stmtRows.reduce((s, r) => s + (r.charges || 0), 0);

  // Bill-to address
  const billTo = [customer.name, customer.company || '', customer.address || '', (customer.city || '') + (customer.state ? ', ' + customer.state : '') + ' ' + (customer.zip || '')].filter(Boolean);
  // Property info
  const propInfo = firstProp ? [firstProp.address || '', (firstProp.city || '') + (firstProp.state ? ', ' + firstProp.state : '') + ' ' + (firstProp.zip || '')] : [];

  const monthlyStmtHtml = `
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:16px;">
      <select id="stmtMonthSelect" style="padding:6px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px;">
        ${monthNames.map((m, i) => `<option value="${i}" ${i === curMonth ? 'selected' : ''}>${m}, ${curYear}</option>`).join('')}
      </select>
      <input type="date" id="stmtFrom" value="${stmtFrom}" style="padding:6px 8px;border:1px solid #ccc;border-radius:4px;font-size:13px;">
      <span style="color:var(--text-light);">to</span>
      <input type="date" id="stmtTo" value="${stmtTo}" style="padding:6px 8px;border:1px solid #ccc;border-radius:4px;font-size:13px;">
    </div>
    <div style="display:flex;gap:8px;margin-bottom:16px;">
      <button class="acct-action-btn" style="background:#c62828;" onclick="showToast('Pay Now coming soon','info')">PAY NOW</button>
      <button class="acct-action-btn" style="background:#2e7d32;" onclick="openSendStatementModal('${customerId}')">SEND STATEMENT</button>
      <button class="acct-action-btn" style="background:#1565c0;" onclick="exportStatementPdf('${customerId}')">EXPORT PDF</button>
    </div>
    <div style="background:#fff;border:1px solid #ddd;padding:32px 40px;font-family:'Georgia',serif;color:#333;">
      <!-- Statement Header -->
      <div style="display:flex;justify-content:space-between;margin-bottom:24px;">
        <div>
          <div style="font-size:22px;font-weight:700;color:#1a237e;">${esc(companyName)}</div>
          ${companyAddress ? `<div style="font-size:13px;margin-top:4px;">${esc(companyAddress)}</div>` : ''}
          ${companyPhone ? `<div style="font-size:13px;">${esc(companyPhone)}</div>` : ''}
        </div>
        <div style="text-align:right;">
          <div style="font-size:18px;font-weight:700;">STATEMENT / INVOICE</div>
          <div style="font-size:13px;color:#555;margin-top:4px;">${esc(monthNames[curMonth])} 1 through ${esc(monthNames[curMonth])} ${now.getDate()}</div>
          <div style="font-size:13px;margin-top:8px;">Statement Creation Date: <strong>${stmtTo}</strong></div>
        </div>
      </div>

      <!-- Summary Box -->
      <div style="display:flex;justify-content:space-between;margin-bottom:24px;">
        <div>
          <div style="font-size:12px;font-weight:700;margin-bottom:4px;">BILL TO</div>
          ${billTo.map(l => `<div style="font-size:13px;">${esc(l)}</div>`).join('')}
        </div>
        <div style="text-align:right;min-width:280px;">
          <table style="margin-left:auto;font-size:14px;border-collapse:collapse;">
            <tr><td style="padding:3px 16px 3px 0;color:#555;">Previous Balance:</td><td style="text-align:right;font-weight:600;">$${prevBalance.toFixed(2)}</td></tr>
            <tr><td style="padding:3px 16px 3px 0;color:#555;">New Charges:</td><td style="text-align:right;font-weight:600;">$${newCharges.toFixed(2)}</td></tr>
            <tr><td style="padding:3px 16px 3px 0;color:#555;">Payments Received:</td><td style="text-align:right;font-weight:600;">-$${lessPayments.toFixed(2)}</td></tr>
            <tr style="border-top:2px solid #333;"><td style="padding:8px 16px 3px 0;font-weight:700;font-size:16px;">Balance Due:</td><td style="text-align:right;font-weight:700;font-size:16px;color:${balanceDue > 0 ? '#c62828' : '#2e7d32'};">$${balanceDue.toFixed(2)}</td></tr>
            <tr><td style="padding:3px 16px 3px 0;font-weight:700;">Payment Due Date:</td><td style="text-align:right;"><span style="border:1px solid #333;padding:2px 12px;font-weight:700;">${stmtTo}</span></td></tr>
          </table>
        </div>
      </div>

      ${firstProp ? `
      <div style="margin-bottom:20px;">
        <div style="font-size:12px;font-weight:700;margin-bottom:4px;">PROPERTY</div>
        ${propInfo.map(l => `<div style="font-size:13px;">${esc(l)}</div>`).join('')}
      </div>` : ''}

      <!-- Statement Table -->
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="border-bottom:2px solid #1a237e;">
            <th style="padding:8px 8px;text-align:left;font-weight:700;">DATE</th>
            <th style="padding:8px 8px;text-align:left;font-weight:700;">INVOICE #</th>
            <th style="padding:8px 8px;text-align:left;font-weight:700;">DESCRIPTION</th>
            <th style="padding:8px 8px;text-align:right;font-weight:700;">PAYMENTS</th>
            <th style="padding:8px 8px;text-align:right;font-weight:700;">CHARGES</th>
          </tr>
        </thead>
        <tbody>
          ${stmtRows.length === 0 ? '<tr><td colspan="5" style="text-align:center;padding:20px;color:#999;">No activity this period.</td></tr>' : ''}
          ${stmtRows.map(r => `
            <tr style="border-bottom:1px solid #eee;">
              <td style="padding:8px;">${r.date}</td>
              <td style="padding:8px;">${r.invId ? `<a href="#" onclick="event.preventDefault();openInvoiceModal(null,'${r.invId}')" style="color:#1565c0;font-weight:600;">${esc(r.invNum)}</a>` : ''}</td>
              <td style="padding:8px;">${esc(r.desc)}</td>
              <td style="padding:8px;text-align:right;">${r.payments ? '$ ' + parseFloat(r.payments).toFixed(2) : ''}</td>
              <td style="padding:8px;text-align:right;">${r.charges ? '$ ' + parseFloat(r.charges).toFixed(2) : ''}</td>
            </tr>
          `).join('')}
          <tr style="border-top:2px solid #333;font-weight:700;">
            <td colspan="3" style="padding:8px;">Total Payments and New Charges</td>
            <td style="padding:8px;text-align:right;">$ ${totalStmtPayments.toFixed(2)}</td>
            <td style="padding:8px;text-align:right;">$ ${totalStmtCharges.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>

      <!-- Footer -->
      <div style="margin-top:32px;padding-top:16px;border-top:1px solid #ddd;font-size:12px;color:#777;">
        ${companyAddress ? `<div>Send payments to ${esc(companyAddress)}${companyPhone ? ' or call ' + esc(companyPhone) + ' to pay via phone' : ''}.</div>` : ''}
        <div>Payment methods: ACH, Cash, Check, Credit Card, Debit</div>
      </div>
    </div>`;

  // --- RECEIVABLES TAB CONTENT ---
  const unpaidInvoices = allInvoices.filter(i => (parseFloat(i.total) || 0) > (parseFloat(i.amount_paid) || 0));
  const receivablesHtml = `
    <div class="card acct-panel" style="border-radius:0 0 6px 6px;margin-top:0;">
      <table class="data-table" style="width:100%;font-size:13px;">
        <thead>
          <tr style="background:#1a237e;color:#fff;">
            <th style="padding:10px 12px;">Invoice #</th>
            <th style="padding:10px 12px;">Date</th>
            <th style="padding:10px 12px;">Description</th>
            <th style="padding:10px 12px;text-align:right;">Total</th>
            <th style="padding:10px 12px;text-align:right;">Paid</th>
            <th style="padding:10px 12px;text-align:right;">Balance</th>
            <th style="padding:10px 12px;">Age</th>
          </tr>
        </thead>
        <tbody>
          ${unpaidInvoices.length === 0 ? '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-light);">All paid up!</td></tr>' : ''}
          ${unpaidInvoices.map(inv => {
            const invTotal = parseFloat(inv.total) || 0;
            const invPaid = parseFloat(inv.amount_paid) || 0;
            const invBal = invTotal - invPaid;
            const age = inv.svc_date ? Math.floor((Date.now() - new Date(inv.svc_date).getTime()) / (1000*60*60*24)) : 0;
            const ageColor = age > 60 ? '#c62828' : age > 30 ? '#e65100' : '#333';
            return `<tr><td style="padding:8px 12px;"><a href="#" onclick="event.preventDefault();openInvoiceModal(null,'${inv.id}')" style="color:#1565c0;font-weight:600;">${esc(inv.invoice_number || '')}</a></td><td style="padding:8px 12px;">${inv.svc_date || ''}</td><td style="padding:8px 12px;">${esc(inv.job_codes || 'Service')}</td><td style="padding:8px 12px;text-align:right;">$${invTotal.toFixed(2)}</td><td style="padding:8px 12px;text-align:right;color:#2e7d32;">$${invPaid.toFixed(2)}</td><td style="padding:8px 12px;text-align:right;font-weight:700;color:#c62828;">$${invBal.toFixed(2)}</td><td style="padding:8px 12px;font-weight:700;color:${ageColor};">${age} days</td></tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

  // --- RECEIPTS TAB CONTENT ---
  const receiptPayments = [...allPayments].filter(p => p.type !== 'refund').sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const receiptsHtml = `
    <div class="card acct-panel" style="border-radius:0 0 6px 6px;margin-top:0;">
      ${receiptPayments.length === 0 ? '<div style="text-align:center;padding:40px;color:var(--text-light);">No receipts yet. Receipts are automatically created when payments are applied.</div>' : ''}
      ${receiptPayments.map((pay, idx) => {
        const linkedInv = allInvoices.find(i => i.id === pay.invoice_id);
        const rcptNum = 'RCT-' + String(receiptPayments.length - idx).padStart(4, '0');
        const amt = parseFloat(pay.amount) || 0;
        const methodLabel = (pay.method || 'cash').charAt(0).toUpperCase() + (pay.method || 'cash').slice(1);
        return `
        <div style="border:1px solid #e0e0e0;border-radius:8px;padding:20px;margin-bottom:12px;background:#fafafa;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;">
            <div>
              <div style="font-size:16px;font-weight:700;color:#1a237e;">Receipt ${rcptNum}</div>
              <div style="font-size:13px;color:#555;margin-top:4px;">Date: <strong>${pay.date || 'N/A'}</strong></div>
              <div style="font-size:13px;color:#555;">Method: <strong>${esc(methodLabel)}</strong>${pay.check_number ? ' #' + esc(pay.check_number) : ''}</div>
              ${linkedInv ? `<div style="font-size:13px;color:#555;">Applied to Invoice: <strong>#${esc(linkedInv.invoice_number || '')}</strong> (${linkedInv.svc_date || ''})</div>` : ''}
              ${pay.notes ? `<div style="font-size:12px;color:#888;margin-top:4px;font-style:italic;">${esc(pay.notes)}</div>` : ''}
            </div>
            <div style="text-align:right;">
              <div style="font-size:22px;font-weight:700;color:#2e7d32;">$${amt.toFixed(2)}</div>
              <button class="btn btn-sm" style="background:#2e7d32;color:white;font-size:11px;font-weight:600;padding:4px 12px;margin-top:8px;" onclick="emailReceipt('${customerId}','${pay.id}')">EMAIL RECEIPT</button>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>`;

  const tabSwitch = `document.querySelectorAll('.acct-tab-content').forEach(c=>c.style.display='none');this.parentElement.querySelectorAll('.acct-tab').forEach(t=>t.classList.remove('active'));this.classList.add('active');`;

  page.innerHTML = `
    <div style="max-width:1100px;margin:0 auto;">
      <div style="font-size:16px;color:#333;margin-bottom:12px;">${esc(addrLine)}</div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0;">
        <div style="display:flex;gap:0;">
          <button class="acct-tab ${activeTab === 'activity' ? 'active' : ''}" onclick="${tabSwitch}document.getElementById('acctTabActivity').style.display='';">Activity</button>
          <button class="acct-tab ${activeTab === 'receipts' ? 'active' : ''}" onclick="${tabSwitch}document.getElementById('acctTabReceipts').style.display='';">Receipts</button>
          <button class="acct-tab ${activeTab === 'statement' ? 'active' : ''}" onclick="${tabSwitch}document.getElementById('acctTabStatement').style.display='';">Monthly Stmt</button>
          <button class="acct-tab ${activeTab === 'receivables' ? 'active' : ''}" onclick="${tabSwitch}document.getElementById('acctTabReceivables').style.display='';">Receivables</button>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="acct-action-btn" style="background:#1565c0;" onclick="navPush('Accounting', &quot;openCustomerAccounting('${customerId}')&quot;);openCustomerDetail('${customerId}')">ADD APPT</button>
          <button class="acct-action-btn" style="background:#2e7d32;" onclick="openAddPaymentModal('${customerId}')">ADD PAYMENT</button>
          <button class="acct-action-btn" style="background:#c62828;" onclick="openAddRefundModal('${customerId}')">ADD REFUND</button>
        </div>
      </div>

      <div id="acctTabActivity" class="acct-tab-content" style="${activeTab === 'activity' ? '' : 'display:none;'}">${activityHtml}</div>
      <div id="acctTabReceipts" class="acct-tab-content" style="${activeTab === 'receipts' ? '' : 'display:none;'}">${receiptsHtml}</div>
      <div id="acctTabStatement" class="acct-tab-content" style="${activeTab === 'statement' ? '' : 'display:none;'}">${monthlyStmtHtml}</div>
      <div id="acctTabReceivables" class="acct-tab-content" style="${activeTab === 'receivables' ? '' : 'display:none;'}">${receivablesHtml}</div>
    </div>
  `;
}

async function deletePaymentConfirm(paymentId, customerId) {
  if (!confirm('Delete this payment/refund? The invoice balance will be recalculated.')) return;
  await window.api.deletePayment(paymentId);
  showToast('Payment deleted.', 'success');
  openCustomerAccounting(customerId);
}

function openAddPaymentModal(customerId) {
  _openPaymentRefundModal(customerId, 'payment');
}

function openAddRefundModal(customerId) {
  _openPaymentRefundModal(customerId, 'refund');
}

async function _openPaymentRefundModal(customerId, type) {
  const { data: invoices } = await window.api.getInvoices({ customerId });
  const allInv = invoices || [];
  const unpaid = type === 'payment' ? allInv.filter(i => (parseFloat(i.total) || 0) > (parseFloat(i.amount_paid) || 0)) : allInv;

  const title = type === 'payment' ? 'Add Payment' : 'Add Refund';
  openModal(title, `
    <div class="form-group">
      <label>Invoice *</label>
      <select id="paymentInvoiceId" class="form-control">
        <option value="">-- Select Invoice --</option>
        ${unpaid.map(i => {
          const bal = ((parseFloat(i.total) || 0) - (parseFloat(i.amount_paid) || 0)).toFixed(2);
          return `<option value="${i.id}">#${esc(i.invoice_number)} — ${i.svc_date || 'No date'} — Bal: $${bal}</option>`;
        }).join('')}
      </select>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Amount *</label>
        <input type="number" id="paymentAmount" step="0.01" min="0" placeholder="0.00">
      </div>
      <div class="form-group">
        <label>Date *</label>
        <input type="date" id="paymentDate" value="${new Date().toISOString().split('T')[0]}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Method</label>
        <select id="paymentMethod" class="form-control" onchange="document.getElementById('paymentCheckRow').style.display=this.value==='check'?'block':'none'">
          <option value="cash">Cash</option>
          <option value="check">Check</option>
          <option value="credit">Credit Card</option>
          <option value="ach">ACH</option>
        </select>
      </div>
      <div class="form-group" id="paymentCheckRow" style="display:none;">
        <label>Check Number</label>
        <input type="text" id="paymentCheckNumber" placeholder="1234">
      </div>
    </div>
    <div class="form-group">
      <label>Notes</label>
      <textarea id="paymentNotes" rows="2" style="width:100%;"></textarea>
    </div>
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="savePaymentFromModal('${customerId}','${type}')">${title}</button>
  `);
}

async function savePaymentFromModal(customerId, type) {
  const invoiceId = document.getElementById('paymentInvoiceId').value;
  const amount = parseFloat(document.getElementById('paymentAmount').value);
  const date = document.getElementById('paymentDate').value;
  const method = document.getElementById('paymentMethod').value;
  const checkNumber = document.getElementById('paymentCheckNumber')?.value || '';
  const notes = document.getElementById('paymentNotes').value;

  if (!invoiceId) { showToast('Select an invoice.', 'error'); return; }
  if (!amount || amount <= 0) { showToast('Enter a valid amount.', 'error'); return; }
  if (!date) { showToast('Enter a date.', 'error'); return; }

  const result = await window.api.savePayment({
    customer_id: customerId,
    invoice_id: invoiceId,
    amount,
    date,
    method,
    check_number: checkNumber,
    type,
    notes
  });

  if (result.success) {
    closeModal();
    showToast(type === 'payment' ? 'Payment recorded.' : 'Refund recorded.', 'success');
    openCustomerAccounting(customerId);
  } else {
    showToast('Failed to save.', 'error');
  }
}

// ===== SEND STATEMENT / EXPORT =====
async function _buildStatementHtml(customerId) {
  const { data: customer } = await window.api.getCustomer(customerId);
  const { data: invoices } = await window.api.getInvoices({ customerId });
  const { data: payments } = await window.api.getPayments(customerId);
  const acctInfo = await window.api.getCustomerBalance(customerId);
  const { data: settings } = await window.api.getSettings();
  const { data: properties } = await window.api.getProperties(customerId);

  const companyName = settings?.company_name || 'Interstate Septic Systems';
  const companyAddress = settings?.company_address || '';
  const companyPhone = settings?.company_phone || '';
  const firstProp = properties?.[0];

  const now = new Date();
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const curMonth = now.getMonth();
  const curYear = now.getFullYear();
  const stmtFrom = `${curYear}-${String(curMonth + 1).padStart(2, '0')}-01`;
  const stmtTo = now.toISOString().split('T')[0];

  const allInvoices = invoices || [];
  const allPayments = payments || [];
  const monthInvoices = allInvoices.filter(i => i.svc_date && i.svc_date >= stmtFrom && i.svc_date <= stmtTo);
  const monthPayments = allPayments.filter(p => p.date && p.date >= stmtFrom && p.date <= stmtTo);
  const newCharges = monthInvoices.reduce((s, i) => s + (parseFloat(i.total) || 0), 0);
  const lessPayments = monthPayments.filter(p => p.type !== 'refund').reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  const prevBalance = acctInfo.balance - newCharges + lessPayments;

  // Fetch tech notes for invoices with linked jobs
  const jobNotes = {};
  for (const inv of monthInvoices) {
    if (inv.job_id) {
      try {
        const { data: job } = await window.api.getJob(inv.job_id);
        if (job?.tech_notes) jobNotes[inv.id] = job.tech_notes;
      } catch (e) { /* ignore */ }
    }
  }

  const stmtRows = [];
  monthInvoices.forEach(inv => {
    let desc = inv.job_codes || 'Service';
    if (jobNotes[inv.id]) desc += '<br><em style="color:#555;font-size:11px;">Notes: ' + jobNotes[inv.id] + '</em>';
    stmtRows.push({ date: inv.svc_date, invNum: inv.invoice_number || '', desc, payments: '', charges: parseFloat(inv.total) || 0 });
  });
  monthPayments.forEach(pay => {
    const linkedInv = allInvoices.find(i => i.id === pay.invoice_id);
    stmtRows.push({ date: pay.date, invNum: '', desc: (pay.type === 'refund' ? 'Refund' : 'Payment') + (pay.method ? ': ' + pay.method.charAt(0).toUpperCase() + pay.method.slice(1) : '') + (linkedInv ? ' Inv #' + linkedInv.invoice_number : ''), payments: parseFloat(pay.amount) || 0, charges: '' });
  });
  stmtRows.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const totalPay = stmtRows.reduce((s, r) => s + (r.payments || 0), 0);
  const totalChg = stmtRows.reduce((s, r) => s + (r.charges || 0), 0);

  const billTo = [customer.name, customer.company || '', customer.address || '', (customer.city || '') + (customer.state ? ', ' + customer.state : '') + ' ' + (customer.zip || '')].filter(Boolean);
  const propLines = firstProp ? [firstProp.address || '', (firstProp.city || '') + (firstProp.state ? ', ' + firstProp.state : '') + ' ' + (firstProp.zip || '')] : [];

  return `<!DOCTYPE html><html><head><style>
    body{font-family:Georgia,serif;color:#333;margin:0;padding:24px 32px;font-size:13px;}
    table{width:100%;border-collapse:collapse;}
    th{text-align:left;padding:8px;border-bottom:2px solid #1a237e;font-weight:700;}
    td{padding:6px 8px;border-bottom:1px solid #eee;}
    .right{text-align:right;}
    .bold{font-weight:700;}
  </style></head><body>
    <div style="display:flex;justify-content:space-between;margin-bottom:20px;">
      <div>
        <div style="font-size:22px;font-weight:700;color:#1a237e;">${companyName}</div>
        ${companyAddress ? `<div>${companyAddress}</div>` : ''}
        ${companyPhone ? `<div>${companyPhone}</div>` : ''}
      </div>
      <div style="text-align:right;">
        <div style="font-size:18px;font-weight:700;">STATEMENT / INVOICE</div>
        <div>${monthNames[curMonth]} 1 through ${monthNames[curMonth]} ${now.getDate()}</div>
        <div>Statement Creation Date: ${stmtTo}</div>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:20px;">
      <div>
        <div class="bold">BILL TO</div>
        ${billTo.map(l => `<div>${l}</div>`).join('')}
      </div>
      <div style="text-align:right;">
        <div>Previous Balance: <strong>$${prevBalance.toFixed(2)}</strong></div>
        <div>New Charges: <strong>$${newCharges.toFixed(2)}</strong></div>
        <div>Payments Received: <strong>-$${lessPayments.toFixed(2)}</strong></div>
        <div style="border-top:2px solid #333;margin-top:4px;padding-top:4px;font-size:16px;" class="bold">Balance Due: $${acctInfo.balance.toFixed(2)}</div>
        <div class="bold">Payment Due Date: ${stmtTo}</div>
      </div>
    </div>
    ${firstProp ? `<div style="margin-bottom:16px;"><div class="bold">PROPERTY</div>${propLines.map(l => `<div>${l}</div>`).join('')}</div>` : ''}
    <table>
      <thead><tr><th>DATE</th><th>INVOICE #</th><th>DESCRIPTION</th><th class="right">PAYMENTS</th><th class="right">CHARGES</th></tr></thead>
      <tbody>
        ${stmtRows.map(r => `<tr><td>${r.date}</td><td>${r.invNum}</td><td>${r.desc}</td><td class="right">${r.payments ? '$ ' + parseFloat(r.payments).toFixed(2) : ''}</td><td class="right">${r.charges ? '$ ' + parseFloat(r.charges).toFixed(2) : ''}</td></tr>`).join('')}
        <tr style="border-top:2px solid #333;"><td colspan="3" class="bold">Total Payments and New Charges</td><td class="right bold">$ ${totalPay.toFixed(2)}</td><td class="right bold">$ ${totalChg.toFixed(2)}</td></tr>
      </tbody>
    </table>
    <div style="margin-top:32px;padding-top:12px;border-top:1px solid #ddd;font-size:11px;color:#777;">
      ${companyAddress ? `<div>Send payments to ${companyAddress}${companyPhone ? ' or call ' + companyPhone + ' to pay via phone' : ''}.</div>` : ''}
      <div>Payment methods: ACH, Cash, Check, Credit Card, Debit</div>
    </div>
  </body></html>`;
}

async function openSendStatementModal(customerId) {
  const { data: customer } = await window.api.getCustomer(customerId);
  if (!customer) return;

  const emailAddr = customer.email || '';
  const custName = customer.name || 'Customer';

  openModal('Send Statement', `
    <div style="display:flex;gap:24px;">
      <div style="flex:1;">
        <div style="font-size:16px;margin-bottom:12px;">&#9993;</div>
        <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer;">
          <input type="checkbox" id="stmtSendPrimary" checked>
          <span style="font-weight:600;">${esc(custName)}</span> <span style="color:var(--text-light);">(Primary Contact)</span>
        </label>
        <div style="margin-top:8px;">
          <label style="font-size:12px;font-weight:600;">Email Address:</label>
          <input type="email" id="stmtEmailTo" value="${esc(emailAddr)}" style="width:100%;margin-top:4px;" placeholder="customer@email.com">
        </div>
        <div style="margin-top:8px;">
          <label style="font-size:12px;font-weight:600;">CC (optional):</label>
          <input type="email" id="stmtEmailCc" value="" style="width:100%;margin-top:4px;" placeholder="additional@email.com">
        </div>
      </div>
      <div style="flex:1;border-left:1px solid #eee;padding-left:24px;">
        <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer;">
          <input type="checkbox" id="stmtIncludeStatement" checked>
          <span>Include Statement</span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer;">
          <input type="checkbox" id="stmtAttachPdf">
          <span>Attach PDF Copy</span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer;">
          <input type="checkbox" id="stmtAttachInvoices">
          <span>Attach All Invoices</span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer;">
          <input type="checkbox" id="stmtAskReview" checked>
          <span>Ask for a Review</span>
        </label>
      </div>
    </div>
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" style="background:#2e7d32;" onclick="sendStatementEmail('${customerId}')">Confirm & Send</button>
  `);
}

async function sendStatementEmail(customerId) {
  const emailTo = document.getElementById('stmtEmailTo').value.trim();
  const emailCc = document.getElementById('stmtEmailCc').value.trim();
  const includeStmt = document.getElementById('stmtIncludeStatement').checked;
  const attachPdf = document.getElementById('stmtAttachPdf').checked;
  const sendPrimary = document.getElementById('stmtSendPrimary').checked;

  if (!sendPrimary || !emailTo) {
    showToast('Enter an email address.', 'error');
    return;
  }

  showToast('Generating statement...', 'info');

  const stmtHtml = await _buildStatementHtml(customerId);
  let pdfPath = null;

  if (attachPdf) {
    const pdfResult = await window.api.generatePdf(stmtHtml);
    if (pdfResult.success) {
      pdfPath = pdfResult.path;
    } else {
      showToast('PDF generation failed: ' + pdfResult.error, 'error');
      return;
    }
  }

  const { data: customer } = await window.api.getCustomer(customerId);
  const { data: settings } = await window.api.getSettings();
  const companyName = settings?.company_name || 'Interstate Septic Systems';

  const subject = `Account Statement — ${companyName}`;
  const body = includeStmt ? stmtHtml : `<p>Hello ${esc(customer?.name || '')},</p><p>Please find your account statement from ${companyName} attached.</p><p>Thank you for your business!</p>`;

  const recipients = emailCc ? emailTo + ',' + emailCc : emailTo;
  const result = await window.api.sendEmail(recipients, subject, body, pdfPath);

  if (result.success) {
    closeModal();
    showToast('Statement sent to ' + emailTo, 'success');
  } else {
    showToast('Send failed: ' + result.error, 'error');
  }
}

async function exportStatementPdf(customerId) {
  showToast('Generating PDF...', 'info');
  const stmtHtml = await _buildStatementHtml(customerId);
  const { data: customer } = await window.api.getCustomer(customerId);
  const name = (customer?.name || 'Statement').replace(/[^a-zA-Z0-9]/g, '_');
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const filename = `Statement_${name}_${dateStr}.pdf`;

  const saveResult = await window.api.showSaveDialog({ defaultPath: filename, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (!saveResult || saveResult.canceled) return;

  const result = await window.api.generatePdf(stmtHtml, saveResult.filePath);
  if (result.success) {
    showToast('PDF saved!', 'success');
    window.api.openFile(result.path);
  } else {
    showToast('PDF failed: ' + result.error, 'error');
  }
}

// ===== RECEIPT EMAIL =====
async function emailReceipt(customerId, paymentId) {
  const { data: customer } = await window.api.getCustomer(customerId);
  const { data: payments } = await window.api.getPayments(customerId);

  const pay = payments.find(p => p.id === paymentId);
  if (!pay) { showToast('Payment not found.', 'error'); return; }

  const custEmail = customer?.email || '';
  const amt = parseFloat(pay.amount) || 0;
  const methodLabel = (pay.method || 'cash').charAt(0).toUpperCase() + (pay.method || 'cash').slice(1);

  openModal('Email Receipt', `
    <div style="margin-bottom:12px;font-size:13px;color:#555;">
      Receipt for <strong>$${amt.toFixed(2)}</strong> — ${methodLabel} on ${pay.date || 'N/A'}
    </div>
    ${custEmail ? `
    <label style="display:flex;align-items:center;gap:8px;margin-bottom:10px;cursor:pointer;">
      <input type="checkbox" id="rcptSendPrimary" checked>
      <span style="font-weight:600;">${esc(customer?.name || 'Customer')}</span>
      <span style="color:var(--text-light);">${esc(custEmail)}</span>
    </label>` : '<div style="color:#c62828;margin-bottom:10px;">No email on file for this customer.</div>'}
    <div class="form-group" style="margin-top:8px;">
      <label style="font-size:12px;font-weight:600;">Additional / Custom Email:</label>
      <input type="email" id="rcptCustomEmail" style="width:100%;margin-top:4px;" placeholder="other@email.com">
    </div>
    <div class="form-group" style="margin-top:8px;">
      <label style="font-size:12px;font-weight:600;">CC (optional):</label>
      <input type="email" id="rcptCcEmail" style="width:100%;margin-top:4px;" placeholder="cc@email.com">
    </div>
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" style="background:#2e7d32;" onclick="sendReceiptEmail('${customerId}','${paymentId}')">Send Receipt</button>
  `);
}

async function sendReceiptEmail(customerId, paymentId) {
  const { data: customer } = await window.api.getCustomer(customerId);
  const { data: payments } = await window.api.getPayments(customerId);
  const { data: invoices } = await window.api.getInvoices({ customerId });
  const { data: settings } = await window.api.getSettings();
  const { data: properties } = await window.api.getProperties(customerId);

  const pay = payments.find(p => p.id === paymentId);
  if (!pay) { showToast('Payment not found.', 'error'); return; }

  const recipients = [];
  const custEmail = customer?.email || '';
  const sendPrimary = document.getElementById('rcptSendPrimary')?.checked;
  const customEmail = document.getElementById('rcptCustomEmail')?.value?.trim();
  const ccEmail = document.getElementById('rcptCcEmail')?.value?.trim();

  if (sendPrimary && custEmail) recipients.push(custEmail);
  if (customEmail) recipients.push(customEmail);
  if (recipients.length === 0) { showToast('Enter at least one email address.', 'error'); return; }
  if (ccEmail) recipients.push(ccEmail);

  const companyName = settings?.company_name || 'Interstate Septic Systems';
  const companyAddress = settings?.company_address || '';
  const companyPhone = settings?.company_phone || '';
  const linkedInv = invoices.find(i => i.id === pay.invoice_id);
  const firstProp = properties?.[0];
  const amt = parseFloat(pay.amount) || 0;
  const methodLabel = (pay.method || 'cash').charAt(0).toUpperCase() + (pay.method || 'cash').slice(1);

  let techNotes = '';
  if (linkedInv?.job_id) {
    try {
      const { data: job } = await window.api.getJob(linkedInv.job_id);
      if (job?.tech_notes) techNotes = job.tech_notes;
    } catch (e) { /* ignore */ }
  }

  const receiptHtml = `<!DOCTYPE html><html><head><style>
    body{font-family:Georgia,serif;color:#333;margin:0;padding:24px 32px;font-size:13px;}
    .bold{font-weight:700;}
  </style></head><body>
    <div style="display:flex;justify-content:space-between;margin-bottom:20px;">
      <div>
        <div style="font-size:22px;font-weight:700;color:#1a237e;">${companyName}</div>
        ${companyAddress ? `<div>${companyAddress}</div>` : ''}
        ${companyPhone ? `<div>${companyPhone}</div>` : ''}
      </div>
      <div style="text-align:right;">
        <div style="font-size:20px;font-weight:700;color:#2e7d32;">PAYMENT RECEIPT</div>
        <div style="margin-top:4px;">Date: ${pay.date || 'N/A'}</div>
      </div>
    </div>
    <div style="margin-bottom:20px;">
      <div class="bold">RECEIVED FROM</div>
      <div>${customer?.name || 'Customer'}</div>
      ${customer?.address ? `<div>${customer.address}</div>` : ''}
      ${customer?.city ? `<div>${customer.city}${customer.state ? ', ' + customer.state : ''} ${customer.zip || ''}</div>` : ''}
      ${firstProp ? `<div style="margin-top:6px;color:#555;">Property: ${firstProp.address || ''}${firstProp.city ? ', ' + firstProp.city : ''}</div>` : ''}
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <tr style="border-bottom:2px solid #1a237e;">
        <th style="padding:8px;text-align:left;">Description</th>
        <th style="padding:8px;text-align:right;">Amount</th>
      </tr>
      <tr style="border-bottom:1px solid #eee;">
        <td style="padding:10px 8px;">
          Payment — ${methodLabel}${pay.check_number ? ' #' + pay.check_number : ''}
          ${linkedInv ? '<br>Applied to Invoice #' + (linkedInv.invoice_number || '') + ' (' + (linkedInv.svc_date || '') + ')' : ''}
          ${linkedInv?.job_codes ? '<br>Service: ' + linkedInv.job_codes : ''}
          ${techNotes ? '<br><em style="color:#555;">Tech Notes: ' + techNotes + '</em>' : ''}
        </td>
        <td style="padding:10px 8px;text-align:right;font-size:18px;font-weight:700;color:#2e7d32;">$${amt.toFixed(2)}</td>
      </tr>
    </table>
    ${pay.notes ? `<div style="margin-bottom:16px;font-style:italic;color:#666;">Note: ${pay.notes}</div>` : ''}
    <div style="text-align:center;font-weight:700;font-size:16px;color:#2e7d32;padding:12px;border:2px solid #2e7d32;border-radius:6px;">PAID — Thank You!</div>
    <div style="margin-top:24px;padding-top:12px;border-top:1px solid #ddd;font-size:11px;color:#777;">
      ${companyAddress ? `<div>${companyAddress}${companyPhone ? ' | ' + companyPhone : ''}</div>` : ''}
    </div>
  </body></html>`;

  const subject = `Payment Receipt — ${companyName}`;
  const allRecipients = recipients.join(',');
  const result = await window.api.sendEmail(allRecipients, subject, receiptHtml);
  if (result.success) {
    closeModal();
    showToast('Receipt sent to ' + allRecipients, 'success');
  } else {
    showToast('Failed to send: ' + result.error, 'error');
  }
}

// ===== PROPERTIES =====
function openPropertyModal(property = null) {
  const isEdit = !!property;
  const p = property || {};
  openModal(isEdit ? 'Edit Property' : 'New Property', `
    <input type="hidden" id="propertyId" value="${p.id || ''}">
    <div class="form-group">
      <label>Street Address *</label>
      <input type="text" id="propertyAddress" value="${esc(p.address || '')}" placeholder="573 Peterboro Rd">
    </div>
    <div class="form-row-3">
      <div class="form-group">
        <label>City</label>
        <input type="text" id="propertyCity" value="${esc(p.city || '')}">
      </div>
      <div class="form-group">
        <label>State</label>
        <input type="text" id="propertyState" value="${esc(p.state || 'ME')}" maxlength="2">
      </div>
      <div class="form-group">
        <label>Zip</label>
        <input type="text" id="propertyZip" value="${esc(p.zip || '')}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>County</label>
        <input type="text" id="propertyCounty" value="${esc(p.county || '')}">
      </div>
      <div class="form-group">
        <label>Property Type</label>
        <select id="propertyType">
          <option value="">-- Select --</option>
          <option value="Residential" ${p.property_type === 'Residential' ? 'selected' : ''}>Residential</option>
          <option value="Commercial" ${p.property_type === 'Commercial' ? 'selected' : ''}>Commercial</option>
          <option value="Multi-Family" ${p.property_type === 'Multi-Family' ? 'selected' : ''}>Multi-Family</option>
          <option value="Vacant Land" ${p.property_type === 'Vacant Land' ? 'selected' : ''}>Vacant Land</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>Directions</label>
      <textarea id="propertyDirections" placeholder="Directions to property...">${esc(p.directions || '')}</textarea>
    </div>
    <div class="form-group">
      <label>Property Notes</label>
      <textarea id="propertyNotes" placeholder="Notes about this property...">${esc(p.notes || '')}</textarea>
    </div>
  `, `
    ${isEdit ? '<button class="btn btn-danger" onclick="deleteProperty()">Delete</button>' : ''}
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveProperty()">Save</button>
  `);
}

async function saveProperty() {
  const data = {
    customer_id: currentCustomerId,
    address: document.getElementById('propertyAddress').value.trim(),
    city: document.getElementById('propertyCity').value.trim(),
    state: document.getElementById('propertyState').value.trim(),
    zip: document.getElementById('propertyZip').value.trim(),
    county: document.getElementById('propertyCounty').value.trim(),
    property_type: document.getElementById('propertyType').value,
    directions: document.getElementById('propertyDirections').value.trim(),
    notes: document.getElementById('propertyNotes').value.trim(),
  };

  const id = document.getElementById('propertyId').value;
  if (id) data.id = id;

  if (!data.address) {
    showToast('Address is required.', 'error');
    return;
  }

  const result = await window.api.saveProperty(data);
  if (result.success) {
    closeModal();
    showToast(id ? 'Property updated.' : 'Property added.', 'success');
    openCustomerDetail(currentCustomerId, id || result.data?.id || currentPropertyId);
  }
}

async function deleteProperty() {
  const id = document.getElementById('propertyId').value;
  if (!id || !confirm('Delete this property and all its tanks? This cannot be undone.')) return;
  await window.api.deleteProperty(id);
  closeModal();
  showToast('Property deleted.', 'success');
  openCustomerDetail(currentCustomerId);
}

// ===== PROPERTY DETAIL (redirects to unified customer page) =====
async function openPropertyDetail(id) {
  const { data: property } = await window.api.getProperty(id);
  if (!property) return;
  openCustomerDetail(property.customer_id, id);
}

// ===== SERVICE CONTRACTS =====
function openServiceContractModal(contract = null, customerId = null, propertyId = null) {
  const isEdit = !!contract;
  const c = contract || {};
  const cId = customerId || currentCustomerId;
  const pId = propertyId || currentPropertyId;
  openModal(isEdit ? 'Edit Service Contract' : 'New Service Contract', `
    <input type="hidden" id="scId" value="${c.id || ''}">
    <div class="form-row">
      <div class="form-group">
        <label>Contract Type *</label>
        <select id="scType">
          <option value="">-- Select --</option>
          <option value="Pumping" ${c.contract_type === 'Pumping' ? 'selected' : ''}>Pumping</option>
          <option value="Inspection" ${c.contract_type === 'Inspection' ? 'selected' : ''}>Inspection</option>
          <option value="Maintenance" ${c.contract_type === 'Maintenance' ? 'selected' : ''}>Maintenance</option>
          <option value="Filter Cleaning" ${c.contract_type === 'Filter Cleaning' ? 'selected' : ''}>Filter Cleaning</option>
          <option value="Full Service" ${c.contract_type === 'Full Service' ? 'selected' : ''}>Full Service</option>
          <option value="Other" ${c.contract_type === 'Other' ? 'selected' : ''}>Other</option>
        </select>
      </div>
      <div class="form-group">
        <label>Frequency</label>
        <select id="scFrequency">
          <option value="">-- Select --</option>
          <option value="Monthly" ${c.frequency === 'Monthly' ? 'selected' : ''}>Monthly</option>
          <option value="Quarterly" ${c.frequency === 'Quarterly' ? 'selected' : ''}>Quarterly</option>
          <option value="Semi-Annual" ${c.frequency === 'Semi-Annual' ? 'selected' : ''}>Semi-Annual</option>
          <option value="Annual" ${c.frequency === 'Annual' ? 'selected' : ''}>Annual</option>
          <option value="Bi-Annual" ${c.frequency === 'Bi-Annual' ? 'selected' : ''}>Bi-Annual</option>
          <option value="As Needed" ${c.frequency === 'As Needed' ? 'selected' : ''}>As Needed</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>Description</label>
      <input type="text" id="scDescription" value="${esc(c.description || '')}" placeholder="Contract description...">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Start Date</label>
        <input type="date" id="scStartDate" value="${c.start_date || ''}">
      </div>
      <div class="form-group">
        <label>End Date</label>
        <input type="date" id="scEndDate" value="${c.end_date || ''}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Price ($)</label>
        <input type="number" id="scPrice" value="${c.price || ''}" min="0" step="0.01" placeholder="0.00">
      </div>
      <div class="form-group">
        <label>Status</label>
        <select id="scStatus">
          <option value="active" ${(!c.status || c.status === 'active') ? 'selected' : ''}>Active</option>
          <option value="expired" ${c.status === 'expired' ? 'selected' : ''}>Expired</option>
          <option value="cancelled" ${c.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label><input type="checkbox" id="scAutoRenew" ${c.auto_renew ? 'checked' : ''}> Auto-Renew</label>
    </div>
    <div class="form-group">
      <label>Notes</label>
      <textarea id="scNotes" placeholder="Contract notes...">${esc(c.notes || '')}</textarea>
    </div>
  `, `
    ${isEdit ? `<button class="btn btn-danger" onclick="deleteServiceContract('${c.id}','${cId}','${pId}')">Delete</button>` : ''}
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveServiceContract('${cId}','${pId}')">Save</button>
  `);
}

async function saveServiceContract(customerId, propertyId) {
  const data = {
    customer_id: customerId,
    property_id: propertyId,
    contract_type: document.getElementById('scType').value,
    frequency: document.getElementById('scFrequency').value,
    description: document.getElementById('scDescription').value.trim(),
    start_date: document.getElementById('scStartDate').value || null,
    end_date: document.getElementById('scEndDate').value || null,
    price: parseFloat(document.getElementById('scPrice').value) || null,
    status: document.getElementById('scStatus').value,
    auto_renew: document.getElementById('scAutoRenew').checked,
    notes: document.getElementById('scNotes').value.trim(),
  };
  const id = document.getElementById('scId').value;
  if (id) data.id = id;
  if (!data.contract_type) { showToast('Contract type is required.', 'error'); return; }
  const result = await window.api.saveServiceContract(data);
  if (result.success) {
    closeModal();
    showToast(id ? 'Contract updated.' : 'Contract created.', 'success');
    openCustomerDetail(customerId, propertyId);
  }
}

async function deleteServiceContract(id, customerId, propertyId) {
  if (!id || !confirm('Delete this service contract?')) return;
  await window.api.deleteServiceContract(id);
  closeModal();
  showToast('Contract deleted.', 'success');
  openCustomerDetail(customerId, propertyId);
}

// ===== SERVICE DUE NOTICES =====
async function openServiceDueNoticeModal(notice = null, customerId = null, propertyId = null) {
  const isEdit = !!notice;
  const n = notice || {};
  const cId = customerId || currentCustomerId;
  const pId = propertyId || currentPropertyId;
  const jobLink = n.job_id && n.job ? `<div style="font-size:11px;color:var(--text-light);margin-bottom:8px;padding:4px 8px;background:#f5f5f5;border-radius:3px;">Linked to Job: <a href="#" onclick="event.preventDefault();closeModal();openJobDetail('${n.job_id}')" style="color:var(--primary);font-weight:600;">${n.job?.manifest_number ? '#' + n.job.manifest_number : 'View Job'}</a></div>` : '';
  const emailChecked = n.email_enabled !== false;

  // Fetch tanks for this property
  let tanks = [];
  if (pId) {
    const { data: propTanks } = await window.api.getTanks(pId);
    tanks = propTanks || [];
  }

  const tankDropdown = tanks.length > 0 ? `
    <div class="form-group">
      <label>Tank</label>
      <select id="sdnModalTank">
        <option value="">All Tanks</option>
        ${tanks.map(t => `<option value="${t.id}" ${n.tank_id === t.id ? 'selected' : ''}>${esc(t.tank_name || t.tank_type || 'Tank')} – ${(t.volume_gallons || 0).toLocaleString()} gal</option>`).join('')}
      </select>
    </div>` : '';

  openModal(isEdit ? 'Edit Service Due Notice' : 'New Service Due Notice', `
    <input type="hidden" id="sdnModalId" value="${n.id || ''}">
    <input type="hidden" id="sdnModalJobId" value="${n.job_id || ''}">
    ${jobLink}
    <div class="form-row">
      <div class="form-group">
        <label>Service Type *</label>
        <select id="sdnModalServiceType">
          <option value="">-- Select --</option>
          <option value="Pumping" ${n.service_type === 'Pumping' ? 'selected' : ''}>Pumping</option>
          <option value="Inspection" ${n.service_type === 'Inspection' ? 'selected' : ''}>Inspection</option>
          <option value="Filter Cleaning" ${n.service_type === 'Filter Cleaning' ? 'selected' : ''}>Filter Cleaning</option>
          <option value="Maintenance" ${n.service_type === 'Maintenance' ? 'selected' : ''}>Maintenance</option>
          <option value="Other" ${n.service_type === 'Other' ? 'selected' : ''}>Other</option>
        </select>
      </div>
      ${tankDropdown}
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Service Due In *</label>
        <select id="sdnModalInterval">
          ${[1,2,3,4,5,6,7].map(y => `<option value="${y}" ${(n.interval_value || 3) === y ? 'selected' : ''}>${y} Year${y > 1 ? 's' : ''}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Email Notification</label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:4px;">
          <input type="checkbox" id="sdnModalEmail" ${emailChecked ? 'checked' : ''} style="width:18px;height:18px;">
          <span style="font-weight:600;color:${emailChecked ? '#388e3c' : '#999'};">${emailChecked ? 'ON' : 'OFF'}</span>
        </label>
      </div>
    </div>
    <div class="form-group">
      <label>Notes</label>
      <textarea id="sdnModalNotes" placeholder="Notice notes...">${esc(n.notes || '')}</textarea>
    </div>
  `, `
    ${isEdit ? `<button class="btn btn-danger" onclick="deleteServiceDueNotice('${n.id}','${cId}','${pId}')">Delete</button>` : ''}
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveServiceDueNoticeModal('${cId}','${pId}')">Save</button>
  `);
}

async function saveServiceDueNoticeModal(customerId, propertyId) {
  const intervalYears = parseInt(document.getElementById('sdnModalInterval').value) || 3;
  const dueDate = calcNextServiceDate(new Date().toISOString().split('T')[0], intervalYears, 'years');
  const data = {
    customer_id: customerId,
    property_id: propertyId,
    service_type: document.getElementById('sdnModalServiceType').value,
    due_date: dueDate,
    method: 'email',
    status: document.getElementById('sdnModalStatus')?.value || 'pending',
    email_enabled: document.getElementById('sdnModalEmail')?.checked !== false,
    interval_value: intervalYears,
    interval_unit: 'years',
    tank_id: document.getElementById('sdnModalTank')?.value || null,
    notes: document.getElementById('sdnModalNotes').value.trim(),
  };
  const id = document.getElementById('sdnModalId').value;
  const jobId = document.getElementById('sdnModalJobId').value;
  if (id) data.id = id;
  if (jobId) data.job_id = jobId;
  if (!data.service_type) { showToast('Service type is required.', 'error'); return; }
  const result = await window.api.saveServiceDueNotice(data);
  if (result.success) {
    closeModal();
    showToast(id ? 'Notice updated.' : 'Notice created.', 'success');
    // Refresh current page context
    if (currentPage === 'sdn') {
      loadServiceDueNotices();
    } else if (customerId) {
      openCustomerDetail(customerId, propertyId);
    }
  }
}

async function deleteServiceDueNotice(id, customerId, propertyId) {
  if (!id || !confirm('Delete this service due notice?')) return;
  await window.api.deleteServiceDueNotice(id);
  closeModal();
  showToast('Notice deleted.', 'success');
  if (currentPage === 'sdn') {
    loadServiceDueNotices();
  } else if (customerId) {
    openCustomerDetail(customerId, propertyId);
  }
}

async function quickCreateSdn(customerId, propertyId, serviceType, interval, unit, fromJobId) {
  // Find most recent job for this customer to base due date off of
  const { data: jobs } = await window.api.getJobs({ customerId });
  const recentJob = jobs.sort((a, b) => (b.svc_date || '').localeCompare(a.svc_date || ''))[0];
  const baseDate = recentJob?.svc_date || new Date().toISOString().split('T')[0];
  const dueDate = calcNextServiceDate(baseDate, interval, unit);

  const data = {
    customer_id: customerId,
    property_id: propertyId,
    job_id: fromJobId || recentJob?.id || null,
    service_type: serviceType,
    due_date: dueDate,
    method: 'email',
    status: 'pending',
    email_enabled: true,
    interval_value: interval,
    interval_unit: unit,
  };

  const result = await window.api.saveServiceDueNotice(data);
  if (result.success) {
    showToast(`${serviceType} / ${interval} ${unit} SDN created — due ${dueDate}`, 'success');
    // Stay on job detail if called from a job, otherwise go to customer
    if (fromJobId) {
      openJobDetail(fromJobId);
    } else {
      openCustomerDetail(customerId, propertyId);
    }
  } else {
    showToast('Failed to create notice.', 'error');
  }
}

// ===== TANKS =====
async function openTankModal(tank = null) {
  const isEdit = !!tank;
  const t = tank || {};
  const { data: tankTypes } = await window.api.getTankTypes();
  const typeOptions = (tankTypes || []).map(tt =>
    `<option value="${esc(tt.name)}" ${t.tank_type === tt.name ? 'selected' : ''}>${esc(tt.name)}</option>`
  ).join('');
  openModal(isEdit ? 'Edit Tank' : 'New Tank', `
    <input type="hidden" id="tankId" value="${t.id || ''}">
    <div class="form-row">
      <div class="form-group">
        <label>Tank Name</label>
        <input type="text" id="tankName" value="${esc(t.tank_name || '')}" placeholder="e.g. Main Tank, Tank #1">
      </div>
      <div class="form-group">
        <label>Tank Type *</label>
        <select id="tankType">
          ${typeOptions}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Volume (gallons) *</label>
        <input type="number" id="tankVolume" value="${t.volume_gallons || ''}" min="0" placeholder="1000">
      </div>
      <div class="form-group">
        <label>Pump Frequency</label>
        <select id="tankPumpFrequency">
          <option value="">-- Select --</option>
          <option value="1 year" ${t.pump_frequency === '1 year' ? 'selected' : ''}>1 Year</option>
          <option value="2 years" ${t.pump_frequency === '2 years' ? 'selected' : ''}>2 Years</option>
          <option value="3 years" ${t.pump_frequency === '3 years' ? 'selected' : ''}>3 Years</option>
          <option value="4 years" ${t.pump_frequency === '4 years' ? 'selected' : ''}>4 Years</option>
          <option value="5 years" ${t.pump_frequency === '5 years' ? 'selected' : ''}>5 Years</option>
          <option value="As needed" ${t.pump_frequency === 'As needed' ? 'selected' : ''}>As Needed</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Last Pump Date</label>
        <input type="date" id="tankLastPump" value="${t.last_pump_date || ''}">
      </div>
      <div class="form-group">
        <label>Depth (inches)</label>
        <input type="number" id="tankDepth" value="${t.depth_inches || ''}" min="0" placeholder="Depth in inches">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Hose Length (ft)</label>
        <input type="number" id="tankHoseLength" value="${t.hose_length_ft || ''}" min="0" placeholder="Hose length in feet">
      </div>
    </div>
    <div class="form-row-3">
      <div class="form-group">
        <label>Filter</label>
        <select id="tankFilter">
          <option value="unknown" ${(!t.filter || t.filter === 'unknown') ? 'selected' : ''}>Unknown</option>
          <option value="yes" ${t.filter === 'yes' || t.filter === true ? 'selected' : ''}>Yes</option>
          <option value="no" ${t.filter === 'no' || t.filter === false ? 'selected' : ''}>No</option>
        </select>
      </div>
      <div class="form-group">
        <label>Reachable from Driveway</label>
        <select id="tankDriveway">
          <option value="unknown" ${(!t.reachable_from_driveway || t.reachable_from_driveway === 'unknown') ? 'selected' : ''}>Unknown</option>
          <option value="yes" ${t.reachable_from_driveway === 'yes' || t.reachable_from_driveway === true ? 'selected' : ''}>Yes</option>
          <option value="no" ${t.reachable_from_driveway === 'no' || t.reachable_from_driveway === false ? 'selected' : ''}>No</option>
        </select>
      </div>
      <div class="form-group">
        <label>Riser</label>
        <select id="tankRiser">
          <option value="unknown" ${(!t.riser || t.riser === 'unknown') ? 'selected' : ''}>Unknown</option>
          <option value="yes" ${t.riser === 'yes' ? 'selected' : ''}>Yes</option>
          <option value="no" ${t.riser === 'no' ? 'selected' : ''}>No</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>Notes</label>
      <textarea id="tankNotes" placeholder="Tank notes, location details...">${esc(t.notes || '')}</textarea>
    </div>
  `, `
    ${isEdit ? '<button class="btn btn-danger" onclick="deleteTank()">Delete</button>' : ''}
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveTank()">Save</button>
  `);
}

async function saveTank() {
  const data = {
    property_id: currentPropertyId,
    tank_name: document.getElementById('tankName').value.trim(),
    volume_gallons: parseInt(document.getElementById('tankVolume').value) || 0,
    tank_type: document.getElementById('tankType').value,
    pump_frequency: document.getElementById('tankPumpFrequency').value,
    last_pump_date: document.getElementById('tankLastPump').value || null,
    depth_inches: parseInt(document.getElementById('tankDepth').value) || null,
    hose_length_ft: parseInt(document.getElementById('tankHoseLength').value) || null,
    filter: document.getElementById('tankFilter').value,
    reachable_from_driveway: document.getElementById('tankDriveway').value,
    riser: document.getElementById('tankRiser').value,
    notes: document.getElementById('tankNotes').value.trim(),
  };

  const id = document.getElementById('tankId').value;
  if (id) data.id = id;

  const result = await window.api.saveTank(data);
  if (result.success) {
    closeModal();
    showToast(id ? 'Tank updated.' : 'Tank added.', 'success');
    openCustomerDetail(currentCustomerId, currentPropertyId);
  }
}

async function deleteTank() {
  const id = document.getElementById('tankId').value;
  if (!id || !confirm('Delete this tank?')) return;
  await window.api.deleteTank(id);
  closeModal();
  showToast('Tank deleted.', 'success');
  openCustomerDetail(currentCustomerId, currentPropertyId);
}

// ===== SCHEDULE =====
let scheduleDate = new Date();
let scheduleView = 'day'; // day, week, month

async function loadSchedule() {
  navHistory = []; // reset nav stack on top-level page
  const page = document.getElementById('page-schedule');
  const { data: vehicles } = await window.api.getVehicles();
  const { data: users } = await window.api.getUsers();

  if (vehicles.length === 0) {
    page.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">&#128666;</div>
        <p>Add your vehicles first before scheduling jobs.</p>
        <button class="btn btn-primary" onclick="navigateTo('vehicles')">Go to Vehicles</button>
      </div>`;
    return;
  }

  const dateStr = formatDate(scheduleDate);
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const dayName = dayNames[scheduleDate.getDay()];
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  // Build schedule header with view toggle
  let headerDateText = '';
  if (scheduleView === 'day') {
    headerDateText = `${dayName}, ${monthNames[scheduleDate.getMonth()]} ${scheduleDate.getDate()}, ${scheduleDate.getFullYear()}`;
  } else if (scheduleView === 'week') {
    const mon = getMonday(scheduleDate);
    const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
    headerDateText = `${monthNames[mon.getMonth()]} ${mon.getDate()} - ${monthNames[sun.getMonth()]} ${sun.getDate()}, ${sun.getFullYear()}`;
  } else {
    headerDateText = `${monthNames[scheduleDate.getMonth()]} ${scheduleDate.getFullYear()}`;
  }

  let scheduleBody = '';
  if (scheduleView === 'day') {
    scheduleBody = await buildDayView(vehicles, users, dateStr);
  } else if (scheduleView === 'week') {
    scheduleBody = await buildWeekView(vehicles, users);
  } else {
    scheduleBody = await buildMonthView(vehicles, users);
  }

  page.innerHTML = `
    <div class="schedule-toolbar">
      <div class="schedule-toolbar-left">
        <button class="btn btn-primary" onclick="openJobModal()">+ New Appointment</button>
        <div class="schedule-nav">
          <button class="btn btn-secondary btn-sm" onclick="changeScheduleDate(-1)">&#9664;</button>
          <span class="schedule-date-display">${headerDateText}</span>
          <button class="btn btn-secondary btn-sm" onclick="changeScheduleDate(1)">&#9654;</button>
        </div>
      </div>
      <div class="schedule-toolbar-right">
        <button class="btn btn-sm ${scheduleView === 'month' ? 'btn-primary' : 'btn-secondary'}" onclick="setScheduleView('month')">MONTH</button>
        <button class="btn btn-sm ${scheduleView === 'week' ? 'btn-primary' : 'btn-secondary'}" onclick="setScheduleView('week')">WEEK</button>
        <button class="btn btn-sm ${scheduleView === 'day' ? 'btn-primary' : 'btn-secondary'}" onclick="setScheduleView('day')">DAY</button>
        <button class="btn btn-secondary btn-sm" onclick="scheduleDate = new Date(); loadSchedule();">Today</button>
        <button class="btn btn-sm" style="background:#1565c0;color:#fff;" onclick="toggleScheduleMap()">&#128506; Map</button>
        <button class="btn btn-sm" style="background:linear-gradient(135deg,#7c4dff,#448aff);color:#fff;font-weight:700;" onclick="aiOptimizeDay()" title="AI-optimize routes, truck assignments, and dump points for the day">&#9889; AI Optimize</button>
        <button class="btn btn-sm" style="background:#e65100;color:#fff;" onclick="seedTestData()">+ Demo</button>
        <button class="btn btn-sm" style="background:#b71c1c;color:#fff;" onclick="unseedTestData()">- Demo</button>
      </div>
    </div>
    ${scheduleBody}
  `;

  // Resolve dump recommendations asynchronously (OSRM driving distances)
  // Only run once per load — skip if we just auto-moved jobs
  if (scheduleView === 'day' && (window._dumpRecQueue || []).length > 0 && !window._dumpRecRunning) {
    window._dumpRecRunning = true;
    resolveDumpRecommendations().finally(() => { window._dumpRecRunning = false; });
  }

  // Ctrl+scroll zoom on schedule
  const scheduleMain = page.querySelector('.schedule-day-main');
  if (scheduleMain) {
    const grid = scheduleMain.querySelector('.day-schedule-grid');
    if (grid) {
      let scheduleZoom = parseFloat(localStorage.getItem('scheduleZoom') || '1');
      grid.style.transform = 'scale(' + scheduleZoom + ')';
      grid.style.transformOrigin = 'top left';
      grid.style.width = (100 / scheduleZoom) + '%';
      scheduleMain.addEventListener('wheel', function(e) {
        if (!e.ctrlKey) return;
        e.preventDefault();
        scheduleZoom += e.deltaY > 0 ? -0.05 : 0.05;
        scheduleZoom = Math.max(0.4, Math.min(1.5, scheduleZoom));
        grid.style.transform = 'scale(' + scheduleZoom + ')';
        grid.style.width = (100 / scheduleZoom) + '%';
        localStorage.setItem('scheduleZoom', scheduleZoom.toString());
      }, { passive: false });
    }

    // Restore scroll position if saved
    if (_restoreScrollOnLoad) {
      _restoreScrollOnLoad = false;
      scheduleMain.scrollTop = _savedScrollTop;
      scheduleMain.scrollLeft = _savedScrollLeft;
    }
  }

  // Always refresh revenue from fresh DB data after schedule renders
  if (scheduleView === 'day') refreshRevenue();
}

async function buildDayView(vehicles, users, dateStr) {
  const { data: jobs } = await window.api.getJobs({ date: dateStr });
  const { data: wasteSites } = await window.api.getWasteSites();
  const { data: allScheduleItems } = await window.api.getScheduleItems(null, dateStr);
  const defaultSite = wasteSites.find(s => s.is_default);

  // Geocode lookup for smart dump recommendations
  const geocodeEntries = (await window.api.getGeocodeCache())?.data || [];
  const geoLookup = {};
  geocodeEntries.forEach(g => { geoLookup[g.address] = { lat: g.lat, lng: g.lng }; });
  // Reset dump recommendation queue for async OSRM resolution
  window._dumpRecQueue = [];
  window._dumpGeoLookup = geoLookup;

  // Get company settings for manifest card label
  const { data: settings } = await window.api.getSettings();
  const companyName = settings?.company_name || 'Interstate Septic Systems';
  const companyAddress = settings?.company_address || '';

  // Helper to get confirmation banner
  function confBanner(status) {
    const map = {
      confirmed: { bg: '#2e7d32', text: 'CONFIRMED' },
      auto_confirmed: { bg: '#5d4037', text: 'AUTO-CONFIRMED' },
      no_reply: { bg: '#f9a825', text: 'NO REPLY' },
      left_message: { bg: '#e65100', text: 'LEFT MESSAGE' },
      unconfirmed: { bg: '#9e9e9e', text: 'UNCONFIRMED' },
    };
    const c = map[status] || map.unconfirmed;
    return `<div class="confirmation-banner" style="background:${c.bg};">${c.text}</div>`;
  }

  return `
    <div class="schedule-day-wrapper">
      <!-- LEFT Side Panel -->
      <div class="schedule-side-panel">
        <div class="side-panel-section">
          <h4>&#128203; Manifest</h4>
          <div class="draggable-chip manifest-chip" style="cursor:grab;"
            onmousedown="onChipMouseDown(event, 'manifest', '')">
            <span class="chip-icon">&#128203;</span> ${esc(companyName)}
          </div>
          <div style="font-size:10px;color:var(--text-light);margin-top:2px;">Drag between jobs</div>
        </div>

        <div class="side-panel-section">
          <h4>Waste Site</h4>
          <select class="side-panel-select" id="sidePanelWasteSite">
            <option value="">Select site...</option>
            ${wasteSites.map(s => `
              <option value="${s.id}" ${s.is_default ? 'selected' : ''}>${esc(s.name)}</option>
            `).join('')}
          </select>
        </div>

        <div class="side-panel-section">
          <h4>&#128100; Drivers</h4>
          ${users.map(u => {
            return '<div class="draggable-chip" style="cursor:grab;border-left: 3px solid ' + (u.color || '#1565c0') + ';"'
              + ' onmousedown="onChipMouseDown(event, \'driver_change\', \'' + u.id + '\')">'
              + '<span class="chip-icon" style="color:' + (u.color || '#1565c0') + ';">&#128100;</span> ' + esc(u.name)
              + '</div>'
              + '<div class="driver-revenue-bar" style="margin:-4px 0 6px 0;">'
              + '<div style="height:5px;background:#e0e0e0;border-radius:3px;overflow:hidden;">'
              + '<div id="rev-bar-' + u.id + '" style="height:100%;width:0%;background:' + (u.color || '#1565c0') + ';border-radius:3px;transition:width 0.3s;"></div>'
              + '</div>'
              + '<div id="rev-amt-' + u.id + '" style="font-size:10px;color:var(--text-light);margin-top:1px;">$0.00</div>'
              + '</div>';
          }).join('')}
          <div style="margin-top:8px;padding:8px;background:#e8f5e9;border-radius:6px;text-align:center;">
            <div style="font-size:10px;color:var(--text-light);text-transform:uppercase;letter-spacing:0.5px;">Day Total Revenue</div>
            <div id="rev-day-total" style="font-size:18px;font-weight:800;color:#2e7d32;">$0.00</div>
          </div>
          <button class="btn btn-sm" onclick="refreshRevenue();" style="margin-top:8px;width:100%;background:#1565c0;color:#fff;font-weight:600;font-size:11px;padding:6px;">&#x21bb; Refresh Revenue</button>
          <div style="font-size:10px;color:var(--text-light);margin-top:6px;">Drag between jobs to change driver mid-route</div>
        </div>
      </div>

      <!-- MAIN schedule grid -->
      <div class="schedule-day-main">
        <div class="day-schedule-grid" style="grid-template-columns: repeat(${vehicles.length}, minmax(240px, 1fr)); min-width: ${vehicles.length * 240}px;">
          ${vehicles.map(v => {
            const tech = users.find(u => u.id === v.default_tech_id);
            const vehicleJobs = jobs.filter(j => j.vehicle_id === v.id).sort((a,b) => (a.scheduled_time || '').localeCompare(b.scheduled_time || ''));
            const vehicleItems = allScheduleItems.filter(i => i.vehicle_id === v.id);

            // Disposed gallons = from completed manifests for this truck today
            let disposedGallons = 0;
            vehicleItems.filter(i => i.item_type === 'manifest' && i.status === 'completed').forEach(m => {
              disposedGallons += m.total_gallons || 0;
            });

            // Planned gallons = all jobs on this truck (complete or not)
            let plannedGallons = 0;
            vehicleJobs.forEach(j => {
              const jobTanks = j.property?.tanks || [];
              const pumped = j.gallons_pumped || {};
              const jobGal = Object.keys(pumped).length > 0
                ? Object.values(pumped).reduce((s, g) => s + (parseInt(g) || 0), 0)
                : jobTanks.reduce((s, t) => s + (t.volume_gallons || 0), 0);
              plannedGallons += jobGal;
            });

            const pct = plannedGallons > 0 ? Math.min((disposedGallons / plannedGallons) * 100, 100) : 0;
            const barColor = pct >= 100 ? 'green' : pct >= 50 ? 'yellow' : 'red';
            const capacity = v.capacity_gallons || 0;

            // Interleave jobs and schedule items by sort_order
            // Jobs get sort_order from their index * 10, schedule items have their own
            const combined = [];
            vehicleJobs.forEach((j, idx) => {
              combined.push({ type: 'job', data: j, sort: j.sort_order != null ? j.sort_order : idx * 10 });
            });
            vehicleItems.forEach(si => {
              combined.push({ type: si.item_type, data: si, sort: si.sort_order != null ? si.sort_order : 999 });
            });
            combined.sort((a, b) => a.sort - b.sort);

            // Running gallon total — only used by manifest cards to know how many gallons are above them
            let runningGallons = 0;
            // Separate running total for capacity alerts (counts all jobs, not just completed)
            let runningForCapacity = 0;

            // Build a light tinted background from the truck color
            const tc = v.color || '#1565c0';
            // Convert hex to rgba with low opacity for column tint
            const hexToRgba = (hex, alpha) => {
              const r = parseInt(hex.slice(1,3), 16), g = parseInt(hex.slice(3,5), 16), b = parseInt(hex.slice(5,7), 16);
              return `rgba(${r},${g},${b},${alpha})`;
            };
            const colBg = hexToRgba(tc, 0.08);
            const colHeaderBg = hexToRgba(tc, 0.15);

            return `
              <div class="truck-column" data-vehicle-id="${v.id}" style="background:${colBg};">
                <div class="truck-column-header" style="border-top: 3px solid ${tc}; background:${colHeaderBg};">
                  <div class="truck-name">${esc(v.name)}</div>
                  <div class="truck-capacity">${capacity ? capacity.toLocaleString() + ' Gallons' : ''}</div>
                  <select class="truck-driver-select" style="background:${tech?.color || '#888'};"
                    onchange="changeTruckDriver('${v.id}', '${dateStr}', this.value); this.style.background = this.selectedOptions[0]?.dataset?.color || '#888';"
                    >
                    <option value="" data-color="#888" ${!v.default_tech_id ? 'selected' : ''}>Unassigned</option>
                    ${users.map(u => `<option value="${u.id}" data-color="${u.color || '#1565c0'}" ${u.id === v.default_tech_id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}
                  </select>
                  ${plannedGallons > 0 ? `
                    <div class="capacity-bar-container">
                      <div class="capacity-bar">
                        <div class="capacity-bar-fill ${barColor}" style="width: ${pct}%;"></div>
                      </div>
                      <div class="capacity-text">${disposedGallons.toLocaleString()} disposed / ${plannedGallons.toLocaleString()} planned &nbsp;|&nbsp; ${vehicleJobs.filter(j => j.status === 'completed').length}/${vehicleJobs.length} jobs</div>
                    </div>
                  ` : ''}
                </div>
                <div class="truck-jobs"
                  data-vehicle-id="${v.id}" data-date="${dateStr}">
                  ${combined.length === 0 ? `
                    <div class="truck-job-empty">No appointments</div>
                  ` : combined.map((item, _cIdx) => {
                    if (item.type === 'job') {
                      const j = item.data;
                      const jobTanks = j.property?.tanks || [];
                      const totalGal = jobTanks.reduce((sum, t) => sum + (t.volume_gallons || 0), 0);
                      const pumped = j.gallons_pumped || {};
                      const actualGal = Object.keys(pumped).length > 0
                        ? Object.values(pumped).reduce((s, g) => s + (parseInt(g) || 0), 0)
                        : totalGal;

                      // Check if this job would overflow — show alert BEFORE the job
                      let preAlert = '';
                      if (capacity > 0 && runningForCapacity > 0 && runningForCapacity + actualGal > capacity) {
                        const remainingGal = capacity - runningForCapacity;
                        // Find candidate jobs AFTER this point that would fit in remaining capacity
                        const candidates = combined.slice(_cIdx + 1)
                          .filter(c => c.type === 'job' && c.data.status !== 'completed')
                          .map(c => {
                            const cTanks = c.data.property?.tanks || [];
                            const cGal = cTanks.reduce((s, t) => s + (t.volume_gallons || 0), 0);
                            return { job: c.data, gal: cGal, sort: c.sort };
                          })
                          .filter(c => c.gal > 0 && c.gal <= remainingGal);

                        const dumpRecId = `dump-rec-${v.id}-${_cIdx}`;
                        // Queue best candidate for auto-move via async OSRM
                        if (candidates.length > 0) {
                          let refJob = null;
                          for (let ri = _cIdx - 1; ri >= 0; ri--) {
                            if (combined[ri].type === 'job' && combined[ri].data.status === 'completed') { refJob = combined[ri].data; break; }
                          }
                          window._dumpRecQueue.push({
                            elemId: dumpRecId,
                            refJob,
                            candidates,
                            capacity,
                            runningGal: runningForCapacity,
                            vehicleId: v.id,
                            dateStr,
                            insertBeforeSort: item.sort,
                          });
                        }

                        preAlert = `<div class="manifest-suggestion" title="Adding this job would reach ${(runningForCapacity + actualGal).toLocaleString()} gal — Truck capacity: ${capacity.toLocaleString()} gal">
                          <span class="manifest-suggestion-icon">&#9888;</span>
                          <span>Dump needed — ${runningForCapacity.toLocaleString()} / ${capacity.toLocaleString()} gal onboard — ${Math.max(0, capacity - runningForCapacity).toLocaleString()} gal remaining — Insert manifest</span>
                          ${candidates.length > 0 ? `<div id="${dumpRecId}" style="padding:4px 12px;font-size:11px;color:#666;font-style:italic;">💡 Finding best job to fit...</div>` : ''}
                        </div>`;
                        runningForCapacity = 0; // Reset — assume a dump happens here, keep tracking for next trip
                      }

                      if (j.status === 'completed') runningGallons += actualGal;
                      runningForCapacity += actualGal;
                      const tankAbbrevs = jobTanks.map(t => {
                        const typeMap = { 'Septic': 'St', 'Grease Trap': 'Gt', 'Holding Tank': 'Ht', 'Cesspool': 'Cp', 'Dry Well': 'Dw' };
                        return typeMap[t.tank_type] || (t.tank_type || 'T').substring(0,2);
                      }).join('');
                      const helperIcons = (j.helpers || []).map(hId => {
                        const helper = users.find(u => u.id === hId);
                        return helper ? `<span class="helper-icon" style="background:${helper.color || '#1565c0'};" title="${esc(helper.name)}">&#128100;</span>` : '';
                      }).join('');

                      const isJobDone = j.status === 'completed';
                      const completedTime = j.completed_at ? new Date(j.completed_at).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}) : '';

                      // Job card background tinted with truck color
                      const jobCardBg = hexToRgba(tc, 0.12);
                      const jobCardBorder = hexToRgba(tc, 0.4);

                      return preAlert + `
                      <div class="truck-job-card ${j.status}" data-sort="${item.sort}" data-job-id="${j.id}" style="background:${jobCardBg}; border-left:3px solid ${tc};${isJobDone ? '' : 'cursor:grab;'}"
                        ${isJobDone ? `onclick="openJobDetail('${j.id}')"` : `onmousedown="onJobMouseDown(event, '${j.id}')"`}>
                        ${confBanner(j.confirmation_status)}
                        <div class="job-card-body">
                          <div class="job-card-left">
                            ${j.scheduled_time ? `<div class="job-time">${j.scheduled_time}</div>` : ''}
                            <div class="job-customer-name">${esc(j.customers?.name || 'N/A')}</div>
                            ${j.property ? `<div class="job-address-line"><span class="job-address-street">${esc(j.property.address || '')}</span>${j.property.city ? ' <span class="job-address-city">' + esc(j.property.city) + '</span>' : ''}</div>` : ''}
                            ${j.customers?.phone ? `<div class="job-phone">${esc(j.customers.phone)}</div>` : ''}
                            <div style="display:flex;gap:4px;align-items:center;margin-top:4px;flex-wrap:wrap;">
                              ${j.loose_end ? '<span class="loose-end-badge" title="Loose End — needs follow-up">&#9888;</span>' : ''}
                              ${j.invoice_number ? `<span style="font-size:11px;color:var(--text-light);">Invoice # ${esc(j.invoice_number)}</span>` : ''}
                              ${helperIcons}
                            </div>
                            ${j.manifest_number ? `<div class="job-manifest-stamp">Manifest # ${esc(j.manifest_number)}</div>` : ''}
                          </div>
                          <div class="job-card-right">
                            <div class="job-tank-abbrev">${tankAbbrevs}</div>
                            <div class="job-tank-gal">${totalGal.toLocaleString()}</div>
                            ${isJobDone && Object.keys(pumped).length > 0 ? `
                              <div style="margin-top:2px;border-top:1px dashed rgba(0,0,0,0.15);padding-top:2px;">
                                <div class="job-tank-gal" title="Pumped">${Object.values(pumped).reduce((s, g) => s + (parseInt(g) || 0), 0).toLocaleString()}</div>
                              </div>
                            ` : ''}
                            ${isJobDone ? `
                              <div class="job-complete-check" title="Completed${completedTime ? ' at ' + completedTime : ''}">
                                <span class="job-check-icon">&#10003;</span>
                                ${completedTime ? `<span class="job-check-time">${completedTime}</span>` : ''}
                              </div>
                            ` : ''}
                          </div>
                        </div>
                      </div>`;
                    } else if (item.type === 'manifest') {
                      const si = item.data;
                      const isCompleted = si.status === 'completed';
                      const manifestGal = si.total_gallons || runningGallons;
                      runningGallons = 0; // Reset after manifest so next batch starts fresh
                      runningForCapacity = 0; // Reset capacity tracking too
                      return `
                      <div class="schedule-manifest-card ${isCompleted ? 'manifest-completed' : 'manifest-draft'}" data-sort="${item.sort}"
                        style="cursor:grab;"
                        onmousedown="onScheduleItemMouseDown(event, '${si.id}')"
                        onclick="openManifestDetail('${si.id}')">
                        <span class="manifest-card-icon">&#9851;</span>
                        <span class="manifest-card-name">${esc(companyName)}</span>
                        <span class="manifest-card-total">${si.manifest_number || ''}</span>
                        ${isCompleted ? `<span class="manifest-card-check">&#10003;</span>` : ''}
                        ${!isCompleted ? `<button class="manifest-card-remove" onclick="event.stopPropagation(); removeScheduleItem('${si.id}')">&times;</button>` : ''}
                      </div>`;
                    } else if (item.type === 'driver_change') {
                      const si = item.data;
                      const driver = users.find(u => u.id === si.driver_id);
                      return `
                      <div class="schedule-driver-change" data-sort="${item.sort}">
                        <span>New Driver: &#128100; ${esc(si.driver_name || driver?.name || 'Unknown')}</span>
                        <button class="driver-change-remove" onclick="removeScheduleItem('${si.id}')">&times;</button>
                      </div>`;
                    }
                    return '';
                  }).join('')}
                  <button class="btn btn-sm btn-secondary" onclick="openJobModal(null, '${dateStr}', '${v.id}')" style="width:100%;margin-top:8px;font-size:11px;">+ Add Job</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;
}

async function buildWeekView(vehicles, users) {
  const mon = getMonday(scheduleDate);
  const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
  const { data: jobs } = await window.api.getJobs({ dateFrom: formatDate(mon), dateTo: formatDate(sun) });

  const dayAbbr = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon); d.setDate(d.getDate() + i);
    days.push({ date: d, dateStr: formatDate(d), isToday: formatDate(d) === formatDate(new Date()) });
  }

  function dayGallons(dayJobs) {
    return dayJobs.reduce((sum, j) => {
      const pumped = j.gallons_pumped || {};
      const tanks = j.property?.tanks || [];
      return sum + (Object.keys(pumped).length > 0
        ? Object.values(pumped).reduce((s, g) => s + (parseInt(g) || 0), 0)
        : tanks.reduce((s, t) => s + (t.volume_gallons || 0), 0));
    }, 0);
  }

  return `
    <div class="week-schedule-grid week-summary-grid">
      ${days.map((d, i) => {
        const dayJobs = jobs.filter(j => j.scheduled_date === d.dateStr);
        const gal = dayGallons(dayJobs);
        return `
          <div class="week-summary-cell ${d.isToday ? 'today' : ''}" onclick="scheduleDate = new Date('${d.dateStr}T12:00:00'); setScheduleView('day');">
            <div class="week-summary-dayname">${dayAbbr[i]}</div>
            <div class="week-summary-date">${d.date.getDate()}</div>
            ${dayJobs.length > 0 ? `
              <div class="week-summary-jobs">${dayJobs.length} job${dayJobs.length !== 1 ? 's' : ''}</div>
              <div class="week-summary-gal">${gal.toLocaleString()} gal</div>
            ` : `<div class="week-summary-empty">—</div>`}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

async function buildMonthView(vehicles, users) {
  const year = scheduleDate.getFullYear();
  const month = scheduleDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const { data: jobs } = await window.api.getJobs({
    dateFrom: formatDate(firstDay),
    dateTo: formatDate(lastDay),
  });

  const startOffset = (firstDay.getDay() + 6) % 7; // Monday start
  const totalDays = lastDay.getDate();
  const dayAbbr = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const todayStr = formatDate(new Date());

  let cells = '';
  for (let i = 0; i < startOffset; i++) {
    cells += '<div class="month-cell empty"></div>';
  }
  for (let d = 1; d <= totalDays; d++) {
    const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayJobs = jobs.filter(j => j.scheduled_date === ds);
    const isToday = ds === todayStr;
    cells += `
      <div class="month-cell ${isToday ? 'today' : ''}" onclick="scheduleDate = new Date('${ds}T12:00:00'); setScheduleView('day');">
        <div class="month-cell-date">${d}</div>
        ${dayJobs.length > 0 ? (() => {
          const gal = dayJobs.reduce((sum, j) => {
            const pumped = j.gallons_pumped || {};
            const tanks = j.property?.tanks || [];
            return sum + (Object.keys(pumped).length > 0
              ? Object.values(pumped).reduce((s, g) => s + (parseInt(g) || 0), 0)
              : tanks.reduce((s, t) => s + (t.volume_gallons || 0), 0));
          }, 0);
          return `<div class="month-cell-count">${dayJobs.length} job${dayJobs.length > 1 ? 's' : ''}</div>
                  <div class="month-cell-gal">${gal.toLocaleString()} gal</div>`;
        })() : ''}
      </div>
    `;
  }

  return `
    <div class="month-grid">
      ${dayAbbr.map(d => `<div class="month-header">${d}</div>`).join('')}
      ${cells}
    </div>
  `;
}

function setScheduleView(view) {
  scheduleView = view;
  loadSchedule();
}

// ===== SCHEDULE MAP VIEW =====
let scheduleMapVisible = false;
let scheduleMapInstance = null;
let mapAllJobs = [];
let mapAllVehicles = [];
let mapAllWasteSites = [];
let mapGeoCache = {};
let mapVisibleTrucks = {}; // which trucks are toggled on
let mapMarkerLayers = {}; // L.layerGroup per vehicle
let mapWasteSiteLayer = null; // L.layerGroup for waste site markers
const MAP_HOME_BASE = { address: '10 Gordon Drive, Rockland, ME', lat: null, lng: null };

async function toggleScheduleMap() {
  const existing = document.getElementById('scheduleMapWrapper');
  if (existing) {
    existing.remove();
    if (scheduleMapInstance) { scheduleMapInstance.remove(); scheduleMapInstance = null; }
    scheduleMapVisible = false;
    loadSchedule();
    return;
  }
  scheduleMapVisible = true;

  const dateStr = formatDate(scheduleDate);
  const { data: jobs } = await window.api.getJobs({ date: dateStr });
  const { data: vehicles } = await window.api.getVehicles();
  const { data: cachedCoords } = await window.api.getGeocodeCache();
  const { data: wasteSites } = await window.api.getWasteSites();

  mapAllJobs = jobs;
  mapAllVehicles = vehicles;
  mapAllWasteSites = wasteSites;
  mapGeoCache = {};
  cachedCoords.forEach(c => { mapGeoCache[c.address] = { lat: c.lat, lng: c.lng }; });

  // Init all trucks visible
  vehicles.forEach(v => { mapVisibleTrucks[v.id] = true; });

  // --- MAP LOADING PROGRESS BAR ---
  // Count how many addresses need geocoding
  const allAddrs = [];
  allAddrs.push(MAP_HOME_BASE.address);
  jobs.forEach(j => {
    const addr = j.property?.address || '';
    const city = j.property?.city || '';
    const state = j.property?.state || 'ME';
    if (addr) allAddrs.push([addr, city, state].filter(Boolean).join(', '));
  });
  wasteSites.forEach(ws => {
    const addr = ws.address || '';
    const city = ws.city || '';
    const state = ws.state || 'ME';
    if (addr) allAddrs.push([addr, city, state].filter(Boolean).join(', '));
  });
  const totalGeoItems = allAddrs.length;
  let geoCompleted = 0;

  // Insert loading overlay into the schedule area
  const wrapper0 = document.querySelector('.schedule-day-wrapper') || document.getElementById('page-schedule');
  const mapLoadDiv = document.createElement('div');
  mapLoadDiv.id = 'mapLoadingProgress';
  mapLoadDiv.style.cssText = 'padding:20px;text-align:center;background:white;border:2px solid #1565c0;border-radius:8px;margin-bottom:8px;';
  mapLoadDiv.innerHTML = '<div style="font-size:14px;font-weight:700;color:#1565c0;margin-bottom:8px;">🗺️ Loading Map</div>'
    + '<div style="font-size:12px;color:#666;margin-bottom:6px;" id="mapLoadText">Geocoding addresses… 0 / ' + totalGeoItems + '</div>'
    + '<div style="background:#e0e0e0;border-radius:4px;height:10px;overflow:hidden;max-width:400px;margin:0 auto;">'
    + '<div id="mapLoadBar" style="background:linear-gradient(90deg,#1565c0,#42a5f5);height:100%;width:0%;transition:width 0.3s ease;border-radius:4px;"></div></div>';
  wrapper0.parentElement.insertBefore(mapLoadDiv, wrapper0);

  function updateMapLoadProgress(label) {
    geoCompleted++;
    const pct = Math.round((geoCompleted / totalGeoItems) * 100);
    const bar = document.getElementById('mapLoadBar');
    const txt = document.getElementById('mapLoadText');
    if (bar) bar.style.width = pct + '%';
    if (txt) txt.textContent = (label || 'Geocoding addresses…') + ' ' + geoCompleted + ' / ' + totalGeoItems + ' — ' + pct + '%';
  }

  // Helper to geocode an address
  let uncachedCount = 0;
  async function geocodeAddr(fullAddr) {
    if (!fullAddr || mapGeoCache[fullAddr]) return;
    uncachedCount++;
    try {
      if (uncachedCount > 1) await new Promise(r => setTimeout(r, 1100));
      const resp = await fetch('https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(fullAddr) + '&limit=1&countrycodes=us', {
        headers: { 'User-Agent': 'InterstateSepticManager/1.0' }
      });
      const data = await resp.json();
      if (data && data.length > 0) {
        mapGeoCache[fullAddr] = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        await window.api.saveGeocodeCache({ address: fullAddr, lat: mapGeoCache[fullAddr].lat, lng: mapGeoCache[fullAddr].lng });
      }
    } catch (e) { console.log('Geocode error:', fullAddr, e); }
  }

  // Geocode home base
  await geocodeAddr(MAP_HOME_BASE.address);
  if (mapGeoCache[MAP_HOME_BASE.address]) {
    MAP_HOME_BASE.lat = mapGeoCache[MAP_HOME_BASE.address].lat;
    MAP_HOME_BASE.lng = mapGeoCache[MAP_HOME_BASE.address].lng;
  }
  updateMapLoadProgress();

  // Geocode all jobs
  for (const j of jobs) {
    const addr = j.property?.address || '';
    const city = j.property?.city || '';
    const state = j.property?.state || 'ME';
    const fullAddr = [addr, city, state].filter(Boolean).join(', ');
    if (!addr) continue;
    await geocodeAddr(fullAddr);
    if (mapGeoCache[fullAddr]) {
      j._coords = mapGeoCache[fullAddr];
      j._fullAddr = fullAddr;
    }
    updateMapLoadProgress();
  }

  // Geocode waste sites
  for (const ws of wasteSites) {
    const addr = ws.address || '';
    const city = ws.city || '';
    const state = ws.state || 'ME';
    const fullAddr = [addr, city, state].filter(Boolean).join(', ');
    if (!addr) continue;
    await geocodeAddr(fullAddr);
    if (mapGeoCache[fullAddr]) {
      ws._coords = mapGeoCache[fullAddr];
      ws._fullAddr = fullAddr;
    }
    updateMapLoadProgress();
  }

  // Remove loading progress bar
  const mapLoadEl = document.getElementById('mapLoadingProgress');
  if (mapLoadEl) mapLoadEl.remove();

  // Build UI
  const wrapper = document.querySelector('.schedule-day-wrapper') || document.getElementById('page-schedule');
  const container = document.createElement('div');
  container.id = 'scheduleMapWrapper';
  container.style.cssText = 'display:flex;gap:0;margin-bottom:8px;border:2px solid #1565c0;border-radius:8px;overflow:hidden;';

  const mapDiv = document.createElement('div');
  mapDiv.id = 'scheduleMapContainer';
  mapDiv.style.cssText = 'flex:1;height:500px;min-width:0;';

  const routePanel = document.createElement('div');
  routePanel.id = 'mapRoutePanel';
  routePanel.style.cssText = 'width:280px;max-height:500px;overflow-y:auto;background:white;border-left:1px solid #ccc;font-size:12px;';

  container.appendChild(mapDiv);
  container.appendChild(routePanel);
  wrapper.parentElement.insertBefore(container, wrapper);

  // Init map
  const map = L.map('scheduleMapContainer').setView([44.1, -69.1], 10);
  scheduleMapInstance = map;
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OSM &copy; CARTO',
    maxZoom: 19,
    subdomains: 'abcd'
  }).addTo(map);

  // Create layer groups per vehicle
  vehicles.forEach(v => {
    mapMarkerLayers[v.id] = L.layerGroup().addTo(map);
  });

  // Waste site layer
  mapWasteSiteLayer = L.layerGroup().addTo(map);

  // Home base marker
  if (MAP_HOME_BASE.lat) {
    const homeIcon = L.divIcon({
      className: 'schedule-map-marker',
      html: '<div style="background:#333;color:white;border-radius:4px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:16px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4);">&#127968;</div>',
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });
    L.marker([MAP_HOME_BASE.lat, MAP_HOME_BASE.lng], { icon: homeIcon })
      .bindPopup('<strong>Home Base</strong><br>10 Gordon Drive, Rockland, ME')
      .addTo(map);
  }

  renderMapMarkers();
  renderWasteSiteMarkers();
  renderMapRoutePanel();
  fitMapBounds();
}

function buildGlobalJobNumberMap() {
  // Assign a unique sequential number to every job across all trucks
  const numMap = {};
  let counter = 1;
  mapAllVehicles.forEach(v => {
    const vJobs = mapAllJobs.filter(j => j.vehicle_id === v.id && j._coords).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    vJobs.forEach(j => { numMap[j.id] = counter++; });
  });
  return numMap;
}

function renderMapMarkers() {
  const map = scheduleMapInstance;
  if (!map) return;

  const jobNumMap = buildGlobalJobNumberMap();

  // Clear all layers
  mapAllVehicles.forEach(v => {
    if (mapMarkerLayers[v.id]) mapMarkerLayers[v.id].clearLayers();
  });

  mapAllVehicles.forEach(v => {
    if (!mapVisibleTrucks[v.id]) return;
    const layer = mapMarkerLayers[v.id];
    const color = v.color || '#1565c0';
    const capacity = v.capacity_gallons || 0;
    const vJobs = mapAllJobs.filter(j => j.vehicle_id === v.id && j._coords).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    let runGal = 0;

    vJobs.forEach((j) => {
      // Calculate this job's gallons
      const pumped = j.gallons_pumped || {};
      const jobTanks = j.property?.tanks || [];
      const jobGal = Object.keys(pumped).length > 0
        ? Object.values(pumped).reduce((s, g) => s + (parseInt(g) || 0), 0)
        : jobTanks.reduce((s, t) => s + (t.volume_gallons || 0), 0);

      // Check if adding this job exceeds capacity — reset gallon counter (dump alerts shown in route panel only)
      if (capacity > 0 && runGal > 0 && runGal + jobGal > capacity) {
        runGal = 0; // Reset after dump
      }

      runGal += jobGal;

      const num = jobNumMap[j.id] || '?';
      const svgIcon = L.divIcon({
        className: 'schedule-map-marker',
        html: '<div style="background:' + color + ';color:white;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);">' + num + '</div>',
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });
      const marker = L.marker([j._coords.lat, j._coords.lng], { icon: svgIcon });
      const isDone = j.status === 'completed';
      const custName = j.customers?.name || 'Unknown';

      let popupHtml = '<div style="min-width:180px;">'
        + '<strong>' + esc(custName) + '</strong><br>'
        + '<span style="font-size:12px;">' + esc(j._fullAddr) + '</span><br>'
        + '<span style="color:' + color + ';font-weight:600;">' + esc(v.name) + '</span>'
        + ' #' + num
        + (isDone ? ' <span style="color:green;">&#10003;</span>' : '')
        + (j.scheduled_time ? '<br>Time: ' + j.scheduled_time : '')
        + '<div style="margin-top:6px;border-top:1px solid #eee;padding-top:6px;">'
        + '<strong style="font-size:11px;">Move to:</strong><br>';
      mapAllVehicles.forEach(ov => {
        if (ov.id === v.id) return;
        popupHtml += '<button style="margin:2px;padding:2px 8px;font-size:11px;background:' + (ov.color || '#1565c0') + ';color:white;border:none;border-radius:3px;cursor:pointer;" '
          + 'onclick="reassignJobFromMap(\'' + j.id + '\',\'' + ov.id + '\')">' + esc(ov.name) + '</button>';
      });
      popupHtml += '</div></div>';
      marker.bindPopup(popupHtml);
      layer.addLayer(marker);
    });
  });
}

function renderWasteSiteMarkers() {
  if (!mapWasteSiteLayer) return;
  mapWasteSiteLayer.clearLayers();
  mapAllWasteSites.forEach(ws => {
    if (!ws._coords) return;
    const wsIcon = L.divIcon({
      className: 'schedule-map-marker',
      html: '<div style="background:#8e24aa;color:white;border-radius:4px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);">&#9851;</div>',
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });
    const marker = L.marker([ws._coords.lat, ws._coords.lng], { icon: wsIcon });
    marker.bindPopup('<div style="min-width:150px;"><strong style="color:#8e24aa;">Waste Site</strong><br>'
      + '<span style="font-weight:600;">' + esc(ws.name || '') + '</span><br>'
      + '<span style="font-size:12px;">' + esc(ws._fullAddr || '') + '</span>'
      + (ws.license_number ? '<br><span style="font-size:11px;color:#666;">License: ' + esc(ws.license_number) + '</span>' : '')
      + '</div>');
    mapWasteSiteLayer.addLayer(marker);
  });
}

function _haversineDist(lat1, lng1, lat2, lng2) {
  // Returns distance in miles between two lat/lng points
  const R = 3959; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// OSRM driving distance cache (session-level)
const _osrmCache = new Map();
async function getOsrmDrivingDistance(lat1, lng1, lat2, lng2) {
  const key = `${lat1},${lng1}-${lat2},${lng2}`;
  if (_osrmCache.has(key)) return _osrmCache.get(key);
  try {
    const controller = new AbortController();
    const _osrmTimeout = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(`https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=false`, { signal: controller.signal });
    clearTimeout(_osrmTimeout);
    const data = await resp.json();
    if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      const result = { distance: route.distance * 0.000621371, duration: route.duration / 60, source: 'osrm' }; // meters→miles, sec→min
      _osrmCache.set(key, result);
      return result;
    }
  } catch (e) { /* fallback */ }
  const fallback = { distance: _haversineDist(lat1, lng1, lat2, lng2), duration: 0, source: 'haversine' };
  _osrmCache.set(key, fallback);
  return fallback;
}

// Helper: get coords for a job from geocode lookup
function _jobCoords(job, geoLookup) {
  const p = job.property;
  if (!p) return null;
  const addr = [p.address, p.city, p.state].filter(Boolean).join(', ');
  return geoLookup[addr] || null;
}

// Resolve dump recommendations asynchronously with OSRM driving distances
async function resolveDumpRecommendations() {
  const queue = window._dumpRecQueue || [];
  const geoLookup = window._dumpGeoLookup || {};
  let anyMoved = false;

  for (const rec of queue) {
    const elem = document.getElementById(rec.elemId);
    if (!elem) continue;

    const refCoords = rec.refJob ? _jobCoords(rec.refJob, geoLookup) : null;
    if (!refCoords) {
      elem.innerHTML = '';
      continue;
    }

    // Calculate driving distances for each candidate
    const scored = [];
    for (const c of rec.candidates) {
      const cCoords = _jobCoords(c.job, geoLookup);
      if (!cCoords) continue;
      const dist = await getOsrmDrivingDistance(refCoords.lat, refCoords.lng, cCoords.lat, cCoords.lng);
      const fillPct = Math.round(((rec.runningGal + c.gal) / rec.capacity) * 100);
      scored.push({ ...c, dist: dist.distance, duration: dist.duration, fillPct, coords: cCoords });
    }

    // Sort: closest driving distance first, then most gallons as tiebreaker
    scored.sort((a, b) => a.dist - b.dist || b.gal - a.gal);
    const best = scored[0];

    if (!best) {
      elem.innerHTML = '';
      continue;
    }

    // Auto-move the best candidate
    const custName = best.job.customers?.name || 'Unknown';
    const distLabel = best.dist < 0.1 ? '< 0.1 mi' : best.dist.toFixed(1) + ' mi';
    elem.innerHTML = `<span style="font-style:normal;color:#2e7d32;">💡 Moving <strong>${esc(custName)}</strong> here (${best.gal.toLocaleString()} gal, ${distLabel}) → ${best.fillPct}% full</span>`;
    elem.style.fontStyle = 'normal';

    await moveJobBeforeDump(best.job.id, rec.vehicleId, rec.dateStr, rec.insertBeforeSort, true);
    anyMoved = true;
  }

  // If any jobs were moved, refresh the schedule once to show new order
  if (anyMoved) {
    showToast('Schedule optimized — jobs reordered to maximize truck load before dumps.', 'success');
    loadSchedule();
  }
}

// Move a job before the dump point by adjusting sort_order
// silent=true skips toast and schedule reload (used by auto-optimizer)
async function moveJobBeforeDump(jobId, vehicleId, dateStr, insertBeforeSort, silent) {
  try {
    const { data: jobs } = await window.api.getJobs({ date: dateStr });
    const vehicleJobs = jobs.filter(j => j.vehicle_id === vehicleId);
    const { data: schedItems } = await window.api.getScheduleItems(vehicleId, dateStr);

    const all = [];
    vehicleJobs.forEach(j => {
      all.push({ type: 'job', id: j.id, sort: j.sort_order != null ? j.sort_order : 999 });
    });
    schedItems.forEach(si => {
      all.push({ type: 'item', id: si.id, sort: si.sort_order != null ? si.sort_order : 999 });
    });

    const targetIdx = all.findIndex(a => a.type === 'job' && a.id === jobId);
    if (targetIdx === -1) return;
    const target = all.splice(targetIdx, 1)[0];

    all.sort((a, b) => a.sort - b.sort);

    let insertIdx = all.findIndex(a => a.sort >= insertBeforeSort);
    if (insertIdx === -1) insertIdx = all.length;
    all.splice(Math.max(0, insertIdx), 0, target);

    for (let i = 0; i < all.length; i++) {
      const newSort = (i + 1) * 10;
      if (all[i].type === 'job') {
        await window.api.saveJob({ id: all[i].id, sort_order: newSort });
      } else {
        await window.api.saveScheduleItem({ id: all[i].id, sort_order: newSort });
      }
    }

    if (!silent) {
      showToast('Job moved — schedule reordered.', 'success');
      loadSchedule();
    }
  } catch (e) {
    if (!silent) showToast('Failed to move job: ' + e.message, 'error');
  }
}

async function optimizeTruckRoute(vehicleId) {
  if (!MAP_HOME_BASE.lat) {
    showToast('Home base not geocoded. Cannot optimize.', 'error');
    return;
  }

  // Get jobs for this truck that have coordinates
  const vJobs = mapAllJobs
    .filter(j => j.vehicle_id === vehicleId && j._coords)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  if (vJobs.length < 2) {
    showToast('Not enough jobs to optimize.', 'info');
    return;
  }

  // Show progress bar under the truck header in the route panel
  const totalSteps = vJobs.length;
  let completedSteps = 0;
  const progressId = 'opt-progress-' + vehicleId;
  const btnEl = document.querySelector(`button[onclick="optimizeTruckRoute('${vehicleId}')"]`);
  const truckHeaderDiv = btnEl ? btnEl.closest('div[style*="border-bottom"]') || btnEl.closest('div').parentNode : null;
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = 'Optimizing...';
  }
  const progDiv = document.createElement('div');
  progDiv.id = progressId;
  progDiv.style.cssText = 'padding:6px 8px;background:#f5f0ff;border-bottom:1px solid #d1c4e9;';
  progDiv.innerHTML = '<div style="font-size:11px;color:#5e35b1;font-weight:600;margin-bottom:3px;">Optimizing route… <span id="' + progressId + '-text">0 / ' + totalSteps + '</span></div>'
    + '<div style="background:#e0e0e0;border-radius:4px;height:8px;overflow:hidden;">'
    + '<div id="' + progressId + '-bar" style="background:linear-gradient(90deg,#7c4dff,#448aff);height:100%;width:0%;transition:width 0.3s ease;border-radius:4px;"></div></div>';
  if (truckHeaderDiv) {
    // Insert right after the truck header bar (first child div)
    const headerBar = truckHeaderDiv.querySelector('div[style*="background:"]') || truckHeaderDiv.firstElementChild;
    if (headerBar && headerBar.nextSibling) {
      truckHeaderDiv.insertBefore(progDiv, headerBar.nextSibling);
    } else {
      truckHeaderDiv.appendChild(progDiv);
    }
  }

  function updateProgress(step, label) {
    completedSteps = step;
    const pct = Math.round((completedSteps / totalSteps) * 100);
    const bar = document.getElementById(progressId + '-bar');
    const txt = document.getElementById(progressId + '-text');
    if (bar) bar.style.width = pct + '%';
    if (txt) txt.textContent = (label || (completedSteps + ' / ' + totalSteps)) + ' — ' + pct + '%';
  }

  // Get truck capacity
  const truck = mapAllVehicles.find(v => v.id === vehicleId);
  const capacity = truck?.capacity_gallons || 0;

  // Calculate each job's gallons
  vJobs.forEach(j => {
    const pumped = j.gallons_pumped || {};
    const jobTanks = j.property?.tanks || [];
    j._gal = Object.keys(pumped).length > 0
      ? Object.values(pumped).reduce((s, g) => s + (parseInt(g) || 0), 0)
      : jobTanks.reduce((s, t) => s + (t.volume_gallons || 0), 0);
    j._distFromHome = _haversineDist(MAP_HOME_BASE.lat, MAP_HOME_BASE.lng, j._coords.lat, j._coords.lng);
  });

  // Route logic: furthest job first (truck is empty/light), then work back
  // toward home base picking the closest next job by drive time.
  const remaining = [...vJobs];
  const sorted = [];
  let onboard = 0;

  // Step 1: Pick the furthest job from home base as the first stop
  remaining.sort((a, b) => b._distFromHome - a._distFromHome);
  const first = remaining.shift();
  sorted.push(first);
  onboard += first._gal;
  updateProgress(1);

  // Step 2: From there, pick closest next job by drive time.
  // Dump triggers: (a) capacity overflow, or (b) truck is 70%+ full AND we're near
  // home base AND the next job would take us further away — smarter to dump now.
  while (remaining.length > 0) {
    const current = sorted[sorted.length - 1];

    // Check if any remaining job fits in the truck
    const anyFits = capacity <= 0 || remaining.some(j => onboard + j._gal <= capacity);

    if (!anyFits && capacity > 0) {
      // DUMP — truck goes back to disposal (home area), resets empty.
      // Pick the furthest remaining job from home base (same as initial logic).
      onboard = 0;
      remaining.forEach(j => {
        j._distFromHome = _haversineDist(MAP_HOME_BASE.lat, MAP_HOME_BASE.lng, j._coords.lat, j._coords.lng);
      });
      remaining.sort((a, b) => b._distFromHome - a._distFromHome);
      const next = remaining.shift();
      sorted.push(next);
      onboard += next._gal;
      updateProgress(sorted.length);
      continue;
    }

    // Normal pick: closest job by drive time that fits capacity
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      if (capacity > 0 && onboard + remaining[i]._gal > capacity) continue;
      const dist = await getOsrmDrivingDistance(current._coords.lat, current._coords.lng, remaining[i]._coords.lat, remaining[i]._coords.lng);
      if (dist.distance < bestDist) { bestDist = dist.distance; bestIdx = i; }
    }

    if (bestIdx === -1) bestIdx = 0; // safety fallback
    const next = remaining.splice(bestIdx, 1)[0];
    sorted.push(next);
    onboard += next._gal;
    updateProgress(sorted.length);
  }

  // Save new sort_order sequentially
  updateProgress(totalSteps, 'Saving');
  const savePromises = sorted.map((j, i) => {
    return window.api.saveJob({ id: j.id, sort_order: (i + 1) * 10 });
  });
  await Promise.all(savePromises);

  // Remove progress bar
  const progEl = document.getElementById(progressId);
  if (progEl) progEl.remove();

  // Refresh
  const dateStr = formatDate(scheduleDate);
  const { data: jobs } = await window.api.getJobs({ date: dateStr });
  jobs.forEach(j => {
    const addr = j.property?.address || '';
    const city = j.property?.city || '';
    const state = j.property?.state || 'ME';
    const fullAddr = [addr, city, state].filter(Boolean).join(', ');
    if (mapGeoCache[fullAddr]) { j._coords = mapGeoCache[fullAddr]; j._fullAddr = fullAddr; }
  });
  mapAllJobs = jobs;
  renderMapMarkers();
  renderMapRoutePanel();

  const v = mapAllVehicles.find(v => v.id === vehicleId);
  showToast('Route optimized for ' + (v?.name || 'truck') + ' — furthest out first, working back home.', 'success');
}

async function aiOptimizeDay() {
  const dateStr = formatDate(scheduleDate);
  const { data: vehicles } = await window.api.getVehicles();

  if (vehicles.length === 0) { showToast('No trucks configured.', 'info'); return; }

  const trucksWithCap = vehicles.filter(v => v.capacity_gallons > 0);
  if (trucksWithCap.length === 0) {
    showToast('Set truck capacities in Vehicles settings first.', 'error');
    return;
  }

  // Show truck selection modal
  const checkboxes = trucksWithCap.map(v =>
    `<label style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:6px;cursor:pointer;border:1px solid var(--border);margin-bottom:6px;">
      <input type="checkbox" class="ai-truck-check" value="${v.id}" checked style="width:18px;height:18px;accent-color:${v.color || '#1565c0'};">
      <span style="width:12px;height:12px;border-radius:50%;background:${v.color || '#1565c0'};flex-shrink:0;"></span>
      <span style="font-weight:600;">${esc(v.name)}</span>
      <span style="color:var(--text-light);font-size:12px;margin-left:auto;">${(v.capacity_gallons || 0).toLocaleString()} gal</span>
    </label>`
  ).join('');

  openModal('AI Route Optimizer', `
    <div style="margin-bottom:16px;">
      <p style="margin:0 0 12px;color:var(--text-light);font-size:13px;">Select which trucks to include in optimization. Jobs will be redistributed across selected trucks based on location, capacity, and route efficiency.</p>
      <div style="margin-bottom:8px;display:flex;gap:8px;">
        <button class="btn btn-sm btn-secondary" onclick="document.querySelectorAll('.ai-truck-check').forEach(c=>c.checked=true)">Select All</button>
        <button class="btn btn-sm btn-secondary" onclick="document.querySelectorAll('.ai-truck-check').forEach(c=>c.checked=false)">Deselect All</button>
      </div>
      ${checkboxes}
    </div>
    <button class="btn btn-primary" style="width:100%;background:linear-gradient(135deg,#7c4dff,#448aff);" onclick="runAiOptimize()">&#9889; Optimize Selected Trucks</button>
  `);
}

async function runAiOptimize() {
  const selectedIds = Array.from(document.querySelectorAll('.ai-truck-check:checked')).map(c => c.value);
  if (selectedIds.length === 0) { showToast('Select at least one truck.', 'error'); return; }
  closeModal();

  const dateStr = formatDate(scheduleDate);
  const { data: jobs } = await window.api.getJobs({ date: dateStr });
  const { data: vehicles } = await window.api.getVehicles();
  const { data: cachedCoords } = await window.api.getGeocodeCache();

  // Only include jobs currently on selected trucks, plus unassigned jobs
  const selectedJobs = jobs.filter(j => selectedIds.includes(j.vehicle_id) || !j.vehicle_id);
  if (selectedJobs.length === 0) { showToast('No jobs on selected trucks.', 'info'); return; }

  const trucks = vehicles.filter(v => selectedIds.includes(v.id));

  // --- AI OPTIMIZE PROGRESS BAR ---
  const totalAiJobs = selectedJobs.length;
  let aiStepsDone = 0;
  const aiProgOverlay = document.createElement('div');
  aiProgOverlay.id = 'aiOptProgress';
  aiProgOverlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
  aiProgOverlay.innerHTML = '<div style="background:white;border-radius:12px;padding:28px 36px;min-width:360px;box-shadow:0 8px 32px rgba(0,0,0,0.3);text-align:center;">'
    + '<div style="font-size:20px;margin-bottom:4px;">⚡</div>'
    + '<div style="font-size:16px;font-weight:700;color:#5e35b1;margin-bottom:4px;">AI Route Optimizer</div>'
    + '<div style="font-size:12px;color:#666;margin-bottom:12px;" id="aiOptLabel">Preparing…</div>'
    + '<div style="background:#e0e0e0;border-radius:6px;height:12px;overflow:hidden;">'
    + '<div id="aiOptBar" style="background:linear-gradient(90deg,#7c4dff,#448aff);height:100%;width:0%;transition:width 0.3s ease;border-radius:6px;"></div></div>'
    + '<div style="font-size:11px;color:#999;margin-top:6px;" id="aiOptPct">0%</div>'
    + '</div>';
  document.body.appendChild(aiProgOverlay);

  function updateAiProgress(step, label) {
    aiStepsDone = step;
    // Total steps: geocoding (totalAiJobs) + clustering (1) + balancing (1) + routing per truck (~totalAiJobs) + saving (1)
    const totalSteps = totalAiJobs * 2 + 3;
    const pct = Math.min(100, Math.round((aiStepsDone / totalSteps) * 100));
    const bar = document.getElementById('aiOptBar');
    const lbl = document.getElementById('aiOptLabel');
    const pctEl = document.getElementById('aiOptPct');
    if (bar) bar.style.width = pct + '%';
    if (lbl) lbl.textContent = label || 'Processing…';
    if (pctEl) pctEl.textContent = pct + '%';
  }

  updateAiProgress(0, 'Geocoding addresses…');

  // Build geocode cache
  const geoCache = {};
  cachedCoords.forEach(c => { geoCache[c.address] = { lat: c.lat, lng: c.lng }; });

  // Geocode home base if needed
  const homeAddr = MAP_HOME_BASE.address;
  if (!geoCache[homeAddr]) {
    try {
      const resp = await fetch('https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(homeAddr) + '&limit=1&countrycodes=us', {
        headers: { 'User-Agent': 'InterstateSepticManager/1.0' }
      });
      const data = await resp.json();
      if (data && data.length > 0) {
        geoCache[homeAddr] = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        await window.api.saveGeocodeCache({ address: homeAddr, lat: geoCache[homeAddr].lat, lng: geoCache[homeAddr].lng });
      }
    } catch(e) {}
  }
  const homeLat = geoCache[homeAddr]?.lat || 44.1;
  const homeLng = geoCache[homeAddr]?.lng || -69.1;

  // Geocode all jobs (use cache, only fetch uncached)
  let uncached = 0;
  for (const j of selectedJobs) {
    const addr = j.property?.address || '';
    const city = j.property?.city || '';
    const state = j.property?.state || 'ME';
    const fullAddr = [addr, city, state].filter(Boolean).join(', ');
    if (!addr) continue;
    if (!geoCache[fullAddr]) {
      uncached++;
      try {
        if (uncached > 1) await new Promise(r => setTimeout(r, 1100));
        const resp = await fetch('https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(fullAddr) + '&limit=1&countrycodes=us', {
          headers: { 'User-Agent': 'InterstateSepticManager/1.0' }
        });
        const data = await resp.json();
        if (data && data.length > 0) {
          geoCache[fullAddr] = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
          await window.api.saveGeocodeCache({ address: fullAddr, lat: geoCache[fullAddr].lat, lng: geoCache[fullAddr].lng });
        }
      } catch(e) {}
    }
    j._coords = geoCache[fullAddr] || null;
    j._fullAddr = fullAddr;
    updateAiProgress(aiStepsDone + 1, 'Geocoding addresses… ' + (aiStepsDone + 1) + ' / ' + totalAiJobs);
    aiStepsDone++;
    // Calculate gallons for this job
    const pumped = j.gallons_pumped || {};
    const jobTanks = j.property?.tanks || [];
    j._gal = Object.keys(pumped).length > 0
      ? Object.values(pumped).reduce((s, g) => s + (parseInt(g) || 0), 0)
      : jobTanks.reduce((s, t) => s + (t.volume_gallons || 0), 0);
    j._distFromHome = j._coords
      ? _haversineDist(homeLat, homeLng, j._coords.lat, j._coords.lng)
      : 0;
  }

  // Separate jobs with and without coordinates
  const geoJobs = selectedJobs.filter(j => j._coords);
  const noGeoJobs = selectedJobs.filter(j => !j._coords);

  updateAiProgress(totalAiJobs, 'Clustering jobs by location…');
  // === STEP 1: Geographic clustering using angular sectors from home base ===
  // Divide the map into sectors (like pie slices) from home base
  geoJobs.forEach(j => {
    j._angle = Math.atan2(j._coords.lat - homeLat, j._coords.lng - homeLng) * (180 / Math.PI);
  });
  // Sort by angle to group geographically close jobs
  geoJobs.sort((a, b) => a._angle - b._angle);

  // === STEP 2: Assign jobs to trucks using capacity-aware bin packing ===
  // Each truck gets filled with geographically grouped jobs respecting capacity per trip
  const truckAssignments = trucks.map(t => ({
    id: t.id,
    capacity: t.capacity_gallons || 9999,
    jobs: [],
    totalGal: 0
  }));

  // Distribute jobs round-robin by sector, respecting that trucks can make multiple trips
  const unassigned = [...geoJobs];

  // First pass: assign jobs to trucks based on geographic sectors
  // Divide jobs into roughly equal geographic sectors per truck
  const sectorSize = Math.ceil(unassigned.length / trucks.length);
  trucks.forEach((t, tIdx) => {
    const ta = truckAssignments[tIdx];
    const sectorJobs = unassigned.splice(0, sectorSize);
    ta.jobs.push(...sectorJobs);
    ta.totalGal = sectorJobs.reduce((s, j) => s + j._gal, 0);
  });

  // Push any remaining into least-loaded truck
  while (unassigned.length > 0) {
    const j = unassigned.shift();
    const lightest = truckAssignments.reduce((a, b) => a.totalGal < b.totalGal ? a : b);
    lightest.jobs.push(j);
    lightest.totalGal += j._gal;
  }

  // === STEP 3: Balance by swapping border jobs between adjacent sectors ===
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < truckAssignments.length; i++) {
      const ta = truckAssignments[i];
      if (ta.jobs.length <= 1) continue;
      // Check if any job is closer to an adjacent truck's centroid
      for (const j of [...ta.jobs]) {
        if (!j._coords) continue;
        let bestTruck = ta;
        let bestDist = Infinity;
        for (const other of truckAssignments) {
          if (other.jobs.length === 0) continue;
          // Calculate centroid of other truck's jobs
          const cLat = other.jobs.reduce((s, oj) => s + (oj._coords?.lat || 0), 0) / other.jobs.length;
          const cLng = other.jobs.reduce((s, oj) => s + (oj._coords?.lng || 0), 0) / other.jobs.length;
          const d = _haversineDist(j._coords.lat, j._coords.lng, cLat, cLng);
          if (d < bestDist) { bestDist = d; bestTruck = other; }
        }
        if (bestTruck !== ta && ta.jobs.length > 1) {
          // Swap if it reduces imbalance
          const taRatio = ta.totalGal / ta.capacity;
          const otherRatio = bestTruck.totalGal / bestTruck.capacity;
          if (taRatio > otherRatio + 0.1) {
            ta.jobs = ta.jobs.filter(x => x.id !== j.id);
            ta.totalGal -= j._gal;
            bestTruck.jobs.push(j);
            bestTruck.totalGal += j._gal;
          }
        }
      }
    }
  }

  // Distribute non-geocoded jobs to least-loaded trucks
  noGeoJobs.forEach(j => {
    const lightest = truckAssignments.reduce((a, b) => a.totalGal < b.totalGal ? a : b);
    lightest.jobs.push(j);
    lightest.totalGal += j._gal;
  });

  updateAiProgress(totalAiJobs + 1, 'Optimizing routes by drive time…');
  // === STEP 4: Optimize route within each truck using OSRM driving distances ===
  const allSaves = [];
  for (const ta of truckAssignments) {
    const truckJobs = ta.jobs.filter(j => j._coords);
    const noCoordJobs = ta.jobs.filter(j => !j._coords);

    if (truckJobs.length > 1) {
      // Furthest job first (truck is light), then work back toward home by closest drive time
      const truckCap = ta.capacity || 9999;
      truckJobs.forEach(j => {
        j._distFromHome = _haversineDist(homeLat, homeLng, j._coords.lat, j._coords.lng);
      });

      const remaining = [...truckJobs];
      const sorted = [];
      let onboard = 0;

      // Pick furthest from home first
      remaining.sort((a, b) => b._distFromHome - a._distFromHome);
      const first = remaining.shift();
      sorted.push(first);
      onboard += first._gal;

      // Then closest next job by drive time, respecting capacity.
      // On dump (capacity full): treat as returning to home base — pick furthest remaining from home.
      while (remaining.length > 0) {
        const current = sorted[sorted.length - 1];
        const anyFits = truckCap <= 0 || remaining.some(j => onboard + j._gal <= truckCap);

        if (!anyFits && truckCap > 0) {
          // DUMP — back to home base, pick furthest remaining job
          onboard = 0;
          remaining.forEach(j => {
            j._distFromHome = _haversineDist(homeLat, homeLng, j._coords.lat, j._coords.lng);
          });
          remaining.sort((a, b) => b._distFromHome - a._distFromHome);
          const next = remaining.shift();
          sorted.push(next);
          onboard += next._gal;
          continue;
        }

        let bestIdx = -1;
        let bestDist = Infinity;
        for (let i = 0; i < remaining.length; i++) {
          if (truckCap > 0 && onboard + remaining[i]._gal > truckCap) continue;
          const dist = await getOsrmDrivingDistance(current._coords.lat, current._coords.lng, remaining[i]._coords.lat, remaining[i]._coords.lng);
          if (dist.distance < bestDist) { bestDist = dist.distance; bestIdx = i; }
        }
        if (bestIdx === -1) bestIdx = 0;

        const next = remaining.splice(bestIdx, 1)[0];
        sorted.push(next);
        onboard += next._gal;
        updateAiProgress(aiStepsDone + 1, 'Optimizing routes… ' + sorted.length + ' jobs routed');
        aiStepsDone++;
      }

      // Save assignments + order + update driver to match new truck
      const truckDriver = trucks.find(v => v.id === ta.id)?.default_tech_id || '';
      sorted.forEach((j, i) => {
        allSaves.push(window.api.saveJob({ id: j.id, vehicle_id: ta.id, assigned_to: truckDriver, sort_order: (i + 1) * 10 }));
      });
      // Append non-geocoded jobs at end
      noCoordJobs.forEach((j, i) => {
        allSaves.push(window.api.saveJob({ id: j.id, vehicle_id: ta.id, assigned_to: truckDriver, sort_order: (sorted.length + i + 1) * 10 }));
      });
    } else {
      // 0-1 jobs, just assign
      const truckDriver = trucks.find(v => v.id === ta.id)?.default_tech_id || '';
      ta.jobs.forEach((j, i) => {
        allSaves.push(window.api.saveJob({ id: j.id, vehicle_id: ta.id, assigned_to: truckDriver, sort_order: (i + 1) * 10 }));
      });
    }
  }

  updateAiProgress(totalAiJobs * 2 + 2, 'Saving…');
  await Promise.all(allSaves);

  // Remove progress overlay
  const aiProgEl = document.getElementById('aiOptProgress');
  if (aiProgEl) aiProgEl.remove();

  // Build summary
  const summary = truckAssignments.map(ta => {
    const t = trucks.find(v => v.id === ta.id);
    const trips = Math.ceil(ta.totalGal / ta.capacity);
    return (t?.name || 'Truck') + ': ' + ta.jobs.length + ' jobs, ' + ta.totalGal.toLocaleString() + ' gal (' + trips + ' trip' + (trips > 1 ? 's' : '') + ')';
  }).join('\n');

  if (scheduleMapVisible) {
    // Refresh map in place — re-fetch jobs and re-render markers/panel without destroying the map
    const { data: freshJobs } = await window.api.getJobs({ date: dateStr });
    const { data: freshVehicles } = await window.api.getVehicles();
    freshJobs.forEach(j => {
      const addr = j.property?.address || '';
      const city = j.property?.city || '';
      const state = j.property?.state || 'ME';
      const fullAddr = [addr, city, state].filter(Boolean).join(', ');
      j._coords = geoCache[fullAddr] || null;
      j._fullAddr = fullAddr;
    });
    mapAllJobs = freshJobs;
    mapAllVehicles = freshVehicles;
    renderMapMarkers();
    renderMapRoutePanel();
  } else {
    _scheduleRestoreScroll();
    loadSchedule();
  }
  showToast('AI Optimization complete!\n' + summary, 'success');
}

function renderMapRoutePanel() {
  const panel = document.getElementById('mapRoutePanel');
  if (!panel) return;

  const jobNumMap = buildGlobalJobNumberMap();

  // Truck filter toggles at top
  let html = '<div style="padding:6px 8px;border-bottom:2px solid #333;">'
    + '<div style="font-weight:700;font-size:13px;margin-bottom:6px;">Trucks</div>'
    + '<div style="display:flex;flex-wrap:wrap;gap:4px;">';
  // "All" button
  const allOn = mapAllVehicles.every(v => mapVisibleTrucks[v.id]);
  html += '<button onclick="toggleMapTruck(\'all\')" style="padding:3px 8px;font-size:11px;font-weight:600;border:none;border-radius:3px;cursor:pointer;'
    + 'background:' + (allOn ? '#333' : '#e0e0e0') + ';color:' + (allOn ? 'white' : '#333') + ';">All</button>';
  mapAllVehicles.forEach(v => {
    const count = mapAllJobs.filter(j => j.vehicle_id === v.id && j._coords).length;
    if (count === 0) return;
    const isOn = mapVisibleTrucks[v.id];
    const color = v.color || '#1565c0';
    html += '<button onclick="toggleMapTruck(\'' + v.id + '\')" style="padding:3px 8px;font-size:11px;font-weight:600;border:none;border-radius:3px;cursor:pointer;'
      + 'background:' + (isOn ? color : '#e0e0e0') + ';color:' + (isOn ? 'white' : '#333') + ';">'
      + esc(v.name) + ' (' + count + ')</button>';
  });
  html += '</div></div>';

  // Route list per visible truck
  html += '<div style="padding:4px 8px;font-weight:700;font-size:12px;border-bottom:1px solid #eee;">Route Order</div>';
  mapAllVehicles.forEach(v => {
    if (!mapVisibleTrucks[v.id]) return;
    const vJobs = mapAllJobs.filter(j => j.vehicle_id === v.id && j._coords).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    if (vJobs.length === 0) return;
    const color = v.color || '#1565c0';
    html += '<div style="border-bottom:1px solid #eee;">'
      + '<div style="padding:5px 8px;background:' + color + ';color:white;font-weight:700;font-size:11px;display:flex;justify-content:space-between;align-items:center;">'
      + '<span>' + esc(v.name) + ' (' + vJobs.length + ')</span>'
      + '<button onclick="optimizeTruckRoute(\'' + v.id + '\')" style="background:rgba(255,255,255,0.25);border:1px solid rgba(255,255,255,0.5);color:white;border-radius:3px;padding:1px 6px;font-size:10px;cursor:pointer;font-weight:600;" title="Optimize route: furthest from home first">Optimize</button>'
      + '</div>';
    const capacity = v.capacity_gallons || 0;
    let routeRunGal = 0;
    vJobs.forEach((j, idx) => {
      // Calculate job gallons
      const pumped = j.gallons_pumped || {};
      const jobTanks = j.property?.tanks || [];
      const jobGal = Object.keys(pumped).length > 0
        ? Object.values(pumped).reduce((s, g) => s + (parseInt(g) || 0), 0)
        : jobTanks.reduce((s, t) => s + (t.volume_gallons || 0), 0);

      // Show dump alert before this job if it would overflow
      if (capacity > 0 && routeRunGal > 0 && routeRunGal + jobGal > capacity) {
        html += '<div style="padding:4px 8px;background:#fff3e0;border-bottom:1px solid #ff9800;display:flex;align-items:center;gap:5px;font-size:10px;font-weight:600;color:#e65100;">'
          + '<span style="font-size:14px;">&#9888;</span>'
          + '<span>Dump — ' + routeRunGal.toLocaleString() + ' / ' + capacity.toLocaleString() + ' gal</span>'
          + '</div>';
        routeRunGal = 0;
      }
      routeRunGal += jobGal;

      const num = jobNumMap[j.id] || '?';
      const custName = j.customers?.name || '?';
      const city = j.property?.city || '';
      html += '<div class="map-route-item" draggable="true" data-job-id="' + j.id + '" data-vehicle-id="' + v.id + '" data-idx="' + idx + '" '
        + 'ondragstart="onMapRouteDragStart(event)" ondragover="onMapRouteDragOver(event)" ondrop="onMapRouteDrop(event, \'' + v.id + '\')" ondragend="onMapRouteDragEnd(event)" '
        + 'style="padding:3px 8px;border-bottom:1px solid #f5f5f5;cursor:grab;display:flex;align-items:center;gap:5px;">'
        + '<span style="background:' + color + ';color:white;border-radius:50%;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;flex-shrink:0;">' + num + '</span>'
        + '<div style="min-width:0;flex:1;overflow:hidden;">'
        + '<div style="font-weight:600;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(custName) + '</div>'
        + '<div style="font-size:10px;color:var(--text-light);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(city) + '</div>'
        + '</div>'
        + '<span style="font-size:10px;font-weight:700;color:#555;white-space:nowrap;">' + jobGal.toLocaleString() + 'g</span>'
        + (j.status === 'completed' ? '<span style="color:green;font-size:11px;">&#10003;</span>' : '')
        + '</div>';
    });
    html += '</div>';
  });
  panel.innerHTML = html;
}

function fitMapBounds() {
  if (!scheduleMapInstance) return;
  const bounds = [];
  mapAllJobs.forEach(j => {
    if (j._coords && mapVisibleTrucks[j.vehicle_id]) {
      bounds.push([j._coords.lat, j._coords.lng]);
    }
  });
  // Include waste sites
  mapAllWasteSites.forEach(ws => {
    if (ws._coords) bounds.push([ws._coords.lat, ws._coords.lng]);
  });
  // Include home base
  if (MAP_HOME_BASE.lat) bounds.push([MAP_HOME_BASE.lat, MAP_HOME_BASE.lng]);
  if (bounds.length > 0) {
    scheduleMapInstance.fitBounds(bounds, { padding: [40, 40] });
  }
}

function toggleMapTruck(id) {
  if (id === 'all') {
    const allOn = mapAllVehicles.every(v => mapVisibleTrucks[v.id]);
    mapAllVehicles.forEach(v => { mapVisibleTrucks[v.id] = !allOn; });
  } else {
    mapVisibleTrucks[id] = !mapVisibleTrucks[id];
  }
  renderMapMarkers();
  renderMapRoutePanel();
  fitMapBounds();
}

// Map route drag-and-drop reordering
let mapDragJobId = null;
let mapDragSourceVehicle = null;

function onMapRouteDragStart(e) {
  const item = e.target.closest('.map-route-item');
  mapDragJobId = item?.dataset?.jobId;
  mapDragSourceVehicle = item?.dataset?.vehicleId;
  e.dataTransfer.effectAllowed = 'move';
  if (item) item.style.opacity = '0.4';
}

function onMapRouteDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  // Clear all drop indicators
  const panel = document.getElementById('mapRoutePanel');
  if (panel) {
    panel.querySelectorAll('.map-route-item').forEach(el => {
      el.style.borderTop = '';
      el.style.borderBottom = '';
    });
    // Auto-scroll
    const rect = panel.getBoundingClientRect();
    const edgeZone = 50;
    if (e.clientY < rect.top + edgeZone) panel.scrollTop -= 8;
    else if (e.clientY > rect.bottom - edgeZone) panel.scrollTop += 8;
  }

  // Show indicator above or below the hovered item
  const item = e.target.closest('.map-route-item');
  if (item) {
    const rect = item.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      item.style.borderTop = '3px solid #1565c0';
    } else {
      item.style.borderBottom = '3px solid #1565c0';
    }
  }
}

function onMapRouteDragEnd(e) {
  // Clean up opacity and indicators
  const panel = document.getElementById('mapRoutePanel');
  if (panel) {
    panel.querySelectorAll('.map-route-item').forEach(el => {
      el.style.opacity = '';
      el.style.borderTop = '';
      el.style.borderBottom = '';
    });
  }
  mapDragJobId = null;
  mapDragSourceVehicle = null;
}

async function onMapRouteDrop(e, vehicleId) {
  e.preventDefault();
  e.stopPropagation();
  const targetItem = e.target.closest('.map-route-item');

  // Clean up indicators
  const panel = document.getElementById('mapRoutePanel');
  if (panel) {
    panel.querySelectorAll('.map-route-item').forEach(el => {
      el.style.opacity = '';
      el.style.borderTop = '';
      el.style.borderBottom = '';
    });
  }

  if (!mapDragJobId) return;
  const draggedId = mapDragJobId;
  mapDragJobId = null;

  const targetJobId = targetItem?.dataset?.jobId;
  if (!targetJobId || targetJobId === draggedId) return;

  // Determine above/below target using a generous zone:
  // top 40% = drop above, bottom 60% = drop below (bias toward "above" for easier upward moves)
  let dropAfter = true;
  if (targetItem) {
    const rect = targetItem.getBoundingClientRect();
    dropAfter = e.clientY >= rect.top + rect.height * 0.4;
  }

  // Get ALL jobs for the target vehicle (including non-geocoded)
  const vJobs = mapAllJobs
    .filter(j => j.vehicle_id === vehicleId)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  // Build new order: remove dragged job, insert at target position
  const ordered = vJobs.filter(j => j.id !== draggedId).map(j => j.id);

  const targetPos = ordered.indexOf(targetJobId);
  if (targetPos !== -1) {
    const insertAt = dropAfter ? targetPos + 1 : targetPos;
    ordered.splice(insertAt, 0, draggedId);
  } else {
    ordered.push(draggedId);
  }

  // Save new sort_order for all jobs + assign vehicle_id
  const savePromises = ordered.map((jobId, i) => {
    return window.api.saveJob({ id: jobId, vehicle_id: vehicleId, sort_order: (i + 1) * 10 });
  });
  await Promise.all(savePromises);

  // Refresh data and re-render
  const dateStr = formatDate(scheduleDate);
  const { data: jobs } = await window.api.getJobs({ date: dateStr });
  jobs.forEach(j => {
    const addr = j.property?.address || '';
    const city = j.property?.city || '';
    const state = j.property?.state || 'ME';
    const fullAddr = [addr, city, state].filter(Boolean).join(', ');
    if (mapGeoCache[fullAddr]) { j._coords = mapGeoCache[fullAddr]; j._fullAddr = fullAddr; }
  });
  mapAllJobs = jobs;
  renderMapMarkers();
  renderMapRoutePanel();
}

async function reassignJobFromMap(jobId, newVehicleId) {
  const { data: allVehicles } = await window.api.getVehicles();
  const newTruck = allVehicles.find(v => v.id === newVehicleId);
  const newDriver = newTruck?.default_tech_id || '';
  await window.api.saveJob({ id: jobId, vehicle_id: newVehicleId, assigned_to: newDriver });
  const dateStr = formatDate(scheduleDate);
  const { data: jobs } = await window.api.getJobs({ date: dateStr });
  jobs.forEach(j => {
    const addr = j.property?.address || '';
    const city = j.property?.city || '';
    const state = j.property?.state || 'ME';
    const fullAddr = [addr, city, state].filter(Boolean).join(', ');
    if (mapGeoCache[fullAddr]) { j._coords = mapGeoCache[fullAddr]; j._fullAddr = fullAddr; }
  });
  mapAllJobs = jobs;
  renderMapMarkers();
  renderMapRoutePanel();
}

async function seedTestData() {
  if (!confirm('Seed demo customers & jobs for today? This will add ~28 jobs across your pump trucks.')) return;
  const result = await window.api.seedTestData();
  if (result.success) {
    const d = result.data;
    showToast(`Created ${d.jobs} jobs, ${d.customers} customers for ${d.date}`, 'success');
    loadSchedule();
  } else {
    showToast(result.error || 'Seed failed', 'error');
  }
}

async function unseedTestData() {
  if (!confirm('Remove ALL test/demo data? This will delete demo customers, properties, tanks, and jobs. Your real data is untouched.')) return;
  const result = await window.api.unseedTestData();
  if (result.success) {
    showToast(`Removed ${result.data.jobs} jobs, ${result.data.customers} customers, ${result.data.properties} properties, ${result.data.tanks} tanks.`, 'success');
    loadSchedule();
  } else {
    showToast(result.error || 'Unseed failed', 'error');
  }
}

function changeScheduleDate(dir) {
  if (scheduleView === 'day') {
    scheduleDate.setDate(scheduleDate.getDate() + dir);
  } else if (scheduleView === 'week') {
    scheduleDate.setDate(scheduleDate.getDate() + (dir * 7));
  } else {
    scheduleDate.setMonth(scheduleDate.getMonth() + dir);
  }
  loadSchedule();
}

// Old HTML5 drag functions kept as no-ops in case any stray references exist
function onChipDragStart() {}
function onScheduleItemDragStart() {}
function onJobDragStart() {}
function onJobsDragOver() {}
function onJobsDragLeave() {}
function onJobsDrop() {}
function onJobCardClick(jobId) { openJobDetail(jobId); }

let _dragScrollInterval = null;
let _dragMouseX = 0;
let _dragMouseY = 0;

// Track mouse position globally during drag so auto-scroll works
document.addEventListener('dragover', (e) => {
  _dragMouseX = e.clientX;
  _dragMouseY = e.clientY;
});

// Clean up drag state globally when any drag ends
document.addEventListener('dragend', () => {
  _stopDragAutoScroll();
  document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  document.querySelectorAll('.drop-above, .drop-below').forEach(el => {
    el.classList.remove('drop-above', 'drop-below');
  });
});

function _startDragAutoScroll() {
  if (_dragScrollInterval) return; // Already running
  const wrapper = document.querySelector('.schedule-day-main');
  if (!wrapper) return;
  const scrollSpeed = 12;
  const edgeZone = 60;

  _dragScrollInterval = setInterval(() => {
    const rect = wrapper.getBoundingClientRect();
    if (_dragMouseY < rect.top + edgeZone) wrapper.scrollTop -= scrollSpeed;
    else if (_dragMouseY > rect.bottom - edgeZone) wrapper.scrollTop += scrollSpeed;
    if (_dragMouseX < rect.left + edgeZone) wrapper.scrollLeft -= scrollSpeed;
    else if (_dragMouseX > rect.right - edgeZone) wrapper.scrollLeft += scrollSpeed;
  }, 16);
}

function _stopDragAutoScroll() {
  if (_dragScrollInterval) { clearInterval(_dragScrollInterval); _dragScrollInterval = null; }
}

// Save and restore scroll position across schedule rebuilds
let _savedScrollTop = 0;
let _savedScrollLeft = 0;
let _restoreScrollOnLoad = false;
let _scheduleNeedsRefresh = false;

// Standalone revenue refresh — queries DB directly, updates DOM elements by ID
async function refreshRevenue() {
  const dateStr = formatDate(scheduleDate);
  const { data: jobs } = await window.api.getJobs({ date: dateStr });
  const { data: users } = await window.api.getUsers();
  const { data: vehicles } = await window.api.getVehicles();

  const driverRevenue = {};
  users.forEach(u => { driverRevenue[u.id] = 0; });

  // STRICT filter: only jobs where status is exactly 'completed'
  const completedJobs = jobs.filter(j => j.status === 'completed');
  console.log('[Revenue] Date:', dateStr, '| Total jobs:', jobs.length, '| Completed:', completedJobs.length);
  completedJobs.forEach(j => {
    console.log('[Revenue] Completed job:', j.id, j.customers?.name, 'status:', j.status, 'total:', j.total);
  });

  completedJobs.forEach(j => {
    const liRev = (j.line_items || []).reduce((s, li) => s + ((li.qty || 0) * (li.unit_price || 0)), 0);
    const rev = liRev > 0 ? liRev : (j.total || 0);
    let driverId = j.assigned_to || '';
    if (!driverId) {
      const truck = vehicles.find(v => v.id === j.vehicle_id);
      driverId = truck?.default_tech_id || '';
    }
    if (driverId && driverRevenue[driverId] !== undefined) {
      driverRevenue[driverId] += rev;
    }
  });

  const maxRevenue = Math.max(...Object.values(driverRevenue), 1);
  let totalRev = 0;

  users.forEach(u => {
    const rev = driverRevenue[u.id] || 0;
    totalRev += rev;
    const pct = maxRevenue > 0 ? (rev / maxRevenue) * 100 : 0;
    const bar = document.getElementById('rev-bar-' + u.id);
    const amt = document.getElementById('rev-amt-' + u.id);
    if (bar) bar.style.width = pct + '%';
    if (amt) amt.textContent = '$' + rev.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  });

  console.log('[Revenue] Total revenue:', totalRev);
  const totalEl = document.getElementById('rev-day-total');
  if (totalEl) totalEl.textContent = '$' + totalRev.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
}

function _scheduleRestoreScroll() {
  const main = document.querySelector('.schedule-day-main');
  if (main) {
    _savedScrollTop = main.scrollTop;
    _savedScrollLeft = main.scrollLeft;
    _restoreScrollOnLoad = true;
  }
}

// ===== CUSTOM POINTER-BASED DRAG & DROP (no HTML5 drag API) =====
let _pDrag = null; // { type, id, source, el, ghost, startY, startX, started }
let _pDragAutoScroll = null;

function _pDragCleanup() {
  if (_pDrag?.ghost) _pDrag.ghost.remove();
  if (_pDrag?.el) { _pDrag.el.classList.remove('dragging'); _pDrag.el.style.opacity = ''; }
  document.querySelectorAll('.drop-above, .drop-below, .drag-over').forEach(c => c.classList.remove('drop-above', 'drop-below', 'drag-over'));
  if (_pDragAutoScroll) { clearInterval(_pDragAutoScroll); _pDragAutoScroll = null; }
  document.body.style.userSelect = '';
  document.body.style.cursor = '';
  _pDrag = null;
}

// Find drop target: which card is the cursor near and above/below midpoint
function _findDropTarget(container, mouseY) {
  const allItems = Array.from(container.querySelectorAll('.truck-job-card, .schedule-manifest-card, .schedule-driver-change'));
  if (allItems.length === 0) return { el: null, after: true, domIndex: 0 };
  for (let i = 0; i < allItems.length; i++) {
    const rect = allItems[i].getBoundingClientRect();
    if (mouseY < rect.top + rect.height / 2) {
      return { el: allItems[i], after: false, domIndex: i };
    }
  }
  const last = allItems[allItems.length - 1];
  return { el: last, after: true, domIndex: allItems.length };
}

function getClosestCard(container, mouseY) {
  const result = _findDropTarget(container, mouseY);
  const sortVal = result.el ? (parseFloat(result.el.dataset.sort) || (result.domIndex * 10)) : 0;
  return { el: result.el, after: result.after, sortOrder: result.after ? sortVal + 5 : sortVal - 5 };
}

// Called from mousedown on job cards
function onJobMouseDown(e, jobId) {
  // Only left button
  if (e.button !== 0) return;
  const card = e.target.closest('.truck-job-card');
  if (!card) return;
  e.preventDefault();
  e.stopPropagation();
  _pDrag = {
    type: 'move_job', id: jobId, source: 'job',
    el: card, ghost: null, started: false,
    startX: e.clientX, startY: e.clientY
  };
}

// Called from mousedown on side panel chips (manifest, driver)
function onChipMouseDown(e, type, id) {
  if (e.button !== 0) return;
  const chip = e.target.closest('.draggable-chip');
  if (!chip) return;
  e.preventDefault();
  _pDrag = {
    type: type, id: id, source: 'panel',
    el: chip, ghost: null, started: false,
    startX: e.clientX, startY: e.clientY
  };
}

// Called from mousedown on schedule items (manifests, driver changes in column)
function onScheduleItemMouseDown(e, itemId) {
  if (e.button !== 0) return;
  const card = e.target.closest('.schedule-manifest-card, .schedule-driver-change');
  if (!card) return;
  e.preventDefault();
  e.stopPropagation();
  _pDrag = {
    type: 'move_item', id: itemId, source: 'schedule',
    el: card, ghost: null, started: false,
    startX: e.clientX, startY: e.clientY
  };
}

document.addEventListener('mousemove', (e) => {
  if (!_pDrag) return;

  // Require 5px movement before starting drag (prevents accidental drag on click)
  if (!_pDrag.started) {
    const dx = Math.abs(e.clientX - _pDrag.startX);
    const dy = Math.abs(e.clientY - _pDrag.startY);
    if (dx < 5 && dy < 5) return;
    _pDrag.started = true;
    // Create ghost element
    const ghost = _pDrag.el.cloneNode(true);
    ghost.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;opacity:0.8;width:' + _pDrag.el.offsetWidth + 'px;box-shadow:0 4px 12px rgba(0,0,0,0.3);transform:rotate(1deg);transition:none;';
    document.body.appendChild(ghost);
    _pDrag.ghost = ghost;
    _pDrag.el.classList.add('dragging');
    _pDrag.el.style.opacity = '0.3';
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';

    // Start auto-scroll
    _pDragAutoScroll = setInterval(() => {
      const scrollContainer = document.querySelector('.schedule-day-main');
      if (!scrollContainer) return;
      const rect = scrollContainer.getBoundingClientRect();
      const edge = 60;
      if (e.clientY < rect.top + edge) scrollContainer.scrollTop -= 12;
      else if (e.clientY > rect.bottom - edge) scrollContainer.scrollTop += 12;
      if (e.clientX < rect.left + edge) scrollContainer.scrollLeft -= 12;
      else if (e.clientX > rect.right - edge) scrollContainer.scrollLeft += 12;
    }, 30);
  }

  // Move ghost
  if (_pDrag.ghost) {
    _pDrag.ghost.style.left = (e.clientX + 8) + 'px';
    _pDrag.ghost.style.top = (e.clientY - 15) + 'px';
  }

  // Show drop indicators
  document.querySelectorAll('.drop-above, .drop-below, .drag-over, .dump-drop-highlight').forEach(c => c.classList.remove('drop-above', 'drop-below', 'drag-over', 'dump-drop-highlight'));

  // Find which truck-jobs container the cursor is over
  const truckContainers = document.querySelectorAll('.truck-jobs');
  for (const container of truckContainers) {
    const rect = container.getBoundingClientRect();
    if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
      container.classList.add('drag-over');
      const result = _findDropTarget(container, e.clientY);
      if (result.el) {
        result.el.classList.add(result.after ? 'drop-below' : 'drop-above');
      }
      // Also highlight dump alert if cursor is directly over one
      container.querySelectorAll('.manifest-suggestion').forEach(d => {
        const dr = d.getBoundingClientRect();
        if (e.clientY >= dr.top && e.clientY <= dr.bottom) {
          d.classList.add('dump-drop-highlight');
        }
      });
      break;
    }
  }
});

document.addEventListener('mouseup', async (e) => {
  if (!_pDrag) return;
  const drag = _pDrag;

  // If we never started dragging (< 5px movement), treat as a click
  if (!drag.started) {
    _pDragCleanup();
    if (drag.type === 'move_job') {
      openJobDetail(drag.id);
    }
    return;
  }

  // Find which truck-jobs container the cursor is over
  let dropContainer = null;
  let dropVehicleId = null;
  let dropDateStr = null;
  const truckContainers = document.querySelectorAll('.truck-jobs');
  for (const container of truckContainers) {
    const rect = container.getBoundingClientRect();
    if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
      dropContainer = container;
      dropVehicleId = container.dataset.vehicleId;
      dropDateStr = container.dataset.date;
      break;
    }
  }

  _pDragCleanup();

  if (!dropContainer || !dropVehicleId) return;

  const closest = getClosestCard(dropContainer, e.clientY);
  const sortOrder = closest.sortOrder;

  if (drag.type === 'manifest') {
    const { data: truckJobs } = await window.api.getJobs({ date: dropDateStr });
    const vjobs = truckJobs.filter(j => j.vehicle_id === dropVehicleId).sort((a,b) => (a.scheduled_time || '').localeCompare(b.scheduled_time || ''));
    for (let i = 0; i < vjobs.length; i++) {
      if (vjobs[i].sort_order == null) await window.api.saveJob({ id: vjobs[i].id, sort_order: i * 10 });
    }
    const sidePanelSelect = document.getElementById('sidePanelWasteSite');
    const wasteSiteId = sidePanelSelect ? sidePanelSelect.value : '';
    const { data: wasteSites } = await window.api.getWasteSites();
    const site = wasteSites.find(s => s.id === wasteSiteId);
    const { data: nextNum } = await window.api.getNextManifestNumber();
    await window.api.saveScheduleItem({
      vehicle_id: dropVehicleId, scheduled_date: dropDateStr, item_type: 'manifest',
      sort_order: sortOrder, status: 'draft', waste_site_id: wasteSiteId || '',
      waste_site_name: site?.name || '', total_gallons: 0,
      waste_type: (document.getElementById('sidePanelWasteType')?.value || 'Septage'),
      manifest_number: String(nextNum), notes: '', job_ids: [],
    });
    showToast(`Manifest #${nextNum} added. Click to edit details.`, 'success');
    _scheduleRestoreScroll(); loadSchedule();

  } else if (drag.type === 'driver_change') {
    const { data: users } = await window.api.getUsers();
    const user = users.find(u => u.id === drag.id);
    await window.api.saveScheduleItem({
      vehicle_id: dropVehicleId, scheduled_date: dropDateStr, item_type: 'driver_change',
      sort_order: sortOrder, driver_id: drag.id, driver_name: user?.name || 'Unknown',
    });
    showToast(`Driver change to ${user?.name || 'Unknown'} added.`, 'success');
    _scheduleRestoreScroll(); loadSchedule();

  } else if (drag.type === 'move_item' && drag.source === 'schedule') {
    await window.api.saveScheduleItem({ id: drag.id, vehicle_id: dropVehicleId, sort_order: sortOrder });
    _scheduleRestoreScroll(); loadSchedule();

  } else if (drag.type === 'move_job') {
    const dropResult = _findDropTarget(dropContainer, e.clientY);
    const domCards = Array.from(dropContainer.querySelectorAll('.truck-job-card[data-job-id]'));
    const domOrder = domCards.map(c => c.dataset.jobId).filter(id => id !== drag.id);

    let insertIdx = domOrder.length;
    if (dropResult.el) {
      const targetJobId = dropResult.el.dataset?.jobId;
      if (targetJobId) {
        const pos = domOrder.indexOf(targetJobId);
        if (pos !== -1) insertIdx = dropResult.after ? pos + 1 : pos;
      } else {
        const allItems = Array.from(dropContainer.querySelectorAll('.truck-job-card, .schedule-manifest-card, .schedule-driver-change'));
        const dropIdx = allItems.indexOf(dropResult.el);
        if (dropResult.after) {
          for (let i = dropIdx + 1; i < allItems.length; i++) {
            const jid = allItems[i].dataset?.jobId;
            if (jid) { insertIdx = domOrder.indexOf(jid); if (insertIdx === -1) insertIdx = domOrder.length; break; }
          }
        } else {
          for (let i = dropIdx - 1; i >= 0; i--) {
            const jid = allItems[i].dataset?.jobId;
            if (jid) { const pos = domOrder.indexOf(jid); insertIdx = pos !== -1 ? pos + 1 : domOrder.length; break; }
          }
        }
      }
    }
    domOrder.splice(insertIdx, 0, drag.id);

    const { data: allJobs } = await window.api.getJobs({ date: dropDateStr });
    const truckJobIds = allJobs.filter(j => j.vehicle_id === dropVehicleId).map(j => j.id);
    truckJobIds.forEach(id => { if (!domOrder.includes(id)) domOrder.push(id); });

    const { data: vehicles } = await window.api.getVehicles();
    const destTruck = vehicles.find(v => v.id === dropVehicleId);
    const destDriver = destTruck?.default_tech_id || '';
    const savePromises = domOrder.map((jobId, i) => {
      const updates = { id: jobId, sort_order: (i + 1) * 10 };
      if (jobId === drag.id) { updates.vehicle_id = dropVehicleId; updates.assigned_to = destDriver; }
      return window.api.saveJob(updates);
    });
    await Promise.all(savePromises);
    _scheduleRestoreScroll(); loadSchedule();
  }
});

async function removeScheduleItem(id) {
  await window.api.deleteScheduleItem(id);
  showToast('Removed.', 'success');
  loadSchedule();
}

async function changeTruckDriver(vehicleId, dateStr, userId) {
  // This changes the truck's default driver (header dropdown)
  const { data: jobs } = await window.api.getJobs({ date: dateStr });
  const truckJobs = jobs.filter(j => j.vehicle_id === vehicleId);
  for (const j of truckJobs) {
    await window.api.saveJob({ id: j.id, assigned_to: userId });
  }
  // Also update vehicle default
  await window.api.saveVehicle({ id: vehicleId, default_tech_id: userId || null });
  showToast('Driver updated.', 'success');
}

// ===== MANIFEST DETAIL (click on manifest card) =====
async function openManifestDetail(itemId) {
  const { data: allItems } = await window.api.getScheduleItems();
  const item = allItems.find(i => i.id === itemId);
  if (!item) return;

  const { data: jobs } = await window.api.getJobs({ date: item.scheduled_date });
  const { data: vehicles } = await window.api.getVehicles();
  const { data: wasteSites } = await window.api.getWasteSites();
  const { data: users } = await window.api.getUsers();

  const vehicle = vehicles.find(v => v.id === item.vehicle_id);
  const truckJobs = jobs.filter(j => j.vehicle_id === item.vehicle_id).sort((a,b) => (a.scheduled_time || '').localeCompare(b.scheduled_time || ''));

  // Find the previous manifest card (closest one above this one) to set a lower bound
  const sameVehicleItems = allItems.filter(i => i.vehicle_id === item.vehicle_id && i.scheduled_date === item.scheduled_date && i.item_type === 'manifest' && i.id !== item.id);
  const prevManifests = sameVehicleItems.filter(i => (i.sort_order || 0) < item.sort_order);
  const prevManifestSort = prevManifests.length > 0 ? Math.max(...prevManifests.map(i => i.sort_order || 0)) : -1;

  // Find jobs BETWEEN the previous manifest and this one (by sort_order)
  // Show all jobs (not just completed) so the manifest detail is populated when first opened
  const jobsAbove = truckJobs.filter(j => {
    const jobSort = j.sort_order != null ? j.sort_order : truckJobs.indexOf(j) * 10;
    return jobSort < item.sort_order && jobSort > prevManifestSort && !j.manifest_number;
  });

  // Calculate total gallons from jobs above
  let totalGallons = 0;
  jobsAbove.forEach(j => {
    const pumped = j.gallons_pumped || {};
    const jobTanks = j.property?.tanks || [];
    totalGallons += Object.keys(pumped).length > 0
      ? Object.values(pumped).reduce((s, g) => s + (parseInt(g) || 0), 0)
      : jobTanks.reduce((s, t) => s + (t.volume_gallons || 0), 0);
  });

  const isCompleted = item.status === 'completed';
  const defaultSite = wasteSites.find(s => s.is_default);
  const selectedSiteId = item.waste_site_id || (defaultSite ? defaultSite.id : '');
  const tech = vehicle?.default_tech_id ? users.find(u => u.id === vehicle.default_tech_id) : null;
  const truckCapacity = vehicle?.capacity_gallons || 0;
  const capacityWarning = truckCapacity > 0 && totalGallons > truckCapacity;

  // Auto-detect waste types from tank types in the jobs above
  const tankTypeToWaste = { 'Septic Tank': 'Septage', 'Septic Tank+Filter': 'Septage', 'Septic': 'Septage', 'Grease Trap': 'Grease Trap', 'Holding Tank': 'Holding Tank', 'Cesspool': 'Septage', 'Dry Well': 'Septage', 'Portable Toilet': 'Portable Toilet', 'Pump Chamber': 'Septage' };
  const detectedWasteTypes = [...new Set(jobsAbove.flatMap(j => (j.property?.tanks || []).map(t => tankTypeToWaste[t.tank_type] || 'Septage')))];
  // Use saved waste_types if available, otherwise use auto-detected
  const activeWasteTypes = Array.isArray(item.waste_types) && item.waste_types.length > 0 ? item.waste_types : (detectedWasteTypes.length > 0 ? detectedWasteTypes : ['Septage']);

  // Calculate per-waste-type volume breakdown
  const wasteTypeVolumes = {};
  jobsAbove.forEach(j => {
    const pumped = j.gallons_pumped || {};
    const jobTanks = j.property?.tanks || [];
    jobTanks.forEach(t => {
      const wasteType = tankTypeToWaste[t.tank_type] || 'Septage';
      const gal = pumped[t.id] != null ? (parseInt(pumped[t.id]) || 0) : (t.volume_gallons || 0);
      wasteTypeVolumes[wasteType] = (wasteTypeVolumes[wasteType] || 0) + gal;
    });
  });
  const wasteBreakdownHtml = Object.keys(wasteTypeVolumes).length > 1
    ? Object.entries(wasteTypeVolumes).map(([wt, gal]) => `<span style="margin-right:12px;">${esc(wt)}: <strong>${gal.toLocaleString()} gal</strong></span>`).join('')
    : '';

  openModal('Manifest — ' + (vehicle?.name || 'Truck'), `
    <div style="margin-bottom:12px;padding:12px;background:${capacityWarning ? '#fbe9e7' : '#e8f5e9'};border-radius:6px;border-left:4px solid ${capacityWarning ? '#c62828' : '#2e7d32'};">
      <div style="font-size:14px;font-weight:600;">${jobsAbove.length} job(s) above this manifest — ${totalGallons.toLocaleString()} gal</div>
      <div style="font-size:13px;color:var(--text-light);margin-top:4px;">Date: ${item.scheduled_date} &bull; ${esc(vehicle?.name || 'Truck')}${vehicle?.waste_hauler_id ? ' &bull; Hauler ID: ' + esc(vehicle.waste_hauler_id) : ''}</div>
      ${wasteBreakdownHtml ? `<div style="font-size:13px;margin-top:6px;">${wasteBreakdownHtml}</div>` : ''}
      ${capacityWarning ? `<div style="color:#c62828;font-weight:700;margin-top:6px;">&#9888; Exceeds truck capacity of ${truckCapacity.toLocaleString()} gal!</div>` : ''}
      ${truckCapacity > 0 ? `<div style="font-size:12px;color:var(--text-light);margin-top:2px;">Truck capacity: ${truckCapacity.toLocaleString()} gal</div>` : ''}
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Total Gallons${truckCapacity > 0 ? ' (max ' + truckCapacity.toLocaleString() + ')' : ''}</label>
        <input type="number" id="mfGallons" value="${item.total_gallons || totalGallons}" min="0" ${truckCapacity > 0 ? 'max="' + truckCapacity + '"' : ''} ${isCompleted ? 'disabled' : ''}>
      </div>
      <div class="form-group">
        <label>Waste Type(s) — auto-detected from jobs</label>
        <div style="padding:6px 0;font-size:14px;font-weight:600;">${activeWasteTypes.join(', ') || 'None'}</div>
        <input type="hidden" id="mfWasteTypesHidden" value="${activeWasteTypes.join(',')}">
      </div>
    </div>
    <div class="form-group">
      <label>Waste Site *</label>
      <select id="mfWasteSite" ${isCompleted ? 'disabled' : ''}>
        <option value="">Select waste site...</option>
        ${wasteSites.map(s => `<option value="${s.id}" ${s.id === selectedSiteId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
      </select>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Manifest #</label>
        <input type="text" id="mfNumber" value="${esc(item.manifest_number || '')}" placeholder="Enter manifest number" ${isCompleted ? 'disabled' : ''}>
      </div>
      <div class="form-group">
        <label>Driver</label>
        <select id="mfDriver" ${isCompleted ? 'disabled' : ''}>
          ${users.map(u => `<option value="${u.id}" ${(item.driver_id || tech?.id) === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>Notes</label>
      <textarea id="mfNotes" ${isCompleted ? 'disabled' : ''}>${esc(item.notes || '')}</textarea>
    </div>
    ${isCompleted ? '<div style="padding:8px;background:#e8f5e9;border-radius:4px;text-align:center;color:#2e7d32;font-weight:600;">&#9989; Manifest Completed & Locked</div>' : ''}
  `, `
    ${!isCompleted ? `
      <button class="btn btn-danger" onclick="removeScheduleItem('${item.id}'); closeModal();">Remove</button>
      <button class="btn btn-secondary" onclick="saveManifestDraft('${item.id}')">Save Draft</button>
      <button class="btn btn-success" onclick="completeManifest('${item.id}', '${item.vehicle_id}', '${item.scheduled_date}')">Complete Manifest</button>
    ` : `
      <button class="btn btn-danger" onclick="deleteCompletedManifest('${item.id}')">Delete Manifest</button>
      <button class="btn btn-secondary" onclick="closeModal()">Close</button>
    `}
  `);
}

async function deleteCompletedManifest(itemId) {
  if (!confirm('Delete this manifest? This will also remove the associated disposal record and un-stamp the jobs.')) return;

  try {
    // Get the schedule item to find manifest number and job details
    const { data: allItems } = await window.api.getScheduleItems();
    const item = allItems.find(i => i.id === itemId);

    if (item && item.manifest_number) {
      const mNum = String(item.manifest_number);
      // Un-stamp jobs that have this manifest number
      const { data: jobs } = await window.api.getJobs({ date: item.scheduled_date });
      const stampedJobs = jobs.filter(j => String(j.manifest_number) === mNum);
      for (const j of stampedJobs) {
        await window.api.saveJob({ id: j.id, manifest_number: '', waste_site: '' });
      }

      // Delete the associated disposal load
      try {
        const { data: disposals } = await window.api.getDisposalLoads();
        const matchingDisposal = disposals.find(d => String(d.manifest_number) === mNum);
        if (matchingDisposal) {
          await window.api.deleteDisposalLoad(matchingDisposal.id);
        }
      } catch (e) { console.log('Could not delete disposal:', e); }
    }

    // Delete the schedule item
    await window.api.deleteScheduleItem(itemId);
    closeModal();
    showToast('Manifest deleted.', 'success');
    loadSchedule();
  } catch (err) {
    console.error('Delete manifest error:', err);
    // Still try to remove the schedule item as fallback
    await window.api.deleteScheduleItem(itemId);
    closeModal();
    showToast('Manifest removed (with errors).', 'warning');
    loadSchedule();
  }
}

async function saveManifestDraft(itemId) {
  const wasteSiteId = document.getElementById('mfWasteSite').value;
  const { data: wasteSites } = await window.api.getWasteSites();
  const site = wasteSites.find(s => s.id === wasteSiteId);

  const wasteTypes = (document.getElementById('mfWasteTypesHidden')?.value || 'Septage').split(',').filter(Boolean);

  await window.api.saveScheduleItem({
    id: itemId,
    total_gallons: parseInt(document.getElementById('mfGallons').value) || 0,
    waste_type: wasteTypes.join(', '),
    waste_types: wasteTypes,
    waste_site_id: wasteSiteId,
    waste_site_name: site?.name || '',
    manifest_number: document.getElementById('mfNumber').value.trim(),
    driver_id: document.getElementById('mfDriver').value,
    notes: document.getElementById('mfNotes').value.trim(),
  });
  closeModal();
  showToast('Manifest draft saved.', 'success');
  loadSchedule();
}

async function completeManifest(itemId, vehicleId, dateStr) {
  const wasteSiteId = document.getElementById('mfWasteSite').value;
  if (!wasteSiteId) { showToast('Please select a waste site.', 'error'); return; }
  const manifestNumber = document.getElementById('mfNumber').value.trim();
  if (!manifestNumber) { showToast('Please enter a manifest number.', 'error'); return; }

  const totalGallons = parseInt(document.getElementById('mfGallons').value) || 0;
  const wasteTypes = (document.getElementById('mfWasteTypesHidden')?.value || 'Septage').split(',').filter(Boolean);
  const wasteType = wasteTypes.join(', ') || 'Septage';
  const driverId = document.getElementById('mfDriver').value;
  const notes = document.getElementById('mfNotes').value.trim();

  const { data: wasteSites } = await window.api.getWasteSites();
  const site = wasteSites.find(s => s.id === wasteSiteId);
  const { data: vehicles } = await window.api.getVehicles();
  const vehicle = vehicles.find(v => v.id === vehicleId);

  // Enforce truck capacity
  const truckCapacity = vehicle?.capacity_gallons || 0;
  if (truckCapacity > 0 && totalGallons > truckCapacity) {
    showToast(`Cannot complete manifest: ${totalGallons.toLocaleString()} gallons exceeds truck capacity of ${truckCapacity.toLocaleString()} gallons.`, 'error');
    return;
  }

  // Get the item to find its sort_order
  const { data: allItems } = await window.api.getScheduleItems(vehicleId, dateStr);
  const item = allItems.find(i => i.id === itemId);

  // Find the previous manifest card to set a lower bound
  const prevManifests = allItems.filter(i => i.item_type === 'manifest' && i.id !== itemId && (i.sort_order || 0) < (item?.sort_order || 999));
  const prevManifestSort = prevManifests.length > 0 ? Math.max(...prevManifests.map(i => i.sort_order || 0)) : -1;

  // Find completed jobs BETWEEN the previous manifest and this one
  const { data: jobs } = await window.api.getJobs({ date: dateStr });
  const truckJobs = jobs.filter(j => j.vehicle_id === vehicleId).sort((a,b) => (a.scheduled_time || '').localeCompare(b.scheduled_time || ''));
  const jobsAbove = truckJobs.filter(j => {
    const jobSort = j.sort_order != null ? j.sort_order : truckJobs.indexOf(j) * 10;
    return jobSort < (item?.sort_order || 999) && jobSort > prevManifestSort && !j.manifest_number && j.status === 'completed';
  });

  // Build pickup addresses from jobs — use 'customers' (the joined field from get-jobs)
  const pickupAddresses = jobsAbove.map(j => {
    const addr = j.property?.address || j.address || '';
    const city = j.property?.city || j.city || '';
    const state = j.property?.state || j.state || '';
    const custName = j.customers?.name || j.customer_name || '';
    const pumped = j.gallons_pumped || {};
    const jobTanks = j.property?.tanks || [];
    const gal = Object.keys(pumped).length > 0
      ? Object.values(pumped).reduce((s, g) => s + (parseInt(g) || 0), 0)
      : jobTanks.reduce((s, t) => s + (t.volume_gallons || 0), 0);
    const tankTypes = jobTanks.map(t => ({ type: t.tank_type || 'Septic Tank', volume: pumped[t.id] != null ? (parseInt(pumped[t.id]) || 0) : (t.volume_gallons || 0) }));
    return { customer: custName, address: addr, city: city, state: state, gallons: gal, customer_id: j.customer_id || '', tank_types: tankTypes, job_id: j.id };
  });

  // Use first customer as the primary, or combine names
  const primaryCustomerId = jobsAbove.length > 0 ? (jobsAbove[0].customer_id || '') : '';
  const customerNames = [...new Set(pickupAddresses.map(a => a.customer).filter(Boolean))].join(', ');

  // Create disposal load
  await window.api.saveDisposalLoad({
    disposal_date: dateStr,
    customer_id: primaryCustomerId,
    customer_names: customerNames,
    volume_gallons: totalGallons,
    waste_type: wasteType,
    disposal_site: site?.name || '',
    waste_site_id: wasteSiteId,
    waste_site_address: site?.address || '',
    vehicle: vehicle?.name || '',
    vehicle_id: vehicleId,
    waste_hauler_id: vehicle?.waste_hauler_id || '',
    waste_site_license: site?.state_license || '',
    driver: driverId,
    manifest_number: manifestNumber,
    notes: notes,
    job_ids: jobsAbove.map(j => j.id),
    pickup_addresses: pickupAddresses,
  });

  // Stamp jobs above with manifest
  for (const j of jobsAbove) {
    await window.api.saveJob({
      id: j.id,
      waste_site: site?.name || '',
      manifest_number: manifestNumber,
    });
  }

  // Mark schedule item as completed
  await window.api.saveScheduleItem({
    id: itemId,
    status: 'completed',
    total_gallons: totalGallons,
    waste_type: wasteType,
    waste_types: wasteTypes,
    waste_site_id: wasteSiteId,
    waste_site_name: site?.name || '',
    manifest_number: manifestNumber,
    driver_id: driverId,
    notes: notes,
    job_ids: jobsAbove.map(j => j.id),
  });

  closeModal();
  showToast(`Manifest ${manifestNumber} completed. ${jobsAbove.length} job(s) stamped.`, 'success');
  loadSchedule();
}

// Job line items state for creation/editing
let jobLineItems = [];
let jobPropertyTanks = []; // tanks for currently selected property in job modal
let jobTankTypesCache = []; // tank type configs cached for current job modal session

async function openJobModal(job = null, defaultDate = '', defaultVehicle = '') {
  const isEdit = !!job;
  const j = job || {};
  const { data: customers } = await window.api.getCustomers();
  const { data: users } = await window.api.getUsers();
  const { data: vehicles } = await window.api.getVehicles();
  const { data: categories } = await window.api.getServiceCategories();

  const dateVal = j.scheduled_date || defaultDate || formatDate(scheduleDate);
  const vehicleVal = j.vehicle_id || defaultVehicle || '';

  // Initialize module-level state
  jobLineItems = j.line_items && j.line_items.length > 0 ? [...j.line_items] : [];
  jobPropertyTanks = [];
  jobTankTypesCache = [];

  // Build property options + pre-load selected property tanks
  let propertyOptions = '';
  let tankInfo = '';
  let selPropTanks = [];
  if (j.customer_id) {
    const { data: props } = await window.api.getProperties(j.customer_id);
    propertyOptions = props.map(p => `<option value="${p.id}" ${p.id === j.property_id ? 'selected' : ''}>${esc(p.address)}</option>`).join('');
    const selProp = props.find(p => p.id === j.property_id);
    if (selProp && selProp.tanks && selProp.tanks.length > 0) {
      tankInfo = selProp.tanks.map(t => `${esc(t.tank_type || 'Tank')}: ${(t.volume_gallons || 0).toLocaleString()} Gallons`).join(', ');
      selPropTanks = selProp.tanks;
    }
  }

  // Pre-load tank types and compute initial line items from pre-selected property
  if (!isEdit && selPropTanks.length > 0) {
    const { data: tankTypes } = await window.api.getTankTypes();
    jobTankTypesCache = tankTypes || [];
    jobPropertyTanks = selPropTanks;
    recomputePumpingLineItems(selPropTanks);
  }

  // Pre-build tank selector HTML for initial render (avoids async post-render issues)
  const initTankCount = selPropTanks.length;
  const initTankGal = selPropTanks.reduce((s, t) => s + (t.volume_gallons || 0), 0);
  const initTankCheckHtml = selPropTanks.map((t, i) => `
    <label style="display:flex;align-items:baseline;gap:4px;cursor:pointer;padding:2px 0;overflow:hidden;">
      <input type="checkbox" class="tank-check" data-idx="${i}" checked onchange="onTankCheckChange()">
      <span style="font-weight:500;overflow:hidden;text-overflow:ellipsis;">${esc(t.name || t.tank_type || 'Tank')}</span>
      <span style="color:#999;flex-shrink:0;">&nbsp;(${esc(t.tank_type || '')})</span>
      <span style="margin-left:auto;flex-shrink:0;color:#555;">&nbsp;${(t.volume_gallons || 0).toLocaleString()}</span>
    </label>
  `).join('');

  // Fetch pre-set customer directly (reliable; avoids ID type-mismatch with find())
  let presetCust = null;
  if (!isEdit && j.customer_id) {
    const { data } = await window.api.getCustomer(j.customer_id);
    presetCust = data || null;
  }
  const presetCustName = presetCust ? esc(presetCust.name) : '';
  const presetCustAddress = presetCust ? esc(presetCust.primary_address || '') : '';

  // Customer header for edit mode
  const customerHeader = (isEdit && j.customers) ? `
    <div class="job-create-header">
      <h3>${esc(j.customers.name)}</h3>
      <div class="sub">${j.property ? esc(j.property.address || '') + ', ' + esc(j.property.city || '') + ', ' + esc(j.property.state || '') + ' ' + esc(j.property.zip || '') : ''}</div>
      ${tankInfo ? `<div class="sub">${tankInfo}</div>` : ''}
    </div>
  ` : '';

  openModal(isEdit ? 'Edit Job' : 'Create New Job', `
    <input type="hidden" id="jobId" value="${j.id || ''}">
    ${(isEdit && j.customers) ? `
    ${customerHeader}
    <input type="hidden" id="jobCustomer" value="${j.customer_id || ''}">
    <input type="hidden" id="jobProperty" value="${j.property_id || ''}">
    ` : `
    ${presetCust ? `
    <div class="job-create-header" style="margin-bottom:14px;">
      <h3>${presetCustName}</h3>
      <div class="sub">${presetCustAddress}</div>
    </div>
    <input type="hidden" id="jobCustomer" value="${j.customer_id}">
    ` : `
    <div class="form-group" style="position:relative;">
      <label>Customer *</label>
      <div style="display:flex;gap:6px;align-items:center;">
        <div style="flex:1;position:relative;">
          <input type="hidden" id="jobCustomer" value="${j.customer_id || ''}">
          <input type="text" id="jobCustomerSearch" class="form-control" placeholder="Type to search customers..."
            value="${j.customer_id ? esc(customers.find(c => c.id === j.customer_id)?.name || '') : ''}"
            autocomplete="off"
            oninput="filterJobCustomers()"
            onfocus="document.getElementById('jobCustomerDropdown').style.display='block'"
            style="width:100%;">
          <div id="jobCustomerDropdown" class="autocomplete-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;max-height:200px;overflow-y:auto;background:white;border:1px solid #ccc;border-top:none;border-radius:0 0 4px 4px;z-index:100;box-shadow:0 4px 12px rgba(0,0,0,0.15);">
            ${customers.map(c => `<div class="autocomplete-item" data-id="${c.id}" onclick="selectJobCustomer('${c.id}','${esc(c.name).replace(/'/g, "\\'")}')" style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #f0f0f0;">
              <strong>${esc(c.name)}</strong>
              <div style="font-size:11px;color:var(--text-light);">${esc(c.primary_address || '')}</div>
            </div>`).join('')}
          </div>
        </div>
        <button class="btn btn-primary" style="white-space:nowrap;padding:6px 12px;font-size:12px;" onclick="openCustomerModalFromJob()">+ New</button>
      </div>
    </div>
    `}
    <div class="form-row">
      <div class="form-group" style="flex:1;">
        <label>Property</label>
        <select id="jobProperty" onchange="onJobPropertyChange()">
          <option value="">-- Select Property --</option>
          ${propertyOptions}
        </select>
      </div>
    </div>
    <div id="jobTankSelector" style="${initTankCount > 0 ? 'display:block' : 'display:none'};border:1px solid #e0e0e0;border-radius:6px;padding:12px;margin-bottom:12px;background:#fafafa;">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
        <label style="display:flex;align-items:center;gap:5px;font-weight:600;cursor:pointer;margin:0;">
          <input type="checkbox" id="tankSelectAll" onchange="toggleAllTanks(this.checked)" checked> All
        </label>
        <span id="tankCountBadge" class="badge badge-info" style="font-size:12px;padding:3px 8px;">${initTankCount} Tank${initTankCount !== 1 ? 's' : ''}</span>
        <span id="tankGalBadge" class="badge badge-success" style="font-size:12px;padding:3px 8px;">${initTankGal.toLocaleString()} Gallons</span>
      </div>
      <div id="tankCheckGrid" style="display:grid;grid-template-columns:1fr 1fr;gap:3px 20px;font-size:12px;">${initTankCheckHtml}</div>
    </div>
    <div id="jobOverdueWarning" style="display:none;background:#fff3cd;border:1px solid #ffc107;border-left:4px solid #e65100;border-radius:6px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:#663c00;">
    </div>
    `}

    <!-- SERVICE PICKER -->
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header"><h3>What needs to be done?</h3></div>
      <div class="service-picker">
        <div class="service-picker-grid">
          <select id="jobCategoryPick" onchange="onJobCategoryChange()">
            <option value="">Choose a category</option>
            ${categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
          </select>
          <select id="jobProductPick">
            <option value="">Choose a product or service</option>
          </select>
          <button class="btn btn-primary btn-sm" onclick="addJobServiceItem()">ADD</button>
        </div>
        <div class="custom-item-row">
          <input type="text" id="jobCustomItemName" placeholder="Type custom invoice item here">
          <input type="number" id="jobCustomItemPrice" placeholder="Price" min="0" step="0.01">
          <button class="btn btn-primary btn-sm" onclick="addJobCustomItem()">ADD</button>
        </div>
      </div>
      <div id="jobItemsList"></div>
      <div id="jobItemsTotal" class="job-items-total"></div>
    </div>

    <!-- DATE / TIME / TRUCK -->
    <div class="form-row">
      <div class="form-group">
        <label>Date of Service *</label>
        <input type="date" id="jobDate" value="${dateVal}">
      </div>
      <div class="form-group">
        <label>Time</label>
        <input type="time" id="jobTime" value="${j.scheduled_time || ''}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Truck *</label>
        <select id="jobVehicle">
          <option value="">-- Select --</option>
          ${vehicles.map(v => `<option value="${v.id}" ${v.id === vehicleVal ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Driver/Tech</label>
        <select id="jobAssigned">
          <option value="">-- Unassigned --</option>
          ${users.map(u => `<option value="${u.id}" ${u.id === j.assigned_to ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}
        </select>
      </div>
    </div>
    <!-- HELPERS -->
    <div class="form-group">
      <label>Helper Techs</label>
      <div id="jobHelpers" style="display:flex;flex-wrap:wrap;gap:6px;">
        ${users.map(u => {
          const isHelper = (j.helpers || []).includes(u.id);
          return `<label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;">
            <input type="checkbox" class="helper-check" value="${u.id}" ${isHelper ? 'checked' : ''}>
            <span style="width:10px;height:10px;border-radius:50%;background:${u.color || '#1565c0'};display:inline-block;"></span>
            ${esc(u.name)}
          </label>`;
        }).join('')}
      </div>
    </div>

    ${isEdit ? `
    <div class="form-row">
      <div class="form-group">
        <label>Status</label>
        <select id="jobStatus">
          <option value="scheduled" ${j.status === 'scheduled' ? 'selected' : ''}>Scheduled</option>
          <option value="in_progress" ${j.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
          <option value="completed" ${j.status === 'completed' ? 'selected' : ''}>Completed</option>
          <option value="cancelled" ${j.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
        </select>
      </div>
      <div class="form-group">
        <label>Confirmation</label>
        <select id="jobConfirmation">
          <option value="unconfirmed" ${(j.confirmation_status || 'unconfirmed') === 'unconfirmed' ? 'selected' : ''}>Unconfirmed</option>
          <option value="confirmed" ${j.confirmation_status === 'confirmed' ? 'selected' : ''}>Confirmed</option>
          <option value="auto_confirmed" ${j.confirmation_status === 'auto_confirmed' ? 'selected' : ''}>Auto-Confirmed</option>
          <option value="no_reply" ${j.confirmation_status === 'no_reply' ? 'selected' : ''}>No Reply</option>
          <option value="left_message" ${j.confirmation_status === 'left_message' ? 'selected' : ''}>Left Message</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Time In</label>
        <input type="time" id="jobTimeIn" value="${j.time_in || ''}">
      </div>
      <div class="form-group">
        <label>Time Out</label>
        <input type="time" id="jobTimeOut" value="${j.time_out || ''}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Waste Site</label>
        <input type="text" id="jobWasteSite" value="${esc(j.waste_site || '')}" placeholder="Disposal facility">
      </div>
      <div class="form-group">
        <label>Manifest #</label>
        <input type="text" id="jobManifest" value="${esc(j.manifest_number || '')}" placeholder="Manifest number">
      </div>
    </div>
    ` : `
    <input type="hidden" id="jobTimeIn" value="">
    <input type="hidden" id="jobTimeOut" value="">
    <input type="hidden" id="jobWasteSite" value="">
    <input type="hidden" id="jobManifest" value="">
    `}
    <!-- NOTES -->
    <div class="form-group">
      <label>Job Notes (for internal use)</label>
      <textarea id="jobNotes" placeholder="Add job notes here...">${esc(j.notes || '')}</textarea>
    </div>
    <div class="form-group">
      <label>Technician Notes (for customers)</label>
      <textarea id="jobTechNotes" placeholder="Notes visible to customer...">${esc(j.tech_notes || '')}</textarea>
    </div>
  `, `
    ${isEdit ? '<button class="btn btn-danger" onclick="deleteJob()">Delete</button>' : ''}
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveJob()">Save</button>
  `);

  // Store categories data for the product picker
  window._jobCategories = categories;

  // Auto-select tech when vehicle is chosen
  document.getElementById('jobVehicle').addEventListener('change', function() {
    const vid = this.value;
    const veh = vehicles.find(v => v.id === vid);
    if (veh && veh.default_tech_id) {
      document.getElementById('jobAssigned').value = veh.default_tech_id;
    }
  });

  // Render existing line items
  renderJobLineItems();

}

function onJobCategoryChange() {
  const catId = document.getElementById('jobCategoryPick').value;
  const prodSelect = document.getElementById('jobProductPick');
  prodSelect.innerHTML = '<option value="">Choose a product or service</option>';
  if (catId && window._jobCategories) {
    const cat = window._jobCategories.find(c => c.id === catId);
    if (cat) {
      cat.products.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.name} - $${(p.price || 0).toFixed(2)}`;
        opt.dataset.name = p.name;
        opt.dataset.price = p.price || 0;
        opt.dataset.code = p.job_code || '';
        prodSelect.appendChild(opt);
      });
    }
  }
}

function addJobServiceItem() {
  const prodSelect = document.getElementById('jobProductPick');
  const selected = prodSelect.options[prodSelect.selectedIndex];
  if (!selected || !selected.value) { showToast('Select a product or service first.', 'error'); return; }

  jobLineItems.push({
    description: selected.dataset.name,
    qty: 1,
    unit_price: parseFloat(selected.dataset.price) || 0,
    job_code: selected.dataset.code || '',
  });
  renderJobLineItems();
  prodSelect.value = '';
}

function addJobCustomItem() {
  const name = document.getElementById('jobCustomItemName').value.trim();
  const price = parseFloat(document.getElementById('jobCustomItemPrice').value) || 0;
  if (!name) { showToast('Enter a description for the custom item.', 'error'); return; }
  jobLineItems.push({ description: name, qty: 1, unit_price: price, job_code: '' });
  renderJobLineItems();
  document.getElementById('jobCustomItemName').value = '';
  document.getElementById('jobCustomItemPrice').value = '';
}

function removeJobLineItem(idx) {
  jobLineItems.splice(idx, 1);
  renderJobLineItems();
}

function updateJobLineItemQty(idx, qty) {
  jobLineItems[idx].qty = parseFloat(qty) || 1;
  renderJobLineItems();
}

function updateJobLineItemPrice(idx, price) {
  jobLineItems[idx].unit_price = parseFloat(price) || 0;
  renderJobLineItems();
}

function renderJobLineItems() {
  const container = document.getElementById('jobItemsList');
  const totalEl = document.getElementById('jobItemsTotal');
  if (!container) return;

  if (jobLineItems.length === 0) {
    container.innerHTML = '';
    totalEl.innerHTML = 'Total: $0.00';
    return;
  }

  let total = 0;
  container.innerHTML = `
    <table class="job-items-table">
      <thead><tr><th>Description</th><th style="width:60px;">Qty</th><th style="width:90px;text-align:right;">Price</th><th style="width:90px;text-align:right;">Total</th><th style="width:30px;"></th></tr></thead>
      <tbody>
        ${jobLineItems.map((li, idx) => {
          const lineTotal = (li.qty || 1) * (li.unit_price || 0);
          total += lineTotal;
          return `
            <tr>
              <td>${esc(li.description)}</td>
              <td><input type="number" value="${li.qty || 1}" min="0.01" step="0.01" style="width:50px;padding:2px 4px;border:1px solid var(--border);border-radius:3px;text-align:center;" onchange="updateJobLineItemQty(${idx}, this.value)"></td>
              <td style="text-align:right;"><input type="number" value="${(li.unit_price || 0).toFixed(2)}" min="0" step="0.01" style="width:80px;padding:2px 4px;border:1px solid var(--border);border-radius:3px;text-align:right;" onchange="updateJobLineItemPrice(${idx}, this.value)"></td>
              <td style="text-align:right;">$${lineTotal.toFixed(2)}</td>
              <td><button class="btn btn-sm btn-danger" onclick="removeJobLineItem(${idx})" style="padding:2px 6px;">&#10005;</button></td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
  totalEl.innerHTML = `Total: $${total.toFixed(2)}`;
}

function filterJobCustomers() {
  const query = (document.getElementById('jobCustomerSearch')?.value || '').toLowerCase();
  const dropdown = document.getElementById('jobCustomerDropdown');
  if (!dropdown) return;
  dropdown.style.display = 'block';
  const items = dropdown.querySelectorAll('.autocomplete-item');
  let visibleCount = 0;
  items.forEach(item => {
    const text = item.textContent.toLowerCase();
    const show = !query || text.includes(query);
    item.style.display = show ? '' : 'none';
    if (show) visibleCount++;
  });
  // Clear hidden id if user is typing a new search
  document.getElementById('jobCustomer').value = '';
}

function selectJobCustomer(id, name) {
  document.getElementById('jobCustomer').value = id;
  document.getElementById('jobCustomerSearch').value = name;
  document.getElementById('jobCustomerDropdown').style.display = 'none';
  onJobCustomerChange();
}

function openCustomerModalFromJob() {
  // Close job modal, open customer modal, then re-open job modal after save
  closeModal();
  openCustomerModal();
}

// Close customer dropdown when clicking outside
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('jobCustomerDropdown');
  const search = document.getElementById('jobCustomerSearch');
  if (dropdown && search && !search.contains(e.target) && !dropdown.contains(e.target)) {
    dropdown.style.display = 'none';
  }
});

// Safety: clear stale drag state when focusing any input/textarea
document.addEventListener('focusin', (e) => {
  if (e.target.matches('input, textarea, select')) {
    if (_pDrag) _pDragCleanup();
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  }
});

async function onJobCustomerChange() {
  const customerId = document.getElementById('jobCustomer').value;
  const propSelect = document.getElementById('jobProperty');
  const tankInfoEl = document.getElementById('jobTankInfo');
  const warningEl = document.getElementById('jobOverdueWarning');
  propSelect.innerHTML = '<option value="">-- Select Property --</option>';
  if (tankInfoEl) tankInfoEl.textContent = '';
  if (warningEl) { warningEl.style.display = 'none'; warningEl.innerHTML = ''; }
  if (customerId) {
    const { data: props } = await window.api.getProperties(customerId);
    props.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.address;
      propSelect.appendChild(opt);
    });
    if (props.length === 1) {
      propSelect.value = props[0].id;
      onJobPropertyChange();
    }
    // Check for overdue balance (>30 days unpaid)
    try {
      const bal = await window.api.getCustomerBalance(customerId);
      if (bal && bal.overdue && bal.balance > 0) {
        if (warningEl) {
          warningEl.innerHTML = `<strong>⚠ Outstanding Balance:</strong> This customer has <strong>$${bal.balance.toFixed(2)}</strong> unpaid for over 30 days.`;
          warningEl.style.display = 'block';
        }
      }
    } catch (e) { /* ignore */ }
  }
}

function toggleAllTanks(checked) {
  document.querySelectorAll('.tank-check').forEach(cb => { cb.checked = checked; });
  onTankCheckChange();
}

function onTankCheckChange() {
  const checks = document.querySelectorAll('.tank-check');
  const allCheckEl = document.getElementById('tankSelectAll');
  const countBadge = document.getElementById('tankCountBadge');
  const galBadge = document.getElementById('tankGalBadge');

  let selectedCount = 0;
  let totalGallons = 0;
  const selectedTanks = [];

  checks.forEach(cb => {
    const idx = parseInt(cb.dataset.idx, 10);
    const t = jobPropertyTanks[idx];
    if (cb.checked && t) {
      selectedCount++;
      totalGallons += t.volume_gallons || 0;
      selectedTanks.push(t);
    }
  });

  if (allCheckEl) allCheckEl.checked = selectedCount === checks.length && checks.length > 0;
  if (countBadge) countBadge.textContent = `${selectedCount} Tank${selectedCount !== 1 ? 's' : ''}`;
  if (galBadge) galBadge.textContent = `${totalGallons.toLocaleString()} Gallons`;

  recomputePumpingLineItems(selectedTanks);
}

function recomputePumpingLineItems(selectedTanks) {
  const ttMap = {};
  (jobTankTypesCache || []).forEach(tt => { ttMap[tt.name] = tt; });

  const manualItems = jobLineItems.filter(li => !li._auto);

  if (!selectedTanks || selectedTanks.length === 0) {
    jobLineItems = manualItems;
    renderJobLineItems();
    return;
  }

  // Consolidated pumping: total qty across all selected tanks
  let totalPumpQty = 0;
  let pumpPrice = 250;
  // Disposal: group by label, accumulate qty
  const dispGroups = {};

  selectedTanks.forEach(t => {
    const tt = ttMap[t.tank_type] || {};
    const tankQty = Math.max(1, Math.round(((t.volume_gallons || 0) / 1000) * 100) / 100);
    totalPumpQty += tankQty;
    if (tt.pumping_price) pumpPrice = tt.pumping_price;

    if (tt.generates_disposal !== false && tt.disposal_label) {
      const label = tt.disposal_label;
      if (!dispGroups[label]) {
        dispGroups[label] = { qty: 0, price: tt.disposal_price ?? 140 };
      }
      dispGroups[label].qty += tankQty;
    }
  });

  const autoItems = [
    { description: 'Pumping', qty: Math.round(totalPumpQty * 100) / 100, unit_price: pumpPrice, _auto: true },
    ...Object.entries(dispGroups).map(([label, { qty, price }]) => ({
      description: label, qty: Math.round(qty * 100) / 100, unit_price: price, _auto: true,
    })),
  ];

  jobLineItems = [...autoItems, ...manualItems];
  renderJobLineItems();
}

async function onJobPropertyChange() {
  const propId = document.getElementById('jobProperty')?.value;
  const selectorEl = document.getElementById('jobTankSelector');
  const gridEl = document.getElementById('tankCheckGrid');

  // No tank selector in DOM means edit mode — nothing to do
  if (!selectorEl) return;

  if (!propId) {
    selectorEl.style.display = 'none';
    jobPropertyTanks = [];
    jobLineItems = jobLineItems.filter(li => !li._auto);
    renderJobLineItems();
    return;
  }

  // Load tank types once per modal session
  if (jobTankTypesCache.length === 0) {
    const { data: tankTypes } = await window.api.getTankTypes();
    jobTankTypesCache = tankTypes || [];
  }

  const { data: prop } = await window.api.getProperty(propId);
  jobPropertyTanks = prop?.tanks || [];

  if (jobPropertyTanks.length === 0) {
    selectorEl.style.display = 'none';
    jobLineItems = jobLineItems.filter(li => !li._auto);
    renderJobLineItems();
    return;
  }

  // Build tank checkbox grid
  if (gridEl) {
    gridEl.innerHTML = jobPropertyTanks.map((t, i) => `
      <label style="display:flex;align-items:baseline;gap:4px;cursor:pointer;padding:2px 0;white-space:nowrap;overflow:hidden;">
        <input type="checkbox" class="tank-check" data-idx="${i}" checked onchange="onTankCheckChange()">
        <span style="font-weight:500;overflow:hidden;text-overflow:ellipsis;">${esc(t.name || t.tank_type || 'Tank')}</span>
        <span style="color:#999;flex-shrink:0;">&nbsp;(${esc(t.tank_type || '')})</span>
        <span style="margin-left:auto;flex-shrink:0;color:#555;">&nbsp;${(t.volume_gallons || 0).toLocaleString()}</span>
      </label>
    `).join('');
  }

  selectorEl.style.display = 'block';
  onTankCheckChange();
}

async function saveJob() {
  // Calculate total from line items
  const total = jobLineItems.reduce((sum, li) => sum + ((li.qty || 1) * (li.unit_price || 0)), 0);

  // Derive job_type from first line item or "Service"
  const jobType = jobLineItems.length > 0 ? jobLineItems[0].description : 'Service';

  const data = {
    customer_id: document.getElementById('jobCustomer').value,
    property_id: document.getElementById('jobProperty').value || null,
    job_type: jobType,
    vehicle_id: document.getElementById('jobVehicle').value,
    assigned_to: document.getElementById('jobAssigned').value || null,
    scheduled_date: document.getElementById('jobDate').value,
    scheduled_time: document.getElementById('jobTime').value || null,
    time_in: document.getElementById('jobTimeIn')?.value || null,
    time_out: document.getElementById('jobTimeOut')?.value || null,
    waste_site: document.getElementById('jobWasteSite')?.value?.trim() || '',
    manifest_number: document.getElementById('jobManifest')?.value?.trim() || '',
    notes: document.getElementById('jobNotes').value.trim(),
    tech_notes: document.getElementById('jobTechNotes').value.trim(),
    line_items: jobLineItems.map(li => { const item = Object.assign({}, li); delete item._auto; return item; }),
    total: total,
    helpers: Array.from(document.querySelectorAll('.helper-check:checked')).map(cb => cb.value),
  };

  const id = document.getElementById('jobId').value;
  if (id) {
    data.id = id;
    const statusEl = document.getElementById('jobStatus');
    const confEl = document.getElementById('jobConfirmation');
    data.status = statusEl ? statusEl.value : 'scheduled';
    data.confirmation_status = confEl ? confEl.value : 'unconfirmed';
  } else {
    data.status = 'scheduled';
    data.confirmation_status = 'unconfirmed';
  }

  if (!data.customer_id || !data.scheduled_date || !data.vehicle_id) {
    showToast('Customer, vehicle, and date are required.', 'error');
    return;
  }

  if (jobLineItems.length === 0) {
    showToast('Add at least one service item.', 'error');
    return;
  }

  // Preserve existing fields that aren't in the modal
  if (id) {
    const { data: existing } = await window.api.getJob(id);
    if (existing) {
      if (existing.gallons_pumped) data.gallons_pumped = existing.gallons_pumped;
      if (existing.payment_status) data.payment_status = existing.payment_status;
    }
  }

  // Check truck capacity
  try {
    const { data: vehicles } = await window.api.getVehicles();
    const vehicle = vehicles.find(v => v.id === data.vehicle_id);
    if (vehicle && vehicle.capacity_gallons) {
      const { data: dayJobs } = await window.api.getJobs({ date: data.scheduled_date });
      const otherJobs = dayJobs.filter(j => j.vehicle_id === data.vehicle_id && j.id !== id && !j.manifest_number);
      let existingGallons = 0;
      otherJobs.forEach(j => {
        const pumped = j.gallons_pumped || {};
        const jobTanks = j.property?.tanks || [];
        existingGallons += Object.keys(pumped).length > 0
          ? Object.values(pumped).reduce((s, g) => s + (parseInt(g) || 0), 0)
          : jobTanks.reduce((s, t) => s + (t.volume_gallons || 0), 0);
      });
      // Estimate this job's gallons from its property tanks
      const propId = data.property_id;
      if (propId) {
        const { data: prop } = await window.api.getProperty(propId);
        if (prop) {
          const { data: tanks } = await window.api.getTanks(propId);
          const thisJobGal = (tanks || []).reduce((s, t) => s + (t.volume_gallons || 0), 0);
          const totalAfter = existingGallons + thisJobGal;
          if (totalAfter > vehicle.capacity_gallons) {
            const over = totalAfter - vehicle.capacity_gallons;
            if (!confirm(`This will exceed ${vehicle.name}'s capacity by ${over.toLocaleString()} gallons (${totalAfter.toLocaleString()} / ${vehicle.capacity_gallons.toLocaleString()} gal).\n\nSchedule anyway?`)) {
              return;
            }
          }
        }
      }
    }
  } catch (e) { /* capacity check is best-effort */ }

  const result = await window.api.saveJob(data);
  if (result.success) {
    closeModal();
    showToast(id ? 'Job updated.' : 'Job scheduled.', 'success');
    loadSchedule();
  } else {
    showToast(result.error || 'Failed to save.', 'error');
  }
}

async function deleteJob() {
  const id = document.getElementById('jobId').value;
  if (!id || !confirm('Delete this job?')) return;
  const result = await window.api.deleteJob(id);
  if (result.success) {
    closeModal();
    showToast('Job deleted.', 'success');
    loadSchedule();
  }
}

async function toggleJobComplete(jobId, markDone) {
  if (markDone) {
    await window.api.saveJob({
      id: jobId,
      status: 'completed',
      completed_at: new Date().toISOString(),
    });
    showToast('Job marked complete.', 'success');
  } else {
    await window.api.saveJob({
      id: jobId,
      status: 'scheduled',
      completed_at: '',
    });
    showToast('Job marked incomplete.', 'info');
  }
}

async function toggleAndReopen(jobId, markDone) {
  await toggleJobComplete(jobId, markDone);
  await openJobDetail(jobId);
  refreshRevenue();
}

let _jobDetailOrigin = null; // Track where we came from to open job detail

async function openJobDetail(id) {
  // Push current location for back button (skip if going back)
  if (!_navGoingBack) {
    if (currentPage === 'customers' && currentCustomerId) {
      const propId = currentPropertyId ? `,'${currentPropertyId}'` : '';
      navPush('Back to Customer', `openCustomerDetail('${currentCustomerId}'${propId})`);
      _jobDetailOrigin = 'customers';
    } else if (currentPage === 'invoices' || _jobDetailOrigin === 'invoices') {
      navPush('Back to Invoices', `navigateTo('invoices')`);
      _jobDetailOrigin = 'invoices';
    } else {
      navPush('Back to Schedule', 'loadSchedule()');
      _jobDetailOrigin = 'schedule';
    }
  }

  const { data: job } = await window.api.getJob(id);
  if (!job) return;

  const { data: vehicles } = await window.api.getVehicles();
  const { data: users } = await window.api.getUsers();
  const { data: serviceCategories } = await window.api.getServiceCategories();

  const customer = job.customers;
  const property = job.property;
  const tanks = property?.tanks || [];
  const vehicle = job.vehicle;
  const tech = job.users;
  const jobAcctInfo = job.customer_id ? await window.api.getCustomerBalance(job.customer_id) : { balance: 0, overdue: false };
  // Fetch SDNs linked to this job
  const { data: allJobSdns } = await window.api.getServiceDueNotices({ customerId: job.customer_id });
  const jobSdn = allJobSdns.find(n => n.job_id === id) || null;

  const totalCapacity = tanks.reduce((sum, t) => sum + (t.volume_gallons || 0), 0);
  const gallonsPumped = job.gallons_pumped || {};
  const totalPumped = Object.values(gallonsPumped).reduce((sum, g) => sum + (parseInt(g) || 0), 0);
  const lineItems = job.line_items || [];
  const lineTotal = lineItems.reduce((s, li) => s + ((li.qty || 0) * (li.unit_price || 0)), 0);
  const amountPaid = (job.payments || []).reduce((s, p) => s + (p.amount || 0), 0);

  currentPage = 'schedule';
  document.querySelectorAll('.page').forEach(p => { p.classList.remove('active'); p.style.display = ''; });
  document.getElementById('page-schedule').classList.add('active');
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.page === 'schedule'));

  document.getElementById('pageTitle').textContent = 'Job Detail';
  document.getElementById('pageActions').innerHTML = `
    ${navBackButton() || `<button class="btn btn-secondary" onclick="loadSchedule()">&#8592; Back to Schedule</button>`}
  `;

  const page = document.getElementById('page-schedule');
  page.innerHTML = `
    <div class="job-detail-layout">
      <!-- LEFT SIDEBAR -->
      <div class="job-detail-sidebar">
        <div class="card">
          <div class="card-header" style="color:#1565c0;cursor:pointer;" onclick="${property ? `navPush('Job Detail', "openJobDetail('${id}')");openPropertyDetail('${property.id}')` : ''}"><h3>PROPERTY INFO</h3></div>
          ${property ? `
            <div style="font-weight:700;cursor:pointer;color:#1565c0;" onclick="navPush('Job Detail', &quot;openJobDetail('${id}')&quot;);openPropertyDetail('${property.id}')">${esc(property.address || '')}</div>
            <div>${esc(property.city || '')}${property.state ? ', ' + esc(property.state) : ''} ${esc(property.zip || '')}</div>
          ` : '<div style="color:var(--text-light);">No property selected</div>'}

          <div style="margin-top:10px;padding-top:8px;border-top:1px solid #eee;">
            <div><strong>Tank Capacity:</strong> ${totalCapacity > 0 ? totalCapacity.toLocaleString() : 'N/A'}</div>
          </div>

          ${property?.directions ? `
            <div style="margin-top:10px;padding-top:8px;border-top:1px solid #eee;">
              <div style="font-size:12px;color:var(--text-light);">Directions:</div>
              <div style="font-size:12px;font-style:italic;">${esc(property.directions)}</div>
            </div>
          ` : ''}

          <div style="margin-top:10px;padding-top:8px;border-top:1px solid #eee;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <div style="font-size:12px;color:var(--text-light);">BILL TO</div>
              ${job.customer_id ? `
              <div class="acct-icon ${jobAcctInfo.overdue ? 'overdue' : ''}" onclick="navPush('Job Detail', &quot;openJobDetail('${id}')&quot;);openCustomerAccounting('${job.customer_id}')" title="Accounting" style="padding:2px 8px;font-size:12px;">
                <span style="font-size:14px;font-weight:800;">$</span>
                ${jobAcctInfo.overdue ? '<span class="acct-overdue-badge" style="width:14px;height:14px;font-size:10px;top:-4px;right:-4px;">!</span>' : ''}
                ${jobAcctInfo.overdue ? `<span class="acct-balance-negative" style="font-size:11px;font-weight:700;">$${Math.abs(jobAcctInfo.balance).toFixed(2)}</span>` : ''}
              </div>` : ''}
            </div>
            <div style="font-weight:700;cursor:pointer;color:#1565c0;" onclick="navPush('Job Detail', &quot;openJobDetail('${id}')&quot;);openCustomerDetail('${job.customer_id}')">${esc(customer?.name || 'N/A')}</div>
            ${property ? `<div style="font-size:13px;">${esc(property.address || '')}<br>${esc(property.city || '')}${property.state ? ', ' + esc(property.state) : ''} ${esc(property.zip || '')}</div>` : ''}
            ${customer?.phone ? `<div style="font-size:13px;">${esc(customer.phone)}</div>` : ''}
            ${customer?.email ? `<div style="font-size:13px;">${esc(customer.email)}</div>` : ''}
          </div>

          <div style="margin-top:10px;padding-top:8px;border-top:1px solid #eee;display:flex;justify-content:space-between;">
            ${job.invoice_number ? `<div><strong>Invoice #</strong> ${esc(job.invoice_number)}</div>` : ''}
          </div>

          ${job.manifest_number ? `<div style="margin-top:4px;"><strong>Manifest #</strong> <span style="color:#1565c0;font-weight:700;">${esc(job.manifest_number)}</span></div>` : ''}

          <div style="margin-top:10px;padding-top:8px;border-top:1px solid #eee;">
            <strong>PAYMENT STATUS</strong>
            <span class="badge badge-${job.payment_status === 'paid' ? 'paid' : 'pending'}" style="margin-left:8px;">${formatStatus(job.payment_status || 'unpaid')}</span>
            ${(job.payments && job.payments.length > 0) ? `
              <div style="margin-top:8px;">
                ${job.payments.map((p, i) => `
                  <div style="font-size:12px;border:1px solid #eee;padding:4px 8px;border-radius:4px;margin-top:4px;">
                    <strong>Payment ${i + 1}</strong><br>
                    Date: ${esc(p.date || '')}<br>
                    Amount: $${(p.amount || 0).toFixed(2)}<br>
                    Method: ${esc(p.method || '')}
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>

          ${property?.notes ? `
            <div style="margin-top:10px;padding-top:8px;border-top:1px solid #eee;">
              <div style="font-size:12px;font-weight:600;">Property Notes</div>
              <div style="font-size:12px;color:var(--text-light);margin-top:4px;white-space:pre-wrap;">${esc(property.notes)}</div>
            </div>
          ` : ''}
        </div>
      </div>

      <!-- CENTER CONTENT -->
      <div class="job-detail-main">
        <!-- Header row: Date, Time, Confirmation, Truck, Driver -->
        <div class="card">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;align-items:start;">
            <div>
              <div class="detail-label" style="color:#1565c0;cursor:pointer;text-decoration:underline;display:inline-block;" onclick="scheduleDate = new Date('${job.scheduled_date || new Date().toISOString().split('T')[0]}T12:00:00'); setScheduleView('day'); navigateTo('schedule');" title="Go to this day's schedule">Date of Service &#8599;</div>
              <input type="date" value="${job.scheduled_date || ''}" class="form-control" style="font-size:14px;font-weight:600;" onchange="updateJobField('${job.id}', 'scheduled_date', this.value)">
            </div>
            <div>
              <div class="detail-label">Time (optional)</div>
              <input type="time" value="${job.scheduled_time || ''}" class="form-control" style="font-size:14px;" onchange="updateJobField('${job.id}', 'scheduled_time', this.value)">
            </div>
            <div>
              <div class="detail-label">Confirmation Status</div>
              <select class="form-control" onchange="updateJobField('${job.id}', 'confirmation_status', this.value)">
                ${['unconfirmed','confirmed','auto_confirmed','no_reply','left_message'].map(s => `<option value="${s}" ${job.confirmation_status === s ? 'selected' : ''}>${formatStatus(s)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:12px;align-items:start;">
            <div>
              <div class="detail-label">Truck</div>
              <select class="form-control" onchange="updateJobField('${job.id}', 'vehicle_id', this.value); setTimeout(() => openJobDetail('${job.id}'), 300);">
                ${vehicles.map(v => `<option value="${v.id}" ${v.id === job.vehicle_id ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}
              </select>
            </div>
            <div>
              <div class="detail-label">Driver</div>
              <select class="form-control" onchange="updateJobField('${job.id}', 'assigned_to', this.value)">
                <option value="">Unassigned</option>
                ${users.map(u => `<option value="${u.id}" ${u.id === job.assigned_to ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}
              </select>
            </div>
            <div>
              <div class="detail-label">Technicians</div>
              <select class="form-control" onchange="addTechnicianToJob('${job.id}', this.value); this.value='';">
                <option value="">+ Add Technician</option>
                ${users.filter(u => !(job.helpers || []).includes(u.id)).map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}
              </select>
              ${(job.helpers || []).length > 0 ? `
                <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px;">
                  ${(job.helpers || []).map(hId => {
                    const h = users.find(u => u.id === hId);
                    return h ? `<span style="display:inline-flex;align-items:center;gap:3px;background:#f0f0f0;padding:2px 8px;border-radius:12px;font-size:12px;">
                      <span style="width:8px;height:8px;border-radius:50%;background:${h.color || '#1565c0'};display:inline-block;"></span>
                      ${esc(h.name)}
                      <span style="cursor:pointer;color:red;font-weight:bold;margin-left:4px;" onclick="toggleJobHelper('${job.id}', '${hId}', false); setTimeout(() => openJobDetail('${job.id}'), 300);">&times;</span>
                    </span>` : '';
                  }).join('')}
                </div>
              ` : ''}
            </div>
          </div>
        </div>

        <!-- Line Items / Pricing -->
        <div class="card">
          <div class="card-header"><h3>Line Items</h3></div>
          <table class="job-line-items" style="width:100%;">
            <thead><tr><th style="text-align:left;">Description</th><th style="width:80px;text-align:right;">Qty</th><th style="width:100px;text-align:right;">Unit Price</th><th style="width:100px;text-align:right;">Total</th><th style="width:30px;"></th></tr></thead>
            <tbody>
              ${lineItems.map((li, i) => `
                <tr>
                  <td style="font-weight:600;">${esc(li.description)}</td>
                  <td style="text-align:right;">
                    <input type="number" value="${li.qty || 1}" min="0" step="0.01" class="form-control" style="width:70px;text-align:right;padding:2px 4px;font-size:13px;display:inline;"
                      onchange="updateLineItem('${job.id}', ${i}, 'qty', parseFloat(this.value))">
                  </td>
                  <td style="text-align:right;">
                    <input type="number" value="${(li.unit_price || 0).toFixed(2)}" min="0" step="0.01" class="form-control" style="width:90px;text-align:right;padding:2px 4px;font-size:13px;display:inline;"
                      onchange="updateLineItem('${job.id}', ${i}, 'unit_price', parseFloat(this.value))">
                  </td>
                  <td style="text-align:right;font-weight:600;">$${((li.qty || 0) * (li.unit_price || 0)).toFixed(2)}</td>
                  <td><button class="btn btn-sm" style="color:red;background:none;border:none;cursor:pointer;font-size:16px;" onclick="removeLineItem('${job.id}', ${i})">&times;</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <!-- Service product dropdowns -->
          <div style="display:flex;gap:8px;align-items:center;margin-top:12px;padding:10px;background:#f5f5f5;border-radius:6px;flex-wrap:wrap;">
            <select id="serviceCategory" class="form-control" style="min-width:200px;" onchange="loadServiceProductsDropdown(this.value)">
              <option value="">-Choose a product category-</option>
              ${serviceCategories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
            </select>
            <select id="serviceProduct" class="form-control" style="min-width:200px;" onchange="onServiceProductSelected('${job.id}')">
              <option value="">-Choose a product or service-</option>
            </select>
          </div>
          <!-- Custom line item -->
          <div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap;">
            <input type="text" id="newLineDesc" placeholder="Type custom line item here" class="form-control" style="flex:1;min-width:200px;">
            <span>$</span>
            <input type="number" id="newLinePrice" placeholder="Price" class="form-control" style="width:80px;" step="0.01" min="0">
            <button class="btn btn-sm btn-success" onclick="addLineItem('${job.id}')">ADD</button>
          </div>
          <div style="margin-top:12px;border-top:1px solid #eee;padding-top:8px;">
            <div style="display:flex;justify-content:space-between;font-size:15px;"><span>Total</span><strong>$${lineTotal.toFixed(2)}</strong></div>
            <div style="display:flex;justify-content:space-between;font-size:14px;color:var(--text-light);"><span>Less Amount Paid</span><span>- $${amountPaid.toFixed(2)}</span></div>
            <div style="display:flex;justify-content:space-between;font-size:16px;font-weight:700;margin-top:4px;border-top:1px solid #eee;padding-top:4px;"><span>Balance Due</span><span>$${(lineTotal - amountPaid).toFixed(2)}</span></div>
          </div>
        </div>

        <!-- Tanks & Gallons Pumped -->
        <div class="card">
          <div class="card-header"><h3>Tanks & Gallons Pumped</h3></div>
          ${tanks.length > 0 ? `
            <div style="margin-bottom:8px;font-size:13px;display:flex;gap:12px;align-items:center;">
              <span>&#9745; All</span>
              <span>${tanks.length} Tank${tanks.length > 1 ? 's' : ''}</span>
              <span>${totalCapacity.toLocaleString()} Gallons</span>
              <span><strong>Job Volume:</strong> ${totalPumped > 0 ? totalPumped.toLocaleString() : totalCapacity.toLocaleString()}</span>
            </div>
            ${tanks.map(t => `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-top:1px solid #f0f0f0;">
                <div style="display:flex;align-items:center;gap:8px;">
                  <input type="checkbox" checked disabled>
                  <span style="font-weight:600;">(${esc(t.tank_type || 'Tank')}${(t.filter === 'yes' || t.filter === true) ? '+Filter' : ''}) ${(t.volume_gallons || 0).toLocaleString()}</span>
                  ${(t.filter === 'yes' || t.filter === true || (t.tank_type || '').includes('Filter')) ? '<span class="badge badge-info" style="margin-left:6px;font-size:11px;">Filter</span>' : ''}
                </div>
                <div style="display:flex;align-items:center;gap:8px;">
                  <span style="font-size:12px;color:var(--text-light);">Gallons Pumped</span>
                  <input type="number" value="${gallonsPumped[t.id] || ''}" min="0"
                    class="form-control" style="width:100px;text-align:right;padding:4px 8px;"
                    onchange="updateJobGallons('${job.id}', '${t.id}', this.value)">
                </div>
              </div>
            `).join('')}
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-top:2px solid #333;font-weight:700;font-size:15px;">
              <span>Total Volume Pumped</span>
              <span>${totalPumped.toLocaleString()}</span>
            </div>
          ` : '<div style="color:var(--text-light);">No tanks on this property.</div>'}
          <div style="margin-top:12px;padding-top:10px;border-top:2px solid #eee;display:flex;justify-content:flex-end;align-items:center;gap:10px;">
              <strong>JOB STATUS</strong>
              <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
                <input type="checkbox" style="width:18px;height:18px;" ${job.status === 'completed' ? 'checked' : ''} onchange="toggleAndReopen('${job.id}', this.checked)">
                Job Completed
              </label>
              ${job.completed_at ? `<span style="font-size:11px;color:var(--text-light);margin-left:6px;">Completed: ${new Date(job.completed_at).toLocaleString()}</span>` : ''}
          </div>
        </div>

        <!-- Disposal Info -->
        <div class="card">
          <div class="card-header"><h3>Disposal</h3></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div>
              <div class="detail-label">Waste Site</div>
              <div style="font-size:14px;font-weight:600;">${esc(job.waste_site || 'Not set')}</div>
            </div>
            <div>
              <div class="detail-label">Manifest #</div>
              <div style="font-size:14px;font-weight:600;">${esc(job.manifest_number || 'N/A')}</div>
            </div>
            <div>
              <div class="detail-label">Disposal Date</div>
              <div style="font-size:14px;">${esc(job.disposal_date || job.scheduled_date || '')}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- RIGHT SIDEBAR - Notes -->
      <div class="job-detail-right">
        <div class="card">
          <div class="card-header"><h3>Job Notes</h3></div>
          <div style="font-size:12px;color:var(--text-light);margin-bottom:4px;">(for internal use)</div>
          <textarea style="width:100%;min-height:120px;font-size:13px;" onchange="updateJobField('${job.id}', 'notes', this.value)">${esc(job.notes || '')}</textarea>
        </div>

        <div class="card">
          <div class="card-header"><h3>Technician Notes</h3></div>
          <div style="font-size:12px;color:var(--text-light);margin-bottom:4px;">(for customers)</div>
          <textarea style="width:100%;min-height:120px;font-size:13px;" onchange="updateJobField('${job.id}', 'tech_notes', this.value)">${esc(job.tech_notes || '')}</textarea>
        </div>

        <!-- SERVICE DUE NOTICE -->
        <div class="card" style="padding:12px;border-left:4px solid #ff8f00;">
          <div class="card-header" style="margin-bottom:8px;"><h3 style="color:#e65100;">&#128197; Service Due Notice</h3></div>
          ${jobSdn ? `
            <div style="background:#fff8e1;border-radius:4px;padding:8px;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <strong style="font-size:12px;">${esc(jobSdn.service_type || 'Service')}</strong>
                <span class="badge" style="font-size:9px;padding:2px 6px;border-radius:3px;background:${jobSdn.is_overdue ? '#f44336' : jobSdn.status === 'sent' ? '#2196f3' : jobSdn.status === 'pending' ? (jobSdn.email_enabled !== false ? '#388e3c' : '#9e9e9e') : '#ff9800'};color:white;">
                  ${jobSdn.is_overdue ? 'OVERDUE' : jobSdn.status === 'pending' ? (jobSdn.email_enabled !== false ? 'Email ON' : 'Email OFF') : (jobSdn.status || '').toUpperCase()}
                </span>
              </div>
              <div style="font-size:12px;margin-top:4px;">Due: <strong>${jobSdn.due_date || 'N/A'}</strong></div>
              <div style="display:flex;gap:6px;margin-top:6px;">
                <button class="btn btn-secondary" style="font-size:11px;padding:3px 8px;flex:1;" onclick="openServiceDueNoticeModal(${JSON.stringify(jobSdn).replace(/"/g, '&quot;')},'${job.customer_id}','${job.property_id || ''}')">Edit</button>
                <button class="btn btn-danger" style="font-size:11px;padding:3px 8px;" onclick="deleteJobSdn('${jobSdn.id}','${id}')">Delete</button>
              </div>
            </div>
          ` : `
            <button class="btn" style="width:100%;font-weight:700;font-size:12px;padding:8px;background:#ff8f00;color:white;border:none;border-radius:4px;cursor:pointer;margin-bottom:6px;" onclick="openServiceDueNoticeModal(null,'${job.customer_id}','${job.property_id || ''}')">
              + CREATE SERVICE DUE NOTICE
            </button>
            <div style="display:flex;gap:4px;">
              <button class="btn" style="flex:1;font-weight:700;font-size:11px;padding:6px;background:#e65100;color:white;border:none;border-radius:4px;cursor:pointer;" onclick="quickCreateSdn('${job.customer_id}','${job.property_id || ''}','Pumping',3,'years','${job.id}')">Pump / 3yr</button>
              <button class="btn" style="flex:1;font-weight:700;font-size:11px;padding:6px;background:#e65100;color:white;border:none;border-radius:4px;cursor:pointer;" onclick="quickCreateSdn('${job.customer_id}','${job.property_id || ''}','Pumping',5,'years','${job.id}')">Pump / 5yr</button>
            </div>
          `}
        </div>

        <div class="card" style="padding:12px;${job.loose_end ? 'border-left:4px solid #e65100;' : ''}">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:700;font-size:14px;color:${job.loose_end ? '#c62828' : 'inherit'};">
            <input type="checkbox" ${job.loose_end ? 'checked' : ''} onchange="toggleLooseEnd('${job.id}', this.checked)" style="width:18px;height:18px;">
            &#9888; Loose End
          </label>
          <div id="looseEndNoteWrap" style="margin-top:8px;${job.loose_end ? '' : 'display:none;'}">
            <label style="font-size:11px;font-weight:600;color:#e65100;">Why is this a loose end?</label>
            <textarea id="looseEndNote" style="width:100%;min-height:60px;margin-top:4px;font-size:13px;border:2px solid #e65100;border-radius:4px;padding:6px;resize:vertical;"
              onblur="updateJobField('${job.id}', 'loose_end_note', this.value)" placeholder="Describe what needs follow-up...">${esc(job.loose_end_note || '')}</textarea>
          </div>
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-primary" style="flex:1;" onclick="openJobEditFromDetail('${job.id}')">Edit Job</button>
          ${isAdmin() ? `<button class="btn btn-danger" onclick="deleteJobFromDetail('${job.id}')">Delete</button>` : ''}
        </div>
      </div>
    </div>
  `;

  // Restore last selected service category
  if (lastServiceCategoryId) {
    const catSel = document.getElementById('serviceCategory');
    if (catSel) {
      catSel.value = lastServiceCategoryId;
      loadServiceProductsDropdown(lastServiceCategoryId);
    }
  }

  // Reset any stale drag state that could block input focus
  _pDrag = null;
  document.body.style.userSelect = '';
  document.body.style.cursor = '';
}

async function updateJobGallons(jobId, tankId, value) {
  const { data: job } = await window.api.getJob(jobId);
  if (!job) return;
  const gallonsPumped = job.gallons_pumped || {};
  gallonsPumped[tankId] = parseInt(value) || 0;
  await window.api.saveJob({ id: jobId, gallons_pumped: gallonsPumped });
  showToast('Gallons updated.', 'success');
}

function calcNextServiceDate(svcDate, interval, unit) {
  if (!svcDate) return 'N/A';
  const d = new Date(svcDate + 'T00:00:00');
  const n = parseInt(interval) || 1;
  switch (unit) {
    case 'years': d.setFullYear(d.getFullYear() + n); break;
    case 'months': d.setMonth(d.getMonth() + n); break;
    case 'weeks': d.setDate(d.getDate() + n * 7); break;
    default: d.setFullYear(d.getFullYear() + n);
  }
  return d.toISOString().split('T')[0];
}

async function createJobSdn(jobId) {
  const { data: job } = await window.api.getJob(jobId);
  if (!job) { showToast('Job not found.', 'error'); return; }

  const interval = parseInt(document.getElementById('sdnInterval')?.value) || 5;
  const unit = document.getElementById('sdnUnit')?.value || 'years';
  const serviceType = document.getElementById('sdnServiceType')?.value || 'Pumping';
  const tankId = document.getElementById('sdnTank')?.value || '';
  const emailOn = document.getElementById('sdnEmailOn')?.checked !== false;
  const dueDate = calcNextServiceDate(job.svc_date, interval, unit);

  const data = {
    customer_id: job.customer_id,
    property_id: job.property_id,
    job_id: jobId,
    service_type: serviceType,
    due_date: dueDate,
    method: 'email',
    status: 'pending',
    email_enabled: emailOn,
    tank_id: tankId,
    interval_value: interval,
    interval_unit: unit,
    notes: job.notes || '',
  };

  const result = await window.api.saveServiceDueNotice(data);
  if (result.success) {
    // Also save the interval on the job for default next time
    await window.api.saveJob({ id: jobId, service_due_interval: interval, service_due_unit: unit });
    showToast('Service Due Notice created!', 'success');
    openJobDetail(jobId);
  } else {
    showToast('Failed to create notice.', 'error');
  }
}

async function deleteJobSdn(sdnId, jobId) {
  if (!confirm('Delete this service due notice?')) return;
  await window.api.deleteServiceDueNotice(sdnId);
  showToast('Notice deleted.', 'success');
  openJobDetail(jobId);
}

function toggleLooseEnd(jobId, checked) {
  const wrap = document.getElementById('looseEndNoteWrap');
  if (checked) {
    wrap.style.display = '';
    document.getElementById('looseEndNote').focus();
  } else {
    wrap.style.display = 'none';
  }
  updateJobField(jobId, 'loose_end', checked);
}

async function updateJobField(jobId, field, value) {
  if (field === 'vehicle_id') {
    // Auto-assign driver to truck's default tech
    const { data: vehicles } = await window.api.getVehicles();
    const v = vehicles.find(vv => vv.id === value);
    if (v && v.default_tech_id) {
      await window.api.saveJob({ id: jobId, vehicle_id: value, assigned_to: v.default_tech_id });
      return;
    }
  }
  await window.api.saveJob({ id: jobId, [field]: value });
}

async function addTechnicianToJob(jobId, userId) {
  if (!userId) return;
  const { data: job } = await window.api.getJob(jobId);
  if (!job) return;
  let helpers = job.helpers || [];
  if (!helpers.includes(userId)) helpers.push(userId);
  await window.api.saveJob({ id: jobId, helpers });
  openJobDetail(jobId);
}

async function toggleJobHelper(jobId, userId, add) {
  const { data: job } = await window.api.getJob(jobId);
  if (!job) return;
  let helpers = job.helpers || [];
  if (add && !helpers.includes(userId)) helpers.push(userId);
  if (!add) helpers = helpers.filter(h => h !== userId);
  await window.api.saveJob({ id: jobId, helpers });
}

async function addLineItem(jobId) {
  const desc = document.getElementById('newLineDesc').value.trim();
  const price = parseFloat(document.getElementById('newLinePrice').value) || 0;
  if (!desc) { showToast('Enter a description.', 'error'); return; }
  const { data: job } = await window.api.getJob(jobId);
  if (!job) return;
  const items = job.line_items || [];
  items.push({ description: desc, qty: 1, unit_price: price });
  const total = items.reduce((s, li) => s + ((li.qty || 0) * (li.unit_price || 0)), 0);
  await window.api.saveJob({ id: jobId, line_items: items, total });
  openJobDetail(jobId);
}

async function removeLineItem(jobId, idx) {
  const { data: job } = await window.api.getJob(jobId);
  if (!job) return;
  const items = (job.line_items || []).filter((_, i) => i !== idx);
  const total = items.reduce((s, li) => s + ((li.qty || 0) * (li.unit_price || 0)), 0);
  await window.api.saveJob({ id: jobId, line_items: items, total });
  openJobDetail(jobId);
}

async function loadServiceProductsDropdown(categoryId) {
  lastServiceCategoryId = categoryId || '';
  const sel = document.getElementById('serviceProduct');
  if (!sel) return;
  sel.innerHTML = '<option value="">-Choose a product or service-</option>';
  if (!categoryId) return;
  const { data: products } = await window.api.getServiceProducts(categoryId);
  products.forEach(p => {
    const opt = document.createElement('option');
    opt.value = JSON.stringify({ description: p.name, unit_price: p.price || 0 });
    opt.textContent = `${p.name}${p.price ? ' - $' + p.price.toFixed(2) : ''}`;
    sel.appendChild(opt);
  });
}

async function onServiceProductSelected(jobId) {
  const sel = document.getElementById('serviceProduct');
  if (!sel || !sel.value) return;
  try {
    const product = JSON.parse(sel.value);
    const { data: job } = await window.api.getJob(jobId);
    if (!job) return;
    const items = job.line_items || [];
    items.push({ description: product.description, qty: 1, unit_price: product.unit_price || 0 });
    const total = items.reduce((s, li) => s + ((li.qty || 0) * (li.unit_price || 0)), 0);
    await window.api.saveJob({ id: jobId, line_items: items, total });
    openJobDetail(jobId);
  } catch (e) { console.error('Service product select error:', e); }
}

async function updateLineItem(jobId, idx, field, value) {
  const { data: job } = await window.api.getJob(jobId);
  if (!job) return;
  const items = job.line_items || [];
  if (items[idx]) {
    items[idx][field] = value;
    const total = items.reduce((s, li) => s + ((li.qty || 0) * (li.unit_price || 0)), 0);
    await window.api.saveJob({ id: jobId, line_items: items, total });
    openJobDetail(jobId);
  }
}

async function markJobComplete(jobId) {
  await window.api.updateJobStatus(jobId, 'completed');
  showToast('Job marked as completed.', 'success');
  openJobDetail(jobId);
}

async function openJobEditFromDetail(jobId) {
  const { data: job } = await window.api.getJob(jobId);
  if (job) openJobModal(job);
}

async function deleteJobFromDetail(jobId) {
  if (!confirm('Delete this job?')) return;
  await window.api.deleteJob(jobId);
  showToast('Job deleted.', 'success');
  loadSchedule();
}

// ===== VEHICLES =====
let _selectedVehicleId = null;

async function loadVehicles() {
  const page = document.getElementById('page-vehicles');
  const { data: vehicles } = await window.api.getVehicles();
  const { data: users } = await window.api.getUsers();

  page.innerHTML = `
    <div class="trucks-layout">
      <div class="trucks-list-panel">
        <div class="trucks-list-header">
          <span>My Trucks: <b>${vehicles.length}</b></span>
        </div>
        <div class="trucks-list">
          ${vehicles.map(v => {
            const isSelected = v.id === _selectedVehicleId;
            return `
              <div class="truck-list-item ${isSelected ? 'selected' : ''}" onclick="selectVehicle('${v.id}')">
                <div class="truck-list-color" style="background:${v.color || '#1565c0'};"></div>
                <div class="truck-list-icon">&#128666;</div>
                <div class="truck-list-info">
                  <div class="truck-list-name">${esc(v.name)}</div>
                  <div class="truck-list-cap">${v.capacity_gallons ? v.capacity_gallons.toLocaleString() + ' Gallons' : 'N/A'}</div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
        <button class="btn btn-danger" style="margin-top:12px;width:100%;" onclick="openVehicleForm(null)">ADD NEW TRUCK</button>
      </div>
      <div class="trucks-edit-panel" id="trucksEditPanel">
        ${_selectedVehicleId ? '' : '<div class="empty-state" style="padding:40px;"><p>Select a truck to edit, or add a new one.</p></div>'}
      </div>
    </div>
  `;

  if (_selectedVehicleId) {
    const v = vehicles.find(x => x.id === _selectedVehicleId);
    if (v) renderVehicleForm(v, users);
  }
}

function selectVehicle(id) {
  _selectedVehicleId = id;
  loadVehicles();
}

function openVehicleForm(vehicle) {
  _selectedVehicleId = vehicle ? vehicle.id : '__new__';
  if (!vehicle) {
    window.api.getUsers().then(({ data: users }) => {
      renderVehicleForm(null, users);
      // Also highlight the new item
      document.querySelectorAll('.truck-list-item').forEach(el => el.classList.remove('selected'));
    });
  }
  loadVehicles();
}

function renderVehicleForm(vehicle, users) {
  const panel = document.getElementById('trucksEditPanel');
  if (!panel) return;
  const isEdit = !!vehicle;
  const v = vehicle || {};

  panel.innerHTML = `
    <h3 style="margin-bottom:16px;font-size:18px;font-weight:700;">${isEdit ? 'Edit Truck' : 'New Truck'}</h3>
    <input type="hidden" id="vehicleId" value="${v.id || ''}">
    <div class="form-group">
      <label>Vehicle Name *</label>
      <input type="text" id="vehicleName" value="${esc(v.name || '')}" placeholder="2017 MACK, BOXTRUCK, etc.">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Capacity (gallons)</label>
        <input type="number" id="vehicleCapacity" value="${v.capacity_gallons || ''}" min="0" placeholder="4400">
      </div>
      <div class="form-group">
        <label>VIN</label>
        <input type="text" id="vehicleVin" value="${esc(v.vin || '')}" placeholder="Vehicle VIN">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Waste Hauler ID</label>
        <input type="text" id="vehicleHaulerId" value="${esc(v.waste_hauler_id || '')}" placeholder="Hauler License #">
      </div>
      <div class="form-group">
        <label>Plate #</label>
        <input type="text" id="vehiclePlate" value="${esc(v.plate || '')}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Date Placed in Service</label>
        <input type="date" id="vehicleServiceDate" value="${v.date_in_service || ''}" ${isEdit && v.date_in_service ? 'disabled' : ''}>
      </div>
      <div class="form-group">
        <label>Color</label>
        <input type="color" id="vehicleColor" value="${v.color || '#1565c0'}" style="height:38px;width:100%;">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Default Technician</label>
        <select id="vehicleTech">
          <option value="">-- None --</option>
          ${users.map(u => `<option value="${u.id}" ${u.id === v.default_tech_id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Sort Order</label>
        <input type="number" id="vehicleSort" value="${v.sort_order || 0}" min="0" placeholder="0">
      </div>
    </div>
    <div class="truck-form-actions">
      ${isEdit ? '<button class="btn btn-danger" onclick="deleteVehicle()">DELETE</button>' : ''}
      <button class="btn btn-success" onclick="saveVehicle()">SAVE TRUCK</button>
    </div>
  `;
}

// Legacy modal opener (not used anymore, but kept for compatibility)
function openVehicleModal(vehicle = null) {
  if (vehicle) {
    selectVehicle(vehicle.id);
  } else {
    openVehicleForm(null);
  }
}

async function saveVehicle() {
  const data = {
    name: document.getElementById('vehicleName').value.trim(),
    capacity_gallons: parseInt(document.getElementById('vehicleCapacity').value) || 0,
    color: document.getElementById('vehicleColor').value,
    default_tech_id: document.getElementById('vehicleTech').value || null,
    plate: document.getElementById('vehiclePlate').value.trim(),
    vin: document.getElementById('vehicleVin').value.trim(),
    waste_hauler_id: document.getElementById('vehicleHaulerId').value.trim(),
    date_in_service: document.getElementById('vehicleServiceDate').value || '',
    sort_order: parseInt(document.getElementById('vehicleSort').value) || 0,
  };

  const id = document.getElementById('vehicleId').value;
  if (id) data.id = id;

  if (!data.name) {
    showToast('Vehicle name is required.', 'error');
    return;
  }

  const result = await window.api.saveVehicle(data);
  if (result.success) {
    _selectedVehicleId = result.data.id;
    showToast(id ? 'Vehicle updated.' : 'Vehicle added.', 'success');
    loadVehicles();
  }
}

async function deleteVehicle() {
  const id = document.getElementById('vehicleId').value;
  if (!id || !confirm('Delete this vehicle?')) return;
  await window.api.deleteVehicle(id);
  _selectedVehicleId = null;
  showToast('Vehicle deleted.', 'success');
  loadVehicles();
}

// ===== INVOICES =====
// ===== INVOICES =====
let invoiceFilters = { page: 1, perPage: 35, sortField: 'svc_date', sortDir: 'desc' };
let invoiceFilterOptions = null;
let selectedInvoiceIds = new Set();

async function loadInvoices() {
  const page = document.getElementById('page-invoices');

  // Backfill invoices for any jobs that don't have one yet
  await window.api.backfillInvoices();

  // Load filter options once
  if (!invoiceFilterOptions) {
    invoiceFilterOptions = await window.api.getInvoiceFilterOptions();
  }
  const opts = invoiceFilterOptions;

  const result = await window.api.getInvoices(invoiceFilters);
  const invoices = result.data || [];
  const total = result.total || 0;
  const totals = result.totals || {};
  const currentPage = result.page || 1;
  const perPage = result.perPage || 25;
  const totalPages = Math.ceil(total / perPage);

  // Date range display
  const dateFrom = invoiceFilters.dateFrom || '';
  const dateTo = invoiceFilters.dateTo || '';
  const dateRange = dateFrom || dateTo ? `${dateFrom || 'Start'} – ${dateTo || 'Present'}` : 'All Time';

  // Sort indicator
  const sortIcon = (field) => {
    if (invoiceFilters.sortField !== field) return '';
    return invoiceFilters.sortDir === 'asc' ? ' &#9650;' : ' &#9660;';
  };
  const sortClick = (field) => `onclick="invoiceSortBy('${field}')"`;

  page.innerHTML = `
    <div style="display:flex;gap:0;height:calc(100vh - 120px);">
      <!-- FILTER SIDEBAR -->
      <div class="inv-filter-sidebar">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <strong style="font-size:12px;text-transform:uppercase;letter-spacing:1px;">Filter Invoices</strong>
          <a href="#" onclick="event.preventDefault();invoiceClearFilters()" style="font-size:11px;">Clear All</a>
        </div>

        <label class="inv-filter-label">Service Date Range</label>
        <div class="inv-date-preset-wrap">
          <div class="inv-date-preset-header">
            <button class="inv-date-nav" onclick="invDatePresetNav(-1)">&lt;</button>
            <span class="inv-date-preset-current" id="invDatePresetLabel">${invFormatPresetLabel()}</span>
            <button class="inv-date-nav" onclick="invDatePresetNav(1)">&gt;</button>
          </div>
          <div class="inv-date-preset-grid">
            ${['Today','Yesterday','This Week','Last Week','This Month','Last Month','This Quarter','Last Quarter','This Year','Last Year','All Time','Custom'].map(p =>
              `<button class="inv-date-preset-btn ${(invoiceFilters._preset || 'All Time') === p ? 'active' : ''}" onclick="invApplyDatePreset('${p}')">${p}</button>`
            ).join('')}
          </div>
          <div class="inv-date-custom-row" id="invDateCustomRow" style="display:${(invoiceFilters._preset === 'Custom') ? 'flex' : 'none'}">
            <input type="date" class="inv-filter-input" value="${invoiceFilters.dateFrom || ''}" onchange="invoiceFilters.dateFrom=this.value;invoiceFilters.page=1;loadInvoices()">
            <span style="font-size:11px;">to</span>
            <input type="date" class="inv-filter-input" value="${invoiceFilters.dateTo || ''}" onchange="invoiceFilters.dateTo=this.value;invoiceFilters.page=1;loadInvoices()">
          </div>
          <div class="inv-date-range-display" id="invDateRangeDisplay">${dateRange}</div>
        </div>

        <label class="inv-filter-label">Billing Contact</label>
        <select class="inv-filter-select" onchange="invoiceFilters.customerId=this.value||undefined;invoiceFilters.page=1;loadInvoices()">
          <option value="">All</option>
          ${opts.customers.map(c => `<option value="${c.id}" ${invoiceFilters.customerId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>

        <label class="inv-filter-label">City</label>
        <select class="inv-filter-select" onchange="invoiceFilters.propertyCity=this.value||undefined;invoiceFilters.page=1;loadInvoices()">
          <option value="">All</option>
          ${opts.cities.map(c => `<option value="${c}" ${invoiceFilters.propertyCity === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>

        <label class="inv-filter-label">Truck</label>
        <select class="inv-filter-select" onchange="invoiceFilters.vehicleId=this.value||undefined;invoiceFilters.page=1;loadInvoices()">
          <option value="">All</option>
          ${opts.vehicles.map(v => `<option value="${v.id}" ${invoiceFilters.vehicleId === v.id ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}
        </select>

        <label class="inv-filter-label">Driver</label>
        <select class="inv-filter-select" onchange="invoiceFilters.driverId=this.value||undefined;invoiceFilters.page=1;loadInvoices()">
          <option value="">All</option>
          ${opts.drivers.map(d => `<option value="${d.id}" ${invoiceFilters.driverId === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
        </select>

        <label class="inv-filter-label">Payment Status</label>
        <select class="inv-filter-select" onchange="invoiceFilters.paymentStatus=this.value||undefined;invoiceFilters.page=1;loadInvoices()">
          <option value="">All</option>
          <option value="unpaid" ${invoiceFilters.paymentStatus === 'unpaid' ? 'selected' : ''}>Unpaid</option>
          <option value="partial" ${invoiceFilters.paymentStatus === 'partial' ? 'selected' : ''}>Partial</option>
          <option value="paid" ${invoiceFilters.paymentStatus === 'paid' ? 'selected' : ''}>Paid</option>
        </select>

        <label class="inv-filter-label">Payment Method</label>
        <select class="inv-filter-select" onchange="invoiceFilters.paymentMethod=this.value||undefined;invoiceFilters.page=1;loadInvoices()">
          <option value="">All</option>
          <option value="cash" ${invoiceFilters.paymentMethod === 'cash' ? 'selected' : ''}>Cash</option>
          <option value="check" ${invoiceFilters.paymentMethod === 'check' ? 'selected' : ''}>Check</option>
          <option value="credit" ${invoiceFilters.paymentMethod === 'credit' ? 'selected' : ''}>Credit Card</option>
          <option value="ach" ${invoiceFilters.paymentMethod === 'ach' ? 'selected' : ''}>ACH</option>
        </select>

        <label class="inv-filter-label">Invoice Status</label>
        <select class="inv-filter-select" onchange="invoiceFilters.status=this.value||undefined;invoiceFilters.page=1;loadInvoices()">
          <option value="">All</option>
          <option value="draft" ${invoiceFilters.status === 'draft' ? 'selected' : ''}>Draft</option>
          <option value="sent" ${invoiceFilters.status === 'sent' ? 'selected' : ''}>Sent</option>
          <option value="paid" ${invoiceFilters.status === 'paid' ? 'selected' : ''}>Paid</option>
          <option value="overdue" ${invoiceFilters.status === 'overdue' ? 'selected' : ''}>Overdue</option>
        </select>

        <label class="inv-filter-label">Job Complete</label>
        <select class="inv-filter-select" onchange="invoiceFilters.complete=this.value===''?undefined:this.value==='true';invoiceFilters.page=1;loadInvoices()">
          <option value="">All</option>
          <option value="true" ${invoiceFilters.complete === true ? 'selected' : ''}>Complete</option>
          <option value="false" ${invoiceFilters.complete === false ? 'selected' : ''}>Incomplete</option>
        </select>

        <label class="inv-filter-label">Waste Site</label>
        <select class="inv-filter-select" onchange="invoiceFilters.wasteSiteId=this.value||undefined;invoiceFilters.page=1;loadInvoices()">
          <option value="">All</option>
          ${opts.wasteSites.map(w => `<option value="${w.id}" ${invoiceFilters.wasteSiteId === w.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}
        </select>
      </div>

      <!-- MAIN CONTENT -->
      <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
        <!-- HEADER -->
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid #e0e0e0;background:#fafafa;flex-shrink:0;">
          <div>
            <span style="font-size:18px;font-weight:700;">Invoices List</span>
            <span style="background:#1565c0;color:white;font-size:11px;padding:2px 8px;border-radius:10px;margin-left:8px;">${total}</span>
            <div style="font-size:11px;color:var(--text-light);margin-top:2px;">Appointment dates: ${dateRange}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <span style="font-size:11px;color:var(--text-light);">${new Date().toLocaleDateString()} | ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>
            <button id="invDeleteBtn" class="btn btn-sm" style="background:#c62828;color:white;font-weight:700;font-size:11px;${selectedInvoiceIds.size > 0 ? '' : 'display:none;'}" onclick="invoiceBatchDelete()">DELETE (${selectedInvoiceIds.size})</button>
            <button class="btn btn-sm" style="background:#1565c0;color:white;font-weight:700;font-size:11px;" onclick="invoiceBatchSend()">BATCH SEND</button>
            <button class="btn btn-sm" style="background:#1565c0;color:white;font-weight:700;font-size:11px;" onclick="invoiceBatchPrint()">BATCH PRINT</button>
            <button class="btn btn-sm" style="background:#555;color:white;font-weight:700;font-size:11px;" onclick="invoiceExportCsv()">EXPORT</button>
          </div>
        </div>

        <!-- TABLE -->
        <div class="inv-table-wrap">
          <table class="inv-table">
            <thead>
              <tr>
                <th ${sortClick('invoice_number')} style="cursor:pointer;">Inv #${sortIcon('invoice_number')}</th>
                <th style="width:32px;"><input type="checkbox" onchange="invoiceToggleAll(this.checked)"></th>
                <th ${sortClick('svc_date')} style="cursor:pointer;">Svc Date${sortIcon('svc_date')}</th>
                <th ${sortClick('billing_company')} style="cursor:pointer;">Name${sortIcon('billing_company')}</th>
                <th>Complete</th>
                <th>Balance</th>
                <th ${sortClick('total')} style="cursor:pointer;">Invoice Amt${sortIcon('total')}</th>
                <th ${sortClick('amount_paid')} style="cursor:pointer;">Amount Paid${sortIcon('amount_paid')}</th>
                <th>Property Address</th>
                <th style="width:60px;">Code</th>
              </tr>
            </thead>
            <tbody>
              <!-- TOTALS ROW -->
              <tr class="inv-totals-row">
                <td><strong>Totals</strong></td>
                <td></td><td></td><td></td><td></td>
                <td><strong>${((totals.invoice_total || 0) - (totals.amount_paid || 0)).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</strong></td>
                <td><strong>${(totals.invoice_total || 0).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</strong></td>
                <td><strong>${(totals.amount_paid || 0).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</strong></td>
                <td></td><td></td>
              </tr>
              ${invoices.map(inv => {
                const balance = (inv.total || 0) - (inv.amount_paid || 0);
                return `
                <tr data-inv-id="${inv.id}" onclick="${inv.job_id ? `openJobDetail('${inv.job_id}')` : `openInvoiceDetail('${inv.id}')`}" style="cursor:pointer;" class="${selectedInvoiceIds.has(inv.id) ? 'inv-row-selected' : ''}">
                  <td><strong>${esc(inv.invoice_number || '')}</strong></td>
                  <td onclick="event.stopPropagation()"><input type="checkbox" ${selectedInvoiceIds.has(inv.id) ? 'checked' : ''} onchange="invoiceToggleOne('${inv.id}', this.checked)"></td>
                  <td>${inv.svc_date || ''}</td>
                  <td>${esc(inv.customers?.name || '')}</td>
                  <td>${inv.complete ? '&#9989;' : ''}</td>
                  <td style="color:${balance > 0 ? '#c62828' : '#2e7d32'};font-weight:600;">${balance.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                  <td>${(inv.total || 0).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                  <td>${(inv.amount_paid || 0).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                  <td>${esc(inv.property_address || '')}</td>
                  <td style="font-size:11px;">${esc(abbreviateJobCode(inv.job_codes || ''))}</td>
                </tr>`;
              }).join('')}
              ${invoices.length === 0 ? '<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--text-light);">No invoices match your filters.</td></tr>' : ''}
            </tbody>
          </table>
        </div>

        <!-- PAGINATION -->
        <div class="inv-pagination">
          <button class="inv-page-btn" ${currentPage <= 1 ? 'disabled' : ''} onclick="invoiceFilters.page=${currentPage - 1};loadInvoices()">&#8249;</button>
          <button class="inv-page-btn" ${currentPage <= 1 ? 'disabled' : ''} onclick="invoiceFilters.page=1;loadInvoices()">&#171;</button>
          ${invoicePaginationNumbers(currentPage, totalPages)}
          <button class="inv-page-btn" ${currentPage >= totalPages ? 'disabled' : ''} onclick="invoiceFilters.page=${currentPage + 1};loadInvoices()">&#8250;</button>
          <button class="inv-page-btn" ${currentPage >= totalPages ? 'disabled' : ''} onclick="invoiceFilters.page=${totalPages};loadInvoices()">&#187;</button>
        </div>
      </div>
    </div>
  `;
}

function invoicePaginationNumbers(current, total) {
  if (total <= 1) return `<button class="inv-page-btn active">1</button>`;
  let pages = [];
  const range = 3;
  for (let i = 1; i <= total; i++) {
    if (i === 1 || i === total || (i >= current - range && i <= current + range)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== '...') {
      pages.push('...');
    }
  }
  return pages.map(p => p === '...'
    ? '<span style="padding:0 4px;color:var(--text-light);">...</span>'
    : `<button class="inv-page-btn ${p === current ? 'active' : ''}" onclick="invoiceFilters.page=${p};loadInvoices()">${p}</button>`
  ).join('');
}

// getLooseEnds removed — loose ends are now a manual checkbox on jobs

function invoiceSortBy(field) {
  if (invoiceFilters.sortField === field) {
    invoiceFilters.sortDir = invoiceFilters.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    invoiceFilters.sortField = field;
    invoiceFilters.sortDir = 'desc';
  }
  invoiceFilters.page = 1;
  loadInvoices();
}

function invGetDateRange(preset, refDate) {
  const d = refDate ? new Date(refDate) : new Date();
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const fmt = (dt) => dt.toISOString().split('T')[0];
  switch (preset) {
    case 'Today': return { from: fmt(today), to: fmt(today) };
    case 'Yesterday': { const y = new Date(today); y.setDate(y.getDate()-1); return { from: fmt(y), to: fmt(y) }; }
    case 'This Week': { const s = new Date(today); s.setDate(s.getDate()-s.getDay()); const e = new Date(s); e.setDate(e.getDate()+6); return { from: fmt(s), to: fmt(e) }; }
    case 'Last Week': { const s = new Date(today); s.setDate(s.getDate()-s.getDay()-7); const e = new Date(s); e.setDate(e.getDate()+6); return { from: fmt(s), to: fmt(e) }; }
    case 'This Month': { const s = new Date(d.getFullYear(), d.getMonth(), 1); const e = new Date(d.getFullYear(), d.getMonth()+1, 0); return { from: fmt(s), to: fmt(e) }; }
    case 'Last Month': { const s = new Date(d.getFullYear(), d.getMonth()-1, 1); const e = new Date(d.getFullYear(), d.getMonth(), 0); return { from: fmt(s), to: fmt(e) }; }
    case 'This Quarter': { const q = Math.floor(d.getMonth()/3); const s = new Date(d.getFullYear(), q*3, 1); const e = new Date(d.getFullYear(), q*3+3, 0); return { from: fmt(s), to: fmt(e) }; }
    case 'Last Quarter': { const q = Math.floor(d.getMonth()/3)-1; const yr = q < 0 ? d.getFullYear()-1 : d.getFullYear(); const qn = q < 0 ? 3 : q; const s = new Date(yr, qn*3, 1); const e = new Date(yr, qn*3+3, 0); return { from: fmt(s), to: fmt(e) }; }
    case 'This Year': return { from: `${d.getFullYear()}-01-01`, to: `${d.getFullYear()}-12-31` };
    case 'Last Year': return { from: `${d.getFullYear()-1}-01-01`, to: `${d.getFullYear()-1}-12-31` };
    case 'All Time': default: return { from: '', to: '' };
  }
}

function invFormatPresetLabel() {
  const preset = invoiceFilters._preset || 'All Time';
  if (preset === 'All Time') return 'All Time';
  if (preset === 'Custom') return 'Custom';
  const from = invoiceFilters.dateFrom;
  const to = invoiceFilters.dateTo;
  if (!from && !to) return 'All Time';
  // Format dates nicely: "Mar 15, 2026" or "Mar 15 – Mar 21, 2026"
  const fmtNice = (d) => {
    const dt = new Date(d + 'T00:00:00');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()}`;
  };
  if (from === to) return fmtNice(from);
  return `${fmtNice(from)} – ${fmtNice(to)}`;
}

function invApplyDatePreset(preset) {
  invoiceFilters._preset = preset;
  if (preset === 'Custom') {
    document.getElementById('invDateCustomRow').style.display = 'flex';
    // Re-render just the label
    const lbl = document.getElementById('invDatePresetLabel');
    if (lbl) lbl.textContent = 'Custom';
    return;
  }
  document.getElementById('invDateCustomRow').style.display = 'none';
  const range = invGetDateRange(preset);
  invoiceFilters.dateFrom = range.from || undefined;
  invoiceFilters.dateTo = range.to || undefined;
  invoiceFilters._presetRef = undefined;
  invoiceFilters.page = 1;
  loadInvoices();
}

function invDatePresetNav(dir) {
  const preset = invoiceFilters._preset || 'All Time';
  if (preset === 'All Time' || preset === 'Custom') return;
  // Calculate a reference date shifted by one period
  let ref = invoiceFilters._presetRef ? new Date(invoiceFilters._presetRef) : new Date();
  switch (preset) {
    case 'Today': case 'Yesterday': ref.setDate(ref.getDate() + dir); break;
    case 'This Week': case 'Last Week': ref.setDate(ref.getDate() + dir * 7); break;
    case 'This Month': case 'Last Month': ref.setMonth(ref.getMonth() + dir); break;
    case 'This Quarter': case 'Last Quarter': ref.setMonth(ref.getMonth() + dir * 3); break;
    case 'This Year': case 'Last Year': ref.setFullYear(ref.getFullYear() + dir); break;
  }
  invoiceFilters._presetRef = ref.toISOString().split('T')[0];
  const range = invGetDateRange(preset, ref);
  invoiceFilters.dateFrom = range.from || undefined;
  invoiceFilters.dateTo = range.to || undefined;
  invoiceFilters.page = 1;
  loadInvoices();
}

function invoiceClearFilters() {
  invoiceFilters = { page: 1, perPage: 35, sortField: 'svc_date', sortDir: 'desc' };
  selectedInvoiceIds.clear();
  loadInvoices();
}

function invoiceToggleAll(checked) {
  document.querySelectorAll('.inv-table tbody input[type="checkbox"]').forEach(cb => {
    cb.checked = checked;
    const id = cb.closest('tr')?.dataset?.invId;
    if (id) checked ? selectedInvoiceIds.add(id) : selectedInvoiceIds.delete(id);
  });
  _updateInvDeleteBtn();
}

function invoiceToggleOne(id, checked) {
  checked ? selectedInvoiceIds.add(id) : selectedInvoiceIds.delete(id);
  _updateInvDeleteBtn();
}

function _updateInvDeleteBtn() {
  const btn = document.getElementById('invDeleteBtn');
  if (!btn) return;
  if (selectedInvoiceIds.size > 0) {
    btn.style.display = '';
    btn.textContent = `DELETE (${selectedInvoiceIds.size})`;
  } else {
    btn.style.display = 'none';
  }
}

async function invoiceBatchSend() {
  if (selectedInvoiceIds.size === 0) { showToast('Select invoices first.', 'error'); return; }
  if (!confirm(`Send ${selectedInvoiceIds.size} invoice(s) via email?`)) return;
  let sent = 0;
  for (const id of selectedInvoiceIds) {
    const { data: inv } = await window.api.getInvoice(id);
    if (inv?.customers?.email) {
      const html = generateInvoiceHtml(inv);
      const pdfPath = await window.api.generatePdf(html, `Invoice-${inv.invoice_number}.pdf`);
      if (pdfPath) {
        await window.api.sendEmail(inv.customers.email, `Invoice ${inv.invoice_number}`, `Please find attached invoice ${inv.invoice_number}.`, pdfPath);
        await window.api.saveInvoice({ id: inv.id, status: 'sent', sent_date: new Date().toISOString().split('T')[0] });
        sent++;
      }
    }
  }
  selectedInvoiceIds.clear();
  showToast(`Sent ${sent} invoice(s).`, 'success');
  loadInvoices();
}

async function invoiceBatchPrint() {
  if (selectedInvoiceIds.size === 0) { showToast('Select invoices first.', 'error'); return; }
  let allHtml = '';
  for (const id of selectedInvoiceIds) {
    const { data: inv } = await window.api.getInvoice(id);
    if (inv) allHtml += generateInvoiceHtml(inv) + '<div style="page-break-after:always;"></div>';
  }
  const pdfPath = await window.api.generatePdf(allHtml, 'Invoices-Batch.pdf');
  if (pdfPath) await window.api.openFile(pdfPath);
}

async function invoiceBatchDelete() {
  if (selectedInvoiceIds.size === 0) { showToast('Select invoices first.', 'error'); return; }
  if (!confirm(`Delete ${selectedInvoiceIds.size} invoice(s)? This cannot be undone.`)) return;
  let deleted = 0;
  for (const id of selectedInvoiceIds) {
    await window.api.deleteInvoice(id);
    deleted++;
  }
  selectedInvoiceIds.clear();
  showToast(`Deleted ${deleted} invoice(s).`, 'success');
  loadInvoices();
}

function generateInvoiceHtml(inv) {
  const lineRows = (inv.line_items || []).map(li =>
    `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;">${li.description || ''}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:center;">${li.qty || 0}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;">$${(li.unit_price || 0).toFixed(2)}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;">$${((li.qty || 0) * (li.unit_price || 0)).toFixed(2)}</td></tr>`
  ).join('');
  return `<html><body style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:20px;">
    <h1 style="color:#1565c0;margin-bottom:4px;">INVOICE</h1>
    <div style="display:flex;justify-content:space-between;margin-bottom:20px;">
      <div><strong>Invoice #:</strong> ${inv.invoice_number}<br><strong>Date:</strong> ${inv.svc_date || inv.created_at?.split('T')[0] || ''}<br>${inv.due_date ? '<strong>Due:</strong> ' + inv.due_date : ''}</div>
      <div style="text-align:right;"><strong>${inv.customers?.name || ''}</strong><br>${inv.property_address || ''}<br>${inv.property_city || ''}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      <thead><tr style="background:#1565c0;color:white;"><th style="padding:6px 8px;text-align:left;">Description</th><th style="padding:6px 8px;text-align:center;">Qty</th><th style="padding:6px 8px;text-align:right;">Price</th><th style="padding:6px 8px;text-align:right;">Total</th></tr></thead>
      <tbody>${lineRows}</tbody>
    </table>
    <div style="text-align:right;font-size:18px;font-weight:bold;">Total: $${(inv.total || 0).toFixed(2)}</div>
    ${inv.notes ? `<div style="margin-top:16px;padding:8px;background:#f5f5f5;border-radius:4px;font-size:13px;">${inv.notes}</div>` : ''}
  </body></html>`;
}

async function invoiceExportCsv() {
  // Fetch ALL invoices (no pagination) with current filters
  const allFilters = { ...invoiceFilters, page: 1, perPage: 999999 };
  const { data: allInvoices } = await window.api.getInvoices(allFilters);
  const headers = ['Invoice #','Svc Date','Name','Billing City','Property Address','Job Code','Complete','Invoice Amt','Amount Paid','Balance','Status','Payment Status'];
  const rows = allInvoices.map(inv => [
    inv.invoice_number || '',
    inv.svc_date || '',
    inv.customers?.name || '',
    inv.billing_city || '',
    inv.property_address || '',
    inv.job_codes || '',
    inv.complete ? 'Yes' : 'No',
    (inv.total || 0).toFixed(2),
    (inv.amount_paid || 0).toFixed(2),
    ((inv.total || 0) - (inv.amount_paid || 0)).toFixed(2),
    inv.status || '',
    inv.payment_status || '',
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const result = await window.api.showSaveDialog({ defaultPath: 'invoices-export.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
  if (result?.filePath) {
    // Write CSV via a temporary approach — generate as blob and save
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'invoices-export.csv';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Export downloaded.', 'success');
  }
}

// Invoice modal (edit individual invoice)
async function openInvoiceModal(invoice = null) {
  const isEdit = !!invoice;
  const inv = invoice || {};
  const { data: customers } = await window.api.getCustomers();

  let invoiceNumber = inv.invoice_number || '';
  if (!isEdit) {
    const { number } = await window.api.getNextInvoiceNumber();
    invoiceNumber = number;
  }

  const lineItems = inv.line_items || [{ description: '', qty: 1, unit_price: 0 }];

  openModal(isEdit ? `Edit Invoice #${esc(inv.invoice_number || '')}` : 'New Invoice', `
    <input type="hidden" id="invoiceId" value="${inv.id || ''}">
    <div class="form-row">
      <div class="form-group">
        <label>Invoice Number</label>
        <input type="text" id="invoiceNumber" value="${esc(invoiceNumber)}">
      </div>
      <div class="form-group">
        <label>Customer *</label>
        <select id="invoiceCustomer">
          <option value="">-- Select --</option>
          ${customers.map(c => `<option value="${c.id}" ${c.id === inv.customer_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Service Date</label>
        <input type="date" id="invoiceSvcDate" value="${inv.svc_date || ''}">
      </div>
      <div class="form-group">
        <label>Due Date</label>
        <input type="date" id="invoiceDueDate" value="${inv.due_date || ''}">
      </div>
    </div>
    <div class="form-group">
      <label>Line Items</label>
      <div id="lineItemsContainer">
        ${lineItems.map((li, idx) => lineItemRow(li, idx)).join('')}
      </div>
      <button class="btn btn-sm btn-secondary mt-8" onclick="addInvoiceLineItem()">+ Add Line</button>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Tax Rate (%)</label>
        <input type="number" id="invoiceTaxRate" value="${inv.tax_rate || 0}" min="0" step="0.1" oninput="calcInvoiceTotal()">
      </div>
      <div class="form-group">
        <label>Total: <strong id="invoiceTotalDisplay">$0.00</strong></label>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Status</label>
        <select id="invoiceStatus">
          <option value="draft" ${(!inv.status || inv.status === 'draft') ? 'selected' : ''}>Draft</option>
          <option value="sent" ${inv.status === 'sent' ? 'selected' : ''}>Sent</option>
          <option value="paid" ${inv.status === 'paid' ? 'selected' : ''}>Paid</option>
          <option value="overdue" ${inv.status === 'overdue' ? 'selected' : ''}>Overdue</option>
        </select>
      </div>
      <div class="form-group">
        <label>Payment Status</label>
        <select id="invoicePaymentStatus">
          <option value="unpaid" ${(!inv.payment_status || inv.payment_status === 'unpaid') ? 'selected' : ''}>Unpaid</option>
          <option value="partial" ${inv.payment_status === 'partial' ? 'selected' : ''}>Partial</option>
          <option value="paid" ${inv.payment_status === 'paid' ? 'selected' : ''}>Paid</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Payment Method</label>
        <select id="invoicePaymentMethod">
          <option value="">-- Select --</option>
          <option value="cash" ${inv.payment_method === 'cash' ? 'selected' : ''}>Cash</option>
          <option value="check" ${inv.payment_method === 'check' ? 'selected' : ''}>Check</option>
          <option value="credit" ${inv.payment_method === 'credit' ? 'selected' : ''}>Credit Card</option>
          <option value="ach" ${inv.payment_method === 'ach' ? 'selected' : ''}>ACH</option>
        </select>
      </div>
      <div class="form-group">
        <label>Amount Paid ($)</label>
        <input type="number" id="invoiceAmountPaid" value="${inv.amount_paid || 0}" min="0" step="0.01">
      </div>
    </div>
    <div class="form-group">
      <label>Notes</label>
      <textarea id="invoiceNotes" placeholder="Additional notes...">${esc(inv.notes || '')}</textarea>
    </div>
  `, `
    ${isEdit ? '<button class="btn btn-danger" onclick="deleteInvoice()">Delete</button>' : ''}
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveInvoice()">Save</button>
  `);

  calcInvoiceTotal();
}

function lineItemRow(li, idx) {
  return `
    <div class="form-row" style="margin-bottom:6px;align-items:end;" data-line="${idx}">
      <div class="form-group" style="flex:3;margin-bottom:0;">
        ${idx === 0 ? '<label style="font-size:11px;">Description</label>' : ''}
        <input type="text" class="li-desc" value="${esc(li.description || '')}" placeholder="Service description" oninput="calcInvoiceTotal()">
      </div>
      <div class="form-group" style="flex:0.5;margin-bottom:0;">
        ${idx === 0 ? '<label style="font-size:11px;">Qty</label>' : ''}
        <input type="number" class="li-qty" value="${li.qty || 1}" min="1" oninput="calcInvoiceTotal()">
      </div>
      <div class="form-group" style="flex:1;margin-bottom:0;">
        ${idx === 0 ? '<label style="font-size:11px;">Unit Price</label>' : ''}
        <input type="number" class="li-price" value="${li.unit_price || 0}" min="0" step="0.01" oninput="calcInvoiceTotal()">
      </div>
      <button class="btn btn-sm btn-danger" onclick="removeInvoiceLineItem(this)" style="margin-bottom:2px;">&times;</button>
    </div>
  `;
}

function addInvoiceLineItem() {
  const container = document.getElementById('lineItemsContainer');
  const idx = container.children.length;
  container.insertAdjacentHTML('beforeend', lineItemRow({ description: '', qty: 1, unit_price: 0 }, idx));
}

function removeInvoiceLineItem(btn) {
  const row = btn.closest('[data-line]');
  if (document.querySelectorAll('[data-line]').length > 1) {
    row.remove();
    calcInvoiceTotal();
  }
}

function calcInvoiceTotal() {
  const descs = document.querySelectorAll('.li-desc');
  const qtys = document.querySelectorAll('.li-qty');
  const prices = document.querySelectorAll('.li-price');
  let subtotal = 0;
  for (let i = 0; i < descs.length; i++) {
    subtotal += (parseFloat(qtys[i]?.value) || 0) * (parseFloat(prices[i]?.value) || 0);
  }
  const taxRate = parseFloat(document.getElementById('invoiceTaxRate')?.value) || 0;
  const tax = subtotal * (taxRate / 100);
  const total = subtotal + tax;
  const display = document.getElementById('invoiceTotalDisplay');
  if (display) display.textContent = '$' + total.toFixed(2);
}

async function saveInvoice() {
  const descs = document.querySelectorAll('.li-desc');
  const qtys = document.querySelectorAll('.li-qty');
  const prices = document.querySelectorAll('.li-price');
  const lineItems = [];
  let subtotal = 0;

  for (let i = 0; i < descs.length; i++) {
    const qty = parseFloat(qtys[i].value) || 0;
    const price = parseFloat(prices[i].value) || 0;
    lineItems.push({ description: descs[i].value.trim(), qty, unit_price: price });
    subtotal += qty * price;
  }

  const taxRate = parseFloat(document.getElementById('invoiceTaxRate').value) || 0;
  const taxAmount = subtotal * (taxRate / 100);

  const data = {
    invoice_number: document.getElementById('invoiceNumber').value.trim(),
    customer_id: document.getElementById('invoiceCustomer').value,
    svc_date: document.getElementById('invoiceSvcDate').value || null,
    line_items: lineItems,
    subtotal,
    tax_rate: taxRate,
    tax_amount: taxAmount,
    total: subtotal + taxAmount,
    due_date: document.getElementById('invoiceDueDate').value || null,
    status: document.getElementById('invoiceStatus').value,
    payment_status: document.getElementById('invoicePaymentStatus').value,
    payment_method: document.getElementById('invoicePaymentMethod').value,
    amount_paid: parseFloat(document.getElementById('invoiceAmountPaid').value) || 0,
    notes: document.getElementById('invoiceNotes').value.trim(),
  };

  const id = document.getElementById('invoiceId').value;
  if (id) data.id = id;

  if (!data.customer_id) {
    showToast('Select a customer.', 'error');
    return;
  }

  const result = await window.api.saveInvoice(data);
  if (result.success) {
    closeModal();
    showToast(id ? 'Invoice updated.' : 'Invoice created.', 'success');
    loadInvoices();
  }
}

async function deleteInvoice() {
  const id = document.getElementById('invoiceId').value;
  if (!id || !confirm('Delete this invoice?')) return;
  await window.api.deleteInvoice(id);
  closeModal();
  showToast('Invoice deleted.', 'success');
  loadInvoices();
}

async function openInvoiceDetail(id) {
  const { data: invoice } = await window.api.getInvoice(id);
  if (invoice) openInvoiceModal(invoice);
}

// ===== WASTE SITES =====
let _selectedWasteSiteId = null;

async function loadWasteSites() {
  const page = document.getElementById('page-wastesites');
  const { data: sites } = await window.api.getWasteSites();

  if (sites.length === 0) {
    page.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">&#127959;</div>
        <p>No waste sites added yet</p>
        <button class="btn btn-primary" onclick="openWasteSiteNew()">+ Add Waste Site</button>
      </div>
    `;
    return;
  }

  // Auto-select first if none selected
  if (!_selectedWasteSiteId || !sites.find(s => s.id === _selectedWasteSiteId)) {
    _selectedWasteSiteId = sites[0].id;
  }

  const sel = sites.find(s => s.id === _selectedWasteSiteId) || sites[0];

  // Fetch disposal history for selected site
  const { data: disposals } = await window.api.getDisposalLoads();
  const siteDisposals = disposals.filter(d => d.waste_site_id === sel.id || d.disposal_site === sel.name);
  const completed = siteDisposals.filter(d => d.status === 'completed' || d.manifest_number);
  const { data: users } = await window.api.getUsers();

  // Waste type abbreviations
  const wtAbbrev = (wt) => {
    if (!wt) return '';
    const map = { 'Septage': 'S', 'Grease Trap': 'G', 'Holding Tank': 'H', 'Portable Toilet': 'Pt', 'Treatment Plant': 'Tp', 'Other': 'O' };
    return map[wt] || wt.charAt(0);
  };

  page.innerHTML = `
    <div class="ws-layout">
      <!-- LEFT: Site list & contact -->
      <div class="ws-left-panel">
        <div class="ws-sites-list">
          ${sites.map(s => `
            <div class="ws-site-item ${s.id === sel.id ? 'selected' : ''}" onclick="selectWasteSite('${s.id}')">
              <div class="ws-site-item-name">${esc(s.name)}</div>
              <div class="ws-site-item-addr">${esc(s.address || '')}${s.city ? ', ' + esc(s.city) : ''}</div>
              ${s.is_default ? '<span class="ws-default-tag">Default</span>' : ''}
            </div>
          `).join('')}
        </div>
        <button class="btn btn-primary" style="width:100%;margin-top:12px;" onclick="openWasteSiteNew()">ADD A NEW WASTE SITE</button>

        <div class="ws-contact-section">
          <h4>WASTE SITE CONTACT</h4>
          <div class="ws-contact-addr">
            ${esc(sel.address || '')}
            ${sel.city || sel.state || sel.zip ? '<br>' + esc([sel.city, sel.state].filter(Boolean).join(', ')) + ' ' + esc(sel.zip || '') : ''}
          </div>
          ${sel.contact_name ? `<div class="ws-contact-line">${esc(sel.contact_name)}</div>` : ''}
          ${sel.contact_phone ? `<div class="ws-contact-line">${esc(sel.contact_phone)}</div>` : ''}
          ${sel.contact_email ? `<div class="ws-contact-line">${esc(sel.contact_email)}</div>` : ''}
          ${sel.notes ? `<div class="ws-contact-notes"><b>Notes:</b> ${esc(sel.notes)}</div>` : ''}
        </div>
      </div>

      <!-- CENTER: Site detail form -->
      <div class="ws-center-panel">
        <h2 style="margin-bottom:4px;">${esc(sel.name)}</h2>
        <div style="color:var(--text-light);margin-bottom:20px;">
          ${esc(sel.address || '')}${sel.city ? '<br>' + esc(sel.city) + ', ' + esc(sel.state || 'ME') + ' ' + esc(sel.zip || '') : ''}
        </div>

        <input type="hidden" id="wsId" value="${sel.id}">

        <div class="form-group">
          <label>Site Name *</label>
          <input type="text" id="wsName" value="${esc(sel.name || '')}">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Address</label>
            <input type="text" id="wsAddress" value="${esc(sel.address || '')}">
          </div>
          <div class="form-group">
            <label>City</label>
            <input type="text" id="wsCity" value="${esc(sel.city || '')}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>State</label>
            <input type="text" id="wsState" value="${esc(sel.state || 'ME')}" maxlength="2">
          </div>
          <div class="form-group">
            <label>Zip</label>
            <input type="text" id="wsZip" value="${esc(sel.zip || '')}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>State License #</label>
            <input type="text" id="wsLicense" value="${esc(sel.state_license || '')}" placeholder="e.g. S-20907-CC-A-N">
          </div>
          <div class="form-group">
            <label>Waste Permit #</label>
            <input type="text" id="wsPermit" value="${esc(sel.waste_permit || '')}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Disposal Rate ($ / 1,000 Gal)</label>
            <input type="number" id="wsRate" value="${sel.disposal_rate || ''}" min="0" step="1" placeholder="140">
          </div>
          <div class="form-group">
            <label>Contact Email</label>
            <input type="email" id="wsEmail" value="${esc(sel.contact_email || '')}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Contact Name</label>
            <input type="text" id="wsContactName" value="${esc(sel.contact_name || '')}">
          </div>
          <div class="form-group">
            <label>Contact Phone</label>
            <input type="text" id="wsContactPhone" value="${esc(sel.contact_phone || '')}">
          </div>
        </div>
        <div class="form-group">
          <label>Hours of Operation</label>
          <input type="text" id="wsHours" value="${esc(sel.hours_of_operation || '')}" placeholder="e.g. 24/7, Mon-Fri 7AM-5PM">
        </div>
        <div class="form-group">
          <label>Certification Text (for waste manifest signature line)</label>
          <textarea id="wsCertification" rows="2">${esc(sel.certification_text || '')}</textarea>
        </div>
        <div class="form-group">
          <label>Directions</label>
          <textarea id="wsDirections" rows="2">${esc(sel.directions || '')}</textarea>
        </div>
        <div class="form-group" style="display:flex;align-items:center;gap:8px;">
          <input type="checkbox" id="wsDefault" ${sel.is_default ? 'checked' : ''}>
          <label for="wsDefault" style="margin:0;">Set as Default Waste Site</label>
        </div>

        <div class="truck-form-actions">
          <button class="btn btn-danger" onclick="deleteWasteSiteItem('${sel.id}')">DELETE</button>
          <button class="btn btn-success" onclick="saveWasteSiteInline()">SAVE WASTE SITE</button>
        </div>
      </div>

      <!-- RIGHT: Disposal history -->
      <div class="ws-right-panel">
        <div class="ws-history-section">
          <div class="ws-history-header">
            <span>&#128203;</span>
            <b>${completed.length} Completed Disposal${completed.length !== 1 ? 's' : ''}</b>
          </div>
          <div class="ws-history-list">
            ${completed.length === 0 ? '<div style="padding:16px;color:var(--text-light);text-align:center;">No disposal records yet</div>' : ''}
            ${completed.sort((a, b) => (b.disposal_date || '').localeCompare(a.disposal_date || '')).map(d => {
              const driver = users.find(u => u.id === d.driver);
              return `
                <div class="ws-disposal-card">
                  <div class="ws-disp-top">
                    <span class="ws-disp-site">${esc(d.disposal_site || sel.name)}</span>
                    <span class="ws-disp-driver">${esc(driver?.name || '')}</span>
                  </div>
                  <div class="ws-disp-bottom">
                    <span>${(d.volume_gallons || 0).toLocaleString()} Gallons</span>
                    <span>${esc(d.disposal_date || '')}</span>
                  </div>
                  <div class="ws-disp-bottom">
                    <span class="ws-disp-type">${wtAbbrev(d.waste_type)}</span>
                    ${d.manifest_number ? `<span class="ws-disp-manifest">Manifest # ${esc(d.manifest_number)}</span>` : ''}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
}

function selectWasteSite(id) {
  _selectedWasteSiteId = id;
  loadWasteSites();
}

function openWasteSiteNew() {
  openModal('Add Waste Site', `
    <div class="form-group">
      <label>Site Name *</label>
      <input type="text" id="wsName" placeholder="e.g. Augusta Treatment Plant">
    </div>
    <div class="form-row">
      <div class="form-group"><label>Address</label><input type="text" id="wsAddress"></div>
      <div class="form-group"><label>City</label><input type="text" id="wsCity"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>State</label><input type="text" id="wsState" value="ME" maxlength="2"></div>
      <div class="form-group"><label>Zip</label><input type="text" id="wsZip"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Contact Name</label><input type="text" id="wsContactName"></div>
      <div class="form-group"><label>Contact Phone</label><input type="text" id="wsContactPhone"></div>
    </div>
    <div class="form-group"><label>Contact Email</label><input type="email" id="wsEmail"></div>
    <div class="form-group"><label>State License #</label><input type="text" id="wsLicense" placeholder="e.g. S-20907-CC-A-N"></div>
    <div class="form-group" style="display:flex;align-items:center;gap:8px;">
      <input type="checkbox" id="wsDefault">
      <label for="wsDefault" style="margin:0;">Set as Default Waste Site</label>
    </div>
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveWasteSiteNew()">Save</button>
  `);
}

async function saveWasteSiteNew() {
  const name = document.getElementById('wsName').value.trim();
  if (!name) { showToast('Site name is required.', 'error'); return; }
  const data = {
    name,
    address: document.getElementById('wsAddress').value.trim(),
    city: document.getElementById('wsCity').value.trim(),
    state: document.getElementById('wsState').value.trim(),
    zip: document.getElementById('wsZip').value.trim(),
    contact_name: document.getElementById('wsContactName').value.trim(),
    contact_phone: document.getElementById('wsContactPhone').value.trim(),
    contact_email: document.getElementById('wsEmail')?.value.trim() || '',
    state_license: document.getElementById('wsLicense')?.value.trim() || '',
    is_default: document.getElementById('wsDefault').checked,
  };
  const result = await window.api.saveWasteSite(data);
  _selectedWasteSiteId = result.data?.id || null;
  closeModal();
  showToast('Waste site added.', 'success');
  loadWasteSites();
}

async function saveWasteSiteInline() {
  const name = document.getElementById('wsName').value.trim();
  if (!name) { showToast('Site name is required.', 'error'); return; }
  const id = document.getElementById('wsId').value;
  const data = {
    id,
    name,
    address: document.getElementById('wsAddress').value.trim(),
    city: document.getElementById('wsCity').value.trim(),
    state: document.getElementById('wsState').value.trim(),
    zip: document.getElementById('wsZip').value.trim(),
    contact_name: document.getElementById('wsContactName').value.trim(),
    contact_phone: document.getElementById('wsContactPhone').value.trim(),
    contact_email: document.getElementById('wsEmail').value.trim(),
    state_license: document.getElementById('wsLicense').value.trim(),
    waste_permit: document.getElementById('wsPermit').value.trim(),
    disposal_rate: parseFloat(document.getElementById('wsRate').value) || 0,
    hours_of_operation: document.getElementById('wsHours').value.trim(),
    certification_text: document.getElementById('wsCertification').value.trim(),
    directions: document.getElementById('wsDirections').value.trim(),
    notes: '',
    is_default: document.getElementById('wsDefault').checked,
  };
  await window.api.saveWasteSite(data);
  showToast('Waste site saved.', 'success');
  loadWasteSites();
}

// Legacy modal opener kept for compatibility
function openWasteSiteModal(site = null) {
  if (site) {
    selectWasteSite(site.id);
  } else {
    openWasteSiteNew();
  }
}
async function saveWasteSiteForm() { await saveWasteSiteInline(); }

async function deleteWasteSiteItem(id) {
  if (!confirm('Delete this waste site?')) return;
  await window.api.deleteWasteSite(id);
  _selectedWasteSiteId = null;
  closeModal();
  showToast('Waste site deleted.', 'success');
  loadWasteSites();
}

// ===== DISPOSAL =====
async function loadDisposal() {
  const page = document.getElementById('page-disposal');

  // Get date range from existing inputs or default to current month
  const existingFrom = document.getElementById('disposalFilterFrom')?.value;
  const existingTo = document.getElementById('disposalFilterTo')?.value;
  const now = new Date();
  const defaultFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const defaultTo = formatDate(now);
  const dateFrom = existingFrom || defaultFrom;
  const dateTo = existingTo || defaultTo;

  const { data: allLoads } = await window.api.getDisposalLoads();
  const { data: _vehicles } = await window.api.getVehicles();
  const { data: _wasteSites } = await window.api.getWasteSites();
  const loads = allLoads.filter(l => l.disposal_date >= dateFrom && l.disposal_date <= dateTo);
  // Enrich loads with hauler ID and site license from related records
  loads.forEach(l => {
    if (!l.waste_hauler_id) {
      const veh = _vehicles.find(v => v.id === l.vehicle_id || v.name === l.vehicle);
      if (veh) l.waste_hauler_id = veh.waste_hauler_id || '';
    }
    if (!l.waste_site_license) {
      const ws = _wasteSites.find(s => s.id === l.waste_site_id);
      if (ws) l.waste_site_license = ws.state_license || '';
    }
  });
  const totalGallons = loads.reduce((s, l) => s + (l.volume_gallons || 0), 0);

  page.innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <div class="form-group" style="margin:0;">
          <label style="font-size:12px;margin-bottom:2px;">From</label>
          <input type="date" id="disposalFilterFrom" value="${dateFrom}" onchange="loadDisposal()" style="padding:6px 8px;">
        </div>
        <div class="form-group" style="margin:0;">
          <label style="font-size:12px;margin-bottom:2px;">To</label>
          <input type="date" id="disposalFilterTo" value="${dateTo}" onchange="loadDisposal()" style="padding:6px 8px;">
        </div>
        <div style="display:flex;gap:6px;margin-left:auto;">
          <button class="btn btn-secondary" onclick="setDisposalRange('month')">This Month</button>
          <button class="btn btn-secondary" onclick="setDisposalRange('quarter')">This Quarter</button>
          <button class="btn btn-secondary" onclick="setDisposalRange('year')">This Year</button>
          <button class="btn btn-primary" onclick="exportDisposalPdf()">&#128196; Export PDF</button>
        </div>
      </div>
      <div style="margin-top:8px;font-size:13px;color:var(--text-light);">
        Showing <strong>${loads.length}</strong> record${loads.length !== 1 ? 's' : ''} &bull; <strong>${totalGallons.toLocaleString()}</strong> total gallons
      </div>
    </div>

    ${loads.length === 0 ? `
      <div class="empty-state">
        <div class="empty-icon">&#128666;</div>
        <p>No disposal loads in this date range.</p>
        <button class="btn btn-primary" onclick="openDisposalModal()">+ Log Disposal</button>
      </div>
    ` : `
      <div class="card" style="padding:0;overflow:hidden;">
        <table class="data-table">
          <thead><tr><th>Date</th><th>Manifest #</th><th>Customer</th><th>Pickup Address</th><th>Gallons</th><th>Waste Type</th><th>Disposal Site</th><th>Vehicle</th><th>Driver</th></tr></thead>
          <tbody>
            ${loads.map(l => {
              const hId = l.waste_hauler_id || '';
              const siteId = l.waste_site_license || '';
              return `
              <tr onclick="openDisposalDetail('${l.id}')">
                <td>${l.disposal_date}</td>
                <td>${esc(l.manifest_number || '')}</td>
                <td>${esc(l.customer_names || l.customers?.name || 'N/A')}</td>
                <td style="font-size:12px;">${esc(l.pickup_address || (l.pickup_addresses ? l.pickup_addresses.map(a => a.address).join('; ') : ''))}</td>
                <td>${l.volume_gallons?.toLocaleString() || 0}</td>
                <td>${esc(l.waste_type || '')}</td>
                <td>${esc(l.disposal_site || '')}${siteId ? '<br><span style="font-size:11px;color:#666;">ID: ' + esc(siteId) + '</span>' : ''}</td>
                <td>${esc(l.vehicle || '')}${hId ? '<br><span style="font-size:11px;color:#666;">Hauler: ' + esc(hId) + '</span>' : ''}</td>
                <td>${esc(l.users?.name || '')}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `}
  `;
}

function setDisposalRange(range) {
  const now = new Date();
  let from, to;
  if (range === 'month') {
    from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    to = formatDate(now);
  } else if (range === 'quarter') {
    const qMonth = Math.floor(now.getMonth() / 3) * 3;
    from = `${now.getFullYear()}-${String(qMonth + 1).padStart(2, '0')}-01`;
    to = formatDate(now);
  } else if (range === 'year') {
    from = `${now.getFullYear()}-01-01`;
    to = formatDate(now);
  }
  document.getElementById('disposalFilterFrom').value = from;
  document.getElementById('disposalFilterTo').value = to;
  loadDisposal();
}

function buildDisposalTableHtml(loads, users, vehicles, wasteSites, totalGallons) {
  const tankTypeToWaste = { 'Septic Tank': 'Septage', 'Septic Tank+Filter': 'Septage', 'Grease Trap': 'Grease Trap', 'Holding Tank': 'Holding Tank', 'Cesspool': 'Septage', 'Portable Toilet': 'Portable Toilet', 'Pump Chamber': 'Septage' };

  let rows = '';
  loads.forEach(l => {
    const driverUser = users.find(u => u.id === l.driver);
    const veh = vehicles.find(v => v.id === l.vehicle_id || v.name === l.vehicle);
    const haulerID = l.waste_hauler_id || veh?.waste_hauler_id || '';
    const ws = wasteSites.find(s => s.id === l.waste_site_id);
    const siteLicense = l.waste_site_license || ws?.state_license || '';
    const driverName = driverUser ? esc(driverUser.name) : '';

    if (l.pickup_addresses && l.pickup_addresses.length > 0) {
      l.pickup_addresses.forEach((pa, idx) => {
        const tankTypes = pa.tank_types || [];
        const tankDisplay = tankTypes.map(tt => esc(tt.type) + ' (' + (tt.volume || 0).toLocaleString() + ')').join(', ');
        const wasteDisplay = tankTypes.length > 0 ? [...new Set(tankTypes.map(tt => tankTypeToWaste[tt.type] || 'Septage'))].join(', ') : esc(l.waste_type || '');
        const addrStr = esc(pa.address || '') + (pa.city ? ', ' + esc(pa.city) : '');
        rows += '<tr>';
        rows += '<td>' + (idx === 0 ? l.disposal_date : '') + '</td>';
        rows += '<td class="manifest-num">' + (idx === 0 ? esc(l.manifest_number || '-') : '') + '</td>';
        rows += '<td>' + esc(pa.customer || '') + '</td>';
        rows += '<td>' + addrStr + '</td>';
        rows += '<td>' + tankDisplay + '</td>';
        rows += '<td>' + wasteDisplay + '</td>';
        rows += '<td>' + (idx === 0 ? esc(l.disposal_site || '') : '') + '</td>';
        rows += '<td>' + (idx === 0 ? esc(siteLicense) : '') + '</td>';
        rows += '<td>' + (idx === 0 ? esc(l.vehicle || '') : '') + '</td>';
        rows += '<td>' + (idx === 0 ? esc(haulerID) : '') + '</td>';
        rows += '<td>' + (idx === 0 ? driverName : '') + '</td>';
        rows += '<td class="gallons">' + (pa.gallons || 0).toLocaleString() + '</td>';
        rows += '</tr>';
      });
      // Manifest subtotal row
      rows += '<tr style="background:#f5f7fa;">';
      rows += '<td colspan="11" style="text-align:right;font-weight:600;font-size:9px;padding-right:8px;">Manifest ' + esc(l.manifest_number || '') + ' Total</td>';
      rows += '<td class="gallons" style="font-weight:700;">' + (l.volume_gallons || 0).toLocaleString() + '</td>';
      rows += '</tr>';
    } else {
      // Fallback for older records without pickup_addresses
      rows += '<tr>';
      rows += '<td>' + l.disposal_date + '</td>';
      rows += '<td class="manifest-num">' + esc(l.manifest_number || '-') + '</td>';
      rows += '<td>' + esc(l.customer_names || '') + '</td>';
      rows += '<td></td><td></td>';
      rows += '<td>' + esc(l.waste_type || '') + '</td>';
      rows += '<td>' + esc(l.disposal_site || '') + '</td>';
      rows += '<td>' + esc(siteLicense) + '</td>';
      rows += '<td>' + esc(l.vehicle || '') + '</td>';
      rows += '<td>' + esc(haulerID) + '</td>';
      rows += '<td>' + driverName + '</td>';
      rows += '<td class="gallons">' + (l.volume_gallons || 0).toLocaleString() + '</td>';
      rows += '</tr>';
    }
  });

  return '<table><thead><tr>'
    + '<th>Date</th><th>Manifest #</th><th>Customer</th><th>Pickup Address</th>'
    + '<th>Tank Type</th><th>Waste Type</th><th>Disposal Site</th><th>Site ID</th>'
    + '<th>Vehicle</th><th>Hauler ID</th><th>Driver</th><th style="text-align:right;">Gallons</th>'
    + '</tr></thead><tbody>'
    + rows
    + '<tr style="background:#f0f4f8;font-weight:700;">'
    + '<td colspan="11" style="text-align:right;padding-right:12px;border-top:2px solid #1565c0;">TOTAL</td>'
    + '<td class="gallons" style="border-top:2px solid #1565c0;">' + totalGallons.toLocaleString() + '</td>'
    + '</tr></tbody></table>';
}

async function exportDisposalPdf() {
  const dateFrom = document.getElementById('disposalFilterFrom').value;
  const dateTo = document.getElementById('disposalFilterTo').value;

  const { data: allLoads } = await window.api.getDisposalLoads();
  const loads = allLoads.filter(l => l.disposal_date >= dateFrom && l.disposal_date <= dateTo);

  if (loads.length === 0) {
    showToast('No disposal records in this date range to export.', 'error');
    return;
  }

  const { data: settings } = await window.api.getSettings();
  const { data: users } = await window.api.getUsers();
  const { data: vehicles } = await window.api.getVehicles();
  const { data: wasteSites } = await window.api.getWasteSites();
  const companyName = settings?.company_name || 'Interstate Septic Systems';
  const companyAddress = settings?.company_address || '';
  const companyPhone = settings?.company_phone || '';
  const haulerId = settings?.dep_hauler_id || '';
  const totalGallons = loads.reduce((s, l) => s + (l.volume_gallons || 0), 0);

  // Group by waste type for summary
  const byType = {};
  loads.forEach(l => {
    const t = l.waste_type || 'Other';
    byType[t] = (byType[t] || 0) + (l.volume_gallons || 0);
  });

  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <style>
      @page { size: landscape; margin: 15mm; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #333; padding: 30px; }
      .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1565c0; padding-bottom: 12px; margin-bottom: 16px; }
      .header-left h1 { font-size: 18px; color: #1565c0; margin-bottom: 2px; }
      .header-left .subtitle { font-size: 11px; color: #666; }
      .header-right { text-align: right; font-size: 11px; color: #555; }
      .header-right .report-title { font-size: 14px; font-weight: 700; color: #333; margin-bottom: 4px; }
      .summary-bar { display: flex; gap: 20px; background: #f5f7fa; padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; font-size: 11px; }
      .summary-item { }
      .summary-item .label { color: #888; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; }
      .summary-item .value { font-size: 14px; font-weight: 700; color: #1565c0; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
      thead th { background: #1565c0; color: white; padding: 6px 8px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.3px; }
      tbody td { padding: 5px 8px; border-bottom: 1px solid #e0e0e0; font-size: 10px; vertical-align: top; }
      tbody tr:nth-child(even) { background: #fafafa; }
      .manifest-num { font-weight: 700; color: #1565c0; }
      .gallons { font-weight: 600; text-align: right; }
      .footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #ddd; font-size: 9px; color: #999; display: flex; justify-content: space-between; }
      .type-summary { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 12px; }
      .type-chip { background: #e8f5e9; border: 1px solid #c8e6c9; padding: 4px 10px; border-radius: 4px; font-size: 10px; }
      .type-chip .type-name { font-weight: 600; }
      .pickup-addr { font-size: 9px; color: #666; }
      @media print { body { padding: 15px; } }
    </style>
  </head>
  <body>
    <div class="header">
      <div class="header-left">
        <h1>${esc(companyName)}</h1>
        <div class="subtitle">${esc(companyAddress)}</div>
        ${companyPhone ? `<div class="subtitle">${esc(companyPhone)}</div>` : ''}
        ${haulerId ? `<div class="subtitle">License #: ${esc(haulerId)}</div>` : ''}
      </div>
      <div class="header-right">
        <div class="report-title">Disposal Report</div>
        <div>${dateFrom} to ${dateTo}</div>
        <div>Generated: ${formatDate(new Date())}</div>
      </div>
    </div>

    <div class="summary-bar">
      <div class="summary-item">
        <div class="label">Total Records</div>
        <div class="value">${loads.length}</div>
      </div>
      <div class="summary-item">
        <div class="label">Total Gallons</div>
        <div class="value">${totalGallons.toLocaleString()}</div>
      </div>
      ${Object.entries(byType).map(([type, gal]) => `
        <div class="summary-item">
          <div class="label">${esc(type)}</div>
          <div class="value">${gal.toLocaleString()} gal</div>
        </div>
      `).join('')}
    </div>

    ${buildDisposalTableHtml(loads, users, vehicles, wasteSites, totalGallons)}

    <div class="footer">
      <div>${esc(companyName)} &bull; ${esc(companyAddress)}</div>
      <div>Page 1 of 1</div>
    </div>
  </body>
  </html>`;

  // Save dialog
  const result = await window.api.showSaveDialog({
    defaultPath: `Disposal_Report_${dateFrom}_to_${dateTo}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });

  if (result?.filePath) {
    const pdfResult = await window.api.generatePdf(html, result.filePath);
    if (pdfResult.success) {
      showToast('PDF exported successfully!', 'success');
      window.api.openFile(result.filePath);
    } else {
      showToast('Failed to generate PDF: ' + pdfResult.error, 'error');
    }
  }
}

async function openDisposalModal(load = null) {
  const isEdit = !!load;
  const l = load || {};
  const { data: customers } = await window.api.getCustomers();
  const { data: users } = await window.api.getUsers();
  const { data: wasteSites } = await window.api.getWasteSites();
  const { data: vehicles } = await window.api.getVehicles();

  openModal(isEdit ? 'Edit Disposal Load' : 'Log Disposal Load', `
    <input type="hidden" id="disposalId" value="${l.id || ''}">
    <div class="form-row">
      <div class="form-group">
        <label>Date *</label>
        <input type="date" id="disposalDate" value="${l.disposal_date || formatDate(new Date())}">
      </div>
      <div class="form-group">
        <label>Customer</label>
        <select id="disposalCustomer">
          <option value="">-- Select --</option>
          ${customers.map(c => `<option value="${c.id}" ${c.id === l.customer_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Volume (gallons) *</label>
        <input type="number" id="disposalVolume" value="${l.volume_gallons || ''}" min="1" placeholder="1000">
      </div>
      <div class="form-group">
        <label>Waste Type *</label>
        <select id="disposalWasteType">
          <option value="">-- Select --</option>
          <option value="Septage" ${l.waste_type === 'Septage' ? 'selected' : ''}>Septage</option>
          <option value="Grease Trap" ${l.waste_type === 'Grease Trap' ? 'selected' : ''}>Grease Trap</option>
          <option value="Holding Tank" ${l.waste_type === 'Holding Tank' ? 'selected' : ''}>Holding Tank</option>
          <option value="Portable Toilet" ${l.waste_type === 'Portable Toilet' ? 'selected' : ''}>Portable Toilet</option>
          <option value="Treatment Plant" ${l.waste_type === 'Treatment Plant' ? 'selected' : ''}>Treatment Plant</option>
          <option value="Other" ${l.waste_type === 'Other' ? 'selected' : ''}>Other</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Disposal Site *</label>
        <select id="disposalSiteSelect">
          <option value="">-- Select --</option>
          ${wasteSites.map(s => `<option value="${s.id}" data-name="${esc(s.name)}" data-address="${esc(s.address || '')}" ${s.id === l.waste_site_id ? 'selected' : (s.name === l.disposal_site ? 'selected' : '')}>${esc(s.name)}</option>`).join('')}
          <option value="__custom" ${l.disposal_site && !wasteSites.find(s => s.id === l.waste_site_id || s.name === l.disposal_site) ? 'selected' : ''}>Other (type in)</option>
        </select>
        <input type="text" id="disposalSiteCustom" value="${esc(l.disposal_site || '')}" placeholder="Site name" style="margin-top:4px;${l.disposal_site && !wasteSites.find(s => s.id === l.waste_site_id || s.name === l.disposal_site) ? '' : 'display:none;'}">
      </div>
      <div class="form-group">
        <label>Vehicle</label>
        <select id="disposalVehicle">
          <option value="">-- Select --</option>
          ${vehicles.map(v => `<option value="${v.name}" ${v.name === l.vehicle ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>Pickup Address</label>
      <input type="text" id="disposalPickupAddress" value="${esc(l.pickup_address || '')}" placeholder="Address where waste was collected">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Driver</label>
        <select id="disposalDriver">
          <option value="">-- Select --</option>
          ${users.map(u => `<option value="${u.id}" ${u.id === l.driver ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Manifest #</label>
        <input type="text" id="disposalManifest" value="${esc(l.manifest_number || '')}">
      </div>
    </div>
    <div class="form-group">
      <label>Notes</label>
      <textarea id="disposalNotes" placeholder="Additional notes...">${esc(l.notes || '')}</textarea>
    </div>
  `, `
    ${isEdit ? '<button class="btn btn-danger" onclick="deleteDisposalLoad()">Delete</button>' : ''}
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveDisposalLoad()">Save</button>
  `);

  // Toggle custom site input
  const siteSelect = document.getElementById('disposalSiteSelect');
  if (siteSelect) {
    siteSelect.addEventListener('change', () => {
      const customInput = document.getElementById('disposalSiteCustom');
      if (siteSelect.value === '__custom') {
        customInput.style.display = '';
        customInput.focus();
      } else {
        customInput.style.display = 'none';
      }
    });
  }
}

async function saveDisposalLoad() {
  const siteSelect = document.getElementById('disposalSiteSelect');
  const siteOption = siteSelect?.selectedOptions[0];
  let siteName = '';
  let siteId = '';
  let siteAddress = '';
  if (siteSelect?.value === '__custom') {
    siteName = document.getElementById('disposalSiteCustom').value.trim();
  } else if (siteSelect?.value) {
    siteId = siteSelect.value;
    siteName = siteOption?.dataset?.name || siteOption?.textContent || '';
    siteAddress = siteOption?.dataset?.address || '';
  }

  const data = {
    disposal_date: document.getElementById('disposalDate').value,
    customer_id: document.getElementById('disposalCustomer').value,
    volume_gallons: parseInt(document.getElementById('disposalVolume').value) || 0,
    waste_type: document.getElementById('disposalWasteType').value,
    disposal_site: siteName,
    waste_site_id: siteId,
    waste_site_address: siteAddress,
    vehicle: document.getElementById('disposalVehicle')?.value || '',
    pickup_address: document.getElementById('disposalPickupAddress')?.value?.trim() || '',
    driver: document.getElementById('disposalDriver').value || null,
    manifest_number: document.getElementById('disposalManifest').value.trim(),
    notes: document.getElementById('disposalNotes').value.trim(),
  };

  const id = document.getElementById('disposalId').value;
  if (id) data.id = id;

  if (!data.disposal_date || !data.volume_gallons || !data.waste_type || !data.disposal_site) {
    showToast('Date, gallons, waste type, and disposal site are required.', 'error');
    return;
  }

  const result = await window.api.saveDisposalLoad(data);
  if (result.success) {
    closeModal();
    showToast(id ? 'Disposal updated.' : 'Disposal logged.', 'success');
    loadDisposal();
  }
}

async function deleteDisposalLoad() {
  const id = document.getElementById('disposalId').value;
  if (!id || !confirm('Delete this disposal record?')) return;
  await window.api.deleteDisposalLoad(id);
  closeModal();
  showToast('Disposal deleted.', 'success');
  loadDisposal();
}

async function openDisposalDetail(id) {
  const loads = (await window.api.getDisposalLoads()).data;
  const load = loads.find(l => l.id === id);
  if (load) openDisposalModal(load);
}

// ===== DEP REPORTS =====
async function loadDepReports() {
  const page = document.getElementById('page-dep');
  const { data: reports } = await window.api.getDepReports();

  page.innerHTML = `
    ${reports.length === 0 ? `
      <div class="empty-state">
        <div class="empty-icon">&#128203;</div>
        <p>No DEP reports generated yet.</p>
        <button class="btn btn-primary" onclick="openDepReportModal()">+ Generate Report</button>
      </div>
    ` : `
      <div class="card" style="padding:0;overflow:hidden;">
        <table class="data-table">
          <thead><tr><th>Period</th><th>Total Loads</th><th>Total Gallons</th><th>Generated</th><th>Sent</th></tr></thead>
          <tbody>
            ${reports.map(r => `
              <tr>
                <td><strong>${esc(r.report_period)}</strong></td>
                <td>${r.total_loads}</td>
                <td>${r.total_gallons?.toLocaleString() || 0}</td>
                <td>${r.generated_at ? r.generated_at.split('T')[0] : ''}</td>
                <td>${r.sent_at ? r.sent_at.split('T')[0] : '<span class="badge badge-pending">Not sent</span>'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `}
  `;
}

function openDepReportModal() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed

  openModal('Generate DEP Report', `
    <div class="form-group">
      <label>Report Period</label>
      <select id="depPeriodType">
        <option value="month">Monthly</option>
        <option value="quarter">Quarterly</option>
      </select>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Year</label>
        <input type="number" id="depYear" value="${year}" min="2020" max="2030">
      </div>
      <div class="form-group">
        <label>Month / Quarter</label>
        <select id="depPeriod">
          <option value="1" ${month === 0 ? 'selected' : ''}>January</option>
          <option value="2" ${month === 1 ? 'selected' : ''}>February</option>
          <option value="3" ${month === 2 ? 'selected' : ''}>March</option>
          <option value="4" ${month === 3 ? 'selected' : ''}>April</option>
          <option value="5" ${month === 4 ? 'selected' : ''}>May</option>
          <option value="6" ${month === 5 ? 'selected' : ''}>June</option>
          <option value="7" ${month === 6 ? 'selected' : ''}>July</option>
          <option value="8" ${month === 7 ? 'selected' : ''}>August</option>
          <option value="9" ${month === 8 ? 'selected' : ''}>September</option>
          <option value="10" ${month === 9 ? 'selected' : ''}>October</option>
          <option value="11" ${month === 10 ? 'selected' : ''}>November</option>
          <option value="12" ${month === 11 ? 'selected' : ''}>December</option>
        </select>
      </div>
    </div>
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="generateDepReport()">Generate</button>
  `);
}

async function generateDepReport() {
  const year = document.getElementById('depYear').value;
  const periodVal = parseInt(document.getElementById('depPeriod').value);
  const type = document.getElementById('depPeriodType').value;

  let from, to, label;
  if (type === 'month') {
    from = `${year}-${String(periodVal).padStart(2,'0')}-01`;
    const lastDay = new Date(year, periodVal, 0).getDate();
    to = `${year}-${String(periodVal).padStart(2,'0')}-${lastDay}`;
    const monthNames = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    label = `${monthNames[periodVal]} ${year}`;
  } else {
    const q = Math.ceil(periodVal / 3);
    const startMonth = (q - 1) * 3 + 1;
    from = `${year}-${String(startMonth).padStart(2,'0')}-01`;
    const endMonth = q * 3;
    const lastDay = new Date(year, endMonth, 0).getDate();
    to = `${year}-${String(endMonth).padStart(2,'0')}-${lastDay}`;
    label = `Q${q} ${year}`;
  }

  const result = await window.api.generateDepReport({ from, to, label });
  if (result.success) {
    closeModal();
    showToast('DEP report generated.', 'success');
    loadDepReports();
  } else {
    showToast(result.error || 'Failed to generate.', 'error');
  }
}

// ===== REMINDERS =====
// ===== SERVICE DUE NOTICES PAGE =====
let sdnFilters = { page: 1, perPage: 35, status: '', dueDateFrom: '', dueDateTo: '', search: '', _preset: 'All Time' };
let selectedSdnIds = new Set();

async function loadServiceDueNotices() {
  const page = document.getElementById('page-sdn');
  const filters = {};
  if (sdnFilters.status) filters.status = sdnFilters.status;
  if (sdnFilters.dueDateFrom) filters.dueDateFrom = sdnFilters.dueDateFrom;
  if (sdnFilters.dueDateTo) filters.dueDateTo = sdnFilters.dueDateTo;
  if (sdnFilters.search) filters.search = sdnFilters.search;

  const { data: allNotices } = await window.api.getServiceDueNotices(filters);
  const today = new Date().toISOString().split('T')[0];
  const thisMonthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().split('T')[0];

  // Stats
  const totalCount = allNotices.length;
  const overdueCount = allNotices.filter(n => n.is_overdue).length;
  const dueThisMonth = allNotices.filter(n => n.status === 'pending' && n.due_date && n.due_date >= today && n.due_date <= thisMonthEnd).length;
  const sentCount = allNotices.filter(n => n.status === 'sent').length;

  // Pagination
  const totalPages = Math.ceil(totalCount / sdnFilters.perPage);
  const startIdx = (sdnFilters.page - 1) * sdnFilters.perPage;
  const notices = allNotices.slice(startIdx, startIdx + sdnFilters.perPage);

  // Date range display
  const dateFrom = sdnFilters.dueDateFrom || '';
  const dateTo = sdnFilters.dueDateTo || '';
  const dateRange = dateFrom || dateTo ? `${dateFrom || 'Start'} – ${dateTo || 'Present'}` : 'All Time';

  page.innerHTML = `
    <div style="display:flex;gap:0;height:calc(100vh - 120px);">
      <!-- FILTER SIDEBAR -->
      <div class="inv-filter-sidebar">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <strong style="font-size:12px;text-transform:uppercase;letter-spacing:1px;">Filter Notices</strong>
          <a href="#" onclick="event.preventDefault();sdnClearFilters()" style="font-size:11px;">Clear All</a>
        </div>

        <label class="inv-filter-label">Search</label>
        <input type="text" class="inv-filter-input" placeholder="Customer, property, service..."
          value="${esc(sdnFilters.search || '')}"
          oninput="clearTimeout(window._sdnSearchTimer);window._sdnSearchTimer=setTimeout(()=>{sdnFilters.search=this.value;sdnFilters.page=1;loadServiceDueNotices()},400)">

        <label class="inv-filter-label">Status</label>
        <select class="inv-filter-select" onchange="sdnFilters.status=this.value;sdnFilters.page=1;loadServiceDueNotices()">
          <option value="">All</option>
          <option value="pending" ${sdnFilters.status === 'pending' ? 'selected' : ''}>Pending</option>
          <option value="overdue" ${sdnFilters.status === 'overdue' ? 'selected' : ''}>Overdue</option>
          <option value="sent" ${sdnFilters.status === 'sent' ? 'selected' : ''}>Sent</option>
          <option value="completed" ${sdnFilters.status === 'completed' ? 'selected' : ''}>Completed</option>
          <option value="dismissed" ${sdnFilters.status === 'dismissed' ? 'selected' : ''}>Dismissed</option>
        </select>

        <label class="inv-filter-label">Due Date Range</label>
        <div class="inv-date-preset-wrap">
          <div class="inv-date-preset-header">
            <button class="inv-date-nav" onclick="sdnDatePresetNav(-1)">&lt;</button>
            <span class="inv-date-preset-current" id="sdnDatePresetLabel">${sdnFormatPresetLabel()}</span>
            <button class="inv-date-nav" onclick="sdnDatePresetNav(1)">&gt;</button>
          </div>
          <div class="inv-date-preset-grid">
            ${['Today','This Week','This Month','This Quarter','This Year','Next Month','Next Quarter','Next Year','All Time','Custom'].map(p =>
              `<button class="inv-date-preset-btn ${(sdnFilters._preset || 'All Time') === p ? 'active' : ''}" onclick="sdnApplyDatePreset('${p}')">${p}</button>`
            ).join('')}
          </div>
          <div class="inv-date-custom-row" id="sdnDateCustomRow" style="display:${sdnFilters._preset === 'Custom' ? 'flex' : 'none'}">
            <input type="date" class="inv-filter-input" value="${sdnFilters.dueDateFrom || ''}" onchange="sdnFilters.dueDateFrom=this.value;sdnFilters.page=1;loadServiceDueNotices()">
            <span style="font-size:11px;">to</span>
            <input type="date" class="inv-filter-input" value="${sdnFilters.dueDateTo || ''}" onchange="sdnFilters.dueDateTo=this.value;sdnFilters.page=1;loadServiceDueNotices()">
          </div>
          <div class="inv-date-range-display">${dateRange}</div>
        </div>
      </div>

      <!-- MAIN CONTENT -->
      <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
        <!-- STATS BAR -->
        <div style="display:flex;gap:12px;padding:10px 16px;border-bottom:1px solid #e0e0e0;background:#fafafa;">
          <div style="font-size:12px;"><strong style="font-size:18px;color:var(--primary);">${totalCount}</strong> Total</div>
          <div style="font-size:12px;"><strong style="font-size:18px;color:#ff9800;">${dueThisMonth}</strong> Due This Month</div>
          <div style="font-size:12px;"><strong style="font-size:18px;color:#f44336;">${overdueCount}</strong> Overdue</div>
          <div style="font-size:12px;"><strong style="font-size:18px;color:#2196f3;">${sentCount}</strong> Sent</div>
        </div>

        <!-- BATCH ACTIONS -->
        ${selectedSdnIds.size > 0 ? `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 16px;background:#fff3e0;border-bottom:1px solid #e0e0e0;">
          <strong style="font-size:12px;">${selectedSdnIds.size} selected</strong>
          <button class="btn btn-sm" style="background:#f44336;color:white;border:none;font-size:11px;padding:3px 10px;" onclick="sdnBatchDelete()">🗑 Delete Selected</button>
          <button class="btn btn-sm btn-secondary" style="font-size:11px;padding:3px 10px;" onclick="selectedSdnIds.clear();loadServiceDueNotices()">Clear Selection</button>
        </div>` : ''}

        <!-- TABLE -->
        <div class="inv-table-wrap" style="flex:1;overflow:auto;">
          <table class="inv-table sdn-table">
            <thead>
              <tr>
                <th style="width:32px;"><input type="checkbox" onchange="sdnToggleAll(this.checked)" ${selectedSdnIds.size > 0 && selectedSdnIds.size === notices.length ? 'checked' : ''}></th>
                <th style="width:40px;">#</th>
                <th>Customer</th>
                <th>Property</th>
                <th>Service Type</th>
                <th>Due Date</th>
                <th>Days</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${notices.length === 0 ? '<tr><td colspan="8" style="text-align:center;color:var(--text-light);padding:40px;">No service due notices found.</td></tr>' : ''}
              ${notices.map((n, idx) => {
                const rowNum = startIdx + idx + 1;
                const rowClass = n.is_overdue ? 'sdn-overdue-row' : (n.days_until_due !== null && n.days_until_due <= 30 && n.days_until_due >= 0 && n.status === 'pending') ? 'sdn-due-soon-row' : '';
                const statusColors = { pending: '#ff9800', sent: '#2196f3', overdue: '#f44336', completed: '#4caf50', dismissed: '#9e9e9e' };
                const statusColor = n.is_overdue ? '#f44336' : n.status === 'pending' ? (n.email_enabled !== false ? '#388e3c' : '#9e9e9e') : (statusColors[n.status] || '#999');
                const statusText = n.is_overdue ? 'OVERDUE' : n.status === 'pending' ? (n.email_enabled !== false ? 'Email ON' : 'Email OFF') : (n.status || '').toUpperCase();
                const daysText = n.days_until_due !== null ? (n.days_until_due < 0 ? `${Math.abs(n.days_until_due)}d ago` : n.days_until_due === 0 ? 'Today' : `${n.days_until_due}d`) : '-';
                const isSelected = selectedSdnIds.has(n.id);
                return `<tr class="${rowClass} ${isSelected ? 'inv-row-selected' : ''}" style="cursor:pointer;" onclick="openServiceDueNoticeModal(${JSON.stringify(n).replace(/"/g, '&quot;')},'${n.customer_id || ''}','${n.property_id || ''}')">
                  <td onclick="event.stopPropagation()"><input type="checkbox" ${isSelected ? 'checked' : ''} onchange="sdnToggleOne('${n.id}', this.checked)"></td>
                  <td style="font-size:11px;color:var(--text-light);">${rowNum}</td>
                  <td style="font-weight:600;">${esc(n.customer?.name || 'Unknown')}</td>
                  <td style="font-size:11px;">${esc(n.property?.address || '-')}</td>
                  <td>${esc(n.service_type || '-')}</td>
                  <td style="font-weight:600;">${n.due_date || '-'}</td>
                  <td style="font-weight:600;color:${n.is_overdue ? '#f44336' : n.days_until_due <= 30 ? '#ff9800' : 'inherit'};">${daysText}</td>
                  <td><span class="badge" style="font-size:9px;padding:2px 6px;border-radius:3px;background:${statusColor};color:white;">${statusText}</span></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>

        <!-- PAGINATION -->
        ${totalPages > 1 ? `
        <div style="display:flex;justify-content:center;align-items:center;gap:8px;padding:8px;border-top:1px solid #e0e0e0;">
          <button class="btn btn-secondary" style="font-size:11px;padding:4px 10px;" onclick="sdnFilters.page=Math.max(1,sdnFilters.page-1);loadServiceDueNotices()" ${sdnFilters.page <= 1 ? 'disabled' : ''}>&lt; Prev</button>
          <span style="font-size:12px;">Page ${sdnFilters.page} of ${totalPages}</span>
          <button class="btn btn-secondary" style="font-size:11px;padding:4px 10px;" onclick="sdnFilters.page=Math.min(${totalPages},sdnFilters.page+1);loadServiceDueNotices()" ${sdnFilters.page >= totalPages ? 'disabled' : ''}>Next &gt;</button>
        </div>` : ''}
      </div>
    </div>`;
}

function sdnClearFilters() {
  sdnFilters = { page: 1, perPage: 35, status: '', dueDateFrom: '', dueDateTo: '', search: '', _preset: 'All Time' };
  selectedSdnIds.clear();
  loadServiceDueNotices();
}

function sdnToggleAll(checked) {
  document.querySelectorAll('.sdn-table tbody input[type="checkbox"]').forEach(cb => {
    cb.checked = checked;
    const row = cb.closest('tr');
    const onclick = row?.getAttribute('onclick') || '';
    const idMatch = onclick.match(/"id":"([^"]+)"/);
    if (idMatch) checked ? selectedSdnIds.add(idMatch[1]) : selectedSdnIds.delete(idMatch[1]);
  });
  loadServiceDueNotices();
}

function sdnToggleOne(id, checked) {
  checked ? selectedSdnIds.add(id) : selectedSdnIds.delete(id);
  loadServiceDueNotices();
}

async function sdnBatchDelete() {
  if (selectedSdnIds.size === 0) return;
  if (!confirm(`Delete ${selectedSdnIds.size} service due notice(s)?`)) return;
  for (const id of selectedSdnIds) {
    await window.api.deleteServiceDueNotice(id);
  }
  showToast(`Deleted ${selectedSdnIds.size} notice(s).`, 'success');
  selectedSdnIds.clear();
  loadServiceDueNotices();
}

function sdnGetDateRange(preset, refDate) {
  const d = refDate ? new Date(refDate) : new Date();
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const fmt = (dt) => dt.toISOString().split('T')[0];
  switch (preset) {
    case 'Today': return { from: fmt(today), to: fmt(today) };
    case 'This Week': { const s = new Date(today); s.setDate(s.getDate()-s.getDay()); const e = new Date(s); e.setDate(e.getDate()+6); return { from: fmt(s), to: fmt(e) }; }
    case 'This Month': { const s = new Date(d.getFullYear(), d.getMonth(), 1); const e = new Date(d.getFullYear(), d.getMonth()+1, 0); return { from: fmt(s), to: fmt(e) }; }
    case 'This Quarter': { const q = Math.floor(d.getMonth()/3); const s = new Date(d.getFullYear(), q*3, 1); const e = new Date(d.getFullYear(), q*3+3, 0); return { from: fmt(s), to: fmt(e) }; }
    case 'This Year': return { from: `${d.getFullYear()}-01-01`, to: `${d.getFullYear()}-12-31` };
    case 'Next Month': { const s = new Date(d.getFullYear(), d.getMonth()+1, 1); const e = new Date(d.getFullYear(), d.getMonth()+2, 0); return { from: fmt(s), to: fmt(e) }; }
    case 'Next Quarter': { const q = Math.floor(d.getMonth()/3)+1; const s = new Date(d.getFullYear(), q*3, 1); const e = new Date(d.getFullYear(), q*3+3, 0); return { from: fmt(s), to: fmt(e) }; }
    case 'Next Year': return { from: `${d.getFullYear()+1}-01-01`, to: `${d.getFullYear()+1}-12-31` };
    case 'All Time': default: return { from: '', to: '' };
  }
}

function sdnFormatPresetLabel() {
  const preset = sdnFilters._preset || 'All Time';
  if (preset === 'All Time') return 'All Time';
  if (preset === 'Custom') return 'Custom';
  const from = sdnFilters.dueDateFrom;
  const to = sdnFilters.dueDateTo;
  if (!from && !to) return 'All Time';
  const fmtNice = (d) => {
    const dt = new Date(d + 'T00:00:00');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()}`;
  };
  if (from === to) return fmtNice(from);
  return `${fmtNice(from)} – ${fmtNice(to)}`;
}

function sdnApplyDatePreset(preset) {
  sdnFilters._preset = preset;
  if (preset === 'Custom') {
    document.getElementById('sdnDateCustomRow').style.display = 'flex';
    const lbl = document.getElementById('sdnDatePresetLabel');
    if (lbl) lbl.textContent = 'Custom';
    return;
  }
  document.getElementById('sdnDateCustomRow').style.display = 'none';
  const range = sdnGetDateRange(preset);
  sdnFilters.dueDateFrom = range.from || '';
  sdnFilters.dueDateTo = range.to || '';
  sdnFilters._presetRef = undefined;
  sdnFilters.page = 1;
  loadServiceDueNotices();
}

function sdnDatePresetNav(dir) {
  const preset = sdnFilters._preset || 'All Time';
  if (preset === 'All Time' || preset === 'Custom') return;
  let ref = sdnFilters._presetRef ? new Date(sdnFilters._presetRef) : new Date();
  switch (preset) {
    case 'Today': ref.setDate(ref.getDate() + dir); break;
    case 'This Week': ref.setDate(ref.getDate() + dir * 7); break;
    case 'This Month': case 'Next Month': ref.setMonth(ref.getMonth() + dir); break;
    case 'This Quarter': case 'Next Quarter': ref.setMonth(ref.getMonth() + dir * 3); break;
    case 'This Year': case 'Next Year': ref.setFullYear(ref.getFullYear() + dir); break;
  }
  sdnFilters._presetRef = ref.toISOString().split('T')[0];
  const range = sdnGetDateRange(preset, ref);
  sdnFilters.dueDateFrom = range.from || '';
  sdnFilters.dueDateTo = range.to || '';
  sdnFilters.page = 1;
  loadServiceDueNotices();
}

// ===== REMINDERS =====
async function loadReminders() {
  const page = document.getElementById('page-reminders');
  const { data: reminders } = await window.api.getReminders();
  const today = new Date().toISOString().split('T')[0];

  // Check if current user has any pending reminders due today or past
  const myReminders = reminders.filter(r =>
    r.status === 'pending' && r.due_date && r.due_date <= today &&
    (r.assigned_users || []).includes(currentUser?.id)
  );
  // Update nav badge
  const navBtn = document.querySelector('.nav-item[data-page="reminders"]');
  if (navBtn) {
    const existingBadge = navBtn.querySelector('.reminder-nav-badge');
    if (existingBadge) existingBadge.remove();
    if (myReminders.length > 0) {
      navBtn.insertAdjacentHTML('beforeend', `<span class="reminder-nav-badge" style="background:#f44336;color:white;font-size:9px;font-weight:700;padding:1px 5px;border-radius:8px;margin-left:6px;">${myReminders.length}</span>`);
    }
  }

  const noteColors = ['#fff9c4','#c8e6c9','#bbdefb','#f8bbd0','#d1c4e9','#ffe0b2','#b2dfdb','#f0f4c3'];

  page.innerHTML = `
    <div style="padding:16px;overflow-y:auto;height:calc(100vh - 120px);">
      ${reminders.length === 0 ? `
        <div class="empty-state">
          <div class="empty-icon">&#128276;</div>
          <p>No reminders yet. Create one to get started!</p>
        </div>
      ` : ''}
      <div style="display:flex;flex-wrap:wrap;gap:16px;align-content:flex-start;">
        ${reminders.map((r, idx) => {
          const color = noteColors[idx % noteColors.length];
          const isOverdue = r.due_date && r.due_date < today && r.status === 'pending';
          const isDone = r.status === 'done';
          const isToday = r.due_date === today;
          const userDots = (r.assigned_user_names || []).map(u =>
            `<span title="${esc(u.name)}" style="display:inline-block;width:22px;height:22px;border-radius:50%;background:${u.color};color:white;font-size:10px;font-weight:700;text-align:center;line-height:22px;">${esc(u.name.charAt(0))}</span>`
          ).join('');

          const fmtDate = r.due_date ? (() => {
            const d = new Date(r.due_date + 'T00:00:00');
            const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
          })() : '';
          const fmtTime = r.due_time ? (() => {
            const [h,m] = r.due_time.split(':');
            const hr = parseInt(h);
            return `${hr > 12 ? hr - 12 : hr || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`;
          })() : '';

          return `
          <div class="reminder-note" style="background:${isDone ? '#e0e0e0' : color};${isOverdue ? 'border:2px solid #f44336;' : ''}${isDone ? 'opacity:0.6;' : ''}width:260px;min-height:180px;padding:16px;border-radius:6px;box-shadow:2px 3px 10px rgba(0,0,0,0.12);display:flex;flex-direction:column;position:relative;transition:transform 0.15s;cursor:default;">
            ${isOverdue ? '<div style="position:absolute;top:-8px;right:-8px;background:#f44336;color:white;font-size:14px;font-weight:700;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 4px rgba(0,0,0,0.3);">!</div>' : ''}
            ${isToday && !isDone ? '<div style="position:absolute;top:-8px;left:-8px;background:#ff9800;color:white;font-size:9px;font-weight:700;padding:2px 6px;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.2);">TODAY</div>' : ''}
            <div style="font-size:12px;font-weight:700;color:#555;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
              <span>${fmtDate}${fmtTime ? ' &middot; ' + fmtTime : ''}</span>
              <div style="display:flex;gap:4px;">
                ${!isDone ? `<span title="Mark done" style="cursor:pointer;font-size:16px;" onclick="event.stopPropagation();markReminderDone('${r.id}')">&#9989;</span>` : '<span style="font-size:11px;color:#666;">DONE</span>'}
                <span title="Delete" style="cursor:pointer;font-size:16px;" onclick="event.stopPropagation();deleteReminder('${r.id}')">&#128465;</span>
              </div>
            </div>
            <div style="flex:1;font-size:14px;line-height:1.5;color:#333;white-space:pre-wrap;word-break:break-word;${isDone ? 'text-decoration:line-through;' : ''}">${esc(r.message || 'No message')}</div>
            ${r.alert_before ? `<div style="font-size:11px;color:#666;margin-top:4px;">🔔 ${{
              '15m': '15 min before',
              '1h': '1 hour before',
              'start_of_day': 'Start of day',
              '1d': 'Day before',
              '7d': '7 days before'
            }[r.alert_before] || r.alert_before}</div>` : ''}
            <div style="margin-top:10px;display:flex;justify-content:space-between;align-items:center;">
              <div style="display:flex;gap:3px;">${userDots || '<span style="font-size:11px;color:#999;">No one assigned</span>'}</div>
              <span title="Edit" style="cursor:pointer;font-size:13px;color:#666;" onclick="event.stopPropagation();openReminderModal(${JSON.stringify(r).replace(/"/g, '&quot;')})">&#9998; edit</span>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
  `;
}

async function openReminderModal(reminder = null) {
  const isEdit = !!reminder;
  const r = reminder || {};
  const { data: users } = await window.api.getUsers();
  const assignedUsers = r.assigned_users || [];
  const todayStr = new Date().toISOString().split('T')[0];

  openModal(isEdit ? 'Edit Reminder' : 'New Reminder', `
    <input type="hidden" id="reminderId" value="${r.id || ''}">
    <div class="form-group">
      <label>What do you need to remember?</label>
      <textarea id="reminderMessage" rows="4" style="font-size:14px;resize:vertical;" placeholder="Type anything here...">${esc(r.message || '')}</textarea>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Date *</label>
        <input type="date" id="reminderDueDate" value="${r.due_date || todayStr}">
      </div>
      <div class="form-group">
        <label>Time</label>
        <input type="time" id="reminderDueTime" value="${r.due_time || ''}">
      </div>
      <div class="form-group">
        <label>Alert Me</label>
        <select id="reminderAlertBefore" class="form-control">
          ${[
            { value: '', label: 'No alert' },
            { value: '15m', label: '15 minutes before' },
            { value: '1h', label: '1 hour before' },
            { value: 'start_of_day', label: 'Start of the day' },
            { value: '1d', label: 'Day before' },
            { value: '7d', label: '7 days before' },
          ].map(o => `<option value="${o.value}" ${(r.alert_before || '') === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>Who's involved?</label>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;">
        ${users.map(u => `
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:4px 10px;border-radius:16px;border:2px solid ${assignedUsers.includes(u.id) ? (u.color || '#1565c0') : '#ddd'};background:${assignedUsers.includes(u.id) ? (u.color || '#1565c0') + '20' : 'white'};transition:all 0.15s;">
            <input type="checkbox" class="reminder-user-check" value="${u.id}" ${assignedUsers.includes(u.id) ? 'checked' : ''} style="display:none;">
            <span style="width:20px;height:20px;border-radius:50%;background:${u.color || '#1565c0'};color:white;font-size:10px;font-weight:700;text-align:center;line-height:20px;display:inline-block;">${esc(u.name.charAt(0))}</span>
            <span style="font-size:13px;font-weight:${assignedUsers.includes(u.id) ? '600' : '400'};">${esc(u.name)}</span>
          </label>
        `).join('')}
      </div>
    </div>
  `, `
    ${isEdit ? `<button class="btn btn-danger" onclick="deleteReminder('${r.id}')">Delete</button>` : ''}
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveReminder()">Save</button>
  `);

  // Wire up pill toggle styling
  document.querySelectorAll('.reminder-user-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const label = cb.closest('label');
      const color = cb.nextElementSibling?.style?.background || '#1565c0';
      if (cb.checked) {
        label.style.borderColor = color;
        label.style.background = color + '20';
        label.querySelector('span:last-child').style.fontWeight = '600';
      } else {
        label.style.borderColor = '#ddd';
        label.style.background = 'white';
        label.querySelector('span:last-child').style.fontWeight = '400';
      }
    });
  });
}

async function saveReminder() {
  const message = document.getElementById('reminderMessage').value.trim();
  const dueDate = document.getElementById('reminderDueDate').value;
  const dueTime = document.getElementById('reminderDueTime').value;
  const assignedUsers = Array.from(document.querySelectorAll('.reminder-user-check:checked')).map(cb => cb.value);
  const id = document.getElementById('reminderId').value;

  if (!message) { showToast('Please type a reminder message.', 'error'); return; }
  if (!dueDate) { showToast('Date is required.', 'error'); return; }

  const alertBefore = document.getElementById('reminderAlertBefore').value;

  const data = {
    message,
    due_date: dueDate,
    due_time: dueTime || null,
    alert_before: alertBefore || null,
    assigned_users: assignedUsers,
    status: 'pending',
  };
  if (id) { data.id = id; delete data.status; } // Keep existing status on edit

  const result = await window.api.saveReminder(data);
  if (result.success) {
    closeModal();
    showToast(id ? 'Reminder updated.' : 'Reminder created!', 'success');
    loadReminders();
    updateReminderBadge();
  }
}

async function deleteReminder(id) {
  if (!confirm('Delete this reminder?')) return;
  closeModal();
  await window.api.deleteReminder(id);
  showToast('Reminder deleted.', 'success');
  loadReminders();
  updateReminderBadge();
}

async function markReminderDone(id) {
  await window.api.updateReminderStatus(id, 'done');
  showToast('Reminder marked done!', 'success');
  loadReminders();
  updateReminderBadge();
}

// ===== REPORTS =====
let reportDateFrom = '';
let reportDateTo = '';

async function loadReports() {
  const page = document.getElementById('page-reports');
  // Default date range: current month
  const now = new Date();
  if (!reportDateFrom) {
    reportDateFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  }
  if (!reportDateTo) {
    reportDateTo = formatDate(now);
  }

  // Load all invoices in date range
  const { data: allInvoices } = await window.api.getInvoices({});
  const { data: allJobs } = await window.api.getJobs({});
  const { data: categories } = await window.api.getServiceCategories();
  const { data: vehicles } = await window.api.getVehicles();

  // Filter invoices by date range
  const invoices = allInvoices.filter(inv => {
    const d = inv.svc_date || inv.created_at?.split('T')[0] || '';
    return d >= reportDateFrom && d <= reportDateTo;
  });

  // Filter jobs by date range
  const jobs = allJobs.filter(j => {
    const d = j.scheduled_date || '';
    return d >= reportDateFrom && d <= reportDateTo;
  });

  // Revenue by service type
  const serviceRevenue = {};
  invoices.forEach(inv => {
    if (inv.line_items && Array.isArray(inv.line_items)) {
      inv.line_items.forEach(li => {
        const name = li.description || li.name || 'Other';
        if (!serviceRevenue[name]) serviceRevenue[name] = { qty: 0, revenue: 0 };
        serviceRevenue[name].qty += (li.quantity || 1);
        serviceRevenue[name].revenue += (li.amount || li.total || 0);
      });
    } else {
      const name = inv.service_type || inv.job_type || 'Pumping';
      if (!serviceRevenue[name]) serviceRevenue[name] = { qty: 0, revenue: 0 };
      serviceRevenue[name].qty += 1;
      serviceRevenue[name].revenue += (inv.total || inv.amount || 0);
    }
  });
  const sortedServices = Object.entries(serviceRevenue).sort((a, b) => b[1].revenue - a[1].revenue);

  // Revenue by tech
  const techRevenue = {};
  invoices.forEach(inv => {
    const tech = inv.tech_name || inv.technician || 'Unassigned';
    if (!techRevenue[tech]) techRevenue[tech] = { jobs: 0, revenue: 0 };
    techRevenue[tech].jobs += 1;
    techRevenue[tech].revenue += (inv.total || inv.amount || 0);
  });
  const sortedTechs = Object.entries(techRevenue).sort((a, b) => b[1].revenue - a[1].revenue);

  // Revenue by truck
  const truckRevenue = {};
  invoices.forEach(inv => {
    const truck = inv.vehicle_name || 'Unassigned';
    if (!truckRevenue[truck]) truckRevenue[truck] = { jobs: 0, revenue: 0, gallons: 0 };
    truckRevenue[truck].jobs += 1;
    truckRevenue[truck].revenue += (inv.total || inv.amount || 0);
    truckRevenue[truck].gallons += (inv.gallons_pumped || 0);
  });
  const sortedTrucks = Object.entries(truckRevenue).sort((a, b) => b[1].revenue - a[1].revenue);

  // Daily revenue for chart
  const dailyRevenue = {};
  invoices.forEach(inv => {
    const d = inv.svc_date || inv.created_at?.split('T')[0] || '';
    if (!dailyRevenue[d]) dailyRevenue[d] = 0;
    dailyRevenue[d] += (inv.total || inv.amount || 0);
  });
  const dailyDates = Object.keys(dailyRevenue).sort();

  // Job status counts
  const statusCounts = { completed: 0, scheduled: 0, in_progress: 0, cancelled: 0 };
  jobs.forEach(j => {
    const s = j.status || 'scheduled';
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  });

  // Totals
  const totalRevenue = invoices.reduce((sum, inv) => sum + (inv.total || inv.amount || 0), 0);
  const totalJobs = jobs.length;
  const totalGallons = invoices.reduce((sum, inv) => sum + (inv.gallons_pumped || 0), 0);
  const avgPerJob = invoices.length > 0 ? totalRevenue / invoices.length : 0;

  // Quick period buttons
  const todayStr = formatDate(now);
  const thisMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const thisYearStart = `${now.getFullYear()}-01-01`;
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const lastMonthStart = `${lastMonthEnd.getFullYear()}-${String(lastMonthEnd.getMonth() + 1).padStart(2, '0')}-01`;
  const lastMonthEndStr = formatDate(lastMonthEnd);
  // This week (Mon-Sun)
  const mon = getMonday(now);
  const thisWeekStart = formatDate(mon);

  // Max bar width for chart
  const maxDailyRev = dailyDates.length > 0 ? Math.max(...dailyDates.map(d => dailyRevenue[d])) : 1;
  const maxServiceRev = sortedServices.length > 0 ? sortedServices[0][1].revenue : 1;

  page.innerHTML = `
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:20px;flex-wrap:wrap;">
      <div style="display:flex;gap:6px;">
        <button class="btn btn-sm ${reportDateFrom === thisWeekStart && reportDateTo === todayStr ? 'btn-primary' : 'btn-secondary'}" onclick="setReportPeriod('${thisWeekStart}','${todayStr}')">This Week</button>
        <button class="btn btn-sm ${reportDateFrom === thisMonthStart && reportDateTo === todayStr ? 'btn-primary' : 'btn-secondary'}" onclick="setReportPeriod('${thisMonthStart}','${todayStr}')">This Month</button>
        <button class="btn btn-sm ${reportDateFrom === lastMonthStart && reportDateTo === lastMonthEndStr ? 'btn-primary' : 'btn-secondary'}" onclick="setReportPeriod('${lastMonthStart}','${lastMonthEndStr}')">Last Month</button>
        <button class="btn btn-sm ${reportDateFrom === thisYearStart && reportDateTo === todayStr ? 'btn-primary' : 'btn-secondary'}" onclick="setReportPeriod('${thisYearStart}','${todayStr}')">YTD</button>
        <button class="btn btn-sm btn-secondary" onclick="setReportPeriod('2019-10-01','${todayStr}')">All Time</button>
      </div>
      <div style="display:flex;gap:6px;align-items:center;">
        <input type="date" id="reportFrom" value="${reportDateFrom}" onchange="reportDateFrom=this.value;loadReports();" style="padding:4px 8px;">
        <span>to</span>
        <input type="date" id="reportTo" value="${reportDateTo}" onchange="reportDateTo=this.value;loadReports();" style="padding:4px 8px;">
      </div>
    </div>

    <!-- KPI Cards -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px;">
      <div class="card" style="text-align:center;padding:20px;">
        <div style="font-size:28px;font-weight:700;color:var(--primary);">$${totalRevenue.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
        <div style="font-size:13px;color:var(--text-light);margin-top:4px;">Total Revenue</div>
      </div>
      <div class="card" style="text-align:center;padding:20px;">
        <div style="font-size:28px;font-weight:700;color:#2196f3;">${totalJobs}</div>
        <div style="font-size:13px;color:var(--text-light);margin-top:4px;">Total Jobs</div>
      </div>
      <div class="card" style="text-align:center;padding:20px;">
        <div style="font-size:28px;font-weight:700;color:#4caf50;">${totalGallons.toLocaleString()}</div>
        <div style="font-size:13px;color:var(--text-light);margin-top:4px;">Gallons Pumped</div>
      </div>
      <div class="card" style="text-align:center;padding:20px;">
        <div style="font-size:28px;font-weight:700;color:#ff9800;">$${avgPerJob.toFixed(2)}</div>
        <div style="font-size:13px;color:var(--text-light);margin-top:4px;">Avg per Invoice</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
      <!-- Revenue by Service -->
      <div class="card">
        <div class="card-header"><h3>Revenue by Service</h3></div>
        ${sortedServices.length === 0 ? '<p style="color:var(--text-light);padding:20px;">No invoice data in this period.</p>' : `
          <div style="max-height:400px;overflow-y:auto;">
            ${sortedServices.map(([name, data]) => `
              <div style="padding:8px 12px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border);">
                <div style="flex:1;min-width:0;">
                  <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(name)}</div>
                  <div style="height:6px;border-radius:3px;background:var(--border);margin-top:4px;">
                    <div style="height:100%;border-radius:3px;background:var(--primary);width:${(data.revenue / maxServiceRev * 100).toFixed(1)}%;"></div>
                  </div>
                </div>
                <div style="text-align:right;white-space:nowrap;">
                  <div style="font-weight:600;">$${data.revenue.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
                  <div style="font-size:11px;color:var(--text-light);">${data.qty} qty</div>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>

      <!-- Revenue by Technician -->
      <div class="card">
        <div class="card-header"><h3>Revenue by Technician</h3></div>
        ${sortedTechs.length === 0 ? '<p style="color:var(--text-light);padding:20px;">No data.</p>' : `
          <table class="data-table" style="margin:0;">
            <thead><tr><th>Technician</th><th style="text-align:right;">Jobs</th><th style="text-align:right;">Revenue</th></tr></thead>
            <tbody>
              ${sortedTechs.map(([name, data]) => `
                <tr>
                  <td>${esc(name)}</td>
                  <td style="text-align:right;">${data.jobs}</td>
                  <td style="text-align:right;font-weight:600;">$${data.revenue.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `}
      </div>

      <!-- Revenue by Truck -->
      <div class="card">
        <div class="card-header"><h3>Revenue by Truck</h3></div>
        ${sortedTrucks.length === 0 ? '<p style="color:var(--text-light);padding:20px;">No data.</p>' : `
          <table class="data-table" style="margin:0;">
            <thead><tr><th>Truck</th><th style="text-align:right;">Jobs</th><th style="text-align:right;">Gallons</th><th style="text-align:right;">Revenue</th></tr></thead>
            <tbody>
              ${sortedTrucks.map(([name, data]) => `
                <tr>
                  <td>${esc(name)}</td>
                  <td style="text-align:right;">${data.jobs}</td>
                  <td style="text-align:right;">${data.gallons.toLocaleString()}</td>
                  <td style="text-align:right;font-weight:600;">$${data.revenue.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `}
      </div>

      <!-- Daily Revenue -->
      <div class="card">
        <div class="card-header"><h3>Daily Revenue</h3></div>
        ${dailyDates.length === 0 ? '<p style="color:var(--text-light);padding:20px;">No data.</p>' : `
          <div style="max-height:400px;overflow-y:auto;">
            ${dailyDates.map(d => `
              <div style="padding:6px 12px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border);">
                <div style="width:90px;font-size:13px;color:var(--text-light);">${d}</div>
                <div style="flex:1;height:6px;border-radius:3px;background:var(--border);">
                  <div style="height:100%;border-radius:3px;background:#4caf50;width:${(dailyRevenue[d] / maxDailyRev * 100).toFixed(1)}%;"></div>
                </div>
                <div style="font-weight:600;white-space:nowrap;">$${dailyRevenue[d].toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
              </div>
            `).join('')}
          </div>
        `}
      </div>

      <!-- Job Status Breakdown -->
      <div class="card">
        <div class="card-header"><h3>Job Status</h3></div>
        <div style="padding:16px;">
          ${Object.entries(statusCounts).filter(([,c]) => c > 0).map(([status, count]) => {
            const colors = { completed:'#4caf50', scheduled:'#2196f3', in_progress:'#ff9800', cancelled:'#f44336' };
            const pct = totalJobs > 0 ? (count / totalJobs * 100).toFixed(1) : 0;
            return `
              <div style="margin-bottom:12px;">
                <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
                  <span>${formatStatus(status)}</span>
                  <span>${count} (${pct}%)</span>
                </div>
                <div style="height:8px;border-radius:4px;background:var(--border);">
                  <div style="height:100%;border-radius:4px;background:${colors[status] || '#999'};width:${pct}%;"></div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;
}

function setReportPeriod(from, to) {
  reportDateFrom = from;
  reportDateTo = to;
  loadReports();
}

async function exportReportPdf() {
  showToast('PDF export coming soon!', 'info');
}

// ===== SETTINGS =====
async function loadSettings() {
  const page = document.getElementById('page-settings');
  const { data: settings } = await window.api.getSettings();
  const { data: users } = await window.api.getUsers();
  const { data: categories } = await window.api.getServiceCategories();
  const { data: tankTypes } = await window.api.getTankTypes();
  const s = settings || {};

  page.innerHTML = `
    <div class="card">
      <div class="card-header"><h3>Company Info</h3></div>
      <div class="form-row">
        <div class="form-group">
          <label>Company Name</label>
          <input type="text" id="settingsCompanyName" value="${esc(s.company_name || '')}">
        </div>
        <div class="form-group">
          <label>Phone</label>
          <input type="text" id="settingsCompanyPhone" value="${esc(s.company_phone || '')}">
        </div>
      </div>
      <div class="form-group">
        <label>Address</label>
        <input type="text" id="settingsCompanyAddress" value="${esc(s.company_address || '')}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>DEP Hauler License #</label>
          <input type="text" id="settingsHaulerId" value="${esc(s.dep_hauler_id || '')}">
        </div>
        <div class="form-group">
          <label>DEP Email</label>
          <input type="email" id="settingsDepEmail" value="${esc(s.dep_email || '')}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Default Tax Rate (%)</label>
          <input type="number" id="settingsTaxRate" value="${s.default_tax_rate || 0}" min="0" step="0.1">
        </div>
        <div class="form-group">
          <label>Invoice Prefix</label>
          <input type="text" id="settingsInvoicePrefix" value="${esc(s.invoice_prefix || 'INV')}">
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><h3>Email (SMTP)</h3></div>
      <div class="form-row">
        <div class="form-group">
          <label>SMTP Host</label>
          <input type="text" id="settingsSmtpHost" value="${esc(s.smtp_host || '')}" placeholder="smtp.gmail.com">
        </div>
        <div class="form-group">
          <label>SMTP Port</label>
          <input type="text" id="settingsSmtpPort" value="${esc(s.smtp_port || '587')}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>SMTP User</label>
          <input type="text" id="settingsSmtpUser" value="${esc(s.smtp_user || '')}">
        </div>
        <div class="form-group">
          <label>SMTP Password</label>
          <input type="password" id="settingsSmtpPass" value="${esc(s.smtp_pass || '')}">
        </div>
      </div>
    </div>

    <button class="btn btn-primary btn-lg" onclick="saveSettingsForm()">Save Settings</button>

    <div class="card mt-24">
      <div class="card-header">
        <h3>Products & Services</h3>
        <button class="btn btn-primary btn-sm" onclick="openServiceCategoryModal()">+ Add Category</button>
      </div>
      <p style="font-size:13px;color:var(--text-light);margin-bottom:16px;">Set up the services you offer. These appear when creating appointments.</p>
      ${categories.length === 0 ? `
        <div class="empty-state" style="padding:30px;">
          <p>No service categories yet. Add categories like "Septic Truck Services", "Box Truck Services", etc.</p>
        </div>
      ` : `
        ${categories.map(cat => `
          <div class="service-category-card">
            <div class="service-category-header">
              <div>
                <strong>${esc(cat.name)}</strong>
                ${cat.code ? `<span class="badge badge-info" style="margin-left:8px;">${esc(cat.code)}</span>` : ''}
              </div>
              <div style="display:flex;gap:4px;">
                <button class="btn btn-sm btn-secondary" onclick="openServiceCategoryModal(${JSON.stringify(cat).replace(/"/g, '&quot;')})">Edit</button>
                <button class="btn btn-sm btn-primary" onclick="openServiceProductModal('${cat.id}')">+ Add Item</button>
              </div>
            </div>
            ${cat.products.length === 0 ? `
              <div style="padding:12px;color:var(--text-light);font-size:13px;font-style:italic;">No products/services in this category yet.</div>
            ` : `
              <table class="data-table" style="margin:0;">
                <thead><tr><th>Item Name</th><th>Job Code</th><th>Pump Job</th><th>Tank Job</th><th style="text-align:right;">Price</th><th></th></tr></thead>
                <tbody>
                  ${cat.products.map(p => `
                    <tr>
                      <td>${esc(p.name)}</td>
                      <td>${esc(p.job_code || '')}</td>
                      <td>${p.is_pump_job ? '&#9989;' : ''}</td>
                      <td>${p.is_tank_job ? '&#9989;' : ''}</td>
                      <td style="text-align:right;">$${(p.price || 0).toFixed(2)}</td>
                      <td style="text-align:right;">
                        <button class="btn btn-sm btn-secondary" onclick="openServiceProductModal('${cat.id}', ${JSON.stringify(p).replace(/"/g, '&quot;')})">Edit</button>
                        <button class="btn btn-sm btn-danger" onclick="deleteServiceProduct('${p.id}')">&#10005;</button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `}
          </div>
        `).join('')}
      `}
    </div>

    <div class="card mt-24">
      <div class="card-header">
        <h3>Users & Technicians</h3>
        <button class="btn btn-primary btn-sm" onclick="openUserModal()">+ Add User</button>
      </div>
      ${users.length === 0 ? '<p style="color:var(--text-light);">No users added yet.</p>' : `
        <table class="data-table">
          <thead><tr><th>Name</th><th>Username</th><th>Phone</th><th>Role</th><th></th></tr></thead>
          <tbody>
            ${users.map(u => `
              <tr>
                <td>${esc(u.name)}</td>
                <td>${esc(u.username || '(no login)')}</td>
                <td>${esc(u.phone || '')}</td>
                <td><span class="badge ${u.role === 'admin' ? 'badge-paid' : 'badge-info'}">${esc(u.role || 'tech')}</span></td>
                <td>
                  <button class="btn btn-sm btn-secondary" onclick="openEditUserModal('${u.id}')">Edit</button>
                  ${u.id !== currentUser.id ? `<button class="btn btn-sm btn-danger" onclick="deleteUser('${u.id}')">Remove</button>` : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>

    <div class="card mt-24">
      <div class="card-header"><h3>My Account</h3></div>
      <div class="form-row">
        <div class="form-group">
          <label>New Password</label>
          <input type="password" id="myNewPassword" placeholder="Leave blank to keep current">
        </div>
        <div class="form-group">
          <label>Confirm New Password</label>
          <input type="password" id="myNewPasswordConfirm" placeholder="Confirm new password">
        </div>
      </div>
      <button class="btn btn-primary" onclick="changeMyPassword()">Change Password</button>
    </div>

    <div class="card mt-24">
      <div class="card-header">
        <h3>Tank / Waste Types</h3>
        <button class="btn btn-primary btn-sm" onclick="openTankTypeModal()">+ Add Type</button>
      </div>
      <p style="font-size:13px;color:var(--text-light);margin-bottom:16px;">Configure tank types used when setting up properties. These drive the disposal line items and waste codes on work orders.</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#f8f9fa;border-bottom:2px solid var(--border);">
            <th style="padding:8px 10px;text-align:left;">Tank Type</th>
            <th style="padding:8px 10px;text-align:left;">Waste Code</th>
            <th style="padding:8px 10px;text-align:left;">Disposal Line Item</th>
            <th style="padding:8px 6px;text-align:center;">Pump $</th>
            <th style="padding:8px 6px;text-align:center;">Disp $</th>
            <th style="padding:8px 6px;text-align:center;">Auto-Disposal</th>
            <th style="padding:8px 6px;text-align:center;"></th>
          </tr>
        </thead>
        <tbody>
          ${(tankTypes || []).map(tt => `
            <tr style="border-bottom:1px solid var(--border);" id="ttrow-${tt.id}">
              <td style="padding:8px 10px;font-weight:600;">${esc(tt.name)}</td>
              <td style="padding:8px 10px;color:var(--text-light);">${esc(tt.waste_code || '—')}</td>
              <td style="padding:8px 10px;color:var(--text-light);font-size:12px;">${esc(tt.disposal_label || '—')}</td>
              <td style="padding:8px 6px;text-align:center;">$${(tt.pumping_price || 0).toFixed(0)}</td>
              <td style="padding:8px 6px;text-align:center;">$${(tt.disposal_price || 0).toFixed(0)}</td>
              <td style="padding:8px 6px;text-align:center;">${tt.generates_disposal ? '<span style="color:var(--primary);font-weight:700;">Yes</span>' : '<span style="color:var(--text-light);">No</span>'}</td>
              <td style="padding:8px 6px;text-align:right;">
                <button class="btn btn-sm btn-secondary" onclick="openTankTypeModal(${JSON.stringify(JSON.stringify(tt))})" style="margin-right:4px;">Edit</button>
                <button class="btn btn-sm" style="background:#c62828;color:#fff;" onclick="deleteTankType('${tt.id}')">Remove</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div class="card mt-24" style="border-left:4px solid #7c4dff;">
      <div class="card-header">
        <h3>&#128230; Import from TankTrack</h3>
      </div>
      <p style="font-size:13px;color:var(--text-light);margin-bottom:16px;">Import customers, properties, tanks, and invoices from a TankTrack backup Excel file (.xlsx). Duplicate customers (same name + billing address) will be skipped.</p>
      <div id="importArea">
        <button class="btn btn-primary" onclick="importTankTrackStart()">&#128194; Select TankTrack Backup File</button>
      </div>
    </div>
  `;
}

function openTankTypeModal(ttJson) {
  const tt = ttJson ? JSON.parse(ttJson) : {};
  const isEdit = !!tt.id;
  openModal(isEdit ? 'Edit Tank Type' : 'Add Tank Type', `
    <input type="hidden" id="ttId" value="${tt.id || ''}">
    <div class="form-row">
      <div class="form-group" style="flex:2;">
        <label>Tank Type Name *</label>
        <input type="text" id="ttName" value="${esc(tt.name || '')}" placeholder="e.g. Septic Tank">
      </div>
      <div class="form-group" style="flex:1;">
        <label>Waste Code</label>
        <input type="text" id="ttWasteCode" value="${esc(tt.waste_code || '')}" placeholder="e.g. S">
      </div>
    </div>
    <div class="form-group">
      <label>Disposal Line Item Label</label>
      <input type="text" id="ttDispLabel" value="${esc(tt.disposal_label || '')}" placeholder="e.g. Septic Tank Waste Disposal">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Pumping Unit Price ($)</label>
        <input type="number" id="ttPumpPrice" value="${tt.pumping_price ?? 250}" min="0" step="0.01">
      </div>
      <div class="form-group">
        <label>Disposal Unit Price ($)</label>
        <input type="number" id="ttDispPrice" value="${tt.disposal_price ?? 140}" min="0" step="0.01">
      </div>
    </div>
    <div class="form-group">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
        <input type="checkbox" id="ttGenDisp" ${tt.generates_disposal ? 'checked' : ''} style="width:18px;height:18px;">
        Auto-add disposal line item when pumping this tank type
      </label>
    </div>
    <div class="form-group">
      <label>Sort Order</label>
      <input type="number" id="ttSort" value="${tt.sort_order ?? 99}" min="1">
    </div>
    <button class="btn btn-primary btn-lg" style="width:100%;margin-top:8px;" onclick="saveTankTypeModal()">Save</button>
  `);
}

async function saveTankTypeModal() {
  const name = document.getElementById('ttName').value.trim();
  if (!name) { showToast('Tank type name is required.', 'error'); return; }
  const data = {
    id: document.getElementById('ttId').value || undefined,
    name,
    waste_code: document.getElementById('ttWasteCode').value.trim(),
    disposal_label: document.getElementById('ttDispLabel').value.trim(),
    pumping_price: parseFloat(document.getElementById('ttPumpPrice').value) || 0,
    disposal_price: parseFloat(document.getElementById('ttDispPrice').value) || 0,
    generates_disposal: document.getElementById('ttGenDisp').checked,
    sort_order: parseInt(document.getElementById('ttSort').value) || 99,
  };
  await window.api.saveTankType(data);
  closeModal();
  showToast('Tank type saved.', 'success');
  loadSettings();
}

async function deleteTankType(id) {
  if (!confirm('Remove this tank type?')) return;
  await window.api.deleteTankType(id);
  showToast('Tank type removed.', 'success');
  loadSettings();
}

async function saveSettingsForm() {
  const data = {
    company_name: document.getElementById('settingsCompanyName').value.trim(),
    company_phone: document.getElementById('settingsCompanyPhone').value.trim(),
    company_address: document.getElementById('settingsCompanyAddress').value.trim(),
    dep_hauler_id: document.getElementById('settingsHaulerId').value.trim(),
    dep_email: document.getElementById('settingsDepEmail').value.trim(),
    default_tax_rate: parseFloat(document.getElementById('settingsTaxRate').value) || 0,
    invoice_prefix: document.getElementById('settingsInvoicePrefix').value.trim() || 'INV',
    smtp_host: document.getElementById('settingsSmtpHost').value.trim(),
    smtp_port: document.getElementById('settingsSmtpPort').value.trim(),
    smtp_user: document.getElementById('settingsSmtpUser').value.trim(),
    smtp_pass: document.getElementById('settingsSmtpPass').value.trim(),
  };

  const result = await window.api.saveSettings(data);
  if (result.success) {
    showToast('Settings saved.', 'success');
  }
}

function openUserModal(user = null) {
  const isEdit = !!user;
  const u = user || {};
  openModal(isEdit ? 'Edit User' : 'Add User', `
    <input type="hidden" id="userId" value="${u.id || ''}">
    <div class="form-group">
      <label>Name *</label>
      <input type="text" id="userName" value="${esc(u.name || '')}" placeholder="Tech name">
    </div>
    <div class="form-group">
      <label>Phone</label>
      <input type="text" id="userPhone" value="${esc(u.phone || '')}" placeholder="(555) 123-4567">
    </div>
    <div class="form-group">
      <label>Username *</label>
      <input type="text" id="userUsername" value="${esc(u.username || '')}" placeholder="Choose a login username" autocomplete="off">
    </div>
    <div class="form-group">
      <label>${isEdit ? 'New Password (leave blank to keep current)' : 'Password *'}</label>
      <input type="password" id="userPassword" placeholder="${isEdit ? 'Leave blank to keep' : 'Choose a password'}">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Role</label>
        <select id="userRole">
          <option value="tech" ${u.role === 'tech' ? 'selected' : ''}>Tech</option>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
        </select>
      </div>
      <div class="form-group">
        <label>Color</label>
        <input type="color" id="userColor" value="${u.color || '#1565c0'}" style="height:38px;width:100%;cursor:pointer;">
      </div>
    </div>
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveUserForm()">Save</button>
  `);
}

async function openEditUserModal(id) {
  const { data: users } = await window.api.getUsers();
  const user = users.find(u => u.id === id);
  if (user) openUserModal(user);
}

async function saveUserForm() {
  const data = {
    name: document.getElementById('userName').value.trim(),
    phone: document.getElementById('userPhone').value.trim(),
    username: document.getElementById('userUsername').value.trim().toLowerCase(),
    role: document.getElementById('userRole').value,
    color: document.getElementById('userColor').value || '#1565c0',
  };
  const password = document.getElementById('userPassword').value;
  const id = document.getElementById('userId').value;

  if (!data.name) {
    showToast('Name is required.', 'error');
    return;
  }
  if (!data.username) {
    showToast('Username is required.', 'error');
    return;
  }
  if (!id && !password) {
    showToast('Password is required for new users.', 'error');
    return;
  }

  if (id) data.id = id;
  if (password) data.password = password;

  await window.api.saveUser(data);
  closeModal();
  showToast(id ? 'User updated.' : 'User added.', 'success');
  loadSettings();
}

// ===== TANKTRACK IMPORT =====
let _importFilePath = null;
let _importPreview = null;

async function importTankTrackStart() {
  const result = await window.api.importSelectFile();
  if (result.canceled) return;
  _importFilePath = result.filePath;

  const area = document.getElementById('importArea');
  area.innerHTML = '<div style="text-align:center;padding:20px;"><div class="spinner"></div><p style="margin-top:8px;color:var(--text-light);">Reading TankTrack file…</p></div>';

  const preview = await window.api.importPreviewTanktrack(_importFilePath, 25);
  if (preview.error) {
    area.innerHTML = `<div style="color:var(--danger);padding:12px;"><strong>Error:</strong> ${esc(preview.error)}</div><button class="btn btn-primary" onclick="importTankTrackStart()">Try Again</button>`;
    return;
  }
  _importPreview = preview;

  area.innerHTML = `
    <div style="background:var(--bg);border-radius:8px;padding:16px;margin-bottom:16px;border:1px solid var(--border);">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;text-align:center;">
        <div>
          <div style="font-size:28px;font-weight:700;color:#1565c0;">${preview.totalRows.toLocaleString()}</div>
          <div style="font-size:12px;color:var(--text-light);">Total Rows</div>
        </div>
        <div>
          <div style="font-size:28px;font-weight:700;color:#2e7d32;">${preview.uniqueCustomers.toLocaleString()}</div>
          <div style="font-size:12px;color:var(--text-light);">Unique Customers</div>
        </div>
        <div>
          <div style="font-size:28px;font-weight:700;color:#e65100;">${preview.invoiceCount.toLocaleString()}</div>
          <div style="font-size:12px;color:var(--text-light);">Invoices</div>
        </div>
      </div>
    </div>

    <div style="margin-bottom:16px;">
      <strong>Preview — First ${preview.previewCount} Customers:</strong>
      <div style="max-height:400px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;margin-top:8px;">
        <table class="data-table" style="margin:0;">
          <thead><tr><th>#</th><th>Name</th><th>Phone</th><th>Email</th><th>Properties</th><th>Tanks</th></tr></thead>
          <tbody>
            ${preview.previewCustomers.map((c, i) => {
              const totalTanks = c.properties.reduce((s, p) => s + p.tanks.length, 0);
              return `<tr>
                <td>${i + 1}</td>
                <td><strong>${esc(c.name)}</strong></td>
                <td>${esc(c.phone || '—')}</td>
                <td>${esc(c.email || '—')}</td>
                <td>${c.properties.length}</td>
                <td>${totalTanks}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div style="display:flex;gap:12px;flex-wrap:wrap;">
      <button class="btn btn-primary" onclick="importTankTrackExecute(25)" style="background:#2e7d32;">
        &#10003; Import First 25 Customers
      </button>
      <button class="btn btn-primary" onclick="importTankTrackExecute(0)" style="background:#1565c0;">
        &#128230; Import All ${preview.uniqueCustomers.toLocaleString()} Customers
      </button>
      ${preview.hasInvoices ? `
        <button class="btn btn-primary" onclick="importTankTrackInvoices()" style="background:#e65100;">
          &#128196; Import ${preview.invoiceCount.toLocaleString()} Invoices
        </button>
      ` : ''}
      <button class="btn btn-secondary" onclick="importTankTrackCancel()">Cancel</button>
    </div>
  `;
}

async function importTankTrackExecute(max) {
  const area = document.getElementById('importArea');
  const label = max > 0 ? `first ${max}` : 'all';
  area.innerHTML = `<div style="text-align:center;padding:20px;"><div class="spinner"></div><p style="margin-top:8px;color:var(--text-light);">Importing ${label} customers…</p></div>`;

  const result = await window.api.importExecuteTanktrack(_importFilePath, max || 0);
  if (result.error) {
    area.innerHTML = `<div style="color:var(--danger);padding:12px;"><strong>Error:</strong> ${esc(result.error)}</div><button class="btn btn-primary" onclick="importTankTrackStart()">Try Again</button>`;
    return;
  }

  area.innerHTML = `
    <div style="background:#e8f5e9;border-radius:8px;padding:20px;border:1px solid #a5d6a7;">
      <h4 style="color:#2e7d32;margin:0 0 12px;">&#10003; Import Complete</h4>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;text-align:center;">
        <div><div style="font-size:24px;font-weight:700;color:#2e7d32;">${result.imported}</div><div style="font-size:12px;color:#666;">Customers</div></div>
        <div><div style="font-size:24px;font-weight:700;color:#1565c0;">${result.propsCreated}</div><div style="font-size:12px;color:#666;">Properties</div></div>
        <div><div style="font-size:24px;font-weight:700;color:#e65100;">${result.tanksCreated}</div><div style="font-size:12px;color:#666;">Tanks</div></div>
        <div><div style="font-size:24px;font-weight:700;color:#999;">${result.skipped}</div><div style="font-size:12px;color:#666;">Skipped (dupes)</div></div>
      </div>
    </div>
    <div style="margin-top:12px;display:flex;gap:12px;">
      ${_importPreview?.hasInvoices ? `<button class="btn btn-primary" onclick="importTankTrackInvoices()" style="background:#e65100;">&#128196; Now Import Invoices</button>` : ''}
      <button class="btn btn-secondary" onclick="navigateTo('customers')">View Customers</button>
      <button class="btn btn-secondary" onclick="importTankTrackStart()">Import More</button>
    </div>
  `;
  showToast(`Imported ${result.imported} customers, ${result.propsCreated} properties, ${result.tanksCreated} tanks.`, 'success');
}

async function importTankTrackInvoices() {
  const area = document.getElementById('importArea');
  area.innerHTML = `<div style="text-align:center;padding:20px;"><div class="spinner"></div><p style="margin-top:8px;color:var(--text-light);">Importing invoices…</p></div>`;

  const result = await window.api.importInvoicesTanktrack(_importFilePath);
  if (result.error) {
    area.innerHTML = `<div style="color:var(--danger);padding:12px;"><strong>Error:</strong> ${esc(result.error)}</div><button class="btn btn-primary" onclick="importTankTrackStart()">Try Again</button>`;
    return;
  }

  area.innerHTML = `
    <div style="background:#e8f5e9;border-radius:8px;padding:20px;border:1px solid #a5d6a7;">
      <h4 style="color:#2e7d32;margin:0 0 12px;">&#10003; Invoice Import Complete</h4>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;text-align:center;">
        <div><div style="font-size:24px;font-weight:700;color:#e65100;">${result.imported}</div><div style="font-size:12px;color:#666;">Invoices Imported</div></div>
        <div><div style="font-size:24px;font-weight:700;color:#999;">${result.skipped}</div><div style="font-size:12px;color:#666;">Skipped (dupes)</div></div>
      </div>
    </div>
    <div style="margin-top:12px;display:flex;gap:12px;">
      <button class="btn btn-secondary" onclick="navigateTo('invoices')">View Invoices</button>
      <button class="btn btn-secondary" onclick="navigateTo('customers')">View Customers</button>
    </div>
  `;
  showToast(`Imported ${result.imported} invoices, skipped ${result.skipped} duplicates.`, 'success');
}

function importTankTrackCancel() {
  _importFilePath = null;
  _importPreview = null;
  const area = document.getElementById('importArea');
  area.innerHTML = '<button class="btn btn-primary" onclick="importTankTrackStart()">&#128194; Select TankTrack Backup File</button>';
}

async function changeMyPassword() {
  const pw = document.getElementById('myNewPassword').value;
  const confirm = document.getElementById('myNewPasswordConfirm').value;
  if (!pw) {
    showToast('Enter a new password.', 'error');
    return;
  }
  if (pw.length < 4) {
    showToast('Password must be at least 4 characters.', 'error');
    return;
  }
  if (pw !== confirm) {
    showToast('Passwords do not match.', 'error');
    return;
  }
  const result = await window.api.changePassword(currentUser.id, pw);
  if (result.success) {
    showToast('Password changed.', 'success');
    document.getElementById('myNewPassword').value = '';
    document.getElementById('myNewPasswordConfirm').value = '';
  } else {
    showToast(result.error || 'Failed to change password.', 'error');
  }
}

async function deleteUser(id) {
  if (!confirm('Remove this technician?')) return;
  await window.api.deleteUser(id);
  showToast('Technician removed.', 'success');
  loadSettings();
}

// ===== SERVICE CATEGORIES & PRODUCTS =====
function openServiceCategoryModal(cat = null) {
  const isEdit = !!cat;
  const c = cat || {};
  openModal(isEdit ? 'Edit Category' : 'New Category', `
    <input type="hidden" id="catId" value="${c.id || ''}">
    <div class="form-group">
      <label>Category Name *</label>
      <input type="text" id="catName" value="${esc(c.name || '')}" placeholder="e.g. Septic Truck Services">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Code</label>
        <input type="text" id="catCode" value="${esc(c.code || '')}" placeholder="e.g. Septic" maxlength="10">
      </div>
      <div class="form-group">
        <label>Sort Order</label>
        <input type="number" id="catSort" value="${c.sort_order || 0}" min="0">
      </div>
    </div>
  `, `
    ${isEdit ? `<button class="btn btn-danger" onclick="deleteServiceCategory('${c.id}')">Delete</button>` : ''}
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveServiceCategory()">Save</button>
  `);
}

async function saveServiceCategory() {
  const data = {
    name: document.getElementById('catName').value.trim(),
    code: document.getElementById('catCode').value.trim(),
    sort_order: parseInt(document.getElementById('catSort').value) || 0,
  };
  const id = document.getElementById('catId').value;
  if (id) data.id = id;
  if (!data.name) { showToast('Category name is required.', 'error'); return; }
  await window.api.saveServiceCategory(data);
  closeModal();
  showToast(id ? 'Category updated.' : 'Category added.', 'success');
  loadSettings();
}

async function deleteServiceCategory(id) {
  if (!confirm('Delete this category and all its products?')) return;
  await window.api.deleteServiceCategory(id);
  closeModal();
  showToast('Category deleted.', 'success');
  loadSettings();
}

function openServiceProductModal(categoryId, product = null) {
  const isEdit = !!product;
  const p = product || {};
  openModal(isEdit ? 'Edit Service' : 'Add Service', `
    <input type="hidden" id="prodId" value="${p.id || ''}">
    <input type="hidden" id="prodCatId" value="${categoryId}">
    <div class="form-group">
      <label>Item Name *</label>
      <input type="text" id="prodName" value="${esc(p.name || '')}" placeholder="e.g. Pumping, Septic Tank Waste Disposal">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Price ($)</label>
        <input type="number" id="prodPrice" value="${p.price || ''}" min="0" step="0.01" placeholder="250.00">
      </div>
      <div class="form-group">
        <label>Job Code</label>
        <input type="text" id="prodCode" value="${esc(p.job_code || '')}" placeholder="e.g. Code" maxlength="10">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Pump Job?</label>
        <select id="prodPumpJob">
          <option value="false" ${!p.is_pump_job ? 'selected' : ''}>No</option>
          <option value="true" ${p.is_pump_job ? 'selected' : ''}>Yes</option>
        </select>
      </div>
      <div class="form-group">
        <label>Tank Job?</label>
        <select id="prodTankJob">
          <option value="false" ${!p.is_tank_job ? 'selected' : ''}>No</option>
          <option value="true" ${p.is_tank_job ? 'selected' : ''}>Yes</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>Sort Order</label>
      <input type="number" id="prodSort" value="${p.sort_order || 0}" min="0">
    </div>
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveServiceProduct()">Save</button>
  `);
}

async function saveServiceProduct() {
  const data = {
    category_id: document.getElementById('prodCatId').value,
    name: document.getElementById('prodName').value.trim(),
    price: parseFloat(document.getElementById('prodPrice').value) || 0,
    job_code: document.getElementById('prodCode').value.trim(),
    is_pump_job: document.getElementById('prodPumpJob').value === 'true',
    is_tank_job: document.getElementById('prodTankJob').value === 'true',
    sort_order: parseInt(document.getElementById('prodSort').value) || 0,
  };
  const id = document.getElementById('prodId').value;
  if (id) data.id = id;
  if (!data.name) { showToast('Item name is required.', 'error'); return; }
  await window.api.saveServiceProduct(data);
  closeModal();
  showToast(id ? 'Service updated.' : 'Service added.', 'success');
  loadSettings();
}

async function deleteServiceProduct(id) {
  if (!confirm('Delete this service?')) return;
  await window.api.deleteServiceProduct(id);
  showToast('Service deleted.', 'success');
  loadSettings();
}

// ===== UTILITIES =====
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatStatus(s) {
  return (s || '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function abbreviateJobCode(code) {
  const map = {
    'septic pumping': 'SP',
    'septic tank pumping': 'SP',
    'sewer line inspection': 'SLI',
    'sewer line cleaning': 'SLC',
    'septic inspection': 'SI',
    'grease trap': 'GT',
    'grease trap pumping': 'GT',
    'drain cleaning': 'DC',
    'camera inspection': 'CI',
    'septic design': 'SD',
    'installation': 'INS',
    'repair': 'RPR',
    'maintenance': 'MNT',
    'pump chamber': 'PC',
    'holding tank': 'HT',
  };
  const lower = (code || '').toLowerCase().trim();
  if (map[lower]) return map[lower];
  // Fallback: take first letter of each word
  return code.split(/\s+/).map(w => w[0]?.toUpperCase() || '').join('');
}

function formatMonthYear(d) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()];
}

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}
