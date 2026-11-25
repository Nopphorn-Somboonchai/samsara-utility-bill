/**
 * ============================================================================
 * Samsara Utility Bill — Database & Drive Setup Script (setup.gs)
 * ระบบจดและติดตามค่าน้ำ - ค่าไฟ บ้านพักครู (สามสาระ)
 * ============================================================================
 * วิธีใช้งาน:
 *   1. เปิดไฟล์นี้ใน Google Apps Script ที่ผูกกับ Google Sheets เปล่า
 *   2. เลือกฟังก์ชัน setupDatabase() แล้วกด "เรียกใช้ (Run)" เพียงครั้งเดียว
 *   3. ระบบจะสร้าง 5 แท็บ หัวตาราง โฟลเดอร์ Google Drive รหัส PIN เริ่มต้น (1234)
 *      และข้อมูลตั้งต้นรอบบิลเดือนพฤศจิกายน 2569 (2026-11) ครบทั้ง 9 ห้อง
 * ============================================================================
 */

var SETUP_FOLDER_NAME = 'Samsara-Utility-Slips';
var SETUP_DEFAULT_PIN = '1234';

var SETUP_SCHEMAS = {
  Settings: ['key', 'value', 'description'],
  Residents: [
    'resident_id',
    'room_no',
    'full_name',
    'status',
    'move_in_date',
    'move_out_date',
    'initial_meter',
    'note',
    'updated_at'
  ],
  Billing_Cycles: [
    'cycle_id',
    'year_th',
    'month_label',
    'due_date',
    'water_rate',
    'electric_rate',
    'status',
    'created_at'
  ],
  Meter_Records: [
    'record_id',
    'cycle_id',
    'resident_id',
    'room_no',
    'name_snapshot',
    'prev_meter',
    'curr_meter',
    'units_used',
    'water_cost',
    'electric_cost',
    'total_cost',
    'payment_status',
    'slip_url',
    'slip_file_id',
    'paid_at',
    'verified_at',
    'reject_reason',
    'updated_at'
  ],
  Audit_Logs: ['timestamp', 'action', 'target_id', 'detail']
};

var SETUP_SEED_NOV_2569 = [
  { resident_id: 'RES-001', room_no: '1', full_name: 'นางสาวรุจิรางค์ งามเมือง', prev_meter: 3834, curr_meter: 3876 },
  { resident_id: 'RES-002', room_no: '2', full_name: 'นางสาวบุษบาบัณ กันนิกา', prev_meter: 5455, curr_meter: 5516 },
  { resident_id: 'RES-003', room_no: '3', full_name: 'นายนพพร สมบูรณ์ชัย', prev_meter: 4710, curr_meter: 4772 },
  { resident_id: 'RES-004', room_no: '4', full_name: 'นายทศพล แก้วสุยะ', prev_meter: 465, curr_meter: 510 },
  { resident_id: 'RES-005', room_no: '5', full_name: 'นางสาวโสธิดา สุอุดมสินโรจน์', prev_meter: 7730, curr_meter: 7730 },
  { resident_id: 'RES-006', room_no: '6', full_name: 'นางสาวเมรินทร์ สิทธิบุญมี', prev_meter: 9066, curr_meter: 9158 },
  { resident_id: 'RES-007', room_no: '7', full_name: 'นางสาวอัมพร กลิ่นรสทิพย์', prev_meter: 4606, curr_meter: 4626 },
  { resident_id: 'RES-008', room_no: '8', full_name: 'นางสาวเบญจวรรณ พลับพลึงพนา', prev_meter: 3211, curr_meter: 3233 },
  { resident_id: 'RES-009', room_no: '9', full_name: 'นางสาวณัฐวดี เขียวภูมิชัย', prev_meter: 3602, curr_meter: 3602 }
];

/**
 * รันครั้งเดียวเพื่อสร้างโครงสร้างฐานข้อมูล โฟลเดอร์ Drive และข้อมูลตั้งต้น
 */
