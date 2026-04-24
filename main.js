const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');
const ExcelJS = require('exceljs');

let mainWindow;
let db;
let dbConfigNeeded = false;
let currentDbHost = '';
let probationAttendanceSchemaEnsured = false;

// ===================== DB CONFIG (AppData) =====================
const DEFAULT_DB_CONFIG = {
  host: '192.168.66.11',
  port: 3306,
  user: 'root',
  password: '5bf3c58a84ecc09eb99f4e5f3381e97dvsth',
  database: 'training.v.1.1'
};

function getConfigPath() {
  return path.join(app.getPath('userData'), 'db-config.json');
}

function loadDbConfig() {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Failed to load db-config.json:', e.message);
  }
  return null;
}

function saveDbConfigFile(config) {
  const configPath = getConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

// Database connection pool
async function createConnection(config) {
  try {
    db = mysql.createPool({
      host: config.host,
      port: Number(config.port) || 3306,
      user: config.user,
      password: config.password || '',
      database: config.database,
      charset: 'utf8',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });
    // Verify the pool can actually reach the server
    await db.execute('SELECT 1');
    await ensureProbationAttendanceSchema();
    currentDbHost = config.host;
    console.log('Connected to MySQL database (pool)');
    return true;
  } catch (error) {
    console.error('Database connection failed:', error.message);
    db = null;
    return false;
  }
}

async function ensureProbationAttendanceSchema() {
  if (!db || probationAttendanceSchemaEnsured) return;
  try {
    const targetColumns = [
      { name: 'present_days', comment: 'มาทำงาน (รองรับเศษวัน)' },
      { name: 'absent_days', comment: 'ขาดงาน (รองรับเศษวัน)' },
      { name: 'late_days', comment: 'มาสาย (รองรับเศษวัน)' },
      { name: 'leave_days', comment: 'ลา (รองรับเศษวัน)' }
    ];

    for (const col of targetColumns) {
      const [rows] = await db.execute(
        `SELECT DATA_TYPE, NUMERIC_PRECISION, NUMERIC_SCALE
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'tb_probation_attendance'
           AND COLUMN_NAME = ?`,
        [col.name]
      );

      if (!rows.length) continue;

      const column = rows[0];
      const needsAlter = String(column.DATA_TYPE || '').toLowerCase() !== 'decimal'
        || Number(column.NUMERIC_PRECISION || 0) !== 6
        || Number(column.NUMERIC_SCALE || 0) !== 3;

      if (needsAlter) {
        await db.execute(
          `ALTER TABLE tb_probation_attendance
           MODIFY ${col.name} DECIMAL(6,3) NOT NULL DEFAULT 0.000 COMMENT '${col.comment}'`
        );
        console.log(`Auto-migrated tb_probation_attendance.${col.name} to DECIMAL(6,3)`);
      }
    }

    probationAttendanceSchemaEnsured = true;
  } catch (error) {
    console.error('Failed to ensure probation attendance schema:', error.message);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },

    frame: true,
    show: false,
    backgroundColor: '#f8fafc',
    icon: path.join(__dirname, 'assets', 'icon.png')
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadFile('index.html');
  mainWindow.webContents.openDevTools()
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  const config = loadDbConfig() || DEFAULT_DB_CONFIG;
  const connected = await createConnection(config);
  dbConfigNeeded = !connected;
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', async () => {
  if (db) { try { await db.end(); } catch { } }
});
// ===================== IPC HANDLERS =====================

// DB config IPC handlers
ipcMain.handle('is-db-config-needed', () => ({ needed: dbConfigNeeded, defaults: DEFAULT_DB_CONFIG }));

ipcMain.handle('test-db-config', async (event, config) => {
  const { host, port, user, password, database } = config || {};
  if (!host || !user || !database) {
    return { success: false, message: 'กรุณากรอก Host, User และ Database ให้ครบถ้วน' };
  }
  let testPool;
  try {
    testPool = mysql.createPool({
      host: String(host).trim(),
      port: Number(port) || 3306,
      user: String(user).trim(),
      password: String(password || ''),
      database: String(database).trim(),
      charset: 'utf8',
      connectionLimit: 1,
      queueLimit: 0
    });
    await testPool.execute('SELECT 1');
    return { success: true, message: 'เชื่อมต่อสำเร็จ!' };
  } catch (error) {
    return { success: false, message: 'เชื่อมต่อไม่ได้: ' + error.message };
  } finally {
    if (testPool) { try { await testPool.end(); } catch {} }
  }
});

