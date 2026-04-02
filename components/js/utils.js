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