function setupDatabase() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('ไม่พบ Spreadsheet ที่เชื่อมโยง กรุณาเปิด Apps Script จากไฟล์ Google Sheets');
  }

  var nowIso = new Date().toISOString();

  // 1. สร้างหรือดึงโฟลเดอร์เก็บสลิปใน Google Drive
  var slipFolder = setupGetOrCreateDriveFolder_(SETUP_FOLDER_NAME);
  var slipFolderId = slipFolder.getId();

  // 2. ตั้งค่า ADMIN_PIN เริ่มต้นใน Script Properties (ไม่ทับถ้าตั้งไว้แล้ว)
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_PIN')) {
    props.setProperty('ADMIN_PIN', SETUP_DEFAULT_PIN);
    Logger.log('ตั้งค่า ADMIN_PIN เริ่มต้นเป็น: ' + SETUP_DEFAULT_PIN);
  } else {
    Logger.log('พบ ADMIN_PIN เดิมใน ScriptProperties แล้ว (คงค่าเดิมไว้)');
  }

  // 3. สร้างและจัดรูปแบบหัวตารางทั้ง 5 แท็บ
  var settingsSheet = setupEnsureSheet_(ss, 'Settings', SETUP_SCHEMAS.Settings);
  var residentsSheet = setupEnsureSheet_(ss, 'Residents', SETUP_SCHEMAS.Residents);
  var cyclesSheet = setupEnsureSheet_(ss, 'Billing_Cycles', SETUP_SCHEMAS.Billing_Cycles);
  var recordsSheet = setupEnsureSheet_(ss, 'Meter_Records', SETUP_SCHEMAS.Meter_Records);
  var logsSheet = setupEnsureSheet_(ss, 'Audit_Logs', SETUP_SCHEMAS.Audit_Logs);

  // ป้องกัน Google Sheets แปลงเลขบัญชีและ cycle_id เป็นตัวเลข/วันที่
  settingsSheet.getRange('A2:C100').setNumberFormat('@');
  residentsSheet.getRange('A2:F500').setNumberFormat('@');
  residentsSheet.getRange('H2:I500').setNumberFormat('@');
  cyclesSheet.getRange('A2:A200').setNumberFormat('@');
  cyclesSheet.getRange('C2:D200').setNumberFormat('@');
  cyclesSheet.getRange('G2:H200').setNumberFormat('@');
  recordsSheet.getRange('A2:E2000').setNumberFormat('@');
  recordsSheet.getRange('L2:R2000').setNumberFormat('@');
  logsSheet.getRange('A2:D5000').setNumberFormat('@');

  // 4. เติมข้อมูลแท็บ Settings (เฉพาะกรณีที่ยังไม่มีข้อมูล)
  if (settingsSheet.getLastRow() <= 1) {
    var settingsRows = [
      ['house_name', 'บ้านพักครู (สามสาระ)', 'ชื่อบ้านพักครู'],
      ['bank_name', 'ธนาคารกรุงไทย', 'ชื่อธนาคารสำหรับโอนชำระ'],
      ['bank_account_no', '8540466694', 'เลขที่บัญชีรับโอน'],
      ['bank_account_name', 'ครูนพพร สมบูรณ์ชัย', 'ชื่อบัญชีรับโอน'],
      ['promptpay_id', '', 'หมายเลขพร้อมเพย์ (เว้นว่างไว้สำหรับอนาคต)'],
      ['default_water_rate', '75', 'ค่าน้ำเหมาจ่ายเริ่มต้นต่อห้อง (บาท)'],
      ['default_electric_rate', '7', 'ค่าไฟเริ่มต้นต่อหน่วย (บาท)'],
      ['slip_folder_id', slipFolderId, 'Google Drive Folder ID ของ Samsara-Utility-Slips']
    ];
    settingsSheet.getRange(2, 1, settingsRows.length, 3).setNumberFormat('@').setValues(settingsRows);
    Logger.log('สร้างข้อมูลแท็บ Settings เรียบร้อยแล้ว');
  } else {
    // ตรวจสอบว่ามี slip_folder_id แล้วหรือยัง ถ้ายังว่างให้อัปเดตให้
    setupEnsureSlipFolderSetting_(settingsSheet, slipFolderId);
  }

  // 5. เติมข้อมูลแท็บ Residents (9 ท่าน)
  if (residentsSheet.getLastRow() <= 1) {
    var residentRows = SETUP_SEED_NOV_2569.map(function (item) {
      return [
        item.resident_id,
        item.room_no,
        item.full_name,
        'active',
        '2026-11-01',
        '',
        item.prev_meter,
        '',
        nowIso
      ];
    });
    residentsSheet.getRange(2, 1, residentRows.length, SETUP_SCHEMAS.Residents.length).setValues(residentRows);
    Logger.log('สร้างข้อมูลผู้พักอาศัยเริ่มต้น 9 ท่านเรียบร้อยแล้ว');
  }

  // 6. เติมข้อมูลแท็บ Billing_Cycles (พฤศจิกายน 2569)
  var waterRate = 75;
  var electricRate = 7;
  var seedCycleId = '2026-11';

  if (cyclesSheet.getLastRow() <= 1) {
    var cycleRow = [[
      seedCycleId,
      2569,
      'พฤศจิกายน 2569',
      '28 พฤศจิกายน 2569',
      waterRate,
      electricRate,
      'open',
      nowIso
    ]];
    cyclesSheet.getRange(2, 1, 1, SETUP_SCHEMAS.Billing_Cycles.length).setValues(cycleRow);
    cyclesSheet.getRange(2, 1).setNumberFormat('@');
    Logger.log('สร้างรอบบิลตั้งต้น 2026-11 (พฤศจิกายน 2569) เรียบร้อยแล้ว');
  }

  // 7. เติมข้อมูลแท็บ Meter_Records (พฤศจิกายน 2569 รวม 3,083 บาท)
  if (recordsSheet.getLastRow() <= 1) {
    var sumWater = 0;
    var sumElectric = 0;
    var sumTotal = 0;
    var sumUnits = 0;

    var recordRows = SETUP_SEED_NOV_2569.map(function (item) {
      var unitsUsed = item.curr_meter - item.prev_meter;
      var waterCost = waterRate;
      var electricCost = unitsUsed * electricRate;
      var totalCost = waterCost + electricCost;

      sumUnits += unitsUsed;
      sumWater += waterCost;
      sumElectric += electricCost;
      sumTotal += totalCost;

      return [
        seedCycleId + '_' + item.resident_id,
        seedCycleId,
        item.resident_id,
        item.room_no,
        item.full_name,
        item.prev_meter,
        item.curr_meter,
        unitsUsed,
        waterCost,
        electricCost,
        totalCost,
        'unpaid',
        '',
        '',
        '',
        '',
        '',
        nowIso
      ];
    });

    recordsSheet.getRange(2, 1, recordRows.length, SETUP_SCHEMAS.Meter_Records.length).setValues(recordRows);
    Logger.log(
      'สร้างบันทึกมิเตอร์ 2026-11 เรียบร้อย: ' +
        recordRows.length + ' ห้อง | หน่วยไฟ ' + sumUnits +
        ' | ค่าน้ำ ' + sumWater + ' | ค่าไฟ ' + sumElectric + ' | รวมสุทธิ ' + sumTotal + ' บาท'
    );
  }

  // 8. บันทึก Audit Log และลบชีตเปล่าเริ่มต้น (Sheet1 / แผ่นงาน1) หากมี
  logsSheet.appendRow([
    nowIso,
    'SETUP_DATABASE',
    seedCycleId,
    'ติดตั้งฐานข้อมูล 5 แท็บ โฟลเดอร์ Drive (' + slipFolderId + ') และข้อมูลตั้งต้น พ.ย. 2569 เรียบร้อย'
  ]);

  setupCleanupDefaultEmptySheet_(ss);

  // ปรับขนาดคอลัมน์ให้อ่านง่ายใน Google Sheets
  [settingsSheet, residentsSheet, cyclesSheet, recordsSheet, logsSheet].forEach(function (sh) {
    sh.autoResizeColumns(1, sh.getLastColumn());
  });

  Logger.log('=== setupDatabase() เสร็จสมบูรณ์ ===');
  Logger.log('Slip Folder ID: ' + slipFolderId);
  Logger.log('Default Admin PIN: ' + props.getProperty('ADMIN_PIN'));
}

