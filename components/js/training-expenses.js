// ===================== TRAINING EXPENSES PAGE =====================
import { escHtml, showToast, showModal, closeModal, formatDate } from './utils.js';

let allExpenses = [];
let expCurrentPage = 1;
let expPerPage = 15;
let expTotalCount = 0;
let expSearchTimer = null;
let expStats = { total: 0, sumAll: 0, thisMonth: 0, sumMonth: 0 };

// Date filter state
let expFilterYear = '';
let expFilterDateFrom = '';
let expFilterDateTo = '';

// Plan autocomplete state
let expPlanSuggestToken = 0;
let expPlanSuggestTimer = null;
let expSelectedPlan = null;   // { Plan_ID, Courses_ID, Courses_Name }

// ===================== HELPERS =====================
function thDateShort(ts) {
  if (!ts) return '-';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return '-'; }
}

function isOlderThanOneMonth(ts) {
  if (!ts) return false;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 1);
  return new Date(ts) < cutoff;
}

function fmtBaht(v) {
  const n = Number(v) || 0;
  return n.toLocaleString('th-TH');
}

// ===================== LOAD PAGE =====================
export async function loadTrainingExpensePage() {
  const container = document.getElementById('pageContent');
  container.innerHTML = `<div class="text-center py-5"><div class="spinner" style="margin:0 auto;"></div>
    <p class="mt-3 text-muted">กำลังโหลดข้อมูล...</p></div>`;

  try {
    const res = await fetch('components/html/training-expenses.html');
    container.innerHTML = await res.text();
  } catch {
    container.innerHTML = '<p>Error loading template</p>';
    return;
  }

  expCurrentPage = 1;
  expPerPage = 15;
  expStats = { total: 0, sumAll: 0, thisMonth: 0, sumMonth: 0 };
  allExpenses = [];

  renderExpenseStats();
  renderExpenseLoadingState();
  await refreshExpenseData();
}

// ===================== REFRESH DATA =====================
export async function refreshExpenseData() {
  renderExpenseLoadingState();
  const search = (document.getElementById('expSearchInput')?.value || '').trim();
  const perPage = expPerPage;
  const page = expCurrentPage;

  try {
    const res = await window.api.getExpenses({ search, page, perPage, yearFilter: expFilterYear, dateFrom: expFilterDateFrom, dateTo: expFilterDateTo });
    if (!res.success) {
      renderExpenseErrorState(res.message || 'โหลดข้อมูลไม่สำเร็จ');
      showToast(res.message || 'โหลดข้อมูลไม่สำเร็จ', 'error');
      return;
    }
    allExpenses = res.data || [];
    expTotalCount = Number(res.total) || 0;
    expCurrentPage = Number(res.page) || 1;
    expPerPage = Number(res.perPage) || 15;
    expStats = res.stats || { total: 0, sumAll: 0, thisMonth: 0, sumMonth: 0 };

    const pageSizeEl = document.getElementById('expPageSize');
    if (pageSizeEl) pageSizeEl.value = String(expPerPage);

    populateExpYearDropdown(res.availableYears || []);
    renderExpenseStats();
    renderExpenseTable();
    renderExpPeriodSummary(res.periodSummary);
  } catch (e) {
    renderExpenseErrorState(e.message);
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'error');
  }
}

function renderExpenseLoadingState() {
  const tbody = document.getElementById('expenseTableBody');
  if (!tbody) return;
  tbody.innerHTML = `<tr class="loading-row"><td colspan="11"><div class="spinner"></div>
    <div>กำลังโหลดรายการ...</div></td></tr>`;
}

