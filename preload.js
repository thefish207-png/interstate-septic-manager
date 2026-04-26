const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Customers
  getCustomers: (search) => ipcRenderer.invoke('get-customers', search),
  getCustomersLite: () => ipcRenderer.invoke('get-customers-lite'),
  sendTestEmail: (payload) => ipcRenderer.invoke('send-test-email', payload),
  getCustomer: (id) => ipcRenderer.invoke('get-customer', id),
  saveCustomer: (data) => ipcRenderer.invoke('save-customer', data),
  deleteCustomer: (id) => ipcRenderer.invoke('delete-customer', id),

  // Properties
  getProperties: (customerId) => ipcRenderer.invoke('get-properties', customerId),
  getProperty: (id) => ipcRenderer.invoke('get-property', id),
  saveProperty: (data) => ipcRenderer.invoke('save-property', data),
  deleteProperty: (id) => ipcRenderer.invoke('delete-property', id),

  // Tanks
  getTanks: (propertyId) => ipcRenderer.invoke('get-tanks', propertyId),
  saveTank: (data) => ipcRenderer.invoke('save-tank', data),
  deleteTank: (id) => ipcRenderer.invoke('delete-tank', id),

  // Vehicles
  getVehicles: () => ipcRenderer.invoke('get-vehicles'),
  saveVehicle: (data) => ipcRenderer.invoke('save-vehicle', data),
  deleteVehicle: (id) => ipcRenderer.invoke('delete-vehicle', id),
  reorderVehicles: (orderedIds) => ipcRenderer.invoke('reorder-vehicles', orderedIds),
  getTruckDayAssignments: (date) => ipcRenderer.invoke('get-truck-day-assignments', date),
  saveTruckDayAssignment: (data) => ipcRenderer.invoke('save-truck-day-assignment', data),

  // Jobs
  getJobs: (filters) => ipcRenderer.invoke('get-jobs', filters),
  getJob: (id) => ipcRenderer.invoke('get-job', id),
  saveJob: (data) => ipcRenderer.invoke('save-job', data),
  updateJobStatus: (id, status) => ipcRenderer.invoke('update-job-status', id, status),
  deleteJob: (id) => ipcRenderer.invoke('delete-job', id),

  // Invoices
  getInvoices: (filters) => ipcRenderer.invoke('get-invoices', filters),
  getInvoice: (id) => ipcRenderer.invoke('get-invoice', id),
  saveInvoice: (data) => ipcRenderer.invoke('save-invoice', data),
  deleteInvoice: (id) => ipcRenderer.invoke('delete-invoice', id),
  getNextInvoiceNumber: () => ipcRenderer.invoke('get-next-invoice-number'),
  getInvoiceFilterOptions: () => ipcRenderer.invoke('get-invoice-filter-options'),
  backfillInvoices: () => ipcRenderer.invoke('backfill-invoices'),

  // Payments / Accounting
  getCustomerBalance: (customerId) => ipcRenderer.invoke('get-customer-balance', customerId),
  getPayments: (customerId) => ipcRenderer.invoke('get-payments', customerId),
  savePayment: (data) => ipcRenderer.invoke('save-payment', data),
  deletePayment: (id) => ipcRenderer.invoke('delete-payment', id),

  // Reminders
  getReminders: (filters) => ipcRenderer.invoke('get-reminders', filters),
  saveReminder: (data) => ipcRenderer.invoke('save-reminder', data),
  deleteReminder: (id) => ipcRenderer.invoke('delete-reminder', id),
  updateReminderStatus: (id, status) => ipcRenderer.invoke('update-reminder-status', id, status),

  // Service Contracts
  getServiceContracts: (filters) => ipcRenderer.invoke('get-service-contracts', filters),
  saveServiceContract: (data) => ipcRenderer.invoke('save-service-contract', data),
  deleteServiceContract: (id) => ipcRenderer.invoke('delete-service-contract', id),

  // Service Due Notices
  getServiceDueNotices: (filters) => ipcRenderer.invoke('get-service-due-notices', filters),
  saveServiceDueNotice: (data) => ipcRenderer.invoke('save-service-due-notice', data),
  deleteServiceDueNotice: (id) => ipcRenderer.invoke('delete-service-due-notice', id),
  sendServiceDueNotification: (id, daysBeforeDue) => ipcRenderer.invoke('send-service-due-notification', id, daysBeforeDue),
  scheduleServiceDueNotifications: (id, schedule) => ipcRenderer.invoke('schedule-service-due-notifications', id, schedule),

  // Disposal
  getDisposalLoads: (filters) => ipcRenderer.invoke('get-disposal-loads', filters),
  saveDisposalLoad: (data) => ipcRenderer.invoke('save-disposal-load', data),
  deleteDisposalLoad: (id) => ipcRenderer.invoke('delete-disposal-load', id),
  getDisposalSummary: (period) => ipcRenderer.invoke('get-disposal-summary', period),
  getNextDisposalNumber: () => ipcRenderer.invoke('get-next-disposal-number'),

  // Day Notes
  getDayNote: (date) => ipcRenderer.invoke('get-day-note', date),
  saveDayNote: (data) => ipcRenderer.invoke('save-day-note', data),
  deleteDayNote: (date) => ipcRenderer.invoke('delete-day-note', date),

  // Schedule Items (manifests & driver changes on schedule)
  getScheduleItems: (vehicleId, date) => ipcRenderer.invoke('get-schedule-items', vehicleId, date),
  saveScheduleItem: (data) => ipcRenderer.invoke('save-schedule-item', data),
  deleteScheduleItem: (id) => ipcRenderer.invoke('delete-schedule-item', id),
  getNextManifestNumber: () => ipcRenderer.invoke('get-next-manifest-number'),

  // Waste Sites
  getWasteSites: () => ipcRenderer.invoke('get-waste-sites'),
  saveWasteSite: (data) => ipcRenderer.invoke('save-waste-site', data),
  deleteWasteSite: (id) => ipcRenderer.invoke('delete-waste-site', id),
  getDefaultWasteSite: () => ipcRenderer.invoke('get-default-waste-site'),

  // Outside Pumpers
  getOutsidePumpers: () => ipcRenderer.invoke('get-outside-pumpers'),
  saveOutsidePumper: (data) => ipcRenderer.invoke('save-outside-pumper', data),
  deleteOutsidePumper: (id) => ipcRenderer.invoke('delete-outside-pumper', id),

  // AR Report
  getArReport: () => ipcRenderer.invoke('get-ar-report'),

  // P&L Snapshots
  getPlSnapshots: () => ipcRenderer.invoke('get-pl-snapshots'),
  savePlSnapshot: (data) => ipcRenderer.invoke('save-pl-snapshot', data),
  deletePlSnapshot: (id) => ipcRenderer.invoke('delete-pl-snapshot', id),
  importPlFile: () => ipcRenderer.invoke('import-pl-file'),

  // Expense snapshots (AI-extracted from PDFs)
  getExpenseSnapshots: () => ipcRenderer.invoke('get-expense-snapshots'),
  saveExpenseSnapshot: (data) => ipcRenderer.invoke('save-expense-snapshot', data),
  deleteExpenseSnapshot: (id) => ipcRenderer.invoke('delete-expense-snapshot', id),
  importExpensePdfAi: () => ipcRenderer.invoke('import-expense-pdf-ai'),
  importExpensePdfAiBatch: () => ipcRenderer.invoke('import-expense-pdf-ai-batch'),
  onExpenseImportProgress: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('expense-import-progress', handler);
    return () => ipcRenderer.removeListener('expense-import-progress', handler);
  },
  onZoomChanged: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('zoom-changed', handler);
    return () => ipcRenderer.removeListener('zoom-changed', handler);
  },

  // Square
  squareSearchCustomers: (query) => ipcRenderer.invoke('square-search-customers', query),
  squareListCards: (squareCustomerId) => ipcRenderer.invoke('square-list-cards', squareCustomerId),
  squareCharge: (data) => ipcRenderer.invoke('square-charge', data),
  squareTest: () => ipcRenderer.invoke('square-test'),

  // DEP Reports
  getDepReports: () => ipcRenderer.invoke('get-dep-reports'),
  generateDepReport: (period) => ipcRenderer.invoke('generate-dep-report', period),
  sendDepReport: (reportId) => ipcRenderer.invoke('send-dep-report', reportId),

  // Services / Products
  getServiceCategories: () => ipcRenderer.invoke('get-service-categories'),
  saveServiceCategory: (data) => ipcRenderer.invoke('save-service-category', data),
  deleteServiceCategory: (id) => ipcRenderer.invoke('delete-service-category', id),
  getServiceProducts: (categoryId) => ipcRenderer.invoke('get-service-products', categoryId),
  saveServiceProduct: (data) => ipcRenderer.invoke('save-service-product', data),
  deleteServiceProduct: (id) => ipcRenderer.invoke('delete-service-product', id),

  // Auth
  authNeedsSetup: () => ipcRenderer.invoke('auth-needs-setup'),
  authSetup: (data) => ipcRenderer.invoke('auth-setup', data),
  authLogin: (username, password) => ipcRenderer.invoke('auth-login', username, password),
  changePassword: (userId, newPassword) => ipcRenderer.invoke('change-password', userId, newPassword),
  getSavedCreds: () => ipcRenderer.invoke('get-saved-creds'),
  clearSavedCreds: () => ipcRenderer.invoke('clear-saved-creds'),

  // Tank Types
  getTankTypes: () => ipcRenderer.invoke('get-tank-types'),
  saveTankType: (data) => ipcRenderer.invoke('save-tank-type', data),
  deleteTankType: (id) => ipcRenderer.invoke('delete-tank-type', id),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (data) => ipcRenderer.invoke('save-settings', data),
  getUsers: () => ipcRenderer.invoke('get-users'),
  saveUser: (data) => ipcRenderer.invoke('save-user', data),
  deleteUser: (id) => ipcRenderer.invoke('delete-user', id),

  // App info
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Auto-updater
  installUpdateNow: () => ipcRenderer.invoke('install-update-now'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_e, p) => cb(p)),
  onUpdateProgress: (cb) => ipcRenderer.on('update-progress', (_e, p) => cb(p)),
  onUpdateReady: (cb) => ipcRenderer.on('update-ready', (_e, p) => cb(p)),

  // Cloud sync warnings (when an optimistic write doesn't reach the cloud)
  onCloudWarning: (cb) => ipcRenderer.on('cloud-warning', (_e, p) => cb(p)),

  // Cloud (Supabase) Users
  cloudConfigStatus: () => ipcRenderer.invoke('cloud-config-status'),
  cloudLogin: (username, password) => ipcRenderer.invoke('cloud-login', username, password),
  cloudLogout: () => ipcRenderer.invoke('cloud-logout'),
  cloudRestoreSession: () => ipcRenderer.invoke('cloud-restore-session'),
  cloudUsersList: () => ipcRenderer.invoke('cloud-users-list'),
  cloudUsersCreate: (data) => ipcRenderer.invoke('cloud-users-create', data),
  cloudUsersUpdate: (userId, updates) => ipcRenderer.invoke('cloud-users-update', userId, updates),
  cloudUsersDelete: (userId) => ipcRenderer.invoke('cloud-users-delete', userId),

  // PDF & Email
  generatePdf: (html, filename, options) => ipcRenderer.invoke('generate-pdf', html, filename, options),
  sendEmail: (to, subject, body, attachmentPath) => ipcRenderer.invoke('send-email', to, subject, body, attachmentPath),

  // File operations
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),

  // Recycling Bin
  getTrash: () => ipcRenderer.invoke('get-trash'),
  restoreTrashItem: (id, type) => ipcRenderer.invoke('restore-trash-item', id, type),
  purgeTrashItem: (id, type) => ipcRenderer.invoke('purge-trash-item', id, type),

  // Automatic Filter Cleanings (AFC)
  ensureFilterLead: (data) => ipcRenderer.invoke('ensure-filter-lead', data),
  getFilterLeads: (filters) => ipcRenderer.invoke('get-filter-leads', filters),
  saveFilterLead: (data) => ipcRenderer.invoke('save-filter-lead', data),
  deleteFilterLead: (id) => ipcRenderer.invoke('delete-filter-lead', id),
  getAfcs: (filters) => ipcRenderer.invoke('get-afcs', filters),
  saveAfc: (data) => ipcRenderer.invoke('save-afc', data),
  deleteAfc: (id) => ipcRenderer.invoke('delete-afc', id),

  // Seed
  seedTestData: () => ipcRenderer.invoke('seed-test-data'),
  unseedTestData: () => ipcRenderer.invoke('unseed-test-data'),

  // Geocode cache + provider
  getGeocodeCache: () => ipcRenderer.invoke('get-geocode-cache'),
  saveGeocodeCache: (entry) => ipcRenderer.invoke('save-geocode-cache', entry),
  geocodeAddress: (parts) => ipcRenderer.invoke('geocode-address', parts),
  testMapboxToken: (token) => ipcRenderer.invoke('test-mapbox-token', token),
  clearGeocodeCache: () => ipcRenderer.invoke('clear-geocode-cache'),

  // TankTrack Import
  importSelectFile: () => ipcRenderer.invoke('import-select-file'),
  importPreviewTanktrack: (filePath, limit) => ipcRenderer.invoke('import-preview-tanktrack', filePath, limit),
  importExecuteTanktrack: (filePath, maxCustomers) => ipcRenderer.invoke('import-execute-tanktrack', filePath, maxCustomers),
  importInvoicesTanktrack: (filePath) => ipcRenderer.invoke('import-invoices-tanktrack', filePath),

  // Confirmation server
  restartConfirmServer: () => ipcRenderer.invoke('restart-confirm-server'),
  getConfirmServerStatus: () => ipcRenderer.invoke('get-confirm-server-status'),

  // Popup windows
  openPopupWindow: (data) => ipcRenderer.invoke('open-popup-window', data),

  // Auto-start
  setAutoStart: (enabled) => ipcRenderer.invoke('set-auto-start', enabled),
  getAutoStart: () => ipcRenderer.invoke('get-auto-start'),

  // Event listeners
  onReminderAlert: (callback) => ipcRenderer.on('reminder-alert', (e, data) => callback(data)),
  onSdnConfirmed: (callback) => ipcRenderer.on('sdn-confirmed', (e, data) => callback(data)),
  onDataChanged: (callback) => ipcRenderer.on('data-changed', (e, data) => callback(data)),
  onDockPage: (callback) => ipcRenderer.on('dock-page', (e, page) => callback(page)),
  onPopupNearTabbar: (callback) => ipcRenderer.on('popup-near-tabbar', (e, data) => callback(data)),
  onImportProgress: (callback) => ipcRenderer.on('import-progress', (e, data) => callback(data)),
  offImportProgress: () => ipcRenderer.removeAllListeners('import-progress'),
  onBulkDeleteProgress: (callback) => ipcRenderer.on('bulk-delete-progress', (e, data) => callback(data)),
  offBulkDeleteProgress: () => ipcRenderer.removeAllListeners('bulk-delete-progress'),
  bulkDeleteCustomers: (ids) => ipcRenderer.invoke('bulk-delete-customers', ids),
  bulkDeleteJobs: (ids) => ipcRenderer.invoke('bulk-delete-jobs', ids),
  bulkDeleteInvoices: (ids) => ipcRenderer.invoke('bulk-delete-invoices', ids),
  bulkCancelInvoices: (ids, cancel) => ipcRenderer.invoke('bulk-cancel-invoices', ids, cancel),

  // Dock popup back to main window tab
  dockToMain: (page) => ipcRenderer.invoke('dock-to-main', page),

  // Motive GPS
  getMotiveLocations: () => ipcRenderer.invoke('get-motive-locations'),

  // In-page find
  findInPage: (text, opts) => ipcRenderer.invoke('find-in-page', { text, ...(opts || {}) }),
  stopFindInPage: () => ipcRenderer.invoke('stop-find-in-page'),
  onFindInPageResult: (cb) => ipcRenderer.on('find-in-page-result', (_e, r) => cb(r)),
});
