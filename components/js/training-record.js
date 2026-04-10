// ===================== TRAINING RECORD PAGE — CHECK-IN =====================
import { escHtml, showToast } from './utils.js';

let allPlansForRecord   = [];
let currentPlan         = null;
let currentSession      = null;  // 'D' | 'N' | 'T'
let currentParticipants = [];
let planSearchTimer     = null;
let empSearchTimer      = null;
let empDropdownItems    = [];
let empDropdownIndex    = -1;
let tableCurrentPage    = 1;
const TABLE_PAGE_SIZE   = 10;

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function thDate(iso) {
  if (!iso) return '-';
  const m = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
             'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  try {
    const d = new Date(iso + 'T00:00:00');
    return `${d.getDate()} ${m[d.getMonth()]} ${d.getFullYear() + 543}`;
  } catch { return iso; }
}

function toMinutes(hhmm) {
  if (!hhmm) return 0;
  const parts = String(hhmm).substring(0, 5).split(':');
  return (Number(parts[0]) || 0) * 60 + (Number(parts[1]) || 0);
}

function detectSessions(plan) {
  const startMin = toMinutes(plan.Plan_TimeStart || '00:00');
  const endMin   = toMinutes(plan.Plan_TimeEnd   || '23:59');
  if (endMin <= 12 * 60) return ['D'];
  if (startMin >= 13 * 60) return ['N'];
  return ['D', 'N', 'T'];
}

function stateInfo(state) {
  if (state === 'D') return { text: 'เช้า ✓',   short: 'เช้า', color: '#1a56db', bg: '#dbeafe', icon: 'bi-sunrise' };
  if (state === 'N') return { text: 'บ่าย ✓',   short: 'บ่าย', color: '#b45309', bg: '#fef3c7', icon: 'bi-brightness-high' };
  if (state === 'T') return { text: 'ผ่านแล้ว', short: 'ผ่าน', color: '#065f46', bg: '#d1fae5', icon: 'bi-patch-check-fill' };
  return                    { text: 'รอ',        short: 'รอ',   color: '#64748b', bg: '#f1f5f9', icon: 'bi-hourglass-split' };
}