ipcMain.handle('save-db-config', async (event, config) => {
  const { host, port, user, password, database } = config || {};
  if (!host || !user || !database) {
    return { success: false, message: 'กรุณากรอก Host, User และ Database ให้ครบถ้วน' };
  }
  const safeConfig = {
    host: String(host).trim(),
    port: Number(port) || 3306,
    user: String(user).trim(),
    password: String(password || ''),
    database: String(database).trim()
  };
  // Close existing pool before reconnecting
  if (db) { try { await db.end(); } catch {} db = null; }
  const connected = await createConnection(safeConfig);
  if (!connected) {
    return { success: false, message: 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้ กรุณาตรวจสอบข้อมูลอีกครั้ง' };
  }
  saveDbConfigFile(safeConfig);
  dbConfigNeeded = false;
  return { success: true };
});

// Login handler
ipcMain.handle('login', async (event, { username, password }) => {
  if (!db) return { success: false, message: 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้' };
  try {
    if (!username || !password) {
      return { success: false, message: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' };
    }
    // Admin login
    const [admins] = await db.execute(
      'SELECT ad_id, ad_firstname, ad_lastname, ad_user, ad_status, ad_permission FROM admin_login WHERE ad_user = ? AND ad_pass = ? LIMIT 1',
      [username, password]
    );
    if (admins.length > 0) {
      return {
        success: true,
        role: 'admin',
        user: {
          id: admins[0].ad_id,
          name: `${admins[0].ad_firstname} ${admins[0].ad_lastname}`,
          username: admins[0].ad_user,
          status: admins[0].ad_status,
          permission: admins[0].ad_permission
        }
      };


    }

    return { success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
  } catch (error) {
    console.error('Login error:', error);
    return { success: false, message: 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ: ' + error.message };
  }
});

// Verify password (used for delete confirmation)
ipcMain.handle('verify-password', async (event, { username, password }) => {
  if (!db) return { success: false };
  try {
    const [rows] = await db.execute(
      'SELECT ad_id FROM admin_login WHERE ad_user = ? AND ad_pass = ? LIMIT 1',
      [username, password]
    );
    return { success: rows.length > 0 };
  } catch (error) {
    return { success: false };
  }
});

// Get employees with server-side pagination
ipcMain.handle('get-employees', async (event, filters = {}) => {
  const { search = '', status = '', subdivision = '', department = '', page = 1, perPage = 50 } = filters;
  if (!db) return { success: false, message: 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้' };
  try {
    const conditions = ['1=1'];
    const params = [];
    const normalizedSearch = String(search || '').trim();
    if (normalizedSearch) {
      const searchLike = `%${normalizedSearch}%`;
      const compactSearchLike = `%${normalizedSearch.replace(/\s+/g, '')}%`;
      conditions.push(`(
        e.Emp_ID LIKE ?
        OR e.Emp_Firstname LIKE ?
        OR e.Emp_Lastname LIKE ?
        OR e.Emp_IDCard LIKE ?
        OR e.Emp_Sname LIKE ?
        OR CONCAT(IFNULL(e.Emp_Sname,''), IFNULL(e.Emp_Firstname,''), ' ', IFNULL(e.Emp_Lastname,'')) LIKE ?
        OR CONCAT(IFNULL(e.Emp_Firstname,''), ' ', IFNULL(e.Emp_Lastname,'')) LIKE ?
        OR REPLACE(CONCAT(IFNULL(e.Emp_Sname,''), IFNULL(e.Emp_Firstname,''), IFNULL(e.Emp_Lastname,'')), ' ', '') LIKE ?
        OR s.Sub_Name LIKE ?
        OR d.Dpt_Name LIKE ?
        OR p.Position_Name LIKE ?
        OR IFNULL(e.Emp_Vsth,'') LIKE ?
      )`);
      params.push(
        searchLike,
        searchLike,
        searchLike,
        searchLike,
        searchLike,
        searchLike,
        searchLike,
        compactSearchLike,
        searchLike,
        searchLike,
        searchLike,
        searchLike
      );
    }


    if (status) {
      conditions.push(`e.Emp_Status = ?`);
      params.push(status);
    }

    if (department) {
      conditions.push(`s.Dpt_ID = ?`);
      params.push(department);
    }
    if (subdivision) {
      conditions.push(`e.Sub_ID = ?`);
      params.push(subdivision);
    }


    const joins = `FROM employees e INNER JOIN subdivision s ON s.Sub_ID = e.Sub_ID INNER JOIN department d ON d.Dpt_ID = s.Dpt_ID INNER JOIN position p ON p.Position_ID = e.Position_ID`;

    const where = `WHERE ${conditions.join(' AND ')}`;
    const [countRows] = await db.execute(`SELECT COUNT(*) as total ${joins} ${where}`, params);
    const total = countRows[0].total;
    const safePerPage = Math.max(1, Math.min(Number(perPage) || 50, 100));
    const safePage = Math.max(1, Number(page) || 1);
    const offset = (safePage - 1) * safePerPage;
    const [rows] = await db.execute(
      `SELECT e.Emp_ID, CONCAT(e.Emp_Sname, e.Emp_Firstname, ' ', e.Emp_Lastname) AS Fullname,
        e.Emp_Start_date, e.Emp_Packing_date, e.Emp_IDCard, e.Emp_Level,
        s.Sub_Name, d.Dpt_Name, p.Position_Name, e.Emp_Status, e.Emp_Vsth,
        s.Sub_ID, s.Dpt_ID, p.Position_ID, e.Emp_Sname, e.Emp_Firstname, e.Emp_Lastname
        ${joins} ${where}
        ORDER BY e.Emp_ID ASC
        LIMIT ${safePerPage} OFFSET ${offset}`,
      params
    );
    return { success: true, data: rows, total, page: safePage, perPage: safePerPage };
  } catch (error) {
    console.error('Get employees error:', error);
    return { success: false, message: error.message };
  }
});
// Search employees for autocomplete (lightweight)
ipcMain.handle('search-employees', async (event, { keyword = '', limit = 20 } = {}) => {
  if (!db) return { success: false, message: 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้' };
  try {
    const q = String(keyword || '').trim();
    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 50));
    if (!q) return { success: true, data: [] };
    const [rows] = await db.execute(
      `SELECT e.Emp_ID, e.Emp_Sname, e.Emp_Firstname, e.Emp_Lastname,
        CONCAT(e.Emp_Sname, e.Emp_Firstname, ' ', e.Emp_Lastname) AS Fullname,
        s.Sub_Name, e.Emp_Status, e.Emp_Vsth
      FROM employees e
      LEFT JOIN subdivision s ON s.Sub_ID = e.Sub_ID
      WHERE (e.Emp_ID LIKE ?
         OR e.Emp_Firstname LIKE ?
         OR e.Emp_Lastname LIKE ?
         OR CONCAT(e.Emp_Sname, e.Emp_Firstname, ' ', e.Emp_Lastname) LIKE ?
         OR s.Sub_Name LIKE ?
         OR IFNULL(e.Emp_Vsth,'') LIKE ?)
      ORDER BY e.Emp_ID ASC
      LIMIT ${safeLimit}`,
      [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`]
    );
    return { success: true, data: rows };


  } catch (error) {
    console.error('Search employees error:', error);
    return { success: false, message: error.message };
  }
});





// Get employee count
ipcMain.handle('get-employee-count', async () => {
  if (!db) return { success: false };
  try {
    const [all] = await db.execute('SELECT COUNT(*) as total FROM employees');
    const [active] = await db.execute('SELECT COUNT(*) as total FROM employees WHERE Emp_Status = "Activated"');
    const [inactive] = await db.execute('SELECT COUNT(*) as total FROM employees WHERE Emp_Status != "Activated"');
    return {
      success: true,
      total: all[0].total,
      active: active[0].total,
      inactive: inactive[0].total,
      dbHost: currentDbHost
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

// Get employee by ID
ipcMain.handle('get-employee-by-id', async (event, id) => {
  if (!db) return { success: false };
  try {
    const [rows] = await db.execute(
      `SELECT e.Emp_ID, e.Emp_Sname, e.Emp_Firstname, e.Emp_Lastname, e.Emp_IDCard, e.Emp_Level,
              e.Sub_ID, e.Position_ID, e.Emp_Status, e.Emp_Vsth,
              DATE_FORMAT(e.Emp_Start_date, '%Y-%m-%d') AS Emp_Start_date,
              DATE_FORMAT(e.Emp_Packing_date, '%Y-%m-%d') AS Emp_Packing_date,
              s.Sub_Name, p.Position_Name
       FROM employees e
       LEFT JOIN subdivision s ON s.Sub_ID = e.Sub_ID
       LEFT JOIN position p ON p.Position_ID = e.Position_ID
       WHERE e.Emp_ID = ?`,
      [id]
    );
    if (rows.length > 0) return { success: true, data: rows[0] };
    return { success: false, message: 'ไม่พบพนักงาน' };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

// Get subdivisions
ipcMain.handle('get-subdivisions', async () => {
  if (!db) return { success: false };
  try {
    const [rows] = await db.execute(
      `SELECT s.Sub_ID, s.Sub_Name, s.Dpt_ID, d.Dpt_Name,
        s.Supervisor_EmpID,
        TRIM(CONCAT(IFNULL(e.Emp_Sname,''), IFNULL(e.Emp_Firstname,''), ' ', IFNULL(e.Emp_Lastname,''))) AS Supervisor_Name,
        p.Position_Name AS Supervisor_Position
       FROM subdivision s
       LEFT JOIN department d ON d.Dpt_ID = s.Dpt_ID
       LEFT JOIN employees e ON e.Emp_ID = s.Supervisor_EmpID AND s.Supervisor_EmpID != ''
       LEFT JOIN position p ON p.Position_ID = e.Position_ID
       ORDER BY d.Dpt_Name ASC, s.Sub_Name ASC`
    );
    return { success: true, data: rows };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('update-subdivision-supervisor', async (event, { sub_id, emp_id }) => {
  if (!db) return { success: false };
  try {
    await db.execute(`UPDATE subdivision SET Supervisor_EmpID=? WHERE Sub_ID=?`, [emp_id || '', sub_id]);
    return { success: true, message: 'บันทึกสำเร็จ' };
  } catch (error) {
    return { success: false, message: error.message };
  }
});


// Get positions
ipcMain.handle('get-positions', async () => {
  if (!db) return { success: false };
  try {
    const [rows] = await db.execute('SELECT Position_ID, Position_Name FROM position ORDER BY Position_Name');
    return { success: true, data: rows };
  } catch (error) {
    return { success: false, message: error.message };
  }
});
// Add employee
ipcMain.handle('add-employee', async (event, data) => {
  if (!db) return { success: false, message: 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้' };
  try {
    await db.execute(
      `INSERT INTO employees (Emp_ID, Emp_Sname, Emp_Firstname, Emp_Lastname, Emp_IDCard, Emp_Start_date,
       Emp_Packing_date, Emp_Level, Sub_ID, Position_ID, Emp_Status, Emp_Vsth)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.Emp_ID, data.Emp_Sname, data.Emp_Firstname, data.Emp_Lastname,
        data.Emp_IDCard || '', data.Emp_Start_date || null,
        data.Emp_Packing_date || '0000-00-00', data.Emp_Level || '',
        data.Sub_ID, data.Position_ID,
        data.Emp_Status || 'Activated', data.Emp_Vsth || 'Vel'
      ]
    );
    return { success: true, message: 'เพิ่มพนักงานสำเร็จ' };
  } catch (error) {
    return { success: false, message: 'เกิดข้อผิดพลาด: ' + error.message };
  }
});


// Update employee
ipcMain.handle('update-employee', async (event, data) => {
  if (!db) return { success: false, message: 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้' };
  try {
    await db.execute(
      `UPDATE employees SET Emp_Sname=?, Emp_Firstname=?, Emp_Lastname=?, Emp_IDCard=?,
       Emp_Start_date=?, Emp_Packing_date=?, Emp_Level=?, Sub_ID=?, Position_ID=?,
       Emp_Status=?, Emp_Vsth=? WHERE Emp_ID=?`,
      [
        data.Emp_Sname, data.Emp_Firstname, data.Emp_Lastname,
        data.Emp_IDCard || '', data.Emp_Start_date || null,
        data.Emp_Packing_date || '0000-00-00', data.Emp_Level || '',
        data.Sub_ID, data.Position_ID,
        data.Emp_Status || 'Activated', data.Emp_Vsth || 'Vel',
        data.Emp_ID
      ]
    );
    return { success: true, message: 'แก้ไขข้อมูลพนักงานสำเร็จ' };
  } catch (error) {
    return { success: false, message: 'เกิดข้อผิดพลาด: ' + error.message };
  }
});





// Delete employee
ipcMain.handle('delete-employee', async (event, id) => {
  if (!db) return { success: false, message: 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้' };
  try {
    await db.execute('DELETE FROM employees WHERE Emp_ID = ?', [id]);
    return { success: true, message: 'ลบข้อมูลพนักงานสำเร็จ' };
  } catch (error) {
    return { success: false, message: 'เกิดข้อผิดพลาด: ' + error.message };
  }
});

// ===================== LEAVE RECORD IPC =====================
// Get leave types
ipcMain.handle('get-leave-types', async () => {
  if (!db) return { success: false };
  try {
    const [rows] = await db.execute('SELECT leave_abbreviation, leave_name FROM leave_type ORDER BY leave_abbreviation');
    return { success: true, data: rows };
  } catch (e) { return { success: false, message: e.message }; }
});

// Get daily reports with optional filters
ipcMain.handle('get-daily-reports', async (event, { search = '', dateFrom = '', dateTo = '', subID = '', vsth = '', leaveType = '' } = {}) => {
  if (!db) return { success: false };
  try {
    let q = `SELECT dr.drp_id, dr.drp_empID, dr.drp_record, dr.drp_Type,
      dr.drp_Communicate, dr.drp_Communicate1,
      dr.drp_Sdate, TIME_FORMAT(dr.drp_Stime,'%H:%i') AS drp_Stime,
      dr.drp_Edate, TIME_FORMAT(dr.drp_Etime,'%H:%i') AS drp_Etime,
      dr.drp_status, dr.drp_Remark,
      CONCAT(IFNULL(e.Emp_Sname,''),IFNULL(e.Emp_Firstname,''),' ',IFNULL(e.Emp_Lastname,'')) AS Fullname,
      e.Emp_Sname, e.Emp_Firstname, e.Emp_Lastname,
      s.Sub_Name, s.Sub_ID, e.Emp_Vsth,
      lt.leave_name
      FROM daily_report dr
      LEFT JOIN employees e ON e.Emp_ID = dr.drp_empID
      LEFT JOIN subdivision s ON s.Sub_ID = e.Sub_ID
      LEFT JOIN leave_type lt ON lt.leave_abbreviation = dr.drp_Type
      WHERE 1=1`;
    const params = [];
    if (search) {
      q += ` AND (dr.drp_empID LIKE ? OR e.Emp_Firstname LIKE ? OR e.Emp_Lastname LIKE ? OR IFNULL(e.Emp_Vsth,'') LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    const fromDate = dateFrom ? dateFrom.replace(/-/g, '/') : '';
    const toDate = dateTo ? dateTo.replace(/-/g, '/') : '';
    if (fromDate && toDate) {
      q += ` AND STR_TO_DATE(REPLACE(COALESCE(NULLIF(dr.drp_Sdate,''), NULLIF(dr.drp_Edate,'')), '/', '-'), '%Y-%m-%d')
               <= STR_TO_DATE(REPLACE(?, '/', '-'), '%Y-%m-%d')
             AND STR_TO_DATE(REPLACE(COALESCE(NULLIF(dr.drp_Edate,''), NULLIF(dr.drp_Sdate,'')), '/', '-'), '%Y-%m-%d')
               >= STR_TO_DATE(REPLACE(?, '/', '-'), '%Y-%m-%d')`;
      params.push(toDate, fromDate);
    } else if (fromDate) {
      q += ` AND STR_TO_DATE(REPLACE(COALESCE(NULLIF(dr.drp_Edate,''), NULLIF(dr.drp_Sdate,'')), '/', '-'), '%Y-%m-%d')
               >= STR_TO_DATE(REPLACE(?, '/', '-'), '%Y-%m-%d')`;
      params.push(fromDate);
    } else if (toDate) {
      q += ` AND STR_TO_DATE(REPLACE(COALESCE(NULLIF(dr.drp_Sdate,''), NULLIF(dr.drp_Edate,'')), '/', '-'), '%Y-%m-%d')
               <= STR_TO_DATE(REPLACE(?, '/', '-'), '%Y-%m-%d')`;
      params.push(toDate);
    }
    if (subID) { q += ` AND e.Sub_ID = ?`; params.push(subID); }
    if (vsth) {
      q += ` AND UPPER(COALESCE(NULLIF(TRIM(e.Emp_Vsth), ''), NULLIF(TRIM(dr.drp_status), ''),
        CASE
          WHEN UPPER(TRIM(dr.drp_empID)) LIKE 'SK%' THEN 'SK'
          WHEN UPPER(TRIM(dr.drp_empID)) LIKE 'TBS%' THEN 'TBS'
          WHEN UPPER(TRIM(dr.drp_empID)) LIKE 'CWS%' THEN 'CWS'
          ELSE 'VEL'
        END
      )) = ?`;
      params.push(vsth.toUpperCase());
    }
    if (leaveType) { q += ` AND dr.drp_Type = ?`; params.push(leaveType); }
    // Use larger limit when a specific employee is being searched for
    const rowLimit = search ? 5000 : 1000;
    q += ` ORDER BY dr.drp_id DESC LIMIT ${rowLimit}`;
    const [rows] = await db.execute(q, params);
    return { success: true, data: rows };
  } catch (e) { return { success: false, message: e.message }; }
});
// Add daily report
ipcMain.handle('add-daily-report', async (event, d) => {
  if (!db) return { success: false };
  try {
    await db.execute(
      `INSERT INTO daily_report
       (drp_empID,drp_record,drp_Type,drp_Communicate,drp_Communicate1,
        drp_Sdate,drp_Stime,drp_Edate,drp_Etime,drp_status,drp_Remark)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [d.drp_empID, d.drp_record, d.drp_Type, d.drp_Communicate, d.drp_Communicate1,
      d.drp_Sdate, d.drp_Stime, d.drp_Edate, d.drp_Etime, d.drp_status, d.drp_Remark]
    );
    return { success: true, message: 'บันทึกการลาสำเร็จ' };
  } catch (e) { return { success: false, message: e.message }; }
});

// Update daily report
ipcMain.handle('update-daily-report', async (event, d) => {
  if (!db) return { success: false };
  try {
    await db.execute(
      `UPDATE daily_report SET
       drp_empID=?,drp_record=?,drp_Type=?,drp_Communicate=?,drp_Communicate1=?,
       drp_Sdate=?,drp_Stime=?,drp_Edate=?,drp_Etime=?,drp_status=?,drp_Remark=?,
       drp_TimeStamp=NOW()
       WHERE drp_id=?`,
      [d.drp_empID, d.drp_record, d.drp_Type, d.drp_Communicate, d.drp_Communicate1,
      d.drp_Sdate, d.drp_Stime, d.drp_Edate, d.drp_Etime, d.drp_status, d.drp_Remark, d.drp_id]
    );
    return { success: true, message: 'แก้ไขข้อมูลการลาสำเร็จ' };
  } catch (e) { return { success: false, message: e.message }; }
});

// Delete daily report
ipcMain.handle('delete-daily-report', async (event, id) => {
  if (!db) return { success: false };
  try {
    await db.execute('DELETE FROM daily_report WHERE drp_id=?', [id]);
    return { success: true, message: 'ลบข้อมูลการลาสำเร็จ' };
  } catch (e) { return { success: false, message: e.message }; }
});

// Get employee training history
ipcMain.handle('get-employee-training', async (event, empId) => {
  if (!db) return { success: false, message: 'à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¹€à¸Šà¸·à¹ˆà¸­à¸¡à¸•à¹ˆà¸­à¸à¸²à¸™à¸‚à¹‰อมูล' };
  try {
    const [rows] = await db.execute(
      `SELECT
        c.Courses_ID,
        c.Courses_Name,
        DATE_FORMAT(tp.Plan_StartDate, '%Y-%m-%d') AS Plan_StartDate,
        DATE_FORMAT(tp.Plan_EndDate,   '%Y-%m-%d') AS Plan_EndDate,
        TIME_FORMAT(tp.Plan_TimeStart, '%H:%i') AS Plan_TimeStart,
        TIME_FORMAT(tp.Plan_TimeEnd, '%H:%i') AS Plan_TimeEnd,
        tp.Plan_Hour,
        tp.Plan_Location,
        tp.Plan_Lecturer,
        tp.Plan_Remark,
        ht.Plan_ID,
        ht.his_state,
        ht.his_remark
      FROM history_training ht
      INNER JOIN training_plan tp ON tp.Plan_ID = ht.Plan_ID
      INNER JOIN courses c ON c.Courses_ID = ht.Courses_ID
      WHERE ht.Emp_ID = ?
      ORDER BY tp.Plan_StartDate DESC`,
      [empId]
    );

    return { success: true, data: rows };
  } catch (e) { return { success: false, message: e.message }; }


});


// Get daily report by specific date (for absence report page)
ipcMain.handle('get-daily-report-by-date', async (event, dateStr) => {
  if (!db) return { success: false };
  try {
    const dbDate = dateStr.replace(/-/g, '/');
    const [rows] = await db.execute(
      `SELECT dr.drp_id, dr.drp_empID, dr.drp_record, dr.drp_Type,
        dr.drp_Communicate, dr.drp_Communicate1,
        dr.drp_Sdate, TIME_FORMAT(dr.drp_Stime,'%H:%i') AS drp_Stime,
        dr.drp_Edate, TIME_FORMAT(dr.drp_Etime,'%H:%i') AS drp_Etime,
        dr.drp_status, dr.drp_Remark,
        CONCAT(IFNULL(e.Emp_Sname,''),IFNULL(e.Emp_Firstname,''),' ',IFNULL(e.Emp_Lastname,'')) AS Fullname,
        e.Emp_Sname, e.Emp_Firstname, e.Emp_Lastname,
        IFNULL(e.Emp_Vsth, dr.drp_status) AS Emp_Vsth,
        s.Sub_Name,
        lt.leave_name, lt.leave_abbreviation
        FROM daily_report dr
        LEFT JOIN employees e ON e.Emp_ID = dr.drp_empID
        LEFT JOIN subdivision s ON s.Sub_ID = e.Sub_ID
        LEFT JOIN leave_type lt ON lt.leave_abbreviation = dr.drp_Type
        WHERE dr.drp_Sdate IS NOT NULL AND dr.drp_Sdate != ''
          AND dr.drp_Sdate <= ?
          AND (dr.drp_Edate IS NULL OR dr.drp_Edate = '' OR dr.drp_Edate >= ?)
        ORDER BY FIELD(IFNULL(e.Emp_Vsth,dr.drp_status),'Vel','SK','TBS','CWS'), dr.drp_empID ASC`,
      [dbDate, dbDate]
    );
    return { success: true, data: rows };
  } catch (e) { return { success: false, message: e.message }; }
});

// Get all leave records where today falls within drp_Sdate..drp_Edate
ipcMain.handle('get-today-on-leave', async (event) => {
  if (!db) return { success: false, message: 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้' };
  try {
    const now = new Date();
    const y = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const todayStr = `${y}/${mo}/${d}`;
    const [rows] = await db.execute(
      `SELECT dr.drp_id, dr.drp_empID, dr.drp_record, dr.drp_Type,
        dr.drp_Communicate, dr.drp_Communicate1,
        dr.drp_Sdate, TIME_FORMAT(dr.drp_Stime,'%H:%i') AS drp_Stime,
        dr.drp_Edate, TIME_FORMAT(dr.drp_Etime,'%H:%i') AS drp_Etime,
        dr.drp_status, dr.drp_Remark,
        CONCAT(IFNULL(e.Emp_Sname,''),IFNULL(e.Emp_Firstname,''),' ',IFNULL(e.Emp_Lastname,'')) AS Fullname,
        e.Emp_Sname, e.Emp_Firstname, e.Emp_Lastname,
        IFNULL(e.Emp_Vsth, dr.drp_status) AS Emp_Vsth,
        s.Sub_Name, p.Position_Name,
        lt.leave_name
        FROM daily_report dr
        LEFT JOIN employees e ON e.Emp_ID = dr.drp_empID
        LEFT JOIN subdivision s ON s.Sub_ID = e.Sub_ID
        LEFT JOIN position p ON p.Position_ID = e.Position_ID
        LEFT JOIN leave_type lt ON lt.leave_abbreviation = dr.drp_Type
        WHERE dr.drp_Sdate IS NOT NULL AND dr.drp_Sdate != ''
          AND dr.drp_Sdate <= ?
          AND (dr.drp_Edate IS NULL OR dr.drp_Edate = '' OR dr.drp_Edate >= ?)
        ORDER BY FIELD(IFNULL(e.Emp_Vsth,dr.drp_status),'Vel','SK','TBS','CWS'), dr.drp_empID ASC`,
      [todayStr, todayStr]
    );
    return { success: true, data: rows };
  } catch (e) { return { success: false, message: e.message }; }
});


// Export daily absence report to Excel (simple multi-sheet workbook)
ipcMain.handle('export-absence-excel', async (event, { date, data }) => {
  if (!Array.isArray(data) || !date) return { success: false, message: 'ไม่มีข้อมูล' };

  try {
    const ExcelJS = require('exceljs');

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const fileStamp = `${yyyy}${mm}${dd}${hh}${mi}`;

    const saveResult = await dialog.showSaveDialog({
      title: 'บันทึกรายงาน Excel',
      defaultPath: `absence_${fileStamp}.xlsx`,
      filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
    });
    if (saveResult.canceled || !saveResult.filePath) return { success: false, message: 'ยกเลิก' };

    const wb = new ExcelJS.Workbook();
    wb.creator = 'HR System';
    wb.created = new Date();

    const GROUP_ORDER = ['VEL', 'SK', 'TBS', 'CWS'];
    const grouped = { VEL: [], SK: [], TBS: [], CWS: [] };

    function normalizeGroup(raw) {
      const v = String(raw || '').trim().toUpperCase();
      if (v === 'VEL' || v === 'SK' || v === 'TBS' || v === 'CWS') return v;
      return 'VEL';
    }

    function communicateLabel(row) {
      if ((row.drp_Communicate || '').trim()) return 'โทร';
      if ((row.drp_Communicate1 || '').trim()) return 'แจ้งล่วงหน้า';
      return '';
    }

    const normalizedRows = data.map((row) => {
      const group = normalizeGroup(row.Emp_Vsth || row.drp_status || 'VEL');
      const normalized = {
        empId: row.drp_empID || '',
        fullName: (row.Fullname || '').trim(),
        department: row.Sub_Name || '',
        leaveType: row.drp_Type || '',
        communicate: communicateLabel(row),
        startDate: row.drp_Sdate || '',
        startTime: row.drp_Stime || '',
        endDate: row.drp_Edate || '',
        endTime: row.drp_Etime || '',
        remark: (row.drp_Remark || '').replace(/\r\n/g, ' ').replace(/\n/g, ' ').trim(),
        recordDate: row.drp_record || '',
        group
      };
      grouped[group].push(normalized);
      return normalized;
    });

    const columns = [
      { header: 'รหัส', key: 'empId', width: 14 },
      { header: 'ชื่อ-นามสกุล', key: 'fullName', width: 28 },
      { header: 'แผนก', key: 'department', width: 20 },
      { header: 'ประเภทลา', key: 'leaveType', width: 12 },
      { header: 'สื่อสาร', key: 'communicate', width: 16 },
      { header: 'วันที่ลา (เริ่ม)', key: 'startDate', width: 14 },
      { header: 'เวลาเริ่ม', key: 'startTime', width: 12 },
      { header: 'วันที่ลาถึง (สิ้นสุด)', key: 'endDate', width: 18 },
      { header: 'เวลาสิ้นสุด', key: 'endTime', width: 12 },
      { header: 'หมายเหตุ/เหตุผล', key: 'remark', width: 36 },
      { header: 'วันที่บันทึก', key: 'recordDate', width: 14 },
    ];

    function fillSheet(sheetName, rows) {
      const ws = wb.addWorksheet(sheetName);
      ws.columns = columns;

      const headerRow = ws.getRow(1);
      headerRow.values = columns.map(c => c.header);
      headerRow.height = 24;

      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF1E88E5' }
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF90CAF9' } },
          left: { style: 'thin', color: { argb: 'FF90CAF9' } },
          bottom: { style: 'thin', color: { argb: 'FF90CAF9' } },
          right: { style: 'thin', color: { argb: 'FF90CAF9' } },
        };
      });

      if (rows.length === 0) {
        ws.addRow({
          empId: '-',
          fullName: 'ไม่มีข้อมูล',
          department: '',
          leaveType: '',
          communicate: '',
          startDate: '',
          startTime: '',
          endDate: '',
          endTime: '',
          remark: '',
          recordDate: ''
        });
      } else {
        rows.forEach(r => ws.addRow(r));
      }

      ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber === 1) return;
        row.eachCell((cell, colNumber) => {
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFE3F2FD' } },
            left: { style: 'thin', color: { argb: 'FFE3F2FD' } },
            bottom: { style: 'thin', color: { argb: 'FFE3F2FD' } },
            right: { style: 'thin', color: { argb: 'FFE3F2FD' } },
          };
          if (colNumber === 10) cell.alignment = { vertical: 'top', wrapText: true };
        });
      });

      ws.views = [{ state: 'frozen', ySplit: 1 }];
      ws.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: columns.length }
      };
    }

    fillSheet('รวมทั้งหมด', normalizedRows);
    GROUP_ORDER.forEach((group) => fillSheet(group, grouped[group] || []));

    await wb.xlsx.writeFile(saveResult.filePath);
    return { success: true, filePath: saveResult.filePath };
  } catch (e) {
    return { success: false, message: e.message };
  }
});





