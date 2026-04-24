// ===================== TRAINING HISTORY DATATABLE =====================
import { escHtml } from './utils.js';

let _trainingAllRows = [];
let _trainingFiltered = [];
let _trainingPage    = 1;
let _trainingPageSize = 5;
let _trainingSortCol  = -1;
let _trainingSortAsc  = true;

function _trainingFormatD(d) {
  if (!d || d === '0000-00-00') return '-';
  try { return new Date(d).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'}); }
  catch { return d; }
}

function _trainingStateLabel(s) {
  if (s === 'T') return '<span style="background:var(--success-light);color:#065f46;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700;">✓ ผ่าน</span>';
  if (s === 'F') return '<span style="background:var(--danger-light);color:#991b1b;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700;">✗ ไม่ผ่าน</span>';
  return '<span style="background:var(--warning-light);color:#854d0e;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700;">⏳ รอ</span>';
}

export function trainingDTRender() {
  const searchVal = (document.getElementById('trDTSearch')?.value || '').toLowerCase();
  _trainingFiltered = _trainingAllRows.filter(r => {
    const str = [r.Courses_ID,r.Courses_Name,r.Plan_StartDate,r.Plan_EndDate,
      r.Plan_Location,r.Plan_Lecturer,r.Plan_Remark,r.Plan_ID,r.his_state].join(' ').toLowerCase();
    return str.includes(searchVal);
  });

  if (_trainingSortCol >= 0) {
    const cols = ['Courses_ID','Courses_Name','Plan_StartDate','Plan_EndDate',
                  'Plan_TimeStart','Plan_TimeEnd','Plan_Hour','Plan_Location',
                  'Plan_Lecturer','Plan_Remark','his_state','Plan_ID'];
    const key = cols[_trainingSortCol];
    _trainingFiltered.sort((a,b) => {
      const av = (a[key]||'').toString().toLowerCase();
      const bv = (b[key]||'').toString().toLowerCase();
      return _trainingSortAsc ? av.localeCompare(bv, 'th') : bv.localeCompare(av, 'th');
    });
  }

  const total    = _trainingFiltered.length;
  const pages    = Math.max(1, Math.ceil(total / _trainingPageSize));
  if (_trainingPage > pages) _trainingPage = pages;
  const start    = (_trainingPage - 1) * _trainingPageSize;
  const pageRows = _trainingFiltered.slice(start, start + _trainingPageSize);

  const thS = (idx) => {
    let arrow = '';
    if (_trainingSortCol === idx) arrow = _trainingSortAsc ? ' ▲' : ' ▼';
    return `style="padding:10px 12px;text-align:left;font-size:11.5px;font-weight:700;
      color:var(--gray-700);white-space:nowrap;border-bottom:2px solid var(--gray-200);
      background:var(--gray-100);cursor:pointer;user-select:none;" 
      onclick="trainingDTSort(${idx})"`;
  };

  const tBodyHtml = pageRows.length === 0
    ? `<tr><td colspan="12" style="text-align:center;padding:32px;color:var(--gray-400);font-size:13px;">
        <i class="bi bi-search me-2"></i>ไม่พบข้อมูลที่ค้นหา</td></tr>`
    : pageRows.map((r, i) => {
        const rowNum = start + i + 1;
        const bg = i % 2 === 1 ? 'var(--gray-50)' : 'var(--gray-100)';
        return `<tr style="background:${bg};transition:background .15s;" 
          onmouseenter="this.style.background='var(--primary-subtle)'" 
          onmouseleave="this.style.background='${bg}'">
          <td style="padding:9px 12px;font-size:12px;color:var(--gray-400);text-align:center;font-weight:600;">${rowNum}</td>
          <td style="padding:9px 12px;font-size:11.5px;">
            <span style="background:var(--primary-light);color:var(--primary);padding:2px 7px;border-radius:5px;font-weight:700;">
              ${escHtml(r.Courses_ID||'-')}
            </span>
          </td>
          <td style="padding:9px 12px;font-size:12.5px;font-weight:500;color:var(--gray-800);min-width:160px;">${escHtml(r.Courses_Name||'-')}</td>
          <td style="padding:9px 12px;font-size:12px;color:var(--gray-700);white-space:nowrap;">${_trainingFormatD(r.Plan_StartDate)}</td>
          <td style="padding:9px 12px;font-size:12px;color:var(--gray-700);white-space:nowrap;">${_trainingFormatD(r.Plan_EndDate)}</td>
          <td style="padding:9px 12px;font-size:12px;color:var(--gray-700);text-align:center;white-space:nowrap;">${escHtml(r.Plan_TimeStart||'-')}</td>
          <td style="padding:9px 12px;font-size:12px;color:var(--gray-700);text-align:center;white-space:nowrap;">${escHtml(r.Plan_TimeEnd||'-')}</td>
          <td style="padding:9px 12px;font-size:12px;color:var(--gray-700);text-align:center;">
            ${r.Plan_Hour!=null?`<strong>${r.Plan_Hour}</strong> ชม.`:'-'}
          </td>
          <td style="padding:9px 12px;font-size:12px;color:var(--gray-700);min-width:120px;">${escHtml(r.Plan_Location||'-')}</td>
          <td style="padding:9px 12px;font-size:12px;color:var(--gray-700);min-width:100px;">${escHtml(r.Plan_Lecturer||'-')}</td>
          <td style="padding:9px 12px;font-size:12px;color:var(--gray-500);min-width:100px;">${escHtml(r.Plan_Remark||'-')}</td>
          <td style="padding:9px 12px;font-size:12px;text-align:center;white-space:nowrap;">${_trainingStateLabel(r.his_state)}</td>
          <td style="padding:9px 12px;font-size:11.5px;">
            <span style="background:var(--gray-100);color:var(--gray-600);padding:2px 7px;border-radius:5px;font-size:11px;">
              ${escHtml(r.Plan_ID||'-')}
            </span>
          </td>
        </tr>`;
      }).join('');

  const paginationHtml = (() => {
    if (pages <= 1) return '';
    let btns = '';
    const maxBtns = 5;
    let startP = Math.max(1, _trainingPage - Math.floor(maxBtns/2));
    let endP   = Math.min(pages, startP + maxBtns - 1);
    if (endP - startP < maxBtns - 1) startP = Math.max(1, endP - maxBtns + 1);

    const btnStyle = (active) => `style="min-width:32px;height:32px;border:1px solid ${active?'var(--primary)':'var(--gray-200)'};
      background:${active?'var(--primary)':'var(--gray-100)'};color:${active?'#fff':'var(--gray-700)'};border-radius:6px;
      font-size:13px;cursor:${active?'default':'pointer'};font-weight:${active?'700':'400'};
      margin:0 2px;padding:0 6px;transition:all .15s;"`;

    btns += `<button ${btnStyle(false)} ${_trainingPage===1?'disabled style="opacity:.4;cursor:default"':''} 
      onclick="trainingDTGoPage(${_trainingPage-1})">‹</button>`;
    if (startP > 1) { btns += `<button ${btnStyle(false)} onclick="trainingDTGoPage(1)">1</button>`; if(startP>2) btns+='<span style="margin:0 4px;color:#94a3b8">…</span>'; }
    for (let p = startP; p <= endP; p++) {
      btns += `<button ${btnStyle(p===_trainingPage)} onclick="trainingDTGoPage(${p})">${p}</button>`;
    }
    if (endP < pages) { if(endP<pages-1) btns+='<span style="margin:0 4px;color:#94a3b8">…</span>'; btns+=`<button ${btnStyle(false)} onclick="trainingDTGoPage(${pages})">${pages}</button>`; }
    btns += `<button ${btnStyle(false)} ${_trainingPage===pages?'disabled style="opacity:.4;cursor:default"':''} 
      onclick="trainingDTGoPage(${_trainingPage+1})">›</button>`;
    return btns;
  })();

  const infoStart = total === 0 ? 0 : start + 1;
  const infoEnd   = Math.min(start + _trainingPageSize, total);
  document.getElementById('trDTTableWrap').innerHTML = `
    <table style="width:100%;border-collapse:collapse;min-width:980px;">
      <thead>
        <tr>
          <th style="padding:10px 12px;text-align:center;font-size:11.5px;font-weight:700;color:var(--gray-700);
            background:var(--gray-100);border-bottom:2px solid var(--gray-200);white-space:nowrap;">#</th>
          <th ${thS(0)}>รหัสหลักสูตร</th>
          <th ${thS(1)}>ชื่อหลักสูตร</th>
          <th ${thS(2)}>วันที่เริ่ม</th>
          <th ${thS(3)}>วันที่สิ้นสุด</th>
          <th ${thS(4)} style="text-align:center;">เวลาเริ่ม</th>
          <th ${thS(5)} style="text-align:center;">เวลาสิ้นสุด</th>
          <th ${thS(6)} style="text-align:center;">ชั่วโมง</th>
          <th ${thS(7)}>สถานที่</th>
          <th ${thS(8)}>วิทยากร</th>
          <th ${thS(9)}>หมายเหตุ</th>
          <th ${thS(10)} style="text-align:center;">สถานะ</th>
          <th ${thS(11)}>Plan_ID</th>
        </tr>
      </thead>
      <tbody>${tBodyHtml}</tbody>
    </table>`;

  document.getElementById('trDTInfo').textContent =
    `แสดง ${infoStart}–${infoEnd} จาก ${total} รายการ${searchVal ? ' (กรอง)' : ''}`;
  document.getElementById('trDTPaging').innerHTML = paginationHtml;
}

export function trainingDTGoPage(p) {
  _trainingPage = p;
  trainingDTRender();
}

export function trainingDTSort(col) {
  if (_trainingSortCol === col) _trainingSortAsc = !_trainingSortAsc;
  else { _trainingSortCol = col; _trainingSortAsc = true; }
  trainingDTRender();
}

export function trainingDTSetPageSize(n) {
  _trainingPageSize = parseInt(n) || 5;
  _trainingPage = 1;
  trainingDTRender();
}

export function trainingDTSearch() {
  _trainingPage = 1;
  trainingDTRender();
}

export async function openTrainingHistory(empId, fullname) {
  let overlay = document.getElementById('trainingHistoryOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'trainingHistoryOverlay';
    overlay.style.cssText = `
      position:fixed;top:0;left:0;right:0;bottom:0;
      background:rgba(15,23,42,0.65);backdrop-filter:blur(5px);
      z-index:9000;display:flex;align-items:flex-start;justify-content:center;
      padding:20px 12px;overflow-y:auto;
    `;
    overlay.onclick = (e) => { if(e.target===overlay) closeTrainingHistory(); };
    document.body.appendChild(overlay);
  }

  _trainingAllRows = []; _trainingFiltered = [];
  _trainingPage = 1; _trainingPageSize = 5;
  _trainingSortCol = -1; _trainingSortAsc = true;

  overlay.innerHTML = `
    <div style="background:var(--gray-100);border-radius:16px;width:100%;max-width:1200px;
      box-shadow:0 30px 70px rgba(0,0,0,0.35);overflow:hidden;margin:auto;">
      <!-- HEADER -->
      <div style="background:linear-gradient(135deg,#1e40af 0%,#3b82f6 100%);padding:18px 24px;
        display:flex;align-items:center;gap:14px;">
        <div style="width:44px;height:44px;background:rgba(255,255,255,0.18);border-radius:12px;
          display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <i class="bi bi-journal-bookmark-fill" style="font-size:20px;color:#fff;"></i>
        </div>
        <div style="flex:1;">
          <div style="font-size:17px;font-weight:700;color:#fff;">ประวัติการอบรม</div>
          <div style="font-size:12px;color:rgba(255,255,255,0.8);margin-top:2px;">
            รหัส: <strong>${escHtml(empId)}</strong> &nbsp;•&nbsp; ${escHtml(fullname)}
          </div>
        </div>
        <button onclick="closeTrainingHistory()"
          style="background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);
            border-radius:8px;width:34px;height:34px;color:#fff;cursor:pointer;font-size:16px;
            display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
      <!-- BODY -->
      <div id="trainingHistoryBody" style="padding:40px 20px;text-align:center;">
        <div class="spinner" style="margin:0 auto 14px;"></div>
        <div style="color:var(--gray-500);font-size:13px;">กำลังโหลดข้อมูลการอบรม...</div>
      </div>
    </div>`;

  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  const res = await window.api.getEmployeeTraining(empId);
  const body = document.getElementById('trainingHistoryBody');

  if (!res.success) {
    body.innerHTML = `<div style="color:#ef4444;padding:20px;text-align:center;">
      <i class="bi bi-exclamation-triangle" style="font-size:28px;display:block;margin-bottom:8px;"></i>
      เกิดข้อผิดพลาด: ${escHtml(res.message)}</div>`;
    return;
  }

  _trainingAllRows = res.data;
  const totalHours  = _trainingAllRows.reduce((s,r)=>(s+(parseFloat(r.Plan_Hour)||0)),0);
  const passedCount = _trainingAllRows.filter(r=>r.his_state==='T').length;

  if (_trainingAllRows.length === 0) {
    body.innerHTML = `
      <div style="padding:52px 20px;text-align:center;">
        <div style="width:70px;height:70px;background:var(--gray-100);border-radius:50%;
          margin:0 auto 14px;display:flex;align-items:center;justify-content:center;">
          <i class="bi bi-journal-x" style="font-size:30px;color:var(--gray-400);"></i>
        </div>
        <div style="font-size:16px;font-weight:600;color:var(--gray-600);">ไม่พบประวัติการอบรม</div>
        <div style="font-size:13px;color:var(--gray-400);margin-top:6px;">
          พนักงานรายนี้ยังไม่มีข้อมูลการอบรมในระบบ
        </div>
      </div>`;
    return;
  }

  body.style.padding = '0';
  body.innerHTML = `
    <div style="padding:18px 20px 20px;">
      <!-- SUMMARY CARDS -->
      <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;">
        <div style="flex:1;min-width:140px;background:var(--primary-light);border:1px solid rgba(91,142,245,0.3);
          border-radius:10px;padding:12px 16px;display:flex;align-items:center;gap:10px;">
          <i class="bi bi-mortarboard-fill" style="color:var(--primary);font-size:22px;flex-shrink:0;"></i>
          <div><div style="font-size:24px;font-weight:800;color:var(--primary);">${_trainingAllRows.length}</div>
          <div style="font-size:11px;color:var(--gray-500);font-weight:500;">หลักสูตรทั้งหมด</div></div>
        </div>
        <div style="flex:1;min-width:140px;background:var(--success-light);border:1px solid rgba(16,185,129,0.3);
          border-radius:10px;padding:12px 16px;display:flex;align-items:center;gap:10px;">
          <i class="bi bi-patch-check-fill" style="color:var(--success);font-size:22px;flex-shrink:0;"></i>
          <div><div style="font-size:24px;font-weight:800;color:var(--success);">${passedCount}</div>
          <div style="font-size:11px;color:var(--gray-500);font-weight:500;">ผ่านการอบรม</div></div>
        </div>
        <div style="flex:1;min-width:140px;background:var(--warning-light);border:1px solid rgba(245,158,11,0.3);
          border-radius:10px;padding:12px 16px;display:flex;align-items:center;gap:10px;">
          <i class="bi bi-clock-history" style="color:var(--warning);font-size:22px;flex-shrink:0;"></i>
          <div><div style="font-size:24px;font-weight:800;color:var(--warning);">${totalHours.toFixed(0)}</div>
          <div style="font-size:11px;color:var(--gray-500);font-weight:500;">ชั่วโมงรวม</div></div>
        </div>
        <div style="flex:1;min-width:140px;background:rgba(124,58,237,0.12);border:1px solid rgba(124,58,237,0.25);
          border-radius:10px;padding:12px 16px;display:flex;align-items:center;gap:10px;">
          <i class="bi bi-percent" style="color:#7c3aed;font-size:22px;flex-shrink:0;"></i>
          <div><div style="font-size:24px;font-weight:800;color:#7c3aed;">
            ${_trainingAllRows.length>0?Math.round(passedCount/_trainingAllRows.length*100):0}%
          </div>
          <div style="font-size:11px;color:var(--gray-500);font-weight:500;">อัตราผ่าน</div></div>
        </div>
      </div>

      <!-- DATATABLE TOOLBAR -->
      <div style="display:flex;align-items:center;justify-content:space-between;
        gap:10px;margin-bottom:10px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:12.5px;color:var(--gray-500);white-space:nowrap;">แสดงทีละ</span>
          <select id="trDTPageSizeSelect" onchange="trainingDTSetPageSize(this.value)"
            style="border:1px solid var(--gray-200);border-radius:7px;padding:5px 10px;font-size:13px;
              background:var(--gray-100);color:var(--gray-700);cursor:pointer;outline:none;">
            <option value="5" selected>5</option>
            <option value="10">10</option>
            <option value="15">15</option>
            <option value="20">20</option>
            <option value="25">25</option>
          </select>
          <span style="font-size:12.5px;color:var(--gray-500);white-space:nowrap;">รายการ</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;background:var(--gray-100);
          border:1px solid var(--gray-200);border-radius:8px;padding:5px 12px;min-width:200px;">
          <i class="bi bi-search" style="color:var(--gray-400);font-size:13px;"></i>
          <input id="trDTSearch" type="text" placeholder="ค้นหาในตาราง..."
            oninput="trainingDTSearch()"
            style="border:none;background:transparent;outline:none;font-size:13px;
              color:var(--gray-700);width:100%;"/>
        </div>
      </div>

      <!-- TABLE WRAPPER -->
      <div style="border:1px solid var(--gray-200);border-radius:10px;overflow:hidden;">
        <div id="trDTTableWrap" style="overflow-x:auto;"></div>
      </div>

      <!-- DATATABLE FOOTER -->
      <div style="display:flex;align-items:center;justify-content:space-between;
        margin-top:12px;flex-wrap:wrap;gap:8px;">
        <div id="trDTInfo" style="font-size:12.5px;color:var(--gray-500);"></div>
        <div id="trDTPaging" style="display:flex;align-items:center;flex-wrap:wrap;gap:2px;"></div>
      </div>

      <!-- CLOSE BUTTON -->
      <div style="margin-top:16px;display:flex;justify-content:flex-end;">
        <button onclick="closeTrainingHistory()"
          style="background:var(--primary);color:#fff;border:none;border-radius:8px;
            padding:8px 22px;font-size:13.5px;font-weight:600;cursor:pointer;
            display:flex;align-items:center;gap:6px;">
          <i class="bi bi-x-circle"></i> ปิด
        </button>
      </div>
    </div>`;

  trainingDTRender();
}

export function closeTrainingHistory() {
  const overlay = document.getElementById('trainingHistoryOverlay');
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
}
