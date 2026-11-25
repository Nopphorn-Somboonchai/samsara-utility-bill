# Specification: ระบบจดและติดตามค่าน้ำ - ค่าไฟ บ้านพักครู (สามสาระ)

- **Repository:** `samsara-utility-bill`
- **ชื่อระบบ:** ระบบจดและติดตามค่าน้ำ - ค่าไฟ บ้านพักครู (สามสาระ)
- **รูปแบบการใช้งาน:** Mobile-First Web Application + Google Apps Script (GAS) + Google Sheets + Google Drive

---

## 1. เป้าหมายหลักของระบบ

1. **ฝั่งครูผู้พักอาศัย (Public / ไม่ต้องล็อกอิน):**
   - เปิดดูยอดค่าน้ำและค่าไฟรายเดือน รวมถึงประวัติย้อนหลังได้ทุกเดือนและทุกปี พ.ศ.
   - ดูรายละเอียดการคำนวณ (มิเตอร์เก่า, มิเตอร์ใหม่, หน่วยที่ใช้, เรทค่าไฟ, ค่าน้ำ, ยอดรวม)
   - คัดลอกเลขบัญชีโอนเงินได้ใน 1 คลิก
   - แนบภาพสลิปแจ้งโอนเงิน (บีบอัดภาพฝั่งเครื่องผู้ใช้ก่อนส่ง) และเปิดดูหลักฐานสลิปย้อนหลังได้ถาวร
   - ติดตามกราฟสถิติการใช้ไฟของทั้งบ้านพักและรายบุคคล (รวมถึงผู้ย้ายออกไปแล้ว)
2. **ฝั่งผู้ดูแล / ผู้จดมิเตอร์ (Admin / ล็อกอินด้วย PIN ตรวจฝั่ง Backend):**
   - เดินจดเลขมิเตอร์ผ่านมือถือได้รวดเร็ว คำนวณยอดแบบ Real-time และแจ้งเตือนเมื่อกรอกค่าน้อยกว่ามิเตอร์เดิม
   - ตรวจอนุมัติหรือตีกลับสลิปพร้อมเหตุผล รวมถึงปรับสถานะชำระเงินสดด้วยตนเอง
   - จัดการรายชื่อครูย้ายเข้าและย้ายออกโดยไม่ลบแถวเดิมและไม่กระทบประวัติบิลเก่า
   - ขึ้นรอบบิลเดือนใหม่โดยดึงเลขมิเตอร์ล่าสุดของครูที่ยังพักอยู่มาเป็น `prev_meter` อัตโนมัติ (หรือใช้ `initial_meter` สำหรับครูย้ายเข้าใหม่)
   - ปิดและเปิดรอบบิล (`open` / `closed`) โดยเมื่อปิดรอบบิลแล้วจะล็อกการแก้ไขเลขมิเตอร์และปิดการส่งสลิปใหม่ของรอบนั้น
   - คัดลอกข้อความสรุปส่งกลุ่ม LINE, Export CSV (UTF-8 BOM), และสั่งพิมพ์ตารางสรุปยอดส่งโรงเรียนแบบ A4 (`@media print`)

---

## 2. สถาปัตยกรรมและเทคโนโลยี

- **Frontend (`web/`):** HTML5, Tailwind CSS (CDN), Vanilla JavaScript (ES Modules), Chart.js (CDN), Phosphor Icons (CDN), Google Fonts (`Prompt` และ `Sarabun`) — พร้อม Deploy ขึ้น GitHub Pages หรือ Vercel ได้ทันทีโดยไม่ต้อง Build
- **Backend (`gas-backend/`):** Google Apps Script (`setup.gs` และ `Code.gs`) Deploy เป็น Web App (`Execute as: Me`, `Who has access: Anyone`)
- **Database:** Google Sheets จำนวน 5 แท็บโครงสร้างแบบ Relational-like
- **File Storage:** Google Drive โฟลเดอร์ `Samsara-Utility-Slips/{cycle_id}/` สำหรับเก็บไฟล์สลิป JPEG และบันทึกลิงก์ลงในชีตเท่านั้น (ไม่เก็บ Base64 ในเซลล์ชีต)

---

## 3. โครงสร้างฐานข้อมูล (Google Sheets 5 แท็บ)

### 3.1 แท็บ `Settings`
คอลัมน์: `key`, `value`, `description`

| key | ค่าเริ่มต้น | คำอธิบาย |
| :--- | :--- | :--- |
| `house_name` | `บ้านพักครู (สามสาระ)` | ชื่อบ้านพักครู |
| `bank_name` | `ธนาคารกรุงไทย` | ชื่อธนาคารรับโอน |
| `bank_account_no` | `8540466694` | เลขที่บัญชีรับโอน (ฟอร์แมตข้อความ) |
| `bank_account_name` | `ครูนพพร สมบูรณ์ชัย` | ชื่อบัญชีรับโอน |
| `promptpay_id` | *(ว่าง)* | หมายเลขพร้อมเพย์สำหรับอนาคต |
| `default_water_rate` | `75` | ค่าน้ำเหมาจ่ายต่อห้อง (บาท) |
| `default_electric_rate` | `7` | ค่าไฟต่อหน่วย (บาท) |
| `slip_folder_id` | *(สร้างอัตโนมัติ)* | Google Drive Folder ID ของ `Samsara-Utility-Slips` |

