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
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
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

export function requirePasswordConfirm(username, callback) {
  _pendingConfirmCallback = callback;
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
    btn.innerHTML = '<i class="bi bi-shield-check"></i> ยืนยันการลบ';
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