// ─────────────────────────────────────────────
// Main Loader
// ─────────────────────────────────────────────
export async function loadTrainingRecordPage() {
  const container = document.getElementById('pageContent');
  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:200px;">
      <div style="text-align:center;">
        <div class="spinner" style="margin:0 auto 12px;"></div>
        <p style="color:var(--gray-400);font-size:13px;">กำลังโหลดข้อมูล...</p>
      </div>
    </div>`;

  const res = await window.api.getTrainingPlansForRecord();
  if (!res.success) {
    showToast('โหลดรายการอบรมไม่สำเร็จ: ' + res.message, 'error');
    allPlansForRecord = [];
  } else {
    allPlansForRecord = res.data || [];
  }

  container.innerHTML = buildPageHTML();
  initPlanSearch();
}

// ─────────────────────────────────────────────
// Page HTML
// ─────────────────────────────────────────────
function buildPageHTML() {
  return `
  <!-- ── Toolbar ── -->
  <div class="table-section" style="padding:14px 20px;margin-bottom:16px;">
    <div style="display:flex;align-items:center;gap:12px;">
      <div style="width:36px;height:36px;border-radius:10px;background:var(--primary-light);
        display:flex;align-items:center;justify-content:center;">
        <i class="bi bi-journal-check" style="font-size:18px;color:var(--primary);"></i>
      </div>
      <div>
        <div style="font-size:15px;font-weight:700;color:var(--gray-900);">บันทึกการอบรม</div>
        <div style="font-size:11.5px;color:var(--gray-400);">เช็คชื่อผู้เข้าร่วมอบรม</div>
      </div>
      <div style="flex:1;"></div>
      <button class="btn-primary-custom" id="btnExportTrainingRecord"
        onclick="exportTrainingRecordExcel()" style="display:none;">
        <i class="bi bi-file-earmark-excel"></i> Export Excel
      </button>
    </div>
  </div>

  <!-- ── Step 1: Select Plan (overflow:visible to prevent dropdown clipping) ── -->
  <div style="background:white;border-radius:var(--border-radius);border:1px solid var(--gray-200);
    box-shadow:var(--shadow-sm);padding:20px 24px;margin-bottom:14px;overflow:visible;position:relative;">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
      <span style="background:var(--primary);color:white;width:22px;height:22px;border-radius:50%;
        display:inline-flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:700;">1</span>
      <span style="font-size:13px;font-weight:700;color:var(--gray-800);">เลือกแผนการอบรม</span>
    </div>
    <div style="max-width:560px;position:relative;z-index:200;">
      <label style="font-size:12px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:5px;">
        ค้นหาด้วย Plan ID / ชื่อหลักสูตร / วันที่
      </label>
      <div style="position:relative;">
        <i class="bi bi-search" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);
          color:var(--gray-400);font-size:13px;pointer-events:none;z-index:1;"></i>
        <input type="text" id="recordPlanSearch" class="form-control-m"
          placeholder="พิมพ์เพื่อค้นหาแผน..." autocomplete="off"
          style="padding-left:32px;padding-right:10px;"
          oninput="onRecordPlanSearch()" onfocus="showRecordPlanDropdown()" onblur="hideRecordPlanDropdown()">
        <div id="recordPlanDropdown"
          style="display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;
          background:white;border:1.5px solid var(--gray-200);border-radius:10px;
          max-height:320px;overflow-y:auto;z-index:9999;
          box-shadow:0 12px 32px rgba(0,0,0,.18);">
        </div>
      </div>
    </div>
  </div>

  <!-- ── Plan Info Banner (full width, shown after plan selected) ── -->
  <div id="recordPlanInfo" style="display:none;margin-bottom:14px;">
    <div style="background:linear-gradient(135deg,#1a56db 0%,#1044b0 100%);border-radius:var(--border-radius);
      padding:16px 24px;display:flex;align-items:flex-start;gap:14px;">
      <div style="width:42px;height:42px;border-radius:12px;background:rgba(255,255,255,.15);
        flex-shrink:0;display:flex;align-items:center;justify-content:center;">
        <i class="bi bi-mortarboard-fill" style="font-size:20px;color:white;"></i>
      </div>
      <div style="flex:1;">
        <div style="font-size:14.5px;font-weight:700;color:white;" id="rInfoCourseName">-</div>
        <div style="font-size:12px;color:rgba(255,255,255,.7);margin-top:4px;
          display:flex;gap:18px;flex-wrap:wrap;">
          <span id="rInfoCourseID"></span>
          <span><i class="bi bi-calendar3" style="margin-right:4px;"></i><span id="rInfoDate"></span></span>
          <span><i class="bi bi-clock" style="margin-right:4px;"></i><span id="rInfoTime"></span></span>
          <span><i class="bi bi-person" style="margin-right:4px;"></i><span id="rInfoLecturer"></span></span>
          <span><i class="bi bi-geo-alt" style="margin-right:4px;"></i><span id="rInfoLocation"></span></span>
        </div>
      </div>
    </div>
  </div>

  <!-- ── 2-column main layout (shown after plan selected) ── -->
  <div id="recordMainLayout" style="display:none;gap:14px;align-items:flex-start;">

    <!-- LEFT: Steps 2 & 3 -->
    <div style="width:360px;flex-shrink:0;display:flex;flex-direction:column;gap:14px;">

      <!-- Step 2: Session -->
      <div class="table-section" style="padding:18px 20px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
          <span style="background:var(--primary);color:white;width:22px;height:22px;border-radius:50%;
            display:inline-flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:700;">2</span>
          <span style="font-size:13px;font-weight:700;color:var(--gray-800);">เลือกช่วงเช็คชื่อ</span>
        </div>
        <div id="sessionButtons" style="display:flex;flex-direction:column;gap:8px;"></div>
      </div>

      <!-- Step 3: Check-in input (shown after session selected) -->
      <div id="checkinInputSection" class="table-section" style="padding:18px 20px;display:none;overflow:visible;position:relative;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
          <span style="background:var(--primary);color:white;width:22px;height:22px;border-radius:50%;
            display:inline-flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:700;">3</span>
          <span style="font-size:13px;font-weight:700;color:var(--gray-800);">เช็คชื่อพนักงาน</span>
          <span id="currentSessionLabel" style="font-size:12px;padding:2px 10px;border-radius:20px;font-weight:600;"></span>
        </div>
        <div style="position:relative;z-index:100;">
          <div style="position:relative;">
            <i class="bi bi-person-search" style="position:absolute;left:11px;top:50%;transform:translateY(-50%);
              color:var(--primary);font-size:15px;pointer-events:none;z-index:1;"></i>
            <input type="text" id="empCheckinInput" class="form-control-m"
              placeholder="รหัส / ชื่อ / แผนก..."
              autocomplete="off"
              style="padding-left:36px;font-size:13px;width:100%;"
              oninput="onEmpCheckinSearch()"
              onkeydown="onEmpCheckinKeydown(event)"
              onblur="hideEmpDropdown()">
            <div id="empCheckinDropdown"
              style="display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;
              background:white;border:1.5px solid var(--gray-200);border-radius:10px;
              max-height:300px;overflow-y:auto;z-index:9999;
              box-shadow:0 12px 32px rgba(0,0,0,.18);">
            </div>
          </div>
          <div style="margin-top:8px;font-size:11.5px;color:var(--gray-400);">
            <i class="bi bi-keyboard" style="margin-right:4px;"></i>กด
            <kbd style="background:var(--gray-100);border:1px solid var(--gray-300);
              border-radius:4px;padding:1px 5px;font-size:11px;">Enter</kbd>
            หรือคลิกรายชื่อเพื่อเช็ค
          </div>
        </div>
      </div>

    </div><!-- /LEFT -->

    <!-- RIGHT: Participants table -->
    <div style="flex:1;min-width:0;" class="table-section">
      <div class="table-header" style="padding:13px 18px;">
        <span class="table-title" style="font-size:13px;">
          <i class="bi bi-people-fill me-2" style="color:var(--primary);"></i>รายชื่อผู้เข้าร่วมอบรม
        </span>
        <div style="margin-left:auto;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <div id="recordStatBadges" style="display:flex;gap:6px;flex-wrap:wrap;"></div>
          <span style="font-size:12px;color:var(--gray-500);white-space:nowrap;">
            ทั้งหมด <strong id="recordParticipantCount">0</strong> คน
          </span>
        </div>
      </div>
      <div class="table-responsive-custom">
        <table class="data-table" style="font-size:12.5px;">
          <thead>
            <tr>
              <th style="width:38px;text-align:center;">#</th>
              <th style="width:100px;">รหัส</th>
              <th style="min-width:150px;">ชื่อ-สกุล</th>
              <th style="min-width:100px;">ตำแหน่ง</th>
              <th style="min-width:100px;">แผนก</th>
              <th style="width:120px;text-align:center;">สถานะ</th>
              <th style="min-width:150px;">หมายเหตุ</th>
              <th style="width:52px;text-align:center;">ยกเลิก</th>
            </tr>
          </thead>
          <tbody id="recordParticipantsBody"></tbody>
        </table>
      </div>
      <div id="recordPagination"></div>
    </div><!-- /RIGHT -->

  </div><!-- /recordMainLayout -->

  <!-- ── Empty State ── -->
  <div id="recordEmptyState" class="table-section" style="padding:70px 20px;text-align:center;">
    <div class="empty-state">
      <div class="empty-icon"><i class="bi bi-journal-check"></i></div>
      <div class="empty-text">เลือกแผนการอบรมเพื่อเริ่มต้นเช็คชื่อ</div>
    </div>
  </div>`;
}

// ─────────────────────────────────────────────
// Plan Search & Selection
// ─────────────────────────────────────────────
function initPlanSearch() {
  renderRecordPlanDropdown('');
}

export function onRecordPlanSearch() {
  clearTimeout(planSearchTimer);
  planSearchTimer = setTimeout(() => {
    const q = (document.getElementById('recordPlanSearch')?.value || '').toLowerCase();
    renderRecordPlanDropdown(q);
    const dd = document.getElementById('recordPlanDropdown');
    if (dd) dd.style.display = 'block';
  }, 150);
}

export function showRecordPlanDropdown() {
  const q = (document.getElementById('recordPlanSearch')?.value || '').toLowerCase();
  renderRecordPlanDropdown(q);
  const dd = document.getElementById('recordPlanDropdown');
  if (dd) dd.style.display = 'block';
}

export function hideRecordPlanDropdown() {
  setTimeout(() => {
    const dd = document.getElementById('recordPlanDropdown');
    if (dd) dd.style.display = 'none';
  }, 200);
}

function renderRecordPlanDropdown(q) {
  const dd = document.getElementById('recordPlanDropdown');
  if (!dd) return;
  const filtered = q
    ? allPlansForRecord.filter(p =>
        String(p.Plan_ID).includes(q) ||
        (p.Courses_Name || '').toLowerCase().includes(q) ||
        (p.Plan_StartDate || '').includes(q) ||
        (p.Courses_ID || '').toLowerCase().includes(q)
      )
    : allPlansForRecord;

  if (filtered.length === 0) {
    dd.innerHTML = `<div style="padding:12px 16px;color:var(--gray-400);font-size:12.5px;text-align:center;">
      <i class="bi bi-search me-2"></i>ไม่พบรายการ</div>`;
    return;
  }

  dd.innerHTML = filtered.slice(0, 60).map(p => `
    <div style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--gray-100);transition:background .1s;"
      onmousedown="event.preventDefault();selectRecordPlan('${p.Plan_ID}');"
      onmouseover="this.style.background='#f0f6ff'" onmouseout="this.style.background=''">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <span style="font-size:12px;font-weight:700;color:var(--primary);background:var(--primary-light);
          padding:1px 7px;border-radius:20px;">#${escHtml(String(p.Plan_ID))}</span>
        <span style="font-size:11px;color:var(--gray-400);">${escHtml(p.Plan_StartDate || '')}</span>
      </div>
      <div style="font-size:13px;font-weight:600;color:var(--gray-800);margin-top:4px;">
        ${escHtml(p.Courses_Name || '-')}</div>
      <div style="font-size:11.5px;color:var(--gray-500);margin-top:2px;">
        ${escHtml(p.Courses_ID || '')}
        ${p.Plan_TimeStart ? '• ' + escHtml(String(p.Plan_TimeStart).substring(0,5))
          + (p.Plan_TimeEnd ? ' – ' + escHtml(String(p.Plan_TimeEnd).substring(0,5)) : '') + ' น.' : ''}
      </div>
    </div>`
  ).join('');
}

export async function selectRecordPlan(planId) {
  try {
    const plan = allPlansForRecord.find(p => String(p.Plan_ID) === String(planId));
    if (!plan) { showToast('ไม่พบแผนการอบรม #' + planId, 'error'); return; }
    currentPlan = plan;
    currentSession = null;
    currentParticipants = [];

    const si = document.getElementById('recordPlanSearch');
    if (si) si.value = `#${plan.Plan_ID} — ${plan.Courses_Name || ''}`;
    const dd = document.getElementById('recordPlanDropdown');
    if (dd) dd.style.display = 'none';

    updatePlanInfoDisplay();
    renderSessionButtons();

    const checkinSec = document.getElementById('checkinInputSection');
    if (checkinSec) checkinSec.style.display = 'none';

    document.getElementById('recordPlanInfo').style.display = '';
    const mainLayout = document.getElementById('recordMainLayout');
    if (mainLayout) mainLayout.style.display = 'flex';
    document.getElementById('recordEmptyState').style.display = 'none';

    tableCurrentPage = 1;
    const tbody  = document.getElementById('recordParticipantsBody');
    if (tbody)  tbody.innerHTML = `<tr class="loading-row"><td colspan="8">
      <div class="spinner"></div><div>กำลังโหลดรายชื่อ...</div></td></tr>`;
    const pag = document.getElementById('recordPagination');
    if (pag) pag.innerHTML = '';

    const btnExport = document.getElementById('btnExportTrainingRecord');
    if (btnExport) btnExport.style.display = '';

    const res = await window.api.getTrainingRecordParticipants(plan.Plan_ID);
    if (!res.success) {
      showToast('โหลดรายชื่อไม่สำเร็จ: ' + res.message, 'error');
      if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;
        color:var(--danger);padding:20px;">เกิดข้อผิดพลาด: ${escHtml(res.message)}</td></tr>`;
      return;
    }
    currentParticipants = (res.data || []).map(p => ({ ...p, his_remark: p.his_remark || '' }));
    renderParticipantsTable();
  } catch (e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'error');
    console.error('[selectRecordPlan]', e);
  }
}

