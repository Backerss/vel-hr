// ===================== AUTH =====================
import { showToast, showModal, closeModal } from './utils.js';
import { loadEmployeesPage } from './employees.js';

export let currentUser = null;

export async function checkDBStatus() {
  const dot = document.getElementById('dbDot');
  const txt = document.getElementById('dbStatusText');
  try {
    const result = await window.api.getEmployeeCount();
    if (result.success) {
      dot.classList.add('connected');
      txt.textContent = 'เชื่อมต่อแล้ว';
    } else {
      txt.textContent = 'ไม่ได้เชื่อมต่อ';
    }
  } catch {
    txt.textContent = 'ไม่ได้เชื่อมต่อ';
  }
}

export async function doLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value.trim();

  const alertEl = document.getElementById('loginAlert');
  alertEl.style.display = 'none';

  if (!username) {
    showLoginAlert('กรุณากรอกรหัสพนักงาน / Username');
    return;
  }

  const btn = document.getElementById('btnLogin');
  btn.innerHTML = '<span class="spinner" style="display:inline-block;width:18px;height:18px;margin:0 8px -4px 0;"></span> กำลังเข้าสู่ระบบ...';
  btn.disabled = true;

  try {
    const result = await window.api.login({ username, password });
    if (result.success) {
      currentUser = result.user;
      currentUser.role = result.role;

      document.getElementById('sidebarUsername').textContent = currentUser.name || currentUser.username;
      document.getElementById('sidebarRole').textContent =
        result.role === 'admin' ? 'ผู้ดูแลระบบ' : 'พนักงาน';

      const overlay = document.getElementById('loginOverlay');
      overlay.classList.add('hidden');
      setTimeout(() => { overlay.style.display = 'none'; }, 400);

      document.getElementById('app').classList.add('visible');
      await loadEmployeesPage();
    } else {
      showLoginAlert(result.message || 'เข้าสู่ระบบไม่สำเร็จ');
    }
  } catch (err) {
    showLoginAlert('เกิดข้อผิดพลาด: ' + err.message);
  } finally {
    btn.innerHTML = '<i class="bi bi-box-arrow-in-right me-1"></i> เข้าสู่ระบบ';
    btn.disabled = false;
  }
}

export function showLoginAlert(msg) {
  const alertEl = document.getElementById('loginAlert');
  document.getElementById('loginAlertMsg').textContent = msg;
  alertEl.style.display = 'flex';
}

export function confirmLogout() {
  showModal('logoutModal');
}

export function doLogout() {
  closeModal('logoutModal');
  currentUser = null;
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginAlert').style.display = 'none';
  document.getElementById('app').classList.remove('visible');
  const overlay = document.getElementById('loginOverlay');
  overlay.style.display = 'flex';
  overlay.style.opacity = '0';
  overlay.classList.remove('hidden');
  setTimeout(() => { overlay.style.opacity = '1'; }, 10);
}
