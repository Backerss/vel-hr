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
let _leaveSearchSuggestTimer = null;
let _leaveSearchSelectedEmpId = null;
let currentAbsenceDate = '';
let currentAbsenceData = [];
const LEAVE_VSTH_OPTIONS = ['VEL', 'SK', 'TBS', 'CWS'];
// ---- Today's Leave (guest-only) ----
let todayLeaveAllData = [];
let todayLeaveFiltered = [];
let todayLeavePage = 1;
const TODAY_LEAVE_PER_PAGE = 20;

// ---- Date helpers ----
export function dbDateToDisplay(d) {
  if (!d || d === '0000/00/00') return '-';
  try {
    const p = d.split('/');
    if (p.length !== 3) return d;
    return `${p[0]}/${p[1].padStart(2,'0')}/${p[2].padStart(2,'0')}`;
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

function getLeaveEmployeeType(record) {
  const rawType = String(record?.Emp_Vsth || record?.drp_status || '').trim().toUpperCase();
  if (LEAVE_VSTH_OPTIONS.includes(rawType)) return rawType;

  const empId = String(record?.drp_empID || '').trim().toUpperCase();
  if (empId.startsWith('SK')) return 'SK';
  if (empId.startsWith('TBS')) return 'TBS';
  if (empId.startsWith('CWS')) return 'CWS';
  return 'VEL';
}

// ---- Guest time-window check ----
function _guestInAllowedWindow() {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  const mins = h * 60 + m;
  return (mins >= 480 && mins < 600) ||  // 08:00 - 10:00
         (mins >= 1200 && mins < 1320);  // 20:00 - 22:00
}

function _guestNextWindowLabel() {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  if (mins < 480)  return 'วันนี้ 08:00 - 10:00 น.';
  if (mins < 1200) return 'วันนี้ 20:00 - 22:00 น.';
  return 'พรุ่งนี้ 08:00 - 10:00 น.';
}

// ===================== LEAVE RECORD PAGE =====================
export async function loadLeaveRecordPage() {
  const container = document.getElementById('pageContent');

  // Guest: enforce time window
  if (currentUser?.role === 'guest' && !_guestInAllowedWindow()) {
    _renderGuestTimeLock(container);
    return;
  }

  container.innerHTML = `<div class="text-center py-5"><div class="spinner" style="margin:0 auto;"></div><p class="mt-3 text-muted">กำลังโหลดข้อมูล...</p></div>`;

  const [ltRes, subRes] = await Promise.all([
    window.api.getLeaveTypes(),
    window.api.getSubdivisions()
  ]);
  if (ltRes.success) leaveTypes = ltRes.data;
  let subdivisions = [];
  if (subRes.success) subdivisions = subRes.data;
  const isGuestUser = currentUser?.role === 'guest';

  const ltOptions = leaveTypes.map(lt =>
    `<option value="${escHtml(lt.leave_abbreviation)}">${escHtml(lt.leave_abbreviation)} - ${escHtml(lt.leave_name)}</option>`
  ).join('');
  const subOptions = subdivisions.map(s =>
    `<option value="${escHtml(String(s.Sub_ID))}">${escHtml(s.Sub_Name)}</option>`
  ).join('');
  const vsthOptions = LEAVE_VSTH_OPTIONS.map(v =>
    `<option value="${v}">${v}</option>`
  ).join('');

  container.innerHTML = `
    <div class="table-section" style="padding:16px 20px;margin-bottom:16px;overflow:visible;">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <i class="bi bi-calendar-plus" style="font-size:19px;color:var(--primary);"></i>
        <span style="font-size:15px;font-weight:700;color:var(--gray-900);">ประวัติการลางาน</span>
        <div style="flex:1;min-width:8px;"></div>
        <div class="search-box" style="max-width:280px;min-width:240px;position:relative;">
          <i class="bi bi-search"></i>
          <input type="text" class="search-input" id="leaveSearch" placeholder="ค้นหา รหัส / ชื่อ..." oninput="onLeaveSearch()" onfocus="onLeaveSearch()" onblur="setTimeout(()=>{const b=document.getElementById('leaveSearchSuggestBox');if(b)b.style.display='none';},150)" autocomplete="off">
          <div id="leaveSearchSuggestBox" style="display:none;position:absolute;top:100%;left:0;min-width:340px;z-index:100;background:var(--gray-100);border:1.5px solid var(--gray-200);border-radius:10px;margin-top:4px;max-height:260px;overflow-y:auto;box-shadow:var(--shadow-md,0 4px 12px rgba(0,0,0,.12));"></div>
        </div>
        <div style="display:flex;align-items:center;gap:5px;">
          <span style="font-size:12px;color:var(--gray-500);white-space:nowrap;">วันที่ลา ตั้งแต่</span>
          <input type="text" class="filter-select" id="leaveDateFrom" data-tdp
            placeholder="YYYY/MM/DD" maxlength="10" inputmode="numeric" autocomplete="off"
            oninput="autoFormatThaiDateField(this)" onblur="formatThaiDateField(this); applyLeaveFilter()" style="min-width:130px;">
        </div>
        <div style="display:flex;align-items:center;gap:5px;">
          <span style="font-size:12px;color:var(--gray-500);white-space:nowrap;">ถึง</span>
          <input type="text" class="filter-select" id="leaveDateTo" data-tdp
            placeholder="YYYY/MM/DD" maxlength="10" inputmode="numeric" autocomplete="off"
            oninput="autoFormatThaiDateField(this)" onblur="formatThaiDateField(this); applyLeaveFilter()" style="min-width:130px;">
        </div>
        <select class="filter-select" id="leaveFilterSub" onchange="applyLeaveFilter()">
          <option value="">ทุกแผนก</option>${subOptions}
        </select>
        <select class="filter-select" id="leaveFilterVsth" onchange="applyLeaveFilter()">
          <option value="">ทุกประเภทพนักงาน</option>${vsthOptions}
        </select>
        <select class="filter-select" id="leaveFilterType" onchange="applyLeaveFilter()">
          <option value="">ทุกประเภทการลา</option>${ltOptions}
        </select>
        <button class="btn-primary-custom" onclick="openLeaveForm(null)">
          <i class="bi bi-plus-circle-fill"></i> บันทึกลางาน
        </button>
      </div>
    </div>

    ${isGuestUser ? `
    <div id="todayLeaveSection">
      <div class="table-section" style="padding:16px 20px;margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <i class="bi bi-person-check-fill" style="font-size:19px;color:var(--success);"></i>
          <span style="font-size:15px;font-weight:700;color:var(--gray-900);">วันนี้มีใครลาบ้าง</span>
          <span id="todayLeaveDate" style="font-size:13px;color:var(--gray-500);"></span>
          <div style="flex:1;min-width:8px;"></div>
          <div class="search-box" style="max-width:190px;">
            <i class="bi bi-search"></i>
            <input type="text" class="search-input" id="todayLeaveSearch"
              placeholder="ค้นหา รหัส / ชื่อ..." oninput="applyTodayLeaveFilter()">
          </div>
          <select class="filter-select" id="todayLeaveFilterSub" onchange="applyTodayLeaveFilter()">
            <option value="">ทุกแผนก</option>
          </select>
          <select class="filter-select" id="todayLeaveFilterPos" onchange="applyTodayLeaveFilter()">
            <option value="">ทุกตำแหน่ง</option>
          </select>
        </div>
      </div>
      <div class="table-section" style="margin-bottom:16px;">
        <div class="table-header" style="padding:13px 20px;">
          <span class="table-title" style="color:var(--success);"><i class="bi bi-calendar-check" style="margin-right:6px;"></i>รายชื่อผู้ลาวันนี้</span>
          <span style="margin-left:auto;font-size:12.5px;color:var(--gray-500);">แสดง <strong id="todayLeaveDisplayCount">0</strong> จาก <strong id="todayLeaveTotalCount">0</strong> คน</span>
        </div>
        <div class="table-responsive-custom">
          <table class="data-table">
            <thead>
              <tr>
                <th style="width:45px;text-align:center;">#</th>
                <th style="width:80px;">รหัส</th>
                <th style="min-width:150px;">ชื่อ-นามสกุล</th>
                <th style="min-width:110px;">แผนก</th>
                <th style="min-width:110px;">ตำแหน่ง</th>
                <th style="width:65px;">สังกัด</th>
                <th style="width:140px;">ประเภทลา</th>
                <th style="width:120px;">วันที่เริ่ม</th>
                <th style="width:120px;">ถึงวันที่</th>
              </tr>
            </thead>
            <tbody id="todayLeaveTableBody">
              <tr class="loading-row"><td colspan="9"><div class="spinner"></div><div>กำลังโหลด...</div></td></tr>
            </tbody>
          </table>
        </div>
        <div class="table-footer" style="justify-content:space-between;flex-wrap:wrap;gap:8px;">
          <div class="record-count">หน้า <span id="todayLeavePageInfo" style="font-weight:700;color:var(--gray-800);">1 / 1</span></div>
          <div id="todayLeavePagination" style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;"></div>
        </div>
      </div>
    </div>
    ` : ''}

    <div id="leaveSummaryPanel" style="display:none;margin-bottom:12px;"></div>

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
  // Set today as default date filter (both from and to)
  const _todayFmt = todayInputFormat();
  const _fromEl = document.getElementById('leaveDateFrom');
  const _toEl   = document.getElementById('leaveDateTo');
  if (_fromEl && !_fromEl.value) _fromEl.value = _todayFmt;
  if (_toEl   && !_toEl.value)   _toEl.value   = _todayFmt;

  await fetchAndRenderLeave();
  if (isGuestUser) loadTodayLeave();
}

// ---- Guest time-lock screen ----
function _renderGuestTimeLock(container) {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;
      gap:16px;padding:32px 20px 24px;text-align:center;">
      <div id="_guestClock" style="font-size:56px;font-weight:700;color:var(--primary);
        letter-spacing:4px;font-variant-numeric:tabular-nums;"></div>
      <div style="font-size:17px;font-weight:700;color:var(--gray-800);">ขณะนี้อยู่นอกเวลาที่เปิดให้บันทึกลางาน</div>
      <div style="background:var(--primary-light);border-radius:14px;padding:16px 28px;max-width:420px;">
        <div style="font-size:13.5px;color:var(--gray-700);line-height:2.1;">
          ⏰ เวลาที่เปิดให้บันทึก:<br>
          <strong>กะแรก &nbsp; 08:00 – 10:00 น.</strong><br>
          <strong>กะสอง &nbsp; 20:00 – 22:00 น.</strong>
        </div>
      </div>
      <div style="font-size:13.5px;color:var(--gray-600);">
        ระบบจะเปิดให้บันทึกอีกครั้ง: <strong id="_guestNext"></strong>
      </div>
      <div style="font-size:13px;color:var(--gray-500);">
        หากพบปัญหาสามารถติดต่อ IT เบอร์ภายใน <strong style="color:var(--primary);">123</strong>
      </div>
    </div>

    <div id="todayLeaveSection" style="padding:0 0 24px;">
      <div class="table-section" style="padding:16px 20px;margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <i class="bi bi-person-check-fill" style="font-size:19px;color:var(--success);"></i>
          <span style="font-size:15px;font-weight:700;color:var(--gray-900);">วันนี้มีใครลาบ้าง</span>
          <span id="todayLeaveDate" style="font-size:13px;color:var(--gray-500);"></span>
          <div style="flex:1;min-width:8px;"></div>
          <div class="search-box" style="max-width:190px;">
            <i class="bi bi-search"></i>
            <input type="text" class="search-input" id="todayLeaveSearch"
              placeholder="ค้นหา รหัส / ชื่อ..." oninput="applyTodayLeaveFilter()">
          </div>
          <select class="filter-select" id="todayLeaveFilterSub" onchange="applyTodayLeaveFilter()">
            <option value="">ทุกแผนก</option>
          </select>
          <select class="filter-select" id="todayLeaveFilterPos" onchange="applyTodayLeaveFilter()">
            <option value="">ทุกตำแหน่ง</option>
          </select>
        </div>
      </div>
      <div class="table-section">
        <div class="table-header" style="padding:13px 20px;">
          <span class="table-title" style="color:var(--success);"><i class="bi bi-calendar-check" style="margin-right:6px;"></i>รายชื่อผู้ลาวันนี้</span>
          <span style="margin-left:auto;font-size:12.5px;color:var(--gray-500);">แสดง <strong id="todayLeaveDisplayCount">0</strong> จาก <strong id="todayLeaveTotalCount">0</strong> คน</span>
        </div>
        <div class="table-responsive-custom">
          <table class="data-table">
            <thead>
              <tr>
                <th style="width:45px;text-align:center;">#</th>
                <th style="width:80px;">รหัส</th>
                <th style="min-width:150px;">ชื่อ-นามสกุล</th>
                <th style="min-width:110px;">แผนก</th>
                <th style="min-width:110px;">ตำแหน่ง</th>
                <th style="width:65px;">สังกัด</th>
                <th style="width:140px;">ประเภทลา</th>
                <th style="width:120px;">วันที่เริ่ม</th>
                <th style="width:120px;">ถึงวันที่</th>
              </tr>
            </thead>
            <tbody id="todayLeaveTableBody">
              <tr class="loading-row"><td colspan="9"><div class="spinner"></div><div>กำลังโหลด...</div></td></tr>
            </tbody>
          </table>
        </div>
        <div class="table-footer" style="justify-content:space-between;flex-wrap:wrap;gap:8px;">
          <div class="record-count">หน้า <span id="todayLeavePageInfo" style="font-weight:700;color:var(--gray-800);">1 / 1</span></div>
          <div id="todayLeavePagination" style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;"></div>
        </div>
      </div>
    </div>`;

  // Auto-refresh to check if the window has opened
  let _clockTick;
  function tick() {
    const now = new Date();
    const hh  = String(now.getHours()).padStart(2, '0');
    const mm  = String(now.getMinutes()).padStart(2, '0');
    const ss  = String(now.getSeconds()).padStart(2, '0');
    const el  = document.getElementById('_guestClock');
    const nx  = document.getElementById('_guestNext');
    if (el) el.textContent = `${hh}:${mm}:${ss}`;
    if (nx) nx.textContent = _guestNextWindowLabel();
    // When window opens, reload the leave page
    if (_guestInAllowedWindow()) {
      clearInterval(_clockTick);
      loadLeaveRecordPage();
    }
  }
  tick();
  _clockTick = setInterval(tick, 1000);
  loadTodayLeave();
}

export async function fetchAndRenderLeave() {
  await applyLeaveFilter();
}

// ---- Today's Leave (guest-only) ----
export async function loadTodayLeave() {
  const tb = document.getElementById('todayLeaveTableBody');
  if (!tb) return;
  tb.innerHTML = `<tr class="loading-row"><td colspan="9"><div class="spinner"></div><div>กำลังโหลด...</div></td></tr>`;
  const dateEl = document.getElementById('todayLeaveDate');
  if (dateEl) {
    const now = new Date();
    const thDate = now.toLocaleDateString('th-TH', { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' });
    dateEl.textContent = `— ${thDate}`;
  }
  const res = await window.api.getTodayOnLeave();
  if (!res.success) {
    tb.innerHTML = `<tr><td colspan="9" class="text-center py-4" style="color:var(--danger);">เกิดข้อผิดพลาด: ${escHtml(res.message || '')}</td></tr>`;
    return;
  }
  todayLeaveAllData = res.data;
  // Populate dynamic filter dropdowns from actual data
  const subSel = document.getElementById('todayLeaveFilterSub');
  const posSel = document.getElementById('todayLeaveFilterPos');
  if (subSel) {
    const subs = [...new Set(todayLeaveAllData.map(r => r.Sub_Name || '').filter(Boolean))].sort();
    subSel.innerHTML = '<option value="">ทุกแผนก</option>' +
      subs.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('');
  }
  if (posSel) {
    const positions = [...new Set(todayLeaveAllData.map(r => r.Position_Name || '').filter(Boolean))].sort();
    posSel.innerHTML = '<option value="">ทุกตำแหน่ง</option>' +
      positions.map(p => `<option value="${escHtml(p)}">${escHtml(p)}</option>`).join('');
  }
  todayLeavePage = 1;
  applyTodayLeaveFilter();
}

export function applyTodayLeaveFilter() {
  const search = (document.getElementById('todayLeaveSearch')?.value || '').toLowerCase().trim();
  const sub    = document.getElementById('todayLeaveFilterSub')?.value || '';
  const pos    = document.getElementById('todayLeaveFilterPos')?.value || '';
  todayLeaveFiltered = todayLeaveAllData.filter(r => {
    if (search) {
      const hay = [(r.drp_empID || ''), (r.Fullname || '')].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (sub && (r.Sub_Name || '') !== sub) return false;
    if (pos && (r.Position_Name || '') !== pos) return false;
    return true;
  });
  todayLeavePage = 1;
  renderTodayLeaveTable();
}

export function renderTodayLeaveTable() {
  const tbody   = document.getElementById('todayLeaveTableBody');
  const totalEl = document.getElementById('todayLeaveTotalCount');
  const dispEl  = document.getElementById('todayLeaveDisplayCount');
  const pageInfo = document.getElementById('todayLeavePageInfo');
  const pagDiv  = document.getElementById('todayLeavePagination');
  if (!tbody) return;
  const total = todayLeaveFiltered.length;
  const totalPages = Math.max(1, Math.ceil(total / TODAY_LEAVE_PER_PAGE));
  if (todayLeavePage > totalPages) todayLeavePage = totalPages;
  const start = (todayLeavePage - 1) * TODAY_LEAVE_PER_PAGE;
  const pageData = todayLeaveFiltered.slice(start, start + TODAY_LEAVE_PER_PAGE);
  if (totalEl) totalEl.textContent = total.toLocaleString();
  if (dispEl)  dispEl.textContent  = pageData.length.toLocaleString();
  if (pageInfo) pageInfo.textContent = `${todayLeavePage} / ${totalPages}`;
  if (total === 0) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-icon"><i class="bi bi-person-check"></i></div><div class="empty-text">ไม่มีพนักงานลาในวันนี้</div></div></td></tr>`;
  } else {
    tbody.innerHTML = pageData.map((r, i) => {
      const num = start + i + 1;
      const ltBadge = r.leave_name
        ? `<span style="background:var(--primary-light);color:var(--primary);padding:2px 8px;border-radius:12px;font-size:11.5px;font-weight:600;">${escHtml(r.drp_Type || '')} - ${escHtml(r.leave_name)}</span>`
        : `<span style="color:var(--gray-500);">${escHtml(r.drp_Type || '-')}</span>`;
      const sdate = r.drp_Sdate ? `${dbDateToDisplay(r.drp_Sdate)}${r.drp_Stime ? ' <span style="color:var(--gray-400);font-size:11px;">' + escHtml(r.drp_Stime) + '</span>' : ''}` : '-';
      const edate = r.drp_Edate ? `${dbDateToDisplay(r.drp_Edate)}${r.drp_Etime ? ' <span style="color:var(--gray-400);font-size:11px;">' + escHtml(r.drp_Etime) + '</span>' : ''}` : '-';
      return `<tr>
        <td style="text-align:center;color:var(--gray-400);font-size:12px;">${num}</td>
        <td><span class="emp-id">${escHtml(r.drp_empID || '-')}</span></td>
        <td><span class="emp-name">${escHtml((r.Fullname || '').trim() || '-')}</span></td>
        <td style="font-size:12.5px;">${escHtml(r.Sub_Name || '-')}</td>
        <td style="font-size:12.5px;">${escHtml(r.Position_Name || '-')}</td>
        <td><span style="font-size:11.5px;font-weight:600;color:var(--gray-600);">${escHtml(r.Emp_Vsth || '-')}</span></td>
        <td>${ltBadge}</td>
        <td style="font-size:12px;">${sdate}</td>
        <td style="font-size:12px;">${edate}</td>
      </tr>`;
    }).join('');
  }
  if (pagDiv) {
    if (totalPages <= 1) { pagDiv.innerHTML = ''; return; }
    let btns = '';
    btns += `<button onclick="goTodayLeavePage(${todayLeavePage - 1})" class="leave-page-btn" ${todayLeavePage === 1 ? 'disabled' : ''}>‹ ก่อน</button>`;
    for (let p = 1; p <= totalPages; p++) {
      if (p === 1 || p === totalPages || (p >= todayLeavePage - 2 && p <= todayLeavePage + 2)) {
        btns += `<button onclick="goTodayLeavePage(${p})" class="leave-page-btn ${p === todayLeavePage ? 'active' : ''}">${p}</button>`;
      } else if (p === todayLeavePage - 3 || p === todayLeavePage + 3) {
        btns += `<span style="color:var(--gray-400);padding:0 2px;">…</span>`;
      }
    }
    btns += `<button onclick="goTodayLeavePage(${todayLeavePage + 1})" class="leave-page-btn" ${todayLeavePage === totalPages ? 'disabled' : ''}>ถัดไป ›</button>`;
    pagDiv.innerHTML = btns;
  }
}

export function goTodayLeavePage(p) {
  const maxP = Math.max(1, Math.ceil(todayLeaveFiltered.length / TODAY_LEAVE_PER_PAGE));
  todayLeavePage = Math.min(Math.max(1, p), maxP);
  renderTodayLeaveTable();
  document.getElementById('todayLeaveSection')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Returns how many minutes of lunch break (12:00–13:00) overlap a time range [startM, endM]
function _lunchOverlapMinutes(startM, endM) {
  const LUNCH_S = 12 * 60; // 720
  const LUNCH_E = 13 * 60; // 780
  return Math.max(0, Math.min(endM, LUNCH_E) - Math.max(startM, LUNCH_S));
}

function _leaveDurationMinutes(r) {
  // Returns net work-minutes for a leave record.
  // Rules: work day 08:00–17:00 (8 hrs), lunch break 12:00–13:00 deducted.
  // Multi-day: first-day partial + middle full days (8 h each) + last-day partial.
  if (!r.drp_Sdate || !r.drp_Edate) return 0;
  const [sy, sm, sd] = r.drp_Sdate.split('/').map(Number);
  const [ey, em, ed] = r.drp_Edate.split('/').map(Number);
  if (!sy || !ey) return 0;
  const sTime  = (r.drp_Stime || '08:00').split(':').map(Number);
  const eTime  = (r.drp_Etime || '17:00').split(':').map(Number);
  const startM = (sTime[0] || 8)  * 60 + (sTime[1] || 0);
  const endM   = (eTime[0] || 17) * 60 + (eTime[1] || 0);
  const WORK_S = 8  * 60; // 480 = 08:00
  const WORK_E = 17 * 60; // 1020 = 17:00

  const startDate = new Date(sy, sm - 1, sd);
  const endDate   = new Date(ey, em - 1, ed);
  const daysDiff  = Math.round((endDate - startDate) / 86400000);
  if (daysDiff < 0) return 0;

  if (daysDiff === 0) {
    // Same day
    const dur = Math.max(0, endM - startM);
    return dur - _lunchOverlapMinutes(startM, endM);
  }

  // First day: startM → WORK_E (17:00), deduct lunch overlap
  let total = Math.max(0, WORK_E - startM) - _lunchOverlapMinutes(startM, WORK_E);
  // Middle full days (each = 8 h = 480 min)
  total += (daysDiff - 1) * 8 * 60;
  // Last day: WORK_S (08:00) → endM, deduct lunch overlap
  total += Math.max(0, endM - WORK_S) - _lunchOverlapMinutes(WORK_S, endM);

  return Math.max(0, total);
}

function _renderLeaveSummary(records, search, filterFrom = '', filterTo = '', yearAllRecords = null) {
  const panel = document.getElementById('leaveSummaryPanel');
  if (!panel) return;
  if (!search || currentUser?.role === 'guest') {
    panel.style.display = 'none';
    panel.innerHTML = '';
    return;
  }

  // Only show summary when all visible records are for same employee
  const empIDs = [...new Set(records.map(r => r.drp_empID).filter(Boolean))];
  if (empIDs.length !== 1) {
    panel.style.display = 'none';
    panel.innerHTML = '';
    return;
  }

  const sample = records.find(r => r.drp_empID === empIDs[0]);
  const sampleName = sample
    ? ((sample.Fullname || '').trim() || (((sample.Emp_Firstname || '') + ' ' + (sample.Emp_Lastname || '')).trim()))
    : '';
  const empName = sampleName || empIDs[0];

  // Year to summarize: use year from filter if provided; otherwise current year.
  const now = new Date();
  const thisYear = now.getFullYear();
  const hasDateFilter = !!(filterFrom || filterTo);
  const pickedYear = Number((filterFrom || filterTo || '').split('/')[0]);
  const displayYear = hasDateFilter && Number.isInteger(pickedYear) ? pickedYear : thisYear;
  const yearPrefix = `${displayYear}/`;

  // 1 day = 8 hours
  const fmtDH = (m) => {
    if (m <= 0) return { day: '0 วัน', hrs: '0 ชม' };
    const h = m / 60;
    const dayRounded = Math.round((h / 8) * 10) / 10;
    const dayStr = dayRounded % 1 === 0 ? `${dayRounded} วัน` : `${dayRounded.toFixed(1)} วัน`;
    return { day: dayStr, hrs: `${h.toFixed(1)} ชม` };
  };

  const sourceRecords = hasDateFilter && Array.isArray(yearAllRecords) ? yearAllRecords : records;
  const completeRecords = sourceRecords.filter(r => r.drp_Type && r.drp_Sdate);

  let yearMinutes = 0;
  for (const r of completeRecords) {
    const sd = r.drp_Sdate || '';
    if (!sd.startsWith(yearPrefix)) continue;
    yearMinutes += _leaveDurationMinutes(r);
  }

  const yr = fmtDH(yearMinutes);

  panel.style.display = 'block';
  panel.innerHTML = `
    <div style="background:var(--bg-card,#fff);border:1.5px solid var(--primary-light,#dbeafe);border-radius:14px;padding:14px 18px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
        <i class="bi bi-person-lines-fill" style="font-size:17px;color:var(--primary);"></i>
        <span style="font-size:14px;font-weight:700;color:var(--gray-900);">${escHtml(empName)}</span>
        <span style="font-size:12px;color:var(--gray-500);">· ${escHtml(empIDs[0])}</span>
        <span style="margin-left:auto;font-size:12px;color:var(--gray-400);">แสดง ${records.length} รายการ</span>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <div style="flex:1;min-width:180px;background:var(--primary-light);border-radius:10px;padding:10px 14px;">
          <div style="font-size:11px;color:var(--gray-500);margin-bottom:3px;">วันลาในปี ${displayYear}</div>
          <div style="font-size:20px;font-weight:800;color:var(--primary);">${yr.day}</div>
          <div style="font-size:12px;color:var(--gray-400);margin-top:2px;">${yr.hrs}</div>
        </div>
      </div>
    </div>`;
}

export async function applyLeaveFilter() {
  const search      = (document.getElementById('leaveSearch')?.value || '').trim();
  const dateFromRaw = document.getElementById('leaveDateFrom')?.value || '';
  const dateToRaw   = document.getElementById('leaveDateTo')?.value   || '';
  const dateFrom    = displayDateToDbSlash(dateFromRaw) || '';
  const dateTo      = displayDateToDbSlash(dateToRaw) || '';
  const subID       = document.getElementById('leaveFilterSub')?.value  || '';
  const vsth        = document.getElementById('leaveFilterVsth')?.value || '';
  const leaveType   = document.getElementById('leaveFilterType')?.value || '';

  const tb = document.getElementById('leaveTableBody');
  if (tb) tb.innerHTML = `<tr class="loading-row"><td colspan="12"><div class="spinner"></div><div>กำลังโหลด...</div></td></tr>`;

  const res = await window.api.getDailyReports({ search, dateFrom, dateTo, subID, vsth, leaveType });
  if (!res.success) {
    if (tb) tb.innerHTML = `<tr><td colspan="12" class="text-center py-4" style="color:var(--danger);">เกิดข้อผิดพลาด: ${escHtml(res.message)}</td></tr>`;
    return;
  }
  allLeaveRecords = res.data;
  // If user selected a specific employee from dropdown, filter to exact match
  if (_leaveSearchSelectedEmpId) {
    allLeaveRecords = allLeaveRecords.filter(r => r.drp_empID === _leaveSearchSelectedEmpId);
  }
  if (vsth) {
    allLeaveRecords = allLeaveRecords.filter(r => getLeaveEmployeeType(r) === vsth);
  }
  filteredLeaveRecords = [...allLeaveRecords];

  // HR only: sort incomplete records (no leave type or no start date) to the top
  if (currentUser?.role !== 'guest') {
    filteredLeaveRecords.sort((a, b) => {
      const aIncomplete = !a.drp_Type || !a.drp_Sdate ? 0 : 1;
      const bIncomplete = !b.drp_Type || !b.drp_Sdate ? 0 : 1;
      if (aIncomplete !== bIncomplete) return aIncomplete - bIncomplete;
      return (b.drp_id || 0) - (a.drp_id || 0);
    });
  }
  leaveCurrentPage = 1;

  // When a date filter is active and results narrow to one employee,
  // fetch full-year records for that employee so the summary can show the year total.
  let yearAllRecords = null;
  const hasDateFilter = !!(dateFrom || dateTo);
  if (hasDateFilter && currentUser?.role !== 'guest' && search) {
    const empIds = [...new Set(filteredLeaveRecords.map(r => r.drp_empID).filter(Boolean))];
    if (empIds.length === 1) {
      const filterYear = (dateFrom || dateTo).split('/')[0];
      const res2 = await window.api.getDailyReports({
        search: empIds[0],
        dateFrom: `${filterYear}/01/01`,
        dateTo:   `${filterYear}/12/31`,
        subID: '', vsth: '', leaveType: ''
      });
      if (res2.success) {
        yearAllRecords = res2.data.filter(r => r.drp_empID === empIds[0]);
      }
    }
  }

  _renderLeaveSummary(filteredLeaveRecords, search, dateFromRaw, dateToRaw, yearAllRecords);
  renderLeaveTable();
}

export function onLeaveSearch() {
  clearTimeout(leaveSearchTimeout);
  clearTimeout(_leaveSearchSuggestTimer);
  _leaveSearchSelectedEmpId = null; // Clear exact selection on manual typing
  const val = (document.getElementById('leaveSearch')?.value || '').trim();
  leaveSearchTimeout = setTimeout(applyLeaveFilter, 300);
  // Show employee suggestions if typing looks like ID or name
  if (val.length >= 2) {
    _leaveSearchSuggestTimer = setTimeout(async () => {
      try {
        const res = await window.api.searchEmployees({ keyword: val, limit: 10 });
        if (res.success && res.data?.length > 0) {
          // If only 1 result, auto-select without showing dropdown
          if (res.data.length === 1) {
            _hideLeaveSearchSuggestions();
            leaveSearchSelectEmp(res.data[0].Emp_ID);
          } else {
            _showLeaveSearchSuggestions(res.data);
          }
        } else {
          _hideLeaveSearchSuggestions();
        }
      } catch { _hideLeaveSearchSuggestions(); }
    }, 200);
  } else {
    _hideLeaveSearchSuggestions();
  }
}

function _showLeaveSearchSuggestions(employees) {
  const box = document.getElementById('leaveSearchSuggestBox');
  if (!box) return;
  box._suggestData = employees;
  box.innerHTML = employees.map((emp, i) => {
    const fullname = `${emp.Emp_Sname || ''}${emp.Emp_Firstname || ''} ${emp.Emp_Lastname || ''}`.trim();
    const sub = emp.Sub_Name || '';
    const vsthBadge = emp.Emp_Vsth ? `<span style="font-size:10px;background:#e0f2fe;color:#0369a1;border-radius:6px;padding:1px 5px;margin-left:4px;">${escHtml(emp.Emp_Vsth)}</span>` : '';
    return `<div class="_leave-search-item" data-idx="${i}" style="padding:8px 14px;cursor:pointer;border-bottom:1px solid var(--gray-100);display:flex;align-items:center;gap:8px;font-size:13px;transition:background .1s;"
      onmousedown="leaveSearchSelectEmp('${escHtml(emp.Emp_ID)}')"
      onmouseenter="this.style.background='var(--primary-light,#eff6ff)';document.querySelectorAll('._leave-search-item').forEach((el,j)=>{if(j!==${i})el.style.background=''})" onmouseleave="this.style.background=''">
      <span style="font-weight:700;color:var(--primary);min-width:70px;">${escHtml(emp.Emp_ID)}</span>${vsthBadge}
      <span style="color:var(--gray-800);flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(fullname)}</span>
      <span style="font-size:11px;color:var(--gray-400);white-space:nowrap;">${escHtml(sub)}</span>
    </div>`;
  }).join('');
  box.style.display = 'block';
}

function _hideLeaveSearchSuggestions() {
  const box = document.getElementById('leaveSearchSuggestBox');
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
}

export function leaveSearchSelectEmp(empId) {
  const input = document.getElementById('leaveSearch');
  if (input) input.value = empId;
  _leaveSearchSelectedEmpId = empId; // Track exact selection
  _hideLeaveSearchSuggestions();
  clearTimeout(leaveSearchTimeout);
  applyLeaveFilter();
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
      const isIncomplete = currentUser?.role !== 'guest' && (!r.drp_Type || !r.drp_Sdate);
      const rowStyle = isIncomplete ? ' style="background:var(--warning-light);border-left:3px solid var(--warning);"' : '';
      const ltBadge = r.leave_name
        ? `<span style="background:var(--primary-light);color:var(--primary);padding:2px 8px;border-radius:12px;font-size:11.5px;font-weight:600;">${escHtml(r.drp_Type)} - ${escHtml(r.leave_name)}</span>`
        : isIncomplete
          ? `<span style="background:var(--warning-light);color:var(--warning);padding:2px 8px;border-radius:12px;font-size:11.5px;font-weight:600;"><i class="bi bi-exclamation-circle-fill me-1"></i>รอบันทึกรายละเอียด</span>`
          : `<span style="color:var(--gray-500);">${escHtml(r.drp_Type||'-')}</span>`;
      const commBadge = comm === 'โทร'
        ? `<span style="color:var(--success);font-size:12px;"><i class="bi bi-telephone-fill me-1"></i>โทร</span>`
        : comm === 'แจ้งล่วงหน้า'
        ? `<span style="color:var(--warning);font-size:12px;"><i class="bi bi-bell-fill me-1"></i>แจ้งล่วงหน้า</span>`
        : '<span style="color:var(--gray-400);">-</span>';
      const sdate = r.drp_Sdate ? `${dbDateToDisplay(r.drp_Sdate)}${r.drp_Stime ? ' <span style="color:var(--gray-400);font-size:11px;">'+escHtml(r.drp_Stime)+'</span>' : ''}` : '-';
      const edate = r.drp_Edate ? `${dbDateToDisplay(r.drp_Edate)}${r.drp_Etime ? ' <span style="color:var(--gray-400);font-size:11px;">'+escHtml(r.drp_Etime)+'</span>' : ''}` : '-';
      const remarkTrimmed = (r.drp_Remark||'').replace(/\r\n/g,' ').replace(/\n/g,' ').trim();
      return `<tr${rowStyle}>
        <td style="text-align:center;color:var(--gray-400);font-size:12px;">${num}</td>
        <td><span class="emp-id">${escHtml(r.drp_empID||'-')}</span></td>
        <td><span class="emp-name">${escHtml((r.Fullname||'').trim()||'-')}</span></td>
        <td style="font-size:12.5px;">${escHtml(r.Sub_Name||'-')}</td>
        <td><span style="font-size:11.5px;font-weight:600;color:var(--gray-600);">${escHtml(getLeaveEmployeeType(r))}</span></td>
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
  // Guest: hide leave details section, show notice
  const isGuest = currentUser?.role === 'guest';
  const detailsSection = document.getElementById('leaveDetailsSection');
  const guestNotice    = document.getElementById('leaveGuestNotice');
  if (detailsSection) detailsSection.style.display = isGuest ? 'none' : '';
  if (guestNotice)    guestNotice.style.display    = isGuest ? 'block' : 'none';

  showModal('leaveModal');
}

export function onLeaveTypeChange() {
  if (currentUser?.role === 'guest') return;
  const sel = document.getElementById('fLeaveType');
  const rem = document.getElementById('fLeaveRemark');
  const comm = document.getElementById('fLeaveComm');
  if (!sel) return;

  // Handle 'Absent' (A) logic - auto-fill remark
  if (sel.value === 'A') {
    if (rem) {
      const lt = leaveTypes.find(t => t.leave_abbreviation === 'A');
      rem.value = lt ? lt.leave_name : 'ขาดงาน';
    }
  }

  // Disable communication for A, X, N leave types or พ้นสภาพพนักงานใหม่ status
  const sub = (document.getElementById('fLeaveSub')?.value || '').trim();
  const skipComm = ['A', 'X', 'N'].includes(sel.value) || sub === 'พ้นสภาพพนักงานใหม่';
  if (comm) {
    if (skipComm) {
      comm.value = '';
      comm.disabled = true;
      comm.classList.add('leave-readonly');
    } else {
      comm.disabled = false;
      comm.classList.remove('leave-readonly');
    }
  }
}

export function onLeaveStartDTChange() {}

function clearLeaveForm() {
  ['fLeaveEmpID','fLeaveFirstname','fLeaveLastname','fLeaveDept','fLeaveSub'].forEach(f => {
    const el = document.getElementById(f);
    if (el) el.value = '';
  });
  const sname = document.getElementById('fLeaveSname');
  if (sname) sname.value = 'นาย';
  const comm = document.getElementById('fLeaveComm');
  if (comm) comm.selectedIndex = 0;
  const lt = document.getElementById('fLeaveType');
  if (lt) lt.value = '';
  const base = todayInputFormat();
  const startDate = document.getElementById('fLeaveStartDate');
  if (startDate) startDate.value = '';
  const startTime = document.getElementById('fLeaveStartTime');
  if (startTime) { startTime.value = ''; startTime.style.borderColor = ''; }
  const endDate = document.getElementById('fLeaveEndDate');
  if (endDate) endDate.value = '';
  const endTime = document.getElementById('fLeaveEndTime');
  if (endTime) { endTime.value = ''; endTime.style.borderColor = ''; }
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
  document.getElementById('fLeaveComm').value = (comm !== '-') ? comm : '';
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
  onLeaveTypeChange();
}

// ---- Employee ID autocomplete ----
let _empSearchTimer = null;
let _empSuggestHiIdx = -1;

function _fillEmployeeFields(e) {
  document.getElementById('fLeaveSname').value     = e.Emp_Sname || 'นาย';
  document.getElementById('fLeaveFirstname').value = e.Emp_Firstname || '';
  document.getElementById('fLeaveLastname').value  = e.Emp_Lastname || '';
  document.getElementById('fLeaveDept').value      = e.Sub_Name || '';
  document.getElementById('fLeaveSub').value       = e.Emp_Vsth || '';
  hideEmpSuggestions();
}

function _selectEmployee(emp) {
  if (emp.Emp_Status && emp.Emp_Status !== 'Activated') {
    showToast(`พนักงาน ${emp.Emp_ID} สถานะ "${emp.Emp_Status}" ไม่สามารถบันทึกรายการใหม่ได้`, 'error');
    return;
  }
  const input = document.getElementById('fLeaveEmpID');
  if (input) input.value = emp.Emp_ID || '';
  _fillEmployeeFields(emp);
  hideEmpSuggestions();
  if (currentUser?.role === 'guest') {
    setTimeout(() => {
      showModal('leaveSaveConfirmModal');
      document.getElementById('btnConfirmSaveLeave')?.focus();
    }, 80);
  } else {
    setTimeout(() => document.getElementById('fLeaveType')?.focus(), 80);
  }
}

export function hideEmpSuggestions() {
  const box = document.getElementById('empSuggestionsBox');
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
  _empSuggestHiIdx = -1;
}

function _showEmpSuggestions(results) {
  const box = document.getElementById('empSuggestionsBox');
  if (!box) return;
  if (!results || results.length === 0) {
    box.innerHTML = `<div style="padding:10px 14px;color:var(--gray-400);font-size:13px;">ไม่พบพนักงาน</div>`;
    box.style.display = 'block';
    return;
  }
  box.innerHTML = results.map((emp, i) => {
    const fullname = `${emp.Emp_Sname || ''}${emp.Emp_Firstname || ''} ${emp.Emp_Lastname || ''}`.trim();
    const sub = emp.Sub_Name ? `<span style="color:var(--gray-400);font-size:11px;margin-left:6px;">${escHtml(emp.Sub_Name)}</span>` : '';
    const vsthBadge = emp.Emp_Vsth ? `<span style="font-size:10px;background:#e0f2fe;color:#0369a1;border-radius:6px;padding:1px 5px;margin-left:4px;">${escHtml(emp.Emp_Vsth)}</span>` : '';
    const isInactive = emp.Emp_Status && emp.Emp_Status !== 'Activated';
    const statusBadge = isInactive
      ? `<span style="font-size:10px;background:var(--warning-light);color:var(--warning);border-radius:6px;padding:1px 5px;margin-left:6px;">${escHtml(emp.Emp_Status || '')}</span>` : '';
    const itemStyle = isInactive ? 'opacity:0.5;cursor:not-allowed;' : 'cursor:pointer;';
    return `<div class="_emp-suggest-item" data-idx="${i}"
      style="padding:9px 14px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:8px;transition:background 0.12s;${itemStyle}"
      onmousedown="${isInactive ? 'event.preventDefault()' : `empSuggestSelect(${i})`}"
      onmouseenter="empSuggestHover(${i})">
      <span style="font-size:12px;font-weight:700;color:var(--primary);min-width:70px;">${escHtml(emp.Emp_ID || '')}</span>${vsthBadge}
      <span style="font-size:13px;color:var(--gray-800);">${escHtml(fullname)}</span>
      ${sub}${statusBadge}
    </div>`;
  }).join('');
  box.style.display = 'block';
  _empSuggestHiIdx = -1;
  // Store results for keyboard selection
  box._empResults = results;
}

export function empSuggestHover(idx) {
  _empSuggestHiIdx = idx;
  _highlightSuggest(idx);
}
export function empSuggestSelect(idx) {
  const box = document.getElementById('empSuggestionsBox');
  const results = box?._empResults;
  if (!results || !results[idx]) return;
  _selectEmployee(results[idx]);
}
function _highlightSuggest(idx) {
  document.querySelectorAll('._emp-suggest-item').forEach((el, i) => {
    el.style.background = i === idx ? 'var(--primary-light,#eff6ff)' : '';
  });
}

export function empIDInput() {
  clearTimeout(_empSearchTimer);
  const val = (document.getElementById('fLeaveEmpID')?.value || '').trim();
  if (!val) { hideEmpSuggestions(); return; }
  _empSearchTimer = setTimeout(async () => {
    try {
      const res = await window.api.searchEmployees({ keyword: val, limit: 10 });
      if (res.success && res.data?.length === 1) {
        // Auto-select if only 1 result
        hideEmpSuggestions();
        _selectEmployee(res.data[0]);
      } else if (res.success) {
        _showEmpSuggestions(res.data);
      } else {
        hideEmpSuggestions();
      }
    } catch { hideEmpSuggestions(); }
  }, 250);
}

export async function lookupEmployee() {
  const empId = (document.getElementById('fLeaveEmpID')?.value || '').trim();
  if (!empId) { showToast('กรุณากรอกรหัสพนักงานก่อน', 'error'); return; }
  hideEmpSuggestions();
  const btn = document.getElementById('btnLookupEmp');
  if (btn) { btn.innerHTML = '<span class="spinner" style="display:inline-block;width:14px;height:14px;margin:0 4px -3px 0;border-width:2px;"></span>'; btn.disabled = true; }
  try {
    const res = await window.api.getEmployeeById(empId);
    if (res.success && res.data) {
      if (res.data.Emp_Status && res.data.Emp_Status !== 'Activated') {
        showToast(`พนักงาน ${empId} สถานะ "${res.data.Emp_Status}" ไม่สามารถบันทึกรายการใหม่ได้`, 'error');
      } else {
        _fillEmployeeFields(res.data);
        if (currentUser?.role === 'guest') {
          setTimeout(() => {
            showModal('leaveSaveConfirmModal');
            document.getElementById('btnConfirmSaveLeave')?.focus();
          }, 80);
        } else {
          setTimeout(() => document.getElementById('fLeaveType')?.focus(), 80);
        }
      }
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
  const isGuest = currentUser?.role === 'guest';
  const empId   = (document.getElementById('fLeaveEmpID')?.value || '').trim();
  const recDate = document.getElementById('fLeaveRecordDate')?.value || todayInputFormat();

  if (!empId) { showToast('กรุณากรอกรหัสพนักงาน', 'error'); return; }

  const recordDateDb = dateInputToDb(recDate);
  if (!recordDateDb) { showToast('วันที่บันทึกไม่ถูกต้อง (ต้องเป็น YYYY/MM/DD)', 'error'); return; }

  let d;

  if (isGuest) {
    // Guest: save only employee ID + record date; leave remaining fields blank for HR to fill
    const sub = document.getElementById('fLeaveSub')?.value || '';
    d = {
      drp_empID:        empId,
      drp_record:       recordDateDb,
      drp_Type:         '',
      drp_Communicate:  '',
      drp_Communicate1: '',
      drp_Sdate:        '',
      drp_Stime:        '',
      drp_Edate:        '',
      drp_Etime:        '',
      drp_status:       sub,
      drp_Remark:       ''
    };
  } else {
    const ltype   = document.getElementById('fLeaveType')?.value || '';
    const startDate = document.getElementById('fLeaveStartDate')?.value || '';
    const startTime = document.getElementById('fLeaveStartTime')?.value || '';
    const endDate   = document.getElementById('fLeaveEndDate')?.value   || '';
    const endTime   = document.getElementById('fLeaveEndTime')?.value   || '';
    const comm    = document.getElementById('fLeaveComm')?.value || '';
    const sub     = document.getElementById('fLeaveSub')?.value || '';
    const remark  = document.getElementById('fLeaveRemark')?.value || '';

    if (!ltype)  { showToast('กรุณาเลือกประเภทการลา', 'error'); return; }
    // Skip communication validation for A, X, N leave types or พ้นสภาพพนักงานใหม่ status
    const skipComm = ['A', 'X', 'N'].includes(ltype) || sub.trim() === 'พ้นสภาพพนักงานใหม่';
    if (!skipComm && !comm) { showToast('กรุณาเลือกการสื่อสาร', 'error'); return; }
    if (!startDate || !startTime) { showToast('กรุณากรอกวันและเวลาเริ่มต้น', 'error'); return; }
    if (!endDate || !endTime)     { showToast('กรุณากรอกวันและเวลาสิ้นสุด', 'error'); return; }
    if (!remark) { showToast('กรุณากรอกเหตุผลการลา', 'error'); return; }

    const startDateDb = dateInputToDb(startDate);
    const endDateDb = dateInputToDb(endDate);

    if (!startDateDb) { showToast('วันที่ลาไม่ถูกต้อง (ต้องเป็น YYYY/MM/DD)', 'error'); return; }
    if (!endDateDb)   { showToast('วันที่สิ้นสุดไม่ถูกต้อง (ต้องเป็น YYYY/MM/DD)', 'error'); return; }

    d = {
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
  }

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

export function closeLeaveModal() { hideEmpSuggestions(); closeModal('leaveModal'); editingLeaveId = null; }

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
            placeholder="YYYY/MM/DD" maxlength="10" inputmode="numeric" autocomplete="off"
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
    area.innerHTML = `<div class="empty-state"><div class="empty-icon"><i class="bi bi-exclamation-triangle"></i></div><div class="empty-text" style="color:var(--danger);">โปรดระบุวันที่ในรูปแบบ YYYY/MM/DD</div></div>`;
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

  // Modern Clean Styles
  const vsthColors = { Vel:'#374151', SK:'#374151', TBS:'#374151', CWS:'#374151' };
  const vsthBg    = { Vel:'#f9fafb', SK:'#f9fafb', TBS:'#f9fafb', CWS:'#f9fafb' };
  const vsthLabel = { Vel:'Vel (พนักงานบริษัท)', SK:'SK (Outsource)', TBS:'TBS (Outsource)', CWS:'CWS (Outsource)' };

  function buildTable(rows, vsth, offset=0) {
    if (rows.length === 0) return `<p style="color:var(--gray-400);font-size:13px;padding:8px 12px;margin:0;">— ไม่มีรายการ —</p>`;
    return `
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin:0;">
        <thead>
          <tr style="background:var(--gray-100);border-bottom:2px solid var(--gray-200);">
            <th style="padding:10px 12px;text-align:center;width:40px;color:var(--gray-600);font-weight:600;">#</th>
            <th style="padding:10px 12px;text-align:left;width:85px;color:var(--gray-600);font-weight:600;">รหัส</th>
            <th style="padding:10px 12px;text-align:left;min-width:160px;color:var(--gray-600);font-weight:600;">ชื่อ-นามสกุล</th>
            <th style="padding:10px 12px;text-align:left;min-width:120px;color:var(--gray-600);font-weight:600;">แผนก</th>
            <th style="padding:10px 12px;text-align:center;width:100px;color:var(--gray-600);font-weight:600;">ประเภทลา</th>
            <th style="padding:10px 12px;text-align:left;width:110px;color:var(--gray-600);font-weight:600;">สื่อสาร</th>
            <th style="padding:10px 12px;text-align:left;width:130px;color:var(--gray-600);font-weight:600;">วันที่ลา/เวลา</th>
            <th style="padding:10px 12px;text-align:left;color:var(--gray-600);font-weight:600;">หมายเหตุ/เหตุผล</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r,i) => {
            const comm = getCommunicateLabel(r);
            const remark = (r.drp_Remark||'').replace(/\r\n/g,' ').replace(/\n/g,' ').trim();
            const timeStr = r.drp_Stime ? `${r.drp_Stime}–${r.drp_Etime||'17:00'}` : '';
            return `<tr style="border-bottom:1px solid #f1f5f9;">
              <td style="padding:10px 12px;text-align:center;color:var(--gray-400);font-size:12px;">${offset+i+1}</td>
              <td style="padding:10px 12px;color:var(--gray-500);font-weight:500;">${escHtml(r.drp_empID||'-')}</td>
              <td style="padding:10px 12px;font-weight:600;color:var(--gray-800);">${escHtml((r.Fullname||'').trim()||'-')}</td>
              <td style="padding:10px 12px;color:var(--gray-600);">${escHtml(r.Sub_Name||'-')}</td>
              <td style="padding:10px 12px;text-align:center;">
                <span style="background:var(--gray-100);color:var(--gray-700);padding:3px 10px;border-radius:6px;font-size:12px;font-weight:600;border:1px solid var(--gray-200);">${escHtml(r.drp_Type||'-')}</span>
              </td>
              <td style="padding:10px 12px;color:var(--gray-600);">${escHtml(comm)}</td>
              <td style="padding:10px 12px;color:var(--gray-600);font-size:12.5px;">${escHtml(dbDateToDisplay(r.drp_Sdate) || '-')} ${timeStr}</td>
              <td style="padding:10px 12px;color:var(--gray-500);font-size:12.5px;max-width:220px;">${escHtml(remark||'-')}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }

  area.innerHTML = `
    <div id="printableArea" style="background:white;border-radius:12px;border:1px solid #e5e7eb;padding:40px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

      <!-- Modern Header -->
      <div style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:32px;padding-bottom:20px;border-bottom:1px solid #f3f4f6;">
        <div>
          <h1 style="margin:0;font-size:24px;font-weight:800;color:#111827;letter-spacing:-0.02em;">รายงานการหยุดงานประจำวัน</h1>
          <p style="margin:6px 0 0;font-size:15px;color:#6b7280;">ข้อมูลวันที่: <strong style="color:#111827;">${escHtml(thDate)}</strong></p>
        </div>
        <div style="text-align:right;">
          <div style="font-size:13px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">สถานะรวม</div>
          <div style="font-size:28px;font-weight:800;color:var(--primary);line-height:1;">${totalCount} <span style="font-size:14px;font-weight:600;color:#6b7280;margin-left:2px;">รายการ</span></div>
        </div>
      </div>

      <!-- Compact Stat Group -->
      <div style="display:flex;gap:24px;margin-bottom:40px;">
        ${VSTH_ORDER.map(v => `
          <div style="flex:1;">
            <div style="font-size:12px;color:#6b7280;font-weight:600;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.02em;">${v}</div>
            <div style="font-size:20px;font-weight:700;color:#111827;">${grouped[v].length}</div>
            <div style="width:100%;height:3px;background:#f3f4f6;margin-top:8px;border-radius:10px;overflow:hidden;">
              <div style="width:${totalCount > 0 ? (grouped[v].length/totalCount*100) : 0}%;height:100%;background:${v==='Vel'?'var(--primary)':'#9ca3af'};"></div>
            </div>
          </div>`).join('')}
      </div>

      <!-- List Style for Vel -->
      <div style="margin-bottom:40px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
          <div style="width:4px;height:24px;background:var(--primary);border-radius:10px;"></div>
          <h2 style="margin:0;font-size:17px;font-weight:700;color:#111827;">พนักงานบริษัท (Vel)</h2>
          <span style="font-size:14px;color:#6b7280;margin-left:4px;">จำนวน ${velCount} คน</span>
        </div>
        <div style="border:1px solid #eef2f6;border-radius:10px;overflow:hidden;">
          ${buildTable(grouped['Vel'], 'Vel')}
        </div>
      </div>

      <!-- List Style for Outsource -->
      <div style="margin-bottom:40px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
          <div style="width:4px;height:24px;background:#6b7280;border-radius:10px;"></div>
          <h2 style="margin:0;font-size:17px;font-weight:700;color:#111827;">พนักงาน Outsource</h2>
          <span style="font-size:14px;color:#6b7280;margin-left:4px;">จำนวน ${outerCount} คน</span>
        </div>
        
        ${['SK','TBS','CWS'].map(v => {
          const rows = grouped[v];
          if (rows.length === 0) return '';
          return `
          <div style="margin-bottom:24px;border:1px solid #f1f5f9;border-radius:10px;overflow:hidden;">
            <div style="background:#f8fafc;padding:10px 16px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between;">
              <span style="font-size:14px;font-weight:700;color:#475569;">${vsthLabel[v]}</span>
              <span style="font-size:12px;color:#94a3b8;font-weight:600;">${rows.length} คน</span>
            </div>
            ${buildTable(rows, v)}
          </div>`;
        }).join('')}
        ${outerCount === 0 ? '<p style="color:var(--gray-400);font-size:13px;padding:8px 0;">— ไม่มีรายการ —</p>' : ''}
      </div>

      <!-- Summary (Clean Grid) -->
      <div style="margin-top:48px;padding-top:32px;border-top:1px solid #f3f4f6;display:flex;justify-content:flex-end;">
        <div style="width:100%;max-width:320px;">
          <div style="font-size:13px;font-weight:700;color:#9ca3af;margin-bottom:16px;text-transform:uppercase;letter-spacing:0.05em;">สรุปการลาประจำวัน</div>
          ${VSTH_ORDER.map(v => `
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f9fafb;font-size:14px;">
              <span style="color:#6b7280;">${vsthLabel[v]}</span>
              <span style="font-weight:700;color:#111827;">${grouped[v].length}</span>
            </div>
          `).join('')}
          <div style="display:flex;justify-content:space-between;padding:12px 0;margin-top:8px;font-weight:800;font-size:16px;color:var(--primary);">
            <span>รวมหยุดงานที้งหมด</span>
            <span>${totalCount}</span>
          </div>
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
          style="position:absolute;top:4px;right:4px;background:var(--gray-100);border:1px solid var(--gray-200);border-radius:5px;
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
