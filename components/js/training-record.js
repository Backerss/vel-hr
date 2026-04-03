// ===================== TRAINING RECORD PAGE =====================
import { escHtml, showToast } from './utils.js';

let allPlansForRecord = [];
let currentPlan = null;
let currentParticipants = [];   // { ...dbRow, his_remark: editable }
let recordSearchTimer = null;

// ---- helpers ----
function thDate(iso) {
  if (!iso) return '-';
  const m = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
             'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  try {
    const d = new Date(iso + 'T00:00:00');
    return `${d.getDate()} ${m[d.getMonth()]} ${d.getFullYear()}`;
  } catch { return iso; }
}

// ===================== MAIN PAGE LOADER =====================
export async function loadTrainingRecordPage() {
  const container = document.getElementById('pageContent');
  container.innerHTML = `<div class="text-center py-5"><div class="spinner" style="margin:0 auto;"></div><p class="mt-3 text-muted">กำลังโหลด...</p></div>`;

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

// ===================== PAGE HTML =====================
function buildPageHTML() {
  const planOptions = allPlansForRecord.map(p =>
    `<option value="${escHtml(String(p.Plan_ID))}"
      data-courses-id="${escHtml(p.Courses_ID || '')}"
      data-courses-name="${escHtml(p.Courses_Name || '')}"
      data-start="${escHtml(p.Plan_StartDate || '')}"
      data-end="${escHtml(p.Plan_EndDate || '')}"
      data-tstart="${escHtml(p.Plan_TimeStart || '')}"
      data-tend="${escHtml(p.Plan_TimeEnd || '')}"
      data-lecturer="${escHtml(p.Plan_Lecturer || '')}"
      data-company="${escHtml(p.Plan_Company || '')}"
      data-location="${escHtml(p.Plan_Location || '')}">
      #${escHtml(String(p.Plan_ID))} — ${escHtml(p.Courses_Name || '')} (${escHtml(p.Plan_StartDate || '')})
    </option>`
  ).join('');

  return `
    <!-- Toolbar -->
    <div class="table-section" style="padding:16px 20px;margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <i class="bi bi-journal-check" style="font-size:19px;color:var(--primary);"></i>
        <span style="font-size:15px;font-weight:700;color:var(--gray-900);">บันทึกการอบรม</span>
        <div style="flex:1;"></div>
        <button class="btn-primary-custom" id="btnExportTrainingRecord" onclick="exportTrainingRecordExcel()" style="display:none;">
          <i class="bi bi-file-earmark-excel"></i> Export Excel
        </button>
      </div>
    </div>

    <!-- Plan Selector Card -->
    <div class="table-section overflow-visible" style="padding:20px 24px;margin-bottom:16px;">
      <div style="font-size:13px;font-weight:700;color:var(--gray-700);margin-bottom:12px;display:flex;align-items:center;gap:8px;">
        <i class="bi bi-search" style="color:var(--primary);"></i> เลือกแผนการอบรม
      </div>
      <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;">
        <div style="flex:1;min-width:260px;">
          <label style="font-size:12px;font-weight:600;color:var(--gray-600);display:block;margin-bottom:5px;">ค้นหาแผนอบรม (Plan ID / หลักสูตร / วันที่)</label>
          <div style="position:relative;">
            <input type="text" id="recordPlanSearch" class="form-control-m"
              placeholder="พิมพ์ค้นหา..." autocomplete="off"
              style="padding-right:32px;"
              oninput="onRecordPlanSearch()" onfocus="showRecordPlanDropdown()" onblur="hideRecordPlanDropdown()">
            <i class="bi bi-chevron-down" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);color:var(--gray-400);pointer-events:none;font-size:12px;"></i>
            <div id="recordPlanDropdown" style="display:none;position:absolute;top:calc(100% + 2px);left:0;right:0;
              background:white;border:1.5px solid var(--gray-200);border-radius:8px;
              max-height:280px;overflow-y:auto;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,.15);">
            </div>
          </div>
        </div>
        <div style="min-width:180px;">
          <label style="font-size:12px;font-weight:600;color:var(--gray-600);display:block;margin-bottom:5px;">ช่วงเวลา</label>
          <select id="recordTimeRange" class="filter-select" onchange="onRecordTimeRangeChange()" style="width:100%;">
            <option value="all">ทั้งหมด</option>
            <option value="morning">ช่วงเช้า (08.00 - 12.00)</option>
            <option value="afternoon">ช่วงบ่าย (13.00 - 17.00)</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Plan Info Card (hidden until plan selected) -->
    <div id="recordPlanInfo" class="table-section" style="display:none;padding:20px 24px;margin-bottom:16px;">
      <div style="padding:20px 24px;">
        <div style="font-size:13px;font-weight:700;color:var(--gray-700);margin-bottom:14px;display:flex;align-items:center;gap:8px;">
          <i class="bi bi-clipboard-data" style="color:var(--primary);"></i> รายละเอียดแผนการอบรม
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px 24px;">
          <div>
            <div style="font-size:11.5px;font-weight:600;color:var(--gray-500);margin-bottom:3px;">หลักสูตร</div>
            <div id="rInfoCourseID" style="font-size:13.5px;font-weight:700;color:var(--primary);"></div>
          </div>
          <div>
            <div style="font-size:11.5px;font-weight:600;color:var(--gray-500);margin-bottom:3px;">ชื่อเรื่องอบรม</div>
            <div id="rInfoCourseName" style="font-size:13.5px;font-weight:600;color:var(--gray-900);"></div>
          </div>
          <div>
            <div style="font-size:11.5px;font-weight:600;color:var(--gray-500);margin-bottom:3px;">วันที่อบรม</div>
            <div id="rInfoDate" style="font-size:13.5px;color:var(--gray-800);"></div>
          </div>
          <div>
            <div style="font-size:11.5px;font-weight:600;color:var(--gray-500);margin-bottom:3px;">เวลา</div>
            <div id="rInfoTime" style="font-size:13.5px;color:var(--gray-800);"></div>
          </div>
          <div>
            <div style="font-size:11.5px;font-weight:600;color:var(--gray-500);margin-bottom:3px;">ชื่อวิทยากร</div>
            <div id="rInfoLecturer" style="font-size:13.5px;color:var(--gray-800);"></div>
          </div>
          <div>
            <div style="font-size:11.5px;font-weight:600;color:var(--gray-500);margin-bottom:3px;">หน่วยงานที่อบรม</div>
            <div id="rInfoCompany" style="font-size:13.5px;color:var(--gray-800);"></div>
          </div>
          <div>
            <div style="font-size:11.5px;font-weight:600;color:var(--gray-500);margin-bottom:3px;">สถานที่อบรม</div>
            <div id="rInfoLocation" style="font-size:13.5px;color:var(--gray-800);"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Participants Table -->
    <div id="recordParticipantsSection" style="display:none;" class="table-section">
      <div class="table-header" style="padding:13px 20px;">
        <span class="table-title"><i class="bi bi-people-fill me-2" style="color:var(--primary);"></i>รายชื่อผู้เข้าร่วมอบรม</span>
        <span style="margin-left:auto;font-size:12.5px;color:var(--gray-500);">
          จำนวน <strong id="recordParticipantCount">0</strong> คน
        </span>
      </div>
      <div class="table-responsive-custom">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:45px;text-align:center;">#</th>
              <th style="width:100px;">รหัสพนักงาน</th>
              <th style="min-width:180px;">ชื่อ-สกุล</th>
              <th style="min-width:120px;">ตำแหน่ง</th>
              <th style="min-width:130px;">แผนก</th>
              <th style="width:130px;text-align:center;">ผลการอบรม</th>
              <th style="min-width:200px;">หมายเหตุ (Remark)</th>
            </tr>
          </thead>
          <tbody id="recordParticipantsBody">
          </tbody>
        </table>
      </div>
    </div>

    <!-- Empty state shown when no plan chosen -->
    <div id="recordEmptyState" class="table-section" style="padding:60px 20px;text-align:center;">
      <div class="empty-state">
        <div class="empty-icon"><i class="bi bi-journal-check"></i></div>
        <div class="empty-text">เลือกแผนการอบรมเพื่อดูรายชื่อผู้เข้าร่วม</div>
      </div>
    </div>`;
}

// ===================== PLAN SEARCH DROPDOWN =====================
function initPlanSearch() {
  renderRecordPlanDropdown('');
}

export function onRecordPlanSearch() {
  clearTimeout(recordSearchTimer);
  recordSearchTimer = setTimeout(() => {
    const q = (document.getElementById('recordPlanSearch')?.value || '').toLowerCase();
    renderRecordPlanDropdown(q);
    document.getElementById('recordPlanDropdown').style.display = 'block';
  }, 150);
}

export function showRecordPlanDropdown() {
  const q = (document.getElementById('recordPlanSearch')?.value || '').toLowerCase();
  renderRecordPlanDropdown(q);
  document.getElementById('recordPlanDropdown').style.display = 'block';
}

export function hideRecordPlanDropdown() {
  setTimeout(() => {
    const dd = document.getElementById('recordPlanDropdown');
    if (dd) dd.style.display = 'none';
  }, 300);
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
    dd.innerHTML = `<div style="padding:10px 14px;color:var(--gray-400);font-size:12.5px;">ไม่พบรายการ</div>`;
    return;
  }

  dd.innerHTML = filtered.slice(0, 50).map(p => `
    <div style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--gray-100);transition:background .12s;"
      onmousedown="event.preventDefault();selectRecordPlan('${p.Plan_ID}');"
      onmouseover="this.style.background='#f0f6ff'" onmouseout="this.style.background='white'">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <span style="font-size:12px;font-weight:700;color:var(--primary);">#${escHtml(String(p.Plan_ID))}</span>
        <span style="font-size:11px;color:var(--gray-400);">${escHtml(p.Plan_StartDate || '')}</span>
      </div>
      <div style="font-size:12.5px;font-weight:600;color:var(--gray-800);margin-top:2px;">${escHtml(p.Courses_Name || '-')}</div>
      <div style="font-size:11.5px;color:var(--gray-500);">${escHtml(p.Courses_ID || '')} • ${escHtml(p.Plan_Company || '-')}</div>
    </div>`
  ).join('');
}

