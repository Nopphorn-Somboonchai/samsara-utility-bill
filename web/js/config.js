/**
 * ============================================================================
 * Samsara Utility Bill — Frontend Configuration & Mock Seed Data (config.js)
 * ============================================================================
 * วิธีเชื่อมต่อกับ Backend จริง:
 *   นำ Web App URL ที่ได้จากการ Deploy Google Apps Script (ลงท้ายด้วย /exec)
 *   มาวางในค่า GAS_WEB_APP_URL ด้านล่างนี้
 *   หากปล่อยค่าว่างไว้ ระบบจะเปิดโหมดข้อมูลจำลอง (Mock Mode) อัตโนมัติเพื่อให้พรีวิวได้ทันที
 * ============================================================================
 */

(function (global) {
  'use strict';

  const SamsaraApp = (global.SamsaraApp = global.SamsaraApp || {});

  const CONFIG = {
    GAS_WEB_APP_URL: 'https://script.google.com/macros/s/AKfycbwkZ9TI_APDt7SfRFkjdyYVgWdu63CLQE0odJXDXAoxkVoa9QZhkBs9COwlKNpMJj-3/exec',
    APP_TITLE: 'ระบบจดและติดตามค่าน้ำ ค่าไฟ บ้านพักครู (สามสาระ)',
    ADMIN_SESSION_KEY: 'samsara_admin_pin_session',
    MOCK_STORAGE_KEY: 'samsara_utility_mock_db_v1',
    SLIP_MAX_WIDTH: 1000,
    SLIP_JPEG_QUALITY: 0.75,
    REQUEST_TIMEOUT_MS: 25000
  };

  /**
   * ตรวจสอบว่าระบบควรทำงานในโหมดข้อมูลจำลองหรือไม่
   */
  function isMockMode() {
    const url = String(CONFIG.GAS_WEB_APP_URL || '').trim();
    return !url || url.includes('YOUR_DEPLOYMENT_ID');
  }

  const THAI_MONTHS = [
    { num: '01', label: 'มกราคม', short: 'ม.ค.' },
    { num: '02', label: 'กุมภาพันธ์', short: 'ก.พ.' },
    { num: '03', label: 'มีนาคม', short: 'มี.ค.' },
    { num: '04', label: 'เมษายน', short: 'เม.ย.' },
    { num: '05', label: 'พฤษภาคม', short: 'พ.ค.' },
    { num: '06', label: 'มิถุนายน', short: 'มิ.ย.' },
    { num: '07', label: 'กรกฎาคม', short: 'ก.ค.' },
    { num: '08', label: 'สิงหาคม', short: 'ส.ค.' },
    { num: '09', label: 'กันยายน', short: 'ก.ย.' },
    { num: '10', label: 'ตุลาคม', short: 'ต.ค.' },
    { num: '11', label: 'พฤศจิกายน', short: 'พ.ย.' },
    { num: '12', label: 'ธันวาคม', short: 'ธ.ค.' }
  ];

  /**
   * สร้างฐานข้อมูลจำลองเริ่มต้นสำหรับพรีวิวหน้าเว็บทันที
   * รอบบิล 2026-11 ใช้ข้อมูลจริงทั้ง 9 ห้องตรงตามสเปก (ยอดรวม 3,083 บาท)
   */
  function createInitialMockDb() {
    const nowIso = '2026-11-25T08:00:00.000Z';

    const residents = [
      { resident_id: 'RES-001', room_no: '1', full_name: 'นางสาวรุจิรางค์ งามเมือง', status: 'active', move_in_date: '2026-10-01', move_out_date: '', initial_meter: 3796, note: '', updated_at: nowIso },
      { resident_id: 'RES-002', room_no: '2', full_name: 'นางสาวบุษบาบัณ กันนิกา', status: 'active', move_in_date: '2026-10-01', move_out_date: '', initial_meter: 5401, note: '', updated_at: nowIso },
      { resident_id: 'RES-003', room_no: '3', full_name: 'นายนพพร สมบูรณ์ชัย', status: 'active', move_in_date: '2026-10-01', move_out_date: '', initial_meter: 4652, note: 'ผู้ดูแลบ้านพัก', updated_at: nowIso },
      { resident_id: 'RES-004', room_no: '4', full_name: 'นายทศพล แก้วสุยะ', status: 'active', move_in_date: '2026-10-01', move_out_date: '', initial_meter: 423, note: '', updated_at: nowIso },
      { resident_id: 'RES-005', room_no: '5', full_name: 'นางสาวโสธิดา สุอุดมสินโรจน์', status: 'active', move_in_date: '2026-10-01', move_out_date: '', initial_meter: 7718, note: '', updated_at: nowIso },
      { resident_id: 'RES-006', room_no: '6', full_name: 'นางสาวเมรินทร์ สิทธิบุญมี', status: 'active', move_in_date: '2026-10-01', move_out_date: '', initial_meter: 8982, note: '', updated_at: nowIso },
      { resident_id: 'RES-007', room_no: '7', full_name: 'นางสาวอัมพร กลิ่นรสทิพย์', status: 'active', move_in_date: '2026-10-01', move_out_date: '', initial_meter: 4581, note: '', updated_at: nowIso },
      { resident_id: 'RES-008', room_no: '8', full_name: 'นางสาวเบญจวรรณ พลับพลึงพนา', status: 'active', move_in_date: '2026-10-01', move_out_date: '', initial_meter: 3186, note: '', updated_at: nowIso },
      { resident_id: 'RES-009', room_no: '9', full_name: 'นางสาวณัฐวดี เขียวภูมิชัย', status: 'active', move_in_date: '2026-10-01', move_out_date: '', initial_meter: 3588, note: '', updated_at: nowIso }
    ];

    const cycles = [
      {
        cycle_id: '2026-11',
        year_th: 2569,
        month_label: 'พฤศจิกายน 2569',
        due_date: '28 พฤศจิกายน 2569',
        water_rate: 75,
        electric_rate: 7,
        status: 'open',
        created_at: '2026-11-24T09:00:00.000Z'
      },
      {
        cycle_id: '2026-10',
        year_th: 2569,
        month_label: 'ตุลาคม 2569',
        due_date: '28 ตุลาคม 2569',
        water_rate: 75,
        electric_rate: 7,
        status: 'closed',
        created_at: '2026-10-24T09:00:00.000Z'
      }
    ];

    const novSpecs = [
      { id: 'RES-001', room: '1', name: 'นางสาวรุจิรางค์ งามเมือง', prev: 3834, curr: 3876, status: 'unpaid' },
      { id: 'RES-002', room: '2', name: 'นางสาวบุษบาบัณ กันนิกา', prev: 5455, curr: 5516, status: 'unpaid' },
      { id: 'RES-003', room: '3', name: 'นายนพพร สมบูรณ์ชัย', prev: 4710, curr: 4772, status: 'paid' },
      { id: 'RES-004', room: '4', name: 'นายทศพล แก้วสุยะ', prev: 465, curr: 510, status: 'unpaid' },
      { id: 'RES-005', room: '5', name: 'นางสาวโสธิดา สุอุดมสินโรจน์', prev: 7730, curr: 7730, status: 'unpaid' },
      { id: 'RES-006', room: '6', name: 'นางสาวเมรินทร์ สิทธิบุญมี', prev: 9066, curr: 9158, status: 'unpaid' },
      { id: 'RES-007', room: '7', name: 'นางสาวอัมพร กลิ่นรสทิพย์', prev: 4606, curr: 4626, status: 'unpaid' },
      { id: 'RES-008', room: '8', name: 'นางสาวเบญจวรรณ พลับพลึงพนา', prev: 3211, curr: 3233, status: 'unpaid' },
      { id: 'RES-009', room: '9', name: 'นางสาวณัฐวดี เขียวภูมิชัย', prev: 3602, curr: 3602, status: 'unpaid' }
    ];

    const octRecords = residents.map((res, idx) => {
      const novCurrPrev = novSpecs[idx].prev;
      const prev = res.initial_meter;
      const curr = novCurrPrev;
      const units = curr - prev;
      const water = 75;
      const elec = units * 7;
      return {
        record_id: `2026-10_${res.resident_id}`,
        cycle_id: '2026-10',
        resident_id: res.resident_id,
        room_no: res.room_no,
        name_snapshot: res.full_name,
        prev_meter: prev,
        curr_meter: curr,
        units_used: units,
        water_cost: water,
        electric_cost: elec,
        total_cost: water + elec,
        payment_status: 'paid',
        slip_url: '',
        slip_file_id: '',
        slip_view_url: '',
        paid_at: '2026-10-27T10:15:00.000Z',
        verified_at: '2026-10-27T14:30:00.000Z',
        reject_reason: '',
        updated_at: '2026-10-27T14:30:00.000Z'
      };
    });

    const novRecords = novSpecs.map((item) => {
      const units = item.curr - item.prev;
      const water = 75;
      const elec = units * 7;
      return {
        record_id: `2026-11_${item.id}`,
        cycle_id: '2026-11',
        resident_id: item.id,
        room_no: item.room,
        name_snapshot: item.name,
        prev_meter: item.prev,
        curr_meter: item.curr,
        units_used: units,
        water_cost: water,
        electric_cost: elec,
        total_cost: water + elec,
        payment_status: item.status,
        slip_url: '',
        slip_file_id: '',
        slip_view_url: '',
        paid_at: item.status === 'paid' ? '2026-11-25T07:45:00.000Z' : '',
        verified_at: item.status === 'paid' ? '2026-11-25T07:50:00.000Z' : '',
        reject_reason: '',
        updated_at: nowIso
      };
    });

    return {
      adminPin: '1234',
      settings: {
        house_name: 'บ้านพักครู (สามสาระ)',
        bank_name: 'ธนาคารกรุงไทย',
        bank_account_no: '8540466694',
        bank_account_name: 'ครูนพพร สมบูรณ์ชัย',
        promptpay_id: '',
        default_water_rate: 75,
        default_electric_rate: 7,
        slip_folder_id: 'MOCK_DRIVE_FOLDER'
      },
      residents,
      cycles,
      records: [...octRecords, ...novRecords],
      auditLogs: [
        {
          timestamp: nowIso,
          action: 'SETUP_DATABASE',
          target_id: '2026-11',
          detail: 'ข้อมูลพรีวิวเริ่มต้น (พฤศจิกายน 2569 รวม 3,083 บาท)'
        }
      ]
    };
  }

  SamsaraApp.CONFIG = CONFIG;
  SamsaraApp.THAI_MONTHS = THAI_MONTHS;
  SamsaraApp.isMockMode = isMockMode;
  SamsaraApp.createInitialMockDb = createInitialMockDb;
})(typeof window !== 'undefined' ? window : globalThis);
