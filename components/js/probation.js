// ===================== PROBATION EVALUATION MODULE =====================
// Follows the same patterns as leave.js / courses.js / training-plan.js
// All sub-views rendered inline (no additional HTML fetch for detail views)
// ======================================================================
import { escHtml, showToast, showModal, closeModal, isoDateToDisplayDate, displayDateToIso } from './utils.js';

// ── Module state ─────────────────────────────────────────────────────
let probCurrentPage  = 1;
let probPerPage      = 50;
let probTotalCount   = 0;
let probSearchTimer  = null;
let probSearchValue  = '';

// Criteria module state
let allCriteria      = [];
let filteredCriteria = [];
let pcSearchTimer    = null;

// ── Helpers ──────────────────────────────────────────────────────────
function probFmtDate(iso) {
  if (!iso || iso === '0000-00-00') return '-';
  try {
    const raw = typeof iso === 'string' ? iso.trim() : String(iso);
    const normalized = raw.includes('T')
      ? raw.split('T')[0]
      : (raw.match(/^\d{4}-\d{2}-\d{2}/)?.[0] || raw);

    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      const [y, m, d] = normalized.split('-');
      return `${y}/${m}/${d}`;
    }

    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
      return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
    }

    return raw;
  } catch { return iso; }
}

function probTodayIso() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
}

function addDaysIso(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/** Add 1 day to a YYYY-MM-DD string */
function addOneDayIso(isoDate) {
  return addDaysIso(isoDate, 1);
}

/** Calculate grade from average percentage */
function calcGrade(avg) {
  if (avg == null) return '-';
  if (avg >= 90) return 'A';
  if (avg >= 80) return 'B';
  if (avg >= 70) return 'C';
  if (avg >= 60) return 'D';
  return 'F';
}

/** Grade badge HTML */
function gradeBadge(grade) {
  const map = { A:'success', B:'primary', C:'warning', D:'warning', F:'danger', '-':'secondary' };
  const color = map[grade] || 'secondary';
  return `<span class="badge bg-${color}" style="font-size:12px;">${escHtml(grade || '-')}</span>`;
}

/** Decision badge HTML */
function decisionBadge(decision) {
  const map = {
    PENDING:   { color:'secondary', label:'รอผล' },
    PASS:      { color:'success',   label:'ผ่าน' },
    EXTEND:    { color:'warning',   label:'ต่อรอบ' },
    TERMINATE: { color:'danger',    label:'ยุติ' },
    OTHER:     { color:'info',      label:'อื่นๆ' },
  };
  const cfg = map[decision] || { color:'secondary', label: escHtml(decision || '-') };
  return `<span class="badge bg-${cfg.color}" style="font-size:12px;">${cfg.label}</span>`;
}

function cycleStatusBadge(status) {
  return status === 'ACTIVE'
    ? `<span class="badge bg-success" style="font-size:11px;">กำลังดำเนินการ</span>`
    : `<span class="badge bg-secondary" style="font-size:11px;">ปิดแล้ว</span>`;
}

// ── Pagination renderer ───────────────────────────────────────────────
function renderProbPagination() {
  const totalPages = Math.max(1, Math.ceil(probTotalCount / probPerPage));
  const el = document.getElementById('probPagination');
  if (!el) return;
  if (totalPages <= 1) { el.innerHTML = ''; return; }
  const btnStyle = (active) =>
    `style="padding:5px 11px;border-radius:6px;border:1px solid ${active ? '#3b82f6' : '#e2e8f0'};
    background:${active ? '#3b82f6' : '#fff'};color:${active ? '#fff' : '#374151'};
    font-size:13px;cursor:pointer;font-weight:${active ? '700' : '400'};font-family:'Sarabun',sans-serif;"`;
  let html = `<button ${btnStyle(false)} onclick="probGoPage(${probCurrentPage - 1})" ${probCurrentPage === 1 ? 'disabled' : ''}>&lsaquo;</button>`;
  const start = Math.max(1, probCurrentPage - 2);
  const end   = Math.min(totalPages, start + 4);
  for (let i = start; i <= end; i++) {
    html += `<button ${btnStyle(i === probCurrentPage)} onclick="probGoPage(${i})">${i}</button>`;
  }
  html += `<button ${btnStyle(false)} onclick="probGoPage(${probCurrentPage + 1})" ${probCurrentPage === totalPages ? 'disabled' : ''}>&rsaquo;</button>`;
  el.innerHTML = html;
}

// ══════════════════════════════════════════════════════════════════════
// CYCLE LIST PAGE
// ══════════════════════════════════════════════════════════════════════
export async function loadProbationPage() {
  const container = document.getElementById('pageContent');
  container.innerHTML = `<div class="text-center py-5">
    <div class="spinner" style="margin:0 auto;"></div>
    <p class="mt-3 text-muted">กำลังโหลดข้อมูล...</p>
  </div>`;

  probCurrentPage = 1;
  probPerPage     = 50;
  probSearchValue = '';

  try {
    const res = await fetch('components/html/probation.html');
    container.innerHTML = await res.text();
  } catch {
    container.innerHTML = '<p class="text-danger p-4">โหลดเทมเพลตไม่สำเร็จ</p>';
    return;
  }

  await probRefreshList();
}

export async function probRefreshList() {
  probRenderTableLoading();
  try {
    const res = await window.api.probationGetCycles({
      search: probSearchValue,
      page: probCurrentPage,
      perPage: probPerPage
    });
    if (!res?.success) { showToast(res?.message || 'โหลดข้อมูลไม่สำเร็จ', 'danger'); return; }
    probTotalCount = res.total || 0;
    const el = document.getElementById('probTotalCount');
    if (el) el.textContent = probTotalCount.toLocaleString();
    probRenderTable(res.data || []);
    renderProbPagination();
  } catch (e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'danger');
  }
}