// Get next Plan_ID for document number preview


ipcMain.handle('get-next-plan-id', async (event) => {


  if (!db) return { success: false, message: 'à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¹€à¸Šà¸·à¹ˆà¸­à¸¡à¸•à¹ˆà¸­à¸à¸²à¸™à¸‚à¹‰อมูล' };


  try {


    // Plan_ID is varchar format 'PN00000001', extract numeric part for MAX


    const [rows] = await db.execute(


      `SELECT COALESCE(MAX(CAST(SUBSTRING(Plan_ID, 3) AS UNSIGNED)), 0) + 1 AS nextId FROM training_plan`


    );


    return { success: true, nextId: Number(rows[0].nextId) || 1 };


  } catch (e) { return { success: false, message: e.message }; }


});





// Get all courses


ipcMain.handle('get-courses', async (event) => {


  if (!db) return { success: false, message: 'à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¹€à¸Šà¸·à¹ˆà¸­à¸¡à¸•à¹ˆà¸­à¸à¸²à¸™à¸‚à¹‰อมูล' };


  try {


    const [rows] = await db.execute('SELECT Courses_ID, Courses_Name, Courses_Date, Courses_Remark FROM courses ORDER BY Courses_Name');


    return { success: true, data: rows };


  } catch (e) { return { success: false, message: e.message }; }


});





// Get training plans with server-side pagination


ipcMain.handle('get-training-plans', async (event, filters = {}) => {


  if (!db) return { success: false, message: 'à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¹€à¸Šà¸·à¹ˆà¸­à¸¡à¸•à¹ˆà¸­à¸à¸²à¸™à¸‚à¹‰อมูล' };


  try {


    const { search = '', page = 1, perPage = 25, yearFilter = '', dateFrom = '', dateTo = '' } = filters;


    const safePerPage = Math.max(1, Math.min(Number(perPage) || 25, 100));


    const safePage = Math.max(1, Number(page) || 1);


    const offset = (safePage - 1) * safePerPage;





    const conditions = ['1=1'];


    const params = [];





    if (search) {


      conditions.push(`(


        tp.Plan_ID LIKE ?


        OR c.Courses_Name LIKE ?


        OR tp.Plan_Company LIKE ?


        OR tp.Plan_Lecturer LIKE ?


        OR tp.Plan_Coordinator LIKE ?


      )`);


      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);


    }


    if (yearFilter) {


      conditions.push(`YEAR(tp.Plan_StartDate) = ?`);


      params.push(Number(yearFilter));


    }


    if (dateFrom) {


      conditions.push(`tp.Plan_StartDate >= ?`);


      params.push(dateFrom);


    }


    if (dateTo) {


      conditions.push(`tp.Plan_StartDate <= ?`);


      params.push(dateTo);


    }


    const joins = `FROM training_plan tp INNER JOIN courses c ON c.Courses_ID = tp.Courses_ID`;


    const where = `WHERE ${conditions.join(' AND ')}`;


    const participantJoin = `


      LEFT JOIN (


        SELECT Plan_ID, COUNT(*) AS ParticipantCount


        FROM history_training


        GROUP BY Plan_ID


      ) participant_counts ON participant_counts.Plan_ID = tp.Plan_ID`;





    const [countRows] = await db.execute(


      `SELECT COUNT(*) AS total


      ${joins} ${where}`,


      params


    );





    const [summaryRows] = await db.execute(


      `SELECT


        COUNT(*) AS totalCount,


        SUM(CASE WHEN tp.Plan_TypeTraining = 'ภายใน' THEN 1 ELSE 0 END) AS internalCount,


        SUM(CASE WHEN tp.Plan_TypeTraining = 'ภายนอก' THEN 1 ELSE 0 END) AS externalCount


      ${joins} ${where}`,


      params


    );





    const [rows] = await db.execute(


      `SELECT tp.Plan_ID, tp.Plan_Record, c.Courses_ID, c.Courses_Name,


        tp.Plan_Hour, tp.Plan_Company, tp.Plan_Location, tp.Plan_TypeTraining,


        tp.Plan_Lecturer, DATE_FORMAT(tp.Plan_StartDate, '%Y-%m-%d') AS Plan_StartDate,


        TIME_FORMAT(tp.Plan_TimeStart, '%H:%i') AS Plan_TimeStart, DATE_FORMAT(tp.Plan_EndDate, '%Y-%m-%d') AS Plan_EndDate,


        TIME_FORMAT(tp.Plan_TimeEnd, '%H:%i') AS Plan_TimeEnd, tp.Plan_Remark, tp.Plan_Coordinator, tp.Plan_Status,


        DATE_FORMAT(tp.Plan_Record, '%Y-%m-%d %H:%i:%s') AS Plan_Record_DateTime,


        COALESCE(participant_counts.ParticipantCount, 0) AS ParticipantCount


      ${joins}


      ${participantJoin}


      ${where}


      ORDER BY tp.Plan_StartDate DESC, tp.Plan_ID DESC


      LIMIT ${safePerPage} OFFSET ${offset}`,


      params


    );


    const [yearRows] = await db.execute(


      `SELECT DISTINCT YEAR(Plan_StartDate) AS yr FROM training_plan ORDER BY yr DESC`


    );


    const availableYears = yearRows.map(r => r.yr).filter(Boolean);





    return {


      success: true,


      data: rows,


      total: Number(countRows[0].total) || 0,


      page: safePage,


      perPage: safePerPage,


      summary: {


        total: Number(summaryRows[0]?.totalCount) || 0,


        internal: Number(summaryRows[0]?.internalCount) || 0,


        external: Number(summaryRows[0]?.externalCount) || 0


      },


      availableYears


    };


  } catch (e) { return { success: false, message: e.message }; }


});





// Save training plan (create new or update existing)


ipcMain.handle('save-training-plan', async (event, data) => {


  if (!db) return { success: false, message: 'à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¹€à¸Šà¸·à¹ˆà¸­à¸¡à¸•à¹ˆà¸­à¸à¸²à¸™à¸‚à¹‰อมูล' };


  try {


    // Convert date format from YYYY-MM-DD to YYYY/MM/DD for MySQL


    const startDate = data.Plan_StartDate.replace(/-/g, '/');


    const endDate = data.Plan_EndDate.replace(/-/g, '/');


    const normalizePlanTime = (value) => {


      const raw = String(value || '').trim();


      if (!raw) return '';


      const match = raw.match(/^(\d{1,2}):(\d{2})/);


      if (match) return `${match[1].padStart(2, '0')}:${match[2]}`;


      const digits = raw.replace(/\D/g, '');


      if (digits.length >= 4) return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;


      return raw;


    };


    const startTime = normalizePlanTime(data.Plan_TimeStart);


    const endTime = normalizePlanTime(data.Plan_TimeEnd);





    let planId;





    if (data.Plan_ID) {


      // Update existing training plan


      await db.execute(


        `UPDATE training_plan SET


          Courses_ID=?, Plan_Hour=?, Plan_Company=?, Plan_Location=?,


          Plan_TypeTraining=?, Plan_Lecturer=?, Plan_StartDate=?, Plan_TimeStart=?,


          Plan_EndDate=?, Plan_TimeEnd=?, Plan_Remark=?, Plan_Coordinator=?, Plan_Status=?


        WHERE Plan_ID=?`,


        [


          data.Courses_ID, data.Plan_Hour, data.Plan_Company, data.Plan_Location,


          data.Plan_TypeTraining, data.Plan_Lecturer, startDate, startTime,


          endDate, endTime, data.Plan_Remark, data.Plan_Coordinator,


          data.Plan_Status || 'Active', data.Plan_ID


        ]


      );


      planId = data.Plan_ID;





      // Remove participants that are no longer in the updated list


      const newParticipants = (data.participants && data.participants.length > 0) ? data.participants : [];


      if (newParticipants.length > 0) {


        const placeholders = newParticipants.map(() => '?').join(',');


        await db.execute(


          `DELETE FROM history_training WHERE Plan_ID=? AND Emp_ID NOT IN (${placeholders})`,


          [planId, ...newParticipants]


        );


      } else {


        await db.execute('DELETE FROM history_training WHERE Plan_ID=?', [planId]);


      }


    } else {


      // Generate next Plan_ID in 'PN00000001' format


      const [nextIdRows] = await db.execute(


        `SELECT COALESCE(MAX(CAST(SUBSTRING(Plan_ID, 3) AS UNSIGNED)), 0) + 1 AS nextId FROM training_plan`


      );


      const nextNum = Number(nextIdRows[0].nextId) || 1;


      const newPlanId = 'PN' + String(nextNum).padStart(8, '0');





      // Insert new training plan with generated Plan_ID


      await db.execute(


        `INSERT INTO training_plan (Plan_ID, Courses_ID, Plan_Hour, Plan_Company, Plan_Location,


          Plan_TypeTraining, Plan_Lecturer, Plan_StartDate, Plan_TimeStart,


          Plan_EndDate, Plan_TimeEnd, Plan_Remark, Plan_Coordinator, Plan_Status, Plan_Record)


        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE())`,


        [


          newPlanId, data.Courses_ID, data.Plan_Hour, data.Plan_Company, data.Plan_Location,


          data.Plan_TypeTraining, data.Plan_Lecturer, startDate, startTime,


          endDate, endTime, data.Plan_Remark, data.Plan_Coordinator, 'Active'


        ]


      );


      planId = newPlanId;


    }





    // Add participants to history_training


    if (data.participants && data.participants.length > 0) {


      for (const empId of data.participants) {


        // Check if participant already exists


        const [existing] = await db.execute(


          'SELECT his_id FROM history_training WHERE Plan_ID=? AND Emp_ID=? AND Courses_ID=?',


          [planId, empId, data.Courses_ID]


        );





        if (existing.length === 0) {


          await db.execute(


            `INSERT INTO history_training (Courses_ID, Plan_ID, Emp_ID, his_state, his_timestamp)


            VALUES (?, ?, ?, 'Pending', NOW())`,


            [data.Courses_ID, planId, empId]


          );


        }


      }


    }





    return { success: true, message: 'บันทึกแผนการฝึกอบรมสำเร็จ', data: { Plan_ID: planId } };


  } catch (e) { return { success: false, message: e.message }; }


});





// Get training participants (employees in history_training for a specific plan)


ipcMain.handle('get-training-participants', async (event, planId) => {


  if (!db) return { success: false, message: 'à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¹€à¸Šà¸·à¹ˆà¸­à¸¡à¸•à¹ˆà¸­à¸à¸²à¸™à¸‚à¹‰อมูล' };


  try {


    const [rows] = await db.execute(


      `SELECT ht.his_id, ht.Emp_ID, ht.his_state, ht.his_remark,


        e.Emp_ID, CONCAT(e.Emp_Sname, e.Emp_Firstname, ' ', e.Emp_Lastname) AS Fullname,


        s.Sub_Name, p.Position_Name


      FROM history_training ht


      INNER JOIN employees e ON e.Emp_ID = ht.Emp_ID


      LEFT JOIN subdivision s ON s.Sub_ID = e.Sub_ID


      LEFT JOIN position p ON p.Position_ID = e.Position_ID


      WHERE ht.Plan_ID = ?


      ORDER BY e.Emp_ID ASC`,


      [planId]


    );


    return { success: true, data: rows };


  } catch (e) { return { success: false, message: e.message }; }


});





// ===================== TRAINING RECORD IPC =====================