// ===================== SELECT PLAN =====================
export async function selectRecordPlan(planId) {
  try {
    const plan = allPlansForRecord.find(p => String(p.Plan_ID) === String(planId));
    if (!plan) {
      showToast('ไม่พบแผนการอบรม #' + planId, 'error');
      return;
    }
    currentPlan = plan;
    currentParticipants = [];

    // Update search input
    const si = document.getElementById('recordPlanSearch');
    if (si) si.value = `#${plan.Plan_ID} — ${plan.Courses_Name || ''}`;
    const dd = document.getElementById('recordPlanDropdown');
    if (dd) dd.style.display = 'none';

    // Show plan info
    updatePlanInfoDisplay();

    // Load participants
    const tbody = document.getElementById('recordParticipantsBody');
    if (tbody) tbody.innerHTML = `<tr class="loading-row"><td colspan="6"><div class="spinner"></div><div>กำลังโหลดรายชื่อ...</div></td></tr>`;
    const secEl = document.getElementById('recordParticipantsSection');
    if (secEl) secEl.style.display = '';
    const emptyEl = document.getElementById('recordEmptyState');
    if (emptyEl) emptyEl.style.display = 'none';
    const btnEl = document.getElementById('btnExportTrainingRecord');
    if (btnEl) btnEl.style.display = '';

    const res = await window.api.getTrainingRecordParticipants(plan.Plan_ID);
    if (!res.success) {
      showToast('โหลดรายชื่อผู้เข้าร่วมไม่สำเร็จ: ' + res.message, 'error');
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--danger);padding:20px;">เกิดข้อผิดพลาด: ${escHtml(res.message)}</td></tr>`;
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
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || '-'; };
  set('rInfoCourseID', currentPlan.Courses_ID);
  set('rInfoCourseName', currentPlan.Courses_Name);

  const startDate = thDate(currentPlan.Plan_StartDate);
  const endDate = currentPlan.Plan_EndDate && currentPlan.Plan_EndDate !== currentPlan.Plan_StartDate
    ? ' — ' + thDate(currentPlan.Plan_EndDate) : '';
  set('rInfoDate', startDate + endDate);

  set('rInfoTime', getTimeLabel());
  set('rInfoLecturer', currentPlan.Plan_Lecturer);
  set('rInfoCompany', currentPlan.Plan_Company);
  set('rInfoLocation', currentPlan.Plan_Location);

  document.getElementById('recordPlanInfo').style.display = '';
}