function updatePlanInfoDisplay() {
  if (!currentPlan) return;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v || '-'; };
  set('rInfoCourseName', currentPlan.Courses_Name);
  set('rInfoCourseID',   currentPlan.Courses_ID ? `รหัสหลักสูตร: ${currentPlan.Courses_ID}` : '');

  const startDate = thDate(currentPlan.Plan_StartDate);
  const endDate   = currentPlan.Plan_EndDate && currentPlan.Plan_EndDate !== currentPlan.Plan_StartDate
    ? ' — ' + thDate(currentPlan.Plan_EndDate) : '';
  set('rInfoDate', startDate + endDate);

  const ts = String(currentPlan.Plan_TimeStart || '').substring(0, 5);
  const te = String(currentPlan.Plan_TimeEnd   || '').substring(0, 5);
  set('rInfoTime', ts && te ? `${ts} – ${te} น.` : (ts || te || '-'));
  set('rInfoLecturer', currentPlan.Plan_Lecturer);
  const loc = [currentPlan.Plan_Company, currentPlan.Plan_Location].filter(Boolean).join(' / ');
  set('rInfoLocation', loc || '-');
}

// ─────────────────────────────────────────────
// Session Buttons
// ─────────────────────────────────────────────
function renderSessionButtons() {
  const container = document.getElementById('sessionButtons');
  if (!container || !currentPlan) return;

  const available = detectSessions(currentPlan);
  const defs = [
    { key: 'D', icon: 'bi-sunrise',         label: 'ช่วงเช้า', sub: '08.00 – 12.00 น.' },
    { key: 'N', icon: 'bi-brightness-high',  label: 'ช่วงบ่าย', sub: '13.00 – 17.00 น.' },
    { key: 'T', icon: 'bi-patch-check-fill', label: 'ทั้งวัน',  sub: 'เช้า + บ่าย' },
  ];

  container.innerHTML = defs.map(def => {
    const isEnabled = available.includes(def.key);
    const isActive  = currentSession === def.key;
    const activeStyle = isActive
      ? 'background:var(--primary);color:white;border-color:var(--primary);'
      : isEnabled
        ? 'background:white;color:var(--gray-700);border-color:var(--gray-300);cursor:pointer;'
        : 'background:var(--gray-100);color:var(--gray-300);border-color:var(--gray-200);cursor:not-allowed;opacity:.55;';
    return `
    <button onclick="${isEnabled ? `selectSession('${def.key}')` : ''}"
      style="display:flex;align-items:center;gap:10px;border:2px solid;border-radius:10px;
        padding:10px 14px;font-size:13px;font-weight:600;transition:all .15s;width:100%;
        text-align:left;${activeStyle}">
      <i class="bi ${def.icon}" style="font-size:18px;flex-shrink:0;"></i>
      <div style="flex:1;"><div>${def.label}</div>
        <div style="font-size:11px;font-weight:400;opacity:.75;">${def.sub}</div>
      </div>
      ${isActive ? '<i class="bi bi-check-circle-fill" style="font-size:16px;flex-shrink:0;"></i>' : ''}
    </button>`;
  }).join('');
}

