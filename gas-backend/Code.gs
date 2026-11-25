/**
 * ============================================================================
 * Samsara Utility Bill — Google Apps Script Web App Backend (Code.gs)
 * ระบบจดและติดตามค่าน้ำ - ค่าไฟ บ้านพักครู (สามสาระ)
 * ============================================================================
 * Deploy Settings:
 *   - Execute as: Me
 *   - Who has access: Anyone
 * ============================================================================
 */

var API_SHEETS = {
  SETTINGS: 'Settings',
  RESIDENTS: 'Residents',
  CYCLES: 'Billing_Cycles',
  RECORDS: 'Meter_Records',
  LOGS: 'Audit_Logs'
};

var API_DEFAULT_FOLDER_NAME = 'Samsara-Utility-Slips';
var API_ALLOWED_SETTING_KEYS = [
  'house_name',
  'bank_name',
  'bank_account_no',
  'bank_account_name',
  'promptpay_id',
  'default_water_rate',
  'default_electric_rate'
];

// ============================================================================
// HTTP Entry Points (doGet / doPost)
// ============================================================================

function doGet(e) {
  try {
    var params = (e && e.parameter) ? e.parameter : {};
    var action = String(params.action || 'getDashboard').trim();

    if (action === 'getDashboard') {
      return apiSuccess_(handleGetDashboard_(params.cycle_id));
    }

    if (action === 'getStats') {
      return apiSuccess_(handleGetStats_(params.year_th));
    }

    if (action === 'ping') {
      return apiSuccess_({ status: 'ok', server_time: new Date().toISOString() });
    }

    return apiError_('UNKNOWN_ACTION', 'ไม่พบคำสั่งที่ร้องขอ: ' + action);
  } catch (err) {
    return apiError_('SERVER_ERROR', err.message || 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์');
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var locked = false;

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return apiError_('EMPTY_BODY', 'ไม่พบข้อมูลคำขอ (Request body ว่างเปล่า)');
    }

    var payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return apiError_('INVALID_JSON', 'รูปแบบข้อมูล JSON ไม่ถูกต้อง');
    }

    var action = String(payload.action || '').trim();
    if (!action) {
      return apiError_('MISSING_ACTION', 'กรุณาระบุ action');
    }

    // 1. Public Read/Auth Check (ไม่ต้องถือ Lock)
    if (action === 'verifyPin') {
      if (!isValidAdminPin_(payload.pin)) {
        return apiError_('INVALID_PIN', 'รหัส PIN ไม่ถูกต้อง');
      }
      return apiSuccess_({ valid: true });
    }

    // 2. ป้องกันการเขียนข้อมูลชนกันด้วย LockService
    locked = lock.tryLock(15000);
    if (!locked) {
      return apiError_('LOCK_TIMEOUT', 'ระบบกำลังบันทึกข้อมูลจากผู้ใช้อื่น กรุณาลองใหม่อีกครั้งในอีกสักครู่');
    }

    // 3. Public Write Action
    if (action === 'uploadSlip') {
      return apiSuccess_(handleUploadSlip_(payload));
    }

    // 4. Admin Actions (ตรวจ PIN ทุกคำสั่ง)
    if (!isValidAdminPin_(payload.pin)) {
      return apiError_('INVALID_PIN', 'รหัส PIN ไม่ถูกต้อง หรือสิทธิ์ผู้ดูแลหมดอายุ');
    }

    switch (action) {
      case 'getResidents':
        return apiSuccess_(handleGetResidents_());
      case 'addResident':
        return apiSuccess_(handleAddResident_(payload));
      case 'moveOutResident':
        return apiSuccess_(handleMoveOutResident_(payload));
      case 'updateResident':
        return apiSuccess_(handleUpdateResident_(payload));
      case 'saveMeters':
        return apiSuccess_(handleSaveMeters_(payload));
      case 'verifyPayment':
        return apiSuccess_(handleVerifyPayment_(payload));
      case 'createCycle':
        return apiSuccess_(handleCreateCycle_(payload));
      case 'updateCycle':
        return apiSuccess_(handleUpdateCycle_(payload));
      case 'updateSettings':
        return apiSuccess_(handleUpdateSettings_(payload));
      default:
        return apiError_('UNKNOWN_ACTION', 'ไม่พบคำสั่งที่ร้องขอ: ' + action);
    }
  } catch (err) {
    var code = err.code || 'SERVER_ERROR';
    return apiError_(code, err.message || 'เกิดข้อผิดพลาดในการดำเนินการ');
  } finally {
    if (locked) {
      lock.releaseLock();
    }
  }
}

// ============================================================================
// Public Handlers
// ============================================================================

function handleGetDashboard_(requestedCycleId) {
  var settings = readSettingsMap_();
  var cycles = readAllCycles_();
  cycles.sort(function (a, b) {
    return b.cycle_id.localeCompare(a.cycle_id);
  });

  var targetCycleId = String(requestedCycleId || '').trim();
  var activeCycle = null;

  if (targetCycleId) {
    for (var i = 0; i < cycles.length; i++) {
      if (cycles[i].cycle_id === targetCycleId) {
        activeCycle = cycles[i];
        break;
      }
    }
  }
  if (!activeCycle && cycles.length > 0) {
    activeCycle = cycles[0];
  }

  var records = [];
  if (activeCycle) {
    records = readAllRecords_().filter(function (rec) {
      return rec.cycle_id === activeCycle.cycle_id;
    });
    records.sort(compareRoomNo_);
  }

  return {
    settings: settings,
    cycles: cycles,
    activeCycle: activeCycle,
    records: records
  };
}