function renderExpenseErrorState(msg) {
  const tbody = document.getElementById('expenseTableBody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="11"><div class="empty-state">
    <div class="empty-icon"><i class="bi bi-exclamation-triangle"></i></div>
    <div class="empty-text">${escHtml(msg)}</div></div></td></tr>`;
  const dc = document.getElementById('expDisplayCount');
  const tc = document.getElementById('expTotalCount');
  const pc = document.getElementById('expPaginationControls');
  if (dc) dc.textContent = '0';
  if (tc) tc.textContent = '0';
  if (pc) pc.innerHTML = '';
}

// ===================== STATS =====================
function renderExpenseStats() {
  const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setEl('expStatTotal',     Number(expStats.total || 0).toLocaleString());
  setEl('expStatSum',       Number(expStats.sumAll || 0).toLocaleString('th-TH'));
  setEl('expStatThisMonth', Number(expStats.thisMonth || 0).toLocaleString());
  setEl('expStatSumMonth',  Number(expStats.sumMonth || 0).toLocaleString('th-TH'));
}

// ===================== RENDER TABLE =====================
function renderExpenseTable() {
  const tbody = document.getElementById('expenseTableBody');
  if (!tbody) return;

  if (!allExpenses.length) {
    tbody.innerHTML = `<tr><td colspan="11"><div class="empty-state">
      <div class="empty-icon"><i class="bi bi-receipt"></i></div>
      <div class="empty-text">ไม่พบรายการค่าใช้จ่าย</div></div></td></tr>`;
    const dc = document.getElementById('expDisplayCount');
    const tc = document.getElementById('expTotalCount');
    const pc = document.getElementById('expPaginationControls');
    if (dc) dc.textContent = '0';
    if (tc) tc.textContent = '0';
    if (pc) pc.innerHTML = '';
    return;
  }

  tbody.innerHTML = allExpenses.map(row => {
    const locked = isOlderThanOneMonth(row.Expenses_TimeStamp);
    const total = Number(row.Expenses_Sum) || 0;

    const editBtn = locked
      ? `<span class="exp-locked-badge" title="บันทึกเกิน 1 เดือน ไม่สามารถแก้ไขได้">
           <i class="bi bi-lock-fill"></i> ล็อก
         </span>`
      : `<button type="button" class="btn-action"
           style="background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe;"
           title="แก้ไข" onclick="openExpenseModal('${escHtml(String(row.Expenses_ID))}')">
           <i class="bi bi-pencil"></i>
         </button>`;

    return `<tr>
      <td style="text-align:center;font-weight:700;color:var(--primary);font-size:12px;">
        ${escHtml(row.Expenses_ID)}
      </td>
      <td style="text-align:center;font-size:12px;">
        <span style="background:var(--primary-light);color:var(--primary);
          padding:2px 7px;border-radius:5px;font-weight:700;">
          ${escHtml(row.Plan_ID || '-')}
        </span>
      </td>
      <td style="font-size:13px;font-weight:500;color:var(--gray-800);">
        ${escHtml(row.Courses_Name || '-')}
      </td>
      <td class="exp-amount-cell" style="text-align:right;font-size:12.5px;color:var(--gray-700);">
        ${fmtBaht(row.Expenses_Lecturer)}
      </td>
      <td class="exp-amount-cell" style="text-align:right;font-size:12.5px;color:var(--gray-700);">
        ${fmtBaht(row.Expenses_Tools)}
      </td>
      <td class="exp-amount-cell" style="text-align:right;font-size:12.5px;color:var(--gray-700);">
        ${fmtBaht(row.Expenses_Food)}
      </td>
      <td class="exp-amount-cell" style="text-align:right;font-size:12.5px;color:var(--gray-700);">
        ${fmtBaht(row.Expenses_Snack)}
      </td>
      <td class="exp-amount-cell" style="text-align:right;font-size:12.5px;color:var(--gray-700);">
        ${fmtBaht(row.Expenses_Travel)}
      </td>
      <td class="exp-amount-cell" style="text-align:right;font-weight:700;
        color:${total > 0 ? '#065f46' : 'var(--gray-500)'};">
        ${fmtBaht(total)}
      </td>
      <td style="text-align:center;font-size:11.5px;color:var(--gray-500);">
        ${thDateShort(row.Expenses_TimeStamp)}
      </td>
      <td style="text-align:center;">
        <div class="action-btns" style="justify-content:center;">${editBtn}</div>
      </td>
    </tr>`;
  }).join('');

  const dc = document.getElementById('expDisplayCount');
  const tc = document.getElementById('expTotalCount');
  const totalPages = Math.max(1, Math.ceil(expTotalCount / expPerPage));
  const from = expTotalCount === 0 ? 0 : (expCurrentPage - 1) * expPerPage + 1;
  const to   = expTotalCount === 0 ? 0 : Math.min((expCurrentPage - 1) * expPerPage + allExpenses.length, expTotalCount);
  if (dc) dc.textContent = expTotalCount === 0 ? '0' : `${from}-${to}`;
  if (tc) tc.textContent = expTotalCount.toLocaleString();

  const pc = document.getElementById('expPaginationControls');
  if (!pc) return;
  if (totalPages <= 1) { pc.innerHTML = ''; return; }

  const startP = Math.max(1, expCurrentPage - 2);
  const endP   = Math.min(totalPages, expCurrentPage + 2);
  let html = `<button class="leave-page-btn" onclick="goToExpensePage(${expCurrentPage - 1})"
    ${expCurrentPage <= 1 ? 'disabled' : ''}>&#8249;</button>`;
  if (startP > 1) html += `<button class="leave-page-btn" onclick="goToExpensePage(1)">1</button>`;
  if (startP > 2) html += `<span style="padding:0 4px;color:var(--gray-400);">...</span>`;
  for (let i = startP; i <= endP; i++) {
    html += `<button class="leave-page-btn ${i === expCurrentPage ? 'active' : ''}"
      onclick="goToExpensePage(${i})">${i}</button>`;
  }
  if (endP < totalPages - 1) html += `<span style="padding:0 4px;color:var(--gray-400);">...</span>`;
  if (endP < totalPages) html += `<button class="leave-page-btn" onclick="goToExpensePage(${totalPages})">${totalPages}</button>`;
  html += `<button class="leave-page-btn" onclick="goToExpensePage(${expCurrentPage + 1})"
    ${expCurrentPage >= totalPages ? 'disabled' : ''}>&#8250;</button>`;
  pc.innerHTML = html;
}

// ===================== PAGINATION / SEARCH =====================
export async function goToExpensePage(page) {
  const totalPages = Math.max(1, Math.ceil(expTotalCount / expPerPage));
  expCurrentPage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  await refreshExpenseData();
}

export function onExpenseSearch() {
  clearTimeout(expSearchTimer);
  expSearchTimer = setTimeout(() => {
    expCurrentPage = 1;
    refreshExpenseData();
  }, 300);
}

export function setExpensePageSize() {
  const el = document.getElementById('expPageSize');
  expPerPage = Math.max(10, Math.min(25, Number(el?.value) || 15));
  expCurrentPage = 1;
  refreshExpenseData();
}

// ===================== OPEN / CLOSE MODAL =====================
export async function openExpenseModal(expenseId = null) {
  expSelectedPlan = null;

  const titleEl = document.getElementById('expenseModalTitle');
  if (titleEl) titleEl.textContent = expenseId ? 'แก้ไขค่าใช้จ่าย' : 'บันทึกค่าใช้จ่ายการอบรม';

  const editIdEl = document.getElementById('editingExpenseId');
  if (editIdEl) editIdEl.value = expenseId || '';

  // Reset form fields
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };
  setVal('expLecturer', 0);
  setVal('expTools', 0);
  setVal('expFood', 0);
  setVal('expSnack', 0);
  setVal('expTravel', 0);
  setVal('expRemarks', '');
  setVal('expPlanIdInput', '');
  resetExpPlanDisplay();
  calcExpenseTotal();

  // Load document number
  await loadNextExpenseDocNo(expenseId);

  if (expenseId) {
    // Load existing record for editing
    await prefillExpenseForm(expenseId);
  }

  showModal('expenseFormModal');
  initExpPlanSuggest();
}

