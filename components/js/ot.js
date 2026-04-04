// ===================== OT PAGE =====================
import { escHtml, showToast, showModal, closeModal } from './utils.js';

let otAllEmployees = [];            // full loaded list from server
let otFilteredEmployees = [];       // after sub + search filter
let otSelectedIds = new Set();      // checked employee IDs (current view)
let otSelectedEmployees = new Map();// Emp_ID → employee data (persists across filter changes)
let otHolidays = [];                // holidays for selected month
let otGeneratedForms = [];          // { emp, days[] } per employee
let otSubTimer = null;
let otEmpSearchTimer = null;

// ===================== THAI MONTH NAMES =====================
const THAI_MONTHS = [
  '', 'มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
  'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'
];

// ===================== LOAD PAGE =====================
export async function loadOtPage() {
  const container = document.getElementById('pageContent');
  container.innerHTML = `<div class="text-center py-5"><div class="spinner" style="margin:0 auto;"></div>
    <p class="mt-3 text-muted">กำลังโหลดข้อมูล...</p></div>`;

  otAllEmployees = [];
  otFilteredEmployees = [];
  otSelectedIds = new Set();
  otSelectedEmployees = new Map();
  otHolidays = [];
  otGeneratedForms = [];

  try {
    const res = await fetch('components/html/ot.html');
    container.innerHTML = await res.text();
  } catch {
    container.innerHTML = '<p>Error loading template</p>';
    return;
  }

  // Populate year selector (current BE ±2)
  const yearSel = document.getElementById('otYear');
  if (yearSel) {
    const ceNow = new Date().getFullYear();
    for (let y = ceNow + 1; y >= ceNow - 2; y--) {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y + 543;
      if (y === ceNow) opt.selected = true;
      yearSel.appendChild(opt);
    }
  }

  // Set current month
  const monthSel = document.getElementById('otMonth');
  if (monthSel) monthSel.value = String(new Date().getMonth() + 1);

  // Load subdivisions
  await otLoadSubdivisions();

  // Load employees
  await otLoadEmployees();
}

// ===================== LOAD SUBDIVISIONS =====================
async function otLoadSubdivisions() {
  const sel = document.getElementById('otSubFilter');
  if (!sel) return;
  try {
    const res = await window.api.getSubdivisions();
    if (res?.success) {
      sel.innerHTML = '<option value="">-- ทั้งหมด --</option>';
      (res.data || []).forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.Sub_ID;
        opt.textContent = s.Sub_Name;
        sel.appendChild(opt);
      });
    }
  } catch {}
}

// ===================== LOAD EMPLOYEES =====================
async function otLoadEmployees() {
  const subId = document.getElementById('otSubFilter')?.value || '';
  const search = document.getElementById('otEmpSearch')?.value?.trim() || '';

  otRenderEmpListLoading();
  try {
    let allRows = [];
    let page = 1;
    const perPage = 100;
    while (true) {
      const res = await window.api.getEmployees({
        status: 'Activated',
        subdivision: subId,
        search,
        perPage,
        page
      });
      if (!res?.success) { otRenderEmpListError(); return; }
      allRows = allRows.concat(res.data || []);
      if (allRows.length >= res.total || (res.data || []).length < perPage) break;
      page++;
    }
    otAllEmployees = allRows;
    otFilteredEmployees = [...otAllEmployees];
    otRenderEmpList();
  } catch {
    otRenderEmpListError();
  }
}

function otRenderEmpListLoading() {
  const el = document.getElementById('otEmpList');
  if (el) el.innerHTML = `<div style="text-align:center;padding:24px;color:var(--gray-400);font-size:13px;">
    <div class="spinner" style="margin:0 auto 8px;"></div>กำลังโหลด...</div>`;
}

function otRenderEmpListError() {
  const el = document.getElementById('otEmpList');
  if (el) el.innerHTML = `<div style="text-align:center;padding:20px;color:var(--danger);font-size:13px;">โหลดข้อมูลไม่สำเร็จ</div>`;
}

