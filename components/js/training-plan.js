// ===================== TRAINING PLAN MANAGEMENT PAGE =====================
import { escHtml, showToast, showModal, closeModal, formatDate } from './utils.js';

export let allTrainingPlans = [];
export let filteredTrainingPlans = [];
export let allCourses = [];
let selectedParticipants = [];
let trainingCurrentPage = 1;
let trainingPerPage = 25;
let trainingTotalCount = 0;
let trainingSearchTimer = null;
let trainingSummary = { total: 0, internal: 0, external: 0 };
let participantSearchTimer = null;
let latestSearchToken = 0;
let lastSuggestionRows = [];
let editingPlanId = null;
let viewingPlanId = null;
let trainingDataLoadFailed = false;
let trainingDataLoadMessage = '';
let pendingParticipantIds = new Set();
let participantsToRemoveIds = new Set();

function withTimeout(promise, ms, name) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${name} timeout`)), ms))
  ]);
}

// ===================== AUTO-CALCULATE TRAINING HOURS =====================

// Convert DD/MM/YYYY (BE year) → YYYY-MM-DD (CE year) for DB storage
function formDateToDb(val) {
  if (!val) return '';
  const p = val.split('/');
  if (p.length !== 3 || p[2].length !== 4) return '';
  const ceYear = parseInt(p[2], 10) - 543; // Convert พ.ศ. → ค.ศ.
  return `${ceYear}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
}

// Convert YYYY-MM-DD (CE year from DB) → DD/MM/YYYY (BE year) for display
function dbDateToFormDate(val) {
  if (!val) return '';
  const p = val.split('-');
  if (p.length !== 3) return '';
  const thYear = parseInt(p[0], 10) + 543; // Convert ค.ศ. → พ.ศ.
  return `${p[2]}/${p[1]}/${thYear}`;
}

// Validate and format a date text field on blur (exported for onclick use)
export function formatDateInputField(el) {
  const raw = (el.value || '').trim();
  if (!raw) { el.style.borderColor = ''; return; }
  // Accept DD/MM/YYYY or DD-MM-YYYY or 8-digit DDMMYYYY
  let d, m, y;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) { [d, m, y] = raw.split('/'); }
  else if (/^\d{2}-\d{2}-\d{4}$/.test(raw)) { [d, m, y] = raw.split('-'); }
  else if (/^\d{8}$/.test(raw)) { d = raw.slice(0,2); m = raw.slice(2,4); y = raw.slice(4); }
  else { el.style.borderColor = '#ef4444'; return; }
  const dt = new Date(`${y}-${m}-${d}T00:00:00`);
  if (isNaN(dt.getTime()) || parseInt(m) < 1 || parseInt(m) > 12 || parseInt(d) < 1 || parseInt(d) > 31) {
    el.style.borderColor = '#ef4444'; return;
  }
  el.value = `${d.padStart(2,'0')}/${m.padStart(2,'0')}/${y}`;
  el.style.borderColor = '';
  calcTrainingHours();
}

// Auto-insert '/' separator while typing
export function autoFormatDateField(el) {
  let v = el.value.replace(/[^0-9]/g, '');
  if (v.length > 8) v = v.slice(0, 8);
  if (v.length >= 5) v = v.slice(0,2) + '/' + v.slice(2,4) + '/' + v.slice(4);
  else if (v.length >= 3) v = v.slice(0,2) + '/' + v.slice(2);
  el.value = v;
}

// Validate and format a time text field on blur (exported for onclick use)
export function formatTimeInputField(el) {
  const raw = (el.value || '').replace(/[^0-9:]/g, '').trim();
  if (!raw) { el.style.borderColor = ''; return; }
  let h, min;
  if (/^\d{4}$/.test(raw)) { h = raw.slice(0,2); min = raw.slice(2); }
  else if (/^\d{1,2}:\d{2}$/.test(raw)) { [h, min] = raw.split(':'); }
  else { el.style.borderColor = '#ef4444'; return; }
  const hNum = parseInt(h, 10), mNum = parseInt(min, 10);
  if (isNaN(hNum) || isNaN(mNum) || hNum < 0 || hNum > 23 || mNum < 0 || mNum > 59) {
    el.style.borderColor = '#ef4444'; return;
  }
  el.value = `${String(hNum).padStart(2,'0')}:${String(mNum).padStart(2,'0')}`;
  el.style.borderColor = '';
  calcTrainingHours();
}

// Auto-insert ':' separator while typing time
export function autoFormatTimeField(el) {
  let v = el.value.replace(/[^0-9]/g, '');
  if (v.length > 4) v = v.slice(0, 4);
  if (v.length >= 3) v = v.slice(0,2) + ':' + v.slice(2);
  el.value = v;
}

function calcTrainingHours() {
  const startDateVal = document.getElementById('planStartDate')?.value; // DD/MM/YYYY
  const startTime    = document.getElementById('planTimeStart')?.value; // HH:MM
  const endDateVal   = document.getElementById('planEndDate')?.value;   // DD/MM/YYYY
  const endTime      = document.getElementById('planTimeEnd')?.value;   // HH:MM
  if (!startDateVal || !startTime || !endDateVal || !endTime) return;
  const startDateDb = formDateToDb(startDateVal);
  const endDateDb   = formDateToDb(endDateVal);
  if (!startDateDb || !endDateDb) return;
  // Validate time format HH:MM
  if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) return;
  const start = new Date(`${startDateDb}T${startTime}`);
  const end   = new Date(`${endDateDb}T${endTime}`);
  const diffMs = end - start;
  if (diffMs <= 0) return;
  const hours = Math.round(diffMs / 1000 / 60 / 60 * 10) / 10;
  const el = document.getElementById('planHour');
  if (el && !el.dataset.manuallyEdited) el.value = hours;
}

