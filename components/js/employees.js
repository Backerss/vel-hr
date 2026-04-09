// ===================== EMPLOYEES PAGE =====================
import { escHtml, formatDate, isoDateToDisplayDate, displayDateToIso, showToast, showModal, closeModal, requirePasswordConfirm, formatIDCard } from './utils.js';
import { currentUser } from './auth.js';

export let allEmployees = [];
export let subdivisions = [];
let departments = [];
export let positions = [];
let editingEmpId = null;
let deletingEmpId = null;
let searchTimeout = null;
let empCurrentPage = 1;
let empTotalCount = 0;
let empPerPage = 50;

function withTimeout(promise, ms, name) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${name} timeout`)), ms))
  ]);
}

function buildDepartmentList() {
  const departmentMap = new Map();
  subdivisions.forEach(subdivision => {
    const departmentId = String(subdivision.Dpt_ID || '').trim();
    if (!departmentId) return;
    if (!departmentMap.has(departmentId)) {
      departmentMap.set(departmentId, {
        Dpt_ID: departmentId,
        Dpt_Name: String(subdivision.Dpt_Name || departmentId).trim()
      });
    }
  });
  departments = [...departmentMap.values()].sort((left, right) =>
    String(left.Dpt_Name || '').localeCompare(String(right.Dpt_Name || ''))
  );
}

function getFilteredSubdivisions(departmentId = '') {
  return subdivisions.filter(subdivision => !departmentId || String(subdivision.Dpt_ID) === String(departmentId));
}

function renderEmployeeFilterOptions() {
  const filterDepartment = document.getElementById('filterDepartment');
  const filterSubdivision = document.getElementById('filterSubdivision');
  if (!filterDepartment || !filterSubdivision) return;

  const selectedDepartment = filterDepartment.value || '';
  const selectedSubdivision = filterSubdivision.value || '';

  filterDepartment.innerHTML = '<option value="">ทุกฝ่าย</option>';
  departments.forEach(department => {
    const option = document.createElement('option');
    option.value = department.Dpt_ID;
    option.textContent = department.Dpt_Name;
    filterDepartment.appendChild(option);
  });
  if (selectedDepartment && departments.some(department => String(department.Dpt_ID) === String(selectedDepartment))) {
    filterDepartment.value = selectedDepartment;
  }

  const visibleSubdivisions = getFilteredSubdivisions(filterDepartment.value || '');
  filterSubdivision.innerHTML = '<option value="">ทุกแผนก</option>';
  visibleSubdivisions.forEach(subdivision => {
    const option = document.createElement('option');
    option.value = subdivision.Sub_ID;
    option.textContent = subdivision.Sub_Name;
    filterSubdivision.appendChild(option);
  });
  if (selectedSubdivision && visibleSubdivisions.some(subdivision => String(subdivision.Sub_ID) === String(selectedSubdivision))) {
    filterSubdivision.value = selectedSubdivision;
  }
}

export async function loadEmployeesPage() {
  const container = document.getElementById('pageContent');
  container.innerHTML = `<div class="text-center py-5"><div class="spinner" style="margin:0 auto;"></div><p class="mt-3 text-muted">กำลังโหลดข้อมูล...</p></div>`;

  try {
    await Promise.all([
      withTimeout(loadSubdivisions(), 10000, 'loadSubdivisions'),
      withTimeout(loadPositions(), 10000, 'loadPositions')
    ]);
  } catch (e) {
    console.warn('Employee metadata load warning:', e.message);
  }

  let countRes = { success: false };
  try {
    countRes = await withTimeout(window.api.getEmployeeCount(), 10000, 'getEmployeeCount');
  } catch (e) {
    console.warn('Employee count load warning:', e.message);
  }
  let totalCount = 0, activeCount = 0, inactiveCount = 0;
  if (countRes.success) {
    totalCount = countRes.total;
    activeCount = countRes.active;
    inactiveCount = countRes.inactive;
    document.getElementById('sidebarCount').textContent = activeCount;
  }

  container.innerHTML = `
    <!-- TABLE -->
    <div class="table-section">
      <div class="table-header">
        <span class="table-title">รายชื่อพนักงาน</span>
        <span style="font-size:12px;color:var(--gray-500);background:var(--gray-100);border-radius:20px;padding:3px 10px;font-weight:600;">
          <i class="bi bi-people-fill" style="margin-right:4px;color:var(--primary);"></i>ทั้งหมด ${activeCount.toLocaleString()} คน
        </span>

        <div class="search-box">
          <i class="bi bi-search"></i>
          <input type="text" class="search-input" id="searchInput"
            placeholder="ค้นหา รหัส / ชื่อ / เลขบัตร / แผนก / ฝ่าย..."
            oninput="onSearch()" />
        </div>

        <div style="display:flex;align-items:center;gap:8px;color:var(--gray-600);font-size:12.5px;">
          <span>แสดง</span>
          <select class="filter-select" id="empPageSize" onchange="setEmployeePageSize()" style="min-width:88px;">
            <option value="25">25</option>
            <option value="50" selected>50</option>
            <option value="100">100</option>
          </select>
        </div>

        <select class="filter-select" id="filterStatus" onchange="filterEmployees()">
          <option value="">ทุกสถานะ</option>
          <option value="Activated" selected>Activated</option>
          <option value="Resigned">Resigned</option>
          <option value="Terminated">Terminated</option>
        </select>

        <select class="filter-select" id="filterDepartment" onchange="onDepartmentFilterChange()">
          <option value="">ทุกฝ่าย</option>
        </select>

        <select class="filter-select" id="filterSubdivision" onchange="filterEmployees()">
          <option value="">ทุกแผนก</option>
        </select>

        ${currentUser && currentUser.role === 'admin' ? `
        <button class="btn-primary-custom" onclick="openAddEmployee()">
          <i class="bi bi-person-plus-fill"></i> เพิ่มพนักงาน
        </button>` : ''}
      </div>

      <div class="table-responsive-custom">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:80px;">รหัส</th>
              <th>ชื่อ-นามสกุล</th>
              <th>ฝ่าย</th>
              <th>แผนก</th>
              <th>ตำแหน่ง</th>
              <th style="width:100px;">ประเภท</th>
              <th>วันที่เริ่มงาน</th>
              <th style="width:110px;">สถานะ</th>
              <th style="width:110px;text-align:center;">จัดการ</th>
            </tr>
          </thead>
          <tbody id="empTableBody">
            <tr class="loading-row">
              <td colspan="9">
                <div class="spinner"></div>
                <div>กำลังโหลด...</div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="table-footer">
        <div class="record-count">
          แสดง <span id="displayCount">0</span> จาก <span id="totalRecordCount">0</span> รายการ
        </div>
        <div class="emp-pagination" id="empPaginationControls"></div>
      </div>
    </div>
  `;

  renderEmployeeFilterOptions();

  await fetchAndRenderEmployees();
}

export async function loadSubdivisions() {
  const res = await window.api.getSubdivisions();
  if (res.success) {
    subdivisions = res.data;
    buildDepartmentList();
    const sel = document.getElementById('fSubID');
    if (sel) {
      sel.innerHTML = '<option value="">-- เลือกแผนก --</option>';
      subdivisions.forEach(s => {
        const o = document.createElement('option');
        o.value = s.Sub_ID; o.textContent = s.Sub_Name;
        sel.appendChild(o);
      });
    }
  }
}

export async function loadPositions() {
  const res = await window.api.getPositions();
  if (res.success) {
    positions = res.data;
    const sel = document.getElementById('fPositionID');
    if (sel) {
      sel.innerHTML = '<option value="">-- เลือกตำแหน่ง --</option>';
      positions.forEach(p => {
        const o = document.createElement('option');
        o.value = p.Position_ID; o.textContent = p.Position_Name;
        sel.appendChild(o);
      });
    }
  }
}

export async function fetchAndRenderEmployees(page = empCurrentPage) {
  empCurrentPage = page;
  const t0 = performance.now();
  const search = document.getElementById('searchInput')?.value || '';
  const status = document.getElementById('filterStatus')?.value || '';
  const department = document.getElementById('filterDepartment')?.value || '';
  const subdivision = document.getElementById('filterSubdivision')?.value || '';

  const res = await window.api.getEmployees({ search, status, department, subdivision, page, perPage: empPerPage });
  const tbody = document.getElementById('empTableBody');

  if (!res.success) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4 text-danger">
      <i class="bi bi-exclamation-triangle me-2"></i>${res.message}</td></tr>`;
    return;
  }

  allEmployees = res.data;
  empTotalCount = res.total;
  const t1 = performance.now();
  renderEmployeeTable(allEmployees);
  renderEmpPagination(res.page, res.total, res.perPage);
  const t2 = performance.now();
  console.log(`[employees] page=${page} rows=${allEmployees.length}/${res.total} query=${Math.round(t1-t0)}ms render=${Math.round(t2-t1)}ms total=${Math.round(t2-t0)}ms`);
}

