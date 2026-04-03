const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
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

// Export daily absence report to Excel (using template)
ipcMain.handle('export-absence-excel', async (event, { date, data }) => {
  if (!data || !date) return { success: false, message: 'ไม่มีข้อมูล' };
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
    } catch(e) {}

    // Format date label (Thai month name, CE year)
    const thMonths = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                      'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
    const dObj = new Date(date + 'T00:00:00');
    const thDateLabel = `${dObj.getDate()} ${thMonths[dObj.getMonth()]} ${dObj.getFullYear()}`;

    // Show save dialog
    const saveResult = await dialog.showSaveDialog({
      title: 'บันทึกรายงาน Excel',
      defaultPath: `รายงานการหยุดงาน_${date}.xlsx`,
      filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
    });
    if (saveResult.canceled || !saveResult.filePath) return { success: false, message: 'ยกเลิก' };
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
    function applyTemplate(sheet) {
      tmplMerges.forEach(m => { try { sheet.mergeCells(m); } catch(e) {} });
      tmplRows.forEach(({ rn, height, cells }) => {
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

    // Helper: get communicate label
    function commLabel(r) {
      if (r.drp_Communicate && r.drp_Communicate.trim()) return 'โทร';
      if (r.drp_Communicate1 && r.drp_Communicate1.trim()) return 'แจ้งล่วงหน้า';
      return '';
    }

    // Fill one sheet with data for page pageIdx
    function fillPage(sheet, pageIdx) {
      const velPage   = grouped.Vel.slice(pageIdx * 20, (pageIdx + 1) * 20);
      const outPage   = outsourceList.slice(pageIdx * 20, (pageIdx + 1) * 20);
      const isLastPg  = (pageIdx === pageCount - 1);

      // Date label
      sheet.getCell('U1').value = thDateLabel;

      // Vel rows (left side, cols A=1 B=2 E=5 F=6 G=7 H=8 I=9)
      for (let i = 0; i < 20; i++) {
        const rowNum = i + 6;
        if (i < velPage.length) {
          const r = velPage[i];
          const comm = commLabel(r);
          sheet.getCell(rowNum, 1).value  = pageIdx * 20 + i + 1;
          sheet.getCell(rowNum, 2).value  = (r.Fullname || '').trim();
          sheet.getCell(rowNum, 5).value  = r.Sub_Name || '';
          sheet.getCell(rowNum, 6).value  = r.drp_Type || '';
          sheet.getCell(rowNum, 7).value  = comm === 'โทร' ? '✓' : '';
          sheet.getCell(rowNum, 8).value  = comm === 'แจ้งล่วงหน้า' ? '✓' : '';
          sheet.getCell(rowNum, 9).value  = (r.drp_Remark || '').trim();
        } else {
          // Clear the sequence number placeholder so blank rows show empty
          sheet.getCell(rowNum, 1).value = null;
        }
      }

      // Outsource rows (right side, cols L=12 M=13 Q=17 R=18 S=19 T=20 U=21 V=22)
      for (let i = 0; i < 20; i++) {
        const rowNum = i + 6;
        if (i < outPage.length) {
          const r = outPage[i];
          const comm = commLabel(r);
          const vsth = (r.Emp_Vsth || r.drp_status || '').trim();
          sheet.getCell(rowNum, 12).value = pageIdx * 20 + i + 1;
          sheet.getCell(rowNum, 13).value = (r.Fullname || '').trim();
          sheet.getCell(rowNum, 17).value = r.Sub_Name || '';
          sheet.getCell(rowNum, 18).value = r.drp_Type || '';
          sheet.getCell(rowNum, 19).value = comm === 'โทร' ? '✓' : '';
          sheet.getCell(rowNum, 20).value = comm === 'แจ้งล่วงหน้า' ? '✓' : '';
          sheet.getCell(rowNum, 21).value = vsth;
          sheet.getCell(rowNum, 22).value = (r.drp_Remark || '').trim();
        } else {
          sheet.getCell(rowNum, 12).value = null;
        }
      }

      // Summary & leave-type matrix — only on last page
      if (isLastPg) {
        // Row 26: Vel totals (E26=total emp, I26=absent count)
        sheet.getCell(26, 5).value  = totalByGroup.Vel || 0;
        sheet.getCell(26, 9).value  = grouped.Vel.length;
        // Row 26: SK totals (Q26=total emp, U26=absent count)
        sheet.getCell(26, 17).value = totalByGroup.SK || 0;
        sheet.getCell(26, 21).value = grouped.SK.length;
        // Row 27: TBS
        sheet.getCell(27, 17).value = totalByGroup.TBS || 0;
        sheet.getCell(27, 21).value = grouped.TBS.length;
        // Row 28: CWS
        sheet.getCell(28, 17).value = totalByGroup.CWS || 0;
        sheet.getCell(28, 21).value = grouped.CWS.length;

        // Leave-type matrix rows 31-35
        // Col: B=2(A) C=3(B) D=4(S) E=5(H) F=6(D) H=8(F) J=10(C) L=12(O) N=14(x)
        const LT_MAP = { 'A':2,'B':3,'S':4,'H':5,'D':6,'F':8,'C':10,'O':12,'x':14 };
        const COMPANIES = ['Vel','SK','TBS','CWS'];
        COMPANIES.forEach((co, ci) => {
          const rd = grouped[co] || [];
          Object.entries(LT_MAP).forEach(([lt, col]) => {
            sheet.getCell(31 + ci, col).value = rd.filter(r => r.drp_Type === lt).length;
          });
        });
        // Total row (row 35)
        Object.entries(LT_MAP).forEach(([lt, col]) => {
          const tot = COMPANIES.reduce((s, co) => s + (grouped[co]||[]).filter(r => r.drp_Type === lt).length, 0);
          sheet.getCell(35, col).value = tot;
        });

        // Right summary (R31=total emp, R32=came to work, R33=total absent)
        const totalEmp    = Object.values(totalByGroup).reduce((a, b) => a + b, 0);
        const totalAbsent = data.length;
        sheet.getCell(31, 18).value = totalEmp;
        sheet.getCell(32, 18).value = Math.max(0, totalEmp - totalAbsent);
        sheet.getCell(33, 18).value = totalAbsent;
      }
    }

    // Fill Sheet1 (page 0)
    fillPage(tmplSheet, 0);

    // Add extra sheets for additional pages
    for (let p = 1; p < pageCount; p++) {
      const newSheet = wb.addWorksheet(`Sheet${p + 1}`);
      applyTemplate(newSheet);
      fillPage(newSheet, p);
    }

    await wb.xlsx.writeFile(outputPath);
    return { success: true, filePath: outputPath };
  } catch (e) {
    return { success: false, message: e.message };
  }
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

// ===================== TRAINING RECORD IPC =====================

// Get training plans list for record dropdown (no pagination)
ipcMain.handle('get-training-plans-for-record', async () => {
  if (!db) return { success: false, message: 'ไม่ได้เชื่อมต่อฐานข้อมูล' };
  try {
    const [rows] = await db.execute(
      `SELECT tp.Plan_ID, c.Courses_ID, c.Courses_Name,
        DATE_FORMAT(tp.Plan_StartDate, '%Y-%m-%d') AS Plan_StartDate,
        tp.Plan_TimeStart,
        DATE_FORMAT(tp.Plan_EndDate, '%Y-%m-%d') AS Plan_EndDate,
        tp.Plan_TimeEnd,
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
  if (!db) return { success: false, message: 'ไม่ได้เชื่อมต่อฐานข้อมูล' };
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
  if (!db) return { success: false, message: 'ไม่ได้เชื่อมต่อฐานข้อมูล' };
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
    const path = require('path');
    const templatePath = path.join(__dirname, 'data', 'F-HR-002 บันทึกการอบรม.xlsx');

    let timeLabel = '';
    if (timeRange === 'morning') timeLabel = '08.00 - 12.00 น.';
    else if (timeRange === 'afternoon') timeLabel = '13.00 - 17.00 น.';
    else {
      const ts = plan.Plan_TimeStart ? plan.Plan_TimeStart.substring(0, 5) : '';
      const te = plan.Plan_TimeEnd   ? plan.Plan_TimeEnd.substring(0, 5)   : '';
      timeLabel = ts && te ? `${ts} - ${te} น.` : (ts || te || '');
    }

    const thMonths = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                      'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
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

    const HEADER_ROWS    = 8;   // rows 1-8 = header block (title, date/time, subject, etc.)
    const FIRST_DATA_ROW = 9;   // data starts at row 9
    const ROWS_PER_BLOCK = 30;  // 30 participants per block (rows 9-38)
    const SPACER_ROWS    = 2;   // blank rows between repeated blocks

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
        } catch(e) {}
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
      sheet.getCell(startRow + 2, 5).value = plan.Courses_Name  || ''; // E3: subject
      sheet.getCell(startRow + 3, 4).value = plan.Plan_Lecturer || ''; // D4: trainer
      sheet.getCell(startRow + 4, 4).value = plan.Plan_Company  || ''; // D5: company
      sheet.getCell(startRow + 4, 9).value = plan.Plan_Location || ''; // I5: location
    }

    // ── resolve English names stored duplicated in both fields ──
    // e.g. Firstname="YOON THARAPHI THAW" Lastname="YOON THARAPHI THAW"
    // → firstname="YOON", lastname="THARAPHI THAW"
    function resolveNames(p) {
      let firstname = p.Emp_Firstname || '';
      let lastname  = p.Emp_Lastname  || '';
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
        const pIdx   = globalOffset + i;
        const rowNum = dataStartRow + i;
        const row    = sheet.getRow(rowNum);
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
          row.getCell(1).value  = pIdx + 1;           // continuous sequence
          row.getCell(2).value  = p.Emp_ID || '';
          row.getCell(3).value  = p.Emp_Sname || '';  // คำนำหน้า
          row.getCell(4).value  = firstname;           // ชื่อ
          row.getCell(5).value  = lastname;            // นามสกุล
          row.getCell(6).value  = p.Position_Name || '';
          row.getCell(7).value  = p.Sub_Name || '';
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
      const headerSnap  = snapRows(sheet, 1, HEADER_ROWS);
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