function initializeDateTimeListeners() {
  ['planStartDate', 'planTimeStart', 'planEndDate', 'planTimeEnd'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const fresh = el.cloneNode(true);
    el.parentNode.replaceChild(fresh, el);
    fresh.addEventListener('blur', calcTrainingHours);
    fresh.addEventListener('change', calcTrainingHours);
  });
  // Allow manual override: mark planHour as manually edited when user types
  const planHourEl = document.getElementById('planHour');
  if (planHourEl) {
    const freshHour = planHourEl.cloneNode(true);
    planHourEl.parentNode.replaceChild(freshHour, planHourEl);
    freshHour.addEventListener('input', () => { freshHour.dataset.manuallyEdited = 'true'; });
    freshHour.addEventListener('focus', () => { freshHour.dataset.manuallyEdited = ''; });
  }
}

function getEmployeeDisplayName(emp) {
  if (emp?.Fullname && String(emp.Fullname).trim()) return String(emp.Fullname).trim();
  return `${emp?.Emp_Sname || ''}${emp?.Emp_Firstname || ''} ${emp?.Emp_Lastname || ''}`.trim();
}

function updateParticipantCountBadge() {
  const badge = document.getElementById('participantCountBadge');
  if (badge) badge.textContent = `${selectedParticipants.length} คน`;
}

// ===================== LOAD TRAINING PAGE =====================
export async function loadTrainingManagementPage() {
  const container = document.getElementById('pageContent');
  container.innerHTML = `<div class="text-center py-5"><div class="spinner" style="margin:0 auto;"></div><p class="mt-3 text-muted">กำลังโหลดข้อมูล...</p></div>`;

  allCourses = [];
  allTrainingPlans = [];
  filteredTrainingPlans = [];
  trainingCurrentPage = 1;
  trainingPerPage = 25;
  trainingTotalCount = 0;
  trainingSummary = { total: 0, internal: 0, external: 0 };
  trainingDataLoadFailed = false;
  trainingDataLoadMessage = '';

  try {
    const response = await fetch('components/html/training.html');
    container.innerHTML = await response.text();
  } catch (e) {
    container.innerHTML = '<p>Error loading template</p>';
    return;
  }

  renderTrainingStats();
  renderTrainingLoadingState();
  await refreshTrainingData({ showLoading: false });
}

function getResultError(result, fallbackMessage) {
  if (!result) return fallbackMessage;
  if (result.status === 'rejected') {
    return result.reason?.message || fallbackMessage;
  }
  if (!result.value?.success) {
    return result.value?.message || fallbackMessage;
  }
  return '';
}

function renderTrainingLoadingState() {
  const tableBody = document.getElementById('trainingTableBody');
  if (!tableBody) return;
  tableBody.innerHTML = `
    <tr class="loading-row">
      <td colspan="8">
        <div class="spinner"></div>
        <div>กำลังโหลดรายการแผนการอบรม...</div>
      </td>
    </tr>`;
}

function renderTrainingErrorState(message) {
  const tableBody = document.getElementById('trainingTableBody');
  if (!tableBody) return;

  tableBody.innerHTML = `
    <tr>
      <td colspan="8">
        <div class="empty-state">
          <div class="empty-icon"><i class="bi bi-exclamation-triangle"></i></div>
          <div class="empty-text">${escHtml(message || 'โหลดข้อมูลแผนการอบรมไม่สำเร็จ')}</div>
        </div>
      </td>
    </tr>`;

  const dc = document.getElementById('trainingDisplayCount');
  const tc = document.getElementById('trainingTotalCount');
  const pc = document.getElementById('trainingPaginationControls');
  if (dc) dc.textContent = '0';
  if (tc) tc.textContent = '0';
  if (pc) pc.innerHTML = '';
}

export async function refreshTrainingData(options = {}) {
  const { showLoading = true, includeCourses = false, page = trainingCurrentPage, perPage = trainingPerPage } = options;

  if (showLoading) {
    renderTrainingLoadingState();
  }

  const search = String(document.getElementById('trainingSearchInput')?.value || '').trim();
  const requestPage = Math.max(1, Number(page) || 1);
  const requestPerPage = Math.max(1, Math.min(Number(perPage) || 25, 100));

  const coursesPromise = (includeCourses || allCourses.length === 0)
    ? (typeof window.api?.getCourses === 'function'
        ? withTimeout(window.api.getCourses(), 10000, 'getCourses')
        : Promise.reject(new Error('ไม่พบ API getCourses')))
    : Promise.resolve({ success: true, data: allCourses });
  const plansPromise = typeof window.api?.getTrainingPlans === 'function'
    ? window.api.getTrainingPlans({ search, page: requestPage, perPage: requestPerPage })
    : Promise.reject(new Error('ไม่พบ API getTrainingPlans'));

  const [coursesRes, plansRes] = await Promise.allSettled([
    coursesPromise,
    plansPromise
  ]);

  const coursesError = getResultError(coursesRes, 'โหลดข้อมูลหลักสูตรไม่สำเร็จ');
  const plansError = getResultError(plansRes, 'โหลดข้อมูลแผนการอบรมไม่สำเร็จ');

  if (!coursesError) {
    allCourses = coursesRes.value.data || [];
  }

  if (plansError) {
    trainingDataLoadFailed = true;
    trainingDataLoadMessage = plansError;
    allTrainingPlans = [];
    filteredTrainingPlans = [];
    trainingTotalCount = 0;
    trainingSummary = { total: 0, internal: 0, external: 0 };
    renderTrainingStats();
    renderTrainingErrorState(plansError);
    showToast(plansError, 'error');
    return;
  }

  trainingDataLoadFailed = false;
  trainingDataLoadMessage = '';
  allTrainingPlans = plansRes.value.data || [];
  filteredTrainingPlans = [...allTrainingPlans];
  trainingCurrentPage = Number(plansRes.value.page) || requestPage;
  trainingPerPage = Number(plansRes.value.perPage) || requestPerPage;
  trainingTotalCount = Number(plansRes.value.total) || 0;
  trainingSummary = plansRes.value.summary || {
    total: trainingTotalCount,
    internal: 0,
    external: 0
  };

  const pageSizeEl = document.getElementById('trainingPageSize');
  if (pageSizeEl) pageSizeEl.value = String(trainingPerPage);

  renderTrainingStats();
  loadTrainingList();

  if (coursesError) {
    showToast(coursesError, 'warning');
  }
}