function getTimeLabel() {
  const range = document.getElementById('recordTimeRange')?.value || 'all';
  if (range === 'morning') return '08.00 - 12.00 น.';
  if (range === 'afternoon') return '13.00 - 17.00 น.';
  if (!currentPlan) return '-';
  const ts = (currentPlan.Plan_TimeStart || '').substring(0, 5);
  const te = (currentPlan.Plan_TimeEnd   || '').substring(0, 5);
  return ts && te ? `${ts} - ${te} น.` : (ts || te || '-');
}

export function onRecordTimeRangeChange() {
  const el = document.getElementById('rInfoTime');
  if (el) el.textContent = getTimeLabel();
}

// ===================== RENDER PARTICIPANTS TABLE =====================
function renderParticipantsTable() {
  const tbody = document.getElementById('recordParticipantsBody');
  const countEl = document.getElementById('recordParticipantCount');
  if (!tbody) return;

  if (countEl) countEl.textContent = currentParticipants.length.toLocaleString();

  if (currentParticipants.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon"><i class="bi bi-person-x"></i></div><div class="empty-text">ไม่มีรายชื่อผู้เข้าร่วมอบรม</div></div></td></tr>`;
    return;
  }

  const stateOpts = [
    { val: '', label: '— เลือก —', color: 'var(--gray-400)' },
    { val: 'T', label: '✔ ผ่าน',   color: 'var(--success, #22c55e)' },
    { val: 'W', label: '⏳ รอ',     color: 'var(--warning, #f59e0b)' },
    { val: 'N', label: '✖ ไม่ผ่าน', color: 'var(--danger, #ef4444)' },
  ];

  tbody.innerHTML = currentParticipants.map((p, i) => {
    const state = p.his_state || '';
    const stateCfg = stateOpts.find(s => s.val === state) || stateOpts[0];
    const remarkDisabled = !state ? 'disabled' : '';
    const selectOpts = stateOpts.map(s =>
      `<option value="${s.val}" ${s.val === state ? 'selected' : ''}>${s.label}</option>`
    ).join('');
    return `
    <tr>
      <td style="text-align:center;color:var(--gray-400);font-size:12px;">${i + 1}</td>
      <td><span class="emp-id">${escHtml(p.Emp_ID || '-')}</span></td>
      <td><span class="emp-name">${escHtml(p.Fullname || '-')}</span></td>
      <td style="font-size:12.5px;">${escHtml(p.Position_Name || '-')}</td>
      <td style="font-size:12.5px;">${escHtml(p.Sub_Name || '-')}</td>
      <td style="text-align:center;">
        <select class="form-control-m" style="font-size:12.5px;padding:4px 8px;border-radius:6px;color:${stateCfg.color};font-weight:600;cursor:pointer;"
          onchange="updateRecordState(${i}, this.value)">
          ${selectOpts}
        </select>
      </td>
      <td>
        <input type="text" class="form-control-m" value="${escHtml(p.his_remark || '')}"
          placeholder="หมายเหตุ..."
          style="font-size:12.5px;padding:5px 9px;border-radius:6px;"
          ${remarkDisabled}
          oninput="updateRecordRemark(${i}, this.value)">
      </td>
    </tr>`;
  }).join('');
}

