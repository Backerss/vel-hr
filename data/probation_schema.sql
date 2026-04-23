-- ============================================================
-- Probation Evaluation Module — Schema & Seed Data
-- Compatible with: training.v.1.1 database
-- Tables: tb_probation_criteria, tb_probation_cycle,
--         tb_probation_period, tb_probation_attendance,
--         tb_probation_score
--
-- IMPORTANT: These CREATE TABLE statements are safe to run
-- multiple times (IF NOT EXISTS). They do NOT modify any
-- existing tables.
-- ============================================================

-- ──────────────────────────────────────────────────────────
-- 1. หัวข้อประเมิน (Dynamic criteria master)
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tb_probation_criteria (
  criteria_id   INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  criteria_name VARCHAR(200)     NOT NULL COMMENT 'ชื่อหัวข้อประเมิน',
  criteria_desc TEXT                      COMMENT 'คำอธิบาย',
  max_score     DECIMAL(5,2)     NOT NULL DEFAULT 100.00 COMMENT 'คะแนนเต็ม',
  sort_order    SMALLINT         NOT NULL DEFAULT 0      COMMENT 'ลำดับการแสดง',
  is_active     TINYINT(1)       NOT NULL DEFAULT 1      COMMENT '1=ใช้งาน, 0=ปิด',
  created_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (criteria_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='หัวข้อประเมินผลทดลองงาน (dynamic master)';

-- ──────────────────────────────────────────────────────────
-- 2. แฟ้มทดลองงาน (1 ต่อ 1 พนักงาน)
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tb_probation_cycle (
  cycle_id      INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  emp_id        VARCHAR(20)      NOT NULL COMMENT 'FK → employees.Emp_ID',
  start_date    DATE             NOT NULL COMMENT 'วันเริ่มทดลองงาน',
  status        ENUM('ACTIVE','CLOSED') NOT NULL DEFAULT 'ACTIVE',
  remark        TEXT                      COMMENT 'หมายเหตุ',
  created_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (cycle_id),
  UNIQUE KEY uq_emp_cycle (emp_id)
    COMMENT '1 พนักงาน มีได้ 1 cycle'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='แฟ้มทดลองงานของพนักงาน';

-- ──────────────────────────────────────────────────────────
-- 3. รอบประเมิน (1 cycle มีได้หลาย period, 1 period = 4 เดือน)
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tb_probation_period (
  period_id     INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  cycle_id      INT UNSIGNED     NOT NULL,
  period_no     TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'ลำดับรอบ (1, 2, 3, ...)',
  start_date    DATE             NOT NULL,
  end_date      DATE             NOT NULL,
  decision      ENUM('PENDING','PASS','EXTEND','TERMINATE','OTHER')
                                 NOT NULL DEFAULT 'PENDING',
  decision_note TEXT                      COMMENT 'หมายเหตุการตัดสินใจ',
  att_pct       DECIMAL(5,2)              COMMENT 'Attendance % (A) — cached',
  quality_pct   DECIMAL(5,2)              COMMENT 'Quality % (B) — cached',
  avg_score     DECIMAL(5,2)              COMMENT 'Average % = (A+B)/2 — cached',
  grade         VARCHAR(5)                COMMENT 'เกรด A/B/C/D/F — cached',
  created_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (period_id),
  UNIQUE KEY uq_cycle_period (cycle_id, period_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='รอบประเมินทดลองงาน (4 เดือน / รอบ)';

-- ──────────────────────────────────────────────────────────
-- 4. ข้อมูลการมาทำงานรายเดือน
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tb_probation_attendance (
  att_id        INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  period_id     INT UNSIGNED     NOT NULL,
  month_no      TINYINT UNSIGNED NOT NULL COMMENT '1..4 (เดือนที่ในรอบ)',
  `year_month`  CHAR(7)          NOT NULL COMMENT 'YYYY-MM',
  work_days     TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'วันทำงานในเดือน',
  present_days  TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'มาทำงาน',
  absent_days   TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'ขาดงาน',
  late_days     TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'มาสาย',
  leave_days    DECIMAL(5,2)     NOT NULL DEFAULT 0.00 COMMENT 'ลา (รองรับเศษวัน)',
  att_pct       DECIMAL(5,2)              COMMENT 'present / work * 100',
  remark        VARCHAR(500),
  PRIMARY KEY (att_id),
  UNIQUE KEY uq_period_month (period_id, month_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='ข้อมูลการมาทำงานรายเดือนของแต่ละรอบทดลองงาน';

ALTER TABLE tb_probation_attendance
  MODIFY leave_days DECIMAL(5,2) NOT NULL DEFAULT 0.00 COMMENT 'ลา (รองรับเศษวัน)';

-- ──────────────────────────────────────────────────────────
-- 5. คะแนนประเมินรายหัวข้อ รายเดือน
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tb_probation_score (
  score_id      INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  period_id     INT UNSIGNED     NOT NULL,
  month_no      TINYINT UNSIGNED NOT NULL COMMENT '1..4',
  criteria_id   INT UNSIGNED     NOT NULL,
  score         DECIMAL(5,2)     NOT NULL DEFAULT 0,
  remark        VARCHAR(500),
  PRIMARY KEY (score_id),
  UNIQUE KEY uq_period_month_criteria (period_id, month_no, criteria_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='คะแนนประเมินรายหัวข้อ รายเดือน สำหรับแต่ละรอบทดลองงาน';

-- ============================================================
-- Seed: หัวข้อประเมินเริ่มต้น (ปรับแก้ได้ในระบบ)
-- ใช้ INSERT IGNORE เพื่อไม่ duplicate ถ้ารัน script ซ้ำ
-- ============================================================
INSERT IGNORE INTO tb_probation_criteria
  (criteria_id, criteria_name, criteria_desc, max_score, sort_order, is_active)
VALUES
  (1, 'ความรู้และทักษะในงาน',       'ความสามารถในการปฏิบัติงานตามหน้าที่ที่ได้รับมอบหมาย',                       100.00, 1, 1),
  (2, 'ความรับผิดชอบ',               'ความตั้งใจและความรับผิดชอบต่องานที่ได้รับมอบหมาย',                         100.00, 2, 1),
  (3, 'ความสามารถในการเรียนรู้',     'ความรวดเร็วและความแม่นยำในการเรียนรู้งานใหม่',                             100.00, 3, 1),
  (4, 'การทำงานเป็นทีม',             'ความร่วมมือและการประสานงานกับเพื่อนร่วมงานและหน่วยงานอื่น',                100.00, 4, 1),
  (5, 'วินัยและความประพฤติ',         'การปฏิบัติตามกฎระเบียบของบริษัท และความประพฤติที่เหมาะสม',                 100.00, 5, 1),
  (6, 'ความคิดริเริ่มสร้างสรรค์',   'การเสนอแนวคิดใหม่ๆ เพื่อพัฒนางาน',                                        100.00, 6, 1),
  (7, 'การสื่อสาร',                  'ความสามารถในการสื่อสารกับผู้บังคับบัญชาและเพื่อนร่วมงานอย่างมีประสิทธิภาพ', 100.00, 7, 1),
  (8, 'ทัศนคติต่องาน',              'ความกระตือรือร้นและทัศนคติเชิงบวกต่อการทำงาน',                             100.00, 8, 1);