async function loadNextExpenseDocNo(expenseId) {
  const el = document.getElementById('expDocNoDisplay');
  if (!el) return;
  if (expenseId) {
    el.textContent = String(expenseId);
    return;
  }
  try {
    const res = await window.api.getNextExpenseId?.();
    if (res?.success) {
      el.textContent = `THB${String(res.nextId).padStart(7, '0')}`;
      el.title = 'เลขที่เอกสารนี้เป็นค่าประมาณการ — เลขจริงจะถูกกำหนดเมื่อบันทึก';
    } else {
      el.textContent = 'THB???????';
    }
  } catch {
    el.textContent = 'THB???????';
  }
}

async function prefillExpenseForm(expenseId) {
  const row = allExpenses.find(e => String(e.Expenses_ID) === String(expenseId));
  if (!row) return;

  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };
  setVal('expPlanIdInput', row.Plan_ID || '');
  setVal('expLecturer', row.Expenses_Lecturer || 0);
  setVal('expTools', row.Expenses_Tools || 0);
  setVal('expFood', row.Expenses_Food || 0);
  setVal('expSnack', row.Expenses_Snack || 0);
  setVal('expTravel', row.Expenses_Travel || 0);
  setVal('expRemarks', row.Expenses_Remarks || '');

  expSelectedPlan = { Plan_ID: row.Plan_ID, Courses_ID: row.Courses_ID, Courses_Name: row.Courses_Name };
  updateExpPlanDisplay(row.Courses_ID, row.Courses_Name);
  calcExpenseTotal();
}

