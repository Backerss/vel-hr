// This file has been integrated into renderer.js — can be deleted.
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
    <!-- Filter Bar -->
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

    <!-- Table -->
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
              <th style="width:130px;">ประเภทการลา</th>
              <th style="width:110px;">การสื่อสาร</th>
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
        <div class="record-count">หน้า <span id="leavePageInfo" style="font-weight:700;">1</span></div>
        <div id="leavePagination" style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;"></div>
      </div>
    </div>`;

  await fetchAndRenderLeave();
}

async function fetchAndRenderLeave() {
  const res = await window.api.getDailyReports({});
  if (!res.success) {
    const tb = document.getElementById('leaveTableBody');
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
  const tbody = document.getElementById('leaveTableBody');
  const totalEl = document.getElementById('leaveTotalCount');
  const dispEl  = document.getElementById('leaveDisplayCount');
  const pageInfo = document.getElementById('leavePageInfo');
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
      const num = start + i + 1;
      const comm = getCommunicateLabel(r);
      const lt = r.leave_name ? `<span style="background:var(--primary-light);color:var(--primary);padding:2px 8px;border-radius:12px;font-size:11.5px;font-weight:600;">${escHtml(r.drp_Type)} - ${escHtml(r.leave_name)}</span>` : escHtml(r.drp_Type||'-');
      const sdate = r.drp_Sdate ? `${dbDateToDisplay(r.drp_Sdate)}${r.drp_Stime ? ' '+escHtml(r.drp_Stime) : ''}` : '-';
      const edate = r.drp_Edate ? `${dbDateToDisplay(r.drp_Edate)}${r.drp_Etime ? ' '+escHtml(r.drp_Etime) : ''}` : '-';
      return `<tr>
        <td style="text-align:center;color:var(--gray-400);font-size:12px;">${num}</td>
        <td><span class="emp-id">${escHtml(r.drp_empID||'-')}</span></td>
        <td><span class="emp-name">${escHtml((r.Fullname||'').trim()||'-')}</span></td>
        <td style="font-size:12.5px;">${escHtml(r.Sub_Name||'-')}</td>
        <td><span style="font-size:11.5px;font-weight:600;color:var(--gray-600);">${escHtml(r.drp_status||'-')}</span></td>
        <td>${lt}</td>
        <td><span style="font-size:12px;">${comm === 'โทร' ? '<i class="bi bi-telephone-fill" style="color:var(--success);margin-right:4px;"></i>โทร' : comm === 'แจ้งล่วงหน้า' ? '<i class="bi bi-bell-fill" style="color:var(--warning);margin-right:4px;"></i>แจ้งล่วงหน้า' : '-'}</span></td>
        <td style="font-size:12px;">${sdate}</td>
        <td style="font-size:12px;">${edate}</td>
        <td style="font-size:12px;">${dbDateToDisplay(r.drp_record)}</td>
        <td style="font-size:12.5px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(r.drp_Remark||'')}">${escHtml(r.drp_Remark||'-')}</td>
        <td>
          <div class="action-btns" style="justify-content:center;">
            <button class="btn-action edit" title="แก้ไข" onclick="openLeaveForm(${r.drp_id})"><i class="bi bi-pencil-fill"></i></button>
            <button class="btn-action delete" title="ลบ" onclick="confirmDeleteLeave(${r.drp_id},'${escHtml(r.drp_empID||'')}')"><i class="bi bi-trash3-fill"></i></button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  // Pagination buttons
  if (pagDiv) {
    let btns = '';
    btns += `<button onclick="goLeavePage(${leaveCurrentPage-1})" style="padding:4px 10px;border:1.5px solid var(--gray-200);background:white;border-radius:6px;cursor:pointer;font-size:12px;" ${leaveCurrentPage===1?'disabled':''}>‹</button>`;
    const range = 2;
    for (let p = 1; p <= totalPages; p++) {
      if (p === 1 || p === totalPages || (p >= leaveCurrentPage - range && p <= leaveCurrentPage + range)) {
        const active = p === leaveCurrentPage;
        btns += `<button onclick="goLeavePage(${p})" style="padding:4px 10px;border:1.5px solid ${active?'var(--primary)':'var(--gray-200)'};background:${active?'var(--primary)':'white'};color:${active?'white':'var(--gray-700)'};border-radius:6px;cursor:pointer;font-size:12px;font-weight:${active?'600':'400'};">${p}</button>`;
      } else if (p === leaveCurrentPage - range - 1 || p === leaveCurrentPage + range + 1) {
        btns += `<span style="padding:4px 6px;font-size:12px;color:var(--gray-400);">…</span>`;
      }
    }
    btns += `<button onclick="goLeavePage(${leaveCurrentPage+1})" style="padding:4px 10px;border:1.5px solid var(--gray-200);background:white;border-radius:6px;cursor:pointer;font-size:12px;" ${leaveCurrentPage===totalPages?'disabled':''}>›</button>`;
    pagDiv.innerHTML = btns;
  }
}