function handleGetStats_(requestedYearTh) {
  var cycles = readAllCycles_();
  var allRecords = readAllRecords_();
  var allResidents = readAllResidents_();

  // รวบรวมปี พ.ศ. ที่มีข้อมูลทั้งหมด (เรียงใหม่ -> เก่า)
  var yearMap = {};
  cycles.forEach(function (c) {
    if (c.year_th) {
      yearMap[c.year_th] = true;
    }
  });
  var availableYears = Object.keys(yearMap)
    .map(function (y) { return Number(y); })
    .sort(function (a, b) { return b - a; });

  var selectedYear = Number(requestedYearTh);
  if (!selectedYear || !yearMap[selectedYear]) {
    selectedYear = availableYears.length > 0 ? availableYears[0] : (new Date().getFullYear() + 543);
  }

  // สร้าง Map รอบบิลของปีที่เลือก (เรียงตามเดือนเก่า -> ใหม่ สำหรับกราฟ)
  var yearCycles = cycles
    .filter(function (c) { return Number(c.year_th) === selectedYear; })
    .sort(function (a, b) { return a.cycle_id.localeCompare(b.cycle_id); });

  var cycleLookup = {};
  cycles.forEach(function (c) {
    cycleLookup[c.cycle_id] = c;
  });

  var yearCycleIds = {};
  yearCycles.forEach(function (c) {
    yearCycleIds[c.cycle_id] = true;
  });

  // สรุปรายเดือนตลอดปีที่เลือก
  var monthlySummary = yearCycles.map(function (cycle) {
    var cycleRecs = allRecords.filter(function (r) {
      return r.cycle_id === cycle.cycle_id;
    });

    var totalUnits = 0;
    var totalWater = 0;
    var totalElectric = 0;
    var totalCost = 0;
    var paidCount = 0;
    var paidAmount = 0;

    cycleRecs.forEach(function (r) {
      totalUnits += r.units_used;
      totalWater += r.water_cost;
      totalElectric += r.electric_cost;
      totalCost += r.total_cost;
      if (r.payment_status === 'paid') {
        paidCount += 1;
        paidAmount += r.total_cost;
      }
    });

    return {
      cycle_id: cycle.cycle_id,
      year_th: cycle.year_th,
      month_label: cycle.month_label,
      due_date: cycle.due_date,
      water_rate: cycle.water_rate,
      electric_rate: cycle.electric_rate,
      status: cycle.status,
      room_count: cycleRecs.length,
      total_units: totalUnits,
      total_water: totalWater,
      total_electric: totalElectric,
      total_cost: totalCost,
      paid_count: paidCount,
      paid_amount: paidAmount
    };
  });

  // รายชื่อผู้พักอาศัยทั้งหมด (ทั้งปัจจุบันและผู้ย้ายออกแล้ว เพื่อเลือกดูกราฟรายบุคคล)
  var residentIndex = {};
  allResidents.forEach(function (res) {
    residentIndex[res.resident_id] = {
      resident_id: res.resident_id,
      room_no: res.room_no,
      full_name: res.full_name,
      status: res.status
    };
  });
  allRecords.forEach(function (rec) {
    if (!residentIndex[rec.resident_id]) {
      residentIndex[rec.resident_id] = {
        resident_id: rec.resident_id,
        room_no: rec.room_no,
        full_name: rec.name_snapshot,
        status: 'moved_out'
      };
    }
  });

  var residentsList = Object.keys(residentIndex)
    .map(function (id) { return residentIndex[id]; })
    .sort(function (a, b) {
      if (a.status !== b.status) {
        return a.status === 'active' ? -1 : 1;
      }
      return compareRoomNo_(a, b);
    });

  // ประวัติรายบุคคลของปีที่เลือก (รวม label เดือนไว้ให้พร้อมใช้ทำกราฟ)
  var residentHistory = allRecords
    .filter(function (rec) { return Boolean(yearCycleIds[rec.cycle_id]); })
    .map(function (rec) {
      var cyc = cycleLookup[rec.cycle_id];
      return {
        record_id: rec.record_id,
        cycle_id: rec.cycle_id,
        month_label: cyc ? cyc.month_label : rec.cycle_id,
        resident_id: rec.resident_id,
        room_no: rec.room_no,
        name_snapshot: rec.name_snapshot,
        prev_meter: rec.prev_meter,
        curr_meter: rec.curr_meter,
        units_used: rec.units_used,
        water_cost: rec.water_cost,
        electric_cost: rec.electric_cost,
        total_cost: rec.total_cost,
        payment_status: rec.payment_status,
        slip_url: rec.slip_url,
        slip_file_id: rec.slip_file_id,
        slip_view_url: rec.slip_view_url
      };
    })
    .sort(function (a, b) {
      if (a.cycle_id !== b.cycle_id) {
        return a.cycle_id.localeCompare(b.cycle_id);
      }
      return compareRoomNo_(a, b);
    });

  return {
    selectedYear: selectedYear,
    availableYears: availableYears,
    monthlySummary: monthlySummary,
    residentsList: residentsList,
    residentHistory: residentHistory
  };
}

function handleUploadSlip_(payload) {
  var recordId = String(payload.record_id || '').trim();
  var cycleId = String(payload.cycle_id || '').trim();
  var imageBase64 = String(payload.imageBase64 || '').trim();
  var mimeType = String(payload.mimeType || 'image/jpeg').trim();

  if (!recordId || !cycleId || !imageBase64) {
    throw makeError_('INVALID_INPUT', 'ข้อมูลไม่ครบถ้วน กรุณาเลือกไฟล์รูปภาพสลิป');
  }

  // ตรวจสอบสถานะรอบบิล (หากปิดรอบบิลแล้วห้ามส่งสลิปใหม่)
  var cycle = findCycleById_(cycleId);
  if (!cycle) {
    throw makeError_('CYCLE_NOT_FOUND', 'ไม่พบรอบบิลที่ระบุ');
  }
  if (cycle.status === 'closed') {
    throw makeError_('CYCLE_CLOSED', 'รอบบิลนี้ปิดรับชำระแล้ว ไม่สามารถส่งสลิปใหม่ได้ กรุณาติดต่อผู้ดูแล');
  }

  // ค้นหาแถวใน Meter_Records
  var sheet = getSheetOrThrow_(API_SHEETS.RECORDS);
  var data = sheet.getDataRange().getValues();
  var headerMap = buildHeaderMap_(data[0]);
  var rowIndex = -1;

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][headerMap.record_id]).trim() === recordId) {
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex === -1) {
    throw makeError_('RECORD_NOT_FOUND', 'ไม่พบรายการบิลที่ระบุ');
  }

  var rowValues = data[rowIndex - 1];
  var rowCycleId = formatCycleIdValue_(rowValues[headerMap.cycle_id]);
  if (rowCycleId !== cycleId) {
    throw makeError_('CYCLE_MISMATCH', 'รหัสรอบบิลไม่ตรงกับรายการบิล');
  }

  var residentId = String(rowValues[headerMap.resident_id]).trim();
  var roomNo = String(rowValues[headerMap.room_no]).trim();

  // แปลง Base64 (ตัด prefix data:image/...;base64, หากติดมา)
  var cleanBase64 = imageBase64.indexOf(',') !== -1
    ? imageBase64.split(',')[1]
    : imageBase64;

  var bytes;
  try {
    bytes = Utilities.base64Decode(cleanBase64);
  } catch (decodeErr) {
    throw makeError_('INVALID_IMAGE', 'ไม่สามารถอ่านไฟล์ภาพสลิปได้ กรุณาลองเลือกภาพใหม่');
  }

  // ตรวจสอบขนาดไฟล์ (ไม่เกิน 8MB หลังบีบอัด)
  if (bytes.length > 8 * 1024 * 1024) {
    throw makeError_('FILE_TOO_LARGE', 'ขนาดภาพใหญ่เกินกำหนด กรุณาเลือกไฟล์ขนาดเล็กลง');
  }

  // เตรียมโฟลเดอร์ Google Drive: Samsara-Utility-Slips/{cycle_id}/
  var rootFolder = getOrCreateSlipRootFolder_();
  var cycleFolder = getOrCreateChildFolder_(rootFolder, cycleId);

  var safeRoom = roomNo.replace(/[^a-zA-Z0-9_-]/g, '');
  var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Bangkok', 'yyyyMMdd_HHmmss');
  var ext = mimeType === 'image/png' ? 'png' : 'jpg';
  var fileName = cycleId + '_' + (safeRoom || 'room') + '_' + residentId + '_' + timestamp + '.' + ext;

  var blob = Utilities.newBlob(bytes, mimeType || 'image/jpeg', fileName);
  var file = cycleFolder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  var fileId = file.getId();
  var slipUrl = 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1000';
  var nowIso = new Date().toISOString();

  // อัปเดตแถวใน Meter_Records
  sheet.getRange(rowIndex, headerMap.payment_status + 1).setNumberFormat('@').setValue('pending');
  sheet.getRange(rowIndex, headerMap.slip_url + 1).setNumberFormat('@').setValue(slipUrl);
  sheet.getRange(rowIndex, headerMap.slip_file_id + 1).setNumberFormat('@').setValue(fileId);
  sheet.getRange(rowIndex, headerMap.paid_at + 1).setNumberFormat('@').setValue(nowIso);
  sheet.getRange(rowIndex, headerMap.reject_reason + 1).setNumberFormat('@').setValue('');
  sheet.getRange(rowIndex, headerMap.updated_at + 1).setNumberFormat('@').setValue(nowIso);

  appendAuditLog_('UPLOAD_SLIP', recordId, 'แนบสลิปห้อง ' + roomNo + ' ไฟล์: ' + fileName);

  var updatedRow = sheet.getRange(rowIndex, 1, 1, data[0].length).getValues()[0];
  return {
    record: parseRecordRow_(updatedRow, headerMap)
  };
}

