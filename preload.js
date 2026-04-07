const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  login: (data) => ipcRenderer.invoke('login', data),
  verifyPassword: (username, password) => ipcRenderer.invoke('verify-password', { username, password }),
  getEmployees: (filters) => ipcRenderer.invoke('get-employees', filters),
  getEmployeeCount: () => ipcRenderer.invoke('get-employee-count'),
  getEmployeeById: (id) => ipcRenderer.invoke('get-employee-by-id', id),
  getSubdivisions: () => ipcRenderer.invoke('get-subdivisions'),
  getPositions: () => ipcRenderer.invoke('get-positions'),
  addEmployee: (data) => ipcRenderer.invoke('add-employee', data),
  updateEmployee: (data) => ipcRenderer.invoke('update-employee', data),
  deleteEmployee: (id) => ipcRenderer.invoke('delete-employee', id),
  // Leave record
  getLeaveTypes: () => ipcRenderer.invoke('get-leave-types'),
  getDailyReports: (f) => ipcRenderer.invoke('get-daily-reports', f),
  addDailyReport: (d) => ipcRenderer.invoke('add-daily-report', d),
  updateDailyReport: (d) => ipcRenderer.invoke('update-daily-report', d),
  deleteDailyReport: (id) => ipcRenderer.invoke('delete-daily-report', id),
  // Daily absence report
  getDailyReportByDate: (date) => ipcRenderer.invoke('get-daily-report-by-date', date),
  getTodayOnLeave: () => ipcRenderer.invoke('get-today-on-leave'),
  exportAbsenceExcel: (d) => ipcRenderer.invoke('export-absence-excel', d),
  // Training record
  getTrainingPlansForRecord: () => ipcRenderer.invoke('get-training-plans-for-record'),
  getTrainingRecordParticipants: (planId) => ipcRenderer.invoke('get-training-record-participants', planId),
  saveTrainingRecordRow: (d) => ipcRenderer.invoke('save-training-record-row', d),
  exportTrainingRecordExcel: (d) => ipcRenderer.invoke('export-training-record-excel', d),
  // Training history
  getEmployeeTraining: (empId) => ipcRenderer.invoke('get-employee-training', empId),
  // Training management
  getCourses: () => ipcRenderer.invoke('get-courses'),
  getTrainingPlans: (filters) => ipcRenderer.invoke('get-training-plans', filters),
  saveTrainingPlan: (data) => ipcRenderer.invoke('save-training-plan', data),
  getTrainingParticipants: (planId) => ipcRenderer.invoke('get-training-participants', planId),
  searchEmployees: (payload) => ipcRenderer.invoke('search-employees', payload),
  getNextPlanId: () => ipcRenderer.invoke('get-next-plan-id'),
  // Training expenses
  getNextExpenseId: () => ipcRenderer.invoke('get-next-expense-id'),
  searchPlansForExpense: (payload) => ipcRenderer.invoke('search-plans-for-expense', payload),
  getExpenses: (filters) => ipcRenderer.invoke('get-expenses', filters),
  saveExpense: (data) => ipcRenderer.invoke('save-expense', data),
  // Holiday
  getHolidays: (payload) => ipcRenderer.invoke('get-holidays', payload),
  saveHoliday: (data) => ipcRenderer.invoke('save-holiday', data),
  deleteHoliday: (id) => ipcRenderer.invoke('delete-holiday', id),
  // OT
  getHolidaysForMonth: (payload) => ipcRenderer.invoke('get-holidays-for-month', payload),
  exportOtExcel: (data) => ipcRenderer.invoke('export-ot-excel', data),
  exportOtPdf: (data) => ipcRenderer.invoke('export-ot-pdf', data),
  updateSubdivisionSupervisor: (data) => ipcRenderer.invoke('update-subdivision-supervisor', data),
});
