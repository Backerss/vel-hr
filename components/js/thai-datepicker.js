// ===================== THAI CE DATE PICKER =====================
// Singleton popup calendar for YYYY/MM/DD (ค.ศ.) text input fields.

const MONTHS_TH = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน',
  'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม',
  'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];
const DAYS_SHORT = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

let _popup = null;
let _activeInput = null;
let _year = new Date().getFullYear(); // CE year
let _month = new Date().getMonth();   // 0-indexed

// ---- Build or get the singleton popup DOM ----
function _getPopup() {
  if (_popup) return _popup;

  _popup = document.createElement('div');
  _popup.id = 'thaiDatePickerPopup';
  _popup.className = 'tdp-popup';
  _popup.style.display = 'none';
  _popup.innerHTML = `
    <div class="tdp-header">
      <button class="tdp-nav-btn" id="tdpPrevBtn" type="button">&#8249;</button>
      <div class="tdp-month-year-wrap">
        <span id="tdpMonthLabel"></span>
        <span id="tdpYearLabel"></span>
      </div>
      <button class="tdp-nav-btn" id="tdpNextBtn" type="button">&#8250;</button>
    </div>
    <div class="tdp-weekdays">
      ${DAYS_SHORT.map(d => `<span>${d}</span>`).join('')}
    </div>
    <div class="tdp-grid" id="tdpGrid"></div>
    <div class="tdp-footer">
      <button class="tdp-today-btn" id="tdpTodayBtn" type="button">วันนี้</button>
    </div>
  `;
  document.body.appendChild(_popup);

  _popup.querySelector('#tdpPrevBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    _month--;
    if (_month < 0) { _month = 11; _year--; }
    _render();
  });

  _popup.querySelector('#tdpNextBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    _month++;
    if (_month > 11) { _month = 0; _year++; }
    _render();
  });

  _popup.querySelector('#tdpTodayBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const now = new Date();
    _year = now.getFullYear();
    _month = now.getMonth();
    _pick(now.getDate());
  });

  // Close on outside click
  document.addEventListener('mousedown', (e) => {
    if (!_popup || _popup.style.display === 'none') return;
    if (!_popup.contains(e.target) && !e.target.closest('.tdp-btn')) {
      _close();
    }
  });

  return _popup;
}

// ---- Render calendar grid ----
function _render() {
  const p = _getPopup();
  p.querySelector('#tdpMonthLabel').textContent = MONTHS_TH[_month];
  p.querySelector('#tdpYearLabel').textContent = String(_year);

  // Parse selected date from active input (YYYY/MM/DD)
  let selD = null, selM = null, selY = null;
  const val = _activeInput?.value || '';
  const parsed = val.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (parsed) {
    selY = parseInt(parsed[1], 10);
    selM = parseInt(parsed[2], 10) - 1;
    selD = parseInt(parsed[3], 10);
  }

  const today = new Date();
  const todayD = today.getDate();
  const todayM = today.getMonth();
  const todayY = today.getFullYear();

  const firstWeekday = new Date(_year, _month, 1).getDay();   // 0=Sun
  const daysInMonth  = new Date(_year, _month + 1, 0).getDate();
  const daysInPrev   = new Date(_year, _month, 0).getDate();

  let cells = '';

  // Filler cells from previous month
  for (let i = 0; i < firstWeekday; i++) {
    cells += `<div class="tdp-day other">${daysInPrev - firstWeekday + 1 + i}</div>`;
  }

  // Days of current month
  for (let d = 1; d <= daysInMonth; d++) {
    let cls = 'tdp-day';
    if (d === todayD && _month === todayM && _year === todayY) cls += ' today';
    if (d === selD && _month === selM && _year === selY) cls += ' selected';
    cells += `<div class="${cls}" data-d="${d}">${d}</div>`;
  }

  // Filler cells for next month
  const filled = firstWeekday + daysInMonth;
  const rem = filled % 7;
  if (rem !== 0) {
    for (let i = 1; i <= 7 - rem; i++) {
      cells += `<div class="tdp-day other">${i}</div>`;
    }
  }

  const grid = p.querySelector('#tdpGrid');
  grid.innerHTML = cells;

  grid.querySelectorAll('.tdp-day[data-d]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      _pick(parseInt(el.dataset.d, 10));
    });
  });
}

// ---- Confirm a day selection ----
function _pick(day) {
  if (!_activeInput) return;
  const d  = String(day).padStart(2, '0');
  const mo = String(_month + 1).padStart(2, '0');
  _activeInput.value = `${_year}/${mo}/${d}`;
  // Trigger oninput handler (auto-format) then onblur handler (validate + side-effects)
  _activeInput.dispatchEvent(new Event('input',  { bubbles: true }));
  _activeInput.dispatchEvent(new Event('blur',   { bubbles: false }));
  _close();
}