export function selectSession(session) {
  currentSession = session;
  renderSessionButtons();

  const checkinSec = document.getElementById('checkinInputSection');
  if (checkinSec) checkinSec.style.display = '';

  const info  = stateInfo(session);
  const label = document.getElementById('currentSessionLabel');
  if (label) {
    const names = { D: 'เช็คช่วงเช้า', N: 'เช็คช่วงบ่าย', T: 'เช็คทั้งวัน' };
    label.textContent = names[session] || '';
    label.style.cssText = `font-size:12px;padding:2px 10px;border-radius:20px;font-weight:600;
      background:${info.bg};color:${info.color};`;
  }

  setTimeout(() => {
    const inp = document.getElementById('empCheckinInput');
    if (inp) inp.focus();
  }, 50);
}

// ─────────────────────────────────────────────
// Employee Search & Check-in
// ─────────────────────────────────────────────
export function onEmpCheckinSearch() {
  clearTimeout(empSearchTimer);
  const q = (document.getElementById('empCheckinInput')?.value || '').trim();
  if (!q) { hideEmpDropdown(); return; }
  empSearchTimer = setTimeout(async () => {
    const res = await window.api.searchEmployees({ keyword: q, limit: 20 });
    if (!res.success) return;
    empDropdownItems = res.data || [];
    empDropdownIndex = -1;
    renderEmpDropdown();
  }, 200);
}