export function closeExpenseModal() {
  closeModal('expenseFormModal');
  expSelectedPlan = null;
  expPlanSuggestToken++;
  clearTimeout(expPlanSuggestTimer);
}

// ===================== PLAN ID AUTOCOMPLETE =====================
function initExpPlanSuggest() {
  const input = document.getElementById('expPlanIdInput');
  const box   = document.getElementById('expPlanSuggestions');
  if (!input || !box) return;

  const fresh = input.cloneNode(true);
  input.parentNode.replaceChild(fresh, input);

  fresh.addEventListener('focus', () => showExpPlanPickerModal());
  fresh.addEventListener('input', onExpPlanIdInput);
  fresh.addEventListener('blur', () => setTimeout(hideExpPlanSuggestions, 200));
  fresh.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); selectFirstExpPlanSuggest(); }
  });

  box.addEventListener('mousedown', e => e.preventDefault());
}

// ===================== PLAN PICKER MODAL =====================
let _planPickerAllPlans = [];
let _planPickerTimer = null;

export async function showExpPlanPickerModal() {
  // Ensure overlay exists
  let overlay = document.getElementById('expPlanPickerOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'expPlanPickerOverlay';
    overlay.style.cssText = `position:fixed;inset:0;background:rgba(15,23,42,.5);
      backdrop-filter:blur(3px);z-index:10500;display:flex;align-items:center;justify-content:center;`;
    overlay.onclick = (e) => { if (e.target === overlay) closeExpPlanPickerModal(); };
    document.body.appendChild(overlay);
  }

  overlay.style.display = 'flex';
  overlay.innerHTML = `
    <div style="background:white;border-radius:16px;width:560px;max-width:94vw;max-height:80vh;
      display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,.28);overflow:hidden;"
      onclick="event.stopPropagation()">
      <div style="padding:18px 22px 14px;border-bottom:1px solid var(--gray-100);flex-shrink:0;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
          <div style="width:36px;height:36px;border-radius:10px;background:var(--primary-light);
            display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <i class="bi bi-card-list" style="font-size:18px;color:var(--primary);"></i>
          </div>
          <div style="flex:1;">
            <div style="font-size:15px;font-weight:700;color:var(--gray-900);">เลือกแผนการอบรม</div>
            <div style="font-size:12px;color:var(--gray-400);">แสดงเฉพาะแผนที่ยังไม่มีการบันทึกค่าใช้จ่าย</div>
          </div>
          <button onclick="closeExpPlanPickerModal()"
            style="background:none;border:none;cursor:pointer;color:var(--gray-400);font-size:18px;
              padding:4px;border-radius:6px;line-height:1;">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>
        <div id="expPickerSearchWrap" style="display:none;position:relative;">
          <i class="bi bi-search" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);
            color:var(--gray-400);font-size:13px;pointer-events:none;"></i>
          <input type="text" id="expPickerSearchInput" class="form-control-m"
            placeholder="ค้นหาเลขที่แผน / ชื่อหลักสูตร / รหัส..."
            autocomplete="off"
            style="padding-left:32px;"
            oninput="filterExpPlanPicker()">
        </div>
      </div>
      <div id="expPickerList" style="flex:1;overflow-y:auto;padding:6px 0;min-height:60px;">
        <div style="display:flex;align-items:center;justify-content:center;padding:24px;">
          <div class="spinner" style="margin-right:10px;"></div>
          <span style="color:var(--gray-400);font-size:13px;">กำลังโหลด...</span>
        </div>
      </div>
    </div>`;

  try {
    const res = await window.api.searchPlansForExpense({ keyword: '' });
    _planPickerAllPlans = res?.success ? (res.data || []) : [];
  } catch {
    _planPickerAllPlans = [];
  }

  // Show search bar only if ≥5 results
  const searchWrap = document.getElementById('expPickerSearchWrap');
  if (searchWrap) searchWrap.style.display = _planPickerAllPlans.length >= 5 ? 'block' : 'none';

  renderExpPlanPickerList(_planPickerAllPlans);

  // Auto-focus search if shown
  if (_planPickerAllPlans.length >= 5) {
    setTimeout(() => document.getElementById('expPickerSearchInput')?.focus(), 80);
  }
}