function goLeavePage(p) {
  const total = filteredLeaveRecords.length;
  const maxP  = Math.max(1, Math.ceil(total / LEAVE_PER_PAGE));
  leaveCurrentPage = Math.min(Math.max(1, p), maxP);
  renderLeaveTable();
}

// ===================== LEAVE FORM =====================
async function openLeaveForm(id) {
  editingLeaveId = id;
  const title = document.getElementById('leaveModalTitle');
  if (title) title.textContent = id ? 'แก้ไขข้อมูลการลา' : 'บันทึกลางาน';
  clearLeaveForm();

  // Populate leave type dropdown
  const ltSel = document.getElementById('fLeaveType');
  if (ltSel) {
    ltSel.innerHTML = '<option value="">-- เลือกประเภทการลา --</option>' +
      leaveTypes.map(lt => `<option value="${escHtml(lt.leave_abbreviation)}">${escHtml(lt.leave_abbreviation)} - ${escHtml(lt.leave_name)}</option>`).join('');
  }

  // Set today as record date
  document.getElementById('fLeaveRecordDate').value = todayInputFormat();

  if (id) {
    const rec = allLeaveRecords.find(r => r.drp_id === id);
    if (rec) fillLeaveForm(rec);
  }

  showModal('leaveModal');
}

function clearLeaveForm() {
  ['fLeaveEmpID','fLeaveFirstname','fLeaveLastname','fLeaveDept','fLeaveSub'].forEach(f => {
    const el = document.getElementById(f);
    if (el) { el.value = ''; }
  });
  const sname = document.getElementById('fLeaveSname');
  if (sname) sname.value = 'นาย';
  const comm = document.getElementById('fLeaveComm');
  if (comm) comm.value = 'โทร';
  const lt = document.getElementById('fLeaveType');
  if (lt) lt.value = '';
  const sd = document.getElementById('fLeaveStartDT');
  if (sd) {
    // Default = today 08:00
    const base = todayInputFormat();
    sd.value = `${base}T08:00`;
  }
  const ed = document.getElementById('fLeaveEndDT');
  if (ed) {
    const base = todayInputFormat();
    ed.value = `${base}T17:00`;
  }
  document.getElementById('fLeaveRecordDate').value = todayInputFormat();
  const rem = document.getElementById('fLeaveRemark');
  if (rem) rem.value = '';
}

