/**
 * renderer.js — Entry point (ES Module)
 * โหลด HTML components ผ่าน fetch แล้ว wire ทุก function ขึ้น global window
 */

import {
  escHtml, showToast, showModal, closeModal, initModalBackdropClose,
  submitPasswordConfirm, closePasswordConfirmModal,
  formatThaiDateField, autoFormatThaiDateField, autoFormatIDCard
} from './components/js/utils.js';
import { initThaiDatePicker, initAllThaiDatePickers, initThaiTimePicker, initAllThaiTimePickers, autoFormatLeaveTimeField, formatLeaveTimeField } from './components/js/thai-datepicker.js';
import { checkDBStatus, doLogin, doLoginAsGuest, initAutoLogin, applyMenuForRole, confirmLogout, doLogout, currentUser } from './components/js/auth.js';
import {
  loadEmployeesPage, loadSubdivisions, loadPositions,
  fetchAndRenderEmployees, renderEmployeeTable,
  onSearch, filterEmployees, goToEmployeePage, setEmployeePageSize, onDepartmentFilterChange,
  openAddEmployee, openEditEmployee, saveEmployee, closeEmpModal,
  openDeleteEmployee, executeDelete, closeConfirmModal,
  openViewEmployee, closeEmpViewModal
} from './components/js/employees.js';
import {
  openTrainingHistory, closeTrainingHistory,
  trainingDTRender, trainingDTGoPage, trainingDTSort,
  trainingDTSetPageSize, trainingDTSearch
} from './components/js/training.js';
import {
  loadTrainingManagementPage, switchTrainingTab, updateCourseDisplay,
  submitTrainingForm, addParticipant, removeParticipant, renderParticipantsList,
  viewTrainingDetails, closeTrainingDetailsModal, editTraining,
  filterTrainingList, loadTrainingList, goToTrainingPage,
  openTrainingModal, closeTrainingModal, refreshTrainingData,
  onTrainingSearch, setTrainingPageSize,
  togglePendingParticipant, toggleAllPendingParticipants,
  toggleParticipantForRemoval, toggleAllParticipantsForRemoval, removeSelectedParticipants,
  formatDateInputField, autoFormatDateField, formatTimeInputField, autoFormatTimeField
} from './components/js/training-plan.js';
import {
  loadTrainingExpensePage,
  refreshExpenseData, onExpenseSearch, setExpensePageSize, goToExpensePage,
  openExpenseModal, closeExpenseModal, submitExpenseForm, calcExpenseTotal,
  onExpPlanIdInput, hideExpPlanSuggestions, selectExpPlan
} from './components/js/training-expenses.js';
import {
  loadTrainingRecordPage,
  onRecordPlanSearch, showRecordPlanDropdown, hideRecordPlanDropdown,
  selectRecordPlan, onRecordTimeRangeChange,
  updateRecordState, updateRecordRemark, exportTrainingRecordExcel
} from './components/js/training-record.js';
import {
  loadHolidayPage, hdRefresh, hdOnSearch, hdOnYearChange,
  hdCalPrev, hdCalNext, hdCalRender,
  hdOpenModal, hdCloseModal, hdAutoFormatDate, hdBlurDate, hdSubmitForm,
  hdOpenDeleteModal, hdCloseDeleteModal, hdExecuteDelete
} from './components/js/holiday.js';
import {
  loadLeaveRecordPage, fetchAndRenderLeave, applyLeaveFilter, onLeaveSearch,
  renderLeaveTable, goLeavePage,
  openLeaveForm, lookupEmployee, saveLeaveRecord, closeLeaveModal,
  confirmDeleteLeave, executeDeleteLeave,
  onLeaveTypeChange, onLeaveStartDTChange,
  loadDailyAbsencePage, loadAbsenceReport, clearSignature, printAbsenceReport,
  loadTodayLeave, applyTodayLeaveFilter, renderTodayLeaveTable, goTodayLeavePage
} from './components/js/leave.js';
import {
  loadOtPage,
  otOnSubChange, otOnFilterChange, otOnEmpSearch,
  otToggleEmp, otSelectAll, otDeselectAll,
  otGenerate, otExport, otPrint
} from './components/js/ot.js';
import {
  loadOtSignersPage,
  otsgOpenEdit, otsgEmpSearch, otsgSelectEmp,
  otsgClearSupervisor, otsgSave
} from './components/js/ot-signers.js';

