// ===================== COURSES MANAGEMENT PAGE =====================
import { escHtml, showToast, showModal, closeModal, isoDateToDisplayDate, displayDateToIso, autoFormatThaiDateField, formatThaiDateField } from './utils.js';

let allCourses = [];        // all rows from DB (with plan count)
let filteredCourses = [];   // after search + filter
let csCurrentPage = 1;
let csPerPage = 25;
let csSortCol = 'Courses_ID';
let csSortAsc = true;
let csSearchTimer = null;

let editingCourseId = null;  // null = add mode, string = edit mode
let editingCourseDate = null; // preserve date on edit
let deletingCourseId = null;
let deleteHasUsage = false;

// ===================== HELPERS =====================
function csFormatDate(val) {
  if (!val || val === '0000-00-00') return '-';
  try {
    const d = new Date(val + 'T00:00:00');
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch { return val; }
}

// ===================== LOAD PAGE =====================
export async function loadCoursesPage() {
  const container = document.getElementById('pageContent');
  container.innerHTML = `<div class="text-center py-5">
    <div class="spinner" style="margin:0 auto;"></div>
    <p class="mt-3 text-muted">กำลังโหลดข้อมูล...</p>
  </div>`;

  allCourses = [];
  filteredCourses = [];
  csCurrentPage = 1;
  editingCourseId = null;
  deletingCourseId = null;

  try {
    const res = await fetch('components/html/courses.html');
    container.innerHTML = await res.text();
  } catch {
    container.innerHTML = '<p class="text-danger">โหลดเทมเพลตไม่สำเร็จ</p>';
    return;
  }

  await csRefresh();
}

// ===================== REFRESH =====================
export async function csRefresh() {
  csRenderTableLoading();
  try {
    const res = await window.api.getCoursesWithUsage();
    if (!res?.success) {
      showToast(res?.message || 'โหลดข้อมูลหลักสูตรไม่สำเร็จ', 'danger');
      csRenderTableError();
      return;
    }
    allCourses = res.data || [];
    csApplyFilter();
    csRenderStats();
  } catch (e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'danger');
    csRenderTableError();
  }
}