function probRenderTableLoading() {
  const tbody = document.getElementById('probTableBody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:#94a3b8;">
    <div class="spinner" style="margin:0 auto 12px;"></div><div>กำลังโหลดข้อมูล...</div></td></tr>`;
}

function probRenderTable(rows) {
  const tbody = document.getElementById('probTableBody');
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:#94a3b8;">
      <i class="bi bi-inbox" style="font-size:32px;"></i><br>ไม่พบข้อมูล</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((r, idx) => {
    const rowNum = (probCurrentPage - 1) * probPerPage + idx + 1;
    const avgDisplay = r.last_avg_score != null
      ? `${parseFloat(r.last_avg_score).toFixed(1)}%`
      : '-';
    return `<tr style="cursor:pointer;" onclick="probOpenCycleDetail(${r.cycle_id})">
      <td style="text-align:center;color:var(--gray-400);font-size:12px;">${rowNum}</td>
      <td><span style="font-weight:600;">${escHtml(r.emp_id)}</span></td>
      <td>${escHtml(r.Fullname || '-')}</td>
      <td style="color:var(--gray-600);">${escHtml(r.Sub_Name || '-')}</td>
      <td>${probFmtDate(r.start_date)}</td>
      <td style="text-align:center;font-weight:700;color:var(--primary);">${r.period_count || 0}</td>
      <td style="text-align:center;">
        <div style="display:flex;flex-direction:column;align-items:center;gap:3px;">
          ${decisionBadge(r.last_decision || 'PENDING')}
          <span style="font-size:11px;color:var(--gray-500);">${avgDisplay}</span>
        </div>
      </td>
      <td style="text-align:center;">${cycleStatusBadge(r.status)}</td>
      <td style="text-align:center;" onclick="event.stopPropagation()">
        <button class="btn-action edit" title="แก้ไข" onclick="probOpenEditCycle(${r.cycle_id}, event)">
          <i class="bi bi-pencil"></i>
        </button>
      </td>
    </tr>`;
  }).join('');
}

export function probOnSearch() {
  clearTimeout(probSearchTimer);
  probSearchTimer = setTimeout(() => {
    probSearchValue = document.getElementById('probSearchInput')?.value || '';
    probCurrentPage = 1;
    probRefreshList();
  }, 350);
}

export function probSetPageSize() {
  probPerPage = parseInt(document.getElementById('probPerPageSelect')?.value || '50');
  probCurrentPage = 1;
  probRefreshList();
}

export function probGoPage(p) {
  probCurrentPage = p;
  probRefreshList();
}

// ── Create / Edit cycle modal ─────────────────────────────────────────
let _probEditingCycleId = null;

export function probOpenCreateCycleModal() {
  _probEditingCycleId = null;
  document.getElementById('probCycleModalTitle').textContent = 'สร้างแฟ้มทดลองงานใหม่';
  document.getElementById('probEmpSearch').value = '';
  document.getElementById('probEmpId').value = '';
  const selEl = document.getElementById('probEmpSelected');
  selEl.style.display = 'none';
  selEl.textContent = '';
  document.getElementById('probCycleStartDate').value = '';
  document.getElementById('probCycleRemark').value = '';
  const empSearchEl = document.getElementById('probEmpSearch');
  if (empSearchEl) empSearchEl.disabled = false;
  showModal('probCycleModal');
}

export async function probOpenEditCycle(cycleId, event) {
  if (event) event.stopPropagation();
  _probEditingCycleId = cycleId;
  try {
    const res = await window.api.probationGetCycleDetail(cycleId);
    if (!res?.success) { showToast(res?.message || 'โหลดข้อมูลไม่สำเร็จ', 'danger'); return; }
    const c = res.cycle;
    document.getElementById('probCycleModalTitle').textContent = 'แก้ไขข้อมูลทดลองงาน';
    document.getElementById('probEmpId').value = c.emp_id;
    document.getElementById('probEmpSearch').value = '';
    document.getElementById('probEmpSearch').disabled = true;
    const selEl = document.getElementById('probEmpSelected');
    selEl.style.display = 'block';
    selEl.innerHTML = `<i class="bi bi-person-check me-2"></i><strong>${escHtml(c.emp_id)}</strong> — ${escHtml(c.Fullname)} (${escHtml(c.Sub_Name || '-')})`;
    document.getElementById('probCycleStartDate').value = c.start_date || '';
    document.getElementById('probCycleRemark').value = c.remark || '';
    showModal('probCycleModal');
  } catch (e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'danger');
  }
}

export function probCloseCycleModal() {
  closeModal('probCycleModal');
  _probEditingCycleId = null;
}

export async function probSubmitCycle() {
  const empId     = String(document.getElementById('probEmpId')?.value || '').trim();
  const startDate = document.getElementById('probCycleStartDate')?.value;
  const remark    = document.getElementById('probCycleRemark')?.value || '';

  if (!empId) { showToast('กรุณาเลือกพนักงาน', 'warning'); return; }
  if (!startDate) { showToast('ไม่พบวันเริ่มงานพนักงานในฐานข้อมูล', 'warning'); return; }

  const data = { emp_id: empId, start_date: startDate, remark };
  if (_probEditingCycleId) data.cycle_id = _probEditingCycleId;

  try {
    const res = await window.api.probationSaveCycle(data);
    if (!res?.success) { showToast(res?.message || 'บันทึกไม่สำเร็จ', 'danger'); return; }
    showToast(res.message || 'บันทึกสำเร็จ', 'success');
    probCloseCycleModal();
    await probRefreshList();
  } catch (e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'danger');
  }
}

// ── Employee autocomplete (reuses existing search-employees IPC) ──────
let _probEmpSuggestTimer = null;

export function probEmpSearchInput() {
  const val = document.getElementById('probEmpSearch')?.value || '';
  clearTimeout(_probEmpSuggestTimer);
  _probEmpSuggestTimer = setTimeout(async () => {
    if (!val.trim()) {
      const s = document.getElementById('probEmpSuggest');
      if (s) s.style.display = 'none';
      return;
    }
    try {
      const res = await window.api.searchEmployees({ keyword: val.trim(), limit: 20 });
      const items = res?.data || [];
      const box = document.getElementById('probEmpSuggest');
      if (!box) return;
      if (!items.length) { box.style.display = 'none'; return; }
      box.innerHTML = items.map(e => `
        <div style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--gray-100);
          font-size:13px;" onmousedown="probSelectEmp('${escHtml(e.Emp_ID)}','${escHtml(e.Fullname || '')}','${escHtml(e.Sub_Name || '')}')">
          <strong style="color:var(--primary);">${escHtml(e.Emp_ID)}</strong>
          — ${escHtml(e.Fullname || '')}
          <span style="color:var(--gray-500);font-size:12px;">&nbsp;${escHtml(e.Sub_Name || '')}</span>
        </div>`).join('');
      box.style.display = 'block';
    } catch { /* ignore */ }
  }, 280);
}

export async function probSelectEmp(empId, fullname, subName) {
  document.getElementById('probEmpId').value = empId;
  document.getElementById('probEmpSearch').value = '';
  const selEl = document.getElementById('probEmpSelected');
  selEl.innerHTML = `<i class="bi bi-person-check me-2"></i><strong>${escHtml(empId)}</strong> — ${escHtml(fullname)} (${escHtml(subName)})`;
  selEl.style.display = 'block';
  const box = document.getElementById('probEmpSuggest');
  if (box) box.style.display = 'none';

  try {
    const empRes = await window.api.getEmployeeById(empId);
    const startDate = empRes?.success ? String(empRes.data?.Emp_Start_date || '') : '';
    document.getElementById('probCycleStartDate').value = startDate && startDate !== '0000-00-00' ? startDate : '';
    if (!startDate || startDate === '0000-00-00') {
      showToast('ไม่พบวันเริ่มงานของพนักงานในฐานข้อมูล', 'warning');
    }
  } catch (e) {
    document.getElementById('probCycleStartDate').value = '';
    showToast('โหลดวันเริ่มงานพนักงานไม่สำเร็จ: ' + e.message, 'danger');
  }
}

// ══════════════════════════════════════════════════════════════════════
// CYCLE DETAIL VIEW (rendered inline, replaces pageContent)
// ══════════════════════════════════════════════════════════════════════
let _currentCycleId = null;
let _probSuggestedPeriodStart = null;

export async function probOpenCycleDetail(cycleId) {
  _currentCycleId = cycleId;
  const container = document.getElementById('pageContent');
  container.innerHTML = `<div class="text-center py-5">
    <div class="spinner" style="margin:0 auto;"></div>
    <p class="mt-3 text-muted">กำลังโหลดข้อมูล...</p>
  </div>`;

  try {
    const res = await window.api.probationGetCycleDetail(cycleId);
    if (!res?.success) {
      container.innerHTML = `<p class="text-danger p-4">${escHtml(res?.message || 'โหลดไม่สำเร็จ')}</p>`;
      return;
    }
    _renderCycleDetail(res.cycle, res.periods);
  } catch (e) {
    container.innerHTML = `<p class="text-danger p-4">เกิดข้อผิดพลาด: ${escHtml(e.message)}</p>`;
  }
}

function _renderCycleDetail(cycle, periods) {
  const container = document.getElementById('pageContent');

  const lastPeriod   = periods.length ? periods[periods.length - 1] : null;
  // Set suggested start: first period → cycle.start_date; subsequent → day after last period end
  _probSuggestedPeriodStart = lastPeriod
    ? addOneDayIso(lastPeriod.end_date)
    : cycle.start_date;
  const canAddPeriod = cycle.status === 'ACTIVE' &&
    (!lastPeriod || lastPeriod.decision === 'EXTEND' || lastPeriod.decision === 'PENDING');
  const canCloseCycle = cycle.status === 'ACTIVE';

  // Build periods table rows
  const periodRows = periods.length
    ? periods.map((p, idx) => `
        <tr style="cursor:pointer;" onclick="probOpenPeriodDetail(${p.period_id})">
          <td style="text-align:center;font-weight:700;color:var(--primary);">รอบที่ ${p.period_no}</td>
          <td>${probFmtDate(p.start_date)} — ${probFmtDate(p.end_date)}</td>
          <td style="text-align:center;">${p.att_pct != null ? parseFloat(p.att_pct).toFixed(1)+'%' : '-'}</td>
          <td style="text-align:center;">${p.quality_pct != null ? parseFloat(p.quality_pct).toFixed(1)+'%' : '-'}</td>
          <td style="text-align:center;font-weight:700;">${p.avg_score != null ? parseFloat(p.avg_score).toFixed(1)+'%' : '-'}</td>
          <td style="text-align:center;">${gradeBadge(p.grade || '-')}</td>
          <td style="text-align:center;">${decisionBadge(p.decision)}</td>
        </tr>`).join('')
    : `<tr><td colspan="7" style="text-align:center;padding:30px;color:#94a3b8;">ยังไม่มีรอบประเมิน</td></tr>`;

  container.innerHTML = `
    <!-- Back + Breadcrumb -->
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
      <button class="btn-outline-custom" style="padding:6px 14px;" onclick="loadProbationPage()">
        <i class="bi bi-arrow-left me-1"></i> กลับรายการ
      </button>
      <span style="color:var(--gray-400);font-size:13px;">/</span>
      <span style="font-size:13.5px;font-weight:600;color:var(--gray-700);">แฟ้มทดลองงาน #${cycle.cycle_id}</span>
    </div>

    <!-- Employee info card -->
    <div class="table-section" style="padding:20px 24px;margin-bottom:16px;">
      <div style="display:flex;align-items:flex-start;gap:20px;flex-wrap:wrap;">
        <div style="width:56px;height:56px;background:var(--primary-light);border-radius:14px;
          display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <i class="bi bi-person-fill" style="font-size:28px;color:var(--primary);"></i>
        </div>
        <div style="flex:1;min-width:200px;">
          <div style="font-size:18px;font-weight:700;color:var(--gray-900);">${escHtml(cycle.Fullname || '-')}</div>
          <div style="font-size:13px;color:var(--gray-500);margin-top:4px;">
            รหัส: <strong>${escHtml(cycle.emp_id)}</strong> &nbsp;|&nbsp;
            แผนก: ${escHtml(cycle.Sub_Name || '-')} &nbsp;|&nbsp;
            ตำแหน่ง: ${escHtml(cycle.Position_Name || '-')}
          </div>
          <div style="font-size:13px;color:var(--gray-500);margin-top:2px;">
            วันเริ่มทดลองงาน: <strong>${probFmtDate(cycle.start_date)}</strong>
            &nbsp;|&nbsp; สถานะ: ${cycleStatusBadge(cycle.status)}
          </div>
          ${cycle.remark ? `<div style="font-size:12px;color:var(--gray-500);margin-top:4px;">
            <i class="bi bi-chat-left-text me-1"></i>${escHtml(cycle.remark)}</div>` : ''}
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <button class="btn-primary-custom" style="padding:8px 16px;"
            onclick="probOpenAddPeriodModal()" ${!canAddPeriod ? 'disabled title="ไม่สามารถเพิ่มรอบได้ในขณะนี้"' : ''}>
            <i class="bi bi-plus-circle me-1"></i> เพิ่มรอบประเมิน
          </button>
          ${canCloseCycle ? `<button class="btn-outline-custom" style="padding:8px 16px;border-color:var(--danger);color:var(--danger);"
            onclick="probConfirmCloseCycle(${cycle.cycle_id})">
            <i class="bi bi-lock me-1"></i> ปิดแฟ้ม
          </button>` : ''}
        </div>
      </div>
    </div>

    <!-- Periods table -->
    <div class="table-section">
      <div class="table-header">
        <span class="table-title">รอบการประเมิน (${periods.length} รอบ)</span>
      </div>
      <div style="overflow-x:auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th style="min-width:80px;">รอบที่</th>
              <th style="min-width:200px;">ช่วงเวลา</th>
              <th style="min-width:100px;text-align:center;">Attendance %</th>
              <th style="min-width:100px;text-align:center;">Quality %</th>
              <th style="min-width:100px;text-align:center;">เฉลี่ย %</th>
              <th style="min-width:80px;text-align:center;">เกรด</th>
              <th style="min-width:110px;text-align:center;">ผลการประเมิน</th>
            </tr>
          </thead>
          <tbody>${periodRows}</tbody>
        </table>
      </div>
    </div>

    <!-- Add Period Modal (inline) -->
    <div class="modal-overlay" id="probAddPeriodModal">
      <div class="modal-card" style="width:460px;max-width:96vw;">
        <div class="modal-header">
          <div class="modal-title">
            <i class="bi bi-calendar-plus"></i>
            <span>เพิ่มรอบประเมินใหม่</span>
          </div>
          <button class="modal-close" onclick="probCloseAddPeriodModal()">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>
        <div class="modal-body">
          <div class="form-row">
            <div class="form-group">
              <label>วันที่เริ่มต้น <span class="required">*</span></label>
              <input type="date" id="probPeriodStart" class="form-control-m">
            </div>
            <div class="form-group">
              <label>วันที่สิ้นสุด <span class="required">*</span></label>
              <input type="date" id="probPeriodEnd" class="form-control-m" readonly
                style="background:var(--gray-100);">
            </div>
          </div>
          <p style="font-size:12px;color:var(--gray-500);margin-top:8px;">
            <i class="bi bi-info-circle me-1"></i>
            วันสิ้นสุดจะถูกคำนวณอัตโนมัติจากวันเริ่มต้น + 119 วัน
          </p>
        </div>
        <div class="modal-footer" style="padding:16px 24px;display:flex;justify-content:flex-end;gap:10px;">
          <button class="btn-outline-custom" onclick="probCloseAddPeriodModal()">ยกเลิก</button>
          <button class="btn-primary-custom" onclick="probSubmitAddPeriod(${cycle.cycle_id})">
            <i class="bi bi-check-lg me-1"></i> สร้างรอบ
          </button>
        </div>
      </div>
    </div>
  `;
}

export function probOpenAddPeriodModal() {
  const startInput = document.getElementById('probPeriodStart');
  const endInput   = document.getElementById('probPeriodEnd');
  if (!startInput) return;
  // รอบแรก: เริ่มจากวันแรกเข้างาน (cycle.start_date)
  // รอบถัดไป: เริ่มจากวันถัดจากสิ้นสุดรอบก่อน
  startInput.value = _probSuggestedPeriodStart || probTodayIso();
  const calcEnd = () => {
    if (startInput.value) {
      const endDate = addDaysIso(startInput.value, 119);
      if (endInput) endInput.value = endDate;
    }
  };
  startInput.oninput = calcEnd;
  calcEnd();
  showModal('probAddPeriodModal');
}

export function probCloseAddPeriodModal() {
  closeModal('probAddPeriodModal');
}

export async function probSubmitAddPeriod(cycleId) {
  const startDate = document.getElementById('probPeriodStart')?.value;
  const endDate   = document.getElementById('probPeriodEnd')?.value;
  if (!startDate || !endDate) { showToast('กรุณาระบุวันที่รอบประเมิน', 'warning'); return; }
  try {
    const res = await window.api.probationSavePeriod({ cycle_id: cycleId, start_date: startDate, end_date: endDate });
    if (!res?.success) { showToast(res?.message || 'บันทึกไม่สำเร็จ', 'danger'); return; }
    showToast(res.message || 'สร้างรอบสำเร็จ', 'success');
    const newPeriodId = res.period_id;
    await probOpenCycleDetail(cycleId);
    // Auto-navigate to the new period after cycle detail renders
    if (newPeriodId) probOpenPeriodDetail(newPeriodId);
  } catch (e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'danger');
  }
}

export async function probConfirmCloseCycle(cycleId) {
  if (!confirm('ต้องการปิดแฟ้มทดลองงานนี้ใช่หรือไม่?\nหลังปิดแล้วจะไม่สามารถเพิ่มรอบประเมินได้อีก')) return;
  try {
    const res = await window.api.probationCloseCycle(cycleId);
    if (!res?.success) { showToast(res?.message || 'ปิดไม่สำเร็จ', 'danger'); return; }
    showToast(res.message || 'ปิดแฟ้มสำเร็จ', 'success');
    await probOpenCycleDetail(cycleId);
  } catch (e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'danger');
  }
}

// ══════════════════════════════════════════════════════════════════════
// PERIOD DETAIL VIEW (3 tabs: Attendance / Scoring / Summary)
// ══════════════════════════════════════════════════════════════════════
let _currentPeriodData = null; // { period, attendance, scores, criteria, leaveReference }
let _activeProbTab     = 'attendance';
let _activeScoreMonth  = 1;

export async function probOpenPeriodDetail(periodId) {
  const container = document.getElementById('pageContent');
  container.innerHTML = `<div class="text-center py-5">
    <div class="spinner" style="margin:0 auto;"></div>
    <p class="mt-3 text-muted">กำลังโหลดข้อมูล...</p>
  </div>`;

  try {
    const res = await window.api.probationGetPeriodDetail(periodId);
    if (!res?.success) {
      container.innerHTML = `<p class="text-danger p-4">${escHtml(res?.message || 'โหลดไม่สำเร็จ')}</p>`;
      return;
    }
    _currentPeriodData = res;
    _activeProbTab    = 'attendance';
    _activeScoreMonth = 1;
    _renderPeriodDetail();
  } catch (e) {
    container.innerHTML = `<p class="text-danger p-4">เกิดข้อผิดพลาด: ${escHtml(e.message)}</p>`;
  }
}

function _renderPeriodDetail() {
  const { period, attendance, scores, criteria } = _currentPeriodData;
  const container = document.getElementById('pageContent');

  // Build month labels for this period
  const monthLabels = _buildMonthLabels(period.start_date, 4);

  container.innerHTML = `
    <!-- Breadcrumb -->
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap;">
      <button class="btn-outline-custom" style="padding:6px 14px;" onclick="loadProbationPage()">
        <i class="bi bi-arrow-left me-1"></i> รายการทดลองงาน
      </button>
      <span style="color:var(--gray-400);">/</span>
      <button class="btn-outline-custom" style="padding:6px 14px;" onclick="probOpenCycleDetail(${period.cycle_id})">
        แฟ้ม #${period.cycle_id}
      </button>
      <span style="color:var(--gray-400);">/</span>
      <span style="font-size:13.5px;font-weight:600;color:var(--gray-700);">
        รอบที่ ${period.period_no} (${probFmtDate(period.start_date)} — ${probFmtDate(period.end_date)})
      </span>
      <span style="margin-left:4px;">${decisionBadge(period.decision)}</span>
    </div>

    <!-- Tab navigation -->
    <div style="display:flex;gap:4px;margin-bottom:16px;border-bottom:2px solid var(--gray-200);">
      <button id="probTab_attendance" class="prob-tab-btn ${_activeProbTab === 'attendance' ? 'active' : ''}"
        onclick="probSwitchTab('attendance')">
        <i class="bi bi-calendar-check me-1"></i> ข้อมูลการมาทำงาน
      </button>
      <button id="probTab_scoring" class="prob-tab-btn ${_activeProbTab === 'scoring' ? 'active' : ''}"
        onclick="probSwitchTab('scoring')">
        <i class="bi bi-star-half me-1"></i> ประเมินคะแนน
      </button>
      <button id="probTab_summary" class="prob-tab-btn ${_activeProbTab === 'summary' ? 'active' : ''}"
        onclick="probSwitchTab('summary')">
        <i class="bi bi-clipboard-data me-1"></i> สรุปผล
      </button>
    </div>

    <!-- Tab content -->
    <div id="probTabContent"></div>
  `;

  // Inject tab style (lightweight, inline)
  if (!document.getElementById('probTabStyle')) {
    const s = document.createElement('style');
    s.id = 'probTabStyle';
    s.textContent = `
      .prob-tab-btn {
        padding: 8px 20px; font-size: 13.5px; font-weight: 600;
        background: transparent; border: none; cursor: pointer;
        color: var(--gray-500); border-bottom: 2px solid transparent;
        margin-bottom: -2px; font-family: 'Sarabun', sans-serif;
        transition: var(--transition);
      }
      .prob-tab-btn:hover { color: var(--primary); }
      .prob-tab-btn.active { color: var(--primary); border-bottom-color: var(--primary); }
      .prob-score-cell input[type="number"] {
        width: 90px; text-align: center; padding: 4px 8px;
        border: 1.5px solid var(--gray-200); border-radius: 8px;
        font-family: 'Sarabun', sans-serif; font-size: 13px;
        background: var(--white);
      }
      .prob-score-cell input[type="number"]:focus {
        outline: none; border-color: var(--primary);
        box-shadow: 0 0 0 3px rgba(26,86,219,.1);
      }
      .prob-att-input {
        width: 72px; text-align: center; padding: 4px 8px;
        border: 1.5px solid var(--gray-200); border-radius: 8px;
        font-size: 13px; font-family: 'Sarabun', sans-serif;
      }
      .prob-att-input:focus {
        outline: none; border-color: var(--primary);
        box-shadow: 0 0 0 3px rgba(26,86,219,.1);
      }
    `;
    document.head.appendChild(s);
  }

  _renderActiveTab(monthLabels);
}

function _buildMonthLabels(startDate, count) {
  const labels = [];
  const d = new Date(startDate + 'T00:00:00');
  for (let i = 0; i < count; i++) {
    const dt = new Date(d);
    dt.setMonth(dt.getMonth() + i);
    const ym = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;
    const thMonth = dt.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
    labels.push({ monthNo: i + 1, yearMonth: ym, label: thMonth });
  }
  return labels;
}

function _renderActiveTab(monthLabels) {
  const content = document.getElementById('probTabContent');
  if (!content) return;
  if (_activeProbTab === 'attendance') {
    _renderAttendanceTab(content, monthLabels);
  } else if (_activeProbTab === 'scoring') {
    _renderScoringTab(content, monthLabels);
  } else {
    _renderSummaryTab(content, monthLabels);
  }
}

export function probSwitchTab(tab) {
  _activeProbTab = tab;
  ['attendance','scoring','summary'].forEach(t => {
    const el = document.getElementById(`probTab_${t}`);
    if (el) el.classList.toggle('active', t === tab);
  });
  const { period, attendance, scores, criteria } = _currentPeriodData;
  const monthLabels = _buildMonthLabels(period.start_date, 4);
  _renderActiveTab(monthLabels);
}

// ── Attendance Tab ─────────────────────────────────────────────────────
function probGetAttendanceLeaveReferenceMap() {
  const map = {};
  (_currentPeriodData?.leaveReference || []).forEach((ref) => {
    map[ref.month_no] = ref;
  });
  return map;
}

function probGetAttendanceRowData(monthNo, fallbackYearMonth = '') {
  const parseWholeField = (id) => {
    const parsed = Number.parseInt(document.getElementById(id)?.value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const parseLeaveField = (id) => {
    const raw = String(document.getElementById(id)?.value || '').trim();
    if (!raw) return 0;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  return {
    month_no: monthNo,
    year_month: fallbackYearMonth,
    work_days: parseWholeField(`att_work_${monthNo}`),
    present_days: parseWholeField(`att_present_${monthNo}`),
    absent_days: parseWholeField(`att_absent_${monthNo}`),
    late_days: parseWholeField(`att_late_${monthNo}`),
    leave_days: parseLeaveField(`att_leave_${monthNo}`),
    remark: document.getElementById(`att_remark_${monthNo}`)?.value || ''
  };
}

function probValidateAttendanceRow(row) {
  const errors = [];
  const warnings = [];
  const fields = [
    ['work_days', 'วันทำงาน'],
    ['present_days', 'วันมาทำงาน'],
    ['absent_days', 'วันขาดงาน'],
    ['late_days', 'วันมาสาย'],
    ['leave_days', 'วันลา']
  ];

  fields.forEach(([key, label]) => {
    const value = Number(row[key]) || 0;
    if (value < 0) errors.push(`${label}ห้ามน้อยกว่า 0 วัน`);
    if (value > 31) errors.push(`${label}ห้ามเกิน 31 วัน`);
  });

  if (row.present_days + row.absent_days + row.leave_days > row.work_days) {
    errors.push('มาทำงาน + ขาดงาน + ลา ต้องไม่เกินวันทำงาน');
  }
  if (row.late_days > row.present_days) {
    errors.push('วันมาสายต้องไม่มากกว่าวันมาทำงาน');
  }
  if (row.absent_days > 3) {
    warnings.push(`ขาดงานเกิน 3 วัน (${row.absent_days} วัน)`);
  }

  return { errors, warnings };
}

function probUpdateAttendanceMonthUi(monthNo) {
  const monthMeta = _currentPeriodData?.period
    ? _buildMonthLabels(_currentPeriodData.period.start_date, 4).find((item) => item.monthNo === monthNo)
    : null;
  const row = probGetAttendanceRowData(monthNo, monthMeta?.yearMonth || '');
  const pctEl = document.getElementById(`att_pct_${monthNo}`);
  const statusEl = document.getElementById(`att_status_${monthNo}`);

  if (pctEl) {
    if (row.work_days > 0) {
      const pct = Math.min(100, (row.present_days / row.work_days) * 100);
      pctEl.textContent = `${pct.toFixed(1)}%`;
    } else {
      pctEl.textContent = '-';
    }
  }

  if (!statusEl) return;

  const { errors, warnings } = probValidateAttendanceRow(row);
  if (errors.length) {
    statusEl.innerHTML = `<span class="badge bg-danger">ข้อมูลไม่ถูกต้อง</span>`;
    statusEl.title = errors.join('\n');
    return;
  }
  if (warnings.length) {
    statusEl.innerHTML = `<span class="badge text-dark" style="background:#fde68a;">ขาดเกินเกณฑ์</span>`;
    statusEl.title = warnings.join('\n');
    return;
  }

  statusEl.innerHTML = `<span class="badge bg-success">ปกติ</span>`;
  statusEl.title = 'ข้อมูลปกติ';
}

function probRenderAttendanceBanner() {
  const banner = document.getElementById('probAttendanceAlert');
  const period = _currentPeriodData?.period;
  if (!banner || !period) return;

  const monthLabels = _buildMonthLabels(period.start_date, 4);
  const invalidNotes = [];
  const warningNotes = [];

  monthLabels.forEach((ml) => {
    const row = probGetAttendanceRowData(ml.monthNo, ml.yearMonth);
    const { errors, warnings } = probValidateAttendanceRow(row);
    if (errors.length) invalidNotes.push(`เดือนที่ ${ml.monthNo}: ${errors[0]}`);
    if (warnings.length) warningNotes.push(`เดือนที่ ${ml.monthNo}: ${warnings[0]}`);
  });

  const notices = [];
  if (invalidNotes.length) {
    notices.push(`<div style="padding:10px 12px;border-radius:10px;background:#fee2e2;color:#991b1b;font-size:12.5px;">
      <i class="bi bi-exclamation-octagon me-2"></i>${escHtml(invalidNotes.join(' | '))}
    </div>`);
  }
  if (warningNotes.length) {
    notices.push(`<div style="padding:10px 12px;border-radius:10px;background:#fef3c7;color:#92400e;font-size:12.5px;">
      <i class="bi bi-exclamation-triangle me-2"></i>${escHtml(warningNotes.join(' | '))}
    </div>`);
  }

  if (!notices.length) {
    banner.style.display = 'none';
    banner.innerHTML = '';
    return;
  }

  banner.style.display = 'flex';
  banner.innerHTML = notices.join('');
}

function _renderAttendanceTab(container, monthLabels) {
  const { period, attendance } = _currentPeriodData;
  const attMap = {};
  const leaveRefMap = probGetAttendanceLeaveReferenceMap();
  (attendance || []).forEach(a => { attMap[a.month_no] = a; });
  const isPending = period.decision === 'PENDING';

  const rows = monthLabels.map(ml => {
    const a = attMap[ml.monthNo] || {};
    const leaveRef = leaveRefMap[ml.monthNo] || {};
    const leaveRefDays = Number(leaveRef.leave_days_ref) || 0;
    const leaveValue = a.leave_days != null ? a.leave_days : (leaveRefDays > 0 ? leaveRefDays : '');
    return `
      <tr>
        <td style="font-weight:600;white-space:nowrap;">เดือนที่ ${ml.monthNo}<br>
          <span style="font-size:12px;color:var(--gray-500);">${escHtml(ml.label)}</span>
        </td>
        <td class="prob-att-cell">
          <input type="text" class="prob-att-input" id="att_ym_${ml.monthNo}"
            value="${escHtml(ml.yearMonth)}" placeholder="YYYY-MM" style="width:110px;background:var(--gray-100);cursor:not-allowed;"
            readonly tabindex="-1">
        </td>
        <td class="prob-att-cell">
          <input type="number" class="prob-att-input" id="att_work_${ml.monthNo}"
            value="${a.work_days ?? ''}" min="0" max="31"
            oninput="probCalcAttPct(${ml.monthNo})"
            ${!isPending ? 'disabled' : ''}>
        </td>
        <td class="prob-att-cell">
          <input type="number" class="prob-att-input" id="att_present_${ml.monthNo}"
            value="${a.present_days ?? ''}" min="0" max="31"
            oninput="probCalcAttPct(${ml.monthNo})"
            ${!isPending ? 'disabled' : ''}>
        </td>
        <td class="prob-att-cell">
          <input type="number" class="prob-att-input" id="att_absent_${ml.monthNo}"
            value="${a.absent_days ?? ''}" min="0" max="31"
            oninput="probCalcAttPct(${ml.monthNo})"
            ${!isPending ? 'disabled' : ''}>
        </td>
        <td class="prob-att-cell">
          <input type="number" class="prob-att-input" id="att_late_${ml.monthNo}"
            value="${a.late_days ?? ''}" min="0" max="31"
            oninput="probCalcAttPct(${ml.monthNo})"
            ${!isPending ? 'disabled' : ''}>
        </td>
        <td class="prob-att-cell">
          <input type="number" class="prob-att-input" id="att_leave_${ml.monthNo}"
            value="${leaveValue}" min="0" max="31" step="0.01"
            oninput="probCalcAttPct(${ml.monthNo})"
            ${!isPending ? 'disabled' : ''}>
        </td>
        <td style="text-align:center;font-weight:700;color:var(--primary);" id="att_pct_${ml.monthNo}">
          ${a.att_pct != null ? parseFloat(a.att_pct).toFixed(1)+'%' : '-'}
        </td>
        <td style="text-align:center;" id="att_status_${ml.monthNo}"></td>
        <td class="prob-att-cell">
          <input type="text" class="prob-att-input" id="att_remark_${ml.monthNo}"
            value="${escHtml(a.remark || '')}" placeholder="หมายเหตุ" style="width:140px;"
            ${!isPending ? 'disabled' : ''}>
        </td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="table-section">
      <div class="table-header" style="align-items:flex-start;">
        <div style="display:flex;flex-direction:column;gap:4px;">
          <span class="table-title">ข้อมูลการมาทำงาน — รอบที่ ${period.period_no}</span>
          <span style="font-size:12px;color:var(--gray-500);">
            ปี-เดือนถูกกำหนดอัตโนมัติ และ มาทำงาน + ขาดงาน + ลา ต้องไม่เกินวันทำงาน
          </span>
        </div>
        ${isPending ? `<button class="btn-primary-custom" onclick="probSaveAttendance(${period.period_id})">
          <i class="bi bi-floppy me-1"></i> บันทึกข้อมูลการมาทำงาน
        </button>` : ''}
      </div>
      <div id="probAttendanceAlert" style="display:none;flex-direction:column;gap:8px;padding:12px 16px;border-top:1px solid var(--gray-100);border-bottom:1px solid var(--gray-100);background:var(--gray-50);"></div>
      <div style="overflow-x:auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th style="min-width:120px;">เดือน</th>
              <th style="min-width:110px;">ปี-เดือน</th>
              <th style="min-width:80px;text-align:center;">วันทำงาน</th>
              <th style="min-width:80px;text-align:center;">มาทำงาน</th>
              <th style="min-width:80px;text-align:center;">ขาดงาน</th>
              <th style="min-width:80px;text-align:center;">มาสาย</th>
              <th style="min-width:80px;text-align:center;">ลา</th>
              <th style="min-width:100px;text-align:center;">Att %</th>
              <th style="min-width:130px;text-align:center;">สถานะ</th>
              <th style="min-width:150px;">หมายเหตุ</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${!isPending ? `<div style="padding:12px 16px;background:var(--warning-light);border-top:1px solid var(--warning);
        font-size:13px;color:#92400e;">
        <i class="bi bi-lock me-2"></i>รอบนี้ได้รับการตัดสินใจแล้ว ไม่สามารถแก้ไขข้อมูลได้
      </div>` : ''}
    </div>
  `;

  monthLabels.forEach((ml) => probUpdateAttendanceMonthUi(ml.monthNo));
  probRenderAttendanceBanner();
}

export function probCalcAttPct(monthNo) {
  probUpdateAttendanceMonthUi(monthNo);
  probRenderAttendanceBanner();
}

export async function probSaveAttendance(periodId) {
  const { period } = _currentPeriodData;
  const monthLabels = _buildMonthLabels(period.start_date, 4);
  const rows = monthLabels.map(ml => ({
    month_no:     ml.monthNo,
    year_month:   ml.yearMonth,
    work_days:    parseInt(document.getElementById(`att_work_${ml.monthNo}`)?.value) || 0,
    present_days: parseInt(document.getElementById(`att_present_${ml.monthNo}`)?.value) || 0,
    absent_days:  parseInt(document.getElementById(`att_absent_${ml.monthNo}`)?.value) || 0,
    late_days:    parseInt(document.getElementById(`att_late_${ml.monthNo}`)?.value) || 0,
    leave_days:   parseFloat(document.getElementById(`att_leave_${ml.monthNo}`)?.value) || 0,
    remark:       document.getElementById(`att_remark_${ml.monthNo}`)?.value || ''
  }));

  const invalidRow = rows
    .map((row) => ({ row, ...probValidateAttendanceRow(row) }))
    .find((entry) => entry.errors.length > 0);
  if (invalidRow) {
    probRenderAttendanceBanner();
    showToast(`ไม่สามารถบันทึกได้: เดือนที่ ${invalidRow.row.month_no} - ${invalidRow.errors[0]}`, 'warning');
    return;
  }

  try {
    const res = await window.api.probationSaveAttendance({ period_id: periodId, rows });
    if (!res?.success) { showToast(res?.message || 'บันทึกไม่สำเร็จ', 'danger'); return; }
    showToast(res.message || 'บันทึกสำเร็จ', 'success');
    if (Array.isArray(res.warnings) && res.warnings.length) {
      showToast(`แจ้งเตือน: ${res.warnings.join(' | ')}`, 'warning');
    }
    // Refresh data
    const detail = await window.api.probationGetPeriodDetail(periodId);
    if (detail?.success) { _currentPeriodData = detail; }
    probSwitchTab('attendance');
  } catch (e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'danger');
  }
}

// ── Scoring Tab ────────────────────────────────────────────────────────
function _renderScoringTab(container, monthLabels) {
  const { period, scores, criteria } = _currentPeriodData;
  const isPending = period.decision === 'PENDING';

  // Month selector tabs
  const monthTabs = monthLabels.map(ml =>
    `<button class="prob-tab-btn ${ml.monthNo === _activeScoreMonth ? 'active' : ''}"
      onclick="probSwitchScoreMonth(${ml.monthNo})" style="font-size:12.5px;">
      เดือน ${ml.monthNo}<br><span style="font-size:11px;font-weight:400;">${escHtml(ml.label)}</span>
    </button>`
  ).join('');

  // Build score rows for active month
  const scoreMap = {};
  (scores || []).forEach(s => {
    if (s.month_no === _activeScoreMonth) scoreMap[s.criteria_id] = s;
  });

  const scoreRows = criteria.length
    ? criteria.map((c, idx) => {
        const s   = scoreMap[c.criteria_id] || {};
        const val = s.score != null ? parseFloat(s.score) : '';
        return `<tr>
          <td style="text-align:center;color:var(--gray-400);">${idx + 1}</td>
          <td>
            <div style="font-weight:600;">${escHtml(c.criteria_name)}</div>
            ${c.criteria_desc ? `<div style="font-size:11.5px;color:var(--gray-500);">${escHtml(c.criteria_desc)}</div>` : ''}
          </td>
          <td style="text-align:center;color:var(--gray-500);">${parseFloat(c.max_score).toFixed(0)}</td>
          <td class="prob-score-cell">
            <input type="number" id="score_${c.criteria_id}" value="${val}"
              min="0" max="${parseFloat(c.max_score)}" step="1"
              oninput="probValidateScore(this, ${parseFloat(c.max_score)})"
              ${!isPending ? 'disabled' : ''}
              placeholder="0">
          </td>
          <td style="text-align:center;" id="score_pct_${c.criteria_id}">
            ${val !== '' ? ((parseFloat(val) / parseFloat(c.max_score)) * 100).toFixed(1) + '%' : '-'}
          </td>
          <td class="prob-score-cell">
            <input type="text" id="score_remark_${c.criteria_id}"
              value="${escHtml(s.remark || '')}" placeholder="หมายเหตุ"
              style="width:140px;padding:4px 8px;border:1.5px solid var(--gray-200);border-radius:8px;font-size:12.5px;"
              ${!isPending ? 'disabled' : ''}>
          </td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="6" style="text-align:center;padding:30px;color:#94a3b8;">ยังไม่มีหัวข้อประเมิน</td></tr>`;

  container.innerHTML = `
    <div class="table-section">
      <div class="table-header">
        <span class="table-title">กรอกคะแนนประเมิน — รอบที่ ${period.period_no}</span>
        ${isPending ? `<button class="btn-primary-custom"
          onclick="probSaveScores(${period.period_id}, ${_activeScoreMonth})">
          <i class="bi bi-floppy me-1"></i> บันทึกคะแนน เดือน ${_activeScoreMonth}
        </button>` : ''}
      </div>

      <!-- Month selector -->
      <div style="padding:0 16px 0;display:flex;gap:4px;border-bottom:2px solid var(--gray-200);margin-bottom:16px;">
        ${monthTabs}
      </div>

      <div style="overflow-x:auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:40px;text-align:center;">#</th>
              <th style="min-width:220px;">หัวข้อประเมิน</th>
              <th style="min-width:90px;text-align:center;">คะแนนเต็ม</th>
              <th style="min-width:110px;text-align:center;">คะแนนที่ได้</th>
              <th style="min-width:80px;text-align:center;">%</th>
              <th style="min-width:160px;">หมายเหตุ</th>
            </tr>
          </thead>
          <tbody>${scoreRows}</tbody>
        </table>
      </div>
      ${!isPending ? `<div style="padding:12px 16px;background:var(--warning-light);border-top:1px solid var(--warning);
        font-size:13px;color:#92400e;">
        <i class="bi bi-lock me-2"></i>รอบนี้ได้รับการตัดสินใจแล้ว ไม่สามารถแก้ไขข้อมูลได้
      </div>` : ''}
    </div>
  `;
}

export function probSwitchScoreMonth(monthNo) {
  _activeScoreMonth = monthNo;
  probSwitchTab('scoring');
}

export function probValidateScore(input, maxScore) {
  let v = parseFloat(input.value);
  if (isNaN(v) || v < 0) { input.value = 0; v = 0; }
  if (v > maxScore) { input.value = maxScore; v = maxScore; }
  // Update % cell
  const criteriaId = input.id.replace('score_', '');
  const pctEl = document.getElementById(`score_pct_${criteriaId}`);
  if (pctEl) pctEl.textContent = maxScore > 0 ? ((v / maxScore) * 100).toFixed(1) + '%' : '-';
}

export async function probSaveScores(periodId, monthNo) {
  const { criteria } = _currentPeriodData;
  const scores = criteria.map(c => ({
    criteria_id: c.criteria_id,
    score:       parseFloat(document.getElementById(`score_${c.criteria_id}`)?.value) || 0,
    remark:      document.getElementById(`score_remark_${c.criteria_id}`)?.value || ''
  }));
  try {
    const res = await window.api.probationSaveScores({ period_id: periodId, month_no: monthNo, scores });
    if (!res?.success) { showToast(res?.message || 'บันทึกไม่สำเร็จ', 'danger'); return; }
    showToast(res.message || 'บันทึกคะแนนสำเร็จ', 'success');
    const detail = await window.api.probationGetPeriodDetail(periodId);
    if (detail?.success) { _currentPeriodData = detail; }
    probSwitchTab('scoring');
  } catch (e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'danger');
  }
}

// ── Summary Tab ────────────────────────────────────────────────────────
function _renderSummaryTab(container, monthLabels) {
  const { period, attendance, scores, criteria } = _currentPeriodData;
  const isPending = period.decision === 'PENDING';

  // ── Recalculate from current data ──────────────────────────────────
  // Attendance % (A)
  let totalWork = 0, totalPresent = 0;
  (attendance || []).forEach(a => {
    totalWork    += parseInt(a.work_days)    || 0;
    totalPresent += parseInt(a.present_days) || 0;
  });
  const attPct = totalWork > 0 ? parseFloat(((totalPresent / totalWork) * 100).toFixed(2)) : null;

  // Quality % (B) = average of 4 monthly quality scores
  // Monthly quality = sum(scores for month) / sum(max_scores for month) * 100
  const monthQuality = {};
  (scores || []).forEach(s => {
    if (!monthQuality[s.month_no]) monthQuality[s.month_no] = { got: 0, max: 0 };
    monthQuality[s.month_no].got += parseFloat(s.score) || 0;
    const crit = criteria.find(c => c.criteria_id === s.criteria_id);
    monthQuality[s.month_no].max += crit ? parseFloat(crit.max_score) : 0;
  });
  const monthPcts = Object.values(monthQuality)
    .filter(v => v.max > 0)
    .map(v => (v.got / v.max) * 100);
  const qualityPct = monthPcts.length > 0
    ? parseFloat((monthPcts.reduce((a, b) => a + b, 0) / monthPcts.length).toFixed(2))
    : null;

  // Average %
  const avgScore = (attPct != null && qualityPct != null)
    ? parseFloat(((attPct + qualityPct) / 2).toFixed(2))
    : null;
  const grade = avgScore != null ? calcGrade(avgScore) : null;

  // Use cached if period is finalized
  const displayAtt     = isPending ? attPct     : period.att_pct;
  const displayQuality = isPending ? qualityPct : period.quality_pct;
  const displayAvg     = isPending ? avgScore   : period.avg_score;
  const displayGrade   = isPending ? grade      : (period.grade || '-');
  const displayDecision = period.decision;

  function pctDisplay(v) {
    return v != null ? `${parseFloat(v).toFixed(2)}%` : '-';
  }
  function pctColor(v) {
    if (v == null) return 'var(--gray-400)';
    if (v >= 80) return 'var(--success)';
    if (v >= 60) return 'var(--warning)';
    return 'var(--danger)';
  }

  const decisionOptions = ['PENDING','PASS','EXTEND','TERMINATE','OTHER'].map(d => {
    const labels = { PENDING:'รอผล',PASS:'ผ่านทดลองงาน',EXTEND:'ต่อรอบทดลองงาน',TERMINATE:'ยุติการจ้างงาน',OTHER:'อื่นๆ' };
    return `<option value="${d}" ${displayDecision === d ? 'selected' : ''}>${labels[d] || d}</option>`;
  }).join('');

  container.innerHTML = `
    <div class="table-section" style="padding:24px;">
      <div style="font-size:15px;font-weight:700;margin-bottom:20px;color:var(--gray-900);">
        <i class="bi bi-clipboard-data me-2 text-primary"></i>
        สรุปผลการประเมิน — รอบที่ ${period.period_no}
        (${probFmtDate(period.start_date)} — ${probFmtDate(period.end_date)})
      </div>

      <!-- Score cards -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px;">
        <div style="background:var(--gray-50);border:1.5px solid var(--gray-200);border-radius:14px;padding:18px;text-align:center;">
          <div style="font-size:12px;color:var(--gray-500);margin-bottom:8px;">Attendance % (A)</div>
          <div style="font-size:28px;font-weight:800;color:${pctColor(displayAtt)};">${pctDisplay(displayAtt)}</div>
          <div style="font-size:11.5px;color:var(--gray-400);margin-top:4px;">${totalPresent}/${totalWork} วัน</div>
        </div>
        <div style="background:var(--gray-50);border:1.5px solid var(--gray-200);border-radius:14px;padding:18px;text-align:center;">
          <div style="font-size:12px;color:var(--gray-500);margin-bottom:8px;">Quality % (B)</div>
          <div style="font-size:28px;font-weight:800;color:${pctColor(displayQuality)};">${pctDisplay(displayQuality)}</div>
          <div style="font-size:11.5px;color:var(--gray-400);margin-top:4px;">เฉลี่ยจาก ${monthPcts.length} เดือน</div>
        </div>
        <div style="background:var(--primary-light);border:1.5px solid var(--primary);border-radius:14px;padding:18px;text-align:center;">
          <div style="font-size:12px;color:var(--primary-dark);margin-bottom:8px;">เฉลี่ย % = (A+B)/2</div>
          <div style="font-size:28px;font-weight:800;color:var(--primary);">${pctDisplay(displayAvg)}</div>
          <div style="font-size:11.5px;color:var(--primary-dark);margin-top:4px;font-weight:600;">
            เกรด: ${displayGrade || '-'}
          </div>
        </div>
        <div style="background:var(--gray-50);border:1.5px solid var(--gray-200);border-radius:14px;padding:18px;text-align:center;">
          <div style="font-size:12px;color:var(--gray-500);margin-bottom:8px;">ผลการประเมิน</div>
          <div style="font-size:20px;margin-top:8px;">${decisionBadge(displayDecision)}</div>
        </div>
      </div>

      <!-- Decision form -->
      ${isPending ? `
      <div style="background:var(--gray-50);border:1.5px solid var(--gray-200);border-radius:12px;padding:20px;">
        <div style="font-size:13.5px;font-weight:700;margin-bottom:14px;">ตัดสินใจผลการประเมิน</div>
        <div class="form-row">
          <div class="form-group">
            <label>ผลการตัดสินใจ <span class="required">*</span></label>
            <select id="probDecisionSelect" class="form-control-m" onchange="probOnDecisionChange()">
              ${decisionOptions}
            </select>
          </div>
        </div>
        <div class="form-group" style="margin-top:12px;">
          <label>หมายเหตุ</label>
          <textarea id="probDecisionNote" class="form-control-m" rows="2"
            style="resize:vertical;" placeholder="(ไม่บังคับ)">${escHtml(period.decision_note || '')}</textarea>
        </div>
        <div style="margin-top:16px;display:flex;justify-content:flex-end;">
          <button class="btn-primary-custom" onclick="probFinalizePeriod(${period.period_id}, ${JSON.stringify(attPct)}, ${JSON.stringify(qualityPct)}, ${JSON.stringify(avgScore)}, '${grade || ''}')">
            <i class="bi bi-check2-circle me-1"></i> บันทึกผลการประเมิน
          </button>
        </div>
      </div>` : `
      <div style="padding:14px 20px;background:var(--success-light);border-radius:12px;
        border-left:3px solid var(--success);font-size:13px;color:#065f46;">
        <i class="bi bi-check-circle-fill me-2"></i>
        รอบนี้ได้รับการตัดสินใจเรียบร้อยแล้ว
        ${period.decision_note ? `<div style="margin-top:6px;color:#047857;">หมายเหตุ: ${escHtml(period.decision_note)}</div>` : ''}
      </div>
      ${period.decision === 'EXTEND' ? `
        <div style="margin-top:16px;text-align:right;">
          <button class="btn-primary-custom" onclick="probOpenCycleDetail(${period.cycle_id})">
            <i class="bi bi-plus-circle me-1"></i> ไปเพิ่มรอบถัดไป
          </button>
        </div>` : ''}
      `}
    </div>
  `;
}

export function probOnDecisionChange() {
  // Reserved for future use (e.g., show/hide additional fields per decision)
}

export async function probFinalizePeriod(periodId, attPct, qualityPct, avgScore, grade) {
  const decision     = document.getElementById('probDecisionSelect')?.value;
  const decisionNote = document.getElementById('probDecisionNote')?.value || '';
  if (!decision || decision === 'PENDING') {
    showToast('กรุณาเลือกผลการตัดสินใจ (ไม่ใช่ "รอผล")', 'warning');
    return;
  }
  const calcGradeVal = calcGrade(avgScore);
  try {
    const res = await window.api.probationFinalizePeriod({
      period_id:    periodId,
      decision,
      decision_note: decisionNote,
      att_pct:      attPct,
      quality_pct:  qualityPct,
      avg_score:    avgScore,
      grade:        calcGradeVal || grade
    });
    if (!res?.success) { showToast(res?.message || 'บันทึกไม่สำเร็จ', 'danger'); return; }
    showToast(res.message || 'บันทึกผลสำเร็จ', 'success');
    const detail = await window.api.probationGetPeriodDetail(periodId);
    if (detail?.success) { _currentPeriodData = detail; }
    probSwitchTab('summary');
  } catch (e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'danger');
  }
}

// ══════════════════════════════════════════════════════════════════════
// CRITERIA MANAGEMENT PAGE
// ══════════════════════════════════════════════════════════════════════
export async function loadProbationCriteriaPage() {
  const container = document.getElementById('pageContent');
  container.innerHTML = `<div class="text-center py-5">
    <div class="spinner" style="margin:0 auto;"></div>
    <p class="mt-3 text-muted">กำลังโหลดข้อมูล...</p>
  </div>`;

  allCriteria      = [];
  filteredCriteria = [];

  try {
    const res = await fetch('components/html/probation-criteria.html');
    container.innerHTML = await res.text();
  } catch {
    container.innerHTML = '<p class="text-danger p-4">โหลดเทมเพลตไม่สำเร็จ</p>';
    return;
  }

  await pcRefresh();
}

export async function pcRefresh() {
  pcRenderTableLoading();
  try {
    const res = await window.api.probationGetCriteria({ includeInactive: true });
    if (!res?.success) { showToast(res?.message || 'โหลดข้อมูลไม่สำเร็จ', 'danger'); return; }
    allCriteria = res.data || [];
    pcApplyFilter();
  } catch (e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'danger');
  }
}

function pcRenderTableLoading() {
  const el = document.getElementById('pcTableBody');
  if (el) el.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:#94a3b8;">
    <div class="spinner" style="margin:0 auto 12px;"></div><div>กำลังโหลดข้อมูล...</div></td></tr>`;
}