// ===================== COMPONENT LOADER =====================
async function loadComponent(url, targetId) {
  const res = await fetch(url);
  const html = await res.text();
  document.getElementById(targetId).innerHTML = html;
}

// ===================== PAGE CONFIG =====================
const PAGE_CONFIG = {
  employees:            { title: 'ข้อมูลพนักงาน',             subtitle: 'จัดการข้อมูลพนักงานทั้งหมด',       icon: 'bi-people-fill',        group: null },
  trainingManagement:   { title: 'จัดการแผนการฝึกอบรม',      subtitle: 'สร้างและจัดการแผนการฝึกอบรม',   icon: 'bi-clipboard-check',    group: 'groupTraining' },
  trainingRecord:       { title: 'บันทึกการอบรม',              subtitle: 'บันทึกผลการเข้าอบรม',             icon: 'bi-journal-check',      group: 'groupTraining' },
  trainingExpense:      { title: 'บันทึกค่าใช้จ่าย',          subtitle: 'บันทึกค่าใช้จ่ายการอบรม',        icon: 'bi-receipt',            group: 'groupTraining' },
  leaveRecord:          { title: 'บันทึกลางาน',                subtitle: 'บันทึกการลาของพนักงาน',           icon: 'bi-calendar-plus',      group: 'groupLeave' },
  dailyAbsence:         { title: 'รายงานการหยุดงานประจำวัน',   subtitle: 'ดูรายงานการขาด/ลา ประจำวัน',     icon: 'bi-calendar-x',         group: 'groupLeave' },
  ot:                   { title: 'OT',                         subtitle: 'จัดการข้อมูลการทำงานล่วงเวลา',   icon: 'bi-clock-history',      group: 'groupOT' },
  otSigners:            { title: 'จัดการผู้เซ็นชื่อ OT',           subtitle: 'กำหนดหัวหน้างานผู้เซ็นชื่อในแบบฟอร์ม OT',   icon: 'bi-pen-fill',           group: 'groupOT' },
  holiday:              { title: 'วันหยุดบริษัท',                  subtitle: 'กำหนดวันหยุดประจำปีของบริษัท',         icon: 'bi-calendar2-heart',    group: null },
};

// ===================== NAV GROUP TOGGLE =====================
function toggleGroup(groupId) {
  const header = document.querySelector(`#${groupId} .nav-group-header`);
  const submenuId = groupId.replace('group', 'sub');
  const submenu = document.getElementById(submenuId);
  if (!header || !submenu) return;

  const isOpen = submenu.classList.contains('open');
  submenu.classList.toggle('open', !isOpen);
  header.classList.toggle('open', !isOpen);
}

// ===================== PAGE SWITCHING =====================
let currentPage = 'employees';

async function switchPage(page) {
  currentPage = page;
  const cfg = PAGE_CONFIG[page] || { title: page, subtitle: '', icon: 'bi-grid', group: null };

  document.querySelectorAll('.nav-item-custom').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.nav-subitem').forEach(n => n.classList.remove('active'));

  const navId = (page === 'ot')
    ? 'navOT'
    : ('nav' + page.charAt(0).toUpperCase() + page.slice(1));
  const navEl = document.getElementById(navId);
  if (navEl) navEl.classList.add('active');

  if (cfg.group) {
    const submenuId = cfg.group.replace('group', 'sub');
    const header = document.querySelector(`#${cfg.group} .nav-group-header`);
    const submenu = document.getElementById(submenuId);
    if (submenu && !submenu.classList.contains('open')) {
      submenu.classList.add('open');
      header?.classList.add('open');
    }
  }

  document.getElementById('pageTitle').textContent = cfg.title;
  document.getElementById('pageSubtitle').textContent = cfg.subtitle;

  if (page === 'employees') {
    await loadEmployeesPage();
  } else if (page === 'trainingManagement') {
    await loadTrainingManagementPage();
  } else if (page === 'leaveRecord') {
    await loadLeaveRecordPage();
  } else if (page === 'dailyAbsence') {
    await loadDailyAbsencePage();
  } else if (page === 'trainingRecord') {
    await loadTrainingRecordPage();
  } else if (page === 'trainingExpense') {
    await loadTrainingExpensePage();
  } else if (page === 'ot') {
    await loadOtPage();
  } else if (page === 'otSigners') {
    await loadOtSignersPage();
  } else if (page === 'holiday') {
    await loadHolidayPage();
  } else {
    loadPlaceholderPage(cfg);
  }
}

