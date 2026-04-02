// ===================== EMPLOYEES PAGE =====================
import { escHtml, formatDate, formatDateInput, showToast, showModal, closeModal } from './utils.js';
import { currentUser } from './auth.js';

export let allEmployees = [];
export let subdivisions = [];
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
    document.getElementById('sidebarCount').textContent = totalCount;
  }

  container.innerHTML = `
    <!-- STAT CARDS -->
    <div class="row g-3 mb-4">
      <div class="col-md-4">
        <div class="stat-card">
          <div class="stat-icon blue"><i class="bi bi-people-fill"></i></div>
          <div>
            <div class="stat-value" id="statTotal">${totalCount.toLocaleString()}</div>
            <div class="stat-label">พนักงานทั้งหมด</div>
          </div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="stat-card">
          <div class="stat-icon green"><i class="bi bi-person-check-fill"></i></div>
          <div>
            <div class="stat-value" id="statActive">${activeCount.toLocaleString()}</div>
            <div class="stat-label">พนักงานที่ทำงานอยู่</div>
          </div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="stat-card">
          <div class="stat-icon amber"><i class="bi bi-person-x-fill"></i></div>
          <div>
            <div class="stat-value" id="statInactive">${inactiveCount.toLocaleString()}</div>
            <div class="stat-label">พนักงานที่ไม่ทำงานแล้ว</div>
          </div>
        </div>
      </div>
    </div>

    <!-- TABLE -->
    <div class="table-section">
      <div class="table-header">
        <span class="table-title">รายชื่อพนักงาน</span>

        <div class="search-box">
          <i class="bi bi-search"></i>
          <input type="text" class="search-input" id="searchInput"
            placeholder="ค้นหา รหัส / ชื่อ / เลขบัตร..."
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
          <option value="Activated">Activated</option>
          <option value="Resigned">Resigned</option>
          <option value="Terminated">Terminated</option>
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
              <td colspan="8">
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

  // Populate subdivision filter
  const filterSub = document.getElementById('filterSubdivision');
  subdivisions.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.Sub_ID;
    opt.textContent = s.Sub_Name;
    filterSub.appendChild(opt);
  });

  await fetchAndRenderEmployees();
}

export async function loadSubdivisions() {
  const res = await window.api.getSubdivisions();
  if (res.success) {
    subdivisions = res.data;
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
  const subdivision = document.getElementById('filterSubdivision')?.value || '';

  const res = await window.api.getEmployees({ search, status, subdivision, page, perPage: empPerPage });
  const tbody = document.getElementById('empTableBody');

  if (!res.success) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-danger">
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
    tbody.innerHTML = `<tr><td colspan="8">
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
            </button>
            <button class="btn-action delete" title="ลบ" onclick="openDeleteEmployee('${escHtml(emp.Emp_ID)}', '${escHtml(emp.Fullname || '')}')">
              <i class="bi bi-trash3-fill"></i>
            </button>` : ''}
          </div>
        </td>
      </tr>`;
  }).join('');
}

export function onSearch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(filterEmployees, 350);
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

// ===================== ADD / EDIT EMPLOYEE =====================
export async function openAddEmployee() {
  editingEmpId = null;
  document.getElementById('empModalTitle').textContent = 'เพิ่มพนักงานใหม่';
  clearEmpForm();
  await populateModalDropdowns();
  showModal('empModal');
}

export async function openEditEmployee(empId) {
  editingEmpId = empId;
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
  document.getElementById('fEmpIDCard').value = emp.Emp_IDCard || '';
  document.getElementById('fEmpLevel').value = emp.Emp_Level || '';
  document.getElementById('fSubID').value = emp.Sub_ID || '';
  document.getElementById('fPositionID').value = emp.Position_ID || '';
  document.getElementById('fEmpStartDate').value = formatDateInput(emp.Emp_Start_date);
  document.getElementById('fEmpPackingDate').value = formatDateInput(emp.Emp_Packing_date);
  document.getElementById('fEmpStatus').value = emp.Emp_Status || 'Activated';
  document.getElementById('fEmpVsth').value = emp.Emp_Vsth || 'Vel';

  showModal('empModal');
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

  if (!empId) { showToast('กรุณากรอกรหัสพนักงาน', 'error'); return; }
  if (!firstname) { showToast('กรุณากรอกชื่อพนักงาน', 'error'); return; }
  if (!lastname) { showToast('กรุณากรอกนามสกุลพนักงาน', 'error'); return; }
  if (!subId) { showToast('กรุณาเลือกแผนก', 'error'); return; }
  if (!posId) { showToast('กรุณาเลือกตำแหน่ง', 'error'); return; }

  const data = {
    Emp_ID: empId,
    Emp_Sname: document.getElementById('fEmpSname').value,
    Emp_Firstname: firstname,
    Emp_Lastname: lastname,
    Emp_IDCard: document.getElementById('fEmpIDCard').value.trim(),
    Emp_Level: document.getElementById('fEmpLevel').value.trim(),
    Sub_ID: subId,
    Position_ID: posId,
    Emp_Start_date: document.getElementById('fEmpStartDate').value || null,
    Emp_Packing_date: document.getElementById('fEmpPackingDate').value || null,
    Emp_Status: document.getElementById('fEmpStatus').value,
    Emp_Vsth: document.getElementById('fEmpVsth').value
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

  const btn = document.getElementById('btnConfirmDelete');
  btn.innerHTML = '<span class="spinner" style="display:inline-block;width:16px;height:16px;margin:0 8px -3px 0;"></span> กำลังลบ...';
  btn.disabled = true;

  const res = await window.api.deleteEmployee(deletingEmpId);

  btn.innerHTML = '<i class="bi bi-trash3"></i> ลบข้อมูล';
  btn.disabled = false;

  if (res.success) {
    showToast(res.message, 'success');
    closeConfirmModal();
    await loadEmployeesPage();
  } else {
    showToast(res.message || 'เกิดข้อผิดพลาด', 'error');
  }
  deletingEmpId = null;
}

export function closeConfirmModal() {
  closeModal('confirmModal');
  deletingEmpId = null;
}