function renderEmpDropdown() {
  const dd = document.getElementById('empCheckinDropdown');
  if (!dd) return;
  if (empDropdownItems.length === 0) {
    dd.innerHTML = `<div style="padding:12px 16px;color:var(--gray-400);text-align:center;font-size:12.5px;">
      ไม่พบพนักงาน</div>`;
    dd.style.display = 'block';
    return;
  }
  dd.innerHTML = empDropdownItems.map((e, i) => {
    const existing = currentParticipants.find(p => p.Emp_ID === e.Emp_ID);
    const info = existing ? stateInfo(existing.his_state) : null;
    const badge = info
      ? `<span style="font-size:11px;padding:1px 7px;border-radius:20px;font-weight:600;
          background:${info.bg};color:${info.color};">${info.short}</span>` : '';
    const highlighted = empDropdownIndex === i ? 'background:#f0f6ff;' : '';
    return `
    <div data-idx="${i}"
      style="padding:9px 14px;cursor:pointer;border-bottom:1px solid var(--gray-100);
        transition:background .1s;${highlighted}"
      onmousedown="event.preventDefault();checkinEmployee('${escHtml(e.Emp_ID)}');"
      onmouseover="highlightEmpItem(${i})" onmouseout="this.style.background=''">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <span class="emp-id">${escHtml(e.Emp_ID)}</span>
        ${badge}
      </div>
      <div style="font-size:13px;font-weight:600;color:var(--gray-800);margin-top:2px;">
        ${escHtml(e.Fullname || '-')}</div>
      <div style="font-size:11.5px;color:var(--gray-500);">${escHtml(e.Sub_Name || '-')}</div>
    </div>`;
  }).join('');
  dd.style.display = 'block';
}