function refreshCurrentPage() {
  switchPage(currentPage);
}

function loadPlaceholderPage(cfg) {
  const container = document.getElementById('pageContent');
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
      height:100%;min-height:400px;gap:20px;">
      <div style="width:80px;height:80px;background:var(--primary-light);border-radius:20px;
        display:flex;align-items:center;justify-content:center;">
        <i class="bi ${escHtml(cfg.icon)}" style="font-size:36px;color:var(--primary);"></i>
      </div>
      <div style="text-align:center;">
        <h4 style="font-size:18px;font-weight:700;color:var(--gray-800);margin-bottom:8px;">
          ${escHtml(cfg.title)}
        </h4>
        <p style="font-size:13.5px;color:var(--gray-500);margin:0;">
          ${escHtml(cfg.subtitle)}
        </p>
      </div>
      <div style="padding:14px 24px;background:var(--warning-light);border-radius:10px;
        border-left:3px solid var(--warning);max-width:340px;">
        <p style="font-size:13px;color:#92400e;margin:0;text-align:center;">
          <i class="bi bi-tools me-2"></i>
          หน้านี้อยู่ระหว่างการพัฒนา<br/>
          <span style="font-size:11.5px;opacity:0.8;">กำลังดำเนินการเพิ่มฟังก์ชัน</span>
        </p>
      </div>
    </div>
  `;
}

// ===================== INIT =====================
async function init() {
  // Load HTML components into placeholders
  await Promise.all([
    loadComponent('./components/html/login.html',                     'loginSlot'),
    loadComponent('./components/html/sidebar.html',                   'sidebarSlot'),
    loadComponent('./components/html/topbar.html',                    'topbarSlot'),
    loadComponent('./components/html/modals/emp-modal.html',          'modalsSlot'),
    loadComponent('./components/html/modals/confirm-modal.html',      'modalsSlot'),
    loadComponent('./components/html/modals/logout-modal.html',       'modalsSlot'),
    loadComponent('./components/html/modals/leave-modal.html',        'modalsSlot'),
    loadComponent('./components/html/modals/leave-confirm-modal.html','modalsSlot'),
  ]);

  // loginSlot & sidebarSlot etc. use innerHTML = so only last wins for modalsSlot
  // Fix: load modals sequentially and append
  const modalFiles = [
    './components/html/modals/db-config-modal.html',
    './components/html/modals/emp-modal.html',
    './components/html/modals/emp-view-modal.html',
    './components/html/modals/confirm-modal.html',
    './components/html/modals/password-confirm-modal.html',
    './components/html/modals/logout-modal.html',
    './components/html/modals/leave-modal.html',
    './components/html/modals/leave-confirm-modal.html',
    './components/html/modals/leave-save-confirm-modal.html',
  ];
  const modalsSlot = document.getElementById('modalsSlot');
  modalsSlot.innerHTML = '';
  for (const url of modalFiles) {
    const r = await fetch(url);
    modalsSlot.insertAdjacentHTML('beforeend', await r.text());
  }

  // Setup modal backdrop close
  initModalBackdropClose(['empModal','empViewModal','passwordConfirmModal','confirmModal','logoutModal','leaveConfirmModal','trainingFormModal','trainingDetailsModal','expenseFormModal','holidayFormModal','holidayDeleteModal']);

  // Init date pickers on all modal date inputs
  initAllThaiDatePickers();

  // Init time pickers on all modal time inputs
  initAllThaiTimePickers();

  // Global Enter-key navigation (move to next field / trigger search)
  initEnterKeyNavigation();

  // Login event listeners
  document.getElementById('loginUsername').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('loginPassword').focus();
  });
  document.getElementById('loginPassword').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
  });
  document.getElementById('btnLogin').addEventListener('click', doLogin);

  // DB status
  await checkDBStatus();

  // Check if DB config is needed (no config file or connection failed at startup)
  const dbCheck = await window.api.isDbConfigNeeded();
  if (dbCheck && dbCheck.needed) {
    // Pre-fill modal with default values so IT staff can adjust if needed
    const d = dbCheck.defaults || {};
    const _set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
    _set('dbConfigHost',     d.host     ?? '');
    _set('dbConfigPort',     d.port     ?? 3306);
    _set('dbConfigUser',     d.user     ?? '');
    _set('dbConfigPassword', d.password ?? '');
    _set('dbConfigDatabase', d.database ?? '');
    showModal('dbConfigModal');
  }

  // ตรวจ session ที่บันทึกไว้ ถ้ายังไม่หมดอายุ จะ auto-login เลย
  await initAutoLogin();
}

// ===================== DB CONFIG FUNCTIONS =====================
function dbConfigTogglePassword() {
  const input = document.getElementById('dbConfigPassword');
  const icon = document.getElementById('dbConfigPasswordEyeIcon');
  if (!input || !icon) return;
  if (input.type === 'password') {
    input.type = 'text';
    icon.className = 'bi bi-eye-slash';
  } else {
    input.type = 'password';
    icon.className = 'bi bi-eye';
  }
}

function _dbConfigGetValues() {
  return {
    host: (document.getElementById('dbConfigHost')?.value || '').trim(),
    port: (document.getElementById('dbConfigPort')?.value || '3306').trim(),
    user: (document.getElementById('dbConfigUser')?.value || '').trim(),
    password: document.getElementById('dbConfigPassword')?.value || '',
    database: (document.getElementById('dbConfigDatabase')?.value || '').trim(),
  };
}

function _dbConfigSetStatus(message, type) {
  const el = document.getElementById('dbConfigStatus');
  if (!el) return;
  el.style.display = 'block';
  const styles = {
    success: { bg: 'var(--success-light)', color: '#065f46', icon: 'bi-check-circle-fill' },
    error:   { bg: 'var(--danger-light)',  color: '#7f1d1d', icon: 'bi-x-circle-fill' },
    info:    { bg: 'var(--primary-light)', color: 'var(--primary-dark)', icon: 'bi-arrow-repeat' },
  };
  const s = styles[type] || styles.info;
  el.style.background = s.bg;
  el.style.color = s.color;
  el.innerHTML = `<i class="bi ${s.icon} me-2"></i>${message}`;
}

async function dbConfigTest() {
  const config = _dbConfigGetValues();
  if (!config.host || !config.user || !config.database) {
    _dbConfigSetStatus('กรุณากรอก Host, User และ Database', 'error'); return;
  }
  const testBtn = document.getElementById('dbConfigTestBtn');
  const saveBtn = document.getElementById('dbConfigSaveBtn');
  if (testBtn) testBtn.disabled = true;
  if (saveBtn) saveBtn.disabled = true;
  _dbConfigSetStatus('กำลังทดสอบการเชื่อมต่อ...', 'info');
  try {
    const result = await window.api.testDbConfig(config);
    _dbConfigSetStatus(result.message, result.success ? 'success' : 'error');
  } catch (e) {
    _dbConfigSetStatus('เกิดข้อผิดพลาด: ' + e.message, 'error');
  } finally {
    if (testBtn) testBtn.disabled = false;
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function dbConfigSave() {
  const config = _dbConfigGetValues();
  if (!config.host || !config.user || !config.database) {
    _dbConfigSetStatus('กรุณากรอก Host, User และ Database', 'error'); return;
  }
  const testBtn = document.getElementById('dbConfigTestBtn');
  const saveBtn = document.getElementById('dbConfigSaveBtn');
  if (testBtn) testBtn.disabled = true;
  if (saveBtn) saveBtn.disabled = true;
  _dbConfigSetStatus('กำลังบันทึกและเชื่อมต่อ...', 'info');
  try {
    const result = await window.api.saveDbConfig(config);
    if (result.success) {
      _dbConfigSetStatus('บันทึกสำเร็จ! เชื่อมต่อฐานข้อมูลแล้ว', 'success');
      await checkDBStatus();
      setTimeout(() => closeModal('dbConfigModal'), 1200);
    } else {
      _dbConfigSetStatus(result.message, 'error');
    }
  } catch (e) {
    _dbConfigSetStatus('เกิดข้อผิดพลาด: ' + e.message, 'error');
  } finally {
    if (testBtn) testBtn.disabled = false;
    if (saveBtn) saveBtn.disabled = false;
  }
}

// ===================== GLOBAL ENTER-KEY NAVIGATION =====================
// Rule:
//   search inputs  → fire search immediately (skip debounce)
//   lookup inputs  → trigger the lookup action
//   filter date inputs → apply filter
//   all other form inputs → move focus to next visible/enabled field
//   textarea / button / select → do nothing (natural browser behaviour)

function _nextFocusable(current) {
  const candidates = [...document.querySelectorAll(
    'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]), select, textarea'
  )].filter(el => {
    if (el === current)  return false;
    if (el.disabled)     return false;
    if (el.readOnly)     return false;
    if (el.tabIndex < 0) return false;
    // Skip invisible elements
    if (!el.offsetParent && el.type !== 'hidden') return false;
    let p = el.parentElement;
    while (p) {
      if (p.style && p.style.display === 'none') return false;
      p = p.parentElement;
    }
    return true;
  });
  const idx = candidates.indexOf(current);
  // idx === -1 when current is readonly (not in list) – find next after it by DOM order
  if (idx === -1) {
    const allInDom = [...document.querySelectorAll(
      'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]), select, textarea'
    )];
    const domIdx = allInDom.indexOf(current);
    return candidates.find(el => allInDom.indexOf(el) > domIdx) || null;
  }
  return candidates[idx + 1] || null;
}

function _prevFocusable(current) {
  const candidates = [...document.querySelectorAll(
    'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]), select, textarea'
  )].filter(el => {
    if (el === current)  return false;
    if (el.disabled)     return false;
    if (el.readOnly)     return false;
    if (el.tabIndex < 0) return false;
    if (!el.offsetParent && el.type !== 'hidden') return false;
    let p = el.parentElement;
    while (p) {
      if (p.style && p.style.display === 'none') return false;
      p = p.parentElement;
    }
    return true;
  });
  const idx = candidates.indexOf(current);
  if (idx === -1) {
    const allInDom = [...document.querySelectorAll(
      'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]), select, textarea'
    )];
    const domIdx = allInDom.indexOf(current);
    const before = candidates.filter(el => allInDom.indexOf(el) < domIdx);
    return before[before.length - 1] || null;
  }
  return candidates[idx - 1] || null;
}

function _leaveFormIsComplete() {
  const get = (id) => (document.getElementById(id)?.value || '').trim();
  return !!(
    get('fLeaveEmpID') &&
    get('fLeaveType') &&
    get('fLeaveStartDate') &&
    get('fLeaveStartTime') &&
    get('fLeaveEndDate') &&
    get('fLeaveEndTime') &&
    get('fLeaveRemark')
  );
}

function _handleEnterKey(e) {
  if (e.key !== 'Enter') return;
  const el  = e.target;
  const tag = el.tagName;

  // Textarea: Enter = newline, never intercept
  if (tag === 'TEXTAREA') return;
  // Buttons / selects: browser default
  if (tag === 'BUTTON' || tag === 'SELECT') return;
  // Inputs inside contenteditable → ignore
  if (el.closest('[contenteditable="true"]')) return;

  const id = el.id || '';

  // ── 1. Employee ID lookup field in leave modal ──────────────────────────
  if (id === 'fLeaveEmpID' && !el.readOnly) {
    e.preventDefault();
    window.lookupEmployee?.();
    return;
  }

  // ── 2. Search inputs → fire immediately (bypass debounce) ───────────────
  // Detected by class or id convention (*Search* / *search*)
  if (el.classList.contains('search-input') || /search/i.test(id)) {
    e.preventDefault();
    // Map known input IDs directly to their immediate search function
    const SEARCH_FN = {
      searchInput:        () => window.filterEmployees?.(),
      leaveSearch:        () => window.applyLeaveFilter?.(),
      trainingSearchInput:() => window.filterTrainingList?.(),
      expSearchInput:     () => window.refreshExpenseData?.(),
      hdSearchInput:      () => window.hdRefresh?.(),
      recordPlanSearch:   () => window.onRecordPlanSearch?.(),
      todayLeaveSearch:   () => window.applyTodayLeaveFilter?.(),
    };
    const fn = SEARCH_FN[id];
    if (fn) { fn(); }
    else {
      // Fall back: trigger oninput to run the wired handler
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return;
  }

  // ── 3. Filter date range inputs → fire blur handler (apply filter) ──────
  if (id === 'leaveDateFrom' || id === 'leaveDateTo') {
    e.preventDefault();
    el.dispatchEvent(new Event('blur', { bubbles: false }));
    return;
  }

  // ── 4. All other visible form inputs → Tab-like next-field navigation ───
  e.preventDefault();
  const next = _nextFocusable(el);

  // If inside leave modal and there's no next focusable field (or next is a button)
  // and all required leave fields are filled → show save confirm
  if (el.closest('#leaveModal') && currentUser?.role !== 'guest') {
    const filled = _leaveFormIsComplete();
    const nextIsActionable = next && next.tagName !== 'BUTTON';
    if (filled && !nextIsActionable) {
      showModal('leaveSaveConfirmModal');
      setTimeout(() => document.getElementById('btnConfirmSaveLeave')?.focus(), 80);
      return;
    }
  }

  if (next) {
    next.focus();
    // For text inputs, select all text for quick overwrite
    if (next.tagName === 'INPUT' && next.type !== 'time' && next.type !== 'date') {
      next.select?.();
    }
  }
}

// ── SELECT change → auto-advance to next field (all forms) ────────────────
function _handleSelectChange(e) {
  const el = e.target;
  if (el.tagName !== 'SELECT') return;
  if (el.disabled) return;
  if (!el.value) return;  // -- เลือก -- selected, don't advance

  // Never trigger save-confirm modal from a select change;
  // the modal is only triggered by Enter on the last input field.
  const next = _nextFocusable(el);
  if (next) {
    setTimeout(() => {
      next.focus();
      if (next.tagName === 'INPUT' && next.type !== 'time' && next.type !== 'date') next.select?.();
    }, 30);
  }
}

// ── Arrow Left/Up → go to previous field ──────────────────────────────────
// Rule:
//   SELECT (any): ArrowLeft / ArrowUp → go back (prevents accidental value change)
//   INPUT empty or cursor at pos 0: ArrowLeft / ArrowUp → go back
function _handleArrowNav(e) {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowUp') return;

  const el  = e.target;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return;
  if (el.closest('[contenteditable="true"]')) return;

  let goBack = false;
  if (tag === 'SELECT') {
    goBack = true;
  } else if (tag === 'INPUT') {
    const val = el.value || '';
    if (e.key === 'ArrowLeft') {
      goBack = !val || el.selectionStart === 0;
    } else {
      goBack = !val;
    }
  }

  if (!goBack) return;

  const prev = _prevFocusable(el);
  if (prev) {
    e.preventDefault();
    prev.focus();
    if (prev.tagName === 'INPUT') {
      const len = (prev.value || '').length;
      prev.setSelectionRange?.(len, len);
    }
  }
}

function initEnterKeyNavigation() {
  document.addEventListener('keydown', _handleEnterKey, true);
  document.addEventListener('keydown', _handleArrowNav, true);
  document.addEventListener('change', _handleSelectChange);
}

// ===================== EXPOSE GLOBALS (for inline onclick in HTML) =====================
// These are needed because HTML component files use onclick="..." which requires globals.
Object.assign(window, {
  // Auth
  doLogin, doLoginAsGuest, confirmLogout, doLogout,
  // Password confirm (delete guard)
  submitPasswordConfirm, closePasswordConfirmModal,
  // Shared date helpers
  formatThaiDateField, autoFormatThaiDateField, autoFormatIDCard,
  // Date picker
  initThaiDatePicker, initAllThaiDatePickers,
  // Time picker
  initThaiTimePicker, initAllThaiTimePickers, autoFormatLeaveTimeField, formatLeaveTimeField,
  // Nav
  switchPage, toggleGroup, refreshCurrentPage,
  // Employees
  openAddEmployee, openEditEmployee, saveEmployee, closeEmpModal,
  openDeleteEmployee, executeDelete, closeConfirmModal,
  openViewEmployee, closeEmpViewModal,
  onSearch, filterEmployees, goToEmployeePage, setEmployeePageSize, onDepartmentFilterChange,
  // Training
  openTrainingHistory, closeTrainingHistory,
  trainingDTRender, trainingDTGoPage, trainingDTSort,
  trainingDTSetPageSize, trainingDTSearch,
  // Training Management (Plan)
  loadTrainingManagementPage, switchTrainingTab, updateCourseDisplay,
  submitTrainingForm, addParticipant, removeParticipant, renderParticipantsList,
  viewTrainingDetails, closeTrainingDetailsModal, editTraining,
  filterTrainingList, loadTrainingList, goToTrainingPage,
  openTrainingModal, closeTrainingModal, refreshTrainingData,
  onTrainingSearch, setTrainingPageSize,
  togglePendingParticipant, toggleAllPendingParticipants,
  toggleParticipantForRemoval, toggleAllParticipantsForRemoval, removeSelectedParticipants,
  formatDateInputField, autoFormatDateField, formatTimeInputField, autoFormatTimeField,
  // Training Record
  loadTrainingRecordPage,
  onRecordPlanSearch, showRecordPlanDropdown, hideRecordPlanDropdown,
  selectRecordPlan, onRecordTimeRangeChange,
  updateRecordState, updateRecordRemark, exportTrainingRecordExcel,
  // Training Expenses
  loadTrainingExpensePage, refreshExpenseData, onExpenseSearch,
  setExpensePageSize, goToExpensePage, openExpenseModal, closeExpenseModal,
  submitExpenseForm, calcExpenseTotal, onExpPlanIdInput, hideExpPlanSuggestions, selectExpPlan,
  // Holiday
  loadHolidayPage, hdRefresh, hdOnSearch, hdOnYearChange,
  hdCalPrev, hdCalNext, hdCalRender,
  hdOpenModal, hdCloseModal, hdAutoFormatDate, hdBlurDate, hdSubmitForm,
  hdOpenDeleteModal, hdCloseDeleteModal, hdExecuteDelete,
  // Leave
  openLeaveForm, lookupEmployee, saveLeaveRecord, closeLeaveModal,
  confirmDeleteLeave, executeDeleteLeave, applyLeaveFilter, onLeaveSearch,
  onLeaveTypeChange, onLeaveStartDTChange,
  goLeavePage, loadAbsenceReport, clearSignature, printAbsenceReport,
  loadTodayLeave, applyTodayLeaveFilter, renderTodayLeaveTable, goTodayLeavePage,
  // OT
  loadOtPage,
  otOnSubChange, otOnFilterChange, otOnEmpSearch,
  otToggleEmp, otSelectAll, otDeselectAll,
  otGenerate, otExport, otPrint,
  // OT Signers (subdivision management)
  loadOtSignersPage,
  otsgOpenEdit, otsgEmpSearch, otsgSelectEmp,
  otsgClearSupervisor, otsgSave,
  // Shared modal util
  closeModal, showModal, showToast,
  // DB config
  dbConfigSave, dbConfigTest, dbConfigTogglePassword,
});

// ===================== START =====================
window.addEventListener('DOMContentLoaded', init);