> **ด้านความปลอดภัย:** ห้ามเก็บ `ADMIN_PIN` ลงใน Google Sheets ให้เก็บไว้ใน `PropertiesService.getScriptProperties()` เท่านั้น (ค่าเริ่มต้นหลังรัน `setupDatabase()` คือ `1234`)

### 3.2 แท็บ `Residents` (ห้ามลบแถวเด็ดขาด)
คอลัมน์: `resident_id`, `room_no`, `full_name`, `status`, `move_in_date`, `move_out_date`, `initial_meter`, `note`, `updated_at`
- `resident_id`: รหัสไม่ซ้ำ รูปแบบ `RES-001`, `RES-002`, ...
- `status`: `active` หรือ `moved_out`
- `initial_meter`: เลขมิเตอร์ ณ วันย้ายเข้า ใช้เป็น `prev_meter` ในรอบบิลแรกของครูคนใหม่

### 3.3 แท็บ `Billing_Cycles`
คอลัมน์: `cycle_id`, `year_th`, `month_label`, `due_date`, `water_rate`, `electric_rate`, `status`, `created_at`
- `cycle_id`: รูปแบบ `YYYY-MM` เช่น `2026-11` (ฟอร์แมตข้อความ)
- `year_th`: ปี พ.ศ. เช่น `2569`
- `status`: `open` หรือ `closed`

### 3.4 แท็บ `Meter_Records`
คอลัมน์: `record_id`, `cycle_id`, `resident_id`, `room_no`, `name_snapshot`, `prev_meter`, `curr_meter`, `units_used`, `water_cost`, `electric_cost`, `total_cost`, `payment_status`, `slip_url`, `slip_file_id`, `paid_at`, `verified_at`, `reject_reason`, `updated_at`
- `record_id`: `{cycle_id}_{resident_id}` เช่น `2026-11_RES-003`
- `name_snapshot` และ `room_no`: ล็อกค่าไว้ ณ ตอนสร้างรอบบิล เพื่อคงความถูกต้องของประวัติย้อนหลังตลอดกาล
- `payment_status`: `unpaid` | `pending` | `paid`

### 3.5 แท็บ `Audit_Logs`
คอลัมน์: `timestamp`, `action`, `target_id`, `detail`
- บันทึกทุกเหตุการณ์สำคัญ เช่น `SETUP_DATABASE`, `CREATE_CYCLE`, `UPDATE_CYCLE`, `SAVE_METERS`, `UPLOAD_SLIP`, `APPROVE_SLIP`, `REJECT_SLIP`, `MARK_PAID_MANUAL`, `ADD_RESIDENT`, `MOVE_OUT_RESIDENT`, `UPDATE_RESIDENT`, `UPDATE_SETTINGS`, `CHANGE_PIN`

---

## 4. ข้อมูลตั้งต้นรอบบิลพฤศจิกายน 2569 (`2026-11`)

- **กำหนดชำระ:** `28 พฤศจิกายน 2569`
- **เรทค่าบริการ:** ค่าน้ำ `75` บาท/ห้อง | ค่าไฟ `7` บาท/หน่วย
- **บัญชีรับโอน:** ครูนพพร สมบูรณ์ชัย `8540466694` ธนาคารกรุงไทย

| รหัส | ห้อง | รายชื่อครู | เลขอ่านก่อน | เลขอ่านหลัง | หน่วยที่ใช้ | ค่าน้ำ | ค่าไฟ | รวม |
| :--- | :---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| `RES-001` | 1 | นางสาวรุจิรางค์ งามเมือง | 3834 | 3876 | 42 | 75 | 294 | 369 |
| `RES-002` | 2 | นางสาวบุษบาบัณ กันนิกา | 5455 | 5516 | 61 | 75 | 427 | 502 |
| `RES-003` | 3 | นายนพพร สมบูรณ์ชัย | 4710 | 4772 | 62 | 75 | 434 | 509 |
| `RES-004` | 4 | นายทศพล แก้วสุยะ | 465 | 510 | 45 | 75 | 315 | 390 |
| `RES-005` | 5 | นางสาวโสธิดา สุอุดมสินโรจน์ | 7730 | 7730 | 0 | 75 | 0 | 75 |
| `RES-006` | 6 | นางสาวเมรินทร์ สิทธิบุญมี | 9066 | 9158 | 92 | 75 | 644 | 719 |
| `RES-007` | 7 | นางสาวอัมพร กลิ่นรสทิพย์ | 4606 | 4626 | 20 | 75 | 140 | 215 |
| `RES-008` | 8 | นางสาวเบญจวรรณ พลับพลึงพนา | 3211 | 3233 | 22 | 75 | 154 | 229 |
| `RES-009` | 9 | นางสาวณัฐวดี เขียวภูมิชัย | 3602 | 3602 | 0 | 75 | 0 | 75 |
| **รวม** | **9 ห้อง** | **ยอดรวมส่งโรงเรียน** | — | — | **344** | **675** | **2,408** | **3,083** |