// Shared helper: persist one row to DB
async function saveParticipantRow(p) {
  if (!p || !p.his_id) return;
  const res = await window.api.saveTrainingRecordRow({
    hisId:  p.his_id,
    state:  p.his_state  || null,
    remark: p.his_remark || ''
  });
  if (!res.success) showToast('บันทึกไม่สำเร็จ: ' + res.message, 'error');
}

// Debounce timers keyed by his_id
const _remarkTimers = {};

export function updateRecordState(index, value) {
  if (currentParticipants[index] === undefined) return;
  currentParticipants[index].his_state = value;

  // Enable/disable the remark input in the same row
  const tbody = document.getElementById('recordParticipantsBody');
  if (tbody) {
    const row = tbody.querySelectorAll('tr')[index];
    if (row) {
      const remarkInput = row.querySelector('input[type="text"]');
      if (remarkInput) remarkInput.disabled = !value;
    }
  }

  // Save immediately
  saveParticipantRow(currentParticipants[index]);
}

export function updateRecordRemark(index, value) {
  if (currentParticipants[index] === undefined) return;
  currentParticipants[index].his_remark = value;

  // Debounce: save 1 second after typing stops
  const hisId = currentParticipants[index].his_id;
  clearTimeout(_remarkTimers[hisId]);
  _remarkTimers[hisId] = setTimeout(() => {
    saveParticipantRow(currentParticipants[index]);
    delete _remarkTimers[hisId];
  }, 1000);
}

// ===================== EXPORT EXCEL =====================
export async function exportTrainingRecordExcel() {
  if (!currentPlan) { showToast('กรุณาเลือกแผนการอบรมก่อน', 'error'); return; }
  if (currentParticipants.length === 0) { showToast('ไม่มีรายชื่อผู้เข้าร่วมอบรม', 'error'); return; }

  const timeRange = document.getElementById('recordTimeRange')?.value || 'all';
  showToast('กำลังสร้างไฟล์ Excel...', 'info');

  const res = await window.api.exportTrainingRecordExcel({
    plan: currentPlan,
    participants: currentParticipants,
    timeRange
  });

  if (res && res.success) {
    showToast('Export Excel สำเร็จ', 'success');
  } else if (res && res.message && res.message !== 'ยกเลิก') {
    showToast('เกิดข้อผิดพลาด: ' + res.message, 'error');
  }
}
