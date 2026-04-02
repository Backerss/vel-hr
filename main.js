const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const mysql = require('mysql2/promise');

let mainWindow;
let db;

// Database connection
async function createConnection() {
  try {
    db = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '',
      database: 'training_v_1_1',
      charset: 'utf8'
    });
    console.log('Connected to MySQL database');
    return true;
  } catch (error) {
    console.error('Database connection failed:', error.message);
    return false;
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

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  await createConnection();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ===================== IPC HANDLERS =====================

// Login handler
ipcMain.handle('login', async (event, { username, password }) => {
  if (!db) return { success: false, message: 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้' };
  try {
    // Admin login
    const [admins] = await db.execute(
      'SELECT * FROM admin_login WHERE ad_user = ? AND ad_pass = ?',
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
          status: admins[0].ad_status
        }
      };
    }

    // Employee login (by Emp_ID or username match)
    const [employees] = await db.execute(
      'SELECT e.*, s.Sub_Name, p.Position_Name FROM employees e LEFT JOIN subdivision s ON s.Sub_ID = e.Sub_ID LEFT JOIN position p ON p.Position_ID = e.Position_ID WHERE e.Emp_ID = ? AND e.Emp_Status = "Activated"',
      [username]
    );
    if (employees.length > 0) {
      return {
        success: true,
        role: 'employee',
        user: {
          id: employees[0].Emp_ID,
          name: `${employees[0].Emp_Sname}${employees[0].Emp_Firstname} ${employees[0].Emp_Lastname}`,
          username: employees[0].Emp_ID,
          status: 'Employee',
          subdivision: employees[0].Sub_Name,
          position: employees[0].Position_Name
        }
      };
    }

    return { success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
  } catch (error) {
    console.error('Login error:', error);
    return { success: false, message: 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ: ' + error.message };
  }
});

// Get all employees
ipcMain.handle('get-employees', async (event, { search = '', status = '', subdivision = '' }) => {
  if (!db) return { success: false, message: 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้' };
  try {
    let query = `SELECT e.Emp_ID, CONCAT(e.Emp_Sname, e.Emp_Firstname, ' ', e.Emp_Lastname) AS Fullname,
      e.Emp_Start_date, e.Emp_Packing_date, e.Emp_IDCard, e.Emp_Level,
      s.Sub_Name, p.Position_Name, e.Emp_Status, e.Emp_Vsth,
      s.Sub_ID, p.Position_ID, e.Emp_Sname, e.Emp_Firstname, e.Emp_Lastname
      FROM employees e
      INNER JOIN subdivision s ON s.Sub_ID = e.Sub_ID
      INNER JOIN position p ON p.Position_ID = e.Position_ID
      WHERE 1=1`;
    const params = [];

    if (search) {
      query += ` AND (e.Emp_ID LIKE ? OR e.Emp_Firstname LIKE ? OR e.Emp_Lastname LIKE ? OR e.Emp_IDCard LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (status) {
      query += ` AND e.Emp_Status = ?`;
      params.push(status);
    }
    if (subdivision) {
      query += ` AND e.Sub_ID = ?`;
      params.push(subdivision);
    }

    query += ` ORDER BY e.Emp_ID ASC`;

    const [rows] = await db.execute(query, params);
    return { success: true, data: rows };
  } catch (error) {
    console.error('Get employees error:', error);
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
      inactive: inactive[0].total
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
      `SELECT e.*, s.Sub_Name, p.Position_Name FROM employees e
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
    const [rows] = await db.execute('SELECT Sub_ID, Sub_Name FROM subdivision ORDER BY Sub_Name');
    return { success: true, data: rows };
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
        data.Emp_Packing_date || null, data.Emp_Level || '',
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
        data.Emp_Packing_date || null, data.Emp_Level || '',
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
ipcMain.handle('get-daily-reports', async (event, { search='', dateFrom='', dateTo='', subID='', leaveType='' } = {}) => {
  if (!db) return { success: false };
  try {
    let q = `SELECT dr.drp_id, dr.drp_empID, dr.drp_record, dr.drp_Type,
      dr.drp_Communicate, dr.drp_Communicate1,
      dr.drp_Sdate, TIME_FORMAT(dr.drp_Stime,'%H:%i') AS drp_Stime,
      dr.drp_Edate, TIME_FORMAT(dr.drp_Etime,'%H:%i') AS drp_Etime,
      dr.drp_status, dr.drp_Remark,
      CONCAT(IFNULL(e.Emp_Sname,''),IFNULL(e.Emp_Firstname,''),' ',IFNULL(e.Emp_Lastname,'')) AS Fullname,
      e.Emp_Sname, e.Emp_Firstname, e.Emp_Lastname,
      s.Sub_Name, s.Sub_ID,
      lt.leave_name
      FROM daily_report dr
      LEFT JOIN employees e ON e.Emp_ID = dr.drp_empID
      LEFT JOIN subdivision s ON s.Sub_ID = e.Sub_ID
      LEFT JOIN leave_type lt ON lt.leave_abbreviation = dr.drp_Type
      WHERE 1=1`;
    const params = [];
    if (search) {
      q += ` AND (dr.drp_empID LIKE ? OR e.Emp_Firstname LIKE ? OR e.Emp_Lastname LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (dateFrom) { q += ` AND dr.drp_Sdate >= ?`; params.push(dateFrom.replace(/-/g,'/')); }
    if (dateTo)   { q += ` AND dr.drp_Sdate <= ?`; params.push(dateTo.replace(/-/g,'/')); }
    if (subID)    { q += ` AND e.Sub_ID = ?`;       params.push(subID); }
    if (leaveType){ q += ` AND dr.drp_Type = ?`;    params.push(leaveType); }
    q += ` ORDER BY dr.drp_id DESC LIMIT 1000`;
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
      [d.drp_empID,d.drp_record,d.drp_Type,d.drp_Communicate,d.drp_Communicate1,
       d.drp_Sdate,d.drp_Stime,d.drp_Edate,d.drp_Etime,d.drp_status,d.drp_Remark]
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
      [d.drp_empID,d.drp_record,d.drp_Type,d.drp_Communicate,d.drp_Communicate1,
       d.drp_Sdate,d.drp_Stime,d.drp_Edate,d.drp_Etime,d.drp_status,d.drp_Remark,d.drp_id]
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
  if (!db) return { success: false, message: 'ไม่ได้เชื่อมต่อฐานข้อมูล' };
  try {
    const [rows] = await db.execute(
      `SELECT
        c.Courses_ID,
        c.Courses_Name,
        DATE_FORMAT(tp.Plan_StartDate, '%Y-%m-%d') AS Plan_StartDate,
        DATE_FORMAT(tp.Plan_EndDate,   '%Y-%m-%d') AS Plan_EndDate,
        tp.Plan_TimeStart,
        tp.Plan_TimeEnd,
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
        WHERE ? BETWEEN dr.drp_Sdate AND IF(dr.drp_Edate = '' OR dr.drp_Edate = '0000/00/00' OR dr.drp_Edate IS NULL, dr.drp_Sdate, dr.drp_Edate)
        ORDER BY FIELD(IFNULL(e.Emp_Vsth,dr.drp_status),'Vel','SK','TBS','CWS'), dr.drp_empID ASC`,
      [dbDate]
    );
    return { success: true, data: rows };
  } catch (e) { return { success: false, message: e.message }; }
});