// ---- Open popup anchored below a button element ----
function _open(inputEl, anchorEl) {
  _activeInput = inputEl;

  // Initialise calendar to the input's current value (YYYY/MM/DD), else today
  const val = inputEl.value || '';
  const m = val.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (m) {
    _year  = parseInt(m[1], 10);
    _month = parseInt(m[2], 10) - 1;
  } else {
    const now = new Date();
    _year  = now.getFullYear();
    _month = now.getMonth();
  }

  _render();

  const p = _getPopup();
  p.style.display    = 'block';
  p.style.visibility = 'hidden'; // hide while measuring

  // Position below (or above if no room)
  const rect = anchorEl.getBoundingClientRect();
  const pw   = p.offsetWidth  || 258;
  const ph   = p.offsetHeight || 280;
  let left = rect.left;
  let top  = rect.bottom + 6;

  if (left + pw > window.innerWidth  - 8) left = window.innerWidth  - pw - 8;
  if (left < 8) left = 8;
  if (top  + ph > window.innerHeight - 8) top  = rect.top - ph - 6;
  if (top  < 8) top  = 8;

  p.style.left       = `${left}px`;
  p.style.top        = `${top}px`;
  p.style.visibility = '';
}

function _close() {
  if (_popup) _popup.style.display = 'none';
  _activeInput = null;
}

// ---- Public API ----

/**
 * Initialise a Thai date picker on a single <input> element.
 * Wraps the input in a .tdp-wrapper span and appends a calendar toggle button.
 * Safe to call multiple times — skips already-initialised inputs.
 */
export function initThaiDatePicker(inputEl) {
  if (!inputEl || inputEl.dataset.tdpInit) return;
  inputEl.dataset.tdpInit = '1';
  inputEl.classList.add('tdp-input'); // adds right padding for the button

  // Wrap input
  const wrapper = document.createElement('span');
  wrapper.className = 'tdp-wrapper';
  inputEl.parentNode.insertBefore(wrapper, inputEl);
  wrapper.appendChild(inputEl);

  // Calendar toggle button
  const btn = document.createElement('button');
  btn.type      = 'button';
  btn.className = 'tdp-btn';
  btn.tabIndex  = -1;
  btn.setAttribute('aria-label', 'เลือกวันที่');
  btn.innerHTML = '<i class="bi bi-calendar3"></i>';
  wrapper.appendChild(btn);

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const isOpen = _popup && _popup.style.display !== 'none' && _activeInput === inputEl;
    if (isOpen) {
      _close();
    } else {
      _open(inputEl, btn);
    }
  });
}

/**
 * Scan the DOM for [data-tdp] inputs and initialise pickers on all that
 * haven't been initialised yet. Call after dynamic page/modal content is inserted.
 */
export function initAllThaiDatePickers() {
  document.querySelectorAll('[data-tdp]').forEach(el => {
    if (!el.dataset.tdpInit) initThaiDatePicker(el);
  });
}

// ===================== THAI TIME PICKER (24-hour) =====================
// Singleton dropdown for [data-ttp] text inputs (HH:MM format).

let _ttpPopup = null;
let _ttpActiveInput = null;

const _TTP_GROUPS = [
  { label: 'เช้า',    hours: [6, 7, 8, 9, 10, 11] },
  { label: 'บ่าย',    hours: [12, 13, 14, 15, 16, 17] },
  { label: 'เย็น / ค่ำ', hours: [18, 19, 20, 21, 22] },
];

function _ttpGetPopup() {
  if (_ttpPopup) return _ttpPopup;
  _ttpPopup = document.createElement('div');
  _ttpPopup.id = 'thaiTimePickerPopup';
  _ttpPopup.className = 'ttp-popup';
  _ttpPopup.style.display = 'none';
  _ttpPopup.innerHTML = `<div class="ttp-scroll" id="ttpList"></div>`;
  document.body.appendChild(_ttpPopup);

  document.addEventListener('mousedown', (e) => {
    if (!_ttpPopup || _ttpPopup.style.display === 'none') return;
    if (!_ttpPopup.contains(e.target) && !e.target.closest('.ttp-btn')) {
      _ttpClose();
    }
  });
  return _ttpPopup;
}