// ===================== FILTER & SORT =====================
function csApplyFilter() {
  const search = String(document.getElementById('csSearchInput')?.value || '').toLowerCase().trim();
  const usage = document.getElementById('csFilterUsage')?.value || '';

  filteredCourses = allCourses.filter(r => {
    if (search) {
      const hay = [r.Courses_ID, r.Courses_Name, r.Courses_Remark].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (usage === 'used' && Number(r.PlanCount) === 0) return false;
    if (usage === 'unused' && Number(r.PlanCount) > 0) return false;
    return true;
  });

  // Sort
  filteredCourses.sort((a, b) => {
    let av = String(a[csSortCol] || '');
    let bv = String(b[csSortCol] || '');
    if (csSortCol === 'Courses_Date') {
      av = av.replace(/[-\/]/g, '');
      bv = bv.replace(/[-\/]/g, '');
    }
    const cmp = av.localeCompare(bv, 'th');
    return csSortAsc ? cmp : -cmp;
  });

  csCurrentPage = 1;
  csRenderTable();
  csRenderPagination();
  csUpdateTotalCount();
}

export function csOnSearch() {
  clearTimeout(csSearchTimer);
  csSearchTimer = setTimeout(csApplyFilter, 220);
}

export function csSortBy(col) {
  if (csSortCol === col) {
    csSortAsc = !csSortAsc;
  } else {
    csSortCol = col;
    csSortAsc = true;
  }
  ['Courses_ID', 'Courses_Name', 'Courses_Date'].forEach(c => {
    const el = document.getElementById(`csSort_${c}`);
    if (el) el.textContent = c === csSortCol ? (csSortAsc ? ' ▲' : ' ▼') : '';
  });
  csApplyFilter();
}

export function csSetPageSize() {
  csPerPage = parseInt(document.getElementById('csPerPageSelect')?.value || 25);
  csCurrentPage = 1;
  csRenderTable();
  csRenderPagination();
}

export function csGoPage(p) {
  const total = Math.max(1, Math.ceil(filteredCourses.length / csPerPage));
  csCurrentPage = Math.max(1, Math.min(p, total));
  csRenderTable();
  csRenderPagination();
}

// ===================== RENDER TABLE =====================
function csRenderTableLoading() {
  const tbody = document.getElementById('csTableBody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:#94a3b8;">
    <div class="spinner" style="margin:0 auto 12px;"></div>
    <div>กำลังโหลดข้อมูล...</div>
  </td></tr>`;
}

function csRenderTableError() {
  const tbody = document.getElementById('csTableBody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:#ef4444;">
    <i class="bi bi-exclamation-triangle-fill" style="font-size:28px;display:block;margin-bottom:8px;"></i>
    โหลดข้อมูลไม่สำเร็จ
  </td></tr>`;
}

function csRenderTable() {
  const tbody = document.getElementById('csTableBody');
  if (!tbody) return;

  const total = filteredCourses.length;
  if (total === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:#94a3b8;">
      <i class="bi bi-search" style="font-size:28px;display:block;margin-bottom:8px;"></i>
      ไม่พบข้อมูลหลักสูตร
    </td></tr>`;
    return;
  }

  const start = (csCurrentPage - 1) * csPerPage;
  const pageRows = filteredCourses.slice(start, start + csPerPage);

  tbody.innerHTML = pageRows.map((r, i) => {
    const rowNum = start + i + 1;
    const bg = i % 2 === 1 ? '#f8fafc' : '#ffffff';
    const hasPlans = Number(r.PlanCount) > 0;
    const planBadge = hasPlans
      ? `<span style="background:#dbeafe;color:#1d4ed8;padding:2px 9px;border-radius:20px;font-size:11.5px;font-weight:700;">${r.PlanCount} แผน</span>`
      : `<span style="background:#f1f5f9;color:#94a3b8;padding:2px 9px;border-radius:20px;font-size:11.5px;">-</span>`;

    return `<tr style="background:${bg};transition:background .15s;"
      onmouseenter="this.style.background='#eff6ff'"
      onmouseleave="this.style.background='${bg}'">
      <td style="padding:9px 12px;font-size:12px;color:#94a3b8;text-align:center;font-weight:600;">${rowNum}</td>
      <td style="padding:9px 12px;font-size:12px;">
        <span style="background:#dbeafe;color:#1d4ed8;padding:2px 8px;border-radius:5px;font-weight:700;font-family:monospace;letter-spacing:0.5px;">
          ${escHtml(r.Courses_ID || '-')}
        </span>
      </td>
      <td style="padding:9px 12px;font-size:13px;font-weight:500;color:#1e293b;max-width:320px;">
        ${escHtml(r.Courses_Name || '-')}
      </td>
      <td style="padding:9px 12px;font-size:12.5px;color:#374151;white-space:nowrap;">${csFormatDate(r.Courses_Date)}</td>
      <td style="padding:9px 12px;font-size:12px;color:#64748b;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
        title="${escHtml(r.Courses_Remark || '')}">
        ${escHtml(r.Courses_Remark || '-')}
      </td>
      <td style="padding:9px 12px;text-align:center;">${planBadge}</td>
      <td style="padding:9px 12px;text-align:center;">
        <div style="display:flex;gap:6px;justify-content:center;">
          <button title="แก้ไข" onclick="csOpenEditModal('${escHtml(r.Courses_ID)}')"
            style="background:#dbeafe;color:#1d4ed8;border:none;border-radius:6px;padding:5px 8px;cursor:pointer;font-size:13px;transition:background .15s;"
            onmouseenter="this.style.background='#bfdbfe'"
            onmouseleave="this.style.background='#dbeafe'">
            <i class="bi bi-pencil"></i>
          </button>
          <button title="ลบ" onclick="csOpenDeleteModal('${escHtml(r.Courses_ID)}')"
            style="background:#fee2e2;color:#991b1b;border:none;border-radius:6px;padding:5px 8px;cursor:pointer;font-size:13px;transition:background .15s;"
            onmouseenter="this.style.background='#fecaca'"
            onmouseleave="this.style.background='#fee2e2'">
            <i class="bi bi-trash3"></i>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function csRenderPagination() {
  const container = document.getElementById('csPagination');
  if (!container) return;
  const total = Math.max(1, Math.ceil(filteredCourses.length / csPerPage));
  if (total <= 1) { container.innerHTML = ''; return; }

  const btnStyle = (active) =>
    `style="padding:5px 11px;border-radius:6px;border:1px solid ${active ? '#3b82f6' : '#e2e8f0'};
    background:${active ? '#3b82f6' : '#fff'};color:${active ? '#fff' : '#374151'};
    font-size:13px;cursor:pointer;font-weight:${active ? '700' : '400'};"`;

  let html = `<button ${btnStyle(false)} onclick="csGoPage(${csCurrentPage - 1})" ${csCurrentPage === 1 ? 'disabled' : ''}>&lsaquo;</button>`;
  const range = 2;
  for (let p = 1; p <= total; p++) {
    if (p === 1 || p === total || (p >= csCurrentPage - range && p <= csCurrentPage + range)) {
      html += `<button ${btnStyle(p === csCurrentPage)} onclick="csGoPage(${p})">${p}</button>`;
    } else if (p === csCurrentPage - range - 1 || p === csCurrentPage + range + 1) {
      html += `<span style="padding:5px 4px;color:#94a3b8;">…</span>`;
    }
  }
  html += `<button ${btnStyle(false)} onclick="csGoPage(${csCurrentPage + 1})" ${csCurrentPage === total ? 'disabled' : ''}>&rsaquo;</button>`;
  container.innerHTML = html;
}

function csUpdateTotalCount() {
  const el = document.getElementById('csTotalCount');
  if (el) el.textContent = filteredCourses.length;
}

function csRenderStats() {
  const total = allCourses.length;
  const used = allCourses.filter(r => Number(r.PlanCount) > 0).length;
  const unused = total - used;
  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  s('csStatTotal', total);
  s('csStatUsed', used);
  s('csStatUnused', unused);
}

// ===================== ADD MODAL =====================
export function csOpenAddModal() {
  editingCourseId = null;

  const el = (id) => document.getElementById(id);
  el('courseFormTitle').innerHTML = '<i class="bi bi-journal-plus me-2"></i>เพิ่มหลักสูตรใหม่';
  el('csFieldId').value = '';
  el('csFieldId').disabled = false;
  el('csFieldId').style.background = '';
  el('csFieldName').value = '';
  el('csFieldRemark').value = '';
  el('csFieldIdError').style.display = 'none';
  el('csFieldNameError').style.display = 'none';
  el('csFormSaveBtn').disabled = false;

  showModal('courseFormModal');
  setTimeout(() => el('csFieldId')?.focus(), 100);
}

// ===================== EDIT MODAL =====================
export function csOpenEditModal(courseId) {
  const row = allCourses.find(r => r.Courses_ID === courseId);
  if (!row) { showToast('ไม่พบข้อมูลหลักสูตร', 'danger'); return; }

  editingCourseId = courseId;

  const el = (id) => document.getElementById(id);
  el('courseFormTitle').innerHTML = '<i class="bi bi-pencil-square me-2"></i>แก้ไขหลักสูตร';

  // ID is read-only while editing
  el('csFieldId').value = row.Courses_ID;
  el('csFieldId').disabled = true;
  el('csFieldId').style.background = '#f1f5f9';

  el('csFieldName').value = row.Courses_Name || '';
  editingCourseDate = row.Courses_Date || null;
  el('csFieldRemark').value = row.Courses_Remark || '';
  el('csFieldIdError').style.display = 'none';
  el('csFieldNameError').style.display = 'none';
  el('csFormSaveBtn').disabled = false;

  showModal('courseFormModal');
  setTimeout(() => el('csFieldName')?.focus(), 100);
}

export function csCloseFormModal() {
  closeModal('courseFormModal');
}

// ===================== SUBMIT FORM =====================
export async function csSubmitForm() {
  const el = (id) => document.getElementById(id);
  const id = (el('csFieldId').value || '').trim();
  const name = (el('csFieldName').value || '').trim();
  const remark = (el('csFieldRemark').value || '').trim();

  // Validation
  let valid = true;

  if (!editingCourseId) {
    if (!id) {
      el('csFieldIdError').textContent = 'กรุณากรอกรหัสหลักสูตร';
      el('csFieldIdError').style.display = '';
      valid = false;
    } else if (!/^[A-Z0-9\-]{1,10}$/.test(id)) {
      el('csFieldIdError').textContent = 'รหัสต้องใช้ตัวพิมพ์ใหญ่ ตัวเลข หรือ - เท่านั้น (สูงสุด 10 ตัว)';
      el('csFieldIdError').style.display = '';
      valid = false;
    } else {
      el('csFieldIdError').style.display = 'none';
    }
  }

  if (!name) {
    el('csFieldNameError').textContent = 'กรุณากรอกชื่อหลักสูตร';
    el('csFieldNameError').style.display = '';
    valid = false;
  } else {
    el('csFieldNameError').style.display = 'none';
  }

  if (!valid) return;

  // Add mode: today's date; edit mode: preserve existing
  const dateIso = editingCourseId ? (editingCourseDate || '') : new Date().toISOString().slice(0, 10);

  el('csFormSaveBtn').disabled = true;
  el('csFormSaveBtn').innerHTML = '<span class="spinner-sm"></span> กำลังบันทึก...';

  try {
    let res;
    if (editingCourseId) {
      res = await window.api.updateCourse({
        Courses_ID: editingCourseId,
        Courses_Name: name,
        Courses_Date: dateIso || '0000-00-00',
        Courses_Remark: remark
      });
    } else {
      res = await window.api.addCourse({
        Courses_ID: id,
        Courses_Name: name,
        Courses_Date: dateIso || '0000-00-00',
        Courses_Remark: remark
      });
    }

    if (!res?.success) {
      showToast(res?.message || 'บันทึกไม่สำเร็จ', 'danger');
      return;
    }

    showToast(editingCourseId ? 'แก้ไขหลักสูตรสำเร็จ' : 'เพิ่มหลักสูตรสำเร็จ', 'success');
    csCloseFormModal();
    await csRefresh();
  } catch (e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'danger');
  } finally {
    const btn = document.getElementById('csFormSaveBtn');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-check-lg me-1"></i>บันทึก';
    }
  }
}

// ===================== DELETE MODAL =====================
export async function csOpenDeleteModal(courseId) {
  const row = allCourses.find(r => r.Courses_ID === courseId);
  if (!row) { showToast('ไม่พบข้อมูลหลักสูตร', 'danger'); return; }

  deletingCourseId = courseId;
  deleteHasUsage = false;

  const el = (id) => document.getElementById(id);
  el('csDeleteCourseName').textContent = row.Courses_Name || '-';
  el('csDeleteCourseId').textContent = `รหัส: ${row.Courses_ID}`;
  el('csDeleteUsageWarning').style.display = 'none';
  el('csDeleteSimpleMsg').style.display = '';
  el('csDeleteConfirmBtn').disabled = false;

  // Reset checkbox if visible
  const chk = el('csDeleteConfirmCheck');
  if (chk) chk.checked = false;

  showModal('courseDeleteModal');

  // Check usage asynchronously
  try {
    const res = await window.api.checkCourseDeletable(courseId);
    if (res?.success) {
      const planCount = Number(res.planCount) || 0;
      const participantCount = Number(res.participantCount) || 0;
      const expenseCount = Number(res.expenseCount) || 0;

      if (planCount > 0) {
        deleteHasUsage = true;
        let detail = `• มีแผนการอบรม <strong>${planCount} แผน</strong> ที่ใช้หลักสูตรนี้<br>`;
        if (participantCount > 0) {
          detail += `• มีข้อมูลผู้เข้าอบรม <strong>${participantCount} รายการ</strong> ที่จะหายไป<br>`;
        }
        if (expenseCount > 0) {
          detail += `• มีข้อมูลค่าใช้จ่าย <strong>${expenseCount} รายการ</strong> ที่จะหายไป<br>`;
        }
        el('csDeleteUsageDetail').innerHTML = detail;
        el('csDeleteUsageWarning').style.display = '';
        el('csDeleteSimpleMsg').style.display = 'none';
        el('csDeleteConfirmBtn').disabled = true; // require checkbox
      }
    }
  } catch (e) {
    // If check fails, allow delete with simple message
  }
}

export function csDeleteCheckChanged() {
  const chk = document.getElementById('csDeleteConfirmCheck');
  const btn = document.getElementById('csDeleteConfirmBtn');
  if (btn && chk) btn.disabled = !chk.checked;
}

export function csCloseDeleteModal() {
  closeModal('courseDeleteModal');
  deletingCourseId = null;
  deleteHasUsage = false;
}

export async function csExecuteDelete() {
  if (!deletingCourseId) return;

  // Extra safety: if there's usage and checkbox isn't checked, abort
  if (deleteHasUsage) {
    const chk = document.getElementById('csDeleteConfirmCheck');
    if (!chk?.checked) {
      showToast('กรุณาทำเครื่องหมายยืนยันก่อนดำเนินการ', 'warning');
      return;
    }
  }

  const btn = document.getElementById('csDeleteConfirmBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span> กำลังลบ...'; }

  try {
    const res = await window.api.deleteCourse(deletingCourseId);
    if (!res?.success) {
      showToast(res?.message || 'ลบไม่สำเร็จ', 'danger');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-trash3 me-1"></i>ลบหลักสูตร'; }
      return;
    }
    showToast('ลบหลักสูตรสำเร็จ', 'success');
    csCloseDeleteModal();
    await csRefresh();
  } catch (e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'danger');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-trash3 me-1"></i>ลบหลักสูตร'; }
  }
}
