// ===================== HOLIDAY MANAGEMENT PAGE =====================
import { escHtml, showToast, showModal, closeModal, requirePasswordConfirm } from './utils.js';
import { currentUser } from './auth.js';

let allHolidays = [];      // all holidays for selected year
let filteredHolidays = []; // after search filter
let hdSelectedYear = new Date().getFullYear(); // CE year
let hdSearchTimer = null;
let hdDeletingId = null;

// Calendar state
let hdCalYear = new Date().getFullYear();
let hdCalMonth = new Date().getMonth(); // 0-11

// ===================== HELPERS =====================
function ceYearToBe(ce) { return ce + 543; }
function beYearToCe(be) { return be - 543; }

// "DD/MM/YYYY (BE)" → "YYYY/MM/DD (CE)" for DB (stored as VARCHAR YYYY/MM/DD)
function formDateToDb(val) {
  if (!val) return '';
  const p = val.split('/');
  if (p.length !== 3 || p[2].length !== 4) return '';
  const ceYear = parseInt(p[2], 10) - 543;
  return `${ceYear}/${p[1].padStart(2, '0')}/${p[0].padStart(2, '0')}`;
}

// "YYYY/MM/DD (CE)" → "DD/MM/YYYY (BE)" for display
function dbDateToDisplay(val) {
  if (!val) return '-';
  const p = String(val).split('/');
  if (p.length < 3) return '-';
  const beYear = parseInt(p[0], 10) + 543;
  return `${p[2]}/${p[1]}/${beYear}`;
}

// Short Thai date  e.g. "01 เม.ย. 2568"
function dbDateToThai(val) {
  if (!val) return '-';
  try {
    const d = new Date(val.replace(/\//g, '-') + 'T00:00:00');
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: '2-digit' });
  } catch { return '-'; }
}

// ===================== LOAD PAGE =====================
export async function loadHolidayPage() {
  const container = document.getElementById('pageContent');
  container.innerHTML = `<div class="text-center py-5"><div class="spinner" style="margin:0 auto;"></div>
    <p class="mt-3 text-muted">กำลังโหลดข้อมูล...</p></div>`;

  hdSelectedYear = new Date().getFullYear();
  hdCalYear = new Date().getFullYear();
  hdCalMonth = new Date().getMonth();
  allHolidays = [];
  filteredHolidays = [];

  try {
    const res = await fetch('components/html/holiday.html');
    container.innerHTML = await res.text();
  } catch {
    container.innerHTML = '<p>Error loading template</p>';
    return;
  }

  // Populate year filter (current CE ±3 years)
  hdPopulateYearSelector();
  hdCalRender();
  await hdRefresh();
}

function hdPopulateYearSelector() {
  const sel = document.getElementById('hdYearFilter');
  if (!sel) return;
  const now = new Date().getFullYear();
  sel.innerHTML = '';
  for (let y = now + 1; y >= now - 3; y--) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = `${ceYearToBe(y)} (${y})`;
    if (y === hdSelectedYear) opt.selected = true;
    sel.appendChild(opt);
  }
}

// ===================== REFRESH DATA =====================
export async function hdRefresh() {
  hdRenderTableLoading();
  const search = String(document.getElementById('hdSearchInput')?.value || '').trim();

  try {
    const res = await window.api.getHolidays({ year: hdSelectedYear });
    if (!res?.success) {
      showToast(res?.message || 'โหลดข้อมูลวันหยุดไม่สำเร็จ', 'danger');
      hdRenderTableError();
      return;
    }
    allHolidays = res.data || [];
    hdApplyFilter(search);
    hdCalRender();
    hdRenderStats();
  } catch (e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'danger');
    hdRenderTableError();
  }
}

function hdApplyFilter(keyword) {
  const q = (keyword || '').toLowerCase();
  filteredHolidays = q
    ? allHolidays.filter(h => (h['Important Day'] || '').toLowerCase().includes(q))
    : [...allHolidays];
  hdRenderTable();
}

