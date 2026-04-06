// ===================== THAI BUDDHIST ERA DATE PICKER =====================
// Singleton popup calendar for DD/MM/YYYY (พ.ศ.) text input fields.

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
  p.querySelector('#tdpYearLabel').textContent = String(_year + 543);

  // Parse selected date from active input
  let selD = null, selM = null, selY = null;
  const val = _activeInput?.value || '';
  const parsed = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (parsed) {
    selD = parseInt(parsed[1], 10);
    selM = parseInt(parsed[2], 10) - 1;
    selY = parseInt(parsed[3], 10) - 543;
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
  const y  = _year + 543;
  _activeInput.value = `${d}/${mo}/${y}`;
  // Trigger oninput handler (auto-format) then onblur handler (validate + side-effects)
  _activeInput.dispatchEvent(new Event('input',  { bubbles: true }));
  _activeInput.dispatchEvent(new Event('blur',   { bubbles: false }));
  _close();
}

// ---- Open popup anchored below a button element ----
function _open(inputEl, anchorEl) {
  _activeInput = inputEl;

  // Initialise calendar to the input's current value, else today
  const val = inputEl.value || '';
  const m = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    _year  = parseInt(m[3], 10) - 543;
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
