// ===================== OT SUBDIVISION MANAGEMENT PAGE =====================
import { escHtml, showToast, showModal, closeModal } from './utils.js';

let allSubs = [];   // [{Sub_ID, Sub_Name, Dpt_ID, Dpt_Name, Supervisor_EmpID, Supervisor_Name, Supervisor_Position}]
let _editingSubId = null;

// ===================== PAGE LOAD =====================
export async function loadOtSignersPage() {
  const container = document.getElementById('pageContent');
  container.innerHTML = `<div class="text-center py-5"><div class="spinner" style="margin:0 auto;"></div>
    <p class="mt-3 text-muted">กำลังโหลดข้อมูล...</p></div>`;

  const res = await window.api.getSubdivisions();
  if (!res?.success) {
    container.innerHTML = `<div class="text-center py-5"><p class="text-danger">โหลดข้อมูลไม่สำเร็จ</p></div>`;
    return;
  }
  allSubs = res.data || [];
  _renderPage(container);
}

// ===================== RENDER =====================
function _renderPage(container) {
  // Group by Dpt_Name
  const byDept = {};
  allSubs.forEach(s => {
    const key = s.Dpt_Name || 'ไม่ระบุแผนก';
    if (!byDept[key]) byDept[key] = [];
    byDept[key].push(s);
  });

  const deptCards = Object.entries(byDept).map(([dptName, subs]) => `
    <div class="table-section" style="margin-bottom:16px;">
      <div class="table-header" style="padding:12px 20px;background:var(--primary-light);">
        <i class="bi bi-diagram-3-fill" style="color:var(--primary);margin-right:8px;font-size:14px;"></i>
        <span class="table-title" style="color:var(--primary);">${escHtml(dptName)}</span>
        <span style="margin-left:auto;font-size:12px;color:var(--primary);">${subs.length} แผนกย่อย</span>
      </div>
      <div class="table-responsive-custom">
        <table class="data-table">
          <thead>
            <tr>
              <th style="min-width:150px;">แผนกย่อย</th>
              <th style="width:90px;">รหัสพนักงาน</th>
              <th style="min-width:170px;">ชื่อหัวหน้างาน</th>
              <th style="min-width:140px;">ตำแหน่ง</th>
              <th style="width:70px;text-align:center;">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            ${subs.map(s => {
              const supName = (s.Supervisor_Name || '').trim();
              const supPos  = s.Supervisor_Position || '';
              const hasData = supName && supName !== '';
              return `<tr id="subrow-${escHtml(s.Sub_ID)}">
                <td><span style="font-weight:600;font-size:13px;">${escHtml(s.Sub_Name)}</span></td>
                <td>
                  ${s.Supervisor_EmpID
                    ? `<span class="emp-id">${escHtml(s.Supervisor_EmpID)}</span>`
                    : `<span style="color:var(--gray-300);font-size:12px;">—</span>`}
                </td>
                <td>
                  ${hasData
                    ? `<span class="emp-name">${escHtml(supName)}</span>`
                    : `<span style="color:var(--gray-300);font-size:12px;font-style:italic;">ยังไม่ได้กำหนด</span>`}
                </td>
                <td style="font-size:12.5px;">${escHtml(supPos || '—')}</td>
                <td>
                  <div class="action-btns" style="justify-content:center;">
                    <button class="btn-action edit" title="แก้ไขหัวหน้างาน"
                      onclick="otsgOpenEdit('${escHtml(s.Sub_ID)}')">
                      <i class="bi bi-pencil-fill"></i>
                    </button>
                  </div>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`).join('');

  container.innerHTML = `
    <div class="table-section" style="padding:16px 20px;margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <i class="bi bi-pen-fill" style="font-size:19px;color:var(--primary);"></i>
        <span style="font-size:15px;font-weight:700;color:var(--gray-900);">จัดการผู้เซ็นชื่อ OT แยกตามแผนก</span>
        <span style="font-size:12.5px;color:var(--gray-500);">
          ชื่อหัวหน้างานที่กำหนดจะแสดงอัตโนมัติในแบบฟอร์ม OT เมื่อพิมพ์หรือ Export
        </span>
        <div style="flex:1;min-width:0;"></div>
        <span style="font-size:12.5px;color:var(--gray-500);">
          <i class="bi bi-buildings" style="margin-right:4px;"></i>
          ${Object.keys(byDept).length} แผนก &nbsp;|&nbsp;
          <i class="bi bi-diagram-2" style="margin-right:4px;"></i>
          ${allSubs.length} แผนกย่อย
        </span>
      </div>
    </div>

    ${deptCards}

    <!-- Edit supervisor modal -->
    <div class="modal-overlay" id="otsgModal">
      <div class="modal-card" style="max-width:480px;">
        <div class="modal-header">
          <span class="modal-title">แก้ไขหัวหน้างานผู้เซ็นชื่อ OT</span>
          <button class="modal-close" onclick="closeModal('otsgModal')">&times;</button>
        </div>
        <div class="modal-body">
          <div style="margin-bottom:16px;padding:10px 14px;background:var(--gray-50);border-radius:8px;border:1px solid var(--gray-200);">
            <div style="font-size:11.5px;color:var(--gray-500);margin-bottom:3px;">แผนกย่อย</div>
            <div id="otsgSubName" style="font-weight:700;font-size:14px;color:var(--gray-900);"></div>
          </div>
          <div class="form-group" style="margin-bottom:6px;">
            <label class="form-label">ค้นหาพนักงาน</label>
            <div style="display:flex;gap:8px;">
              <input type="text" class="form-control" id="otsgEmpSearch"
                placeholder="พิมพ์รหัสหรือชื่อพนักงาน..."
                oninput="otsgEmpSearch()"
                autocomplete="off">
            </div>
            <div id="otsgEmpDropdown" style="position:relative;"></div>
          </div>
          <div class="form-group" style="margin-bottom:14px;">
            <label class="form-label">รหัสพนักงานที่เลือก</label>
            <input type="text" class="form-control" id="otsgEmpID" readonly
              placeholder="เลือกจากรายการด้านบน" style="background:var(--gray-50);">
          </div>
          <div class="form-group">
            <label class="form-label">ชื่อพนักงาน</label>
            <input type="text" class="form-control" id="otsgEmpName" readonly
              style="background:var(--gray-50);">
          </div>
          <div style="margin-top:14px;padding:10px 14px;background:var(--warning-light);border-radius:8px;border:1px solid rgba(245,158,11,0.4);font-size:12.5px;color:var(--warning);">
            <i class="bi bi-info-circle-fill" style="margin-right:6px;"></i>
            ชื่อและตำแหน่งของพนักงานที่เลือกจะแสดงในแบบฟอร์ม OT ช่องลายเซ็นหัวหน้างาน
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline-custom" onclick="closeModal('otsgModal')">ยกเลิก</button>
          <button class="btn-danger-custom" style="margin-right:auto;" onclick="otsgClearSupervisor()"
            title="ลบชื่อหัวหน้างาน">
            <i class="bi bi-x-circle"></i> ล้างข้อมูล
          </button>
          <button class="btn-primary-custom" id="otsgBtnSave" onclick="otsgSave()">
            <i class="bi bi-check2-circle"></i> บันทึก
          </button>
        </div>
      </div>
    </div>`;
}

// ===================== OPEN EDIT MODAL =====================
export function otsgOpenEdit(subId) {
  _editingSubId = subId;
  const sub = allSubs.find(s => s.Sub_ID === subId);
  if (!sub) return;

  const dptLabel = sub.Dpt_Name ? ` (${sub.Dpt_Name})` : '';
  document.getElementById('otsgSubName').textContent = sub.Sub_Name + dptLabel;
  document.getElementById('otsgEmpSearch').value = (sub.Supervisor_Name || '').trim();
  document.getElementById('otsgEmpID').value = sub.Supervisor_EmpID || '';
  document.getElementById('otsgEmpName').value = (sub.Supervisor_Name || '').trim();
  document.getElementById('otsgEmpDropdown').innerHTML = '';
  showModal('otsgModal');
  setTimeout(() => {
    const inp = document.getElementById('otsgEmpSearch');
    if (inp) { inp.focus(); inp.select(); }
  }, 80);
}

// ===================== EMPLOYEE SEARCH =====================
export async function otsgEmpSearch() {
  const keyword = (document.getElementById('otsgEmpSearch')?.value || '').trim();
  const dd = document.getElementById('otsgEmpDropdown');
  if (!dd) return;
  if (keyword.length < 1) { dd.innerHTML = ''; return; }

  const res = await window.api.searchEmployees({ keyword, limit: 15 });
  if (!res.success || !res.data?.length) {
    dd.innerHTML = `<div style="padding:8px 12px;font-size:13px;color:var(--gray-400);background:var(--gray-100);border:1px solid var(--gray-200);border-radius:6px;margin-top:2px;">ไม่พบพนักงาน</div>`;
    return;
  }
  dd.innerHTML = `<div style="background:var(--gray-100);border:1px solid var(--gray-200);border-radius:6px;margin-top:2px;max-height:220px;overflow-y:auto;box-shadow:var(--shadow-md);">` +
    res.data.map(e => {
      const full = `${e.Emp_Sname || ''}${e.Emp_Firstname || ''} ${e.Emp_Lastname || ''}`.trim();
      const sub  = e.Sub_Name || '';
      return `<div class="_otsg-item" data-empid="${escHtml(e.Emp_ID)}" data-fullname="${escHtml(full)}"
        onclick="otsgSelectEmp('${escHtml(e.Emp_ID)}','${escHtml(full)}')"
        style="padding:8px 14px;font-size:13px;cursor:pointer;display:flex;gap:10px;align-items:center;border-bottom:1px solid var(--gray-100);"
        onmouseenter="this.style.background='var(--primary-light,#eff6ff)'" onmouseleave="this.style.background=''">
        <span class="emp-id" style="font-size:11.5px;">${escHtml(e.Emp_ID)}</span>
        ${e.Emp_Vsth ? `<span style="font-size:10px;background:var(--primary-light);color:var(--primary);border-radius:6px;padding:1px 5px;">${escHtml(e.Emp_Vsth)}</span>` : ''}
        <span>${escHtml(full)}</span>
        <span style="margin-left:auto;font-size:11.5px;color:var(--gray-400);">${escHtml(sub)}</span>
      </div>`;
    }).join('') + `</div>`;
}

export function otsgSelectEmp(empId, fullname) {
  const dd = document.getElementById('otsgEmpDropdown');
  if (dd) dd.innerHTML = '';
  document.getElementById('otsgEmpSearch').value = fullname;
  document.getElementById('otsgEmpID').value = empId;
  document.getElementById('otsgEmpName').value = fullname;
}

// ===================== CLEAR =====================
export function otsgClearSupervisor() {
  document.getElementById('otsgEmpSearch').value = '';
  document.getElementById('otsgEmpID').value = '';
  document.getElementById('otsgEmpName').value = '';
  document.getElementById('otsgEmpDropdown').innerHTML = '';
}

// ===================== SAVE =====================
export async function otsgSave() {
  const sub_id = _editingSubId;
  const emp_id = (document.getElementById('otsgEmpID')?.value || '').trim();
  if (!sub_id) return;

  const btn = document.getElementById('otsgBtnSave');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner" style="display:inline-block;width:14px;height:14px;margin:0 8px -3px 0;border-width:2px;"></span> บันทึก...'; }

  const res = await window.api.updateSubdivisionSupervisor({ sub_id, emp_id });

  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-check2-circle"></i> บันทึก'; }

  if (res?.success) {
    showToast('บันทึกสำเร็จ', 'success');
    closeModal('otsgModal');
    // Reload data and re-render
    const refreshRes = await window.api.getSubdivisions();
    if (refreshRes?.success) {
      allSubs = refreshRes.data || [];
      _renderPage(document.getElementById('pageContent'));
    }
  } else {
    showToast(res?.message || 'เกิดข้อผิดพลาด', 'error');
  }
}
