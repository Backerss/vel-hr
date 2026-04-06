// ===================== LEAVE RECORD & DAILY ABSENCE =====================
import {
  escHtml, showToast, showModal, closeModal, requirePasswordConfirm,
  displayDateToDbSlash, isoDateToDisplayDate, todayDisplayDate, displayDateToIso
} from './utils.js';
import { initAllThaiDatePickers } from './thai-datepicker.js';
import { currentUser } from './auth.js';

export let leaveTypes = [];
export let allLeaveRecords = [];
export let filteredLeaveRecords = [];
let editingLeaveId = null;
let deletingLeaveId = null;
let leaveCurrentPage = 1;
const LEAVE_PER_PAGE = 50;
let leaveSearchTimeout = null;
let currentAbsenceDate = '';
let currentAbsenceData = [];

// ---- Date helpers ----
export function dbDateToDisplay(d) {
  if (!d || d === '0000/00/00') return '-';
  try {
    const p = d.split('/');
    if (p.length !== 3) return d;
    const dt = new Date(`${p[0]}-${p[1]}-${p[2]}`);
    if (isNaN(dt)) return d;
    return dt.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return d; }
}
export function dateInputToDb(v) { return displayDateToDbSlash(v); }
export function dbDateToInput(v) { return isoDateToDisplayDate(v); }
export function todayDbFormat() {
  const n = new Date();
  return `${n.getFullYear()}/${String(n.getMonth()+1).padStart(2,'0')}/${String(n.getDate()).padStart(2,'0')}`;
}
export function todayInputFormat() { return todayDisplayDate(); }
export function getCommunicateLabel(r) {
  if (r.drp_Communicate && r.drp_Communicate.trim()) return 'โทร';
  if (r.drp_Communicate1 && r.drp_Communicate1.trim()) return 'แจ้งล่วงหน้า';
  return '-';
}

// ===================== LEAVE RECORD PAGE =====================
export async function loadLeaveRecordPage() {
  const container = document.getElementById('pageContent');
  container.innerHTML = `<div class="text-center py-5"><div class="spinner" style="margin:0 auto;"></div><p class="mt-3 text-muted">กำลังโหลดข้อมูล...</p></div>`;

  const [ltRes, subRes] = await Promise.all([
    window.api.getLeaveTypes(),
    window.api.getSubdivisions()
  ]);
  if (ltRes.success) leaveTypes = ltRes.data;
  let subdivisions = [];
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
          <input type="text" class="filter-select" id="leaveDateFrom" data-tdp
            placeholder="DD/MM/YYYY" maxlength="10" inputmode="numeric" autocomplete="off"
            oninput="autoFormatThaiDateField(this)" onblur="formatThaiDateField(this); applyLeaveFilter()" style="min-width:130px;">
        </div>
        <div style="display:flex;align-items:center;gap:5px;">
          <span style="font-size:12px;color:var(--gray-500);white-space:nowrap;">ถึง</span>
          <input type="text" class="filter-select" id="leaveDateTo" data-tdp
            placeholder="DD/MM/YYYY" maxlength="10" inputmode="numeric" autocomplete="off"
            oninput="autoFormatThaiDateField(this)" onblur="formatThaiDateField(this); applyLeaveFilter()" style="min-width:130px;">
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
              <th id="leaveColRemark">เหตุผล</th>
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

  initAllThaiDatePickers();
  await fetchAndRenderLeave();
}

