const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Customers
  getCustomers: (search) => ipcRenderer.invoke('get-customers', search),
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

  // Disposal
  getDisposalLoads: (filters) => ipcRenderer.invoke('get-disposal-loads', filters),
  saveDisposalLoad: (data) => ipcRenderer.invoke('save-disposal-load', data),
  deleteDisposalLoad: (id) => ipcRenderer.invoke('delete-disposal-load', id),
  getDisposalSummary: (period) => ipcRenderer.invoke('get-disposal-summary', period),

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

  // PDF & Email
  generatePdf: (html, filename) => ipcRenderer.invoke('generate-pdf', html, filename),
  sendEmail: (to, subject, body, attachmentPath) => ipcRenderer.invoke('send-email', to, subject, body, attachmentPath),

  // File operations
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),

  // Seed
  seedTestData: () => ipcRenderer.invoke('seed-test-data'),
  unseedTestData: () => ipcRenderer.invoke('unseed-test-data'),

  // Geocode cache
  getGeocodeCache: () => ipcRenderer.invoke('get-geocode-cache'),
  saveGeocodeCache: (entry) => ipcRenderer.invoke('save-geocode-cache', entry),

  // TankTrack Import
  importSelectFile: () => ipcRenderer.invoke('import-select-file'),
  importPreviewTanktrack: (filePath, limit) => ipcRenderer.invoke('import-preview-tanktrack', filePath, limit),
  importExecuteTanktrack: (filePath, maxCustomers) => ipcRenderer.invoke('import-execute-tanktrack', filePath, maxCustomers),
  importInvoicesTanktrack: (filePath) => ipcRenderer.invoke('import-invoices-tanktrack', filePath),

  // Event listeners
  onReminderAlert: (callback) => ipcRenderer.on('reminder-alert', (e, data) => callback(data)),
});