export function closeExpPlanPickerModal() {
  const overlay = document.getElementById('expPlanPickerOverlay');
  if (overlay) overlay.style.display = 'none';
  clearTimeout(_planPickerTimer);
}

export function filterExpPlanPicker() {
  clearTimeout(_planPickerTimer);
  _planPickerTimer = setTimeout(() => {
    const q = (document.getElementById('expPickerSearchInput')?.value || '').toLowerCase();
    const filtered = q
      ? _planPickerAllPlans.filter(p =>
          String(p.Plan_ID).toLowerCase().includes(q) ||
          (p.Courses_Name || '').toLowerCase().includes(q) ||
          (p.Courses_ID   || '').toLowerCase().includes(q)
        )
      : _planPickerAllPlans;
    renderExpPlanPickerList(filtered);
  }, 150);
}

function renderExpPlanPickerList(plans) {
  const list = document.getElementById('expPickerList');
  if (!list) return;

  if (plans.length === 0) {
    list.innerHTML = `
      <div style="text-align:center;padding:32px 20px;color:var(--gray-400);">
        <i class="bi bi-journal-x" style="font-size:32px;display:block;margin-bottom:8px;"></i>
        <div style="font-size:13px;">ไม่พบแผนการอบรมที่ยังไม่มีการบันทึกค่าใช้จ่าย</div>
      </div>`;
    return;
  }

  list.innerHTML = plans.map(p => {
    const dateStr = p.Plan_StartDate ? thDateShort(p.Plan_StartDate + 'T00:00:00') : '';
    return `
    <button type="button"
      onclick="pickExpPlan('${escHtml(String(p.Plan_ID))}','${escHtml(p.Courses_ID||'')}','${escHtml(p.Courses_Name||'')}')"
      style="display:flex;align-items:center;gap:12px;width:100%;border:none;background:none;
        padding:10px 20px;cursor:pointer;text-align:left;transition:background .1s;border-bottom:1px solid var(--gray-50);"
      onmouseover="this.style.background='#f0f6ff'" onmouseout="this.style.background=''">
      <div style="width:9px;height:9px;border-radius:50%;background:var(--primary);flex-shrink:0;margin-top:2px;"></div>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-size:12.5px;font-weight:700;color:var(--primary);background:var(--primary-light);
            padding:1px 8px;border-radius:20px;">${escHtml(String(p.Plan_ID))}</span>
          <span style="font-size:13px;font-weight:600;color:var(--gray-900);">${escHtml(p.Courses_Name || '-')}</span>
        </div>
        <div style="font-size:11.5px;color:var(--gray-400);margin-top:3px;">
          ${escHtml(p.Courses_ID || '')}
          ${dateStr ? `<span style="margin:0 5px;">·</span>${escHtml(dateStr)}` : ''}
          ${p.Plan_Company ? `<span style="margin:0 5px;">·</span>${escHtml(p.Plan_Company)}` : ''}
        </div>
      </div>
      <i class="bi bi-chevron-right" style="color:var(--gray-300);font-size:13px;flex-shrink:0;"></i>
    </button>`;
  }).join('');
}