// ===================== RENDER STAT CARDS =====================
function renderTrainingStats() {
  const s = document.getElementById('statTotalPlans');
  const i = document.getElementById('statInternal');
  const ex = document.getElementById('statExternal');
  if (s) s.textContent = Number(trainingSummary.total || 0).toLocaleString();
  if (i) i.textContent = Number(trainingSummary.internal || 0).toLocaleString();
  if (ex) ex.textContent = Number(trainingSummary.external || 0).toLocaleString();
}

// ===================== OPEN/CLOSE TRAINING MODAL =====================
export async function openTrainingModal(planId = null) {
  editingPlanId = planId;
  selectedParticipants = [];
  pendingParticipantIds = new Set();
  participantsToRemoveIds = new Set();
  lastSuggestionRows = [];
  latestSearchToken = 0;

  const titleEl = document.getElementById('trainingModalTitle');
  if (titleEl) titleEl.textContent = planId ? 'แก้ไขแผนการอบรม' : 'สร้างแผนการอบรม';

  // Reset form
  const form = document.getElementById('trainingForm');
  if (!form) return;
  form.reset();
  const epId = document.getElementById('editingPlanId');
  if (epId) epId.value = planId || '';

  // Populate courses dropdown
  initializeCoursesDropdown();

  // Setup participant picker & date-time auto-calc
  initializeParticipantPicker();
  initializeDateTimeListeners();

  // Load document number preview
  loadNextPlanDocNo(planId);

  // If editing, pre-fill fields
  if (planId) {
    const plan = allTrainingPlans.find(p => p.Plan_ID === planId);
    if (plan) prefillForm(plan);
  }

  renderParticipantsList();
  showModal('trainingFormModal');

  // If editing, load existing participants asynchronously after modal is shown
  if (planId) {
    try {
      const participantsRes = await window.api.getTrainingParticipants(planId);
      if (participantsRes?.success && participantsRes.data?.length > 0) {
        selectedParticipants = participantsRes.data.map(p => ({
          Emp_ID: p.Emp_ID,
          Fullname: p.Fullname || '',
          Sub_Name: p.Sub_Name || '',
          Emp_Firstname: p.Emp_Firstname || '',
          Emp_Lastname: p.Emp_Lastname || ''
        }));
        renderParticipantsList();
      }
    } catch {}
  }
}

export function closeTrainingModal() {
  closeModal('trainingFormModal');
  selectedParticipants = [];
  pendingParticipantIds = new Set();
  participantsToRemoveIds = new Set();
  editingPlanId = null;
  clearParticipantSearch();
}

// ===================== DOCUMENT NUMBER PREVIEW =====================
async function loadNextPlanDocNo(planId) {
  const el = document.getElementById('planDocNoDisplay');
  if (!el) return;
  if (planId) {
    // Editing: show existing plan's document number (Plan_ID is already 'PN00000XXX' format)
    el.textContent = String(planId);
    return;
  }
  // Creating: fetch predicted next ID
  try {
    const res = await window.api.getNextPlanId?.();
    if (res?.success) {
      el.textContent = `PN${String(res.nextId).padStart(8, '0')}`;
      el.title = `เลขที่เอกสารนี้เป็นค่าประมาณการ — เลขจริงจะถูกกำหนดเมื่อบันทึก`;
    } else {
      el.textContent = 'PN????????';
    }
  } catch {
    el.textContent = 'PN????????';
  }
}

// ===================== PRE-FILL FORM FOR EDIT =====================
function prefillForm(plan) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  set('coursesId', plan.Courses_ID);
  set('planTypeTraining', plan.Plan_TypeTraining);
  set('planCompany', plan.Plan_Company);
  set('planLocation', plan.Plan_Location);
  set('planLecturer', plan.Plan_Lecturer);
  set('planCoordinator', plan.Plan_Coordinator);
  // Convert YYYY-MM-DD → DD/MM/YYYY for date text inputs
  set('planStartDate', dbDateToFormDate(plan.Plan_StartDate));
  set('planTimeStart', plan.Plan_TimeStart || '');
  set('planEndDate', dbDateToFormDate(plan.Plan_EndDate));
  set('planTimeEnd', plan.Plan_TimeEnd || '');
  set('planHour', plan.Plan_Hour);
  set('planRemark', plan.Plan_Remark);
  updateCourseDisplay();
}

// ===================== INITIALIZE DROPDOWNS =====================
function initializeCoursesDropdown() {
  const select = document.getElementById('coursesId');
  if (!select) return;
  select.innerHTML = '<option value="">-- เลือกหลักสูตร --</option>';
  allCourses.forEach(course => {
    const option = document.createElement('option');
    option.value = course.Courses_ID;
    option.textContent = `${course.Courses_ID} - ${course.Courses_Name}`;
    option.dataset.coursesName = course.Courses_Name;
    select.appendChild(option);
  });
}