function fillLeaveForm(r) {
  document.getElementById('fLeaveEmpID').value = r.drp_empID || '';
  document.getElementById('fLeaveSname').value = r.Emp_Sname || 'นาย';
  document.getElementById('fLeaveFirstname').value = r.Emp_Firstname || '';
  document.getElementById('fLeaveLastname').value = r.Emp_Lastname || '';
  document.getElementById('fLeaveDept').value = r.Sub_Name || '';
  document.getElementById('fLeaveSub').value = r.drp_status || '';
  document.getElementById('fLeaveType').value = r.drp_Type || '';
  const comm = getCommunicateLabel(r);
  document.getElementById('fLeaveComm').value = comm !== '-' ? comm : 'โทร';
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
  if (!empId) return;
  const btn = document.getElementById('btnLookupEmp');
  if (btn) { btn.innerHTML = '<span class="spinner" style="display:inline-block;width:14px;height:14px;margin:0 4px -3px 0;border-width:2px;"></span>'; btn.disabled = true; }
  try {
    const res = await window.api.getEmployeeById(empId);
    if (res.success && res.data) {
      const e = res.data;
      document.getElementById('fLeaveSname').value = e.Emp_Sname || 'นาย';
      document.getElementById('fLeaveFirstname').value = e.Emp_Firstname || '';
      document.getElementById('fLeaveLastname').value = e.Emp_Lastname || '';
      // Sub_Name comes from JOIN in get-employee-by-id
      document.getElementById('fLeaveDept').value = e.Sub_Name || '';
      document.getElementById('fLeaveSub').value = e.Emp_Vsth || '';
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
  const empId = (document.getElementById('fLeaveEmpID')?.value || '').trim();
  const ltype  = document.getElementById('fLeaveType')?.value || '';
  const startDT = document.getElementById('fLeaveStartDT')?.value || '';
  const endDT   = document.getElementById('fLeaveEndDT')?.value   || '';
  const recDate = document.getElementById('fLeaveRecordDate')?.value || todayInputFormat();
  const comm    = document.getElementById('fLeaveComm')?.value || 'โทร';
  const sub     = document.getElementById('fLeaveSub')?.value || '';
  const remark  = document.getElementById('fLeaveRemark')?.value || '';

  if (!empId)  { showToast('กรุณากรอกรหัสพนักงาน', 'error'); return; }
  if (!ltype)  { showToast('กรุณาเลือกประเภทการลา', 'error'); return; }
  if (!startDT){ showToast('กรุณาเลือกวันที่ลา', 'error'); return; }
  if (!endDT)  { showToast('กรุณาเลือกวันที่สิ้นสุดการลา', 'error'); return; }

  const d = {
    drp_empID:       empId,
    drp_record:      dateInputToDb(recDate),
    drp_Type:        ltype,
    drp_Communicate: comm === 'โทร' ? 'ü' : '',
    drp_Communicate1:comm === 'แจ้งล่วงหน้า' ? 'ü' : '',
    drp_Sdate:       dateInputToDb(startDT.split('T')[0]),
    drp_Stime:       (startDT.split('T')[1] || '08:00') + ':00',
    drp_Edate:       dateInputToDb(endDT.split('T')[0]),
    drp_Etime:       (endDT.split('T')[1]   || '17:00') + ':00',
    drp_status:      sub,
    drp_Remark:      remark
  };

  const btn = document.getElementById('btnSaveLeave');
  btn.innerHTML = '<span class="spinner" style="display:inline-block;width:14px;height:14px;margin:0 8px -3px 0;border-width:2px;"></span> กำลังบันทึก...';
  btn.disabled = true;

  let res;
  if (editingLeaveId) {
    d.drp_id = editingLeaveId;
    res = await window.api.updateDailyReport(d);
  } else {
    res = await window.api.addDailyReport(d);
  }

  btn.innerHTML = '<i class="bi bi-check2-circle"></i> บันทึก';
  btn.disabled = false;

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
  const txt = document.getElementById('leaveConfirmText');
  if (txt) txt.innerHTML = `คุณต้องการลบข้อมูลการลา<br><strong>รหัส: ${escHtml(empId)}</strong> (ID: ${id}) ?<br><span style="color:var(--danger);font-size:12px;">การดำเนินการนี้ไม่สามารถย้อนกลับได้</span>`;
  showModal('leaveConfirmModal');
}

async function executeDeleteLeave() {
  if (!deletingLeaveId) return;
  const btn = document.getElementById('btnConfirmDeleteLeave');
  btn.innerHTML = '<span class="spinner" style="display:inline-block;width:14px;height:14px;margin:0 8px -3px 0;border-width:2px;"></span> กำลังลบ...';
  btn.disabled = true;

  const res = await window.api.deleteDailyReport(deletingLeaveId);

  btn.innerHTML = '<i class="bi bi-trash3"></i> ลบข้อมูล';
  btn.disabled = false;

  if (res.success) {
    showToast(res.message, 'success');
    closeModal('leaveConfirmModal');
    deletingLeaveId = null;
    await fetchAndRenderLeave();
  } else {
    showToast(res.message || 'เกิดข้อผิดพลาด', 'error');
  }
}