function otRenderEmpList() {
  const el = document.getElementById('otEmpList');
  if (!el) return;

  if (otFilteredEmployees.length === 0) {
    el.innerHTML = `<div style="text-align:center;padding:20px;color:var(--gray-400);font-size:13px;">ไม่พบพนักงาน</div>`;
    otUpdateSelectedCount();
    return;
  }

  el.innerHTML = otFilteredEmployees.map(emp => {
    const checked = otSelectedIds.has(emp.Emp_ID);
    return `<div class="ot-emp-item${checked ? ' checked' : ''}" onclick="otToggleEmp('${escHtml(emp.Emp_ID)}')">
      <input type="checkbox" ${checked ? 'checked' : ''} onclick="event.stopPropagation();otToggleEmp('${escHtml(emp.Emp_ID)}')">
      <div class="ot-emp-info">
        <div><span class="ot-emp-id">${escHtml(emp.Emp_ID)}</span>
          <span class="ot-emp-name" style="margin-left:6px;">${escHtml(emp.Fullname || '-')}</span></div>
        <div class="ot-emp-sub">${escHtml(emp.Sub_Name || '-')}</div>
      </div>
    </div>`;
  }).join('');

  otUpdateSelectedCount();
}

function otUpdateSelectedCount() {
  const total = otSelectedEmployees.size;
  const el = document.getElementById('otSelectedCount');
  if (el) el.textContent = total;

  // Show "multiple departments" badge if selected spans more than current filter
  const badge = document.getElementById('otCrossDeptBadge');
  if (badge) {
    const currentIds = new Set(otFilteredEmployees.map(e => e.Emp_ID));
    const hasCross = [...otSelectedEmployees.keys()].some(id => !currentIds.has(id));
    badge.style.display = hasCross ? 'inline' : 'none';
  }

  const generated = otGeneratedForms.length;
  const btnPrint = document.getElementById('otBtnPrint');
  const btnExport = document.getElementById('otBtnExport');
  const cnt = document.getElementById('otPrintCount');
  const expCnt = document.getElementById('otExportCount');
  if (btnPrint) btnPrint.disabled = generated === 0;
  if (btnExport) btnExport.disabled = generated === 0;
  if (cnt) cnt.textContent = generated;
  if (expCnt) expCnt.textContent = generated;
}

// ===================== EVENT HANDLERS =====================
export function otOnSubChange() {
  // Do NOT clear selections — user may be selecting across departments
  otLoadEmployees();
}

export function otOnFilterChange() {
  // When month/year changes, clear generated forms
  otGeneratedForms = [];
  otUpdateSelectedCount();
  document.getElementById('otPreviewArea').innerHTML = `
    <div style="text-align:center;padding:60px 20px;color:var(--gray-400);">
      <i class="bi bi-file-earmark-text" style="font-size:48px;display:block;margin-bottom:12px;opacity:0.4;"></i>
      <div style="font-size:14px;">เลือกพนักงานและกด <strong>สร้างแบบฟอร์ม</strong> เพื่อแสดงตัวอย่าง</div>
    </div>`;
}

export function otOnEmpSearch() {
  clearTimeout(otEmpSearchTimer);
  otEmpSearchTimer = setTimeout(() => otLoadEmployees(), 300);
}

export function otToggleEmp(empId) {
  if (otSelectedIds.has(empId)) {
    otSelectedIds.delete(empId);
    otSelectedEmployees.delete(empId);
  } else {
    otSelectedIds.add(empId);
    const emp = otFilteredEmployees.find(e => e.Emp_ID === empId);
    if (emp) otSelectedEmployees.set(empId, emp);
  }
  otRenderEmpList();
}

export function otSelectAll() {
  otFilteredEmployees.forEach(e => {
    otSelectedIds.add(e.Emp_ID);
    otSelectedEmployees.set(e.Emp_ID, e);
  });
  otRenderEmpList();
}