export function pickExpPlan(planId, coursesId, coursesName) {
  closeExpPlanPickerModal();
  // Fill input and trigger the existing autocomplete select logic
  const input = document.getElementById('expPlanIdInput');
  if (input) {
    input.value = planId;
    input.dispatchEvent(new Event('input'));
  }
  expSelectedPlan = { Plan_ID: planId, Courses_ID: coursesId, Courses_Name: coursesName };
  updateExpPlanDisplay(coursesId, coursesName);
  hideExpPlanSuggestions();
  // Move focus to first expense amount field
  setTimeout(() => document.getElementById('expLecturer')?.focus(), 80);
}

export function onExpPlanIdInput() {
  clearTimeout(expPlanSuggestTimer);
  expPlanSuggestTimer = setTimeout(fetchExpPlanSuggestions, 250);
}

async function fetchExpPlanSuggestions() {
  const input   = document.getElementById('expPlanIdInput');
  const box     = document.getElementById('expPlanSuggestions');
  if (!input || !box) return;

  const keyword = input.value.trim();
  if (!keyword) { box.style.display = 'none'; expSelectedPlan = null; resetExpPlanDisplay(); return; }

  const token = ++expPlanSuggestToken;
  try {
    const res = await window.api.searchPlansForExpense({ keyword });
    if (token !== expPlanSuggestToken) return;
    const plans = res?.success ? (res.data || []) : [];
    renderExpPlanSuggestions(plans, keyword);
  } catch {
    if (token !== expPlanSuggestToken) return;
    renderExpPlanSuggestions([], keyword);
  }
}

function renderExpPlanSuggestions(plans, keyword) {
  const box = document.getElementById('expPlanSuggestions');
  if (!box) return;

  if (!plans.length) {
    box.innerHTML = `<div style="padding:10px 14px;color:var(--gray-500);font-size:12.5px;">
      ไม่พบแผนการอบรมที่ตรงกับคำค้น<br>
      <span style="font-size:11.5px;color:var(--gray-400);">(รวมเฉพาะแผนที่ยังไม่มีค่าใช้จ่าย)</span>
    </div>`;
    box.style.display = 'block';
    return;
  }

  box.innerHTML = plans.map(p => {
    const dateStr = p.Plan_StartDate ? thDateShort(p.Plan_StartDate + 'T00:00:00') : '';
    return `<button type="button" class="exp-suggest-item"
      onmousedown="selectExpPlan('${escHtml(String(p.Plan_ID))}','${escHtml(p.Courses_ID||'')}','${escHtml(p.Courses_Name||'')}')">
      <div>
        <span class="exp-suggest-plan-id">${escHtml(p.Plan_ID)}</span>
        <span class="exp-suggest-course">${escHtml(p.Courses_Name || '-')}</span>
      </div>
      <div class="exp-suggest-sub">
        ${escHtml(p.Courses_ID || '')}
        ${dateStr ? ' &nbsp;|&nbsp; ' + escHtml(dateStr) : ''}
        ${p.Plan_Company ? ' &nbsp;|&nbsp; ' + escHtml(p.Plan_Company) : ''}
      </div>
    </button>`;
  }).join('');
  box.style.display = 'block';
}

export function selectExpPlan(planId, coursesId, coursesName) {
  const input = document.getElementById('expPlanIdInput');
  if (input) input.value = planId;
  expSelectedPlan = { Plan_ID: planId, Courses_ID: coursesId, Courses_Name: coursesName };
  updateExpPlanDisplay(coursesId, coursesName);
  hideExpPlanSuggestions();
}