// ============================================================================
// Admin Handlers
// ============================================================================

function handleGetResidents_() {
  var residents = readAllResidents_();
  residents.sort(function (a, b) {
    if (a.status !== b.status) {
      return a.status === 'active' ? -1 : 1;
    }
    return compareRoomNo_(a, b);
  });
  return { residents: residents };
}

function handleAddResident_(payload) {
  var roomNo = String(payload.room_no || '').trim();
  var fullName = String(payload.full_name || '').trim();
  var moveInDate = String(payload.move_in_date || '').trim() || formatDateYmd_(new Date());
  var initialMeter = Number(payload.initial_meter);
  var note = String(payload.note || '').trim();
  var addToOpenCycle = Boolean(payload.add_to_open_cycle);

  if (!roomNo || !fullName) {
    throw makeError_('INVALID_INPUT', 'กรุณากรอกเลขห้องและชื่อ-สกุลผู้พักอาศัย');
  }
  if (!isFinite(initialMeter) || initialMeter < 0) {
    throw makeError_('INVALID_INPUT', 'เลขมิเตอร์เริ่มต้นต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
  }

  var sheet = getSheetOrThrow_(API_SHEETS.RESIDENTS);
  var existing = readAllResidents_();
  var nextId = generateNextResidentId_(existing);
  var nowIso = new Date().toISOString();

  var newRow = [
    nextId,
    roomNo,
    fullName,
    'active',
    moveInDate,
    '',
    initialMeter,
    note,
    nowIso
  ];

  var nextRowIndex = sheet.getLastRow() + 1;
  sheet.getRange(nextRowIndex, 1, 1, newRow.length).setValues([newRow]);
  sheet.getRange(nextRowIndex, 1, 1, 6).setNumberFormat('@');
  sheet.getRange(nextRowIndex, 8, 1, 2).setNumberFormat('@');

  var addedCycleId = '';
  if (addToOpenCycle) {
    var openCycles = readAllCycles_()
      .filter(function (c) { return c.status === 'open'; })
      .sort(function (a, b) { return b.cycle_id.localeCompare(a.cycle_id); });

    if (openCycles.length > 0) {
      var latestOpen = openCycles[0];
      var recordId = latestOpen.cycle_id + '_' + nextId;
      var recordsSheet = getSheetOrThrow_(API_SHEETS.RECORDS);
      var recRow = [
        recordId,
        latestOpen.cycle_id,
        nextId,
        roomNo,
        fullName,
        initialMeter,
        initialMeter,
        0,
        latestOpen.water_rate,
        0,
        latestOpen.water_rate,
        'unpaid',
        '',
        '',
        '',
        '',
        '',
        nowIso
      ];
      var recIdx = recordsSheet.getLastRow() + 1;
      recordsSheet.getRange(recIdx, 1, 1, recRow.length).setValues([recRow]);
      recordsSheet.getRange(recIdx, 1, 1, 5).setNumberFormat('@');
      recordsSheet.getRange(recIdx, 12, 1, 7).setNumberFormat('@');
      addedCycleId = latestOpen.cycle_id;
    }
  }

  appendAuditLog_(
    'ADD_RESIDENT',
    nextId,
    'เพิ่มผู้พักอาศัย ห้อง ' + roomNo + ' ' + fullName + ' (มิเตอร์เริ่มต้น ' + initialMeter + ')' +
      (addedCycleId ? ' และเพิ่มเข้าบิลรอบ ' + addedCycleId : '')
  );

  return {
    resident: {
      resident_id: nextId,
      room_no: roomNo,
      full_name: fullName,
      status: 'active',
      move_in_date: moveInDate,
      move_out_date: '',
      initial_meter: initialMeter,
      note: note,
      updated_at: nowIso
    },
    added_to_cycle_id: addedCycleId
  };
}

function handleMoveOutResident_(payload) {
  var residentId = String(payload.resident_id || '').trim();
  var moveOutDate = String(payload.move_out_date || '').trim() || formatDateYmd_(new Date());
  var note = String(payload.note || '').trim();

  if (!residentId) {
    throw makeError_('INVALID_INPUT', 'กรุณาระบุรหัสผู้พักอาศัย');
  }

  var sheet = getSheetOrThrow_(API_SHEETS.RESIDENTS);
  var data = sheet.getDataRange().getValues();
  var headerMap = buildHeaderMap_(data[0]);
  var rowIndex = -1;

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][headerMap.resident_id]).trim() === residentId) {
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex === -1) {
    throw makeError_('RESIDENT_NOT_FOUND', 'ไม่พบข้อมูลผู้พักอาศัยรหัส ' + residentId);
  }

  var nowIso = new Date().toISOString();
  var existingNote = String(data[rowIndex - 1][headerMap.note] || '').trim();
  var finalNote = note || existingNote;

  sheet.getRange(rowIndex, headerMap.status + 1).setNumberFormat('@').setValue('moved_out');
  sheet.getRange(rowIndex, headerMap.move_out_date + 1).setNumberFormat('@').setValue(moveOutDate);
  sheet.getRange(rowIndex, headerMap.note + 1).setNumberFormat('@').setValue(finalNote);
  sheet.getRange(rowIndex, headerMap.updated_at + 1).setNumberFormat('@').setValue(nowIso);

  var fullName = String(data[rowIndex - 1][headerMap.full_name]).trim();
  var roomNo = String(data[rowIndex - 1][headerMap.room_no]).trim();
  appendAuditLog_(
    'MOVE_OUT_RESIDENT',
    residentId,
    'แจ้งย้ายออก ห้อง ' + roomNo + ' ' + fullName + ' วันที่ ' + moveOutDate + (finalNote ? ' (' + finalNote + ')' : '')
  );

  var updatedRow = sheet.getRange(rowIndex, 1, 1, data[0].length).getValues()[0];
  return {
    resident: parseResidentRow_(updatedRow, headerMap)
  };
}