// ===================== PARTICIPANT PICKER =====================
function initializeParticipantPicker() {
  const input = document.getElementById('participantSearchInput');
  const addBtn = document.getElementById('btnAddParticipant');
  let resultEl = document.getElementById('participantSearchResults');
  if (!input || !resultEl) return;

  pendingParticipantIds = new Set();

  // Clone to remove old event listeners
  const newInput = input.cloneNode(true);
  input.parentNode.replaceChild(newInput, input);

  // Clone resultEl to clear stale listeners
  const newResultEl = resultEl.cloneNode(false);
  resultEl.parentNode.replaceChild(newResultEl, resultEl);

  if (addBtn) {
    const newBtn = addBtn.cloneNode(true);
    addBtn.parentNode.replaceChild(newBtn, addBtn);
    newBtn.addEventListener('mousedown', e => e.preventDefault());
    newBtn.addEventListener('click', addParticipant);
  }

  newInput.addEventListener('input', onParticipantSearchInput);
  newInput.addEventListener('keydown', handleParticipantSearchKeydown);
  newInput.addEventListener('blur', () => setTimeout(() => {
    const el = document.getElementById('participantSearchResults');
    if (el) el.style.display = 'none';
  }, 200));

  // Prevent input blur when interacting inside suggestions panel
  newResultEl.addEventListener('mousedown', e => e.preventDefault());
}

function clearParticipantSearch() {
  const input = document.getElementById('participantSearchInput');
  const resultEl = document.getElementById('participantSearchResults');
  if (input) input.value = '';
  if (resultEl) { resultEl.innerHTML = ''; resultEl.style.display = 'none'; }
  pendingParticipantIds = new Set();
  updateAddButton();
}

function renderParticipantSuggestions(rows, keyword = '') {
  const resultEl = document.getElementById('participantSearchResults');
  if (!resultEl) return;

  const selectedIds = new Set(selectedParticipants.map(p => String(p.Emp_ID)));
  const filteredRows = (rows || []).filter(emp => !selectedIds.has(String(emp.Emp_ID)));
  lastSuggestionRows = filteredRows;

  // Clean pending IDs no longer in current result set
  pendingParticipantIds = new Set([...pendingParticipantIds].filter(id =>
    filteredRows.some(e => String(e.Emp_ID) === id)
  ));

  updateAddButton();

  if (filteredRows.length === 0) {
    if (String(keyword || '').trim()) {
      resultEl.innerHTML = `<div style="padding:10px 14px;color:var(--gray-500);font-size:12.5px;">ไม่พบพนักงานที่ตรงกับคำค้น</div>`;
      resultEl.style.display = 'block';
    } else {
      resultEl.style.display = 'none';
    }
    return;
  }

  const pendingCount = pendingParticipantIds.size;
  const allChecked = filteredRows.length > 0 && filteredRows.every(e => pendingParticipantIds.has(String(e.Emp_ID)));
  const addBtnBg = pendingCount > 0 ? 'var(--primary)' : '#94a3b8';
  const addBtnCursor = pendingCount > 0 ? 'pointer' : 'not-allowed';

  resultEl.innerHTML = `
    <div style="padding:7px 12px;border-bottom:1px solid var(--gray-200);background:#f8fafc;display:flex;align-items:center;justify-content:space-between;gap:8px;position:sticky;top:0;z-index:1;">
      <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:12.5px;color:#475569;font-weight:600;user-select:none;margin:0;">
        <input type="checkbox" ${allChecked ? 'checked' : ''} onchange="toggleAllPendingParticipants(this.checked)" onclick="event.stopPropagation()" style="width:15px;height:15px;cursor:pointer;accent-color:var(--primary);">
        เลือกทั้งหมด
      </label>
      <button type="button" onclick="addParticipant()" ${pendingCount === 0 ? 'disabled' : ''}
        style="background:${addBtnBg};color:#fff;border:none;border-radius:6px;padding:5px 12px;font-size:12px;font-weight:600;cursor:${addBtnCursor};display:flex;align-items:center;gap:5px;flex-shrink:0;white-space:nowrap;">
        <i class="bi bi-person-plus-fill"></i> เพิ่ม${pendingCount > 0 ? ` ${pendingCount} คน` : ''}
      </button>
    </div>
    ${filteredRows.map(emp => {
      const checked = pendingParticipantIds.has(String(emp.Emp_ID));
      return `
      <label class="training-suggest-item" style="display:flex;align-items:center;gap:10px;cursor:pointer;" data-emp-id="${escHtml(String(emp.Emp_ID))}">
        <input type="checkbox" ${checked ? 'checked' : ''} onchange="togglePendingParticipant('${escHtml(String(emp.Emp_ID))}')"
          onclick="event.stopPropagation()" style="width:15px;height:15px;flex-shrink:0;cursor:pointer;accent-color:var(--primary);">
        <div style="flex:1;min-width:0;">
          <div>
            <span class="suggest-id">${escHtml(String(emp.Emp_ID))}</span>
            <span class="suggest-name">${escHtml(getEmployeeDisplayName(emp) || '-')}</span>
          </div>
          <div class="suggest-sub">${escHtml(emp.Sub_Name || 'ไม่ระบุแผนก')}</div>
        </div>
      </label>`;
    }).join('')}
  `;
  resultEl.style.display = 'block';
}

function updateAddButton() {
  const btn = document.getElementById('btnAddParticipant');
  if (!btn) return;
  const count = pendingParticipantIds.size;
  btn.innerHTML = count > 0
    ? `<i class="bi bi-person-plus-fill"></i> เพิ่ม (${count})`
    : `<i class="bi bi-person-plus-fill"></i> เพิ่ม`;
}