function selectFirstExpPlanSuggest() {
  const box = document.getElementById('expPlanSuggestions');
  const first = box?.querySelector('.exp-suggest-item');
  if (first) first.click();
}

export function hideExpPlanSuggestions() {
  const box = document.getElementById('expPlanSuggestions');
  if (box) box.style.display = 'none';
}

function resetExpPlanDisplay() {
  const idEl   = document.getElementById('expCoursesIdDisplay');
  const nameEl = document.getElementById('expCoursesNameDisplay');
  if (idEl)   { idEl.textContent = '—'; idEl.style.color = 'var(--gray-500)'; }
  if (nameEl) { nameEl.textContent = '—'; nameEl.style.color = 'var(--gray-600)'; }
}

function updateExpPlanDisplay(coursesId, coursesName) {
  const idEl   = document.getElementById('expCoursesIdDisplay');
  const nameEl = document.getElementById('expCoursesNameDisplay');
  if (idEl) {
    idEl.textContent = coursesId || '—';
    idEl.style.color = coursesId ? 'var(--primary)' : 'var(--gray-500)';
    idEl.style.fontWeight = coursesId ? '700' : '400';
  }
  if (nameEl) {
    nameEl.textContent = coursesName || '—';
    nameEl.style.color = coursesName ? 'var(--gray-800)' : 'var(--gray-500)';
  }
}

// ===================== TOTAL CALCULATION =====================
export function calcExpenseTotal() {
  const getNum = (id) => Math.max(0, Number(document.getElementById(id)?.value) || 0);
  const total = getNum('expLecturer') + getNum('expTools') + getNum('expFood')
              + getNum('expSnack')    + getNum('expTravel');
  const el = document.getElementById('expTotalValue');
  if (el) el.textContent = total.toLocaleString('th-TH');
}

// ===================== SUBMIT FORM =====================
export async function submitExpenseForm() {
  const expenseId = document.getElementById('editingExpenseId')?.value || null;
  const planInput = (document.getElementById('expPlanIdInput')?.value || '').trim();

  if (!planInput) {
    showToast('โปรดระบุเลขที่แผนการอบรม', 'warning'); return;
  }

  // Use expSelectedPlan if available, else validate via API
  let planRef = expSelectedPlan;
  if (!planRef || planRef.Plan_ID !== planInput) {
    // User may have typed manually without selecting suggestion
    try {
      const res = await window.api.searchPlansForExpense({ keyword: planInput, exact: true });
      const matched = res?.success ? (res.data || []) : [];
      if (!matched.length) {
        showToast('ไม่พบเลขที่แผนการอบรมนี้ หรือแผนนี้มีค่าใช้จ่ายแล้ว', 'warning'); return;
      }
      planRef = { Plan_ID: matched[0].Plan_ID, Courses_ID: matched[0].Courses_ID, Courses_Name: matched[0].Courses_Name };
    } catch (e) {
      showToast('ตรวจสอบแผนการอบรมไม่สำเร็จ: ' + e.message, 'error'); return;
    }
  }

  const getNum = (id) => Math.max(0, Number(document.getElementById(id)?.value) || 0);
  const lecturer = getNum('expLecturer');
  const tools    = getNum('expTools');
  const food     = getNum('expFood');
  const snack    = getNum('expSnack');
  const travel   = getNum('expTravel');
  const total    = lecturer + tools + food + snack + travel;
  const remarks  = (document.getElementById('expRemarks')?.value || '').trim();

  const formData = {
    Expenses_ID:       expenseId || null,
    Plan_ID:           planRef.Plan_ID,
    Courses_ID:        planRef.Courses_ID,
    Expenses_Lecturer: lecturer,
    Expenses_Tools:    tools,
    Expenses_Food:     food,
    Expenses_Snack:    snack,
    Expenses_Travel:   travel,
    Expenses_Sum:      String(total),
    Expenses_Remarks:  remarks,
  };

  const btn = document.getElementById('btnSaveExpense');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner" style="display:inline-block;width:16px;height:16px;margin:0 4px -3px 0;"></span> กำลังบันทึก...'; }

  try {
    const result = await window.api.saveExpense(formData);
    if (result.success) {
      showToast('บันทึกค่าใช้จ่ายสำเร็จ', 'success');
      closeExpenseModal();
      expCurrentPage = 1;
      await refreshExpenseData();
    } else {
      showToast(result.message || 'บันทึกไม่สำเร็จ', 'danger');
    }
  } catch (e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'danger');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-check2-circle"></i> บันทึก'; }
  }
}

