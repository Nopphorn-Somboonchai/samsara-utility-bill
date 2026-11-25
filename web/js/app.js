/**
 * ============================================================================
 * Samsara Utility Bill — Main Application Controller (web/js/app.js)
 * Classic Defer Compatible (Works on file://, Localhost, GitHub Pages, Vercel)
 * ============================================================================
 */

(function (global) {
  'use strict';

  const SamsaraApp = (global.SamsaraApp = global.SamsaraApp || {});
  const { CONFIG, THAI_MONTHS, isMockMode, api, compressSlipImage, renderHouseTrendChart, renderResidentTrendChart } = SamsaraApp;

  // Safe sessionStorage access (prevents errors on strict file:// browsers)
  function getSessionPin() {
    try {
      return sessionStorage.getItem(CONFIG.ADMIN_SESSION_KEY) || '';
    } catch (e) {
      return '';
    }
  }

  function setSessionPin(pin) {
    try {
      if (pin) {
        sessionStorage.setItem(CONFIG.ADMIN_SESSION_KEY, pin);
      } else {
        sessionStorage.removeItem(CONFIG.ADMIN_SESSION_KEY);
      }
    } catch (e) {
      // fallback: kept in memory state only
    }
  }

  // ============================================================================
  // Application State
  // ============================================================================

  const state = {
    currentView: 'bills', // 'bills' | 'stats' | 'admin'
    billFilter: 'all', // 'all' | 'unpaid' | 'pending' | 'paid'
    adminTab: 'meters', // 'meters' | 'slips' | 'residents' | 'manage'
    residentFilter: 'active', // 'active' | 'moved_out'

    adminPin: getSessionPin(),
    adminVerified: false,

    settings: null,
    cycles: [],
    activeCycle: null,
    records: [],
    residents: [],

    statsData: null,
    selectedStatsYear: '',
    selectedStatsResidentId: '',

    activeBillRecordId: '',
    pendingCompressedSlip: null,
    rejectTargetRecordId: '',
    confirmCallback: null
  };

  // ============================================================================
  // DOM, Real-Time Progress & Formatting Helpers
  // ============================================================================

  const $ = (id) => document.getElementById(id);

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtNum(val) {
    return Number(val || 0).toLocaleString('th-TH');
  }

  function fmtMoney(val) {
    const num = Number(val || 0);
    return Number.isInteger(num)
      ? num.toLocaleString('th-TH')
      : num.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtDateTimeTh(isoString) {
    if (!isoString) return '';
    const dt = new Date(isoString);
    if (Number.isNaN(dt.getTime())) return String(isoString);
    return dt.toLocaleString('th-TH', {
      day: 'numeric',
      month: 'short',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function getTodayYmd() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function getStatusMeta(status) {
    if (status === 'paid') {
      return { label: 'ชำระแล้ว', badgeClass: 'status-paid', icon: 'ph-check-circle' };
    }
    if (status === 'pending') {
      return { label: 'รอตรวจสลิป', badgeClass: 'status-pending', icon: 'ph-hourglass-high' };
    }
    return { label: 'รอชำระ', badgeClass: 'status-unpaid', icon: 'ph-clock' };
  }

  /**
   * อัปเดตการ์ด Real-Time Loading Progress (0%–100%)
   * prefix: 'bills' | 'stats' | 'slip'
   */
  function updateProgressWidget(prefix, info) {
    const pct = Math.max(0, Math.min(100, Math.round(Number(info.percent || 0))));
    const stageEl = $(`${prefix}-progress-stage`);
    const pctEl = $(`${prefix}-progress-percent`);
    const barEl = $(`${prefix}-progress-bar`);
    const dotEl = $(`${prefix}-progress-dot`);
    const metaEl = $(`${prefix}-progress-meta`);
    const elapsedEl = $(`${prefix}-progress-elapsed`);

    if (stageEl && info.stageText) stageEl.textContent = info.stageText;
    if (pctEl) {
      pctEl.textContent = `${pct}%`;
      pctEl.classList.toggle('text-[#047857]', Boolean(info.done));
      pctEl.classList.toggle('text-[#B91C1C]', Boolean(info.error));
      pctEl.classList.toggle('text-[#164873]', !info.done && !info.error);
    }
    if (barEl) {
      barEl.style.transform = `scaleX(${pct / 100})`;
      barEl.classList.toggle('is-done', Boolean(info.done));
      barEl.classList.toggle('is-error', Boolean(info.error));
      if (barEl.parentElement) {
        barEl.parentElement.setAttribute('aria-valuenow', String(pct));
      }
    }
    if (dotEl) {
      dotEl.classList.toggle('is-done', Boolean(info.done));
      dotEl.classList.toggle('is-error', Boolean(info.error));
    }
    if (metaEl && info.metaText !== undefined) {
      metaEl.textContent = info.metaText;
    }
    if (elapsedEl && typeof info.elapsedSec === 'number') {
      elapsedEl.textContent = `${info.elapsedSec.toFixed(1)} วินาที`;
    }
  }

  function resetProgressWidget(prefix, initialStage) {
    updateProgressWidget(prefix, {
      percent: 0,
      stageText: initialStage,
      metaText: 'กำลังเริ่มเชื่อมต่อ...',
      elapsedSec: 0,
      done: false,
      error: false
    });
  }

  function waitMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function showToast(message, type = 'default') {
    const container = $('toast-container');
    const item = document.createElement('div');
    const icon =
      type === 'success'
        ? 'ph-check-circle'
        : type === 'error'
          ? 'ph-warning-circle'
          : 'ph-info';

    item.className = `toast-item body-5 ${type === 'success' ? 'toast-success' : type === 'error' ? 'toast-error' : ''}`;
    item.innerHTML = `<i class="ph ${icon} text-lg shrink-0" aria-hidden="true"></i><span>${escapeHtml(message)}</span>`;
    container.appendChild(item);

    requestAnimationFrame(() => item.classList.add('is-visible'));

    setTimeout(() => {
      item.classList.remove('is-visible');
      setTimeout(() => item.remove(), 320);
    }, 3200);
  }

  async function copyToClipboard(text, successMsg) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const temp = document.createElement('textarea');
        temp.value = text;
        temp.style.position = 'fixed';
        temp.style.opacity = '0';
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        temp.remove();
      }
      showToast(successMsg, 'success');
    } catch (err) {
      showToast('ไม่สามารถคัดลอกได้ กรุณาเลือกข้อความแล้วคัดลอกด้วยตนเอง', 'error');
    }
  }

  function openModal(modalId) {
    const el = $(modalId);
    if (!el) return;
    el.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  function closeModal(modalId) {
    const el = $(modalId);
    if (!el) return;
    el.classList.remove('is-open');
    const anyOpen = document.querySelector('.modal-backdrop.is-open');
    if (!anyOpen) {
      document.body.style.overflow = '';
    }
  }

  function openConfirmDialog({ title, message, confirmLabel = 'ยืนยัน', confirmVariant = 'primary', onConfirm }) {
    $('confirm-modal-title').textContent = title;
    $('confirm-modal-message').textContent = message;
    const okBtn = $('btn-confirm-ok');
    okBtn.textContent = confirmLabel;
    okBtn.className = `btn button-sm ${confirmVariant === 'danger' ? 'btn-danger' : confirmVariant === 'success' ? 'btn-success' : 'btn-primary'}`;
    state.confirmCallback = onConfirm;
    openModal('modal-confirm');
  }

  function setButtonLoading(btn, loading, loadingText = 'กำลังดำเนินการ...') {
    if (!btn) return;
    if (loading) {
      btn.dataset.originalHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<i class="ph ph-spinner-gap text-lg animate-spin" aria-hidden="true"></i><span>${escapeHtml(loadingText)}</span>`;
    } else {
      btn.disabled = false;
      if (btn.dataset.originalHtml) {
        btn.innerHTML = btn.dataset.originalHtml;
        delete btn.dataset.originalHtml;
      }
    }
  }

  function downloadCsvWithBom(filename, rows) {
    const escapeCell = (cell) => {
      const str = String(cell ?? '');
      if (/[",\n\r]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };
    const csvBody = rows.map((row) => row.map(escapeCell).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csvBody], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ============================================================================
  // Navigation & View Switching
  // ============================================================================

  function switchView(viewName) {
    state.currentView = viewName;

    ['bills', 'stats', 'admin'].forEach((v) => {
      const sec = $(`view-${v}`);
      if (sec) sec.classList.toggle('hidden', v !== viewName);
    });

    document.querySelectorAll('[data-nav-view]').forEach((btn) => {
      const active = btn.dataset.navView === viewName;
      btn.classList.toggle('is-active', active);
      if (active) {
        btn.setAttribute('aria-current', 'page');
      } else {
        btn.removeAttribute('aria-current');
      }
    });

    if (viewName === 'stats') {
      loadStats(state.selectedStatsYear);
    } else if (viewName === 'admin') {
      renderAdminAccessState();
    }
  }

  function switchAdminTab(tabName) {
    state.adminTab = tabName;

    document.querySelectorAll('[data-admin-tab]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.adminTab === tabName);
    });

    ['meters', 'slips', 'residents', 'manage'].forEach((t) => {
      const panel = $(`admin-panel-${t}`);
      if (panel) panel.classList.toggle('hidden', t !== tabName);
    });

    if (tabName === 'residents' && state.adminVerified && state.residents.length === 0) {
      loadResidentsAdmin();
    }
  }

  // ============================================================================
  // Data Loading: Dashboard (Public) with Real-Time Progress %
  // ============================================================================

  async function loadDashboard(cycleId = '') {
    resetProgressWidget('bills', 'กำลังเชื่อมต่อ Google Apps Script...');
    $('bills-skeleton').classList.remove('hidden');
    $('bills-error-box').classList.add('hidden');
    $('bills-content').classList.add('hidden');

    try {
      const data = await api.getDashboard(cycleId, {
        onProgress: (info) => updateProgressWidget('bills', info)
      });

      state.settings = data.settings;
      state.cycles = data.cycles || [];
      state.activeCycle = data.activeCycle || null;
      state.records = data.records || [];

      renderHeaderAndCycleSelectors();
      renderBillsView();
      if (state.adminVerified) {
        renderAdminDashboard();
      }

      // แสดง 100% สีเขียวสั้นๆ ให้ผู้ใช้เห็นชัดเจนก่อนเปิดเนื้อหาจริง
      await waitMs(220);

      $('bills-skeleton').classList.add('hidden');
      $('bills-content').classList.remove('hidden');
    } catch (err) {
      await waitMs(200);
      $('bills-skeleton').classList.add('hidden');
      $('bills-error-text').textContent = err.message || 'ไม่สามารถเชื่อมต่อกับฐานข้อมูลได้';
      $('bills-error-box').classList.remove('hidden');
    }
  }

  function renderHeaderAndCycleSelectors() {
    const settings = state.settings || {};
    const houseName = settings.house_name || 'บ้านพักครู (สามสาระ)';
    $('header-house-name').textContent = houseName;
    document.title = `ค่าน้ำและค่าไฟ — ${houseName}`;

    if (state.activeCycle) {
      $('header-cycle-subtitle').textContent = `รอบบิลเดือน ${state.activeCycle.month_label}`;
    } else {
      $('header-cycle-subtitle').textContent = 'ยังไม่มีรอบบิลในระบบ';
    }

    const optionsHtml =
      state.cycles.length > 0
        ? state.cycles
            .map((c) => {
              const statusText = c.status === 'closed' ? ' (ปิดรอบแล้ว)' : '';
              const selected = state.activeCycle && c.cycle_id === state.activeCycle.cycle_id ? 'selected' : '';
              return `<option value="${escapeHtml(c.cycle_id)}" ${selected}>${escapeHtml(c.month_label)}${statusText}</option>`;
            })
            .join('')
        : '<option value="">ยังไม่มีรอบบิล</option>';

    $('bills-cycle-select').innerHTML = optionsHtml;
    $('admin-cycle-select').innerHTML = optionsHtml;

    const pendingCount = state.records.filter((r) => r.payment_status === 'pending').length;
    ['nav-pending-badge-desktop', 'nav-pending-badge-mobile', 'admin-tab-pending-count'].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.textContent = String(pendingCount);
      el.classList.toggle('hidden', pendingCount === 0);
    });
  }

  // ============================================================================
  // View 1 Rendering: Resident Monthly Bills
  // ============================================================================

  function renderBillsView() {
    const cycle = state.activeCycle;
    const settings = state.settings || {};
    const records = state.records || [];

    $('bills-due-date').textContent = cycle ? cycle.due_date : '-';
    $('bills-bank-name').textContent = settings.bank_name || '-';
    $('bills-bank-account-no').textContent = settings.bank_account_no || '-';
    $('bills-bank-account-name').textContent = settings.bank_account_name || '-';

    const statusBadge = $('bills-cycle-status-badge');
    if (cycle && cycle.status === 'closed') {
      statusBadge.className = 'status-badge status-closed caption-3';
      statusBadge.innerHTML = '<i class="ph ph-lock-simple text-sm" aria-hidden="true"></i><span>ปิดรอบบิลแล้ว</span>';
    } else {
      statusBadge.className = 'status-badge status-paid caption-3';
      statusBadge.innerHTML = '<i class="ph ph-check-circle text-sm" aria-hidden="true"></i><span>กำลังเปิดรับชำระ</span>';
    }

    if (cycle) {
      $('bills-rates-text').innerHTML = `
        <span>ค่าน้ำเหมาจ่าย ${fmtMoney(cycle.water_rate)} บาท/ห้อง</span>
        <span>ค่าไฟ ${fmtMoney(cycle.electric_rate)} บาท/หน่วย</span>
        <span>จำนวนทั้งหมด ${records.length} ห้อง</span>
      `;
    }

    let totalWater = 0;
    let totalElectric = 0;
    let totalCost = 0;
    let totalUnits = 0;
    let paidRooms = 0;
    let paidAmount = 0;
    let countUnpaid = 0;
    let countPending = 0;
    let countPaid = 0;

    records.forEach((r) => {
      totalWater += r.water_cost;
      totalElectric += r.electric_cost;
      totalCost += r.total_cost;
      totalUnits += r.units_used;
      if (r.payment_status === 'paid') {
        paidRooms += 1;
        paidAmount += r.total_cost;
        countPaid += 1;
      } else if (r.payment_status === 'pending') {
        countPending += 1;
      } else {
        countUnpaid += 1;
      }
    });

    $('summary-water').textContent = fmtMoney(totalWater);
    $('summary-electric').textContent = fmtMoney(totalElectric);
    $('summary-total').textContent = fmtMoney(totalCost);
    $('summary-units').textContent = `ใช้ไฟรวม ${fmtNum(totalUnits)} หน่วย`;

    const pct = totalCost > 0 ? Math.min(100, Math.round((paidAmount / totalCost) * 100)) : 0;
    $('summary-collected-text').textContent = `ชำระแล้ว ${paidRooms} / ${records.length} ห้อง (${fmtMoney(paidAmount)} / ${fmtMoney(totalCost)} บาท)`;
    $('summary-collected-percent').textContent = `${pct}%`;
    $('summary-progress-fill').style.transform = `scaleX(${pct / 100})`;
    const progressBar = $('summary-progress-fill').parentElement;
    if (progressBar) progressBar.setAttribute('aria-valuenow', String(pct));

    $('count-all').textContent = String(records.length);
    $('count-unpaid').textContent = String(countUnpaid);
    $('count-pending').textContent = String(countPending);
    $('count-paid').textContent = String(countPaid);

    const filtered =
      state.billFilter === 'all'
        ? records
        : records.filter((r) => r.payment_status === state.billFilter);

    const listEl = $('bills-card-list');
    const emptyEl = $('bills-empty-state');

    if (filtered.length === 0) {
      listEl.innerHTML = '';
      emptyEl.classList.remove('hidden');
      return;
    }

    emptyEl.classList.add('hidden');
    listEl.innerHTML = filtered
      .map((rec) => {
        const st = getStatusMeta(rec.payment_status);
        const hasReject = Boolean(rec.reject_reason && rec.payment_status === 'unpaid');
        return `
          <article
            class="card-interactive p-4 flex items-center justify-between gap-3"
            role="button"
            tabindex="0"
            data-open-bill="${escapeHtml(rec.record_id)}"
            aria-label="ดูรายละเอียดบิลห้อง ${escapeHtml(rec.room_no)} ${escapeHtml(rec.name_snapshot)} ยอดรวม ${fmtMoney(rec.total_cost)} บาท"
          >
            <div class="flex items-center gap-3 min-w-0 flex-1">
              <div class="w-11 h-11 rounded-lg bg-[#EFF6FC] border border-[#BAD6F0] text-[#164873] flex flex-col items-center justify-center shrink-0">
                <span class="caption-5 leading-none">ห้อง</span>
                <span class="title-3 leading-tight tabular-nums">${escapeHtml(rec.room_no)}</span>
              </div>
              <div class="min-w-0 flex-1">
                <div class="title-3 text-[#0F172A] truncate">${escapeHtml(rec.name_snapshot)}</div>
                <div class="caption-2 text-[#64748B] tabular-nums">
                  มิเตอร์ ${fmtNum(rec.prev_meter)} → ${fmtNum(rec.curr_meter)} (${fmtNum(rec.units_used)} หน่วย)
                </div>
                ${
                  hasReject
                    ? `<div class="caption-3 text-[#B91C1C] flex items-center gap-1 mt-1"><i class="ph ph-warning-circle text-sm" aria-hidden="true"></i><span class="truncate">สลิปถูกตีกลับ: ${escapeHtml(rec.reject_reason)}</span></div>`
                    : ''
                }
              </div>
            </div>

            <div class="text-right shrink-0 space-y-1">
              <div class="heading-6 text-[#0F172A] tabular-nums">${fmtMoney(rec.total_cost)} <span class="caption-4 text-[#64748B]">บาท</span></div>
              <span class="status-badge ${st.badgeClass} caption-3">
                <i class="ph ${st.icon} text-sm" aria-hidden="true"></i>
                <span>${st.label}</span>
              </span>
            </div>
          </article>
        `;
      })
      .join('');
  }

  // ============================================================================
  // Bill Detail Modal & Client-Side Slip Upload with Real-Time Progress %
  // ============================================================================

  function openBillDetailModal(recordId) {
    const rec = state.records.find((r) => r.record_id === recordId);
    if (!rec) return;

    state.activeBillRecordId = rec.record_id;
    state.pendingCompressedSlip = null;
    resetSlipPreviewUi();

    const cycle = state.activeCycle;
    const st = getStatusMeta(rec.payment_status);

    $('bill-modal-title').textContent = `ห้อง ${rec.room_no} • ${rec.name_snapshot}`;
    $('bill-modal-subtitle').textContent = cycle ? `รอบบิลเดือน ${cycle.month_label}` : rec.cycle_id;

    const badge = $('bill-modal-status-badge');
    badge.className = `status-badge ${st.badgeClass} caption-3`;
    badge.innerHTML = `<i class="ph ${st.icon} text-sm" aria-hidden="true"></i><span>${st.label}</span>`;

    const rejectBox = $('bill-modal-reject-box');
    if (rec.reject_reason && rec.payment_status === 'unpaid') {
      $('bill-modal-reject-text').textContent = rec.reject_reason;
      rejectBox.classList.remove('hidden');
    } else {
      rejectBox.classList.add('hidden');
    }

    $('bill-modal-prev').textContent = fmtNum(rec.prev_meter);
    $('bill-modal-curr').textContent = fmtNum(rec.curr_meter);
    $('bill-modal-units').textContent = `${fmtNum(rec.units_used)} หน่วย`;
    $('bill-modal-water').textContent = `${fmtMoney(rec.water_cost)} บาท`;
    const elecRate = cycle ? cycle.electric_rate : rec.units_used > 0 ? rec.electric_cost / rec.units_used : 0;
    $('bill-modal-rate-note').textContent = `ค่าไฟ (${fmtNum(rec.units_used)} หน่วย × ${fmtMoney(elecRate)} บาท)`;
    $('bill-modal-electric').textContent = `${fmtMoney(rec.electric_cost)} บาท`;
    $('bill-modal-total').textContent = `${fmtMoney(rec.total_cost)} บาท`;

    const existingSlipBox = $('bill-modal-existing-slip');
    if (rec.slip_url) {
      $('bill-modal-slip-img').src = rec.slip_url;
      $('bill-modal-slip-link').href = rec.slip_view_url || rec.slip_url;
      $('bill-modal-paid-at').textContent = rec.paid_at ? `แจ้งโอนเมื่อ ${fmtDateTimeTh(rec.paid_at)}` : '';
      existingSlipBox.classList.remove('hidden');
    } else {
      existingSlipBox.classList.add('hidden');
    }

    const isClosed = cycle && cycle.status === 'closed';
    const canUpload = !isClosed && rec.payment_status !== 'paid';
    $('bill-modal-closed-note').classList.toggle('hidden', !isClosed || rec.payment_status === 'paid');
    $('bill-modal-upload-section').classList.toggle('hidden', !canUpload);

    openModal('modal-bill-detail');
  }

  function resetSlipPreviewUi() {
    $('input-slip-file').value = '';
    $('slip-preview-box').classList.add('hidden');
    $('slip-preview-img').src = '';
    $('slip-upload-error').classList.add('hidden');
    $('slip-upload-progress-box').classList.add('hidden');
    $('btn-submit-slip').disabled = true;
  }

  async function handleSlipFileSelected(event) {
    const file = event.target.files && event.target.files[0];
    $('slip-upload-error').classList.add('hidden');

    if (!file) {
      state.pendingCompressedSlip = null;
      resetSlipPreviewUi();
      return;
    }

    const progressBox = $('slip-upload-progress-box');
    resetProgressWidget('slip', 'กำลังอ่านไฟล์ภาพสลิป...');
    progressBox.classList.remove('hidden');

    try {
      const compressed = await compressSlipImage(
        file,
        CONFIG.SLIP_MAX_WIDTH,
        CONFIG.SLIP_JPEG_QUALITY,
        (info) => updateProgressWidget('slip', { ...info, elapsedSec: 0 })
      );
      state.pendingCompressedSlip = compressed;
      $('slip-preview-img').src = compressed.dataUrl;
      $('slip-preview-meta').textContent = `พร้อมอัปโหลด (${compressed.width}×${compressed.height}px • ประมาณ ${compressed.sizeKB} KB)`;
      $('slip-preview-box').classList.remove('hidden');
      progressBox.classList.add('hidden');
      $('btn-submit-slip').disabled = false;
    } catch (err) {
      state.pendingCompressedSlip = null;
      resetSlipPreviewUi();
      $('slip-upload-error').textContent = err.message;
      $('slip-upload-error').classList.remove('hidden');
    }
  }

  async function handleSubmitSlip() {
    const rec = state.records.find((r) => r.record_id === state.activeBillRecordId);
    if (!rec || !state.pendingCompressedSlip) return;

    const btn = $('btn-submit-slip');
    const progressBox = $('slip-upload-progress-box');
    $('slip-upload-error').classList.add('hidden');

    updateProgressWidget('slip', {
      percent: 30,
      stageText: 'กำลังส่งภาพสลิปไปยัง Google Drive...',
      metaText: `ขนาดไฟล์ประมาณ ${state.pendingCompressedSlip.sizeKB} KB`,
      elapsedSec: 0,
      done: false,
      error: false
    });
    progressBox.classList.remove('hidden');
    setButtonLoading(btn, true, 'กำลังอัปโหลดสลิป...');

    try {
      const res = await api.uploadSlip(
        {
          record_id: rec.record_id,
          cycle_id: rec.cycle_id,
          imageBase64: state.pendingCompressedSlip.base64,
          mimeType: state.pendingCompressedSlip.mimeType
        },
        {
          onProgress: (info) => updateProgressWidget('slip', info)
        }
      );

      const idx = state.records.findIndex((r) => r.record_id === res.record.record_id);
      if (idx !== -1) state.records[idx] = res.record;

      renderHeaderAndCycleSelectors();
      renderBillsView();
      if (state.adminVerified) renderAdminSlipsTab();

      await waitMs(280);
      progressBox.classList.add('hidden');
      closeModal('modal-bill-detail');
      showToast(`ส่งสลิปห้อง ${rec.room_no} เรียบร้อย รอผู้ดูแลตรวจสอบ`, 'success');
    } catch (err) {
      $('slip-upload-error').textContent = err.message || 'อัปโหลดสลิปไม่สำเร็จ กรุณาลองใหม่';
      $('slip-upload-error').classList.remove('hidden');
    } finally {
      setButtonLoading(btn, false);
    }
  }

  function openLightbox(imgUrl, viewUrl, caption) {
    if (!imgUrl) return;
    $('lightbox-img').src = imgUrl;
    $('lightbox-caption').textContent = caption || 'หลักฐานสลิปโอนเงิน';
    const extLink = $('lightbox-external-link');
    extLink.href = viewUrl || imgUrl;
    extLink.classList.toggle('hidden', !viewUrl || viewUrl.startsWith('data:'));
    openModal('modal-lightbox');
  }

  // ============================================================================
  // View 2: Stats & Historical Archive with Real-Time Progress %
  // ============================================================================

  async function loadStats(yearTh = '') {
    resetProgressWidget('stats', 'กำลังดึงข้อมูลสถิติรายปี...');
    $('stats-skeleton').classList.remove('hidden');
    $('stats-error-box').classList.add('hidden');
    $('stats-content').classList.add('hidden');

    try {
      const data = await api.getStats(yearTh, {
        onProgress: (info) => updateProgressWidget('stats', info)
      });
      state.statsData = data;
      state.selectedStatsYear = String(data.selectedYear || '');

      renderStatsView();

      await waitMs(200);
      $('stats-skeleton').classList.add('hidden');
      $('stats-content').classList.remove('hidden');
    } catch (err) {
      await waitMs(200);
      $('stats-skeleton').classList.add('hidden');
      $('stats-error-text').textContent = err.message || 'ไม่สามารถโหลดสถิติได้';
      $('stats-error-box').classList.remove('hidden');
    }
  }

  function renderStatsView() {
    const data = state.statsData;
    if (!data) return;

    const years = data.availableYears || [];
    $('stats-year-select').innerHTML =
      years.length > 0
        ? years
            .map((y) => `<option value="${y}" ${Number(y) === Number(data.selectedYear) ? 'selected' : ''}>พ.ศ. ${y}</option>`)
            .join('')
        : '<option value="">ไม่มีข้อมูล</option>';

    const summary = data.monthlySummary || [];

    let sumTotal = 0;
    let sumWater = 0;
    let sumElectric = 0;
    let sumUnits = 0;
    summary.forEach((m) => {
      sumTotal += m.total_cost;
      sumWater += m.total_water;
      sumElectric += m.total_electric;
      sumUnits += m.total_units;
    });

    $('stats-kpi-total').textContent = fmtMoney(sumTotal);
    $('stats-kpi-water').textContent = fmtMoney(sumWater);
    $('stats-kpi-electric').textContent = fmtMoney(sumElectric);
    $('stats-kpi-units').textContent = fmtNum(sumUnits);

    const houseCanvas = $('chart-house-trend');
    const houseEmpty = $('stats-house-empty');
    if (summary.length === 0) {
      houseCanvas.parentElement.classList.add('hidden');
      houseEmpty.classList.remove('hidden');
    } else {
      houseCanvas.parentElement.classList.remove('hidden');
      houseEmpty.classList.add('hidden');
      renderHouseTrendChart(houseCanvas, summary);
    }

    const residentsList = data.residentsList || [];
    if (!state.selectedStatsResidentId || !residentsList.some((r) => r.resident_id === state.selectedStatsResidentId)) {
      state.selectedStatsResidentId = residentsList.length > 0 ? residentsList[0].resident_id : '';
    }

    $('stats-resident-select').innerHTML =
      residentsList.length > 0
        ? residentsList
            .map((r) => {
              const movedTag = r.status === 'moved_out' ? ' (ย้ายออกแล้ว)' : '';
              const selected = r.resident_id === state.selectedStatsResidentId ? 'selected' : '';
              return `<option value="${escapeHtml(r.resident_id)}" ${selected}>ห้อง ${escapeHtml(r.room_no)} • ${escapeHtml(r.full_name)}${movedTag}</option>`;
            })
            .join('')
        : '<option value="">ไม่พบรายชื่อ</option>';

    renderResidentStatsSection();

    const tbody = $('stats-yearly-tbody');
    const tfoot = $('stats-yearly-tfoot');

    if (summary.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-[#64748B] py-4">ยังไม่มีข้อมูลรอบบิลในปีนี้</td></tr>';
      tfoot.innerHTML = '';
      return;
    }

    tbody.innerHTML = summary
      .map(
        (m) => `
        <tr>
          <td class="whitespace-nowrap">${escapeHtml(m.month_label)}</td>
          <td class="text-center tabular-nums">${fmtNum(m.room_count)}</td>
          <td class="text-right tabular-nums">${fmtNum(m.total_units)}</td>
          <td class="text-right tabular-nums">${fmtMoney(m.total_water)}</td>
          <td class="text-right tabular-nums">${fmtMoney(m.total_electric)}</td>
          <td class="text-right tabular-nums font-semibold">${fmtMoney(m.total_cost)}</td>
          <td class="text-center tabular-nums">${m.paid_count}/${m.room_count} ห้อง</td>
        </tr>
      `
      )
      .join('');

    tfoot.innerHTML = `
      <tr>
        <td colspan="2" class="text-center">รวมทั้งปี พ.ศ. ${escapeHtml(data.selectedYear)}</td>
        <td class="text-right tabular-nums">${fmtNum(sumUnits)}</td>
        <td class="text-right tabular-nums">${fmtMoney(sumWater)}</td>
        <td class="text-right tabular-nums">${fmtMoney(sumElectric)}</td>
        <td class="text-right tabular-nums">${fmtMoney(sumTotal)}</td>
        <td class="text-center">${summary.length} รอบบิล</td>
      </tr>
    `;
  }

  function renderResidentStatsSection() {
    const data = state.statsData;
    if (!data) return;

    const history = (data.residentHistory || []).filter(
      (r) => r.resident_id === state.selectedStatsResidentId
    );

    const canvas = $('chart-resident-trend');
    const emptyEl = $('stats-resident-empty');
    const listEl = $('stats-resident-history-list');

    if (history.length === 0) {
      canvas.parentElement.classList.add('hidden');
      emptyEl.classList.remove('hidden');
      listEl.innerHTML = '';
      return;
    }

    canvas.parentElement.classList.remove('hidden');
    emptyEl.classList.add('hidden');
    renderResidentTrendChart(canvas, history);

    listEl.innerHTML = history
      .slice()
      .reverse()
      .map((rec) => {
        const st = getStatusMeta(rec.payment_status);
        const slipBtn = rec.slip_url
          ? `<button type="button" class="btn btn-secondary btn-compact button-xsm" data-lightbox-url="${escapeHtml(rec.slip_url)}" data-lightbox-view="${escapeHtml(rec.slip_view_url || rec.slip_url)}" data-lightbox-caption="สลิป ${escapeHtml(rec.month_label)} ห้อง ${escapeHtml(rec.room_no)}">
               <i class="ph ph-image text-sm" aria-hidden="true"></i><span>ดูสลิป</span>
             </button>`
          : '';
        return `
          <div class="inner-panel p-3 flex flex-wrap items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="title-4 text-[#0F172A]">${escapeHtml(rec.month_label)} <span class="caption-4 text-[#64748B]">(ห้อง ${escapeHtml(rec.room_no)})</span></div>
              <div class="caption-2 text-[#475569] tabular-nums">
                มิเตอร์ ${fmtNum(rec.prev_meter)} → ${fmtNum(rec.curr_meter)} = ${fmtNum(rec.units_used)} หน่วย • น้ำ ${fmtMoney(rec.water_cost)} + ไฟ ${fmtMoney(rec.electric_cost)}
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span class="title-3 text-[#164873] tabular-nums">${fmtMoney(rec.total_cost)} บาท</span>
              <span class="status-badge ${st.badgeClass} caption-3">${st.label}</span>
              ${slipBtn}
            </div>
          </div>
        `;
      })
      .join('');
  }

  function handleExportYearlyCsv() {
    const data = state.statsData;
    if (!data || !data.monthlySummary || data.monthlySummary.length === 0) {
      showToast('ไม่มีข้อมูลสำหรับ Export CSV', 'error');
      return;
    }

    const rows = [
      ['รอบบิล', 'เดือน', 'จำนวนห้อง', 'หน่วยไฟรวม', 'ค่าน้ำรวม (บาท)', 'ค่าไฟรวม (บาท)', 'รวมสุทธิ (บาท)', 'ชำระแล้ว (ห้อง)', 'ยอดที่เก็บได้ (บาท)', 'สถานะรอบบิล']
    ];

    let sumUnits = 0;
    let sumWater = 0;
    let sumElec = 0;
    let sumTotal = 0;
    let sumPaid = 0;

    data.monthlySummary.forEach((m) => {
      sumUnits += m.total_units;
      sumWater += m.total_water;
      sumElec += m.total_electric;
      sumTotal += m.total_cost;
      sumPaid += m.paid_amount;

      rows.push([
        m.cycle_id,
        m.month_label,
        m.room_count,
        m.total_units,
        m.total_water,
        m.total_electric,
        m.total_cost,
        m.paid_count,
        m.paid_amount,
        m.status
      ]);
    });

    rows.push(['รวมทั้งปี', `พ.ศ. ${data.selectedYear}`, '', sumUnits, sumWater, sumElec, sumTotal, '', sumPaid, '']);

    downloadCsvWithBom(`samsara-summary-${data.selectedYear}.csv`, rows);
    showToast(`ดาวน์โหลดไฟล์สรุปรายปี พ.ศ. ${data.selectedYear} เรียบร้อย`, 'success');
  }

  // ============================================================================
  // View 3: Admin Authentication & Dashboard
  // ============================================================================

  async function renderAdminAccessState() {
    if (state.adminVerified && state.adminPin) {
      $('admin-login-panel').classList.add('hidden');
      $('admin-dashboard-panel').classList.remove('hidden');
      renderAdminDashboard();
      return;
    }

    if (state.adminPin && !state.adminVerified) {
      try {
        await api.verifyPin(state.adminPin);
        state.adminVerified = true;
        $('admin-login-panel').classList.add('hidden');
        $('admin-dashboard-panel').classList.remove('hidden');
        renderAdminDashboard();
        loadResidentsAdmin();
        return;
      } catch (err) {
        setSessionPin('');
        state.adminPin = '';
        state.adminVerified = false;
      }
    }

    $('admin-login-panel').classList.remove('hidden');
    $('admin-dashboard-panel').classList.add('hidden');
  }

  async function handleAdminLoginSubmit(event) {
    event.preventDefault();
    const pinInput = $('input-admin-pin');
    const pin = pinInput.value.trim();
    const errEl = $('admin-login-error');
    const btn = $('btn-admin-login-submit');

    errEl.classList.add('hidden');
    if (!pin) {
      errEl.textContent = 'กรุณากรอกรหัส PIN';
      errEl.classList.remove('hidden');
      pinInput.focus();
      return;
    }

    setButtonLoading(btn, true, 'กำลังตรวจสอบ...');
    try {
      await api.verifyPin(pin);
      state.adminPin = pin;
      state.adminVerified = true;
      setSessionPin(pin);
      pinInput.value = '';

      $('admin-login-panel').classList.add('hidden');
      $('admin-dashboard-panel').classList.remove('hidden');
      renderAdminDashboard();
      loadResidentsAdmin();
      showToast('เข้าสู่โหมดผู้ดูแลระบบเรียบร้อย', 'success');
    } catch (err) {
      errEl.textContent = err.message || 'รหัส PIN ไม่ถูกต้อง';
      errEl.classList.remove('hidden');
      pinInput.select();
    } finally {
      setButtonLoading(btn, false);
    }
  }

  function handleAdminLogout() {
    setSessionPin('');
    state.adminPin = '';
    state.adminVerified = false;
    state.residents = [];
    $('admin-dashboard-panel').classList.add('hidden');
    $('admin-login-panel').classList.remove('hidden');
    showToast('ออกจากโหมดผู้ดูแลระบบแล้ว');
  }

  function handleAuthFailureIfNeeded(err) {
    if (err && err.code === 'INVALID_PIN') {
      handleAdminLogout();
      showToast('รหัส PIN หมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบผู้ดูแลใหม่', 'error');
      return true;
    }
    return false;
  }

  function renderAdminDashboard() {
    const cycle = state.activeCycle;
    const badge = $('admin-cycle-status-badge');
    if (cycle && cycle.status === 'closed') {
      badge.className = 'status-badge status-closed caption-3 shrink-0';
      badge.textContent = 'ปิดรอบแล้ว';
    } else {
      badge.className = 'status-badge status-paid caption-3 shrink-0';
      badge.textContent = 'เปิดรับชำระ';
    }

    renderAdminMetersTab();
    renderAdminSlipsTab();
    renderAdminResidentsTab();
    renderAdminManageTab();
  }

  // ----------------------------------------------------------------------------
  // Admin Sub-Tab 1: Quick Meter Entry
  // ----------------------------------------------------------------------------

  function renderAdminMetersTab() {
    const cycle = state.activeCycle;
    const records = state.records || [];
    const isClosed = !cycle || cycle.status === 'closed';

    $('meters-closed-banner').classList.toggle('hidden', !isClosed || !cycle);
    $('btn-save-meters').disabled = isClosed || records.length === 0;

    if (cycle) {
      $('meters-rate-info').textContent = `เรทคำนวณรอบนี้: ค่าน้ำ ${fmtMoney(cycle.water_rate)} บาท/ห้อง • ค่าไฟ ${fmtMoney(cycle.electric_rate)} บาท/หน่วย`;
    } else {
      $('meters-rate-info').textContent = 'ยังไม่มีรอบบิลที่เลือก';
    }

    const listEl = $('meters-entry-list');
    if (records.length === 0) {
      listEl.innerHTML = '<div class="card p-6 text-center body-6 text-[#64748B]">ยังไม่มีรายการห้องในรอบบิลนี้</div>';
      recalculateLiveMetersSummary();
      return;
    }

    listEl.innerHTML = records
      .map((rec) => {
        return `
          <article class="card p-3 space-y-2" data-meter-row="${escapeHtml(rec.record_id)}">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 min-w-0">
                <span class="px-2 py-0.5 rounded bg-[#EFF6FC] border border-[#BAD6F0] text-[#164873] title-4 tabular-nums shrink-0">ห้อง ${escapeHtml(rec.room_no)}</span>
                <span class="title-3 text-[#0F172A] truncate">${escapeHtml(rec.name_snapshot)}</span>
              </div>
              <span class="caption-4 text-[#64748B] tabular-nums shrink-0">ก่อนหน้า: ${fmtNum(rec.prev_meter)}</span>
            </div>

            <div class="grid grid-cols-2 gap-2 items-end">
              <div class="space-y-1">
                <label for="prev-${escapeHtml(rec.record_id)}" class="caption-4 text-[#475569] block">เลขอ่านก่อน</label>
                <input
                  id="prev-${escapeHtml(rec.record_id)}"
                  type="number"
                  inputmode="numeric"
                  min="0"
                  step="1"
                  value="${rec.prev_meter}"
                  data-meter-prev="${escapeHtml(rec.record_id)}"
                  class="field-input tabular-nums bg-[#F8FAFC]"
                  ${isClosed ? 'disabled' : ''}
                />
              </div>
              <div class="space-y-1">
                <label for="curr-${escapeHtml(rec.record_id)}" class="caption-3 text-[#0F172A] block">เลขอ่านหลัง (มิเตอร์ใหม่)</label>
                <input
                  id="curr-${escapeHtml(rec.record_id)}"
                  type="number"
                  inputmode="numeric"
                  min="0"
                  step="1"
                  value="${rec.curr_meter}"
                  data-meter-curr="${escapeHtml(rec.record_id)}"
                  class="field-input tabular-nums font-semibold"
                  ${isClosed ? 'disabled' : ''}
                />
              </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-2 pt-1 text-sm" data-meter-calc="${escapeHtml(rec.record_id)}">
              <span class="caption-1 text-[#475569] tabular-nums">
                ใช้ <strong class="text-[#0F172A]">${fmtNum(rec.units_used)}</strong> หน่วย • ค่าไฟ <strong class="text-[#0F172A]">${fmtMoney(rec.electric_cost)}</strong> บาท
              </span>
              <span class="title-3 text-[#164873] tabular-nums">รวม ${fmtMoney(rec.total_cost)} บาท</span>
            </div>
            <p class="hidden caption-3 text-[#B91C1C]" data-meter-err="${escapeHtml(rec.record_id)}">
              เลขมิเตอร์ใหม่ต้องไม่น้อยกว่าเลขอ่านก่อน
            </p>
          </article>
        `;
      })
      .join('');

    recalculateLiveMetersSummary();
  }

  function recalculateLiveMetersSummary() {
    const cycle = state.activeCycle;
    const waterRate = cycle ? Number(cycle.water_rate) : 0;
    const electricRate = cycle ? Number(cycle.electric_rate) : 0;
    const isClosed = !cycle || cycle.status === 'closed';

    let sumUnits = 0;
    let sumTotal = 0;
    let hasError = false;

    document.querySelectorAll('[data-meter-row]').forEach((rowEl) => {
      const recId = rowEl.dataset.meterRow;
      const prevInput = rowEl.querySelector(`[data-meter-prev="${recId}"]`);
      const currInput = rowEl.querySelector(`[data-meter-curr="${recId}"]`);
      const calcEl = rowEl.querySelector(`[data-meter-calc="${recId}"]`);
      const errEl = rowEl.querySelector(`[data-meter-err="${recId}"]`);

      const prevVal = Number(prevInput.value);
      const currVal = Number(currInput.value);
      const invalid =
        prevInput.value === '' ||
        currInput.value === '' ||
        !Number.isFinite(prevVal) ||
        !Number.isFinite(currVal) ||
        prevVal < 0 ||
        currVal < prevVal;

      currInput.classList.toggle('is-error', invalid);
      errEl.classList.toggle('hidden', !invalid);

      if (invalid) {
        hasError = true;
        calcEl.innerHTML = '<span class="caption-3 text-[#B91C1C]">กรุณาตรวจสอบเลขมิเตอร์</span><span class="title-4 text-[#B91C1C]">-</span>';
      } else {
        const units = currVal - prevVal;
        const elec = Math.round((units * electricRate + Number.EPSILON) * 100) / 100;
        const total = Math.round((waterRate + elec + Number.EPSILON) * 100) / 100;
        sumUnits += units;
        sumTotal += total;
        calcEl.innerHTML = `
          <span class="caption-1 text-[#475569] tabular-nums">
            ใช้ <strong class="text-[#0F172A]">${fmtNum(units)}</strong> หน่วย • ค่าไฟ <strong class="text-[#0F172A]">${fmtMoney(elec)}</strong> บาท
          </span>
          <span class="title-3 text-[#164873] tabular-nums">รวม ${fmtMoney(total)} บาท</span>
        `;
      }
    });

    $('meters-live-units').textContent = `${fmtNum(sumUnits)} หน่วย`;
    $('meters-live-total').textContent = `${fmtMoney(sumTotal)} บาท`;
    $('meters-validation-summary').classList.toggle('hidden', !hasError);
    $('btn-save-meters').disabled = isClosed || hasError || state.records.length === 0;
  }

  async function handleSaveAllMeters() {
    if (!state.activeCycle) return;

    const items = [];
    let hasInvalid = false;

    document.querySelectorAll('[data-meter-row]').forEach((rowEl) => {
      const recId = rowEl.dataset.meterRow;
      const prevVal = Number(rowEl.querySelector(`[data-meter-prev="${recId}"]`).value);
      const currVal = Number(rowEl.querySelector(`[data-meter-curr="${recId}"]`).value);
      if (!Number.isFinite(prevVal) || !Number.isFinite(currVal) || prevVal < 0 || currVal < prevVal) {
        hasInvalid = true;
      }
      items.push({ record_id: recId, prev_meter: prevVal, curr_meter: currVal });
    });

    if (hasInvalid) {
      showToast('พบเลขมิเตอร์ที่ไม่ถูกต้อง กรุณาตรวจสอบช่องสีแดง', 'error');
      return;
    }

    const btn = $('btn-save-meters');
    setButtonLoading(btn, true, 'กำลังบันทึกมิเตอร์...');

    try {
      const res = await api.saveMeters(state.adminPin, state.activeCycle.cycle_id, items);
      state.records = res.records || [];
      renderHeaderAndCycleSelectors();
      renderBillsView();
      renderAdminDashboard();
      showToast(`บันทึกเลขมิเตอร์ทั้ง ${res.updated_count} ห้องเรียบร้อย`, 'success');
    } catch (err) {
      if (!handleAuthFailureIfNeeded(err)) {
        showToast(err.message || 'บันทึกเลขมิเตอร์ไม่สำเร็จ', 'error');
      }
    } finally {
      setButtonLoading(btn, false);
    }
  }

  // ----------------------------------------------------------------------------
  // Admin Sub-Tab 2: Slip Verification & Manual Cash Payment
  // ----------------------------------------------------------------------------

  function renderAdminSlipsTab() {
    const records = state.records || [];
    const pending = records.filter((r) => r.payment_status === 'pending');
    const unpaid = records.filter((r) => r.payment_status === 'unpaid');
    const paid = records.filter((r) => r.payment_status === 'paid');

    $('slips-pending-count').textContent = `${pending.length} รายการ`;
    $('slips-unpaid-count').textContent = `${unpaid.length} รายการ`;
    $('slips-paid-count').textContent = `${paid.length} รายการ`;

    $('slips-pending-list').innerHTML =
      pending.length > 0
        ? pending
            .map(
              (rec) => `
            <article class="card p-4 space-y-3 border-[#BFDBFE]">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="title-3 text-[#0F172A]">ห้อง ${escapeHtml(rec.room_no)} • ${escapeHtml(rec.name_snapshot)}</div>
                  <div class="caption-2 text-[#64748B] tabular-nums">ส่งสลิปเมื่อ ${fmtDateTimeTh(rec.paid_at)}</div>
                </div>
                <div class="heading-6 text-[#164873] tabular-nums shrink-0">${fmtMoney(rec.total_cost)} บาท</div>
              </div>

              ${
                rec.slip_url
                  ? `<div class="inner-panel p-2 flex items-center gap-3">
                       <img
                         src="${escapeHtml(rec.slip_url)}"
                         alt="สลิปห้อง ${escapeHtml(rec.room_no)}"
                         class="w-20 h-24 object-cover rounded-lg border border-[#CBD5E1] cursor-pointer shrink-0 bg-white"
                         data-lightbox-url="${escapeHtml(rec.slip_url)}"
                         data-lightbox-view="${escapeHtml(rec.slip_view_url || rec.slip_url)}"
                         data-lightbox-caption="สลิปห้อง ${escapeHtml(rec.room_no)} • ${escapeHtml(rec.name_snapshot)} (${fmtMoney(rec.total_cost)} บาท)"
                       />
                       <div class="space-y-2 flex-1 min-w-0">
                         <p class="caption-1 text-[#334155]">แตะรูปภาพเพื่อขยายดูยอดโอนเต็มจอ</p>
                         <button
                           type="button"
                           class="btn btn-secondary btn-compact button-xsm"
                           data-lightbox-url="${escapeHtml(rec.slip_url)}"
                           data-lightbox-view="${escapeHtml(rec.slip_view_url || rec.slip_url)}"
                           data-lightbox-caption="สลิปห้อง ${escapeHtml(rec.room_no)} • ${escapeHtml(rec.name_snapshot)} (${fmtMoney(rec.total_cost)} บาท)"
                         >
                           <i class="ph ph-magnifying-glass-plus text-sm" aria-hidden="true"></i>
                           <span>ขยายดูสลิปเต็มจอ</span>
                         </button>
                       </div>
                     </div>`
                  : ''
              }

              <div class="grid grid-cols-2 gap-2">
                <button type="button" class="btn btn-danger-outline button-sm" data-reject-slip="${escapeHtml(rec.record_id)}">
                  <i class="ph ph-x-circle text-base" aria-hidden="true"></i>
                  <span>ตีกลับสลิป</span>
                </button>
                <button type="button" class="btn btn-success button-sm" data-approve-slip="${escapeHtml(rec.record_id)}">
                  <i class="ph ph-check-circle text-base" aria-hidden="true"></i>
                  <span>อนุมัติชำระแล้ว</span>
                </button>
              </div>
            </article>
          `
            )
            .join('')
        : '<div class="card p-4 text-center body-6 text-[#64748B]">ไม่มีรายการรอตรวจสลิปในขณะนี้</div>';

    $('slips-unpaid-list').innerHTML =
      unpaid.length > 0
        ? unpaid
            .map(
              (rec) => `
            <article class="card p-3 flex flex-wrap items-center justify-between gap-2">
              <div class="min-w-0 flex-1">
                <div class="title-4 text-[#0F172A] truncate">ห้อง ${escapeHtml(rec.room_no)} • ${escapeHtml(rec.name_snapshot)}</div>
                <div class="caption-4 text-[#64748B] tabular-nums">ยอดค้างชำระ ${fmtMoney(rec.total_cost)} บาท${rec.reject_reason ? ` • ตีกลับ: ${escapeHtml(rec.reject_reason)}` : ''}</div>
              </div>
              <button type="button" class="btn btn-secondary btn-compact button-xsm shrink-0" data-mark-cash="${escapeHtml(rec.record_id)}">
                <i class="ph ph-money text-base" aria-hidden="true"></i>
                <span>บันทึกจ่ายเงินสด</span>
              </button>
            </article>
          `
            )
            .join('')
        : '<div class="card p-4 text-center body-6 text-[#64748B]">ไม่มีรายการค้างชำระในรอบนี้</div>';

    $('slips-paid-list').innerHTML =
      paid.length > 0
        ? paid
            .map(
              (rec) => `
            <article class="card p-3 flex flex-wrap items-center justify-between gap-2">
              <div class="min-w-0 flex-1">
                <div class="title-4 text-[#0F172A] truncate">ห้อง ${escapeHtml(rec.room_no)} • ${escapeHtml(rec.name_snapshot)}</div>
                <div class="caption-4 text-[#047857] tabular-nums">
                  ชำระแล้ว ${fmtMoney(rec.total_cost)} บาท ${rec.verified_at ? `• ตรวจเมื่อ ${fmtDateTimeTh(rec.verified_at)}` : ''}
                </div>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                ${
                  rec.slip_url
                    ? `<button type="button" class="btn btn-secondary btn-compact button-xsm" data-lightbox-url="${escapeHtml(rec.slip_url)}" data-lightbox-view="${escapeHtml(rec.slip_view_url || rec.slip_url)}" data-lightbox-caption="สลิปห้อง ${escapeHtml(rec.room_no)} • ${escapeHtml(rec.name_snapshot)}">
                         <i class="ph ph-image text-sm" aria-hidden="true"></i><span>ดูสลิป</span>
                       </button>`
                    : '<span class="caption-5 text-[#64748B] px-2">จ่ายเงินสด</span>'
                }
                <button type="button" class="btn btn-secondary btn-compact button-xsm text-[#C2410C]" data-revert-unpaid="${escapeHtml(rec.record_id)}">
                  <span>ยกเลิกสถานะ</span>
                </button>
              </div>
            </article>
          `
            )
            .join('')
        : '<div class="card p-4 text-center body-6 text-[#64748B]">ยังไม่มีรายการที่ชำระเงินแล้ว</div>';
  }

  async function submitVerifyPayment({ record_id, decision, reject_reason = '', is_manual = false }, triggerBtn = null) {
    if (triggerBtn) setButtonLoading(triggerBtn, true, 'กำลังบันทึก...');
    try {
      const res = await api.verifyPayment(state.adminPin, { record_id, decision, reject_reason, is_manual });
      const idx = state.records.findIndex((r) => r.record_id === res.record.record_id);
      if (idx !== -1) state.records[idx] = res.record;

      renderHeaderAndCycleSelectors();
      renderBillsView();
      renderAdminSlipsTab();

      if (decision === 'paid') {
        showToast(is_manual ? 'บันทึกชำระเงินสดเรียบร้อย' : 'อนุมัติสลิปเรียบร้อย', 'success');
      } else {
        showToast('ปรับสถานะเป็นรอชำระเรียบร้อย', 'success');
      }
    } catch (err) {
      if (!handleAuthFailureIfNeeded(err)) {
        showToast(err.message || 'อัปเดตสถานะไม่สำเร็จ', 'error');
      }
    } finally {
      if (triggerBtn) setButtonLoading(triggerBtn, false);
    }
  }

  // ----------------------------------------------------------------------------
  // Admin Sub-Tab 3: Resident Management (Active & Moved Out)
  // ----------------------------------------------------------------------------

  async function loadResidentsAdmin() {
    if (!state.adminVerified) return;
    try {
      const res = await api.getResidents(state.adminPin);
      state.residents = res.residents || [];
      renderAdminResidentsTab();
    } catch (err) {
      if (!handleAuthFailureIfNeeded(err)) {
        showToast(err.message || 'โหลดรายชื่อผู้พักอาศัยไม่สำเร็จ', 'error');
      }
    }
  }

  function renderAdminResidentsTab() {
    const activeList = state.residents.filter((r) => r.status === 'active');
    const movedList = state.residents.filter((r) => r.status === 'moved_out');

    $('res-count-active').textContent = String(activeList.length);
    $('res-count-moved').textContent = String(movedList.length);

    const list = state.residentFilter === 'active' ? activeList : movedList;
    const container = $('residents-list-container');

    if (list.length === 0) {
      container.innerHTML =
        state.residentFilter === 'active'
          ? '<div class="card p-6 text-center body-6 text-[#64748B]">ยังไม่มีรายชื่อครูที่พักอาศัยอยู่ปัจจุบัน</div>'
          : '<div class="card p-6 text-center body-6 text-[#64748B]">ยังไม่มีประวัติผู้ย้ายออก</div>';
      return;
    }

    container.innerHTML = list
      .map((res) => {
        const isActive = res.status === 'active';
        return `
          <article class="card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div class="space-y-1 min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span class="px-2 py-0.5 rounded bg-[#EFF6FC] border border-[#BAD6F0] text-[#164873] title-4 tabular-nums">ห้อง ${escapeHtml(res.room_no)}</span>
                <span class="title-3 text-[#0F172A]">${escapeHtml(res.full_name)}</span>
                <span class="caption-5 text-[#64748B] tabular-nums">(${escapeHtml(res.resident_id)})</span>
              </div>
              <div class="caption-2 text-[#475569] tabular-nums flex flex-wrap gap-x-3 gap-y-1">
                <span>ย้ายเข้า: ${escapeHtml(res.move_in_date || '-')}</span>
                ${!isActive ? `<span>ย้ายออก: ${escapeHtml(res.move_out_date || '-')}</span>` : ''}
                <span>มิเตอร์เริ่มต้น: ${fmtNum(res.initial_meter)}</span>
              </div>
              ${res.note ? `<p class="caption-4 text-[#64748B]">หมายเหตุ: ${escapeHtml(res.note)}</p>` : ''}
            </div>

            ${
              isActive
                ? `<div class="flex items-center gap-2 shrink-0">
                     <button type="button" class="btn btn-secondary btn-compact button-xsm" data-edit-resident="${escapeHtml(res.resident_id)}">
                       <i class="ph ph-pencil-simple text-sm" aria-hidden="true"></i>
                       <span>แก้ไข</span>
                     </button>
                     <button type="button" class="btn btn-danger-outline btn-compact button-xsm" data-moveout-resident="${escapeHtml(res.resident_id)}">
                       <i class="ph ph-sign-out text-sm" aria-hidden="true"></i>
                       <span>แจ้งย้ายออก</span>
                     </button>
                   </div>`
                : '<span class="status-badge status-closed caption-3 shrink-0">ย้ายออกแล้ว (เก็บประวัติถาวร)</span>'
            }
          </article>
        `;
      })
      .join('');
  }

  function openAddResidentModal() {
    $('resident-modal-title').textContent = 'เพิ่มครูย้ายเข้า';
    $('res-form-id').value = '';
    $('res-form-room').value = '';
    $('res-form-name').value = '';
    $('res-form-move-in').value = getTodayYmd();
    $('res-form-initial-meter').value = '';
    $('res-form-note').value = '';
    $('res-form-add-open').checked = false;

    $('res-form-move-in-wrap').classList.remove('hidden');
    const hasOpenCycle = state.cycles.some((c) => c.status === 'open');
    $('res-form-add-open-wrap').classList.toggle('hidden', !hasOpenCycle);
    $('res-form-error').classList.add('hidden');
    openModal('modal-resident-form');
  }

  function openEditResidentModal(residentId) {
    const res = state.residents.find((r) => r.resident_id === residentId);
    if (!res) return;

    $('resident-modal-title').textContent = `แก้ไขข้อมูล (${res.resident_id})`;
    $('res-form-id').value = res.resident_id;
    $('res-form-room').value = res.room_no;
    $('res-form-name').value = res.full_name;
    $('res-form-move-in').value = res.move_in_date || getTodayYmd();
    $('res-form-initial-meter').value = res.initial_meter;
    $('res-form-note').value = res.note || '';

    $('res-form-move-in-wrap').classList.add('hidden');
    $('res-form-add-open-wrap').classList.add('hidden');
    $('res-form-error').classList.add('hidden');
    openModal('modal-resident-form');
  }

  async function handleSubmitResidentForm(event) {
    event.preventDefault();
    const id = $('res-form-id').value.trim();
    const roomNo = $('res-form-room').value.trim();
    const fullName = $('res-form-name').value.trim();
    const moveInDate = $('res-form-move-in').value;
    const initialMeter = Number($('res-form-initial-meter').value);
    const note = $('res-form-note').value.trim();
    const addToOpenCycle = $('res-form-add-open').checked;
    const errEl = $('res-form-error');
    const btn = $('btn-submit-resident');

    errEl.classList.add('hidden');
    if (!roomNo || !fullName || !Number.isFinite(initialMeter) || initialMeter < 0) {
      errEl.textContent = 'กรุณากรอกเลขห้อง ชื่อ-สกุล และเลขมิเตอร์เริ่มต้นให้ถูกต้อง';
      errEl.classList.remove('hidden');
      return;
    }

    setButtonLoading(btn, true, 'กำลังบันทึก...');
    try {
      if (id) {
        await api.updateResident(state.adminPin, {
          resident_id: id,
          room_no: roomNo,
          full_name: fullName,
          initial_meter: initialMeter,
          note
        });
        showToast('อัปเดตข้อมูลผู้พักอาศัยเรียบร้อย', 'success');
      } else {
        const res = await api.addResident(state.adminPin, {
          room_no: roomNo,
          full_name: fullName,
          move_in_date: moveInDate,
          initial_meter: initialMeter,
          note,
          add_to_open_cycle: addToOpenCycle
        });
        showToast(
          res.added_to_cycle_id
            ? `เพิ่ม ${fullName} และเพิ่มเข้าบิลรอบ ${res.added_to_cycle_id} เรียบร้อย`
            : `เพิ่ม ${fullName} เข้าระบบเรียบร้อย`,
          'success'
        );
        if (res.added_to_cycle_id && state.activeCycle && state.activeCycle.cycle_id === res.added_to_cycle_id) {
          await loadDashboard(state.activeCycle.cycle_id);
        }
      }

      await loadResidentsAdmin();
      closeModal('modal-resident-form');
    } catch (err) {
      if (!handleAuthFailureIfNeeded(err)) {
        errEl.textContent = err.message || 'บันทึกข้อมูลไม่สำเร็จ';
        errEl.classList.remove('hidden');
      }
    } finally {
      setButtonLoading(btn, false);
    }
  }

  function openMoveOutModal(residentId) {
    const res = state.residents.find((r) => r.resident_id === residentId);
    if (!res) return;
    $('moveout-resident-id').value = res.resident_id;
    $('moveout-target-name').textContent = `ห้อง ${res.room_no} • ${res.full_name} (${res.resident_id})`;
    $('moveout-date').value = getTodayYmd();
    $('moveout-note').value = res.note || '';
    openModal('modal-move-out');
  }

  async function handleSubmitMoveOut(event) {
    event.preventDefault();
    const residentId = $('moveout-resident-id').value;
    const moveOutDate = $('moveout-date').value;
    const note = $('moveout-note').value.trim();
    const btn = $('btn-confirm-moveout');

    setButtonLoading(btn, true, 'กำลังบันทึก...');
    try {
      await api.moveOutResident(state.adminPin, {
        resident_id: residentId,
        move_out_date: moveOutDate,
        note
      });
      await loadResidentsAdmin();
      closeModal('modal-move-out');
      showToast('บันทึกการย้ายออกเรียบร้อย ประวัติเก่าทั้งหมดยังอยู่ครบถ้วน', 'success');
    } catch (err) {
      if (!handleAuthFailureIfNeeded(err)) {
        showToast(err.message || 'บันทึกการย้ายออกไม่สำเร็จ', 'error');
      }
    } finally {
      setButtonLoading(btn, false);
    }
  }

  // ----------------------------------------------------------------------------
  // Admin Sub-Tab 4: Cycles, Reports (LINE / Print / CSV) & Settings
  // ----------------------------------------------------------------------------

  function renderAdminManageTab() {
    const cycle = state.activeCycle;
    const settings = state.settings || {};

    if (cycle) {
      $('edit-cycle-label').textContent = `${cycle.month_label} (${cycle.cycle_id})`;
      $('edit-cycle-due-date').value = cycle.due_date || '';
      $('edit-cycle-water-rate').value = cycle.water_rate;
      $('edit-cycle-electric-rate').value = cycle.electric_rate;
      $('edit-cycle-status').value = cycle.status || 'open';
    }

    $('set-house-name').value = settings.house_name || '';
    $('set-bank-name').value = settings.bank_name || '';
    $('set-bank-account-no').value = settings.bank_account_no || '';
    $('set-bank-account-name').value = settings.bank_account_name || '';
    $('set-promptpay-id').value = settings.promptpay_id || '';
    $('set-default-water-rate').value = settings.default_water_rate ?? 75;
    $('set-default-electric-rate').value = settings.default_electric_rate ?? 7;
    $('set-new-pin').value = '';
    $('set-confirm-pin').value = '';
    $('settings-form-error').classList.add('hidden');
  }

  async function openCreateCycleModal() {
    if (state.residents.length === 0) {
      await loadResidentsAdmin();
    }

    let nextYearCe = new Date().getFullYear();
    let nextMonthNum = new Date().getMonth() + 1;

    if (state.cycles.length > 0) {
      const match = state.cycles[0].cycle_id.match(/^(\d{4})-(\d{2})$/);
      if (match) {
        nextYearCe = parseInt(match[1], 10);
        nextMonthNum = parseInt(match[2], 10) + 1;
        if (nextMonthNum > 12) {
          nextMonthNum = 1;
          nextYearCe += 1;
        }
      }
    }

    const nextMonthStr = String(nextMonthNum).padStart(2, '0');
    const nextYearTh = nextYearCe + 543;

    $('new-cycle-month').innerHTML = THAI_MONTHS.map(
      (m) => `<option value="${m.num}" ${m.num === nextMonthStr ? 'selected' : ''}>${m.label}</option>`
    ).join('');
    $('new-cycle-year-th').value = nextYearTh;

    const settings = state.settings || {};
    $('new-cycle-water-rate').value = settings.default_water_rate ?? 75;
    $('new-cycle-electric-rate').value = settings.default_electric_rate ?? 7;

    updateNewCyclePreviewFields();

    const activeRes = state.residents.filter((r) => r.status === 'active');
    const previewEl = $('new-cycle-residents-preview');
    if (activeRes.length === 0) {
      previewEl.innerHTML = '<p class="text-[#B91C1C]">ไม่พบรายชื่อครูที่พักอาศัยอยู่ปัจจุบัน</p>';
    } else {
      previewEl.innerHTML = activeRes
        .map(
          (r) => `<div class="flex justify-between gap-2 py-0.5 border-b border-[#E2E8F0] last:border-b-0">
                    <span>ห้อง ${escapeHtml(r.room_no)} • ${escapeHtml(r.full_name)}</span>
                    <span class="text-[#64748B] tabular-nums">${escapeHtml(r.resident_id)}</span>
                  </div>`
        )
        .join('');
    }

    $('create-cycle-error').classList.add('hidden');
    openModal('modal-create-cycle');
  }

  function updateNewCyclePreviewFields() {
    const monthNum = $('new-cycle-month').value || '01';
    const yearTh = Number($('new-cycle-year-th').value) || 2569;
    const yearCe = yearTh - 543;
    const monthObj = THAI_MONTHS.find((m) => m.num === monthNum) || THAI_MONTHS[0];

    $('new-cycle-id-preview').textContent = `${yearCe}-${monthNum}`;
    $('new-cycle-due-date').value = `28 ${monthObj.label} ${yearTh}`;
  }

  async function handleSubmitCreateCycle(event) {
    event.preventDefault();
    const monthNum = $('new-cycle-month').value;
    const yearTh = Number($('new-cycle-year-th').value);
    const yearCe = yearTh - 543;
    const monthObj = THAI_MONTHS.find((m) => m.num === monthNum);
    const cycleId = `${yearCe}-${monthNum}`;
    const monthLabel = `${monthObj ? monthObj.label : monthNum} ${yearTh}`;
    const dueDate = $('new-cycle-due-date').value.trim();
    const waterRate = Number($('new-cycle-water-rate').value);
    const electricRate = Number($('new-cycle-electric-rate').value);

    const errEl = $('create-cycle-error');
    const btn = $('btn-confirm-create-cycle');
    errEl.classList.add('hidden');

    setButtonLoading(btn, true, 'กำลังสร้างรอบบิล...');
    try {
      await api.createCycle(state.adminPin, {
        cycle_id: cycleId,
        year_th: yearTh,
        month_label: monthLabel,
        due_date: dueDate,
        water_rate: waterRate,
        electric_rate: electricRate
      });

      closeModal('modal-create-cycle');
      await loadDashboard(cycleId);
      switchAdminTab('meters');
      showToast(`สร้างรอบบิล ${monthLabel} และดึงเลขมิเตอร์เดิมเรียบร้อย`, 'success');
    } catch (err) {
      if (!handleAuthFailureIfNeeded(err)) {
        errEl.textContent = err.message || 'สร้างรอบบิลไม่สำเร็จ';
        errEl.classList.remove('hidden');
      }
    } finally {
      setButtonLoading(btn, false);
    }
  }

  async function handleSubmitUpdateCycle(event) {
    event.preventDefault();
    if (!state.activeCycle) return;

    const btn = $('btn-save-cycle');
    setButtonLoading(btn, true, 'กำลังบันทึก...');

    try {
      const res = await api.updateCycle(state.adminPin, {
        cycle_id: state.activeCycle.cycle_id,
        due_date: $('edit-cycle-due-date').value.trim(),
        water_rate: Number($('edit-cycle-water-rate').value),
        electric_rate: Number($('edit-cycle-electric-rate').value),
        status: $('edit-cycle-status').value
      });

      state.activeCycle = res.cycle;
      state.records = res.records || [];
      const idx = state.cycles.findIndex((c) => c.cycle_id === res.cycle.cycle_id);
      if (idx !== -1) state.cycles[idx] = res.cycle;

      renderHeaderAndCycleSelectors();
      renderBillsView();
      renderAdminDashboard();
      showToast('บันทึกการตั้งค่ารอบบิลเรียบร้อย', 'success');
    } catch (err) {
      if (!handleAuthFailureIfNeeded(err)) {
        showToast(err.message || 'อัปเดตรอบบิลไม่สำเร็จ', 'error');
      }
    } finally {
      setButtonLoading(btn, false);
    }
  }

  async function handleSubmitUpdateSettings(event) {
    event.preventDefault();
    const errEl = $('settings-form-error');
    const btn = $('btn-save-settings');
    errEl.classList.add('hidden');

    const newPin = $('set-new-pin').value.trim();
    const confirmPin = $('set-confirm-pin').value.trim();

    if (newPin || confirmPin) {
      if (newPin.length < 4 || newPin.length > 12) {
        errEl.textContent = 'รหัส PIN ใหม่ต้องมีความยาวระหว่าง 4 ถึง 12 ตัวอักษร';
        errEl.classList.remove('hidden');
        return;
      }
      if (newPin !== confirmPin) {
        errEl.textContent = 'รหัส PIN ใหม่และการยืนยันไม่ตรงกัน';
        errEl.classList.remove('hidden');
        return;
      }
    }

    const settingsPayload = {
      house_name: $('set-house-name').value.trim(),
      bank_name: $('set-bank-name').value.trim(),
      bank_account_no: $('set-bank-account-no').value.trim(),
      bank_account_name: $('set-bank-account-name').value.trim(),
      promptpay_id: $('set-promptpay-id').value.trim(),
      default_water_rate: Number($('set-default-water-rate').value),
      default_electric_rate: Number($('set-default-electric-rate').value)
    };

    setButtonLoading(btn, true, 'กำลังบันทึก...');
    try {
      const res = await api.updateSettings(state.adminPin, settingsPayload, newPin);
      state.settings = res.settings;

      if (res.pin_changed && newPin) {
        state.adminPin = newPin;
        setSessionPin(newPin);
      }

      renderHeaderAndCycleSelectors();
      renderBillsView();
      renderAdminManageTab();
      showToast(res.pin_changed ? 'บันทึกการตั้งค่าและเปลี่ยนรหัส PIN เรียบร้อย' : 'บันทึกการตั้งค่าระบบเรียบร้อย', 'success');
    } catch (err) {
      if (!handleAuthFailureIfNeeded(err)) {
        errEl.textContent = err.message || 'บันทึกการตั้งค่าไม่สำเร็จ';
        errEl.classList.remove('hidden');
      }
    } finally {
      setButtonLoading(btn, false);
    }
  }

  // ----------------------------------------------------------------------------
  // LINE Summary Generator & School Print Sheet / CSV
  // ----------------------------------------------------------------------------

  function openLineSummaryModal() {
    const cycle = state.activeCycle;
    const settings = state.settings || {};
    const records = state.records || [];
    if (!cycle) {
      showToast('ยังไม่มีข้อมูลรอบบิล', 'error');
      return;
    }

    let totalWater = 0;
    let totalElec = 0;
    let grandTotal = 0;

    const lines = [
      `แจ้งยอดค่าน้ำและค่าไฟ ${settings.house_name || 'บ้านพักครู (สามสาระ)'}`,
      `ประจำเดือน ${cycle.month_label}`,
      `กำหนดชำระภายในวันที่ ${cycle.due_date}`,
      ''
    ];

    records.forEach((rec, idx) => {
      totalWater += rec.water_cost;
      totalElec += rec.electric_cost;
      grandTotal += rec.total_cost;
      const statusMark = rec.payment_status === 'paid' ? ' [ชำระแล้ว]' : rec.payment_status === 'pending' ? ' [รอตรวจสลิป]' : '';
      lines.push(`${idx + 1}. ห้อง ${rec.room_no} ${rec.name_snapshot} : ${fmtMoney(rec.total_cost)} บาท (${fmtNum(rec.units_used)} หน่วย)${statusMark}`);
    });

    lines.push('');
    lines.push(`รวมยอดส่งโรงเรียน: ${fmtMoney(grandTotal)} บาท (ค่าน้ำ ${fmtMoney(totalWater)} + ค่าไฟ ${fmtMoney(totalElec)})`);
    lines.push('');
    lines.push('ช่องทางโอนเงิน:');
    lines.push(`${settings.bank_name || ''} เลขที่บัญชี ${settings.bank_account_no || ''}`);
    lines.push(`ชื่อบัญชี ${settings.bank_account_name || ''}`);
    if (window.location.protocol.startsWith('http')) {
      lines.push('');
      lines.push('ตรวจสอบรายละเอียดและแนบสลิปได้ที่:');
      lines.push(window.location.href.split('#')[0]);
    }

    $('line-summary-textarea').value = lines.join('\n');
    openModal('modal-line-summary');
  }

  function buildSchoolReportHtml() {
    const cycle = state.activeCycle;
    const settings = state.settings || {};
    const records = state.records || [];
    if (!cycle) return '';

    let sumWater = 0;
    let sumElec = 0;
    let sumTotal = 0;
    let sumUnits = 0;

    const bodyRows = records
      .map((rec, index) => {
        sumWater += rec.water_cost;
        sumElec += rec.electric_cost;
        sumTotal += rec.total_cost;
        sumUnits += rec.units_used;

        return `
          <tr>
            <td class="text-center tabular-nums">${index + 1}</td>
            <td class="whitespace-nowrap">${escapeHtml(rec.name_snapshot)}</td>
            <td class="text-right tabular-nums">${fmtMoney(rec.water_cost)}</td>
            <td class="text-right tabular-nums">${fmtMoney(rec.electric_cost)}</td>
            <td class="text-right tabular-nums font-semibold">${fmtMoney(rec.total_cost)}</td>
            <td class="text-right tabular-nums">${fmtNum(rec.prev_meter)}</td>
            <td class="text-right tabular-nums">${fmtNum(rec.curr_meter)}</td>
            <td class="text-right tabular-nums">${fmtNum(rec.units_used)}</td>
            <td class="text-right tabular-nums">${fmtMoney(cycle.electric_rate)}</td>
            <td class="text-right tabular-nums">${fmtMoney(rec.electric_cost)}</td>
          </tr>
        `;
      })
      .join('');

    return `
      <div class="print-title">ตารางสรุปค่าน้ำและค่าไฟ ${escapeHtml(settings.house_name || 'บ้านพักครู (สามสาระ)')}</div>
      <div class="print-subtitle">ประจำเดือน ${escapeHtml(cycle.month_label)} • กำหนดชำระวันที่ ${escapeHtml(cycle.due_date)}</div>
      <table class="school-table">
        <thead>
          <tr>
            <th>ลำดับ</th>
            <th>รายชื่อครู</th>
            <th>ค่าน้ำ</th>
            <th>ค่าไฟ</th>
            <th>รวม</th>
            <th>เลขอ่านก่อน</th>
            <th>เลขอ่านหลัง</th>
            <th>หน่วยที่ใช้</th>
            <th>ค่าไฟ/หน่วย</th>
            <th>ค่าไฟ</th>
          </tr>
        </thead>
        <tbody>
          ${bodyRows}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="2" class="text-center">จ่ายโรงเรียน</td>
            <td class="text-right tabular-nums">${fmtMoney(sumWater)}</td>
            <td class="text-right tabular-nums">${fmtMoney(sumElec)}</td>
            <td class="text-right tabular-nums">${fmtMoney(sumTotal)}</td>
            <td colspan="2"></td>
            <td class="text-right tabular-nums">${fmtNum(sumUnits)}</td>
            <td class="text-right tabular-nums">${fmtMoney(cycle.electric_rate)}</td>
            <td class="text-right tabular-nums">${fmtMoney(sumElec)}</td>
          </tr>
        </tfoot>
      </table>
      <div class="print-footer mt-4 p-3 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] caption-1 text-[#334155]">
        <div>
          <strong>หมายเหตุการโอนชำระ:</strong> ${escapeHtml(settings.bank_account_name || '')} •
          เลขที่บัญชี <span class="tabular-nums">${escapeHtml(settings.bank_account_no || '')}</span>
          (${escapeHtml(settings.bank_name || '')})
        </div>
        <div>กำหนดชำระ: ${escapeHtml(cycle.due_date)}</div>
      </div>
    `;
  }

  function openSchoolReportModal() {
    if (!state.activeCycle) {
      showToast('ยังไม่มีข้อมูลรอบบิล', 'error');
      return;
    }
    const html = buildSchoolReportHtml();
    $('school-report-title').textContent = `ตารางสรุปยอดส่งโรงเรียน — ${state.activeCycle.month_label}`;
    $('school-report-table-wrap').innerHTML = html;
    $('print-sheet-root').innerHTML = html;
    openModal('modal-school-report');
  }

  function handleExportMonthCsv() {
    const cycle = state.activeCycle;
    const records = state.records || [];
    if (!cycle || records.length === 0) return;

    let sumWater = 0;
    let sumElec = 0;
    let sumTotal = 0;
    let sumUnits = 0;

    const rows = [
      ['ลำดับ', 'ห้อง', 'รายชื่อครู', 'ค่าน้ำ', 'ค่าไฟ', 'รวม', 'เลขอ่านก่อน', 'เลขอ่านหลัง', 'หน่วยที่ใช้', 'ค่าไฟ/หน่วย', 'ค่าไฟ', 'สถานะการชำระ']
    ];

    records.forEach((rec, idx) => {
      sumWater += rec.water_cost;
      sumElec += rec.electric_cost;
      sumTotal += rec.total_cost;
      sumUnits += rec.units_used;
      rows.push([
        idx + 1,
        rec.room_no,
        rec.name_snapshot,
        rec.water_cost,
        rec.electric_cost,
        rec.total_cost,
        rec.prev_meter,
        rec.curr_meter,
        rec.units_used,
        cycle.electric_rate,
        rec.electric_cost,
        getStatusMeta(rec.payment_status).label
      ]);
    });

    rows.push(['', '', 'จ่ายโรงเรียน', sumWater, sumElec, sumTotal, '', '', sumUnits, cycle.electric_rate, sumElec, '']);
    downloadCsvWithBom(`samsara-school-report-${cycle.cycle_id}.csv`, rows);
    showToast(`ดาวน์โหลดตารางรอบ ${cycle.month_label} เรียบร้อย`, 'success');
  }

  // ============================================================================
  // Event Binding & Initialization
  // ============================================================================

  function bindEvents() {
    document.querySelectorAll('[data-nav-view]').forEach((btn) => {
      btn.addEventListener('click', () => switchView(btn.dataset.navView));
    });

    $('btn-reset-mock').addEventListener('click', () => {
      openConfirmDialog({
        title: 'รีเซ็ตข้อมูลจำลอง',
        message: 'ข้อมูลจำลองที่แก้ไขไว้ในเบราว์เซอร์นี้จะกลับเป็นค่าเริ่มต้น (รอบบิล พ.ย. 2569 และ ต.ค. 2569)',
        confirmLabel: 'รีเซ็ตข้อมูล',
        confirmVariant: 'danger',
        onConfirm: async () => {
          api.resetMockDatabase();
          state.residents = [];
          await loadDashboard();
          if (state.currentView === 'stats') await loadStats();
          if (state.adminVerified) await loadResidentsAdmin();
          showToast('รีเซ็ตข้อมูลจำลองเรียบร้อย', 'success');
        }
      });
    });

    $('bills-cycle-select').addEventListener('change', (e) => loadDashboard(e.target.value));
    $('btn-refresh-bills').addEventListener('click', () => loadDashboard($('bills-cycle-select').value));
    $('btn-retry-bills').addEventListener('click', () => loadDashboard($('bills-cycle-select').value));

    $('btn-copy-account').addEventListener('click', () => {
      const accNo = (state.settings && state.settings.bank_account_no) || '';
      if (!accNo) return;
      copyToClipboard(accNo, `คัดลอกเลขบัญชี ${accNo} เรียบร้อย`);
    });

    document.querySelectorAll('[data-bill-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.billFilter = btn.dataset.billFilter;
        document.querySelectorAll('[data-bill-filter]').forEach((el) => {
          el.classList.toggle('is-active', el.dataset.billFilter === state.billFilter);
        });
        renderBillsView();
      });
    });

    $('bills-card-list').addEventListener('click', (e) => {
      const card = e.target.closest('[data-open-bill]');
      if (card) openBillDetailModal(card.dataset.openBill);
    });

    $('bills-card-list').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const card = e.target.closest('[data-open-bill]');
        if (card) {
          e.preventDefault();
          openBillDetailModal(card.dataset.openBill);
        }
      }
    });

    $('input-slip-file').addEventListener('change', handleSlipFileSelected);
    $('btn-clear-slip-preview').addEventListener('click', () => {
      state.pendingCompressedSlip = null;
      resetSlipPreviewUi();
    });
    $('btn-submit-slip').addEventListener('click', handleSubmitSlip);
    $('bill-modal-slip-img').addEventListener('click', () => {
      const rec = state.records.find((r) => r.record_id === state.activeBillRecordId);
      if (rec && rec.slip_url) {
        openLightbox(rec.slip_url, rec.slip_view_url, `สลิปห้อง ${rec.room_no} • ${rec.name_snapshot}`);
      }
    });

    $('stats-year-select').addEventListener('change', (e) => {
      state.selectedStatsYear = e.target.value;
      loadStats(state.selectedStatsYear);
    });
    $('btn-retry-stats').addEventListener('click', () => loadStats(state.selectedStatsYear));
    $('btn-export-yearly-csv').addEventListener('click', handleExportYearlyCsv);
    $('stats-resident-select').addEventListener('change', (e) => {
      state.selectedStatsResidentId = e.target.value;
      renderResidentStatsSection();
    });

    $('form-admin-login').addEventListener('submit', handleAdminLoginSubmit);
    $('btn-toggle-pin-visibility').addEventListener('click', () => {
      const input = $('input-admin-pin');
      const isPass = input.type === 'password';
      input.type = isPass ? 'text' : 'password';
      $('btn-toggle-pin-visibility').innerHTML = `<i class="ph ${isPass ? 'ph-eye-slash' : 'ph-eye'} text-lg" aria-hidden="true"></i>`;
    });
    $('btn-admin-logout').addEventListener('click', handleAdminLogout);

    $('admin-cycle-select').addEventListener('change', (e) => loadDashboard(e.target.value));

    document.querySelectorAll('[data-admin-tab]').forEach((btn) => {
      btn.addEventListener('click', () => switchAdminTab(btn.dataset.adminTab));
    });

    $('btn-goto-reopen-cycle').addEventListener('click', () => switchAdminTab('manage'));
    $('meters-entry-list').addEventListener('input', (e) => {
      if (e.target.matches('[data-meter-prev], [data-meter-curr]')) {
        recalculateLiveMetersSummary();
      }
    });
    $('btn-save-meters').addEventListener('click', handleSaveAllMeters);

    $('admin-panel-slips').addEventListener('click', (e) => {
      const approveBtn = e.target.closest('[data-approve-slip]');
      if (approveBtn) {
        submitVerifyPayment({ record_id: approveBtn.dataset.approveSlip, decision: 'paid', is_manual: false }, approveBtn);
        return;
      }

      const rejectBtn = e.target.closest('[data-reject-slip]');
      if (rejectBtn) {
        const rec = state.records.find((r) => r.record_id === rejectBtn.dataset.rejectSlip);
        if (!rec) return;
        state.rejectTargetRecordId = rec.record_id;
        $('reject-slip-target').textContent = `ห้อง ${rec.room_no} • ${rec.name_snapshot} (ยอด ${fmtMoney(rec.total_cost)} บาท)`;
        $('input-reject-reason').value = '';
        openModal('modal-reject-slip');
        return;
      }

      const cashBtn = e.target.closest('[data-mark-cash]');
      if (cashBtn) {
        const rec = state.records.find((r) => r.record_id === cashBtn.dataset.markCash);
        if (!rec) return;
        openConfirmDialog({
          title: 'บันทึกชำระเงินสด',
          message: `ยืนยันบันทึกว่า ห้อง ${rec.room_no} (${rec.name_snapshot}) ชำระเงินจำนวน ${fmtMoney(rec.total_cost)} บาทเรียบร้อยแล้ว`,
          confirmLabel: 'ยืนยันชำระแล้ว',
          confirmVariant: 'success',
          onConfirm: () =>
            submitVerifyPayment({ record_id: rec.record_id, decision: 'paid', is_manual: true })
        });
        return;
      }

      const revertBtn = e.target.closest('[data-revert-unpaid]');
      if (revertBtn) {
        const rec = state.records.find((r) => r.record_id === revertBtn.dataset.revertUnpaid);
        if (!rec) return;
        openConfirmDialog({
          title: 'ยกเลิกสถานะชำระแล้ว',
          message: `ต้องการเปลี่ยนสถานะของ ห้อง ${rec.room_no} (${rec.name_snapshot}) กลับเป็น "รอชำระ" ใช่หรือไม่`,
          confirmLabel: 'ยืนยันเปลี่ยนสถานะ',
          confirmVariant: 'danger',
          onConfirm: () =>
            submitVerifyPayment({ record_id: rec.record_id, decision: 'unpaid', reject_reason: '', is_manual: true })
        });
      }
    });

    $('form-reject-slip').addEventListener('submit', async (e) => {
      e.preventDefault();
      const reason = $('input-reject-reason').value.trim();
      if (!reason) return;
      const btn = $('btn-confirm-reject');
      await submitVerifyPayment(
        { record_id: state.rejectTargetRecordId, decision: 'unpaid', reject_reason: reason, is_manual: false },
        btn
      );
      closeModal('modal-reject-slip');
    });

    document.querySelectorAll('[data-resident-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.residentFilter = btn.dataset.residentFilter;
        document.querySelectorAll('[data-resident-filter]').forEach((el) => {
          el.classList.toggle('is-active', el.dataset.residentFilter === state.residentFilter);
        });
        renderAdminResidentsTab();
      });
    });

    $('btn-open-add-resident').addEventListener('click', openAddResidentModal);
    $('residents-list-container').addEventListener('click', (e) => {
      const editBtn = e.target.closest('[data-edit-resident]');
      if (editBtn) {
        openEditResidentModal(editBtn.dataset.editResident);
        return;
      }
      const moveBtn = e.target.closest('[data-moveout-resident]');
      if (moveBtn) {
        openMoveOutModal(moveBtn.dataset.moveoutResident);
      }
    });

    $('form-resident').addEventListener('submit', handleSubmitResidentForm);
    $('form-move-out').addEventListener('submit', handleSubmitMoveOut);

    $('btn-open-create-cycle').addEventListener('click', openCreateCycleModal);
    $('new-cycle-month').addEventListener('change', updateNewCyclePreviewFields);
    $('new-cycle-year-th').addEventListener('input', updateNewCyclePreviewFields);
    $('form-create-cycle').addEventListener('submit', handleSubmitCreateCycle);

    $('btn-open-line-summary').addEventListener('click', openLineSummaryModal);
    $('btn-copy-line-text').addEventListener('click', () => {
      copyToClipboard($('line-summary-textarea').value, 'คัดลอกข้อความสรุปสำหรับส่ง LINE เรียบร้อย');
    });

    $('btn-open-school-report').addEventListener('click', openSchoolReportModal);
    $('btn-export-month-csv').addEventListener('click', handleExportMonthCsv);
    $('btn-print-school-report').addEventListener('click', () => {
      $('print-sheet-root').innerHTML = buildSchoolReportHtml();
      window.print();
    });

    $('form-update-cycle').addEventListener('submit', handleSubmitUpdateCycle);
    $('form-update-settings').addEventListener('submit', handleSubmitUpdateSettings);

    document.addEventListener('click', (e) => {
      const lightboxTrigger = e.target.closest('[data-lightbox-url]');
      if (lightboxTrigger) {
        openLightbox(
          lightboxTrigger.dataset.lightboxUrl,
          lightboxTrigger.dataset.lightboxView,
          lightboxTrigger.dataset.lightboxCaption
        );
        return;
      }

      const closeBtn = e.target.closest('[data-close-modal]');
      if (closeBtn) {
        closeModal(closeBtn.dataset.closeModal);
        return;
      }

      if (e.target.classList.contains('modal-backdrop')) {
        closeModal(e.target.id);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const openModals = document.querySelectorAll('.modal-backdrop.is-open');
        if (openModals.length > 0) {
          closeModal(openModals[openModals.length - 1].id);
        }
      }
    });

    $('btn-confirm-ok').addEventListener('click', async () => {
      const cb = state.confirmCallback;
      state.confirmCallback = null;
      closeModal('modal-confirm');
      if (typeof cb === 'function') {
        await cb();
      }
    });
  }

  function init() {
    SamsaraApp.__booted = true;
    if (isMockMode()) {
      $('mock-mode-banner').classList.remove('hidden');
    }
    bindEvents();
    loadDashboard();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