function handleUpdateResident_(payload) {
  var residentId = String(payload.resident_id || '').trim();
  var roomNo = String(payload.room_no || '').trim();
  var fullName = String(payload.full_name || '').trim();
  var note = payload.note !== undefined ? String(payload.note).trim() : null;
  var hasInitialMeter = payload.initial_meter !== undefined && payload.initial_meter !== '' && payload.initial_meter !== null;
  var initialMeter = hasInitialMeter ? Number(payload.initial_meter) : null;

  if (!residentId || !roomNo || !fullName) {
    throw makeError_('INVALID_INPUT', 'กรุณากรอกข้อมูลเลขห้องและชื่อ-สกุลให้ครบถ้วน');
  }
  if (hasInitialMeter && (!isFinite(initialMeter) || initialMeter < 0)) {
    throw makeError_('INVALID_INPUT', 'เลขมิเตอร์เริ่มต้นต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
  }

  var sheet = getSheetOrThrow_(API_SHEETS.RESIDENTS);
  var data = sheet.getDataRange().getValues();
  var headerMap = buildHeaderMap_(data[0]);
  var rowIndex = -1;

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][headerMap.resident_id]).trim() === residentId) {
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex === -1) {
    throw makeError_('RESIDENT_NOT_FOUND', 'ไม่พบข้อมูลผู้พักอาศัย');
  }

  var currentStatus = String(data[rowIndex - 1][headerMap.status]).trim();
  if (currentStatus !== 'active') {
    throw makeError_('RESIDENT_MOVED_OUT', 'ไม่สามารถแก้ไขข้อมูลผู้พักอาศัยที่ย้ายออกไปแล้ว');
  }

  var nowIso = new Date().toISOString();
  sheet.getRange(rowIndex, headerMap.room_no + 1).setNumberFormat('@').setValue(roomNo);
  sheet.getRange(rowIndex, headerMap.full_name + 1).setNumberFormat('@').setValue(fullName);
  if (hasInitialMeter) {
    sheet.getRange(rowIndex, headerMap.initial_meter + 1).setValue(initialMeter);
  }
  if (note !== null) {
    sheet.getRange(rowIndex, headerMap.note + 1).setNumberFormat('@').setValue(note);
  }
  sheet.getRange(rowIndex, headerMap.updated_at + 1).setNumberFormat('@').setValue(nowIso);

  appendAuditLog_(
    'UPDATE_RESIDENT',
    residentId,
    'แก้ไขข้อมูลผู้พักอาศัยเป็น ห้อง ' + roomNo + ' ' + fullName
  );

  var updatedRow = sheet.getRange(rowIndex, 1, 1, data[0].length).getValues()[0];
  return {
    resident: parseResidentRow_(updatedRow, headerMap)
  };
}

function handleSaveMeters_(payload) {
  var cycleId = String(payload.cycle_id || '').trim();
  var items = payload.items;

  if (!cycleId || !Array.isArray(items) || items.length === 0) {
    throw makeError_('INVALID_INPUT', 'ไม่พบข้อมูลเลขมิเตอร์ที่ต้องการบันทึก');
  }

  var cycle = findCycleById_(cycleId);
  if (!cycle) {
    throw makeError_('CYCLE_NOT_FOUND', 'ไม่พบรอบบิล ' + cycleId);
  }
  if (cycle.status === 'closed') {
    throw makeError_('CYCLE_CLOSED', 'รอบบิลนี้ปิดแล้ว กรุณาเปิดรอบบิลก่อนแก้ไขเลขมิเตอร์');
  }

  // สร้าง Map ขาเข้าพร้อมตรวจสอบความถูกต้องก่อนเขียนลงชีต
  var inputMap = {};
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var recId = String(item.record_id || '').trim();
    var currMeter = Number(item.curr_meter);
    var hasPrev = item.prev_meter !== undefined && item.prev_meter !== '' && item.prev_meter !== null;
    var prevMeter = hasPrev ? Number(item.prev_meter) : null;

    if (!recId) {
      throw makeError_('INVALID_INPUT', 'พบรายการที่ไม่มี record_id');
    }
    if (!isFinite(currMeter) || currMeter < 0) {
      throw makeError_('INVALID_METER_READING', 'เลขมิเตอร์หลังของรายการ ' + recId + ' ไม่ถูกต้อง');
    }
    if (hasPrev && (!isFinite(prevMeter) || prevMeter < 0)) {
      throw makeError_('INVALID_METER_READING', 'เลขมิเตอร์ก่อนของรายการ ' + recId + ' ไม่ถูกต้อง');
    }

    inputMap[recId] = {
      hasPrev: hasPrev,
      prev_meter: prevMeter,
      curr_meter: currMeter
    };
  }

  var sheet = getSheetOrThrow_(API_SHEETS.RECORDS);
  var data = sheet.getDataRange().getValues();
  var headerMap = buildHeaderMap_(data[0]);
  var nowIso = new Date().toISOString();

  var updatedCount = 0;
  var cycleGrandTotal = 0;
  var cycleTotalUnits = 0;

  // ตรวจสอบรอบแรกและคำนวณค่าใหม่บนหน่วยความจำทั้งหมด
  for (var r = 1; r < data.length; r++) {
    var rowCycleId = formatCycleIdValue_(data[r][headerMap.cycle_id]);
    if (rowCycleId !== cycleId) {
      continue;
    }

    var rowRecId = String(data[r][headerMap.record_id]).trim();
    var incoming = inputMap[rowRecId];

    if (incoming) {
      var effectivePrev = incoming.hasPrev ? incoming.prev_meter : Number(data[r][headerMap.prev_meter] || 0);
      var effectiveCurr = incoming.curr_meter;

      if (effectiveCurr < effectivePrev) {
        var roomLabel = String(data[r][headerMap.room_no]);
        var nameLabel = String(data[r][headerMap.name_snapshot]);
        throw makeError_(
          'INVALID_METER_READING',
          'ห้อง ' + roomLabel + ' (' + nameLabel + '): เลขมิเตอร์ใหม่ (' + effectiveCurr + ') น้อยกว่าเลขเดิม (' + effectivePrev + ')'
        );
      }

      var unitsUsed = effectiveCurr - effectivePrev;
      var waterCost = Number(cycle.water_rate);
      var electricCost = roundMoney_(unitsUsed * Number(cycle.electric_rate));
      var totalCost = roundMoney_(waterCost + electricCost);

      data[r][headerMap.prev_meter] = effectivePrev;
      data[r][headerMap.curr_meter] = effectiveCurr;
      data[r][headerMap.units_used] = unitsUsed;
      data[r][headerMap.water_cost] = waterCost;
      data[r][headerMap.electric_cost] = electricCost;
      data[r][headerMap.total_cost] = totalCost;
      data[r][headerMap.updated_at] = nowIso;

      updatedCount += 1;
    }

    cycleTotalUnits += Number(data[r][headerMap.units_used] || 0);
    cycleGrandTotal += Number(data[r][headerMap.total_cost] || 0);
  }

  if (updatedCount === 0) {
    throw makeError_('RECORD_NOT_FOUND', 'ไม่พบรายการบิลที่ตรงกับรอบบิล ' + cycleId);
  }

  // เขียนกลับทั้งตารางในครั้งเดียวเพื่อความเร็วและป้องกันข้อมูลไม่สอดคล้อง
  sheet.getRange(2, 1, data.length - 1, data[0].length).setValues(data.slice(1));

  appendAuditLog_(
    'SAVE_METERS',
    cycleId,
    'บันทึกเลขมิเตอร์ ' + updatedCount + ' ห้อง | หน่วยรวม ' + cycleTotalUnits + ' | ยอดสุทธิ ' + roundMoney_(cycleGrandTotal) + ' บาท'
  );

  var refreshed = readAllRecords_()
    .filter(function (rec) { return rec.cycle_id === cycleId; })
    .sort(compareRoomNo_);

  return {
    records: refreshed,
    updated_count: updatedCount
  };
}

