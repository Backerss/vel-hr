const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  login: (data) => ipcRenderer.invoke('login', data),
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
});