/**
 * ฟังก์ชันช่วยเปลี่ยนหรือรีเซ็ต ADMIN_PIN ด้วยตนเองจากหน้า Apps Script Editor
 * วิธีใช้: แก้ค่าใน resetAdminPinToDefault หรือเรียก setAdminPin('รหัสใหม่')
 */
function setAdminPin(newPin) {
  var pinStr = String(newPin || '').trim();
  if (pinStr.length < 4 || pinStr.length > 12) {
    throw new Error('รหัส PIN ต้องมีความยาวระหว่าง 4 ถึง 12 ตัวอักษร');
  }
  PropertiesService.getScriptProperties().setProperty('ADMIN_PIN', pinStr);
  Logger.log('อัปเดต ADMIN_PIN ใน ScriptProperties เรียบร้อยแล้ว');
}

function resetAdminPinToDefault() {
  setAdminPin(SETUP_DEFAULT_PIN);
}

/**
 * สร้างหรือดึงชีตพร้อมจัดรูปแบบหัวตาราง
 */
function setupEnsureSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange
    .setFontWeight('bold')
    .setBackground('#1E3A5F')
    .setFontColor('#FFFFFF')
    .setHorizontalAlignment('center');

  sheet.setFrozenRows(1);
  return sheet;
}

/**
 * ค้นหาหรือสร้างโฟลเดอร์ Google Drive ระดับ Root
 */
function setupGetOrCreateDriveFolder_(folderName) {
  var folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  }
  return DriveApp.createFolder(folderName);
}

/**
 * ตรวจสอบว่ามี slip_folder_id ใน Settings แล้วหรือไม่
 */
function setupEnsureSlipFolderSetting_(settingsSheet, folderId) {
  var values = settingsSheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === 'slip_folder_id') {
      if (!String(values[i][1] || '').trim()) {
        settingsSheet.getRange(i + 1, 2).setNumberFormat('@').setValue(folderId);
      }
      return;
    }
  }
  settingsSheet.appendRow(['slip_folder_id', folderId, 'Google Drive Folder ID ของ Samsara-Utility-Slips']);
}

/**
 * ลบชีตเปล่าเริ่มต้น (Sheet1 / แผ่นงาน1) หากมีแท็บระบบครบแล้ว
 */
function setupCleanupDefaultEmptySheet_(ss) {
  var candidates = ['Sheet1', 'แผ่นงาน1'];
  for (var i = 0; i < candidates.length; i++) {
    var sh = ss.getSheetByName(candidates[i]);
    if (sh && sh.getLastRow() === 0 && ss.getSheets().length > 1) {
      ss.deleteSheet(sh);
    }
  }
}