export function togglePendingParticipant(empId) {
  const id = String(empId);
  if (pendingParticipantIds.has(id)) pendingParticipantIds.delete(id);
  else pendingParticipantIds.add(id);
  const search = document.getElementById('participantSearchInput')?.value || '';
  renderParticipantSuggestions(lastSuggestionRows, search);
}

export function toggleAllPendingParticipants(checked) {
  if (checked) lastSuggestionRows.forEach(e => pendingParticipantIds.add(String(e.Emp_ID)));
  else pendingParticipantIds.clear();
  const search = document.getElementById('participantSearchInput')?.value || '';
  renderParticipantSuggestions(lastSuggestionRows, search);
}

async function fetchEmployeeSuggestions(keyword) {
  const q = String(keyword || '').trim();
  if (!q) { renderParticipantSuggestions([], q); return; }
  if (!window.api?.searchEmployees) {
    showToast('ไม่พบฟังก์ชันค้นหาพนักงาน', 'danger');
    return;
  }
  const token = ++latestSearchToken;
  try {
    const res = await withTimeout(window.api.searchEmployees({ keyword: q, limit: 20 }), 8000, 'searchEmployees');
    if (token !== latestSearchToken) return;
    renderParticipantSuggestions(res?.success ? (res.data || []) : [], q);
  } catch {
    if (token !== latestSearchToken) return;
    renderParticipantSuggestions([], q);
  }
}

function selectParticipant(empId) {
  if (!empId) return;
  const id = String(empId);
  if (selectedParticipants.find(p => String(p.Emp_ID) === id)) {
    showToast('พนักงานนี้มีอยู่แล้ว', 'warning');
    return;
  }
  const employee = lastSuggestionRows.find(e => String(e.Emp_ID) === id);
  if (!employee) { showToast('ไม่พบข้อมูลพนักงาน', 'warning'); return; }
  selectedParticipants.push({ ...employee });
  clearParticipantSearch();
  renderParticipantsList();
}

function onParticipantSearchInput() {
  const input = document.getElementById('participantSearchInput');
  if (!input) return;
  clearTimeout(participantSearchTimer);
  participantSearchTimer = setTimeout(() => fetchEmployeeSuggestions(input.value), 220);
}

async function handleParticipantSearchKeydown(event) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  await addParticipant();
}

// ===================== UPDATE COURSE DISPLAY =====================
export function updateCourseDisplay() {
  const select = document.getElementById('coursesId');
  if (select?.options[select.selectedIndex]) {
    const coursesName = select.options[select.selectedIndex].dataset.coursesName || '';
    const hidden = document.getElementById('coursesName');
    if (hidden) hidden.value = coursesName;
  }
}

// ===================== ADD PARTICIPANT =====================
export async function addParticipant() {
  // If there are checked (pending) participants, add them all
  if (pendingParticipantIds.size > 0) {
    let added = 0;
    pendingParticipantIds.forEach(id => {
      if (selectedParticipants.find(p => String(p.Emp_ID) === id)) return;
      const emp = lastSuggestionRows.find(e => String(e.Emp_ID) === id);
      if (emp) { selectedParticipants.push({ ...emp }); added++; }
    });
    pendingParticipantIds.clear();
    clearParticipantSearch();
    renderParticipantsList();
    if (added > 0) showToast(`เพิ่มผู้เข้าอบรม ${added} คน`, 'success');
    return;
  }
  // Fallback: search text with no checkboxes → try to add first matching result
  const input = document.getElementById('participantSearchInput');
  const keyword = String(input?.value || '').trim();
  if (!keyword) { showToast('โปรดเลือกพนักงานจากรายการ', 'warning'); return; }
  if (lastSuggestionRows.length === 0) await fetchEmployeeSuggestions(keyword);
  const exact = lastSuggestionRows.find(e => String(e.Emp_ID) === keyword);
  const fallback = lastSuggestionRows[0];
  if (exact) return selectParticipant(exact.Emp_ID);
  if (fallback) return selectParticipant(fallback.Emp_ID);
  showToast('ไม่พบพนักงานจากคำค้นนี้', 'warning');
}

// ===================== REMOVE PARTICIPANT =====================
export function removeParticipant(empId) {
  selectedParticipants = selectedParticipants.filter(p => String(p.Emp_ID) !== String(empId));
  renderParticipantsList();
}