export function highlightEmpItem(idx) {
  empDropdownIndex = idx;
  const dd = document.getElementById('empCheckinDropdown');
  if (!dd) return;
  dd.querySelectorAll('[data-idx]').forEach(el => {
    el.style.background = Number(el.dataset.idx) === idx ? '#f0f6ff' : '';
  });
}

export function hideEmpDropdown() {
  setTimeout(() => {
    const dd = document.getElementById('empCheckinDropdown');
    if (dd) dd.style.display = 'none';
  }, 200);
}

export function onEmpCheckinKeydown(e) {
  const dd = document.getElementById('empCheckinDropdown');
  if (!dd || dd.style.display === 'none') {
    if (e.key === 'Enter') {
      const q = (document.getElementById('empCheckinInput')?.value || '').trim();
      if (q) checkinEmployee(q);
    }
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    empDropdownIndex = Math.min(empDropdownIndex + 1, empDropdownItems.length - 1);
    renderEmpDropdown(); return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    empDropdownIndex = Math.max(empDropdownIndex - 1, 0);
    renderEmpDropdown(); return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    const idx = empDropdownIndex >= 0 ? empDropdownIndex : 0;
    if (empDropdownItems[idx]) checkinEmployee(empDropdownItems[idx].Emp_ID);
    return;
  }
  if (e.key === 'Escape') hideEmpDropdown();
}

export async function checkinEmployee(empId) {
  if (!currentPlan)    { showToast('กรุณาเลือกแผนการอบรมก่อน', 'error'); return; }
  if (!currentSession) { showToast('กรุณาเลือกช่วงเวลาก่อน', 'error'); return; }

  const inp = document.getElementById('empCheckinInput');
  if (inp) inp.value = '';
  const dd = document.getElementById('empCheckinDropdown');
  if (dd) dd.style.display = 'none';
  empDropdownItems = [];
  empDropdownIndex = -1;

  try {
    const res = await window.api.checkinTraining({
      planId:  currentPlan.Plan_ID,
      empId,
      session: currentSession,
      remark:  ''
    });
    if (!res.success) {
      if (res.notRegistered) {
        showToast(`พนักงาน ${escHtml(String(empId))} ไม่มีชื่อในรายการอบรมนี้`, 'error');
      } else {
        showToast('เช็คชื่อไม่สำเร็จ: ' + res.message, 'error');
      }
      setTimeout(() => { const inp = document.getElementById('empCheckinInput'); if (inp) inp.focus(); }, 80);
      return;
    }

    const listRes = await window.api.getTrainingRecordParticipants(currentPlan.Plan_ID);
    if (listRes.success) {
      currentParticipants = (listRes.data || []).map(p => ({ ...p, his_remark: p.his_remark || '' }));
      renderParticipantsTable();
    }
    const info = stateInfo(res.newState);
    showToast(`เช็คชื่อสำเร็จ: ${escHtml(empId || '')} — ${info.text}`, 'success');
    setTimeout(() => { if (inp) inp.focus(); }, 80);
  } catch (e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'error');
  }
}