// ===================== DATE FILTER =====================
function populateExpYearDropdown(years) {
  const sel = document.getElementById('expFilterYear');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">ทุกปี</option>';
  years.forEach(yr => {
    const opt = document.createElement('option');
    opt.value = yr;
    const buddhistYear = Number(yr) + 543;
    opt.textContent = `ปี ${buddhistYear} (${yr})`;
    sel.appendChild(opt);
  });
  if (current) sel.value = current;
}

function renderExpPeriodSummary(summary) {
  const panel = document.getElementById('expPeriodSummary');
  if (!panel) return;
  const isFiltered = expFilterYear || expFilterDateFrom || expFilterDateTo;
  if (!isFiltered || !summary) { panel.style.display = 'none'; return; }

  panel.style.display = 'block';
  const fmt = (v) => (Number(v) || 0).toLocaleString('th-TH');
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = fmt(v); };
  set('expSumLecturer', summary.sumLecturer);
  set('expSumTools',    summary.sumTools);
  set('expSumFood',     summary.sumFood);
  set('expSumSnack',    summary.sumSnack);
  set('expSumTravel',   summary.sumTravel);
  set('expSumTotal',    summary.sumTotal);
}

export function onExpenseDateFilter() {
  expFilterYear     = document.getElementById('expFilterYear')?.value || '';
  expFilterDateFrom = document.getElementById('expFilterDateFrom')?.value || '';
  expFilterDateTo   = document.getElementById('expFilterDateTo')?.value || '';

  // If year selected, clear date range; if date range set, clear year
  if (expFilterYear) {
    expFilterDateFrom = '';
    expFilterDateTo   = '';
    const from = document.getElementById('expFilterDateFrom');
    const to   = document.getElementById('expFilterDateTo');
    if (from) from.value = '';
    if (to)   to.value   = '';
  } else if (expFilterDateFrom || expFilterDateTo) {
    expFilterYear = '';
    const yr = document.getElementById('expFilterYear');
    if (yr) yr.value = '';
  }

  const clearBtn = document.getElementById('btnClearExpenseFilter');
  const info     = document.getElementById('expFilterInfo');
  const isActive = expFilterYear || expFilterDateFrom || expFilterDateTo;

  if (clearBtn) clearBtn.style.display = isActive ? '' : 'none';
  if (info) {
    if (expFilterYear) {
      info.textContent = `กรองปี ${Number(expFilterYear) + 543}`;
    } else if (expFilterDateFrom && expFilterDateTo) {
      info.textContent = `${expFilterDateFrom} ถึง ${expFilterDateTo}`;
    } else if (expFilterDateFrom) {
      info.textContent = `ตั้งแต่ ${expFilterDateFrom}`;
    } else if (expFilterDateTo) {
      info.textContent = `ถึง ${expFilterDateTo}`;
    } else {
      info.textContent = '';
    }
  }

  expCurrentPage = 1;
  refreshExpenseData();
}

export function clearExpenseDateFilter() {
  expFilterYear = '';
  expFilterDateFrom = '';
  expFilterDateTo = '';
  const yr   = document.getElementById('expFilterYear');
  const from = document.getElementById('expFilterDateFrom');
  const to   = document.getElementById('expFilterDateTo');
  if (yr)   yr.value   = '';
  if (from) from.value = '';
  if (to)   to.value   = '';
  const clearBtn = document.getElementById('btnClearExpenseFilter');
  const info     = document.getElementById('expFilterInfo');
  if (clearBtn) clearBtn.style.display = 'none';
  if (info)     info.textContent = '';
  expCurrentPage = 1;
  refreshExpenseData();
}