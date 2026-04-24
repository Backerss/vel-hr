// ===================== UTILITIES =====================

export function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function formatDate(dateStr) {
  if (!dateStr || dateStr === '0000-00-00') return '-';
  try {
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return '-';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}/${m}/${day}`;
  } catch { return '-'; }
}

export function formatDateInput(dateStr) {
  if (!dateStr || dateStr === '0000-00-00') return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  } catch { return ''; }
}

function parseDisplayDateParts(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  if (/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(raw)) {
    const normalized = raw.replace(/\//g, '-');
    const [year, month, day] = normalized.split('-').map(Number);
    return { day, month, year, isoLike: true };
  }

  let day;
  let month;
  let year;
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) {
    [day, month, year] = raw.split('/').map(Number);
  } else if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(raw)) {
    [day, month, year] = raw.split('-').map(Number);
  } else if (/^\d{8}$/.test(raw)) {
    day = Number(raw.slice(0, 2));
    month = Number(raw.slice(2, 4));
    year = Number(raw.slice(4));
  } else {
    return null;
  }

  return { day, month, year, isoLike: false };
}

export function isoDateToDisplayDate(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '0000-00-00' || raw === '0000/00/00') return '';
  const normalized = raw.split('T')[0].replace(/\//g, '-');
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  return `${match[1]}/${match[2]}/${match[3]}`;
}

export function displayDateToIso(value) {
  const parsed = parseDisplayDateParts(value);
  if (!parsed) return '';

  let { day, month, year, isoLike } = parsed;
  if (!isoLike && year >= 2400) year -= 543;
  const yyyy = String(year).padStart(4, '0');
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const dt = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);

  if (
    isNaN(dt.getTime()) ||
    dt.getFullYear() !== Number(yyyy) ||
    dt.getMonth() + 1 !== Number(mm) ||
    dt.getDate() !== Number(dd)
  ) {
    return '';
  }

  return `${yyyy}-${mm}-${dd}`;
}

export function displayDateToDbSlash(value) {
  const iso = displayDateToIso(value);
  return iso ? iso.replace(/-/g, '/') : '';
}

export function todayDisplayDate() {
  const now = new Date();
  return `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
}

export function formatThaiDateField(el) {
  const raw = (el?.value || '').trim();
  if (!raw) {
    if (el) el.style.borderColor = '';
    return true;
  }
  const iso = displayDateToIso(raw);
  if (!iso) {
    if (el) el.style.borderColor = '#ef4444';
    return false;
  }
  if (el) {
    el.value = isoDateToDisplayDate(iso);
    el.style.borderColor = '';
  }
  return true;
}

export function autoFormatThaiDateField(el) {
  let value = String(el?.value || '').replace(/[^0-9]/g, '');
  if (value.length > 8) value = value.slice(0, 8);
  if (value.length >= 7) value = `${value.slice(0, 4)}/${value.slice(4, 6)}/${value.slice(6)}`;
  else if (value.length >= 5) value = `${value.slice(0, 4)}/${value.slice(4)}`;
  if (el) el.value = value;
}

export function formatIDCard(raw) {
  const d = String(raw || '').replace(/[^0-9]/g, '').slice(0, 13);
  let result = d.slice(0, 1);
  if (d.length > 1) result += '-' + d.slice(1, 5);
  if (d.length > 5) result += '-' + d.slice(5, 10);
  if (d.length > 10) result += '-' + d.slice(10, 12);
  if (d.length > 12) result += '-' + d.slice(12, 13);
  return result;
}

export function autoFormatIDCard(el) {
  if (el) el.value = formatIDCard(el.value);
}