// Get training plans list for record dropdown (no pagination)


ipcMain.handle('get-training-plans-for-record', async () => {


  if (!db) return { success: false, message: 'à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¹€à¸Šà¸·à¹ˆà¸­à¸¡à¸•à¹ˆà¸­à¸à¸²à¸™à¸‚à¹‰อมูล' };


  try {


    const [rows] = await db.execute(


      `SELECT tp.Plan_ID, c.Courses_ID, c.Courses_Name,


        DATE_FORMAT(tp.Plan_StartDate, '%Y-%m-%d') AS Plan_StartDate,


        TIME_FORMAT(tp.Plan_TimeStart, '%H:%i') AS Plan_TimeStart,


        DATE_FORMAT(tp.Plan_EndDate, '%Y-%m-%d') AS Plan_EndDate,


        TIME_FORMAT(tp.Plan_TimeEnd, '%H:%i') AS Plan_TimeEnd,


        tp.Plan_Lecturer, tp.Plan_Company, tp.Plan_Location, tp.Plan_Hour


      FROM training_plan tp


      INNER JOIN courses c ON c.Courses_ID = tp.Courses_ID


      ORDER BY tp.Plan_StartDate DESC, tp.Plan_ID DESC


      LIMIT 500`


    );


    return { success: true, data: rows };


  } catch (e) { return { success: false, message: e.message }; }


});





// Get participants with name parts for training record export


ipcMain.handle('get-training-record-participants', async (event, planId) => {


  if (!db) return { success: false, message: 'à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¹€à¸Šà¸·à¹ˆà¸­à¸¡à¸•à¹ˆà¸­à¸à¸²à¸™à¸‚à¹‰อมูล' };


  try {


    const [rows] = await db.execute(


      `SELECT ht.his_id, ht.Emp_ID, ht.his_state, ht.his_remark,


        e.Emp_Sname, e.Emp_Firstname, e.Emp_Lastname,


        CONCAT(e.Emp_Sname, e.Emp_Firstname, ' ', e.Emp_Lastname) AS Fullname,


        s.Sub_Name, p.Position_Name


      FROM history_training ht


      INNER JOIN employees e ON e.Emp_ID = ht.Emp_ID


      LEFT JOIN subdivision s ON s.Sub_ID = e.Sub_ID


      LEFT JOIN position p ON p.Position_ID = e.Position_ID


      WHERE ht.Plan_ID = ?


      ORDER BY e.Emp_ID ASC`,


      [planId]


    );


    return { success: true, data: rows };


  } catch (e) { return { success: false, message: e.message }; }


});





ipcMain.handle('save-training-record-row', async (event, { hisId, state, remark }) => {


  if (!db) return { success: false, message: 'à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¹€à¸Šà¸·à¹ˆà¸­à¸¡à¸•à¹ˆà¸­à¸à¸²à¸™à¸‚à¹‰อมูล' };


  try {


    await db.execute(


      'UPDATE history_training SET his_state = ?, his_remark = ? WHERE his_id = ?',


      [state || null, remark || '', hisId]


    );


    return { success: true };


  } catch (e) { return { success: false, message: e.message }; }


});


// Check-in employee for a training session (D=morning, N=afternoon, T=all)
// Only registered employees (existing history_training row) may be checked in.
// For half-day plans the check-in is immediately treated as T (passed).
ipcMain.handle('checkin-training', async (event, { planId, empId, session, remark }) => {
  if (!db) return { success: false, message: 'ไม่ได้เชื่อมต่อฐานข้อมูล' };
  const validSessions = ['D', 'N', 'T'];
  if (!validSessions.includes(session)) return { success: false, message: 'session ไม่ถูกต้อง' };
  try {
    // Must already be registered — no new inserts allowed from check-in
    const [existing] = await db.execute(
      'SELECT his_id, his_state FROM history_training WHERE Plan_ID=? AND Emp_ID=?',
      [planId, empId]
    );
    if (existing.length === 0) {
      return { success: false, notRegistered: true, message: 'พนักงานนี้ไม่มีชื่อในรายการอบรมนี้' };
    }

    // Detect if the plan is half-day (morning-only or afternoon-only) → auto-pass
    let finalSession = session;
    const [planRows] = await db.execute(
      'SELECT Plan_TimeStart, Plan_TimeEnd FROM training_plan WHERE Plan_ID=?', [planId]
    );
    if (planRows.length > 0) {
      const toMin = (t) => {
        if (!t) return 0;
        const p = String(t).substring(0, 5).split(':');
        return (Number(p[0]) || 0) * 60 + (Number(p[1]) || 0);
      };
      const startMin = toMin(planRows[0].Plan_TimeStart);
      const endMin   = toMin(planRows[0].Plan_TimeEnd);
      const isHalfDay = endMin <= 12 * 60 || startMin >= 13 * 60;
      if (isHalfDay) finalSession = 'T';
    }

    // Merge with existing state
    const cur = existing[0].his_state;
    let newState = finalSession;
    if (cur === 'T') newState = 'T';
    else if (cur === 'D' && finalSession === 'N') newState = 'T';
    else if (cur === 'N' && finalSession === 'D') newState = 'T';
    else newState = finalSession;

    await db.execute(
      'UPDATE history_training SET his_state=?, his_remark=?, his_timestamp=NOW() WHERE his_id=?',
      [newState, remark || '', existing[0].his_id]
    );
    return { success: true, hisId: existing[0].his_id, newState, isNew: false };
  } catch (e) { return { success: false, message: e.message }; }
});


// Undo check-in: revert state to W (waiting/registered)
ipcMain.handle('undo-checkin-training', async (event, { hisId }) => {
  if (!db) return { success: false, message: 'ไม่ได้เชื่อมต่อฐานข้อมูล' };
  try {
    await db.execute(
      "UPDATE history_training SET his_state='W', his_timestamp=NOW() WHERE his_id=?",
      [hisId]
    );
    return { success: true };
  } catch (e) { return { success: false, message: e.message }; }
});

// Check if a training plan is safe to delete — returns registration & expense counts
ipcMain.handle('check-plan-deletable', async (event, planId) => {
  if (!db) return { success: false, message: 'ไม่ได้เชื่อมต่อฐานข้อมูล' };
  try {
    const [[{ regCount }]] = await db.execute(
      'SELECT COUNT(*) AS regCount FROM history_training WHERE Plan_ID=?', [planId]
    );
    const [[{ expCount }]] = await db.execute(
      'SELECT COUNT(*) AS expCount FROM training_expenses WHERE Plan_ID=?', [planId]
    );
    return { success: true, regCount: Number(regCount), expCount: Number(expCount) };
  } catch (e) { return { success: false, message: e.message }; }
});

// Delete a training plan and all its associated records
ipcMain.handle('delete-training-plan', async (event, planId) => {
  if (!db) return { success: false, message: 'ไม่ได้เชื่อมต่อฐานข้อมูล' };
  try {
    await db.execute('DELETE FROM training_expenses  WHERE Plan_ID=?', [planId]);
    await db.execute('DELETE FROM history_training   WHERE Plan_ID=?', [planId]);
    await db.execute('DELETE FROM training_plan      WHERE Plan_ID=?', [planId]);
    return { success: true };
  } catch (e) { return { success: false, message: e.message }; }
});





// Export training record to Excel using F-HR-002 template


// Each sheet fills all participants: header block (rows 1-8) + 30 data rows, then


// 2 blank spacers + repeat header + continue participants (continuous numbering).


ipcMain.handle('export-training-record-excel', async (event, { plan, participants, timeRange }) => {


  if (!plan || !participants) return { success: false, message: 'ไม่มีข้อมูล' };


  try {


    const ExcelJS = require('exceljs');


    const fs = require('fs');


    const path = require('path');


    const dataDir = path.join(__dirname, 'data');


    const templateName = fs.readdirSync(dataDir).find(name =>


      name.startsWith('F-HR-002') && name.toLowerCase().endsWith('.xlsx')


    );


    if (!templateName) {


      return { success: false, message: 'ไม่พบไฟล์ template F-HR-002 ในโฟลเดอร์ data' };


    }


    const templatePath = path.join(dataDir, templateName);





    let timeLabel = '';


    if (timeRange === 'morning') timeLabel = '08.00 - 12.00 น.';


    else if (timeRange === 'afternoon') timeLabel = '13.00 - 17.00 น.';


    else {


      const ts = plan.Plan_TimeStart ? plan.Plan_TimeStart.substring(0, 5) : '';


      const te = plan.Plan_TimeEnd ? plan.Plan_TimeEnd.substring(0, 5) : '';


      timeLabel = ts && te ? `${ts} - ${te} น.` : (ts || te || '');


    }





    const thMonths = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',


      'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];


    const dObj = plan.Plan_StartDate ? new Date(plan.Plan_StartDate + 'T00:00:00') : new Date();


    const dateLabel = `${dObj.getDate()} ${thMonths[dObj.getMonth()]} ${dObj.getFullYear()}`;





    const saveResult = await dialog.showSaveDialog({


      title: 'บันทึกไฟล์ Excel',


      defaultPath: `F-HR-002_${plan.Plan_StartDate || 'training'}.xlsx`,


      filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]


    });


    if (saveResult.canceled || !saveResult.filePath) return { success: false, message: 'ยกเลิก' };


    const outputPath = saveResult.filePath;





    const wb = new ExcelJS.Workbook();


    await wb.xlsx.readFile(templatePath);





    const HEADER_ROWS = 8;   // rows 1-8 = header block (title, date/time, subject, etc.)


    const FIRST_DATA_ROW = 9;   // data starts at row 9


    const ROWS_PER_BLOCK = 30;  // 30 participants per block (rows 9-38)


    const SPACER_ROWS = 2;   // blank rows between repeated blocks





    const sheet0 = wb.worksheets[0]; // Sheet 1: รายชื่อ


    const sheet1 = wb.worksheets[1]; // Sheet 2: แบบบันทึก


    if (!sheet0) throw new Error('ไม่พบ sheet ในไฟล์ template');





    // ── snapshot(fromRow, toRow): capture rows + merges into offset-based structure ──


    function snapRows(sheet, fromRow, toRow) {


      const rows = [];


      for (let rn = fromRow; rn <= toRow; rn++) {


        const row = sheet.getRow(rn);


        const cells = [];


        row.eachCell({ includeEmpty: true }, (cell, cn) => {


          cells.push({


            cn,


            value: JSON.parse(JSON.stringify(cell.value ?? null)),


            style: JSON.parse(JSON.stringify(cell.style ?? {}))


          });


        });


        rows.push({ rn, height: row.height, cells });


      }


      const merges = [];


      (sheet.model.merges || []).forEach(m => {


        const mo = m.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);


        if (!mo) return;


        const r1 = parseInt(mo[2]), r2 = parseInt(mo[4]);


        if (r1 >= fromRow && r2 <= toRow)


          merges.push([mo[1], r1 - fromRow, mo[3], r2 - fromRow]);


      });


      return { rows, merges, fromRow };


    }





    // ── stamp snapshot onto sheet at targetRow (first snap row goes to targetRow) ──


    function stampSnap(sheet, snap, targetRow) {


      const delta = targetRow - snap.fromRow;


      snap.merges.forEach(([c1, ro1, c2, ro2]) => {


        try {


          sheet.mergeCells(


            `${c1}${snap.fromRow + ro1 + delta}:${c2}${snap.fromRow + ro2 + delta}`


          );


        } catch (e) { }


      });


      snap.rows.forEach(({ rn, height, cells }) => {


        const row = sheet.getRow(rn + delta);


        if (height) row.height = height;


        cells.forEach(({ cn, value, style }) => {


          const cell = row.getCell(cn);


          cell.value = value;


          if (style && Object.keys(style).length) cell.style = style;


        });


        row.commit();


      });


    }





    // ── write the 6 variable header values; startRow = where row-1 of the block is ──


    function writeHeaderValues(sheet, startRow) {


      sheet.getCell(startRow + 1, 3).value = dateLabel;           // C2: date


      sheet.getCell(startRow + 1, 9).value = timeLabel;           // I2: time


      sheet.getCell(startRow + 2, 5).value = plan.Courses_Name || ''; // E3: subject


      sheet.getCell(startRow + 3, 4).value = plan.Plan_Lecturer || ''; // D4: trainer


      sheet.getCell(startRow + 4, 4).value = plan.Plan_Company || ''; // D5: company


      sheet.getCell(startRow + 4, 9).value = plan.Plan_Location || ''; // I5: location


    }





    // ── resolve English names stored duplicated in both fields ──


    // e.g. Firstname="YOON THARAPHI THAW" Lastname="YOON THARAPHI THAW"


    // → firstname="YOON", lastname="THARAPHI THAW"


    function resolveNames(p) {


      let firstname = p.Emp_Firstname || '';


      let lastname = p.Emp_Lastname || '';


      if (firstname && firstname === lastname) {


        const sp = firstname.indexOf(' ');


        if (sp > -1) { lastname = firstname.slice(sp + 1); firstname = firstname.slice(0, sp); }


        else { lastname = ''; }


      }


      return { firstname, lastname };


    }





    // ── write one block of participant rows (up to 30) at dataStartRow ──


    function writeDataBlock(sheet, dataStartRow, globalOffset, dataRowSnap) {


      for (let i = 0; i < ROWS_PER_BLOCK; i++) {


        const pIdx = globalOffset + i;


        const rowNum = dataStartRow + i;


        const row = sheet.getRow(rowNum);


        // Apply data-row style for rows outside the template's original 9-38 range


        if (rowNum < FIRST_DATA_ROW || rowNum >= FIRST_DATA_ROW + ROWS_PER_BLOCK) {


          if (dataRowSnap.rows[0].height) row.height = dataRowSnap.rows[0].height;


          dataRowSnap.rows[0].cells.forEach(({ cn, style }) => {


            if (style && Object.keys(style).length)


              row.getCell(cn).style = JSON.parse(JSON.stringify(style));


          });


        }


        if (pIdx < participants.length) {


          const p = participants[pIdx];


          const { firstname, lastname } = resolveNames(p);


          row.getCell(1).value = pIdx + 1;           // continuous sequence


          row.getCell(2).value = p.Emp_ID || '';


          row.getCell(3).value = p.Emp_Sname || '';  // à¸„à¸³à¸™à¸³à¸«à¸™à¹‰า


          row.getCell(4).value = firstname;           // à¸Šà¸·à¹ˆอ


          row.getCell(5).value = lastname;            // à¸™ามสกุล


          row.getCell(6).value = p.Position_Name || '';


          row.getCell(7).value = p.Sub_Name || '';


          row.getCell(11).value = p.his_remark || '';


        } else {


          for (let c = 1; c <= 11; c++) row.getCell(c).value = null;


        }


        row.commit();


      }


    }





    // ── fill an entire sheet with all participants, repeating header every 30 rows ──


    function fillSheet(sheet) {


      const totalBlocks = Math.max(1, Math.ceil(participants.length / ROWS_PER_BLOCK));





      // Snapshot header and one data-row style BEFORE modifying anything


      const headerSnap = snapRows(sheet, 1, HEADER_ROWS);


      const dataRowSnap = snapRows(sheet, FIRST_DATA_ROW, FIRST_DATA_ROW); // row 9 style





      // Block 0: write directly into template rows 1-38


      writeHeaderValues(sheet, 1);


      writeDataBlock(sheet, FIRST_DATA_ROW, 0, dataRowSnap);





      // Clear footer rows that follow block 0 in the template (rows 39+)


      if (totalBlocks > 1) {


        for (let r = FIRST_DATA_ROW + ROWS_PER_BLOCK; r <= FIRST_DATA_ROW + ROWS_PER_BLOCK + 8; r++) {


          const row = sheet.getRow(r);


          row.eachCell({ includeEmpty: true }, cell => { cell.value = null; });


          row.commit();


        }


      }





      // Blocks 1, 2, … : 2 spacer rows → header block → data block


      let nextRow = FIRST_DATA_ROW + ROWS_PER_BLOCK; // starts at 39


      for (let b = 1; b < totalBlocks; b++) {


        // Write 2 blank spacer rows


        for (let s = 0; s < SPACER_ROWS; s++) {


          const row = sheet.getRow(nextRow + s);


          row.eachCell({ includeEmpty: true }, cell => { cell.value = null; });


          row.commit();


        }


        nextRow += SPACER_ROWS;





        // Stamp full header block (labels + borders + merges)


        stampSnap(sheet, headerSnap, nextRow);


        writeHeaderValues(sheet, nextRow);


        nextRow += HEADER_ROWS;





        // Write participant data


        writeDataBlock(sheet, nextRow, b * ROWS_PER_BLOCK, dataRowSnap);


        nextRow += ROWS_PER_BLOCK;


      }


    }





    fillSheet(sheet0);


    if (sheet1) fillSheet(sheet1);





    await wb.xlsx.writeFile(outputPath);


    return { success: true, filePath: outputPath };


  } catch (e) {


    return { success: false, message: e.message };


  }


});