export function otDeselectAll() {
  // Only deselect employees visible in current filter
  otFilteredEmployees.forEach(e => {
    otSelectedIds.delete(e.Emp_ID);
    otSelectedEmployees.delete(e.Emp_ID);
  });
  otRenderEmpList();
}

// ===================== GET MONTH HOLIDAYS =====================
async function otFetchHolidays(ceYear, month) {
  try {
    const res = await window.api.getHolidaysForMonth({ year: ceYear, month });
    if (res?.success) return res.data || [];
  } catch {}
  return [];
}

// ===================== BUILD DAY ROWS =====================
function otBuildDays(ceYear, month, holidays) {
  const daysInMonth = new Date(ceYear, month, 0).getDate();
  const holidayMap = new Map(); // "YYYY/MM/DD" → name
  holidays.forEach(h => holidayMap.set(h.Date, h['Important Day']));

  const rows = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const mm = String(month).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    const dateStr = `${ceYear}/${mm}/${dd}`;
    const jsDate = new Date(ceYear, month - 1, d);
    const dow = jsDate.getDay(); // 0=Sun,6=Sat
    const isWeekend = dow === 0 || dow === 6;
    const holidayName = holidayMap.get(dateStr) || '';
    const isHoliday = !!holidayName;
    const dayNameTH = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'][dow];
    rows.push({ d, dateStr, dow, dayNameTH, isWeekend, isHoliday, holidayName });
  }
  return rows;
}

// ===================== GENERATE FORMS =====================
export async function otGenerate() {
  if (otSelectedIds.size === 0) {
    showToast('โปรดเลือกพนักงานอย่างน้อย 1 คน', 'warning');
    return;
  }

  const ceYear = parseInt(document.getElementById('otYear')?.value, 10);
  const month  = parseInt(document.getElementById('otMonth')?.value, 10);
  if (!ceYear || !month) { showToast('โปรดเลือกเดือน/ปี', 'warning'); return; }

  const btn = document.getElementById('otBtnGenerate');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner" style="display:inline-block;width:14px;height:14px;margin:0 4px -2px 0;"></span>กำลังสร้าง...'; }

  try {
    otHolidays = await otFetchHolidays(ceYear, month);
    const days = otBuildDays(ceYear, month, otHolidays);

    // Use otSelectedEmployees map — preserves cross-department selections
    const selected = [...otSelectedEmployees.values()];
    if (selected.length === 0) {
      showToast('ไม่พบข้อมูลพนักงานที่เลือก', 'warning');
      return;
    }
    otGeneratedForms = selected.map(emp => ({ emp, days }));

    otRenderPreview(ceYear, month, otGeneratedForms);
    otBuildPrintArea(ceYear, month, otGeneratedForms);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-arrow-clockwise"></i> สร้างแบบฟอร์ม'; }
    otUpdateSelectedCount();
  }
}

