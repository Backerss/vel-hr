const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const mysql = require('mysql2/promise');
const ExcelJS = require('exceljs');

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
  //mainWindow.webContents.openDevTools()
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
    const [rows] = await db.execute(`SELECT s.Sub_ID, s.Sub_Name, s.Dpt_ID, d.Dpt_Name
      FROM subdivision s
      LEFT JOIN department d ON d.Dpt_ID = s.Dpt_ID
      ORDER BY d.Dpt_Name ASC, s.Sub_Name ASC`);
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
ipcMain.handle('get-daily-reports', async (event, { search = '', dateFrom = '', dateTo = '', subID = '', leaveType = '' } = {}) => {
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
    if (dateFrom) { q += ` AND dr.drp_Sdate >= ?`; params.push(dateFrom.replace(/-/g, '/')); }
    if (dateTo) { q += ` AND dr.drp_Sdate <= ?`; params.push(dateTo.replace(/-/g, '/')); }
    if (subID) { q += ` AND e.Sub_ID = ?`; params.push(subID); }
    if (leaveType) { q += ` AND dr.drp_Type = ?`; params.push(leaveType); }
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
        WHERE dr.drp_record = ?
        ORDER BY FIELD(IFNULL(e.Emp_Vsth,dr.drp_status),'Vel','SK','TBS','CWS'), dr.drp_empID ASC`,
      [dbDate]
    );
    return { success: true, data: rows };
  } catch (e) { return { success: false, message: e.message }; }
});


// Export daily absence report to Excel (using template)
ipcMain.handle('export-absence-excel', async (event, { date, data }) => {
  if (!data || !date) return { success: false, message: 'à¹„à¸¡à¹ˆà¸¡à¸µà¸‚à¹‰อมูล' };
  try {
    const ExcelJS = require('exceljs');
    const path = require('path');
    const templatePath = path.join(__dirname, 'data', 'รายงานการหยุดงานประจำวัน.xlsx');
    // Group data by company
    const grouped = { Vel: [], SK: [], TBS: [], CWS: [] };
    data.forEach(r => {
      const vsth = (r.Emp_Vsth || r.drp_status || 'Vel').trim();
      if (grouped[vsth] !== undefined) grouped[vsth].push(r);
      else grouped['Vel'].push(r);
    });
    const outsourceList = [...grouped.SK, ...grouped.TBS, ...grouped.CWS];
    const pageCount = Math.max(Math.ceil(grouped.Vel.length / 20), Math.ceil(outsourceList.length / 20), 1);
    // Total employees per company
    const totalByGroup = { Vel: 0, SK: 0, TBS: 0, CWS: 0 };
    try {
      const [empRows] = await db.execute(
        `SELECT IFNULL(Emp_Vsth,'Vel') AS grp, COUNT(*) AS cnt FROM employees WHERE Emp_Status='Activated' GROUP BY IFNULL(Emp_Vsth,'Vel')`
      );
      empRows.forEach(r => { if (totalByGroup[r.grp] !== undefined) totalByGroup[r.grp] = r.cnt; });
    } catch (e) { }
    // Format date label (Thai month name, CE year)
    const thMonths = ['à¸¡à¸à¸£à¸²à¸„ม', 'กุมภาพันธ์', 'à¸¡à¸µà¸™à¸²à¸„ม', 'เมษายน', 'à¸žà¸¤à¸©à¸ à¸²à¸„ม', 'มิถุนายน',
      'à¸à¸£à¸à¸Žà¸²à¸„ม', 'à¸ªà¸´à¸‡à¸«à¸²à¸„ม', 'กันยายน', 'à¸•à¸¸à¸¥à¸²à¸„ม', 'พฤศจิกายน', 'à¸˜à¸±à¸™à¸§à¸²à¸„ม'];
    const dObj = new Date(date + 'T00:00:00');
    const thDateLabel = `${dObj.getDate()} ${thMonths[dObj.getMonth()]} ${dObj.getFullYear()}`;
    // Show save dialog
    const saveResult = await dialog.showSaveDialog({
      title: 'บันทึกรายงาน Excel',
      defaultPath: `รายงานการหยุดงาน_${date}.xlsx`,
      filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
    });
    if (saveResult.canceled || !saveResult.filePath) return { success: false, message: 'à¸¢à¸à¹€ลิก' };
    const outputPath = saveResult.filePath;
    // Load template workbook
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(templatePath);
    const tmplSheet = wb.getWorksheet('Sheet1');
    // Snapshot template state before any modification (for copying to extra sheets)
    const tmplMerges = tmplSheet.model.merges ? [...tmplSheet.model.merges] : [];
    const tmplRows = [];
    tmplSheet.eachRow({ includeEmpty: true }, (row, rn) => {
      const cells = [];
      row.eachCell({ includeEmpty: true }, (cell, cn) => {
        cells.push({ cn, value: JSON.parse(JSON.stringify(cell.value ?? null)), style: JSON.parse(JSON.stringify(cell.style ?? {})) });
      });
      tmplRows.push({ rn, height: row.height, cells });
    });
    const tmplColWidths = [];
    for (let c = 1; c <= 30; c++) {
      const col = tmplSheet.getColumn(c);
      if (col.width) tmplColWidths.push({ c, width: col.width });
    }
    // Apply template snapshot to a blank sheet
    // ── helper: copy a template row (by rowNum) to any target row on sheet
    function copyTmplRow(sheet, tmplRowNum, targetRowNum) {
      const tr = tmplRows.find(r => r.rn === tmplRowNum);
      if (!tr) return;
      const row = sheet.getRow(targetRowNum);
      if (tr.height) row.height = tr.height;
      tr.cells.forEach(({ cn, value, style }) => {
        const cell = row.getCell(cn);
        cell.value = value;
        if (style && Object.keys(style).length) cell.style = JSON.parse(JSON.stringify(style));
      });
      row.commit();
    }

    // ── helper: re-apply template merges for rows [srcStart..srcEnd] shifted by rowOffset
    function shiftMerges(sheet, srcStart, srcEnd, rowOffset) {
      tmplMerges.forEach(m => {
        const match = m.match(/^([A-Za-z]+)(\d+):([A-Za-z]+)(\d+)$/);
        if (!match) return;
        const r1 = parseInt(match[2]);
        const r2 = parseInt(match[4]);
        if (r1 >= srcStart && r2 <= srcEnd) {
          try { sheet.mergeCells(`${match[1]}${r1 + rowOffset}:${match[3]}${r2 + rowOffset}`); } catch (e) { }
        }
      });
    }

    // ── apply template rows minRow..maxRow (merges + styles + widths) to a sheet
    function applyTemplate(sheet, minRow, maxRow) {
      if (minRow === undefined) minRow = 1;
      if (maxRow === undefined) maxRow = Infinity;
      tmplMerges.forEach(m => {
        const match = m.match(/^[A-Za-z]+(\d+):[A-Za-z]+(\d+)$/);
        if (!match) return;
        const r1 = parseInt(match[1]);
        const r2 = parseInt(match[2]);
        if (r1 >= minRow && r2 <= maxRow) {
          try { sheet.mergeCells(m); } catch (e) { }
        }
      });
      tmplRows.forEach(({ rn, height, cells }) => {
        if (rn < minRow || rn > maxRow) return;
        const row = sheet.getRow(rn);
        if (height) row.height = height;
        cells.forEach(({ cn, value, style }) => {
          const cell = row.getCell(cn);
          cell.value = value;
          if (style && Object.keys(style).length) cell.style = style;
        });
        row.commit();
      });
      tmplColWidths.forEach(({ c, width }) => { sheet.getColumn(c).width = width; });
    }

    // ── helper: get communicate label
    function commLabel(r) {
      if (r.drp_Communicate && r.drp_Communicate.trim()) return '\u0E42\u0E17\u0E23';           // โทร
      if (r.drp_Communicate1 && r.drp_Communicate1.trim()) return '\u0E41\u0E08\u0E49\u0E07\u0E25\u0E48\u0E27\u0E07\u0E2B\u0E19\u0E49\u0E32'; // แจ้งล่วงหน้า
      return '';
    }

    // ── constants
    const ROWS_PER_SECTION = 20;
    const DATA_TMPL_START = 6;   // first data row in template
    const DATA_TMPL_END = 25;  // last  data row in template
    const SUMMARY_TMPL_START = 26;  // first summary row in template
    const SUMMARY_TMPL_END = tmplRows.length > 0
      ? Math.max.apply(null, tmplRows.map(r => r.rn))
      : 36;

    const velCount = grouped.Vel.length;
    const outCount = outsourceList.length;
    const sections = Math.ceil(Math.max(velCount, outCount, 1) / ROWS_PER_SECTION);

    // ── choose / build the working sheet
    let sheet;
    if (sections === 1) {
      // single section: use the loaded template sheet as-is
      sheet = tmplSheet;
    } else {
      // multiple sections: start fresh so summary rows aren't duplicated
      wb.removeWorksheet(tmplSheet.id);
      sheet = wb.addWorksheet('Sheet1');
      applyTemplate(sheet, 1, DATA_TMPL_END);
    }

    // ── date label
    sheet.getCell('U1').value = thDateLabel;

    // ── write all data sections
    let currentRow = DATA_TMPL_START;

    for (let sec = 0; sec < sections; sec++) {
      const offset = sec * ROWS_PER_SECTION;
      const velChunk = grouped.Vel.slice(offset, offset + ROWS_PER_SECTION);
      const outChunk = outsourceList.slice(offset, offset + ROWS_PER_SECTION);

      if (sec > 0) {
        // ── Leave 4 blank rows, then repeat the FULL header (rows 1-5):
        //    row 1 = title + date,  rows 3-5 = section/column headers
        //    (row 2 is blank spacer)
        currentRow += 4;
        const HEADER_ROWS = [1, 2, 3, 4, 5];
        const headerOffset = currentRow - HEADER_ROWS[0]; // same for all
        // shift ALL header merges in one call so multi-row spans (A4:A5, B4:D5…) are handled
        shiftMerges(sheet, HEADER_ROWS[0], HEADER_ROWS[HEADER_ROWS.length - 1], headerOffset);
        HEADER_ROWS.forEach((tmplHR, idx) => {
          copyTmplRow(sheet, tmplHR, currentRow + idx);
        });
        // restore the date label on the new title row (tmplRows snapshot has original template value)
        sheet.getCell(currentRow, 21).value = thDateLabel; // col 21 = U
        currentRow += HEADER_ROWS.length;

        // copy data-row styles/merges from template rows 6-25 for this new section in one pass
        const dataOffset = currentRow - DATA_TMPL_START;
        shiftMerges(sheet, DATA_TMPL_START, DATA_TMPL_END, dataOffset);
        for (let i = 0; i < ROWS_PER_SECTION; i++) {
          copyTmplRow(sheet, DATA_TMPL_START + i, currentRow + i);
        }
      }

      // fill Vel (left) data
      for (let i = 0; i < ROWS_PER_SECTION; i++) {
        const rowNum = currentRow + i;
        if (i < velChunk.length) {
          const r = velChunk[i];
          const comm = commLabel(r);
          sheet.getCell(rowNum, 1).value = offset + i + 1;
          sheet.getCell(rowNum, 2).value = (r.Fullname || '').trim();
          sheet.getCell(rowNum, 5).value = r.Sub_Name || '';
          sheet.getCell(rowNum, 6).value = r.drp_Type || '';
          sheet.getCell(rowNum, 7).value = comm === '\u0E42\u0E17\u0E23' ? '\u2713' : '';
          sheet.getCell(rowNum, 8).value = comm === '\u0E41\u0E08\u0E49\u0E07\u0E25\u0E48\u0E27\u0E07\u0E2B\u0E19\u0E49\u0E32' ? '\u2713' : '';
          sheet.getCell(rowNum, 9).value = (r.drp_Remark || '').trim();
        } else {
          sheet.getCell(rowNum, 1).value = null;
        }
      }

      // fill Outsource (right) data
      for (let i = 0; i < ROWS_PER_SECTION; i++) {
        const rowNum = currentRow + i;
        if (i < outChunk.length) {
          const r = outChunk[i];
          const comm = commLabel(r);
          const vsth = (r.Emp_Vsth || r.drp_status || '').trim();
          sheet.getCell(rowNum, 12).value = offset + i + 1;
          sheet.getCell(rowNum, 13).value = (r.Fullname || '').trim();
          sheet.getCell(rowNum, 17).value = r.Sub_Name || '';
          sheet.getCell(rowNum, 18).value = r.drp_Type || '';
          sheet.getCell(rowNum, 19).value = comm === '\u0E42\u0E17\u0E23' ? '\u2713' : '';
          sheet.getCell(rowNum, 20).value = comm === '\u0E41\u0E08\u0E49\u0E07\u0E25\u0E48\u0E27\u0E07\u0E2B\u0E19\u0E49\u0E32' ? '\u2713' : '';
          sheet.getCell(rowNum, 21).value = vsth;
          sheet.getCell(rowNum, 22).value = (r.drp_Remark || '').trim();
        } else {
          sheet.getCell(rowNum, 12).value = null;
        }
      }

      currentRow += ROWS_PER_SECTION;
    }

    // ── write summary section
    // currentRow is now just after the last data row
    const summaryOffset = currentRow - SUMMARY_TMPL_START; // = 0 when sections === 1

    if (sections > 1) {
      // copy summary rows from template to their dynamic position
      shiftMerges(sheet, SUMMARY_TMPL_START, SUMMARY_TMPL_END, summaryOffset);
      for (let tr = SUMMARY_TMPL_START; tr <= SUMMARY_TMPL_END; tr++) {
        copyTmplRow(sheet, tr, tr + summaryOffset);
      }
    }

    // ── fill summary values (summaryOffset adjusts row numbers)
    const S = summaryOffset;

    // company totals
    sheet.getCell(26 + S, 5).value = totalByGroup.Vel || 0;
    sheet.getCell(26 + S, 9).value = grouped.Vel.length;
    sheet.getCell(26 + S, 17).value = totalByGroup.SK || 0;
    sheet.getCell(26 + S, 21).value = grouped.SK.length;
    sheet.getCell(27 + S, 17).value = totalByGroup.TBS || 0;
    sheet.getCell(27 + S, 21).value = grouped.TBS.length;
    sheet.getCell(28 + S, 17).value = totalByGroup.CWS || 0;
    sheet.getCell(28 + S, 21).value = grouped.CWS.length;

    // leave-type matrix (rows 31-35)
    const LT_MAP = { 'A': 2, 'B': 3, 'S': 4, 'H': 5, 'D': 6, 'F': 8, 'C': 10, 'O': 12, 'x': 14 };
    const COMPANIES = ['Vel', 'SK', 'TBS', 'CWS'];

    COMPANIES.forEach((co, ci) => {
      const rd = grouped[co] || [];
      Object.entries(LT_MAP).forEach(([lt, col]) => {
        sheet.getCell(31 + ci + S, col).value = rd.filter(r => r.drp_Type === lt).length;
      });
    });

    Object.entries(LT_MAP).forEach(([lt, col]) => {
      const tot = COMPANIES.reduce((sum, co) =>
        sum + (grouped[co] || []).filter(r => r.drp_Type === lt).length, 0);
      sheet.getCell(35 + S, col).value = tot;
    });

    // right summary
    const totalEmp = Object.values(totalByGroup).reduce((a, b) => a + b, 0);
    const totalAbsent = data.length;
    sheet.getCell(31 + S, 18).value = totalEmp;
    sheet.getCell(32 + S, 18).value = Math.max(0, totalEmp - totalAbsent);
    sheet.getCell(33 + S, 18).value = totalAbsent;

    await wb.xlsx.writeFile(outputPath);


    return { success: true, filePath: outputPath };


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


        SUM(CASE WHEN tp.Plan_TypeTraining = 'à¸ à¸²à¸¢à¸™อก' THEN 1 ELSE 0 END) AS externalCount


      ${joins}`,


      []


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


    const { search = '', page = 1, perPage = 15 } = filters;


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


      }


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
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'บันทึกไฟล์ Excel',
    defaultPath: `OT_${ceYear + 543}_${String(month).padStart(2, '0')}.xlsx`,
    filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
  });
  if (canceled || !filePath) return { success: false, canceled: true };

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

  // ── Load the original template once ──────────────────────────────────────
  const templatePath = path.join(__dirname, 'data', 'OT.xlsx');
  const templateWb = new ExcelJS.Workbook();
  await templateWb.xlsx.readFile(templatePath);
  const templateWs = templateWb.worksheets[0]
    || templateWb.worksheets.find(Boolean);
  if (!templateWs) {
    console.error('[OT Export] sheets in template:', templateWb.worksheets.map(s => s && s.name));
    return { success: false, message: `ไม่พบ sheet ใน template: ${templatePath}` };
  }

  // ── Output workbook ───────────────────────────────────────────────────────
  const outWb = new ExcelJS.Workbook();

  // Helper: deep-copy one worksheet from template into outWb
  function copySheet(srcWs, sheetName) {
    const dstWs = outWb.addWorksheet(sheetName);

    // Page setup & margins (exact original)
    Object.assign(dstWs.pageSetup, srcWs.pageSetup);

    // Column widths
    srcWs.columns.forEach((col, idx) => {
      const dstCol = dstWs.getColumn(idx + 1);
      if (col.width) dstCol.width = col.width;
    });

    // Rows: height + cells (value + full style deep-copy)
    srcWs.eachRow({ includeEmpty: true }, (srcRow, rowNum) => {
      const dstRow = dstWs.getRow(rowNum);
      if (srcRow.height) {
        dstRow.height = srcRow.height;
        dstRow.customHeight = true;
      }
      srcRow.eachCell({ includeEmpty: true }, (srcCell, colNum) => {
        const dstCell = dstRow.getCell(colNum);
        dstCell.value = srcCell.value;
        // Deep-copy style so each sheet is independent
        dstCell.style = JSON.parse(JSON.stringify(srcCell.style));
      });
      dstRow.commit();
    });

    // Merge cells
    const merges = srcWs.model && srcWs.model.merges;
    if (Array.isArray(merges)) {
      merges.forEach(m => { try { dstWs.mergeCells(m); } catch { } });
    }

    return dstWs;
  }

  // ── Build one sheet per employee ──────────────────────────────────────────
  for (const { emp, days } of forms) {
    const ws = copySheet(templateWs, String(emp.Emp_ID));

    // ── Row 1: Title with month + year ──────────────────────────────────────
    ws.getCell('A1').value =
      `     รายงานการทำงานล่วงเวลาประจำเดือน ${monthName} ${beYear}`;

    // ── Row 2: Employee name + ID ───────────────────────────────────────────
    ws.getCell('D2').value = emp.Emp_Firstname || emp.Fullname || '';
    ws.getCell('F2').value = emp.Emp_Lastname || '';
    ws.getCell('I2').value = String(emp.Emp_ID);

    // ── Row 3: Department + date range ────────────────────────────────────────
    ws.getCell('D3').value = emp.Sub_Name || '';
    ws.getCell('I3').value = `1 - ${daysInMonth} ${monthName} ${beYear}`;

    // ── Day rows (6-35): day number + weekend/holiday label ───────────────────
    for (let i = 0; i < days.length; i++) {
      const day = days[i];
      const rowNum = 6 + i;
      ws.getCell(rowNum, 1).value = String(day.d);
      let note = '';
      if (day.isHoliday) note = day.holidayName;
      else if (day.dow === 6) note = 'วันเสาร์';
      else if (day.dow === 0) note = 'วันอาทิตย์';
      ws.getCell(rowNum, 10).value = note;
    }

    // Clear leftover day cells if month is shorter than template (< 30 days)
    for (let extra = days.length + 1; extra <= 30; extra++) {
      ws.getCell(5 + extra, 1).value = null;
      ws.getCell(5 + extra, 10).value = null;
    }
  }

  try {
    await outWb.xlsx.writeFile(filePath);
    return { success: true, filePath };
  } catch (e) {
    return { success: false, message: e.message };
  }
});


