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
let trainingDataLoadFailed = false;
let trainingDataLoadMessage = '';

function withTimeout(promise, ms, name) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${name} timeout`)), ms))
  ]);
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
export function openTrainingModal(planId = null) {
  editingPlanId = planId;
  selectedParticipants = [];
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

  // Setup participant picker
  initializeParticipantPicker();

  // If editing, pre-fill fields
  if (planId) {
    const plan = allTrainingPlans.find(p => p.Plan_ID === planId);
    if (plan) prefillForm(plan);
  }

  renderParticipantsList();
  showModal('trainingFormModal');
}

export function closeTrainingModal() {
  closeModal('trainingFormModal');
  selectedParticipants = [];
  editingPlanId = null;
  clearParticipantSearch();
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
  set('planStartDate', plan.Plan_StartDate);
  set('planTimeStart', plan.Plan_TimeStart);
  set('planEndDate', plan.Plan_EndDate);
  set('planTimeEnd', plan.Plan_TimeEnd);
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
  const resultEl = document.getElementById('participantSearchResults');
  if (!input || !addBtn || !resultEl) return;

  // Remove old listeners by cloning
  const newInput = input.cloneNode(true);
  input.parentNode.replaceChild(newInput, input);
  const newBtn = addBtn.cloneNode(true);
  addBtn.parentNode.replaceChild(newBtn, addBtn);

  newInput.addEventListener('input', onParticipantSearchInput);
  newInput.addEventListener('keydown', handleParticipantSearchKeydown);
  newInput.addEventListener('blur', () => setTimeout(() => {
    const el = document.getElementById('participantSearchResults');
    if (el) el.style.display = 'none';
  }, 150));

  newBtn.addEventListener('click', addParticipant);
  resultEl.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-emp-id]');
    if (!btn) return;
    selectParticipant(btn.dataset.empId);
  });
}

function clearParticipantSearch() {
  const input = document.getElementById('participantSearchInput');
  const resultEl = document.getElementById('participantSearchResults');
  if (input) input.value = '';
  if (resultEl) { resultEl.innerHTML = ''; resultEl.style.display = 'none'; }
}

function renderParticipantSuggestions(rows, keyword = '') {
  const resultEl = document.getElementById('participantSearchResults');
  if (!resultEl) return;

  const selectedIds = new Set(selectedParticipants.map(p => String(p.Emp_ID)));
  const filteredRows = (rows || []).filter(emp => !selectedIds.has(String(emp.Emp_ID)));
  lastSuggestionRows = filteredRows;

  if (filteredRows.length === 0) {
    if (String(keyword || '').trim()) {
      resultEl.innerHTML = `<div style="padding:10px 14px;color:var(--gray-500);font-size:12.5px;">ไม่พบพนักงานที่ตรงกับคำค้น</div>`;
      resultEl.style.display = 'block';
    } else {
      resultEl.style.display = 'none';
    }
    return;
  }

  resultEl.innerHTML = filteredRows.map(emp => `
    <button type="button" class="training-suggest-item" data-emp-id="${escHtml(String(emp.Emp_ID))}">
      <div>
        <span class="suggest-id">${escHtml(String(emp.Emp_ID))}</span>
        <span class="suggest-name">${escHtml(getEmployeeDisplayName(emp) || '-')}</span>
      </div>
      <div class="suggest-sub">${escHtml(emp.Sub_Name || 'ไม่ระบุแผนก')}</div>
    </button>
  `).join('');
  resultEl.style.display = 'block';
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
  const input = document.getElementById('participantSearchInput');
  const keyword = String(input?.value || '').trim();
  if (!keyword) { showToast('โปรดพิมพ์รหัสหรือชื่อพนักงาน', 'warning'); return; }
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

  if (selectedParticipants.length === 0) {
    container.innerHTML = `<div id="participantsEmptyState" style="text-align:center;padding:20px;color:var(--gray-400);font-size:13px;">
      <i class="bi bi-people" style="font-size:22px;display:block;margin-bottom:6px;"></i>
      ยังไม่มีผู้เข้าอบรม
    </div>`;
    updateParticipantCountBadge();
    return;
  }

  container.innerHTML = selectedParticipants.map(emp => `
    <div class="participant-row">
      <div class="participant-info">
        <span class="participant-id">${escHtml(emp.Emp_ID)}</span>
        <div>
          <div class="participant-name">${escHtml(getEmployeeDisplayName(emp) || '-')}</div>
          <div class="participant-sub">${escHtml(emp.Sub_Name || 'ไม่ระบุแผนก')}</div>
        </div>
      </div>
      <button type="button" class="btn-remove-participant" onclick="removeParticipant('${escHtml(emp.Emp_ID)}')">
        <i class="bi bi-trash"></i> ลบ
      </button>
    </div>
  `).join('');

  updateParticipantCountBadge();
}

// ===================== TRAINING FORM SUBMISSION =====================
export async function submitTrainingForm(event) {
  if (event) event.preventDefault();

  const coursesId = document.getElementById('coursesId')?.value;
  if (!coursesId) { showToast('โปรดเลือกหลักสูตร', 'warning'); return; }
  if (selectedParticipants.length === 0) { showToast('โปรดเพิ่มผู้เข้าอบรมอย่างน้อย 1 คน', 'warning'); return; }

  const formData = {
    Plan_ID:           document.getElementById('editingPlanId')?.value || null,
    Courses_ID:        coursesId,
    Plan_Hour:         document.getElementById('planHour')?.value,
    Plan_Company:      document.getElementById('planCompany')?.value,
    Plan_Location:     document.getElementById('planLocation')?.value,
    Plan_TypeTraining: document.getElementById('planTypeTraining')?.value,
    Plan_Lecturer:     document.getElementById('planLecturer')?.value,
    Plan_Coordinator:  document.getElementById('planCoordinator')?.value,
    Plan_StartDate:    document.getElementById('planStartDate')?.value,
    Plan_TimeStart:    document.getElementById('planTimeStart')?.value,
    Plan_EndDate:      document.getElementById('planEndDate')?.value,
    Plan_TimeEnd:      document.getElementById('planTimeEnd')?.value,
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
  closeTrainingDetailsModal();
  // TODO: implement edit - currently shows placeholder
  showToast('คุณลักษณะการแก้ไขจะถูกพัฒนาเพิ่มเติม', 'info');
}

// Keep legacy export names for renderer.js compatibility
export function switchTrainingTab() {}