---

## 5. ข้อกำหนด Backend API (`gas-backend/Code.gs`)

### ข้อกำหนดทางเทคนิค
1. **ป้องกันปัญหา CORS:** ฝั่ง Frontend ส่ง `POST` ด้วย `headers: { 'Content-Type': 'text/plain;charset=utf-8' }` และ `redirect: 'follow'` ส่วน `doPost(e)` อ่าน `JSON.parse(e.postData.contents)` และคืน JSON ด้วย `ContentService.MimeType.JSON`
2. **ป้องกันการเขียนข้อมูลชนกัน:** ใช้ `LockService.getScriptLock().tryLock(15000)` ทุกคำสั่งเขียนใน `doPost` และ `releaseLock()` ใน `finally`
3. **ตรวจสิทธิ์ Admin:** ทุก Admin Action ตรวจสอบ `pin` กับ `ScriptProperties.getProperty('ADMIN_PIN')` หากไม่ถูกต้องคืน `{ ok: false, error: 'INVALID_PIN' }`
4. **การเก็บสลิปใน Google Drive:** บันทึกในโฟลเดอร์ `Samsara-Utility-Slips/{cycle_id}/{cycle_id}_{room_no}_{resident_id}_{timestamp}.jpg`, ตั้งสิทธิ์ `ANYONE_WITH_LINK / VIEW`, คืน `slip_url` (`https://drive.google.com/thumbnail?id={fileId}&sz=w1000`) และ `slip_file_id` (ใช้สร้างลิงก์เปิดเต็มจอ `https://drive.google.com/file/d/{fileId}/view`)
5. **นโยบายรอบบิลที่ปิดแล้ว (`status === 'closed'`):** ล็อกคำสั่ง `saveMeters` และ `uploadSlip` ของรอบบิลนั้น จนกว่าผู้ดูแลจะเปิดรอบบิลกลับเป็น `open` ผ่าน `updateCycle`

### รายการ Endpoints
- `GET ?action=getDashboard&cycle_id=YYYY-MM` (Public)
- `GET ?action=getStats&year_th=2569` (Public)
- `POST action: "verifyPin"` (Public)
- `POST action: "uploadSlip"` (Public)
- `POST action: "getResidents"` (Admin)
- `POST action: "addResident"` (Admin)
- `POST action: "moveOutResident"` (Admin)
- `POST action: "updateResident"` (Admin)
- `POST action: "saveMeters"` (Admin)
- `POST action: "verifyPayment"` (Admin)
- `POST action: "createCycle"` (Admin)
- `POST action: "updateCycle"` (Admin)
- `POST action: "updateSettings"` (Admin)

---

## 6. ระบบการออกแบบภาพ (Visual System — อ้างอิง `ai-design-skills`)

- **ธีม:** Light Mode เท่านั้น พื้นผิวเรียบ (Flat, ไม่มี Background Gradient), โทนสีฟ้า-น้ำเงินสุภาพ (ความอิ่มตัว `< 80%`) แบ่ง CSS Variables เป็น 2 ชั้น (`Core Colors` → `Color System`)
- **ตัวอักษร:** `Prompt` (หัวข้อ/ตัวเลข `tabular-nums`) และ `Sarabun` (เนื้อหา/ตารางพิมพ์), ขนาดยึด Tailwind Scale เท่านั้น (`12, 14, 16, 18, 20, 24, 30, 36px`), ไม่มีตัวเอียง, ไม่เกินน้ำหนัก Bold (700)
- **ระยะห่างและมุมโค้ง:** ยึดชุด Spacing `0, 2, 4, 8, 12, 16, 24, 32, 40, 48, 64px` และสูตร Nested Radius (`inner = outer - gap`), การ์ดทุกใบมีเส้นขอบครบ 4 ด้าน 1px (ไม่ใช้เส้นขอบด้านเดียว)
- **ไอคอนและการเคลื่อนไหว:** ใช้ Phosphor Icons, การเคลื่อนไหวใช้ Curve `cubic-bezier(0.22, 1, 0.36, 1)` รองรับ `prefers-reduced-motion`, มี Skeleton Loader, Empty State, Inline Error, Focus Ring และ Custom Modal แทน `window.alert()`
- **Mobile-First:** ตรวจสอบที่ความกว้าง 390px ต้องไม่มี Horizontal Overflow และปุ่มกดมีขนาดไม่ต่ำกว่า 44×44px