function _ttpOpen(inputEl, anchorEl) {
  _ttpActiveInput = inputEl;
  const p = _ttpGetPopup();
  const cur = inputEl.value || '';

  let html = '';
  for (const g of _TTP_GROUPS) {
    html += `<div class="ttp-group-label">${g.label}</div>`;
    for (const h of g.hours) {
      for (const m of [0, 30]) {
        const val = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        html += `<div class="ttp-item${val === cur ? ' selected' : ''}" data-v="${val}">${val}</div>`;
      }
    }
  }

  const list = p.querySelector('#ttpList');
  list.innerHTML = html;
  list.querySelectorAll('.ttp-item').forEach(el => {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      _ttpPick(el.dataset.v);
    });
  });

  p.style.display    = 'block';
  p.style.visibility = 'hidden';

  const rect = anchorEl.getBoundingClientRect();
  const pw   = p.offsetWidth  || 120;
  const ph   = p.offsetHeight || 240;
  let left = rect.right - pw;
  let top  = rect.bottom + 4;

  if (left + pw > window.innerWidth  - 8) left = window.innerWidth  - pw - 8;
  if (left < 8) left = 8;
  if (top  + ph > window.innerHeight - 8) top  = rect.top - ph - 4;
  if (top  < 8) top  = 8;

  p.style.left       = `${left}px`;
  p.style.top        = `${top}px`;
  p.style.visibility = '';

  // Scroll selected item into view
  const sel = list.querySelector('.ttp-item.selected');
  if (sel) sel.scrollIntoView({ block: 'center' });
}

function _ttpPick(val) {
  if (!_ttpActiveInput) return;
  _ttpActiveInput.value = val;
  _ttpActiveInput.style.borderColor = '';
  _ttpActiveInput.dispatchEvent(new Event('change', { bubbles: true }));
  _ttpClose();
  _ttpActiveInput.focus();
}

function _ttpClose() {
  if (_ttpPopup) _ttpPopup.style.display = 'none';
  _ttpActiveInput = null;
}

/**
 * Auto-insert ':' after the 2nd digit while the user is typing.
 * Attach to oninput.
 */
export function autoFormatLeaveTimeField(el) {
  let v = el.value.replace(/[^0-9]/g, '');
  if (v.length > 4) v = v.slice(0, 4);
  if (v.length >= 3) v = v.slice(0, 2) + ':' + v.slice(2);
  el.value = v;
}

/**
 * Validate and normalise to HH:MM on blur.
 * Clears the field and highlights red on invalid input.
 */
export function formatLeaveTimeField(el) {
  const raw = (el.value || '').replace(/[^0-9:]/g, '').trim();
  if (!raw) { el.style.borderColor = ''; return; }
  let h, m;
  if      (/^\d{4}$/.test(raw))           { h = raw.slice(0, 2); m = raw.slice(2); }
  else if (/^\d{1,2}:\d{1,2}$/.test(raw)) { [h, m] = raw.split(':'); }
  else if (/^\d{1,2}$/.test(raw))         { h = raw; m = '00'; }
  else { el.style.borderColor = '#ef4444'; return; }

  const hNum = parseInt(h, 10);
  const mNum = parseInt(m, 10);
  if (isNaN(hNum) || isNaN(mNum) || hNum < 0 || hNum > 23 || mNum < 0 || mNum > 59) {
    el.style.borderColor = '#ef4444';
    el.value = '';
    return;
  }
  el.value = `${String(hNum).padStart(2, '0')}:${String(mNum).padStart(2, '0')}`;
  el.style.borderColor = '';
}

/**
 * Initialise time picker on a single [data-ttp] input.
 * Safe to call multiple times — skips already-initialised inputs.
 */
export function initThaiTimePicker(inputEl) {
  if (!inputEl || inputEl.dataset.ttpInit) return;
  inputEl.dataset.ttpInit = '1';
  inputEl.classList.add('ttp-input');

  const wrapper = document.createElement('span');
  wrapper.className = 'ttp-wrapper';
  inputEl.parentNode.insertBefore(wrapper, inputEl);
  wrapper.appendChild(inputEl);

  const btn = document.createElement('button');
  btn.type      = 'button';
  btn.className = 'ttp-btn';
  btn.tabIndex  = -1;
  btn.setAttribute('aria-label', 'เลือกเวลา');
  btn.innerHTML = '<i class="bi bi-clock"></i>';
  wrapper.appendChild(btn);

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const isOpen = _ttpPopup && _ttpPopup.style.display !== 'none' && _ttpActiveInput === inputEl;
    if (isOpen) { _ttpClose(); } else { _ttpOpen(inputEl, btn); }
  });
}

/**
 * Scan the DOM for [data-ttp] inputs and initialise pickers on all that
 * haven't been initialised yet. Call after dynamic page/modal content is inserted.
 */
export function initAllThaiTimePickers() {
  document.querySelectorAll('[data-ttp]').forEach(el => {
    if (!el.dataset.ttpInit) initThaiTimePicker(el);
  });
}