export async function goToEmployeePage(page) {
  await fetchAndRenderEmployees(page);
}

function renderEmpPagination(page, total, perPage) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const displayFrom = total === 0 ? 0 : (page - 1) * perPage + 1;
  const displayTo = Math.min(page * perPage, total);

  const dc = document.getElementById('displayCount');
  const tc = document.getElementById('totalRecordCount');
  if (dc) dc.textContent = total === 0 ? '0' : `${displayFrom.toLocaleString()}-${displayTo.toLocaleString()}`;
  if (tc) tc.textContent = total.toLocaleString();

  const pager = document.getElementById('empPaginationControls');
  if (!pager) return;
  if (totalPages <= 1) { pager.innerHTML = ''; return; }

  const startP = Math.max(1, page - 3);
  const endP = Math.min(totalPages, page + 3);
  let html = `<button class="leave-page-btn" onclick="goToEmployeePage(${page - 1})" ${page <= 1 ? 'disabled' : ''}>‹</button>`;
  if (startP > 1) html += `<button class="leave-page-btn" onclick="goToEmployeePage(1)">1</button>`;
  if (startP > 2) html += `<span style="padding:0 4px;color:var(--gray-400);">…</span>`;
  for (let i = startP; i <= endP; i++) {
    html += `<button class="leave-page-btn ${i === page ? 'active' : ''}" onclick="goToEmployeePage(${i})">${i}</button>`;
  }
  if (endP < totalPages - 1) html += `<span style="padding:0 4px;color:var(--gray-400);">…</span>`;
  if (endP < totalPages) html += `<button class="leave-page-btn" onclick="goToEmployeePage(${totalPages})">${totalPages}</button>`;
  html += `<button class="leave-page-btn" onclick="goToEmployeePage(${page + 1})" ${page >= totalPages ? 'disabled' : ''}>›</button>`;
  pager.innerHTML = html;
}

