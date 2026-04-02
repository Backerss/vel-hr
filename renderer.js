/**
 * renderer.js — Entry point (ES Module)
 * โหลด HTML components ผ่าน fetch แล้ว wire ทุก function ขึ้น global window
 */

import { escHtml, showToast, showModal, closeModal, initModalBackdropClose } from './components/js/utils.js';
import { checkDBStatus, doLogin, confirmLogout, doLogout, currentUser } from './components/js/auth.js';
import {
  loadEmployeesPage, loadSubdivisions, loadPositions,
  fetchAndRenderEmployees, renderEmployeeTable,
  onSearch, filterEmployees, goToEmployeePage, setEmployeePageSize,
  openAddEmployee, openEditEmployee, saveEmployee, closeEmpModal,
  openDeleteEmployee, executeDelete, closeConfirmModal
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
  onTrainingSearch, setTrainingPageSize
} from './components/js/training-plan.js';
import {
  loadLeaveRecordPage, fetchAndRenderLeave, applyLeaveFilter, onLeaveSearch,
  renderLeaveTable, goLeavePage,
  openLeaveForm, lookupEmployee, saveLeaveRecord, closeLeaveModal,
  confirmDeleteLeave, executeDeleteLeave,
  loadDailyAbsencePage, loadAbsenceReport, clearSignature, printAbsenceReport
} from './components/js/leave.js';

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
  trainingList:         { title: 'แจ้งรายชื่อผู้เข้าอบรม',    subtitle: 'ลงทะเบียนรายชื่อผู้เข้าอบรม',     icon: 'bi-person-lines-fill',  group: 'groupTraining' },
  trainingRecord:       { title: 'บันทึกการอบรม',              subtitle: 'บันทึกผลการเข้าอบรม',             icon: 'bi-journal-check',      group: 'groupTraining' },
  trainingExpense:      { title: 'บันทึกค่าใช้จ่าย',          subtitle: 'บันทึกค่าใช้จ่ายการอบรม',        icon: 'bi-receipt',            group: 'groupTraining' },
  leaveRecord:          { title: 'บันทึกลางาน',                subtitle: 'บันทึกการลาของพนักงาน',           icon: 'bi-calendar-plus',      group: 'groupLeave' },
  dailyAbsence:         { title: 'รายงานการหยุดงานประจำวัน',   subtitle: 'ดูรายงานการขาด/ลา ประจำวัน',     icon: 'bi-calendar-x',         group: 'groupLeave' },
  leaveStatus:          { title: 'ตรวจสอบสถานะลางาน',          subtitle: 'ตรวจสอบสถานะการอนุมัติลา',       icon: 'bi-calendar-check',     group: 'groupLeave' },
  ot:                   { title: 'OT',                         subtitle: 'จัดการข้อมูลการทำงานล่วงเวลา',   icon: 'bi-clock-history',      group: null },
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

  const navId = 'nav' + page.charAt(0).toUpperCase() + page.slice(1);
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
    './components/html/modals/emp-modal.html',
    './components/html/modals/confirm-modal.html',
    './components/html/modals/logout-modal.html',
    './components/html/modals/leave-modal.html',
    './components/html/modals/leave-confirm-modal.html',
  ];
  const modalsSlot = document.getElementById('modalsSlot');
  modalsSlot.innerHTML = '';
  for (const url of modalFiles) {
    const r = await fetch(url);
    modalsSlot.insertAdjacentHTML('beforeend', await r.text());
  }

  // Setup modal backdrop close
  initModalBackdropClose(['empModal','confirmModal','logoutModal','leaveModal','leaveConfirmModal','trainingFormModal','trainingDetailsModal']);

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
}

// ===================== EXPOSE GLOBALS (for inline onclick in HTML) =====================
// These are needed because HTML component files use onclick="..." which requires globals.
Object.assign(window, {
  // Auth
  doLogin, confirmLogout, doLogout,
  // Nav
  switchPage, toggleGroup, refreshCurrentPage,
  // Employees
  openAddEmployee, openEditEmployee, saveEmployee, closeEmpModal,
  openDeleteEmployee, executeDelete, closeConfirmModal,
  onSearch, filterEmployees, goToEmployeePage, setEmployeePageSize,
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
  // Leave
  openLeaveForm, lookupEmployee, saveLeaveRecord, closeLeaveModal,
  confirmDeleteLeave, executeDeleteLeave, applyLeaveFilter, onLeaveSearch,
  goLeavePage, loadAbsenceReport, clearSignature, printAbsenceReport,
  // Shared modal util
  closeModal, showModal, showToast,
});

// ===================== START =====================
window.addEventListener('DOMContentLoaded', init);