// ===================== RENDER PARTICIPANTS LIST =====================
export function renderParticipantsList() {
  const container = document.getElementById('participantsList');
  if (!container) return;

  // Remove stale removal IDs
  participantsToRemoveIds = new Set([...participantsToRemoveIds].filter(id =>
    selectedParticipants.some(p => String(p.Emp_ID) === id)
  ));

  if (selectedParticipants.length === 0) {
    container.innerHTML = `<div id="participantsEmptyState" style="text-align:center;padding:20px;color:var(--gray-400);font-size:13px;">
      <i class="bi bi-people" style="font-size:22px;display:block;margin-bottom:6px;"></i>
      ยังไม่มีผู้เข้าอบรม
    </div>`;
    updateParticipantCountBadge();
    return;
  }

  const checkedCount = participantsToRemoveIds.size;
  const allChecked = selectedParticipants.every(p => participantsToRemoveIds.has(String(p.Emp_ID)));
  const removeBg = checkedCount > 0 ? '#ef4444' : '#94a3b8';
  const removeCursor = checkedCount > 0 ? 'pointer' : 'not-allowed';

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;border-bottom:1px solid var(--gray-100);background:#f8fafc;border-radius:8px 8px 0 0;margin-bottom:4px;">
      <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:12.5px;color:#475569;font-weight:600;user-select:none;margin:0;">
        <input type="checkbox" ${allChecked ? 'checked' : ''} onchange="toggleAllParticipantsForRemoval(this.checked)" onclick="event.stopPropagation()" style="width:15px;height:15px;cursor:pointer;accent-color:#ef4444;">
        เลือกทั้งหมด (${selectedParticipants.length} คน)
      </label>
      <button type="button" onclick="removeSelectedParticipants()" ${checkedCount === 0 ? 'disabled' : ''}
        style="background:${removeBg};color:#fff;border:none;border-radius:6px;padding:4px 12px;font-size:12px;font-weight:600;cursor:${removeCursor};display:flex;align-items:center;gap:5px;transition:background 0.15s;">
        <i class="bi bi-trash"></i> ลบที่เลือก${checkedCount > 0 ? ` (${checkedCount})` : ''}
      </button>
    </div>
    ${selectedParticipants.map(emp => {
      const isChecked = participantsToRemoveIds.has(String(emp.Emp_ID));
      return `
      <div class="participant-row" style="${isChecked ? 'background:#fef2f2;' : ''}">
        <div class="participant-info">
          <input type="checkbox" ${isChecked ? 'checked' : ''}
            onchange="toggleParticipantForRemoval('${escHtml(String(emp.Emp_ID))}', this.checked)"
            style="width:15px;height:15px;cursor:pointer;accent-color:#ef4444;flex-shrink:0;">
          <span class="participant-id">${escHtml(emp.Emp_ID)}</span>
          <div>
            <div class="participant-name">${escHtml(getEmployeeDisplayName(emp) || '-')}</div>
            <div class="participant-sub">${escHtml(emp.Sub_Name || 'ไม่ระบุแผนก')}</div>
          </div>
        </div>
        <button type="button" class="btn-remove-participant" onclick="removeParticipant('${escHtml(String(emp.Emp_ID))}')">
          <i class="bi bi-trash"></i>
        </button>
      </div>`;
    }).join('')}
  `;

  updateParticipantCountBadge();
}

// ===================== BATCH REMOVE PARTICIPANTS =====================
export function toggleParticipantForRemoval(empId, checked) {
  const id = String(empId);
  if (checked) participantsToRemoveIds.add(id);
  else participantsToRemoveIds.delete(id);
  renderParticipantsList();
}

export function toggleAllParticipantsForRemoval(checked) {
  if (checked) selectedParticipants.forEach(p => participantsToRemoveIds.add(String(p.Emp_ID)));
  else participantsToRemoveIds.clear();
  renderParticipantsList();
}

export function removeSelectedParticipants() {
  if (participantsToRemoveIds.size === 0) return;
  const count = participantsToRemoveIds.size;
  selectedParticipants = selectedParticipants.filter(p => !participantsToRemoveIds.has(String(p.Emp_ID)));
  participantsToRemoveIds.clear();
  showToast(`ลบ ${count} คนออกจากรายการแล้ว`, 'success');
  renderParticipantsList();
}

// ===================== TRAINING FORM SUBMISSION =====================
export async function submitTrainingForm(event) {
  if (event) event.preventDefault();

  // Auto-add any participants that are checked/pending but not yet confirmed
  if (pendingParticipantIds.size > 0) {
    let autoAdded = 0;
    pendingParticipantIds.forEach(id => {
      if (selectedParticipants.find(p => String(p.Emp_ID) === id)) return;
      const emp = lastSuggestionRows.find(e => String(e.Emp_ID) === id);
      if (emp) { selectedParticipants.push({ ...emp }); autoAdded++; }
    });
    pendingParticipantIds.clear();
    if (autoAdded > 0) renderParticipantsList();
  }

  const coursesId = document.getElementById('coursesId')?.value;
  if (!coursesId) { showToast('โปรดเลือกหลักสูตร', 'warning'); return; }
  if (selectedParticipants.length === 0) { showToast('โปรดเพิ่มผู้เข้าอบรมอย่างน้อย 1 คน', 'warning'); return; }

  // Convert DD/MM/YYYY → YYYY-MM-DD for DB
  const startDateRaw = document.getElementById('planStartDate')?.value || '';
  const endDateRaw   = document.getElementById('planEndDate')?.value || '';
  const startDateDb  = formDateToDb(startDateRaw);
  const endDateDb    = formDateToDb(endDateRaw);

  if (!startDateDb) { showToast('วันที่เริ่มต้นไม่ถูกต้อง (ต้องเป็น DD/MM/YYYY)', 'warning'); return; }
  if (!endDateDb)   { showToast('วันที่สิ้นสุดไม่ถูกต้อง (ต้องเป็น DD/MM/YYYY)', 'warning'); return; }

  const startTime = document.getElementById('planTimeStart')?.value || '';
  const endTime   = document.getElementById('planTimeEnd')?.value || '';
  if (!/^\d{2}:\d{2}$/.test(startTime)) { showToast('เวลาเริ่มต้นไม่ถูกต้อง (ต้องเป็น HH:MM เช่น 08:30)', 'warning'); return; }
  if (!/^\d{2}:\d{2}$/.test(endTime))   { showToast('เวลาสิ้นสุดไม่ถูกต้อง (ต้องเป็น HH:MM เช่น 17:00)', 'warning'); return; }

  const formData = {
    Plan_ID:           document.getElementById('editingPlanId')?.value || null,
    Courses_ID:        coursesId,
    Plan_Hour:         document.getElementById('planHour')?.value,
    Plan_Company:      document.getElementById('planCompany')?.value,
    Plan_Location:     document.getElementById('planLocation')?.value,
    Plan_TypeTraining: document.getElementById('planTypeTraining')?.value,
    Plan_Lecturer:     document.getElementById('planLecturer')?.value,
    Plan_Coordinator:  document.getElementById('planCoordinator')?.value,
    Plan_StartDate:    startDateDb,
    Plan_TimeStart:    startTime,
    Plan_EndDate:      endDateDb,
    Plan_TimeEnd:      endTime,
    Plan_Remark:       document.getElementById('planRemark')?.value,
    participants:      selectedParticipants.map(p => p.Emp_ID)
  };

  const btn = document.getElementById('btnSaveTraining');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner" style="display:inline-block;width:16px;height:16px;margin:0 4px -3px 0;"></span> กำลังบันทึก...'; }

  try {
    const result = await window.api.saveTrainingPlan(formData);
    if (result.success) {
      showToast('บันทึกแผนการอบรมสำเร็จ', 'success');
      closeTrainingModal();
      await refreshTrainingData({ showLoading: false });
    } else {
      showToast(result.message || 'บันทึกข้อมูลไม่สำเร็จ', 'danger');
    }
  } catch (e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'danger');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-check2-circle"></i> บันทึก'; }
  }
}

// ===================== LOAD TRAINING LIST =====================
export function loadTrainingList() {
  const tableBody = document.getElementById('trainingTableBody');
  if (!tableBody) return;

  if (trainingDataLoadFailed) {
    renderTrainingErrorState(trainingDataLoadMessage);
    return;
  }

  if (!Array.isArray(filteredTrainingPlans) || filteredTrainingPlans.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon"><i class="bi bi-journal-x"></i></div><div class="empty-text">ไม่พบข้อมูลแผนการอบรม</div></div></td></tr>`;
    const dc = document.getElementById('trainingDisplayCount');
    const tc = document.getElementById('trainingTotalCount');
    const pc = document.getElementById('trainingPaginationControls');
    if (dc) dc.textContent = '0';
    if (tc) tc.textContent = '0';
    if (pc) pc.innerHTML = '';
    return;
  }

  const rows = filteredTrainingPlans;
  const totalPages = Math.max(1, Math.ceil(trainingTotalCount / trainingPerPage));

  tableBody.innerHTML = rows.map(plan => {
    const typeTag = plan.Plan_TypeTraining === 'ภายใน'
      ? '<span style="padding:3px 8px;border-radius:4px;font-size:11.5px;background:#dcfce7;color:#166534;">ภายใน</span>'
      : '<span style="padding:3px 8px;border-radius:4px;font-size:11.5px;background:#dbeafe;color:#1e40af;">ภายนอก</span>';
    return `
    <tr>
      <td style="text-align:center;font-weight:600;color:var(--primary);">${escHtml(String(plan.Plan_ID))}</td>
      <td>${escHtml(plan.Courses_Name || '-')}</td>
      <td style="font-size:12px;">${formatDate(plan.Plan_StartDate)}<br><span style="color:var(--gray-400);">ถึง</span> ${formatDate(plan.Plan_EndDate)}</td>
      <td>${escHtml(plan.Plan_Company || '-')}</td>
      <td style="text-align:center;">${typeTag}</td>
      <td>${escHtml(plan.Plan_Lecturer || '-')}</td>
      <td style="text-align:center;">
        <span style="font-weight:600;color:var(--primary);">${escHtml(String(plan.ParticipantCount || 0))}</span>
      </td>
      <td style="text-align:center;">
        <div class="action-btns" style="justify-content:center;">
          <button type="button" class="btn-action" title="ดูรายละเอียด"
            style="background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe;"
            onclick="viewTrainingDetails('${escHtml(String(plan.Plan_ID))}')">
            <i class="bi bi-eye"></i>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');

  if (rows.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon"><i class="bi bi-journal-x"></i></div><div class="empty-text">ไม่พบข้อมูลแผนการอบรม</div></div></td></tr>`;
  }

  const dc = document.getElementById('trainingDisplayCount');
  const tc = document.getElementById('trainingTotalCount');
  const displayFrom = trainingTotalCount === 0 ? 0 : ((trainingCurrentPage - 1) * trainingPerPage) + 1;
  const displayTo = trainingTotalCount === 0 ? 0 : Math.min(((trainingCurrentPage - 1) * trainingPerPage) + rows.length, trainingTotalCount);
  if (dc) dc.textContent = trainingTotalCount === 0 ? '0' : `${displayFrom.toLocaleString()}-${displayTo.toLocaleString()}`;
  if (tc) tc.textContent = trainingTotalCount.toLocaleString();

  const pc = document.getElementById('trainingPaginationControls');
  if (!pc) return;
  if (totalPages <= 1) { pc.innerHTML = ''; return; }

  const startPage = Math.max(1, trainingCurrentPage - 2);
  const endPage = Math.min(totalPages, trainingCurrentPage + 2);
  let html = `<button class="leave-page-btn" onclick="goToTrainingPage(${trainingCurrentPage - 1})" ${trainingCurrentPage <= 1 ? 'disabled' : ''}>&#8249;</button>`;
  if (startPage > 1) {
    html += `<button class="leave-page-btn" onclick="goToTrainingPage(1)">1</button>`;
  }
  if (startPage > 2) {
    html += `<span style="padding:0 4px;color:var(--gray-400);">...</span>`;
  }
  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="leave-page-btn ${i === trainingCurrentPage ? 'active' : ''}" onclick="goToTrainingPage(${i})">${i}</button>`;
  }
  if (endPage < totalPages - 1) {
    html += `<span style="padding:0 4px;color:var(--gray-400);">...</span>`;
  }
  if (endPage < totalPages) {
    html += `<button class="leave-page-btn" onclick="goToTrainingPage(${totalPages})">${totalPages}</button>`;
  }
  html += `<button class="leave-page-btn" onclick="goToTrainingPage(${trainingCurrentPage + 1})" ${trainingCurrentPage >= totalPages ? 'disabled' : ''}>&#8250;</button>`;
  pc.innerHTML = html;
}