// ===================== TRAINING EXPENSES IPC =====================





// Get next Expenses_ID in 'THB0000001' format


ipcMain.handle('get-next-expense-id', async () => {


  if (!db) return { success: false, message: 'à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¹€à¸Šà¸·à¹ˆà¸­à¸¡à¸•à¹ˆà¸­à¸à¸²à¸™à¸‚à¹‰อมูล' };


  try {


    const [rows] = await db.execute(


      `SELECT COALESCE(MAX(CAST(SUBSTRING(Expenses_ID, 4) AS UNSIGNED)), 0) + 1 AS nextId FROM training_expenses`


    );


    return { success: true, nextId: Number(rows[0].nextId) || 1 };


  } catch (e) { return { success: false, message: e.message }; }


});





// Search training plans available for expense entry (exclude plans that already have an expense)


// Supports exact=true for single-plan lookup (used on submit validation)


ipcMain.handle('search-plans-for-expense', async (event, { keyword = '', exact = false } = {}) => {


  if (!db) return { success: false, message: 'à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¹€à¸Šà¸·à¹ˆà¸­à¸¡à¸•à¹ˆà¸­à¸à¸²à¸™à¸‚à¹‰อมูล' };


  try {


    const editingExpensesId = null; // always exclude existing entries on create


    let whereClause, params;


    if (exact) {


      whereClause = `WHERE tp.Plan_ID = ? AND tp.Plan_ID NOT IN (SELECT Plan_ID FROM training_expenses)`;


      params = [keyword.trim()];


    } else {


      whereClause = `WHERE (tp.Plan_ID LIKE ? OR c.Courses_Name LIKE ? OR c.Courses_ID LIKE ?)


        AND tp.Plan_ID NOT IN (SELECT Plan_ID FROM training_expenses)`;


      const q = `%${keyword.trim()}%`;


      params = [q, q, q];


    }


    const [rows] = await db.execute(


      `SELECT tp.Plan_ID, c.Courses_ID, c.Courses_Name,


        DATE_FORMAT(tp.Plan_StartDate, '%Y-%m-%d') AS Plan_StartDate,


        tp.Plan_Company


      FROM training_plan tp


      INNER JOIN courses c ON c.Courses_ID = tp.Courses_ID


      ${whereClause}


      ORDER BY tp.Plan_ID DESC


      LIMIT 20`,


      params


    );


    return { success: true, data: rows };


  } catch (e) { return { success: false, message: e.message }; }


});





// Get expenses list with pagination + stats


ipcMain.handle('get-expenses', async (event, filters = {}) => {


  if (!db) return { success: false, message: 'à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¹€à¸Šà¸·à¹ˆà¸­à¸¡à¸•à¹ˆà¸­à¸à¸²à¸™à¸‚à¹‰อมูล' };


  try {


    const { search = '', page = 1, perPage = 15, yearFilter = '', dateFrom = '', dateTo = '' } = filters;


    const safePerPage = Math.max(10, Math.min(25, Number(perPage) || 15));


    const safePage = Math.max(1, Number(page) || 1);


    const offset = (safePage - 1) * safePerPage;





    const conditions = ['1=1'];


    const params = [];


    if (search) {


      conditions.push(`(te.Expenses_ID LIKE ? OR tp.Plan_ID LIKE ? OR c.Courses_Name LIKE ? OR c.Courses_ID LIKE ?)`);


      const q = `%${search}%`;


      params.push(q, q, q, q);


    }


    if (yearFilter) {


      conditions.push(`YEAR(tp.Plan_StartDate) = ?`);


      params.push(Number(yearFilter));


    }


    if (dateFrom) {


      conditions.push(`tp.Plan_StartDate >= ?`);


      params.push(dateFrom);


    }


    if (dateTo) {


      conditions.push(`tp.Plan_StartDate <= ?`);


      params.push(dateTo);


    }


    const where = `WHERE ${conditions.join(' AND ')}`;


    const joins = `FROM training_expenses te


      INNER JOIN training_plan tp ON tp.Plan_ID = te.Plan_ID


      INNER JOIN courses c ON c.Courses_ID = te.Courses_ID`;





    const [[{ total }]] = await db.execute(


      `SELECT COUNT(*) AS total ${joins} ${where}`, params


    );





    const [[statsRow]] = await db.execute(


      `SELECT


        COUNT(*) AS totalAll,


        COALESCE(SUM(CAST(te.Expenses_Sum AS UNSIGNED)), 0) AS sumAll,


        SUM(CASE WHEN YEAR(te.Expenses_TimeStamp)=YEAR(NOW()) AND MONTH(te.Expenses_TimeStamp)=MONTH(NOW()) THEN 1 ELSE 0 END) AS thisMonth,


        SUM(CASE WHEN YEAR(te.Expenses_TimeStamp)=YEAR(NOW()) AND MONTH(te.Expenses_TimeStamp)=MONTH(NOW()) THEN CAST(te.Expenses_Sum AS UNSIGNED) ELSE 0 END) AS sumMonth


      FROM training_expenses te


      INNER JOIN training_plan tp ON tp.Plan_ID = te.Plan_ID


      INNER JOIN courses c ON c.Courses_ID = te.Courses_ID`,


      []


    );





    const [rows] = await db.execute(


      `SELECT te.Expenses_ID, te.Plan_ID, te.Courses_ID, c.Courses_Name,


        te.Expenses_Lecturer, te.Expenses_Tools, te.Expenses_Food,


        te.Expenses_Snack, te.Expenses_Travel, te.Expenses_Sum,


        te.Expenses_Remarks,


        DATE_FORMAT(te.Expenses_TimeStamp, '%Y-%m-%dT%H:%i:%s') AS Expenses_TimeStamp


      ${joins} ${where}


      ORDER BY te.Expenses_TimeStamp DESC, te.Expenses_ID DESC


      LIMIT ${safePerPage} OFFSET ${offset}`,


      params


    );





    const [periodRows] = await db.execute(


      `SELECT
        COALESCE(SUM(CAST(te.Expenses_Lecturer AS DECIMAL(12,2))), 0) AS sumLecturer,
        COALESCE(SUM(CAST(te.Expenses_Tools AS DECIMAL(12,2))), 0) AS sumTools,
        COALESCE(SUM(CAST(te.Expenses_Food AS DECIMAL(12,2))), 0) AS sumFood,
        COALESCE(SUM(CAST(te.Expenses_Snack AS DECIMAL(12,2))), 0) AS sumSnack,
        COALESCE(SUM(CAST(te.Expenses_Travel AS DECIMAL(12,2))), 0) AS sumTravel,
        COALESCE(SUM(CAST(te.Expenses_Sum AS DECIMAL(12,2))), 0) AS sumTotal,
        COUNT(*) AS cnt
      ${joins} ${where}`,


      params


    );


    const [expYearRows] = await db.execute(


      `SELECT DISTINCT YEAR(tp.Plan_StartDate) AS yr FROM training_expenses te INNER JOIN training_plan tp ON tp.Plan_ID = te.Plan_ID ORDER BY yr DESC`


    );


    const expAvailableYears = expYearRows.map(r => r.yr).filter(Boolean);


    return {


      success: true,


      data: rows,


      total: Number(total) || 0,


      page: safePage,


      perPage: safePerPage,


      stats: {


        total: Number(statsRow.totalAll) || 0,


        sumAll: Number(statsRow.sumAll) || 0,


        thisMonth: Number(statsRow.thisMonth) || 0,


        sumMonth: Number(statsRow.sumMonth) || 0,


      },


      periodSummary: {


        sumLecturer: Number(periodRows[0]?.sumLecturer) || 0,


        sumTools: Number(periodRows[0]?.sumTools) || 0,


        sumFood: Number(periodRows[0]?.sumFood) || 0,


        sumSnack: Number(periodRows[0]?.sumSnack) || 0,


        sumTravel: Number(periodRows[0]?.sumTravel) || 0,


        sumTotal: Number(periodRows[0]?.sumTotal) || 0,


        count: Number(periodRows[0]?.cnt) || 0,


      },


      availableYears: expAvailableYears


    };


  } catch (e) { return { success: false, message: e.message }; }


});





// Save (create or update) a training expense record