function handleVerifyPayment_(payload) {
  var recordId = String(payload.record_id || '').trim();
  var decision = String(payload.decision || '').trim();
  var rejectReason = String(payload.reject_reason || '').trim();
  var isManual = Boolean(payload.is_manual);

  if (!recordId || (decision !== 'paid' && decision !== 'unpaid')) {
    throw makeError_('INVALID_INPUT', 'กรุณาระบุ record_id และ decision (paid หรือ unpaid)');
  }

  var sheet = getSheetOrThrow_(API_SHEETS.RECORDS);
  var data = sheet.getDataRange().getValues();
  var headerMap = buildHeaderMap_(data[0]);
  var rowIndex = -1;

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][headerMap.record_id]).trim() === recordId) {
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex === -1) {
    throw makeError_('RECORD_NOT_FOUND', 'ไม่พบรายการบิลที่ระบุ');
  }

  var nowIso = new Date().toISOString();
  var existingPaidAt = String(data[rowIndex - 1][headerMap.paid_at] || '').trim();
  var roomNo = String(data[rowIndex - 1][headerMap.room_no]).trim();
  var nameSnapshot = String(data[rowIndex - 1][headerMap.name_snapshot]).trim();

  if (decision === 'paid') {
    sheet.getRange(rowIndex, headerMap.payment_status + 1).setNumberFormat('@').setValue('paid');
    sheet.getRange(rowIndex, headerMap.verified_at + 1).setNumberFormat('@').setValue(nowIso);
    sheet.getRange(rowIndex, headerMap.reject_reason + 1).setNumberFormat('@').setValue('');
    if (!existingPaidAt) {
      sheet.getRange(rowIndex, headerMap.paid_at + 1).setNumberFormat('@').setValue(nowIso);
    }
    sheet.getRange(rowIndex, headerMap.updated_at + 1).setNumberFormat('@').setValue(nowIso);

    appendAuditLog_(
      isManual ? 'MARK_PAID_MANUAL' : 'APPROVE_SLIP',
      recordId,
      (isManual ? 'บันทึกชำระเงินสด/ด้วยตนเอง ' : 'อนุมัติสลิป ') + 'ห้อง ' + roomNo + ' ' + nameSnapshot
    );
  } else {
    if (!rejectReason && !isManual) {
      rejectReason = 'กรุณาตรวจสอบยอดโอนและอัปโหลดสลิปใหม่อีกครั้ง';
    }
    sheet.getRange(rowIndex, headerMap.payment_status + 1).setNumberFormat('@').setValue('unpaid');
    sheet.getRange(rowIndex, headerMap.verified_at + 1).setNumberFormat('@').setValue('');
    sheet.getRange(rowIndex, headerMap.reject_reason + 1).setNumberFormat('@').setValue(rejectReason);
    sheet.getRange(rowIndex, headerMap.updated_at + 1).setNumberFormat('@').setValue(nowIso);

    appendAuditLog_(
      'REJECT_SLIP',
      recordId,
      'ตีกลับ/ปรับสถานะรอชำระ ห้อง ' + roomNo + ' ' + nameSnapshot + (rejectReason ? ' เหตุผล: ' + rejectReason : '')
    );
  }

  var updatedRow = sheet.getRange(rowIndex, 1, 1, data[0].length).getValues()[0];
  return {
    record: parseRecordRow_(updatedRow, headerMap)
  };
}