// ─── Screen Preview ───────────────────────────────────────────────
function otRenderPreview(ceYear, month, forms) {
  const pa = document.getElementById('otPreviewArea');
  if (!pa) return;

  const beYear = ceYear + 543;
  const monthName = THAI_MONTHS[month];

  if (forms.length === 0) {
    pa.innerHTML = `<div style="text-align:center;padding:40px;color:var(--gray-400);">ไม่มีข้อมูล</div>`;
    return;
  }

  pa.innerHTML = forms.map(({ emp, days }) => {
    const rows = days.map(r => {
      let rowClass = '';
      if (r.isHoliday) rowClass = 'ot-holiday-row';
      else if (r.isWeekend) rowClass = 'ot-weekend-row';
      return `<tr class="${rowClass}">
        <td style="text-align:center;font-weight:${r.isHoliday||r.isWeekend?'600':'400'};font-size:12px;">${r.d}<br><span style="font-size:10px;color:var(--gray-400);">${r.dayNameTH}</span></td>
        <td></td><td></td><td></td><td></td>
        <td></td>
        <td></td><td></td>
        <td></td>
        <td style="font-size:11px;color:${r.isHoliday?'#ef4444':'var(--gray-500)'};">${escHtml(r.holidayName)}</td>
      </tr>`;
    }).join('');

    return `<div class="ot-form-card">
      <div class="ot-form-card-header">
        <div>
          <span class="ot-form-emp-badge">${escHtml(emp.Emp_ID)}</span>
          <span style="font-weight:700;margin-left:8px;font-size:14px;">${escHtml(emp.Fullname || '-')}</span>
        </div>
        <span style="font-size:12px;color:var(--gray-500);">${escHtml(emp.Sub_Name||'-')} &nbsp;|&nbsp; ${monthName} ${beYear}</span>
      </div>
      <div style="overflow-x:auto;">
        <table class="data-table" style="font-size:12px;min-width:600px;">
          <thead>
            <tr>
              <th rowspan="2" style="width:48px;text-align:center;">วันที่</th>
              <th colspan="2" style="text-align:center;">เวลาที่แจ้ง OT</th>
              <th colspan="2" style="text-align:center;">เวลาที่ทำจริง</th>
              <th rowspan="2" style="width:52px;text-align:center;">ชั่วโมง</th>
              <th rowspan="2" style="width:52px;text-align:center;">ลายเซ็น<br>พนักงาน</th>
              <th rowspan="2" style="width:52px;text-align:center;">ลายเซ็น<br>หัวหน้า</th>
              <th rowspan="2">รายละเอียดการทำงาน</th>
              <th rowspan="2" style="width:110px;">หมายเหตุ</th>
            </tr>
            <tr>
              <th style="width:55px;text-align:center;">เริ่ม</th>
              <th style="width:55px;text-align:center;">ถึง</th>
              <th style="width:55px;text-align:center;">เริ่ม</th>
              <th style="width:55px;text-align:center;">ถึง</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  }).join('');
}

// ─── Print area ────────────────────────────────────────────────────
function otBuildPrintArea(ceYear, month, forms) {
  const area = document.getElementById('otPrintArea');
  if (!area) return;

  const beYear = ceYear + 543;
  const monthName = THAI_MONTHS[month];
  const mm = String(month).padStart(2, '0');
  const daysInMonth = new Date(ceYear, month, 0).getDate();
  const dateRangeLabel = `1 - ${daysInMonth} ${monthName} ${beYear}`;

  area.innerHTML = forms.map(({ emp, days }) => {
    const rows = days.map(r => {
      let rowClass = r.isHoliday ? 'ot-ph-row' : (r.isWeekend ? 'ot-wk-row' : '');
      return `<tr class="${rowClass}">
        <td class="day-col">${r.d}<br><small>${r.dayNameTH}</small></td>
        <td class="time-col"></td>
        <td class="time-col"></td>
        <td class="time-col"></td>
        <td class="time-col"></td>
        <td class="hr-col"></td>
        <td class="sign-col"></td>
        <td class="sign-col"></td>
        <td class="detail-col"></td>
        <td class="note-col">${escHtml(r.holidayName)}</td>
      </tr>`;
    }).join('');

    return `<div class="ot-print-page">
      <div class="ot-print-title">รายงานการทำงานล่วงเวลาประจำเดือน</div>

      <div class="ot-print-info">
        <table>
          <tr>
            <td width="100">ชื่อ - นามสกุล</td>
            <td width="250">${escHtml(emp.Fullname || '-')}</td>
            <td width="110">รหัสพนักงาน</td>
            <td>${escHtml(emp.Emp_ID)}</td>
          </tr>
          <tr>
            <td>แผนก</td>
            <td>${escHtml(emp.Sub_Name || '-')}</td>
            <td>ประจำวันที่</td>
            <td>${escHtml(dateRangeLabel)}</td>
          </tr>
        </table>
      </div>

      <table class="ot-print-table">
        <thead>
          <tr>
            <th class="day-col" rowspan="2">วันที่</th>
            <th colspan="2">เวลาที่แจ้ง OT</th>
            <th colspan="2">เวลาที่ทำจริง</th>
            <th class="hr-col" rowspan="2">จำนวน<br>ชั่วโมง</th>
            <th class="sign-col" rowspan="2">ลายเซ็น<br>พนักงาน</th>
            <th class="sign-col" rowspan="2">ลายเซ็น<br>หัวหน้างาน</th>
            <th class="detail-col" rowspan="2">รายละเอียดการทำงาน</th>
            <th class="note-col" rowspan="2">หมายเหตุ</th>
          </tr>
          <tr>
            <th class="time-col">เริ่มเวลา</th>
            <th class="time-col">ถึงเวลา</th>
            <th class="time-col">เริ่มเวลา</th>
            <th class="time-col">ถึงเวลา</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="ot-print-summary">
        <div style="font-weight:bold;margin-bottom:4pt;">รวมการทำงานล่วงเวลา</div>
        <table>
          <tr>
            <td width="180">1. ล่วงเวลา 1.5 เท่า</td>
            <td width="130">……………… วัน</td>
            <td width="130">……………… ชั่วโมง</td>
            <td></td>
          </tr>
          <tr>
            <td>2. ล่วงเวลา 1 เท่า</td>
            <td>……………… วัน</td>
            <td>……………… ชั่วโมง</td>
            <td></td>
          </tr>
          <tr>
            <td>3. ล่วงเวลา 2 เท่า</td>
            <td>……………… วัน</td>
            <td>……………… ชั่วโมง</td>
            <td></td>
          </tr>
          <tr>
            <td>4. ล่วงเวลา 3 เท่า</td>
            <td>……………… วัน</td>
            <td>……………… ชั่วโมง</td>
            <td></td>
          </tr>
        </table>
      </div>

      <div class="ot-print-sign">
        <div class="ot-print-sign-box">
          ลงชื่อ ................................................<br>
          <small>( ผู้ตรวจสอบ / เจ้าหน้าที่ HR )</small>
        </div>
        <div class="ot-print-sign-box">
          ลงชื่อ ................................................<br>
          <small>( Assistant Manager )</small>
        </div>
      </div>

      <div class="ot-print-remark">
        <b>หมายเหตุ :</b> 1. รายงานการทำงานล่วงเวลาที่สำนักงานส่งทุกวันอังคารช่วงเช้า<br>
        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
        2. ถ้าพนักงานต้องการเปลี่ยนแปลงการทำงานล่วงเวลาต้องได้รับการอนุมัติจากผู้จัดการฝ่าย
      </div>
    </div>`;
  }).join('');
}

// ===================== EXPORT EXCEL =====================
export async function otExport() {
  if (otGeneratedForms.length === 0) {
    showToast('โปรดสร้างแบบฟอร์มก่อน', 'warning');
    return;
  }

  const ceYear = parseInt(document.getElementById('otYear')?.value, 10);
  const month  = parseInt(document.getElementById('otMonth')?.value, 10);

  const btn = document.getElementById('otBtnExport');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner" style="display:inline-block;width:14px;height:14px;margin:0 4px -2px 0;"></span>กำลัง Export...'; }

  try {
    const res = await window.api.exportOtExcel({
      forms: otGeneratedForms,
      ceYear,
      month
    });
    if (res?.success) {
      showToast(`บันทึกไฟล์ Excel สำเร็จ (${otGeneratedForms.length} ชีท)`, 'success');
    } else if (!res?.canceled) {
      showToast(res?.message || 'Export ไม่สำเร็จ', 'danger');
    }
  } catch (e) {
    showToast('Export ไม่สำเร็จ: ' + e.message, 'danger');
  } finally {
    if (btn) {
      btn.disabled = otGeneratedForms.length === 0;
      btn.innerHTML = '<i class="bi bi-file-earmark-excel-fill"></i> Export Excel (<span id="otExportCount">' + otGeneratedForms.length + '</span> ชีท)';
    }
  }
}

// ===================== PRINT =====================
export function otPrint() {
  if (otGeneratedForms.length === 0) {
    showToast('โปรดสร้างแบบฟอร์มก่อน', 'warning');
    return;
  }
  window.print();
}
