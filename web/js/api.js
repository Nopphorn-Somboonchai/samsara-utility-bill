/**
 * ============================================================================
 * Samsara Utility Bill — API Client, Real-Time Stream Progress & Mock Router (api.js)
 * ============================================================================
 */

(function (global) {
  'use strict';

  const SamsaraApp = (global.SamsaraApp = global.SamsaraApp || {});

  function getConfig() {
    return SamsaraApp.CONFIG;
  }

  function isMock() {
    return SamsaraApp.isMockMode();
  }

  // ============================================================================
  // Client-Side Slip Image Compression (HTML5 Canvas: max 1000px, JPEG 0.75)
  // ============================================================================

  async function compressSlipImage(file, maxWidth, quality, onProgress) {
    const cfg = getConfig();
    const targetMaxW = maxWidth || cfg.SLIP_MAX_WIDTH || 1000;
    const targetQuality = quality || cfg.SLIP_JPEG_QUALITY || 0.75;
    const emit = typeof onProgress === 'function' ? onProgress : () => {};

    if (!file || !file.type || !file.type.startsWith('image/')) {
      throw new Error('กรุณาเลือกไฟล์รูปภาพเท่านั้น (JPG, PNG หรือ WebP)');
    }

    emit({ percent: 8, stageText: 'กำลังอ่านไฟล์รูปภาพ...', metaText: file.name || '' });

    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onprogress = (ev) => {
        if (ev.lengthComputable && ev.total > 0) {
          const pct = 8 + Math.round((ev.loaded / ev.total) * 12);
          emit({ percent: pct, stageText: 'กำลังอ่านไฟล์รูปภาพ...', metaText: `${Math.round(ev.loaded / 1024)} KB` });
        }
      };
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์รูปภาพได้'));
      reader.readAsDataURL(file);
    });

    emit({ percent: 22, stageText: 'กำลังย่อขนาดและบีบอัดภาพสลิป...', metaText: 'ปรับความกว้างสูงสุด 1000px' });

    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('ไฟล์ภาพเสียหายหรือไม่รองรับในเบราว์เซอร์นี้'));
      image.src = dataUrl;
    });

    let width = img.naturalWidth || img.width;
    let height = img.naturalHeight || img.height;

    if (width > targetMaxW) {
      height = Math.round((height * targetMaxW) / width);
      width = targetMaxW;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const compressedDataUrl = canvas.toDataURL('image/jpeg', targetQuality);
    const base64 = compressedDataUrl.split(',')[1] || '';
    const estimatedBytes = Math.round((base64.length * 3) / 4);
    const sizeKB = Math.max(1, Math.round(estimatedBytes / 1024));

    emit({ percent: 30, stageText: 'บีบอัดภาพเรียบร้อย', metaText: `${width}×${height}px (${sizeKB} KB)` });

    return {
      dataUrl: compressedDataUrl,
      base64,
      mimeType: 'image/jpeg',
      width,
      height,
      sizeKB
    };
  }

  // ============================================================================
  // Real-Time HTTP Progress Engine (Stage Curve + ReadableStream + Timeout)
  // ============================================================================

  function formatKB(bytes) {
    if (!bytes || bytes <= 0) return '0 KB';
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  async function fetchWithRealTimeProgress(url, fetchOptions, progressOpts = {}) {
    const cfg = getConfig();
    const timeoutMs = cfg.REQUEST_TIMEOUT_MS || 25000;
    const onProgress = typeof progressOpts.onProgress === 'function' ? progressOpts.onProgress : null;
    const basePct = Number(progressOpts.startPercent || 0);
    const waitStartPct = Math.max(basePct + 10, 12);
    const waitCapPct = Number(progressOpts.waitCapPercent || 68);
    const readEndPct = 92;

    const stages = {
      connect: progressOpts.connectStage || 'กำลังเชื่อมต่อ Google Apps Script...',
      wait: progressOpts.waitStage || 'กำลังดึงข้อมูลจาก Google Sheets...',
      read: progressOpts.readStage || 'กำลังรับข้อมูลจากเซิร์ฟเวอร์...',
      parse: progressOpts.parseStage || 'กำลังตรวจสอบและจัดเรียงข้อมูล...',
      done: progressOpts.doneStage || 'โหลดข้อมูลเสร็จสมบูรณ์'
    };

    const startTime = Date.now();
    let currentPercent = basePct;
    let rafId = null;
    let intervalId = null;
    let stopped = false;

    const emit = (patch) => {
      if (!onProgress) return;
      const elapsedSec = (Date.now() - startTime) / 1000;
      if (typeof patch.percent === 'number') {
        currentPercent = Math.max(currentPercent, Math.min(100, Math.round(patch.percent)));
      }
      onProgress({
        percent: currentPercent,
        stageText: patch.stageText || stages.wait,
        metaText: patch.metaText || '',
        loadedBytes: patch.loadedBytes || 0,
        elapsedSec,
        done: Boolean(patch.done),
        error: Boolean(patch.error)
      });
    };

    const stopTicker = () => {
      stopped = true;
      if (rafId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const startWaitTicker = () => {
      const tick = () => {
        if (stopped) return;
        const elapsedMs = Date.now() - startTime;
        const span = Math.max(1, waitCapPct - waitStartPct);
        // เส้นโค้งนุ่มนวล (Asymptotic) ไหลต่อเนื่องตามเวลาจริงโดยไม่ชนเพดานก่อนได้รับข้อมูล
        const smoothPct = waitStartPct + span * (1 - Math.exp(-elapsedMs / 2400));
        emit({
          percent: smoothPct,
          stageText: elapsedMs > 3200 ? `${stages.wait} (กำลังรอตอบกลับจาก Google)` : stages.wait,
          metaText: 'เชื่อมต่อเซิร์ฟเวอร์แล้ว กำลังประมวลผล'
        });
        if (typeof requestAnimationFrame === 'function') {
          rafId = requestAnimationFrame(tick);
        }
      };

      if (typeof requestAnimationFrame === 'function') {
        rafId = requestAnimationFrame(tick);
      } else {
        intervalId = setInterval(tick, 120);
      }
    };

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => {
          controller.abort();
        }, timeoutMs)
      : null;

    try {
      emit({ percent: Math.max(basePct + 4, 5), stageText: stages.connect, metaText: 'ส่งคำขอไปยัง Web App URL' });
      startWaitTicker();

      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller ? controller.signal : undefined
      });

      stopTicker();

      if (!response.ok) {
        throw new Error(`เซิร์ฟเวอร์ตอบกลับผิดพลาด (${response.status}) กรุณาลองใหม่อีกครั้ง`);
      }

      // อ่าน Stream ข้อมูลจริงทีละ Chunk เพื่อแสดงขนาด KB และเปอร์เซ็นต์แบบเรียลไทม์
      let text = '';
      let loadedBytes = 0;

      if (response.body && typeof response.body.getReader === 'function' && typeof TextDecoder !== 'undefined') {
        const contentLength = Number(response.headers.get('content-length') || 0);
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');

        emit({
          percent: Math.max(currentPercent, waitCapPct + 2),
          stageText: stages.read,
          metaText: 'เริ่มรับข้อมูลตอบกลับ'
        });

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            loadedBytes += value.byteLength;
            text += decoder.decode(value, { stream: true });
            const readSpan = readEndPct - waitCapPct;
            const nextPct =
              contentLength > 0
                ? waitCapPct + Math.round((loadedBytes / contentLength) * readSpan)
                : waitCapPct + Math.min(readSpan, Math.round(loadedBytes / 240) + 10);

            emit({
              percent: nextPct,
              stageText: stages.read,
              metaText: contentLength > 0
                ? `รับข้อมูล ${formatKB(loadedBytes)} / ${formatKB(contentLength)}`
                : `รับข้อมูลแล้ว ${formatKB(loadedBytes)}`,
              loadedBytes
            });
          }
        }
        text += decoder.decode();
      } else {
        text = await response.text();
        loadedBytes = text.length;
        emit({
          percent: readEndPct,
          stageText: stages.read,
          metaText: `รับข้อมูลแล้ว ${formatKB(loadedBytes)}`,
          loadedBytes
        });
      }

      emit({
        percent: 96,
        stageText: stages.parse,
        metaText: `ตรวจสอบข้อมูล (${formatKB(loadedBytes)})`,
        loadedBytes
      });

      let json;
      try {
        json = JSON.parse(text);
      } catch (err) {
        throw new Error('ไม่สามารถอ่านผลลัพธ์จาก Google Apps Script ได้ กรุณาตรวจสอบสิทธิ์ Deploy (Who has access: Anyone)');
      }

      if (!json || json.ok !== true) {
        const apiErr = new Error((json && json.message) || 'ดำเนินการไม่สำเร็จ');
        apiErr.code = (json && json.error) || 'API_ERROR';
        throw apiErr;
      }

      emit({
        percent: 100,
        stageText: stages.done,
        metaText: `รับข้อมูลครบถ้วน (${formatKB(loadedBytes)})`,
        loadedBytes,
        done: true
      });

      return json.data;
    } catch (err) {
      stopTicker();
      let finalErr = err;
      if (err && err.name === 'AbortError') {
        finalErr = new Error(`หมดเวลาการเชื่อมต่อ (เกิน ${Math.round(timeoutMs / 1000)} วินาที) กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่`);
        finalErr.code = 'TIMEOUT';
      } else if (err && err.message === 'Failed to fetch') {
        finalErr = new Error('ไม่สามารถเชื่อมต่อ Google Apps Script ได้ กรุณาตรวจสอบอินเทอร์เน็ตหรือสิทธิ์ Deploy (Anyone)');
        finalErr.code = 'NETWORK_ERROR';
      }

      emit({
        percent: currentPercent,
        stageText: finalErr.message || 'เกิดข้อผิดพลาดในการโหลดข้อมูล',
        metaText: 'การเชื่อมต่อขัดข้อง',
        error: true
      });

      throw finalErr;
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }
  }

  // ============================================================================
  // HTTP Transport Wrappers
  // ============================================================================

  async function requestGet(action, params = {}, progressOpts = {}) {
    if (isMock()) {
      return runMockWithProgress(() => mockHandleGet(action, params), progressOpts);
    }

    const url = new URL(getConfig().GAS_WEB_APP_URL);
    url.searchParams.set('action', action);
    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '') {
        url.searchParams.set(key, String(val));
      }
    });

    return fetchWithRealTimeProgress(
      url.toString(),
      { method: 'GET', redirect: 'follow' },
      progressOpts
    );
  }

  async function requestPost(payload, progressOpts = {}) {
    if (isMock()) {
      return runMockWithProgress(() => mockHandlePost(payload), progressOpts);
    }

    return fetchWithRealTimeProgress(
      getConfig().GAS_WEB_APP_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        redirect: 'follow'
      },
      progressOpts
    );
  }

  async function runMockWithProgress(fn, progressOpts = {}) {
    const onProgress = typeof progressOpts.onProgress === 'function' ? progressOpts.onProgress : null;
    const startTime = Date.now();
    const startPct = Number(progressOpts.startPercent || 0);

    const emit = (percent, stageText, metaText, done = false) => {
      if (!onProgress) return;
      onProgress({
        percent,
        stageText,
        metaText,
        loadedBytes: 0,
        elapsedSec: (Date.now() - startTime) / 1000,
        done,
        error: false
      });
    };

    emit(Math.max(startPct, 18), progressOpts.connectStage || 'กำลังเชื่อมต่อโหมดข้อมูลจำลอง...', 'โหมดพรีวิว');
    await mockDelay(90);
    emit(Math.max(startPct + 35, 65), progressOpts.waitStage || 'กำลังโหลดข้อมูลจำลอง...', 'กำลังจัดเตรียมรายการ');
    const result = await fn();
    emit(100, progressOpts.doneStage || 'โหลดข้อมูลเสร็จสมบูรณ์', 'โหมดข้อมูลจำลอง', true);
    return result;
  }

  // ============================================================================
  // Public & Admin API Surface (Matches gas-backend/Code.gs 1:1)
  // ============================================================================

  const api = {
    getDashboard(cycleId = '', options = {}) {
      return requestGet(
        'getDashboard',
        cycleId ? { cycle_id: cycleId } : {},
        {
          onProgress: options.onProgress,
          connectStage: 'กำลังเชื่อมต่อ Google Apps Script...',
          waitStage: 'กำลังดึงข้อมูลรอบบิลจาก Google Sheets...',
          readStage: 'กำลังรับรายการบิลแต่ละห้อง...',
          parseStage: 'กำลังคำนวณยอดสรุปและเรียงลำดับห้อง...',
          doneStage: 'โหลดข้อมูลรอบบิลเสร็จสมบูรณ์'
        }
      );
    },

    getStats(yearTh = '', options = {}) {
      return requestGet(
        'getStats',
        yearTh ? { year_th: yearTh } : {},
        {
          onProgress: options.onProgress,
          connectStage: 'กำลังเชื่อมต่อฐานข้อมูลสถิติ...',
          waitStage: 'กำลังประมวลผลสถิติรายปีจาก Google Sheets...',
          readStage: 'กำลังรับข้อมูลประวัติย้อนหลัง...',
          parseStage: 'กำลังเตรียมข้อมูลกราฟและตารางสรุป...',
          doneStage: 'โหลดข้อมูลสถิติเสร็จสมบูรณ์'
        }
      );
    },

    verifyPin(pin) {
      return requestPost({ action: 'verifyPin', pin });
    },

    uploadSlip({ record_id, cycle_id, imageBase64, mimeType }, options = {}) {
      return requestPost(
        {
          action: 'uploadSlip',
          record_id,
          cycle_id,
          imageBase64,
          mimeType
        },
        {
          onProgress: options.onProgress,
          startPercent: 30,
          waitCapPercent: 86,
          connectStage: 'กำลังส่งภาพสลิปไปยัง Google Drive...',
          waitStage: 'กำลังบันทึกไฟล์สลิปลงโฟลเดอร์ Google Drive...',
          readStage: 'กำลังยืนยันการบันทึกลง Google Sheets...',
          parseStage: 'กำลังอัปเดตสถานะรอตรวจสลิป...',
          doneStage: 'อัปโหลดสลิปเสร็จสมบูรณ์'
        }
      );
    },

    getResidents(pin) {
      return requestPost({ action: 'getResidents', pin });
    },

    addResident(pin, data) {
      return requestPost({
        action: 'addResident',
        pin,
        room_no: data.room_no,
        full_name: data.full_name,
        move_in_date: data.move_in_date,
        initial_meter: data.initial_meter,
        note: data.note,
        add_to_open_cycle: Boolean(data.add_to_open_cycle)
      });
    },

    moveOutResident(pin, data) {
      return requestPost({
        action: 'moveOutResident',
        pin,
        resident_id: data.resident_id,
        move_out_date: data.move_out_date,
        note: data.note
      });
    },

    updateResident(pin, data) {
      return requestPost({
        action: 'updateResident',
        pin,
        resident_id: data.resident_id,
        room_no: data.room_no,
        full_name: data.full_name,
        initial_meter: data.initial_meter,
        note: data.note
      });
    },

    saveMeters(pin, cycleId, items) {
      return requestPost({
        action: 'saveMeters',
        pin,
        cycle_id: cycleId,
        items
      });
    },

    verifyPayment(pin, { record_id, decision, reject_reason = '', is_manual = false }) {
      return requestPost({
        action: 'verifyPayment',
        pin,
        record_id,
        decision,
        reject_reason,
        is_manual
      });
    },

    createCycle(pin, data) {
      return requestPost({
        action: 'createCycle',
        pin,
        cycle_id: data.cycle_id,
        year_th: data.year_th,
        month_label: data.month_label,
        due_date: data.due_date,
        water_rate: data.water_rate,
        electric_rate: data.electric_rate
      });
    },

    updateCycle(pin, data) {
      return requestPost({
        action: 'updateCycle',
        pin,
        cycle_id: data.cycle_id,
        due_date: data.due_date,
        water_rate: data.water_rate,
        electric_rate: data.electric_rate,
        status: data.status
      });
    },

    updateSettings(pin, settings, newPin = '') {
      return requestPost({
        action: 'updateSettings',
        pin,
        settings,
        new_pin: newPin
      });
    },

    resetMockDatabase() {
      try {
        localStorage.removeItem(getConfig().MOCK_STORAGE_KEY);
      } catch (e) {
        // ignore storage errors on restricted contexts
      }
      return loadMockDb();
    }
  };

  // ============================================================================
  // Full-Fidelity Mock Backend (Mirrors gas-backend/Code.gs Logic Locally)
  // ============================================================================

  let memoryFallbackDb = null;

  function loadMockDb() {
    try {
      const raw = localStorage.getItem(getConfig().MOCK_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (err) {
      if (memoryFallbackDb) return memoryFallbackDb;
    }
    const fresh = SamsaraApp.createInitialMockDb();
    saveMockDb(fresh);
    return fresh;
  }

  function saveMockDb(db) {
    memoryFallbackDb = db;
    try {
      localStorage.setItem(getConfig().MOCK_STORAGE_KEY, JSON.stringify(db));
    } catch (err) {
      // ignore quota/restricted storage errors
    }
  }

  function compareRoomNo(a, b) {
    return String(a.room_no || '').localeCompare(String(b.room_no || ''), 'th', {
      numeric: true,
      sensitivity: 'base'
    });
  }

  function roundMoney(num) {
    return Math.round((Number(num) + Number.EPSILON) * 100) / 100;
  }

  function mockDelay(ms = 120) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function throwMockError(code, message) {
    const err = new Error(message);
    err.code = code;
    throw err;
  }

  async function mockHandleGet(action, params) {
    await mockDelay(100);
    const db = loadMockDb();

    if (action === 'getDashboard') {
      const cycles = [...db.cycles].sort((a, b) => b.cycle_id.localeCompare(a.cycle_id));
      const activeCycle =
        (params.cycle_id ? cycles.find((c) => c.cycle_id === params.cycle_id) : null) ||
        cycles[0] ||
        null;
      const records = activeCycle
        ? db.records.filter((r) => r.cycle_id === activeCycle.cycle_id).sort(compareRoomNo)
        : [];

      return {
        settings: { ...db.settings },
        cycles,
        activeCycle,
        records
      };
    }

    if (action === 'getStats') {
      const yearSet = new Set(db.cycles.map((c) => Number(c.year_th)).filter(Boolean));
      const availableYears = [...yearSet].sort((a, b) => b - a);
      const reqYear = Number(params.year_th);
      const selectedYear = reqYear && yearSet.has(reqYear) ? reqYear : availableYears[0] || 2569;

      const yearCycles = db.cycles
        .filter((c) => Number(c.year_th) === selectedYear)
        .sort((a, b) => a.cycle_id.localeCompare(b.cycle_id));

      const cycleLookup = Object.fromEntries(db.cycles.map((c) => [c.cycle_id, c]));
      const yearCycleIds = new Set(yearCycles.map((c) => c.cycle_id));

      const monthlySummary = yearCycles.map((cycle) => {
        const cycleRecs = db.records.filter((r) => r.cycle_id === cycle.cycle_id);
        let totalUnits = 0;
        let totalWater = 0;
        let totalElectric = 0;
        let totalCost = 0;
        let paidCount = 0;
        let paidAmount = 0;
        cycleRecs.forEach((r) => {
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

      const residentIndex = {};
      db.residents.forEach((res) => {
        residentIndex[res.resident_id] = {
          resident_id: res.resident_id,
          room_no: res.room_no,
          full_name: res.full_name,
          status: res.status
        };
      });
      db.records.forEach((rec) => {
        if (!residentIndex[rec.resident_id]) {
          residentIndex[rec.resident_id] = {
            resident_id: rec.resident_id,
            room_no: rec.room_no,
            full_name: rec.name_snapshot,
            status: 'moved_out'
          };
        }
      });

      const residentsList = Object.values(residentIndex).sort((a, b) => {
        if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
        return compareRoomNo(a, b);
      });

      const residentHistory = db.records
        .filter((r) => yearCycleIds.has(r.cycle_id))
        .map((r) => ({
          ...r,
          month_label: cycleLookup[r.cycle_id] ? cycleLookup[r.cycle_id].month_label : r.cycle_id
        }))
        .sort((a, b) => (a.cycle_id !== b.cycle_id ? a.cycle_id.localeCompare(b.cycle_id) : compareRoomNo(a, b)));

      return {
        selectedYear,
        availableYears,
        monthlySummary,
        residentsList,
        residentHistory
      };
    }

    throwMockError('UNKNOWN_ACTION', `ไม่พบคำสั่ง ${action}`);
  }

  async function mockHandlePost(payload) {
    await mockDelay(140);
    const db = loadMockDb();
    const action = payload.action;
    const nowIso = new Date().toISOString();

    if (action === 'verifyPin') {
      if (String(payload.pin || '').trim() !== db.adminPin) {
        throwMockError('INVALID_PIN', 'รหัส PIN ไม่ถูกต้อง (ค่าเริ่มต้นโหมดทดสอบคือ 1234)');
      }
      return { valid: true };
    }

    if (action === 'uploadSlip') {
      const cycle = db.cycles.find((c) => c.cycle_id === payload.cycle_id);
      if (!cycle) throwMockError('CYCLE_NOT_FOUND', 'ไม่พบรอบบิลที่ระบุ');
      if (cycle.status === 'closed') {
        throwMockError('CYCLE_CLOSED', 'รอบบิลนี้ปิดรับชำระแล้ว ไม่สามารถส่งสลิปใหม่ได้');
      }
      const rec = db.records.find((r) => r.record_id === payload.record_id);
      if (!rec) throwMockError('RECORD_NOT_FOUND', 'ไม่พบรายการบิลที่ระบุ');

      const dataUrl = payload.imageBase64.startsWith('data:')
        ? payload.imageBase64
        : `data:${payload.mimeType || 'image/jpeg'};base64,${payload.imageBase64}`;

      rec.payment_status = 'pending';
      rec.slip_url = dataUrl;
      rec.slip_view_url = dataUrl;
      rec.slip_file_id = `MOCK_SLIP_${Date.now()}`;
      rec.paid_at = nowIso;
      rec.reject_reason = '';
      rec.updated_at = nowIso;

      saveMockDb(db);
      return { record: { ...rec } };
    }

    if (String(payload.pin || '').trim() !== db.adminPin) {
      throwMockError('INVALID_PIN', 'รหัส PIN ไม่ถูกต้อง หรือสิทธิ์ผู้ดูแลหมดอายุ');
    }

    if (action === 'getResidents') {
      const residents = [...db.residents].sort((a, b) => {
        if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
        return compareRoomNo(a, b);
      });
      return { residents };
    }

    if (action === 'addResident') {
      const roomNo = String(payload.room_no || '').trim();
      const fullName = String(payload.full_name || '').trim();
      const initialMeter = Number(payload.initial_meter);
      if (!roomNo || !fullName) throwMockError('INVALID_INPUT', 'กรุณากรอกเลขห้องและชื่อ-สกุล');
      if (!Number.isFinite(initialMeter) || initialMeter < 0) {
        throwMockError('INVALID_INPUT', 'เลขมิเตอร์เริ่มต้นต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
      }

      let maxNum = 0;
      db.residents.forEach((r) => {
        const m = String(r.resident_id).match(/RES-(\d+)/i);
        if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
      });
      const nextId = `RES-${String(maxNum + 1).padStart(3, '0')}`;

      const resident = {
        resident_id: nextId,
        room_no: roomNo,
        full_name: fullName,
        status: 'active',
        move_in_date: payload.move_in_date || nowIso.slice(0, 10),
        move_out_date: '',
        initial_meter: initialMeter,
        note: String(payload.note || '').trim(),
        updated_at: nowIso
      };
      db.residents.push(resident);

      let addedCycleId = '';
      if (payload.add_to_open_cycle) {
        const openCycles = db.cycles
          .filter((c) => c.status === 'open')
          .sort((a, b) => b.cycle_id.localeCompare(a.cycle_id));
        if (openCycles.length > 0) {
          const latestOpen = openCycles[0];
          db.records.push({
            record_id: `${latestOpen.cycle_id}_${nextId}`,
            cycle_id: latestOpen.cycle_id,
            resident_id: nextId,
            room_no: roomNo,
            name_snapshot: fullName,
            prev_meter: initialMeter,
            curr_meter: initialMeter,
            units_used: 0,
            water_cost: latestOpen.water_rate,
            electric_cost: 0,
            total_cost: latestOpen.water_rate,
            payment_status: 'unpaid',
            slip_url: '',
            slip_file_id: '',
            slip_view_url: '',
            paid_at: '',
            verified_at: '',
            reject_reason: '',
            updated_at: nowIso
          });
          addedCycleId = latestOpen.cycle_id;
        }
      }

      saveMockDb(db);
      return { resident, added_to_cycle_id: addedCycleId };
    }

    if (action === 'moveOutResident') {
      const res = db.residents.find((r) => r.resident_id === payload.resident_id);
      if (!res) throwMockError('RESIDENT_NOT_FOUND', 'ไม่พบข้อมูลผู้พักอาศัย');
      res.status = 'moved_out';
      res.move_out_date = payload.move_out_date || nowIso.slice(0, 10);
      if (payload.note !== undefined && String(payload.note).trim()) {
        res.note = String(payload.note).trim();
      }
      res.updated_at = nowIso;
      saveMockDb(db);
      return { resident: { ...res } };
    }

    if (action === 'updateResident') {
      const res = db.residents.find((r) => r.resident_id === payload.resident_id);
      if (!res) throwMockError('RESIDENT_NOT_FOUND', 'ไม่พบข้อมูลผู้พักอาศัย');
      if (res.status !== 'active') throwMockError('RESIDENT_MOVED_OUT', 'ไม่สามารถแก้ไขข้อมูลผู้ย้ายออกแล้ว');
      res.room_no = String(payload.room_no || '').trim();
      res.full_name = String(payload.full_name || '').trim();
      if (payload.initial_meter !== undefined && payload.initial_meter !== '') {
        res.initial_meter = Number(payload.initial_meter);
      }
      res.note = String(payload.note || '').trim();
      res.updated_at = nowIso;
      saveMockDb(db);
      return { resident: { ...res } };
    }

    if (action === 'saveMeters') {
      const cycle = db.cycles.find((c) => c.cycle_id === payload.cycle_id);
      if (!cycle) throwMockError('CYCLE_NOT_FOUND', 'ไม่พบรอบบิลที่ระบุ');
      if (cycle.status === 'closed') {
        throwMockError('CYCLE_CLOSED', 'รอบบิลนี้ปิดแล้ว กรุณาเปิดรอบบิลก่อนแก้ไขเลขมิเตอร์');
      }

      for (const item of payload.items || []) {
        const rec = db.records.find((r) => r.record_id === item.record_id && r.cycle_id === cycle.cycle_id);
        if (!rec) continue;
        const prev = item.prev_meter !== undefined && item.prev_meter !== '' ? Number(item.prev_meter) : rec.prev_meter;
        const curr = Number(item.curr_meter);
        if (!Number.isFinite(prev) || !Number.isFinite(curr) || prev < 0 || curr < prev) {
          throwMockError(
            'INVALID_METER_READING',
            `ห้อง ${rec.room_no} (${rec.name_snapshot}): เลขมิเตอร์ใหม่ (${curr}) น้อยกว่าเลขเดิม (${prev})`
          );
        }
      }

      let updatedCount = 0;
      for (const item of payload.items || []) {
        const rec = db.records.find((r) => r.record_id === item.record_id && r.cycle_id === cycle.cycle_id);
        if (!rec) continue;
        const prev = item.prev_meter !== undefined && item.prev_meter !== '' ? Number(item.prev_meter) : rec.prev_meter;
        const curr = Number(item.curr_meter);
        const units = curr - prev;
        const elec = roundMoney(units * cycle.electric_rate);
        const total = roundMoney(cycle.water_rate + elec);
        rec.prev_meter = prev;
        rec.curr_meter = curr;
        rec.units_used = units;
        rec.water_cost = cycle.water_rate;
        rec.electric_cost = elec;
        rec.total_cost = total;
        rec.updated_at = nowIso;
        updatedCount += 1;
      }

      saveMockDb(db);
      return {
        records: db.records.filter((r) => r.cycle_id === cycle.cycle_id).sort(compareRoomNo),
        updated_count: updatedCount
      };
    }

    if (action === 'verifyPayment') {
      const rec = db.records.find((r) => r.record_id === payload.record_id);
      if (!rec) throwMockError('RECORD_NOT_FOUND', 'ไม่พบรายการบิลที่ระบุ');

      if (payload.decision === 'paid') {
        rec.payment_status = 'paid';
        rec.verified_at = nowIso;
        rec.reject_reason = '';
        if (!rec.paid_at) rec.paid_at = nowIso;
      } else {
        rec.payment_status = 'unpaid';
        rec.verified_at = '';
        rec.reject_reason = String(payload.reject_reason || '').trim();
      }
      rec.updated_at = nowIso;
      saveMockDb(db);
      return { record: { ...rec } };
    }

    if (action === 'createCycle') {
      const cycleId = String(payload.cycle_id || '').trim();
      if (!/^\d{4}-\d{2}$/.test(cycleId)) {
        throwMockError('INVALID_INPUT', 'รูปแบบรหัสรอบบิลต้องเป็น YYYY-MM');
      }
      if (db.cycles.some((c) => c.cycle_id === cycleId)) {
        throwMockError('CYCLE_ALREADY_EXISTS', `มีรอบบิล ${cycleId} อยู่ในระบบแล้ว`);
      }
      const activeResidents = db.residents.filter((r) => r.status === 'active').sort(compareRoomNo);
      if (activeResidents.length === 0) {
        throwMockError('NO_ACTIVE_RESIDENTS', 'ไม่พบครูที่พักอาศัยอยู่ปัจจุบัน');
      }

      const latestByRes = {};
      db.records.forEach((r) => {
        const prev = latestByRes[r.resident_id];
        if (!prev || r.cycle_id.localeCompare(prev.cycle_id) > 0) {
          latestByRes[r.resident_id] = { cycle_id: r.cycle_id, curr_meter: r.curr_meter };
        }
      });

      const cycle = {
        cycle_id: cycleId,
        year_th: Number(payload.year_th),
        month_label: String(payload.month_label || '').trim(),
        due_date: String(payload.due_date || '').trim(),
        water_rate: Number(payload.water_rate),
        electric_rate: Number(payload.electric_rate),
        status: 'open',
        created_at: nowIso
      };
      db.cycles.push(cycle);

      const createdRecords = activeResidents.map((res) => {
        const prevMeter = latestByRes[res.resident_id]
          ? Number(latestByRes[res.resident_id].curr_meter)
          : Number(res.initial_meter || 0);
        return {
          record_id: `${cycleId}_${res.resident_id}`,
          cycle_id: cycleId,
          resident_id: res.resident_id,
          room_no: res.room_no,
          name_snapshot: res.full_name,
          prev_meter: prevMeter,
          curr_meter: prevMeter,
          units_used: 0,
          water_cost: cycle.water_rate,
          electric_cost: 0,
          total_cost: cycle.water_rate,
          payment_status: 'unpaid',
          slip_url: '',
          slip_file_id: '',
          slip_view_url: '',
          paid_at: '',
          verified_at: '',
          reject_reason: '',
          updated_at: nowIso
        };
      });
      db.records.push(...createdRecords);
      saveMockDb(db);
      return { cycle, records: createdRecords };
    }

    if (action === 'updateCycle') {
      const cycle = db.cycles.find((c) => c.cycle_id === payload.cycle_id);
      if (!cycle) throwMockError('CYCLE_NOT_FOUND', 'ไม่พบรอบบิลที่ระบุ');

      const oldWater = cycle.water_rate;
      const oldElec = cycle.electric_rate;

      if (payload.due_date !== undefined) cycle.due_date = String(payload.due_date).trim();
      if (payload.water_rate !== undefined && payload.water_rate !== '') cycle.water_rate = Number(payload.water_rate);
      if (payload.electric_rate !== undefined && payload.electric_rate !== '') cycle.electric_rate = Number(payload.electric_rate);
      if (payload.status === 'open' || payload.status === 'closed') cycle.status = payload.status;

      if (cycle.water_rate !== oldWater || cycle.electric_rate !== oldElec) {
        db.records
          .filter((r) => r.cycle_id === cycle.cycle_id)
          .forEach((r) => {
            r.water_cost = cycle.water_rate;
            r.electric_cost = roundMoney(r.units_used * cycle.electric_rate);
            r.total_cost = roundMoney(r.water_cost + r.electric_cost);
            r.updated_at = nowIso;
          });
      }

      saveMockDb(db);
      return {
        cycle: { ...cycle },
        records: db.records.filter((r) => r.cycle_id === cycle.cycle_id).sort(compareRoomNo)
      };
    }

    if (action === 'updateSettings') {
      const s = payload.settings || {};
      const keys = [
        'house_name',
        'bank_name',
        'bank_account_no',
        'bank_account_name',
        'promptpay_id',
        'default_water_rate',
        'default_electric_rate'
      ];
      keys.forEach((k) => {
        if (s[k] !== undefined && s[k] !== null) {
          db.settings[k] =
            k === 'default_water_rate' || k === 'default_electric_rate'
              ? Number(s[k])
              : String(s[k]).trim();
        }
      });

      let pinChanged = false;
      if (payload.new_pin && String(payload.new_pin).trim()) {
        const nextPin = String(payload.new_pin).trim();
        if (nextPin.length < 4 || nextPin.length > 12) {
          throwMockError('INVALID_INPUT', 'รหัส PIN ใหม่ต้องยาว 4 ถึง 12 ตัวอักษร');
        }
        db.adminPin = nextPin;
        pinChanged = true;
      }

      saveMockDb(db);
      return { settings: { ...db.settings }, pin_changed: pinChanged };
    }

    throwMockError('UNKNOWN_ACTION', `ไม่พบคำสั่ง ${action}`);
  }

  SamsaraApp.api = api;
  SamsaraApp.compressSlipImage = compressSlipImage;
})(typeof window !== 'undefined' ? window : globalThis);