export async function fetchAndRenderLeave() {
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

export function applyLeaveFilter() {
  const search = (document.getElementById('leaveSearch')?.value || '').toLowerCase();
  const dateFromRaw = document.getElementById('leaveDateFrom')?.value || '';
  const dateToRaw   = document.getElementById('leaveDateTo')?.value   || '';
  const dateFrom = displayDateToDbSlash(dateFromRaw) || '';
  const dateTo   = displayDateToDbSlash(dateToRaw) || '';
  const sub      = document.getElementById('leaveFilterSub')?.value  || '';
  const ltype    = document.getElementById('leaveFilterType')?.value || '';

  filteredLeaveRecords = allLeaveRecords.filter(r => {
    if (search) {
      const hay = [(r.drp_empID||''),(r.Emp_Firstname||''),(r.Emp_Lastname||''),(r.Fullname||'')].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (dateFrom && (r.drp_Sdate||'') < dateFrom) return false;
    if (dateTo   && (r.drp_Sdate||'') > dateTo)   return false;
    if (sub && String(r.Sub_ID) !== sub) return false;
    if (ltype && r.drp_Type !== ltype) return false;
    return true;
  });
  leaveCurrentPage = 1;
  renderLeaveTable();
}

export function onLeaveSearch() {
  clearTimeout(leaveSearchTimeout);
  leaveSearchTimeout = setTimeout(applyLeaveFilter, 300);
}

export function renderLeaveTable() {
  const tbody   = document.getElementById('leaveTableBody');
  const totalEl = document.getElementById('leaveTotalCount');
  const dispEl  = document.getElementById('leaveDisplayCount');
  const pageInfo= document.getElementById('leavePageInfo');
  const pagDiv  = document.getElementById('leavePagination');
  if (!tbody) return;

  // ซ่อน/แสดง column เหตุผลตาม role
  const leaveTable = tbody.closest('table');
  if (leaveTable) {
    if (currentUser?.role === 'guest') leaveTable.classList.add('guest-hide-remark');
    else leaveTable.classList.remove('guest-hide-remark');
  }

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
        <td class="leave-remark-cell" style="font-size:12.5px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(remarkTrimmed)}">${escHtml(remarkTrimmed||'-')}</td>
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

export function goLeavePage(p) {
  const maxP = Math.max(1, Math.ceil(filteredLeaveRecords.length / LEAVE_PER_PAGE));
  leaveCurrentPage = Math.min(Math.max(1, p), maxP);
  renderLeaveTable();
  document.getElementById('pageContent')?.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---- Leave Form ----
export async function openLeaveForm(id) {
  editingLeaveId = id;
  document.getElementById('leaveModalTitle').textContent = id ? 'แก้ไขข้อมูลการลา' : 'บันทึกลางาน';
  clearLeaveForm();

  const ltSel = document.getElementById('fLeaveType');
  if (ltSel) {
    ltSel.innerHTML = '<option value="">-- เลือกประเภทการลา --</option>' +
      leaveTypes.map(lt => `<option value="${escHtml(lt.leave_abbreviation)}">${escHtml(lt.leave_abbreviation)} - ${escHtml(lt.leave_name)}</option>`).join('');
  }

  const empInput  = document.getElementById('fLeaveEmpID');
  const lookupBtn = document.getElementById('btnLookupEmp');
  const empNotice = document.getElementById('empEditNotice');
  if (id) {
    if (empInput)  { empInput.readOnly = true; empInput.classList.add('leave-readonly'); }
    if (lookupBtn) { lookupBtn.style.display = 'none'; }
    if (empNotice) { empNotice.style.display = 'flex'; }
    const rec = allLeaveRecords.find(r => r.drp_id === id);
    if (rec) fillLeaveForm(rec);
  } else {
    if (empInput)  { empInput.readOnly = false; empInput.classList.remove('leave-readonly'); }
    if (lookupBtn) { lookupBtn.style.display = ''; }
    if (empNotice) { empNotice.style.display = 'none'; }
  }
  // ซ่อน/แสดง field เหตุผลตาม role
  const remarkRow = document.getElementById('leaveRemarkRow');
  if (remarkRow) remarkRow.style.display = (currentUser?.role === 'guest') ? 'none' : '';

  showModal('leaveModal');
}

export function onLeaveTypeChange() {
  if (currentUser?.role === 'guest') return;
  const sel = document.getElementById('fLeaveType');
  const rem = document.getElementById('fLeaveRemark');
  if (!sel || !rem) return;
  if (sel.value) {
    const lt = leaveTypes.find(t => t.leave_abbreviation === sel.value);
    rem.value = lt ? lt.leave_name : sel.options[sel.selectedIndex]?.text || '';
  }
}

export function onLeaveStartDTChange() {
  const startDateEl = document.getElementById('fLeaveStartDate');
  const endDateEl   = document.getElementById('fLeaveEndDate');
  const endTimeEl   = document.getElementById('fLeaveEndTime');
  if (!startDateEl || !endDateEl || !startDateEl.value) return;
  if (!displayDateToIso(startDateEl.value)) return;
  endDateEl.value = startDateEl.value;
  if (endTimeEl && !endTimeEl.value) endTimeEl.value = '17:00';
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
  const startDate = document.getElementById('fLeaveStartDate');
  if (startDate) startDate.value = base;
  const startTime = document.getElementById('fLeaveStartTime');
  if (startTime) startTime.value = '08:00';
  const endDate = document.getElementById('fLeaveEndDate');
  if (endDate) endDate.value = base;
  const endTime = document.getElementById('fLeaveEndTime');
  if (endTime) endTime.value = '17:00';
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
    document.getElementById('fLeaveStartDate').value = dbDateToInput(r.drp_Sdate);
    document.getElementById('fLeaveStartTime').value = r.drp_Stime || '08:00';
  }
  if (r.drp_Edate) {
    document.getElementById('fLeaveEndDate').value = dbDateToInput(r.drp_Edate);
    document.getElementById('fLeaveEndTime').value = r.drp_Etime || '17:00';
  }
  document.getElementById('fLeaveRecordDate').value = dbDateToInput(r.drp_record) || todayInputFormat();
  document.getElementById('fLeaveRemark').value = (r.drp_Remark||'').replace(/\r\n/g,'\n').trim();
}

export async function lookupEmployee() {
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

export async function saveLeaveRecord() {
  const empId   = (document.getElementById('fLeaveEmpID')?.value || '').trim();
  const ltype   = document.getElementById('fLeaveType')?.value || '';
  const startDate = document.getElementById('fLeaveStartDate')?.value || '';
  const startTime = document.getElementById('fLeaveStartTime')?.value || '';
  const endDate   = document.getElementById('fLeaveEndDate')?.value   || '';
  const endTime   = document.getElementById('fLeaveEndTime')?.value   || '';
  const recDate = document.getElementById('fLeaveRecordDate')?.value || todayInputFormat();
  const comm    = document.getElementById('fLeaveComm')?.value || 'โทร';
  const sub     = document.getElementById('fLeaveSub')?.value || '';
  const remark  = document.getElementById('fLeaveRemark')?.value || '';

  if (!empId)  { showToast('กรุณากรอกรหัสพนักงาน', 'error'); return; }
  if (!ltype)  { showToast('กรุณาเลือกประเภทการลา', 'error'); return; }
  if (!startDate || !startTime) { showToast('กรุณากรอกวันและเวลาเริ่มต้น', 'error'); return; }
  if (!endDate || !endTime)     { showToast('กรุณากรอกวันและเวลาสิ้นสุด', 'error'); return; }

  const recordDateDb = dateInputToDb(recDate);
  const startDateDb = dateInputToDb(startDate);
  const endDateDb = dateInputToDb(endDate);

  if (!recordDateDb) { showToast('วันที่บันทึกไม่ถูกต้อง (ต้องเป็น DD/MM/YYYY)', 'error'); return; }
  if (!startDateDb)  { showToast('วันที่ลาไม่ถูกต้อง (ต้องเป็น DD/MM/YYYY)', 'error'); return; }
  if (!endDateDb)    { showToast('วันที่สิ้นสุดไม่ถูกต้อง (ต้องเป็น DD/MM/YYYY)', 'error'); return; }

  const d = {
    drp_empID:        empId,
    drp_record:       recordDateDb,
    drp_Type:         ltype,
    drp_Communicate:  comm === 'โทร' ? 'ü' : '',
    drp_Communicate1: comm === 'แจ้งล่วงหน้า' ? 'ü' : '',
    drp_Sdate:        startDateDb,
    drp_Stime:        `${startTime}:00`,
    drp_Edate:        endDateDb,
    drp_Etime:        `${endTime}:00`,
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

export function closeLeaveModal() { closeModal('leaveModal'); editingLeaveId = null; }

export function confirmDeleteLeave(id, empId) {
  deletingLeaveId = id;
  document.getElementById('leaveConfirmText').innerHTML =
    `คุณต้องการลบข้อมูลการลา<br><strong>รหัสพนักงาน: ${escHtml(empId)}</strong> (ID: ${id}) ?<br><span style="color:var(--danger);font-size:12px;">ไม่สามารถย้อนกลับได้</span>`;
  showModal('leaveConfirmModal');
}

export async function executeDeleteLeave() {
  if (!deletingLeaveId) return;
  const id = deletingLeaveId;
  closeModal('leaveConfirmModal');
  requirePasswordConfirm(currentUser?.username || '', async () => {
    const res = await window.api.deleteDailyReport(id);
    if (res.success) {
      showToast(res.message, 'success');
      deletingLeaveId = null;
      await fetchAndRenderLeave();
    } else {
      showToast(res.message || 'เกิดข้อผิดพลาด', 'error');
    }
  });
}

// ===================== DAILY ABSENCE REPORT PAGE =====================
export async function loadDailyAbsencePage() {
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
          <input type="text" id="absenceDate" class="filter-select" data-tdp value="${today}"
            placeholder="DD/MM/YYYY" maxlength="10" inputmode="numeric" autocomplete="off"
            oninput="autoFormatThaiDateField(this)" onblur="formatThaiDateField(this)" style="min-width:140px;">
        </div>
        <button class="btn-primary-custom" onclick="loadAbsenceReport()">
          <i class="bi bi-search"></i> แสดงรายงาน
        </button>
        <button class="btn-outline-custom" onclick="printAbsenceReport()" title="ส่งออก Excel">
          <i class="bi bi-file-earmark-excel"></i> Excel
        </button>
      </div>
    </div>

    <!-- Report Contents -->
    <div id="absenceReportArea">
      <div class="empty-state" style="padding:60px 20px;">
        <div class="empty-icon"><i class="bi bi-calendar-x"></i></div>
        <div class="empty-text">เลือกวันที่แล้วกด "แสดงรายงาน"</div>
      </div>
    </div>`;

  initAllThaiDatePickers();
  await loadAbsenceReport();
}

export async function loadAbsenceReport() {
  const dateInput = document.getElementById('absenceDate');
  const dateRaw = dateInput?.value || todayInputFormat();
  const dateVal = displayDateToIso(dateRaw);
  const area = document.getElementById('absenceReportArea');
  if (!area) return;

  if (!dateVal) {
    area.innerHTML = `<div class="empty-state"><div class="empty-icon"><i class="bi bi-exclamation-triangle"></i></div><div class="empty-text" style="color:var(--danger);">โปรดระบุวันที่ในรูปแบบ DD/MM/YYYY</div></div>`;
    return;
  }

  area.innerHTML = `<div class="text-center py-5"><div class="spinner" style="margin:0 auto;"></div><p class="mt-3 text-muted">กำลังดึงข้อมูล...</p></div>`;

  const res = await window.api.getDailyReportByDate(dateVal);
  if (!res.success) {
    area.innerHTML = `<div class="empty-state"><div class="empty-icon"><i class="bi bi-exclamation-triangle"></i></div><div class="empty-text" style="color:var(--danger);">เกิดข้อผิดพลาด: ${escHtml(res.message)}</div></div>`;
    return;
  }

  const data = res.data;
  currentAbsenceDate = dateVal;
  currentAbsenceData = data;
  const VSTH_ORDER = ['Vel','SK','TBS','CWS'];
  const grouped = {};
  VSTH_ORDER.forEach(v => { grouped[v] = []; });
  data.forEach(r => {
    const vsth = (r.Emp_Vsth || r.drp_status || 'Vel').trim();
    if (!grouped[vsth]) grouped[vsth] = [];
    grouped[vsth].push(r);
  });

  const thDate = new Date(`${dateVal}T00:00:00`).toLocaleDateString('th-TH', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const totalCount = data.length;
  const velCount   = grouped['Vel'].length;
  const outerCount = totalCount - velCount;

  const vsthColors = { Vel:'#1a56db', SK:'#f59e0b', TBS:'#10b981', CWS:'#8b5cf6' };
  const vsthBg    = { Vel:'#e8f0fe', SK:'#fef3c7', TBS:'#d1fae5', CWS:'#ede9fe' };
  const vsthLabel = { Vel:'Vel (พนักงานบริษัท)', SK:'SK (Outsource)', TBS:'TBS (Outsource)', CWS:'CWS (Outsource)' };

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
              <td style="padding:7px 10px;border:1px solid #e2e8f0;font-size:11.5px;">${escHtml(dbDateToDisplay(r.drp_Sdate) || '-')} ${timeStr}</td>
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

export function clearSignature(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

export async function printAbsenceReport() {
  if (!currentAbsenceData || currentAbsenceData.length === 0) {
    showToast('ยังไม่มีข้อมูลรายงาน กรุณาเลือกวันที่แล้วกด "แสดงรายงาน" ก่อน', 'error');
    return;
  }
  showToast('กำลังสร้างไฟล์ Excel...', 'info');
  const res = await window.api.exportAbsenceExcel({ date: currentAbsenceDate, data: currentAbsenceData });
  if (res && res.success) {
    showToast('ส่งออก Excel สำเร็จ', 'success');
  } else if (res && res.message && res.message !== 'ยกเลิก') {
    showToast('เกิดข้อผิดพลาด: ' + res.message, 'error');
  }
}
