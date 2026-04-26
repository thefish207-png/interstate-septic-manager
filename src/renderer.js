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

// ===== POPUP MODE =====
const _popupParams = new URLSearchParams(window.location.search);
const _isPopup = _popupParams.get('popup') === '1';
const _popupPage = _popupParams.get('page') || 'schedule';
const _popupId   = _popupParams.get('id') || null;

function popoutPage(page, title) {
  window.api.openPopupWindow({ page, title: 'ISM — ' + title });
}

function popupRefresh() {
  navigateTo(_popupPage);
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  installCustomTooltip();
  installZoomIndicator();
  initSidebarCustomization();
});

// ===== Sidebar customization (lock/unlock, drag reorder, hide/restore) =====
const SIDEBAR_STORAGE_KEY = 'ism_sidebar_layout_v1';
function loadSidebarLayout() {
  try {
    const raw = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (!raw) return { order: null, hidden: [] };
    const parsed = JSON.parse(raw);
    return { order: Array.isArray(parsed.order) ? parsed.order : null, hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [] };
  } catch { return { order: null, hidden: [] }; }
}
function saveSidebarLayout(layout) {
  try { localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(layout)); } catch {}
}
function getSidebarPages() {
  return Array.from(document.querySelectorAll('.sidebar-nav .nav-item')).map(b => b.dataset.page);
}
function applySidebarLayout() {
  const nav = document.getElementById('sidebarNav');
  if (!nav) return;
  const { order, hidden } = loadSidebarLayout();
  const items = Array.from(nav.querySelectorAll('.nav-item'));
  const byPage = new Map(items.map(el => [el.dataset.page, el]));
  // If a saved order exists, remove dividers and append items in custom order
  if (order && order.length) {
    nav.querySelectorAll('.nav-divider').forEach(d => d.remove());
    order.forEach(page => {
      const el = byPage.get(page);
      if (el) nav.insertBefore(el, document.getElementById('sidebarHiddenDrawer'));
    });
    // Any items not in saved order (new pages added later) — append at end
    items.forEach(el => {
      if (!order.includes(el.dataset.page)) {
        nav.insertBefore(el, document.getElementById('sidebarHiddenDrawer'));
      }
    });
  }
  // Apply hidden state
  items.forEach(el => {
    el.style.display = hidden.includes(el.dataset.page) ? 'none' : '';
  });
  renderHiddenDrawer();
}
function renderHiddenDrawer() {
  const { hidden } = loadSidebarLayout();
  const drawer = document.getElementById('sidebarHiddenDrawer');
  const list = document.getElementById('sidebarHiddenList');
  const resetBtn = document.getElementById('sidebarResetBtn');
  const unlocked = document.querySelector('.sidebar')?.classList.contains('unlocked');
  if (!drawer || !list) return;
  list.innerHTML = '';
  hidden.forEach(page => {
    const label = PAGE_LABELS[page] || page;
    const chip = document.createElement('button');
    chip.className = 'sidebar-hidden-chip';
    chip.textContent = '＋ ' + label;
    chip.addEventListener('click', () => restoreSidebarItem(page));
    list.appendChild(chip);
  });
  drawer.style.display = (unlocked && hidden.length > 0) ? '' : 'none';
  if (resetBtn) resetBtn.style.display = unlocked ? '' : 'none';
}
function hideSidebarItem(page) {
  const layout = loadSidebarLayout();
  if (!layout.hidden.includes(page)) layout.hidden.push(page);
  saveSidebarLayout(layout);
  applySidebarLayout();
}
function restoreSidebarItem(page) {
  const layout = loadSidebarLayout();
  layout.hidden = layout.hidden.filter(p => p !== page);
  saveSidebarLayout(layout);
  applySidebarLayout();
}
function persistCurrentOrder() {
  const nav = document.getElementById('sidebarNav');
  if (!nav) return;
  const order = Array.from(nav.querySelectorAll('.nav-item')).map(b => b.dataset.page);
  const layout = loadSidebarLayout();
  layout.order = order;
  saveSidebarLayout(layout);
}
function resetSidebarLayout() {
  if (!confirm('Reset sidebar to default order and show all items?')) return;
  localStorage.removeItem(SIDEBAR_STORAGE_KEY);
  location.reload();
}
function attachSidebarDragHandlers() {
  const nav = document.getElementById('sidebarNav');
  if (!nav) return;
  let dragEl = null;
  nav.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('dragstart', (e) => {
      if (!document.querySelector('.sidebar').classList.contains('unlocked')) { e.preventDefault(); return; }
      dragEl = el;
      el.classList.add('nav-dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', el.dataset.page); } catch {}
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('nav-dragging');
      nav.querySelectorAll('.drag-over-top,.drag-over-bottom').forEach(n => n.classList.remove('drag-over-top','drag-over-bottom'));
      dragEl = null;
      persistCurrentOrder();
    });
    el.addEventListener('dragover', (e) => {
      if (!dragEl || dragEl === el) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      el.classList.toggle('drag-over-top', before);
      el.classList.toggle('drag-over-bottom', !before);
    });
    el.addEventListener('dragleave', () => {
      el.classList.remove('drag-over-top','drag-over-bottom');
    });
    el.addEventListener('drop', (e) => {
      if (!dragEl || dragEl === el) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      // Remove all dividers on first reorder — layout is now fully custom
      nav.querySelectorAll('.nav-divider').forEach(d => d.remove());
      if (before) nav.insertBefore(dragEl, el);
      else nav.insertBefore(dragEl, el.nextSibling);
      el.classList.remove('drag-over-top','drag-over-bottom');
    });
  });
}
function injectSidebarHideButtons() {
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(el => {
    if (el.querySelector('.nav-hide-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'nav-hide-btn';
    btn.type = 'button';
    btn.title = 'Hide from sidebar';
    btn.textContent = '×';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      hideSidebarItem(el.dataset.page);
    });
    el.appendChild(btn);
  });
}
function toggleSidebarUnlock() {
  const sidebar = document.querySelector('.sidebar');
  const icon = document.getElementById('sidebarCustomizeIcon');
  const unlocked = sidebar.classList.toggle('unlocked');
  if (icon) icon.innerHTML = unlocked ? '&#128275;' : '&#128274;';
  const btn = document.getElementById('sidebarCustomizeBtn');
  if (btn) btn.title = unlocked ? 'Lock sidebar' : 'Customize sidebar';
  // Only make items draggable while unlocked — otherwise the browser can
  // intercept clicks as potential drags and swallow the navigation.
  sidebar.querySelectorAll('.nav-item').forEach(el => {
    if (unlocked) el.setAttribute('draggable', 'true');
    else el.removeAttribute('draggable');
  });
  renderHiddenDrawer();
}
function initSidebarCustomization() {
  applySidebarLayout();
  injectSidebarHideButtons();
  attachSidebarDragHandlers();
  const btn = document.getElementById('sidebarCustomizeBtn');
  if (btn) btn.addEventListener('click', toggleSidebarUnlock);
  const resetBtn = document.getElementById('sidebarResetBtn');
  if (resetBtn) resetBtn.addEventListener('click', resetSidebarLayout);
}

function installZoomIndicator() {
  const el = document.createElement('div');
  el.id = '__zoomBadge';
  el.style.cssText = 'position:fixed;bottom:14px;right:14px;z-index:99998;padding:6px 12px;background:rgba(20,20,20,0.78);color:#fff;border:1px solid rgba(255,255,255,0.12);border-radius:999px;font-size:12px;font-weight:600;font-family:system-ui,sans-serif;letter-spacing:0.3px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);box-shadow:0 4px 14px rgba(0,0,0,0.35);opacity:0;transition:opacity 0.25s ease;pointer-events:none;';
  el.textContent = '100%';
  document.body.appendChild(el);
  let hideTimer = null;
  const show = (pct) => {
    el.textContent = pct + '%';
    el.style.opacity = pct === 100 ? '0.55' : '1';
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { el.style.opacity = '0'; }, 1500);
  };
  if (window.api && window.api.onZoomChanged) {
    window.api.onZoomChanged(({ percent }) => show(percent));
  }
}

// Custom tooltip for [data-tip] elements — renders above the cursor so it doesn't obscure the target.
function installCustomTooltip() {
  let tipEl = null;
  function ensure() {
    if (tipEl) return tipEl;
    tipEl = document.createElement('div');
    tipEl.id = '__customTip';
    tipEl.style.cssText = 'position:fixed;z-index:99999;padding:6px 10px;background:#222;color:#fff;border:1px solid #555;border-radius:4px;font-size:12px;pointer-events:none;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.4);display:none;';
    document.body.appendChild(tipEl);
    return tipEl;
  }
  document.addEventListener('mouseover', e => {
    const t = e.target.closest('[data-tip]');
    if (!t) return;
    const el = ensure();
    el.textContent = t.getAttribute('data-tip');
    el.style.display = 'block';
  });
  document.addEventListener('mousemove', e => {
    if (!tipEl || tipEl.style.display === 'none') return;
    const t = e.target.closest('[data-tip]');
    if (!t) { tipEl.style.display = 'none'; return; }
    const pad = 14;
    let x = e.clientX + 12;
    let y = e.clientY - tipEl.offsetHeight - pad;
    if (y < 4) y = e.clientY + pad + 8;
    if (x + tipEl.offsetWidth > window.innerWidth - 4) x = window.innerWidth - tipEl.offsetWidth - 4;
    tipEl.style.left = x + 'px';
    tipEl.style.top = y + 'px';
  });
  document.addEventListener('mouseout', e => {
    if (!tipEl) return;
    if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest('[data-tip]')) {
      tipEl.style.display = 'none';
    }
  });
}

// Cloud-status sidebar dot. Colors: green=ok, amber=warn, grey=offline.
function _setCloudDot(state, label) {
  const dot = document.getElementById('sidebarCloudDot');
  const lbl = document.getElementById('sidebarCloudLabel');
  if (!dot || !lbl) return;
  const colors = { ok: '#43a047', warn: '#ff9800', offline: '#9e9e9e' };
  dot.style.background = colors[state] || colors.offline;
  lbl.textContent = label || state;
}

async function _refreshCloudStatus() {
  try {
    const status = await window.api.cloudConfigStatus();
    if (!status || !status.configured) { _setCloudDot('offline', 'no cloud'); return; }
    if (status.signedIn) _setCloudDot('ok', 'live');
    else _setCloudDot('warn', 'signed out');
  } catch {
    _setCloudDot('offline', 'error');
  }
}

// ===== AUTH (Supabase) =====
async function checkAuth() {
  // Check if Supabase is configured
  const status = await window.api.cloudConfigStatus();
  if (!status || !status.configured) {
    // Fallback to legacy bypass if Supabase isn't set up yet
    currentUser = { id: 1, name: 'Admin', role: 'owner', username: 'admin' };
    enterApp();
    return;
  }

  // Try to restore an existing session
  const restore = await window.api.cloudRestoreSession();
  if (restore && restore.success) {
    currentUser = {
      id: restore.user.id,
      name: restore.user.name,
      role: restore.user.role,
      username: restore.user.username,
      color: restore.user.color,
      phone: restore.user.phone
    };
    enterApp();
    return;
  }

  // No valid session — show login screen
  showScreen('login');
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

  // Try Supabase login first
  const cloudStatus = await window.api.cloudConfigStatus();
  if (cloudStatus && cloudStatus.configured) {
    const result = await window.api.cloudLogin(username, password);
    if (result.success) {
      currentUser = {
        id: result.user.id,
        name: result.user.name,
        role: result.user.role,
        username: result.user.username,
        color: result.user.color,
        phone: result.user.phone
      };
      localStorage.setItem('ism_saved_username', username);
      // Don't save password to localStorage anymore — session is persisted on disk by main process
      localStorage.removeItem('ism_saved_password');
      errorEl.style.display = 'none';
      enterApp();
      return;
    }
    errorEl.textContent = result.error || 'Login failed.';
    errorEl.style.display = 'block';
    return;
  }

  // Fallback to legacy local auth (only used if Supabase isn't configured)
  const result = await window.api.authLogin(username, password);
  if (result.success) {
    currentUser = result.data;
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

  // Cloud sync warnings — show toast + flip the sidebar dot
  if (window.api?.onCloudWarning && !window._cloudWarningAttached) {
    window._cloudWarningAttached = true;
    let _lastCloudWarn = 0;
    window.api.onCloudWarning((p) => {
      const now = Date.now();
      if (now - _lastCloudWarn < 3000) return;
      _lastCloudWarn = now;
      try {
        showToast('⚠ Cloud ' + (p.opType || 'sync') + ' failed for ' + (p.collection || '') + ': ' + (p.message || 'unknown error') + '. Saved locally — will retry on next launch.', 'error', 8000);
      } catch {}
      // Flip dot to amber for 30s
      _setCloudDot('warn', 'sync issue');
      clearTimeout(window._cloudDotTimer);
      window._cloudDotTimer = setTimeout(() => _setCloudDot('ok', 'live'), 30000);
    });
  }

  // Initialize the sidebar cloud-status dot
  _refreshCloudStatus();
  // Re-check cloud status every 30s
  if (!window._cloudStatusTimer) {
    window._cloudStatusTimer = setInterval(_refreshCloudStatus, 30000);
  }

  // Show real app version in sidebar footer
  if (window.api?.getAppVersion) {
    window.api.getAppVersion().then(v => {
      const el = document.getElementById('sidebarVersion');
      if (el && v?.version) el.textContent = 'v' + v.version + (v.isPackaged ? '' : ' (dev)');
    }).catch(() => {});
  }

  // Wire up auto-update notifications (idempotent — only attaches once)
  if (window.api?.onUpdateAvailable && !window._updateListenersAttached) {
    window._updateListenersAttached = true;
    window.api.onUpdateAvailable((info) => {
      try { showToast('New version v' + info.version + ' available — downloading…', 'info'); } catch {}
    });
    window.api.onUpdateReady((info) => {
      // Persistent banner — clicking it triggers install
      const existing = document.getElementById('updateReadyBanner');
      if (existing) existing.remove();
      const banner = document.createElement('div');
      banner.id = 'updateReadyBanner';
      banner.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#1565c0;color:white;padding:14px 18px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.3);z-index:99999;font-size:14px;cursor:pointer;display:flex;gap:10px;align-items:center;max-width:360px;';
      banner.innerHTML = '<strong>Update v' + info.version + ' ready</strong> <span style="opacity:.85;">Click to restart and install</span>';
      banner.onclick = async () => {
        banner.innerHTML = '<strong>Restarting…</strong>';
        try { await window.api.installUpdateNow(); } catch (e) { banner.innerHTML = 'Install failed: ' + e.message; }
      };
      document.body.appendChild(banner);
    });
  }

  if (_isPopup) {
    // Popup window: hide sidebar, show minimal topbar
    document.body.classList.add('popup-mode');
    const topbar = document.getElementById('popupTopbar');
    const titleEl = document.getElementById('popupTopbarTitle');
    if (topbar) topbar.style.display = 'flex';
    if (titleEl) {
      const labels = { schedule:'Schedule', customers:'Customers', invoices:'Invoices',
        disposal:'Disposals', sdn:'Service Due', reports:'Reports', dep:'DEP Reports',
        vehicles:'Vehicles', reminders:'Reminders', settings:'Settings', dashboard:'Dashboard' };
      titleEl.textContent = labels[_popupPage] || _popupPage;
    }
    setupNavigation();
    // If it's a job detail popup, open that job; otherwise navigate to the page
    if (_popupPage === 'job' && _popupId) {
      navigateTo('customers'); // need app shell active
      openJobDetail(_popupId);
    } else {
      navigateTo(_popupPage);
    }
    return;
  }

  // Show user info in sidebar
  document.getElementById('sidebarUserName').textContent = currentUser.name;
  document.getElementById('sidebarUserRole').textContent = currentUser.role;
  document.getElementById('sidebarUser').style.display = 'flex';

  // Gate nav items by role
  applyPermissions();

  setupNavigation();

  // Show tab bar and open Schedule (on today's date) as default tab
  const tabBarEl = document.getElementById('tabBar');
  if (tabBarEl) tabBarEl.style.display = 'block';
  scheduleDate = new Date();
  scheduleView = 'day';
  openTab('schedule');

  // Keep schedule anchored on "today" when the app is re-shown after the
  // clock has rolled to a new day (e.g. left running overnight / minimised to tray)
  const rollToTodayIfStale = () => {
    if (document.hidden) return;
    const now = new Date();
    if (scheduleView === 'day' && formatDate(scheduleDate) !== formatDate(now)) {
      scheduleDate = now;
      if (activeTabPage === 'schedule') loadSchedule();
    }
  };
  document.addEventListener('visibilitychange', rollToTodayIfStale);
  window.addEventListener('focus', rollToTodayIfStale);

  // Listen for dock-page events from popup windows
  if (window.api.onDockPage) {
    window.api.onDockPage((page) => openTab(page));
  }

  // Highlight tab bar when a popup is dragged near it
  if (window.api.onPopupNearTabbar) {
    window.api.onPopupNearTabbar(({ near }) => {
      const tabBarEl = document.getElementById('tabBar');
      if (tabBarEl) tabBarEl.classList.toggle('tab-bar-drop-zone', near);
    });
  }

  updateReminderBadge();

  // Warm the customer search cache in the background so the first
  // "New Appointment" modal doesn't pay a ~1s IPC round-trip
  setTimeout(() => {
    try { _loadJobModalCustomers().catch(() => {}); } catch {}
  }, 500);

  // Start messenger badge listener — webview loads in background even if user never visits the tab
  setTimeout(() => _initMessengerBadge(), 2000);

  // Listen for reminder alerts from main process
  if (window.api.onReminderAlert) {
    window.api.onReminderAlert((data) => {
      showToast(`🔔 Reminder: ${data.message}`, 'info', 8000);
      updateReminderBadge();
    });
  }
  if (window.api.onSdnConfirmed) {
    window.api.onSdnConfirmed((data) => {
      const name = data.customerName ? ` from ${data.customerName}` : '';
      showToast(`Customer confirmed${name} — reminders stopped.`, 'success', 8000);
      if (currentPage === 'sdn') loadServiceDueNotices();
    });
  }

  // Live data broadcast — refresh current page when any window saves data
  if (window.api.onDataChanged) {
    let _refreshTimer = null;
    window.api.onDataChanged(() => {
      // Debounce — multiple saves in quick succession only trigger one refresh
      clearTimeout(_refreshTimer);
      _refreshTimer = setTimeout(() => {
        // Don't refresh while a modal is open — it would destroy the user's in-progress edits
        const modalOpen = document.getElementById('modalOverlay')?.classList.contains('active');
        if (modalOpen) return;
        const refreshMap = {
          schedule: loadSchedule,
          customers: loadCustomers,
          invoices: loadInvoices,
          disposal: loadDisposals,
          sdn: loadServiceDueNotices,
          reports: loadReports,
          dep: loadDep,
          vehicles: loadVehicles,
          reminders: loadReminders,
          dashboard: loadDashboard,
        };
        const fn = refreshMap[currentPage];
        if (fn) fn();
        // Schedule map overlay: refresh its internal state too when open, so
        // manifest/job edits made from the day view (or any other surface)
        // show up on the map without requiring a toggle-off/on.
        if (currentPage === 'schedule' && scheduleMapVisible && typeof refreshMapData === 'function') {
          refreshMapData();
        }
        updateReminderBadge();
      }, 400);
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
  // 'owner' (cloud) and 'admin' (legacy) both grant admin privileges
  return currentUser && (currentUser.role === 'owner' || currentUser.role === 'admin');
}

function isOffice() {
  return currentUser && currentUser.role === 'office';
}

function isOwnerOrOffice() {
  return isAdmin() || isOffice();
}

async function doLogout() {
  // Sign out of Supabase if applicable
  try { await window.api.cloudLogout(); } catch {}
  currentUser = null;
  document.getElementById('sidebarUser').style.display = 'none';
  // Clear saved credentials so the login screen is empty next time
  localStorage.removeItem('ism_saved_password');
  // Reset nav visibility
  document.querySelectorAll('.nav-item').forEach(item => {
    item.style.display = '';
  });
  showScreen('login');
}

// Global keyboard handlers
document.addEventListener('keydown', (e) => {
  // Login/setup screens
  if (e.key === 'Enter') {
    if (document.getElementById('loginScreen').style.display === 'flex') {
      doLogin();
      return;
    } else if (document.getElementById('setupScreen').style.display === 'flex') {
      doSetup();
      return;
    }
  }

  // Modal Escape closes; Ctrl+Enter clicks the primary button
  const modalOpen = document.getElementById('modalOverlay')?.classList.contains('active');
  if (modalOpen) {
    if (e.key === 'Escape') {
      closeModal();
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      const primary = document.querySelector('#modalFooter .btn-primary');
      if (primary) {
        primary.click();
        e.preventDefault();
      }
    }
    return; // don't fire page shortcuts while modal open
  }

  // Skip shortcuts if user is typing in an input/textarea/select
  const tag = (e.target && e.target.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  // Schedule page shortcuts: T = today, [/] = prev/next, ←/→ = prev/next
  if (currentPage === 'schedule' && typeof scheduleDate !== 'undefined') {
    if (e.key === 't' || e.key === 'T') {
      scheduleDate = new Date();
      loadSchedule();
      e.preventDefault();
    } else if (e.key === '[' || e.key === 'ArrowLeft') {
      if (typeof changeScheduleDate === 'function') { changeScheduleDate(-1); e.preventDefault(); }
    } else if (e.key === ']' || e.key === 'ArrowRight') {
      if (typeof changeScheduleDate === 'function') { changeScheduleDate(1); e.preventDefault(); }
    }
  }
});

// ===== NAVIGATION =====
const PAGE_LABELS = {
  dashboard:'Dashboard', schedule:'Schedule', jobs:'Jobs', customers:'Customers',
  invoices:'Invoices', disposal:'Disposals', sdn:'Service Due', afc:'Filter Cleanings',
  reports:'Reports', motive:'Motive', messenger:'Messenger',
  dep:'DEP Reports', vehicles:'Vehicles',
  reminders:'Reminders', settings:'Settings', trash:'Recycling Bin'
};

function setupNavigation() {
  // Event delegation on the sidebar-nav container so clicks always land on the
  // right page even after drag-reordering rearranges the DOM.
  const nav = document.getElementById('sidebarNav') || document.querySelector('.sidebar-nav');
  if (nav && !nav._ismNavWired) {
    nav._ismNavWired = true;
    nav.addEventListener('click', (e) => {
      // Ignore clicks on the inline hide button, reset button, or hidden-drawer chips
      if (e.target.closest('.nav-hide-btn, .sidebar-reset-btn, .sidebar-hidden-chip')) return;
      const item = e.target.closest('.nav-item');
      if (!item || !nav.contains(item)) return;
      const page = item.dataset.page;
      if (!page) return;
      if (_isPopup) navigateTo(page);
      else openTab(page);
    });
    nav.addEventListener('contextmenu', (e) => {
      const item = e.target.closest('.nav-item');
      if (!item || !nav.contains(item)) return;
      e.preventDefault();
      if (_isPopup) return;
      const page = item.dataset.page;
      const label = PAGE_LABELS[page] || page;
      popoutPage(page, label);
    });
  }
}

// ===== TAB SYSTEM =====
let openTabs = [];       // [{ page, label }]
let activeTabPage = null;

function openTab(page) {
  const label = PAGE_LABELS[page] || page;
  if (!openTabs.find(t => t.page === page)) {
    openTabs.push({ page, label });
  }
  switchTab(page);
}

function switchTab(page) {
  activeTabPage = page;
  renderTabBar();
  navigateTo(page);
}

function closeTab(page) {
  const idx = openTabs.findIndex(t => t.page === page);
  if (idx === -1) return;
  openTabs.splice(idx, 1);

  if (activeTabPage === page) {
    // Switch to adjacent tab or show hub
    const next = openTabs[Math.min(idx, openTabs.length - 1)];
    if (next) {
      switchTab(next.page);
    } else {
      activeTabPage = null;
      renderTabBar();
      loadHub();
    }
  } else {
    renderTabBar();
  }
}

function detachTab(page) {
  const label = PAGE_LABELS[page] || page;
  window.api.openPopupWindow({ page, title: 'ISM — ' + label });
  closeTab(page);
}

function renderTabBar() {
  const tabBar = document.getElementById('tabBar');
  const tabList = document.getElementById('tabList');
  if (!tabBar || !tabList) return;

  tabBar.style.display = openTabs.length > 0 ? 'block' : 'none';

  tabList.innerHTML = openTabs.map(t => `
    <div class="tab-item${t.page === activeTabPage ? ' active' : ''}"
         data-page="${t.page}"
         id="tab-${t.page}"
         onpointerdown="tabMouseDown(event, '${t.page}')">
      <span class="tab-label" onclick="event.stopPropagation(); switchTab('${t.page}')">${t.label}</span>
      <button class="tab-close" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation(); closeTab('${t.page}')" title="Close">&times;</button>
    </div>
  `).join('');
}

// ===== TAB DRAG-TO-DETACH / REORDER =====
let _tabDrag = null; // { page, startX, startY, ghost, detached, lastReorderIdx }

function tabMouseDown(e, page) {
  if (e.button !== 0) return;
  e.preventDefault();

  // Don't switch tab yet — wait to see if this is a click or a drag
  const idx = openTabs.findIndex(t => t.page === page);

  // Capture on tabList (stable element that survives renderTabBar rebuilds)
  const captureEl = document.getElementById('tabList');
  if (!captureEl) return;

  _tabDrag = { page, startX: e.clientX, startY: e.clientY, ghost: null, detached: false, origIdx: idx, target: captureEl, pointerId: e.pointerId, moved: false };

  try { captureEl.setPointerCapture(e.pointerId); } catch {}
  captureEl.addEventListener('pointermove', _tabDragMove);
  captureEl.addEventListener('pointerup', _tabDragEnd);
  captureEl.addEventListener('pointercancel', _tabDragEnd);
}

function _tabDragMove(e) {
  if (!_tabDrag || _tabDrag.detached) return;
  const dx = e.clientX - _tabDrag.startX;
  const dy = e.clientY - _tabDrag.startY;
  const dist = Math.sqrt(dx*dx + dy*dy);
  if (dist < 6) return;

  _tabDrag.moved = true;

  const tabBarEl = document.getElementById('tabBar');
  const tabBarRect = tabBarEl ? tabBarEl.getBoundingClientRect() : null;
  const inTabBar = tabBarRect && e.clientY >= tabBarRect.top - 10 && e.clientY <= tabBarRect.bottom + 20;

  if (inTabBar) {
    // Reorder within tab bar by X position
    const tabEls = [...document.querySelectorAll('#tabList .tab-item')];
    let targetIdx = openTabs.length;
    for (let i = 0; i < tabEls.length; i++) {
      const r = tabEls[i].getBoundingClientRect();
      if (e.clientX < r.left + r.width / 2) { targetIdx = i; break; }
    }
    const currentIdx = openTabs.findIndex(t => t.page === _tabDrag.page);
    if (currentIdx !== -1 && targetIdx !== currentIdx && targetIdx !== currentIdx + 1) {
      const tab = openTabs.splice(currentIdx, 1)[0];
      const insertAt = targetIdx > currentIdx ? targetIdx - 1 : targetIdx;
      openTabs.splice(Math.max(0, insertAt), 0, tab);
      // Re-render but preserve pointer capture on tabList
      renderTabBar();
    }
  } else if (dist > 30) {
    // Dragged well outside the tab bar — detach as native OS window
    _tabDrag.detached = true;
    const page = _tabDrag.page;
    _tabDragCleanup(e);
    _tabDrag = null;
    detachTab(page);
  }
}

function _tabDragCleanup(e) {
  if (!_tabDrag) return;
  if (_tabDrag.target) {
    _tabDrag.target.removeEventListener('pointermove', _tabDragMove);
    _tabDrag.target.removeEventListener('pointerup', _tabDragEnd);
    _tabDrag.target.removeEventListener('pointercancel', _tabDragEnd);
    try { _tabDrag.target.releasePointerCapture(_tabDrag.pointerId); } catch {}
  }
  if (_tabDrag.ghost) _tabDrag.ghost.remove();
  const origTab = document.getElementById('tab-' + _tabDrag.page);
  if (origTab) origTab.style.opacity = '';
}

function _tabDragEnd(e) {
  if (!_tabDrag) return;
  const { page, moved } = _tabDrag;
  _tabDragCleanup(e);
  _tabDrag = null;
  // If no drag movement, treat as a click — switch to the tab
  if (!moved) switchTab(page);
}

// ===== RE-ATTACH (popup → main window tab) =====
function dockToMain() {
  if (!_isPopup) return;
  if (window.api.dockToMain) {
    window.api.dockToMain(_popupPage);
  }
}

function navigateTo(page) {
  currentPage = page;

  // Clean up schedule map if leaving schedule
  clearInterval(_motiveMapRefreshTimer);
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
    jobs: 'Jobs',
    motive: 'Motive',
    invoices: 'Invoices',
    vehicles: 'Vehicles',
    wastesites: 'Waste Sites',
    disposal: 'Disposals',
    dep: 'DEP Reports',
    reports: 'Reports',
    reminders: 'Reminders',
    sdn: 'Service Due Notices',
    settings: 'Settings',
  };
  document.getElementById('pageTitle').textContent = titles[page] || page;

  // Messenger page: ensure webview is loaded, no JS loader needed
  if (page === 'messenger') {
    const wv = document.getElementById('messengerWebview');
    if (wv) {
      const checkBlank = () => {
        try {
          const url = wv.getURL();
          if (!url || url === 'about:blank') wv.loadURL('https://www.messenger.com');
          const urlEl = document.getElementById('messengerUrl');
          if (urlEl) urlEl.textContent = url || '';
        } catch (_) {}
      };
      setTimeout(checkBlank, 300);
      wv.addEventListener('did-navigate', () => {
        const urlEl = document.getElementById('messengerUrl');
        try { if (urlEl) urlEl.textContent = wv.getURL(); } catch (_) {}
      });
      wv.addEventListener('did-navigate-in-page', () => {
        const urlEl = document.getElementById('messengerUrl');
        try { if (urlEl) urlEl.textContent = wv.getURL(); } catch (_) {}
      });
      // Wire up unread badge detection (idempotent — safe to call multiple times)
      wv.addEventListener('did-finish-load', () => _initMessengerBadge(), { once: true });
      _initMessengerBadge(); // also try immediately in case already loaded
    }
    return;
  }

  // Motive page: ensure webview is loaded and live
  if (page === 'motive') {
    const wv = document.getElementById('motiveWebview');
    if (wv) {
      // Attach nav listeners exactly once
      if (!wv._ismListenersAttached) {
        wv._ismListenersAttached = true;
        const updateUrl = () => {
          const urlEl = document.getElementById('motiveUrl');
          try { if (urlEl) urlEl.textContent = wv.getURL(); } catch (_) {}
        };
        wv.addEventListener('did-navigate', updateUrl);
        wv.addEventListener('did-navigate-in-page', updateUrl);
        wv.addEventListener('did-finish-load', () => {
          wv._ismLastLoadedAt = Date.now();
          updateUrl();
        });
      }

      // Decide whether to reload. The fleet-view websocket can die silently
      // when the tab's been inactive — so reload if:
      //   - URL is blank (lost its page entirely)
      //   - it's been more than 90 seconds since we last saw the tab active
      //   - it's been more than 5 minutes since the last full load (session drift)
      const now = Date.now();
      const STALE_VISIT_MS  = 90 * 1000;       // 90s idle between visits
      const STALE_LOAD_MS   = 5  * 60 * 1000;  // 5 min since last hard load
      const lastVisit = wv._ismLastVisitAt || 0;
      const lastLoad  = wv._ismLastLoadedAt || 0;
      const idleTooLong  = lastVisit && (now - lastVisit) > STALE_VISIT_MS;
      const loadTooOld   = !lastLoad  || (now - lastLoad)  > STALE_LOAD_MS;

      setTimeout(() => {
        try {
          const url = wv.getURL();
          const target = 'https://app.gomotive.com/en-US/#/fleetview/map';
          if (!url || url === 'about:blank') {
            wv.loadURL(target);
          } else if (idleTooLong || loadTooOld) {
            // Live data (fleet positions) can go stale — force a full reload
            wv.reload();
          }
          const urlEl = document.getElementById('motiveUrl');
          if (urlEl) urlEl.textContent = url || '';
        } catch (_) {}
      }, 200);

      wv._ismLastVisitAt = now;

      // While the tab is the active page, keep ticking the visit timestamp
      // so rapid in-session tab-switches don't trigger needless reloads.
      clearInterval(wv._ismVisitTicker);
      wv._ismVisitTicker = setInterval(() => {
        if (currentPage !== 'motive') { clearInterval(wv._ismVisitTicker); return; }
        wv._ismLastVisitAt = Date.now();
      }, 10 * 1000);
    }
    return;
  }

  const loaders = {
    dashboard: loadDashboard,
    customers: loadCustomers,
    schedule: loadSchedule,
    jobs: loadJobsList,
    invoices: loadInvoices,
    vehicles: loadVehicles,
    wastesites: loadWasteSites,
    disposal: loadDisposal,
    dep: loadDepReports,
    reports: loadReports,
    reminders: loadReminders,
    sdn: loadServiceDueNotices,
    settings: loadSettings,
    trash: loadTrash,
    afc: loadAFC,
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
    reports: '<button class="btn btn-secondary" onclick="exportReportPdf()">&#128196; Export CSV</button>',
    sdn: '<button class="btn btn-primary" onclick="openServiceDueNoticeModal()">+ New Service Due Notice</button>',
  };
  container.innerHTML = actions[page] || '';
}

// ===== MODAL =====
function openModal(title, bodyHtml, footerHtml) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHtml;
  document.getElementById('modalFooter').innerHTML = footerHtml || '';
  // Reset position to center on each open
  const modal = document.querySelector('.modal');
  modal.style.top = '';
  modal.style.left = '';
  modal.style.transform = '';
  modal.style.top = '50%';
  modal.style.left = '50%';
  modal.style.transform = 'translate(-50%, -50%)';
  document.getElementById('modalOverlay').classList.add('active');
  // Auto-focus first input
  setTimeout(() => {
    const firstInput = document.querySelector('#modalBody input:not([type=hidden]), #modalBody textarea, #modalBody select');
    if (firstInput) firstInput.focus();
  }, 100);
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
  document.querySelector('.modal')?.classList.remove('minimized');
}

function toggleMinimizeModal() {
  const modal = document.querySelector('.modal');
  const isMin = modal.classList.toggle('minimized');
  const minBtn = modal.querySelector('.modal-min-btn');
  if (minBtn) minBtn.title = isMin ? 'Restore' : 'Minimize';
  // When minimizing, snap to bottom-left; when restoring, re-center
  if (isMin) {
    modal.style.transform = 'none';
    modal.style.left = '20px';
    modal.style.top = (window.innerHeight - 56) + 'px';
  } else {
    modal.style.left = '50%';
    modal.style.top = '50%';
    modal.style.transform = 'translate(-50%, -50%)';
  }
}

// ===== MODAL DRAG =====
(function initModalDrag() {
  let dragging = false, startX, startY, origLeft, origTop;

  document.addEventListener('mousedown', (e) => {
    const header = e.target.closest('.modal-header');
    if (!header || e.target.closest('.modal-close') || e.target.closest('.modal-min-btn')) return;
    // Clicking minimized header restores it
    const modal = header.closest('.modal');
    if (!modal) return;
    if (modal.classList.contains('minimized')) { toggleMinimizeModal(); return; }

    // Convert current position to absolute px so transform doesn't fight dragging
    const rect = modal.getBoundingClientRect();
    modal.style.transform = 'none';
    modal.style.left = rect.left + 'px';
    modal.style.top = rect.top + 'px';

    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    origLeft = rect.left;
    origTop = rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const modal = document.querySelector('.modal');
    if (!modal) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    modal.style.left = (origLeft + dx) + 'px';
    modal.style.top = (origTop + dy) + 'px';
  });

  document.addEventListener('mouseup', () => { dragging = false; });
})();

// Modal backdrop click intentionally disabled — use X button or Escape to close
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
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

// ===== HUB (main window landing) =====
async function loadHub() {
  // Show the schedule page element as the active canvas
  document.querySelectorAll('.page').forEach(p => { p.classList.remove('active'); p.style.display = ''; });
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));

  const today = new Date();
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dateStr = today.toISOString().split('T')[0];

  const [jobsRes, custRes] = await Promise.all([
    window.api.getJobs({ date: dateStr }),
    window.api.getCustomers('')
  ]);
  const todayJobs = jobsRes?.data || [];
  const customers = custRes?.data || [];

  const sections = [
    { page:'schedule',  icon:'📅', label:'Schedule',    desc:'Day view, trucks, jobs' },
    { page:'customers', icon:'👥', label:'Customers',   desc:'Accounts & properties' },
    { page:'invoices',  icon:'📄', label:'Invoices',    desc:'Billing & payments' },
    { page:'disposal',  icon:'🚛', label:'Disposals',   desc:'Waste disposal records' },
    { page:'sdn',       icon:'📆', label:'Service Due', desc:'Upcoming service notices' },
    { page:'reports',   icon:'📈', label:'Reports',     desc:'Revenue, A/R, P&L' },
    { page:'dep',       icon:'📋', label:'DEP Reports', desc:'Compliance manifests' },
    { page:'vehicles',  icon:'🚚', label:'Vehicles',    desc:'Fleet & truck settings' },
    { page:'reminders', icon:'🔔', label:'Reminders',   desc:'Alerts & follow-ups' },
    { page:'settings',  icon:'⚙️',  label:'Settings',   desc:'App configuration' },
  ];

  // Use schedule page as hub canvas
  const page = document.getElementById('page-schedule');
  page.classList.add('active');
  document.getElementById('pageTitle').textContent = 'Interstate Septic Manager';
  document.getElementById('pageActions').innerHTML = '';

  page.innerHTML = `
    <div style="padding:32px;max-width:960px;margin:0 auto;">
      <div style="margin-bottom:28px;">
        <div style="font-size:13px;color:var(--text-light);">${dayNames[today.getDay()]}, ${monthNames[today.getMonth()]} ${today.getDate()}, ${today.getFullYear()}</div>
        <div style="display:flex;gap:24px;margin-top:12px;">
          <div class="card" style="flex:1;padding:16px;text-align:center;">
            <div style="font-size:28px;font-weight:800;color:var(--primary);">${todayJobs.length}</div>
            <div style="font-size:12px;color:var(--text-light);">Jobs Today</div>
          </div>
          <div class="card" style="flex:1;padding:16px;text-align:center;">
            <div style="font-size:28px;font-weight:800;color:#27ae60;">${todayJobs.filter(j=>j.status==='completed').length}</div>
            <div style="font-size:12px;color:var(--text-light);">Completed</div>
          </div>
          <div class="card" style="flex:1;padding:16px;text-align:center;">
            <div style="font-size:28px;font-weight:800;">${customers.length}</div>
            <div style="font-size:12px;color:var(--text-light);">Customers</div>
          </div>
        </div>
      </div>

      <div style="font-size:11px;color:var(--text-light);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Open a section</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;">
        ${sections.map(s => `
          <div onclick="popoutPage('${s.page}','${s.label}')"
            style="background:var(--bg-white);border:1px solid var(--border);border-radius:8px;padding:16px;cursor:pointer;transition:box-shadow 0.15s,border-color 0.15s;"
            onmouseover="this.style.boxShadow='0 4px 12px rgba(0,0,0,0.1)';this.style.borderColor='var(--primary)';"
            onmouseout="this.style.boxShadow='';this.style.borderColor='var(--border)';">
            <div style="font-size:24px;margin-bottom:8px;">${s.icon}</div>
            <div style="font-weight:700;font-size:14px;">${s.label}</div>
            <div style="font-size:11px;color:var(--text-light);margin-top:2px;">${s.desc}</div>
          </div>`).join('')}
      </div>
    </div>
  `;
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
          ${jobs.map(j => {
            const lineDesc = (j.line_items && j.line_items[0] && j.line_items[0].description) || j.service_type || j.job_codes || '—';
            return `
            <tr onclick="navigateTo('schedule')">
              <td>${esc(j.scheduled_time || 'TBD')}</td>
              <td>${esc(j.customers?.name || 'N/A')}</td>
              <td>${esc(lineDesc)}</td>
              <td>${esc(j.users?.name || 'Unassigned')}</td>
              <td><span class="badge badge-${(j.status || 'scheduled').replace('_','-')}">${formatStatus(j.status || 'scheduled')}</span></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  } else {
    document.getElementById('dashboardJobs').innerHTML = `
      <div class="empty-state"><div class="empty-icon">&#128197;</div><p>No jobs scheduled for today</p>
        <button class="btn btn-primary mt-12" onclick="openJobModal()">+ Add a Job</button></div>`;
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
        <thead><tr><th>Due</th><th>Message</th><th>Assigned</th></tr></thead>
        <tbody>
          ${upcoming.map(r => `
            <tr onclick="navigateTo('reminders')">
              <td>${esc(r.due_date || '')}</td>
              <td>${esc((r.message || '').slice(0, 80))}${(r.message || '').length > 80 ? '…' : ''}</td>
              <td>${esc((r.assigned_user_names || []).map(u => u.name).join(', ') || '—')}</td>
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

// Customer list sort state — persisted across loads
window._custSortBy = window._custSortBy || 'name';
window._custSortDir = window._custSortDir || 'asc';
window.setCustSort = function(col) {
  if (window._custSortBy === col) {
    window._custSortDir = window._custSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    window._custSortBy = col;
    window._custSortDir = (col === 'balance') ? 'desc' : 'asc';
  }
  loadCustomers(document.getElementById('customerSearch')?.value || '');
};

async function loadCustomers(search = '') {
  navHistory = []; // reset nav stack on top-level page
  currentCustomerId = null;
  currentPropertyId = null;
  const page = document.getElementById('page-customers');
  const { data: customers } = await window.api.getCustomers(search);

  // Sort
  const sortKey = window._custSortBy;
  const sortDir = window._custSortDir === 'desc' ? -1 : 1;
  customers.sort((a, b) => {
    let va, vb;
    if (sortKey === 'name') { va = (a.name || '').toLowerCase(); vb = (b.name || '').toLowerCase(); }
    else if (sortKey === 'address') { va = (a.primary_address || '').toLowerCase(); vb = (b.primary_address || '').toLowerCase(); }
    else if (sortKey === 'email') { va = (a.email || '').toLowerCase(); vb = (b.email || '').toLowerCase(); }
    else if (sortKey === 'phone') { va = (a.phone_cell || a.phone || '').toLowerCase(); vb = (b.phone_cell || b.phone || '').toLowerCase(); }
    else if (sortKey === 'balance') { va = a.balance || 0; vb = b.balance || 0; }
    else { va = (a.name || ''); vb = (b.name || ''); }
    if (va < vb) return -1 * sortDir;
    if (va > vb) return  1 * sortDir;
    return 0;
  });

  allCustomers = customers;

  const arrow = (col) => window._custSortBy === col ? (window._custSortDir === 'asc' ? ' ▲' : ' ▼') : '';
  const head = (col, label) => `<th style="cursor:pointer;user-select:none;" onclick="setCustSort('${col}')">${label}${arrow(col)}</th>`;

  page.innerHTML = `
    <div class="search-bar" style="display:flex;gap:8px;align-items:center;">
      <input type="text" id="customerSearch" placeholder="Search customers by name, phone, email, or property address..." value="${search}" oninput="debounceCustomerSearch()" style="flex:1;">
      <button class="btn btn-secondary btn-sm" onclick="exportCustomersCsv()">Export CSV</button>
      <button class="btn btn-danger btn-sm" id="customersBulkDeleteBtn" onclick="bulkDeleteCustomers()" disabled>Delete Selected (0)</button>
    </div>
    ${customers.length === 0 ? `
      <div class="empty-state">
        <div class="empty-icon">&#128101;</div>
        <p>No customers ${search ? 'match this search' : 'yet'}.</p>
        <button class="btn btn-primary" onclick="openCustomerModal()">+ Add Customer</button>
      </div>
    ` : `
      <div class="card" style="padding:0;overflow:hidden;">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:36px;"><input type="checkbox" id="customersSelectAll" onclick="_toggleAllCustomerCheckboxes(this.checked)"></th>
              ${head('name', 'Name')}
              ${head('address', 'Address')}
              ${head('email', 'Email')}
              ${head('phone', 'Phone')}
              ${head('balance', 'Balance')}
            </tr>
          </thead>
          <tbody>
            ${customers.map(c => `
              <tr>
                <td onclick="event.stopPropagation()"><input type="checkbox" class="customer-checkbox" data-id="${c.id}" onclick="_updateCustomerBulkBtn()"></td>
                <td onclick="openCustomerDetail('${c.id}')"><strong>${esc(c.name)}</strong></td>
                <td onclick="openCustomerDetail('${c.id}')" style="font-size:12px;">${esc(c.primary_address || '')}</td>
                <td onclick="openCustomerDetail('${c.id}')">${esc(c.email || '')}</td>
                <td onclick="openCustomerDetail('${c.id}')">${esc(c.phone_cell || c.phone || '')}</td>
                <td onclick="openCustomerDetail('${c.id}')" class="${(c.balance || 0) > 0 ? 'text-danger' : ''}">$${(c.balance || 0).toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `}
  `;
  // Restore focus & cursor position after DOM rebuild so typing isn't interrupted
  if (search !== '') {
    const searchEl = document.getElementById('customerSearch');
    if (searchEl) {
      searchEl.focus();
      searchEl.setSelectionRange(search.length, search.length);
    }
  }
}

let customerSearchTimeout;
function debounceCustomerSearch() {
  clearTimeout(customerSearchTimeout);
  customerSearchTimeout = setTimeout(() => {
    loadCustomers(document.getElementById('customerSearch').value);
  }, 300);
}

async function exportCustomersCsv() {
  try {
    const { data: customers } = await window.api.getCustomers('');
    if (!customers || !customers.length) { showToast('No customers to export.', 'info'); return; }
    const rows = [['Name', 'Company', 'Phone (Cell)', 'Phone (Home)', 'Phone (Work)', 'Email', 'Address', 'City', 'State', 'Zip', 'Property Count', 'Balance', 'Notes']];
    for (const c of customers) {
      rows.push([
        c.name || '', c.company || '',
        c.phone_cell || c.phone || '', c.phone_home || '', c.phone_work || '',
        c.email || '', c.address || '', c.city || '', c.state || '', c.zip || '',
        c.property_count || 0, (c.balance || 0).toFixed(2),
        (c.notes || '').replace(/[\r\n]+/g, ' ')
      ]);
    }
    const csv = rows.map(r => r.map(cell => {
      const s = String(cell ?? '');
      return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `customers-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Exported ${customers.length} customers.`, 'success');
  } catch (e) {
    showToast('Export failed: ' + e.message, 'error');
  }
}

function _toggleAllCustomerCheckboxes(checked) {
  document.querySelectorAll('.customer-checkbox').forEach(cb => { cb.checked = checked; });
  _updateCustomerBulkBtn();
}

function _updateCustomerBulkBtn() {
  const checked = document.querySelectorAll('.customer-checkbox:checked').length;
  const btn = document.getElementById('customersBulkDeleteBtn');
  if (btn) {
    btn.textContent = `Delete Selected (${checked})`;
    btn.disabled = checked === 0;
  }
  const total = document.querySelectorAll('.customer-checkbox').length;
  const master = document.getElementById('customersSelectAll');
  if (master) master.checked = total > 0 && checked === total;
}

let _bulkDeleteInProgress = false;
async function bulkDeleteCustomers() {
  if (_bulkDeleteInProgress) { showToast('Delete already running.', 'error'); return; }
  const ids = Array.from(document.querySelectorAll('.customer-checkbox:checked')).map(cb => cb.dataset.id);
  if (ids.length === 0) return;
  if (!confirm(`Delete ${ids.length} customer${ids.length>1?'s':''}? This also removes their properties, tanks, and is permanent.`)) return;
  _bulkDeleteInProgress = true;
  _showBulkDeleteOverlay(`Deleting ${ids.length} customer${ids.length>1?'s':''}…`);
  window.api.offBulkDeleteProgress();
  window.api.onBulkDeleteProgress((p) => _updateBulkDeleteOverlay(p));
  try {
    await window.api.bulkDeleteCustomers(ids);
    showToast(`Deleted ${ids.length} customer${ids.length>1?'s':''}.`, 'success');
  } catch (err) {
    console.error('Bulk delete failed:', err);
    showToast('Bulk delete failed: ' + (err.message || err), 'error');
  } finally {
    window.api.offBulkDeleteProgress();
    _hideBulkDeleteOverlay();
    _bulkDeleteInProgress = false;
  }
  loadCustomers(document.getElementById('customerSearch')?.value || '');
}

function _showBulkDeleteOverlay(title) {
  let overlay = document.getElementById('bulkDeleteOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'bulkDeleteOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div style="background:white;border-radius:10px;padding:24px;min-width:360px;max-width:440px;box-shadow:0 10px 40px rgba(0,0,0,0.3);">
      <div style="font-size:16px;font-weight:600;margin-bottom:12px;" id="bulkDelTitle">${esc(title)}</div>
      <div style="font-size:12px;color:#666;margin-bottom:6px;" id="bulkDelMsg">Preparing…</div>
      <div style="height:14px;background:#e0e0e0;border-radius:7px;overflow:hidden;">
        <div id="bulkDelBar" style="height:100%;width:0%;background:linear-gradient(90deg,#c62828,#ef5350);transition:width 0.15s;"></div>
      </div>
      <div style="margin-top:10px;font-size:11px;color:#888;font-style:italic;">Please wait — do not close the app.</div>
    </div>
  `;
}
function _updateBulkDeleteOverlay(p) {
  const msg = document.getElementById('bulkDelMsg');
  const bar = document.getElementById('bulkDelBar');
  if (!bar) return;
  if (msg) msg.textContent = p.message || (p.stage || '');
  if (p.total) {
    const pct = Math.min(100, Math.round((p.current / p.total) * 100));
    bar.style.width = pct + '%';
  } else if (p.stage === 'saving' || p.stage === 'done') {
    bar.style.width = '100%';
  }
}
function _hideBulkDeleteOverlay() {
  const overlay = document.getElementById('bulkDeleteOverlay');
  if (overlay) overlay.remove();
}

// ===== JOBS MASTER LIST =====
// Persistent filter state for Jobs tab — survives navigating away and back
let _jobsListState = {
  search: '',
  period: 'all',      // all | past | today | week | month | future | custom
  status: 'all',      // all | scheduled | in_progress | completed | cancelled
  sort: 'oldest',     // newest | oldest — oldest so past is on top, future below, today in middle
  dateFrom: '',
  dateTo: '',
};
let _jobsListCache = null; // last fetched list, reused when only filter changes
let _jobsListScrollToToday = true; // auto-scroll to today's section on next render

async function loadJobsList(forceRefresh = true) {
  const page = document.getElementById('page-jobs');
  if (!page) return;
  navHistory = [];

  if (forceRefresh || !_jobsListCache) {
    const { data } = await window.api.getJobs({});
    _jobsListCache = data || [];
  }

  _jobsListScrollToToday = true; // landing on the tab → snap to today
  _renderJobsList();
}

function _renderJobsList() {
  const page = document.getElementById('page-jobs');
  if (!page) return;

  const s = _jobsListState;
  const today = new Date().toISOString().split('T')[0];

  // --- Build filtered view ---
  let rows = (_jobsListCache || []).slice();

  // Period filter
  if (s.period !== 'all') {
    const now = new Date();
    const startOfToday = today;
    if (s.period === 'today') {
      rows = rows.filter(j => (j.scheduled_date || '') === startOfToday);
    } else if (s.period === 'past') {
      rows = rows.filter(j => (j.scheduled_date || '') < startOfToday);
    } else if (s.period === 'future') {
      rows = rows.filter(j => (j.scheduled_date || '') > startOfToday);
    } else if (s.period === 'week') {
      const d = new Date(now); d.setDate(d.getDate() - d.getDay()); // Sun
      const from = d.toISOString().split('T')[0];
      d.setDate(d.getDate() + 6);
      const to = d.toISOString().split('T')[0];
      rows = rows.filter(j => (j.scheduled_date || '') >= from && (j.scheduled_date || '') <= to);
    } else if (s.period === 'month') {
      const from = today.substring(0, 7) + '-01';
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const to = nextMonth.toISOString().split('T')[0];
      rows = rows.filter(j => (j.scheduled_date || '') >= from && (j.scheduled_date || '') <= to);
    } else if (s.period === 'custom') {
      if (s.dateFrom) rows = rows.filter(j => (j.scheduled_date || '') >= s.dateFrom);
      if (s.dateTo) rows = rows.filter(j => (j.scheduled_date || '') <= s.dateTo);
    }
  }

  // Status filter
  if (s.status !== 'all') {
    rows = rows.filter(j => (j.status || 'scheduled') === s.status);
  }

  // Search — name, address, service, notes, manifest, invoice, tech
  if (s.search.trim()) {
    const q = s.search.trim().toLowerCase();
    rows = rows.filter(j => {
      const hay = [
        j.customers?.name,
        j.property?.address, j.property?.city, j.property?.state, j.property?.zip,
        j.service_type, j.job_type, j.job_codes,
        j.notes, j.internal_notes,
        j.manifest_number, j.invoice_number,
        j.users?.name, j.assigned_to_name,
        j.status,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  // Sort
  rows.sort((a, b) => {
    const da = (a.scheduled_date || '') + ' ' + (a.scheduled_time || '');
    const db = (b.scheduled_date || '') + ' ' + (b.scheduled_time || '');
    return s.sort === 'oldest' ? da.localeCompare(db) : db.localeCompare(da);
  });

  const totalJobs = (_jobsListCache || []).length;

  page.innerHTML = `
    <div class="card" style="padding:10px 12px;margin-bottom:10px;">
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
        <input type="text" id="jobsSearch" placeholder="Search customer, address, service, notes, manifest..."
               value="${esc(s.search)}"
               oninput="_onJobsSearch(this.value)"
               style="flex:1;min-width:260px;padding:8px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px;">

        <select onchange="_setJobsPeriod(this.value)" style="padding:7px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px;">
          <option value="all" ${s.period==='all'?'selected':''}>All Time</option>
          <option value="past" ${s.period==='past'?'selected':''}>Past</option>
          <option value="today" ${s.period==='today'?'selected':''}>Today</option>
          <option value="week" ${s.period==='week'?'selected':''}>This Week</option>
          <option value="month" ${s.period==='month'?'selected':''}>This Month</option>
          <option value="future" ${s.period==='future'?'selected':''}>Future</option>
          <option value="custom" ${s.period==='custom'?'selected':''}>Custom Range…</option>
        </select>

        <select onchange="_setJobsStatus(this.value)" style="padding:7px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px;">
          <option value="all" ${s.status==='all'?'selected':''}>All Statuses</option>
          <option value="scheduled" ${s.status==='scheduled'?'selected':''}>Scheduled</option>
          <option value="in_progress" ${s.status==='in_progress'?'selected':''}>In Progress</option>
          <option value="completed" ${s.status==='completed'?'selected':''}>Completed</option>
          <option value="cancelled" ${s.status==='cancelled'?'selected':''}>Cancelled</option>
        </select>

        <select onchange="_setJobsSort(this.value)" style="padding:7px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px;">
          <option value="newest" ${s.sort==='newest'?'selected':''}>Newest First</option>
          <option value="oldest" ${s.sort==='oldest'?'selected':''}>Oldest First</option>
        </select>

        <button class="btn btn-secondary btn-sm" onclick="_resetJobsFilters()" title="Clear all filters">Clear</button>
        <button class="btn btn-secondary btn-sm" onclick="loadJobsList(true)" title="Reload from disk">&#8635;</button>
        <button class="btn btn-danger btn-sm" id="jobsBulkDeleteBtn" onclick="bulkDeleteJobs()" disabled>Delete Selected (0)</button>
      </div>

      ${s.period === 'custom' ? `
        <div style="display:flex;gap:8px;align-items:center;margin-top:8px;">
          <label style="font-size:12px;color:var(--text-light);">From</label>
          <input type="date" value="${esc(s.dateFrom)}" onchange="_setJobsDate('from', this.value)"
                 style="padding:6px 8px;border:1px solid #ccc;border-radius:4px;font-size:13px;">
          <label style="font-size:12px;color:var(--text-light);">To</label>
          <input type="date" value="${esc(s.dateTo)}" onchange="_setJobsDate('to', this.value)"
                 style="padding:6px 8px;border:1px solid #ccc;border-radius:4px;font-size:13px;">
        </div>
      ` : ''}

      <div style="font-size:12px;color:var(--text-light);margin-top:8px;">
        Showing <strong>${rows.length}</strong> of ${totalJobs} job${totalJobs!==1?'s':''}
      </div>
    </div>

    ${rows.length === 0 ? `
      <div class="empty-state">
        <div class="empty-icon">&#128221;</div>
        <p>No jobs match these filters.</p>
      </div>
    ` : `
      <div class="card" style="padding:0;overflow:hidden;">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:36px;"><input type="checkbox" id="jobsSelectAll" onclick="_toggleAllJobCheckboxes(this.checked)"></th>
              <th style="width:110px;">Date</th>
              <th style="width:70px;">Time</th>
              <th>Customer</th>
              <th>Address</th>
              <th>Service</th>
              <th style="width:110px;">Status</th>
              <th style="width:130px;">Tech</th>
            </tr>
          </thead>
          <tbody>
            ${_renderJobsListRowsWithTodayDivider(rows, today)}
          </tbody>
        </table>
      </div>
    `}
  `;

  // Restore cursor position in search after re-render (preserve typing)
  const searchEl = document.getElementById('jobsSearch');
  if (searchEl && s.search) {
    searchEl.focus();
    try { searchEl.setSelectionRange(s.search.length, s.search.length); } catch(_) {}
  }

  // Auto-scroll to today's section on first landing (not on every filter change)
  if (_jobsListScrollToToday) {
    _jobsListScrollToToday = false;
    requestAnimationFrame(() => {
      const anchor = document.getElementById('jobsTodayAnchor');
      if (anchor && anchor.scrollIntoView) {
        anchor.scrollIntoView({ block: 'start', behavior: 'auto' });
      }
    });
  }
}

// Render rows and mark the first today-or-future row (oldest-first) /
// today-or-past row (newest-first) with an invisible scroll anchor so
// the Jobs tab lands the viewport on today.
function _renderJobsListRowsWithTodayDivider(rows, today) {
  const s = _jobsListState;
  const oldestFirst = s.sort === 'oldest';
  let anchorPlaced = false;
  const parts = [];

  for (let i = 0; i < rows.length; i++) {
    const j = rows[i];
    const d = j.scheduled_date || '';
    let extra = '';
    if (!anchorPlaced) {
      const hit = oldestFirst ? (d >= today) : (d <= today);
      if (hit) { extra = 'id="jobsTodayAnchor"'; anchorPlaced = true; }
    }
    parts.push(_renderJobsListRow(j, today, extra));
  }

  // If no row qualifies (e.g. only past jobs exist), append an invisible anchor at end
  if (!anchorPlaced) {
    parts.push(`<tr id="jobsTodayAnchor"><td colspan="8" style="height:0;padding:0;border:none;"></td></tr>`);
  }

  return parts.join('');
}

function _renderJobsListRow(j, today, extraAttrs = '') {
  const status = j.status || 'scheduled';
  const statusColor = {
    scheduled: '#1565c0',
    in_progress: '#e65100',
    completed: '#2e7d32',
    cancelled: '#757575',
  }[status] || '#555';
  const dateStr = j.scheduled_date || '';
  let rowBg = '';
  if (dateStr) {
    if (dateStr === today) rowBg = 'background:#c8e6c9;';      // today — light green
    else if (dateStr < today) rowBg = 'background:#fffde7;';   // past — light yellow
    else rowBg = 'background:#e3f2fd;';                         // future — light blue
  }

  const addr = j.property
    ? [j.property.address, j.property.city, j.property.state].filter(Boolean).join(', ')
    : '';

  const svc = j.service_type
    || j.job_type
    || (Array.isArray(j.job_codes) ? j.job_codes.join(', ') : (j.job_codes || ''))
    || 'Pumping';

  const techName = j.users?.name || j.assigned_to_name || '';

  const custId = j.customer_id || j.customers?.id || '';
  const custName = esc(j.customers?.name || '—');
  const customerCell = custId
    ? `<strong><a href="#" style="color:#1565c0;text-decoration:underline;" onclick="event.preventDefault();event.stopPropagation();openCustomerDetail('${custId}')">${custName}</a></strong>`
    : `<strong>${custName}</strong>`;
  const addressCell = custId && addr
    ? `<a href="#" style="color:#1565c0;text-decoration:underline;" onclick="event.preventDefault();event.stopPropagation();openCustomerDetail('${custId}'${j.property_id ? ",'" + j.property_id + "'" : ''})">${esc(addr)}</a>`
    : esc(addr);

  return `
    <tr style="cursor:pointer;${rowBg}" ${extraAttrs}>
      <td onclick="event.stopPropagation()" style="width:36px;"><input type="checkbox" class="job-checkbox" data-id="${j.id}" onclick="_updateJobBulkBtn()"></td>
      <td onclick="openJobDetail('${j.id}')" style="white-space:nowrap;">${esc(dateStr)}</td>
      <td onclick="openJobDetail('${j.id}')" style="white-space:nowrap;color:var(--text-light);">${esc(j.scheduled_time || '')}</td>
      <td onclick="openJobDetail('${j.id}')">${customerCell}${j.manifest_number ? ` <span style="color:var(--text-light);font-size:11px;">#${esc(j.manifest_number)}</span>` : ''}</td>
      <td onclick="openJobDetail('${j.id}')" style="font-size:12px;">${addressCell}</td>
      <td onclick="openJobDetail('${j.id}')" style="font-size:12px;">${esc(svc)}</td>
      <td onclick="openJobDetail('${j.id}')"><span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:${statusColor}15;color:${statusColor};">${esc(formatStatus ? formatStatus(status) : status)}</span></td>
      <td onclick="openJobDetail('${j.id}')" style="font-size:12px;">${esc(techName)}</td>
    </tr>
  `;
}

function _toggleAllJobCheckboxes(checked) {
  document.querySelectorAll('.job-checkbox').forEach(cb => { cb.checked = checked; });
  _updateJobBulkBtn();
}

function _updateJobBulkBtn() {
  const checked = document.querySelectorAll('.job-checkbox:checked').length;
  const btn = document.getElementById('jobsBulkDeleteBtn');
  if (btn) {
    btn.textContent = `Delete Selected (${checked})`;
    btn.disabled = checked === 0;
  }
  const total = document.querySelectorAll('.job-checkbox').length;
  const master = document.getElementById('jobsSelectAll');
  if (master) master.checked = total > 0 && checked === total;
}

async function bulkDeleteJobs() {
  if (_bulkDeleteInProgress) { showToast('Delete already running.', 'error'); return; }
  const ids = Array.from(document.querySelectorAll('.job-checkbox:checked')).map(cb => cb.dataset.id);
  if (ids.length === 0) return;
  if (!confirm(`Delete ${ids.length} job${ids.length>1?'s':''}? This is permanent.`)) return;
  _bulkDeleteInProgress = true;
  _showBulkDeleteOverlay(`Deleting ${ids.length} job${ids.length>1?'s':''}…`);
  window.api.offBulkDeleteProgress();
  window.api.onBulkDeleteProgress((p) => _updateBulkDeleteOverlay(p));
  try {
    await window.api.bulkDeleteJobs(ids);
    showToast(`Deleted ${ids.length} job${ids.length>1?'s':''}.`, 'success');
  } catch (err) {
    console.error('Bulk delete failed:', err);
    showToast('Bulk delete failed: ' + (err.message || err), 'error');
  } finally {
    window.api.offBulkDeleteProgress();
    _hideBulkDeleteOverlay();
    _bulkDeleteInProgress = false;
  }
  loadJobsList(true);
}

let _jobsSearchTimer;
function _onJobsSearch(value) {
  _jobsListState.search = value;
  clearTimeout(_jobsSearchTimer);
  _jobsSearchTimer = setTimeout(_renderJobsList, 200);
}
function _setJobsPeriod(v) { _jobsListState.period = v; _renderJobsList(); }
function _setJobsStatus(v) { _jobsListState.status = v; _renderJobsList(); }
function _setJobsSort(v)   { _jobsListState.sort   = v; _renderJobsList(); }
function _setJobsDate(which, v) {
  if (which === 'from') _jobsListState.dateFrom = v;
  else _jobsListState.dateTo = v;
  _renderJobsList();
}
function _resetJobsFilters() {
  _jobsListState = { search: '', period: 'all', status: 'all', sort: 'newest', dateFrom: '', dateTo: '' };
  _renderJobsList();
}

function openCustomerModal(customer = null) {
  // New customer — use the full unified contact + property + tanks form
  if (!customer) {
    openCustomerModalFromJob(false);
    return;
  }
  const isEdit = true;
  const c = customer || {};
  openModal(isEdit ? 'Edit Customer' : 'New Customer', `
    <input type="hidden" id="customerId" value="${c.id || ''}">
    <div class="form-group">
      <label>Customer Name *</label>
      <input type="text" id="customerName" value="${esc(c.name || '')}" placeholder="John & Jane Doe">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Cell Phone</label>
        <input type="text" id="customerPhoneCell" value="${esc(c.phone_cell || c.phone || '')}" placeholder="(207) 555-1234">
      </div>
      <div class="form-group">
        <label>Home Phone</label>
        <input type="text" id="customerPhoneHome" value="${esc(c.phone_home || '')}" placeholder="(207) 555-1234">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Work Phone</label>
        <input type="text" id="customerPhoneWork" value="${esc(c.phone_work || '')}" placeholder="(207) 555-1234">
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
  `, `
    ${isEdit ? '<button class="btn btn-danger" onclick="deleteCustomer()">Delete</button>' : ''}
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveCustomer()">Save</button>
  `);
}

async function saveCustomer() {
  const data = {
    name: document.getElementById('customerName').value.trim(),
    phone_cell: document.getElementById('customerPhoneCell').value.trim(),
    phone_home: document.getElementById('customerPhoneHome').value.trim(),
    phone_work: document.getElementById('customerPhoneWork').value.trim(),
    email: document.getElementById('customerEmail').value.trim(),
    address: document.getElementById('customerAddress').value.trim(),
    city: document.getElementById('customerCity').value.trim(),
    state: document.getElementById('customerState').value.trim(),
    zip: document.getElementById('customerZip').value.trim(),
    contact_method: document.getElementById('customerContactMethod').value,
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

// ===== CONTACT NOTES =====
function renderContactNotes(notesLog, legacyNotes) {
  const entries = Array.isArray(notesLog) ? [...notesLog] : [];

  // Migrate old plain-text notes as first entry if no log yet
  if (entries.length === 0 && legacyNotes) {
    entries.push({ id: 'legacy', text: legacyNotes, created_at: null, author: '' });
  }

  if (entries.length === 0) {
    return `<div style="font-size:12px;color:var(--text-light);padding:4px 0;">No notes yet.</div>`;
  }

  // Newest first
  return [...entries].reverse().map(n => {
    const dt = n.created_at ? new Date(n.created_at) : null;
    const dateStr = dt ? dt.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' }) + ' @ ' +
      dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '';
    return `
      <div style="padding:7px 8px;margin-bottom:6px;background:#fafafa;border-left:3px solid #1565c0;border-radius:0 4px 4px 0;font-size:12px;position:relative;">
        ${dateStr || n.author ? `<div style="font-size:10px;color:var(--text-light);margin-bottom:3px;font-weight:600;">${dateStr}${n.author ? (dateStr ? ' — ' : '') + esc(n.author) : ''}</div>` : ''}
        <div style="white-space:pre-wrap;line-height:1.5;">${esc(n.text)}</div>
        <button onclick="deleteContactNote('${n.customerId || ''}','${n.id}')" style="position:absolute;top:4px;right:4px;background:none;border:none;color:#ccc;cursor:pointer;font-size:14px;padding:0 3px;" title="Delete note">&times;</button>
      </div>`;
  }).join('');
}

function openAddNoteModal(customerId) {
  openModal('Add Contact Note', `
    <input type="hidden" id="noteCustomerId" value="${customerId}">
    <div class="form-group">
      <label>Note</label>
      <textarea id="newNoteText" rows="5" placeholder="Enter note..." style="width:100%;"></textarea>
    </div>
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveContactNote()">Save Note</button>
  `);
}

async function saveContactNote() {
  const customerId = document.getElementById('noteCustomerId').value;
  const text = document.getElementById('newNoteText').value.trim();
  if (!text) { showToast('Note cannot be empty.', 'error'); return; }

  const { data: customer } = await window.api.getCustomer(customerId);
  const existingLog = Array.isArray(customer.notes_log) ? customer.notes_log : [];

  // Migrate legacy notes on first save
  if (existingLog.length === 0 && customer.notes) {
    existingLog.push({ id: crypto.randomUUID(), text: customer.notes, created_at: null, author: '', customerId });
  }

  const newEntry = {
    id: crypto.randomUUID(),
    text,
    created_at: new Date().toISOString(),
    author: currentUser?.name || '',
    customerId,
  };
  existingLog.push(newEntry);

  await window.api.saveCustomer({ id: customerId, notes_log: existingLog, notes: '' });
  closeModal();
  showToast('Note saved.', 'success');
  openCustomerDetail(customerId, currentPropertyId);
}

async function deleteContactNote(customerId, noteId) {
  if (!customerId || !noteId || noteId === 'legacy') return;
  const { data: customer } = await window.api.getCustomer(customerId);
  const log = (customer.notes_log || []).filter(n => n.id !== noteId);
  await window.api.saveCustomer({ id: customerId, notes_log: log });
  openCustomerDetail(customerId, currentPropertyId);
}

// ===== ADDITIONAL PROPERTY CONTACTS =====
const CONTACT_ROLES = ['Owner', 'Co-Owner', 'Property Manager', 'Tenant', 'Realtor', 'Emergency Contact', 'Billing Contact', 'Other'];

function renderAdditionalContacts(contacts, propertyId, customerId) {
  if (!contacts || contacts.length === 0) {
    return `<div style="font-size:12px;color:var(--text-light);">No additional contacts.</div>`;
  }
  return contacts.map(c => `
    <div style="padding:7px 8px;margin-bottom:6px;background:#fafafa;border-left:3px solid #2e7d32;border-radius:0 4px 4px 0;font-size:12px;position:relative;">
      <div style="font-weight:700;margin-bottom:2px;">${esc(c.name || '')}${c.role ? `<span style="font-size:10px;font-weight:400;color:var(--text-light);margin-left:6px;">${esc(c.role)}</span>` : ''}</div>
      ${c.phone_cell ? `<div>${esc(c.phone_cell)} <span style="color:var(--text-light);font-size:10px;">(cell)</span></div>` : ''}
      ${c.phone_home ? `<div>${esc(c.phone_home)} <span style="color:var(--text-light);font-size:10px;">(home)</span></div>` : ''}
      ${c.phone_work ? `<div>${esc(c.phone_work)} <span style="color:var(--text-light);font-size:10px;">(work)</span></div>` : ''}
      ${c.email ? `<div>${esc(c.email)}</div>` : ''}
      ${c.notify !== false ? `<span style="font-size:10px;color:#2e7d32;">&#10003; Notifications ON</span>` : `<span style="font-size:10px;color:#9e9e9e;">Notifications OFF</span>`}
      <div style="position:absolute;top:4px;right:4px;display:flex;gap:4px;">
        <button onclick="openAdditionalContactModal('${propertyId}','${customerId}',${JSON.stringify(c).replace(/"/g,'&quot;')})" style="background:none;border:none;cursor:pointer;font-size:11px;color:#1565c0;padding:0 3px;" title="Edit">&#9998;</button>
        <button onclick="deleteAdditionalContact('${propertyId}','${customerId}','${c.id}')" style="background:none;border:none;cursor:pointer;font-size:14px;color:#ccc;padding:0 3px;" title="Delete">&times;</button>
      </div>
    </div>`).join('');
}

function openAdditionalContactModal(propertyId, customerId, contact = null) {
  const isEdit = !!contact;
  const c = contact || {};
  openModal(isEdit ? 'Edit Contact' : 'Add Contact', `
    <input type="hidden" id="addlContactId" value="${c.id || ''}">
    <input type="hidden" id="addlContactPropertyId" value="${propertyId}">
    <input type="hidden" id="addlContactCustomerId" value="${customerId}">
    <div class="form-row">
      <div class="form-group">
        <label>Name *</label>
        <input type="text" id="addlContactName" value="${esc(c.name || '')}" placeholder="Jane Smith">
      </div>
      <div class="form-group">
        <label>Role</label>
        <select id="addlContactRole">
          <option value="">-- Select --</option>
          ${CONTACT_ROLES.map(r => `<option value="${r}" ${c.role === r ? 'selected' : ''}>${r}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Cell Phone</label>
        <input type="text" id="addlContactPhoneCell" value="${esc(c.phone_cell || '')}" placeholder="(207) 555-1234">
      </div>
      <div class="form-group">
        <label>Home Phone</label>
        <input type="text" id="addlContactPhoneHome" value="${esc(c.phone_home || '')}" placeholder="(207) 555-1234">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Work Phone</label>
        <input type="text" id="addlContactPhoneWork" value="${esc(c.phone_work || '')}" placeholder="(207) 555-1234">
      </div>
      <div class="form-group">
        <label>Email</label>
        <input type="email" id="addlContactEmail" value="${esc(c.email || '')}" placeholder="contact@email.com">
      </div>
    </div>
    <div class="form-group">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
        <input type="checkbox" id="addlContactNotify" ${c.notify !== false ? 'checked' : ''}>
        Send service notifications to this contact
      </label>
    </div>
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveAdditionalContact()">Save</button>
  `);
}

async function saveAdditionalContact() {
  const propertyId = document.getElementById('addlContactPropertyId').value;
  const customerId = document.getElementById('addlContactCustomerId').value;
  const name = document.getElementById('addlContactName').value.trim();
  if (!name) { showToast('Name is required.', 'error'); return; }

  const existingId = document.getElementById('addlContactId').value;
  const entry = {
    id: existingId || crypto.randomUUID(),
    name,
    role: document.getElementById('addlContactRole').value,
    phone_cell: document.getElementById('addlContactPhoneCell').value.trim(),
    phone_home: document.getElementById('addlContactPhoneHome').value.trim(),
    phone_work: document.getElementById('addlContactPhoneWork').value.trim(),
    email: document.getElementById('addlContactEmail').value.trim(),
    notify: document.getElementById('addlContactNotify').checked,
  };

  const { data: property } = await window.api.getProperty(propertyId);
  const contacts = Array.isArray(property.additional_contacts) ? property.additional_contacts : [];
  const idx = contacts.findIndex(c => c.id === entry.id);
  if (idx >= 0) contacts[idx] = entry; else contacts.push(entry);

  await window.api.saveProperty({ id: propertyId, additional_contacts: contacts });
  closeModal();
  showToast(existingId ? 'Contact updated.' : 'Contact added.', 'success');
  openCustomerDetail(customerId, propertyId);
}

async function deleteAdditionalContact(propertyId, customerId, contactId) {
  const { data: property } = await window.api.getProperty(propertyId);
  const contacts = (property.additional_contacts || []).filter(c => c.id !== contactId);
  await window.api.saveProperty({ id: propertyId, additional_contacts: contacts });
  openCustomerDetail(customerId, propertyId);
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

  const today = formatDate(new Date());
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
            ${(customer.phone_cell || customer.phone) ? `<div style="margin-top:4px;"><strong>${esc(customer.phone_cell || customer.phone)}</strong> <span style="font-size:11px;color:var(--text-light);">(cell)</span></div>` : ''}
            ${customer.phone_home ? `<div><strong>${esc(customer.phone_home)}</strong> <span style="font-size:11px;color:var(--text-light);">(home)</span></div>` : ''}
            ${customer.phone_work ? `<div><strong>${esc(customer.phone_work)}</strong> <span style="font-size:11px;color:var(--text-light);">(work)</span></div>` : ''}
            ${customer.email ? `<div>${esc(customer.email)}</div>` : ''}
            <div style="color:var(--text-light);font-size:12px;">E-Contact Method: ${esc(customer.contact_method || 'Email & Text')}</div>
          </div>

          <div style="margin-top:12px;border-top:1px solid #eee;padding-top:8px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-weight:700;font-size:12px;color:var(--text-light);">CONTACT NOTES</span>
              <button class="btn btn-sm btn-primary" style="font-size:10px;padding:2px 8px;" onclick="openAddNoteModal('${id}')">+ Add Note</button>
            </div>
            <div id="contactNotesList_${id}" style="max-height:200px;overflow-y:auto;">
              ${renderContactNotes(customer.notes_log, customer.notes)}
            </div>
          </div>
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

        <!-- Additional Contacts -->
        <div class="card" style="padding:16px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <span style="font-weight:700;font-size:13px;">&#128101; Additional Contacts</span>
            <button class="btn btn-sm btn-primary" style="font-size:10px;padding:2px 8px;" onclick="openAdditionalContactModal('${prop.id}','${id}')">+ Add</button>
          </div>
          <div id="additionalContactsList_${prop.id}">
            ${renderAdditionalContacts(prop.additional_contacts || [], prop.id, id)}
          </div>
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
            const statusColors = { pending: '#ff9800', sent: '#2196f3', scheduled: '#4caf50', completed: '#388e3c', dismissed: '#9e9e9e', confirmed: '#43a047' };
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
        ${others.map(c => `<option value="${c.id}">${esc(c.name)}${(c.phone_cell || c.phone) ? ' — ' + esc(c.phone_cell || c.phone) : ''}</option>`).join('')}
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
    <button class="btn btn-primary" style="background:#006aff;" onclick="openSquarePayModal('${customerId}',${acctInfo.balance.toFixed(2)})">&#9654; Charge Square</button>
    ${!customer.square_customer_id ? `<button class="btn btn-secondary" style="font-size:11px;" onclick="openSquareLinkModal('${customerId}')">Link Square</button>` : ''}
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
            const delLink = r.paymentId
              ? `<a href="#" onclick="event.preventDefault();deletePaymentConfirm('${r.paymentId}','${customerId}')" style="color:#c62828;font-size:11px;" title="Delete payment">&#10005;</a>`
              : (r.invId ? `<a href="#" onclick="event.preventDefault();deleteInvoiceConfirm('${r.invId}','${customerId}')" style="color:#c62828;font-size:11px;" title="Delete invoice">&#10005;</a>` : '');
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
    let desc = '';
    if (inv.line_items && inv.line_items.length > 0) {
      desc = inv.line_items.map(li => esc(li.description || li.name || '')).filter(Boolean).join(', ');
    }
    if (!desc) desc = inv.service_type || inv.job_type || inv.job_codes || 'Pumping Service';
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
      <button class="acct-action-btn" style="background:#006aff;" onclick="openSquarePayModal('${customerId}',${balanceDue.toFixed(2)})">
        &#9654; PAY NOW${customer.square_customer_id ? '' : ' (link Square first)'}
      </button>
      ${!customer.square_customer_id ? `<button class="acct-action-btn" style="background:#555;font-size:10px;" onclick="openSquareLinkModal('${customerId}')">Link Square Acct</button>` : `<span style="font-size:11px;color:#2e7d32;align-self:center;">&#10003; Square linked</span>`}
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

async function deleteInvoiceConfirm(invoiceId, customerId) {
  if (!confirm('Delete this invoice? This cannot be undone.')) return;
  await window.api.deleteInvoice(invoiceId);
  showToast('Invoice deleted.', 'success');
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
    let desc = '';
    if (inv.line_items && inv.line_items.length > 0) {
      desc = inv.line_items.map(li => li.description || li.name || '').filter(Boolean).join(', ');
    }
    if (!desc) desc = inv.service_type || inv.job_type || inv.job_codes || 'Pumping Service';
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
    const pdfResult = await window.api.generatePdf(stmtHtml, 'statement.pdf', { skipDialog: true });
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

  const result = await window.api.generatePdf(stmtHtml, saveResult.filePath, { skipDialog: true, forcePath: saveResult.filePath });
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
    <div class="form-row">
      <div class="form-group">
        <label>Payment Due (days after service)</label>
        <input type="number" id="propertyPaymentDueDays" value="${p.payment_due_days || ''}" min="0" placeholder="e.g. 30">
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
    payment_due_days: parseInt(document.getElementById('propertyPaymentDueDays').value) || null,
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
    ${isEdit && Array.isArray(n.notification_schedule) && n.notification_schedule.length > 0 ? `
    <div style="margin-top:12px;padding:10px 12px;background:${n.status === 'confirmed' ? '#e8f5e9' : '#f0f7ff'};border-left:4px solid ${n.status === 'confirmed' ? '#43a047' : '#2196F3'};border-radius:4px;">
      <div style="font-size:12px;font-weight:700;color:${n.status === 'confirmed' ? '#2e7d32' : '#1565c0'};margin-bottom:6px;">
        ${n.status === 'confirmed' ? '✅ CONFIRMED — No further reminders will be sent' : '📅 AUTO REMINDERS'}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
        ${n.notification_schedule.map(item => `
          <div style="font-size:11px;padding:3px 6px;border-radius:3px;background:${item.sent ? '#e8f5e9' : n.status === 'confirmed' ? '#f5f5f5' : '#fff'};border:1px solid ${item.sent ? '#a5d6a7' : '#ddd'};display:flex;justify-content:space-between;align-items:center;${n.status === 'confirmed' && !item.sent ? 'opacity:0.45;' : ''}">
            <span style="color:var(--text);">${esc(item.label)}</span>
            <span style="color:${item.sent ? '#388e3c' : '#999'};font-weight:600;">${item.sent ? '✓ Sent' : n.status === 'confirmed' ? 'Cancelled' : item.send_date}</span>
          </div>`).join('')}
      </div>
    </div>` : ''}
  `, `
    ${isEdit && n.status !== 'confirmed' ? `<button class="btn" style="background:#43a047;color:white;" onclick="confirmSdn('${n.id}','${cId}','${pId}')">✓ Mark Confirmed / Booked</button>` : ''}
    ${isEdit && n.status === 'confirmed' ? `<button class="btn btn-secondary" onclick="unconfirmSdn('${n.id}','${cId}','${pId}')">↩ Unconfirm</button>` : ''}
    ${isEdit ? `<button class="btn btn-info" onclick="openServiceDueNotificationScheduler('${n.id}')">📧 Send Notification</button>` : ''}
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

async function confirmSdn(id, customerId, propertyId) {
  await window.api.saveServiceDueNotice({ id, status: 'confirmed', confirmed_at: new Date().toISOString() });
  closeModal();
  showToast('Marked as confirmed — no further reminders will send.', 'success');
  if (currentPage === 'sdn') loadServiceDueNotices();
  else if (customerId) openCustomerDetail(customerId, propertyId);
}

async function unconfirmSdn(id, customerId, propertyId) {
  await window.api.saveServiceDueNotice({ id, status: 'pending', confirmed_at: null });
  closeModal();
  showToast('Notice set back to pending — reminders will resume.', 'success');
  if (currentPage === 'sdn') loadServiceDueNotices();
  else if (customerId) openCustomerDetail(customerId, propertyId);
}

async function openServiceDueNotificationScheduler(noticeId) {
  const noticeResult = await window.api.getServiceDueNotices({ id: noticeId });
  const notices = noticeResult.data || [];
  const notice = notices[0];
  if (!notice) {
    showToast('Notice not found.', 'error');
    return;
  }

  const presets = [
    { days: 0, label: 'Today (Now)', selected: false },
    { days: 1, label: '1 Day Before', selected: false },
    { days: 3, label: '3 Days Before', selected: false },
    { days: 7, label: '1 Week Before', selected: false },
    { days: 14, label: '2 Weeks Before', selected: false },
    { days: 30, label: '1 Month Before', selected: false },
  ];

  openModal('Send Notification', `
    <input type="hidden" id="notifNoticeId" value="${notice.id}">
    <div style="margin-bottom:16px;">
      <p style="margin:0 0 12px 0;font-size:14px;color:var(--text-light);">
        Select when to send this notification to the customer:
      </p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        ${presets.map((p, i) => `
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:10px;border:1px solid #ddd;border-radius:4px;background:#fafafa;">
            <input type="radio" name="notificationDay" value="${p.days}" style="width:18px;height:18px;" />
            <span style="font-weight:500;">${p.label}</span>
          </label>
        `).join('')}
      </div>
    </div>
    <div style="padding:12px;background:#f0f7ff;border-left:4px solid #2196F3;border-radius:4px;margin-top:16px;">
      <p style="margin:0;font-size:13px;color:#1565c0;">
        💡 <strong>Note:</strong> Selecting a day will send the notification immediately to the customer.
      </p>
    </div>
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="sendServiceDueNotificationNow()">Send Notification</button>
  `);

  // Set first option as selected by default
  setTimeout(() => {
    const firstRadio = document.querySelector('input[name="notificationDay"]');
    if (firstRadio) firstRadio.checked = true;
  }, 100);
}

async function sendServiceDueNotificationNow() {
  const noticeId = document.getElementById('notifNoticeId').value;
  const daysSelected = document.querySelector('input[name="notificationDay"]:checked')?.value;
  
  if (!daysSelected) {
    showToast('Please select when to send the notification.', 'error');
    return;
  }

  try {
    const result = await window.api.sendServiceDueNotification(noticeId, parseInt(daysSelected));
    if (result.success) {
      closeModal();
      showToast(result.message || 'Notification sent!', 'success');
    } else {
      showToast(result.error || 'Failed to send notification', 'error');
    }
  } catch (err) {
    showToast('Error sending notification: ' + err.message, 'error');
  }
}

// Default auto-notification schedule by service type (days relative to due date; negative = before, positive = after)
const SDN_AUTO_SCHEDULES = {
  'Pumping': [
    { days_offset: -30, label: '1 Month Before' },
    { days_offset: -7,  label: '1 Week Before' },
    { days_offset: 0,   label: 'Day Of' },
    { days_offset: 30,  label: '1 Month After' },
  ],
};
// Fallback schedule for any service type not listed above
const SDN_DEFAULT_SCHEDULE = [
  { days_offset: -30, label: '1 Month Before' },
  { days_offset: -7,  label: '1 Week Before' },
  { days_offset: 0,   label: 'Day Of' },
];

function addDaysToDate(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

async function quickCreateSdn(customerId, propertyId, serviceType, interval, unit, fromJobId) {
  // Use the specific job's service date if coming from a job; fall back to most recent job
  let baseDate;
  if (fromJobId) {
    const { data: job } = await window.api.getJob(fromJobId);
    baseDate = job?.svc_date || new Date().toISOString().split('T')[0];
  } else {
    const { data: jobs } = await window.api.getJobs({ customerId });
    const recentJob = jobs.sort((a, b) => (b.svc_date || '').localeCompare(a.svc_date || ''))[0];
    baseDate = recentJob?.svc_date || new Date().toISOString().split('T')[0];
  }
  const dueDate = calcNextServiceDate(baseDate, interval, unit);

  // Build auto-notification schedule
  const scheduleTemplate = SDN_AUTO_SCHEDULES[serviceType] || SDN_DEFAULT_SCHEDULE;
  const notification_schedule = scheduleTemplate.map(item => ({
    days_offset: item.days_offset,
    label: item.label,
    send_date: addDaysToDate(dueDate, item.days_offset),
    sent: false,
  }));

  const data = {
    customer_id: customerId,
    property_id: propertyId,
    job_id: fromJobId || null,
    service_type: serviceType,
    due_date: dueDate,
    method: 'email',
    status: 'pending',
    email_enabled: true,
    interval_value: interval,
    interval_unit: unit,
    notification_schedule,
    confirm_token: crypto.randomUUID(),
  };

  const result = await window.api.saveServiceDueNotice(data);
  if (result.success) {
    const scheduleDesc = notification_schedule.map(s => s.label).join(', ');
    showToast(`${serviceType} / ${interval} ${unit} notice created (due ${dueDate}). Auto-reminders: ${scheduleDesc}.`, 'success');
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
        <div class="schedule-nav" style="display:flex;align-items:center;gap:6px;">
          <button class="btn btn-secondary btn-sm" onclick="changeScheduleDate(-1)" title="Previous (←)">&#9664;</button>
          <span class="schedule-date-display">${headerDateText}</span>
          <button class="btn btn-secondary btn-sm" onclick="changeScheduleDate(1)" title="Next (→)">&#9654;</button>
          <input type="date" id="scheduleDateJump" value="${dateStr}" onchange="jumpScheduleToDate(this.value)" style="padding:4px 6px;font-size:12px;margin-left:6px;" title="Jump to date">
          <button class="btn btn-secondary btn-sm" onclick="scheduleDate = new Date(); loadSchedule();" title="Today (T)" style="margin-left:4px;">Today</button>
        </div>
      </div>
      <div class="schedule-toolbar-right">
        <button class="btn btn-sm ${scheduleView === 'month' ? 'btn-primary' : 'btn-secondary'}" onclick="setScheduleView('month')">MONTH</button>
        <button class="btn btn-sm ${scheduleView === 'week' ? 'btn-primary' : 'btn-secondary'}" onclick="setScheduleView('week')">WEEK</button>
        <button class="btn btn-sm ${scheduleView === 'day' ? 'btn-primary' : 'btn-secondary'}" onclick="scheduleDate = new Date(); setScheduleView('day');">DAY</button>
        <button class="btn btn-sm" style="background:#1565c0;color:#fff;" onclick="toggleScheduleMap()">&#128506; Map</button>
        <button class="btn btn-sm" style="background:#43a047;color:#fff;" onclick="printRouteSheets()" title="Print one route sheet per truck for today">&#128424; Print Routes</button>
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
  const { data: dayAssignments } = await window.api.getTruckDayAssignments(dateStr);
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
          <h4>&#128221; Notes</h4>
          <div class="draggable-chip" style="cursor:grab;border-left:3px solid #f9a825;background:#1a1600;"
            onmousedown="onChipMouseDown(event, 'note', '')">
            <span class="chip-icon" style="color:#f9a825;">&#128221;</span> Note
          </div>
          <div style="font-size:10px;color:var(--text-light);margin-top:2px;">Drag into a truck column</div>
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
          <div id="drivers-scoreboard-list">
          ${users.map(u => {
            return '<div class="driver-scoreboard-item" data-user-id="' + u.id + '">'
              + '<div class="draggable-chip" style="cursor:grab;border-left: 3px solid ' + (u.color || '#1565c0') + ';"'
              + ' onmousedown="onChipMouseDown(event, \'driver_change\', \'' + u.id + '\')">'
              + '<svg class="chip-icon" viewBox="0 0 24 24" width="14" height="14" style="vertical-align:-2px;margin-right:4px;fill:' + (u.color || '#1565c0') + ';"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>' + esc(u.name)
              + '</div>'
              + '<div class="driver-revenue-bar" style="margin:-4px 0 6px 0;">'
              + '<div style="height:5px;background:#e0e0e0;border-radius:3px;overflow:hidden;">'
              + '<div id="rev-bar-' + u.id + '" style="height:100%;width:0%;background:' + (u.color || '#1565c0') + ';border-radius:3px;transition:width 0.3s;"></div>'
              + '</div>'
              + '<div id="rev-amt-' + u.id + '" style="font-size:10px;color:var(--text-light);margin-top:1px;">$0.00</div>'
              + '</div>'
              + '</div>';
          }).join('')}
          </div>
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
            const dayAssign = dayAssignments.find(a => a.vehicle_id === v.id);
            const activeTechId = dayAssign?.user_id ?? v.default_tech_id;
            const tech = users.find(u => u.id === activeTechId);
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
                  <div class="truck-capacity">${capacity ? capacity.toLocaleString() + ' Gallons' : '&nbsp;'}</div>
                  <select class="truck-driver-select" style="background:${tech?.color || '#888'};"
                    onchange="changeTruckDriver('${v.id}', '${dateStr}', this.value); this.style.background = this.selectedOptions[0]?.dataset?.color || '#888';"
                    >
                    <option value="" data-color="#888" ${!activeTechId ? 'selected' : ''}>Unassigned</option>
                    ${users.map(u => `<option value="${u.id}" data-color="${u.color || '#1565c0'}" ${u.id === activeTechId ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}
                  </select>
                  <div class="capacity-bar-container">
                    <div class="capacity-bar">
                      ${plannedGallons > 0 ? `<div class="capacity-bar-fill ${barColor}" style="width: ${pct}%;"></div>` : ''}
                    </div>
                    <div class="capacity-text">${plannedGallons > 0 ? `${disposedGallons.toLocaleString()} disposed / ${plannedGallons.toLocaleString()} planned &nbsp;|&nbsp; ${vehicleJobs.filter(j => j.status === 'completed').length}/${vehicleJobs.length} jobs` : '&nbsp;'}</div>
                  </div>
                </div>
                <div class="truck-jobs"
                  data-vehicle-id="${v.id}" data-date="${dateStr}">
                  ${combined.length === 0 ? `` : combined.map((item, _cIdx) => {
                    if (item.type === 'job') {
                      const j = item.data;
                      const jobTanks = j.property?.tanks || [];
                      const totalGal = jobTanks.reduce((sum, t) => sum + (t.volume_gallons || 0), 0);
                      const pumped = j.gallons_pumped || {};
                      const actualGal = Object.keys(pumped).length > 0
                        ? Object.values(pumped).reduce((s, g) => s + (parseInt(g) || 0), 0)
                        : totalGal;

                      // Show dump alert BEFORE this job when either:
                      //   (a) the previous item was a job flagged dump_after=true
                      //       by the route optimizer (opportunistic mid-route dump),
                      //   (b) adding this job would overflow capacity.
                      // Look backward to find the most recent job item; manifests/
                      // other non-job items shouldn't count.
                      let prevJobItem = null;
                      for (let pi = _cIdx - 1; pi >= 0; pi--) {
                        if (combined[pi].type === 'job') { prevJobItem = combined[pi]; break; }
                        if (combined[pi].type === 'manifest') break; // actual dump resets the chain
                      }
                      const flaggedDump = prevJobItem && prevJobItem.data && prevJobItem.data.dump_after;
                      const overflowDump = capacity > 0 && runningForCapacity > 0 && runningForCapacity + actualGal > capacity;
                      let preAlert = '';
                      if (flaggedDump && !overflowDump) {
                        // Opportunistic dump — tank isn't overflowing but optimizer
                        // decided this is a good place to empty (dump was on the way).
                        preAlert = `<div class="manifest-suggestion" title="Route optimizer suggests dumping here — the transfer station is on the way">
                          <span class="manifest-suggestion-icon">&#9888;</span>
                          <span>Dump suggested — ${runningForCapacity.toLocaleString()} gal onboard (on-the-way) — Insert manifest</span>
                        </div>`;
                        runningForCapacity = 0;
                      } else if (overflowDump) {
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
                            ${(j.customers?.phone_cell || j.customers?.phone) ? `<div class="job-phone">${esc(j.customers.phone_cell || j.customers.phone)}</div>` : ''}
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
                      const dcColor = driver?.color || '#1565c0';
                      return `
                      <div class="schedule-driver-change" data-sort="${item.sort}" style="background:${dcColor};border-color:${dcColor};color:#fff;">
                        <span style="display:inline-flex;align-items:center;gap:6px;">New Driver:
                          <svg viewBox="0 0 24 24" width="14" height="14" style="fill:#fff;"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>
                          ${esc(si.driver_name || driver?.name || 'Unknown')}
                        </span>
                        <button class="driver-change-remove" onclick="removeScheduleItem('${si.id}')" style="color:#fff;opacity:0.85;">&times;</button>
                      </div>`;
                    } else if (item.type === 'note') {
                      const si = item.data;
                      // Store text in a data attribute so edit can read it without quote issues
                      const noteTextEscAttr = (si.note_text || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;');
                      return `
                      <div class="schedule-note-card" data-sort="${item.sort}" data-item-id="${si.id}"
                        data-vehicle-id="${si.vehicle_id}" data-date="${si.scheduled_date}"
                        data-sort-order="${si.sort_order}" data-note-text="${noteTextEscAttr}">
                        <span class="note-card-drag" onmousedown="onScheduleItemMouseDown(event, '${si.id}')" title="Drag to reorder">&#8801;</span>
                        <span class="note-card-text">${esc(si.note_text || '')}</span>
                        <div class="note-card-actions">
                          <button class="note-card-btn" onclick="event.stopPropagation(); editNoteCard('${si.id}')" title="Edit">&#9998;</button>
                          <button class="note-card-btn" onclick="event.stopPropagation(); removeScheduleItem('${si.id}')" title="Delete">&times;</button>
                        </div>
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

function editNoteCard(itemId) {
  const card = document.querySelector(`.schedule-note-card[data-item-id="${itemId}"]`);
  if (!card) return;
  openNoteModal(
    card.dataset.vehicleId,
    card.dataset.date,
    parseFloat(card.dataset.sortOrder),
    itemId,
    card.dataset.noteText || ''
  );
}

function openNoteModal(vehicleId, dateStr, sortOrder, itemId, currentText) {
  // Store pending context
  window._pendingNote = { vehicleId, dateStr, sortOrder, itemId };

  const overlay = document.createElement('div');
  overlay.id = 'note-modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `
    <div style="background:#1e1e1e;border-radius:8px;padding:24px;width:400px;max-width:90vw;box-shadow:0 8px 32px rgba(0,0,0,0.5);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h3 style="margin:0;font-size:16px;">${itemId ? 'Edit Note' : 'Add a Note'}</h3>
        <button onclick="document.getElementById('note-modal-overlay').remove()" style="background:none;border:none;color:#888;font-size:20px;cursor:pointer;line-height:1;">&times;</button>
      </div>
      <textarea id="note-modal-text" rows="4"
        style="width:100%;background:#111;border:1px solid #333;border-radius:4px;color:#fff;font-size:14px;padding:10px;resize:vertical;box-sizing:border-box;font-family:inherit;"
        placeholder="Enter note…">${currentText ? currentText.replace(/</g,'&lt;') : ''}</textarea>
      <div style="display:flex;gap:8px;margin-top:14px;">
        <button class="btn btn-primary" style="flex:1;font-weight:700;" onclick="saveNoteCard()">SAVE</button>
        <button class="btn btn-secondary" onclick="document.getElementById('note-modal-overlay').remove()">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const ta = document.getElementById('note-modal-text');
  if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; }
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) overlay.remove(); });
}

async function saveNoteCard() {
  const ctx = window._pendingNote;
  if (!ctx) return;
  const text = document.getElementById('note-modal-text')?.value?.trim();
  if (!text) { showToast('Note cannot be empty.', 'error'); return; }
  await window.api.saveScheduleItem({
    ...(ctx.itemId ? { id: ctx.itemId } : {}),
    vehicle_id: ctx.vehicleId,
    scheduled_date: ctx.dateStr,
    item_type: 'note',
    note_text: text,
    sort_order: ctx.sortOrder,
  });
  document.getElementById('note-modal-overlay')?.remove();
  window._pendingNote = null;
  _scheduleRestoreScroll();
  loadSchedule();
}

async function editDayNote() {
  const dateStr = formatDate(scheduleDate);
  const noteRes = await window.api.getDayNote(dateStr);
  const current = noteRes?.data?.text || '';

  // Replace bar with inline editor
  const bar = document.getElementById('day-note-bar');
  if (!bar) return;
  bar.innerHTML = `
    <input id="day-note-input" type="text" value="${current.replace(/"/g,'&quot;')}"
      style="flex:1;background:#0d1a0d;border:1px solid #2e7d32;color:#a5d6a7;font-size:13px;font-weight:600;padding:4px 8px;border-radius:4px;outline:none;"
      onkeydown="if(event.key==='Enter')saveDayNote();if(event.key==='Escape')loadSchedule();"
      placeholder="Enter a note for this day…">
    <button class="btn btn-sm btn-primary" onclick="saveDayNote()" style="padding:4px 12px;">Save</button>
    <button class="btn btn-sm btn-secondary" onclick="loadSchedule()" style="padding:4px 10px;">Cancel</button>
  `;
  bar.style.background = '#0d1a0d';
  document.getElementById('day-note-input')?.focus();
  const inp = document.getElementById('day-note-input');
  if (inp) inp.selectionStart = inp.selectionEnd = inp.value.length;
}

async function saveDayNote() {
  const inp = document.getElementById('day-note-input');
  if (!inp) return;
  const text = inp.value.trim();
  const dateStr = formatDate(scheduleDate);
  if (!text) {
    await window.api.deleteDayNote(dateStr);
  } else {
    await window.api.saveDayNote({ date: dateStr, text });
  }
  loadSchedule();
}

async function deleteDayNote(dateStr) {
  await window.api.deleteDayNote(dateStr);
  loadSchedule();
}

// ===== SCHEDULE MAP VIEW =====
let scheduleMapVisible = false;
let scheduleMapInstance = null;
let mapAllJobs = [];
let mapAllScheduleItems = []; // manifests + driver_change + notes — we only render manifests in the route panel
let mapAllVehicles = [];
let mapAllWasteSites = [];
let mapGeoCache = {};
let mapVisibleTrucks = {}; // which trucks are toggled on
let mapMarkerLayers = {}; // L.layerGroup per vehicle
let mapWasteSiteLayer = null; // L.layerGroup for waste site markers
let mapMotiveTruckLayer = null; // Motive live truck markers
let _motiveMapRefreshTimer = null;
let mapJobMarkers = {}; // job.id → L.marker, for hover highlight
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
  const { data: schedItems } = await window.api.getScheduleItems(null, dateStr);

  mapAllJobs = jobs;
  mapAllScheduleItems = (schedItems || []).filter(si => si.item_type === 'manifest');
  mapAllVehicles = vehicles;
  mapAllWasteSites = wasteSites;
  mapGeoCache = {};
  cachedCoords.forEach(c => {
    // Preserve the `approximate` flag (true = city-level fallback, not a
    // precise street-level fix) so map markers can show a visual warning.
    mapGeoCache[c.address] = { lat: c.lat, lng: c.lng, approximate: !!c.approximate };
  });

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

  // Geocode an address via the main-process geocoding service. Main
  // picks the provider (OSM / Mapbox / hybrid) based on Settings and
  // keeps the Mapbox token out of this renderer context. Result is
  // always cached to geocode_cache.json so subsequent runs skip the
  // network entirely.
  async function geocodeAddr(fullAddr, parts) {
    if (!fullAddr || mapGeoCache[fullAddr]) return;
    try {
      const r = await window.api.geocodeAddress({
        freeForm: fullAddr,
        street: parts && parts.street,
        city: parts && parts.city,
        state: parts && parts.state,
      });
      if (r && !r.notFound && typeof r.lat === 'number') {
        mapGeoCache[fullAddr] = {
          lat: r.lat,
          lng: r.lng,
          approximate: !!r.approximate,
          provider: r.provider,
          accuracy: r.accuracy,
        };
        await window.api.saveGeocodeCache({
          address: fullAddr,
          lat: r.lat,
          lng: r.lng,
          approximate: !!r.approximate,
          provider: r.provider,
          accuracy: r.accuracy,
        });
      } else if (r && r.notFound) {
        console.log('[GEOCODE] Not found:', fullAddr, r.error || '');
      }
    } catch (e) { console.log('Geocode IPC error:', fullAddr, e); }
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
    await geocodeAddr(fullAddr, { street: addr, city, state });
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
    await geocodeAddr(fullAddr, { street: addr, city, state });
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

  // Live Motive truck layer
  mapMotiveTruckLayer = L.layerGroup().addTo(map);
  refreshMotiveTrucksOnMap();
  clearInterval(_motiveMapRefreshTimer);
  _motiveMapRefreshTimer = setInterval(refreshMotiveTrucksOnMap, 30000);
}

function buildGlobalJobNumberMap() {
  // Assign a unique sequential number to every job across all trucks
  const numMap = {};
  let counter = 1;
  mapAllVehicles.forEach(v => {
    const vJobs = mapAllJobs.filter(j => j.vehicle_id === v.id && j._coords && j.status !== 'completed').sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    vJobs.forEach(j => { numMap[j.id] = counter++; });
  });
  return numMap;
}

function renderMapMarkers() {
  const map = scheduleMapInstance;
  if (!map) return;

  const jobNumMap = buildGlobalJobNumberMap();

  // Clear all layers and marker lookup
  mapJobMarkers = {};
  mapAllVehicles.forEach(v => {
    if (mapMarkerLayers[v.id]) mapMarkerLayers[v.id].clearLayers();
  });

  mapAllVehicles.forEach(v => {
    if (!mapVisibleTrucks[v.id]) return;
    const layer = mapMarkerLayers[v.id];
    const color = v.color || '#1565c0';
    const capacity = v.capacity_gallons || 0;
    const vJobs = mapAllJobs.filter(j => j.vehicle_id === v.id && j._coords && j.status !== 'completed').sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

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
      const isApprox = !!j._coords.approximate;
      // Approximate markers: dashed yellow border + slight transparency,
      // signalling "we dropped this on the town center because the exact
      // address didn't geocode — driver should verify by phone/Directions."
      const makeJobIcon = (size, fontSize, shadow) => L.divIcon({
        className: 'schedule-map-marker' + (isApprox ? ' schedule-map-marker-approx' : ''),
        html: '<div style="background:' + color + ';color:white;border-radius:50%;width:' + size + 'px;height:' + size + 'px;display:flex;align-items:center;justify-content:center;font-size:' + fontSize + 'px;font-weight:700;'
          + (isApprox
              ? 'border:2px dashed #f9a825;opacity:0.75;'
              : 'border:2px solid white;')
          + 'box-shadow:' + shadow + ';">' + num + (isApprox ? '<span style="position:absolute;top:-4px;right:-4px;background:#f9a825;color:#000;font-size:9px;width:12px;height:12px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;border:1px solid white;">~</span>' : '') + '</div>',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2]
      });
      const normalIcon = makeJobIcon(28, 11, '0 2px 6px rgba(0,0,0,0.3)');
      const hoverIcon  = makeJobIcon(44, 16, '0 4px 12px rgba(0,0,0,0.5)');
      const marker = L.marker([j._coords.lat, j._coords.lng], { icon: normalIcon });
      marker._jobNormalIcon = normalIcon;
      marker._jobHoverIcon  = hoverIcon;
      mapJobMarkers[j.id] = marker;
      const isDone = j.status === 'completed';
      const custName = j.customers?.name || 'Unknown';

      let popupHtml = '<div style="min-width:180px;">'
        + '<strong>' + esc(custName) + '</strong><br>'
        + '<span style="font-size:12px;">' + esc(j._fullAddr) + '</span><br>'
        + (isApprox
            ? '<div style="margin-top:4px;padding:4px 6px;background:#fff8e1;border-left:3px solid #f9a825;font-size:11px;color:#5d4037;">'
                + '<strong>~ Approximate location</strong> — this street didn&#39;t resolve to a precise coordinate, so the marker is placed near the town center. Verify the address before routing.'
              + '</div>'
            : '')
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

// Fetch a full NxN road-distance matrix in a single OSRM /table call.
// points: [{lat, lng}, ...]  returns { distances[N][N] (miles), durations[N][N] (min), source }
// Falls back to pairwise haversine if OSRM is unreachable.
async function getOsrmDistanceMatrix(points) {
  if (!points || points.length < 2) return null;
  const coords = points.map(p => `${p.lng},${p.lat}`).join(';');
  try {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(
      `https://router.project-osrm.org/table/v1/driving/${coords}?annotations=distance,duration`,
      { signal: controller.signal }
    );
    clearTimeout(to);
    const data = await resp.json();
    if (data.code === 'Ok' && data.distances && data.durations) {
      return {
        distances: data.distances.map(row => row.map(m => (m == null ? Infinity : m * 0.000621371))),
        durations: data.durations.map(row => row.map(s => (s == null ? Infinity : s / 60))),
        source: 'osrm',
      };
    }
  } catch (e) { /* fallback */ }
  // Haversine fallback matrix
  const N = points.length;
  const distances = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      if (i !== j) distances[i][j] = _haversineDist(points[i].lat, points[i].lng, points[j].lat, points[j].lng);
    }
  }
  return { distances, durations: distances.map(r => r.map(() => 0)), source: 'haversine' };
}

// Nearest-neighbor route solver with capacity.
// Seeds with the furthest-from-home job, then at each step picks the closest
// remaining job (by road miles) that still fits in the truck. When nothing
// fits, triggers a dump (onboard=0) and continues from the current position
// to the closest remaining job regardless of fill. This is a greedy TSP
// heuristic — not globally optimal, but matches how a driver actually thinks
// about the route, and avoids the peninsula-hopping zigzag that pure
// descending-distance-from-home produced.
//
// Input: home {lat,lng}, jobs [{...j, _coords, _gal}], capacity (gallons or 0)
// Mutates nothing. Returns { sorted, matrixSource }.
// ============================================================
// ROUTE SOLVER — DO NOT MODIFY THIS FUNCTION WITHOUT APPROVAL
// Nearest-neighbor TSP with capacity constraints, opportunistic
// dumping, and farthest-first re-seeding after every dump.
//
// Rules locked in (tuned against real Maine coastal routes):
//   • Seed each segment at the job farthest from home by road
//   • After every dump (forced or opportunistic), re-seed farthest
//   • Forced dump  → pick farthest remaining from home
//   • Opportunistic dump fires when ALL of:
//       - tank ≥ 40% full
//       - detour via dump ≤ 5 + 10×fillPct miles
//       - direct leg to next job ≥ 3 miles (don't dump before a nearby job)
//       - next job is ≥ 2 miles from home (don't dump before a job that's
//         already at the dump site — just grab it on the way in)
//   • Near-home job deferred: if the only fitting job is within 2 road-miles
//     of home but larger jobs are waiting that don't fit, force a dump first
//     so the near-home job lands at the END of the next segment naturally
// ============================================================
async function _nearestNeighborRoute(home, jobs, capacity) {
  if (jobs.length === 0) return { sorted: [], matrixSource: null };
  // Clear any stale dump flags from prior runs; the solver is authoritative.
  jobs.forEach(j => { j._dumpAfter = false; });
  if (jobs.length === 1) return { sorted: [...jobs], matrixSource: null };

  // Build points array: index 0 = home, 1..N = jobs
  const pts = [home, ...jobs.map(j => j._coords)];
  const matrix = await getOsrmDistanceMatrix(pts);
  const D = matrix.distances;

  // Seed: furthest-from-home job (row 0, excluding self)
  let seedIdx = 0;
  for (let i = 1; i < jobs.length; i++) {
    if (D[0][i + 1] > D[0][seedIdx + 1]) seedIdx = i;
  }

  const sorted = [];
  const remainingJobs = jobs.map((j, i) => ({ job: j, mIdx: i + 1 }));
  let cur = remainingJobs.splice(seedIdx, 1)[0];
  sorted.push(cur.job);
  let onboard = cur.job._gal || 0;
  let curMIdx = cur.mIdx;
  // After any dump, the next pick re-seeds with farthest-from-home so each
  // new segment starts at the extreme and works back — same as the initial seed.
  let reseedNext = false;

  while (remainingJobs.length > 0) {
    // Pick nearest remaining that fits, OR re-seed with farthest if we just
    // completed a dump (forced or opportunistic) on the previous iteration.
    let bestIdx = -1;
    let bestDist = reseedNext ? -Infinity : Infinity;
    for (let i = 0; i < remainingJobs.length; i++) {
      if (capacity > 0 && onboard + (remainingJobs[i].job._gal || 0) > capacity) continue;
      const d = reseedNext
        ? D[0][remainingJobs[i].mIdx]          // farthest from home
        : D[curMIdx][remainingJobs[i].mIdx];   // nearest from current
      if (reseedNext ? d > bestDist : d < bestDist) { bestDist = d; bestIdx = i; }
    }
    reseedNext = false;

    // If the only job that fits right now is essentially at the dump site
    // (within 2 road-miles of home) but larger jobs are still waiting that
    // don't fit at the current load, prefer a forced dump instead. This keeps
    // the near-home job for the END of the next segment (nearest-to-home pick
    // in farthest-first ordering) rather than awkwardly starting the new
    // segment with it. Practical example: a 50g Rockland job that only fits
    // at 4,000g should not be pumped with a nearly-full truck (spill risk) —
    // dump first, do the bigger jobs, pick it up last on the way back home.
    if (bestIdx !== -1 && capacity > 0) {
      const pickedDistFromHome = D[0][remainingJobs[bestIdx].mIdx];
      if (pickedDistFromHome < 2.0) {
        const hasWaitingJobs = remainingJobs.some((rj, i) =>
          i !== bestIdx && onboard + (rj.job._gal || 0) > capacity
        );
        if (hasWaitingJobs) bestIdx = -1; // defer to forced dump
      }
    }

    let forcedDump = false;
    if (bestIdx === -1) {
      // Nothing fits — forced dump. Empty, then re-seed farthest from home.
      forcedDump = true;
      onboard = 0;
      curMIdx = 0;
      bestDist = -Infinity;
      for (let i = 0; i < remainingJobs.length; i++) {
        const d = D[0][remainingJobs[i].mIdx];
        if (d > bestDist) { bestDist = d; bestIdx = i; }
      }
      // Next pick after this forced-dump job also re-seeds farthest.
      reseedNext = true;
    }

    // Opportunistic dump: even when the next job *fits*, if the direct leg
    // from current → next would pass close to the dump anyway, dump now.
    // The detour cost is cheap, and emptying the tank mid-route prevents a
    // later dedicated out-and-back trip for a stranded job on a separate
    // peninsula. Skip this check on forced dumps (already dumped) and when
    // the tank is basically empty (nothing worth dumping).
    //
    // Rule: detour (via-dump vs direct) ≤ 5 + 10 × fillPct miles, tank ≥ 40%
    // full, and the direct leg to the next job is ≥ 3 miles (don't dump when
    // you're about to do a nearby job — grab it first).
    let opportunisticDump = false;
    if (
      !forcedDump &&
      capacity > 0 &&
      sorted.length > 0 &&
      onboard > 0 &&
      bestIdx !== -1
    ) {
      const pickedMIdx = remainingJobs[bestIdx].mIdx;
      const directMiles = D[curMIdx][pickedMIdx];
      const viaDumpMiles = D[curMIdx][0] + D[0][pickedMIdx];
      const detour = viaDumpMiles - directMiles;
      const fillPct = onboard / capacity;
      const allowedDetour = 5 + 10 * fillPct;
      const nextDistFromHome = D[0][pickedMIdx];
      if (fillPct >= 0.40 && detour <= allowedDetour && directMiles >= 3.0 && nextDistFromHome >= 2.0) {
        opportunisticDump = true;
        onboard = 0;
        // Next pick after this opportunistic-dump job also re-seeds farthest
        // so the new segment starts at the far extreme, not nearest to current.
        reseedNext = true;
      }
    }

    if (forcedDump || opportunisticDump) {
      // Flag the previous job so the renderer inserts a dump marker after it.
      sorted[sorted.length - 1]._dumpAfter = true;
    }

    const picked = remainingJobs.splice(bestIdx, 1)[0];
    sorted.push(picked.job);
    onboard += picked.job._gal || 0;
    curMIdx = picked.mIdx;
  }

  return { sorted, matrixSource: matrix.source };
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

  // Pull any actual (user-placed) manifests on this truck for this date.
  // Manifests are fixed segment boundaries — the driver has committed to
  // dumping at that point in the route, so the optimizer can't cross them.
  // We split the jobs into independent segments bounded by manifests, run
  // nearest-neighbor TSP on each segment separately (each starts with an
  // empty tank), and reassemble preserving manifest positions.
  const vManifests = (mapAllScheduleItems || [])
    .filter(si => si.vehicle_id === vehicleId && si.item_type === 'manifest')
    .map(si => ({ type: 'manifest', data: si, sort: si.sort_order != null ? si.sort_order : 999 }));

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
  });

  // Route logic: nearest-neighbor TSP seeded with the furthest-from-home job.
  // OSRM /table gives us the full NxN road-miles matrix in one API call.
  // First stop = the job with the longest road-distance from home (driver
  // tackles the far extreme while the truck is empty). Every stop after that
  // is the closest remaining job that still fits in the tank, measured by
  // road miles from the *current* position — not from home. This naturally
  // snakes back home as the far jobs get consumed, and eliminates the
  // peninsula-hop zigzag that pure distance-from-home sorting produced.
  //
  // Manifest-aware segmenting: if the user has placed actual manifests, split
  // jobs into segments at manifest boundaries and optimize each segment
  // independently. Each segment starts with an empty tank (the preceding
  // manifest physically empties the truck). Manifests keep their order but
  // get renumbered into the final sort_order sequence.
  updateProgress(0, 'Computing road distance matrix…');

  // Build segments: jobs split by manifests (by sort_order).
  // mergedOrdered = jobs and manifests interleaved in sort_order.
  const jobItems = vJobs.map(j => ({ type: 'job', data: j, sort: j.sort_order != null ? j.sort_order : 0 }));
  const mergedOrdered = [...jobItems, ...vManifests].sort((a, b) => a.sort - b.sort);

  const segments = []; // array of { jobs: [...], manifestAfter: <manifest item or null> }
  let currentSegJobs = [];
  for (const item of mergedOrdered) {
    if (item.type === 'manifest') {
      segments.push({ jobs: currentSegJobs, manifestAfter: item });
      currentSegJobs = [];
    } else {
      currentSegJobs.push(item.data);
    }
  }
  segments.push({ jobs: currentSegJobs, manifestAfter: null });

  // Optimize each segment independently.
  let matrixSourceLabel = 'no-matrix';
  const optimizedSegments = [];
  for (const seg of segments) {
    if (seg.jobs.length <= 1) {
      // Nothing to optimize; still clear any stale dump flags
      seg.jobs.forEach(j => { j._dumpAfter = false; });
      optimizedSegments.push({ jobs: [...seg.jobs], manifestAfter: seg.manifestAfter });
      continue;
    }
    const { sorted: segSorted, matrixSource } = await _nearestNeighborRoute(
      { lat: MAP_HOME_BASE.lat, lng: MAP_HOME_BASE.lng },
      seg.jobs,
      capacity
    );
    if (matrixSource) matrixSourceLabel = matrixSource;
    // The last job of a segment is followed by an actual manifest (except the
    // final segment). Clear any _dumpAfter flag on that last job — a real
    // manifest is there, we don't want a redundant "suggested dump" marker.
    if (seg.manifestAfter && segSorted.length > 0) {
      segSorted[segSorted.length - 1]._dumpAfter = false;
    }
    optimizedSegments.push({ jobs: segSorted, manifestAfter: seg.manifestAfter });
  }

  updateProgress(vJobs.length, 'Route computed (' + matrixSourceLabel + ')');

  // Reassemble in order and renumber sort_order across jobs + manifests.
  updateProgress(totalSteps, 'Saving');
  const savePromises = [];
  let sortIdx = 0;
  for (const seg of optimizedSegments) {
    for (const j of seg.jobs) {
      sortIdx++;
      savePromises.push(window.api.saveJob({
        id: j.id,
        sort_order: sortIdx * 10,
        dump_after: !!j._dumpAfter,
      }));
    }
    if (seg.manifestAfter) {
      sortIdx++;
      savePromises.push(window.api.saveScheduleItem({
        id: seg.manifestAfter.data.id,
        sort_order: sortIdx * 10,
      }));
    }
  }
  await Promise.all(savePromises);

  // Remove progress bar
  const progEl = document.getElementById(progressId);
  if (progEl) progEl.remove();

  // Refresh
  const dateStr = formatDate(scheduleDate);
  const { data: jobs } = await window.api.getJobs({ date: dateStr });
  const { data: schedItemsRefresh } = await window.api.getScheduleItems(null, dateStr);
  jobs.forEach(j => {
    const addr = j.property?.address || '';
    const city = j.property?.city || '';
    const state = j.property?.state || 'ME';
    const fullAddr = [addr, city, state].filter(Boolean).join(', ');
    if (mapGeoCache[fullAddr]) { j._coords = mapGeoCache[fullAddr]; j._fullAddr = fullAddr; }
  });
  mapAllJobs = jobs;
  mapAllScheduleItems = (schedItemsRefresh || []).filter(si => si.item_type === 'manifest');
  renderMapMarkers();
  renderMapRoutePanel();

  const v = mapAllVehicles.find(v => v.id === vehicleId);
  const segCount = vManifests.length + 1;
  const segNote = vManifests.length > 0
    ? ' (' + segCount + ' segments around ' + vManifests.length + ' manifest' + (vManifests.length > 1 ? 's' : '') + ')'
    : '';
  showToast('Route optimized for ' + (v?.name || 'truck') + segNote + ' — farthest first, then nearest-neighbor back home.', 'success');
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
  const { data: allSchedItems } = await window.api.getScheduleItems(null, dateStr);

  // Only include jobs currently on selected trucks, plus unassigned jobs
  const selectedJobs = jobs.filter(j => selectedIds.includes(j.vehicle_id) || !j.vehicle_id);
  if (selectedJobs.length === 0) { showToast('No jobs on selected trucks.', 'info'); return; }

  const trucks = vehicles.filter(v => selectedIds.includes(v.id));

  // Collect actual manifests per selected truck — these are fixed segment
  // boundaries. Cross-truck reassignment doesn't touch them (a manifest stays
  // on whatever truck it was placed on), but when we finalize each truck's
  // route we split the truck's jobs into segments around its manifests.
  const manifestsByTruck = {};
  (allSchedItems || [])
    .filter(si => si.item_type === 'manifest' && selectedIds.includes(si.vehicle_id))
    .forEach(si => {
      if (!manifestsByTruck[si.vehicle_id]) manifestsByTruck[si.vehicle_id] = [];
      manifestsByTruck[si.vehicle_id].push(si);
    });

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
      const r = await window.api.geocodeAddress({ freeForm: homeAddr });
      if (r && !r.notFound && typeof r.lat === 'number') {
        geoCache[homeAddr] = { lat: r.lat, lng: r.lng, approximate: !!r.approximate, provider: r.provider, accuracy: r.accuracy };
        await window.api.saveGeocodeCache({ address: homeAddr, lat: r.lat, lng: r.lng, approximate: !!r.approximate, provider: r.provider, accuracy: r.accuracy });
      }
    } catch(e) {}
  }
  const homeLat = geoCache[homeAddr]?.lat || 44.1;
  const homeLng = geoCache[homeAddr]?.lng || -69.1;

  // Geocode all jobs (use cache, only fetch uncached — routed through the
  // main-process provider service so the selected provider/tier wins)
  for (const j of selectedJobs) {
    const addr = j.property?.address || '';
    const city = j.property?.city || '';
    const state = j.property?.state || 'ME';
    const fullAddr = [addr, city, state].filter(Boolean).join(', ');
    if (!addr) continue;
    if (!geoCache[fullAddr]) {
      try {
        const r = await window.api.geocodeAddress({ freeForm: fullAddr, street: addr, city, state });
        if (r && !r.notFound && typeof r.lat === 'number') {
          geoCache[fullAddr] = { lat: r.lat, lng: r.lng, approximate: !!r.approximate, provider: r.provider, accuracy: r.accuracy };
          await window.api.saveGeocodeCache({ address: fullAddr, lat: r.lat, lng: r.lng, approximate: !!r.approximate, provider: r.provider, accuracy: r.accuracy });
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
    // Placeholder haversine just for clustering (Step 1). The real
    // road-miles value is computed in Step 4 right before sorting.
    j._distFromHomeAir = j._coords
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

    // Pull user-placed manifests on this truck — they are fixed segment
    // boundaries in the final route. Sort by existing sort_order so the
    // relative position between "fresh" reassigned jobs and manifests is
    // preserved as much as possible.
    const truckManifests = (manifestsByTruck[ta.id] || [])
      .slice()
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const truckDriver = trucks.find(v => v.id === ta.id)?.default_tech_id || '';

    if (truckJobs.length > 1) {
      // Route strategy: nearest-neighbor TSP seeded with the farthest-from-home
      // job. OSRM /table fetches the full NxN road-miles matrix for this
      // truck's stops in a single API call. First stop = the longest-road-
      // distance job from home (handle the extreme while empty). Every stop
      // after that = the closest remaining job (from *current* position) that
      // still fits in the tank. Naturally snakes back home as far jobs get
      // consumed, avoiding the peninsula-hop zigzag that descending-from-home
      // sorting produced on coastal Maine.
      //
      // Manifest-aware segmenting: if the truck has actual manifests placed,
      // split the route into segments bounded by manifests. We distribute
      // reassigned jobs across segments by their pre-optimization sort_order
      // relative to each manifest's sort_order. Each segment is then solved
      // independently starting with an empty tank.
      const truckCap = ta.capacity || 9999;

      let optimizedSegments = [];
      if (truckManifests.length === 0) {
        // No manifests — single segment, straightforward.
        const { sorted: nnSorted } = await _nearestNeighborRoute(
          { lat: homeLat, lng: homeLng },
          truckJobs,
          truckCap
        );
        optimizedSegments = [{ jobs: nnSorted, manifestAfter: null }];
      } else {
        // Split truckJobs into N+1 buckets around N manifests by sort_order.
        // Jobs with original sort_order < first manifest's sort go to bucket 0,
        // etc. Jobs missing sort_order (newly assigned this run) fall into the
        // last bucket so they route after existing manifests.
        const buckets = Array.from({ length: truckManifests.length + 1 }, () => []);
        for (const j of truckJobs) {
          const js = j.sort_order != null ? j.sort_order : Infinity;
          let placed = false;
          for (let b = 0; b < truckManifests.length; b++) {
            if (js < (truckManifests[b].sort_order || 0)) {
              buckets[b].push(j);
              placed = true;
              break;
            }
          }
          if (!placed) buckets[truckManifests.length].push(j);
        }
        // Solve each bucket independently.
        for (let b = 0; b < buckets.length; b++) {
          const segJobs = buckets[b];
          const manifestAfter = b < truckManifests.length ? truckManifests[b] : null;
          if (segJobs.length === 0) {
            optimizedSegments.push({ jobs: [], manifestAfter });
            continue;
          }
          if (segJobs.length === 1) {
            segJobs[0]._dumpAfter = false;
            optimizedSegments.push({ jobs: [...segJobs], manifestAfter });
            continue;
          }
          const { sorted: segSorted } = await _nearestNeighborRoute(
            { lat: homeLat, lng: homeLng },
            segJobs,
            truckCap
          );
          // The last job before a manifest shouldn't carry a dump-suggestion
          // flag — the manifest is the real dump.
          if (manifestAfter && segSorted.length > 0) {
            segSorted[segSorted.length - 1]._dumpAfter = false;
          }
          optimizedSegments.push({ jobs: segSorted, manifestAfter });
        }
      }

      aiStepsDone += truckJobs.length;
      updateAiProgress(aiStepsDone + 1, 'Route computed for ' + (ta.name || 'truck'));

      // Save assignments + order + dump flag + update driver to match new truck.
      // Manifests keep their id but get renumbered into the final sort_order.
      let sortIdx = 0;
      for (const seg of optimizedSegments) {
        for (const j of seg.jobs) {
          sortIdx++;
          allSaves.push(window.api.saveJob({
            id: j.id,
            vehicle_id: ta.id,
            assigned_to: truckDriver,
            sort_order: sortIdx * 10,
            dump_after: !!j._dumpAfter,
          }));
        }
        if (seg.manifestAfter) {
          sortIdx++;
          allSaves.push(window.api.saveScheduleItem({
            id: seg.manifestAfter.id,
            sort_order: sortIdx * 10,
          }));
        }
      }
      // Append non-geocoded jobs at end (no dump flag — can't route them)
      noCoordJobs.forEach((j, i) => {
        sortIdx++;
        allSaves.push(window.api.saveJob({ id: j.id, vehicle_id: ta.id, assigned_to: truckDriver, sort_order: sortIdx * 10, dump_after: false }));
      });
    } else {
      // 0-1 jobs, just assign; no routing needed so clear any stale flag.
      // Still renumber manifests into the sort_order sequence.
      let sortIdx = 0;
      ta.jobs.forEach(j => {
        sortIdx++;
        allSaves.push(window.api.saveJob({ id: j.id, vehicle_id: ta.id, assigned_to: truckDriver, sort_order: sortIdx * 10, dump_after: false }));
      });
      truckManifests.forEach(m => {
        sortIdx++;
        allSaves.push(window.api.saveScheduleItem({ id: m.id, sort_order: sortIdx * 10 }));
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
    const { data: freshSched } = await window.api.getScheduleItems(null, dateStr);
    freshJobs.forEach(j => {
      const addr = j.property?.address || '';
      const city = j.property?.city || '';
      const state = j.property?.state || 'ME';
      const fullAddr = [addr, city, state].filter(Boolean).join(', ');
      j._coords = geoCache[fullAddr] || null;
      j._fullAddr = fullAddr;
    });
    mapAllJobs = freshJobs;
    mapAllScheduleItems = (freshSched || []).filter(si => si.item_type === 'manifest');
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
    const vJobs = mapAllJobs.filter(j => j.vehicle_id === v.id && j._coords && j.status !== 'completed').sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    if (vJobs.length === 0) return;
    const color = v.color || '#1565c0';
    html += '<div style="border-bottom:1px solid #eee;">'
      + '<div style="padding:5px 8px;background:' + color + ';color:white;font-weight:700;font-size:11px;display:flex;justify-content:space-between;align-items:center;">'
      + '<span>' + esc(v.name) + ' (' + vJobs.length + ')</span>'
      + '<button onclick="optimizeTruckRoute(\'' + v.id + '\')" style="background:rgba(255,255,255,0.25);border:1px solid rgba(255,255,255,0.5);color:white;border-radius:3px;padding:1px 6px;font-size:10px;cursor:pointer;font-weight:600;" title="Optimize route: farthest stop first, then nearest-neighbor back home">Optimize</button>'
      + '</div>';
    const capacity = v.capacity_gallons || 0;
    let routeRunGal = 0;

    // Build an interleaved list of jobs + actual manifests for this truck so
    // we can render real dump records alongside job cards. Jobs and manifests
    // both live on sort_order — a manifest with sort_order between two jobs
    // sits between them in the rendered list.
    const vManifests = mapAllScheduleItems
      .filter(si => si.vehicle_id === v.id && si.item_type === 'manifest')
      .map(si => ({ type: 'manifest', data: si, sort: si.sort_order != null ? si.sort_order : 999 }));
    const vRouteJobs = vJobs.map((j, jobIdx) => ({ type: 'job', data: j, sort: j.sort_order != null ? j.sort_order : jobIdx * 10, jobIdx }));
    const combined = [...vRouteJobs, ...vManifests].sort((a, b) => a.sort - b.sort);

    combined.forEach((item, cIdx) => {
      if (item.type === 'manifest') {
        // Actual manifest (real dump record from schedule_items). Render as
        // a draggable green-tinted card. Placing one here is authoritative —
        // the tank resets at this position regardless of any dump_after flags
        // on surrounding jobs. Drag to reposition; drop-target logic updates
        // sort_order on the underlying schedule_item.
        const si = item.data;
        const isCompleted = si.status === 'completed';
        const mfBg = isCompleted ? '#e8f5e9' : '#e3f2fd';
        const mfBorder = isCompleted ? '#43a047' : '#1e88e5';
        const mfTitle = isCompleted
          ? 'Manifest #' + esc(si.manifest_number || '—') + ' — dumped ' + (si.total_gallons || 0).toLocaleString() + ' gal'
          : 'Manifest #' + esc(si.manifest_number || '(draft)') + ' — drag to reposition';
        html += '<div class="map-route-manifest" draggable="true" '
          + 'data-manifest-id="' + si.id + '" data-vehicle-id="' + v.id + '" '
          + 'ondragstart="onMapManifestDragStart(event)" ondragover="onMapRouteDragOver(event)" '
          + 'ondrop="onMapRouteDrop(event, \'' + v.id + '\')" ondragend="onMapRouteDragEnd(event)" '
          + 'title="' + mfTitle + '" '
          + 'style="padding:4px 8px;background:' + mfBg + ';border-bottom:1px solid ' + mfBorder + ';display:flex;align-items:center;gap:5px;font-size:10px;font-weight:700;color:#0d47a1;cursor:grab;">'
          + '<span style="font-size:14px;">&#9851;</span>'
          + '<span style="flex:1;">Manifest' + (si.manifest_number ? ' #' + esc(si.manifest_number) : '') + (si.total_gallons ? ' — ' + si.total_gallons.toLocaleString() + ' gal' : '') + (isCompleted ? '' : ' <span style="color:#999;font-weight:500;">(draft)</span>') + '</span>'
          + '<span style="font-size:9px;color:#999;font-weight:500;">&#8693;</span>'
          + '</div>';
        routeRunGal = 0; // Actual dump empties the tank
        return;
      }

      const j = item.data;
      const idx = item.jobIdx;

      // Calculate job gallons
      const pumped = j.gallons_pumped || {};
      const jobTanks = j.property?.tanks || [];
      const jobGal = Object.keys(pumped).length > 0
        ? Object.values(pumped).reduce((s, g) => s + (parseInt(g) || 0), 0)
        : jobTanks.reduce((s, t) => s + (t.volume_gallons || 0), 0);

      // Show dump SUGGESTION (orange) before this job when either:
      //   (a) the previous job was flagged dump_after by the optimizer
      //       (opportunistic mid-route dump, tank wouldn't overflow), or
      //   (b) adding this job would overflow capacity.
      // Skip if the immediately previous item was already an actual manifest
      // (the real dump already reset the tank — no need for a suggestion).
      const prevItem = cIdx > 0 ? combined[cIdx - 1] : null;
      const prevWasManifest = prevItem && prevItem.type === 'manifest';
      const prevJobInList = prevItem && prevItem.type === 'job' ? prevItem.data : null;
      const flaggedDump = prevJobInList && prevJobInList.dump_after;
      const overflowDump = capacity > 0 && routeRunGal > 0 && routeRunGal + jobGal > capacity;
      if (!prevWasManifest && (flaggedDump || overflowDump)) {
        const dumpSourceId = flaggedDump ? prevJobInList.id : '';
        html += '<div class="map-route-dump" draggable="true" '
          + 'data-vehicle-id="' + v.id + '" data-source-job-id="' + dumpSourceId + '" '
          + 'data-dump-type="' + (flaggedDump ? 'flagged' : 'overflow') + '" '
          + 'ondragstart="onMapDumpDragStart(event)" ondragover="onMapRouteDragOver(event)" '
          + 'ondrop="onMapRouteDrop(event, \'' + v.id + '\')" ondragend="onMapRouteDragEnd(event)" '
          + 'title="Suggested dump — drag to reposition, or insert a real manifest from the schedule view" '
          + 'style="padding:4px 8px;background:#fff3e0;border-bottom:1px solid #ff9800;display:flex;align-items:center;gap:5px;font-size:10px;font-weight:600;color:#e65100;cursor:grab;">'
          + '<span style="font-size:14px;">&#9888;</span>'
          + '<span style="flex:1;">Dump suggested — ' + routeRunGal.toLocaleString() + (capacity > 0 ? ' / ' + capacity.toLocaleString() : '') + ' gal</span>'
          + '<span style="font-size:9px;color:#999;font-weight:500;">&#8693;</span>'
          + '</div>';
        routeRunGal = 0;
      }
      routeRunGal += jobGal;

      const num = jobNumMap[j.id] || '?';
      const custName = j.customers?.name || '?';
      const city = j.property?.city || '';
      html += '<div class="map-route-item" draggable="true" data-job-id="' + j.id + '" data-vehicle-id="' + v.id + '" data-idx="' + idx + '" '
        + 'ondragstart="onMapRouteDragStart(event)" ondragover="onMapRouteDragOver(event)" ondrop="onMapRouteDrop(event, \'' + v.id + '\')" ondragend="onMapRouteDragEnd(event)" '
        + 'onmouseenter="highlightMapJob(\'' + j.id + '\',true)" onmouseleave="highlightMapJob(\'' + j.id + '\',false)" '
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


async function refreshMotiveTrucksOnMap() {
  if (!scheduleMapInstance || !mapMotiveTruckLayer) return;
  try {
    // Always fetch fresh vehicles so color changes in Settings apply immediately
    const [locResult, { data: freshVehicles }] = await Promise.all([
      window.api.getMotiveLocations(),
      window.api.getVehicles(),
    ]);
    if (!locResult || locResult.error) return;
    mapMotiveTruckLayer.clearLayers();
    const rawList = locResult.vehicles || [];
    const motiveVehicles = rawList.map(item => item.vehicle || item).filter(Boolean);
    const ismVehicleList = freshVehicles || mapAllVehicles;
    motiveVehicles.forEach(mv => {
      const loc = mv.current_location;
      if (!loc?.lat || !loc?.lon) return;
      // Match to ISM vehicle for color
      const mnRaw = (mv.number || '').toLowerCase();
      const mnTokens = [...new Set(
        mnRaw.split(/[\s_\-]+/).flatMap(p => p.split(/(?<=[a-z])(?=[0-9])|(?<=[0-9])(?=[a-z])/i)).filter(w => w.length > 2)
      )];
      let ismV = null, bestScore = -1;
      for (const v of ismVehicleList) {
        if ((v.name || '').toLowerCase().includes('service')) continue;
        const words = (v.name || '').toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const score = words.filter(w => mnTokens.some(t => t.includes(w) || w.includes(t))).length;
        if (score > bestScore) { bestScore = score; ismV = v; }
      }
      if (bestScore === 0) ismV = null;
      const color = ismV?.color || '#607d8b';
      const label = ismV?.name || mv.number || 'Truck';
      const speedMph = Math.round((loc.kph || 0) * 0.621);
      const updatedAt = loc.located_at ? new Date(loc.located_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
      const isBox = (ismV?.name || '').toLowerCase().includes('box');

      const truckSvg = isBox
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="24" viewBox="0 0 44 24">
            <rect x="1" y="2" width="26" height="16" rx="2" fill="${color}" stroke="white" stroke-width="1"/>
            <line x1="22" y1="2" x2="22" y2="18" stroke="rgba(255,255,255,0.4)" stroke-width="0.7"/>
            <rect x="27" y="7" width="14" height="11" rx="2" fill="${color}" stroke="white" stroke-width="1"/>
            <rect x="28" y="8" width="8" height="7" rx="1" fill="rgba(200,235,255,0.45)" stroke="rgba(255,255,255,0.6)" stroke-width="0.6"/>
            <circle cx="9" cy="21" r="3" fill="#1a1a1a" stroke="white" stroke-width="1"/><circle cx="9" cy="21" r="1.2" fill="#555"/>
            <circle cx="34" cy="21" r="3" fill="#1a1a1a" stroke="white" stroke-width="1"/><circle cx="34" cy="21" r="1.2" fill="#555"/>
          </svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="22" viewBox="0 0 44 22">
            <rect x="1" y="4" width="27" height="11" rx="5" fill="${color}" stroke="white" stroke-width="1"/>
            <rect x="28" y="6" width="14" height="9" rx="2" fill="${color}" stroke="white" stroke-width="1"/>
            <rect x="29" y="7" width="8" height="6" rx="1" fill="rgba(200,235,255,0.45)" stroke="rgba(255,255,255,0.6)" stroke-width="0.6"/>
            <rect x="40" y="3" width="1.8" height="4" rx="0.8" fill="rgba(0,0,0,0.4)"/>
            <circle cx="9" cy="19" r="3" fill="#1a1a1a" stroke="white" stroke-width="1"/><circle cx="9" cy="19" r="1.2" fill="#555"/>
            <circle cx="34" cy="19" r="3" fill="#1a1a1a" stroke="white" stroke-width="1"/><circle cx="34" cy="19" r="1.2" fill="#555"/>
          </svg>`;

      const icon = L.divIcon({
        className: '',
        html: `<div style="display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5));">
          ${truckSvg}
          <div style="background:${color};color:white;font-size:8px;font-weight:800;padding:1px 5px;border-radius:3px;border:1px solid white;white-space:nowrap;margin-top:1px;">${esc(label)}</div>
        </div>`,
        iconSize: [44, 38], iconAnchor: [22, 38],
      });
      L.marker([loc.lat, loc.lon], { icon, zIndexOffset: 2000 })
        .bindPopup(`<strong>${esc(label)}</strong><br>${loc.city || ''}${loc.state ? ', ' + loc.state : ''}<br>Speed: ${speedMph} mph<br>Updated: ${updatedAt}`)
        .addTo(mapMotiveTruckLayer);
    });
  } catch (e) { console.error('[Motive map]', e); }
}

function highlightMapJob(jobId, on) {
  const marker = mapJobMarkers[jobId];
  if (!marker) return;
  marker.setIcon(on ? marker._jobHoverIcon : marker._jobNormalIcon);
  if (on) marker.setZIndexOffset(1000);
  else marker.setZIndexOffset(0);
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
// Additional drag state — set exclusively by their respective dragstart
// handlers, cleared in onMapRouteDragEnd. The drop handler branches on
// whichever is set.
let mapDragDumpVehicleId = null;     // dump suggestion being dragged
let mapDragDumpSourceJobId = null;   // prev job with dump_after=true; '' for overflow-only dumps
let mapDragManifestId = null;        // actual manifest (schedule_item) being dragged
let mapDragManifestVehicle = null;

function onMapRouteDragStart(e) {
  const item = e.target.closest('.map-route-item');
  mapDragJobId = item?.dataset?.jobId;
  mapDragSourceVehicle = item?.dataset?.vehicleId;
  e.dataTransfer.effectAllowed = 'move';
  if (item) item.style.opacity = '0.4';
}

function onMapDumpDragStart(e) {
  const el = e.target.closest('.map-route-dump');
  if (!el) return;
  mapDragDumpVehicleId = el.dataset.vehicleId;
  mapDragDumpSourceJobId = el.dataset.sourceJobId || ''; // '' = overflow dump
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', 'dump'); // required for some browsers
  el.style.opacity = '0.4';
}

function onMapManifestDragStart(e) {
  const el = e.target.closest('.map-route-manifest');
  if (!el) return;
  mapDragManifestId = el.dataset.manifestId;
  mapDragManifestVehicle = el.dataset.vehicleId;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', 'manifest');
  el.style.opacity = '0.4';
}

function onMapRouteDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  // Clear all drop indicators across every row type
  const panel = document.getElementById('mapRoutePanel');
  if (panel) {
    panel.querySelectorAll('.map-route-item, .map-route-dump, .map-route-manifest').forEach(el => {
      el.style.borderTop = '';
      el.style.borderBottom = '';
    });
    // Auto-scroll
    const rect = panel.getBoundingClientRect();
    const edgeZone = 50;
    if (e.clientY < rect.top + edgeZone) panel.scrollTop -= 8;
    else if (e.clientY > rect.bottom - edgeZone) panel.scrollTop += 8;
  }

  // Show indicator above or below the hovered row (job, dump, or manifest)
  const item = e.target.closest('.map-route-item, .map-route-dump, .map-route-manifest');
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
  // Clean up opacity and indicators for all draggable row types
  const panel = document.getElementById('mapRoutePanel');
  if (panel) {
    panel.querySelectorAll('.map-route-item, .map-route-dump, .map-route-manifest').forEach(el => {
      el.style.opacity = '';
      el.style.borderTop = '';
      el.style.borderBottom = '';
    });
  }
  mapDragJobId = null;
  mapDragSourceVehicle = null;
  mapDragDumpVehicleId = null;
  mapDragDumpSourceJobId = null;
  mapDragManifestId = null;
  mapDragManifestVehicle = null;
}

// Find which JOB the user intended to drop before/after, given any target row
// (job, dump, or manifest) and the drop Y coordinate. Returns the job that
// should receive the dump_after flag (i.e. the job immediately before the
// drop position in route order). Returns null if no such job exists (e.g.
// dropped before the first job).
function _findDumpAnchorJob(e, vehicleId, targetItem) {
  const vJobs = mapAllJobs
    .filter(j => j.vehicle_id === vehicleId && j._coords && j.status !== 'completed')
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  if (vJobs.length === 0) return null;

  // Build combined in the same order the panel renders them so "before/after"
  // matches what the user sees.
  const vManifests = mapAllScheduleItems
    .filter(si => si.vehicle_id === vehicleId && si.item_type === 'manifest')
    .map(si => ({ type: 'manifest', data: si, sort: si.sort_order != null ? si.sort_order : 999 }));
  const vRouteJobs = vJobs.map((j, i) => ({ type: 'job', data: j, sort: j.sort_order != null ? j.sort_order : i * 10 }));
  const combined = [...vRouteJobs, ...vManifests].sort((a, b) => a.sort - b.sort);

  if (!targetItem) {
    // Dropped in empty space — append dump after the last job.
    for (let i = combined.length - 1; i >= 0; i--) {
      if (combined[i].type === 'job') return combined[i].data;
    }
    return null;
  }

  const rect = targetItem.getBoundingClientRect();
  const dropAfter = e.clientY >= rect.top + rect.height * 0.5;

  // Figure out which combined-index the targetItem corresponds to.
  const targetJobId = targetItem.dataset?.jobId;
  const targetManifestId = targetItem.dataset?.manifestId;
  let targetCIdx = -1;
  if (targetJobId) {
    targetCIdx = combined.findIndex(c => c.type === 'job' && c.data.id === targetJobId);
  } else if (targetManifestId) {
    targetCIdx = combined.findIndex(c => c.type === 'manifest' && c.data.id === targetManifestId);
  } else if (targetItem.classList.contains('map-route-dump')) {
    // Dropped on another dump marker — treat as "right before the job that comes after it"
    // The dump isn't in `combined` (it's rendered between items), so search forward
    // from the source job for the next job.
    const sourceJobId = targetItem.dataset.sourceJobId;
    if (sourceJobId) {
      targetCIdx = combined.findIndex(c => c.type === 'job' && c.data.id === sourceJobId);
    }
  }

  if (targetCIdx === -1) return null;

  // The dump lands either BEFORE targetCIdx (if dropAfter=false) or AFTER (if dropAfter=true).
  // The anchor job is the last job at or before the landing slot.
  const landingIdx = dropAfter ? targetCIdx : targetCIdx - 1;
  for (let i = landingIdx; i >= 0; i--) {
    if (combined[i].type === 'job') return combined[i].data;
  }
  return null;
}

async function _handleMapDumpDrop(e, vehicleId, targetItem) {
  const anchorJob = _findDumpAnchorJob(e, vehicleId, targetItem);
  if (!anchorJob) { showToast('Cannot place dump before the first job.', 'error'); return; }
  if (anchorJob.id === mapDragDumpSourceJobId) return; // same position, no-op

  const saves = [];
  // Clear the flag from the old source (if this was a flagged dump, not overflow)
  if (mapDragDumpSourceJobId) {
    saves.push(window.api.saveJob({ id: mapDragDumpSourceJobId, dump_after: false }));
  }
  // Set the flag on the new anchor
  saves.push(window.api.saveJob({ id: anchorJob.id, dump_after: true }));
  await Promise.all(saves);

  // Update in-memory so the re-render reflects immediately without needing a round-trip
  mapAllJobs.forEach(j => {
    if (j.id === mapDragDumpSourceJobId) j.dump_after = false;
    if (j.id === anchorJob.id) j.dump_after = true;
  });

  renderMapRoutePanel();
  showToast('Dump repositioned.', 'success');
}

async function _handleMapManifestDrop(e, vehicleId, targetItem) {
  const manifestId = mapDragManifestId;

  // Assemble the current combined list and relocate the manifest within it,
  // then renumber all sort_orders sequentially so the new position sticks.
  const vJobs = mapAllJobs
    .filter(j => j.vehicle_id === vehicleId && j._coords && j.status !== 'completed')
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const vManifests = mapAllScheduleItems
    .filter(si => si.vehicle_id === vehicleId && si.item_type === 'manifest')
    .map(si => ({ type: 'manifest', id: si.id, sort: si.sort_order != null ? si.sort_order : 999 }));
  const vRouteJobs = vJobs.map((j, i) => ({ type: 'job', id: j.id, sort: j.sort_order != null ? j.sort_order : i * 10 }));
  const combined = [...vRouteJobs, ...vManifests].sort((a, b) => a.sort - b.sort);

  // Remove the dragged manifest from its current position
  const draggedIdx = combined.findIndex(c => c.type === 'manifest' && c.id === manifestId);
  if (draggedIdx === -1) return;
  const [dragged] = combined.splice(draggedIdx, 1);

  // Determine insert position based on drop target + Y position
  let insertIdx;
  if (!targetItem) {
    insertIdx = combined.length; // end of route
  } else {
    const rect = targetItem.getBoundingClientRect();
    const dropAfter = e.clientY >= rect.top + rect.height * 0.5;
    const targetJobId = targetItem.dataset?.jobId;
    const targetManifestId = targetItem.dataset?.manifestId;
    let targetCIdx = -1;
    if (targetJobId) {
      targetCIdx = combined.findIndex(c => c.type === 'job' && c.id === targetJobId);
    } else if (targetManifestId) {
      targetCIdx = combined.findIndex(c => c.type === 'manifest' && c.id === targetManifestId);
    }
    if (targetCIdx === -1) insertIdx = combined.length;
    else insertIdx = dropAfter ? targetCIdx + 1 : targetCIdx;
  }
  combined.splice(insertIdx, 0, dragged);

  // Renumber sort_orders: 10, 20, 30, ... — jobs and manifests share the space
  const saves = [];
  combined.forEach((entry, i) => {
    const newSort = (i + 1) * 10;
    if (entry.type === 'job') {
      saves.push(window.api.saveJob({ id: entry.id, sort_order: newSort }));
    } else {
      saves.push(window.api.saveScheduleItem({ id: entry.id, sort_order: newSort }));
    }
  });
  await Promise.all(saves);

  // Refresh and re-render
  const dateStr = formatDate(scheduleDate);
  const { data: freshJobs } = await window.api.getJobs({ date: dateStr });
  const { data: freshSched } = await window.api.getScheduleItems(null, dateStr);
  freshJobs.forEach(j => {
    const addr = j.property?.address || '';
    const city = j.property?.city || '';
    const state = j.property?.state || 'ME';
    const fullAddr = [addr, city, state].filter(Boolean).join(', ');
    if (mapGeoCache[fullAddr]) { j._coords = mapGeoCache[fullAddr]; j._fullAddr = fullAddr; }
  });
  mapAllJobs = freshJobs;
  mapAllScheduleItems = (freshSched || []).filter(si => si.item_type === 'manifest');
  renderMapMarkers();
  renderMapRoutePanel();
  showToast('Manifest repositioned.', 'success');
}

// Reload jobs + schedule items for the currently open map without destroying
// the Leaflet map instance. Used by the data-change broadcast listener so
// edits from other surfaces (day view manifest inserts, etc.) show up on
// the map immediately.
async function refreshMapData() {
  if (!scheduleMapVisible) return;
  const dateStr = formatDate(scheduleDate);
  const { data: jobs } = await window.api.getJobs({ date: dateStr });
  const { data: schedItems } = await window.api.getScheduleItems(null, dateStr);
  jobs.forEach(j => {
    const addr = j.property?.address || '';
    const city = j.property?.city || '';
    const state = j.property?.state || 'ME';
    const fullAddr = [addr, city, state].filter(Boolean).join(', ');
    if (mapGeoCache[fullAddr]) { j._coords = mapGeoCache[fullAddr]; j._fullAddr = fullAddr; }
  });
  mapAllJobs = jobs;
  mapAllScheduleItems = (schedItems || []).filter(si => si.item_type === 'manifest');
  renderMapMarkers();
  renderMapRoutePanel();
}

async function onMapRouteDrop(e, vehicleId) {
  e.preventDefault();
  e.stopPropagation();
  const targetItem = e.target.closest('.map-route-item, .map-route-dump, .map-route-manifest');

  // Clean up indicators across all row types
  const panel = document.getElementById('mapRoutePanel');
  if (panel) {
    panel.querySelectorAll('.map-route-item, .map-route-dump, .map-route-manifest').forEach(el => {
      el.style.opacity = '';
      el.style.borderTop = '';
      el.style.borderBottom = '';
    });
  }

  // Branch 1: dropped a DUMP SUGGESTION — update dump_after flags on jobs.
  if (mapDragDumpVehicleId) {
    await _handleMapDumpDrop(e, vehicleId, targetItem);
    mapDragDumpVehicleId = null;
    mapDragDumpSourceJobId = null;
    return;
  }

  // Branch 2: dropped an ACTUAL MANIFEST — update its sort_order.
  if (mapDragManifestId) {
    await _handleMapManifestDrop(e, vehicleId, targetItem);
    mapDragManifestId = null;
    mapDragManifestVehicle = null;
    return;
  }

  // Branch 3: dropped a JOB (original behavior).
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
  const { data: schedItemsRefresh } = await window.api.getScheduleItems(null, dateStr);
  jobs.forEach(j => {
    const addr = j.property?.address || '';
    const city = j.property?.city || '';
    const state = j.property?.state || 'ME';
    const fullAddr = [addr, city, state].filter(Boolean).join(', ');
    if (mapGeoCache[fullAddr]) { j._coords = mapGeoCache[fullAddr]; j._fullAddr = fullAddr; }
  });
  mapAllJobs = jobs;
  mapAllScheduleItems = (schedItemsRefresh || []).filter(si => si.item_type === 'manifest');
  renderMapMarkers();
  renderMapRoutePanel();
}

async function reassignJobFromMap(jobId, newVehicleId) {
  const dateStr = formatDate(scheduleDate);
  const { data: allVehicles } = await window.api.getVehicles();
  const newTruck = allVehicles.find(v => v.id === newVehicleId);
  const { data: dayAssignments } = await window.api.getTruckDayAssignments(dateStr);
  const dayAssign = dayAssignments.find(a => a.vehicle_id === newVehicleId);
  const newDriver = dayAssign?.user_id ?? newTruck?.default_tech_id ?? '';
  await window.api.saveJob({ id: jobId, vehicle_id: newVehicleId, assigned_to: newDriver });
  const { data: jobs } = await window.api.getJobs({ date: dateStr });
  const { data: schedItemsRA } = await window.api.getScheduleItems(null, dateStr);
  jobs.forEach(j => {
    const addr = j.property?.address || '';
    const city = j.property?.city || '';
    const state = j.property?.state || 'ME';
    const fullAddr = [addr, city, state].filter(Boolean).join(', ');
    if (mapGeoCache[fullAddr]) { j._coords = mapGeoCache[fullAddr]; j._fullAddr = fullAddr; }
  });
  mapAllJobs = jobs;
  mapAllScheduleItems = (schedItemsRA || []).filter(si => si.item_type === 'manifest');
  renderMapMarkers();
  renderMapRoutePanel();
}

async function seedTestData() {
  if (!confirm('Seed ~28 demo jobs for today using your real customer list?\n\n'
    + '• Real customers, properties, and tanks are used so addresses map correctly\n'
    + '• ONLY the job records are tagged as demo data\n'
    + '• NO confirmation emails will go out to your real customers\n'
    + '• Clicking "- Demo" removes every demo job and its invoices/payments/etc., leaving all customer data untouched')) return;
  const result = await window.api.seedTestData();
  if (result.success) {
    const d = result.data;
    showToast(`Created ${d.jobs} demo jobs for ${d.date} (sampled from ${d.pool_size} real customers — no emails sent)`, 'success');
    loadSchedule();
  } else {
    showToast(result.error || 'Seed failed', 'error');
  }
}

async function unseedTestData() {
  if (!confirm('Remove ALL demo jobs and every record tied to them '
    + '(invoices, payments, schedule items, reminders, disposal loads, service-due notices, filter leads)?\n\n'
    + 'Your real customers, properties, and tanks are NOT touched.')) return;
  const result = await window.api.unseedTestData();
  if (result.success) {
    const d = result.data;
    // Build a concise summary of what was actually removed
    const parts = [];
    if (d.jobs) parts.push(`${d.jobs} jobs`);
    if (d.invoices) parts.push(`${d.invoices} invoices`);
    if (d.payments) parts.push(`${d.payments} payments`);
    if (d.schedule_items) parts.push(`${d.schedule_items} schedule items`);
    if (d.reminders) parts.push(`${d.reminders} reminders`);
    if (d.disposal_loads) parts.push(`${d.disposal_loads} disposal loads`);
    if (d.service_due_notices) parts.push(`${d.service_due_notices} service-due notices`);
    if (d.filter_leads) parts.push(`${d.filter_leads} filter leads`);
    if (d.customers) parts.push(`${d.customers} legacy demo customers`);
    if (d.properties) parts.push(`${d.properties} legacy demo properties`);
    if (d.tanks) parts.push(`${d.tanks} legacy demo tanks`);
    showToast(parts.length ? `Removed: ${parts.join(', ')}` : 'No demo data to remove.', 'success');
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

function jumpScheduleToDate(dateStr) {
  if (!dateStr) return;
  // Local-time interpretation (avoids UTC date-shift on the schedule date)
  const parts = dateStr.split('-');
  if (parts.length !== 3) return;
  scheduleDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 12, 0, 0);
  loadSchedule();
}

// Generate per-truck printable route sheets for the current schedule day.
// Combined into one PDF (one page per truck, page-break between).
async function printRouteSheets() {
  try {
    const dateStr = formatDate(scheduleDate);
    const [{ data: jobs }, { data: vehicles }, { data: users }, { data: dayAssigns }, { data: scheduleItems }] = await Promise.all([
      window.api.getJobs({ date: dateStr }),
      window.api.getVehicles(),
      window.api.getUsers(),
      window.api.getTruckDayAssignments(dateStr),
      window.api.getScheduleItems(null, dateStr)
    ]);
    const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][scheduleDate.getDay()];
    const monthName = ['January','February','March','April','May','June','July','August','September','October','November','December'][scheduleDate.getMonth()];
    const longDate = `${dayName}, ${monthName} ${scheduleDate.getDate()}, ${scheduleDate.getFullYear()}`;

    let html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Route Sheets</title>';
    html += '<style>body{font-family:Arial,sans-serif;color:#000;margin:0;padding:0;font-size:12px;}'
         + '.page{padding:24px;page-break-after:always;}.page:last-child{page-break-after:auto;}'
         + 'h1{margin:0 0 4px 0;font-size:24px;}h2{margin:0 0 12px 0;font-size:14px;color:#444;font-weight:normal;}'
         + 'table{width:100%;border-collapse:collapse;margin-top:8px;}'
         + 'th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;vertical-align:top;}'
         + 'th{background:#1b5e20;color:#fff;font-size:11px;}'
         + '.stop-num{font-weight:700;font-size:14px;width:28px;text-align:center;}'
         + '.cust{font-weight:700;}.addr{font-size:11px;color:#333;}'
         + '.notes{font-size:11px;color:#555;font-style:italic;margin-top:2px;}'
         + '.gallons{text-align:right;font-weight:700;}'
         + '.sig{margin-top:30px;border-top:1px solid #000;width:300px;padding-top:4px;font-size:10px;color:#666;}'
         + '.empty{padding:40px;text-align:center;color:#888;font-style:italic;}'
         + '</style></head><body>';

    const sortedVehicles = [...(vehicles || [])].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    let pageCount = 0;

    for (const v of sortedVehicles) {
      const truckJobs = (jobs || []).filter(j => j.vehicle_id === v.id && !j.deleted_at)
        .sort((a, b) => {
          const sa = a.sort_order != null ? a.sort_order : 9999;
          const sb = b.sort_order != null ? b.sort_order : 9999;
          if (sa !== sb) return sa - sb;
          return (a.scheduled_time || '').localeCompare(b.scheduled_time || '');
        });
      if (!truckJobs.length) continue;
      pageCount++;

      // Resolve driver
      const dayAssign = (dayAssigns || []).find(a => a.vehicle_id === v.id);
      const driverId = dayAssign?.user_id || v.default_tech_id;
      const driver = (users || []).find(u => u.id === driverId);

      // Compute capacity used
      const totalGal = truckJobs.reduce((s, j) => {
        const tanks = j.property?.tanks || [];
        return s + tanks.reduce((ss, t) => ss + (t.volume_gallons || 0), 0);
      }, 0);

      html += '<div class="page">';
      html += `<h1>${esc(v.name || 'Truck')} — Route for ${esc(longDate)}</h1>`;
      html += `<h2>Driver: <strong>${esc(driver?.name || 'Unassigned')}</strong> &nbsp;·&nbsp; ${truckJobs.length} stop${truckJobs.length === 1 ? '' : 's'} &nbsp;·&nbsp; ~${totalGal.toLocaleString()} gallons of capacity needed (truck holds ${(v.capacity_gallons || 0).toLocaleString()})</h2>`;
      html += '<table>';
      html += '<thead><tr><th>#</th><th>Time</th><th>Customer / Property</th><th>Phone</th><th>Tank(s)</th><th>Service</th><th>Done?</th></tr></thead><tbody>';
      truckJobs.forEach((j, i) => {
        const cust = j.customers || {};
        const prop = j.property || {};
        const tanks = prop.tanks || [];
        const tankSummary = tanks.length === 0 ? '—' : tanks.map(t => `${t.tank_type || 'Tank'} (${(t.volume_gallons || 0).toLocaleString()} gal)`).join('<br>');
        const services = (j.line_items || []).map(li => li.description).filter(Boolean).join(', ') || j.service_type || '—';
        const phone = cust.phone_cell || cust.phone || '—';
        const addr = [prop.address || '', prop.city || ''].filter(Boolean).join(', ');
        const directionsNote = prop.directions ? `<div class="notes">📍 ${esc(prop.directions)}</div>` : '';
        const propNotes = prop.notes ? `<div class="notes">${esc(prop.notes.slice(0, 200))}</div>` : '';
        const time = j.scheduled_time || '';
        html += '<tr>';
        html += `<td class="stop-num">${i + 1}</td>`;
        html += `<td>${esc(time)}</td>`;
        html += `<td><div class="cust">${esc(cust.name || cust.company || 'N/A')}</div><div class="addr">${esc(addr)}</div>${directionsNote}${propNotes}</td>`;
        html += `<td>${esc(phone)}</td>`;
        html += `<td>${tankSummary}</td>`;
        html += `<td>${esc(services)}</td>`;
        html += '<td style="width:60px;text-align:center;">☐</td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
      html += '<div class="sig">Driver signature / Date completed</div>';
      html += '</div>';
    }

    if (pageCount === 0) {
      showToast('No jobs on the schedule for ' + longDate + '.', 'info');
      return;
    }

    html += '</body></html>';
    const filename = `Route-Sheets-${dateStr}.pdf`;
    const result = await window.api.generatePdf(html, filename);
    if (result?.success) {
      showToast(`Route sheets saved (${pageCount} truck${pageCount === 1 ? '' : 's'}).`, 'success');
    } else if (!result?.canceled) {
      showToast('PDF generation failed: ' + (result?.error || 'unknown'), 'error');
    }
  } catch (e) {
    showToast('Failed to print routes: ' + e.message, 'error');
  }
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

  // Re-sort driver chips scoreboard-style: highest revenue on top
  const scoreboardList = document.getElementById('drivers-scoreboard-list');
  if (scoreboardList) {
    const items = Array.from(scoreboardList.querySelectorAll('.driver-scoreboard-item'));
    // Record position before sort
    const beforeOrder = items.map(el => el.dataset.userId);
    items.sort((a, b) => (driverRevenue[b.dataset.userId] || 0) - (driverRevenue[a.dataset.userId] || 0));
    items.forEach((item, i) => {
      scoreboardList.appendChild(item);
      // Flash items that moved position
      if (beforeOrder[i] !== item.dataset.userId) {
        item.classList.remove('scoreboard-moved');
        void item.offsetWidth; // force reflow so animation re-triggers
        item.classList.add('scoreboard-moved');
        setTimeout(() => item.classList.remove('scoreboard-moved'), 400);
      }
    });
  }

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

// Touch → mouse shim so the existing mouse-only drag handlers also work on
// tablets / touchscreens. Listens at the document level on capture phase so
// touchstart on a `.truck-job-card` or `.draggable-chip` fires the equivalent
// mousedown that the existing onJobMouseDown / onChipMouseDown handlers
// already wire up via inline attributes.
(function installTouchShim() {
  if (window._touchShimInstalled) return;
  window._touchShimInstalled = true;
  function fireMouse(type, touchEvt) {
    const t = touchEvt.touches[0] || touchEvt.changedTouches[0];
    if (!t) return;
    const evt = new MouseEvent(type, {
      bubbles: true, cancelable: true,
      view: window, button: 0,
      clientX: t.clientX, clientY: t.clientY,
      screenX: t.screenX, screenY: t.screenY
    });
    (touchEvt.target || document.body).dispatchEvent(evt);
  }
  // Only forward touches that started on a draggable element to avoid
  // breaking native scrolling on regular page content
  document.addEventListener('touchstart', (e) => {
    const t = e.target.closest('.truck-job-card, .draggable-chip, .schedule-item');
    if (!t) return;
    fireMouse('mousedown', e);
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!_pDrag) return;
    fireMouse('mousemove', e);
    e.preventDefault(); // prevent scroll while dragging
  }, { passive: false });
  document.addEventListener('touchend', (e) => {
    if (!_pDrag) return;
    fireMouse('mouseup', e);
  }, { passive: true });
})();
let _scheduleUndoStack = []; // stack of { jobs: [{id, vehicle_id, assigned_to, sort_order}] }

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

// Recompute and persist assigned_to for every job in a truck column based on driver_change schedule items.
// Jobs before any driver_change get the truck's default driver; jobs after each driver_change get that driver.
async function _reapplyDriverChanges(vehicleId, date) {
  const [{ data: allJobs2 }, { data: vehicles2 }, { data: dayAssigns2 }, { data: schedItems2 }] = await Promise.all([
    window.api.getJobs({ date }),
    window.api.getVehicles(),
    window.api.getTruckDayAssignments(date),
    window.api.getScheduleItems(vehicleId, date),
  ]);
  const truckJobs = (allJobs2 || []).filter(j => j.vehicle_id === vehicleId);
  const truck = (vehicles2 || []).find(v => v.id === vehicleId);
  const dayAssign = (dayAssigns2 || []).find(a => a.vehicle_id === vehicleId);
  const defaultDriverId = dayAssign?.user_id ?? truck?.default_tech_id ?? '';
  const driverChanges = (schedItems2 || []).filter(si => si.item_type === 'driver_change');

  const combined = [];
  truckJobs.forEach((j, idx) => combined.push({ type: 'job', data: j, sort: j.sort_order != null ? j.sort_order : idx * 10 }));
  driverChanges.forEach(si => combined.push({ type: 'driver_change', driverId: si.driver_id, sort: si.sort_order != null ? si.sort_order : 999 }));
  combined.sort((a, b) => a.sort - b.sort);

  let curDriver = defaultDriverId;
  const updates = [];
  for (const item of combined) {
    if (item.type === 'driver_change') {
      curDriver = item.driverId;
    } else if (item.data.assigned_to !== curDriver) {
      updates.push({ id: item.data.id, assigned_to: curDriver });
    }
  }
  if (updates.length > 0) await Promise.all(updates.map(u => window.api.saveJob(u)));
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
  const card = e.target.closest('.schedule-manifest-card, .schedule-driver-change') ||
    e.target.closest('.note-card-drag')?.closest('.schedule-note-card');
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

  } else if (drag.type === 'note') {
    // Open note modal — save drop location for when user hits Save
    openNoteModal(dropVehicleId, dropDateStr, sortOrder, null, '');
    return;

  } else if (drag.type === 'driver_change') {
    const { data: users } = await window.api.getUsers();
    const user = users.find(u => u.id === drag.id);
    await window.api.saveScheduleItem({
      vehicle_id: dropVehicleId, scheduled_date: dropDateStr, item_type: 'driver_change',
      sort_order: sortOrder, driver_id: drag.id, driver_name: user?.name || 'Unknown',
    });
    // Propagate: update assigned_to on every job in this column based on where driver changes now fall
    await _reapplyDriverChanges(dropVehicleId, dropDateStr);
    showToast(`Driver change to ${user?.name || 'Unknown'} added.`, 'success');
    _scheduleRestoreScroll(); loadSchedule();

  } else if (drag.type === 'move_item' && drag.source === 'schedule') {
    await window.api.saveScheduleItem({ id: drag.id, vehicle_id: dropVehicleId, sort_order: sortOrder });
    // If this was a driver_change item being repositioned, re-derive assigned_to for all jobs in the column
    await _reapplyDriverChanges(dropVehicleId, dropDateStr);
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
    const { data: dropDayAssigns } = await window.api.getTruckDayAssignments(dropDateStr);
    const dropDayAssign = dropDayAssigns.find(a => a.vehicle_id === dropVehicleId);
    const destDriver = dropDayAssign?.user_id ?? destTruck?.default_tech_id ?? '';
    // Capture before-state for undo
    const allAffectedIds = [...new Set([...domOrder, drag.id])];
    const { data: preJobs } = await window.api.getJobs({ date: dropDateStr });
    const undoSnapshot = preJobs
      .filter(j => allAffectedIds.includes(j.id))
      .map(j => ({ id: j.id, vehicle_id: j.vehicle_id, assigned_to: j.assigned_to, sort_order: j.sort_order }));
    _scheduleUndoStack.push({ jobs: undoSnapshot, date: dropDateStr });
    if (_scheduleUndoStack.length > 20) _scheduleUndoStack.shift(); // cap at 20

    // Fetch driver_change schedule items so we can assign the correct driver to each job by position
    const { data: dropSchedItems } = await window.api.getScheduleItems(dropVehicleId, dropDateStr);
    const dropDriverChanges = (dropSchedItems || []).filter(si => si.item_type === 'driver_change');
    // Build combined list of new job positions + existing driver_change items, sorted
    const newOrderCombined = [];
    domOrder.forEach((jobId, i) => newOrderCombined.push({ type: 'job', jobId, sort: (i + 1) * 10 }));
    dropDriverChanges.forEach(si => newOrderCombined.push({ type: 'driver_change', driverId: si.driver_id, sort: si.sort_order != null ? si.sort_order : 999 }));
    newOrderCombined.sort((a, b) => a.sort - b.sort);
    // Walk the combined list to determine which driver each job belongs to
    let activeDriver = destDriver;
    const jobDriverMap = {};
    for (const item of newOrderCombined) {
      if (item.type === 'driver_change') activeDriver = item.driverId;
      else jobDriverMap[item.jobId] = activeDriver;
    }

    const savePromises = domOrder.map((jobId, i) => {
      const updates = { id: jobId, sort_order: (i + 1) * 10, assigned_to: jobDriverMap[jobId] || destDriver };
      if (jobId === drag.id) updates.vehicle_id = dropVehicleId;
      return window.api.saveJob(updates);
    });
    await Promise.all(savePromises);
    _scheduleRestoreScroll(); loadSchedule();
  }
});

document.addEventListener('keydown', async (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    const active = document.activeElement;
    const typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
    if (typing) return;
    if (_scheduleUndoStack.length === 0) return;
    e.preventDefault();
    const snapshot = _scheduleUndoStack.pop();
    await Promise.all(snapshot.jobs.map(j =>
      window.api.saveJob({ id: j.id, vehicle_id: j.vehicle_id, assigned_to: j.assigned_to, sort_order: j.sort_order })
    ));
    showToast('Move undone (Ctrl+Z)', 'success');
    _scheduleRestoreScroll(); loadSchedule();
  }
});

async function removeScheduleItem(id) {
  await window.api.deleteScheduleItem(id);
  showToast('Removed.', 'success');
  loadSchedule();
}

async function changeTruckDriver(vehicleId, dateStr, userId) {
  // Save per-day assignment only — does not change the truck's default tech
  await window.api.saveTruckDayAssignment({ vehicle_id: vehicleId, date: dateStr, user_id: userId || null });
  // Update all jobs for this truck on this day
  const { data: jobs } = await window.api.getJobs({ date: dateStr });
  const truckJobs = jobs.filter(j => j.vehicle_id === vehicleId);
  for (const j of truckJobs) {
    await window.api.saveJob({ id: j.id, assigned_to: userId });
  }
  showToast('Driver updated for ' + dateStr + '.', 'success');
}

// ===== MANIFEST DETAIL (click on manifest card) =====
function getActiveTanks(j) {
  const all = j.property?.tanks || [];
  return j.pumped_tank_ids && j.pumped_tank_ids.length > 0
    ? all.filter(t => j.pumped_tank_ids.includes(t.id))
    : all;
}

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

  // Calculate total gallons from jobs above — only manually entered gallons_pumped, never tank capacity
  let totalGallons = 0;
  jobsAbove.forEach(j => {
    const pumped = j.gallons_pumped || {};
    totalGallons += Object.values(pumped).reduce((s, g) => s + (parseInt(g) || 0), 0);
  });

  const isCompleted = item.status === 'completed';
  const defaultSite = wasteSites.find(s => s.is_default);
  const selectedSiteId = item.waste_site_id || (defaultSite ? defaultSite.id : '');
  const tech = vehicle?.default_tech_id ? users.find(u => u.id === vehicle.default_tech_id) : null;
  const truckCapacity = vehicle?.capacity_gallons || 0;
  const capacityWarning = truckCapacity > 0 && totalGallons > truckCapacity;

  // Auto-detect waste types from tank types in the jobs above
  const tankTypeToWaste = { 'Septic Tank': 'Septage', 'Septic Tank+Filter': 'Septage', 'Septic': 'Septage', 'Grease Trap': 'Grease Trap', 'Holding Tank': 'Holding Tank', 'Cesspool': 'Septage', 'Dry Well': 'Septage', 'Portable Toilet': 'Portable Toilet', 'Pump Chamber': 'Septage' };
  // Only count tanks that were actually pumped (respect pumped_tank_ids if set)
  const detectedWasteTypes = [...new Set(jobsAbove.flatMap(j => getActiveTanks(j).map(t => tankTypeToWaste[t.tank_type] || 'Septage')))];
  // Use saved waste_types if available, otherwise use auto-detected
  const activeWasteTypes = Array.isArray(item.waste_types) && item.waste_types.length > 0 ? item.waste_types : (detectedWasteTypes.length > 0 ? detectedWasteTypes : ['Septage']);

  // Calculate per-waste-type volume breakdown (only pumped tanks)
  const wasteTypeVolumes = {};
  jobsAbove.forEach(j => {
    const pumped = j.gallons_pumped || {};
    getActiveTanks(j).forEach(t => {
      const wasteType = tankTypeToWaste[t.tank_type] || 'Septage';
      const gal = pumped[t.id] != null ? (parseInt(pumped[t.id]) || 0) : (t.volume_gallons || 0);
      wasteTypeVolumes[wasteType] = (wasteTypeVolumes[wasteType] || 0) + gal;
    });
  });
  const wasteBreakdownHtml = Object.keys(wasteTypeVolumes).length > 1
    ? Object.entries(wasteTypeVolumes).map(([wt, gal]) => `<span style="margin-right:12px;">${esc(wt)}: <strong>${gal.toLocaleString()} gal</strong></span>`).join('')
    : '';

  openModal('Manifest — ' + (vehicle?.name || 'Truck'), `
    <input type="hidden" id="mfWasteTypesHidden" value="${activeWasteTypes.join(',')}">

    <!-- DATE / TRUCK / CAPACITY ROW -->
    <div class="form-row" style="margin-bottom:12px;">
      <div class="form-group">
        <label>Date of Disposal</label>
        <div style="font-size:14px;font-weight:600;padding:6px 0;">${item.scheduled_date || ''}</div>
      </div>
      <div class="form-group">
        <label>Truck</label>
        <div style="font-size:14px;font-weight:600;padding:6px 0;">${esc(vehicle?.name || '')}</div>
      </div>
      <div style="text-align:right;font-size:13px;color:var(--text-light);align-self:flex-end;padding-bottom:8px;">
        Truck Capacity: <strong>${truckCapacity.toLocaleString()} Gallons</strong>
      </div>
    </div>

    <!-- JOB LIST -->
    <div class="card" style="margin-bottom:14px;">
      <div class="card-header"><h3>Jobs on this Manifest</h3></div>
      ${jobsAbove.length === 0
        ? '<div style="padding:12px;color:var(--text-light);font-size:13px;">No jobs found above this manifest.</div>'
        : `<table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#f5f5f5;">
              <th style="padding:6px 8px;text-align:left;"></th>
              <th style="padding:6px 8px;text-align:left;">Customer / Address</th>
              <th style="padding:6px 8px;text-align:left;">Tank Type</th>
              <th style="padding:6px 8px;text-align:right;white-space:nowrap;">Gallons</th>
            </tr>
          </thead>
          <tbody>
            ${jobsAbove.map(j => {
              const activeTanks = getActiveTanks(j);
              const pumped = j.gallons_pumped || {};
              const jGal = Object.values(pumped).reduce((s, g) => s + (parseInt(g) || 0), 0);
              const tankDesc = activeTanks.map(t => `${esc(t.tank_type || 'Tank')} (${(t.volume_gallons||0).toLocaleString()})`).join(', ') || 'Unknown';
              return `<tr style="border-top:1px solid #eee;">
                <td style="padding:6px 8px;"><input type="checkbox" class="mf-job-check" data-job-id="${j.id}" data-gallons="${jGal}" checked onchange="updateManifestTotal()"></td>
                <td style="padding:6px 8px;"><strong>${esc(j.customers?.name || '')}</strong><div style="font-size:11px;color:var(--text-light);">${esc(j.property?.address || '')}, ${esc(j.property?.city || '')}</div></td>
                <td style="padding:6px 8px;">${tankDesc}</td>
                <td style="padding:6px 8px;text-align:right;">
                  <input type="number" class="mf-job-gal" value="${jGal > 0 ? jGal : ''}" min="0"
                    data-job-id="${j.id}"
                    placeholder="—"
                    style="width:80px;padding:2px 4px;border:1px solid var(--border);border-radius:3px;text-align:right;"
                    oninput="this.closest('tr').querySelector('.mf-job-check').dataset.gallons=this.value;updateManifestTotal()">
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-top:2px solid #333;font-weight:700;">
          <span>Waste Type(s): <span style="color:var(--primary);">${activeWasteTypes.join(', ') || 'None'}</span></span>
          <span>Predicted Total: <span id="mfPredictedTotal" style="color:var(--primary);">${totalGallons.toLocaleString()}</span> Gallons
            ${capacityWarning ? `<span style="color:#c62828;margin-left:8px;">&#9888; Exceeds capacity!</span>` : ''}
          </span>
        </div>`
      }
    </div>

    <!-- MANIFEST FIELDS -->
    <div class="form-row">
      <div class="form-group">
        <label>Waste Site *</label>
        <select id="mfWasteSite">
          <option value="">Select waste site...</option>
          ${wasteSites.map(s => `<option value="${s.id}" ${s.id === selectedSiteId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Manifest #</label>
        <div style="font-size:14px;font-weight:600;padding:6px 0;color:var(--text);">${esc(item.manifest_number || '—')}</div>
        <input type="hidden" id="mfNumber" value="${esc(item.manifest_number || '')}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Technician</label>
        <select id="mfDriver">
          ${users.map(u => `<option value="${u.id}" ${(item.driver_id || tech?.id) === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Total Gallons${truckCapacity > 0 ? ' (max ' + truckCapacity.toLocaleString() + ')' : ''}</label>
        <input type="number" id="mfGallons" value="${item.total_gallons || totalGallons}" min="0" ${truckCapacity > 0 ? 'max="' + truckCapacity + '"' : ''}>
      </div>
    </div>

    <!-- DISPOSAL DATA -->
    <div class="form-row">
      <div class="form-group">
        <label>Receipt #</label>
        <input type="text" id="mfReceipt" value="${esc(item.receipt_number || '')}" placeholder="Receipt number">
      </div>
      <div class="form-group">
        <label>Actual Gallons Delivered</label>
        <input type="number" id="mfActualGallons" value="${item.actual_gallons || totalGallons}" min="0" placeholder="Actual gallons">
      </div>
    </div>
    <div class="form-group">
      <label>Disposal Notes</label>
      <textarea id="mfNotes">${esc(item.notes || '')}</textarea>
    </div>

    ${isCompleted ? '<div style="margin-top:12px;padding:8px 12px;background:#e8f5e9;border-radius:6px;border:1px solid #a5d6a7;color:#2e7d32;font-weight:600;font-size:13px;">&#10003; Completed</div>' : ''}
  `, `
    <button class="btn btn-danger" onclick="deleteCompletedManifest('${item.id}')">Remove</button>
    ${isCompleted ? `<button class="btn btn-secondary" onclick="uncompleteManifest('${item.id}')">Reopen</button>` : ''}
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveManifestModal('${item.id}', '${item.vehicle_id}', '${item.scheduled_date}', ${isCompleted})">Save &amp; Complete</button>
  `);
}

function updateManifestTotal() {
  const checks = document.querySelectorAll('.mf-job-check');
  let total = 0;
  checks.forEach(cb => {
    if (cb.checked) {
      total += parseInt(cb.dataset.gallons) || 0;
    }
  });
  const el = document.getElementById('mfPredictedTotal');
  if (el) el.textContent = total.toLocaleString();
  const galEl = document.getElementById('mfGallons');
  if (galEl) galEl.value = total;
  // Auto-sync actual gallons if it hasn't been manually changed from its auto value
  const actEl = document.getElementById('mfActualGallons');
  if (actEl && !actEl.dataset.manuallyChanged) actEl.value = total;
}

// Track when user manually edits actual gallons so auto-sync stops
document.addEventListener('input', function(e) {
  if (e.target && e.target.id === 'mfActualGallons') {
    e.target.dataset.manuallyChanged = '1';
  }
});

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

      // Delete ALL disposal loads with this manifest number (handles duplicates from prior bugs)
      try {
        const { data: disposals } = await window.api.getDisposalLoads();
        const matched = (disposals || []).filter(d => String(d.manifest_number) === mNum);
        for (const disp of matched) {
          await window.api.deleteDisposalLoad(disp.id);
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

// Write per-job gallons from the manifest modal rows back to each job's gallons_pumped.
// This makes the manifest the source of truth — work order reads from it.
async function syncManifestGallonsToJobs() {
  const checkboxes = [...document.querySelectorAll('.mf-job-check')];
  for (const cb of checkboxes) {
    const jobId = cb.dataset.jobId;
    const row = cb.closest('tr');
    const galInput = row?.querySelector('.mf-job-gal');
    const val = galInput?.value?.trim() ?? '';
    const gal = val === '' ? null : (parseInt(val) || 0);

    const { data: job } = await window.api.getJob(jobId);
    if (!job) continue;
    const activeTanks = getActiveTanks(job);
    let newPumped = {};

    if (gal !== null && gal > 0 && activeTanks.length > 0) {
      if (activeTanks.length === 1) {
        newPumped = { [activeTanks[0].id]: gal };
      } else {
        const totalCap = activeTanks.reduce((s, t) => s + (t.volume_gallons || 0), 0);
        activeTanks.forEach(t => {
          newPumped[t.id] = totalCap > 0
            ? Math.round(gal * (t.volume_gallons || 0) / totalCap)
            : Math.round(gal / activeTanks.length);
        });
      }
    }
    await window.api.saveJob({ id: jobId, gallons_pumped: newPumped });
  }
}

async function saveManifestDraft(itemId) {
  // Legacy path — kept for any direct calls. Full logic now in saveManifestModal.
  await saveManifestModal(itemId, null, null, false);
}

async function saveManifestModal(itemId, vehicleId, dateStr, wasCompleted) {
  if (!wasCompleted) {
    // Not yet complete — complete it now
    await completeManifest(itemId, vehicleId, dateStr);
    return;
  }

  // Already complete — update fields in place:
  // Sync gallons from manifest rows to jobs, then save the schedule item fields
  await syncManifestGallonsToJobs();

  const wasteSiteId = document.getElementById('mfWasteSite').value;
  const { data: wasteSites } = await window.api.getWasteSites();
  const site = wasteSites.find(s => s.id === wasteSiteId);
  const wasteTypes = (document.getElementById('mfWasteTypesHidden')?.value || 'Septage').split(',').filter(Boolean);

  await window.api.saveScheduleItem({
    id: itemId,
    // Preserve completed status if it was already complete
    ...(wasCompleted ? { status: 'completed' } : {}),
    total_gallons: parseInt(document.getElementById('mfGallons').value) || 0,
    waste_type: wasteTypes.join(', '),
    waste_types: wasteTypes,
    waste_site_id: wasteSiteId,
    waste_site_name: site?.name || '',
    manifest_number: document.getElementById('mfNumber').value.trim(),
    driver_id: document.getElementById('mfDriver').value,
    notes: document.getElementById('mfNotes').value.trim(),
    receipt_number: document.getElementById('mfReceipt')?.value.trim() || '',
    actual_gallons: parseInt(document.getElementById('mfActualGallons')?.value) || 0,
  });

  closeModal();
  showToast('Manifest saved.', 'success');
  loadSchedule();
}

async function uncompleteManifest(itemId) {
  const { data: allItems } = await window.api.getScheduleItems(null, null);
  const item = allItems?.find ? allItems.find(i => i.id === itemId) : null;
  const manifestNumber = item?.manifest_number || document.getElementById('mfNumber')?.value?.trim();

  // Mark the schedule item as draft
  await window.api.saveScheduleItem({ id: itemId, status: 'draft' });

  // Remove manifest stamp from any jobs that were completed under this manifest
  if (manifestNumber) {
    const { data: allJobs } = await window.api.getJobs({});
    const mNum = String(manifestNumber);
    const stamped = (allJobs || []).filter(j => String(j.manifest_number) === mNum);
    for (const j of stamped) {
      await window.api.saveJob({ id: j.id, manifest_number: null, status: 'scheduled', completed_at: null });
    }
    // Delete ALL disposal loads with this manifest number (handles duplicates from prior bugs)
    const { data: disposals } = await window.api.getDisposalLoads({});
    const matched = (disposals || []).filter(d => String(d.manifest_number) === mNum);
    for (const disp of matched) {
      await window.api.deleteDisposalLoad(disp.id);
    }
  }

  closeModal();
  showToast('Manifest reopened.', 'info');
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
  const receiptNumber = document.getElementById('mfReceipt')?.value.trim() || '';
  const actualGallons = parseInt(document.getElementById('mfActualGallons')?.value) || 0;

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

  // Read which jobs are checked in the modal and their gallons
  const checkedJobData = {};
  const missingGallons = [];
  document.querySelectorAll('.mf-job-check').forEach(cb => {
    if (!cb.checked) return;
    const row = cb.closest('tr');
    const galInput = row?.querySelector('.mf-job-gal');
    const galVal = galInput?.value ?? '';
    checkedJobData[cb.dataset.jobId] = {
      checked: true,
      gallons: galVal === '' ? null : (parseInt(galVal) || 0),
    };
    if (galVal === '') {
      // Get the customer name from the row for the error message
      const custCell = row?.querySelector('td:nth-child(2) strong');
      missingGallons.push(custCell?.textContent?.trim() || 'Unknown');
    }
  });

  if (missingGallons.length > 0) {
    showToast(`Cannot complete manifest — enter gallons for: ${missingGallons.join(', ')}`, 'error');
    return;
  }

  // Find all jobs BETWEEN the previous manifest and this one (all statuses)
  const { data: jobs } = await window.api.getJobs({ date: dateStr });
  const truckJobs = jobs.filter(j => j.vehicle_id === vehicleId).sort((a,b) => (a.scheduled_time || '').localeCompare(b.scheduled_time || ''));
  const jobsAbove = truckJobs.filter(j => {
    const jobSort = j.sort_order != null ? j.sort_order : truckJobs.indexOf(j) * 10;
    return jobSort < (item?.sort_order || 999) && jobSort > prevManifestSort && !j.manifest_number;
  });

  // Use modal checkbox state to determine which jobs are included; fall back to all if no modal data
  const includedJobs = Object.keys(checkedJobData).length > 0
    ? jobsAbove.filter(j => checkedJobData[j.id]?.checked !== false)
    : jobsAbove;

  const tankTypeToWasteMap = { 'Septic Tank': 'Septage', 'Septic Tank+Filter': 'Septage', 'Septic': 'Septage', 'Grease Trap': 'Grease Trap', 'Holding Tank': 'Holding Tank', 'Cesspool': 'Septage', 'Dry Well': 'Septage', 'Portable Toilet': 'Portable Toilet', 'Pump Chamber': 'Septage' };

  // Build pickup addresses — respect pumped_tank_ids and use modal gallons overrides
  const pickupAddresses = includedJobs.map(j => {
    const addr = j.property?.address || j.address || '';
    const city = j.property?.city || j.city || '';
    const state = j.property?.state || j.state || '';
    const custName = j.customers?.name || j.customer_name || '';
    const pumped = j.gallons_pumped || {};
    const jobTanks = j.property?.tanks || [];
    // Only include tanks that were actually selected (pumped_tank_ids)
    const activeTanks = j.pumped_tank_ids && j.pumped_tank_ids.length > 0
      ? jobTanks.filter(t => j.pumped_tank_ids.includes(t.id))
      : jobTanks;
    // Use modal gallons (null means blank — fall back to gallons_pumped)
    const modalGal = checkedJobData[j.id]?.gallons;
    const gal = (modalGal != null) ? modalGal : Object.values(pumped).reduce((s, g) => s + (parseInt(g) || 0), 0);
    const tankTypes = activeTanks.map(t => ({ type: t.tank_type || 'Septic Tank', volume: parseInt(pumped[t.id]) || 0 }));
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
    actual_gallons: actualGallons || totalGallons,
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
    receipt_number: receiptNumber,
    notes: notes,
    job_ids: includedJobs.map(j => j.id),
    pickup_addresses: pickupAddresses,
  });

  // Stamp included jobs with manifest, mark as completed, and write gallons back to job
  for (const j of includedJobs) {
    const modalGallons = checkedJobData[j.id]?.gallons;
    let newGallonsPumped = j.gallons_pumped || {};

    if (modalGallons != null && modalGallons > 0) {
      const activeTanks = getActiveTanks(j);
      const totalCap = activeTanks.reduce((s, t) => s + (t.volume_gallons || 0), 0);
      if (activeTanks.length === 1) {
        newGallonsPumped = { [activeTanks[0].id]: modalGallons };
      } else if (activeTanks.length > 1 && totalCap > 0) {
        // Distribute proportionally by tank capacity
        newGallonsPumped = {};
        activeTanks.forEach(t => {
          newGallonsPumped[t.id] = Math.round(modalGallons * (t.volume_gallons || 0) / totalCap);
        });
      } else if (activeTanks.length > 1) {
        // Equal split
        const split = Math.round(modalGallons / activeTanks.length);
        newGallonsPumped = {};
        activeTanks.forEach(t => { newGallonsPumped[t.id] = split; });
      }
    }

    await window.api.saveJob({
      id: j.id,
      waste_site: site?.name || '',
      manifest_number: manifestNumber,
      status: 'completed',
      completed_at: new Date().toISOString(),
      gallons_pumped: newGallonsPumped,
    });
  }

  // Mark schedule item as completed
  await window.api.saveScheduleItem({
    id: itemId,
    status: 'completed',
    total_gallons: totalGallons,
    actual_gallons: actualGallons,
    waste_type: wasteType,
    waste_types: wasteTypes,
    waste_site_id: wasteSiteId,
    waste_site_name: site?.name || '',
    manifest_number: manifestNumber,
    driver_id: driverId,
    notes: notes,
    receipt_number: receiptNumber,
    job_ids: includedJobs.map(j => j.id),
  });

  closeModal();
  showToast(`Manifest ${manifestNumber} completed. ${includedJobs.length} job(s) stamped.`, 'success');
  loadSchedule();
}

// Job line items state for creation/editing
let jobLineItems = [];
let jobPropertyTanks = []; // tanks for currently selected property in job modal
let jobTankTypesCache = []; // tank type configs cached for current job modal session

let _jobModalCustomers = []; // module-level cache for customer search
let _jobModalCustomersAt = 0; // cache timestamp
const _JOB_MODAL_CUST_TTL = 60000; // 60s — invalidated on save via data-changed listener below

// Invalidate the customers cache when customers/properties change elsewhere
if (window.api && window.api.onDataChanged && !window._jobModalCacheSub) {
  window._jobModalCacheSub = true;
  window.api.onDataChanged((payload) => {
    const col = (payload && payload.collection) || payload;
    if (col === 'customers' || col === 'properties') {
      _jobModalCustomersAt = 0;
    }
  });
}

async function _loadJobModalCustomers() {
  const now = Date.now();
  if (_jobModalCustomers.length > 0 && (now - _jobModalCustomersAt) < _JOB_MODAL_CUST_TTL) {
    return _jobModalCustomers;
  }
  const api = window.api;
  // Prefer the lightweight endpoint; fall back to full list if unavailable
  let customers;
  if (api.getCustomersLite) {
    const res = await api.getCustomersLite();
    customers = res && res.data;
  } else {
    const res = await api.getCustomers();
    customers = res && res.data;
  }
  _jobModalCustomers = customers || [];
  _jobModalCustomersAt = Date.now();
  return _jobModalCustomers;
}

async function openJobModal(job = null, defaultDate = '', defaultVehicle = '') {
  try {
  const isEdit = !!(job && job.id);
  const j = job || {};
  const [
    customers,
    { data: users },
    { data: vehicles },
    { data: categories },
  ] = await Promise.all([
    _loadJobModalCustomers(),
    window.api.getUsers(),
    window.api.getVehicles(),
    window.api.getServiceCategories(),
  ]);
  _jobModalCustomers = customers || [];

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
    // If no property is pre-selected and the customer has exactly one, auto-pick it
    // so tanks & line items auto-populate just like the Customers-tab flow.
    if (!j.property_id && props.length === 1) j.property_id = props[0].id;
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
    <label style="display:flex;align-items:baseline;gap:4px;cursor:pointer;padding:2px 0;overflow:hidden;color:var(--text);">
      <input type="checkbox" class="tank-check" data-idx="${i}" checked onchange="onTankCheckChange()">
      <span style="font-weight:500;overflow:hidden;text-overflow:ellipsis;">${esc(t.name || t.tank_type || 'Tank')}</span>
      <span style="color:var(--text-muted);flex-shrink:0;">&nbsp;(${esc(t.tank_type || '')})</span>
      <span style="margin-left:auto;flex-shrink:0;color:var(--text-light);">&nbsp;${(t.volume_gallons || 0).toLocaleString()}</span>
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
    ${isEdit ? `
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
            value=""
            autocomplete="off"
            oninput="renderJobCustomerDropdown()"
            onfocus="renderJobCustomerDropdown()"
            onblur="setTimeout(()=>{const d=document.getElementById('jobCustomerDropdown');if(d)d.style.display='none';},200)"
            style="width:100%;">
          <div id="jobCustomerDropdown" class="autocomplete-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;max-height:220px;overflow-y:auto;background:white;border:1px solid #ccc;border-radius:0 0 4px 4px;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,0.2);">
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
    <div id="jobTankSelector" style="${initTankCount > 0 ? 'display:block' : 'display:none'};border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:12px;background:var(--bg-white);color:var(--text);">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
        <label style="display:flex;align-items:center;gap:5px;font-weight:600;cursor:pointer;margin:0;color:var(--text);">
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
          <select id="jobProductPick" onchange="addJobServiceItem()">
            <option value="">Choose a product or service</option>
          </select>
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

    <!-- DATE / TIME -->
    <div class="form-row">
      <div class="form-group">
        <label>Date of Service *</label>
        <input type="date" id="jobDate" value="${isEdit ? dateVal : (defaultDate || '')}">
      </div>
      <div class="form-group">
        <label>Time</label>
        <input type="time" id="jobTime" value="${j.scheduled_time || ''}">
      </div>
    </div>

    ${isEdit ? `
    <!-- EDIT MODE: dropdown truck + driver + helpers -->
    <div class="form-row">
      <div class="form-group">
        <label>Truck *</label>
        <select id="jobVehicle">
          <option value="">-- Select --</option>
          ${vehicles.map(v => `<option value="${v.id}" ${v.id === vehicleVal ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Technician</label>
        <select id="jobAssigned">
          <option value="">-- Unassigned --</option>
          ${users.map(u => `<option value="${u.id}" ${u.id === j.assigned_to ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>Additional Technician</label>
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
    ` : `
    <!-- NEW JOB: TankTrack-style colored truck buttons -->
    <div class="form-group">
      <label>Truck *</label>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;">
        <button type="button" class="truck-btn ${!vehicleVal ? 'truck-btn-sel' : ''}" data-vid=""
          onclick="selectJobTruck('')"
          style="background:#e0e0e0;color:#555;padding:8px 16px;border:2px solid ${!vehicleVal ? '#555' : 'transparent'};border-radius:4px;cursor:pointer;font-weight:600;font-size:13px;${!vehicleVal ? '' : 'opacity:0.55;'}">
          None
        </button>
        ${vehicles.map(v => {
          const sel = v.id === vehicleVal;
          const c = v.color || '#1565c0';
          return `<button type="button" class="truck-btn ${sel ? 'truck-btn-sel' : ''}" data-vid="${v.id}"
            onclick="selectJobTruck('${v.id}')"
            style="background:${c};color:#fff;padding:8px 16px;border:2px solid ${sel ? '#fff' : 'transparent'};border-radius:4px;cursor:pointer;font-weight:600;font-size:13px;${sel ? 'box-shadow:0 0 0 2px ' + c + ';' : 'opacity:0.55;'}">
            ${esc(v.name)}
          </button>`;
        }).join('')}
      </div>
      <input type="hidden" id="jobVehicle" value="${vehicleVal}">
    </div>
    <div id="jobTechDisplay" style="font-size:13px;color:var(--text-light);margin-top:4px;margin-bottom:10px;">
      ${vehicleVal ? (() => { const veh = vehicles.find(v => v.id === vehicleVal); const tech = veh && users.find(u => u.id === veh.default_tech_id); return tech ? `Technician: <strong>${esc(tech.name)}</strong>` : ''; })() : ''}
    </div>
    <input type="hidden" id="jobAssigned" value="${vehicleVal ? (vehicles.find(v => v.id === vehicleVal)?.default_tech_id || '') : ''}">
    `}

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
    ${isEdit ? `
    <div class="form-group">
      <label>Technician Notes (for customers)</label>
      <textarea id="jobTechNotes" placeholder="Notes visible to customer...">${esc(j.tech_notes || '')}</textarea>
    </div>
    ` : ''}
  `, `
    ${isEdit ? '<button class="btn btn-danger" onclick="deleteJob()">Delete</button>' : ''}
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveJob()">Save</button>
  `);

  // Store data for use in truck/category picker functions
  window._jobCategories = categories;
  window._jobVehicles = vehicles;
  window._jobUsers = users;

  // Auto-select tech when vehicle dropdown is changed (edit mode only)
  const jobVehicleEl = document.getElementById('jobVehicle');
  if (jobVehicleEl && jobVehicleEl.tagName === 'SELECT') {
    jobVehicleEl.addEventListener('change', function() {
      const vid = this.value;
      const veh = vehicles.find(v => v.id === vid);
      const assignedEl = document.getElementById('jobAssigned');
      if (veh && veh.default_tech_id && assignedEl) {
        assignedEl.value = veh.default_tech_id;
      }
    });
  }

  // Render existing line items
  renderJobLineItems();

  } catch (err) {
    console.error('[openJobModal]', err);
    showToast('Error loading job form: ' + (err.message || err), 'error');
  }
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
  if (!selected || !selected.value) return;

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
              <td><input type="number" value="${li.qty || 1}" min="0.01" step="1" style="width:50px;padding:2px 4px;border:1px solid var(--border);border-radius:3px;text-align:center;" onchange="updateJobLineItemQty(${idx}, this.value)"></td>
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

let _jobCustSearchTimer = null;
function renderJobCustomerDropdown() {
  // Debounce rapid keystrokes so filtering 4k+ customers doesn't block typing.
  if (_jobCustSearchTimer) clearTimeout(_jobCustSearchTimer);
  _jobCustSearchTimer = setTimeout(_renderJobCustomerDropdownNow, 60);
}
function _renderJobCustomerDropdownNow() {
  const searchEl = document.getElementById('jobCustomerSearch');
  const dropdown = document.getElementById('jobCustomerDropdown');
  if (!searchEl || !dropdown) return;
  const query = (searchEl.value || '').toLowerCase().trim();
  const hiddenEl = document.getElementById('jobCustomer');
  if (hiddenEl) hiddenEl.value = '';
  const list = _jobModalCustomers;
  if (!list || list.length === 0) {
    dropdown.innerHTML = '<div style="padding:8px 12px;color:#999;font-size:13px;">Loading customers...</div>';
    dropdown.style.display = 'block';
    return;
  }
  const queryDigits = query.replace(/\D/g, '');
  // Bail out early once we have 50 matches — on an empty/short query we were
  // iterating all 4k items even though we only render 50.
  const out = [];
  const MAX = 50;
  for (let i = 0; i < list.length && out.length < MAX; i++) {
    const c = list[i];
    if (!query) { out.push(c); continue; }
    const name = c.name || '';
    if (name.toLowerCase().indexOf(query) !== -1) { out.push(c); continue; }
    if (queryDigits) {
      const p = (c.phone_cell || c.phone || '').replace(/\D/g, '');
      if (p && p.indexOf(queryDigits) !== -1) { out.push(c); continue; }
    }
    const email = c.email || '';
    if (email && email.toLowerCase().indexOf(query) !== -1) { out.push(c); continue; }
    const addr = c.primary_address || '';
    if (addr && addr.toLowerCase().indexOf(query) !== -1) { out.push(c); continue; }
  }
  if (out.length === 0) {
    dropdown.innerHTML = '<div style="padding:8px 12px;color:#999;font-size:13px;">No customers found.</div>';
  } else {
    const parts = new Array(out.length);
    for (let i = 0; i < out.length; i++) {
      const c = out[i];
      parts[i] = '<div class="autocomplete-item" data-id="' + esc(c.id) + '" data-name="' + esc(c.name) + '"' +
        ' onmousedown="event.preventDefault(); selectJobCustomer(this.dataset.id, this.dataset.name)"' +
        ' style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #f0f0f0;">' +
        '<strong>' + esc(c.name) + '</strong>' +
        '<div style="font-size:11px;color:var(--text-light);">' + esc(c.primary_address || '') + '</div>' +
        '</div>';
    }
    dropdown.innerHTML = parts.join('');
  }
  dropdown.style.display = 'block';
}

function filterJobCustomers() { renderJobCustomerDropdown(); } // legacy alias

function selectJobCustomer(id, name) {
  // Reopen the modal with the customer pre-set, so the full flow
  // (property dropdown populated, single-property auto-select, tank selector
  // pre-rendered with checkboxes, pump-out line items auto-computed) runs
  // exactly the same as when opening from the Customers tab.
  const keepDate = document.getElementById('jobDate')?.value || '';
  const keepVehicle = document.getElementById('jobVehicle')?.value || '';
  const dropdown = document.getElementById('jobCustomerDropdown');
  if (dropdown) dropdown.style.display = 'none';
  closeModal();
  openJobModal({ customer_id: id }, keepDate, keepVehicle);
}

// Context saved when "+ New" is clicked in the job modal so we can reopen it after
let _newCustJobCtx = null;

async function openCustomerModalFromJob(fromJob = true) {
  try {
  if (fromJob) {
    // Capture the current job modal context before closing it
    _newCustJobCtx = {
      date: document.getElementById('jobDate')?.value || '',
      vehicle: document.getElementById('jobVehicle')?.value || '',
    };
    closeModal();
  } else {
    // Called from Customers page — no job context
    _newCustJobCtx = null;
  }

  const { data: tankTypes } = await window.api.getTankTypes();
  window._ncpTtOptions = (tankTypes || []).map(tt => `<option value="${esc(tt.name)}">${esc(tt.name)}</option>`).join('');

  const saveBtn = fromJob
    ? `<button class="btn btn-primary" onclick="saveNewCustomerAndProperty()">Save &amp; Continue to Job &#8594;</button>`
    : `<button class="btn btn-primary" onclick="saveNewCustomerAndProperty()">Save &amp; Open Contact &#8594;</button>`;

  openModal('New Customer & Property', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 28px;">

      <!-- LEFT: CONTACT -->
      <div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-light);margin-bottom:10px;padding-bottom:5px;border-bottom:2px solid #1565c0;">&#128100; Contact Info</div>
        <div class="form-group">
          <label>Customer Name *</label>
          <input type="text" id="ncpName" placeholder="John & Jane Doe">
        </div>
        <div class="form-group">
          <label>Cell Phone</label>
          <input type="text" id="ncpPhoneCell" placeholder="(207) 555-1234">
        </div>
        <div class="form-group">
          <label>Home Phone</label>
          <input type="text" id="ncpPhoneHome" placeholder="(207) 555-1234">
        </div>
        <div class="form-group">
          <label>Work Phone</label>
          <input type="text" id="ncpPhoneWork" placeholder="(207) 555-1234">
        </div>
        <div class="form-group">
          <label>Email</label>
          <input type="email" id="ncpEmail" placeholder="customer@email.com">
        </div>
        <div class="form-group">
          <label>Billing Address</label>
          <input type="text" id="ncpBillingAddr" placeholder="123 Main Street">
        </div>
        <div class="form-row">
          <div class="form-group" style="flex:2;">
            <label>City</label>
            <input type="text" id="ncpBillingCity" placeholder="Camden">
          </div>
          <div class="form-group" style="max-width:64px;">
            <label>State</label>
            <input type="text" id="ncpBillingState" value="ME" maxlength="2">
          </div>
          <div class="form-group" style="max-width:90px;">
            <label>Zip</label>
            <input type="text" id="ncpBillingZip" placeholder="04843">
          </div>
        </div>
        <div class="form-group">
          <label>Contact Method</label>
          <select id="ncpContactMethod">
            <option value="Email &amp; Text">Email &amp; Text</option>
            <option value="Email">Email Only</option>
            <option value="Text">Text Only</option>
            <option value="Phone">Phone Call</option>
          </select>
        </div>
      </div>

      <!-- RIGHT: PROPERTY -->
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;padding-bottom:5px;border-bottom:2px solid #388e3c;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-light);">&#127968; Service Property</div>
          <button type="button" class="btn btn-secondary btn-sm" style="font-size:11px;" onclick="ncpCopyAddress()">&#128203; Same as billing</button>
        </div>
        <div class="form-group">
          <label>Street Address *</label>
          <input type="text" id="ncpPropAddr" placeholder="573 Peterboro Rd">
        </div>
        <div class="form-row">
          <div class="form-group" style="flex:2;">
            <label>City</label>
            <input type="text" id="ncpPropCity">
          </div>
          <div class="form-group" style="max-width:64px;">
            <label>State</label>
            <input type="text" id="ncpPropState" value="ME" maxlength="2">
          </div>
          <div class="form-group" style="max-width:90px;">
            <label>Zip</label>
            <input type="text" id="ncpPropZip">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>County</label>
            <input type="text" id="ncpPropCounty">
          </div>
          <div class="form-group">
            <label>Property Type</label>
            <select id="ncpPropType">
              <option value="">-- Select --</option>
              <option value="Residential" selected>Residential</option>
              <option value="Commercial">Commercial</option>
              <option value="Multi-Family">Multi-Family</option>
              <option value="Vacant Land">Vacant Land</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>Directions / Access Notes</label>
          <textarea id="ncpPropNotes" rows="2" placeholder="Gate code, driveway info, access instructions..."></textarea>
        </div>

        <!-- TANKS -->
        <div style="margin-top:12px;padding-top:10px;border-top:1px solid #eee;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-light);">&#128167; Tanks</div>
            <button type="button" class="btn btn-secondary btn-sm" style="font-size:11px;" onclick="ncpAddTankRow()">+ Add Tank</button>
          </div>
          <div id="ncpTankRows"></div>
        </div>
      </div>

    </div>
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    ${saveBtn}
  `);
  // Widen the modal for the two-column layout
  const m = document.querySelector('.modal');
  if (m) { m.style.maxWidth = '1000px'; m.style.width = '92%'; }
  _ncpTankCount = 0;
  } catch (err) {
    console.error('[openCustomerModalFromJob]', err);
    showToast('Error opening new customer form: ' + (err.message || err), 'error');
  }
}

let _ncpTankCount = 0;

function ncpAddTankRow() {
  const container = document.getElementById('ncpTankRows');
  if (!container) return;
  const idx = _ncpTankCount++;
  const row = document.createElement('div');
  row.id = `ncpTankRow_${idx}`;
  row.style.cssText = 'background:#f9f9f9;border:1px solid #e0e0e0;border-radius:5px;padding:8px 10px;margin-bottom:8px;';
  row.innerHTML = `
    <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;">
      <div class="form-group" style="flex:2;min-width:100px;margin-bottom:0;">
        <label style="font-size:11px;">Tank Type</label>
        <select id="ncpTankType_${idx}" style="font-size:12px;padding:4px 6px;">
          ${window._ncpTtOptions || ''}
        </select>
      </div>
      <div class="form-group" style="flex:1;min-width:80px;margin-bottom:0;">
        <label style="font-size:11px;">Gallons</label>
        <input type="number" id="ncpTankGal_${idx}" min="0" value="1000" placeholder="1000" style="font-size:12px;padding:4px 6px;">
      </div>
      <div class="form-group" style="flex:2;min-width:100px;margin-bottom:0;">
        <label style="font-size:11px;">Name (optional)</label>
        <input type="text" id="ncpTankName_${idx}" placeholder="e.g. Main Tank" style="font-size:12px;padding:4px 6px;">
      </div>
      <div class="form-group" style="min-width:70px;margin-bottom:0;">
        <label style="font-size:11px;">Filter</label>
        <select id="ncpTankFilter_${idx}" style="font-size:12px;padding:4px 6px;">
          <option value="unknown">Unknown</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </div>
      <div class="form-group" style="min-width:70px;margin-bottom:0;">
        <label style="font-size:11px;">Riser</label>
        <select id="ncpTankRiser_${idx}" style="font-size:12px;padding:4px 6px;">
          <option value="unknown">Unknown</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </div>
      <button type="button" style="background:none;border:none;color:#f44336;font-size:16px;cursor:pointer;padding:0 4px;margin-bottom:2px;" onclick="document.getElementById('ncpTankRow_${idx}').remove()" title="Remove">&#10005;</button>
    </div>`;
  container.appendChild(row);
}

function ncpCopyAddress() {
  document.getElementById('ncpPropAddr').value  = document.getElementById('ncpBillingAddr').value;
  document.getElementById('ncpPropCity').value  = document.getElementById('ncpBillingCity').value;
  document.getElementById('ncpPropState').value = document.getElementById('ncpBillingState').value;
  document.getElementById('ncpPropZip').value   = document.getElementById('ncpBillingZip').value;
}

async function saveNewCustomerAndProperty() {
  try {
  const name = document.getElementById('ncpName').value.trim();
  const propAddr = document.getElementById('ncpPropAddr').value.trim();

  if (!name) { showToast('Customer name is required.', 'error'); return; }
  if (!propAddr) { showToast('Property address is required.', 'error'); return; }

  // Save customer
  const custResult = await window.api.saveCustomer({
    name,
    phone_cell: document.getElementById('ncpPhoneCell').value.trim(),
    phone_home: document.getElementById('ncpPhoneHome').value.trim(),
    phone_work: document.getElementById('ncpPhoneWork').value.trim(),
    email: document.getElementById('ncpEmail').value.trim(),
    address: document.getElementById('ncpBillingAddr').value.trim(),
    city: document.getElementById('ncpBillingCity').value.trim(),
    state: document.getElementById('ncpBillingState').value.trim(),
    zip: document.getElementById('ncpBillingZip').value.trim(),
    contact_method: document.getElementById('ncpContactMethod').value,
  });
  if (!custResult.success) { showToast('Failed to save customer.', 'error'); return; }

  const customerId = custResult.data.id;

  // Save property
  const propResult = await window.api.saveProperty({
    customer_id: customerId,
    address: propAddr,
    city: document.getElementById('ncpPropCity').value.trim(),
    state: document.getElementById('ncpPropState').value.trim(),
    zip: document.getElementById('ncpPropZip').value.trim(),
    county: document.getElementById('ncpPropCounty').value.trim(),
    property_type: document.getElementById('ncpPropType').value,
    notes: document.getElementById('ncpPropNotes').value.trim(),
  });
  if (!propResult.success) { showToast('Customer saved but property failed.', 'error'); return; }

  const propertyId = propResult.data.id;

  // Save any tanks that were added
  const tankRows = document.querySelectorAll('#ncpTankRows > div[id^="ncpTankRow_"]');
  for (const row of tankRows) {
    const idx = row.id.replace('ncpTankRow_', '');
    const gallons = parseInt(document.getElementById(`ncpTankGal_${idx}`)?.value) || 0;
    const tankType = document.getElementById(`ncpTankType_${idx}`)?.value || '';
    if (!tankType && !gallons) continue; // skip completely empty rows
    await window.api.saveTank({
      property_id: propertyId,
      tank_type: document.getElementById(`ncpTankType_${idx}`)?.value || '',
      volume_gallons: gallons,
      tank_name: document.getElementById(`ncpTankName_${idx}`)?.value.trim() || '',
      filter: document.getElementById(`ncpTankFilter_${idx}`)?.value || 'unknown',
      riser: document.getElementById(`ncpTankRiser_${idx}`)?.value || 'unknown',
    });
  }

  closeModal();

  const ctx = _newCustJobCtx;
  _newCustJobCtx = null;

  if (ctx) {
    // Came from job modal — open job creation immediately
    showToast(`${name} added. Opening job...`, 'success');
    await openJobModal(
      { customer_id: customerId, property_id: propertyId },
      ctx.date || '',
      ctx.vehicle || ''
    );
  } else {
    // Came from Customers page — open the new customer's detail
    showToast(`${name} added.`, 'success');
    openCustomerDetail(customerId);
  }
  } catch (err) {
    console.error('[saveNewCustomerAndProperty]', err);
    showToast('Error: ' + (err.message || err), 'error');
  }
}


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
      const cityState = [p.city, p.state].filter(Boolean).join(', ');
      opt.textContent = cityState ? `${p.address}, ${cityState}` : p.address;
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

function selectJobTruck(vid) {
  const hiddenInput = document.getElementById('jobVehicle');
  if (hiddenInput) hiddenInput.value = vid;

  // Update button visual state
  document.querySelectorAll('.truck-btn').forEach(btn => {
    const sel = btn.dataset.vid === vid;
    btn.classList.toggle('truck-btn-sel', sel);
    btn.style.opacity = sel ? '1' : '0.55';
    if (sel) {
      btn.style.border = '2px solid #fff';
      const bg = btn.style.background;
      btn.style.boxShadow = bg && bg !== 'rgb(224, 224, 224)' ? `0 0 0 2px ${bg}` : '';
    } else {
      btn.style.border = '2px solid transparent';
      btn.style.boxShadow = '';
    }
  });

  // Auto-assign default tech and show name
  const veh = vid ? (window._jobVehicles || []).find(v => v.id === vid) : null;
  const tech = veh && veh.default_tech_id
    ? (window._jobUsers || []).find(u => u.id === veh.default_tech_id)
    : null;
  const assignedEl = document.getElementById('jobAssigned');
  if (assignedEl) assignedEl.value = tech ? tech.id : '';
  const techDisplay = document.getElementById('jobTechDisplay');
  if (techDisplay) techDisplay.innerHTML = tech ? `Technician: <strong>${esc(tech.name)}</strong>` : '';
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

  // Pumping: total gallons / 1000, no per-tank minimum (0.5 + 1.5 = 2, not 1 + 1.5 = 2.5)
  let totalPumpQty = 0;
  let pumpPrice = 250;
  // Disposal: group by label, per-tank minimum of 1 (500 gal = 1 unit, 1500 gal = 1.5 units)
  const dispGroups = {};

  selectedTanks.forEach(t => {
    const tt = ttMap[t.tank_type] || {};
    const vol = t.volume_gallons || 0;
    totalPumpQty += vol / 1000;
    if (tt.pumping_price) pumpPrice = tt.pumping_price;

    if (tt.generates_disposal !== false && tt.disposal_label) {
      const label = tt.disposal_label;
      if (!dispGroups[label]) {
        dispGroups[label] = { qty: 0, price: tt.disposal_price ?? 140 };
      }
      // Per-tank minimum of 1 for disposal
      dispGroups[label].qty += Math.max(1, vol / 1000);
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
      <label style="display:flex;align-items:baseline;gap:4px;cursor:pointer;padding:2px 0;white-space:nowrap;overflow:hidden;color:var(--text);">
        <input type="checkbox" class="tank-check" data-idx="${i}" checked onchange="onTankCheckChange()">
        <span style="font-weight:500;overflow:hidden;text-overflow:ellipsis;">${esc(t.name || t.tank_type || 'Tank')}</span>
        <span style="color:var(--text-muted);flex-shrink:0;">&nbsp;(${esc(t.tank_type || '')})</span>
        <span style="margin-left:auto;flex-shrink:0;color:var(--text-light);">&nbsp;${(t.volume_gallons || 0).toLocaleString()}</span>
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

  // Capture which tanks are checked in the modal (so job detail reflects user's selection)
  const tankCheckEls = document.querySelectorAll('.tank-check');
  const selectedTankIds = tankCheckEls.length > 0
    ? Array.from(tankCheckEls)
        .filter(cb => cb.checked)
        .map(cb => { const t = jobPropertyTanks[parseInt(cb.dataset.idx, 10)]; return t?.id; })
        .filter(Boolean)
    : null;

  const data = {
    customer_id: document.getElementById('jobCustomer').value,
    property_id: document.getElementById('jobProperty').value || null,
    job_type: jobType,
    vehicle_id: document.getElementById('jobVehicle').value,
    assigned_to: document.getElementById('jobAssigned')?.value || null,
    scheduled_date: document.getElementById('jobDate').value,
    scheduled_time: document.getElementById('jobTime').value || null,
    time_in: document.getElementById('jobTimeIn')?.value || null,
    time_out: document.getElementById('jobTimeOut')?.value || null,
    waste_site: document.getElementById('jobWasteSite')?.value?.trim() || '',
    manifest_number: document.getElementById('jobManifest')?.value?.trim() || '',
    notes: document.getElementById('jobNotes').value.trim(),
    tech_notes: document.getElementById('jobTechNotes')?.value?.trim() || '',
    filter_found: document.getElementById('jobFilterFound')?.checked || false,
    line_items: jobLineItems.map(li => { const item = Object.assign({}, li); delete item._auto; return item; }),
    total: total,
    helpers: Array.from(document.querySelectorAll('.helper-check:checked')).map(cb => cb.value),
    ...(selectedTankIds !== null && { pumped_tank_ids: selectedTankIds }),
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
    const savedId = result.data?.id || id;
    // If filter was found, ensure a filter lead exists for this job
    if (data.filter_found && savedId) {
      await window.api.ensureFilterLead({
        job_id: savedId,
        customer_id: data.customer_id,
        property_id: data.property_id,
        scheduled_date: data.scheduled_date,
      });
    }
    closeModal();
    showToast(id ? 'Job updated.' : 'Job scheduled.', 'success');
    loadSchedule();
  } else {
    showToast(result.error || 'Failed to save.', 'error');
  }
}

async function deleteJob() {
  const id = document.getElementById('jobId').value;
  if (!id) return;
  const blocked = await jobDeleteBlocked(id);
  if (blocked) return;
  if (!confirm('Delete this job?')) return;
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
  const { data: allFilterLeads } = await window.api.getFilterLeads({});
  const jobFilterLead = allFilterLeads.find(l => l.job_id === id) || null;
  const { data: custAfcs } = job.customer_id ? await window.api.getAfcs({ customerId: job.customer_id }) : { data: [] };
  const callOnWay = custAfcs.some(a => a.status === 'active' && a.call_ahead);

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

  document.getElementById('pageTitle').textContent = 'Work Order';
  document.getElementById('pageActions').innerHTML = `
    ${navBackButton() || `<button class="btn btn-secondary" onclick="loadSchedule()">&#8592; Back to Schedule</button>`}
    ${!_isPopup ? `<button class="btn btn-secondary btn-sm" title="Open in new window" onclick="window.api.openPopupWindow({page:'job',id:'${id}',title:'Job — ${esc(customer?.name || '')}'})">&#10697; Pop Out</button>` : ''}
  `;

  const page = document.getElementById('page-schedule');
  page.innerHTML = `
    <div class="job-detail-layout">
      <!-- LEFT SIDEBAR -->
      <div class="job-detail-sidebar">
        <div class="card">
          <div class="card-header" style="color:#1565c0;cursor:pointer;" onclick="${property ? `navPush('Work Order', "openJobDetail('${id}')");openPropertyDetail('${property.id}')` : ''}"><h3>PROPERTY INFO</h3></div>
          ${property ? `
            <div style="font-weight:700;cursor:pointer;color:#1565c0;" onclick="navPush('Work Order', &quot;openJobDetail('${id}')&quot;);openPropertyDetail('${property.id}')">${esc(property.address || '')}</div>
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
              <div class="acct-icon ${jobAcctInfo.overdue ? 'overdue' : ''}" onclick="navPush('Work Order', &quot;openJobDetail('${id}')&quot;);openCustomerAccounting('${job.customer_id}')" title="Accounting" style="padding:2px 8px;font-size:12px;">
                <span style="font-size:14px;font-weight:800;">$</span>
                ${jobAcctInfo.overdue ? '<span class="acct-overdue-badge" style="width:14px;height:14px;font-size:10px;top:-4px;right:-4px;">!</span>' : ''}
                ${jobAcctInfo.overdue ? `<span class="acct-balance-negative" style="font-size:11px;font-weight:700;">$${Math.abs(jobAcctInfo.balance).toFixed(2)}</span>` : ''}
              </div>` : ''}
            </div>
            <div style="font-weight:700;cursor:pointer;color:#1565c0;" onclick="navPush('Work Order', &quot;openJobDetail('${id}')&quot;);openCustomerDetail('${job.customer_id}')">${esc(customer?.name || 'N/A')}</div>
            ${property ? `<div style="font-size:13px;">${esc(property.address || '')}<br>${esc(property.city || '')}${property.state ? ', ' + esc(property.state) : ''} ${esc(property.zip || '')}</div>` : ''}
            ${(customer?.phone_cell || customer?.phone) ? `<div style="font-size:13px;">${esc(customer.phone_cell || customer.phone)}</div>` : ''}
            ${customer?.email ? `<div style="font-size:13px;">${esc(customer.email)}</div>` : ''}
          </div>

          <div style="margin-top:10px;padding-top:8px;border-top:1px solid #eee;display:flex;justify-content:space-between;">
            ${job.invoice_number ? `<div><strong>Invoice #</strong> ${esc(job.invoice_number)}</div>` : ''}
          </div>

          ${job.manifest_number ? `<div style="margin-top:4px;"><strong>Manifest #</strong> <span style="color:#1565c0;font-weight:700;">${esc(job.manifest_number)}</span></div>` : ''}

          ${(() => {
            if (!job.created_by && !job.created_at) return '';
            const creator = users.find(u => u.id === job.created_by);
            const creatorName = creator ? creator.name : (job.created_by ? 'Unknown user' : '');
            let when = '';
            if (job.created_at) {
              try {
                const d = new Date(job.created_at);
                const dateStr = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
                const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                when = `${dateStr} at ${timeStr}`;
              } catch {}
            }
            return `
              <div style="margin-top:10px;padding-top:8px;border-top:1px solid #eee;font-size:12px;color:var(--text-light);">
                <div><strong style="color:var(--text);">Created${creatorName ? ' by ' + esc(creatorName) : ''}</strong></div>
                ${when ? `<div>${when}</div>` : ''}
              </div>`;
          })()}

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
                    <input type="number" value="${li.qty || 1}" min="0" step="1" class="form-control" style="width:70px;text-align:right;padding:2px 4px;font-size:13px;display:inline;"
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
          ${tanks.length > 0 ? (() => {
            const pumpedIds = job.pumped_tank_ids || tanks.map(t => t.id);
            const allChecked = pumpedIds.length === tanks.length;
            return `
            <div style="margin-bottom:8px;font-size:13px;display:flex;gap:12px;align-items:center;">
              <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-weight:600;">
                <input type="checkbox" id="jobDetailAllTanks" data-job-id="${job.id}" ${allChecked ? 'checked' : ''} onchange="toggleAllJobDetailTanks('${job.id}', this.checked)"> All
              </label>
              <span>${tanks.length} Tank${tanks.length > 1 ? 's' : ''}</span>
              <span>${totalCapacity.toLocaleString()} Gallons</span>
              <span><strong>Job Volume:</strong> ${totalPumped > 0 ? totalPumped.toLocaleString() : totalCapacity.toLocaleString()}</span>
            </div>
            ${tanks.map(t => {
              const isChecked = pumpedIds.includes(t.id);
              return `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-top:1px solid #f0f0f0;">
                <div style="display:flex;align-items:center;gap:8px;">
                  <input type="checkbox" class="job-detail-tank-check" data-tank-id="${t.id}" ${isChecked ? 'checked' : ''} onchange="onJobDetailTankToggle('${job.id}')">
                  <span style="font-weight:600;">(${esc(t.tank_type || 'Tank')}${(t.filter === 'yes' || t.filter === true) ? '+Filter' : ''}) ${(t.volume_gallons || 0).toLocaleString()}</span>
                  ${(t.filter === 'yes' || t.filter === true || (t.tank_type || '').includes('Filter')) ? '<span class="badge badge-info" style="margin-left:6px;font-size:11px;">Filter</span>' : ''}
                </div>
                <div style="display:flex;align-items:center;gap:8px;">
                  <span style="font-size:12px;font-weight:600;">Gallons Pumped</span>
                  <input type="number" value="${gallonsPumped[t.id] || ''}" min="0"
                    class="form-control" style="width:100px;text-align:right;padding:4px 8px;"
                    ${!isChecked ? 'disabled' : ''}
                    onblur="updateJobGallons('${job.id}', '${t.id}', this.value)">
                </div>
              </div>`;
            }).join('')}
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-top:2px solid #333;font-weight:700;font-size:15px;">
              <span>Total Volume Pumped</span>
              <span>${totalPumped.toLocaleString()}</span>
            </div>`; })()
          : '<div style="color:var(--text-light);">No tanks on this property.</div>'}
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
        ${callOnWay ? `
        <div class="card" style="padding:12px;background:#fff3e0;border-left:4px solid #e65100;">
          <div style="font-weight:700;font-size:14px;color:#e65100;">&#128222; Call Customer On The Way</div>
        </div>
        ` : ''}
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

        <!-- FILTER CLEANING FOLLOW-UP -->
        <div class="card" style="padding:12px;">
          ${jobFilterLead ? `
            <div style="display:flex;align-items:center;gap:8px;font-weight:700;color:#2e7d32;font-size:13px;">
              &#128388; Flagged for Automatic Filter Cleaning &#10003;
            </div>
          ` : `
            <button class="btn" style="width:100%;background:#1565c0;color:white;font-weight:700;font-size:13px;padding:9px;border:none;border-radius:5px;cursor:pointer;" onclick="flagFilterCleaningFromJob('${id}')">
              &#128388; Flag for Automatic Filter Cleaning
            </button>
          `}
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

async function flagFilterCleaningFromJob(jobId) {
  const { data: job } = await window.api.getJob(jobId);
  if (!job) return;
  await window.api.ensureFilterLead({
    job_id: jobId,
    customer_id: job.customer_id,
    property_id: job.property_id,
    scheduled_date: job.scheduled_date,
  });
  showToast('Filter cleaning follow-up created.', 'success');
  openJobDetail(jobId);
}

async function updateJobGallons(jobId, tankId, value) {
  const { data: job } = await window.api.getJob(jobId);
  if (!job) return;
  const gallonsPumped = job.gallons_pumped || {};
  if (value === '' || value == null) {
    delete gallonsPumped[tankId];
  } else {
    gallonsPumped[tankId] = parseInt(value) || 0;
  }
  await window.api.saveJob({ id: jobId, gallons_pumped: gallonsPumped });
  showToast('Gallons updated.', 'success');
}

// Called from manifest modal per-job gallons input — writes back to job immediately
async function updateManifestJobGallons(jobId, input) {
  const val = input.value.trim();
  const gal = val === '' ? null : (parseInt(val) || 0);

  const { data: job } = await window.api.getJob(jobId);
  if (!job) return;

  const activeTanks = getActiveTanks(job);
  let newPumped = {};

  if (gal !== null && gal > 0) {
    if (activeTanks.length === 1) {
      newPumped = { [activeTanks[0].id]: gal };
    } else if (activeTanks.length > 1) {
      const totalCap = activeTanks.reduce((s, t) => s + (t.volume_gallons || 0), 0);
      if (totalCap > 0) {
        activeTanks.forEach(t => { newPumped[t.id] = Math.round(gal * (t.volume_gallons || 0) / totalCap); });
      } else {
        const split = Math.round(gal / activeTanks.length);
        activeTanks.forEach(t => { newPumped[t.id] = split; });
      }
    }
  }
  // gal === null or 0 → newPumped stays {} (clears gallons_pumped)

  await window.api.saveJob({ id: jobId, gallons_pumped: newPumped });
}

function toggleAllJobDetailTanks(jobId, checked) {
  document.querySelectorAll('.job-detail-tank-check').forEach(cb => { cb.checked = checked; });
  onJobDetailTankToggle(jobId);
}

async function onJobDetailTankToggle(jobId) {
  const checkedIds = Array.from(document.querySelectorAll('.job-detail-tank-check:checked')).map(cb => cb.dataset.tankId);
  const total = document.querySelectorAll('.job-detail-tank-check').length;
  const allEl = document.getElementById('jobDetailAllTanks');
  if (allEl) allEl.checked = checkedIds.length === total;

  // Immediately disable/enable the gallons input for each tank row
  document.querySelectorAll('.job-detail-tank-check').forEach(cb => {
    const row = cb.closest('div[style*="border-top"]');
    if (row) {
      const input = row.querySelector('input[type="number"]');
      if (input) input.disabled = !cb.checked;
    }
  });

  const { data: job } = await window.api.getJob(jobId);
  if (!job || !job.property_id) return;

  const [{ data: prop }, { data: tankTypes }] = await Promise.all([
    window.api.getProperty(job.property_id),
    window.api.getTankTypes(),
  ]);

  const ttMap = {};
  (tankTypes || []).forEach(tt => { ttMap[tt.name] = tt; });

  // All possible auto-generated descriptions (to filter out before recomputing)
  const autoDescs = new Set(['Pumping']);
  (tankTypes || []).forEach(tt => { if (tt.disposal_label) autoDescs.add(tt.disposal_label); });
  const manualItems = (job.line_items || []).filter(li => !autoDescs.has(li.description));

  const checkedTanks = (prop?.tanks || []).filter(t => checkedIds.includes(t.id));
  let totalPumpQty = 0;
  let pumpPrice = 250;
  const dispGroups = {};
  checkedTanks.forEach(t => {
    const tt = ttMap[t.tank_type] || {};
    const vol = t.volume_gallons || 0;
    totalPumpQty += vol / 1000;
    if (tt.pumping_price) pumpPrice = tt.pumping_price;
    if (tt.generates_disposal !== false && tt.disposal_label) {
      const label = tt.disposal_label;
      if (!dispGroups[label]) dispGroups[label] = { qty: 0, price: tt.disposal_price ?? 140 };
      dispGroups[label].qty += Math.max(1, vol / 1000);
    }
  });

  const autoItems = checkedTanks.length > 0 ? [
    { description: 'Pumping', qty: Math.round(totalPumpQty * 100) / 100, unit_price: pumpPrice },
    ...Object.entries(dispGroups).map(([label, { qty, price }]) => ({
      description: label, qty: Math.round(qty * 100) / 100, unit_price: price,
    })),
  ] : [];

  const newLineItems = [...autoItems, ...manualItems];
  const newTotal = newLineItems.reduce((s, li) => s + (li.qty || 1) * (li.unit_price || 0), 0);
  await window.api.saveJob({ id: jobId, pumped_tank_ids: checkedIds, line_items: newLineItems, total: newTotal });
  openJobDetail(jobId);
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
  const blocked = await jobDeleteBlocked(jobId);
  if (blocked) return;
  if (!confirm('Delete this job?')) return;
  await window.api.deleteJob(jobId);
  showToast('Job deleted.', 'success');
  loadSchedule();
}

// Returns true (and shows error) if the job is stamped to a manifest and cannot be deleted
async function jobDeleteBlocked(jobId) {
  const { data: job } = await window.api.getJob(jobId);
  if (!job?.manifest_number) return false;

  // Verify the manifest schedule item actually still exists
  const { data: allItems } = await window.api.getScheduleItems();
  const manifestExists = (allItems || []).some(i =>
    i.item_type === 'manifest' && String(i.manifest_number) === String(job.manifest_number)
  );
  if (!manifestExists) {
    // Manifest was deleted without clearing job stamp — clear it now and allow deletion
    await window.api.saveJob({ id: jobId, manifest_number: '', waste_site: '' });
    return false;
  }

  showToast(
    `Cannot delete — this job is on manifest #${job.manifest_number}. Remove it from the manifest or delete the manifest first.`,
    'error',
    7000
  );
  return true;
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
        <div class="trucks-list" id="trucksList">
          ${vehicles.map(v => {
            const isSelected = v.id === _selectedVehicleId;
            return `
              <div class="truck-list-item ${isSelected ? 'selected' : ''}" data-id="${v.id}" draggable="true"
                   ondragstart="_truckDragStart(event,'${v.id}')"
                   ondragover="_truckDragOver(event)"
                   ondragleave="_truckDragLeave(event)"
                   ondrop="_truckDrop(event,'${v.id}')"
                   ondragend="_truckDragEnd(event)"
                   onclick="selectVehicle('${v.id}')">
                <div class="truck-drag-handle" title="Drag to reorder" style="cursor:grab;padding:0 6px;color:#999;font-size:16px;user-select:none;">&#8942;&#8942;</div>
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
      </div>
      <div class="trucks-edit-panel" id="trucksEditPanel">
        ${_selectedVehicleId ? '' : '<div class="empty-state" style="padding:40px;"><p>Select a truck to edit, or add a new one.</p></div>'}
      </div>
    </div>
  `;

  if (_selectedVehicleId === '__new__') {
    renderVehicleForm(null, users);
  } else if (_selectedVehicleId) {
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

// ===== TRUCK LIST DRAG-AND-DROP REORDER =====
let _truckDraggingId = null;
function _truckDragStart(e, id) {
  _truckDraggingId = id;
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', id); } catch (_) {}
  e.currentTarget.style.opacity = '0.4';
}
function _truckDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const row = e.currentTarget;
  if (row.dataset.id === _truckDraggingId) return;
  const rect = row.getBoundingClientRect();
  const after = (e.clientY - rect.top) > rect.height / 2;
  row.style.borderTop = after ? '' : '2px solid #1565c0';
  row.style.borderBottom = after ? '2px solid #1565c0' : '';
}
function _truckDragLeave(e) {
  e.currentTarget.style.borderTop = '';
  e.currentTarget.style.borderBottom = '';
}
function _truckDragEnd(e) {
  document.querySelectorAll('.truck-list-item').forEach(el => {
    el.style.opacity = '';
    el.style.borderTop = '';
    el.style.borderBottom = '';
  });
  _truckDraggingId = null;
}
async function _truckDrop(e, targetId) {
  e.preventDefault();
  const row = e.currentTarget;
  row.style.borderTop = '';
  row.style.borderBottom = '';
  const draggingId = _truckDraggingId;
  _truckDraggingId = null;
  if (!draggingId || draggingId === targetId) return;

  const list = document.getElementById('trucksList');
  if (!list) return;
  const rect = row.getBoundingClientRect();
  const after = (e.clientY - rect.top) > rect.height / 2;

  const draggingEl = list.querySelector(`.truck-list-item[data-id="${draggingId}"]`);
  if (!draggingEl) return;
  if (after) row.parentNode.insertBefore(draggingEl, row.nextSibling);
  else row.parentNode.insertBefore(draggingEl, row);

  const orderedIds = Array.from(list.querySelectorAll('.truck-list-item')).map(el => el.dataset.id);
  try {
    await window.api.reorderVehicles(orderedIds);
    showToast('Order saved.', 'success');
  } catch (err) {
    console.error('Reorder failed:', err);
    showToast('Reorder failed.', 'error');
    loadVehicles();
  }
}

// ===== INVOICES =====
// ===== INVOICES =====
function _invoiceDefaultFilters() {
  const d = new Date();
  const fmt = (dt) => dt.toISOString().split('T')[0];
  const from = fmt(new Date(d.getFullYear(), d.getMonth(), 1));
  const to = fmt(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  return { sortField: 'svc_date', sortDir: 'desc', dateFrom: from, dateTo: to, _preset: 'This Month' };
}
let invoiceFilters = _invoiceDefaultFilters();
let invoiceFilterOptions = null;
let selectedInvoiceIds = new Set();

async function loadInvoices() {
  const page = document.getElementById('page-invoices');
  selectedInvoiceIds.clear();

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

        <label class="inv-filter-label">Waiting Area</label>
        <select class="inv-filter-select" onchange="invoiceFilters.waitingArea=this.value||undefined;loadInvoices()">
          <option value="" ${!invoiceFilters.waitingArea ? 'selected' : ''}>Include (default)</option>
          <option value="hide" ${invoiceFilters.waitingArea === 'hide' ? 'selected' : ''}>Hide</option>
          <option value="only" ${invoiceFilters.waitingArea === 'only' ? 'selected' : ''}>Only Waiting Area</option>
        </select>

        <label class="inv-filter-label">Cancelled</label>
        <select class="inv-filter-select" onchange="invoiceFilters.cancelled=this.value||undefined;loadInvoices()">
          <option value="" ${!invoiceFilters.cancelled ? 'selected' : ''}>Hide (default)</option>
          <option value="include" ${invoiceFilters.cancelled === 'include' ? 'selected' : ''}>Include</option>
          <option value="only" ${invoiceFilters.cancelled === 'only' ? 'selected' : ''}>Only Cancelled</option>
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
            <button id="invCancelBtn" class="btn btn-sm" style="background:#f57c00;color:white;font-weight:700;font-size:11px;${selectedInvoiceIds.size > 0 ? '' : 'display:none;'}" onclick="invoiceBatchCancel(true)">CANCEL (${selectedInvoiceIds.size})</button>
            <button id="invUncancelBtn" class="btn btn-sm" style="background:#2e7d32;color:white;font-weight:700;font-size:11px;${selectedInvoiceIds.size > 0 && invoiceFilters.cancelled === 'only' ? '' : 'display:none;'}" onclick="invoiceBatchCancel(false)">UNCANCEL (${selectedInvoiceIds.size})</button>
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
                <th style="width:32px;"><input type="checkbox" onchange="invoiceToggleAll(this.checked)"></th>
                <th ${sortClick('invoice_number')} style="cursor:pointer;">Invoice #${sortIcon('invoice_number')}</th>
                <th ${sortClick('svc_date')} style="cursor:pointer;">Svc Date${sortIcon('svc_date')}</th>
                <th>Loose Ends</th>
                <th ${sortClick('customer_name')} style="cursor:pointer;">Name${sortIcon('customer_name')}</th>
                <th>Billing Company</th>
                <th>Billing City</th>
                <th>Property Company</th>
                <th>Property Address</th>
                <th>Property City</th>
                <th style="width:70px;">Job Codes</th>
                <th style="width:70px;">Complete</th>
                <th style="text-align:right;">Gallons Pumped</th>
                <th ${sortClick('total')} style="cursor:pointer;text-align:right;">Invoice Amt${sortIcon('total')}</th>
                <th ${sortClick('amount_paid')} style="cursor:pointer;text-align:right;">Amount Paid${sortIcon('amount_paid')}</th>
              </tr>
            </thead>
            <tbody>
              <!-- TOTALS ROW -->
              <tr class="inv-totals-row">
                <td></td>
                <td><strong>Totals</strong></td>
                <td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>
                <td style="text-align:right;"><strong>${(totals.gallons_pumped || 0).toLocaleString()}</strong></td>
                <td style="text-align:right;"><strong>${(totals.invoice_total || 0).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</strong></td>
                <td style="text-align:right;"><strong>${(totals.amount_paid || 0).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</strong></td>
              </tr>
              ${invoices.map(inv => {
                const gallons = inv.gallons_pumped_total || 0;
                const total = inv.total || 0;
                const paid = inv.amount_paid || 0;
                const name = inv.customers?.name || inv.customer_name || inv.billing_company || inv.property_company || '';
                const billCompany = inv.billing_company || inv.customers?.company || inv.customers?.name || '';
                const billCity = inv.billing_city || inv.customers?.city || '';
                const propCompany = inv.property_company || '';
                const propAddr = inv.property_address || inv.property?.address || '';
                const propCity = inv.property_city || inv.property?.city || '';
                const isWaiting = inv.waiting_area === true || (inv.waiting_area == null && inv.imported_from === 'tanktrack' && !(inv.truck || '').trim());
                const waitingBadge = isWaiting ? ` <span style="background:#f9a825;color:#000;font-size:9px;font-weight:700;padding:1px 5px;border-radius:8px;vertical-align:middle;" title="Unassigned to a truck">WAITING</span>` : '';
                const cancelledBadge = inv.cancelled ? ` <span style="background:#c62828;color:#fff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:8px;vertical-align:middle;" title="Cancelled invoice">CANCELLED</span>` : '';
                const rowStyle = inv.cancelled ? 'cursor:pointer;opacity:0.55;text-decoration:line-through;' : 'cursor:pointer;';
                return `
                <tr data-inv-id="${inv.id}" onclick="${inv.job_id ? `openJobDetail('${inv.job_id}')` : `openInvoiceDetail('${inv.id}')`}" style="${rowStyle}" class="${selectedInvoiceIds.has(inv.id) ? 'inv-row-selected' : ''}">
                  <td onclick="event.stopPropagation()"><input type="checkbox" ${selectedInvoiceIds.has(inv.id) ? 'checked' : ''} onchange="invoiceToggleOne('${inv.id}', this.checked)"></td>
                  <td><strong>${esc(inv.invoice_number || '')}</strong>${waitingBadge}${cancelledBadge}</td>
                  <td style="white-space:nowrap;">${inv.svc_date || ''}</td>
                  <td style="font-size:11px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(inv.loose_ends || '')}">${esc(inv.loose_ends || '')}</td>
                  <td>${esc(name)}</td>
                  <td>${esc(billCompany)}</td>
                  <td>${esc(billCity)}</td>
                  <td>${esc(propCompany)}</td>
                  <td>${esc(propAddr)}</td>
                  <td>${esc(propCity)}</td>
                  <td style="font-size:11px;">${esc(abbreviateJobCode(inv.job_codes || ''))}</td>
                  <td style="text-align:center;">${inv.complete ? '&#10003;' : ''}</td>
                  <td style="text-align:right;">${gallons ? gallons.toLocaleString() : ''}</td>
                  <td style="text-align:right;">${total.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                  <td style="text-align:right;">${paid.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                </tr>`;
              }).join('')}
              ${invoices.length === 0 ? '<tr><td colspan="15" style="text-align:center;padding:24px;color:var(--text-light);">No invoices match your filters.</td></tr>' : ''}
            </tbody>
          </table>
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
  invoiceFilters = _invoiceDefaultFilters();
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
      const pdfResult = await window.api.generatePdf(html, `Invoice-${inv.invoice_number}.pdf`, { skipDialog: true });
      if (pdfResult?.success) {
        await window.api.sendEmail(inv.customers.email, `Invoice ${inv.invoice_number}`, `Please find attached invoice ${inv.invoice_number}.`, pdfResult.path);
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
  const pdfResult = await window.api.generatePdf(allHtml, 'Invoices-Batch.pdf', { skipDialog: true });
  if (pdfResult?.success) await window.api.openFile(pdfResult.path);
}

async function invoiceBatchDelete() {
  if (selectedInvoiceIds.size === 0) { showToast('Select invoices first.', 'error'); return; }
  const ids = Array.from(selectedInvoiceIds);
  if (!confirm(`Delete ${ids.length} invoice(s)? This cannot be undone.`)) return;
  _showBulkDeleteOverlay(`Deleting ${ids.length} invoice(s)…`);
  try {
    const res = await window.api.bulkDeleteInvoices(ids);
    selectedInvoiceIds.clear();
    showToast(`Deleted ${res.deleted} invoice(s).`, 'success');
  } catch (err) {
    console.error(err);
    showToast('Delete failed: ' + (err?.message || err), 'error');
  } finally {
    _hideBulkDeleteOverlay();
    loadInvoices();
  }
}

async function invoiceBatchCancel(cancel) {
  if (selectedInvoiceIds.size === 0) { showToast('Select invoices first.', 'error'); return; }
  const ids = Array.from(selectedInvoiceIds);
  const verb = cancel ? 'Cancel' : 'Reinstate';
  if (!confirm(`${verb} ${ids.length} invoice(s)?`)) return;
  try {
    const res = await window.api.bulkCancelInvoices(ids, cancel);
    selectedInvoiceIds.clear();
    showToast(`${cancel ? 'Cancelled' : 'Reinstated'} ${res.updated} invoice(s).`, 'success');
  } catch (err) {
    console.error(err);
    showToast((cancel ? 'Cancel' : 'Reinstate') + ' failed: ' + (err?.message || err), 'error');
  } finally {
    loadInvoices();
  }
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

  // Preserve filter state
  const existingFrom   = document.getElementById('disposalFilterFrom')?.value;
  const existingTo     = document.getElementById('disposalFilterTo')?.value;
  const existingSite   = document.getElementById('disposalFilterSite')?.value || '';
  const existingTruck  = document.getElementById('disposalFilterTruck')?.value || '';
  const existingWaste  = document.getElementById('disposalFilterWaste')?.value || '';

  const now = new Date();
  const defaultFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const defaultTo = formatDate(now);
  const dateFrom = existingFrom || defaultFrom;
  const dateTo   = existingTo   || defaultTo;

  const { data: allLoads }      = await window.api.getDisposalLoads();
  const { data: _vehicles }     = await window.api.getVehicles();
  const { data: _wasteSites }   = await window.api.getWasteSites();
  const { data: _users }        = await window.api.getUsers();
  const { data: _outsidePumpers } = await window.api.getOutsidePumpers();

  // Enrich with vehicle/site lookups
  allLoads.forEach(l => {
    if (!l.waste_hauler_id) {
      const veh = _vehicles.find(v => v.id === l.vehicle_id || v.name === l.vehicle);
      if (veh) l.waste_hauler_id = veh.waste_hauler_id || '';
    }
    if (!l.waste_site_license) {
      const ws = _wasteSites.find(s => s.id === l.waste_site_id);
      if (ws) l.waste_site_license = ws.state_license || '';
    }
  });

  // Apply date filter first
  let loads = allLoads.filter(l => l.disposal_date >= dateFrom && l.disposal_date <= dateTo);

  // Apply sidebar filters
  if (existingSite)  loads = loads.filter(l => l.waste_site_id === existingSite || l.disposal_site === existingSite);
  if (existingTruck) loads = loads.filter(l => l.vehicle_id === existingTruck || l.vehicle === existingTruck);
  if (existingWaste) loads = loads.filter(l => (l.waste_type || '').toLowerCase().includes(existingWaste.toLowerCase()));

  // Totals
  const totalPumpVol   = loads.reduce((s, l) => s + (l.volume_gallons  || 0), 0);
  const totalActual    = loads.reduce((s, l) => s + (l.actual_gallons   || l.volume_gallons || 0), 0);

  // Waste type abbreviation map (matches TankTrack style)
  const wasteAbbr = {
    'Septage': 'S', 'Grease Trap': 'G', 'Grease': 'G',
    'Holding Tank': 'H', 'Portable Toilet': 'Pt',
    'Septic Waste Disposal': 'Sw', 'Grease Trap Waste': 'G',
    'GIgS': 'GIgS', 'Other': 'Oth',
  };
  const abbr = (wt) => {
    if (!wt) return 'S';
    for (const [k, v] of Object.entries(wasteAbbr)) {
      if (wt.toLowerCase().includes(k.toLowerCase())) return v;
    }
    return wt.substring(0, 3);
  };

  // Build site options for filter
  const siteOptions = _wasteSites.map(s =>
    `<option value="${s.id}" ${existingSite === s.id ? 'selected' : ''}>${esc(s.name)}</option>`
  ).join('');
  const truckOptions = _vehicles.map(v =>
    `<option value="${v.id}" ${existingTruck === v.id ? 'selected' : ''}>${esc(v.name)}</option>`
  ).join('');

  // Date range label (TankTrack style header)
  const fmtDisplay = (d) => {
    if (!d) return '';
    const [y, m, dy] = d.split('-');
    return `${['January','February','March','April','May','June','July','August','September','October','November','December'][parseInt(m)-1]} ${parseInt(dy)}, ${y}`;
  };
  const dateRangeLabel = `${fmtDisplay(dateFrom)} \u2013 ${fmtDisplay(dateTo)}`;

  page.innerHTML = `
    <div style="display:flex;height:100%;min-height:0;">

      <!-- LEFT FILTER SIDEBAR -->
      <div style="width:180px;min-width:160px;flex-shrink:0;background:var(--surface-subtle);border-right:1px solid var(--border);padding:12px 10px;overflow-y:auto;font-size:13px;color:var(--text);">
        <div style="font-weight:700;font-size:11px;letter-spacing:.5px;color:var(--text-light);margin-bottom:10px;text-transform:uppercase;">Filter Disposals</div>

        <div style="display:flex;justify-content:flex-end;margin-bottom:10px;">
          <button class="btn btn-secondary" style="font-size:11px;padding:3px 8px;" onclick="clearDisposalFilters()">Clear All</button>
        </div>

        <div style="margin-bottom:10px;">
          <div style="font-weight:600;font-size:11px;margin-bottom:4px;color:var(--text);">Service Date Range</div>
          <select onchange="setDisposalRange(this.value);this.value=''" style="width:100%;padding:4px 6px;font-size:12px;margin-bottom:4px;">
            <option value="">Quick range…</option>
            <option value="month">This Month</option>
            <option value="lastmonth">Last Month</option>
            <option value="quarter">This Quarter</option>
            <option value="year">This Year</option>
          </select>
          <input type="date" id="disposalFilterFrom" value="${dateFrom}" onchange="loadDisposal()" style="width:100%;padding:4px 6px;font-size:12px;margin-bottom:3px;">
          <input type="date" id="disposalFilterTo"   value="${dateTo}"   onchange="loadDisposal()" style="width:100%;padding:4px 6px;font-size:12px;">
        </div>

        <div style="margin-bottom:10px;">
          <div style="font-weight:600;font-size:11px;margin-bottom:4px;color:var(--text);">Waste Site</div>
          <select id="disposalFilterSite" onchange="loadDisposal()" style="width:100%;padding:4px 6px;font-size:12px;">
            <option value="">All sites</option>
            ${siteOptions}
          </select>
        </div>

        <div style="margin-bottom:10px;">
          <div style="font-weight:600;font-size:11px;margin-bottom:4px;color:var(--text);">Truck</div>
          <select id="disposalFilterTruck" onchange="loadDisposal()" style="width:100%;padding:4px 6px;font-size:12px;">
            <option value="">All trucks</option>
            ${truckOptions}
          </select>
        </div>

        <div style="margin-bottom:10px;">
          <div style="font-weight:600;font-size:11px;margin-bottom:4px;color:var(--text);">Waste Type</div>
          <input type="text" id="disposalFilterWaste" value="${esc(existingWaste)}" placeholder="e.g. Septage" oninput="loadDisposal()" style="width:100%;padding:4px 6px;font-size:12px;">
        </div>
      </div>

      <!-- MAIN CONTENT -->
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden;">

        <!-- TOP BAR -->
        <div style="display:flex;align-items:center;padding:10px 16px;border-bottom:1px solid var(--border);background:#fff;flex-shrink:0;gap:10px;">
          <span style="font-size:18px;font-weight:700;">Disposals</span>
          <span style="display:inline-block;background:var(--primary);color:#fff;border-radius:12px;font-size:12px;font-weight:700;padding:1px 8px;">${loads.length}</span>
          <button id="disposalBatchDeleteBtn" class="btn btn-danger btn-sm" style="display:none;margin-left:8px;" onclick="batchDeleteDisposals()">&#128465; Delete Selected</button>
        </div>

        <!-- DATE RANGE HEADER -->
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 16px;background:#f5f5f5;border-bottom:1px solid var(--border);font-size:12px;color:var(--text-light);flex-shrink:0;">
          <span>${dateRangeLabel}</span>
          <span>${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})} | ${new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZoneName:'short'})}</span>
        </div>

        <!-- TABLE -->
        <div style="flex:1;overflow:auto;">
          ${loads.length === 0 ? `
            <div class="empty-state">
              <div class="empty-icon">&#128666;</div>
              <p>No disposal loads in this date range.</p>
            </div>
          ` : `
            <table class="data-table" style="font-size:13px;width:100%;">
              <thead>
                <tr style="background:#f0f0f0;">
                  <th style="padding:7px 8px;text-align:center;width:32px;"><input type="checkbox" id="disposalSelectAll" onchange="toggleAllDisposalChecks(this.checked)" title="Select all"></th>
                  <th style="padding:7px 10px;text-align:left;white-space:nowrap;">Record #</th>
                  <th style="padding:7px 6px;text-align:center;">Type</th>
                  <th style="padding:7px 10px;text-align:left;">Site Name</th>
                  <th style="padding:7px 10px;text-align:left;white-space:nowrap;">Del Date</th>
                  <th style="padding:7px 10px;text-align:left;">Contact Name</th>
                  <th style="padding:7px 10px;text-align:right;white-space:nowrap;">TT Delivered</th>
                  <th style="padding:7px 10px;text-align:right;white-space:nowrap;">Pump Vol</th>
                  <th style="padding:7px 10px;text-align:left;">Waste Type</th>
                  <th style="padding:7px 10px;text-align:left;">Truck</th>
                  <th style="padding:7px 10px;text-align:left;">Receipt #</th>
                </tr>
                <tr style="background:#e8e8e8;font-weight:700;font-size:12px;">
                  <td></td>
                  <td style="padding:5px 10px;" colspan="5">Totals</td>
                  <td style="padding:5px 10px;text-align:right;">${totalActual.toLocaleString()}</td>
                  <td style="padding:5px 10px;text-align:right;">${totalPumpVol.toLocaleString()}</td>
                  <td colspan="3"></td>
                </tr>
              </thead>
              <tbody>
                ${loads.sort((a,b) => (b.disposal_date||'').localeCompare(a.disposal_date||'')).map(l => {
                  const wasteType = l.waste_type || 'Septage';
                  const wasteCode = abbr(wasteType);
                  const siteName  = l.disposal_site || l.waste_site_name || '';
                  const custName  = l.customer_names || l.customers?.name || '';
                  const isYards   = l.volume_unit === 'yards';
                  const volRaw    = isYards ? (l.volume_yards || 0) : (l.volume_gallons || 0);
                  const volUnit   = isYards ? ' yd³' : '';
                  const pumpVol   = volRaw.toLocaleString() + volUnit;
                  const ttDel     = isYards ? pumpVol : (l.actual_gallons || l.volume_gallons || 0).toLocaleString();
                  const isComplete = !!(l.manifest_number);
                  let sourceLabel = l.vehicle || '';
                  if (l.outside_pumper_id) {
                    const op = _outsidePumpers.find(p => p.id === l.outside_pumper_id);
                    sourceLabel = op ? (op.company || op.name) : (l.pumper_name || 'Outside Pumper');
                  }
                  return `<tr style="cursor:pointer;border-bottom:1px solid #eee;" onmouseover="this.style.background='#f9f9f9'" onmouseout="this.style.background=''">
                    <td style="padding:6px 8px;text-align:center;" onclick="event.stopPropagation()">
                      <input type="checkbox" class="disposal-row-check" data-id="${l.id}" onchange="updateDisposalBatchBtn()">
                    </td>
                    <td style="padding:6px 10px;font-weight:600;color:var(--primary);" onclick="openDisposalDetail('${l.id}')">${esc(l.disposal_number || l.manifest_number || '—')}</td>
                    <td style="padding:6px 6px;text-align:center;font-size:11px;font-weight:700;" onclick="openDisposalDetail('${l.id}')">${esc(wasteCode)}</td>
                    <td style="padding:6px 10px;" onclick="openDisposalDetail('${l.id}')">${esc(siteName)}</td>
                    <td style="padding:6px 10px;white-space:nowrap;" onclick="openDisposalDetail('${l.id}')">${l.disposal_date || ''}</td>
                    <td style="padding:6px 10px;" onclick="openDisposalDetail('${l.id}')">${esc(custName)}</td>
                    <td style="padding:6px 10px;text-align:right;font-weight:600;" onclick="openDisposalDetail('${l.id}')">${ttDel}</td>
                    <td style="padding:6px 10px;text-align:right;" onclick="openDisposalDetail('${l.id}')">${pumpVol}</td>
                    <td style="padding:6px 10px;font-size:12px;" onclick="openDisposalDetail('${l.id}')">${esc(wasteType)}</td>
                    <td style="padding:6px 10px;font-size:12px;" onclick="openDisposalDetail('${l.id}')">${esc(sourceLabel)}${l.outside_pumper_id ? '<br><span style="font-size:10px;color:#e65100;font-weight:600;">OUTSIDE PUMPER</span>' : ''}</td>
                    <td style="padding:6px 10px;font-size:12px;color:var(--text-light);" onclick="openDisposalDetail('${l.id}')">${esc(l.receipt_number || '')}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          `}
        </div>
      </div>
    </div>
  `;
}

function clearDisposalFilters() {
  const now = new Date();
  const defaultFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const defaultTo = formatDate(now);
  const f = document.getElementById('disposalFilterFrom');
  const t = document.getElementById('disposalFilterTo');
  const s = document.getElementById('disposalFilterSite');
  const tr = document.getElementById('disposalFilterTruck');
  const w = document.getElementById('disposalFilterWaste');
  if (f) f.value = defaultFrom;
  if (t) t.value = defaultTo;
  if (s) s.value = '';
  if (tr) tr.value = '';
  if (w) w.value = '';
  loadDisposal();
}

function updateDisposalBatchBtn() {
  const anyChecked = document.querySelectorAll('.disposal-row-check:checked').length > 0;
  const btn = document.getElementById('disposalBatchDeleteBtn');
  if (btn) btn.style.display = anyChecked ? '' : 'none';
}

function toggleAllDisposalChecks(checked) {
  document.querySelectorAll('.disposal-row-check').forEach(cb => cb.checked = checked);
  updateDisposalBatchBtn();
}

async function batchDeleteDisposals() {
  const checked = [...document.querySelectorAll('.disposal-row-check:checked')];
  if (checked.length === 0) return;
  if (!confirm(`Delete ${checked.length} disposal record${checked.length > 1 ? 's' : ''}? This cannot be undone.`)) return;

  const { data: loads } = await window.api.getDisposalLoads();
  const { data: allItems } = await window.api.getScheduleItems();
  const { data: allJobs } = await window.api.getJobs({});

  for (const cb of checked) {
    const disposal = (loads || []).find(d => d.id === cb.dataset.id);
    const mNum = disposal?.manifest_number ? String(disposal.manifest_number) : null;
    await window.api.deleteDisposalLoad(cb.dataset.id);
    if (mNum) {
      const manifestItem = (allItems || []).find(i => i.item_type === 'manifest' && String(i.manifest_number) === mNum);
      if (manifestItem) await window.api.deleteScheduleItem(manifestItem.id);
      const stamped = (allJobs || []).filter(j => String(j.manifest_number) === mNum);
      for (const j of stamped) {
        await window.api.saveJob({ id: j.id, manifest_number: null, status: 'scheduled', completed_at: null });
      }
    }
  }

  showToast(`${checked.length} disposal${checked.length > 1 ? 's' : ''} deleted.`, 'success');
  loadDisposal();
}

function setDisposalRange(range) {
  const now = new Date();
  let from, to;
  if (range === 'month') {
    from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    to = formatDate(now);
  } else if (range === 'lastmonth') {
    const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lmEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    from = formatDate(lm);
    to = formatDate(lmEnd);
  } else if (range === 'quarter') {
    const qMonth = Math.floor(now.getMonth() / 3) * 3;
    from = `${now.getFullYear()}-${String(qMonth + 1).padStart(2, '0')}-01`;
    to = formatDate(now);
  } else if (range === 'year') {
    from = `${now.getFullYear()}-01-01`;
    to = formatDate(now);
  }
  const fromEl = document.getElementById('disposalFilterFrom');
  const toEl   = document.getElementById('disposalFilterTo');
  if (fromEl) fromEl.value = from;
  if (toEl)   toEl.value   = to;
  loadDisposal();
}

function buildDisposalTableHtml(loads, users, vehicles, wasteSites, totalGallons, outsidePumpers) {
  const tankTypeToWaste = { 'Septic Tank': 'Septage', 'Septic Tank+Filter': 'Septage', 'Grease Trap': 'Grease Trap', 'Holding Tank': 'Holding Tank', 'Cesspool': 'Septage', 'Portable Toilet': 'Portable Toilet', 'Pump Chamber': 'Septage' };

  let rows = '';
  loads.forEach(l => {
    const driverUser = users.find(u => u.id === l.driver);
    const veh = vehicles.find(v => v.id === l.vehicle_id || v.name === l.vehicle);
    const op = (outsidePumpers || []).find(p => p.id === l.outside_pumper_id);
    const haulerID = l.pumper_hauler_id || l.waste_hauler_id || veh?.waste_hauler_id || op?.hauler_id || '';
    const ws = wasteSites.find(s => s.id === l.waste_site_id);
    const siteLicense = l.waste_site_license || ws?.state_license || '';
    const techName = driverUser ? esc(driverUser.name) : '';
    const truckLabel = op ? esc(op.company || op.name) : esc(l.vehicle || '');
    const recordNum = l.disposal_number || l.manifest_number || '—';
    const volUnit = l.volume_unit === 'yards' ? ' yd³' : ' gal';
    const totalVol = l.volume_unit === 'yards' ? (l.volume_yards || 0) : (l.volume_gallons || 0);

    if (l.pickup_addresses && l.pickup_addresses.length > 0) {
      // Per-job breakdown row (from schedule manifests)
      l.pickup_addresses.forEach((pa, idx) => {
        const tankTypes = pa.tank_types || [];
        const tankDisplay = tankTypes.length > 0
          ? tankTypes.map(tt => esc(tt.type) + ' (' + (tt.volume || 0).toLocaleString() + ' gal)').join('<br>')
          : '—';
        const wasteDisplay = tankTypes.length > 0
          ? [...new Set(tankTypes.map(tt => tankTypeToWaste[tt.type] || 'Septage'))].join(', ')
          : esc(l.waste_type || '');
        const addrStr = esc(pa.address || '') + (pa.city ? ', ' + esc(pa.city) : '');
        rows += '<tr>';
        rows += '<td>' + (idx === 0 ? l.disposal_date : '') + '</td>';
        rows += '<td class="record-num">' + (idx === 0 ? esc(recordNum) : '') + '</td>';
        rows += '<td><strong>' + esc(pa.customer || '') + '</strong><br><span class="addr">' + addrStr + '</span></td>';
        rows += '<td>' + wasteDisplay + '</td>';
        rows += '<td>' + (idx === 0 ? esc(l.disposal_site || '') : '') + '</td>';
        rows += '<td>' + (idx === 0 ? truckLabel : '') + '</td>';
        rows += '<td>' + (idx === 0 ? esc(haulerID) : '') + '</td>';
        rows += '<td class="gallons">' + (pa.gallons || 0).toLocaleString() + ' gal</td>';
        rows += '</tr>';
      });
      // Subtotal row
      rows += '<tr class="subtotal">';
      rows += '<td colspan="7" style="text-align:right;font-size:9px;">Record ' + esc(recordNum) + ' Total</td>';
      rows += '<td class="gallons">' + totalVol.toLocaleString() + volUnit + '</td>';
      rows += '</tr>';
    } else {
      // Single-entry disposal (logged manually or outside pumper)
      const genAddr = esc(l.generator_address || l.pickup_address || '');
      const custName = esc(l.customer_names || l.customers?.name || '');
      rows += '<tr>';
      rows += '<td>' + l.disposal_date + '</td>';
      rows += '<td class="record-num">' + esc(recordNum) + '</td>';
      rows += '<td>' + (custName ? '<strong>' + custName + '</strong>' + (genAddr ? '<br>' : '') : '') + '<span class="addr">' + genAddr + '</span></td>';
      rows += '<td>' + esc(l.waste_type || '') + '</td>';
      rows += '<td>' + esc(l.disposal_site || '') + '</td>';
      rows += '<td>' + truckLabel + (op ? '<br><span style="font-size:8px;color:#e65100;font-weight:600;">OUTSIDE PUMPER</span>' : '') + '</td>';
      rows += '<td>' + esc(haulerID) + '</td>';
      rows += '<td class="gallons">' + totalVol.toLocaleString() + volUnit + '</td>';
      rows += '</tr>';
    }
  });

  return '<table><thead><tr>'
    + '<th>Date</th><th>Record #</th><th>Customer / Generator Address</th>'
    + '<th>Waste Type</th><th>Disposal Site</th>'
    + '<th>Vehicle / Hauler</th><th>Hauler ID</th><th style="text-align:right;">Volume</th>'
    + '</tr></thead><tbody>'
    + rows
    + '<tr style="background:#f0f4f8;font-weight:700;">'
    + '<td colspan="7" style="text-align:right;padding-right:12px;border-top:2px solid #1565c0;">TOTAL</td>'
    + '<td class="gallons" style="border-top:2px solid #1565c0;">' + totalGallons.toLocaleString() + ' gal</td>'
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
  const { data: outsidePumpers } = await window.api.getOutsidePumpers();
  const companyName = settings?.company_name || 'Interstate Septic Systems';
  const companyAddress = settings?.company_address || '';
  const companyPhone = settings?.company_phone || '';
  const haulerId = settings?.dep_hauler_id || '';
  const totalGallons = loads.reduce((s, l) => s + (l.volume_unit === 'yards' ? 0 : (l.volume_gallons || 0)), 0);

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
      .record-num { font-weight: 700; color: #1565c0; }
      .gallons { font-weight: 600; text-align: right; }
      .addr { font-size: 9px; color: #666; }
      .subtotal td { background: #f5f7fa; font-weight: 600; font-size: 9px; }
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

    ${buildDisposalTableHtml(loads, users, vehicles, wasteSites, totalGallons, outsidePumpers)}

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
    const pdfResult = await window.api.generatePdf(html, result.filePath, { skipDialog: true, forcePath: result.filePath });
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
  const { data: outsidePumpers } = await window.api.getOutsidePumpers();

  // Auto-generate a disposal number for new records
  let disposalNumber = l.disposal_number || '';
  if (!isEdit && !disposalNumber) {
    const { data: nextNum } = await window.api.getNextDisposalNumber();
    disposalNumber = String(nextNum);
  }

  // Build per-pumper history: { pumper_id: [{generator_address, customer_id}, ...] }
  const { data: allLoads } = await window.api.getDisposalLoads();
  const pumperHistory = {};
  allLoads.forEach(ld => {
    if (!ld.outside_pumper_id) return;
    const addr = ld.generator_address || ld.pickup_address || '';
    const custName = ld.customer_names || ld.customers?.name || '';
    if (!pumperHistory[ld.outside_pumper_id]) pumperHistory[ld.outside_pumper_id] = [];
    const existing = pumperHistory[ld.outside_pumper_id];
    // Track unique addresses (with associated customer name)
    if (addr && !existing.find(e => e.address === addr)) {
      existing.push({ address: addr, customer_name: custName });
    }
    // Track unique customer names separately for the customer datalist
    if (custName && !existing.find(e => e.customer_name === custName && !e.address)) {
      // Only add standalone name entry if not already covered by an address entry
    }
  });
  // Build a flat unique customer name list per pumper
  const pumperCustomerNames = {};
  allLoads.forEach(ld => {
    if (!ld.outside_pumper_id) return;
    const custName = ld.customer_names || ld.customers?.name || '';
    if (!custName) return;
    if (!pumperCustomerNames[ld.outside_pumper_id]) pumperCustomerNames[ld.outside_pumper_id] = new Set();
    pumperCustomerNames[ld.outside_pumper_id].add(custName);
  });
  // Convert sets to arrays for JSON serialization
  const pumperCustomerNamesJson = JSON.stringify(
    Object.fromEntries(Object.entries(pumperCustomerNames).map(([k, v]) => [k, [...v]]))
  ).replace(/"/g, '&quot;');
  const pumperHistoryJson = JSON.stringify(pumperHistory).replace(/"/g, '&quot;');

  // Determine if this load was from an outside pumper
  const hasOutsidePumper = !!l.outside_pumper_id;

  // Build outside pumper data as JSON for the auto-fill function
  const pumpersJson = JSON.stringify(outsidePumpers).replace(/"/g, '&quot;');

  openModal(isEdit ? 'Edit Disposal Load' : 'Log Disposal Load', `
    <input type="hidden" id="disposalId" value="${l.id || ''}">
    <input type="hidden" id="disposalOutsidePumperId" value="${l.outside_pumper_id || ''}">

    <!-- PUMPER SOURCE TOGGLE -->
    <div style="display:flex;gap:0;margin-bottom:16px;border:1px solid var(--border);border-radius:6px;overflow:hidden;">
      <button id="disposalSourceOwn" onclick="setDisposalSource('own')"
        style="flex:1;padding:9px;font-size:13px;font-weight:600;border:none;cursor:pointer;transition:background .15s;background:${hasOutsidePumper ? '#f5f5f5' : 'var(--primary)'};color:${hasOutsidePumper ? 'var(--text)' : '#fff'};">
        &#128666; Our Truck
      </button>
      <button id="disposalSourceOutside" onclick="setDisposalSource('outside')"
        style="flex:1;padding:9px;font-size:13px;font-weight:600;border:none;border-left:1px solid var(--border);cursor:pointer;transition:background .15s;background:${hasOutsidePumper ? 'var(--primary)' : '#f5f5f5'};color:${hasOutsidePumper ? '#fff' : 'var(--text)'};">
        &#128101; Outside Pumper
      </button>
    </div>

    <!-- OUR TRUCK FIELDS -->
    <div id="disposalOwnFields" style="${hasOutsidePumper ? 'display:none;' : ''}">
      <div class="form-row">
        <div class="form-group">
          <label>Vehicle</label>
          <select id="disposalVehicle">
            <option value="">-- Select --</option>
            ${vehicles.map(v => `<option value="${v.name}" ${v.name === l.vehicle ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Driver / Technician</label>
          <select id="disposalDriver">
            <option value="">-- Select --</option>
            ${users.map(u => `<option value="${u.id}" ${u.id === l.driver ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>

    <!-- OUTSIDE PUMPER FIELDS -->
    <div id="disposalOutsideFields" style="${hasOutsidePumper ? '' : 'display:none;'}">
      <div class="form-row">
        <div class="form-group" style="flex:2;">
          <label>Outside Pumper</label>
          <select id="disposalPumperSelect" data-pumpers="${pumpersJson}" data-history="${pumperHistoryJson}" data-customer-names="${pumperCustomerNamesJson}" onchange="onDisposalPumperChange()">
            <option value="">-- Select pumper --</option>
            ${outsidePumpers.map(p => `<option value="${p.id}" ${p.id === l.outside_pumper_id ? 'selected' : ''}>${esc(p.name)}${p.company ? ' — ' + esc(p.company) : ''}</option>`).join('')}
            <option value="__manual">Enter manually…</option>
          </select>
        </div>
        <div class="form-group" id="disposalPumperHaulerIdRow" style="flex:1;">
          <label>Hauler ID</label>
          <input type="text" id="disposalPumperHaulerId" value="${esc(l.pumper_hauler_id || '')}" placeholder="DEP License #">
        </div>
      </div>
      <!-- Manual entry row (shown when "Enter manually" selected) -->
      <div id="disposalPumperManualRow" style="display:none;">
        <div class="form-row">
          <div class="form-group">
            <label>Pumper Name / Company</label>
            <input type="text" id="disposalPumperManualName" value="${esc(l.pumper_name || '')}" placeholder="Company or driver name">
          </div>
          <div class="form-group">
            <label>Hauler ID (manual)</label>
            <input type="text" id="disposalPumperManualHaulerId" value="${esc(l.pumper_hauler_id || '')}" placeholder="DEP License #">
          </div>
        </div>
      </div>
      <!-- Pumper info display -->
      <div id="disposalPumperInfo" style="font-size:12px;color:var(--text-light);margin-bottom:8px;padding:6px 10px;background:#f5f5f5;border-radius:4px;${l.outside_pumper_id ? '' : 'display:none;'}">
        ${l.outside_pumper_id ? (() => {
          const op = outsidePumpers.find(p => p.id === l.outside_pumper_id);
          return op ? `${esc(op.company || op.name)} &bull; ${esc(op.phone || '')} &bull; Default: ${esc(op.default_waste_type || 'Septage')}` : '';
        })() : ''}
      </div>
    </div>

    <!-- SHARED FIELDS -->
    <div class="form-row">
      <div class="form-group">
        <label>Record #</label>
        <div style="font-size:16px;font-weight:700;color:var(--primary);padding:6px 0;">${esc(disposalNumber)}</div>
        <input type="hidden" id="disposalNumber" value="${esc(disposalNumber)}">
      </div>
      <div class="form-group">
        <label>Date *</label>
        <input type="date" id="disposalDate" value="${l.disposal_date || formatDate(new Date())}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Volume *</label>
        <div style="display:flex;gap:6px;align-items:center;">
          <input type="number" id="disposalVolume" value="${l.volume_gallons || l.volume_yards || ''}" min="0" step="0.1" placeholder="0" style="flex:1;">
          <select id="disposalUnit" style="width:100px;" onchange="document.getElementById('disposalVolumeLabel').textContent=this.options[this.selectedIndex].text;">
            <option value="gallons" ${(l.volume_unit || 'gallons') === 'gallons' ? 'selected' : ''}>Gallons</option>
            <option value="yards" ${l.volume_unit === 'yards' ? 'selected' : ''}>Cubic Yards</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Waste Type *</label>
        ${(() => {
          const known = ['Septage','Grease Trap','Holding Tank','Portable Toilet','Beer Waste','Treatment Plant','Other'];
          const isCustom = l.waste_type && !known.includes(l.waste_type);
          return `<select id="disposalWasteType" onchange="document.getElementById('disposalWasteCustomRow').style.display=this.value==='Other'?'':'none';">
            <option value="">-- Select --</option>
            <option value="Septage" ${l.waste_type === 'Septage' ? 'selected' : ''}>Septage</option>
            <option value="Grease Trap" ${l.waste_type === 'Grease Trap' ? 'selected' : ''}>Grease Trap</option>
            <option value="Holding Tank" ${l.waste_type === 'Holding Tank' ? 'selected' : ''}>Holding Tank</option>
            <option value="Portable Toilet" ${l.waste_type === 'Portable Toilet' ? 'selected' : ''}>Portable Toilet</option>
            <option value="Beer Waste" ${l.waste_type === 'Beer Waste' ? 'selected' : ''}>Beer Waste</option>
            <option value="Treatment Plant" ${l.waste_type === 'Treatment Plant' ? 'selected' : ''}>Treatment Plant</option>
            <option value="Other" ${l.waste_type === 'Other' || isCustom ? 'selected' : ''}>Other…</option>
          </select>
          <div id="disposalWasteCustomRow" style="margin-top:4px;${l.waste_type === 'Other' || isCustom ? '' : 'display:none;'}">
            <input type="text" id="disposalWasteCustom" value="${isCustom ? esc(l.waste_type) : ''}" placeholder="Describe the waste type">
          </div>`;
        })()}
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Disposal Site *</label>
        ${(() => {
          const defaultSite = wasteSites.find(s => s.is_default) || wasteSites[0];
          const selectedId = l.waste_site_id || (!isEdit && defaultSite ? defaultSite.id : '');
          const selectedName = l.disposal_site || (!isEdit && defaultSite ? defaultSite.name : '');
          const isCustom = selectedName && !wasteSites.find(s => s.id === selectedId || s.name === selectedName);
          return `<select id="disposalSiteSelect">
            <option value="">-- Select --</option>
            ${wasteSites.map(s => `<option value="${s.id}" data-name="${esc(s.name)}" data-address="${esc(s.address || '')}" ${s.id === selectedId ? 'selected' : (s.name === selectedName && !selectedId ? 'selected' : '')}>${esc(s.name)}</option>`).join('')}
            <option value="__custom" ${isCustom ? 'selected' : ''}>Other (type in)</option>
          </select>`;
        })()}
        <input type="text" id="disposalSiteCustom" value="${esc(l.disposal_site || '')}" placeholder="Site name" style="margin-top:4px;${l.disposal_site && !wasteSites.find(s => s.id === l.waste_site_id || s.name === l.disposal_site) ? '' : 'display:none;'}">
      </div>
      <div class="form-group">
        <label>Generator Address</label>
        <input type="text" id="disposalPickupAddress" list="disposalAddressHistory" value="${esc(l.pickup_address || l.generator_address || '')}" placeholder="Address where waste was generated" autocomplete="off">
        <datalist id="disposalAddressHistory"></datalist>
      </div>
    </div>
    <div class="form-group">
      <label>Customer Name</label>
      <input type="text" id="disposalCustomer" list="disposalCustomerHistory"
        value="${esc(l.customer_names || l.customers?.name || '')}"
        placeholder="Type customer or company name..."
        autocomplete="off">
      <datalist id="disposalCustomerHistory"></datalist>
    </div>
    <div class="form-group">
      <label>Notes</label>
      <textarea id="disposalNotes" placeholder="Additional notes...">${esc(l.notes || '')}</textarea>
    </div>
  `, `
    ${isEdit ? '<button class="btn btn-danger" onclick="deleteDisposalLoad()">Delete</button>' : ''}
    ${isEdit ? `<button class="btn btn-secondary" onclick="openDisposalDetail('${l.id}')" style="margin-right:auto;">&#8592; Back</button>` : ''}
    ${isEdit ? `<button class="btn btn-secondary" onclick="printDisposalRecord('${l.id}')">&#128438; Print</button>` : ''}
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

function setDisposalSource(source) {
  const ownBtn      = document.getElementById('disposalSourceOwn');
  const outsideBtn  = document.getElementById('disposalSourceOutside');
  const ownFields   = document.getElementById('disposalOwnFields');
  const outFields   = document.getElementById('disposalOutsideFields');
  const isOwn = source === 'own';
  ownBtn.style.background    = isOwn ? 'var(--primary)' : '#f5f5f5';
  ownBtn.style.color         = isOwn ? '#fff' : 'var(--text)';
  outsideBtn.style.background= isOwn ? '#f5f5f5' : 'var(--primary)';
  outsideBtn.style.color     = isOwn ? 'var(--text)' : '#fff';
  ownFields.style.display    = isOwn ? '' : 'none';
  outFields.style.display    = isOwn ? 'none' : '';
  if (isOwn) document.getElementById('disposalOutsidePumperId').value = '';
}

function onDisposalPumperChange() {
  const sel     = document.getElementById('disposalPumperSelect');
  const val     = sel.value;
  const manualRow = document.getElementById('disposalPumperManualRow');
  const infoDiv   = document.getElementById('disposalPumperInfo');
  const hauleEl   = document.getElementById('disposalPumperHaulerId');
  const pumperId  = document.getElementById('disposalOutsidePumperId');

  const haulerRow = document.getElementById('disposalPumperHaulerIdRow');
  if (val === '__manual') {
    manualRow.style.display = '';
    infoDiv.style.display   = 'none';
    if (haulerRow) haulerRow.style.display = 'none';
    hauleEl.value = '';
    pumperId.value = '';
    return;
  }
  manualRow.style.display = 'none';
  if (haulerRow) haulerRow.style.display = '';
  hauleEl.readOnly = false;
  hauleEl.style.background = '';

  if (!val) {
    infoDiv.style.display = 'none';
    pumperId.value = '';
    // Clear datalist
    const dl = document.getElementById('disposalAddressHistory');
    if (dl) dl.innerHTML = '';
    return;
  }

  // Find the pumper from the select's data attribute
  const allPumpers = JSON.parse(sel.dataset.pumpers.replace(/&quot;/g, '"'));
  const p = allPumpers.find(x => x.id === val);
  if (!p) return;

  pumperId.value  = p.id;
  hauleEl.value   = p.hauler_id || '';

  infoDiv.style.display = '';
  infoDiv.innerHTML = `${esc(p.company || p.name)}${p.phone ? ' &bull; ' + esc(p.phone) : ''}${p.hauler_id ? ' &bull; Hauler ID: <strong>' + esc(p.hauler_id) + '</strong>' : ''}`;

  // Populate address history datalist for this pumper
  const history = JSON.parse(sel.dataset.history.replace(/&quot;/g, '"'));
  const pumperAddrs = history[val] || [];
  const dl = document.getElementById('disposalAddressHistory');
  if (dl) {
    dl.innerHTML = pumperAddrs.map(e => `<option value="${esc(e.address)}">`).join('');
  }

  // Populate customer name datalist for this pumper
  const custNames = JSON.parse(sel.dataset.customerNames.replace(/&quot;/g, '"'));
  const pumperCustList = custNames[val] || [];
  const custDl = document.getElementById('disposalCustomerHistory');
  if (custDl) {
    custDl.innerHTML = pumperCustList.map(n => `<option value="${esc(n)}">`).join('');
  }

  // When user picks an address from the datalist, auto-fill customer name if we have a match
  const addrInput = document.getElementById('disposalPickupAddress');
  if (addrInput && !addrInput._historyWired) {
    addrInput._historyWired = true;
    addrInput.addEventListener('change', () => {
      const matched = pumperAddrs.find(e => e.address === addrInput.value);
      if (matched?.customer_name) {
        const custInput = document.getElementById('disposalCustomer');
        if (custInput && !custInput.value) custInput.value = matched.customer_name;
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

  // Determine pumper source (own truck vs outside pumper)
  const outsidePumperId = document.getElementById('disposalOutsidePumperId')?.value || '';
  const pumperSel       = document.getElementById('disposalPumperSelect');
  const isManualPumper  = pumperSel?.value === '__manual';

  let pumperName     = '';
  let pumperHaulerId = '';
  if (outsidePumperId) {
    pumperHaulerId = document.getElementById('disposalPumperHaulerId')?.value || '';
  } else if (isManualPumper) {
    pumperName     = document.getElementById('disposalPumperManualName')?.value.trim() || '';
    pumperHaulerId = document.getElementById('disposalPumperManualHaulerId')?.value.trim() || '';
  }

  const unit = document.getElementById('disposalUnit')?.value || 'gallons';
  const rawVolume = parseFloat(document.getElementById('disposalVolume').value) || 0;
  const rawWasteType = document.getElementById('disposalWasteType').value;
  const knownTypes = ['Septage','Grease Trap','Holding Tank','Portable Toilet','Beer Waste','Treatment Plant'];
  const wasteType = (rawWasteType === 'Other' || !knownTypes.includes(rawWasteType))
    ? (document.getElementById('disposalWasteCustom')?.value.trim() || rawWasteType || 'Other')
    : rawWasteType;

  const data = {
    disposal_date: document.getElementById('disposalDate').value,
    volume_gallons: unit === 'gallons' ? rawVolume : 0,
    volume_yards: unit === 'yards' ? rawVolume : 0,
    volume_unit: unit,
    waste_type: wasteType,
    disposal_site: siteName,
    waste_site_id: siteId,
    waste_site_address: siteAddress,
    disposal_number: document.getElementById('disposalNumber').value,
    customer_names: document.getElementById('disposalCustomer')?.value?.trim() || '',
    generator_address: document.getElementById('disposalPickupAddress')?.value?.trim() || '',
    pickup_address: document.getElementById('disposalPickupAddress')?.value?.trim() || '',
    notes: document.getElementById('disposalNotes').value.trim(),
    // Own truck fields (may be empty for outside pumper jobs)
    vehicle: document.getElementById('disposalVehicle')?.value || '',
    driver: document.getElementById('disposalDriver')?.value || null,
    // Outside pumper fields
    outside_pumper_id: outsidePumperId || null,
    pumper_name: pumperName,
    pumper_hauler_id: pumperHaulerId,
  };

  const id = document.getElementById('disposalId').value;
  if (id) data.id = id;

  const totalVolume = data.volume_gallons || data.volume_yards || 0;
  if (!data.disposal_date || !totalVolume || !data.waste_type || !data.disposal_site) {
    showToast('Date, volume, waste type, and disposal site are required.', 'error');
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

  // Look up the disposal to find its manifest number before deleting
  const { data: loads } = await window.api.getDisposalLoads();
  const disposal = (loads || []).find(d => d.id === id);
  const mNum = disposal?.manifest_number ? String(disposal.manifest_number) : null;

  await window.api.deleteDisposalLoad(id);

  if (mNum) {
    // Delete the matching manifest schedule item
    const { data: allItems } = await window.api.getScheduleItems();
    const manifestItem = (allItems || []).find(i => i.item_type === 'manifest' && String(i.manifest_number) === mNum);
    if (manifestItem) {
      await window.api.deleteScheduleItem(manifestItem.id);
    }
    // Un-stamp jobs that were stamped by this manifest
    const { data: allJobs } = await window.api.getJobs({});
    const stamped = (allJobs || []).filter(j => String(j.manifest_number) === mNum);
    for (const j of stamped) {
      await window.api.saveJob({ id: j.id, manifest_number: null, status: 'scheduled', completed_at: null });
    }
  }

  closeModal();
  showToast('Disposal deleted.', 'success');
  loadDisposal();
}

async function openDisposalDetail(id) {
  const loads = (await window.api.getDisposalLoads()).data;
  const l = loads.find(x => x.id === id);
  if (!l) return;

  const { data: settings } = await window.api.getSettings();
  const { data: wasteSites } = await window.api.getWasteSites();
  const { data: users } = await window.api.getUsers();
  const { data: outsidePumpers } = await window.api.getOutsidePumpers();
  const { data: allCustomers } = await window.api.getCustomers();

  const site = wasteSites.find(s => s.id === l.waste_site_id);
  const driver = users.find(u => u.id === l.driver);
  const pumper = outsidePumpers.find(p => p.id === l.outside_pumper_id);
  const customer = allCustomers.find(c => c.id === l.customer_id);

  const isOutside = !!l.outside_pumper_id;
  const recordNum = l.disposal_number || l.manifest_number || '—';
  const vol = l.volume_unit === 'yards'
    ? `${(l.volume_yards || 0).toLocaleString()} cu yd`
    : `${(l.volume_gallons || 0).toLocaleString()} gal`;

  function field(label, value) {
    return `<div class="dv-field"><div class="dv-label">${label}</div><div class="dv-value">${value || '<span style="color:#bbb;">—</span>'}</div></div>`;
  }

  const body = `
    <style>
      .dv-card { display:flex; flex-direction:column; gap:18px; }
      .dv-section { background:#f8f9fa; border:1px solid #e5e7eb; border-radius:8px; padding:14px 16px; }
      .dv-section-title { font-size:10px; font-weight:700; letter-spacing:.6px; text-transform:uppercase; color:#888; margin-bottom:12px; }
      .dv-row { display:flex; flex-wrap:wrap; gap:12px; }
      .dv-field { flex:1; min-width:120px; }
      .dv-label { font-size:10px; text-transform:uppercase; letter-spacing:.4px; color:#999; margin-bottom:3px; }
      .dv-value { font-size:13px; font-weight:600; color:#1a1a1a; }
      .dv-badge { display:inline-block; padding:3px 10px; border-radius:10px; font-size:11px; font-weight:700; background:#e3f2fd; color:#1565c0; }
      .dv-vol { font-size:20px; font-weight:700; color:#1a56a0; }
    </style>
    <div class="dv-card">
      <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:12px;border-bottom:1px solid #eee;">
        <div>
          <div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:.5px;">Record</div>
          <div style="font-size:22px;font-weight:700;color:#1a56a0;">#${esc(recordNum)}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:13px;color:#555;">${esc(l.disposal_date || '')}</div>
          ${isOutside ? '<div style="margin-top:4px;"><span class="dv-badge">🚛 Outside Pumper</span></div>' : ''}
        </div>
      </div>

      <div class="dv-section">
        <div class="dv-section-title">${isOutside ? 'Outside Hauler' : 'Hauler / Vehicle'}</div>
        <div class="dv-row">
          ${isOutside ? `
            ${field('Name', esc(pumper?.name || l.pumper_name || ''))}
            ${field('Company', esc(pumper?.company || ''))}
            ${field('DEP Hauler ID', esc(pumper?.hauler_id || l.pumper_hauler_id || ''))}
            ${field('Phone', esc(pumper?.phone || ''))}
          ` : `
            ${field('Vehicle', esc(l.vehicle || ''))}
            ${field('Technician', esc(driver?.name || ''))}
          `}
        </div>
      </div>

      <div class="dv-section">
        <div class="dv-section-title">Waste Details</div>
        <div class="dv-row">
          <div class="dv-field"><div class="dv-label">Volume</div><div class="dv-vol">${esc(vol)}</div></div>
          ${field('Waste Type', esc(l.waste_type || ''))}
          ${field('Customer', esc(customer?.name || l.customer_names || ''))}
        </div>
        ${l.generator_address || l.pickup_address ? `<div style="margin-top:10px;">${field('Generator Address', esc(l.generator_address || l.pickup_address || ''))}</div>` : ''}
      </div>

      <div class="dv-section">
        <div class="dv-section-title">Disposal Site</div>
        <div class="dv-row">
          ${field('Facility', esc(l.disposal_site || site?.name || ''))}
          ${field('Address', esc(site?.address || l.waste_site_address || ''))}
          ${field('State License', esc(site?.state_license || l.waste_site_license || ''))}
        </div>
      </div>

      ${l.notes ? `<div class="dv-section"><div class="dv-section-title">Notes</div><div style="font-size:13px;color:#333;">${esc(l.notes)}</div></div>` : ''}
    </div>`;

  const footer = `
    <button class="btn btn-danger" onclick="deleteDisposalFromDetail('${l.id}')" style="margin-right:auto;">Delete</button>
    <button class="btn btn-secondary" onclick="closeModal();setTimeout(()=>openDisposalModal(window.__disposalDetailLoad),50)">Edit</button>
    <button class="btn" style="background:#f59e0b;color:#fff;border-color:#f59e0b;" onclick="closeModal();printDisposalRecord('${l.id}')">&#128196; Export PDF</button>
    <button class="btn btn-secondary" onclick="closeModal()">Close</button>`;

  window.__disposalDetailLoad = l;
  openModal(`Disposal Record #${recordNum}`, body, footer);
}

async function deleteDisposalFromDetail(id) {
  if (!confirm('Delete this disposal record?')) return;
  await window.api.deleteDisposalLoad(id);
  closeModal();
  showToast('Disposal deleted.', 'success');
  loadDisposal();
}

async function printDisposalRecord(id) {
  const loads = (await window.api.getDisposalLoads()).data;
  const l = loads.find(x => x.id === id);
  if (!l) return;

  const { data: settings } = await window.api.getSettings();
  const { data: wasteSites } = await window.api.getWasteSites();
  const { data: users } = await window.api.getUsers();
  const { data: outsidePumpers } = await window.api.getOutsidePumpers();

  const company = settings?.company_name || 'Interstate Septic Systems';
  const compAddr = settings?.company_address || '';
  const compPhone = settings?.company_phone || '';
  const haulerId = settings?.dep_hauler_id || '';

  const site = wasteSites.find(s => s.id === l.waste_site_id);
  const driver = users.find(u => u.id === l.driver);
  const pumper = outsidePumpers.find(p => p.id === l.outside_pumper_id);
  const { data: allCustomers } = await window.api.getCustomers();
  const customer = allCustomers.find(c => c.id === l.customer_id);

  const recordNum = l.disposal_number || l.manifest_number || '—';
  const isOutside = !!l.outside_pumper_id;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Disposal Record #${recordNum}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 13px; color: #222; padding: 32px; }
    h1 { font-size: 22px; margin-bottom: 2px; }
    h2 { font-size: 14px; font-weight: 600; margin-bottom: 10px; color: #555; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; border-bottom: 2px solid #222; padding-bottom: 16px; }
    .record-num { font-size: 20px; font-weight: 700; color: #1a56a0; }
    .section { margin-bottom: 20px; }
    .section-title { font-size: 11px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: #333; border-bottom: 1px solid #bbb; padding-bottom: 4px; margin-bottom: 10px; }
    .row { display: flex; gap: 24px; margin-bottom: 8px; }
    .field { flex: 1; }
    .label { font-size: 10px; text-transform: uppercase; letter-spacing: .4px; color: #888; margin-bottom: 2px; }
    .value { font-size: 13px; font-weight: 600; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 700; background: #e3f2fd; color: #1565c0; }
    .footer { margin-top: 40px; font-size: 10px; color: #aaa; border-top: 1px solid #eee; padding-top: 8px; }
    @media print { body { padding: 16px; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${esc(company)}</h1>
      <div style="font-size:12px;color:#555;">${esc(compAddr)}${compAddr && compPhone ? ' &bull; ' : ''}${esc(compPhone)}</div>
      ${haulerId ? `<div style="font-size:12px;margin-top:2px;">DEP Hauler ID: <strong>${esc(haulerId)}</strong></div>` : ''}
    </div>
    <div style="text-align:right;">
      <div class="record-num">Record #${esc(recordNum)}</div>
      <h2 style="margin-top:4px;">Waste Disposal Record</h2>
    </div>
  </div>

  <div class="section">
    <div class="section-title">${isOutside ? 'Outside Hauler' : 'Hauler'}</div>
    ${isOutside ? `
      <div class="row">
        <div class="field"><div class="label">Company / Name</div><div class="value">${esc([pumper?.name, pumper?.company].filter(Boolean).join(' — ') || l.pumper_name || '—')}</div></div>
        <div class="field"><div class="label">DEP Hauler ID</div><div class="value">${esc(pumper?.hauler_id || l.pumper_hauler_id || '—')}</div></div>
        <div class="field"><div class="label">Phone</div><div class="value">${esc(pumper?.phone || '—')}</div></div>
        <div class="field"><div class="label">Date</div><div class="value">${esc(l.disposal_date || '—')}</div></div>
      </div>
    ` : `
      <div class="row">
        <div class="field"><div class="label">Vehicle</div><div class="value">${esc(l.vehicle || '—')}</div></div>
        <div class="field"><div class="label">Technician</div><div class="value">${esc(driver?.name || '—')}</div></div>
        <div class="field"><div class="label">Our Hauler ID</div><div class="value">${esc(haulerId || '—')}</div></div>
        <div class="field"><div class="label">Date</div><div class="value">${esc(l.disposal_date || '—')}</div></div>
      </div>
    `}
  </div>

  <div class="section">
    <div class="section-title">Waste Details</div>
    <div class="row">
      <div class="field"><div class="label">Waste Type</div><div class="value">${esc(l.waste_type || '—')}</div></div>
      <div class="field"><div class="label">Volume</div><div class="value" style="font-size:18px;">${l.volume_unit === 'yards' ? `${(l.volume_yards||0).toLocaleString()} cu yd` : `${(l.volume_gallons||0).toLocaleString()} gal`}</div></div>
      <div class="field"><div class="label">Customer</div><div class="value">${esc(customer?.name || l.customer_names || '—')}</div></div>
      <div class="field"><div class="label">Generator Address</div><div class="value">${esc(l.generator_address || l.pickup_address || '—')}</div></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Disposal Site</div>
    <div class="row">
      <div class="field"><div class="label">Facility Name</div><div class="value">${esc(l.disposal_site || site?.name || '—')}</div></div>
      <div class="field"><div class="label">Facility Address</div><div class="value">${esc(site?.address || l.waste_site_address || '—')}</div></div>
      <div class="field"><div class="label">State License</div><div class="value">${esc(site?.state_license || l.waste_site_license || '—')}</div></div>
    </div>
  </div>

  ${l.notes ? `<div class="section"><div class="section-title">Notes</div><div>${esc(l.notes)}</div></div>` : ''}


  <div class="footer">
    Printed ${new Date().toLocaleString()} &bull; ${esc(company)} &bull; Record #${esc(recordNum)}
  </div>

</body>
</html>`;

  const filename = `Disposal_Record_${recordNum}_${l.disposal_date || 'undated'}.pdf`;
  const result = await window.api.generatePdf(html, filename);
  if (result?.success) {
    showToast('PDF saved.', 'success');
    window.api.openFile(result.path);
  }
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
let sdnFilters = { page: 1, perPage: 35, status: '', serviceType: '', dueDateFrom: '', dueDateTo: '', search: '', _preset: 'All Time', sortBy: 'due_date', sortDir: 'asc' };
let selectedSdnIds = new Set();

async function loadServiceDueNotices() {
  const page = document.getElementById('page-sdn');
  const filters = {};
  if (sdnFilters.status) filters.status = sdnFilters.status;
  if (sdnFilters.serviceType) filters.serviceType = sdnFilters.serviceType;
  if (sdnFilters.dueDateFrom) filters.dueDateFrom = sdnFilters.dueDateFrom;
  if (sdnFilters.dueDateTo) filters.dueDateTo = sdnFilters.dueDateTo;
  if (sdnFilters.search) filters.search = sdnFilters.search;

  const { data: allNotices } = await window.api.getServiceDueNotices(filters);
  const today = new Date().toISOString().split('T')[0];
  const thisMonthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().split('T')[0];

  // Stats (always computed on full result set before pagination)
  const totalCount = allNotices.length;
  const overdueCount = allNotices.filter(n => n.is_overdue).length;
  const dueThisMonth = allNotices.filter(n => n.status === 'pending' && n.due_date && n.due_date >= today && n.due_date <= thisMonthEnd).length;
  const sentCount = allNotices.filter(n => n.status === 'sent').length;

  // Unique service types for filter dropdown
  const serviceTypes = [...new Set(allNotices.map(n => n.service_type).filter(Boolean))].sort();

  // Client-side sort (overrides backend default)
  const sb = sdnFilters.sortBy;
  const sd = sdnFilters.sortDir === 'asc' ? 1 : -1;
  allNotices.sort((a, b) => {
    let av, bv;
    if (sb === 'customer') { av = a.customer?.name || ''; bv = b.customer?.name || ''; }
    else if (sb === 'service_type') { av = a.service_type || ''; bv = b.service_type || ''; }
    else if (sb === 'days') { av = a.days_until_due ?? 99999; bv = b.days_until_due ?? 99999; return (av - bv) * sd; }
    else if (sb === 'status') { av = a.is_overdue ? 'overdue' : (a.status || ''); bv = b.is_overdue ? 'overdue' : (b.status || ''); }
    else { av = a.due_date || ''; bv = b.due_date || ''; } // default: due_date
    return av.localeCompare(bv) * sd;
  });

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

        <label class="inv-filter-label">Service Type</label>
        <select class="inv-filter-select" onchange="sdnFilters.serviceType=this.value;sdnFilters.page=1;loadServiceDueNotices()">
          <option value="">All Types</option>
          ${serviceTypes.map(t => `<option value="${esc(t)}" ${sdnFilters.serviceType === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
        </select>

        <label class="inv-filter-label">Sort By</label>
        <div style="display:flex;gap:4px;">
          <select class="inv-filter-select" style="flex:1;" onchange="sdnFilters.sortBy=this.value;sdnFilters.page=1;loadServiceDueNotices()">
            <option value="due_date" ${sdnFilters.sortBy==='due_date'?'selected':''}>Due Date</option>
            <option value="customer" ${sdnFilters.sortBy==='customer'?'selected':''}>Customer</option>
            <option value="service_type" ${sdnFilters.sortBy==='service_type'?'selected':''}>Service Type</option>
            <option value="days" ${sdnFilters.sortBy==='days'?'selected':''}>Days Until Due</option>
            <option value="status" ${sdnFilters.sortBy==='status'?'selected':''}>Status</option>
          </select>
          <button class="btn btn-secondary btn-sm" style="padding:3px 8px;font-size:13px;" title="Toggle direction" onclick="sdnFilters.sortDir=sdnFilters.sortDir==='asc'?'desc':'asc';loadServiceDueNotices()">${sdnFilters.sortDir==='asc'?'↑':'↓'}</button>
        </div>

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
                ${['customer','property','service_type','due_date','days','status'].map((col,i) => {
                  const labels = ['Customer','Property','Service Type','Due Date','Days','Status'];
                  const sortable = col !== 'property';
                  const active = sdnFilters.sortBy === col;
                  const arrow = active ? (sdnFilters.sortDir === 'asc' ? ' ↑' : ' ↓') : '';
                  return `<th style="cursor:${sortable?'pointer':'default'};user-select:none;${active?'color:#ffeb3b;':''}" ${sortable?`onclick="sdnSetSort('${col}')"`:''} title="${sortable?'Click to sort':''}">${labels[i]}${arrow}</th>`;
                }).join('')}
              </tr>
            </thead>
            <tbody>
              ${notices.length === 0 ? '<tr><td colspan="8" style="text-align:center;color:var(--text-light);padding:40px;">No service due notices found.</td></tr>' : ''}
              ${notices.map((n, idx) => {
                const rowNum = startIdx + idx + 1;
                const rowClass = n.is_overdue ? 'sdn-overdue-row' : (n.days_until_due !== null && n.days_until_due <= 30 && n.days_until_due >= 0 && n.status === 'pending') ? 'sdn-due-soon-row' : '';
                const statusColors = { pending: '#ff9800', sent: '#2196f3', overdue: '#f44336', completed: '#4caf50', dismissed: '#9e9e9e', confirmed: '#43a047' };
                const statusColor = n.status === 'confirmed' ? '#43a047' : n.is_overdue ? '#f44336' : n.status === 'pending' ? (n.email_enabled !== false ? '#388e3c' : '#9e9e9e') : (statusColors[n.status] || '#999');
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

function sdnSetSort(col) {
  if (sdnFilters.sortBy === col) {
    sdnFilters.sortDir = sdnFilters.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    sdnFilters.sortBy = col;
    sdnFilters.sortDir = 'asc';
  }
  sdnFilters.page = 1;
  loadServiceDueNotices();
}

function sdnClearFilters() {
  sdnFilters = { page: 1, perPage: 35, status: '', serviceType: '', dueDateFrom: '', dueDateTo: '', search: '', _preset: 'All Time', sortBy: 'due_date', sortDir: 'asc' };
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
let reportTab = 'revenue'; // revenue | ar | city | statements | pl
let reportCompareMode = 'none'; // none | prior | yoy | custom
let reportCompareFrom = '';
let reportCompareTo = '';
let arSortBy = 'total'; // name | city | current | d30 | d60 | d90 | total | oldest
let arSortDir = 'desc'; // asc | desc
let arSearchTerm = '';
function setArSort(col) {
  if (arSortBy === col) { arSortDir = arSortDir === 'desc' ? 'asc' : 'desc'; }
  else { arSortBy = col; arSortDir = (col === 'name' || col === 'city') ? 'asc' : 'desc'; }
  loadReports();
}
function filterArTable(term) {
  arSearchTerm = (term || '').toLowerCase().trim();
  const rows = document.querySelectorAll('#ar-tbody .ar-row');
  let shown = 0;
  rows.forEach(tr => {
    const hay = tr.getAttribute('data-search') || '';
    const match = !arSearchTerm || hay.includes(arSearchTerm);
    tr.style.display = match ? '' : 'none';
    if (match) shown++;
  });
  const countEl = document.getElementById('ar-search-count');
  if (countEl) countEl.textContent = arSearchTerm ? `${shown} of ${rows.length} customers` : `${rows.length} customers`;
}

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

  // Load all data
  const { data: allInvoices } = await window.api.getInvoices({});
  const { data: allJobs } = await window.api.getJobs({});
  const { data: categories } = await window.api.getServiceCategories();
  const { data: vehicles } = await window.api.getVehicles();
  const { data: arRows, totals: arTotals, deltas: arDeltas, delta7: arDelta7, collection: arCollection, collectionHistory: arCollectionHistory } = await window.api.getArReport();

  // Filter invoices by date range — match TankTrack's report behavior:
  // exclude cancelled, require complete (TT: "only includes data from Invoices marked Complete")
  const invoices = allInvoices.filter(inv => {
    const d = inv.svc_date || inv.created_at?.split('T')[0] || '';
    if (d < reportDateFrom || d > reportDateTo) return false;
    if (inv.cancelled === true) return false;
    if (inv.complete !== true) return false;
    return true;
  });

  // Filter jobs by date range
  const jobs = allJobs.filter(j => {
    const d = j.scheduled_date || '';
    return d >= reportDateFrom && d <= reportDateTo;
  });

  // Revenue by service type
  const serviceRevenue = {};
  invoices.forEach(inv => {
    if (inv.line_items && Array.isArray(inv.line_items) && inv.line_items.length) {
      inv.line_items.forEach(li => {
        const name = li.description || li.name || 'Other';
        if (!serviceRevenue[name]) serviceRevenue[name] = { qty: 0, revenue: 0 };
        serviceRevenue[name].qty += (li.quantity || 1);
        serviceRevenue[name].revenue += (li.amount || li.total || 0);
      });
    } else {
      // TankTrack-imported: parse comma-separated Products/Services + Quantity + Unit Cost
      const ps = String(inv.products_services || '').split(',').map(s => s.trim()).filter(Boolean);
      const qs = String(inv.quantity || '').split(',').map(s => parseFloat(s.trim()) || 0);
      const ucs = String(inv.unit_cost || '').split(',').map(s => parseFloat(s.trim()) || 0);
      if (ps.length) {
        ps.forEach((name, i) => {
          const q = qs[i] || 1;
          const uc = ucs[i] || 0;
          if (!serviceRevenue[name]) serviceRevenue[name] = { qty: 0, revenue: 0 };
          serviceRevenue[name].qty += q;
          serviceRevenue[name].revenue += q * uc;
        });
      } else {
        const name = inv.service_type || inv.job_type || 'Pumping';
        if (!serviceRevenue[name]) serviceRevenue[name] = { qty: 0, revenue: 0 };
        serviceRevenue[name].qty += 1;
        serviceRevenue[name].revenue += (inv.total || inv.amount || 0);
      }
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
    const truck = inv.vehicle_name || inv.truck || 'Unassigned';
    if (!truckRevenue[truck]) truckRevenue[truck] = { jobs: 0, revenue: 0, gallons: 0 };
    truckRevenue[truck].jobs += 1;
    truckRevenue[truck].revenue += (inv.total || inv.amount || 0);
    truckRevenue[truck].gallons += (inv.gallons_pumped_total || inv.gallons_pumped || 0);
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
  const totalPaid = invoices.reduce((sum, inv) => sum + (inv.amount_paid || 0), 0);
  const totalOutstanding = Math.max(0, totalRevenue - totalPaid);
  const totalJobs = invoices.length;
  const totalGallons = invoices.reduce((sum, inv) => sum + (inv.gallons_pumped_total || inv.gallons_pumped || 0), 0);
  const avgPerJob = invoices.length > 0 ? totalRevenue / invoices.length : 0;

  // === Comparison period ===
  function shiftDate(dStr, days) {
    const d = new Date(dStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return formatDate(d);
  }
  function shiftYear(dStr, years) {
    const d = new Date(dStr + 'T00:00:00');
    d.setFullYear(d.getFullYear() + years);
    return formatDate(d);
  }
  let cmpFrom = '', cmpTo = '';
  if (reportCompareMode === 'prior') {
    const from = new Date(reportDateFrom + 'T00:00:00');
    const to = new Date(reportDateTo + 'T00:00:00');
    const span = Math.round((to - from) / 86400000);
    cmpTo = shiftDate(reportDateFrom, -1);
    cmpFrom = shiftDate(cmpTo, -span);
  } else if (reportCompareMode === 'yoy') {
    cmpFrom = shiftYear(reportDateFrom, -1);
    cmpTo = shiftYear(reportDateTo, -1);
  } else if (reportCompareMode === 'custom' && reportCompareFrom && reportCompareTo) {
    cmpFrom = reportCompareFrom;
    cmpTo = reportCompareTo;
  }
  const cmpInvoices = (cmpFrom && cmpTo) ? allInvoices.filter(inv => {
    const d = inv.svc_date || inv.created_at?.split('T')[0] || '';
    if (d < cmpFrom || d > cmpTo) return false;
    if (inv.cancelled === true) return false;
    if (inv.complete !== true) return false;
    return true;
  }) : [];
  const cmpTotalRevenue = cmpInvoices.reduce((s, i) => s + (i.total || i.amount || 0), 0);
  const cmpTotalJobs = cmpInvoices.length;
  const cmpTotalGallons = cmpInvoices.reduce((s, i) => s + (i.gallons_pumped_total || i.gallons_pumped || 0), 0);
  const cmpAvgPerJob = cmpTotalJobs > 0 ? cmpTotalRevenue / cmpTotalJobs : 0;
  const hasCmp = cmpFrom && cmpTo;
  function fmtCmpVal(v, isMoney, isInt) {
    if (isMoney) return '$' + (v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (isInt) return (v || 0).toLocaleString();
    return (v || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  function deltaBadge(curr, prev, opts = {}) {
    if (!hasCmp) return '';
    const { money = false, int = false } = opts;
    const prevStr = fmtCmpVal(prev, money, int);
    if (!prev) {
      return `<div style="font-size:11px;color:var(--text-light);margin-top:4px;">Prior: ${prevStr}</div>`;
    }
    const pct = ((curr - prev) / Math.abs(prev)) * 100;
    const up = pct >= 0;
    const color = up ? '#4caf50' : '#e74c3c';
    return `<div style="font-size:11px;color:${color};margin-top:4px;">${up?'▲':'▼'} ${Math.abs(pct).toFixed(1)}% — prior ${prevStr}</div>`;
  }
  function fmtRangeLabel(from, to) {
    const f = d => {
      const [y, m, day] = d.split('-');
      return `${parseInt(m)}/${parseInt(day)}/${y}`;
    };
    return `${f(from)} – ${f(to)}`;
  }

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
  // Last week (prev Mon - prev Sun)
  const lastMon = new Date(mon); lastMon.setDate(mon.getDate() - 7);
  const lastSun = new Date(mon); lastSun.setDate(mon.getDate() - 1);
  const lastWeekStart = formatDate(lastMon);
  const lastWeekEnd = formatDate(lastSun);

  // Revenue by city — respects the selected date range (same filter as Revenue tab)
  const cityRevenue = {};
  invoices.forEach(inv => {
    const city = inv.property_city || inv.billing_city || inv.customers?.city || 'Unknown';
    if (!cityRevenue[city]) cityRevenue[city] = { jobs: 0, revenue: 0, gallons: 0 };
    cityRevenue[city].jobs += 1;
    cityRevenue[city].revenue += (inv.total || inv.amount || 0);
    cityRevenue[city].gallons += (inv.gallons_pumped_total || inv.gallons_pumped || 0);
  });
  const sortedCities = Object.entries(cityRevenue).sort((a, b) => b[1].revenue - a[1].revenue);

  // Max bar width for chart
  const maxDailyRev = dailyDates.length > 0 ? Math.max(...dailyDates.map(d => dailyRevenue[d])) : 1;
  const maxServiceRev = sortedServices.length > 0 ? sortedServices[0][1].revenue : 1;
  const maxCityRev = sortedCities.length > 0 ? sortedCities[0][1].revenue : 1;

  page.innerHTML = `
    <!-- Tab Bar -->
    <div style="display:flex;gap:0;border-bottom:2px solid var(--border);margin-bottom:20px;">
      ${[['revenue','Revenue'],['ar','Accounts Receivable'],['city','By City'],['pl','P&L']].map(([key,label]) =>
        `<button onclick="reportTab='${key}';loadReports()" style="padding:10px 22px;border:none;background:${reportTab===key?'var(--surface-subtle)':'none'};cursor:pointer;font-size:13px;font-weight:${reportTab===key?'700':'500'};color:${reportTab===key?'var(--primary)':'var(--text)'};border-bottom:${reportTab===key?'3px solid var(--primary)':'3px solid transparent'};margin-bottom:-2px;border-radius:6px 6px 0 0;">${label}</button>`
      ).join('')}
    </div>

    ${(reportTab === 'revenue' || reportTab === 'city') ? `
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:20px;flex-wrap:wrap;">
      <div style="display:flex;gap:6px;">
        <button class="btn btn-sm ${reportDateFrom === thisWeekStart && reportDateTo === todayStr ? 'btn-primary' : 'btn-secondary'}" onclick="setReportPeriod('${thisWeekStart}','${todayStr}')">This Week</button>
        <button class="btn btn-sm ${reportDateFrom === lastWeekStart && reportDateTo === lastWeekEnd ? 'btn-primary' : 'btn-secondary'}" onclick="setReportPeriod('${lastWeekStart}','${lastWeekEnd}')">Last Week</button>
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
    <div class="card" style="padding:12px 14px;margin-bottom:20px;display:flex;flex-direction:column;gap:10px;">
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;">
        <label style="font-size:13px;color:var(--text-light);font-weight:600;">Compare to:</label>
        <select onchange="reportCompareMode=this.value;loadReports();" style="padding:4px 8px;">
          <option value="none" ${reportCompareMode==='none'?'selected':''}>None</option>
          <option value="prior" ${reportCompareMode==='prior'?'selected':''}>Prior period (same length)</option>
          <option value="yoy" ${reportCompareMode==='yoy'?'selected':''}>Same period last year</option>
          <option value="custom" ${reportCompareMode==='custom'?'selected':''}>Custom date range</option>
        </select>
        <div style="display:flex;gap:4px;flex-wrap:wrap;">
          <button class="btn btn-sm btn-secondary" onclick="setComparePreset('week_prior')">Week vs Last Week</button>
          <button class="btn btn-sm btn-secondary" onclick="setComparePreset('month_prior')">Month vs Prior</button>
          <button class="btn btn-sm btn-secondary" onclick="setComparePreset('month_yoy')">Month vs YoY</button>
          <button class="btn btn-sm btn-secondary" onclick="setComparePreset('quarter_prior')">Quarter vs Prior</button>
          <button class="btn btn-sm btn-secondary" onclick="setComparePreset('quarter_yoy')">Quarter vs YoY</button>
          <button class="btn btn-sm ${reportCompareMode==='custom'?'btn-primary':'btn-secondary'}" onclick="setComparePreset('custom')" title="Compare any custom date range to another">Custom Range</button>
        </div>
        ${hasCmp ? `<div style="margin-left:auto;font-size:12px;color:var(--text-light);white-space:nowrap;"><strong>${fmtRangeLabel(reportDateFrom, reportDateTo)}</strong> vs <strong>${fmtRangeLabel(cmpFrom, cmpTo)}</strong></div>` : ''}
      </div>
      ${reportCompareMode==='custom' ? `
      <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:10px 12px;background:rgba(33,150,243,0.08);border:1px dashed rgba(33,150,243,0.4);border-radius:6px;">
        <div style="font-size:12px;color:var(--text-light);font-weight:600;">CURRENT:</div>
        <div style="display:flex;gap:6px;align-items:center;">
          <input type="date" value="${reportDateFrom}" onchange="reportDateFrom=this.value;loadReports();" style="padding:4px 8px;" title="Current range start">
          <span style="font-size:12px;color:var(--text-light);">to</span>
          <input type="date" value="${reportDateTo}" onchange="reportDateTo=this.value;loadReports();" style="padding:4px 8px;" title="Current range end">
        </div>
        <div style="font-size:14px;color:var(--text-light);font-weight:700;">vs</div>
        <div style="font-size:12px;color:var(--text-light);font-weight:600;">COMPARE:</div>
        <div style="display:flex;gap:6px;align-items:center;">
          <input type="date" value="${reportCompareFrom}" onchange="reportCompareFrom=this.value;loadReports();" style="padding:4px 8px;" title="Compare range start">
          <span style="font-size:12px;color:var(--text-light);">to</span>
          <input type="date" value="${reportCompareTo}" onchange="reportCompareTo=this.value;loadReports();" style="padding:4px 8px;" title="Compare range end">
        </div>
        <button class="btn btn-sm btn-secondary" onclick="swapCompareRanges()" title="Swap current and compare ranges">⇄ Swap</button>
        ${(!reportCompareFrom || !reportCompareTo) ? '<span style="font-size:11px;color:#ff9800;font-weight:600;">⚠ Enter both compare dates to see comparison</span>' : ''}
      </div>` : ''}
    </div>` : ''}

    ${reportTab === 'revenue' ? `
    <!-- KPI Cards -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px;">
      <div class="card" style="text-align:center;padding:20px;">
        <div style="font-size:28px;font-weight:700;color:var(--primary);">$${totalRevenue.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
        <div style="font-size:13px;color:var(--text-light);margin-top:4px;">Total Revenue</div>
        ${deltaBadge(totalRevenue, cmpTotalRevenue, {money:true})}
        <div style="font-size:11px;color:#4caf50;margin-top:6px;">Paid: $${totalPaid.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
        <div style="font-size:11px;color:#ff9800;">Outstanding: $${totalOutstanding.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
      </div>
      <div class="card" style="text-align:center;padding:20px;">
        <div style="font-size:28px;font-weight:700;color:#2196f3;">${totalJobs}</div>
        <div style="font-size:13px;color:var(--text-light);margin-top:4px;">Total Jobs</div>
        ${deltaBadge(totalJobs, cmpTotalJobs, {int:true})}
      </div>
      <div class="card" style="text-align:center;padding:20px;">
        <div style="font-size:28px;font-weight:700;color:#4caf50;">${totalGallons.toLocaleString()}</div>
        <div style="font-size:13px;color:var(--text-light);margin-top:4px;">Gallons Pumped</div>
        ${deltaBadge(totalGallons, cmpTotalGallons, {int:true})}
      </div>
      <div class="card" style="text-align:center;padding:20px;">
        <div style="font-size:28px;font-weight:700;color:#ff9800;">$${avgPerJob.toFixed(2)}</div>
        <div style="font-size:13px;color:var(--text-light);margin-top:4px;">Avg per Invoice</div>
        ${deltaBadge(avgPerJob, cmpAvgPerJob, {money:true})}
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

    </div>
    ` : ''}

    ${reportTab === 'ar' ? `
    <div class="card" style="overflow:hidden;">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">
        <h3>Accounts Receivable — All Outstanding Balances</h3>
        <span style="font-size:13px;color:var(--text-light);">as of ${formatDate(new Date())}</span>
      </div>
      <!-- AR Aging Summary -->
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:0;border-bottom:1px solid #e0e0e0;">
        ${[['Total','total','#1565c0',null],['Current (0–30d)','current','#1565c0',null],['31–60 Days','d30','#ff9800',null],['61–90 Days','d60','#f44336',null],['90+ Days','d90','#b71c1c','write-off risk']].map(([label,key,color,hint]) => {
          const d = arDeltas ? arDeltas[key] : null;
          const base = arDeltas ? (arDeltas[key+'_base'] ?? ((arTotals?.[key] || 0) - (d || 0))) : 0;
          // AR shrinking is good: ↑ = red, ↓ = green.
          const deltaColor = (d == null || d === 0) ? '#999' : (d > 0 ? '#c62828' : '#2e7d32');
          const arrow = d == null ? '' : (d > 0 ? '↑' : d < 0 ? '↓' : '');
          const fmtShort = (v) => {
            const abs = Math.abs(v);
            if (abs >= 1000) return `$${(v/1000).toFixed(1)}K`;
            return `$${v.toFixed(0)}`;
          };
          const fmtFull = (v) => `$${v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
          // Prior-period value for %: totals - delta
          const prior = (arTotals?.[key] || 0) - (d || 0);
          const pct = (d != null && prior > 0) ? ((d / prior) * 100) : null;
          const pctTxt = pct != null ? ` (${d>0?'+':''}${pct.toFixed(0)}%)` : '';
          const deltaTxt = arDeltas
            ? `${arrow}${fmtShort(Math.abs(d))}${pctTxt} 30d`
            : '— no 30d yet';
          const deltaTitle = arDeltas
            ? `${d>0?'+':''}${fmtFull(d)} vs ${arDeltas.since}`
            : '';
          // 7-day delta on Total card only
          let delta7Html = '';
          if (key === 'total') {
            if (arDelta7) {
              const d7 = arDelta7.total;
              const c7 = (d7 === 0) ? '#999' : (d7 > 0 ? '#c62828' : '#2e7d32');
              const a7 = d7 > 0 ? '↑' : d7 < 0 ? '↓' : '';
              delta7Html = `<div style="font-size:10px;color:${c7};margin-top:1px;" title="${d7>0?'+':''}${fmtFull(d7)} vs ${arDelta7.since}">${a7}${fmtShort(Math.abs(d7))} 7d</div>`;
            } else {
              delta7Html = `<div style="font-size:10px;color:#999;margin-top:1px;">— no 7d yet</div>`;
            }
          }
          const hintHtml = hint ? `<div style="font-size:10px;color:#b71c1c;font-style:italic;margin-top:2px;">${hint}</div>` : '';
          return `
          <div style="text-align:center;padding:14px 8px;border-right:1px solid #e0e0e0;">
            <div style="font-size:18px;font-weight:700;color:${color};">$${((arTotals||{})[key]||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
            <div style="font-size:11px;color:var(--text-light);margin-top:2px;">${label}</div>
            <div style="font-size:10px;color:${deltaColor};margin-top:3px;" title="${deltaTitle}">${deltaTxt}</div>
            ${delta7Html}
            ${hintHtml}
          </div>`;
        }).join('')}
      </div>
      ${arCollection ? (() => {
        const r = arCollection.ratio;
        const pct = r != null ? (r * 100) : null;
        const color = pct == null ? '#999' : (pct >= 100 ? '#2e7d32' : pct >= 80 ? '#ff9800' : '#c62828');
        const bar = Math.max(0, Math.min(120, pct || 0));
        return `
        <div style="padding:12px 16px;border-bottom:1px solid #e0e0e0;background:#fafafa;">
          <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
            <div>
              <div style="font-size:11px;color:var(--text-light);">Collection Ratio (last 30d)</div>
              <div style="font-size:18px;font-weight:700;color:${color};">${pct != null ? pct.toFixed(0) + '%' : '—'}</div>
            </div>
            <div style="flex:1;min-width:200px;">
              <div style="height:8px;background:#e0e0e0;border-radius:4px;overflow:hidden;">
                <div style="width:${bar}%;height:100%;background:${color};"></div>
              </div>
              <div style="font-size:11px;color:var(--text-light);margin-top:4px;">
                Collected $${arCollection.collected.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
                of $${arCollection.billed.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} billed
                · ${pct >= 100 ? 'keeping up' : pct >= 80 ? 'slightly behind' : 'falling behind'}
              </div>
            </div>
            ${(arCollectionHistory && arCollectionHistory.length) ? (() => {
              const hist = arCollectionHistory.slice(-6);
              const maxBar = 32;
              const ratios = hist.map(h => h.ratio == null ? 0 : h.ratio * 100);
              return `
              <div style="border-left:1px solid #e0e0e0;padding-left:16px;min-width:200px;">
                <div style="font-size:11px;color:var(--text-light);margin-bottom:4px;">6-Month History</div>
                <div style="display:flex;align-items:flex-end;gap:4px;height:${maxBar}px;">
                  ${hist.map((h, i) => {
                    const r = ratios[i];
                    const c = r >= 100 ? '#2e7d32' : r >= 80 ? '#ff9800' : '#c62828';
                    const h2 = Math.max(2, Math.min(maxBar, (r/120)*maxBar));
                    const tip = `${h.date}: ${r.toFixed(0)}% (collected $${h.collected.toLocaleString('en-US',{maximumFractionDigits:0})} / billed $${h.billed.toLocaleString('en-US',{maximumFractionDigits:0})})`;
                    return `<div class="ar-hist-bar" data-tip="${tip.replace(/"/g,'&quot;')}" style="width:14px;height:${h2}px;background:${c};border-radius:2px 2px 0 0;cursor:default;"></div>`;
                  }).join('')}
                </div>
                <div style="font-size:10px;color:var(--text-light);margin-top:4px;">
                  avg ${(ratios.reduce((a,b)=>a+b,0)/ratios.length).toFixed(0)}% ·
                  best ${Math.max(...ratios).toFixed(0)}% ·
                  worst ${Math.min(...ratios).toFixed(0)}%
                </div>
              </div>`;
            })() : ''}
          </div>
        </div>` ;
      })() : ''}
      ${!arRows || arRows.length === 0 ? `<p style="padding:20px;color:var(--text-light);">No outstanding balances. All invoices paid!</p>` : (() => {
        const arrow = (col) => arSortBy === col ? (arSortDir === 'asc' ? ' ▲' : ' ▼') : '';
        const th = (col, label, align) => `<th style="cursor:pointer;user-select:none;${align === 'right' ? 'text-align:right;' : ''}" onclick="setArSort('${col}')">${label}${arrow(col)}</th>`;
        const sorted = [...(arRows || [])].sort((a, b) => {
          let va = a[arSortBy], vb = b[arSortBy];
          if (arSortBy === 'name' || arSortBy === 'city') {
            va = (va || '').toLowerCase(); vb = (vb || '').toLowerCase();
            return arSortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
          }
          if (arSortBy === 'oldest') {
            va = va || ''; vb = vb || '';
            return arSortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
          }
          va = va || 0; vb = vb || 0;
          return arSortDir === 'asc' ? va - vb : vb - va;
        });
        return `
      <div style="padding:10px 12px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border);">
        <input id="ar-search" type="text" placeholder="Search customer or city…" autocomplete="off"
          value="${esc(arSearchTerm || '')}"
          oninput="filterArTable(this.value)"
          style="flex:1;max-width:360px;padding:8px 12px;border:1px solid var(--border);border-radius:6px;font-size:14px;" />
        <span id="ar-search-count" style="color:var(--text-light);font-size:12px;">${sorted.length} customers</span>
      </div>
      <table class="data-table" style="margin:0;">
        <thead><tr>
          ${th('name','Customer')}${th('city','City')}
          ${th('current','Current','right')}
          ${th('d30','31–60d','right')}
          ${th('d60','61–90d','right')}
          ${th('d90','90+d','right')}
          ${th('total','Total Owed','right')}
          ${th('oldest','Oldest Inv')}
        </tr></thead>
        <tbody id="ar-tbody">
          ${sorted.map(r => {
            const searchText = ((r.name || '') + ' ' + (r.city || '')).toLowerCase().replace(/"/g, '&quot;');
            return `
            <tr class="ar-row" data-search="${searchText}" style="cursor:pointer;" onclick="openCustomerDetail('${r.customerId || ''}')">
              <td><strong>${esc(r.name)}</strong></td>
              <td style="color:var(--text-light);font-size:12px;">${esc(r.city)}</td>
              <td style="text-align:right;color:#4caf50;">$${r.current.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
              <td style="text-align:right;color:#ff9800;">$${r.d30.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
              <td style="text-align:right;color:#f44336;">$${r.d60.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
              <td style="text-align:right;color:#b71c1c;font-weight:${r.d90>0?'700':'400'};">$${r.d90.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
              <td style="text-align:right;font-weight:700;">$${r.total.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
              <td style="font-size:12px;color:var(--text-light);">${r.oldest || '—'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
      })()}
    </div>
    ` : ''}

    ${reportTab === 'city' ? `
    <div class="card">
      <div class="card-header"><h3>Revenue by City — ${reportDateFrom} to ${reportDateTo}</h3></div>
      ${sortedCities.length === 0 ? '<p style="padding:20px;color:var(--text-light);">No invoice data.</p>' : `
      <table class="data-table" style="margin:0;">
        <thead><tr>
          <th>City</th>
          <th style="text-align:right;">Jobs</th>
          <th style="text-align:right;">Gallons</th>
          <th style="text-align:right;">Revenue</th>
          <th style="min-width:140px;"></th>
        </tr></thead>
        <tbody>
          ${sortedCities.map(([city, d]) => `
            <tr>
              <td><strong>${esc(city)}</strong></td>
              <td style="text-align:right;">${d.jobs}</td>
              <td style="text-align:right;">${d.gallons.toLocaleString()}</td>
              <td style="text-align:right;font-weight:700;">$${d.revenue.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
              <td><div style="height:8px;border-radius:4px;background:#e0e0e0;"><div style="height:100%;border-radius:4px;background:var(--primary);width:${(d.revenue/maxCityRev*100).toFixed(1)}%;"></div></div></td>
            </tr>`).join('')}
        </tbody>
      </table>`}
    </div>
    ` : ''}

    ${reportTab === 'statements' ? `
    <div class="card" style="max-width:600px;">
      <div class="card-header"><h3>Generate Customer Statement</h3></div>
      <div style="padding:20px;">
        <div class="form-group">
          <label>Customer</label>
          <select id="stmtCustomerId" style="width:100%;">
            <option value="">-- Select Customer --</option>
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>From Date</label>
            <input type="date" id="stmtFrom" value="${reportDateFrom}">
          </div>
          <div class="form-group">
            <label>To Date</label>
            <input type="date" id="stmtTo" value="${reportDateTo}">
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button class="btn btn-primary" onclick="generateStatement()">Generate PDF</button>
          <button class="btn btn-secondary" onclick="generateStatement(true)">Generate &amp; Email</button>
        </div>
      </div>
    </div>
    ` : ''}

    ${reportTab === 'pl' ? `
    <div style="margin-bottom:20px;">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <button class="btn btn-primary" onclick="importPlFile()">Import QB P&L Export</button>
        <button class="btn btn-primary" onclick="importExpensePdfAi()">Import Expense PDF (AI)</button>
        <button class="btn btn-primary" onclick="importExpensePdfAiBatch()" style="background:linear-gradient(135deg,#7c4dff,#448aff);">Batch Import PDFs (AI)</button>
        <span style="color:#888;font-size:13px;">QB monthly export, single PDF, or batch-upload multiple quarter PDFs at once.</span>
      </div>
    </div>
    <div id="plContent">
      <div style="color:#888;text-align:center;padding:40px 0;">Loading P&L data…</div>
    </div>
    ` : ''}
  `;

  // Populate statements customer dropdown async
  if (reportTab === 'statements') {
    const { data: custs } = await window.api.getCustomers('');
    const sel = document.getElementById('stmtCustomerId');
    if (sel) {
      (custs || []).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name + (c.city ? ' — ' + c.city : '');
        sel.appendChild(opt);
      });
    }
  }

  if (reportTab === 'pl') {
    renderPlTab();
  }

  // Re-apply A/R search filter after re-render (e.g. after sort click)
  if (reportTab === 'ar' && arSearchTerm) {
    filterArTable(arSearchTerm);
  }
}

async function importPlFile() {
  const btn = event?.target;
  if (btn) { btn.disabled = true; btn.textContent = 'Importing…'; }
  try {
    const result = await window.api.importPlFile();
    if (result && result.success) {
      showToast(`Imported ${result.count} month(s) of P&L data.`, 'success');
      renderPlTab();
    } else {
      showToast(result?.error || 'Import failed.', 'error');
    }
  } catch (e) {
    showToast('Import error: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Import QB P&L Export'; }
  }
}

let plViewMode = 'quarter'; // 'year' | 'quarter' | 'month'
let plCompareMode = 'prior'; // 'prior' | 'yoy' | 'none'

function monthToQuarter(m) {
  const [y, mm] = m.split('-');
  const q = Math.ceil(parseInt(mm) / 3);
  return `${y}-Q${q}`;
}
function quarterMonths(qKey) {
  const [y, qStr] = qKey.split('-Q');
  const q = parseInt(qStr);
  const start = (q - 1) * 3 + 1;
  return [start, start + 1, start + 2].map(m => `${y}-${String(m).padStart(2,'0')}`);
}
function priorQuarter(qKey) {
  const [y, qStr] = qKey.split('-Q');
  let q = parseInt(qStr) - 1, yr = parseInt(y);
  if (q < 1) { q = 4; yr -= 1; }
  return `${yr}-Q${q}`;
}
function yoyQuarter(qKey) {
  const [y, qStr] = qKey.split('-Q');
  return `${parseInt(y) - 1}-Q${qStr}`;
}
function priorMonth(mKey) {
  const [y, m] = mKey.split('-');
  let mm = parseInt(m) - 1, yr = parseInt(y);
  if (mm < 1) { mm = 12; yr -= 1; }
  return `${yr}-${String(mm).padStart(2,'0')}`;
}
function yoyMonth(mKey) {
  const [y, m] = mKey.split('-');
  return `${parseInt(y) - 1}-${m}`;
}

async function importExpensePdfAi() {
  const btn = event?.target;
  if (btn) { btn.disabled = true; btn.textContent = 'Scanning with Claude…'; }

  // Progress overlay
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'display:flex;z-index:9999;';
  const stepOrder = ['picking','reading','read_done','calling','received','done'];
  const stepLabels = {
    picking: 'Choose PDF',
    reading: 'Read PDF',
    read_done: 'PDF loaded',
    calling: 'Claude extracting',
    received: 'Parsing response',
    done: 'Complete'
  };
  overlay.innerHTML = `
    <div class="modal" style="max-width:520px;width:95%;">
      <div class="modal-header"><h2>Importing Expense PDF</h2></div>
      <div class="modal-body">
        <div id="expImpMsg" style="font-size:13px;color:var(--text-muted);margin-bottom:14px;min-height:36px;">Starting…</div>
        <div style="display:flex;flex-direction:column;gap:8px;" id="expImpSteps">
          ${stepOrder.map(s => `
            <div class="exp-imp-step" data-step="${s}" style="display:flex;align-items:center;gap:10px;font-size:13px;color:var(--text-muted);">
              <div class="exp-imp-dot" style="width:14px;height:14px;border-radius:50%;border:2px solid var(--border);background:var(--surface-subtle);flex-shrink:0;"></div>
              <span>${stepLabels[s]}</span>
            </div>`).join('')}
        </div>
        <div style="margin-top:16px;height:4px;background:var(--surface-subtle);border-radius:2px;overflow:hidden;">
          <div id="expImpBar" style="height:100%;width:0%;background:linear-gradient(90deg,#4caf50,#2196f3);transition:width 0.5s ease;border-radius:2px;"></div>
        </div>
        <div id="expImpTimer" style="margin-top:8px;font-size:11px;color:var(--text-muted);text-align:right;"></div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const msgEl = overlay.querySelector('#expImpMsg');
  const barEl = overlay.querySelector('#expImpBar');
  const timerEl = overlay.querySelector('#expImpTimer');
  const tStart = Date.now();
  const tick = setInterval(() => {
    timerEl.textContent = `Elapsed: ${((Date.now() - tStart)/1000).toFixed(1)}s`;
  }, 100);

  function markStep(name, message) {
    const idx = stepOrder.indexOf(name);
    if (idx >= 0) {
      overlay.querySelectorAll('.exp-imp-step').forEach((el, i) => {
        const dot = el.querySelector('.exp-imp-dot');
        if (i < idx) {
          dot.style.background = '#4caf50';
          dot.style.borderColor = '#4caf50';
          dot.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" style="display:block;margin:auto;margin-top:-1px;"><path fill="white" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
          el.style.color = 'var(--text)';
        } else if (i === idx) {
          dot.style.background = '#2196f3';
          dot.style.borderColor = '#2196f3';
          dot.style.animation = 'pulse 1.2s ease-in-out infinite';
          dot.innerHTML = '';
          el.style.color = 'var(--text)';
          el.style.fontWeight = '600';
        } else {
          dot.style.background = 'var(--surface-subtle)';
          dot.style.borderColor = 'var(--border)';
          dot.style.animation = '';
          dot.innerHTML = '';
          el.style.color = 'var(--text-muted)';
          el.style.fontWeight = '400';
        }
      });
      barEl.style.width = `${((idx + 1) / stepOrder.length * 100).toFixed(0)}%`;
    }
    if (message) msgEl.textContent = message;
  }

  const unsubscribe = window.api.onExpenseImportProgress(({ step, message }) => {
    if (step === 'error') {
      msgEl.style.color = '#e74c3c';
      msgEl.textContent = message;
      return;
    }
    if (step === 'cancelled') return;
    markStep(step, message);
  });

  try {
    const result = await window.api.importExpensePdfAi();
    clearInterval(tick);
    unsubscribe && unsubscribe();
    setTimeout(() => overlay.remove(), result?.success ? 400 : 2000);
    if (result && result.success) {
      showExpenseReviewModal(result.extracted, result.source_file);
    } else if (result && result.canceled) {
      overlay.remove();
    } else {
      showToast(result?.error || 'AI import failed.', 'error');
    }
  } catch (e) {
    clearInterval(tick);
    unsubscribe && unsubscribe();
    overlay.remove();
    showToast('Import error: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Import Expense PDF (AI)'; }
  }
}

async function importExpensePdfAiBatch() {
  const btn = event?.target;
  if (btn) { btn.disabled = true; btn.textContent = 'Scanning with Claude…'; }

  // Progress overlay — simpler for batch (shows X of N + live message)
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'display:flex;z-index:9999;';
  overlay.innerHTML = `
    <div class="modal" style="max-width:560px;width:95%;">
      <div class="modal-header"><h2>Batch Importing Expense PDFs</h2></div>
      <div class="modal-body">
        <div id="batchImpFile" style="font-size:14px;font-weight:600;margin-bottom:6px;">Starting…</div>
        <div id="batchImpMsg" style="font-size:13px;color:var(--text-muted);margin-bottom:14px;min-height:20px;"></div>
        <div style="height:6px;background:var(--surface-subtle);border-radius:3px;overflow:hidden;">
          <div id="batchImpBar" style="height:100%;width:0%;background:linear-gradient(90deg,#4caf50,#2196f3);transition:width 0.4s ease;border-radius:3px;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:11px;color:var(--text-muted);">
          <span id="batchImpCount">0 / 0</span>
          <span id="batchImpTimer">Elapsed: 0.0s</span>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const fileEl = overlay.querySelector('#batchImpFile');
  const msgEl = overlay.querySelector('#batchImpMsg');
  const barEl = overlay.querySelector('#batchImpBar');
  const countEl = overlay.querySelector('#batchImpCount');
  const timerEl = overlay.querySelector('#batchImpTimer');

  const tStart = Date.now();
  const tick = setInterval(() => {
    timerEl.textContent = `Elapsed: ${((Date.now() - tStart)/1000).toFixed(1)}s`;
  }, 100);

  const unsubscribe = window.api.onExpenseImportProgress(({ step, message, index, total, file }) => {
    if (step === 'error') { msgEl.style.color = '#e74c3c'; msgEl.textContent = message; return; }
    if (step === 'cancelled') return;
    if (file) fileEl.textContent = file;
    if (message) msgEl.textContent = message;
    if (index && total) {
      countEl.textContent = `${index} / ${total}`;
      barEl.style.width = `${Math.round((index - 1) / total * 100)}%`;
    }
    if (step === 'done') {
      barEl.style.width = '100%';
      countEl.textContent = `${total} / ${total}`;
      fileEl.textContent = 'All files processed';
    }
  });

  try {
    const res = await window.api.importExpensePdfAiBatch();
    clearInterval(tick);
    unsubscribe && unsubscribe();
    if (res && res.canceled) { overlay.remove(); return; }
    if (res && res.error) { showToast(res.error, 'error'); overlay.remove(); return; }
    setTimeout(() => overlay.remove(), 500);
    showBatchReviewModal(res.results || []);
  } catch (e) {
    clearInterval(tick);
    unsubscribe && unsubscribe();
    overlay.remove();
    showToast('Batch import error: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Batch Import PDFs (AI)'; }
  }
}

function showBatchReviewModal(results) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const money = v => '$' + (parseFloat(v)||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const successes = results.filter(r => r.extracted);
  const failures = results.filter(r => r.error);

  // Flatten every period across every file into a single list of rows
  const rows = [];
  successes.forEach(r => {
    const d = r.extracted;
    const periods = Array.isArray(d.periods) ? d.periods : [{ label: '(unknown)', period_type: 'custom' }];
    const totals = Array.isArray(d.totals_by_period) ? d.totals_by_period : [];
    const incomes = Array.isArray(d.income_by_period) ? d.income_by_period : [];
    const nets = Array.isArray(d.net_by_period) ? d.net_by_period : [];
    periods.forEach((p, i) => {
      rows.push({
        file: r.file,
        label: p.label || `Period ${i+1}`,
        period_type: p.period_type || 'custom',
        start: p.start || '',
        end: p.end || '',
        income: parseFloat(incomes[i]) || 0,
        expense: parseFloat(totals[i]) || 0,
        net: parseFloat(nets[i]) || 0,
        line_items: Array.isArray(d.line_items) ? d.line_items.map(li => ({
          code: li.code || '',
          name: li.name || '',
          parent_category: li.parent_category || 'OTHER',
          amount: parseFloat((li.amounts || [])[i]) || 0,
        })).filter(li => li.amount !== 0) : [],
        use_income: false, // default off — only enable for pre-TankTrack years
        _pick: true,
      });
    });
  });

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'display:flex;z-index:9999;';
  overlay.innerHTML = `
    <div class="modal" style="max-width:1000px;width:95%;max-height:90vh;display:flex;flex-direction:column;">
      <div class="modal-header">
        <h2>Batch Import Review — ${rows.length} period${rows.length!==1?'s':''} extracted</h2>
      </div>
      <div class="modal-body" style="overflow-y:auto;flex:1;">
        ${failures.length > 0 ? `
          <div style="background:rgba(229,57,53,0.1);border:1px solid rgba(229,57,53,0.3);border-radius:6px;padding:10px;margin-bottom:14px;">
            <div style="font-weight:600;color:#e74c3c;margin-bottom:4px;">${failures.length} file${failures.length!==1?'s':''} failed</div>
            ${failures.map(f => `<div style="font-size:12px;color:var(--text-muted);">${esc(f.file)}: ${esc(f.error)}</div>`).join('')}
          </div>
        ` : ''}
        <div style="margin-bottom:10px;font-size:13px;color:var(--text-muted);">
          Uncheck any period you don't want to save. Use-income checkboxes are off by default — turn them on only for pre-TankTrack years where you want the PDF income to seed Revenue.
        </div>
        <table class="data-table" style="font-size:13px;">
          <thead><tr>
            <th style="width:32px;">Save</th>
            <th>Source</th>
            <th>Label</th>
            <th>Type</th>
            <th style="text-align:right;">Income</th>
            <th style="text-align:right;">Expense</th>
            <th style="text-align:right;">Net</th>
            <th style="text-align:center;">Use income as revenue</th>
          </tr></thead>
          <tbody>
            ${rows.map((r, i) => `
              <tr>
                <td><input type="checkbox" data-r-field="pick" data-r-i="${i}" ${r._pick?'checked':''}></td>
                <td style="font-size:11px;color:var(--text-muted);">${esc(r.file)}</td>
                <td><input type="text" data-r-field="label" data-r-i="${i}" value="${esc(r.label)}" style="width:140px;"></td>
                <td>
                  <select data-r-field="period_type" data-r-i="${i}">
                    <option value="year" ${r.period_type==='year'?'selected':''}>Year</option>
                    <option value="quarter" ${r.period_type==='quarter'?'selected':''}>Quarter</option>
                    <option value="month" ${r.period_type==='month'?'selected':''}>Month</option>
                    <option value="custom" ${r.period_type==='custom'?'selected':''}>Custom</option>
                  </select>
                </td>
                <td style="text-align:right;font-variant-numeric:tabular-nums;">${money(r.income)}</td>
                <td style="text-align:right;font-variant-numeric:tabular-nums;font-weight:600;">${money(r.expense)}</td>
                <td style="text-align:right;font-variant-numeric:tabular-nums;color:${r.net>=0?'#4caf50':'#e74c3c'};">${money(r.net)}</td>
                <td style="text-align:center;"><input type="checkbox" data-r-field="use_income" data-r-i="${i}"></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div class="modal-footer" style="padding:14px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:10px;">
        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove();">Cancel</button>
        <button class="btn btn-primary" id="batchSaveAllBtn">Save All Checked</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // Wire inputs
  overlay.querySelectorAll('[data-r-field]').forEach(el => {
    el.addEventListener('change', () => {
      const i = parseInt(el.dataset.rI, 10);
      const field = el.dataset.rField;
      const row = rows[i];
      if (field === 'pick') row._pick = el.checked;
      else if (field === 'use_income') row.use_income = el.checked;
      else row[field] = el.value;
    });
  });

  overlay.querySelector('#batchSaveAllBtn').addEventListener('click', async () => {
    const picked = rows.filter(r => r._pick);
    if (picked.length === 0) { showToast('Nothing to save.', 'error'); return; }
    const saveBtn = overlay.querySelector('#batchSaveAllBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = `Saving 0 / ${picked.length}…`;
    let ok = 0, fail = 0;
    for (let i = 0; i < picked.length; i++) {
      const r = picked[i];
      saveBtn.textContent = `Saving ${i+1} / ${picked.length}…`;
      try {
        await window.api.saveExpenseSnapshot({
          period_label: r.label,
          period_type: r.period_type,
          period_start: r.start || null,
          period_end: r.end || null,
          total_expenses: r.expense,
          total_income: r.income,
          net_income: r.net,
          use_income_as_revenue: !!r.use_income,
          line_items: r.line_items,
          source_file: r.file,
        });
        ok++;
      } catch (e) {
        fail++;
      }
    }
    overlay.remove();
    showToast(`Saved ${ok} snapshot${ok!==1?'s':''}${fail>0?`, ${fail} failed`:''}.`, fail > 0 ? 'error' : 'success');
    renderPlTab();
  });
}

function showExpenseReviewModal(data, sourceFile) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const money = v => '$' + (parseFloat(v)||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});

  // Normalize: accept new multi-period schema OR legacy single-period
  let periods = Array.isArray(data.periods) ? data.periods : null;
  let lineItems = Array.isArray(data.line_items) ? data.line_items : null;
  let totals = Array.isArray(data.totals_by_period) ? data.totals_by_period : null;
  let incomes = Array.isArray(data.income_by_period) ? data.income_by_period : (periods ? new Array(periods.length).fill(0) : [0]);
  let nets = Array.isArray(data.net_by_period) ? data.net_by_period : (periods ? new Array(periods.length).fill(0) : [0]);
  if (!periods) {
    periods = [{
      label: data.period_label || 'Imported',
      period_type: data.period_type || 'custom',
      start: data.period_start || '',
      end: data.period_end || ''
    }];
    lineItems = (data.categories || []).map(c => ({
      code: '', name: c.name, parent_category: (c.group || 'OTHER').toUpperCase(),
      amounts: [parseFloat(c.amount) || 0]
    }));
    totals = [parseFloat(data.total_expenses) || 0];
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.display = 'flex';
  const nP = periods.length;
  overlay.innerHTML = `
    <div class="modal" style="max-width:960px;width:95%;max-height:90vh;display:flex;flex-direction:column;">
      <div class="modal-header">
        <h2>Review Extracted Expenses</h2>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
      </div>
      <div class="modal-body" style="overflow-y:auto;">
        <p style="color:var(--text-muted);font-size:13px;margin:0 0 14px;">Claude extracted <strong>${lineItems.length}</strong> expense lines across <strong>${nP}</strong> period${nP>1?'s':''} from <strong>${esc(sourceFile || 'PDF')}</strong>.</p>

        <div style="display:grid;grid-template-columns:repeat(${nP},1fr);gap:10px;margin-bottom:16px;">
          ${periods.map((p, i) => `
            <div class="card" style="padding:12px;">
              <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Period ${i+1}</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
                <div class="form-group" style="margin:0;"><label style="font-size:11px;">Label</label><input type="text" data-p-field="label" data-p-i="${i}" value="${esc(p.label||'')}" style="font-size:13px;"></div>
                <div class="form-group" style="margin:0;"><label style="font-size:11px;">Type</label><select data-p-field="period_type" data-p-i="${i}" style="font-size:13px;">
                  <option value="year" ${p.period_type==='year'?'selected':''}>Year</option>
                  <option value="quarter" ${p.period_type==='quarter'?'selected':''}>Quarter</option>
                  <option value="month" ${p.period_type==='month'?'selected':''}>Month</option>
                  <option value="custom" ${p.period_type==='custom'?'selected':''}>Custom</option>
                </select></div>
                <div class="form-group" style="margin:0;"><label style="font-size:11px;">Start</label><input type="date" data-p-field="start" data-p-i="${i}" value="${esc(p.start||'')}" style="font-size:13px;"></div>
                <div class="form-group" style="margin:0;"><label style="font-size:11px;">End</label><input type="date" data-p-field="end" data-p-i="${i}" value="${esc(p.end||'')}" style="font-size:13px;"></div>
              </div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:8px;display:flex;flex-direction:column;gap:2px;">
                <div>Income: <strong style="color:var(--success-text, #4caf50);">${money(incomes[i])}</strong></div>
                <div>Expense: <strong style="color:var(--warning-text, #e67e22);">${money(totals[i])}</strong></div>
                <div>Net: <strong style="color:${(nets[i]||0)>=0?'var(--success-text, #4caf50)':'var(--danger-text, #e74c3c)'};">${money(nets[i])}</strong></div>
                <label style="display:flex;align-items:center;gap:6px;margin-top:4px;font-weight:500;">
                  <input type="checkbox" data-p-use-income="${i}" ${incomes[i]>0?'checked':''}>
                  <span>Use income as revenue for this period (for pre-TankTrack years)</span>
                </label>
              </div>
            </div>
          `).join('')}
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <strong>Line Items (${lineItems.length})</strong>
          <button class="btn btn-secondary btn-sm" id="expAddRow">+ Add Row</button>
        </div>
        <div style="max-height:380px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;">
          <table class="data-table" style="font-size:12px;margin:0;">
            <thead style="position:sticky;top:0;background:var(--table-head-bg);z-index:1;">
              <tr>
                <th style="width:70px;">Code</th>
                <th>Line Item</th>
                <th>Parent Category</th>
                ${periods.map(p => `<th style="text-align:right;">${esc(p.label||'')}</th>`).join('')}
                <th style="width:30px;"></th>
              </tr>
            </thead>
            <tbody id="expRowsBody"></tbody>
          </table>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
        <button class="btn btn-primary" id="expSaveBtn">Save ${nP} Snapshot${nP>1?'s':''}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const body = overlay.querySelector('#expRowsBody');
  function rowHtml(li) {
    return `<tr>
      <td><input type="text" value="${esc(li.code||'')}" class="li-code" style="width:60px;font-size:12px;"></td>
      <td><input type="text" value="${esc(li.name||'')}" class="li-name" style="width:100%;font-size:12px;"></td>
      <td><input type="text" value="${esc(li.parent_category||'OTHER')}" class="li-parent" list="expParentList" style="width:100%;font-size:12px;"></td>
      ${periods.map((_, i) => `<td style="text-align:right;"><input type="number" step="0.01" value="${li.amounts?.[i]||0}" class="li-amt" data-pi="${i}" style="width:100px;text-align:right;font-size:12px;"></td>`).join('')}
      <td><button class="btn-icon li-del" title="Remove">×</button></td>
    </tr>`;
  }
  // Datalist for parent category autocomplete
  const parents = [...new Set(lineItems.map(l => l.parent_category).filter(Boolean))];
  const dl = document.createElement('datalist');
  dl.id = 'expParentList';
  dl.innerHTML = parents.map(p => `<option value="${esc(p)}">`).join('');
  overlay.appendChild(dl);

  body.innerHTML = lineItems.map(rowHtml).join('') || rowHtml({amounts: periods.map(()=>0)});
  body.addEventListener('click', e => {
    if (e.target.classList.contains('li-del')) e.target.closest('tr').remove();
  });
  overlay.querySelector('#expAddRow').onclick = () => {
    const tr = document.createElement('tr');
    tr.innerHTML = rowHtml({amounts: periods.map(()=>0), parent_category:'OTHER'}).replace(/^<tr>|<\/tr>$/g,'');
    body.appendChild(tr);
  };

  overlay.querySelector('#expSaveBtn').onclick = async () => {
    // Read periods back from modal inputs
    const editedPeriods = periods.map((p, i) => {
      const get = f => overlay.querySelector(`[data-p-field="${f}"][data-p-i="${i}"]`).value;
      return { label: get('label').trim(), period_type: get('period_type'), start: get('start'), end: get('end') };
    });
    const rows = [...body.querySelectorAll('tr')];
    const items = rows.map(r => ({
      code: r.querySelector('.li-code').value.trim(),
      name: r.querySelector('.li-name').value.trim(),
      parent_category: (r.querySelector('.li-parent').value.trim() || 'OTHER').toUpperCase(),
      amounts: [...r.querySelectorAll('.li-amt')].map(inp => parseFloat(inp.value) || 0)
    })).filter(li => li.name);

    // Save one snapshot per period
    let saved = 0;
    for (let i = 0; i < editedPeriods.length; i++) {
      const p = editedPeriods[i];
      const lineItemsForPeriod = items.map(li => ({
        code: li.code, name: li.name, parent_category: li.parent_category, amount: li.amounts[i] || 0
      })).filter(li => li.amount > 0);
      const totalExp = lineItemsForPeriod.reduce((s, li) => s + li.amount, 0);
      const useIncome = overlay.querySelector(`[data-p-use-income="${i}"]`)?.checked || false;
      const snap = {
        period_label: p.label,
        period_type: p.period_type,
        period_start: p.start,
        period_end: p.end,
        line_items: lineItemsForPeriod,
        total_expenses: totalExp,
        total_income: parseFloat(incomes[i]) || 0,
        net_income: parseFloat(nets[i]) || 0,
        use_income_as_revenue: useIncome,
        source_file: sourceFile,
        created_at: new Date().toISOString()
      };
      const res = await window.api.saveExpenseSnapshot(snap);
      if (res?.success) saved++;
    }
    showToast(`Saved ${saved} expense snapshot${saved!==1?'s':''}.`, 'success');
    overlay.remove();
    renderPlTab();
  };
}

// Color palette for parent categories (stable hash -> hue)
function categoryHue(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}
function categoryColor(name, alpha = 1) {
  const hue = categoryHue(name);
  return alpha >= 1 ? `hsl(${hue}, 60%, 55%)` : `hsla(${hue}, 60%, 55%, ${alpha})`;
}

// Strip leading QuickBooks account-code prefixes so the same line item coming
// from different PDFs (with or without the code glued onto the name) merges.
// Handles:
//   "823 · Licenses and Permits"      → "Licenses and Permits"
//   "A · Trucking Compost to JR..."   → "Trucking Compost to JR..."
//   "823 - Licenses"                   → "Licenses"
//   "A1: Foo"  / "B-12. Bar"          → "Foo" / "Bar"
// Only strips UPPERCASE-or-digit prefixes of 1–6 chars (QB convention) so a
// legitimate name like "Oz - Something" isn't accidentally mangled.
// Accepts many Unicode mid-dot / bullet variants as the separator.
const CODE_PREFIX_RE = /^\s*[A-Z0-9][A-Z0-9]{0,5}\s*[\u00B7\u2022\u2027\u22C5\u2219\u30FB\uFF65\u2043\-\u2012\u2013\u2014\u2015:\.\/|~]\s*/;
function cleanLineItemName(name) {
  if (!name) return '';
  const stripped = String(name)
    .replace(CODE_PREFIX_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || String(name).trim();
}
function lineItemKey(name) {
  return cleanLineItemName(name).toLowerCase();
}

// Safety net: catch duplicates the prefix-stripper missed (e.g. weird unicode
// variants). Given two keys in the same parent, if the longer one ends with
// the shorter one and the leading chunk looks like "short prefix + separator",
// merge them.
function suffixMergePass(parentMap) {
  Object.keys(parentMap).forEach(parent => {
    const items = parentMap[parent];
    // sort by length ascending so short keys are considered first as merge targets
    const keys = Object.keys(items).sort((a, b) => a.length - b.length);
    const gone = new Set();
    for (let i = 0; i < keys.length; i++) {
      if (gone.has(keys[i])) continue;
      const shortK = keys[i];
      if (shortK.length < 4) continue; // avoid merging tiny keys like "a" — unreliable
      for (let j = i + 1; j < keys.length; j++) {
        if (gone.has(keys[j])) continue;
        const longK = keys[j];
        if (longK === shortK) continue;
        if (!longK.endsWith(shortK)) continue;
        const prefix = longK.slice(0, longK.length - shortK.length);
        // Must be non-empty and short (≤10 chars) and end with a separator-ish char
        if (!prefix || prefix.length > 10) continue;
        if (!/[\s\u00B7\u2022\u2027\u22C5\u2219\u30FB\uFF65\u2043\-\u2012-\u2015:\.\/|~]$/.test(prefix)) continue;
        // Merge longK into shortK
        items[longK].amounts.forEach((v, k) => items[shortK].amounts[k] += v);
        delete items[longK];
        gone.add(longK);
      }
    }
  });
}

// ===== Expense breakdown filter state (persisted to localStorage) =====
// type:  'all' | 'year' | 'quarter' | 'month'
// limit: 0 = show all | N = show N most recent
// excluded: Set of snapshot ids the user has manually hidden
function getExpenseFilterState() {
  try {
    const raw = localStorage.getItem('ism-expense-filter-v1');
    if (raw) {
      const s = JSON.parse(raw);
      return {
        type: s.type || 'all',
        limit: Number(s.limit) || 0,
        excluded: new Set(Array.isArray(s.excluded) ? s.excluded : []),
      };
    }
  } catch {}
  return { type: 'all', limit: 0, excluded: new Set() };
}
function setExpenseFilterState(s) {
  try {
    localStorage.setItem('ism-expense-filter-v1', JSON.stringify({
      type: s.type || 'all',
      limit: Number(s.limit) || 0,
      excluded: Array.from(s.excluded || []),
    }));
  } catch {}
}
function setExpenseFilterType(t) {
  const s = getExpenseFilterState(); s.type = t; setExpenseFilterState(s); renderPlTab();
}
function setExpenseFilterLimit(n) {
  const s = getExpenseFilterState(); s.limit = Number(n) || 0; setExpenseFilterState(s); renderPlTab();
}
function toggleExpensePeriod(id) {
  const s = getExpenseFilterState();
  if (s.excluded.has(id)) s.excluded.delete(id); else s.excluded.add(id);
  setExpenseFilterState(s); renderPlTab();
}
function resetExpenseFilterExclusions() {
  const s = getExpenseFilterState(); s.excluded = new Set(); setExpenseFilterState(s); renderPlTab();
}
function resetExpenseFilter() {
  setExpenseFilterState({ type: 'all', limit: 0, excluded: new Set() }); renderPlTab();
}

// Derive the 4-digit year for a snapshot. Prefers period_start (ISO date), falls
// back to scanning the label for "2025" or "25".
function snapshotYear(s) {
  if (s.period_start && /^\d{4}/.test(s.period_start)) return s.period_start.slice(0, 4);
  const lbl = String(s.period_label || '');
  const m4 = lbl.match(/\b(19\d{2}|20\d{2})\b/);
  if (m4) return m4[1];
  const m2 = lbl.match(/\b(\d{2})\b(?!\d)\s*$/);
  if (m2) {
    const yy = parseInt(m2[1], 10);
    return (yy >= 50 ? '19' : '20') + m2[1];
  }
  return null;
}

// Aggregate all snapshots into synthetic yearly snapshots. If a native
// year-type snapshot exists for a given year, that's used directly; otherwise
// quarter/month/custom snapshots belonging to that year are summed and their
// line items merged (using the same name-normalization as renderExpenseBreakdown).
function buildYearlyRollup(allSnaps) {
  const native = {};
  allSnaps.forEach(s => {
    const t = (s.period_type || '').toLowerCase();
    if (t === 'year' || t === 'yearly' || t === 'annual') {
      const y = snapshotYear(s);
      if (y && !native[y]) native[y] = s;
    }
  });
  // Group sub-year snapshots
  const subs = {};
  allSnaps.forEach(s => {
    const t = (s.period_type || '').toLowerCase();
    if (t === 'year' || t === 'yearly' || t === 'annual') return;
    const y = snapshotYear(s);
    if (!y) return;
    if (native[y]) return; // already have a native year snapshot — don't double-count
    (subs[y] = subs[y] || []).push(s);
  });

  const out = {};
  Object.keys(native).forEach(y => {
    const s = native[y];
    out[y] = { ...s, id: s.id || ('year-' + y), period_label: y, period_type: 'year' };
  });
  Object.keys(subs).forEach(y => {
    const entries = subs[y];
    let totalExp = 0, totalInc = 0;
    const lineMap = {};
    let useIncome = false;
    const sources = [];
    entries.forEach(s => {
      totalExp += parseFloat(s.total_expenses) || 0;
      totalInc += parseFloat(s.total_income) || 0;
      if (s.use_income_as_revenue) useIncome = true;
      if (s.source_file) sources.push(s.source_file);
      const lines = Array.isArray(s.line_items)
        ? s.line_items
        : (Array.isArray(s.categories)
            ? s.categories.map(c => ({ name: c.name, parent_category: (c.group || 'OTHER').toUpperCase(), amount: c.amount }))
            : []);
      lines.forEach(li => {
        const parent = (li.parent_category || 'OTHER').toUpperCase();
        const rawName = li.name || '(unnamed)';
        const key = parent + '|' + (lineItemKey(rawName) || rawName.toLowerCase());
        const cleaned = cleanLineItemName(rawName) || rawName;
        if (!lineMap[key]) {
          lineMap[key] = { name: cleaned, parent_category: parent, amount: 0 };
        } else if (cleaned.length > lineMap[key].name.length ||
                   (cleaned !== cleaned.toUpperCase() && lineMap[key].name === lineMap[key].name.toUpperCase())) {
          lineMap[key].name = cleaned;
        }
        lineMap[key].amount += parseFloat(li.amount) || 0;
      });
    });
    // Run the same suffix-merge safety net over the per-parent groups of this
    // year's line items so duplicates collapse in the yearly rollup too.
    const byParent = {};
    Object.values(lineMap).forEach(li => {
      const p = (li.parent_category || 'OTHER').toUpperCase();
      const k = lineItemKey(li.name) || String(li.name).toLowerCase();
      (byParent[p] = byParent[p] || {})[k] = {
        display: li.name,
        amounts: [li.amount], // 1-element for this helper to work
        _origLi: li,
      };
    });
    suffixMergePass(byParent);
    const mergedLines = [];
    Object.keys(byParent).forEach(p => {
      Object.values(byParent[p]).forEach(entry => {
        mergedLines.push({
          name: entry.display,
          parent_category: p,
          amount: entry.amounts[0],
        });
      });
    });

    out[y] = {
      id: 'year-' + y,
      period_label: y,
      period_type: 'year',
      period_start: y + '-01-01',
      period_end: y + '-12-31',
      total_expenses: totalExp,
      total_income: totalInc,
      net_income: totalInc - totalExp,
      use_income_as_revenue: useIncome,
      line_items: mergedLines,
      source_file: `rolled up from ${entries.length} ${entries.length === 1 ? 'snapshot' : 'snapshots'}`,
      _syntheticYear: true,
      _sourceCount: entries.length,
    };
  });
  return Object.keys(out).sort().map(y => out[y]);
}

function renderExpenseBreakdown(expSnaps) {
  if (!expSnaps || expSnaps.length === 0) {
    return `<div class="card" style="margin-top:20px;padding:24px;text-align:center;color:var(--text-muted);">
      <div style="font-size:14px;margin-bottom:6px;">No AI-imported expense data yet.</div>
      <div style="font-size:12px;">Click "Import Expense PDF (AI)" above to upload a QB P&L PDF and have Claude extract expense line items automatically.</div>
    </div>`;
  }

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const money = v => '$' + (parseFloat(v)||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});

  // ------------------------------------------------------------------
  // FILTER: type (all/year/quarter/month) + limit (N most recent) + per-period toggle
  // ------------------------------------------------------------------
  const filter = getExpenseFilterState();
  const allPeriodsSorted = [...expSnaps].sort((a, b) => (a.period_start || '').localeCompare(b.period_start || ''));
  const uniqueTypes = new Set(allPeriodsSorted.map(p => p.period_type || 'custom'));

  // When the user picks "Years", roll up any sub-year data into synthetic
  // annual snapshots so you can view yearly totals even if you only imported
  // quarterly PDFs. "Quarters"/"Months" still filter by native period_type.
  let typeFiltered;
  if (filter.type === 'all') {
    typeFiltered = allPeriodsSorted;
  } else if (filter.type === 'year') {
    typeFiltered = buildYearlyRollup(allPeriodsSorted);
  } else {
    typeFiltered = allPeriodsSorted.filter(p => (p.period_type || 'custom') === filter.type);
  }
  const candidates = filter.limit > 0 ? typeFiltered.slice(-filter.limit) : typeFiltered;
  const excluded = filter.excluded instanceof Set ? filter.excluded : new Set(filter.excluded || []);
  const periods = candidates.filter(p => !excluded.has(p.id));

  // Toolbar (always rendered so user can always change filters). The "Years"
  // button is always enabled as long as there's any data — rollup handles it.
  const canRollupYears = allPeriodsSorted.length > 0;
  const typeBtn = (val, label, force=false) => (force || uniqueTypes.has(val))
    ? `<button class="btn btn-sm ${filter.type===val?'btn-primary':'btn-secondary'}" onclick="setExpenseFilterType('${val}')" style="padding:4px 12px;font-size:12px;">${label}</button>`
    : '';
  const limitBtn = (n, label) => `<button class="btn btn-sm ${filter.limit===n?'btn-primary':'btn-secondary'}" onclick="setExpenseFilterLimit(${n})" style="padding:4px 12px;font-size:12px;">${label}</button>`;

  const toolbarHtml = `
    <div class="card" style="margin-top:20px;padding:14px 18px;">
      <div style="display:flex;flex-wrap:wrap;gap:18px;align-items:center;">
        <div style="display:flex;gap:10px;align-items:center;">
          <span style="color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:0.8px;font-weight:700;">Type</span>
          <div style="display:flex;gap:4px;">
            ${typeBtn('all','All',true)}
            ${typeBtn('year','Years', canRollupYears)}
            ${typeBtn('quarter','Quarters')}
            ${typeBtn('month','Months')}
          </div>
        </div>
        <div style="display:flex;gap:10px;align-items:center;">
          <span style="color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:0.8px;font-weight:700;">Show</span>
          <div style="display:flex;gap:4px;">
            ${limitBtn(0,'All')}
            ${limitBtn(4,'Last 4')}
            ${limitBtn(8,'Last 8')}
            ${limitBtn(12,'Last 12')}
            ${limitBtn(16,'Last 16')}
          </div>
        </div>
        <div style="margin-left:auto;font-size:12px;color:var(--text-muted);font-variant-numeric:tabular-nums;">
          <strong style="color:var(--text);">${periods.length}</strong> of ${allPeriodsSorted.length} period${allPeriodsSorted.length!==1?'s':''} shown
        </div>
      </div>
      ${candidates.length > 0 ? `
        <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
          ${candidates.map(p => {
            const isOn = !excluded.has(p.id);
            return `<button onclick="toggleExpensePeriod('${esc(p.id)}')" style="border:1px solid ${isOn?'var(--primary, #1565c0)':'var(--border)'};padding:3px 11px;border-radius:12px;background:${isOn?'var(--primary, #1565c0)':'transparent'};color:${isOn?'#fff':'var(--text-muted)'};font-size:11px;cursor:pointer;opacity:${isOn?1:0.6};transition:all 0.15s;white-space:nowrap;">${isOn?'✓':'○'} ${esc(p.period_label||'?')}</button>`;
          }).join('')}
          ${excluded.size > 0 ? `<button onclick="resetExpenseFilterExclusions()" style="border:none;background:transparent;color:var(--primary, #1565c0);font-size:11px;cursor:pointer;text-decoration:underline;margin-left:6px;">Include all</button>` : ''}
        </div>
      ` : ''}
    </div>`;

  if (periods.length === 0) {
    return toolbarHtml + `<div class="card" style="margin-top:12px;padding:30px;text-align:center;color:var(--text-muted);">No periods match your filter. Adjust the buttons above, or click "Include all" to reset.</div>`;
  }

  // ------------------------------------------------------------------
  // DATA: group into parentMap[parent][key] = { display, amounts[] }
  // Strips QB account-code prefixes so "823 · Licenses and Permits" merges
  // with bare "Licenses and Permits".
  // ------------------------------------------------------------------
  function getLines(snap) {
    if (Array.isArray(snap.line_items)) return snap.line_items;
    if (Array.isArray(snap.categories)) {
      return snap.categories.map(c => ({
        name: c.name, parent_category: (c.group || 'OTHER').toUpperCase(), amount: c.amount
      }));
    }
    return [];
  }

  const parentMap = {};
  periods.forEach((snap, pi) => {
    getLines(snap).forEach(li => {
      const parent = (li.parent_category || 'OTHER').toUpperCase();
      const rawName = li.name || '(unnamed)';
      const key = lineItemKey(rawName) || rawName.toLowerCase();
      const cleaned = cleanLineItemName(rawName) || rawName;
      if (!parentMap[parent]) parentMap[parent] = {};
      if (!parentMap[parent][key]) {
        parentMap[parent][key] = { display: cleaned, amounts: new Array(periods.length).fill(0) };
      } else {
        const prev = parentMap[parent][key].display;
        if (cleaned.length > prev.length || (cleaned !== cleaned.toUpperCase() && prev === prev.toUpperCase())) {
          parentMap[parent][key].display = cleaned;
        }
      }
      parentMap[parent][key].amounts[pi] += parseFloat(li.amount) || 0;
    });
  });

  // Safety net: merge any remaining duplicates where one key is a "prefix +
  // separator + other key" variant that the regex didn't catch.
  suffixMergePass(parentMap);

  const parentTotals = {};
  Object.keys(parentMap).forEach(p => {
    parentTotals[p] = new Array(periods.length).fill(0);
    Object.values(parentMap[p]).forEach(entry => entry.amounts.forEach((v, i) => parentTotals[p][i] += v));
  });

  // Sort parents by grand total (not just latest period) so the big ones always
  // float to the top regardless of which periods are selected.
  const parents = Object.keys(parentMap).sort((a, b) => {
    const ta = parentTotals[a].reduce((s,v)=>s+v,0);
    const tb = parentTotals[b].reduce((s,v)=>s+v,0);
    return tb - ta;
  });
  const periodLabels = periods.map(p => p.period_label || p.period_start || 'Period');
  const grandTotalAll = parents.reduce((s, p) => s + parentTotals[p].reduce((a,b)=>a+b,0), 0);

  // Delta helper — for expenses, up is bad (red), down is good (green).
  const deltaBadge = (vals, i) => {
    if (i === 0) return '<span style="color:var(--text-muted);font-size:10px;">—</span>';
    const prev = vals[i-1], curr = vals[i];
    if (prev === 0 && curr === 0) return '<span style="color:var(--text-muted);font-size:10px;">—</span>';
    if (prev === 0 && curr > 0) return '<span style="color:var(--text-muted);font-size:10px;">new</span>';
    if (curr === 0 && prev > 0) return '<span style="color:#4caf50;font-size:10px;font-weight:600;">▼100%</span>';
    const d = (curr - prev) / prev * 100;
    const up = d >= 0;
    return `<span style="color:${up?'#e74c3c':'#4caf50'};font-size:10px;font-weight:600;">${up?'▲':'▼'}${Math.abs(d).toFixed(0)}%</span>`;
  };

  // Legend (colored dots = period tone ramp)
  const legendHtml = `
    <div style="display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center;font-size:11px;color:var(--text-muted);padding-bottom:10px;border-bottom:1px solid var(--border);margin-bottom:12px;">
      <span style="text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Periods</span>
      ${periodLabels.map((l, i) => `<span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:9px;height:9px;border-radius:50%;background:${periodTone(i, periods.length)};"></span>${esc(l)}</span>`).join('')}
    </div>`;

  // ------------------------------------------------------------------
  // Summary card — one block per category, periods as aligned rows inside a grid.
  // Grid columns: [period label] [bar (flex)] [$ amount] [Δ%]
  // ------------------------------------------------------------------
  const summaryHtml = `
    <div class="card" style="margin-top:14px;">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <h3 style="margin:0;">Expenses by Category</h3>
        <div style="font-size:12px;color:var(--text-muted);font-variant-numeric:tabular-nums;">
          ${parents.length} categor${parents.length!==1?'ies':'y'} · <strong style="color:var(--text);">${money(grandTotalAll)}</strong> combined
        </div>
      </div>
      <div style="padding:14px 18px;">
        ${legendHtml}
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${parents.map(parent => {
            const vals = parentTotals[parent];
            const maxRow = Math.max(...vals, 1);
            const color = categoryColor(parent);
            const itemCount = Object.keys(parentMap[parent]).length;
            const catTotal = vals.reduce((a,b)=>a+b,0);
            return `
              <div style="padding:12px 14px;background:var(--surface-subtle);border-radius:8px;border-left:3px solid ${color};">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:10px;">
                  <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1;">
                    <span style="width:10px;height:10px;border-radius:50%;background:${color};box-shadow:0 0 10px ${categoryColor(parent,0.4)};flex-shrink:0;"></span>
                    <span style="font-weight:600;font-size:14px;">${esc(parent)}</span>
                    <span style="font-size:11px;color:var(--text-muted);">${itemCount} line${itemCount!==1?'s':''}</span>
                  </div>
                  <div style="font-size:14px;font-variant-numeric:tabular-nums;font-weight:700;color:${color};flex-shrink:0;">
                    ${money(catTotal)}
                  </div>
                </div>
                <div style="display:grid;grid-template-columns:minmax(100px,max-content) 1fr minmax(100px,max-content) minmax(56px,max-content);column-gap:12px;row-gap:5px;align-items:center;font-size:12px;font-variant-numeric:tabular-nums;">
                  ${vals.map((v, i) => {
                    const pct = (v / maxRow * 100).toFixed(1);
                    return `
                      <div style="color:${periodTone(i, periods.length)};font-size:10px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;white-space:nowrap;">${esc(periodLabels[i])}</div>
                      <div style="height:12px;background:var(--surface);border-radius:6px;overflow:hidden;">
                        <div style="height:100%;width:${pct}%;background:linear-gradient(90deg, ${categoryColor(parent,0.5)}, ${color});border-radius:6px;transition:width 0.4s ease;"></div>
                      </div>
                      <div style="color:${periodTone(i, periods.length)};font-weight:600;text-align:right;white-space:nowrap;">${money(v)}</div>
                      <div style="text-align:right;">${deltaBadge(vals, i)}</div>
                    `;
                  }).join('')}
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>
    </div>`;

  // ------------------------------------------------------------------
  // Drill-down — each category as a collapsible detail block listing line items
  // with the same grid structure as the summary (period | bar | $ | Δ%).
  // ------------------------------------------------------------------
  const drillHtml = `
    <div class="card" style="margin-top:14px;">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">
        <h3 style="margin:0;">Line Item Detail</h3>
        <span style="font-size:11px;color:var(--text-muted);">Click a category to expand</span>
      </div>
      <div style="padding:8px 14px;">
        ${parents.map(parent => {
          const entries = Object.values(parentMap[parent])
            .map(e => ({ name: e.display, amounts: e.amounts, total: e.amounts.reduce((s,v)=>s+v,0) }))
            .filter(e => e.total !== 0)
            .sort((a,b) => b.total - a.total);
          const catTotal = entries.reduce((s,e)=>s+e.total,0);
          const color = categoryColor(parent);
          const maxItem = Math.max(...entries.flatMap(e => e.amounts), 1);
          return `
            <details style="margin:6px 0;border:1px solid var(--border);border-radius:8px;overflow:hidden;">
              <summary style="padding:10px 14px;background:var(--surface-subtle);cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;user-select:none;gap:10px;">
                <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1;">
                  <span style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;"></span>
                  <strong>${esc(parent)}</strong>
                  <span style="font-size:11px;color:var(--text-muted);">${entries.length} item${entries.length!==1?'s':''}</span>
                </div>
                <div style="font-size:13px;font-variant-numeric:tabular-nums;font-weight:700;color:${color};flex-shrink:0;">${money(catTotal)}</div>
              </summary>
              <div style="padding:8px 14px 12px;">
                ${entries.map(it => `
                  <div style="padding:9px 0;border-bottom:1px solid var(--border);">
                    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;gap:10px;">
                      <span style="font-size:13px;font-weight:500;">${esc(it.name)}</span>
                      <span style="font-size:13px;font-variant-numeric:tabular-nums;font-weight:600;">${money(it.total)}</span>
                    </div>
                    <div style="display:grid;grid-template-columns:minmax(95px,max-content) 1fr minmax(95px,max-content) minmax(50px,max-content);column-gap:10px;row-gap:4px;align-items:center;font-size:11px;font-variant-numeric:tabular-nums;">
                      ${it.amounts.map((v, i) => {
                        const pct = (v / maxItem * 100).toFixed(1);
                        return `
                          <div style="color:${periodTone(i, periods.length)};font-size:9px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;white-space:nowrap;">${esc(periodLabels[i])}</div>
                          <div style="height:8px;background:var(--surface);border-radius:4px;overflow:hidden;">
                            <div style="height:100%;width:${pct}%;background:linear-gradient(90deg, ${categoryColor(parent,0.45)}, ${color});border-radius:4px;"></div>
                          </div>
                          <div style="color:${periodTone(i, periods.length)};text-align:right;white-space:nowrap;">${money(v)}</div>
                          <div style="text-align:right;">${deltaBadge(it.amounts, i)}</div>
                        `;
                      }).join('')}
                    </div>
                  </div>
                `).join('')}
              </div>
            </details>`;
        }).join('')}
      </div>
    </div>`;

  // Snapshot manager (unchanged list at bottom — always shows ALL snapshots, not
  // the filtered subset, so the user can still delete hidden ones)
  const snapsHtml = `
    <div class="card" style="margin-top:20px;padding:14px 18px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <h3 style="margin:0;font-size:14px;">Imported Snapshots</h3>
        <span style="font-size:11px;color:var(--text-muted);">${expSnaps.length} total</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        ${expSnaps.map(s => `
          <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--surface-subtle);border-radius:6px;font-size:12px;">
            <strong>${esc(s.period_label || '?')}</strong>
            <span style="color:var(--text-muted);">${money(s.total_expenses)}</span>
            <span style="color:var(--text-muted);font-size:10px;">${esc(s.source_file||'')}</span>
            <button class="btn-icon" onclick="deleteExpenseSnapshot('${s.id}')" title="Delete">×</button>
          </div>
        `).join('')}
      </div>
    </div>`;

  return toolbarHtml + summaryHtml + drillHtml + snapsHtml;
}

// Tone ramp for period comparison (older=dim, newer=vivid)
function periodTone(i, total) {
  if (total === 1) return 'var(--warning-text, #e67e22)';
  const pct = i / (total - 1); // 0..1
  // older = teal/blue, newer = orange/gold
  const hue = 210 - pct * 180; // 210 -> 30
  const sat = 45 + pct * 25;
  const light = 55;
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

async function deleteExpenseSnapshot(id) {
  if (!confirm('Delete this expense snapshot?')) return;
  await window.api.deleteExpenseSnapshot(id);
  renderPlTab();
}

async function renderPlTab() {
  const container = document.getElementById('plContent');
  if (!container) return;
  container.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:40px 0;">Loading…</div>';

  const [snapshotsRes, expSnapsRes, invoicesRes] = await Promise.all([
    window.api.getPlSnapshots(),
    window.api.getExpenseSnapshots(),
    window.api.getInvoices({})
  ]);

  const snapshots = (snapshotsRes?.data || []).sort((a, b) => (a.month || '') > (b.month || '') ? 1 : -1);
  const expSnaps = expSnapsRes?.data || [];
  const allInvoices = invoicesRes?.data || [];

  // Build revenue by month from invoices — exclude future-dated, cancelled, or incomplete
  const todayStr_pl = new Date().toISOString().slice(0, 10);
  const revByMonth = {};
  allInvoices.forEach(inv => {
    const d = inv.svc_date || (inv.created_at ? inv.created_at.slice(0, 10) : '');
    if (!d) return;
    if (d > todayStr_pl) return;
    if (inv.cancelled === true) return;
    const key = d.slice(0, 7);
    revByMonth[key] = (revByMonth[key] || 0) + (parseFloat(inv.total) || 0);
  });

  // Expense by month from QB snapshots
  const expByMonth = {};
  const catByMonth = {}; // month -> [{name,group,amount}]
  snapshots.forEach(s => {
    expByMonth[s.month] = parseFloat(s.total_expenses) || 0;
    catByMonth[s.month] = Array.isArray(s.categories) ? s.categories : [];
  });

  // Expense by quarter from AI-imported PDF snapshots (add on top where available)
  const expByQuarter = {};
  const catByQuarter = {};
  const revByQuarter = {};
  // Aggregate monthly data to quarter
  const allMonthKeys = new Set([
    ...snapshots.map(s => s.month),
    ...Object.keys(revByMonth)
  ]);
  [...allMonthKeys].forEach(m => {
    const q = monthToQuarter(m);
    revByQuarter[q] = (revByQuarter[q] || 0) + (revByMonth[m] || 0);
    expByQuarter[q] = (expByQuarter[q] || 0) + (expByMonth[m] || 0);
    if (catByMonth[m]) {
      catByQuarter[q] = catByQuarter[q] || [];
      catByMonth[m].forEach(c => catByQuarter[q].push(c));
    }
  });
  // Normalize any "quarter-ish" label/date into the canonical YYYY-QN key.
  // Accepts: "2025-Q1", "2025 Q1", "Q1 2025", "Jan-Mar 25", "Oct-Dec 2025", plus period_start fallback.
  const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  function expandYear(y) {
    if (!y) return null;
    y = String(y);
    if (y.length === 4) return y;
    if (y.length === 2) return '20' + y;
    return null;
  }
  function normalizeQuarterKey(s) {
    const raw = (s.period_label || '').trim();
    let m = raw.match(/^(\d{4})-Q([1-4])$/);
    if (m) return `${m[1]}-Q${m[2]}`;
    m = raw.match(/(\d{4})\s*[-\s]?\s*Q([1-4])/i) || raw.match(/Q([1-4])[\s-]*(\d{4})/i);
    if (m) {
      const y = m[1].length === 4 ? m[1] : m[2];
      const q = m[1].length === 4 ? m[2] : m[1];
      return `${y}-Q${q}`;
    }
    // "Jan-Mar 25", "Oct-Dec 2025", "Apr - Jun 25"
    m = raw.toLowerCase().match(/([a-z]{3})\s*[-–]\s*([a-z]{3})[\s,]+(\d{2,4})/);
    if (m) {
      const m1 = MONTHS[m[1]], m2 = MONTHS[m[2]];
      const y = expandYear(m[3]);
      if (m1 && m2 && y && (m2 - m1) === 2 && ((m1 - 1) % 3) === 0) {
        const q = Math.floor((m1 - 1) / 3) + 1;
        return `${y}-Q${q}`;
      }
    }
    // period_start (YYYY-MM-DD) fallback
    if (s.period_start && /^\d{4}-\d{2}/.test(s.period_start)) {
      const y = s.period_start.slice(0, 4);
      const mo = parseInt(s.period_start.slice(5, 7), 10);
      const me = s.period_end && /^\d{4}-\d{2}/.test(s.period_end) ? parseInt(s.period_end.slice(5, 7), 10) : null;
      // Only treat as a quarter if the span is actually 3 months aligned on a quarter boundary
      if (mo >= 1 && mo <= 12 && ((mo - 1) % 3) === 0 && (!me || me - mo === 2)) {
        const q = Math.floor((mo - 1) / 3) + 1;
        return `${y}-Q${q}`;
      }
    }
    return null;
  }
  function normalizeYearKey(s) {
    // period_start wins
    if (s.period_start && /^\d{4}/.test(s.period_start)) return s.period_start.slice(0, 4);
    const raw = String(s.period_label || '');
    // Look for 4-digit year first, then 2-digit
    let m = raw.match(/(20\d{2})/);
    if (m) return m[1];
    // "Jan-Dec 24" / "Jan-Dec 2025"
    m = raw.toLowerCase().match(/jan\s*[-–]\s*dec[\s,]+(\d{2,4})/);
    if (m) return expandYear(m[1]);
    // Bare 2-digit year at end
    m = raw.match(/\b(\d{2})\s*$/);
    if (m) return expandYear(m[1]);
    return null;
  }

  // AI expense snapshots: add expenses + fallback revenue (for pre-TankTrack years)
  expSnaps.forEach(s => {
    const ptype = (s.period_type || '').toLowerCase();
    const isQuarterType = ptype === 'quarter' || ptype === 'quarterly' || ptype.startsWith('q');
    if (isQuarterType) {
      const key = normalizeQuarterKey(s);
      if (!key) return;
      expByQuarter[key] = parseFloat(s.total_expenses) || expByQuarter[key] || 0;
      catByQuarter[key] = Array.isArray(s.line_items) ? s.line_items.map(li => ({ name: li.name, amount: li.amount, parent_category: li.parent_category }))
        : (Array.isArray(s.categories) ? s.categories : (catByQuarter[key] || []));
      if (s.use_income_as_revenue && s.total_income > 0) {
        revByQuarter[key] = parseFloat(s.total_income);
      }
    }
    // Yearly snapshots are NOT distributed into quarters/months — they live only in year view.
    // Users who want finer granularity should upload quarterly PDFs.
  });

  const months = [...allMonthKeys].sort();

  if (months.length === 0 && expSnaps.length === 0) {
    container.innerHTML = `
      <div class="card" style="text-align:center;padding:40px;">
        <p style="color:var(--text-muted);">No P&L data yet.</p>
        <p style="color:var(--text-muted);font-size:13px;">Import a QB export or upload a quarterly expense PDF to get started.</p>
      </div>`;
    return;
  }

  // Determine quarter keys
  const allQuarterKeys = new Set(Object.keys(revByQuarter).concat(Object.keys(expByQuarter)));
  const quarters = [...allQuarterKeys].sort();

  // Build yearly aggregates from quarterly
  const revByYear = {}, expByYear = {}, catByYear = {};
  quarters.forEach(qk => {
    const y = qk.slice(0, 4);
    revByYear[y] = (revByYear[y] || 0) + (revByQuarter[qk] || 0);
    expByYear[y] = (expByYear[y] || 0) + (expByQuarter[qk] || 0);
    if (catByQuarter[qk]) {
      catByYear[y] = (catByYear[y] || []).concat(catByQuarter[qk]);
    }
  });
  // AI yearly snapshots: use totals directly (overrides quartered-fill)
  expSnaps.forEach(s => {
    const ptype = (s.period_type || '').toLowerCase();
    const isYearType = ptype === 'year' || ptype === 'yearly' || ptype === 'annual';
    const y = normalizeYearKey(s);
    if (isYearType && y) {
      expByYear[y] = parseFloat(s.total_expenses) || expByYear[y] || 0;
      if (s.use_income_as_revenue && s.total_income > 0) {
        revByYear[y] = parseFloat(s.total_income);
      }
      const lines = Array.isArray(s.line_items) ? s.line_items : [];
      if (lines.length > 0) {
        catByYear[y] = lines.map(li => ({ name: li.name, amount: li.amount, parent_category: li.parent_category }));
      }
    }
  });
  const years = Object.keys({ ...revByYear, ...expByYear }).sort();

  const isYear = plViewMode === 'year';
  const isQuarter = plViewMode === 'quarter';
  // Honor the expense-filter's Show limit for this summary too. limit === 0 means
  // "show all" (no slicing). This keeps the bottom summary in sync with the
  // Expenses-by-Category filter toolbar so "All" / "Last N" work uniformly.
  const plLimit = getExpenseFilterState().limit;
  const applyPlLimit = arr => plLimit > 0 ? arr.slice(-plLimit) : arr;
  const displayKeys = isYear ? applyPlLimit(years) : (isQuarter ? applyPlLimit(quarters) : applyPlLimit(months));
  const revBy = isYear ? revByYear : (isQuarter ? revByQuarter : revByMonth);
  const expBy = isYear ? expByYear : (isQuarter ? expByQuarter : expByMonth);
  const catBy = isYear ? catByYear : (isQuarter ? catByQuarter : catByMonth);

  const snapshotMap = {};
  snapshots.forEach(s => { snapshotMap[s.month] = s; });

  function fmt(n) { return '$' + n.toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2}); }
  function fmtKey(key) {
    if (!key) return '';
    if (/^\d{4}$/.test(key)) return key; // yearly
    if (key.includes('Q')) return key; // already quarterly
    const [y, m] = key.split('-');
    const names = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return (names[parseInt(m)] || m) + ' ' + y.slice(2);
  }
  const fmtM = fmtKey; // backwards-compat alias

  // Current + comparison period
  const lastKey = displayKeys[displayKeys.length - 1];
  let compareKey = null;
  if (plCompareMode === 'prior') {
    compareKey = isYear ? String(parseInt(lastKey)-1) : (isQuarter ? priorQuarter(lastKey) : priorMonth(lastKey));
  } else if (plCompareMode === 'yoy') {
    compareKey = isYear ? String(parseInt(lastKey)-1) : (isQuarter ? yoyQuarter(lastKey) : yoyMonth(lastKey));
  }

  const lastRev = revBy[lastKey] || 0;
  const lastExp = expBy[lastKey] || 0;
  const lastNet = lastRev - lastExp;
  const lastMargin = lastRev > 0 ? ((lastNet / lastRev) * 100).toFixed(1) : '—';

  const cmpRev = compareKey ? (revBy[compareKey] || 0) : 0;
  const cmpExp = compareKey ? (expBy[compareKey] || 0) : 0;
  const cmpNet = cmpRev - cmpExp;

  function deltaHtml(curr, prev) {
    if (!compareKey || prev === 0) return '';
    const pct = ((curr - prev) / Math.abs(prev)) * 100;
    const up = pct >= 0;
    const color = up ? 'var(--success-text, #27ae60)' : 'var(--danger-text, #e74c3c)';
    return `<div style="font-size:11px;color:${color};margin-top:4px;">${up?'▲':'▼'} ${Math.abs(pct).toFixed(1)}% vs ${fmtKey(compareKey)}</div>`;
  }

  const totalRevAllTime = Object.values(revByMonth).reduce((s, v) => s + v, 0);
  const totalExpAllTime = Object.values(expByMonth).reduce((s, v) => s + v, 0)
    + expSnaps.filter(s => s.period_type === 'quarter').reduce((s, e) => s + (parseFloat(e.total_expenses) || 0), 0);
  const totalNetAllTime = totalRevAllTime - totalExpAllTime;

  // Bar chart: find max value for scaling
  const chartVals = displayKeys.map(k => ({
    key: k,
    rev: revBy[k] || 0,
    exp: expBy[k] || 0,
    net: (revBy[k] || 0) - (expBy[k] || 0)
  }));
  const maxVal = Math.max(...chartVals.map(v => Math.max(v.rev, v.exp)), 1);

  // Expense categories from last period
  let expCatHtml = '';
  const lastCategories = catBy[lastKey] || [];
  // merge duplicate category names (normalized — strips account-code prefixes
  // like "823 · " so the same line doesn't appear twice across imports)
  const catMerged = {};
  lastCategories.forEach(c => {
    const raw = c.name || 'Uncategorized';
    const k = lineItemKey(raw) || raw.toLowerCase();
    const display = cleanLineItemName(raw) || raw;
    if (!catMerged[k]) catMerged[k] = { display, amount: 0 };
    if (display.length > catMerged[k].display.length) catMerged[k].display = display;
    catMerged[k].amount += (parseFloat(c.amount) || 0);
  });
  const catEntries = Object.values(catMerged).map(e => ({ name: e.display, amount: e.amount })).filter(c => c.amount > 0).sort((a, b) => b.amount - a.amount);
  if (catEntries.length > 0) {
    const maxCat = Math.max(...catEntries.map(c => c.amount));
    expCatHtml = `
      <div class="card" style="margin-top:20px;">
        <div class="card-header">
          <h3>Expense Breakdown — ${fmtKey(lastKey)}</h3>
        </div>
        <div style="padding:16px;">
          ${catEntries.map(c => {
            const pct = maxCat > 0 ? (c.amount / maxCat * 100).toFixed(1) : 0;
            return `
            <div style="margin-bottom:10px;">
              <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px;">
                <span>${c.name}</span><span style="font-weight:600;">${fmt(c.amount)}</span>
              </div>
              <div style="background:var(--surface-subtle);border-radius:4px;height:8px;overflow:hidden;">
                <div style="background:var(--warning-text, #e67e22);height:100%;width:${pct}%;border-radius:4px;transition:width 0.4s;"></div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  // Summary table rows
  const tableRows = displayKeys.map(k => {
    const rev = revBy[k] || 0;
    const exp = expBy[k] || 0;
    const net = rev - exp;
    const margin = rev > 0 ? ((net / rev) * 100).toFixed(1) + '%' : '—';
    const netColor = net >= 0 ? 'var(--success-text, #27ae60)' : 'var(--danger-text, #e74c3c)';
    return `<tr>
      <td>${fmtKey(k)}</td>
      <td style="text-align:right;">${rev > 0 ? fmt(rev) : '<span style="color:var(--text-muted);">—</span>'}</td>
      <td style="text-align:right;">${exp > 0 ? fmt(exp) : '<span style="color:var(--text-muted);">No data</span>'}</td>
      <td style="text-align:right;color:${netColor};font-weight:600;">${(rev > 0 || exp > 0) ? fmt(net) : '—'}</td>
      <td style="text-align:right;">${margin}</td>
    </tr>`;
  }).reverse().join('');

  container.innerHTML = `
    <!-- Controls -->
    <div class="card" style="padding:12px 16px;margin-bottom:20px;display:flex;flex-wrap:wrap;gap:16px;align-items:center;">
      <div style="display:flex;gap:4px;background:var(--surface-subtle);padding:3px;border-radius:8px;">
        <button class="btn btn-sm ${isYear?'btn-primary':'btn-secondary'}" onclick="plViewMode='year';renderPlTab();" style="border:none;">Yearly</button>
        <button class="btn btn-sm ${isQuarter?'btn-primary':'btn-secondary'}" onclick="plViewMode='quarter';renderPlTab();" style="border:none;">Quarterly</button>
        <button class="btn btn-sm ${(!isYear && !isQuarter)?'btn-primary':'btn-secondary'}" onclick="plViewMode='month';renderPlTab();" style="border:none;">Monthly</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <label style="font-size:13px;color:var(--text-muted);">Compare to:</label>
        <select onchange="plCompareMode=this.value;renderPlTab();" style="padding:5px 8px;">
          <option value="none" ${plCompareMode==='none'?'selected':''}>None</option>
          <option value="prior" ${plCompareMode==='prior'?'selected':''}>Prior ${isYear?'year':(isQuarter?'quarter':'month')}</option>
          ${isYear?'':`<option value="yoy" ${plCompareMode==='yoy'?'selected':''}>Same ${isQuarter?'quarter':'month'} last year</option>`}
        </select>
      </div>
      <div style="margin-left:auto;font-size:12px;color:var(--text-muted);">Showing ${displayKeys.length} ${isYear?'years':(isQuarter?'quarters':'months')}</div>
    </div>

    <!-- KPI cards -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px;">
      <div class="card" style="padding:16px;text-align:center;">
        <div style="font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Revenue (${fmtKey(lastKey)})</div>
        <div style="font-size:22px;font-weight:700;color:var(--success-text, #27ae60);">${fmt(lastRev)}</div>
        ${deltaHtml(lastRev, cmpRev)}
      </div>
      <div class="card" style="padding:16px;text-align:center;">
        <div style="font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Expenses (${fmtKey(lastKey)})</div>
        <div style="font-size:22px;font-weight:700;color:var(--warning-text, #e67e22);">${lastExp > 0 ? fmt(lastExp) : 'No data'}</div>
        ${deltaHtml(lastExp, cmpExp)}
      </div>
      <div class="card" style="padding:16px;text-align:center;">
        <div style="font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Net Profit (${fmtKey(lastKey)})</div>
        <div style="font-size:22px;font-weight:700;color:${lastNet >= 0 ? 'var(--success-text, #27ae60)' : 'var(--danger-text, #e74c3c)'};">${lastExp > 0 ? fmt(lastNet) : '—'}</div>
        ${deltaHtml(lastNet, cmpNet)}
      </div>
      <div class="card" style="padding:16px;text-align:center;">
        <div style="font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Margin (${fmtKey(lastKey)})</div>
        <div style="font-size:22px;font-weight:700;">${lastMargin}${lastMargin !== '—' ? '%' : ''}</div>
      </div>
    </div>

    <!-- Bar chart -->
    <div class="card" style="margin-bottom:20px;">
      <div class="card-header"><h3>Revenue vs Expenses — ${plLimit > 0 ? 'Last '+displayKeys.length : 'All '+displayKeys.length} ${isYear?'Years':(isQuarter?'Quarters':'Months')}</h3></div>
      <div style="padding:16px 16px 0;">
        <div style="display:flex;align-items:flex-end;gap:4px;height:160px;overflow-x:auto;">
          ${chartVals.map(v => {
            const revH = Math.round((v.rev / maxVal) * 140);
            const expH = Math.round((v.exp / maxVal) * 140);
            return `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;min-width:44px;flex:1;">
              <div style="display:flex;align-items:flex-end;gap:2px;height:140px;">
                <div data-tip="Revenue: ${fmt(v.rev)}" style="width:14px;height:${revH}px;background:var(--success-text, #27ae60);border-radius:2px 2px 0 0;cursor:pointer;"></div>
                <div data-tip="Expenses: ${fmt(v.exp)}" style="width:14px;height:${expH > 0 ? expH : 1}px;background:${v.exp > 0 ? 'var(--warning-text, #e67e22)' : 'var(--border)'};border-radius:2px 2px 0 0;cursor:pointer;opacity:${v.exp > 0 ? 1 : 0.3};"></div>
              </div>
              <div style="font-size:10px;color:var(--text-muted);text-align:center;white-space:nowrap;">${fmtKey(v.key)}</div>
            </div>`;
          }).join('')}
        </div>
        <div style="display:flex;gap:16px;padding:8px 0;font-size:12px;">
          <span><span style="display:inline-block;width:10px;height:10px;background:var(--success-text, #27ae60);border-radius:2px;margin-right:4px;"></span>Revenue</span>
          <span><span style="display:inline-block;width:10px;height:10px;background:var(--warning-text, #e67e22);border-radius:2px;margin-right:4px;"></span>Expenses</span>
        </div>
      </div>
    </div>

    <!-- Net profit trend -->
    <div class="card" style="margin-bottom:20px;">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">
        <h3>Net Profit Trend</h3>
        <span style="font-size:11px;color:var(--text-muted);">Only periods with both revenue & expense data</span>
      </div>
      <div style="padding:16px;">
        ${(() => {
          // Only render periods where BOTH revenue and expense are known —
          // otherwise net is meaningless (e.g. current quarter has TankTrack
          // revenue but no uploaded PDF expenses yet).
          const complete = chartVals.filter(v => v.rev > 0 && v.exp > 0);
          if (complete.length === 0) {
            return `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px;">
              Upload expense PDFs for periods that also have revenue to see net profit trend.
            </div>`;
          }
          const maxAbs = Math.max(...complete.map(v => Math.abs(v.net)), 1);
          // Show all periods in the list but grey-out incomplete ones
          return chartVals.map(v => {
            const hasBoth = v.rev > 0 && v.exp > 0;
            if (!hasBoth) {
              return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;opacity:0.45;">
                <div style="width:60px;font-size:12px;color:var(--text-muted);text-align:right;flex-shrink:0;">${fmtKey(v.key)}</div>
                <div style="flex:1;background:var(--surface-subtle);border-radius:4px;height:20px;overflow:hidden;position:relative;display:flex;align-items:center;padding:0 8px;">
                  <span style="font-size:11px;color:var(--text-muted);font-style:italic;">${v.exp === 0 ? 'No expense data uploaded' : 'No revenue yet'}</span>
                </div>
                <div style="width:90px;font-size:12px;color:var(--text-muted);text-align:right;flex-shrink:0;">—</div>
              </div>`;
            }
            const pct = (Math.abs(v.net) / maxAbs * 100).toFixed(1);
            const color = v.net >= 0 ? 'var(--success-text, #27ae60)' : 'var(--danger-text, #e74c3c)';
            return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
              <div style="width:60px;font-size:12px;color:var(--text-muted);text-align:right;flex-shrink:0;">${fmtKey(v.key)}</div>
              <div style="flex:1;background:var(--surface-subtle);border-radius:4px;height:20px;overflow:hidden;position:relative;">
                <div style="position:absolute;left:0;top:0;height:100%;width:${pct}%;background:${color};border-radius:4px;"></div>
              </div>
              <div style="width:90px;font-size:12px;font-weight:600;color:${color};text-align:right;flex-shrink:0;">${fmt(v.net)}</div>
            </div>`;
          }).join('');
        })()}
      </div>
    </div>

    ${renderExpenseBreakdown(expSnaps)}

    <!-- Period summary table -->
    <div class="card" style="margin-top:20px;">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">
        <h3>${isYear?'Yearly':(isQuarter?'Quarterly':'Monthly')} Summary</h3>
        <span style="font-size:12px;color:var(--text-muted);">All time: Revenue ${fmt(totalRevAllTime)} | Expenses ${fmt(totalExpAllTime)} | Net ${fmt(totalNetAllTime)}</span>
      </div>
      <table class="data-table">
        <thead><tr>
          <th>${isYear?'Year':(isQuarter?'Quarter':'Month')}</th>
          <th style="text-align:right;">Revenue</th>
          <th style="text-align:right;">Expenses</th>
          <th style="text-align:right;">Net Profit</th>
          <th style="text-align:right;">Margin</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `;
}

function setReportPeriod(from, to) {
  reportDateFrom = from;
  reportDateTo = to;
  loadReports();
}

function setComparePreset(kind) {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  if (kind === 'week_prior') {
    const mon = getMonday(now);
    const sun = new Date(mon); sun.setDate(mon.getDate()+6);
    reportDateFrom = ymd(mon); reportDateTo = ymd(sun);
    reportCompareMode = 'prior';
  } else if (kind === 'month_prior') {
    const f = new Date(now.getFullYear(), now.getMonth(), 1);
    const t = new Date(now.getFullYear(), now.getMonth()+1, 0);
    reportDateFrom = ymd(f); reportDateTo = ymd(t);
    reportCompareMode = 'prior';
  } else if (kind === 'month_yoy') {
    const f = new Date(now.getFullYear(), now.getMonth(), 1);
    const t = new Date(now.getFullYear(), now.getMonth()+1, 0);
    reportDateFrom = ymd(f); reportDateTo = ymd(t);
    reportCompareMode = 'yoy';
  } else if (kind === 'quarter_prior' || kind === 'quarter_yoy') {
    const q = Math.floor(now.getMonth()/3);
    const f = new Date(now.getFullYear(), q*3, 1);
    const t = new Date(now.getFullYear(), q*3+3, 0);
    reportDateFrom = ymd(f); reportDateTo = ymd(t);
    reportCompareMode = kind === 'quarter_yoy' ? 'yoy' : 'prior';
  } else if (kind === 'custom') {
    // Activate custom mode. If compare dates aren't set, pre-fill with same range a year prior as a sensible starting point.
    reportCompareMode = 'custom';
    if (!reportCompareFrom || !reportCompareTo) {
      if (reportDateFrom && reportDateTo) {
        const shiftYear = (dStr, years) => {
          const d = new Date(dStr + 'T00:00:00');
          d.setFullYear(d.getFullYear() + years);
          return ymd(d);
        };
        reportCompareFrom = shiftYear(reportDateFrom, -1);
        reportCompareTo = shiftYear(reportDateTo, -1);
      }
    }
  }
  loadReports();
}

function swapCompareRanges() {
  const tmpFrom = reportDateFrom, tmpTo = reportDateTo;
  reportDateFrom = reportCompareFrom;
  reportDateTo = reportCompareTo;
  reportCompareFrom = tmpFrom;
  reportCompareTo = tmpTo;
  loadReports();
}

async function exportReportPdf() {
  // Export the current report tab data as a CSV.
  // PDF export is replaced with CSV — far more useful for accountants/spreadsheet workflows.
  try {
    const tab = reportTab || 'revenue';
    const dateFrom = reportDateFrom || '';
    const dateTo = reportDateTo || '';

    const { data: invoices } = await window.api.getInvoices({
      dateFrom, dateTo, cancelled: 'exclude'
    });
    if (!invoices || !invoices.length) {
      showToast('No data in selected date range to export.', 'info');
      return;
    }

    let rows = [];
    let filename = `report-${tab}-${dateFrom}-to-${dateTo}.csv`;

    if (tab === 'revenue' || tab === 'city') {
      rows.push(['Date', 'Invoice #', 'Customer', 'Property Address', 'City', 'Total', 'Amount Paid', 'Status', 'Tech', 'Truck', 'Service']);
      for (const inv of invoices) {
        rows.push([
          inv.svc_date || '',
          inv.invoice_number || '',
          inv.customer_name || inv.customers?.name || '',
          inv.property_address || '',
          inv.property_city || '',
          (inv.total || 0).toFixed(2),
          (inv.amount_paid || 0).toFixed(2),
          inv.payment_status || inv.status || '',
          inv.technician || inv.driver?.name || '',
          inv.truck || inv.vehicle?.name || '',
          inv.products_services || inv.job_codes || ''
        ]);
      }
    } else if (tab === 'ar') {
      // AR aging
      const { data: ar } = await window.api.getArReport();
      rows.push(['Customer', 'Phone', 'Email', 'Current', '30 days', '60 days', '90+ days', 'Total Outstanding', 'Oldest Invoice']);
      for (const r of (ar?.rows || [])) {
        rows.push([r.name, r.phone || '', r.email || '', (r.current||0).toFixed(2), (r.d30||0).toFixed(2), (r.d60||0).toFixed(2), (r.d90||0).toFixed(2), (r.total||0).toFixed(2), r.oldest || '']);
      }
      filename = `ar-aging-${new Date().toISOString().split('T')[0]}.csv`;
    } else if (tab === 'pl') {
      const { data: snaps } = await window.api.getExpenseSnapshots();
      rows.push(['Period', 'Type', 'Period Start', 'Period End', 'Total Income', 'Total Expenses', 'Net Income']);
      for (const s of (snaps || []).filter(x => !x.deleted_at)) {
        rows.push([s.period_label || '', s.period_type || '', s.period_start || '', s.period_end || '', (s.total_income || 0).toFixed(2), (s.total_expenses || 0).toFixed(2), (s.net_income || 0).toFixed(2)]);
      }
      filename = `pl-snapshots-${new Date().toISOString().split('T')[0]}.csv`;
    } else {
      showToast('Export not available for this tab yet.', 'info');
      return;
    }

    // Convert to CSV (escape commas/quotes/newlines)
    const csv = rows.map(row => row.map(cell => {
      const s = String(cell ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }).join(',')).join('\r\n');

    // Trigger download via Blob
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`Exported ${rows.length - 1} rows to ${filename}`, 'success');
  } catch (e) {
    showToast('Export failed: ' + e.message, 'error');
  }
}

async function generateStatement(sendEmail = false) {
  const customerId = document.getElementById('stmtCustomerId')?.value;
  const from = document.getElementById('stmtFrom')?.value;
  const to = document.getElementById('stmtTo')?.value;
  if (!customerId) { showToast('Please select a customer.', 'error'); return; }
  if (!from || !to) { showToast('Please select a date range.', 'error'); return; }

  const { data: customer } = await window.api.getCustomer(customerId);
  const { data: invoicesFull } = await window.api.getInvoices({ customerId, dateFrom: from, dateTo: to });
  const { data: payments } = await window.api.getPayments(customerId);
  const { data: settings } = await window.api.getSettings();
  const s = settings || {};

  const periodPayments = payments.filter(p => p.date >= from && p.date <= to);
  const totalCharged = invoicesFull.reduce((sum, i) => sum + (parseFloat(i.total) || 0), 0);
  const totalPaid = periodPayments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
  const balance = invoicesFull.reduce((sum, i) => sum + (parseFloat(i.total) || 0) - (parseFloat(i.amount_paid) || 0), 0);

  const fmt = v => '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
  <style>
    body{font-family:Arial,sans-serif;font-size:13px;color:#222;margin:0;padding:32px;}
    h1{font-size:22px;margin:0;} h2{font-size:15px;margin:0 0 4px;}
    .header{display:flex;justify-content:space-between;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid #1565c0;}
    table{width:100%;border-collapse:collapse;margin-bottom:20px;}
    th{background:#1565c0;color:white;padding:7px 10px;text-align:left;font-size:12px;}
    td{padding:6px 10px;border-bottom:1px solid #eee;font-size:12px;}
    .totals td{font-weight:700;border-top:2px solid #1565c0;background:#f5f5f5;}
    .balance{font-size:18px;font-weight:700;color:${balance>0?'#c62828':'#2e7d32'};text-align:right;margin-top:12px;}
  </style></head><body>
  <div class="header">
    <div>
      <h1>${esc(s.company_name || 'Interstate Septic')}</h1>
      ${s.address ? `<div>${esc(s.address)}</div>` : ''}
      ${s.phone ? `<div>${esc(s.phone)}</div>` : ''}
    </div>
    <div style="text-align:right;">
      <h2>STATEMENT</h2>
      <div><strong>Period:</strong> ${from} — ${to}</div>
      <div><strong>Date:</strong> ${formatDate(new Date())}</div>
    </div>
  </div>
  <div style="margin-bottom:20px;">
    <strong>Bill To:</strong><br>
    ${esc(customer.name)}<br>
    ${customer.address ? esc(customer.address) + '<br>' : ''}
    ${(customer.city||customer.state||customer.zip) ? esc((customer.city||'')+(customer.state?', '+customer.state:'')+(customer.zip?' '+customer.zip:'')) + '<br>' : ''}
    ${customer.email ? esc(customer.email) : ''}
  </div>
  <table>
    <thead><tr><th>Date</th><th>Invoice #</th><th>Description</th><th style="text-align:right;">Amount</th><th style="text-align:right;">Paid</th><th style="text-align:right;">Balance</th></tr></thead>
    <tbody>
      ${invoicesFull.length === 0 ? `<tr><td colspan="6" style="color:#999;text-align:center;">No invoices in this period.</td></tr>` :
        invoicesFull.map(i => {
          const bal = (parseFloat(i.total)||0) - (parseFloat(i.amount_paid)||0);
          return `<tr>
            <td>${i.svc_date||''}</td>
            <td>${esc(i.invoice_number||'')}</td>
            <td>${esc(i.service_type||i.job_type||'Service')}</td>
            <td style="text-align:right;">${fmt(i.total||0)}</td>
            <td style="text-align:right;color:#2e7d32;">${fmt(i.amount_paid||0)}</td>
            <td style="text-align:right;color:${bal>0?'#c62828':'inherit'};">${fmt(bal)}</td>
          </tr>`;
        }).join('')}
    </tbody>
    <tfoot class="totals"><tr>
      <td colspan="3">Totals</td>
      <td style="text-align:right;">${fmt(totalCharged)}</td>
      <td style="text-align:right;color:#2e7d32;">${fmt(totalPaid)}</td>
      <td style="text-align:right;">${fmt(balance)}</td>
    </tr></tfoot>
  </table>
  ${periodPayments.length > 0 ? `
  <h2 style="margin-bottom:8px;">Payments Received</h2>
  <table>
    <thead><tr><th>Date</th><th>Method</th><th>Reference</th><th style="text-align:right;">Amount</th></tr></thead>
    <tbody>${periodPayments.map(p => `<tr>
      <td>${p.date||''}</td><td>${esc(p.payment_method||'')}</td><td>${esc(p.reference||p.check_number||'')}</td>
      <td style="text-align:right;color:#2e7d32;">${fmt(p.amount||0)}</td>
    </tr>`).join('')}</tbody>
  </table>` : ''}
  <div class="balance">Balance Due: ${fmt(balance)}${balance < 0 ? ' (Credit)' : ''}</div>
  </body></html>`;

  const filename = `Statement_${esc(customer.name).replace(/\s+/g,'_')}_${from}_${to}.pdf`;
  const result = await window.api.generatePdf(html, filename, {});
  if (result?.path) {
    if (sendEmail && customer.email) {
      const subject = `Your Statement from ${s.company_name || 'Interstate Septic'} — ${from} to ${to}`;
      const body = `Dear ${customer.name},\n\nPlease find your account statement for ${from} to ${to} attached.\n\nBalance Due: ${fmt(balance)}\n\nThank you,\n${s.company_name || 'Interstate Septic'}`;
      await window.api.sendEmail(customer.email, subject, body, result.path);
      showToast('Statement emailed to ' + customer.email, 'success');
    } else {
      await window.api.openFile(result.path);
      showToast('Statement generated.', 'success');
    }
  } else {
    showToast(result?.error || 'Failed to generate PDF.', 'error');
  }
}

// ===== RECYCLING BIN =====
// ============================================================
// AUTOMATIC FILTER CLEANINGS (AFC)
// ============================================================

let _afcTab = 'leads'; // 'leads' | 'active'

async function loadAFC() {
  const page = document.getElementById('page-afc');
  if (!page) return;
  page.innerHTML = '<div class="empty-state"><div class="empty-icon">&#9203;</div><p>Loading...</p></div>';

  const [{ data: leads }, { data: afcs }] = await Promise.all([
    window.api.getFilterLeads({}),
    window.api.getAfcs({}),
  ]);

  const pendingLeads = leads.filter(l => l.status === 'pending');
  const hasAFCLeads = leads.filter(l => l.has_afc && l.status === 'pending');
  const activeAfcs = afcs.filter(a => a.status === 'active');
  const today = new Date().toISOString().split('T')[0];

  page.innerHTML = `
    <div style="display:flex;gap:0;height:calc(100vh - 120px);">
      <!-- SIDEBAR -->
      <div class="inv-filter-sidebar" style="min-width:180px;max-width:200px;">
        <strong style="font-size:12px;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:14px;">Filter Cleanings</strong>

        <button onclick="_afcTab='leads';loadAFC()" style="display:block;width:100%;text-align:left;padding:8px 10px;margin-bottom:4px;border-radius:5px;border:none;cursor:pointer;font-size:13px;background:${_afcTab==='leads'?'#1565c0':'transparent'};color:${_afcTab==='leads'?'white':'inherit'};font-weight:${_afcTab==='leads'?'600':'400'};">
          &#128276; Needs Follow-Up
          ${pendingLeads.length > 0 ? `<span style="background:${_afcTab==='leads'?'white':'#f44336'};color:${_afcTab==='leads'?'#1565c0':'white'};border-radius:10px;font-size:10px;padding:1px 6px;margin-left:4px;font-weight:700;">${pendingLeads.length}</span>` : ''}
        </button>

        <button onclick="_afcTab='active';loadAFC()" style="display:block;width:100%;text-align:left;padding:8px 10px;margin-bottom:4px;border-radius:5px;border:none;cursor:pointer;font-size:13px;background:${_afcTab==='active'?'#1565c0':'transparent'};color:${_afcTab==='active'?'white':'inherit'};font-weight:${_afcTab==='active'?'600':'400'};">
          &#10003; Active Cleanings
          ${activeAfcs.length > 0 ? `<span style="background:${_afcTab==='active'?'white':'#4caf50'};color:${_afcTab==='active'?'#1565c0':'white'};border-radius:10px;font-size:10px;padding:1px 6px;margin-left:4px;font-weight:700;">${activeAfcs.length}</span>` : ''}
        </button>

        <div style="margin-top:16px;padding-top:14px;border-top:1px solid #eee;font-size:11px;color:var(--text-light);">
          <div style="margin-bottom:6px;"><strong style="color:#f44336;">${pendingLeads.length}</strong> need follow-up</div>
          <div style="margin-bottom:6px;"><strong style="color:#4caf50;">${activeAfcs.length}</strong> active cleanings</div>
          <div><strong style="color:#ff9800;">${afcs.filter(a=>a.status==='active'&&a.next_service_date&&a.next_service_date<=today).length}</strong> overdue</div>
        </div>
      </div>

      <!-- MAIN -->
      <div style="flex:1;overflow:auto;padding:20px;">
        ${_afcTab === 'leads' ? renderAfcLeadsTab(leads) : renderAfcActiveTab(afcs, today)}
      </div>
    </div>`;
}

function renderAfcLeadsTab(leads) {
  const pending = leads.filter(l => l.status === 'pending');
  const other = leads.filter(l => l.status !== 'pending');

  if (leads.length === 0) return `
    <div class="empty-state">
      <div class="empty-icon">&#128388;</div>
      <p>No filter follow-ups yet.<br><small>When a tech taps "Flag Filter Cleaning Follow-Up" on a work order, it will appear here.</small></p>
    </div>`;

  const renderLead = (l) => {
    const statusColors = { pending:'#ff9800', approved:'#4caf50', declined:'#9e9e9e', no_answer:'#2196f3' };
    const statusLabels = { pending:'Needs Call', approved:'Cleaning Set Up', declined:'Declined', no_answer:'No Answer' };
    const sc = statusColors[l.status] || '#999';
    const sl = statusLabels[l.status] || l.status;
    const hasAFC = l.has_afc;
    return `
      <div style="background:white;border:1px solid #e0e0e0;border-left:4px solid ${l.status==='pending'?(hasAFC?'#4caf50':'#ff9800'):'#ccc'};border-radius:6px;padding:14px 16px;margin-bottom:10px;cursor:pointer;" onclick="openCustomerDetail('${l.customer_id}')">
        <div style="display:flex;align-items:flex-start;gap:12px;">
          <div style="flex:1;">
            <div style="font-weight:700;font-size:14px;">${esc(l.customer?.name || l.customer_name || '—')}</div>
            <div style="font-size:12px;color:var(--text-light);margin-top:2px;">${esc(l.property?.address || l.property_address || '')}${l.property?.city ? ', ' + esc(l.property.city) : ''}</div>
            ${hasAFC && l.status==='pending' ? `<div style="font-size:11px;color:#4caf50;margin-top:4px;font-weight:600;">&#10003; Already has an active Automatic Filter Cleaning</div>` : ''}
            <div style="font-size:11px;color:#888;margin-top:4px;">Filter flagged on: ${esc(l.scheduled_date || l.job?.scheduled_date || '')}</div>
            ${l.notes ? `<div style="font-size:11px;color:#555;margin-top:4px;font-style:italic;">${esc(l.notes)}</div>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
            <span style="background:${sc};color:white;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;">${sl}</span>
            <span style="font-size:10px;color:#aaa;">${l.created_at ? new Date(l.created_at).toLocaleDateString() : ''}</span>
            <button class="btn btn-secondary" style="font-size:11px;padding:3px 10px;" onclick="event.stopPropagation();openAfcLeadDetail('${l.id}')">Actions</button>
          </div>
        </div>
      </div>`;
  };

  return `
    <h3 style="margin:0 0 14px;font-size:16px;">&#128276; Needs Follow-Up (${pending.length})</h3>
    ${pending.length === 0 ? '<p style="color:var(--text-light);font-size:13px;">No pending follow-ups.</p>' : pending.map(renderLead).join('')}
    ${other.length > 0 ? `
      <h3 style="margin:20px 0 10px;font-size:14px;color:var(--text-light);">Resolved (${other.length})</h3>
      ${other.map(renderLead).join('')}
    ` : ''}`;
}

function renderAfcActiveTab(afcs, today) {
  const freqLabels = { '6_month':'Every 6 Months', '1_year':'Annually', '2_year':'Every 2 Years', 'custom':'Custom' };
  const active = afcs.filter(a => a.status === 'active');
  const paused = afcs.filter(a => a.status === 'paused');
  const cancelled = afcs.filter(a => a.status === 'cancelled');

  if (afcs.length === 0) return `
    <div class="empty-state">
      <div class="empty-icon">&#128388;</div>
      <p>No Automatic Filter Cleanings set up yet.</p>
    </div>`;

  const renderAfc = (a) => {
    const overdue = a.next_service_date && a.next_service_date < today && a.status === 'active';
    const soon = a.next_service_date && a.next_service_date >= today && a.next_service_date <= today.slice(0,7) + '-31' && a.status === 'active';
    const borderColor = overdue ? '#f44336' : soon ? '#ff9800' : a.status === 'active' ? '#4caf50' : '#ccc';
    return `
      <div style="background:white;border:1px solid #e0e0e0;border-left:4px solid ${borderColor};border-radius:6px;padding:14px 16px;margin-bottom:10px;cursor:pointer;" onclick="openAfcDetail('${a.id}')">
        <div style="display:flex;align-items:flex-start;gap:12px;">
          <div style="flex:1;">
            <div style="font-weight:700;font-size:14px;">${esc(a.customer?.name || '—')}</div>
            <div style="font-size:12px;color:var(--text-light);margin-top:2px;">${esc(a.property?.address || '')}${a.property?.city ? ', ' + esc(a.property.city) : ''}</div>
            <div style="display:flex;gap:12px;margin-top:6px;font-size:12px;">
              <span>&#128197; Next: <strong style="color:${overdue?'#f44336':overdue?'#ff9800':'inherit'}">${a.next_service_date || 'Not set'}</strong></span>
              <span>&#128260; ${freqLabels[a.frequency] || a.frequency || '—'}</span>
              <span>&#128181; $${parseFloat(a.price||150).toFixed(2)}</span>
              ${a.call_ahead ? '<span>&#128222; Call Ahead</span>' : ''}
            </div>
            ${a.notes ? `<div style="font-size:11px;color:#555;margin-top:4px;font-style:italic;">${esc(a.notes)}</div>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
            ${overdue ? '<span style="background:#f44336;color:white;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;">OVERDUE</span>' : ''}
            <span style="background:${a.status==='active'?'#4caf50':a.status==='paused'?'#ff9800':'#9e9e9e'};color:white;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;">${(a.status||'').toUpperCase()}</span>
          </div>
        </div>
      </div>`;
  };

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <h3 style="margin:0;font-size:16px;">&#10003; Active Filter Cleanings (${active.length})</h3>
      <button class="btn btn-primary btn-sm" onclick="openAfcSetupModal(null,null,null)">+ New Cleaning</button>
    </div>
    ${active.length === 0 ? '<p style="color:var(--text-light);font-size:13px;">No active filter cleanings.</p>' : active.map(renderAfc).join('')}
    ${paused.length > 0 ? `<h3 style="margin:20px 0 10px;font-size:14px;color:#ff9800;">Paused (${paused.length})</h3>${paused.map(renderAfc).join('')}` : ''}
    ${cancelled.length > 0 ? `<h3 style="margin:20px 0 10px;font-size:14px;color:#9e9e9e;">Cancelled (${cancelled.length})</h3>${cancelled.map(renderAfc).join('')}` : ''}`;
}

async function openAfcLeadDetail(leadId) {
  const { data: leads } = await window.api.getFilterLeads({});
  const lead = leads.find(l => l.id === leadId);
  if (!lead) return;

  const custName = esc(lead.customer?.name || lead.customer_name || '—');
  const addr = esc((lead.property?.address || lead.property_address || '') + (lead.property?.city ? ', ' + lead.property.city : ''));

  openModal(`&#128388; Filter Lead — ${custName}`, `
    <div style="background:#f9f9f9;border-radius:6px;padding:12px 14px;margin-bottom:14px;">
      <div style="font-weight:700;font-size:15px;">${custName}</div>
      <div style="font-size:13px;color:var(--text-light);">${addr}</div>
      <div style="font-size:12px;margin-top:6px;">Filter found on <strong>${esc(lead.scheduled_date || lead.job?.scheduled_date || '')}</strong></div>
      ${lead.has_afc ? `<div style="margin-top:6px;font-size:12px;color:#4caf50;font-weight:600;">&#10003; This customer already has an active Automatic Filter Cleaning.</div>` : ''}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">
      <button class="btn btn-primary" onclick="closeModal();_afcTab='active';openAfcSetupModal('${lead.id}','${lead.customer_id}','${lead.property_id}')">&#10003; Set Up Automatic Filter Cleaning</button>
      <button class="btn btn-secondary" onclick="afcLeadViewJob('${lead.job_id}')">&#128203; View Work Order</button>
      <button class="btn btn-secondary" onclick="afcLeadStatus('${lead.id}','no_answer')">&#128222; No Answer</button>
      <button class="btn btn-danger" onclick="afcLeadStatus('${lead.id}','declined')">&#10007; Declined</button>
    </div>
    <div class="form-group">
      <label>Notes</label>
      <textarea id="afcLeadNotes" rows="3" style="width:100%;" placeholder="Call notes, follow-up info...">${esc(lead.notes || '')}</textarea>
    </div>
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">Close</button>
    <button class="btn btn-primary" onclick="afcSaveLeadNotes('${lead.id}')">Save Notes</button>
  `);
}

async function afcLeadStatus(leadId, status) {
  const { data: leads } = await window.api.getFilterLeads({});
  const lead = leads.find(l => l.id === leadId);
  if (!lead) return;
  await window.api.saveFilterLead({ ...lead, status });
  closeModal();
  showToast(`Lead marked as ${status === 'no_answer' ? 'No Answer' : 'Declined'}.`, 'success');
  loadAFC();
}

async function afcSaveLeadNotes(leadId) {
  const notes = document.getElementById('afcLeadNotes')?.value || '';
  const { data: leads } = await window.api.getFilterLeads({});
  const lead = leads.find(l => l.id === leadId);
  if (!lead) return;
  await window.api.saveFilterLead({ ...lead, notes });
  showToast('Notes saved.', 'success');
  closeModal();
  loadAFC();
}

async function afcLeadViewJob(jobId) {
  if (!jobId) { showToast('No work order linked.', 'error'); return; }
  closeModal();
  const { data: job } = await window.api.getJob(jobId);
  if (job) openJobModal(job);
}

async function openAfcDetail(afcId) {
  const { data: afcs } = await window.api.getAfcs({});
  const a = afcs.find(x => x.id === afcId);
  if (!a) return;
  const freqLabels = { '6_month':'Every 6 Months', '1_year':'Annually', '2_year':'Every 2 Years', 'custom':'Custom' };

  openModal(`&#128388; Automatic Filter Cleaning — ${esc(a.customer?.name || '—')}`, `
    <div style="background:#f9f9f9;border-radius:6px;padding:12px 14px;margin-bottom:14px;">
      <div style="font-weight:700;font-size:15px;">${esc(a.customer?.name || '—')}</div>
      <div style="font-size:13px;color:var(--text-light);">${esc(a.property?.address || '')}${a.property?.city ? ', ' + esc(a.property.city) : ''}</div>
      <div style="display:flex;gap:16px;margin-top:8px;font-size:13px;flex-wrap:wrap;">
        <span>&#128260; ${freqLabels[a.frequency] || a.frequency}</span>
        <span>&#128197; Next: <strong>${a.next_service_date || '—'}</strong></span>
        <span>&#128181; $${parseFloat(a.price || 150).toFixed(2)}</span>
        ${a.call_ahead ? '<span>&#128222; Call Ahead</span>' : ''}
      </div>
      ${a.notes ? `<div style="margin-top:8px;font-size:12px;color:#555;font-style:italic;">${esc(a.notes)}</div>` : ''}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">
      <button class="btn btn-primary" onclick="closeModal();openAfcSetupModal(null,'${a.customer_id}','${a.property_id}','${a.id}')">&#9998; Edit</button>
      ${a.status === 'active' ? `<button class="btn btn-secondary" onclick="afcSetStatus('${a.id}','paused')">&#9646;&#9646; Pause</button>` : `<button class="btn btn-primary" onclick="afcSetStatus('${a.id}','active')">&#9654; Reactivate</button>`}
      <button class="btn btn-danger" onclick="afcSetStatus('${a.id}','cancelled')">Cancel Cleaning</button>
    </div>
  `, `<button class="btn btn-secondary" onclick="closeModal()">Close</button>`);
}

async function afcSetStatus(afcId, status) {
  const { data: afcs } = await window.api.getAfcs({});
  const a = afcs.find(x => x.id === afcId);
  if (!a) return;
  await window.api.saveAfc({ ...a, status });
  closeModal();
  showToast(`Cleaning ${status}.`, 'success');
  loadAFC();
}

function afcNextDates(frequency) {
  // Compute the next two service dates based on frequency
  // 6-month: end of March and end of September
  const now = new Date();
  const yr = now.getFullYear();
  if (frequency === '6_month') {
    const candidates = [new Date(yr, 2, 28), new Date(yr, 8, 28), new Date(yr+1, 2, 28), new Date(yr+1, 8, 28)];
    return candidates.find(d => d > now)?.toISOString().split('T')[0] || '';
  }
  if (frequency === '1_year') {
    const next = new Date(yr + 1, now.getMonth(), now.getDate());
    return next.toISOString().split('T')[0];
  }
  if (frequency === '2_year') {
    const next = new Date(yr + 2, now.getMonth(), now.getDate());
    return next.toISOString().split('T')[0];
  }
  return '';
}

// Safely add N months to a date without day-overflow (e.g. Jan 31 + 1 month = Feb 28, not Mar 3)
function afcAddMonths(date, n) {
  const d = new Date(date);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

// Generate all service dates from startDateStr forward for yearsAhead years
function generateAfcSchedule(startDateStr, frequency, yearsAhead = 5) {
  if (frequency === 'custom') return [startDateStr];
  const monthsPerCycle = frequency === '6_month' ? 6 : frequency === '2_year' ? 24 : 12;
  const dates = [];
  let current = new Date(startDateStr + 'T12:00:00');
  const cutoff = new Date(current);
  cutoff.setFullYear(cutoff.getFullYear() + yearsAhead);
  while (current <= cutoff) {
    dates.push(current.toISOString().split('T')[0]);
    current = afcAddMonths(current, monthsPerCycle);
  }
  return dates;
}

function openAfcSetupModal(leadId, customerId, propertyId, existingAfcId) {
  const isEdit = !!existingAfcId;
  // Load the existing AFC or start fresh
  (async () => {
    let existing = null;
    if (isEdit) {
      const { data: afcs } = await window.api.getAfcs({});
      existing = afcs.find(a => a.id === existingAfcId) || null;
    }
    const freq = existing?.frequency || '6_month';
    const nextDate = existing?.next_service_date || afcNextDates(freq);

    openModal(isEdit ? '&#9998; Edit Automatic Filter Cleaning' : '&#10003; Set Up Automatic Filter Cleaning', `
      <div style="margin-bottom:12px;background:#e8f5e9;border:1px solid #a5d6a7;border-radius:6px;padding:10px 14px;font-size:13px;">
        <strong>Automatic Filter Cleanings — $150</strong> · No digging fees · Service at our convenience
      </div>
      <div class="form-row">
        <div class="form-group" style="flex:1;">
          <label>Frequency *</label>
          <select id="afcFreq" class="form-control" onchange="document.getElementById('afcNextDate').value=afcNextDates(this.value)">
            <option value="6_month" ${freq==='6_month'?'selected':''}>Every 6 Months (~March & September)</option>
            <option value="1_year" ${freq==='1_year'?'selected':''}>Annually (1 Year)</option>
            <option value="2_year" ${freq==='2_year'?'selected':''}>Every 2 Years</option>
            <option value="custom" ${freq==='custom'?'selected':''}>Custom Date</option>
          </select>
        </div>
        <div class="form-group" style="flex:1;">
          <label>Next Service Date *</label>
          <input type="date" id="afcNextDate" class="form-control" value="${nextDate}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group" style="flex:1;">
          <label>Price</label>
          <input type="number" id="afcPrice" class="form-control" value="${existing?.price || 150}" step="0.01">
        </div>
        <div class="form-group" style="flex:1;display:flex;align-items:center;gap:8px;padding-top:24px;">
          <input type="checkbox" id="afcCallAhead" ${existing?.call_ahead ? 'checked' : ''} style="width:16px;height:16px;">
          <label for="afcCallAhead" style="margin:0;cursor:pointer;">Call customer on the way</label>
        </div>
      </div>
      <div class="form-group">
        <label>Notes</label>
        <textarea id="afcNotes" rows="2" style="width:100%;" placeholder="Access instructions, gate codes, preferences...">${esc(existing?.notes || '')}</textarea>
      </div>
    `, `
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveAfcSetup('${leadId||''}','${customerId||existing?.customer_id||''}','${propertyId||existing?.property_id||''}','${existingAfcId||''}')">&#10003; ${isEdit ? 'Save Changes' : 'Confirm Cleaning'}</button>
    `);
  })();
}

async function saveAfcSetup(leadId, customerId, propertyId, existingAfcId) {
  const frequency = document.getElementById('afcFreq').value;
  const nextServiceDate = document.getElementById('afcNextDate').value;
  const price = parseFloat(document.getElementById('afcPrice').value) || 150;
  const callAhead = document.getElementById('afcCallAhead').checked;
  const notes = document.getElementById('afcNotes').value.trim();

  if (!nextServiceDate) { showToast('Next service date is required.', 'error'); return; }
  if (!customerId) { showToast('No customer linked.', 'error'); return; }

  // Load existing AFC to get previously scheduled job IDs (for cleanup on edit)
  let existingAfc = null;
  if (existingAfcId) {
    const { data: afcs } = await window.api.getAfcs({});
    existingAfc = afcs.find(a => a.id === existingAfcId) || null;
  }

  const custId = customerId || existingAfc?.customer_id;
  const propId = propertyId || existingAfc?.property_id;

  const afcData = {
    ...(existingAfcId ? { id: existingAfcId } : {}),
    customer_id: custId,
    property_id: propId,
    filter_lead_id: leadId || null,
    frequency,
    next_service_date: nextServiceDate,
    price,
    call_ahead: callAhead,
    notes,
    status: 'active',
  };

  const afcResult = await window.api.saveAfc(afcData);
  if (!afcResult.success) { showToast('Failed to save.', 'error'); return; }

  const afcId = afcResult.data.id;
  const today = new Date().toISOString().split('T')[0];

  // On edit: soft-delete any previously scheduled pending future jobs
  if (existingAfcId && existingAfc?.scheduled_job_ids?.length) {
    for (const jobId of existingAfc.scheduled_job_ids) {
      try {
        const { data: oldJob } = await window.api.getJob(jobId);
        if (oldJob && oldJob.status === 'pending' && (oldJob.scheduled_date || '') >= today) {
          await window.api.deleteJob(jobId);
        }
      } catch (_) { /* skip if job already gone */ }
    }
  }

  // Generate all dates for 5 years and create a job for each
  const { data: vehicles } = await window.api.getVehicles();
  const serviceTruck = vehicles.find(v => v.name === 'Service Truck') || vehicles[0];
  const dates = generateAfcSchedule(nextServiceDate, frequency, 5);
  const scheduledJobIds = [];

  for (const date of dates) {
    const jobResult = await window.api.saveJob({
      customer_id: custId,
      property_id: propId,
      vehicle_id: serviceTruck?.id || '',
      scheduled_date: date,
      status: 'pending',
      notes: 'Automatic Filter Cleaning',
      afc_id: afcId,
      line_items: [{ description: 'Automatic Filter Cleaning', qty: 1, unit_price: price }],
    });
    if (jobResult.success) scheduledJobIds.push(jobResult.data.id);
  }

  // Store all scheduled job IDs on the AFC so we can manage them later
  await window.api.saveAfc({ ...afcResult.data, scheduled_job_ids: scheduledJobIds });

  // Mark the lead as approved
  if (leadId) {
    const { data: leads } = await window.api.getFilterLeads({});
    const lead = leads.find(l => l.id === leadId);
    if (lead) await window.api.saveFilterLead({ ...lead, status: 'approved', has_afc: true });
  }

  const lastDate = dates[dates.length - 1];
  closeModal();
  showToast(
    existingAfcId
      ? `Schedule updated — ${dates.length} jobs regenerated through ${lastDate}.`
      : `Set up! ${dates.length} jobs scheduled on Service Truck through ${lastDate}.`,
    'success'
  );
  _afcTab = 'active';
  loadAFC();
}

async function loadTrash() {
  const page = document.getElementById('page-trash');
  if (!page) return;
  page.innerHTML = '<div class="empty-state"><div class="empty-icon">&#9203;</div><p>Loading...</p></div>';

  const { data: items } = await window.api.getTrash();

  page.innerHTML = `
    <div style="padding:20px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap;">
        <h2 style="margin:0;">&#128465; Recycling Bin</h2>
        <span style="font-size:13px;color:var(--text-light);">${items.length} item${items.length !== 1 ? 's' : ''}</span>
        <input type="text" id="trashSearch" placeholder="Search..." oninput="filterTrash()" style="padding:5px 10px;border:1px solid var(--border);border-radius:4px;font-size:13px;width:200px;">
        <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;">
          <button id="trashBatchRestoreBtn" class="btn btn-secondary btn-sm" style="display:none;" onclick="batchTrashAction('restore')">&#8617; Restore Selected</button>
          <button id="trashBatchDeleteBtn" class="btn btn-danger btn-sm" style="display:none;" onclick="batchTrashAction('purge')">&#128465; Delete Selected Forever</button>
          ${items.length > 0 ? `<button class="btn btn-danger btn-sm" onclick="purgeAllTrash()">Empty Bin</button>` : ''}
        </div>
      </div>
      ${items.length === 0 ? `
        <div class="empty-state">
          <div class="empty-icon">&#128465;</div>
          <p>Recycling bin is empty.</p>
        </div>
      ` : `
        <table class="data-table" style="width:100%;font-size:13px;">
          <thead>
            <tr>
              <th style="padding:8px;width:32px;"><input type="checkbox" id="trashSelectAll" onchange="toggleAllTrashChecks(this.checked)"></th>
              <th style="padding:8px 12px;text-align:left;cursor:pointer;" onclick="sortTrash('type')">Type &#8597;</th>
              <th style="padding:8px 12px;text-align:left;cursor:pointer;" onclick="sortTrash('desc')">Description &#8597;</th>
              <th style="padding:8px 12px;text-align:left;cursor:pointer;" onclick="sortTrash('service_date')">Service Date &#8597;</th>
              <th style="padding:8px 12px;text-align:left;cursor:pointer;" onclick="sortTrash('deleted_at')">Deleted On &#8597;</th>
              <th style="padding:8px 12px;text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(item => {
              const type = item.trash_type;
              const meta = {
                job:                { label: 'Work Order',     icon: '&#128203;' },
                payment:            { label: 'Payment',        icon: '&#128181;' },
                manifest:           { label: 'Manifest',       icon: '&#128204;' },
                invoice:            { label: 'Invoice',        icon: '&#129534;' },
                service_due_notice: { label: 'Service Due',    icon: '&#128276;' },
                disposal_load:      { label: 'Disposal Load',  icon: '&#128666;' },
              }[type] || { label: 'Item', icon: '&#128230;' };
              let descLines = [];
              let serviceDate = '';
              if (type === 'payment') {
                const amt = parseFloat(item.amount || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
                descLines.push(`<strong>${esc(item.customer_name || '—')}</strong>`);
                descLines.push(`${amt}${item.method ? ' · ' + esc(item.method) : ''}${item.invoice_number ? ' · Invoice #' + esc(item.invoice_number) : ''}`);
                if (item.note) descLines.push(esc(item.note));
                serviceDate = item.date || '';
              } else if (type === 'job') {
                if (item.customer_name) descLines.push(`<strong>${esc(item.customer_name)}</strong>`);
                const addr = [item.property_address, item.property_city, item.property_state].filter(Boolean).join(', ');
                if (addr) descLines.push(esc(addr));
                if (item.customer_phone) descLines.push(`&#128222; ${esc(item.customer_phone)}`);
                if (item.customer_email) descLines.push(`&#9993; ${esc(item.customer_email)}`);
                serviceDate = item.scheduled_date || '';
              } else if (type === 'manifest') {
                descLines.push(`<strong>Manifest #${esc(item.manifest_number || '—')}</strong>`);
                if (item.customer_names) descLines.push(esc(item.customer_names));
                if (item.addresses) descLines.push(esc(item.addresses));
                if (item.vehicle_name) descLines.push(`&#128666; ${esc(item.vehicle_name)}`);
                serviceDate = item.scheduled_date || '';
              } else if (type === 'invoice') {
                const total = parseFloat(item.total || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
                descLines.push(`<strong>Invoice #${esc(item.invoice_number || '—')} · ${total}</strong>`);
                if (item.customer_name) descLines.push(esc(item.customer_name));
                const addr = [item.property_address, item.property_city, item.property_state].filter(Boolean).join(', ');
                if (addr) descLines.push(esc(addr));
                if (item.payment_status) descLines.push(`Status: ${esc(item.payment_status)}`);
                serviceDate = item.invoice_date || item.date || '';
              } else if (type === 'service_due_notice') {
                descLines.push(`<strong>${esc(item.service_type || 'Service')} due</strong>`);
                if (item.customer_name) descLines.push(esc(item.customer_name));
                const addr = [item.property_address, item.property_city, item.property_state].filter(Boolean).join(', ');
                if (addr) descLines.push(esc(addr));
                if (item.status) descLines.push(`Status: ${esc(item.status)}`);
                serviceDate = item.due_date || '';
              } else if (type === 'disposal_load') {
                const gal = item.volume_gallons ? Number(item.volume_gallons).toLocaleString() + ' gal' : '';
                const num = item.disposal_number ? `#${esc(item.disposal_number)}` : '';
                descLines.push(`<strong>Disposal ${num}${gal ? ' · ' + gal : ''}</strong>`);
                if (item.customer_name) descLines.push(esc(item.customer_name));
                if (item.waste_site) descLines.push(`Site: ${esc(item.waste_site)}`);
                serviceDate = item.disposal_date || '';
              }
              const desc = descLines.join('<br>');
              const deletedDate = item.deleted_at ? new Date(item.deleted_at).toLocaleDateString() : '';
              return `<tr style="border-bottom:1px solid #eee;">
                <td style="padding:8px;text-align:center;" onclick="event.stopPropagation()">
                  <input type="checkbox" class="trash-row-check" data-id="${item.id}" data-type="${item.trash_type}" onchange="updateTrashBatchBtns()">
                </td>
                <td style="padding:8px 12px;white-space:nowrap;">${meta.icon} ${meta.label}</td>
                <td style="padding:8px 12px;">${desc}</td>
                <td style="padding:8px 12px;color:var(--text-light);">${esc(serviceDate)}</td>
                <td style="padding:8px 12px;color:var(--text-light);font-size:12px;">${deletedDate}</td>
                <td style="padding:8px 12px;text-align:right;white-space:nowrap;">
                  <button class="btn btn-secondary btn-sm" onclick="restoreTrashItem('${item.id}','${item.trash_type}')">Restore</button>
                  <button class="btn btn-danger btn-sm" style="margin-left:4px;" onclick="purgeTrashItem('${item.id}','${item.trash_type}')">Delete Forever</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      `}
    </div>
  `;
}

let _trashSortCol = 'deleted_at';
let _trashSortAsc = false;

function filterTrash() {
  const q = (document.getElementById('trashSearch')?.value || '').toLowerCase();
  document.querySelectorAll('#page-trash tbody tr').forEach(row => {
    row.style.display = !q || row.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
  updateTrashBatchBtns();
}

function sortTrash(col) {
  if (_trashSortCol === col) _trashSortAsc = !_trashSortAsc;
  else { _trashSortCol = col; _trashSortAsc = true; }
  const tbody = document.querySelector('#page-trash tbody');
  if (!tbody) return;
  const rows = [...tbody.querySelectorAll('tr')];
  const colIdx = { type: 1, desc: 2, service_date: 3, deleted_at: 4 }[col] ?? 3;
  rows.sort((a, b) => {
    const av = a.cells[colIdx]?.textContent.trim() || '';
    const bv = b.cells[colIdx]?.textContent.trim() || '';
    return _trashSortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
  });
  rows.forEach(r => tbody.appendChild(r));
}

function updateTrashBatchBtns() {
  const any = document.querySelectorAll('.trash-row-check:checked').length > 0;
  const r = document.getElementById('trashBatchRestoreBtn');
  const d = document.getElementById('trashBatchDeleteBtn');
  if (r) r.style.display = any ? '' : 'none';
  if (d) d.style.display = any ? '' : 'none';
}

function toggleAllTrashChecks(checked) {
  document.querySelectorAll('.trash-row-check').forEach(cb => cb.checked = checked);
  updateTrashBatchBtns();
}

async function batchTrashAction(action) {
  const checked = [...document.querySelectorAll('.trash-row-check:checked')];
  if (checked.length === 0) return;
  if (action === 'purge' && !confirm(`Permanently delete ${checked.length} item${checked.length > 1 ? 's' : ''}? This cannot be undone.`)) return;
  for (const cb of checked) {
    if (action === 'restore') await window.api.restoreTrashItem(cb.dataset.id, cb.dataset.type);
    else await window.api.purgeTrashItem(cb.dataset.id, cb.dataset.type);
  }
  showToast(`${checked.length} item${checked.length > 1 ? 's' : ''} ${action === 'restore' ? 'restored' : 'permanently deleted'}.`, 'success');
  loadTrash();
}

async function restoreTrashItem(id, type) {
  await window.api.restoreTrashItem(id, type);
  showToast(`${type === 'job' ? 'Work order' : 'Manifest'} restored.`, 'success');
  loadTrash();
}

async function purgeTrashItem(id, type) {
  if (!confirm('Permanently delete this item? It cannot be recovered.')) return;
  await window.api.purgeTrashItem(id, type);
  showToast('Permanently deleted.', 'success');
  loadTrash();
}

async function purgeAllTrash() {
  if (!confirm('Permanently delete everything in the recycling bin? This cannot be undone.')) return;
  const { data: items } = await window.api.getTrash();
  for (const item of items) {
    await window.api.purgeTrashItem(item.id, item.trash_type);
  }
  showToast('Recycling bin emptied.', 'success');
  loadTrash();
}

// ===== SETTINGS =====
async function loadSettings() {
  const page = document.getElementById('page-settings');
  const { data: settings } = await window.api.getSettings();
  const { data: users } = await window.api.getUsers();
  const { data: categories } = await window.api.getServiceCategories();
  const { data: tankTypes } = await window.api.getTankTypes();
  const { data: outsidePumpers } = await window.api.getOutsidePumpers();
  const s = settings || {};

  // Show auto-start state + confirm server status after render
  setTimeout(async () => {
    const autoStartEl = document.getElementById('settingsAutoStart');
    if (autoStartEl) {
      const { enabled } = await window.api.getAutoStart();
      autoStartEl.checked = !!enabled;
    }
    const statusEl = document.getElementById('confirmServerStatus');
    if (!statusEl) return;
    const srv = await window.api.getConfirmServerStatus();
    if (srv.running) {
      statusEl.innerHTML = `<span style="color:#388e3c;font-weight:600;">✓ Running on port ${srv.port}</span> — customers will see: <code>${srv.publicUrl || 'http://YOUR-PUBLIC-IP'}:${srv.port}/confirm?token=...</code>`;
    } else {
      statusEl.innerHTML = `<span style="color:#e53935;">✗ Not running</span>`;
    }
  }, 100);

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
      <div class="form-group">
        <label>Default PDF Save Folder</label>
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="text" id="settingsPdfFolder" value="${esc(s.default_pdf_folder || '')}" placeholder="e.g. C:\\Users\\You\\Documents\\ISM PDFs" style="flex:1;">
          <button class="btn btn-secondary" type="button" onclick="browsePdfFolder()" style="white-space:nowrap;">Browse...</button>
        </div>
        <div style="font-size:11px;color:var(--text-light);margin-top:4px;">When exporting PDFs, the Save dialog will open here by default.</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><h3>Fleet</h3></div>
      <p style="font-size:13px;color:var(--text-light);margin-bottom:12px;">
        Manage trucks, drivers, tank capacities, and daily truck-driver assignments.
      </p>
      <button class="btn btn-primary" type="button" onclick="openTab('vehicles')">🚚 Manage Vehicles</button>
    </div>

    <div class="card">
      <div class="card-header"><h3>Email (SMTP)</h3></div>
      <p style="font-size:13px;color:var(--text-light);margin-bottom:16px;">
        Used for sending customer statements and service reminders directly from the app.
        Choose your provider below and follow the one-time setup steps.
      </p>

      <!-- Setup Instructions accordion -->
      <details style="margin-bottom:18px;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;">
        <summary style="cursor:pointer;padding:10px 16px;background:#f5f5f5;font-weight:600;font-size:13px;list-style:none;display:flex;justify-content:space-between;align-items:center;">
          📧 Setup Instructions <span style="font-weight:400;color:var(--text-light);font-size:12px;">click to expand</span>
        </summary>
        <div style="padding:16px;font-size:13px;line-height:1.7;color:var(--text);">

          <div style="margin-bottom:14px;">
            <strong style="color:#1565c0;">Gmail</strong>
            <ol style="margin:6px 0 0 18px;padding:0;">
              <li>Go to <strong>myaccount.google.com → Security → 2-Step Verification</strong> and make sure it is ON.</li>
              <li>Then go to <strong>myaccount.google.com/apppasswords</strong> and create an App Password (name it "ISM" or anything).</li>
              <li>Copy the 16-character password shown — use that as your SMTP Password below.</li>
              <li>Enter these settings:<br>
                <code style="background:#f0f0f0;padding:2px 6px;border-radius:4px;">Host: smtp.gmail.com &nbsp;|&nbsp; Port: 587 &nbsp;|&nbsp; User: your full Gmail address</code>
              </li>
            </ol>
          </div>

          <div style="margin-bottom:14px;">
            <strong style="color:#1565c0;">Outlook / Microsoft 365</strong>
            <ol style="margin:6px 0 0 18px;padding:0;">
              <li>Sign in to <strong>account.microsoft.com → Security → Advanced security options</strong>.</li>
              <li>Enable <strong>App passwords</strong> and create one for ISM.</li>
              <li>Enter these settings:<br>
                <code style="background:#f0f0f0;padding:2px 6px;border-radius:4px;">Host: smtp.office365.com &nbsp;|&nbsp; Port: 587 &nbsp;|&nbsp; User: your full email address</code>
              </li>
            </ol>
          </div>

          <div style="margin-bottom:14px;">
            <strong style="color:#1565c0;">Apple iCloud Mail</strong>
            <ol style="margin:6px 0 0 18px;padding:0;">
              <li>Go to <strong>appleid.apple.com → Sign-In and Security → App-Specific Passwords</strong>.</li>
              <li>Generate a password for ISM and copy it.</li>
              <li>Enter these settings:<br>
                <code style="background:#f0f0f0;padding:2px 6px;border-radius:4px;">Host: smtp.mail.me.com &nbsp;|&nbsp; Port: 587 &nbsp;|&nbsp; User: your @icloud.com address</code>
              </li>
            </ol>
          </div>

          <div>
            <strong style="color:#1565c0;">Custom / Business Domain (e.g. info@yourcompany.com)</strong>
            <ol style="margin:6px 0 0 18px;padding:0;">
              <li>Log in to your hosting control panel (cPanel, Plesk, Cloudflare, etc.).</li>
              <li>Find your outgoing SMTP settings — usually under <strong>Email Accounts</strong> or <strong>Mail Settings</strong>.</li>
              <li>Use your full email address as the username and your normal email password (or an app password if your host supports it).</li>
              <li>Common ports: <strong>587</strong> (STARTTLS, recommended) or <strong>465</strong> (SSL).</li>
            </ol>
          </div>

          <div style="margin-top:12px;padding:10px 12px;background:#fff8e1;border-left:3px solid #ffc107;border-radius:4px;font-size:12px;color:#5d4037;">
            ⚠️ Never use your regular account password here — always use an <strong>App Password</strong>. It's a separate password that only gives email-sending access and can be revoked anytime.
          </div>
        </div>
      </details>

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

      <!-- SMTP TEST BUTTON -->
      <div style="border:1px dashed #c8c8c8;border-radius:6px;padding:12px 14px;background:#fafafa;margin-top:4px;">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <label style="font-size:13px;font-weight:600;margin:0;">Send test email to:</label>
          <input type="email" id="settingsTestEmailTo" value="tyler.interstateseptic@gmail.com" style="flex:1;min-width:240px;padding:6px 10px;border:1px solid var(--border);border-radius:4px;font-size:13px;">
          <button type="button" id="settingsSendTestEmailBtn" class="btn btn-primary" onclick="sendSmtpTestEmail()" style="white-space:nowrap;">📧 Send Test Email</button>
        </div>
        <div id="settingsTestEmailResult" style="margin-top:10px;font-size:13px;display:none;"></div>
        <p style="font-size:11px;color:var(--text-light);margin:8px 0 0;">
          Uses the values <strong>currently typed above</strong> (you don't have to save first). Delivers a sample appointment confirmation so you can see what customers will receive.
        </p>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><h3>Geocoding &amp; Map Accuracy</h3></div>
      <p style="font-size:13px;color:var(--text-light);margin-bottom:12px;">
        Converts customer addresses into map coordinates. Rural Maine addresses (private lanes, RR-numbered roads, new subdivisions) often fail the free OSM geocoder — so ISM supports <strong>Mapbox</strong> as a better provider.
      </p>

      <details style="margin-bottom:14px;background:#f0f7ff;border:1px solid #bbdefb;border-radius:6px;padding:10px 14px;">
        <summary style="cursor:pointer;font-weight:600;color:#1565c0;">How to get a free Mapbox token (2-minute setup)</summary>
        <div style="margin-top:10px;font-size:13px;line-height:1.7;color:#333;">
          <ol style="margin:4px 0 0 18px;padding:0;">
            <li>Go to <strong>mapbox.com/signup</strong> and create a free account (no credit card required).</li>
            <li>After logging in, open your <strong>Account → Tokens</strong> page.</li>
            <li>Copy the <strong>Default public token</strong> (starts with <code>pk.</code>) OR click <em>Create a token</em> for one scoped only to Geocoding.</li>
            <li>Paste the token below and click <strong>Test Token</strong>.</li>
            <li>Switch mode to <strong>Hybrid</strong> (recommended) or <strong>Mapbox</strong> and save.</li>
          </ol>
          <div style="margin-top:10px;padding:8px 10px;background:#fff;border-left:3px solid #1565c0;border-radius:4px;font-size:12px;">
            💡 Free tier includes <strong>100,000 geocoding requests / month</strong>. A septic company with 5,000 customers geocodes each address once (cached forever), so you'll typically use well under 100/month after initial import. You will never pay.
          </div>
        </div>
      </details>

      <div class="form-row">
        <div class="form-group">
          <label>Provider Mode</label>
          <select id="settingsGeocodeProvider" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:4px;">
            <option value="auto" ${(!s.geocoding_provider || s.geocoding_provider === 'auto') ? 'selected' : ''}>Auto — use Mapbox if token is set, else OSM</option>
            <option value="osm" ${s.geocoding_provider === 'osm' ? 'selected' : ''}>OSM only (free, gaps on rural roads)</option>
            <option value="mapbox" ${s.geocoding_provider === 'mapbox' ? 'selected' : ''}>Mapbox only (best accuracy)</option>
            <option value="hybrid" ${s.geocoding_provider === 'hybrid' ? 'selected' : ''}>Hybrid — OSM first, Mapbox on miss (cheapest)</option>
          </select>
        </div>
        <div class="form-group">
          <label>Mapbox Access Token <span style="font-size:11px;color:var(--text-light);">(starts with <code>pk.</code>)</span></label>
          <input type="password" id="settingsMapboxToken" value="${esc(s.mapbox_token || '')}" placeholder="pk.eyJ1Ijo...">
        </div>
      </div>

      <hr style="border:none;border-top:1px solid var(--border);margin:20px 0;">
      <div class="form-group">
        <label>Anthropic Claude API Key <span style="font-size:11px;color:var(--text-light);">(starts with <code>sk-ant-</code>) — used for AI PDF expense import on the P&amp;L tab</span></label>
        <input type="password" id="settingsAnthropicKey" value="${esc(s.anthropic_api_key || '')}" placeholder="sk-ant-api03-...">
        <p style="font-size:11px;color:var(--text-light);margin-top:6px;">Get a key at <strong>console.anthropic.com</strong> → API Keys. Cost: roughly $0.02-0.10 per PDF scanned.</p>
      </div>

      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px;">
        <button type="button" class="btn btn-secondary" onclick="testMapboxTokenBtn()">🧪 Test Token</button>
        <button type="button" class="btn btn-secondary" onclick="clearGeocodeCacheBtn()" title="Deletes all saved coordinates. Next time the map opens, every address will be re-geocoded using your currently-selected provider.">♻️ Clear Geocode Cache</button>
        <span id="mapboxTestResult" style="font-size:12px;"></span>
      </div>
      <p style="font-size:11px;color:var(--text-light);margin:8px 0 0;">
        After switching providers, click <strong>Clear Geocode Cache</strong> to force every address to re-resolve through the new provider. Otherwise already-cached (possibly wrong) coords will keep being used.
      </p>
    </div>

    <div class="card">
      <div class="card-header"><h3>Appointment Confirmation Email</h3></div>
      <p style="font-size:13px;color:var(--text-light);margin-bottom:16px;">
        When a new job is scheduled, ISM automatically emails the customer an appointment confirmation. Customize what goes in the email below.
      </p>
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;margin-bottom:16px;">
        <input type="checkbox" id="settingsConfirmEmailEnabled" ${s.confirm_email_enabled !== false ? 'checked' : ''} style="width:18px;height:18px;">
        <span style="font-weight:600;">Send confirmation email when a job is scheduled</span>
      </label>
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;margin-bottom:20px;">
        <input type="checkbox" id="settingsConfirmEmailReschedule" ${s.confirm_email_send_on_reschedule ? 'checked' : ''} style="width:18px;height:18px;">
        <span>Also send when appointment date is changed (reschedule)</span>
      </label>
      <div class="form-row">
        <div class="form-group">
          <label>From Name <span style="font-size:11px;color:var(--text-light);">(shown in customer's inbox)</span></label>
          <input type="text" id="settingsConfirmFromName" value="${esc(s.confirm_email_from_name || s.company_name || '')}" placeholder="Interstate Septic Systems">
        </div>
        <div class="form-group">
          <label>Subject Line <span style="font-size:11px;color:var(--text-light);">(use {company} for company name)</span></label>
          <input type="text" id="settingsConfirmSubject" value="${esc(s.confirm_email_subject || '')}" placeholder="Your Appointment Confirmation — {company}">
        </div>
      </div>
      <div class="form-group">
        <label>Policy / Additional Info Bullets <span style="font-size:11px;color:var(--text-light);">(one bullet per line — shown under "Attention: Possible Additional Costs")</span></label>
        <textarea id="settingsConfirmPolicy" rows="12" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:6px;font-size:13px;resize:vertical;line-height:1.6;">${esc(s.confirm_email_policy != null ? s.confirm_email_policy : `Thank you for scheduling your service with us. If this is a routine pump-out, please note that we are unable to provide an exact arrival time. You are not required to be home for this service. If being home is important to you, we recommend rescheduling for one of our limited 7:30 AM time slots, as these offer the most predictable arrival time. Our drivers' arrival times vary, and we don't want to make a commitment we can't deliver on. We appreciate your understanding and flexibility.
If you must cancel or reschedule please call the office
Please ensure the proper septic covers are exposed if you plan to dig them up.
If a garden hose is available, please have it nearby for the pumper
The following is a breakdown of our pricing.
If the tank is difficult to find, the technician may occasionally in rare instances require radio detection, which is an additional $125
If the distance from the truck to the tank exceeds 100 feet, an additional $10 will be charged for every 40 feet of extra hose required.
If the driver has to take his shovel off to expose any covers or do any digging, it is an additional $20 per cubic foot of digging.
If your pump or leachfield has failed, your tank may contain more liquid than expected. Any additional volume will be billed at our standard rates of $250 per 1,000 gallons to pump and $140 per 1,000 gallons to dispose, prorated in 500-gallon increments.
Our minimum charge is $175, which covers the service call to the property. This fee applies when pumping or other scheduled services are determined to be unnecessary upon arrival. It covers travel time, labor, and scheduling costs.`)}</textarea>
      </div>
      <div class="form-group">
        <label>Footer / Cancellation Notice</label>
        <input type="text" id="settingsConfirmFooter" value="${esc(s.confirm_email_footer || 'Please respond at least 48 hours before your appointment if you need to reschedule or cancel.')}" style="width:100%;">
      </div>
      <p style="font-size:12px;color:var(--text-light);margin-top:4px;">
        💡 The <strong>Agree &amp; Confirm</strong> button in the email links to your Customer Confirmation Server (configured below). If no public URL is set, a <em>Call to Confirm</em> phone link is shown instead.
      </p>
    </div>

    <div class="card">
      <div class="card-header"><h3>Square Payments</h3></div>
      <p style="font-size:13px;color:var(--text-light);margin-bottom:14px;">
        Enter your Square API credentials to enable one-click card-on-file charges from the customer accounting screen.
        Get these from <strong>developer.squareup.com</strong> → your app → Production credentials.
      </p>
      <div class="form-row">
        <div class="form-group">
          <label>Square Access Token</label>
          <input type="password" id="settingsSquareToken" value="${esc(s.square_access_token || '')}" placeholder="EAAAl...">
        </div>
        <div class="form-group">
          <label>Square Location ID</label>
          <input type="text" id="settingsSquareLocationId" value="${esc(s.square_location_id || '')}" placeholder="LXXXXXXXXXXXXXXXXX">
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:4px;">
        <button class="btn btn-secondary" onclick="testSquareConnection()">Test Connection</button>
        <span id="squareTestResult" style="font-size:12px;"></span>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><h3>Startup & Background</h3></div>
      <p style="font-size:13px;color:var(--text-light);margin-bottom:14px;">
        When enabled, the app launches automatically when Windows starts and stays running in the system tray when you close the window — keeping the confirmation server and email reminders active 24/7.
      </p>
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
        <input type="checkbox" id="settingsAutoStart" style="width:18px;height:18px;">
        <span style="font-weight:600;">Launch at Windows startup &amp; run in system tray</span>
      </label>
      <p style="font-size:12px;color:var(--text-light);margin-top:6px;">To fully quit the app, right-click the tray icon in the taskbar and choose Quit.</p>
    </div>

    <div class="card">
      <div class="card-header"><h3>Customer Confirmation Server</h3></div>
      <p style="font-size:13px;color:var(--text-light);margin-bottom:14px;">
        Enables a green <strong>"Confirm / I'll Schedule My Appointment"</strong> button in reminder emails. When a customer clicks it, the notice is marked confirmed and all further reminders stop automatically.<br>
        <strong>Requires:</strong> port forwarding on your router (forward this port to this PC) so customers can reach it from the internet.
      </p>
      <div class="form-row">
        <div class="form-group">
          <label>Public URL / IP <span style="font-size:11px;color:var(--text-light);">(what customers see, e.g. http://yourip or http://yourdomain.com)</span></label>
          <input type="text" id="settingsConfirmPublicUrl" value="${esc(s.confirm_public_url || '')}" placeholder="http://123.456.789.0">
        </div>
        <div class="form-group">
          <label>Server Port <span style="font-size:11px;color:var(--text-light);">(default 3456)</span></label>
          <input type="text" id="settingsConfirmPort" value="${esc(s.confirm_server_port || '3456')}" style="max-width:120px;">
        </div>
      </div>
      <div id="confirmServerStatus" style="font-size:13px;margin-top:8px;color:var(--text-light);">Checking server status...</div>
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
          <thead><tr><th>Color</th><th>Name</th><th>Username</th><th>Phone</th><th>Role</th><th></th></tr></thead>
          <tbody>
            ${users.map(u => `
              <tr>
                <td style="width:48px;text-align:center;">
                  <input type="color" value="${u.color || '#1565c0'}"
                    title="Click to change color"
                    style="width:32px;height:32px;border:none;border-radius:50%;cursor:pointer;padding:0;background:none;"
                    onchange="saveUserColor('${u.id}', this.value)">
                </td>
                <td><strong style="color:${u.color || '#1565c0'};">${esc(u.name)}</strong></td>
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

    <div class="card mt-24" id="cloudUsersCard">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <div>
          <h3 style="margin:0;">Cloud Users (Multi-Device Login)</h3>
          <div style="font-size:12px;color:var(--text-light);margin-top:4px;">Manage accounts that work on PC, Android, and iPhone via Supabase.</div>
        </div>
        <div id="cloudUsersHeaderActions"></div>
      </div>
      <div id="cloudUsersBody" style="padding:8px 0;">Loading…</div>
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

    <div class="card mt-24">
      <div class="card-header">
        <h3>&#128666; Outside Pumpers</h3>
        <button class="btn btn-primary btn-sm" onclick="openOutsidePumperModal()">+ Add Pumper</button>
      </div>
      <p style="font-size:13px;color:var(--text-light);margin-bottom:16px;">Save hauler companies and drivers that dump waste at your facility. Select them when logging a disposal instead of typing their info each time.</p>
      ${(outsidePumpers || []).length === 0
        ? '<p style="color:var(--text-light);font-size:13px;padding:8px 0;">No outside pumpers added yet.</p>'
        : `<table class="data-table" style="font-size:13px;">
          <thead>
            <tr>
              <th>Name / Company</th>
              <th>Hauler ID</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${(outsidePumpers || []).map(p => `
              <tr>
                <td>
                  <strong>${esc(p.name || '')}</strong>
                  ${p.company ? `<div style="font-size:11px;color:var(--text-light);">${esc(p.company)}</div>` : ''}
                </td>
                <td>${esc(p.hauler_id || '—')}</td>
                <td>${esc(p.phone || '—')}</td>
                <td style="font-size:12px;">${esc(p.email || '—')}</td>
                <td style="font-size:12px;color:var(--text-light);">${esc(p.notes || '')}</td>
                <td style="text-align:right;">
                  <button class="btn btn-sm btn-secondary" onclick="openOutsidePumperModal(${JSON.stringify(p).replace(/"/g, '&quot;')})">Edit</button>
                  <button class="btn btn-sm btn-danger" onclick="deleteOutsidePumper('${p.id}')">Remove</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>`
      }
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

  // Render the Cloud Users card after the page is in the DOM
  renderCloudUsersCard();
}

// =====================================================================
// CLOUD USERS — Supabase-backed multi-device account management
// =====================================================================

async function renderCloudUsersCard() {
  const body = document.getElementById('cloudUsersBody');
  const actions = document.getElementById('cloudUsersHeaderActions');
  if (!body || !actions) return;

  const status = await window.api.cloudConfigStatus();
  if (!status.configured) {
    body.innerHTML = `<div style="padding:12px;color:#ff9800;">⚠ Supabase is not configured. Cloud users unavailable.</div>`;
    actions.innerHTML = '';
    return;
  }

  if (!status.signedIn) {
    actions.innerHTML = '';
    body.innerHTML = `
      <div style="padding:8px 0;">
        <div style="margin-bottom:12px;color:var(--text-light);font-size:13px;">Sign in with your cloud account (owner role) to manage users that work across devices.</div>
        <div class="form-row" style="max-width:520px;">
          <div class="form-group">
            <label>Cloud username</label>
            <input type="text" id="cloudLoginUsername" placeholder="e.g. tyler" autocomplete="off">
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" id="cloudLoginPassword" autocomplete="current-password">
          </div>
        </div>
        <button class="btn btn-primary" onclick="cloudSignIn()">Sign in to Cloud</button>
        <div id="cloudLoginError" style="color:#e53935;margin-top:8px;font-size:13px;"></div>
      </div>`;
    return;
  }

  // Signed in — show user list
  actions.innerHTML = `
    <button class="btn btn-primary btn-sm" onclick="openCloudUserModal()">+ Add Cloud User</button>
    <button class="btn btn-secondary btn-sm" onclick="cloudSignOut()" style="margin-left:6px;">Sign out</button>`;

  const res = await window.api.cloudUsersList();
  if (!res.success) {
    body.innerHTML = `<div style="color:#e53935;padding:12px;">Failed to load: ${esc(res.error)}</div>`;
    return;
  }
  const users = res.data;
  if (!users.length) {
    body.innerHTML = `<p style="color:var(--text-light);padding:12px;">No cloud users yet.</p>`;
    return;
  }
  body.innerHTML = `
    <div style="font-size:12px;color:var(--text-light);margin-bottom:8px;">
      Signed in as <strong>${esc(status.sessionUser || '')}</strong>. ${users.length} cloud user${users.length === 1 ? '' : 's'}.
    </div>
    <table class="data-table">
      <thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Linked</th><th></th></tr></thead>
      <tbody>
        ${users.map(u => {
          const roleColor = u.role === 'owner' ? '#7c4dff' : (u.role === 'office' ? '#1565c0' : '#388e3c');
          return `
          <tr>
            <td><code style="background:#f3f4f6;padding:2px 6px;border-radius:3px;">${esc(u.username || '')}</code></td>
            <td><strong>${esc(u.name || '')}</strong></td>
            <td><span class="badge" style="background:${roleColor}20;color:${roleColor};font-weight:600;">${esc(u.role)}</span></td>
            <td>${u.linked ? '<span style="color:#388e3c;">✓ linked</span>' : '<span style="color:#e53935;">✗ not linked</span>'}</td>
            <td style="text-align:right;">
              <button class="btn btn-sm btn-secondary" onclick="openEditCloudUserModal('${u.id}')">Edit</button>
              <button class="btn btn-sm btn-danger" onclick="deleteCloudUser('${u.id}', '${esc(u.username)}')">Remove</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

async function cloudSignIn() {
  const username = document.getElementById('cloudLoginUsername').value.trim();
  const password = document.getElementById('cloudLoginPassword').value;
  const errEl = document.getElementById('cloudLoginError');
  if (!username || !password) {
    errEl.textContent = 'Username and password are required.';
    return;
  }
  errEl.textContent = '';
  const res = await window.api.cloudLogin(username, password);
  if (!res.success) {
    errEl.textContent = res.error || 'Sign in failed.';
    return;
  }
  if (!res.user || res.user.role !== 'owner') {
    await window.api.cloudLogout();
    errEl.textContent = 'Only the owner can manage cloud users from this screen.';
    return;
  }
  showToast('Signed in to cloud as ' + res.user.name, 'success');
  renderCloudUsersCard();
}

async function cloudSignOut() {
  await window.api.cloudLogout();
  showToast('Signed out of cloud.', 'info');
  renderCloudUsersCard();
}

function openCloudUserModal(existing) {
  const u = existing || {};
  const isEdit = !!u.id;
  openModal(isEdit ? 'Edit Cloud User' : 'Add Cloud User', `
    <input type="hidden" id="cuId" value="${u.id || ''}">
    <div class="form-group">
      <label>Username * (used to log in)</label>
      <input type="text" id="cuUsername" value="${esc(u.username || '')}" placeholder="e.g. john.smith" autocomplete="off" ${isEdit ? 'readonly style="background:#f3f4f6;"' : ''}>
      ${isEdit ? '<div style="font-size:11px;color:var(--text-light);margin-top:4px;">Username cannot be changed after creation. Delete and re-create to rename.</div>' : ''}
    </div>
    <div class="form-group">
      <label>Full Name *</label>
      <input type="text" id="cuName" value="${esc(u.name || '')}" placeholder="e.g. John Smith">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Role *</label>
        <select id="cuRole">
          <option value="tech" ${u.role === 'tech' ? 'selected' : ''}>Tech (read-only field access)</option>
          <option value="office" ${u.role === 'office' ? 'selected' : ''}>Office (full operational access)</option>
          <option value="owner" ${u.role === 'owner' ? 'selected' : ''}>Owner (everything including settings)</option>
        </select>
      </div>
      <div class="form-group">
        <label>Phone</label>
        <input type="tel" id="cuPhone" value="${esc(u.phone || '')}" placeholder="(207) 555-0100">
      </div>
    </div>
    ${isEdit ? '' : `
    <div class="form-group">
      <label>Initial Password * (min 6 chars)</label>
      <input type="password" id="cuPassword" placeholder="Choose a temporary password" autocomplete="new-password">
      <div style="font-size:11px;color:var(--text-light);margin-top:4px;">Share this password with the user — they can change it after login.</div>
    </div>`}
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveCloudUserForm()">${isEdit ? 'Save Changes' : 'Create User'}</button>
  `);
}

async function openEditCloudUserModal(id) {
  const res = await window.api.cloudUsersList();
  if (!res.success) { showToast('Could not load user: ' + res.error, 'error'); return; }
  const u = res.data.find(x => x.id === id);
  if (!u) { showToast('User not found.', 'error'); return; }
  openCloudUserModal(u);
}

async function saveCloudUserForm() {
  const id = document.getElementById('cuId').value;
  const isEdit = !!id;
  const username = document.getElementById('cuUsername').value.trim();
  const name = document.getElementById('cuName').value.trim();
  const role = document.getElementById('cuRole').value;
  const phone = document.getElementById('cuPhone').value.trim();

  if (!username) { showToast('Username is required.', 'error'); return; }
  if (!name) { showToast('Full name is required.', 'error'); return; }

  let res;
  if (isEdit) {
    res = await window.api.cloudUsersUpdate(id, { name, role, phone });
  } else {
    const password = document.getElementById('cuPassword').value;
    if (!password || password.length < 6) {
      showToast('Password must be at least 6 characters.', 'error');
      return;
    }
    res = await window.api.cloudUsersCreate({ username, name, role, phone, password });
  }

  if (!res.success) {
    showToast('Failed: ' + res.error, 'error');
    return;
  }
  closeModal();
  showToast(isEdit ? 'User updated.' : 'User created. Share the password with them.', 'success');
  renderCloudUsersCard();
}

async function deleteCloudUser(id, username) {
  if (!confirm(`Remove cloud user "${username}"? They will no longer be able to log in. (The orphaned auth record can be cleaned via Supabase dashboard.)`)) return;
  const res = await window.api.cloudUsersDelete(id);
  if (!res.success) { showToast('Delete failed: ' + res.error, 'error'); return; }
  showToast('User removed.', 'success');
  renderCloudUsersCard();
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

// ===== OUTSIDE PUMPERS =====

function openOutsidePumperModal(p) {
  p = p || {};
  const isEdit = !!p.id;
  openModal(isEdit ? 'Edit Outside Pumper' : 'Add Outside Pumper', `
    <input type="hidden" id="opId" value="${p.id || ''}">
    <div class="form-row">
      <div class="form-group" style="flex:2;">
        <label>Name / Driver Name *</label>
        <input type="text" id="opName" value="${esc(p.name || '')}" placeholder="e.g. John Smith or Smith Septic">
      </div>
      <div class="form-group" style="flex:2;">
        <label>Company Name</label>
        <input type="text" id="opCompany" value="${esc(p.company || '')}" placeholder="e.g. Smith Septic Services LLC">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>DEP Hauler ID</label>
        <input type="text" id="opHaulerId" value="${esc(p.hauler_id || '')}" placeholder="e.g. ME-WH-12345">
      </div>
      <div class="form-group">
        <label>Phone</label>
        <input type="tel" id="opPhone" value="${esc(p.phone || '')}" placeholder="(207) 555-0100">
      </div>
    </div>
    <div class="form-group">
      <label>Email</label>
      <input type="email" id="opEmail" value="${esc(p.email || '')}" placeholder="contact@example.com">
    </div>
    <div class="form-group">
      <label>Notes</label>
      <textarea id="opNotes" placeholder="Any additional notes about this hauler...">${esc(p.notes || '')}</textarea>
    </div>
  `, `
    ${isEdit ? `<button class="btn btn-danger" onclick="deleteOutsidePumper('${p.id}', true)">Delete</button>` : ''}
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveOutsidePumperForm()">Save</button>
  `);
}

async function saveOutsidePumperForm() {
  const name = document.getElementById('opName').value.trim();
  if (!name) { showToast('Name is required.', 'error'); return; }
  const data = {
    id: document.getElementById('opId').value || undefined,
    name,
    company: document.getElementById('opCompany').value.trim(),
    hauler_id: document.getElementById('opHaulerId').value.trim(),
    phone: document.getElementById('opPhone').value.trim(),
    email: document.getElementById('opEmail').value.trim(),
    notes: document.getElementById('opNotes').value.trim(),
  };
  await window.api.saveOutsidePumper(data);
  closeModal();
  showToast('Outside pumper saved.', 'success');
  loadSettings();
}

async function deleteOutsidePumper(id, fromModal = false) {
  if (!confirm('Remove this outside pumper?')) return;
  await window.api.deleteOutsidePumper(id);
  if (fromModal) closeModal();
  showToast('Outside pumper removed.', 'success');
  loadSettings();
}

async function browsePdfFolder() {
  const result = await window.api.selectFolder();
  if (!result.canceled && result.folderPath) {
    document.getElementById('settingsPdfFolder').value = result.folderPath;
  }
}

// ===== SQUARE =====
async function testSquareConnection() {
  const el = document.getElementById('squareTestResult');
  if (el) el.innerHTML = '<span style="color:#999;">Testing...</span>';
  // Save only square fields (safe merge now)
  const token = document.getElementById('settingsSquareToken').value.trim();
  const locId = document.getElementById('settingsSquareLocationId').value.trim();
  if (!token) { if (el) el.innerHTML = '<span style="color:#c62828;">&#10007; Enter an access token first.</span>'; return; }
  await window.api.saveSettings({ square_access_token: token, square_location_id: locId });
  const result = await window.api.squareTest();
  if (el) el.innerHTML = result.success
    ? `<span style="color:#2e7d32;font-weight:600;">&#10003; Connected — ${esc(result.name)}</span>`
    : `<span style="color:#c62828;">&#10007; ${esc(result.error)}</span>`;
}

async function openSquarePayModal(customerId, defaultAmount) {
  const { data: customer } = await window.api.getCustomer(customerId);
  if (!customer.square_customer_id) {
    openSquareLinkModal(customerId);
    return;
  }
  const result = await window.api.squareListCards(customer.square_customer_id);
  const cards = result.cards || [];
  if (cards.length === 0) {
    showToast('No cards on file in Square for this customer. Add one in your Square dashboard.', 'error');
    return;
  }

  // Build auto-note from most recent unpaid invoice(s)
  const { data: invoices } = await window.api.getInvoices({ customerId, paymentStatus: 'unpaid' });
  const unpaid = (invoices || []).filter(i => i.payment_status !== 'paid').sort((a, b) => (b.svc_date || '').localeCompare(a.svc_date || ''));
  let autoNote = customer.name;
  if (unpaid.length > 0) {
    const inv = unpaid[0];
    const parts = [];
    if (inv.invoice_number) parts.push('Inv #' + inv.invoice_number);
    if (inv.svc_date) parts.push(inv.svc_date);
    if (parts.length) autoNote = customer.name + ' — ' + parts.join(' ');
  }

  const cardOptions = cards.map(c =>
    `<option value="${c.id}">${esc(c.card_brand || 'Card')} ****${c.last_4} exp ${c.exp_month}/${c.exp_year}</option>`
  ).join('');
  openModal('Charge Square Card on File', `
    <input type="hidden" id="squarePayCustomerId" value="${customerId}">
    <input type="hidden" id="squarePaySquareCustId" value="${customer.square_customer_id}">
    <div class="form-group">
      <label>Card</label>
      <select id="squarePayCardId">${cardOptions}</select>
    </div>
    <div class="form-group">
      <label>Amount ($)</label>
      <input type="number" id="squarePayAmount" value="${defaultAmount || ''}" min="0.01" step="0.01" placeholder="0.00" style="font-size:20px;font-weight:700;">
    </div>
    <div class="form-group">
      <label>Note</label>
      <input type="text" id="squarePayNote" value="${esc(autoNote)}">
    </div>
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" style="background:#006aff;" onclick="runSquareCharge()">Charge Card</button>
  `);
}

async function runSquareCharge() {
  const customerId = document.getElementById('squarePayCustomerId').value;
  const squareCustomerId = document.getElementById('squarePaySquareCustId').value;
  const cardId = document.getElementById('squarePayCardId').value;
  const amount = parseFloat(document.getElementById('squarePayAmount').value);
  const note = document.getElementById('squarePayNote').value.trim();
  if (!amount || amount <= 0) { showToast('Enter a valid amount.', 'error'); return; }
  const amountCents = Math.round(amount * 100);

  const btn = document.querySelector('#modalFooter .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Processing...'; }

  const result = await window.api.squareCharge({ squareCustomerId, cardId, amountCents, note });
  if (result.error) {
    showToast('Square error: ' + result.error, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Charge Card'; }
    return;
  }

  const payment = result.payment;
  const receiptUrl = payment?.receipt_url;

  // Record payment in app
  const { data: customer } = await window.api.getCustomer(customerId);
  await window.api.savePayment({
    customer_id: customerId,
    amount,
    date: new Date().toISOString().split('T')[0],
    payment_method: 'Square',
    reference: payment?.id || '',
    notes: note || '',
    type: 'payment',
  });

  closeModal();
  showToast(`Charged $${amount.toFixed(2)} via Square successfully.`, 'success');

  // Send receipt email
  if (customer.email) {
    const { data: settings } = await window.api.getSettings();
    const co = settings?.company_name || 'Interstate Septic';
    const dateStr = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
    const subject = `Payment Receipt — ${co}`;
    const htmlBody = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{font-family:Arial,sans-serif;font-size:14px;color:#222;background:#f5f5f5;margin:0;padding:24px;}
.card{background:#fff;border-radius:8px;padding:32px;max-width:520px;margin:0 auto;box-shadow:0 2px 8px rgba(0,0,0,.08);}
h2{margin:0 0 4px;color:#1565c0;} .amount{font-size:32px;font-weight:700;color:#2e7d32;margin:16px 0;}
.row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f0f0;font-size:13px;}
.footer{margin-top:20px;font-size:12px;color:#999;text-align:center;}
</style></head><body><div class="card">
<h2>${esc(co)}</h2>
<div style="font-size:13px;color:#666;margin-bottom:16px;">Payment Receipt</div>
<div class="amount">$${amount.toFixed(2)}</div>
<div class="row"><span>Date</span><span>${dateStr}</span></div>
<div class="row"><span>Customer</span><span>${esc(customer.name)}</span></div>
${note ? `<div class="row"><span>Description</span><span>${esc(note)}</span></div>` : ''}
<div class="row"><span>Payment Method</span><span>Card on File (Square)</span></div>
<div class="row"><span>Transaction ID</span><span style="font-size:11px;color:#999;">${esc(payment?.id || 'N/A')}</span></div>
${receiptUrl ? `<div style="margin-top:16px;text-align:center;"><a href="${receiptUrl}" style="background:#006aff;color:#fff;padding:10px 24px;border-radius:4px;text-decoration:none;font-weight:700;font-size:13px;">View Square Receipt</a></div>` : ''}
<div class="footer">Thank you for your business!<br>${esc(settings?.company_phone || '')}</div>
</div></body></html>`;
    await window.api.sendEmail(customer.email, subject, htmlBody, null);
    showToast('Receipt emailed to ' + customer.email, 'success');
  }

  // Refresh accounting view
  openCustomerAccounting(customerId);
}

async function openSquareLinkModal(customerId) {
  const { data: customer } = await window.api.getCustomer(customerId);
  const prefilledQuery = customer.email || customer.name || '';
  openModal('Link Square Customer', `
    <input type="hidden" id="squareLinkCustomerId" value="${customerId}">
    <div class="form-row">
      <div class="form-group" style="flex:1;">
        <label>Search Square</label>
        <input type="text" id="squareLinkQuery" value="${esc(prefilledQuery)}" placeholder="email or name">
      </div>
      <div class="form-group" style="max-width:120px;align-self:flex-end;">
        <button class="btn btn-secondary" onclick="searchSquareCustomers()">Search</button>
      </div>
    </div>
    <div id="squareLinkResults" style="margin-top:8px;"><div style="color:#999;font-size:12px;">Searching...</div></div>
    <hr style="margin:12px 0;">
    <p style="font-size:12px;color:var(--text-light);">Or paste the Square Customer ID directly:</p>
    <div class="form-row">
      <div class="form-group" style="flex:1;">
        <input type="text" id="squareLinkDirectId" placeholder="Square Customer ID">
      </div>
      <div class="form-group" style="max-width:120px;align-self:flex-end;">
        <button class="btn btn-primary" onclick="saveSquareLink()">Link</button>
      </div>
    </div>
  `, `<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>`);

  // Auto-search on open using the customer's email
  if (prefilledQuery) {
    const result = await window.api.squareSearchCustomers(prefilledQuery);
    const el = document.getElementById('squareLinkResults');
    if (!el) return;
    const customers = result.customers || [];
    if (customers.length === 0) {
      el.innerHTML = '<div style="font-size:12px;color:#c62828;">No Square customers found matching that email. Try editing the search above.</div>';
      return;
    }
    el.innerHTML = customers.map(c => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;margin-bottom:4px;background:#f5f5f5;border-radius:4px;font-size:12px;">
        <div>
          <div style="font-weight:600;">${esc(c.given_name||'')} ${esc(c.family_name||'')}</div>
          <div style="color:var(--text-light);">${esc(c.email_address||'')} &bull; ID: ${esc(c.id)}</div>
        </div>
        <button class="btn btn-sm btn-primary" onclick="document.getElementById('squareLinkDirectId').value='${c.id}';saveSquareLink()">Select</button>
      </div>`).join('');
  }
}

async function searchSquareCustomers() {
  const query = document.getElementById('squareLinkQuery').value.trim();
  if (!query) return;
  const el = document.getElementById('squareLinkResults');
  el.innerHTML = '<div style="color:#999;font-size:12px;">Searching...</div>';
  const result = await window.api.squareSearchCustomers(query);
  const customers = result.customers || [];
  if (customers.length === 0) {
    el.innerHTML = '<div style="font-size:12px;color:#c62828;">No Square customers found. Try a different search or paste the ID directly.</div>';
    return;
  }
  el.innerHTML = customers.map(c => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;margin-bottom:4px;background:#f5f5f5;border-radius:4px;font-size:12px;">
      <div>
        <div style="font-weight:600;">${esc(c.given_name||'')} ${esc(c.family_name||'')}</div>
        <div style="color:var(--text-light);">${esc(c.email_address||'')} &bull; ID: ${esc(c.id)}</div>
      </div>
      <button class="btn btn-sm btn-primary" onclick="document.getElementById('squareLinkDirectId').value='${c.id}';saveSquareLink()">Select</button>
    </div>`).join('');
}

async function saveSquareLink() {
  const customerId = document.getElementById('squareLinkCustomerId').value;
  const squareId = document.getElementById('squareLinkDirectId').value.trim();
  if (!squareId) { showToast('Enter a Square Customer ID.', 'error'); return; }
  await window.api.saveCustomer({ id: customerId, square_customer_id: squareId });
  closeModal();
  showToast('Square customer linked.', 'success');
  openCustomerAccounting(customerId);
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
    default_pdf_folder: document.getElementById('settingsPdfFolder').value.trim(),
    smtp_host: document.getElementById('settingsSmtpHost').value.trim(),
    smtp_port: document.getElementById('settingsSmtpPort').value.trim(),
    smtp_user: document.getElementById('settingsSmtpUser').value.trim(),
    smtp_pass: document.getElementById('settingsSmtpPass').value.trim(),
    confirm_email_enabled: document.getElementById('settingsConfirmEmailEnabled')?.checked ?? true,
    confirm_email_send_on_reschedule: document.getElementById('settingsConfirmEmailReschedule')?.checked ?? false,
    confirm_email_from_name: document.getElementById('settingsConfirmFromName')?.value.trim() || '',
    confirm_email_subject: document.getElementById('settingsConfirmSubject')?.value.trim() || '',
    confirm_email_policy: document.getElementById('settingsConfirmPolicy')?.value || '',
    confirm_email_footer: document.getElementById('settingsConfirmFooter')?.value.trim() || '',
    confirm_public_url: document.getElementById('settingsConfirmPublicUrl').value.trim(),
    confirm_server_port: document.getElementById('settingsConfirmPort').value.trim() || '3456',
    square_access_token: document.getElementById('settingsSquareToken').value.trim(),
    square_location_id: document.getElementById('settingsSquareLocationId').value.trim(),
    geocoding_provider: document.getElementById('settingsGeocodeProvider')?.value || 'auto',
    mapbox_token: document.getElementById('settingsMapboxToken')?.value.trim() || '',
    anthropic_api_key: document.getElementById('settingsAnthropicKey')?.value.trim() || '',
  };

  const result = await window.api.saveSettings(data);
  if (result.success) {
    // Apply auto-start setting
    const autoStart = document.getElementById('settingsAutoStart')?.checked || false;
    await window.api.setAutoStart(autoStart);

    // Restart confirm server in case port/url changed
    const serverResult = await window.api.restartConfirmServer();
    const statusEl = document.getElementById('confirmServerStatus');
    if (statusEl) statusEl.innerHTML = `<span style="color:#388e3c;font-weight:600;">✓ Confirmation server running on port ${serverResult.port}</span>`;

    showToast('Settings saved.', 'success');
  }
}

// Send a test SMTP email using the values CURRENTLY typed in the Settings form
// (without forcing a save). Shows a clear inline success / error so the user
// can diagnose why confirmation emails aren't going out.
// Test that the Mapbox token works by asking it to geocode a deliberately
// rural address (8 Raccoon Ln, Cushing — the one OSM misses).
async function testMapboxTokenBtn() {
  const tokenEl = document.getElementById('settingsMapboxToken');
  const resultEl = document.getElementById('mapboxTestResult');
  if (!tokenEl || !resultEl) return;
  const token = tokenEl.value.trim();
  if (!token) {
    resultEl.innerHTML = '<span style="color:#b71c1c;">Enter a token first.</span>';
    return;
  }
  resultEl.innerHTML = '<span style="color:#555;">Testing…</span>';
  try {
    const r = await window.api.testMapboxToken(token);
    if (r.success) {
      if (r.match) {
        resultEl.innerHTML = '<span style="color:#2e7d32;font-weight:600;">✓ Token works.</span> '
          + '<span style="color:#555;">Geocoded test address as: <strong>' + esc(r.match) + '</strong> '
          + '(accuracy: ' + esc(r.accuracy || 'unknown') + ', relevance: ' + (r.relevance != null ? r.relevance.toFixed(2) : '—') + ')</span>';
      } else {
        resultEl.innerHTML = '<span style="color:#2e7d32;font-weight:600;">✓ Token works.</span> '
          + '<span style="color:#555;">' + esc(r.note || '') + '</span>';
      }
    } else {
      resultEl.innerHTML = '<span style="color:#b71c1c;font-weight:600;">✗ ' + esc(r.error || 'Token test failed') + '</span>';
    }
  } catch (e) {
    resultEl.innerHTML = '<span style="color:#b71c1c;">✗ ' + esc(e.message || 'Error') + '</span>';
  }
}

async function clearGeocodeCacheBtn() {
  if (!confirm('Delete every saved map coordinate?\n\n'
    + 'Next time you open the map, every address will re-resolve through your currently-selected geocoding provider. '
    + 'For 5,000 customers this can take a few minutes (mostly rate-limited if on OSM).\n\n'
    + 'Do this after switching providers (e.g. OSM → Mapbox) so stale coords get replaced with better ones.')) return;
  const r = await window.api.clearGeocodeCache();
  if (r && r.success) {
    showToast('Geocode cache cleared. Open the map to re-resolve addresses.', 'success');
    // Also clear in-memory cache so current session picks up the change
    if (typeof mapGeoCache !== 'undefined') mapGeoCache = {};
  } else {
    showToast('Failed to clear geocode cache.', 'error');
  }
}

async function sendSmtpTestEmail() {
  const btn = document.getElementById('settingsSendTestEmailBtn');
  const resultEl = document.getElementById('settingsTestEmailResult');
  const toEl = document.getElementById('settingsTestEmailTo');
  const to = (toEl?.value || '').trim();

  if (!resultEl || !btn) return;
  resultEl.style.display = 'block';

  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    resultEl.innerHTML = '<span style="color:#b71c1c;">✗ Enter a valid recipient email address.</span>';
    return;
  }

  // Gather live form values so we test exactly what the user is looking at.
  const liveSettings = {
    smtp_host: document.getElementById('settingsSmtpHost')?.value.trim() || '',
    smtp_port: document.getElementById('settingsSmtpPort')?.value.trim() || '587',
    smtp_user: document.getElementById('settingsSmtpUser')?.value.trim() || '',
    smtp_pass: document.getElementById('settingsSmtpPass')?.value || '',
    company_name: document.getElementById('settingsCompanyName')?.value.trim() || '',
    company_phone: document.getElementById('settingsCompanyPhone')?.value.trim() || '',
    company_address: document.getElementById('settingsCompanyAddress')?.value.trim() || '',
    confirm_email_from_name: document.getElementById('settingsConfirmFromName')?.value.trim() || '',
    confirm_email_subject: document.getElementById('settingsConfirmSubject')?.value.trim() || '',
    confirm_email_policy: document.getElementById('settingsConfirmPolicy')?.value || '',
    confirm_email_footer: document.getElementById('settingsConfirmFooter')?.value.trim() || '',
    confirm_public_url: document.getElementById('settingsConfirmPublicUrl')?.value.trim() || '',
    confirm_server_port: document.getElementById('settingsConfirmPort')?.value.trim() || '3456',
  };

  btn.disabled = true;
  const originalLabel = btn.innerHTML;
  btn.innerHTML = '⏳ Sending...';
  resultEl.innerHTML = '<span style="color:#555;">Connecting to SMTP server and sending test message...</span>';

  try {
    const res = await window.api.sendTestEmail({ to, settings: liveSettings });
    if (res && res.success) {
      resultEl.innerHTML = `<div style="background:#e8f5e9;border:1px solid #81c784;border-radius:4px;padding:10px 12px;color:#1b5e20;">
        ✓ Test email sent to <strong>${esc(to)}</strong>. Check the inbox (and spam folder) in the next minute.
        <div style="font-size:11px;color:#555;margin-top:4px;">Message ID: ${esc(res.messageId || '')}</div>
      </div>`;
    } else {
      const msg = (res && res.error) || 'Unknown error';
      resultEl.innerHTML = `<div style="background:#ffebee;border:1px solid #ef9a9a;border-radius:4px;padding:10px 12px;color:#b71c1c;">
        ✗ Test email failed: <strong>${esc(msg)}</strong>
        <div style="font-size:11px;color:#555;margin-top:6px;">
          Common fixes:<br>
          • For Gmail, SMTP Password must be a 16-char <strong>App Password</strong> (no spaces) — not your regular Google password<br>
          • SMTP Host: <code>smtp.gmail.com</code> &nbsp; Port: <code>587</code> &nbsp; User: your full Gmail address<br>
          • Make sure 2-Step Verification is enabled on the Google account so App Passwords are available
        </div>
      </div>`;
    }
  } catch (err) {
    resultEl.innerHTML = `<span style="color:#b71c1c;">✗ Error: ${esc(err.message || String(err))}</span>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalLabel;
  }
}

async function saveUserColor(userId, color) {
  await window.api.saveUser({ id: userId, color });
  loadSettings();
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

function _importProgressHTML(title) {
  return `
    <div style="background:var(--bg);border-radius:8px;padding:20px;border:1px solid var(--border);">
      <div style="font-size:15px;font-weight:600;margin-bottom:12px;" id="importProgTitle">${esc(title)}</div>
      <div style="font-size:12px;color:var(--text-light);margin-bottom:6px;" id="importProgMessage">Preparing…</div>
      <div style="height:14px;background:#e0e0e0;border-radius:7px;overflow:hidden;margin-bottom:8px;">
        <div id="importProgBar" style="height:100%;width:0%;background:linear-gradient(90deg,#1565c0,#42a5f5);transition:width 0.15s;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-light);">
        <span id="importProgCount">0 / 0</span>
        <span id="importProgStats"></span>
      </div>
      <div style="margin-top:12px;font-size:11px;color:var(--text-light);font-style:italic;">
        Keep this window open. The app will stay responsive.
      </div>
    </div>
  `;
}

function _updateImportProgress(p) {
  const titleEl = document.getElementById('importProgTitle');
  const msgEl = document.getElementById('importProgMessage');
  const barEl = document.getElementById('importProgBar');
  const countEl = document.getElementById('importProgCount');
  const statsEl = document.getElementById('importProgStats');
  if (!barEl) return;
  const stageLabels = { reading: 'Reading file…', grouping: 'Grouping rows…', importing: 'Importing…', saving: 'Saving to disk…', done: 'Complete!', error: 'Error' };
  if (titleEl && p.stage && stageLabels[p.stage]) titleEl.textContent = stageLabels[p.stage];
  if (msgEl) msgEl.textContent = p.message || (p.stage === 'importing' ? 'Processing rows…' : '');
  if (p.total) {
    const pct = Math.min(100, Math.round((p.current / p.total) * 100));
    barEl.style.width = pct + '%';
    if (countEl) countEl.textContent = `${p.current.toLocaleString()} / ${p.total.toLocaleString()} (${pct}%)`;
  } else if (p.stage === 'saving' || p.stage === 'done') {
    barEl.style.width = '100%';
  }
  if (statsEl) {
    const parts = [];
    if (p.imported != null) parts.push(`${p.imported} imported`);
    if (p.skipped != null) parts.push(`${p.skipped} skipped`);
    if (p.propsCreated != null) parts.push(`${p.propsCreated} properties`);
    if (p.tanksCreated != null) parts.push(`${p.tanksCreated} tanks`);
    statsEl.textContent = parts.join(' • ');
  }
}

function _disableImportButtons(disabled) {
  document.querySelectorAll('#importArea button').forEach(b => { b.disabled = disabled; });
}

async function importTankTrackStart() {
  if (_importInProgress) { showToast('Import already running — please wait.', 'error'); return; }
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

let _importInProgress = false;
async function importTankTrackExecute(max) {
  if (_importInProgress) { showToast('Import already running — please wait.', 'error'); return; }
  _importInProgress = true;
  const area = document.getElementById('importArea');
  _disableImportButtons(true);
  area.innerHTML = _importProgressHTML('Importing customers…');
  window.api.offImportProgress();
  window.api.onImportProgress((p) => _updateImportProgress(p));

  let result;
  try {
    result = await window.api.importExecuteTanktrack(_importFilePath, max || 0);
  } finally {
    window.api.offImportProgress();
    _importInProgress = false;
  }
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
  if (_importInProgress) { showToast('Import already running — please wait.', 'error'); return; }
  _importInProgress = true;
  const area = document.getElementById('importArea');
  _disableImportButtons(true);
  area.innerHTML = _importProgressHTML('Importing invoices…');
  window.api.offImportProgress();
  window.api.onImportProgress((p) => _updateImportProgress(p));

  let result;
  try {
    result = await window.api.importInvoicesTanktrack(_importFilePath);
  } finally {
    window.api.offImportProgress();
    _importInProgress = false;
  }
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
  return div.innerHTML.replace(/"/g, '&quot;');
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

// ===== MOTIVE WEBVIEW CONTROLS =====
function _motiveWv() { return document.getElementById('motiveWebview'); }
function motiveGo(dir) {
  const wv = _motiveWv(); if (!wv) return;
  try { dir < 0 ? wv.goBack() : wv.goForward(); } catch (_) {}
}
function motiveReload() {
  const wv = _motiveWv(); if (!wv) return;
  try { wv.reload(); } catch (_) {}
}
function motiveHome() {
  const wv = _motiveWv(); if (!wv) return;
  try { wv.loadURL('https://app.gomotive.com/en-US/#/fleetview/map'); } catch (_) {}
}

// ===== MESSENGER WEBVIEW CONTROLS =====
let _messengerBadgePoll = null;

function _messengerWv() { return document.getElementById('messengerWebview'); }

function messengerGo(dir) {
  const wv = _messengerWv(); if (!wv) return;
  try { dir < 0 ? wv.goBack() : wv.goForward(); } catch (_) {}
}
function messengerReload() {
  const wv = _messengerWv(); if (!wv) return;
  try { wv.reload(); } catch (_) {}
}
function messengerHome() {
  const wv = _messengerWv(); if (!wv) return;
  try { wv.loadURL('https://www.messenger.com'); } catch (_) {}
}

let _messengerBadgeDebounce = null;

// Update the red badge — debounced so rapid title-change events don't thrash it
function _updateMessengerBadge(count) {
  clearTimeout(_messengerBadgeDebounce);
  _messengerBadgeDebounce = setTimeout(() => {
    const navBtn = document.querySelector('[data-page="messenger"]');
    if (!navBtn) return;
    let badge = navBtn.querySelector('.messenger-badge');
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'messenger-badge';
        navBtn.appendChild(badge);
      }
      const label = count > 99 ? '99+' : String(count);
      if (badge.textContent !== label) badge.textContent = label;
    } else {
      if (badge) badge.remove();
    }
  }, 400);
}

// Scrape total unread message count from the Messenger webview DOM.
// Key rule: if the page title says there ARE unread conversations, never return 0
// (the conversation list may not be rendered in the background, causing false zeros).
const _MESSENGER_SCRAPE_JS = `(function() {
  var titleMatch = document.title.match(/^\\((\\d+)\\)/);
  var titleCount = titleMatch ? parseInt(titleMatch[1]) : 0;
  var domTotal = 0;
  var els = document.querySelectorAll('[aria-label]');
  for (var i = 0; i < els.length; i++) {
    var lbl = els[i].getAttribute('aria-label') || '';
    var m = lbl.match(/(\\d+)\\s+unread\\s+message/i);
    if (m) domTotal += parseInt(m[1]);
  }
  if (titleCount === 0) return 0;          // title says clear — trust it
  return domTotal > 0 ? domTotal : titleCount; // prefer DOM sum, fall back to title
})()`;

async function _scrapeMessengerUnread() {
  const wv = _messengerWv();
  if (!wv) return;
  try {
    const count = await wv.executeJavaScript(_MESSENGER_SCRAPE_JS);
    _updateMessengerBadge(typeof count === 'number' ? count : 0);
  } catch (_) {}
}

// Listen for messenger webview title changes to detect unread messages
function _initMessengerBadge() {
  if (_messengerBadgePoll) return; // already set up
  _messengerBadgePoll = true;
  const wv = _messengerWv();
  if (!wv) return;
  // page-title-updated fires instantly whenever the tab title changes — use as trigger to re-scrape
  wv.addEventListener('page-title-updated', () => _scrapeMessengerUnread());
  // Also scrape right now in case webview is already loaded with unread messages
  _scrapeMessengerUnread();
}