// ===================== TOAST =====================
export function showToast(msg, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast-item ${type}`;

  const icon = type === 'success' ? 'bi-check-circle-fill' :
    type === 'error' ? 'bi-x-circle-fill' : 'bi-info-circle-fill';

  toast.innerHTML = `
    <i class="bi ${icon} toast-icon"></i>
    <span class="toast-msg">${escHtml(msg)}</span>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(24px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ===================== MODAL UTILS =====================
export function showModal(id) {
  document.getElementById(id).classList.add('show');
}

export function closeModal(id) {
  document.getElementById(id).classList.remove('show');
}

// Click-outside to close modals
export function initModalBackdropClose(modalIds) {
  document.addEventListener('click', (e) => {
    modalIds.forEach(id => {
      const el = document.getElementById(id);
      if (el && e.target === el) closeModal(id);
    });
  });
}

// ===================== PASSWORD CONFIRM (delete guard) =====================
let _pendingConfirmCallback = null;
let _pwdConfirmBtnLabel = 'ยืนยันการลบ';

export function requirePasswordConfirm(username, callback, options = {}) {
  _pendingConfirmCallback = callback;
  const {
    title = 'ยืนยันตัวตนก่อนลบข้อมูล',
    message = 'การลบข้อมูลนี้ไม่สามารถย้อนกลับได้ กรุณากรอกรหัสผ่านเพื่อยืนยัน',
    btnLabel = 'ยืนยันการลบ',
    titleColor = 'var(--danger)',
    warningBg = 'var(--danger-light)',
    messageColor = '#b91c1c',
    btnBg = 'var(--danger)',
  } = options;
  _pwdConfirmBtnLabel = btnLabel;

  const titleEl = document.getElementById('pwdConfirmTitle');
  if (titleEl) { titleEl.textContent = title; titleEl.style.color = titleColor; }
  const titleIcon = document.getElementById('pwdConfirmTitleIcon');
  if (titleIcon) titleIcon.style.color = titleColor;
  const msgEl = document.getElementById('pwdConfirmMessage');
  if (msgEl) { msgEl.textContent = message; msgEl.style.color = messageColor; }
  const warnBox = document.getElementById('pwdConfirmWarningBox');
  if (warnBox) warnBox.style.background = warningBg;
  const warnIcon = document.getElementById('pwdConfirmWarningIcon');
  if (warnIcon) warnIcon.style.color = titleColor;
  const btnLabelEl = document.getElementById('pwdConfirmBtnLabel');
  if (btnLabelEl) btnLabelEl.textContent = btnLabel;
  const btn = document.getElementById('btnPasswordConfirm');
  if (btn) { btn.style.background = btnBg; btn.style.borderColor = btnBg; }

  const usernameEl = document.getElementById('pwdConfirmUsername');
  if (usernameEl) usernameEl.textContent = username;
  const inp = document.getElementById('pwdConfirmInput');
  if (inp) inp.value = '';
  const errEl = document.getElementById('pwdConfirmError');
  if (errEl) errEl.textContent = '';
  showModal('passwordConfirmModal');
  setTimeout(() => { if (inp) inp.focus(); }, 120);
}

export async function submitPasswordConfirm() {
  const usernameEl = document.getElementById('pwdConfirmUsername');
  const username = usernameEl?.textContent?.trim() || '';
  const inp = document.getElementById('pwdConfirmInput');
  const password = inp?.value || '';
  const errEl = document.getElementById('pwdConfirmError');
  const btn = document.getElementById('btnPasswordConfirm');

  if (!password) {
    if (errEl) errEl.textContent = 'กรุณากรอกรหัสผ่าน';
    if (inp) inp.focus();
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="display:inline-block;width:14px;height:14px;margin:0 6px -3px 0;border-width:2px;"></span> กำลังตรวจสอบ...';
  }

  const res = await window.api.verifyPassword(username, password);

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<i class="bi bi-shield-check"></i> <span id="pwdConfirmBtnLabel">${_pwdConfirmBtnLabel}</span>`;
  }

  if (res.success) {
    closeModal('passwordConfirmModal');
    const cb = _pendingConfirmCallback;
    _pendingConfirmCallback = null;
    if (cb) await cb();
  } else {
    if (errEl) errEl.textContent = 'รหัสผ่านไม่ถูกต้อง กรุณาลองใหม่';
    if (inp) { inp.value = ''; inp.focus(); }
  }
}

export function closePasswordConfirmModal() {
  _pendingConfirmCallback = null;
  closeModal('passwordConfirmModal');
}