function pcApplyFilter() {
  const search = String(document.getElementById('pcSearchInput')?.value || '').toLowerCase().trim();
  const statusFilter = document.getElementById('pcFilterStatus')?.value ?? '';

  filteredCriteria = allCriteria.filter(r => {
    if (search && !r.criteria_name.toLowerCase().includes(search)) return false;
    if (statusFilter !== '' && String(r.is_active) !== statusFilter) return false;
    return true;
  });

  pcRenderTable();
  const el = document.getElementById('pcTotalCount');
  if (el) el.textContent = filteredCriteria.length;
}

function pcRenderTable() {
  const tbody = document.getElementById('pcTableBody');
  if (!tbody) return;
  if (!filteredCriteria.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:#94a3b8;">
      <i class="bi bi-inbox" style="font-size:32px;"></i><br>ไม่พบข้อมูล</td></tr>`;
    return;
  }
  tbody.innerHTML = filteredCriteria.map((r, idx) => `
    <tr>
      <td style="text-align:center;color:var(--gray-400);">${idx + 1}</td>
      <td style="text-align:center;font-weight:600;">${r.sort_order}</td>
      <td>
        <div style="font-weight:600;">${escHtml(r.criteria_name)}</div>
      </td>
      <td style="font-size:12.5px;color:var(--gray-500);">${escHtml(r.criteria_desc || '-')}</td>
      <td style="text-align:center;font-weight:700;">${parseFloat(r.max_score).toFixed(0)}</td>
      <td style="text-align:center;">
        ${r.is_active
          ? '<span class="badge bg-success">ใช้งาน</span>'
          : '<span class="badge bg-secondary">ปิดใช้งาน</span>'}
      </td>
      <td style="text-align:center;">
        <button class="btn-action edit" title="แก้ไข" onclick="pcOpenEditModal(${r.criteria_id})">
          <i class="bi bi-pencil"></i>
        </button>
        <button class="btn-action" title="${r.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}"
          style="background:${r.is_active ? 'var(--warning-light)' : 'var(--success-light)'};color:${r.is_active ? 'var(--warning)' : 'var(--success)'};"
          onclick="pcToggle(${r.criteria_id}, ${r.is_active ? 0 : 1})">
          <i class="bi bi-${r.is_active ? 'eye-slash' : 'eye'}"></i>
        </button>
      </td>
    </tr>`).join('');
}

export function pcOnSearch() {
  clearTimeout(pcSearchTimer);
  pcSearchTimer = setTimeout(pcApplyFilter, 250);
}

// ── Criteria CRUD ─────────────────────────────────────────────────────
let _pcEditingId = null;

export function pcOpenAddModal() {
  _pcEditingId = null;
  document.getElementById('pcFormTitle').textContent = 'เพิ่มหัวข้อประเมิน';
  document.getElementById('pcEditId').value = '';
  document.getElementById('pcName').value = '';
  document.getElementById('pcDesc').value = '';
  document.getElementById('pcMaxScore').value = '100';
  document.getElementById('pcSortOrder').value = String(allCriteria.length + 1);
  showModal('pcFormModal');
}

export function pcOpenEditModal(criteriaId) {
  const r = allCriteria.find(c => c.criteria_id === criteriaId);
  if (!r) return;
  _pcEditingId = criteriaId;
  document.getElementById('pcFormTitle').textContent = 'แก้ไขหัวข้อประเมิน';
  document.getElementById('pcEditId').value = criteriaId;
  document.getElementById('pcName').value = r.criteria_name;
  document.getElementById('pcDesc').value = r.criteria_desc || '';
  document.getElementById('pcMaxScore').value = parseFloat(r.max_score).toFixed(0);
  document.getElementById('pcSortOrder').value = r.sort_order;
  showModal('pcFormModal');
}

export function pcCloseFormModal() {
  closeModal('pcFormModal');
  _pcEditingId = null;
}

export async function pcSubmitForm() {
  const name     = String(document.getElementById('pcName')?.value || '').trim();
  const desc     = document.getElementById('pcDesc')?.value || '';
  const maxScore = parseFloat(document.getElementById('pcMaxScore')?.value) || 100;
  const sortOrder = parseInt(document.getElementById('pcSortOrder')?.value) || 0;

  if (!name) { showToast('กรุณากรอกชื่อหัวข้อประเมิน', 'warning'); return; }
  if (maxScore <= 0) { showToast('คะแนนเต็มต้องมากกว่า 0', 'warning'); return; }

  const data = { criteria_name: name, criteria_desc: desc, max_score: maxScore, sort_order: sortOrder };
  if (_pcEditingId) data.criteria_id = _pcEditingId;

  try {
    const res = await window.api.probationSaveCriteria(data);
    if (!res?.success) { showToast(res?.message || 'บันทึกไม่สำเร็จ', 'danger'); return; }
    showToast(res.message || 'บันทึกสำเร็จ', 'success');
    pcCloseFormModal();
    await pcRefresh();
  } catch (e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'danger');
  }
}

export async function pcToggle(criteriaId, isActive) {
  const label = isActive ? 'เปิดใช้งาน' : 'ปิดใช้งาน';
  if (!confirm(`ต้องการ${label}หัวข้อนี้ใช่หรือไม่?`)) return;
  try {
    const res = await window.api.probationToggleCriteria({ criteria_id: criteriaId, is_active: isActive });
    if (!res?.success) { showToast(res?.message || 'ดำเนินการไม่สำเร็จ', 'danger'); return; }
    showToast(`${label}สำเร็จ`, 'success');
    await pcRefresh();
  } catch (e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'danger');
  }
}
