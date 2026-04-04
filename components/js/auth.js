// ===================== AUTH =====================
import { showToast, showModal, closeModal } from './utils.js';
import { loadEmployeesPage } from './employees.js';

export let currentUser = null;

// ===================== SESSION / REMEMBER ME =====================
const SESSION_KEY = 'hr_remember_session';
const SESSION_TTL = 12 * 60 * 60 * 1000; // 12 ชั่วโมง (ms)
let _sessionTimer = null;

function _startSessionTimer(expiresAt) {
  clearTimeout(_sessionTimer);
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) { doLogout(); return; }
  _sessionTimer = setTimeout(() => {
    showToast('เซสชันหมดอายุ (12 ชั่วโมง) กรุณาเข้าสู่ระบบใหม่', 'warning');
    doLogout();
  }, remaining);
}

export async function initAutoLogin() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const session = JSON.parse(atob(raw));
    if (!session.loginAt || (Date.now() - session.loginAt) > SESSION_TTL) {
      localStorage.removeItem(SESSION_KEY);
      return;
    }
    // ลอง auto-login เงียบๆ
    const result = await window.api.login({ username: session.username, password: session.password });
    if (!result.success) {
      localStorage.removeItem(SESSION_KEY);
      const el = document.getElementById('loginUsername');
      if (el) el.value = session.username || '';
      return;
    }
    currentUser = result.user;
    currentUser.role = result.role;
    document.getElementById('sidebarUsername').textContent = currentUser.name || currentUser.username;
    document.getElementById('sidebarRole').textContent = result.role === 'admin' ? 'ผู้ดูแลระบบ' : 'พนักงาน';
    applyMenuForRole(result.role);
    const overlay = document.getElementById('loginOverlay');
    overlay.classList.add('hidden');
    setTimeout(() => { overlay.style.display = 'none'; }, 400);
    document.getElementById('app').classList.add('visible');
    const chk = document.getElementById('rememberMe');
    if (chk) chk.checked = true;
    _startSessionTimer(session.loginAt + SESSION_TTL);
    await loadEmployeesPage();
  } catch {
    localStorage.removeItem(SESSION_KEY);
  }
}

// ===================== MENU VISIBILITY BY ROLE =====================
// guest: ซ่อน วันหยุด, กลุ่มการอบรมทั้งหมด, ซ่อน รายงานการหยุดงานประจำวัน
// admin/user: แสดงทั้งหมด
export function applyMenuForRole(role) {
  const isGuest = role === 'guest';

  // กลุ่มการอบรม (training group header + submenu)
  const groupTraining = document.getElementById('groupTraining');
  const labelTraining = groupTraining?.previousElementSibling; // nav-section-label ก่อน groupTraining
  if (groupTraining) groupTraining.style.display = isGuest ? 'none' : '';
  // ซ่อน section label "การอบรม" ด้วย
  document.querySelectorAll('.nav-section-label').forEach(el => {
    if (el.textContent.trim() === 'การอบรม') el.style.display = isGuest ? 'none' : '';
  });

  // วันหยุดบริษัท button + section label
  const navHoliday = document.getElementById('navHoliday');
  if (navHoliday) navHoliday.style.display = isGuest ? 'none' : '';
  document.querySelectorAll('.nav-section-label').forEach(el => {
    if (el.textContent.trim() === 'วันหยุด') el.style.display = isGuest ? 'none' : '';
  });

  // รายงานการหยุดงานประจำวัน (subitem inside leave group)
  const navDailyAbsence = document.getElementById('navDailyAbsence');
  if (navDailyAbsence) navDailyAbsence.style.display = isGuest ? 'none' : '';
}

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

export async function doLoginAsGuest() {
  currentUser = { name: 'Guest', username: 'guest', role: 'guest' };

  document.getElementById('sidebarUsername').textContent = 'Guest';
  document.getElementById('sidebarRole').textContent = 'ผู้เข้าชม';

  applyMenuForRole('guest');

  const overlay = document.getElementById('loginOverlay');
  overlay.classList.add('hidden');
  setTimeout(() => { overlay.style.display = 'none'; }, 400);

  document.getElementById('app').classList.add('visible');
  await loadEmployeesPage();
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

      applyMenuForRole(result.role);

      // จำรหัสผ่าน (HR เท่านั้น)
      const loginAt = Date.now();
      const chk = document.getElementById('rememberMe');
      if (chk?.checked && result.role !== 'guest') {
        const payload = btoa(JSON.stringify({ username, password, loginAt }));
        localStorage.setItem(SESSION_KEY, payload);
      } else {
        localStorage.removeItem(SESSION_KEY);
      }
      _startSessionTimer(loginAt + SESSION_TTL);

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
  clearTimeout(_sessionTimer);
  localStorage.removeItem(SESSION_KEY);
  applyMenuForRole('admin'); // reset all menus to visible
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
  const chk = document.getElementById('rememberMe');
  if (chk) chk.checked = false;
  document.getElementById('loginAlert').style.display = 'none';
  document.getElementById('app').classList.remove('visible');
  const overlay = document.getElementById('loginOverlay');
  overlay.style.display = 'flex';
  overlay.style.opacity = '0';
  overlay.classList.remove('hidden');
  setTimeout(() => { overlay.style.opacity = '1'; }, 10);
}