function handleCreateCycle_(payload) {
  var cycleId = String(payload.cycle_id || '').trim();
  var yearTh = Number(payload.year_th);
  var monthLabel = String(payload.month_label || '').trim();
  var dueDate = String(payload.due_date || '').trim();
  var waterRate = Number(payload.water_rate);
  var electricRate = Number(payload.electric_rate);

  if (!/^\d{4}-\d{2}$/.test(cycleId)) {
    throw makeError_('INVALID_INPUT', 'รหัสรอบบิลต้องอยู่ในรูปแบบ YYYY-MM เช่น 2026-12');
  }
  if (!yearTh || !monthLabel || !dueDate) {
    throw makeError_('INVALID_INPUT', 'กรุณากรอกปี พ.ศ. ชื่อเดือน และวันครบกำหนดชำระให้ครบถ้วน');
  }
  if (!isFinite(waterRate) || waterRate < 0 || !isFinite(electricRate) || electricRate < 0) {
    throw makeError_('INVALID_INPUT', 'อัตราค่าน้ำและค่าไฟต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
  }

  if (findCycleById_(cycleId)) {
    throw makeError_('CYCLE_ALREADY_EXISTS', 'มีรอบบิล ' + cycleId + ' อยู่ในระบบแล้ว');
  }

  var activeResidents = readAllResidents_()
    .filter(function (r) { return r.status === 'active'; })
    .sort(compareRoomNo_);

  if (activeResidents.length === 0) {
    throw makeError_('NO_ACTIVE_RESIDENTS', 'ไม่พบรายชื่อครูที่พักอาศัยอยู่ปัจจุบัน (active)');
  }

  // หา curr_meter จากรอบบิลล่าสุดของแต่ละ resident_id
  var allRecords = readAllRecords_();
  var latestMeterByResident = {};

  allRecords.forEach(function (rec) {
    var prevEntry = latestMeterByResident[rec.resident_id];
    if (!prevEntry || rec.cycle_id.localeCompare(prevEntry.cycle_id) > 0) {
      latestMeterByResident[rec.resident_id] = {
        cycle_id: rec.cycle_id,
        curr_meter: rec.curr_meter
      };
    }
  });

  var nowIso = new Date().toISOString();
  var cyclesSheet = getSheetOrThrow_(API_SHEETS.CYCLES);
  var newCycleRow = [
    cycleId,
    yearTh,
    monthLabel,
    dueDate,
    waterRate,
    electricRate,
    'open',
    nowIso
  ];
  var cycleRowIdx = cyclesSheet.getLastRow() + 1;
  cyclesSheet.getRange(cycleRowIdx, 1, 1, newCycleRow.length).setValues([newCycleRow]);
  cyclesSheet.getRange(cycleRowIdx, 1).setNumberFormat('@');
  cyclesSheet.getRange(cycleRowIdx, 3, 1, 2).setNumberFormat('@');
  cyclesSheet.getRange(cycleRowIdx, 7, 1, 2).setNumberFormat('@');

  // สร้างแถว Meter_Records พร้อมล็อก name_snapshot และ room_no
  var newRecordRows = activeResidents.map(function (res) {
    var prevMeter = latestMeterByResident[res.resident_id] !== undefined
      ? Number(latestMeterByResident[res.resident_id].curr_meter)
      : Number(res.initial_meter || 0);

    return [
      cycleId + '_' + res.resident_id,
      cycleId,
      res.resident_id,
      res.room_no,
      res.full_name,
      prevMeter,
      prevMeter,
      0,
      waterRate,
      0,
      waterRate,
      'unpaid',
      '',
      '',
      '',
      '',
      '',
      nowIso
    ];
  });

  var recordsSheet = getSheetOrThrow_(API_SHEETS.RECORDS);
  var startRow = recordsSheet.getLastRow() + 1;
  recordsSheet.getRange(startRow, 1, newRecordRows.length, newRecordRows[0].length).setValues(newRecordRows);
  recordsSheet.getRange(startRow, 1, newRecordRows.length, 5).setNumberFormat('@');
  recordsSheet.getRange(startRow, 12, newRecordRows.length, 7).setNumberFormat('@');

  appendAuditLog_(
    'CREATE_CYCLE',
    cycleId,
    'สร้างรอบบิล ' + monthLabel + ' (' + activeResidents.length + ' ห้อง, น้ำ ' + waterRate + ', ไฟ ' + electricRate + '/หน่วย)'
  );

  var createdRecords = readAllRecords_()
    .filter(function (rec) { return rec.cycle_id === cycleId; })
    .sort(compareRoomNo_);

  return {
    cycle: {
      cycle_id: cycleId,
      year_th: yearTh,
      month_label: monthLabel,
      due_date: dueDate,
      water_rate: waterRate,
      electric_rate: electricRate,
      status: 'open',
      created_at: nowIso
    },
    records: createdRecords
  };
}

function handleUpdateCycle_(payload) {
  var cycleId = String(payload.cycle_id || '').trim();
  if (!cycleId) {
    throw makeError_('INVALID_INPUT', 'กรุณาระบุ cycle_id');
  }

  var cyclesSheet = getSheetOrThrow_(API_SHEETS.CYCLES);
  var data = cyclesSheet.getDataRange().getValues();
  var headerMap = buildHeaderMap_(data[0]);
  var rowIndex = -1;

  for (var i = 1; i < data.length; i++) {
    if (formatCycleIdValue_(data[i][headerMap.cycle_id]) === cycleId) {
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex === -1) {
    throw makeError_('CYCLE_NOT_FOUND', 'ไม่พบรอบบิล ' + cycleId);
  }

  var existingRow = data[rowIndex - 1];
  var oldWaterRate = Number(existingRow[headerMap.water_rate]);
  var oldElectricRate = Number(existingRow[headerMap.electric_rate]);

  var newDueDate = payload.due_date !== undefined ? String(payload.due_date).trim() : String(existingRow[headerMap.due_date]).trim();
  var newWaterRate = payload.water_rate !== undefined && payload.water_rate !== '' ? Number(payload.water_rate) : oldWaterRate;
  var newElectricRate = payload.electric_rate !== undefined && payload.electric_rate !== '' ? Number(payload.electric_rate) : oldElectricRate;
  var newStatus = payload.status !== undefined ? String(payload.status).trim() : String(existingRow[headerMap.status]).trim();

  if (!newDueDate) {
    throw makeError_('INVALID_INPUT', 'กรุณาระบุวันครบกำหนดชำระ');
  }
  if (!isFinite(newWaterRate) || newWaterRate < 0 || !isFinite(newElectricRate) || newElectricRate < 0) {
    throw makeError_('INVALID_INPUT', 'อัตราค่าน้ำและค่าไฟต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
  }
  if (newStatus !== 'open' && newStatus !== 'closed') {
    throw makeError_('INVALID_INPUT', 'สถานะรอบบิลต้องเป็น open หรือ closed');
  }

  cyclesSheet.getRange(rowIndex, headerMap.due_date + 1).setNumberFormat('@').setValue(newDueDate);
  cyclesSheet.getRange(rowIndex, headerMap.water_rate + 1).setValue(newWaterRate);
  cyclesSheet.getRange(rowIndex, headerMap.electric_rate + 1).setValue(newElectricRate);
  cyclesSheet.getRange(rowIndex, headerMap.status + 1).setNumberFormat('@').setValue(newStatus);

  // หากมีการเปลี่ยนเรทค่าน้ำหรือค่าไฟ ให้คำนวณยอดใหม่ทุกห้องในรอบบิลนี้
  var rateChanged = (newWaterRate !== oldWaterRate) || (newElectricRate !== oldElectricRate);
  if (rateChanged) {
    var recordsSheet = getSheetOrThrow_(API_SHEETS.RECORDS);
    var recData = recordsSheet.getDataRange().getValues();
    var recHeader = buildHeaderMap_(recData[0]);
    var nowIso = new Date().toISOString();
    var anyModified = false;

    for (var r = 1; r < recData.length; r++) {
      if (formatCycleIdValue_(recData[r][recHeader.cycle_id]) === cycleId) {
        var units = Number(recData[r][recHeader.units_used] || 0);
        var elecCost = roundMoney_(units * newElectricRate);
        var totalCost = roundMoney_(newWaterRate + elecCost);

        recData[r][recHeader.water_cost] = newWaterRate;
        recData[r][recHeader.electric_cost] = elecCost;
        recData[r][recHeader.total_cost] = totalCost;
        recData[r][recHeader.updated_at] = nowIso;
        anyModified = true;
      }
    }

    if (anyModified) {
      recordsSheet.getRange(2, 1, recData.length - 1, recData[0].length).setValues(recData.slice(1));
    }
  }

  appendAuditLog_(
    'UPDATE_CYCLE',
    cycleId,
    'อัปเดตรอบบิล: กำหนดชำระ=' + newDueDate + ', น้ำ=' + newWaterRate + ', ไฟ=' + newElectricRate + ', สถานะ=' + newStatus
  );

  var updatedCycleRow = cyclesSheet.getRange(rowIndex, 1, 1, data[0].length).getValues()[0];
  var updatedRecords = readAllRecords_()
    .filter(function (rec) { return rec.cycle_id === cycleId; })
    .sort(compareRoomNo_);

  return {
    cycle: parseCycleRow_(updatedCycleRow, headerMap),
    records: updatedRecords
  };
}

function handleUpdateSettings_(payload) {
  var incomingSettings = payload.settings || {};
  var newPin = String(payload.new_pin || '').trim();

  var sheet = getSheetOrThrow_(API_SHEETS.SETTINGS);
  var data = sheet.getDataRange().getValues();
  var keyRowMap = {};

  for (var i = 1; i < data.length; i++) {
    var k = String(data[i][0] || '').trim();
    if (k) {
      keyRowMap[k] = i + 1;
    }
  }

  var changedKeys = [];
  for (var j = 0; j < API_ALLOWED_SETTING_KEYS.length; j++) {
    var key = API_ALLOWED_SETTING_KEYS[j];
    if (incomingSettings[key] !== undefined && incomingSettings[key] !== null) {
      var valStr = String(incomingSettings[key]).trim();
      if ((key === 'default_water_rate' || key === 'default_electric_rate') && (!isFinite(Number(valStr)) || Number(valStr) < 0)) {
        throw makeError_('INVALID_INPUT', 'ค่าเริ่มต้นของ ' + key + ' ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
      }
      if (keyRowMap[key]) {
        sheet.getRange(keyRowMap[key], 2).setNumberFormat('@').setValue(valStr);
      } else {
        var newIdx = sheet.getLastRow() + 1;
        sheet.getRange(newIdx, 1, 1, 3).setNumberFormat('@').setValues([[key, valStr, '']]);
      }
      changedKeys.push(key);
    }
  }

  if (changedKeys.length > 0) {
    appendAuditLog_('UPDATE_SETTINGS', 'Settings', 'อัปเดตการตั้งค่า: ' + changedKeys.join(', '));
  }

  var pinChanged = false;
  if (newPin) {
    if (newPin.length < 4 || newPin.length > 12) {
      throw makeError_('INVALID_INPUT', 'รหัส PIN ใหม่ต้องมีความยาว 4 ถึง 12 ตัวอักษร');
    }
    PropertiesService.getScriptProperties().setProperty('ADMIN_PIN', newPin);
    appendAuditLog_('CHANGE_PIN', 'ADMIN_PIN', 'เปลี่ยนรหัสผ่านผู้ดูแลระบบเรียบร้อย');
    pinChanged = true;
  }

  return {
    settings: readSettingsMap_(),
    pin_changed: pinChanged
  };
}

// ============================================================================
// Data Access & Parsers
// ============================================================================

function getSheetOrThrow_(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw makeError_('SHEET_NOT_FOUND', 'ไม่พบแท็บ ' + sheetName + ' กรุณารัน setupDatabase() ใน setup.gs ก่อน');
  }
  return sheet;
}

function readSettingsMap_() {
  var sheet = getSheetOrThrow_(API_SHEETS.SETTINGS);
  var data = sheet.getDataRange().getDisplayValues();
  var map = {
    house_name: 'บ้านพักครู (สามสาระ)',
    bank_name: '',
    bank_account_no: '',
    bank_account_name: '',
    promptpay_id: '',
    default_water_rate: 75,
    default_electric_rate: 7,
    slip_folder_id: ''
  };

  for (var i = 1; i < data.length; i++) {
    var key = String(data[i][0] || '').trim();
    var val = String(data[i][1] || '').trim();
    if (!key) continue;
    if (key === 'default_water_rate' || key === 'default_electric_rate') {
      map[key] = Number(val || 0);
    } else {
      map[key] = val;
    }
  }
  return map;
}

function readAllResidents_() {
  var sheet = getSheetOrThrow_(API_SHEETS.RESIDENTS);
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  var headerMap = buildHeaderMap_(data[0]);
  var list = [];
  for (var i = 1; i < data.length; i++) {
    var id = String(data[i][headerMap.resident_id] || '').trim();
    if (!id) continue;
    list.push(parseResidentRow_(data[i], headerMap));
  }
  return list;
}

function parseResidentRow_(row, headerMap) {
  return {
    resident_id: String(row[headerMap.resident_id] || '').trim(),
    room_no: String(row[headerMap.room_no] || '').trim(),
    full_name: String(row[headerMap.full_name] || '').trim(),
    status: String(row[headerMap.status] || 'active').trim(),
    move_in_date: formatDateField_(row[headerMap.move_in_date]),
    move_out_date: formatDateField_(row[headerMap.move_out_date]),
    initial_meter: Number(row[headerMap.initial_meter] || 0),
    note: String(row[headerMap.note] || '').trim(),
    updated_at: formatIsoField_(row[headerMap.updated_at])
  };
}

function readAllCycles_() {
  var sheet = getSheetOrThrow_(API_SHEETS.CYCLES);
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  var headerMap = buildHeaderMap_(data[0]);
  var list = [];
  for (var i = 1; i < data.length; i++) {
    var cycleId = formatCycleIdValue_(data[i][headerMap.cycle_id]);
    if (!cycleId) continue;
    list.push(parseCycleRow_(data[i], headerMap));
  }
  return list;
}

function parseCycleRow_(row, headerMap) {
  return {
    cycle_id: formatCycleIdValue_(row[headerMap.cycle_id]),
    year_th: Number(row[headerMap.year_th] || 0),
    month_label: String(row[headerMap.month_label] || '').trim(),
    due_date: String(row[headerMap.due_date] || '').trim(),
    water_rate: Number(row[headerMap.water_rate] || 0),
    electric_rate: Number(row[headerMap.electric_rate] || 0),
    status: String(row[headerMap.status] || 'open').trim(),
    created_at: formatIsoField_(row[headerMap.created_at])
  };
}

function findCycleById_(cycleId) {
  var cycles = readAllCycles_();
  for (var i = 0; i < cycles.length; i++) {
    if (cycles[i].cycle_id === cycleId) {
      return cycles[i];
    }
  }
  return null;
}

function readAllRecords_() {
  var sheet = getSheetOrThrow_(API_SHEETS.RECORDS);
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  var headerMap = buildHeaderMap_(data[0]);
  var list = [];
  for (var i = 1; i < data.length; i++) {
    var recId = String(data[i][headerMap.record_id] || '').trim();
    if (!recId) continue;
    list.push(parseRecordRow_(data[i], headerMap));
  }
  return list;
}

function parseRecordRow_(row, headerMap) {
  var slipFileId = String(row[headerMap.slip_file_id] || '').trim();
  var slipUrl = String(row[headerMap.slip_url] || '').trim();
  if (!slipUrl && slipFileId) {
    slipUrl = 'https://drive.google.com/thumbnail?id=' + slipFileId + '&sz=w1000';
  }
  var slipViewUrl = slipFileId ? ('https://drive.google.com/file/d/' + slipFileId + '/view') : slipUrl;

  return {
    record_id: String(row[headerMap.record_id] || '').trim(),
    cycle_id: formatCycleIdValue_(row[headerMap.cycle_id]),
    resident_id: String(row[headerMap.resident_id] || '').trim(),
    room_no: String(row[headerMap.room_no] || '').trim(),
    name_snapshot: String(row[headerMap.name_snapshot] || '').trim(),
    prev_meter: Number(row[headerMap.prev_meter] || 0),
    curr_meter: Number(row[headerMap.curr_meter] || 0),
    units_used: Number(row[headerMap.units_used] || 0),
    water_cost: Number(row[headerMap.water_cost] || 0),
    electric_cost: Number(row[headerMap.electric_cost] || 0),
    total_cost: Number(row[headerMap.total_cost] || 0),
    payment_status: String(row[headerMap.payment_status] || 'unpaid').trim(),
    slip_url: slipUrl,
    slip_file_id: slipFileId,
    slip_view_url: slipViewUrl,
    paid_at: formatIsoField_(row[headerMap.paid_at]),
    verified_at: formatIsoField_(row[headerMap.verified_at]),
    reject_reason: String(row[headerMap.reject_reason] || '').trim(),
    updated_at: formatIsoField_(row[headerMap.updated_at])
  };
}

function appendAuditLog_(action, targetId, detail) {
  var sheet = getSheetOrThrow_(API_SHEETS.LOGS);
  var nowIso = new Date().toISOString();
  var nextRow = sheet.getLastRow() + 1;
  sheet.getRange(nextRow, 1, 1, 4).setNumberFormat('@').setValues([[
    nowIso,
    String(action || ''),
    String(targetId || ''),
    String(detail || '')
  ]]);
}

// ============================================================================
// Security, Drive & Formatting Utilities
// ============================================================================

function isValidAdminPin_(providedPin) {
  var storedPin = PropertiesService.getScriptProperties().getProperty('ADMIN_PIN');
  if (!storedPin) {
    storedPin = '1234';
  }
  return String(providedPin || '').trim() === String(storedPin).trim();
}

function getOrCreateSlipRootFolder_() {
  var settings = readSettingsMap_();
  var folderId = settings.slip_folder_id;

  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (e) {
      // โฟลเดอร์อาจถูกลบหรือเปลี่ยนสิทธิ์ ให้ค้นหา/สร้างใหม่
    }
  }

  var folders = DriveApp.getFoldersByName(API_DEFAULT_FOLDER_NAME);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(API_DEFAULT_FOLDER_NAME);
  var newId = folder.getId();

  // บันทึก Folder ID กลับลง Settings
  var settingsSheet = getSheetOrThrow_(API_SHEETS.SETTINGS);
  var rows = settingsSheet.getDataRange().getValues();
  var found = false;
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === 'slip_folder_id') {
      settingsSheet.getRange(i + 1, 2).setNumberFormat('@').setValue(newId);
      found = true;
      break;
    }
  }
  if (!found) {
    var nextRow = settingsSheet.getLastRow() + 1;
    settingsSheet.getRange(nextRow, 1, 1, 3).setNumberFormat('@').setValues([
      ['slip_folder_id', newId, 'Google Drive Folder ID ของ Samsara-Utility-Slips']
    ]);
  }
  return folder;
}