export function renderEmployeeTable(employees) {
  const tbody = document.getElementById('empTableBody');
  const isAdmin = currentUser && currentUser.role === 'admin';

  if (employees.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9">
      <div class="empty-state">
        <div class="empty-icon"><i class="bi bi-people"></i></div>
        <div class="empty-text">ไม่พบข้อมูลพนักงาน</div>
      </div></td></tr>`;
    return;
  }

  tbody.innerHTML = employees.map(emp => {
    const statusClass = emp.Emp_Status === 'Activated' ? 'activated' :
      emp.Emp_Status === 'Terminated' ? 'terminated' : 'inactive';
    const startDate = emp.Emp_Start_date ? formatDate(emp.Emp_Start_date) : '-';
    const fullnameSafe = (emp.Fullname || '').replace(/'/g, "\\'");

    return `
      <tr>
        <td><span class="emp-id">${escHtml(emp.Emp_ID)}</span></td>
        <td><span class="emp-name">${escHtml(emp.Fullname || '-')}</span></td>
        <td>${escHtml(emp.Dpt_Name || '-')}</td>
        <td>${escHtml(emp.Sub_Name || '-')}</td>
        <td>${escHtml(emp.Position_Name || '-')}</td>
        <td><span class="badge" style="background:var(--primary-light);color:var(--primary);font-size:11.5px;">${escHtml(emp.Emp_Vsth || '-')}</span></td>
        <td>${startDate}</td>
        <td>
          <span class="badge-status ${statusClass}">
            ● ${escHtml(emp.Emp_Status || '-')}
          </span>
        </td>
        <td>
          <div class="action-btns" style="justify-content:center;">
            <button class="btn-action" title="ดูประวัติการอบรม"
              style="background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe;"
              onclick="openTrainingHistory('${escHtml(emp.Emp_ID)}', '${fullnameSafe}')">
              <i class="bi bi-journal-bookmark-fill"></i>
            </button>
            ${isAdmin ? `
            <button class="btn-action edit" title="แก้ไข" onclick="openEditEmployee('${escHtml(emp.Emp_ID)}')">
              <i class="bi bi-pencil-fill"></i>
            </button>` : `
            <button class="btn-action" title="ดูรายละเอียด"
              style="background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;"
              onclick="openViewEmployee('${escHtml(emp.Emp_ID)}')">
              <i class="bi bi-eye-fill"></i>
            </button>`}
          </div>
        </td>
      </tr>`;
  }).join('');
}

export function onSearch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(filterEmployees, 350);
}

export async function onDepartmentFilterChange() {
  const filterSubdivision = document.getElementById('filterSubdivision');
  if (filterSubdivision) filterSubdivision.value = '';
  renderEmployeeFilterOptions();
  await filterEmployees();
}

export async function filterEmployees() {
  empCurrentPage = 1;
  await fetchAndRenderEmployees(1);
}

export async function setEmployeePageSize() {
  const pageSizeEl = document.getElementById('empPageSize');
  empPerPage = Math.max(1, Math.min(Number(pageSizeEl?.value) || 50, 100));
  empCurrentPage = 1;
  await fetchAndRenderEmployees(1);
}

// ===================== ADD / EDIT / VIEW EMPLOYEE =====================
function _restoreModalEditMode() {
  const rowIDCardLevel = document.getElementById('rowIDCardLevel');
  if (rowIDCardLevel) rowIDCardLevel.style.display = '';
  const statusGroup = document.getElementById('empStatusFormGroup');
  if (statusGroup) statusGroup.style.display = '';
  const saveBtn = document.getElementById('btnSaveEmp');
  if (saveBtn) saveBtn.style.display = '';
  const modal = document.getElementById('empModal');
  if (modal) modal.querySelectorAll('input, select, textarea').forEach(el => el.disabled = false);
}

export async function openAddEmployee() {
  editingEmpId = null;
  _restoreModalEditMode();
  document.getElementById('empModalTitle').textContent = 'เพิ่มพนักงานใหม่';
  clearEmpForm();
  const statusGroup = document.getElementById('empStatusFormGroup');
  if (statusGroup) statusGroup.style.display = 'none';
  await populateModalDropdowns();
  showModal('empModal');
}

export async function openEditEmployee(empId) {
  editingEmpId = empId;
  _restoreModalEditMode();
  document.getElementById('empModalTitle').textContent = 'แก้ไขข้อมูลพนักงาน';
  await populateModalDropdowns();

  const res = await window.api.getEmployeeById(empId);
  if (!res.success) {
    showToast('ไม่พบข้อมูลพนักงาน', 'error');
    return;
  }

  const emp = res.data;
  document.getElementById('fEmpID').value = emp.Emp_ID;
  document.getElementById('fEmpID').disabled = true;
  document.getElementById('fEmpSname').value = emp.Emp_Sname || 'นาย';
  document.getElementById('fEmpFirstname').value = emp.Emp_Firstname || '';
  document.getElementById('fEmpLastname').value = emp.Emp_Lastname || '';
  document.getElementById('fEmpIDCard').value = formatIDCard(emp.Emp_IDCard || '');
  document.getElementById('fEmpLevel').value = emp.Emp_Level || '';
  document.getElementById('fSubID').value = emp.Sub_ID || '';
  document.getElementById('fPositionID').value = emp.Position_ID || '';
  document.getElementById('fEmpStartDate').value = isoDateToDisplayDate(emp.Emp_Start_date);
  document.getElementById('fEmpPackingDate').value = isoDateToDisplayDate(emp.Emp_Packing_date);
  document.getElementById('fEmpStatus').value = emp.Emp_Status || 'Activated';
  document.getElementById('fEmpVsth').value = emp.Emp_Vsth || 'Vel';

  showModal('empModal');
}

export async function openViewEmployee(empId) {
  const res = await window.api.getEmployeeById(empId);
  if (!res.success) {
    showToast('ไม่พบข้อมูลพนักงาน', 'error');
    return;
  }

  const emp = res.data;

  // Resolve subdivision name and department name from loaded data
  const sub = subdivisions.find(s => String(s.Sub_ID) === String(emp.Sub_ID));
  const pos = positions.find(p => String(p.Position_ID) === String(emp.Position_ID));

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val || '-';
  };

  set('vEmpID',         emp.Emp_ID);
  set('vEmpSname',      emp.Emp_Sname);
  set('vEmpFirstname',  emp.Emp_Firstname);
  set('vEmpLastname',   emp.Emp_Lastname);
  set('vDptName',       sub?.Dpt_Name || '-');
  set('vSubName',       sub?.Sub_Name || '-');
  set('vPositionName',  pos?.Position_Name || '-');
  set('vEmpVsth',       emp.Emp_Vsth);
  set('vEmpStartDate',  emp.Emp_Start_date ? formatDate(emp.Emp_Start_date) : '-');
  set('vEmpPackingDate',emp.Emp_Packing_date ? formatDate(emp.Emp_Packing_date) : '-');
  set('vEmpStatus',     emp.Emp_Status);

  showModal('empViewModal');
}

export function closeEmpViewModal() {
  closeModal('empViewModal');
}


async function populateModalDropdowns() {
  await loadSubdivisions();
  await loadPositions();
}

function clearEmpForm() {
  const fields = ['fEmpID', 'fEmpFirstname', 'fEmpLastname', 'fEmpIDCard', 'fEmpLevel', 'fEmpStartDate', 'fEmpPackingDate'];
  fields.forEach(f => {
    const el = document.getElementById(f);
    if (el) { el.value = ''; el.disabled = false; }
  });
  const selects = ['fEmpSname', 'fSubID', 'fPositionID', 'fEmpStatus', 'fEmpVsth'];
  selects.forEach(f => {
    const el = document.getElementById(f);
    if (el) { el.selectedIndex = 0; el.disabled = false; }
  });
}

export async function saveEmployee() {
  const empId = document.getElementById('fEmpID').value.trim();
  const firstname = document.getElementById('fEmpFirstname').value.trim();
  const lastname = document.getElementById('fEmpLastname').value.trim();
  const subId = document.getElementById('fSubID').value;
  const posId = document.getElementById('fPositionID').value;
  const startDateText = document.getElementById('fEmpStartDate').value.trim();
  const packingDateText = document.getElementById('fEmpPackingDate').value.trim();

  if (!empId) { showToast('กรุณากรอกรหัสพนักงาน', 'error'); return; }
  if (!firstname) { showToast('กรุณากรอกชื่อพนักงาน', 'error'); return; }
  if (!lastname) { showToast('กรุณากรอกนามสกุลพนักงาน', 'error'); return; }
  if (!subId) { showToast('กรุณาเลือกแผนก', 'error'); return; }
  if (!posId) { showToast('กรุณาเลือกตำแหน่ง', 'error'); return; }
  const snameVal = document.getElementById('fEmpSname').value;
  const vsthVal = document.getElementById('fEmpVsth').value;
  if (!snameVal) { showToast('กรุณาเลือกคำนำหน้า', 'error'); return; }
  if (!vsthVal) { showToast('กรุณาเลือกประเภทพนักงาน (Vsth)', 'error'); return; }

  const startDateDb = startDateText ? displayDateToIso(startDateText) : null;
  const packingDateDb = packingDateText ? displayDateToIso(packingDateText) : null;

  if (startDateText && !startDateDb) { showToast('วันที่เริ่มงานไม่ถูกต้อง (ต้องเป็น DD/MM/YYYY)', 'error'); return; }
  if (packingDateText && !packingDateDb) { showToast('วันที่บรรจุไม่ถูกต้อง (ต้องเป็น DD/MM/YYYY)', 'error'); return; }

  const data = {
    Emp_ID: empId,
    Emp_Sname: snameVal,
    Emp_Firstname: firstname,
    Emp_Lastname: lastname,
    Emp_IDCard: document.getElementById('fEmpIDCard').value.replace(/-/g, '').trim(),
    Emp_Level: document.getElementById('fEmpLevel').value.trim(),
    Sub_ID: subId,
    Position_ID: posId,
    Emp_Start_date: startDateDb,
    Emp_Packing_date: packingDateDb,
    Emp_Status: editingEmpId ? document.getElementById('fEmpStatus').value : 'Activated',
    Emp_Vsth: vsthVal
  };

  const btn = document.getElementById('btnSaveEmp');
  btn.innerHTML = '<span class="spinner" style="display:inline-block;width:16px;height:16px;margin:0 8px -3px 0;"></span> กำลังบันทึก...';
  btn.disabled = true;

  let res;
  if (editingEmpId) {
    res = await window.api.updateEmployee(data);
  } else {
    res = await window.api.addEmployee(data);
  }

  btn.innerHTML = '<i class="bi bi-check2-circle"></i> บันทึก';
  btn.disabled = false;

  if (res.success) {
    showToast(res.message, 'success');
    closeEmpModal();
    await loadEmployeesPage();
  } else {
    showToast(res.message || 'เกิดข้อผิดพลาด', 'error');
  }
}

export function closeEmpModal() {
  closeModal('empModal');
  editingEmpId = null;
}

// ===================== DELETE EMPLOYEE =====================
export function openDeleteEmployee(empId, fullname) {
  deletingEmpId = empId;
  document.getElementById('confirmText').innerHTML =
    `คุณต้องการลบข้อมูลพนักงาน<br/><strong>${escHtml(fullname)}</strong> (${escHtml(empId)}) ?<br/><span style="color:var(--danger);font-size:12.5px;">การดำเนินการนี้ไม่สามารถย้อนกลับได้</span>`;
  showModal('confirmModal');
}

export async function executeDelete() {
  if (!deletingEmpId) return;
  const id = deletingEmpId;
  closeConfirmModal();
  requirePasswordConfirm(currentUser?.username || '', async () => {
    const res = await window.api.deleteEmployee(id);
    if (res.success) {
      showToast(res.message, 'success');
      await loadEmployeesPage();
    } else {
      showToast(res.message || 'เกิดข้อผิดพลาด', 'error');
    }
  });
}

export function closeConfirmModal() {
  closeModal('confirmModal');
  deletingEmpId = null;
}
