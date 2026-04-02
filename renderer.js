// ===================== STATE =====================
let currentUser = null;
let currentPage = 'employees';
let allEmployees = [];
let subdivisions = [];
let positions = [];
let editingEmpId = null;
let deletingEmpId = null;
let searchTimeout = null;
// Leave state
let leaveTypes = [];
let allLeaveRecords = [];
let filteredLeaveRecords = [];
let editingLeaveId = null;
let deletingLeaveId = null;
let leaveCurrentPage = 1;
const LEAVE_PER_PAGE = 50;
let leaveSearchTimeout = null;

// ===================== INIT =====================
window.addEventListener('DOMContentLoaded', () => {
  checkDBStatus();
  // Enter key on login
  document.getElementById('loginUsername').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('loginPassword').focus();
  });
  document.getElementById('loginPassword').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
  });
});

async function checkDBStatus() {
  const dot = document.getElementById('dbDot');
  const txt = document.getElementById('dbStatusText');
  try {
    const result = await window.api.getEmployeeCount();
    if (result.success) {
      dot.classList.add('connected');
      txt.textContent = 'เชื่อมต่อแล้ว';
    } else {
      txt.textContent = 'ไม่ได้เชื่อมต่อ';
    }
  } catch {
    txt.textContent = 'ไม่ได้เชื่อมต่อ';
  }
}

// ===================== LOGIN =====================
async function doLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value.trim();

  const alert = document.getElementById('loginAlert');
  alert.style.display = 'none';

  if (!username) {
    showLoginAlert('กรุณากรอกรหัสพนักงาน / Username');
    return;
  }

  const btn = document.getElementById('btnLogin');
  btn.innerHTML = '<span class="spinner" style="display:inline-block;width:18px;height:18px;margin:0 8px -4px 0;"></span> กำลังเข้าสู่ระบบ...';
  btn.disabled = true;

  try {
    const result = await window.api.login({ username, password });
    if (result.success) {
      currentUser = result.user;
      currentUser.role = result.role;

      document.getElementById('sidebarUsername').textContent = currentUser.name || currentUser.username;
      document.getElementById('sidebarRole').textContent =
        result.role === 'admin' ? 'ผู้ดูแลระบบ' : 'พนักงาน';

      // Hide login, show app
      const overlay = document.getElementById('loginOverlay');
      overlay.classList.add('hidden');
      setTimeout(() => { overlay.style.display = 'none'; }, 400);

      document.getElementById('app').classList.add('visible');
      await loadEmployeesPage();
    } else {
      showLoginAlert(result.message || 'เข้าสู่ระบบไม่สำเร็จ');
    }
  } catch (err) {
    showLoginAlert('เกิดข้อผิดพลาด: ' + err.message);
  } finally {
    btn.innerHTML = '<i class="bi bi-box-arrow-in-right me-1"></i> เข้าสู่ระบบ';
    btn.disabled = false;
  }
}

function showLoginAlert(msg) {
  const alert = document.getElementById('loginAlert');
  document.getElementById('loginAlertMsg').textContent = msg;
  alert.style.display = 'flex';
}

function confirmLogout() {
  showModal('logoutModal');
}

function doLogout() {
  closeModal('logoutModal');
  currentUser = null;
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginAlert').style.display = 'none';
  document.getElementById('app').classList.remove('visible');
  const overlay = document.getElementById('loginOverlay');
  overlay.style.display = 'flex';
  overlay.style.opacity = '0';
  overlay.classList.remove('hidden');
  setTimeout(() => { overlay.style.opacity = '1'; }, 10);
}

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

// กำหนด config ของแต่ละหน้า: { title, subtitle, icon, groupId }
const PAGE_CONFIG = {
  employees:       { title: 'ข้อมูลพนักงาน',             subtitle: 'จัดการข้อมูลพนักงานทั้งหมด',       icon: 'bi-people-fill',        group: null },
  trainingList:    { title: 'แจ้งรายชื่อผู้เข้าอบรม',    subtitle: 'ลงทะเบียนรายชื่อผู้เข้าอบรม',     icon: 'bi-person-lines-fill',  group: 'groupTraining' },
  trainingRecord:  { title: 'บันทึกการอบรม',              subtitle: 'บันทึกผลการเข้าอบรม',             icon: 'bi-journal-check',      group: 'groupTraining' },
  trainingExpense: { title: 'บันทึกค่าใช้จ่าย',          subtitle: 'บันทึกค่าใช้จ่ายการอบรม',        icon: 'bi-receipt',            group: 'groupTraining' },
  leaveRecord:     { title: 'บันทึกลางาน',                subtitle: 'บันทึกการลาของพนักงาน',           icon: 'bi-calendar-plus',      group: 'groupLeave' },
  dailyAbsence:    { title: 'รายงานการหยุดงานประจำวัน',   subtitle: 'ดูรายงานการขาด/ลา ประจำวัน',     icon: 'bi-calendar-x',         group: 'groupLeave' },
  leaveStatus:     { title: 'ตรวจสอบสถานะลางาน',          subtitle: 'ตรวจสอบสถานะการอนุมัติลา',       icon: 'bi-calendar-check',     group: 'groupLeave' },
  ot:              { title: 'OT',                         subtitle: 'จัดการข้อมูลการทำงานล่วงเวลา',   icon: 'bi-clock-history',      group: null },
};

// ===================== PAGE SWITCHING =====================
async function switchPage(page) {
  currentPage = page;
  const cfg = PAGE_CONFIG[page] || { title: page, subtitle: '', icon: 'bi-grid', group: null };

  // Reset all nav active states
  document.querySelectorAll('.nav-item-custom').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.nav-subitem').forEach(n => n.classList.remove('active'));

  // Set active on nav item (top-level) or subitem
  const navId = 'nav' + page.charAt(0).toUpperCase() + page.slice(1);
  const navEl = document.getElementById(navId);
  if (navEl) navEl.classList.add('active');

  // Open parent group if belongs to one
  if (cfg.group) {
    const submenuId = cfg.group.replace('group', 'sub');
    const header = document.querySelector(`#${cfg.group} .nav-group-header`);
    const submenu = document.getElementById(submenuId);
    if (submenu && !submenu.classList.contains('open')) {
      submenu.classList.add('open');
      header?.classList.add('open');
    }
  }

  // Update topbar
  document.getElementById('pageTitle').textContent = cfg.title;
  document.getElementById('pageSubtitle').textContent = cfg.subtitle;

  if (page === 'employees') {
    await loadEmployeesPage();
  } else if (page === 'leaveRecord') {
    await loadLeaveRecordPage();
  } else if (page === 'dailyAbsence') {
    await loadDailyAbsencePage();
  } else {
    loadPlaceholderPage(cfg);
  }
}

function refreshCurrentPage() {
  if (currentPage === 'employees') {
    loadEmployeesPage();
  } else if (currentPage === 'leaveRecord') {
    loadLeaveRecordPage();
  } else if (currentPage === 'dailyAbsence') {
    loadDailyAbsencePage();
  } else {
    const cfg = PAGE_CONFIG[currentPage];
    if (cfg) loadPlaceholderPage(cfg);
  }
}

// ===================== PLACEHOLDER PAGE =====================
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