export function hdOnSearch() {
  clearTimeout(hdSearchTimer);
  hdSearchTimer = setTimeout(() => {
    const q = document.getElementById('hdSearchInput')?.value || '';
    hdApplyFilter(q.trim());
  }, 250);
}

export function hdOnYearChange() {
  const sel = document.getElementById('hdYearFilter');
  if (sel) {
    hdSelectedYear = parseInt(sel.value, 10);
    hdCalYear = hdSelectedYear;
    hdCalMonth = 0; // reset to Jan when switching year
    hdCalRender();
  }
  hdRefresh();
}

// ===================== STAT CARDS =====================
function hdRenderStats() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let upcoming = 0, past = 0;
  allHolidays.forEach(h => {
    const d = new Date(String(h.Date || '').replace(/\//g, '-') + 'T00:00:00');
    if (d >= today) upcoming++; else past++;
  });

  const total = document.getElementById('hdStatTotal');
  const upEl = document.getElementById('hdStatUpcoming');
  const pastEl = document.getElementById('hdStatPast');
  if (total) total.textContent = allHolidays.length;
  if (upEl) upEl.textContent = upcoming;
  if (pastEl) pastEl.textContent = past;
}

// ===================== RENDER TABLE =====================
function hdRenderTableLoading() {
  const tb = document.getElementById('hdTableBody');
  if (tb) tb.innerHTML = `<tr class="loading-row"><td colspan="5">
    <div class="spinner"></div><div>กำลังโหลด...</div></td></tr>`;
}

function hdRenderTableError() {
  const tb = document.getElementById('hdTableBody');
  if (tb) tb.innerHTML = `<tr><td colspan="5"><div class="empty-state">
    <div class="empty-icon"><i class="bi bi-exclamation-triangle"></i></div>
    <div class="empty-text">โหลดข้อมูลไม่สำเร็จ</div></div></td></tr>`;
}

function hdRenderTable() {
  const tb = document.getElementById('hdTableBody');
  if (!tb) return;

  const dc = document.getElementById('hdDisplayCount');
  const tc = document.getElementById('hdTotalCount');
  if (dc) dc.textContent = filteredHolidays.length;
  if (tc) tc.textContent = allHolidays.length;

  if (filteredHolidays.length === 0) {
    tb.innerHTML = `<tr><td colspan="5"><div class="empty-state">
      <div class="empty-icon"><i class="bi bi-calendar2-x"></i></div>
      <div class="empty-text">ไม่พบวันหยุดในปีที่เลือก</div></div></td></tr>`;
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  tb.innerHTML = filteredHolidays.map((h, idx) => {
    const hDate = new Date(String(h.Date || '').replace(/\//g, '-') + 'T00:00:00');
    const isPast = hDate < today;
    const rowStyle = isPast ? 'opacity:0.6;' : '';
    const beYear = parseInt(String(h.Date || '0').split('/')[0], 10) + 543;
    const name = h['Important Day'] || '-';

    return `<tr style="${rowStyle}">
      <td style="text-align:center;color:var(--gray-400);">${idx + 1}</td>
      <td style="font-weight:600;color:var(--primary);white-space:nowrap;">${dbDateToThai(h.Date)}</td>
      <td>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="width:8px;height:8px;border-radius:50%;background:${isPast ? 'var(--gray-300)' : '#ef4444'};flex-shrink:0;display:inline-block;"></span>
          ${escHtml(name)}
        </div>
      </td>
      <td style="text-align:center;color:var(--gray-600);">${beYear}</td>
      <td style="text-align:center;">
        <div class="action-btns" style="justify-content:center;">
          <button type="button" class="btn-action" title="แก้ไข"
            style="background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe;"
            onclick="hdOpenModal(${h.ID})">
            <i class="bi bi-pencil"></i>
          </button>
          <button type="button" class="btn-action" title="ลบ"
            style="background:#fef2f2;color:#ef4444;border:1px solid #fecaca;"
            onclick="hdOpenDeleteModal(${h.ID}, '${escHtml(name)}')">
            <i class="bi bi-trash"></i>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ===================== CALENDAR =====================
function hdGetHolidayDates() {
  // Returns a Set of "YYYY/MM/DD" strings for quick lookup
  const s = new Set();
  allHolidays.forEach(h => { if (h.Date) s.add(h.Date); });
  return s;
}

export function hdCalRender() {
  const cal = document.getElementById('hdCalendar');
  const label = document.getElementById('hdCalMonthLabel');
  if (!cal) return;

  const monthLabel = new Date(hdCalYear, hdCalMonth, 1)
    .toLocaleDateString('th-TH', { year: 'numeric', month: 'long' });
  if (label) label.textContent = monthLabel;

  const holidayDates = hdGetHolidayDates();
  const today = new Date();
  const todayStr = `${today.getFullYear()}/${String(today.getMonth()+1).padStart(2,'0')}/${String(today.getDate()).padStart(2,'0')}`;

  const firstDay = new Date(hdCalYear, hdCalMonth, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(hdCalYear, hdCalMonth + 1, 0).getDate();

  const dayLabels = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
  let html = '<div class="hd-cal-grid">';

  // Day headers
  dayLabels.forEach((d, i) => {
    const wkClass = (i === 0 || i === 6) ? ' weekend' : '';
    html += `<div class="hd-cal-day-label${wkClass}">${d}</div>`;
  });

  // Empty leading cells
  for (let i = 0; i < firstDay; i++) {
    html += `<div class="hd-cal-cell empty"></div>`;
  }

  // Day cells
  for (let d = 1; d <= daysInMonth; d++) {
    const dayOfWeek = (firstDay + d - 1) % 7;
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const dateStr = `${hdCalYear}/${String(hdCalMonth + 1).padStart(2,'0')}/${String(d).padStart(2,'0')}`;
    const isHoliday = holidayDates.has(dateStr);
    const isToday = dateStr === todayStr;

    let cls = 'hd-cal-cell';
    if (isToday && isHoliday) cls += ' today holiday';
    else if (isHoliday) cls += ' holiday';
    else if (isToday) cls += ' today';
    else if (isWeekend) cls += ' weekend';

    const holiday = isHoliday ? allHolidays.find(h => h.Date === dateStr) : null;
    const title = holiday ? ` title="${escHtml(holiday['Important Day'] || '')}"` : '';

    html += `<div class="${cls}"${title}>${d}</div>`;
  }

  html += '</div>';
  cal.innerHTML = html;
}

export function hdCalPrev() {
  hdCalMonth--;
  if (hdCalMonth < 0) { hdCalMonth = 11; hdCalYear--; }
  hdCalRender();
}

export function hdCalNext() {
  hdCalMonth++;
  if (hdCalMonth > 11) { hdCalMonth = 0; hdCalYear++; }
  hdCalRender();
}

// ===================== FORM MODAL =====================
export function hdOpenModal(holidayId = null) {
  const titleEl = document.getElementById('hdModalTitle');
  const form = document.getElementById('hdForm');
  const editId = document.getElementById('hdEditingId');
  if (!form) return;

  form.reset();
  if (editId) editId.value = holidayId || '';
  if (titleEl) titleEl.textContent = holidayId ? 'แก้ไขวันหยุด' : 'เพิ่มวันหยุด';

  // Pre-fill if editing
  if (holidayId) {
    const h = allHolidays.find(x => x.ID === holidayId);
    if (h) {
      const dateEl = document.getElementById('hdDate');
      const nameEl = document.getElementById('hdName');
      if (dateEl) dateEl.value = dbDateToDisplay(h.Date);
      if (nameEl) nameEl.value = h['Important Day'] || '';
    }
  }

  showModal('holidayFormModal');
}

export function hdCloseModal() {
  closeModal('holidayFormModal');
}

// Date input helpers
export function hdAutoFormatDate(el) {
  let v = el.value.replace(/[^0-9]/g, '');
  if (v.length > 8) v = v.slice(0, 8);
  if (v.length >= 5) v = v.slice(0,2) + '/' + v.slice(2,4) + '/' + v.slice(4);
  else if (v.length >= 3) v = v.slice(0,2) + '/' + v.slice(2);
  el.value = v;
}

export function hdBlurDate(el) {
  const raw = (el.value || '').trim();
  if (!raw) { el.style.borderColor = ''; return; }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    el.style.borderColor = '';
  } else {
    el.style.borderColor = '#ef4444';
  }
}

// ===================== SUBMIT FORM =====================
export async function hdSubmitForm(event) {
  if (event) event.preventDefault();

  const dateVal  = document.getElementById('hdDate')?.value?.trim();
  const nameVal  = document.getElementById('hdName')?.value?.trim();
  const editingId = document.getElementById('hdEditingId')?.value || null;

  if (!dateVal || !/^\d{2}\/\d{2}\/\d{4}$/.test(dateVal)) {
    showToast('โปรดระบุวันที่ในรูปแบบ DD/MM/YYYY (พ.ศ.)', 'warning'); return;
  }
  if (!nameVal) {
    showToast('โปรดระบุชื่อวันหยุด', 'warning'); return;
  }

  const dbDate = formDateToDb(dateVal);
  if (!dbDate) {
    showToast('วันที่ไม่ถูกต้อง', 'warning'); return;
  }

  const btn = document.getElementById('hdBtnSave');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner" style="display:inline-block;width:16px;height:16px;margin:0 4px -3px 0;"></span> กำลังบันทึก...'; }

  try {
    const result = await window.api.saveHoliday({
      Holiday_ID:   editingId ? parseInt(editingId, 10) : null,
      Holiday_Date: dbDate,
      Holiday_Name: nameVal,
    });

    if (result?.success) {
      showToast(editingId ? 'แก้ไขวันหยุดสำเร็จ' : 'เพิ่มวันหยุดสำเร็จ', 'success');
      hdCloseModal();
      // Update year filter if newly added date differs from current selected year
      const addedYear = parseInt(dbDate.split('/')[0], 10);
      if (addedYear !== hdSelectedYear) {
        hdSelectedYear = addedYear;
        hdPopulateYearSelector();
        hdCalYear = addedYear;
        hdCalMonth = parseInt(dbDate.split('/')[1], 10) - 1;
      }
      await hdRefresh();
    } else {
      showToast(result?.message || 'บันทึกไม่สำเร็จ', 'danger');
    }
  } catch (e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'danger');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-check2-circle"></i> บันทึก'; }
  }
}

// ===================== DELETE MODAL =====================
export function hdOpenDeleteModal(holidayId, holidayName) {
  hdDeletingId = holidayId;
  const lbl = document.getElementById('hdDeleteLabel');
  if (lbl) lbl.textContent = holidayName || String(holidayId);
  showModal('holidayDeleteModal');
}

export function hdCloseDeleteModal() {
  hdDeletingId = null;
  closeModal('holidayDeleteModal');
}

export async function hdExecuteDelete() {
  if (!hdDeletingId) return;
  const id = hdDeletingId;
  hdCloseDeleteModal();
  requirePasswordConfirm(currentUser?.username || '', async () => {
    try {
      const result = await window.api.deleteHoliday(id);
      if (result?.success) {
        showToast('ลบวันหยุดสำเร็จ', 'success');
        await hdRefresh();
      } else {
        showToast(result?.message || 'ลบไม่สำเร็จ', 'danger');
      }
    } catch (e) {
      showToast('เกิดข้อผิดพลาด: ' + e.message, 'danger');
    }
  });
}