// ─────────────────────────────────────────────
// Participants Table (with pagination)
// ─────────────────────────────────────────────
function renderParticipantsTable() {
  const tbody   = document.getElementById('recordParticipantsBody');
  const countEl = document.getElementById('recordParticipantCount');
  if (!tbody) return;

  if (countEl) countEl.textContent = currentParticipants.length.toLocaleString();
  updateStatBadges();

  if (currentParticipants.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8">
      <div class="empty-state"><div class="empty-icon"><i class="bi bi-person-x"></i></div>
      <div class="empty-text">ยังไม่มีผู้ลงทะเบียน</div></div></td></tr>`;
    renderPagination(0);
    return;
  }

  const totalPages = Math.ceil(currentParticipants.length / TABLE_PAGE_SIZE);
  if (tableCurrentPage > totalPages) tableCurrentPage = totalPages;
  if (tableCurrentPage < 1) tableCurrentPage = 1;

  const startIdx = (tableCurrentPage - 1) * TABLE_PAGE_SIZE;
  const pageData = currentParticipants.slice(startIdx, startIdx + TABLE_PAGE_SIZE);

  tbody.innerHTML = pageData.map((p, i) => {
    const absIdx  = startIdx + i;
    const info    = stateInfo(p.his_state);
    const canUndo = p.his_state && p.his_state !== 'W' && p.his_state !== 'Pending';
    const rowBg   = p.his_state === 'T' ? 'background:#f0fdf4;' : '';
    return `
    <tr style="${rowBg}">
      <td style="text-align:center;color:var(--gray-400);font-size:12px;">${startIdx + i + 1}</td>
      <td><span class="emp-id" style="font-size:12px;">${escHtml(p.Emp_ID || '-')}</span></td>
      <td style="font-weight:600;color:var(--gray-900);">${escHtml(p.Fullname || '-')}</td>
      <td style="color:var(--gray-600);">${escHtml(p.Position_Name || '-')}</td>
      <td style="color:var(--gray-600);">${escHtml(p.Sub_Name || '-')}</td>
      <td style="text-align:center;">
        <span style="display:inline-flex;align-items:center;gap:4px;padding:3px 9px;
          border-radius:20px;font-size:11.5px;font-weight:700;
          background:${info.bg};color:${info.color};white-space:nowrap;">
          <i class="bi ${info.icon}"></i>${info.text}
        </span>
      </td>
      <td>
        <input type="text" class="form-control-m" value="${escHtml(p.his_remark || '')}"
          placeholder="หมายเหตุ..."
          style="font-size:12px;padding:4px 8px;border-radius:6px;"
          oninput="updateRecordRemark(${absIdx}, this.value)">
      </td>
      <td style="text-align:center;">
        ${canUndo ? `
        <button onclick="undoCheckin(${absIdx})"
          title="ยกเลิกการเช็คชื่อ"
          style="background:none;border:1.5px solid var(--gray-300);border-radius:6px;
            padding:3px 6px;cursor:pointer;color:var(--gray-400);transition:all .15s;"
          onmouseover="this.style.borderColor='var(--danger)';this.style.color='var(--danger)'"
          onmouseout="this.style.borderColor='var(--gray-300)';this.style.color='var(--gray-400)'">
          <i class="bi bi-arrow-counterclockwise"></i>
        </button>` : ''}
      </td>
    </tr>`;
  }).join('');

  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  const el = document.getElementById('recordPagination');
  if (!el) return;
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  const cur = tableCurrentPage;
  const showPages = new Set(
    [1, totalPages, cur, cur - 1, cur + 1].filter(p => p >= 1 && p <= totalPages)
  );
  const sorted = [...showPages].sort((a, b) => a - b);

  let html = `<div style="display:flex;align-items:center;justify-content:space-between;
    padding:10px 16px;border-top:1px solid var(--gray-100);flex-wrap:wrap;gap:8px;">`;

  html += `<span style="font-size:12px;color:var(--gray-500);">
    แสดง ${(cur - 1) * TABLE_PAGE_SIZE + 1}–${Math.min(cur * TABLE_PAGE_SIZE, currentParticipants.length)}
    จาก ${currentParticipants.length} คน
  </span>`;

  html += `<div style="display:flex;align-items:center;gap:5px;">`;
  html += `<button onclick="goToRecordPage(${cur - 1})" ${cur <= 1 ? 'disabled' : ''}
    style="width:30px;height:30px;border-radius:6px;border:1.5px solid var(--gray-200);
      background:white;cursor:${cur <= 1 ? 'default' : 'pointer'};color:var(--gray-500);
      opacity:${cur <= 1 ? '.4' : '1'};font-size:13px;">
    <i class="bi bi-chevron-left"></i></button>`;

  let prev = 0;
  for (const pg of sorted) {
    if (pg - prev > 1) {
      html += `<span style="color:var(--gray-300);padding:0 2px;font-size:13px;">…</span>`;
    }
    const active = pg === cur;
    html += `<button onclick="goToRecordPage(${pg})"
      style="min-width:30px;height:30px;padding:0 6px;border-radius:6px;
        border:1.5px solid ${active ? 'var(--primary)' : 'var(--gray-200)'};
        background:${active ? 'var(--primary)' : 'white'};
        color:${active ? 'white' : 'var(--gray-700)'};
        font-size:12.5px;font-weight:${active ? '700' : '500'};
        cursor:pointer;transition:all .12s;">
      ${pg}</button>`;
    prev = pg;
  }

  html += `<button onclick="goToRecordPage(${cur + 1})" ${cur >= totalPages ? 'disabled' : ''}
    style="width:30px;height:30px;border-radius:6px;border:1.5px solid var(--gray-200);
      background:white;cursor:${cur >= totalPages ? 'default' : 'pointer'};color:var(--gray-500);
      opacity:${cur >= totalPages ? '.4' : '1'};font-size:13px;">
    <i class="bi bi-chevron-right"></i></button>`;

  html += `</div></div>`;
  el.innerHTML = html;
}

export function goToRecordPage(page) {
  tableCurrentPage = page;
  renderParticipantsTable();
}

function updateStatBadges() {
  const container = document.getElementById('recordStatBadges');
  if (!container) return;
  const count = { T: 0, D: 0, N: 0, W: 0 };
  currentParticipants.forEach(p => {
    if      (p.his_state === 'T') count.T++;
    else if (p.his_state === 'D') count.D++;
    else if (p.his_state === 'N') count.N++;
    else count.W++;
  });
  container.innerHTML = [
    count.T > 0 ? `<span style="font-size:11.5px;padding:2px 9px;border-radius:20px;font-weight:600;
      background:#d1fae5;color:#065f46;"><i class="bi bi-patch-check-fill me-1"></i>ผ่าน ${count.T}</span>` : '',
    count.D > 0 ? `<span style="font-size:11.5px;padding:2px 9px;border-radius:20px;font-weight:600;
      background:#dbeafe;color:#1a56db;"><i class="bi bi-sunrise me-1"></i>เช้า ${count.D}</span>` : '',
    count.N > 0 ? `<span style="font-size:11.5px;padding:2px 9px;border-radius:20px;font-weight:600;
      background:#fef3c7;color:#b45309;"><i class="bi bi-brightness-high me-1"></i>บ่าย ${count.N}</span>` : '',
    count.W > 0 ? `<span style="font-size:11.5px;padding:2px 9px;border-radius:20px;font-weight:600;
      background:#f1f5f9;color:#64748b;"><i class="bi bi-hourglass-split me-1"></i>รอ ${count.W}</span>` : '',
  ].filter(Boolean).join('');
}

// ─────────────────────────────────────────────
// Remark & Undo  
// ─────────────────────────────────────────────
const _remarkTimers = {};

export function updateRecordRemark(index, value) {
  if (!currentParticipants[index]) return;
  currentParticipants[index].his_remark = value;
  const hisId = currentParticipants[index].his_id;
  if (!hisId) return;
  clearTimeout(_remarkTimers[hisId]);
  _remarkTimers[hisId] = setTimeout(async () => {
    await window.api.saveTrainingRecordRow({
      hisId,
      state:  currentParticipants[index].his_state || null,
      remark: value
    });
    delete _remarkTimers[hisId];
  }, 900);
}

export async function undoCheckin(index) {
  const p = currentParticipants[index];
  if (!p || !p.his_id) return;
  const res = await window.api.undoCheckinTraining({ hisId: p.his_id });
  if (!res.success) { showToast('ยกเลิกไม่สำเร็จ: ' + res.message, 'error'); return; }
  currentParticipants[index].his_state = 'W';
  renderParticipantsTable();
  showToast(`ยกเลิกเช็คชื่อ: ${p.Emp_ID} — คืนสถานะรอ`, 'info');
}

// ─────────────────────────────────────────────
// Export Excel
// ─────────────────────────────────────────────
export async function exportTrainingRecordExcel() {
  if (!currentPlan) { showToast('กรุณาเลือกแผนการอบรมก่อน', 'error'); return; }
  if (currentParticipants.length === 0) { showToast('ไม่มีรายชื่อผู้เข้าร่วม', 'error'); return; }
  showToast('กำลังสร้างไฟล์ Excel...', 'info');
  const res = await window.api.exportTrainingRecordExcel({
    plan:         currentPlan,
    participants: currentParticipants,
    timeRange:    currentSession === 'D' ? 'morning' : currentSession === 'N' ? 'afternoon' : 'all'
  });
  if (res && res.success) {
    showToast('Export Excel สำเร็จ', 'success');
  } else if (res && res.message && res.message !== 'ยกเลิก') {
    showToast('เกิดข้อผิดพลาด: ' + res.message, 'error');
  }
}