// ===================== EMPLOYEES PAGE =====================
async function loadEmployeesPage() {
  const container = document.getElementById('pageContent');
  container.innerHTML = `<div class="text-center py-5"><div class="spinner" style="margin:0 auto;"></div><p class="mt-3 text-muted">กำลังโหลดข้อมูล...</p></div>`;

  // Load lookup data
  await loadSubdivisions();
  await loadPositions();

  // Count
  const countRes = await window.api.getEmployeeCount();
  let totalCount = 0, activeCount = 0, inactiveCount = 0;
  if (countRes.success) {
    totalCount = countRes.total;
    activeCount = countRes.active;
    inactiveCount = countRes.inactive;
    document.getElementById('sidebarCount').textContent = totalCount;
  }

  // Render page structure
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

async function loadSubdivisions() {
  const res = await window.api.getSubdivisions();
  if (res.success) {
    subdivisions = res.data;
    // Fill modal select
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

async function loadPositions() {
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

async function fetchAndRenderEmployees() {
  const search = document.getElementById('searchInput')?.value || '';
  const status = document.getElementById('filterStatus')?.value || '';
  const subdivision = document.getElementById('filterSubdivision')?.value || '';

  const res = await window.api.getEmployees({ search, status, subdivision });
  const tbody = document.getElementById('empTableBody');

  if (!res.success) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-danger">
      <i class="bi bi-exclamation-triangle me-2"></i>${res.message}</td></tr>`;
    return;
  }

  allEmployees = res.data;
  renderEmployeeTable(allEmployees);
}

function renderEmployeeTable(employees) {
  const tbody = document.getElementById('empTableBody');
  const isAdmin = currentUser && currentUser.role === 'admin';

  document.getElementById('displayCount').textContent = employees.length.toLocaleString();
  document.getElementById('totalRecordCount').textContent = employees.length.toLocaleString();

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
    const statusDot = emp.Emp_Status === 'Activated' ? '●' :
      emp.Emp_Status === 'Terminated' ? '●' : '●';

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
            ${statusDot} ${escHtml(emp.Emp_Status || '-')}
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

function onSearch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(filterEmployees, 350);
}

async function filterEmployees() {
  await fetchAndRenderEmployees();
}


// ===================== TRAINING HISTORY DATATABLE =====================
let _trainingAllRows = [];
let _trainingFiltered = [];
let _trainingPage    = 1;
let _trainingPageSize = 5;
let _trainingSortCol  = -1;
let _trainingSortAsc  = true;

function _trainingFormatD(d) {
  if (!d || d === '0000-00-00') return '-';
  try { return new Date(d).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'}); }
  catch { return d; }
}

function _trainingStateLabel(s) {
  if (s === 'T') return '<span style="background:#dcfce7;color:#166534;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700;">✓ ผ่าน</span>';
  if (s === 'F') return '<span style="background:#fee2e2;color:#991b1b;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700;">✗ ไม่ผ่าน</span>';
  return '<span style="background:#fef9c3;color:#854d0e;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700;">⏳ รอ</span>';
}

function trainingDTRender() {
  const searchVal = (document.getElementById('trDTSearch')?.value || '').toLowerCase();
  // Filter
  _trainingFiltered = _trainingAllRows.filter(r => {
    const str = [r.Courses_ID,r.Courses_Name,r.Plan_StartDate,r.Plan_EndDate,
      r.Plan_Location,r.Plan_Lecturer,r.Plan_Remark,r.Plan_ID,r.his_state].join(' ').toLowerCase();
    return str.includes(searchVal);
  });

  // Sort
  if (_trainingSortCol >= 0) {
    const cols = ['Courses_ID','Courses_Name','Plan_StartDate','Plan_EndDate',
                  'Plan_TimeStart','Plan_TimeEnd','Plan_Hour','Plan_Location',
                  'Plan_Lecturer','Plan_Remark','his_state','Plan_ID'];
    const key = cols[_trainingSortCol];
    _trainingFiltered.sort((a,b) => {
      const av = (a[key]||'').toString().toLowerCase();
      const bv = (b[key]||'').toString().toLowerCase();
      return _trainingSortAsc ? av.localeCompare(bv, 'th') : bv.localeCompare(av, 'th');
    });
  }

  const total    = _trainingFiltered.length;
  const pages    = Math.max(1, Math.ceil(total / _trainingPageSize));
  if (_trainingPage > pages) _trainingPage = pages;
  const start    = (_trainingPage - 1) * _trainingPageSize;
  const pageRows = _trainingFiltered.slice(start, start + _trainingPageSize);

  // TH sort arrows
  const thS = (idx) => {
    let arrow = '';
    if (_trainingSortCol === idx) arrow = _trainingSortAsc ? ' ▲' : ' ▼';
    return `style="padding:10px 12px;text-align:left;font-size:11.5px;font-weight:700;
      color:#334155;white-space:nowrap;border-bottom:2px solid #e2e8f0;
      background:#f1f5f9;cursor:pointer;user-select:none;" 
      onclick="trainingDTSort(${idx})"`;
  };

  const tBodyHtml = pageRows.length === 0
    ? `<tr><td colspan="12" style="text-align:center;padding:32px;color:#94a3b8;font-size:13px;">
        <i class="bi bi-search me-2"></i>ไม่พบข้อมูลที่ค้นหา</td></tr>`
    : pageRows.map((r, i) => {
        const rowNum = start + i + 1;
        const bg = i % 2 === 1 ? '#f8fafc' : '#ffffff';
        return `<tr style="background:${bg};transition:background .15s;" 
          onmouseenter="this.style.background='#eff6ff'" 
          onmouseleave="this.style.background='${bg}'">
          <td style="padding:9px 12px;font-size:12px;color:#94a3b8;text-align:center;font-weight:600;">${rowNum}</td>
          <td style="padding:9px 12px;font-size:11.5px;">
            <span style="background:#dbeafe;color:#1d4ed8;padding:2px 7px;border-radius:5px;font-weight:700;">
              ${escHtml(r.Courses_ID||'-')}
            </span>
          </td>
          <td style="padding:9px 12px;font-size:12.5px;font-weight:500;color:#1e293b;min-width:160px;">${escHtml(r.Courses_Name||'-')}</td>
          <td style="padding:9px 12px;font-size:12px;color:#374151;white-space:nowrap;">${_trainingFormatD(r.Plan_StartDate)}</td>
          <td style="padding:9px 12px;font-size:12px;color:#374151;white-space:nowrap;">${_trainingFormatD(r.Plan_EndDate)}</td>
          <td style="padding:9px 12px;font-size:12px;color:#374151;text-align:center;white-space:nowrap;">${escHtml(r.Plan_TimeStart||'-')}</td>
          <td style="padding:9px 12px;font-size:12px;color:#374151;text-align:center;white-space:nowrap;">${escHtml(r.Plan_TimeEnd||'-')}</td>
          <td style="padding:9px 12px;font-size:12px;color:#374151;text-align:center;">
            ${r.Plan_Hour!=null?`<strong>${r.Plan_Hour}</strong> ชม.`:'-'}
          </td>
          <td style="padding:9px 12px;font-size:12px;color:#374151;min-width:120px;">${escHtml(r.Plan_Location||'-')}</td>
          <td style="padding:9px 12px;font-size:12px;color:#374151;min-width:100px;">${escHtml(r.Plan_Lecturer||'-')}</td>
          <td style="padding:9px 12px;font-size:12px;color:#64748b;min-width:100px;">${escHtml(r.Plan_Remark||'-')}</td>
          <td style="padding:9px 12px;font-size:12px;text-align:center;white-space:nowrap;">${_trainingStateLabel(r.his_state)}</td>
          <td style="padding:9px 12px;font-size:11.5px;">
            <span style="background:#f1f5f9;color:#475569;padding:2px 7px;border-radius:5px;font-size:11px;">
              ${escHtml(r.Plan_ID||'-')}
            </span>
          </td>
        </tr>`;
      }).join('');

  // Pagination buttons
  const paginationHtml = (() => {
    if (pages <= 1) return '';
    let btns = '';
    const maxBtns = 5;
    let startP = Math.max(1, _trainingPage - Math.floor(maxBtns/2));
    let endP   = Math.min(pages, startP + maxBtns - 1);
    if (endP - startP < maxBtns - 1) startP = Math.max(1, endP - maxBtns + 1);

    const btnStyle = (active) => `style="min-width:32px;height:32px;border:1px solid ${active?'#3b82f6':'#e2e8f0'};
      background:${active?'#3b82f6':'#fff'};color:${active?'#fff':'#374151'};border-radius:6px;
      font-size:13px;cursor:${active?'default':'pointer'};font-weight:${active?'700':'400'};
      margin:0 2px;padding:0 6px;transition:all .15s;"`;

    btns += `<button ${btnStyle(false)} ${_trainingPage===1?'disabled style="opacity:.4;cursor:default"':''} 
      onclick="trainingDTGoPage(${_trainingPage-1})">‹</button>`;
    if (startP > 1) { btns += `<button ${btnStyle(false)} onclick="trainingDTGoPage(1)">1</button>`; if(startP>2) btns+='<span style="margin:0 4px;color:#94a3b8">…</span>'; }
    for (let p = startP; p <= endP; p++) {
      btns += `<button ${btnStyle(p===_trainingPage)} onclick="trainingDTGoPage(${p})">${p}</button>`;
    }
    if (endP < pages) { if(endP<pages-1) btns+='<span style="margin:0 4px;color:#94a3b8">…</span>'; btns+=`<button ${btnStyle(false)} onclick="trainingDTGoPage(${pages})">${pages}</button>`; }
    btns += `<button ${btnStyle(false)} ${_trainingPage===pages?'disabled style="opacity:.4;cursor:default"':''} 
      onclick="trainingDTGoPage(${_trainingPage+1})">›</button>`;
    return btns;
  })();

  const infoStart = total === 0 ? 0 : start + 1;
  const infoEnd   = Math.min(start + _trainingPageSize, total);
  document.getElementById('trDTTableWrap').innerHTML = `
    <table style="width:100%;border-collapse:collapse;min-width:980px;">
      <thead>
        <tr>
          <th style="padding:10px 12px;text-align:center;font-size:11.5px;font-weight:700;color:#334155;
            background:#f1f5f9;border-bottom:2px solid #e2e8f0;white-space:nowrap;">#</th>
          <th ${thS(0)}>รหัสหลักสูตร</th>
          <th ${thS(1)}>ชื่อหลักสูตร</th>
          <th ${thS(2)}>วันที่เริ่ม</th>
          <th ${thS(3)}>วันที่สิ้นสุด</th>
          <th ${thS(4)} style="text-align:center;">เวลาเริ่ม</th>
          <th ${thS(5)} style="text-align:center;">เวลาสิ้นสุด</th>
          <th ${thS(6)} style="text-align:center;">ชั่วโมง</th>
          <th ${thS(7)}>สถานที่</th>
          <th ${thS(8)}>วิทยากร</th>
          <th ${thS(9)}>หมายเหตุ</th>
          <th ${thS(10)} style="text-align:center;">สถานะ</th>
          <th ${thS(11)}>Plan_ID</th>
        </tr>
      </thead>
      <tbody>${tBodyHtml}</tbody>
    </table>`;

  document.getElementById('trDTInfo').textContent =
    `แสดง ${infoStart}–${infoEnd} จาก ${total} รายการ${searchVal ? ' (กรอง)' : ''}`;
  document.getElementById('trDTPaging').innerHTML = paginationHtml;
}

function trainingDTGoPage(p) {
  _trainingPage = p;
  trainingDTRender();
}

function trainingDTSort(col) {
  if (_trainingSortCol === col) _trainingSortAsc = !_trainingSortAsc;
  else { _trainingSortCol = col; _trainingSortAsc = true; }
  trainingDTRender();
}

function trainingDTSetPageSize(n) {
  _trainingPageSize = parseInt(n) || 5;
  _trainingPage = 1;
  trainingDTRender();
}

function trainingDTSearch() {
  _trainingPage = 1;
  trainingDTRender();
}

async function openTrainingHistory(empId, fullname) {
  let overlay = document.getElementById('trainingHistoryOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'trainingHistoryOverlay';
    overlay.style.cssText = `
      position:fixed;top:0;left:0;right:0;bottom:0;
      background:rgba(15,23,42,0.65);backdrop-filter:blur(5px);
      z-index:9000;display:flex;align-items:flex-start;justify-content:center;
      padding:20px 12px;overflow-y:auto;
    `;
    overlay.onclick = (e) => { if(e.target===overlay) closeTrainingHistory(); };
    document.body.appendChild(overlay);
  }

  // Reset state
  _trainingAllRows = []; _trainingFiltered = [];
  _trainingPage = 1; _trainingPageSize = 5;
  _trainingSortCol = -1; _trainingSortAsc = true;

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;width:100%;max-width:1200px;
      box-shadow:0 30px 70px rgba(0,0,0,0.35);overflow:hidden;margin:auto;">
      <!-- HEADER -->
      <div style="background:linear-gradient(135deg,#1e40af 0%,#3b82f6 100%);padding:18px 24px;
        display:flex;align-items:center;gap:14px;">
        <div style="width:44px;height:44px;background:rgba(255,255,255,0.18);border-radius:12px;
          display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <i class="bi bi-journal-bookmark-fill" style="font-size:20px;color:#fff;"></i>
        </div>
        <div style="flex:1;">
          <div style="font-size:17px;font-weight:700;color:#fff;">ประวัติการอบรม</div>
          <div style="font-size:12px;color:rgba(255,255,255,0.8);margin-top:2px;">
            รหัส: <strong>${escHtml(empId)}</strong> &nbsp;•&nbsp; ${escHtml(fullname)}
          </div>
        </div>
        <button onclick="closeTrainingHistory()"
          style="background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);
            border-radius:8px;width:34px;height:34px;color:#fff;cursor:pointer;font-size:16px;
            display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
      <!-- BODY -->
      <div id="trainingHistoryBody" style="padding:40px 20px;text-align:center;">
        <div class="spinner" style="margin:0 auto 14px;"></div>
        <div style="color:#64748b;font-size:13px;">กำลังโหลดข้อมูลการอบรม...</div>
      </div>
    </div>`;

  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  const res = await window.api.getEmployeeTraining(empId);
  const body = document.getElementById('trainingHistoryBody');

  if (!res.success) {
    body.innerHTML = `<div style="color:#ef4444;padding:20px;text-align:center;">
      <i class="bi bi-exclamation-triangle" style="font-size:28px;display:block;margin-bottom:8px;"></i>
      เกิดข้อผิดพลาด: ${escHtml(res.message)}</div>`;
    return;
  }

  _trainingAllRows = res.data;
  const totalHours  = _trainingAllRows.reduce((s,r)=>(s+(parseFloat(r.Plan_Hour)||0)),0);
  const passedCount = _trainingAllRows.filter(r=>r.his_state==='T').length;

  if (_trainingAllRows.length === 0) {
    body.innerHTML = `
      <div style="padding:52px 20px;text-align:center;">
        <div style="width:70px;height:70px;background:#f1f5f9;border-radius:50%;
          margin:0 auto 14px;display:flex;align-items:center;justify-content:center;">
          <i class="bi bi-journal-x" style="font-size:30px;color:#94a3b8;"></i>
        </div>
        <div style="font-size:16px;font-weight:600;color:#475569;">ไม่พบประวัติการอบรม</div>
        <div style="font-size:13px;color:#94a3b8;margin-top:6px;">
          พนักงานรายนี้ยังไม่มีข้อมูลการอบรมในระบบ
        </div>
      </div>`;
    return;
  }

  body.style.padding = '0';
  body.innerHTML = `
    <div style="padding:18px 20px 20px;">
      <!-- SUMMARY CARDS -->
      <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;">
        <div style="flex:1;min-width:140px;background:#eff6ff;border:1px solid #bfdbfe;
          border-radius:10px;padding:12px 16px;display:flex;align-items:center;gap:10px;">
          <i class="bi bi-mortarboard-fill" style="color:#3b82f6;font-size:22px;flex-shrink:0;"></i>
          <div><div style="font-size:24px;font-weight:800;color:#1d4ed8;">${_trainingAllRows.length}</div>
          <div style="font-size:11px;color:#64748b;font-weight:500;">หลักสูตรทั้งหมด</div></div>
        </div>
        <div style="flex:1;min-width:140px;background:#f0fdf4;border:1px solid #bbf7d0;
          border-radius:10px;padding:12px 16px;display:flex;align-items:center;gap:10px;">
          <i class="bi bi-patch-check-fill" style="color:#16a34a;font-size:22px;flex-shrink:0;"></i>
          <div><div style="font-size:24px;font-weight:800;color:#15803d;">${passedCount}</div>
          <div style="font-size:11px;color:#64748b;font-weight:500;">ผ่านการอบรม</div></div>
        </div>
        <div style="flex:1;min-width:140px;background:#fffbeb;border:1px solid #fde68a;
          border-radius:10px;padding:12px 16px;display:flex;align-items:center;gap:10px;">
          <i class="bi bi-clock-history" style="color:#d97706;font-size:22px;flex-shrink:0;"></i>
          <div><div style="font-size:24px;font-weight:800;color:#b45309;">${totalHours.toFixed(0)}</div>
          <div style="font-size:11px;color:#64748b;font-weight:500;">ชั่วโมงรวม</div></div>
        </div>
        <div style="flex:1;min-width:140px;background:#fdf4ff;border:1px solid #e9d5ff;
          border-radius:10px;padding:12px 16px;display:flex;align-items:center;gap:10px;">
          <i class="bi bi-percent" style="color:#7c3aed;font-size:22px;flex-shrink:0;"></i>
          <div><div style="font-size:24px;font-weight:800;color:#6d28d9;">
            ${_trainingAllRows.length>0?Math.round(passedCount/_trainingAllRows.length*100):0}%
          </div>
          <div style="font-size:11px;color:#64748b;font-weight:500;">อัตราผ่าน</div></div>
        </div>
      </div>

      <!-- DATATABLE TOOLBAR -->
      <div style="display:flex;align-items:center;justify-content:space-between;
        gap:10px;margin-bottom:10px;flex-wrap:wrap;">
        <!-- Left: rows per page -->
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:12.5px;color:#64748b;white-space:nowrap;">แสดงทีละ</span>
          <select id="trDTPageSizeSelect" onchange="trainingDTSetPageSize(this.value)"
            style="border:1px solid #e2e8f0;border-radius:7px;padding:5px 10px;font-size:13px;
              background:#f8fafc;color:#374151;cursor:pointer;outline:none;">
            <option value="5" selected>5</option>
            <option value="10">10</option>
            <option value="15">15</option>
            <option value="20">20</option>
            <option value="25">25</option>
          </select>
          <span style="font-size:12.5px;color:#64748b;white-space:nowrap;">รายการ</span>
        </div>
        <!-- Right: search -->
        <div style="display:flex;align-items:center;gap:6px;background:#f8fafc;
          border:1px solid #e2e8f0;border-radius:8px;padding:5px 12px;min-width:200px;">
          <i class="bi bi-search" style="color:#94a3b8;font-size:13px;"></i>
          <input id="trDTSearch" type="text" placeholder="ค้นหาในตาราง..."
            oninput="trainingDTSearch()"
            style="border:none;background:transparent;outline:none;font-size:13px;
              color:#374151;width:100%;"/>
        </div>
      </div>

      <!-- TABLE WRAPPER (responsive) -->
      <div style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
        <div id="trDTTableWrap" style="overflow-x:auto;"></div>
      </div>

      <!-- DATATABLE FOOTER -->
      <div style="display:flex;align-items:center;justify-content:space-between;
        margin-top:12px;flex-wrap:wrap;gap:8px;">
        <div id="trDTInfo" style="font-size:12.5px;color:#64748b;"></div>
        <div id="trDTPaging" style="display:flex;align-items:center;flex-wrap:wrap;gap:2px;"></div>
      </div>

      <!-- CLOSE BUTTON -->
      <div style="margin-top:16px;display:flex;justify-content:flex-end;">
        <button onclick="closeTrainingHistory()"
          style="background:#1e40af;color:#fff;border:none;border-radius:8px;
            padding:8px 22px;font-size:13.5px;font-weight:600;cursor:pointer;
            display:flex;align-items:center;gap:6px;">
          <i class="bi bi-x-circle"></i> ปิด
        </button>
      </div>
    </div>`;

  // Initial render
  trainingDTRender();
}

function closeTrainingHistory() {
  const overlay = document.getElementById('trainingHistoryOverlay');
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
}


// ===================== ADD / EDIT EMPLOYEE =====================

async function openAddEmployee() {
  editingEmpId = null;
  document.getElementById('empModalTitle').textContent = 'เพิ่มพนักงานใหม่';
  clearEmpForm();

  // Populate dropdowns
  await populateModalDropdowns();

  showModal('empModal');
}

async function openEditEmployee(empId) {
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
  document.getElementById('fEmpID').disabled = true; // can't change ID
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

async function saveEmployee() {
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

function closeEmpModal() {
  closeModal('empModal');
  editingEmpId = null;
}

// ===================== DELETE EMPLOYEE =====================
function openDeleteEmployee(empId, fullname) {
  deletingEmpId = empId;
  document.getElementById('confirmText').innerHTML =
    `คุณต้องการลบข้อมูลพนักงาน<br/><strong>${escHtml(fullname)}</strong> (${escHtml(empId)}) ?<br/><span style="color:var(--danger);font-size:12.5px;">การดำเนินการนี้ไม่สามารถย้อนกลับได้</span>`;
  showModal('confirmModal');
}

async function executeDelete() {
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

function closeConfirmModal() {
  closeModal('confirmModal');
  deletingEmpId = null;
}

// ===================== MODAL UTILS =====================
function showModal(id) {
  document.getElementById(id).classList.add('show');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('show');
}

// Click outside to close modals
document.addEventListener('click', (e) => {
  ['empModal', 'confirmModal', 'logoutModal', 'leaveModal', 'leaveConfirmModal'].forEach(id => {
    const el = document.getElementById(id);
    if (el && e.target === el) closeModal(id);
  });
});

// ===================== UTILITIES =====================
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(dateStr) {
  if (!dateStr || dateStr === '0000-00-00') return '-';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return '-'; }
}

function formatDateInput(dateStr) {
  if (!dateStr || dateStr === '0000-00-00') return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  } catch { return ''; }
}

// ===================== TOAST =====================
function showToast(msg, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast-item ${type}`;

  const icon = type === 'success' ? 'bi-check-circle-fill' :
    type === 'error' ? 'bi-x-circle-fill' : 'bi-info-circle-fill';

  toast.innerHTML = `
    <i class="bi ${icon} toast-icon"></i>
    <span class="toast-msg">${escHtml(msg)}</span>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(24px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ===================== LEAVE RECORD PAGE =====================

function dbDateToDisplay(d) {
  if (!d || d === '0000/00/00') return '-';
  try {
    const p = d.split('/');
    if (p.length !== 3) return d;
    const dt = new Date(`${p[0]}-${p[1]}-${p[2]}`);
    if (isNaN(dt)) return d;
    return dt.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return d; }
}
function dateInputToDb(v) { return v ? v.replace(/-/g, '/') : ''; }
function dbDateToInput(v) { return v ? v.replace(/\//g, '-') : ''; }
function todayDbFormat() {
  const n = new Date();
  return `${n.getFullYear()}/${String(n.getMonth()+1).padStart(2,'0')}/${String(n.getDate()).padStart(2,'0')}`;
}
function todayInputFormat() { return todayDbFormat().replace(/\//g, '-'); }
function getCommunicateLabel(r) {
  if (r.drp_Communicate && r.drp_Communicate.trim()) return 'โทร';
  if (r.drp_Communicate1 && r.drp_Communicate1.trim()) return 'แจ้งล่วงหน้า';
  return '-';
}

async function loadLeaveRecordPage() {
  const container = document.getElementById('pageContent');
  container.innerHTML = `<div class="text-center py-5"><div class="spinner" style="margin:0 auto;"></div><p class="mt-3 text-muted">กำลังโหลดข้อมูล...</p></div>`;

  const [ltRes, subRes] = await Promise.all([
    window.api.getLeaveTypes(),
    window.api.getSubdivisions()
  ]);
  if (ltRes.success) leaveTypes = ltRes.data;
  if (subRes.success) subdivisions = subRes.data;

  const ltOptions = leaveTypes.map(lt =>
    `<option value="${escHtml(lt.leave_abbreviation)}">${escHtml(lt.leave_abbreviation)} - ${escHtml(lt.leave_name)}</option>`
  ).join('');
  const subOptions = subdivisions.map(s =>
    `<option value="${escHtml(String(s.Sub_ID))}">${escHtml(s.Sub_Name)}</option>`
  ).join('');

  container.innerHTML = `
    <div class="table-section" style="padding:16px 20px;margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <i class="bi bi-calendar-plus" style="font-size:19px;color:var(--primary);"></i>
        <span style="font-size:15px;font-weight:700;color:var(--gray-900);">ประวัติการลางาน</span>
        <div style="flex:1;min-width:8px;"></div>
        <div class="search-box" style="max-width:190px;">
          <i class="bi bi-search"></i>
          <input type="text" class="search-input" id="leaveSearch" placeholder="ค้นหา รหัส / ชื่อ..." oninput="onLeaveSearch()">
        </div>
        <div style="display:flex;align-items:center;gap:5px;">
          <span style="font-size:12px;color:var(--gray-500);white-space:nowrap;">ตั้งแต่</span>
          <input type="date" class="filter-select" id="leaveDateFrom" onchange="applyLeaveFilter()" style="min-width:130px;">
        </div>
        <div style="display:flex;align-items:center;gap:5px;">
          <span style="font-size:12px;color:var(--gray-500);white-space:nowrap;">ถึง</span>
          <input type="date" class="filter-select" id="leaveDateTo" onchange="applyLeaveFilter()" style="min-width:130px;">
        </div>
        <select class="filter-select" id="leaveFilterSub" onchange="applyLeaveFilter()">
          <option value="">ทุกแผนก</option>${subOptions}
        </select>
        <select class="filter-select" id="leaveFilterType" onchange="applyLeaveFilter()">
          <option value="">ทุกประเภทการลา</option>${ltOptions}
        </select>
        <button class="btn-primary-custom" onclick="openLeaveForm(null)">
          <i class="bi bi-plus-circle-fill"></i> บันทึกลางาน
        </button>
      </div>
    </div>

    <div class="table-section">
      <div class="table-header" style="padding:13px 20px;">
        <span class="table-title">รายการบันทึกลางาน</span>
        <span style="margin-left:auto;font-size:12.5px;color:var(--gray-500);">
          แสดง <strong id="leaveDisplayCount">0</strong> จาก <strong id="leaveTotalCount">0</strong> รายการ
        </span>
      </div>
      <div class="table-responsive-custom">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:45px;text-align:center;">#</th>
              <th style="width:80px;">รหัส</th>
              <th style="min-width:150px;">ชื่อ-นามสกุล</th>
              <th style="min-width:110px;">แผนก</th>
              <th style="width:60px;">สังกัด</th>
              <th style="width:135px;">ประเภทการลา</th>
              <th style="width:115px;">การสื่อสาร</th>
              <th style="width:115px;">วันที่ลา</th>
              <th style="width:115px;">ถึงวันที่</th>
              <th style="width:95px;">วันที่บันทึก</th>
              <th>เหตุผล</th>
              <th style="width:78px;text-align:center;">จัดการ</th>
            </tr>
          </thead>
          <tbody id="leaveTableBody">
            <tr class="loading-row"><td colspan="12"><div class="spinner"></div><div>กำลังโหลด...</div></td></tr>
          </tbody>
        </table>
      </div>
      <div class="table-footer" style="justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <div class="record-count">หน้า <span id="leavePageInfo" style="font-weight:700;color:var(--gray-800);">1 / 1</span></div>
        <div id="leavePagination" style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;"></div>
      </div>
    </div>`;

  await fetchAndRenderLeave();
}

async function fetchAndRenderLeave() {
  const tb = document.getElementById('leaveTableBody');
  if (tb) tb.innerHTML = `<tr class="loading-row"><td colspan="12"><div class="spinner"></div><div>กำลังโหลด...</div></td></tr>`;
  const res = await window.api.getDailyReports({});
  if (!res.success) {
    if (tb) tb.innerHTML = `<tr><td colspan="12" class="text-center py-4" style="color:var(--danger);">เกิดข้อผิดพลาด: ${escHtml(res.message)}</td></tr>`;
    return;
  }
  allLeaveRecords = res.data;
  leaveCurrentPage = 1;
  applyLeaveFilter();
}

function applyLeaveFilter() {
  const search = (document.getElementById('leaveSearch')?.value || '').toLowerCase();
  const dateFrom = document.getElementById('leaveDateFrom')?.value || '';
  const dateTo   = document.getElementById('leaveDateTo')?.value   || '';
  const sub      = document.getElementById('leaveFilterSub')?.value  || '';
  const ltype    = document.getElementById('leaveFilterType')?.value || '';

  filteredLeaveRecords = allLeaveRecords.filter(r => {
    if (search) {
      const hay = [(r.drp_empID||''),(r.Emp_Firstname||''),(r.Emp_Lastname||''),(r.Fullname||'')].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (dateFrom && (r.drp_Sdate||'') < dateFrom.replace(/-/g,'/')) return false;
    if (dateTo   && (r.drp_Sdate||'') > dateTo.replace(/-/g,'/'))   return false;
    if (sub && String(r.Sub_ID) !== sub) return false;
    if (ltype && r.drp_Type !== ltype) return false;
    return true;
  });
  leaveCurrentPage = 1;
  renderLeaveTable();
}

function onLeaveSearch() {
  clearTimeout(leaveSearchTimeout);
  leaveSearchTimeout = setTimeout(applyLeaveFilter, 300);
}

function renderLeaveTable() {
  const tbody   = document.getElementById('leaveTableBody');
  const totalEl = document.getElementById('leaveTotalCount');
  const dispEl  = document.getElementById('leaveDisplayCount');
  const pageInfo= document.getElementById('leavePageInfo');
  const pagDiv  = document.getElementById('leavePagination');
  if (!tbody) return;

  const total = filteredLeaveRecords.length;
  const totalPages = Math.max(1, Math.ceil(total / LEAVE_PER_PAGE));
  if (leaveCurrentPage > totalPages) leaveCurrentPage = totalPages;
  const start = (leaveCurrentPage - 1) * LEAVE_PER_PAGE;
  const pageData = filteredLeaveRecords.slice(start, start + LEAVE_PER_PAGE);

  if (totalEl) totalEl.textContent = total.toLocaleString();
  if (dispEl)  dispEl.textContent  = pageData.length.toLocaleString();
  if (pageInfo) pageInfo.textContent = `${leaveCurrentPage} / ${totalPages}`;

  if (total === 0) {
    tbody.innerHTML = `<tr><td colspan="12"><div class="empty-state"><div class="empty-icon"><i class="bi bi-calendar-x"></i></div><div class="empty-text">ไม่พบข้อมูลการลา</div></div></td></tr>`;
  } else {
    tbody.innerHTML = pageData.map((r, i) => {
      const num  = start + i + 1;
      const comm = getCommunicateLabel(r);
      const ltBadge = r.leave_name
        ? `<span style="background:var(--primary-light);color:var(--primary);padding:2px 8px;border-radius:12px;font-size:11.5px;font-weight:600;">${escHtml(r.drp_Type)} - ${escHtml(r.leave_name)}</span>`
        : `<span style="color:var(--gray-500);">${escHtml(r.drp_Type||'-')}</span>`;
      const commBadge = comm === 'โทร'
        ? `<span style="color:var(--success);font-size:12px;"><i class="bi bi-telephone-fill me-1"></i>โทร</span>`
        : comm === 'แจ้งล่วงหน้า'
        ? `<span style="color:var(--warning);font-size:12px;"><i class="bi bi-bell-fill me-1"></i>แจ้งล่วงหน้า</span>`
        : '<span style="color:var(--gray-400);">-</span>';
      const sdate = r.drp_Sdate ? `${dbDateToDisplay(r.drp_Sdate)}${r.drp_Stime ? ' <span style="color:var(--gray-400);font-size:11px;">'+escHtml(r.drp_Stime)+'</span>' : ''}` : '-';
      const edate = r.drp_Edate ? `${dbDateToDisplay(r.drp_Edate)}${r.drp_Etime ? ' <span style="color:var(--gray-400);font-size:11px;">'+escHtml(r.drp_Etime)+'</span>' : ''}` : '-';
      const remarkTrimmed = (r.drp_Remark||'').replace(/\r\n/g,' ').replace(/\n/g,' ').trim();
      return `<tr>
        <td style="text-align:center;color:var(--gray-400);font-size:12px;">${num}</td>
        <td><span class="emp-id">${escHtml(r.drp_empID||'-')}</span></td>
        <td><span class="emp-name">${escHtml((r.Fullname||'').trim()||'-')}</span></td>
        <td style="font-size:12.5px;">${escHtml(r.Sub_Name||'-')}</td>
        <td><span style="font-size:11.5px;font-weight:600;color:var(--gray-600);">${escHtml(r.drp_status||'-')}</span></td>
        <td>${ltBadge}</td>
        <td>${commBadge}</td>
        <td style="font-size:12px;">${sdate}</td>
        <td style="font-size:12px;">${edate}</td>
        <td style="font-size:12px;">${dbDateToDisplay(r.drp_record)}</td>
        <td style="font-size:12.5px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(remarkTrimmed)}">${escHtml(remarkTrimmed||'-')}</td>
        <td>
          <div class="action-btns" style="justify-content:center;">
            <button class="btn-action edit" title="แก้ไข" onclick="openLeaveForm(${r.drp_id})"><i class="bi bi-pencil-fill"></i></button>
            <button class="btn-action delete" title="ลบ" onclick="confirmDeleteLeave(${r.drp_id},'${escHtml(r.drp_empID||'')}')"><i class="bi bi-trash3-fill"></i></button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  if (pagDiv) {
    if (totalPages <= 1) { pagDiv.innerHTML = ''; return; }
    let btns = '';
    btns += `<button onclick="goLeavePage(${leaveCurrentPage-1})" class="leave-page-btn" ${leaveCurrentPage===1?'disabled':''}>‹ ก่อน</button>`;
    for (let p = 1; p <= totalPages; p++) {
      if (p === 1 || p === totalPages || (p >= leaveCurrentPage-2 && p <= leaveCurrentPage+2)) {
        btns += `<button onclick="goLeavePage(${p})" class="leave-page-btn ${p===leaveCurrentPage?'active':''}">${p}</button>`;
      } else if (p === leaveCurrentPage-3 || p === leaveCurrentPage+3) {
        btns += `<span style="color:var(--gray-400);padding:0 2px;">…</span>`;
      }
    }
    btns += `<button onclick="goLeavePage(${leaveCurrentPage+1})" class="leave-page-btn" ${leaveCurrentPage===totalPages?'disabled':''}>ถัดไป ›</button>`;
    pagDiv.innerHTML = btns;
  }
}

function goLeavePage(p) {
  const maxP = Math.max(1, Math.ceil(filteredLeaveRecords.length / LEAVE_PER_PAGE));
  leaveCurrentPage = Math.min(Math.max(1, p), maxP);
  renderLeaveTable();
  document.getElementById('pageContent')?.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---- Leave Form ----
async function openLeaveForm(id) {
  editingLeaveId = id;
  document.getElementById('leaveModalTitle').textContent = id ? 'แก้ไขข้อมูลการลา' : 'บันทึกลางาน';
  clearLeaveForm();

  const ltSel = document.getElementById('fLeaveType');
  if (ltSel) {
    ltSel.innerHTML = '<option value="">-- เลือกประเภทการลา --</option>' +
      leaveTypes.map(lt => `<option value="${escHtml(lt.leave_abbreviation)}">${escHtml(lt.leave_abbreviation)} - ${escHtml(lt.leave_name)}</option>`).join('');
  }

  // ล็อค/ปลดล็อคฟิลด์รหัสพนักงาน + ปุ่มค้นหา
  const empInput  = document.getElementById('fLeaveEmpID');
  const lookupBtn = document.getElementById('btnLookupEmp');
  const empNotice = document.getElementById('empEditNotice');
  if (id) {
    // โหมดแก้ไข — ล็อครหัสพนักงานห้ามเปลี่ยน
    if (empInput)  { empInput.readOnly = true; empInput.classList.add('leave-readonly'); }
    if (lookupBtn) { lookupBtn.style.display = 'none'; }
    if (empNotice) { empNotice.style.display = 'flex'; }
    const rec = allLeaveRecords.find(r => r.drp_id === id);
    if (rec) fillLeaveForm(rec);
  } else {
    // โหมดเพิ่มใหม่ — ปลดล็อค
    if (empInput)  { empInput.readOnly = false; empInput.classList.remove('leave-readonly'); }
    if (lookupBtn) { lookupBtn.style.display = ''; }
    if (empNotice) { empNotice.style.display = 'none'; }
  }
  showModal('leaveModal');
}

function clearLeaveForm() {
  ['fLeaveEmpID','fLeaveFirstname','fLeaveLastname','fLeaveDept','fLeaveSub'].forEach(f => {
    const el = document.getElementById(f);
    if (el) el.value = '';
  });
  const sname = document.getElementById('fLeaveSname');
  if (sname) sname.value = 'นาย';
  const comm = document.getElementById('fLeaveComm');
  if (comm) comm.value = 'โทร';
  const lt = document.getElementById('fLeaveType');
  if (lt) lt.value = '';
  const base = todayInputFormat();
  const sd = document.getElementById('fLeaveStartDT');
  if (sd) sd.value = `${base}T08:00`;
  const ed = document.getElementById('fLeaveEndDT');
  if (ed) ed.value = `${base}T17:00`;
  document.getElementById('fLeaveRecordDate').value = base;
  const rem = document.getElementById('fLeaveRemark');
  if (rem) rem.value = '';
}

function fillLeaveForm(r) {
  document.getElementById('fLeaveEmpID').value      = r.drp_empID || '';
  document.getElementById('fLeaveSname').value      = r.Emp_Sname || 'นาย';
  document.getElementById('fLeaveFirstname').value  = r.Emp_Firstname || '';
  document.getElementById('fLeaveLastname').value   = r.Emp_Lastname || '';
  document.getElementById('fLeaveDept').value       = r.Sub_Name || '';
  document.getElementById('fLeaveSub').value        = r.drp_status || '';
  document.getElementById('fLeaveType').value       = r.drp_Type || '';
  const comm = getCommunicateLabel(r);
  document.getElementById('fLeaveComm').value = (comm !== '-') ? comm : 'โทร';
  if (r.drp_Sdate) {
    document.getElementById('fLeaveStartDT').value = `${dbDateToInput(r.drp_Sdate)}T${r.drp_Stime||'08:00'}`;
  }
  if (r.drp_Edate) {
    document.getElementById('fLeaveEndDT').value = `${dbDateToInput(r.drp_Edate)}T${r.drp_Etime||'17:00'}`;
  }
  document.getElementById('fLeaveRecordDate').value = dbDateToInput(r.drp_record) || todayInputFormat();
  document.getElementById('fLeaveRemark').value = (r.drp_Remark||'').replace(/\r\n/g,'\n').trim();
}

async function lookupEmployee() {
  const empId = (document.getElementById('fLeaveEmpID')?.value || '').trim();
  if (!empId) { showToast('กรุณากรอกรหัสพนักงานก่อน', 'error'); return; }
  const btn = document.getElementById('btnLookupEmp');
  if (btn) { btn.innerHTML = '<span class="spinner" style="display:inline-block;width:14px;height:14px;margin:0 4px -3px 0;border-width:2px;"></span>'; btn.disabled = true; }
  try {
    const res = await window.api.getEmployeeById(empId);
    if (res.success && res.data) {
      const e = res.data;
      document.getElementById('fLeaveSname').value     = e.Emp_Sname || 'นาย';
      document.getElementById('fLeaveFirstname').value = e.Emp_Firstname || '';
      document.getElementById('fLeaveLastname').value  = e.Emp_Lastname || '';
      document.getElementById('fLeaveDept').value      = e.Sub_Name || '';
      document.getElementById('fLeaveSub').value       = e.Emp_Vsth || '';
    } else {
      showToast('ไม่พบรหัสพนักงานนี้ในระบบ', 'error');
    }
  } catch(err) {
    showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  } finally {
    if (btn) { btn.innerHTML = '<i class="bi bi-search"></i> ค้นหา'; btn.disabled = false; }
  }
}

async function saveLeaveRecord() {
  const empId   = (document.getElementById('fLeaveEmpID')?.value || '').trim();
  const ltype   = document.getElementById('fLeaveType')?.value || '';
  const startDT = document.getElementById('fLeaveStartDT')?.value || '';
  const endDT   = document.getElementById('fLeaveEndDT')?.value   || '';
  const recDate = document.getElementById('fLeaveRecordDate')?.value || todayInputFormat();
  const comm    = document.getElementById('fLeaveComm')?.value || 'โทร';
  const sub     = document.getElementById('fLeaveSub')?.value || '';
  const remark  = document.getElementById('fLeaveRemark')?.value || '';

  if (!empId)  { showToast('กรุณากรอกรหัสพนักงาน', 'error'); return; }
  if (!ltype)  { showToast('กรุณาเลือกประเภทการลา', 'error'); return; }
  if (!startDT){ showToast('กรุณาเลือกวันที่ลา', 'error'); return; }
  if (!endDT)  { showToast('กรุณาเลือกวันที่สิ้นสุด', 'error'); return; }

  const d = {
    drp_empID:        empId,
    drp_record:       dateInputToDb(recDate),
    drp_Type:         ltype,
    drp_Communicate:  comm === 'โทร' ? 'ü' : '',
    drp_Communicate1: comm === 'แจ้งล่วงหน้า' ? 'ü' : '',
    drp_Sdate:        dateInputToDb(startDT.split('T')[0]),
    drp_Stime:        (startDT.split('T')[1] || '08:00') + ':00',
    drp_Edate:        dateInputToDb(endDT.split('T')[0]),
    drp_Etime:        (endDT.split('T')[1]   || '17:00') + ':00',
    drp_status:       sub,
    drp_Remark:       remark
  };

  const btn = document.getElementById('btnSaveLeave');
  btn.innerHTML = '<span class="spinner" style="display:inline-block;width:14px;height:14px;margin:0 8px -3px 0;border-width:2px;"></span> กำลังบันทึก...';
  btn.disabled = true;

  let res;
  if (editingLeaveId) { d.drp_id = editingLeaveId; res = await window.api.updateDailyReport(d); }
  else                { res = await window.api.addDailyReport(d); }

  btn.innerHTML = '<i class="bi bi-check2-circle"></i> บันทึก';
  btn.disabled  = false;

  if (res.success) {
    showToast(res.message, 'success');
    closeModal('leaveModal');
    await fetchAndRenderLeave();
  } else {
    showToast(res.message || 'เกิดข้อผิดพลาด', 'error');
  }
}

function closeLeaveModal() { closeModal('leaveModal'); editingLeaveId = null; }

function confirmDeleteLeave(id, empId) {
  deletingLeaveId = id;
  document.getElementById('leaveConfirmText').innerHTML =
    `คุณต้องการลบข้อมูลการลา<br><strong>รหัสพนักงาน: ${escHtml(empId)}</strong> (ID: ${id}) ?<br><span style="color:var(--danger);font-size:12px;">ไม่สามารถย้อนกลับได้</span>`;
  showModal('leaveConfirmModal');
}

async function executeDeleteLeave() {
  if (!deletingLeaveId) return;
  const btn = document.getElementById('btnConfirmDeleteLeave');
  btn.innerHTML = '<span class="spinner" style="display:inline-block;width:14px;height:14px;margin:0 8px -3px 0;border-width:2px;"></span> กำลังลบ...';
  btn.disabled = true;
  const res = await window.api.deleteDailyReport(deletingLeaveId);
  btn.innerHTML = '<i class="bi bi-trash3"></i> ลบข้อมูล';
  btn.disabled  = false;
  if (res.success) {
    showToast(res.message, 'success');
    closeModal('leaveConfirmModal');
    deletingLeaveId = null;
    await fetchAndRenderLeave();
  } else {
    showToast(res.message || 'เกิดข้อผิดพลาด', 'error');
  }
}

// ===================== DAILY ABSENCE REPORT PAGE =====================

async function loadDailyAbsencePage() {
  const container = document.getElementById('pageContent');
  container.innerHTML = `<div class="text-center py-5"><div class="spinner" style="margin:0 auto;"></div><p class="mt-3 text-muted">กำลังโหลด...</p></div>`;

  const today = todayInputFormat();

  container.innerHTML = `
    <!-- Toolbar -->
    <div class="table-section" style="padding:16px 20px;margin-bottom:16px;" id="absenceToolbar">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <i class="bi bi-calendar-x" style="font-size:19px;color:var(--primary);"></i>
        <span style="font-size:15px;font-weight:700;color:var(--gray-900);">รายงานการหยุดงานประจำวัน</span>
        <div style="flex:1;"></div>
        <div style="display:flex;align-items:center;gap:8px;">
          <label style="font-size:13px;font-weight:600;color:var(--gray-700);white-space:nowrap;">เลือกวันที่:</label>
          <input type="date" id="absenceDate" class="filter-select" value="${today}" style="min-width:140px;">
        </div>
        <button class="btn-primary-custom" onclick="loadAbsenceReport()">
          <i class="bi bi-search"></i> แสดงรายงาน
        </button>
        <button class="btn-outline-custom" onclick="printAbsenceReport()" title="พิมพ์รายงาน">
          <i class="bi bi-printer"></i> พิมพ์
        </button>
      </div>
    </div>

    <!-- Report Contents (printable area) -->
    <div id="absenceReportArea">
      <div class="empty-state" style="padding:60px 20px;">
        <div class="empty-icon"><i class="bi bi-calendar-x"></i></div>
        <div class="empty-text">เลือกวันที่แล้วกด "แสดงรายงาน"</div>
      </div>
    </div>`;

  // Auto-load today's report
  await loadAbsenceReport();
}

async function loadAbsenceReport() {
  const dateInput = document.getElementById('absenceDate');
  const dateVal = dateInput?.value || todayInputFormat();
  const area = document.getElementById('absenceReportArea');
  if (!area) return;

  area.innerHTML = `<div class="text-center py-5"><div class="spinner" style="margin:0 auto;"></div><p class="mt-3 text-muted">กำลังดึงข้อมูล...</p></div>`;

  const res = await window.api.getDailyReportByDate(dateVal);
  if (!res.success) {
    area.innerHTML = `<div class="empty-state"><div class="empty-icon"><i class="bi bi-exclamation-triangle"></i></div><div class="empty-text" style="color:var(--danger);">เกิดข้อผิดพลาด: ${escHtml(res.message)}</div></div>`;
    return;
  }

  const data = res.data;
  // Group by Emp_Vsth
  const VSTH_ORDER = ['Vel','SK','TBS','CWS'];
  const grouped = {};
  VSTH_ORDER.forEach(v => { grouped[v] = []; });
  data.forEach(r => {
    const vsth = (r.Emp_Vsth || r.drp_status || 'Vel').trim();
    if (!grouped[vsth]) grouped[vsth] = [];
    grouped[vsth].push(r);
  });

  // Thai date display
  const thDate = new Date(dateVal).toLocaleDateString('th-TH', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const totalCount = data.length;
  const velCount   = grouped['Vel'].length;
  const outerCount = totalCount - velCount;

  const vsthColors = { Vel:'#1a56db', SK:'#f59e0b', TBS:'#10b981', CWS:'#8b5cf6' };
  const vsthBg    = { Vel:'#e8f0fe', SK:'#fef3c7', TBS:'#d1fae5', CWS:'#ede9fe' };
  const vsthLabel = { Vel:'Vel (พนักงานบริษัท)', SK:'SK (Outsource)', TBS:'TBS (Outsource)', CWS:'CWS (Outsource)' };

  // Build section table HTML
  function buildTable(rows, vsth, offset=0) {
    if (rows.length === 0) return `<p style="color:var(--gray-400);font-size:13px;padding:8px 0;">— ไม่มีรายการ —</p>`;
    return `
      <table style="width:100%;border-collapse:collapse;font-size:12.5px;">
        <thead>
          <tr style="background:${vsthBg[vsth]||'#f8fafc'};">
            <th style="padding:8px 10px;text-align:center;border:1px solid #e2e8f0;width:38px;">#</th>
            <th style="padding:8px 10px;border:1px solid #e2e8f0;width:75px;">รหัส</th>
            <th style="padding:8px 10px;border:1px solid #e2e8f0;min-width:150px;">ชื่อ-นามสกุล</th>
            <th style="padding:8px 10px;border:1px solid #e2e8f0;min-width:110px;">แผนก</th>
            <th style="padding:8px 10px;border:1px solid #e2e8f0;width:90px;">ประเภทลา</th>
            <th style="padding:8px 10px;border:1px solid #e2e8f0;width:100px;">การสื่อสาร</th>
            <th style="padding:8px 10px;border:1px solid #e2e8f0;width:120px;">วันที่ลา</th>
            <th style="padding:8px 10px;border:1px solid #e2e8f0;">เหตุผล</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r,i) => {
            const comm = getCommunicateLabel(r);
            const remark = (r.drp_Remark||'').replace(/\r\n/g,' ').replace(/\n/g,' ').trim();
            const timeStr = r.drp_Stime ? `${r.drp_Stime}–${r.drp_Etime||'17:00'}` : '';
            return `<tr style="background:${i%2===0?'white':'#f8fafc'};">
              <td style="padding:7px 10px;text-align:center;border:1px solid #e2e8f0;color:#94a3b8;">${offset+i+1}</td>
              <td style="padding:7px 10px;border:1px solid #e2e8f0;font-weight:600;font-size:11.5px;color:#64748b;">${escHtml(r.drp_empID||'-')}</td>
              <td style="padding:7px 10px;border:1px solid #e2e8f0;font-weight:600;">${escHtml((r.Fullname||'').trim()||'-')}</td>
              <td style="padding:7px 10px;border:1px solid #e2e8f0;font-size:12px;">${escHtml(r.Sub_Name||'-')}</td>
              <td style="padding:7px 10px;border:1px solid #e2e8f0;text-align:center;">
                <span style="background:${vsthBg[vsth]||'#f1f5f9'};color:${vsthColors[vsth]||'#1e293b'};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">${escHtml(r.drp_Type||'-')}</span>
              </td>
              <td style="padding:7px 10px;border:1px solid #e2e8f0;font-size:12px;">
                ${comm==='โทร'?'📞 โทร':comm==='แจ้งล่วงหน้า'?'🔔 แจ้งล่วงหน้า':'-'}
              </td>
              <td style="padding:7px 10px;border:1px solid #e2e8f0;font-size:11.5px;">${escHtml(r.drp_Sdate||'')} ${timeStr}</td>
              <td style="padding:7px 10px;border:1px solid #e2e8f0;font-size:12px;max-width:200px;">${escHtml(remark||'-')}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }

  area.innerHTML = `
    <div id="printableArea" style="background:white;border-radius:var(--border-radius);border:1px solid var(--gray-200);padding:28px 32px;box-shadow:var(--shadow-sm);">

      <!-- Report Header -->
      <div style="text-align:center;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid var(--gray-200);">
        <div style="font-size:18px;font-weight:800;color:var(--gray-900);margin-bottom:4px;">
          รายงานการหยุดงานประจำวัน
        </div>
        <div style="font-size:14px;color:var(--gray-600);">วันที่: <strong style="color:var(--primary);">${escHtml(thDate)}</strong></div>
      </div>

      <!-- Stats Cards -->
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:24px;">
        <div style="background:linear-gradient(135deg,#1a56db,#1044b0);color:white;border-radius:10px;padding:14px;text-align:center;">
          <div style="font-size:26px;font-weight:800;">${totalCount}</div>
          <div style="font-size:11.5px;opacity:0.9;margin-top:2px;">รวมทั้งหมด</div>
        </div>
        ${VSTH_ORDER.map(v => `
          <div style="background:${vsthBg[v]};color:${vsthColors[v]};border-radius:10px;padding:14px;text-align:center;border:1.5px solid ${vsthColors[v]}30;">
            <div style="font-size:26px;font-weight:800;">${grouped[v].length}</div>
            <div style="font-size:11.5px;font-weight:600;margin-top:2px;">${v}</div>
          </div>`).join('')}
      </div>

      <!-- GROUP 1: Vel -->
      <div style="margin-bottom:24px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding:10px 14px;background:var(--primary-light);border-radius:8px;border-left:4px solid var(--primary);">
          <i class="bi bi-building" style="color:var(--primary);font-size:16px;"></i>
          <span style="font-size:14px;font-weight:700;color:var(--primary);">กลุ่มที่ 1 — พนักงานบริษัท (Vel)</span>
          <span style="margin-left:auto;background:var(--primary);color:white;padding:2px 12px;border-radius:20px;font-size:12px;font-weight:700;">${velCount} คน</span>
        </div>
        ${buildTable(grouped['Vel'],'Vel')}
      </div>

      <!-- GROUP 2: Outsource -->
      <div style="margin-bottom:24px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding:10px 14px;background:#f3f0ff;border-radius:8px;border-left:4px solid #7c3aed;">
          <i class="bi bi-people" style="color:#7c3aed;font-size:16px;"></i>
          <span style="font-size:14px;font-weight:700;color:#7c3aed;">กลุ่มที่ 2 — พนักงาน Outsource</span>
          <span style="margin-left:auto;background:#7c3aed;color:white;padding:2px 12px;border-radius:20px;font-size:12px;font-weight:700;">${outerCount} คน</span>
        </div>
        ${['SK','TBS','CWS'].map(v => {
          const rows = grouped[v];
          if (rows.length === 0) return '';
          return `<div style="margin-bottom:16px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
              <span style="width:10px;height:10px;border-radius:50%;background:${vsthColors[v]};display:inline-block;"></span>
              <span style="font-size:13px;font-weight:700;color:${vsthColors[v]};">${vsthLabel[v]}</span>
              <span style="font-size:12px;color:var(--gray-500);">(${rows.length} คน)</span>
            </div>
            ${buildTable(rows,v)}
          </div>`;
        }).join('')}
        ${outerCount === 0 ? '<p style="color:var(--gray-400);font-size:13px;padding:8px 0;">— ไม่มีรายการ —</p>' : ''}
      </div>

      <!-- Summary Table -->
      <div style="margin-bottom:28px;">
        <div style="font-size:13px;font-weight:700;color:var(--gray-700);margin-bottom:10px;letter-spacing:0.05em;">
          📊 สรุปจำนวนการลาแยกตามประเภทพนักงาน
        </div>
        <table style="width:280px;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:var(--gray-100);">
              <th style="padding:8px 16px;border:1px solid var(--gray-200);text-align:left;">ประเภทพนักงาน</th>
              <th style="padding:8px 16px;border:1px solid var(--gray-200);text-align:center;">จำนวน (คน)</th>
            </tr>
          </thead>
          <tbody>
            ${VSTH_ORDER.map(v => `
            <tr>
              <td style="padding:7px 16px;border:1px solid var(--gray-200);">
                <span style="display:inline-flex;align-items:center;gap:6px;">
                  <span style="width:8px;height:8px;border-radius:50%;background:${vsthColors[v]};"></span>
                  ${escHtml(vsthLabel[v])}
                </span>
              </td>
              <td style="padding:7px 16px;border:1px solid var(--gray-200);text-align:center;font-weight:700;color:${vsthColors[v]};">${grouped[v].length}</td>
            </tr>`).join('')}
            <tr style="background:var(--gray-50);font-weight:700;">
              <td style="padding:8px 16px;border:1px solid var(--gray-200);">รวมทั้งหมด</td>
              <td style="padding:8px 16px;border:1px solid var(--gray-200);text-align:center;color:var(--primary);font-size:15px;">${totalCount}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Signature Section -->
      <div style="border-top:1px dashed var(--gray-300);padding-top:24px;margin-top:8px;">
        <div style="font-size:13px;font-weight:700;color:var(--gray-700);margin-bottom:16px;">✍️ ลายเซ็นผู้รับรอง</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:32px;">
          ${buildSignatureBlock('sigReportBy','Report by (ผู้รายงาน)')}
          ${buildSignatureBlock('sigApproveBy','Approve by (ผู้อนุมัติ)')}
        </div>
      </div>

    </div>`;

  // Init signature pads after DOM is ready
  setTimeout(() => {
    initSignaturePad('sigReportBy');
    initSignaturePad('sigApproveBy');
  }, 50);
}

function buildSignatureBlock(id, label) {
  return `
    <div>
      <div style="font-size:12.5px;font-weight:600;color:var(--gray-600);margin-bottom:6px;">${escHtml(label)}</div>
      <div style="margin-bottom:8px;">
        <input type="text" id="${id}Name" class="form-control-m" placeholder="ชื่อ-นามสกุล (ไม่บังคับ)"
          style="font-size:13px;padding:7px 12px;"/>
      </div>
      <div style="position:relative;border:1.5px solid var(--gray-200);border-radius:8px;background:#fafafa;overflow:hidden;">
        <canvas id="${id}Canvas" width="280" height="100"
          style="display:block;width:100%;height:100px;cursor:crosshair;touch-action:none;"></canvas>
        <div style="position:absolute;bottom:4px;left:8px;font-size:10px;color:var(--gray-300);pointer-events:none;">วาดลายเซ็น</div>
        <button onclick="clearSignature('${id}Canvas')"
          style="position:absolute;top:4px;right:4px;background:white;border:1px solid var(--gray-200);border-radius:5px;
          padding:2px 7px;font-size:10.5px;color:var(--gray-500);cursor:pointer;font-family:'Sarabun',sans-serif;">
          ล้าง
        </button>
      </div>
    </div>`;
}

function initSignaturePad(id) {
  const canvas = document.getElementById(`${id}Canvas`);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // Set actual resolution
  const rect = canvas.getBoundingClientRect();
  canvas.width  = rect.width  || 280;
  canvas.height = rect.height || 100;

  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth   = 1.8;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';

  let drawing = false, lx = 0, ly = 0;

  function getPos(e) {
    const r = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return [src.clientX - r.left, src.clientY - r.top];
  }

  function startDraw(e) {
    e.preventDefault();
    drawing = true;
    [lx, ly] = getPos(e);
    ctx.beginPath();
    ctx.arc(lx, ly, 0.8, 0, Math.PI*2);
    ctx.fillStyle = '#1e293b';
    ctx.fill();
  }
  function draw(e) {
    if (!drawing) return;
    e.preventDefault();
    const [cx, cy] = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(cx, cy);
    ctx.stroke();
    [lx, ly] = [cx, cy];
  }
  function stopDraw() { drawing = false; }

  canvas.addEventListener('mousedown',  startDraw);
  canvas.addEventListener('mousemove',  draw);
  canvas.addEventListener('mouseup',    stopDraw);
  canvas.addEventListener('mouseleave', stopDraw);
  canvas.addEventListener('touchstart', startDraw, { passive: false });
  canvas.addEventListener('touchmove',  draw,      { passive: false });
  canvas.addEventListener('touchend',   stopDraw);
}

function clearSignature(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

function printAbsenceReport() {
  const toolbar  = document.getElementById('absenceToolbar');
  const printArea = document.getElementById('printableArea');
  if (!printArea) { showToast('ยังไม่มีข้อมูลรายงาน', 'error'); return; }

  // Capture signatures as image data before printing
  const w = window.open('', '_blank');
  const style = `
    <style>
      * { box-sizing:border-box; margin:0; padding:0; }
      body { font-family: 'Sarabun', sans-serif; font-size:12.5px; color:#1e293b; padding:24px; }
      table { width:100%; border-collapse:collapse; }
      th,td { border:1px solid #e2e8f0; padding:6px 10px; }
      th { background:#f8fafc; font-weight:700; }
      @media print { body { padding:0; } }
    </style>
    <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">`;

  // Replace canvas with img for printing
  const clone = printArea.cloneNode(true);
  clone.querySelectorAll('canvas').forEach(c => {
    const orig = document.getElementById(c.id);
    const img = document.createElement('img');
    img.src = orig?.toDataURL('image/png') || '';
    img.style.cssText = 'width:100%;height:100px;border:1.5px solid #e2e8f0;border-radius:8px;';
    c.parentNode.replaceChild(img, c);
  });
  // Also remove the "ล้าง" buttons from print
  clone.querySelectorAll('button').forEach(b => b.remove());

  w.document.write(`<!DOCTYPE html><html><head><title>รายงานการหยุดงานประจำวัน</title>${style}</head><body>${clone.innerHTML}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 600);
}

