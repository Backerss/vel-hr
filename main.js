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
  mainWindow.webContents.openDevTools()

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

// Get employees with server-side pagination
ipcMain.handle('get-employees', async (event, filters = {}) => {
  const { search = '', status = '', subdivision = '', page = 1, perPage = 50 } = filters;
  if (!db) return { success: false, message: 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้' };
  try {
    const conditions = ['1=1'];
    const params = [];

    if (search) {
      conditions.push(`(e.Emp_ID LIKE ? OR e.Emp_Firstname LIKE ? OR e.Emp_Lastname LIKE ? OR e.Emp_IDCard LIKE ?)`);
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (status) {
      conditions.push(`e.Emp_Status = ?`);
      params.push(status);
    }
    if (subdivision) {
      conditions.push(`e.Sub_ID = ?`);
      params.push(subdivision);
    }

    const joins = `FROM employees e INNER JOIN subdivision s ON s.Sub_ID = e.Sub_ID INNER JOIN position p ON p.Position_ID = e.Position_ID`;
    const where = `WHERE ${conditions.join(' AND ')}`;

    const [countRows] = await db.execute(`SELECT COUNT(*) as total ${joins} ${where}`, params);
    const total = countRows[0].total;

    const safePerPage = Math.max(1, Math.min(Number(perPage) || 50, 100));
    const safePage = Math.max(1, Number(page) || 1);
    const offset = (safePage - 1) * safePerPage;

    const [rows] = await db.execute(
      `SELECT e.Emp_ID, CONCAT(e.Emp_Sname, e.Emp_Firstname, ' ', e.Emp_Lastname) AS Fullname,
        e.Emp_Start_date, e.Emp_Packing_date, e.Emp_IDCard, e.Emp_Level,
        s.Sub_Name, p.Position_Name, e.Emp_Status, e.Emp_Vsth,
        s.Sub_ID, p.Position_ID, e.Emp_Sname, e.Emp_Firstname, e.Emp_Lastname
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
        s.Sub_Name, e.Emp_Status
      FROM employees e
      LEFT JOIN subdivision s ON s.Sub_ID = e.Sub_ID
      WHERE e.Emp_ID LIKE ?
         OR e.Emp_Firstname LIKE ?
         OR e.Emp_Lastname LIKE ?
         OR CONCAT(e.Emp_Sname, e.Emp_Firstname, ' ', e.Emp_Lastname) LIKE ?
         OR s.Sub_Name LIKE ?
      ORDER BY e.Emp_ID ASC
      LIMIT ${safeLimit}`,
      [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`]
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

// Get all courses
ipcMain.handle('get-courses', async (event) => {
  if (!db) return { success: false, message: 'ไม่ได้เชื่อมต่อฐานข้อมูล' };
  try {
    const [rows] = await db.execute('SELECT Courses_ID, Courses_Name, Courses_Date, Courses_Remark FROM courses ORDER BY Courses_Name');
    return { success: true, data: rows };
  } catch (e) { return { success: false, message: e.message }; }
});

// Get training plans with server-side pagination
ipcMain.handle('get-training-plans', async (event, filters = {}) => {
  if (!db) return { success: false, message: 'ไม่ได้เชื่อมต่อฐานข้อมูล' };
  try {
    const { search = '', page = 1, perPage = 25 } = filters;
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
      ${joins}`,
      []
    );

    const [rows] = await db.execute(
      `SELECT tp.Plan_ID, tp.Plan_Record, c.Courses_ID, c.Courses_Name,
        tp.Plan_Hour, tp.Plan_Company, tp.Plan_Location, tp.Plan_TypeTraining,
        tp.Plan_Lecturer, DATE_FORMAT(tp.Plan_StartDate, '%Y-%m-%d') AS Plan_StartDate,
        tp.Plan_TimeStart, DATE_FORMAT(tp.Plan_EndDate, '%Y-%m-%d') AS Plan_EndDate,
        tp.Plan_TimeEnd, tp.Plan_Remark, tp.Plan_Coordinator, tp.Plan_Status,
        DATE_FORMAT(tp.Plan_Record, '%Y-%m-%d %H:%i:%s') AS Plan_Record_DateTime,
        COALESCE(participant_counts.ParticipantCount, 0) AS ParticipantCount
      ${joins}
      ${participantJoin}
      ${where}
      ORDER BY tp.Plan_StartDate DESC, tp.Plan_ID DESC
      LIMIT ${safePerPage} OFFSET ${offset}`,
      params
    );

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
      }
    };
  } catch (e) { return { success: false, message: e.message }; }
});

// Save training plan (create new or update existing)
ipcMain.handle('save-training-plan', async (event, data) => {
  if (!db) return { success: false, message: 'ไม่ได้เชื่อมต่อฐานข้อมูล' };
  try {
    // Convert date format from YYYY-MM-DD to YYYY/MM/DD for MySQL
    const startDate = data.Plan_StartDate.replace(/-/g, '/');
    const endDate = data.Plan_EndDate.replace(/-/g, '/');
    
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
          data.Plan_TypeTraining, data.Plan_Lecturer, startDate, data.Plan_TimeStart,
          endDate, data.Plan_TimeEnd, data.Plan_Remark, data.Plan_Coordinator,
          data.Plan_Status || 'Active', data.Plan_ID
        ]
      );
      planId = data.Plan_ID;
    } else {
      // Insert new training plan
      const result = await db.execute(
        `INSERT INTO training_plan (Courses_ID, Plan_Hour, Plan_Company, Plan_Location,
          Plan_TypeTraining, Plan_Lecturer, Plan_StartDate, Plan_TimeStart,
          Plan_EndDate, Plan_TimeEnd, Plan_Remark, Plan_Coordinator, Plan_Status, Plan_Record)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          data.Courses_ID, data.Plan_Hour, data.Plan_Company, data.Plan_Location,
          data.Plan_TypeTraining, data.Plan_Lecturer, startDate, data.Plan_TimeStart,
          endDate, data.Plan_TimeEnd, data.Plan_Remark, data.Plan_Coordinator, 'Active'
        ]
      );
      planId = result[0].insertId;
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
  if (!db) return { success: false, message: 'ไม่ได้เชื่อมต่อฐานข้อมูล' };
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