// ===================== GO TO PAGE =====================
export async function goToTrainingPage(page) {
  const totalPages = Math.max(1, Math.ceil(trainingTotalCount / trainingPerPage));
  const nextPage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  trainingCurrentPage = nextPage;
  await refreshTrainingData({ page: nextPage, showLoading: true });
}

// ===================== FILTER TRAINING LIST =====================
export async function filterTrainingList() {
  trainingCurrentPage = 1;
  await refreshTrainingData({ page: 1, showLoading: true });
}

export function onTrainingSearch() {
  clearTimeout(trainingSearchTimer);
  trainingSearchTimer = setTimeout(() => {
    filterTrainingList();
  }, 300);
}

export async function setTrainingPageSize() {
  const pageSizeEl = document.getElementById('trainingPageSize');
  trainingPerPage = Math.max(1, Math.min(Number(pageSizeEl?.value) || 25, 100));
  trainingCurrentPage = 1;
  await refreshTrainingData({ page: 1, perPage: trainingPerPage, showLoading: true });
}

// ===================== VIEW TRAINING DETAILS =====================
export async function viewTrainingDetails(planId) {
  viewingPlanId = planId;
  const plan = allTrainingPlans.find(p => String(p.Plan_ID) === String(planId));
  if (!plan) { showToast('ไม่พบข้อมูล', 'warning'); return; }

  document.getElementById('trainingDetailsContent').innerHTML =
    `<div style="text-align:center;padding:20px;"><div class="spinner" style="margin:0 auto;"></div></div>`;
  showModal('trainingDetailsModal');

  const participantsRes = await window.api.getTrainingParticipants(planId);
  const participants = participantsRes.success ? participantsRes.data || [] : [];

  const typeColor = plan.Plan_TypeTraining === 'ภายใน' ? 'background:#dcfce7;color:#166534' : 'background:#dbeafe;color:#1e40af';
  const html = `
    <div class="form-section-title" style="margin-bottom:14px;">ข้อมูลการอบรม</div>
    <div class="form-row" style="margin-bottom:0;">
      <div class="form-group"><label>เลขที่เอกสาร</label><div style="color:var(--primary);font-weight:700;font-size:15px;">${escHtml(String(plan.Plan_ID))}</div></div>
      <div class="form-group"><label>หลักสูตร</label><div style="font-weight:600;">${escHtml(plan.Courses_Name || '-')}</div></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>หน่วยงาน</label><div>${escHtml(plan.Plan_Company || '-')}</div></div>
      <div class="form-group"><label>ประเภท</label><div><span style="padding:3px 10px;border-radius:20px;font-size:12px;${typeColor}">${escHtml(plan.Plan_TypeTraining || '-')}</span></div></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>สถานที่</label><div>${escHtml(plan.Plan_Location || '-')}</div></div>
      <div class="form-group"><label>จำนวนชั่วโมง</label><div>${escHtml(String(plan.Plan_Hour || '-'))} ชั่วโมง</div></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>วิทยากร</label><div>${escHtml(plan.Plan_Lecturer || '-')}</div></div>
      <div class="form-group"><label>ผู้ประสานงาน</label><div>${escHtml(plan.Plan_Coordinator || '-')}</div></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>วันที่เริ่ม</label><div>${formatDate(plan.Plan_StartDate)} ${plan.Plan_TimeStart || ''}</div></div>
      <div class="form-group"><label>วันที่สิ้นสุด</label><div>${formatDate(plan.Plan_EndDate)} ${plan.Plan_TimeEnd || ''}</div></div>
    </div>
    ${plan.Plan_Remark ? `<div class="form-row full"><div class="form-group"><label>หมายเหตุ</label><div style="padding:8px 12px;background:#fffbeb;border-left:3px solid #f59e0b;border-radius:4px;font-size:13px;">${escHtml(plan.Plan_Remark)}</div></div></div>` : ''}

    <div class="form-divider"></div>
    <div class="form-section-title" style="margin-bottom:12px;">ผู้เข้าอบรม (${participants.length} คน)</div>
    ${participants.length > 0 ? `
    <div style="max-height:280px;overflow-y:auto;border:1px solid var(--gray-100);border-radius:10px;">
      <table class="data-table" style="font-size:12.5px;width:100%;">
        <thead><tr>
          <th style="width:44px;text-align:center;padding:8px;">ลำดับ</th>
          <th style="width:80px;padding:8px;">รหัส</th>
          <th style="padding:8px;">ชื่อ-นามสกุล</th>
        </tr></thead>
        <tbody>
          ${participants.map((p, idx) => `
            <tr>
              <td style="text-align:center;padding:7px;">${idx + 1}</td>
              <td style="padding:7px;"><span class="emp-id">${escHtml(p.Emp_ID)}</span></td>
              <td style="padding:7px;">${escHtml(p.Fullname || `${p.Emp_Firstname || ''} ${p.Emp_Lastname || ''}`.trim() || '-')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>` : `<div style="text-align:center;padding:20px;color:var(--gray-400);font-size:13px;">ไม่มีผู้เข้าอบรม</div>`}
  `;
  document.getElementById('trainingDetailsContent').innerHTML = html;
}

// ===================== CLOSE DETAILS MODAL =====================
export function closeTrainingDetailsModal() {
  closeModal('trainingDetailsModal');
}

// ===================== EDIT TRAINING =====================
export function editTraining() {
  const planId = viewingPlanId;
  closeTrainingDetailsModal();
  openTrainingModal(planId);
}

// Keep legacy export names for renderer.js compatibility
export function switchTrainingTab() {}