ipcMain.handle('save-expense', async (event, data) => {


  if (!db) return { success: false, message: 'à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¹€à¸Šà¸·à¹ˆà¸­à¸¡à¸•à¹ˆà¸­à¸à¸²à¸™à¸‚à¹‰อมูล' };


  try {


    const { Expenses_ID, Plan_ID, Courses_ID,


      Expenses_Lecturer, Expenses_Tools, Expenses_Food,


      Expenses_Snack, Expenses_Travel, Expenses_Sum, Expenses_Remarks } = data;





    if (!Plan_ID || !Courses_ID) return { success: false, message: 'ข้อมูลไม่ครบถ้วน' };





    if (Expenses_ID) {


      // Update existing — verify it's within editable window (≤ 1 month)


      const [[existing]] = await db.execute(


        `SELECT Expenses_TimeStamp FROM training_expenses WHERE Expenses_ID = ?`, [Expenses_ID]


      );


      if (!existing) return { success: false, message: 'ไม่พบรายการที่ต้องการแก้ไข' };





      const ts = new Date(existing.Expenses_TimeStamp);


      const cutoff = new Date();


      cutoff.setMonth(cutoff.getMonth() - 1);


      if (ts < cutoff) return { success: false, message: 'ไม่สามารถแก้ไขได้ เนื่องจากบันทึกเกิน 1 à¹€à¸”à¸·à¸­à¸™à¹à¸¥à¹‰ว' };





      await db.execute(


        `UPDATE training_expenses SET


          Expenses_Lecturer=?, Expenses_Tools=?, Expenses_Food=?,


          Expenses_Snack=?, Expenses_Travel=?, Expenses_Sum=?, Expenses_Remarks=?


        WHERE Expenses_ID=?`,


        [Expenses_Lecturer, Expenses_Tools, Expenses_Food,


          Expenses_Snack, Expenses_Travel, Expenses_Sum, Expenses_Remarks || '',


          Expenses_ID]


      );


      return { success: true, message: 'แก้ไขค่าใช้จ่ายสำเร็จ' };


    } else {


      // Insert new — generate next ID


      const [[nextRow]] = await db.execute(


        `SELECT COALESCE(MAX(CAST(SUBSTRING(Expenses_ID, 4) AS UNSIGNED)), 0) + 1 AS nextId FROM training_expenses`


      );


      const nextNum = Number(nextRow.nextId) || 1;


      const newId = 'THB' + String(nextNum).padStart(7, '0');





      // Check plan not already recorded


      const [[dup]] = await db.execute(


        `SELECT Expenses_ID FROM training_expenses WHERE Plan_ID = ?`, [Plan_ID]


      );


      if (dup) return { success: false, message: `à¹à¸œà¸™à¸à¸²à¸£à¸­à¸šà¸£à¸¡à¸™à¸µà¹‰à¸¡à¸µà¸à¸²à¸£à¸šà¸±à¸™à¸—à¸¶à¸à¸„à¹ˆà¸²à¹ƒà¸Šà¹‰à¸ˆà¹ˆà¸²à¸¢à¹à¸¥à¹‰ว (${dup.Expenses_ID})` };





      await db.execute(


        `INSERT INTO training_expenses


          (Expenses_ID, Plan_ID, Courses_ID, Expenses_Lecturer, Expenses_Tools,


           Expenses_Food, Expenses_Snack, Expenses_Travel, Expenses_Sum, Expenses_Remarks)


        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,


        [newId, Plan_ID, Courses_ID,


          Expenses_Lecturer, Expenses_Tools, Expenses_Food,


          Expenses_Snack, Expenses_Travel, Expenses_Sum, Expenses_Remarks || '']


      );


      return { success: true, message: 'บันทึกค่าใช้จ่ายสำเร็จ', data: { Expenses_ID: newId } };


    }


  } catch (e) { return { success: false, message: e.message }; }


});





// ===================== HOLIDAY IPC =====================


// Table: holiday  Columns: ID (INT PK AUTO_INCREMENT), `Date` (VARCHAR YYYY/MM/DD), `Important Day` (VARCHAR)
// Get holidays by year (CE year)
ipcMain.handle('get-holidays', async (event, { year } = {}) => {
  if (!db) return { success: false, message: 'à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¹€à¸Šà¸·à¹ˆà¸­à¸¡à¸•à¹ˆà¸­à¸à¸²à¸™à¸‚à¹‰อมูล' };
  try {
    const ceYear = year ? parseInt(year, 10) : new Date().getFullYear();
    const [rows] = await db.execute(
      "SELECT `ID`, `Date`, `Important Day` FROM `holiday` WHERE SUBSTRING(`Date`, 1, 4) = ? ORDER BY `Date` ASC",
      [String(ceYear)]
    );
    return { success: true, data: rows };
  } catch (e) { return { success: false, message: e.message }; }
});





// Save holiday (INSERT or UPDATE)
ipcMain.handle('save-holiday', async (event, data) => {
  if (!db) return { success: false, message: 'à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¹€à¸Šà¸·à¹ˆà¸­à¸¡à¸•à¹ˆà¸­à¸à¸²à¸™à¸‚à¹‰อมูล' };
  try {
    const { Holiday_ID, Holiday_Date, Holiday_Name } = data;
    if (!Holiday_Date || !Holiday_Name) return { success: false, message: 'ข้อมูลไม่ครบถ้วน' };
    if (Holiday_ID) {
      // UPDATE
      await db.execute(
        "UPDATE `holiday` SET `Date`=?, `Important Day`=? WHERE `ID`=?",
        [Holiday_Date, String(Holiday_Name).trim(), Holiday_ID]
      );
      return { success: true, message: 'แก้ไขวันหยุดสำเร็จ' };
    } else {
      // INSERT — prevent duplicate date
      const [dup] = await db.execute(
        "SELECT `ID` FROM `holiday` WHERE `Date`=?", [Holiday_Date]
      );
      if (dup.length > 0) return { success: false, message: 'à¸§à¸±à¸™à¸—à¸µà¹ˆà¸™à¸µà¹‰à¸¡à¸µà¸§à¸±à¸™à¸«à¸¢à¸¸à¸”à¸­à¸¢à¸¹à¹ˆà¹à¸¥à¹‰ว' };
      await db.execute(
        "INSERT INTO `holiday` (`Date`, `Important Day`) VALUES (?, ?)",
        [Holiday_Date, String(Holiday_Name).trim()]
      );
      return { success: true, message: 'เพิ่มวันหยุดสำเร็จ' };
    }
  } catch (e) { return { success: false, message: e.message }; }
});





// Delete holiday by ID
ipcMain.handle('delete-holiday', async (event, holidayId) => {
  if (!db) return { success: false, message: 'à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¹€à¸Šà¸·à¹ˆà¸­à¸¡à¸•à¹ˆà¸­à¸à¸²à¸™à¸‚à¹‰อมูล' };
  try {
    await db.execute("DELETE FROM `holiday` WHERE `ID`=?", [parseInt(holidayId, 10)]);
    return { success: true };
  } catch (e) { return { success: false, message: e.message }; }
});





// Get holidays by year+month (for OT form)
ipcMain.handle('get-holidays-for-month', async (event, { year, month } = {}) => {
  if (!db) return { success: false, message: 'à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¹€à¸Šà¸·à¹ˆà¸­à¸¡à¸•à¹ˆà¸­à¸à¸²à¸™à¸‚à¹‰อมูล' };
  try {
    const ceYear = year ? parseInt(year, 10) : new Date().getFullYear();
    const mm = String(month || (new Date().getMonth() + 1)).padStart(2, '0');
    const prefix = `${ceYear}/${mm}`;
    const [rows] = await db.execute(
      "SELECT `ID`, `Date`, `Important Day` FROM `holiday` WHERE SUBSTRING(`Date`, 1, 7) = ? ORDER BY `Date` ASC",
      [prefix]
    );
    return { success: true, data: rows };
  } catch (e) { return { success: false, message: e.message }; }
});





// ===================== OT EXCEL EXPORT =====================
ipcMain.handle('export-ot-excel', async (event, { forms, ceYear, month }) => {
  if (!Array.isArray(forms) || forms.length === 0) {
    return { success: false, message: 'ไม่มีข้อมูลสำหรับส่งออก' };
  }

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'บันทึกไฟล์ Excel',
    defaultPath: `OT_${ceYear + 543}_${String(month).padStart(2, '0')}.xlsx`,
    filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
  });
  if (canceled || !filePath) return { success: false, canceled: true };

  // ── Fetch supervisor info for each unique Sub_ID used in forms ─────────────
  const subSupMap = new Map(); // Sub_ID → { name, position }
  if (db) {
    try {
      const uniqueSubIds = [...new Set(forms.map(f => f.emp?.Sub_ID).filter(Boolean))];
      if (uniqueSubIds.length > 0) {
        const placeholders = uniqueSubIds.map(() => '?').join(',');
        const [rows] = await db.execute(
          `SELECT s.Sub_ID,
            TRIM(CONCAT(IFNULL(e.Emp_Sname,''), IFNULL(e.Emp_Firstname,''), ' ', IFNULL(e.Emp_Lastname,''))) AS sup_name,
            p.Position_Name AS sup_pos
           FROM subdivision s
           LEFT JOIN employees e ON e.Emp_ID = s.Supervisor_EmpID AND s.Supervisor_EmpID != ''
           LEFT JOIN position p ON p.Position_ID = e.Position_ID
           WHERE s.Sub_ID IN (${placeholders})`,
          uniqueSubIds
        );
        rows.forEach(r => subSupMap.set(r.Sub_ID, { name: (r.sup_name || '').trim(), position: r.sup_pos || '' }));
      }
    } catch { /* non-fatal — continue export without supervisor */ }
  }

  const THAI_MONTHS_XL = ['',
    'มกราคม',
    'กุมภาพันธ์',
    'มีนาคม',
    'เมษายน',
    'พฤษภาคม',
    'มิถุนายน',
    'กรกฎาคม',
    'สิงหาคม',
    'กันยายน',
    'ตุลาคม',
    'พฤศจิกายน',
    'ธันวาคม'];

  const beYear = ceYear + 543;
  const monthName = THAI_MONTHS_XL[month];
  const daysInMonth = new Date(ceYear, month, 0).getDate();

  const templatePath = path.join(__dirname, 'data', 'OT.xlsx');
  if (!fs.existsSync(templatePath)) {
    return { success: false, message: `ไม่พบไฟล์ต้นฉบับ: ${templatePath}` };
  }

  const os = require('os');
  const { execFile } = require('child_process');
  const payloadPath = path.join(os.tmpdir(), `ot_export_payload_${Date.now()}.json`);
  const scriptPath = path.join(os.tmpdir(), `ot_export_excel_${Date.now()}.ps1`);

  const exportPayload = {
    title: `     รายงานการทำงานล่วงเวลาประจำเดือน ${monthName} ${beYear}`,
    dateRange: `1 - ${daysInMonth} ${monthName} ${beYear}`,
    forms: forms.map((form, index) => {
      const emp = form.emp || {};
      const sup = subSupMap.get(emp.Sub_ID) || {};
      return {
        sheetName: String(emp.Emp_ID || `OT${index + 1}`),
        firstName: emp.Emp_Firstname || emp.Fullname || '',
        lastName: emp.Emp_Lastname || '',
        empId: String(emp.Emp_ID || ''),
        subName: emp.Sub_Name || '',
        supervisorName: sup.name || '',
        supervisorPosition: sup.position || 'หัวหน้างาน',
        days: (form.days || []).map((day) => {
          let note = '';
          if (day.isHoliday) note = day.holidayName;
          else if (day.dow === 0) note = 'วันอาทิตย์';
          return {
            d: day.d,
            note,
            isHoliday: !!day.isHoliday,
            isSunday: day.dow === 0,
          };
        })
      };
    })
  };

  const psLines = [
    'param([string]$templatePath, [string]$outputPath, [string]$payloadPath)',
    '$ErrorActionPreference = "Stop"',
    '$payload = Get-Content -LiteralPath $payloadPath -Raw -Encoding UTF8 | ConvertFrom-Json',
    '$excel = New-Object -ComObject Excel.Application',
    '$excel.Visible = $false',
    '$excel.DisplayAlerts = $false',
    'function Get-UniqueSheetName($workbook, $baseName) {',
    '  if ([string]::IsNullOrWhiteSpace($baseName)) { $safe = "Sheet" } else { $safe = $baseName }',
    '  if ($safe.Length -gt 31) { $safe = $safe.Substring(0, 31) }',
    '  $name = $safe',
    '  $n = 1',
    '  while ($true) {',
    '    $exists = $false',
    '    foreach ($sheet in $workbook.Worksheets) { if ($sheet.Name -eq $name) { $exists = $true; break } }',
    '    if (-not $exists) { return $name }',
    '    $suffix = "_" + $n',
    '    $trimLen = [Math]::Min(31 - $suffix.Length, $safe.Length)',
    '    $name = $safe.Substring(0, $trimLen) + $suffix',
    '    $n++',
    '  }',
    '}',
    'try {',
    '  $wb = $excel.Workbooks.Open($templatePath)',
    '  $templateSheet = $wb.Worksheets.Item(1)',
    '  for ($i = 0; $i -lt $payload.forms.Count; $i++) {',
    '    $form = $payload.forms[$i]',
    '    if ($i -eq 0) {',
    '      $ws = $templateSheet',
    '    } else {',
    '      $templateSheet.Copy([Type]::Missing, $wb.Worksheets.Item($wb.Worksheets.Count))',
    '      $ws = $wb.Worksheets.Item($wb.Worksheets.Count)',
    '    }',
    '    $ws.Name = Get-UniqueSheetName $wb $form.sheetName',
    '    $ws.Range("A1").Value2 = $payload.title',
    '    $ws.Range("D2").Value2 = $form.firstName',
    '    $ws.Range("F2").Value2 = $form.lastName',
    '    $ws.Range("I2").Value2 = $form.empId',
    '    $ws.Range("D3").Value2 = $form.subName',
    '    $ws.Range("I3").Value2 = $payload.dateRange',
    '    for ($row = 6; $row -le 36; $row++) {',
    '      $ws.Cells.Item($row, 1).Value2 = $null',
    '      $ws.Cells.Item($row, 10).Value2 = $null',
    '      $r = $ws.Range("A" + $row + ":J" + $row)',
    '      $r.Interior.Pattern = -4142',
    '      $r.Interior.ColorIndex = -4142',
    '    }',
    '    for ($d = 0; $d -lt $form.days.Count; $d++) {',
    '      $excelRow = 6 + $d',
    '      $ws.Cells.Item($excelRow, 1).Value2 = [string]$form.days[$d].d',
    '      $ws.Cells.Item($excelRow, 10).Value2 = [string]$form.days[$d].note',
    '      if ($form.days[$d].isHoliday -or $form.days[$d].isSunday) {',
    '        $hl = $ws.Range("A" + $excelRow + ":J" + $excelRow)',
    '        $hl.Interior.Pattern = 1',
    '        $hl.Interior.ColorIndex = 15',
    '      }',
    '    }',
    '    if (-not [string]::IsNullOrWhiteSpace($form.supervisorName)) {',
    '      $ws.Cells.Item(40, 9).Value2 = "(  " + $form.supervisorName + "  )"',
    '    }',
    '    $ws.Cells.Item(41, 9).Value2 = $form.supervisorPosition',
    '  }',
    '  $wb.SaveAs($outputPath, 51)',
    '  $wb.Close($false)',
    '} finally {',
    '  if ($wb) { try { $wb.Close($false) } catch {} }',
    '  $excel.Quit()',
    '  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null',
    '}',
  ];

  try {
    fs.writeFileSync(payloadPath, JSON.stringify(exportPayload), 'utf8');
    fs.writeFileSync(scriptPath, psLines.join('\r\n'), 'utf8');

    await new Promise((resolve, reject) => {
      execFile('powershell', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', scriptPath, templatePath, filePath, payloadPath
      ], { timeout: 120000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr ? stderr.trim() : err.message));
        else resolve();
      });
    });

    return { success: true, filePath };
  } catch (e) {
    return { success: false, message: `สร้างไฟล์ OT ไม่สำเร็จ: ${e.message}` };
  } finally {
    try { fs.unlinkSync(payloadPath); } catch {}
    try { fs.unlinkSync(scriptPath); } catch {}
  }
});

// ===================== EXPORT OT PDF =====================
ipcMain.handle('export-ot-pdf', async (event, { xlsxPath, pdfPath }) => {
  const fs = require('fs');
  const os = require('os');
  const { execFile } = require('child_process');

  // PowerShell script: open xlsx with Excel COM and export as PDF
  const psLines = [
    'param([string]$xlPath, [string]$pdfPath)',
    '$ErrorActionPreference = "Stop"',
    '$excel = New-Object -ComObject Excel.Application',
    '$excel.Visible = $false',
    '$excel.DisplayAlerts = $false',
    'try {',
    '  $wb = $excel.Workbooks.Open($xlPath)',
    '  $wb.ExportAsFixedFormat(0, $pdfPath)',
    '  $wb.Close($false)',
    '} finally {',
    '  $excel.Quit()',
    '  [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null',
    '}',
  ];

  const tempScript = path.join(os.tmpdir(), `ot_topdf_${Date.now()}.ps1`);
  try {
    fs.writeFileSync(tempScript, psLines.join('\r\n'), 'utf-8');

    await new Promise((resolve, reject) => {
      execFile('powershell', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', tempScript, xlsxPath, pdfPath
      ], { timeout: 60000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr ? stderr.trim() : err.message));
        else resolve();
      });
    });

    return { success: true, filePath: pdfPath };
  } catch (e) {
    return { success: false, message: `แปลง PDF ไม่สำเร็จ (ต้องการ Microsoft Excel): ${e.message}` };
  } finally {
    try { fs.unlinkSync(tempScript); } catch {}
  }
});



// ===================== COURSES MANAGEMENT IPC =====================

// Get all courses with usage count (for courses management page)
ipcMain.handle('get-courses-with-usage', async (event) => {
  if (!db) return { success: false, message: 'ไม่ได้เชื่อมต่อฐานข้อมูล' };
  try {
    const [rows] = await db.execute(
      `SELECT c.Courses_ID, c.Courses_Name,
        DATE_FORMAT(c.Courses_Date, '%Y-%m-%d') AS Courses_Date,
        c.Courses_Remark,
        COUNT(DISTINCT tp.Plan_ID) AS PlanCount
       FROM courses c
       LEFT JOIN training_plan tp ON tp.Courses_ID = c.Courses_ID
       GROUP BY c.Courses_ID, c.Courses_Name, c.Courses_Date, c.Courses_Remark
       ORDER BY c.Courses_ID ASC`
    );
    return { success: true, data: rows };
  } catch (e) { return { success: false, message: e.message }; }
});

// Add course
ipcMain.handle('add-course', async (event, data) => {
  if (!db) return { success: false, message: 'ไม่ได้เชื่อมต่อฐานข้อมูล' };
  if (!data || !data.Courses_ID || !data.Courses_Name) {
    return { success: false, message: 'กรุณากรอกรหัสและชื่อหลักสูตร' };
  }
  const safeId = String(data.Courses_ID).trim().toUpperCase().replace(/[^A-Z0-9\-]/g, '').slice(0, 10);
  const safeName = String(data.Courses_Name).trim().slice(0, 255);
  const safeDate = String(data.Courses_Date || '0000-00-00').trim();
  const safeRemark = String(data.Courses_Remark || '').trim().slice(0, 255);
  if (!safeId) return { success: false, message: 'รหัสหลักสูตรไม่ถูกต้อง' };
  if (!safeName) return { success: false, message: 'กรุณากรอกชื่อหลักสูตร' };
  try {
    const [existing] = await db.execute('SELECT Courses_ID FROM courses WHERE Courses_ID = ?', [safeId]);
    if (existing.length > 0) {
      return { success: false, message: `รหัสหลักสูตร "${safeId}" มีอยู่แล้วในระบบ` };
    }
    await db.execute(
      'INSERT INTO courses (Courses_ID, Courses_Name, Courses_Date, Courses_Remark) VALUES (?, ?, ?, ?)',
      [safeId, safeName, safeDate, safeRemark]
    );
    return { success: true, message: 'เพิ่มหลักสูตรสำเร็จ' };
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return { success: false, message: `รหัสหลักสูตร "${safeId}" มีอยู่แล้วในระบบ` };
    return { success: false, message: e.message };
  }
});

// Update course
ipcMain.handle('update-course', async (event, data) => {
  if (!db) return { success: false, message: 'ไม่ได้เชื่อมต่อฐานข้อมูล' };
  if (!data || !data.Courses_ID) return { success: false, message: 'ไม่ระบุรหัสหลักสูตร' };
  const safeName = String(data.Courses_Name || '').trim().slice(0, 255);
  const safeDate = String(data.Courses_Date || '0000-00-00').trim();
  const safeRemark = String(data.Courses_Remark || '').trim().slice(0, 255);
  if (!safeName) return { success: false, message: 'กรุณากรอกชื่อหลักสูตร' };
  try {
    const [result] = await db.execute(
      'UPDATE courses SET Courses_Name=?, Courses_Date=?, Courses_Remark=? WHERE Courses_ID=?',
      [safeName, safeDate, safeRemark, data.Courses_ID]
    );
    if (result.affectedRows === 0) return { success: false, message: 'ไม่พบหลักสูตรที่ต้องการแก้ไข' };
    return { success: true, message: 'แก้ไขหลักสูตรสำเร็จ' };
  } catch (e) { return { success: false, message: e.message }; }
});

// Check course deletable
ipcMain.handle('check-course-deletable', async (event, courseId) => {
  if (!db) return { success: false, message: 'ไม่ได้เชื่อมต่อฐานข้อมูล' };
  if (!courseId) return { success: false, message: 'ไม่ระบุรหัสหลักสูตร' };
  try {
    const [planRows] = await db.execute(
      'SELECT COUNT(*) AS cnt FROM training_plan WHERE Courses_ID = ?', [courseId]
    );
    const planCount = Number((planRows[0] || {}).cnt) || 0;
    const [partRows] = await db.execute(
      `SELECT COUNT(*) AS cnt FROM history_training ht
       INNER JOIN training_plan tp ON tp.Plan_ID = ht.Plan_ID
       WHERE tp.Courses_ID = ?`, [courseId]
    );
    const participantCount = Number((partRows[0] || {}).cnt) || 0;
    const [expRows] = await db.execute(
      'SELECT COUNT(*) AS cnt FROM training_expenses WHERE Courses_ID = ?', [courseId]
    );
    const expenseCount = Number((expRows[0] || {}).cnt) || 0;
    return { success: true, planCount, participantCount, expenseCount };
  } catch (e) { return { success: false, message: e.message }; }
});

// Delete course with cascade: expenses -> history_training -> training_plan -> courses
ipcMain.handle('delete-course', async (event, courseId) => {
  if (!db) return { success: false, message: 'ไม่ได้เชื่อมต่อฐานข้อมูล' };
  if (!courseId) return { success: false, message: 'ไม่ระบุรหัสหลักสูตร' };
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `DELETE te FROM training_expenses te
       INNER JOIN training_plan tp ON tp.Plan_ID = te.Plan_ID
       WHERE tp.Courses_ID = ?`, [courseId]
    );
    await conn.execute(
      `DELETE ht FROM history_training ht
       INNER JOIN training_plan tp ON tp.Plan_ID = ht.Plan_ID
       WHERE tp.Courses_ID = ?`, [courseId]
    );
    await conn.execute('DELETE FROM training_plan WHERE Courses_ID = ?', [courseId]);
    await conn.execute('DELETE FROM courses WHERE Courses_ID = ?', [courseId]);
    await conn.commit();
    return { success: true, message: 'ลบหลักสูตรสำเร็จ' };
  } catch (e) {
    await conn.rollback();
    return { success: false, message: e.message };
  } finally {
    conn.release();
  }
});

// ===================== PROBATION EVALUATION IPC =====================

// ---- Criteria ----
ipcMain.handle('probation-get-criteria', async (event, { includeInactive = false } = {}) => {
  if (!db) return { success: false, message: 'ไม่ได้เชื่อมต่อฐานข้อมูล' };
  try {
    const where = includeInactive ? '' : 'WHERE is_active = 1';
    const [rows] = await db.execute(
      `SELECT criteria_id, criteria_name, criteria_desc, max_score, sort_order, is_active
       FROM tb_probation_criteria ${where} ORDER BY sort_order ASC, criteria_id ASC`
    );
    return { success: true, data: rows };
  } catch (e) { return { success: false, message: e.message }; }
});

ipcMain.handle('probation-save-criteria', async (event, d) => {
  if (!db) return { success: false, message: 'ไม่ได้เชื่อมต่อฐานข้อมูล' };
  const name = String(d.criteria_name || '').trim();
  if (!name) return { success: false, message: 'กรุณากรอกชื่อหัวข้อประเมิน' };
  const maxScore = parseFloat(d.max_score) || 100;
  if (maxScore <= 0) return { success: false, message: 'คะแนนเต็มต้องมากกว่า 0' };
  try {
    if (d.criteria_id) {
      await db.execute(
        `UPDATE tb_probation_criteria
         SET criteria_name=?, criteria_desc=?, max_score=?, sort_order=?, is_active=?
         WHERE criteria_id=?`,
        [name, d.criteria_desc || '', maxScore, Number(d.sort_order) || 0,
         d.is_active ? 1 : 0, d.criteria_id]
      );
      return { success: true, message: 'แก้ไขหัวข้อสำเร็จ' };
    } else {
      await db.execute(
        `INSERT INTO tb_probation_criteria (criteria_name, criteria_desc, max_score, sort_order, is_active)
         VALUES (?, ?, ?, ?, 1)`,
        [name, d.criteria_desc || '', maxScore, Number(d.sort_order) || 0]
      );
      return { success: true, message: 'เพิ่มหัวข้อสำเร็จ' };
    }
  } catch (e) { return { success: false, message: e.message }; }
});

ipcMain.handle('probation-toggle-criteria', async (event, { criteria_id, is_active }) => {
  if (!db) return { success: false, message: 'ไม่ได้เชื่อมต่อฐานข้อมูล' };
  try {
    await db.execute(
      `UPDATE tb_probation_criteria SET is_active=? WHERE criteria_id=?`,
      [is_active ? 1 : 0, criteria_id]
    );
    return { success: true };
  } catch (e) { return { success: false, message: e.message }; }
});

// ---- Cycle ----
ipcMain.handle('probation-get-cycles', async (event, { search = '', page = 1, perPage = 50 } = {}) => {
  if (!db) return { success: false, message: 'ไม่ได้เชื่อมต่อฐานข้อมูล' };
  try {
    const safePerPage = Math.max(1, Math.min(Number(perPage) || 50, 100));
    const safePage    = Math.max(1, Number(page) || 1);
    const offset      = (safePage - 1) * safePerPage;
    const params      = [];
    let   where       = 'WHERE 1=1';
    if (search) {
      where += ` AND (c.emp_id LIKE ? OR CONCAT(e.Emp_Sname,e.Emp_Firstname,' ',e.Emp_Lastname) LIKE ? OR s.Sub_Name LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const baseQ = `FROM tb_probation_cycle c
      LEFT JOIN employees e ON e.Emp_ID = c.emp_id
      LEFT JOIN subdivision s ON s.Sub_ID = e.Sub_ID
      ${where}`;
    const [countRows] = await db.execute(`SELECT COUNT(*) AS total ${baseQ}`, params);
    const total = countRows[0].total;
    const [rows] = await db.execute(
      `SELECT c.cycle_id, c.emp_id, DATE_FORMAT(c.start_date,'%Y-%m-%d') AS start_date, c.status, c.remark,
        CONCAT(IFNULL(e.Emp_Sname,''),IFNULL(e.Emp_Firstname,''),' ',IFNULL(e.Emp_Lastname,'')) AS Fullname,
        s.Sub_Name,
        (SELECT COUNT(*) FROM tb_probation_period p WHERE p.cycle_id = c.cycle_id) AS period_count,
        (SELECT p2.decision FROM tb_probation_period p2 WHERE p2.cycle_id = c.cycle_id
         ORDER BY p2.period_no DESC LIMIT 1) AS last_decision,
        (SELECT p3.avg_score FROM tb_probation_period p3 WHERE p3.cycle_id = c.cycle_id
         ORDER BY p3.period_no DESC LIMIT 1) AS last_avg_score
      ${baseQ}
      ORDER BY c.cycle_id DESC
      LIMIT ${safePerPage} OFFSET ${offset}`,
      params
    );
    return { success: true, data: rows, total, page: safePage, perPage: safePerPage };
  } catch (e) { return { success: false, message: e.message }; }
});

ipcMain.handle('probation-save-cycle', async (event, d) => {
  if (!db) return { success: false, message: 'ไม่ได้เชื่อมต่อฐานข้อมูล' };
  const empId = String(d.emp_id || '').trim();
  if (!empId) return { success: false, message: 'กรุณาระบุรหัสพนักงาน' };
  const requestedStartDate = String(d.start_date || '').trim();
  try {
    if (d.cycle_id) {
      if (!requestedStartDate) return { success: false, message: 'กรุณาระบุวันเริ่มทดลองงาน' };
      await db.execute(
        `UPDATE tb_probation_cycle SET start_date=?, remark=? WHERE cycle_id=?`,
        [requestedStartDate, d.remark || '', d.cycle_id]
      );
      return { success: true, message: 'แก้ไขข้อมูลทดลองงานสำเร็จ' };
    } else {
      const [existing] = await db.execute(
        `SELECT cycle_id FROM tb_probation_cycle WHERE emp_id = ?`, [empId]
      );
      if (existing.length > 0) return { success: false, message: 'พนักงานนี้มีแฟ้มทดลองงานอยู่แล้ว' };

      const [empRows] = await db.execute(
        `SELECT DATE_FORMAT(Emp_Start_date, '%Y-%m-%d') AS Emp_Start_date
         FROM employees WHERE Emp_ID = ?`,
        [empId]
      );
      if (!empRows.length) return { success: false, message: 'ไม่พบข้อมูลพนักงาน' };

      const employeeStartDate = String(empRows[0].Emp_Start_date || '').trim();
      if (!employeeStartDate || employeeStartDate === '0000-00-00') {
        return { success: false, message: 'ไม่พบวันเริ่มงานของพนักงานในฐานข้อมูล' };
      }

      const [result] = await db.execute(
        `INSERT INTO tb_probation_cycle (emp_id, start_date, remark) VALUES (?, ?, ?)`,
        [empId, employeeStartDate, d.remark || '']
      );
      return {
        success: true,
        message: 'สร้างแฟ้มทดลองงานสำเร็จ',
        cycle_id: result.insertId,
        start_date: employeeStartDate
      };
    }
  } catch (e) { return { success: false, message: e.message }; }
});

ipcMain.handle('probation-close-cycle', async (event, cycle_id) => {
  if (!db) return { success: false, message: 'ไม่ได้เชื่อมต่อฐานข้อมูล' };
  try {
    await db.execute(
      `UPDATE tb_probation_cycle SET status='CLOSED' WHERE cycle_id=?`, [cycle_id]
    );
    return { success: true, message: 'ปิดแฟ้มทดลองงานสำเร็จ' };
  } catch (e) { return { success: false, message: e.message }; }
});

ipcMain.handle('probation-get-cycle-detail', async (event, cycle_id) => {
  if (!db) return { success: false, message: 'ไม่ได้เชื่อมต่อฐานข้อมูล' };
  try {
    const [cycles] = await db.execute(
      `SELECT c.cycle_id, c.emp_id, DATE_FORMAT(c.start_date,'%Y-%m-%d') AS start_date,
         c.status, c.remark,
         CONCAT(IFNULL(e.Emp_Sname,''),IFNULL(e.Emp_Firstname,''),' ',IFNULL(e.Emp_Lastname,'')) AS Fullname,
         e.Emp_Sname, e.Emp_Firstname, e.Emp_Lastname, e.Emp_Status,
         s.Sub_Name, p.Position_Name, e.Emp_Vsth
       FROM tb_probation_cycle c
       LEFT JOIN employees e ON e.Emp_ID = c.emp_id
       LEFT JOIN subdivision s ON s.Sub_ID = e.Sub_ID
       LEFT JOIN position p ON p.Position_ID = e.Position_ID
       WHERE c.cycle_id = ?`, [cycle_id]
    );
    if (!cycles.length) return { success: false, message: 'ไม่พบข้อมูล' };
    const [periods] = await db.execute(
      `SELECT period_id, period_no,
         DATE_FORMAT(start_date,'%Y-%m-%d') AS start_date,
         DATE_FORMAT(end_date,'%Y-%m-%d') AS end_date,
         decision, decision_note, att_pct, quality_pct, avg_score, grade
       FROM tb_probation_period WHERE cycle_id=? ORDER BY period_no ASC`, [cycle_id]
    );
    const [attSum] = await db.execute(
      `SELECT COALESCE(SUM(a.present_days),0) AS total_present
       FROM tb_probation_attendance a
       JOIN tb_probation_period p ON p.period_id = a.period_id
       WHERE p.cycle_id = ?`, [cycle_id]
    );
    const totalPresentDays = Number(attSum[0]?.total_present) || 0;
    return { success: true, cycle: cycles[0], periods, totalPresentDays };
  } catch (e) { return { success: false, message: e.message }; }
});

// ---- Period ----
ipcMain.handle('probation-save-period', async (event, d) => {
  if (!db) return { success: false, message: 'ไม่ได้เชื่อมต่อฐานข้อมูล' };
  if (!d.cycle_id) return { success: false, message: 'ไม่ระบุ cycle_id' };
  if (!d.start_date) return { success: false, message: 'กรุณาระบุวันที่รอบประเมิน' };
  try {
    const startDate = new Date(`${d.start_date}T00:00:00`);
    if (Number.isNaN(startDate.getTime())) return { success: false, message: 'วันที่เริ่มรอบประเมินไม่ถูกต้อง' };
    let endDateIso;
    if (d.end_date) {
      // HR provided end date (round 2+)
      const providedEnd = new Date(`${d.end_date}T00:00:00`);
      if (Number.isNaN(providedEnd.getTime())) return { success: false, message: 'วันที่สิ้นสุดไม่ถูกต้อง' };
      if (providedEnd <= startDate) return { success: false, message: 'วันสิ้นสุดต้องมากกว่าวันเริ่มต้น' };
      endDateIso = d.end_date;
    } else {
      // Default: start + 119 days (round 1)
      const endDate = new Date(startDate.getTime());
      endDate.setDate(endDate.getDate() + 119);
      endDateIso = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
    }

    const [maxRow] = await db.execute(
      `SELECT IFNULL(MAX(period_no),0) AS max_no FROM tb_probation_period WHERE cycle_id=?`,
      [d.cycle_id]
    );
    const nextNo = Number(maxRow[0].max_no) + 1;
    const [result] = await db.execute(
      `INSERT INTO tb_probation_period (cycle_id, period_no, start_date, end_date)
       VALUES (?, ?, ?, ?)`,
      [d.cycle_id, nextNo, d.start_date, endDateIso]
    );
    return {
      success: true,
      message: `สร้างรอบที่ ${nextNo} สำเร็จ`,
      period_id: result.insertId,
      period_no: nextNo,
      end_date: endDateIso
    };
  } catch (e) { return { success: false, message: e.message }; }
});

ipcMain.handle('probation-get-period-detail', async (event, period_id) => {
  if (!db) return { success: false, message: 'ไม่ได้เชื่อมต่อฐานข้อมูล' };
  try {
    const [periods] = await db.execute(
      `SELECT p.period_id, p.cycle_id, c.emp_id, p.period_no,
         DATE_FORMAT(p.start_date,'%Y-%m-%d') AS start_date,
         DATE_FORMAT(p.end_date,'%Y-%m-%d') AS end_date,
         p.decision, p.decision_note, p.att_pct, p.quality_pct, p.avg_score, p.grade
       FROM tb_probation_period p
       INNER JOIN tb_probation_cycle c ON c.cycle_id = p.cycle_id
       WHERE p.period_id=?`, [period_id]
    );
    if (!periods.length) return { success: false, message: 'ไม่พบข้อมูลรอบประเมิน' };
    const period = periods[0];

    const parseDbDate = (value) => {
      const normalized = String(value || '').trim().replace(/\//g, '-');
      if (!normalized) return null;
      const date = new Date(`${normalized}T00:00:00`);
      return Number.isNaN(date.getTime()) ? null : date;
    };
    const addDays = (date, days) => {
      const next = new Date(date.getTime());
      next.setDate(next.getDate() + days);
      return next;
    };
    const parseTimeToMinutes = (value, fallback = 0) => {
      if (!value) return fallback;
      const text = String(value).trim();
      const match = text.match(/^(\d{1,2}):(\d{2})/);
      if (!match) return fallback;
      const hh = Number.parseInt(match[1], 10);
      const mm = Number.parseInt(match[2], 10);
      if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
        return fallback;
      }
      return (hh * 60) + mm;
    };
    const parseDbDateTime = (dateValue, timeValue, fallbackMinutes) => {
      const base = parseDbDate(dateValue);
      if (!base) return null;
      const minutes = parseTimeToMinutes(timeValue, fallbackMinutes);
      const dt = new Date(base.getTime());
      dt.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
      return dt;
    };
    const lunchOverlapMinutes = (startMins, endMins) => {
      const LUNCH_S = 12 * 60;
      const LUNCH_E = 13 * 60;
      return Math.max(0, Math.min(endMins, LUNCH_E) - Math.max(startMins, LUNCH_S));
    };
    const toYearMonth = (date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

    const leaveReference = [];
    const periodStart = parseDbDate(period.start_date);
    const periodEnd = parseDbDate(period.end_date);
    if (period.emp_id && periodStart && periodEnd) {
      const monthRefMap = {};
      const periodMonthBase = new Date(periodStart.getFullYear(), periodStart.getMonth(), 1);
      // นับเดือนจริงจาก start_date ถึง end_date (อาจเกิน 4 เดือน)
      const periodMonthCount = (
        (periodEnd.getFullYear() - periodStart.getFullYear()) * 12 +
        (periodEnd.getMonth() - periodStart.getMonth()) + 1
      );
      for (let i = 0; i < periodMonthCount; i++) {
        const monthDate = new Date(periodMonthBase.getFullYear(), periodMonthBase.getMonth() + i, 1);
        const yearMonth = toYearMonth(monthDate);
        monthRefMap[yearMonth] = {
          month_no: i + 1,
          year_month: yearMonth,
          leave_days_ref: 0,
          partial_records: 0
        };
      }

      const [leaveRows] = await db.execute(
        `SELECT drp_Sdate, TIME_FORMAT(drp_Stime,'%H:%i') AS drp_Stime,
           drp_Edate, TIME_FORMAT(drp_Etime,'%H:%i') AS drp_Etime
         FROM daily_report
         WHERE drp_empID = ?
           AND STR_TO_DATE(REPLACE(COALESCE(NULLIF(drp_Sdate,''), NULLIF(drp_Edate,'')), '/', '-'), '%Y-%m-%d') <= ?
           AND STR_TO_DATE(REPLACE(COALESCE(NULLIF(drp_Edate,''), NULLIF(drp_Sdate,'')), '/', '-'), '%Y-%m-%d') >= ?`,
        [period.emp_id, period.end_date, period.start_date]
      );

      const periodStartAt = new Date(periodStart.getTime());
      periodStartAt.setHours(0, 0, 0, 0);
      const periodEndAt = new Date(periodEnd.getTime());
      periodEndAt.setHours(23, 59, 59, 999);
      const MINUTES_PER_LEAVE_DAY = 8 * 60;

      leaveRows.forEach((row) => {
        const rawStart = parseDbDateTime(
          row.drp_Sdate || row.drp_Edate,
          row.drp_Stime || '08:00',
          8 * 60
        );
        const rawEnd = parseDbDateTime(
          row.drp_Edate || row.drp_Sdate,
          row.drp_Etime || '17:00',
          17 * 60
        );
        if (!rawStart || !rawEnd) return;

        let startAt = rawStart;
        let endAt = rawEnd;
        if (endAt < startAt) [startAt, endAt] = [endAt, startAt];

        const overlapStart = startAt > periodStartAt ? new Date(startAt.getTime()) : new Date(periodStartAt.getTime());
        const overlapEnd = endAt < periodEndAt ? new Date(endAt.getTime()) : new Date(periodEndAt.getTime());
        if (overlapStart >= overlapEnd) return;

        let cursor = new Date(overlapStart.getFullYear(), overlapStart.getMonth(), overlapStart.getDate());
        const endCursor = new Date(overlapEnd.getFullYear(), overlapEnd.getMonth(), overlapEnd.getDate());

        while (cursor <= endCursor) {
          const dayStart = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), 0, 0, 0, 0);
          const dayEnd = addDays(dayStart, 1);
          const segStart = overlapStart > dayStart ? overlapStart : dayStart;
          const segEnd = overlapEnd < dayEnd ? overlapEnd : dayEnd;

          if (segEnd > segStart) {
            let minutes = (segEnd.getTime() - segStart.getTime()) / 60000;
            const startMins = segStart.getHours() * 60 + segStart.getMinutes();
            const endMins = segEnd.getHours() * 60 + segEnd.getMinutes();
            minutes -= lunchOverlapMinutes(startMins, endMins);
            if (minutes < 0) minutes = 0;

            if (minutes > 0) {
              const yearMonth = toYearMonth(dayStart);
              if (monthRefMap[yearMonth]) {
                monthRefMap[yearMonth].leave_days_ref += (minutes / MINUTES_PER_LEAVE_DAY);
              }
            }
          }
          cursor = addDays(cursor, 1);
        }
      });

      Object.values(monthRefMap).forEach((monthRef) => {
        monthRef.leave_days_ref = Number.parseFloat(monthRef.leave_days_ref.toFixed(2));
      });

      leaveReference.push(...Object.values(monthRefMap));
    }

    const [attendance] = await db.execute(
      `SELECT att_id, month_no, \`year_month\`, work_days, present_days,
         absent_days, late_days, leave_days, att_pct, remark
       FROM tb_probation_attendance WHERE period_id=? ORDER BY month_no ASC`, [period_id]
    );
    const [scores] = await db.execute(
      `SELECT score_id, month_no, criteria_id, score, remark
       FROM tb_probation_score WHERE period_id=? AND score >= 0 ORDER BY month_no ASC, criteria_id ASC`,
      [period_id]
    );
    const [criteria] = await db.execute(
      `SELECT criteria_id, criteria_name, criteria_desc, max_score, sort_order
       FROM tb_probation_criteria WHERE is_active=1
       ORDER BY sort_order ASC, criteria_id ASC`
    );
    // NA คือ criteria ที่ถูกบันทึกไว้ด้วย score=-1 ในทุก period ของ cycle เดียวกัน
    const [naRows] = await db.execute(
      `SELECT DISTINCT s.criteria_id
       FROM tb_probation_score s
       INNER JOIN tb_probation_period p ON p.period_id = s.period_id
       WHERE p.cycle_id = ? AND s.score = -1`,
      [period.cycle_id]
    );
    const naCriteriaIds = naRows.map(r => r.criteria_id);
    return { success: true, period, attendance, scores, criteria, leaveReference, naCriteriaIds };
  } catch (e) { return { success: false, message: e.message }; }
});

// ---- Attendance ----
ipcMain.handle('probation-save-attendance', async (event, { period_id, rows }) => {
  if (!db) return { success: false, message: 'ไม่ได้เชื่อมต่อฐานข้อมูล' };
  if (!period_id || !Array.isArray(rows)) return { success: false, message: 'ข้อมูลไม่ถูกต้อง' };
  // ดึงวันที่รอบจริงเพื่อคำนวณจำนวนเดือน
  let maxMonthNo = 4;
  try {
    const [pRows] = await db.execute(
      `SELECT DATE_FORMAT(start_date,'%Y-%m-%d') AS start_date, DATE_FORMAT(end_date,'%Y-%m-%d') AS end_date FROM tb_probation_period WHERE period_id=?`,
      [period_id]
    );
    if (pRows.length) {
      const ps = new Date(pRows[0].start_date + 'T00:00:00');
      const pe = new Date(pRows[0].end_date   + 'T00:00:00');
      maxMonthNo = (pe.getFullYear() - ps.getFullYear()) * 12 + (pe.getMonth() - ps.getMonth()) + 1;
    }
  } catch { /* fallback ไว้ที่ 4 */ }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const parseWholeDayValue = (value, label, monthNo) => {
      const raw = String(value ?? '').trim();
      if (raw === '') return 0;
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`เดือนที่ ${monthNo}: ${label}ไม่ถูกต้อง`);
      }
      if (parsed > 31) {
        throw new Error(`เดือนที่ ${monthNo}: ${label}ห้ามเกิน 31 วัน`);
      }
      return parsed;
    };
    const parseDecimalDayValue = (value, label, monthNo) => {
      const raw = String(value ?? '').trim();
      if (raw === '') return 0;
      const parsed = Number.parseFloat(raw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`เดือนที่ ${monthNo}: ${label}ไม่ถูกต้อง`);
      }
      if (parsed > 31) {
        throw new Error(`เดือนที่ ${monthNo}: ${label}ห้ามเกิน 31 วัน`);
      }
      return parseFloat(parsed.toFixed(3));
    };
    const warnings = [];

    for (const r of rows) {
      const monthNo = Number.parseInt(r.month_no, 10);
      if (!Number.isInteger(monthNo) || monthNo < 1 || monthNo > maxMonthNo) {
        throw new Error(`month_no ต้องอยู่ระหว่าง 1 ถึง ${maxMonthNo}`);
      }

      const yearMonth = String(r.year_month || '').trim();
      if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
        throw new Error(`เดือนที่ ${monthNo}: ปี-เดือนไม่ถูกต้อง`);
      }

      const workDays = parseWholeDayValue(r.work_days, 'วันทำงาน', monthNo);
      const presentDays = parseDecimalDayValue(r.present_days, 'วันมาทำงาน', monthNo);
      const absentDays = parseDecimalDayValue(r.absent_days, 'วันขาดงาน', monthNo);
      const lateDays = parseDecimalDayValue(r.late_days, 'วันมาสาย', monthNo);
      const leaveDays = parseDecimalDayValue(r.leave_days, 'วันลา', monthNo);

      if (absentDays + leaveDays > workDays) {
        throw new Error(`เดือนที่ ${monthNo}: ขาดงาน + ลา ต้องไม่เกินวันทำงาน`);
      }
      if (lateDays > presentDays) {
        throw new Error(`เดือนที่ ${monthNo}: วันมาสายต้องไม่มากกว่าวันมาทำงาน`);
      }
      if (absentDays > 3) {
        warnings.push(`เดือนที่ ${monthNo} ขาดงาน ${absentDays} วัน`);
      }

      const attPct      = workDays > 0 ? parseFloat(((presentDays / workDays) * 100).toFixed(3)) : 0;
      await conn.execute(
        `INSERT INTO tb_probation_attendance
           (period_id, month_no, \`year_month\`, work_days, present_days, absent_days, late_days, leave_days, att_pct, remark)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
           \`year_month\`=VALUES(\`year_month\`), work_days=VALUES(work_days),
           present_days=VALUES(present_days), absent_days=VALUES(absent_days),
           late_days=VALUES(late_days), leave_days=VALUES(leave_days),
           att_pct=VALUES(att_pct), remark=VALUES(remark)`,
        [period_id, monthNo, yearMonth,
         workDays, presentDays,
         absentDays,
         lateDays,
         leaveDays,
         attPct, r.remark || '']
      );
    }
    await conn.commit();
    return { success: true, message: 'บันทึกข้อมูลการมาทำงานสำเร็จ', warnings };
  } catch (e) {
    await conn.rollback();
    return { success: false, message: e.message };
  } finally {
    conn.release();
  }
});