function getOrCreateChildFolder_(parentFolder, childName) {
  var iter = parentFolder.getFoldersByName(childName);
  if (iter.hasNext()) {
    return iter.next();
  }
  return parentFolder.createFolder(childName);
}

function generateNextResidentId_(residents) {
  var maxNum = 0;
  for (var i = 0; i < residents.length; i++) {
    var match = String(residents[i].resident_id || '').match(/RES-(\d+)/i);
    if (match) {
      var n = parseInt(match[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  var next = maxNum + 1;
  var padded = String(next);
  while (padded.length < 3) {
    padded = '0' + padded;
  }
  return 'RES-' + padded;
}

function buildHeaderMap_(headersRow) {
  var map = {};
  for (var i = 0; i < headersRow.length; i++) {
    var key = String(headersRow[i] || '').trim();
    if (key) map[key] = i;
  }
  return map;
}

function formatCycleIdValue_(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone() || 'Asia/Bangkok', 'yyyy-MM');
  }
  return String(val || '').trim();
}

function formatDateField_(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone() || 'Asia/Bangkok', 'yyyy-MM-dd');
  }
  return String(val || '').trim();
}

function formatIsoField_(val) {
  if (val instanceof Date) {
    return val.toISOString();
  }
  return String(val || '').trim();
}

function formatDateYmd_(dateObj) {
  return Utilities.formatDate(dateObj, Session.getScriptTimeZone() || 'Asia/Bangkok', 'yyyy-MM-dd');
}

function compareRoomNo_(a, b) {
  var roomA = String(a.room_no || '');
  var roomB = String(b.room_no || '');
  return roomA.localeCompare(roomB, 'th', { numeric: true, sensitivity: 'base' });
}

function roundMoney_(num) {
  return Math.round((Number(num) + Number.EPSILON) * 100) / 100;
}

function makeError_(code, message) {
  var err = new Error(message);
  err.code = code;
  return err;
}

function apiSuccess_(data) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, data: data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function apiError_(errorCode, message) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, error: errorCode, message: message }))
    .setMimeType(ContentService.MimeType.JSON);
}