// ---- Scores ----
ipcMain.handle('probation-save-scores', async (event, { period_id, month_no, scores }) => {
  if (!db) return { success: false, message: 'ไม่ได้เชื่อมต่อฐานข้อมูล' };
  if (!period_id || !month_no || !Array.isArray(scores)) return { success: false, message: 'ข้อมูลไม่ถูกต้อง' };
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    for (const s of scores) {
      const rawScore = parseFloat(s.score);
      // score = -1 คือสัญลักษณ์ NA เก็บตรงๆ ฝั่น ค่าอื่นๆ clamp ไว้ >= 0
      const score = (rawScore === -1) ? -1 : Math.max(0, rawScore || 0);
      await conn.execute(
        `INSERT INTO tb_probation_score (period_id, month_no, criteria_id, score, remark)
         VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE score=VALUES(score), remark=VALUES(remark)`,
        [period_id, month_no, s.criteria_id, score, s.remark || '']
      );
    }
    await conn.commit();
    return { success: true, message: 'บันทึกคะแนนสำเร็จ' };
  } catch (e) {
    await conn.rollback();
    return { success: false, message: e.message };
  } finally {
    conn.release();
  }
});

// ---- Finalize period (save summary + decision) ----
ipcMain.handle('probation-finalize-period', async (event, d) => {
  if (!db) return { success: false, message: 'ไม่ได้เชื่อมต่อฐานข้อมูล' };
  const validDecisions = ['PENDING','PASS','EXTEND','TERMINATE','OTHER'];
  if (!validDecisions.includes(d.decision)) return { success: false, message: 'decision ไม่ถูกต้อง' };
  try {
    await db.execute(
      `UPDATE tb_probation_period
       SET decision=?, decision_note=?, att_pct=?, quality_pct=?, avg_score=?, grade=?
       WHERE period_id=?`,
      [d.decision, d.decision_note || '',
       d.att_pct != null ? parseFloat(d.att_pct) : null,
       d.quality_pct != null ? parseFloat(d.quality_pct) : null,
       d.avg_score != null ? parseFloat(d.avg_score) : null,
       d.grade || null,
       d.period_id]
    );
    // If PASS or TERMINATE, auto-close the cycle
    if (d.decision === 'PASS' || d.decision === 'TERMINATE') {
      const [pRow] = await db.execute(
        `SELECT cycle_id FROM tb_probation_period WHERE period_id=?`, [d.period_id]
      );
      if (pRow.length) {
        await db.execute(
          `UPDATE tb_probation_cycle SET status='CLOSED' WHERE cycle_id=?`,
          [pRow[0].cycle_id]
        );
        // If PASS: return total actual working days across all periods of cycle
        if (d.decision === 'PASS') {
          const [attSum] = await db.execute(
            `SELECT COALESCE(SUM(a.present_days),0) AS total_present
             FROM tb_probation_attendance a
             JOIN tb_probation_period p ON p.period_id = a.period_id
             WHERE p.cycle_id = ?`, [pRow[0].cycle_id]
          );
          const totalPresentDays = Number(attSum[0]?.total_present) || 0;
          return { success: true, message: 'บันทึกผลการประเมินสำเร็จ', totalPresentDays };
        }
      }
    }
    return { success: true, message: 'บันทึกผลการประเมินสำเร็จ' };
  } catch (e) { return { success: false, message: e.message }; }
});
