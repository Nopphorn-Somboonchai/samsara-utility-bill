/**
 * ============================================================================
 * Samsara Utility Bill — PWA Registration & Easy Install Controller (pwa.js)
 * Classic Defer Compatible (Works safely on https://, localhost, and file://)
 * ============================================================================
 */

(function (global) {
  'use strict';

  const SamsaraApp = (global.SamsaraApp = global.SamsaraApp || {});

  const DISMISS_STORAGE_KEY = 'samsara_pwa_banner_dismissed_at';
  const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  let deferredPrompt = null;
  let installedDuringSession = false;

  const $ = (id) => document.getElementById(id);

  // ============================================================================
  // Environment & Install State Detection
  // ============================================================================

  function isStandaloneMode() {
    if (installedDuringSession) return true;
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
        return true;
      }
      if (window.matchMedia && window.matchMedia('(display-mode: minimal-ui)').matches) {
        return true;
      }
    } catch (e) {
      // ignore matchMedia error
    }
    if (window.navigator && window.navigator.standalone === true) {
      return true;
    }
    if (document.referrer && document.referrer.startsWith('android-app://')) {
      return true;
    }
    return false;
  }

  function detectEnvironment() {
    const ua = (navigator && navigator.userAgent) || '';
    const platform = (navigator && navigator.platform) || '';
    const maxTouchPoints = (navigator && navigator.maxTouchPoints) || 0;

    const isLine = /\bLine\//i.test(ua);
    const isInApp =
      isLine || /FBAN|FBAV|Instagram|Twitter|MicroMessenger|; wv\)/i.test(ua);
    const isIOS =
      /iPhone|iPad|iPod/i.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1);
    const isAndroid = /Android/i.test(ua);
    const isFileProtocol = window.location.protocol === 'file:';
    const isSecureForSw =
      window.location.protocol === 'https:' ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';

    return {
      ua,
      isLine,
      isInApp,
      isIOS,
      isAndroid,
      isFileProtocol,
      isSecureForSw
    };
  }

  function isBannerDismissedRecently() {
    try {
      const raw = localStorage.getItem(DISMISS_STORAGE_KEY);
      if (!raw) return false;
      const dismissedAt = Number(raw);
      if (!Number.isFinite(dismissedAt)) return false;
      return Date.now() - dismissedAt < DISMISS_TTL_MS;
    } catch (e) {
      return false;
    }
  }

  function saveBannerDismissed() {
    try {
      localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now()));
    } catch (e) {
      // ignore storage error
    }
  }

  function clearBannerDismissed() {
    try {
      localStorage.removeItem(DISMISS_STORAGE_KEY);
    } catch (e) {
      // ignore storage error
    }
  }

  // ============================================================================
  // UI Helpers (Matches app.js Toast & Modal Design System)
  // ============================================================================

  function showPwaToast(message, type) {
    const container = $('toast-container');
    if (!container) return;

    const icon =
      type === 'success'
        ? 'ph-check-circle'
        : type === 'error'
          ? 'ph-warning-circle'
          : 'ph-info';

    const item = document.createElement('div');
    item.className = `toast-item body-5 ${
      type === 'success' ? 'toast-success' : type === 'error' ? 'toast-error' : ''
    }`;

    const iconEl = document.createElement('i');
    iconEl.className = `ph ${icon} text-lg shrink-0`;
    iconEl.setAttribute('aria-hidden', 'true');

    const textEl = document.createElement('span');
    textEl.textContent = String(message || '');

    item.appendChild(iconEl);
    item.appendChild(textEl);
    container.appendChild(item);

    requestAnimationFrame(() => item.classList.add('is-visible'));

    setTimeout(() => {
      item.classList.remove('is-visible');
      setTimeout(() => item.remove(), 320);
    }, 3200);
  }

  async function copyCurrentPageUrl() {
    const url = window.location.href;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
      } else {
        const temp = document.createElement('textarea');
        temp.value = url;
        temp.style.position = 'fixed';
        temp.style.opacity = '0';
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        temp.remove();
      }
      showPwaToast('คัดลอกลิงก์เว็บแอปเรียบร้อยแล้ว', 'success');
    } catch (e) {
      showPwaToast('ไม่สามารถคัดลอกลิงก์ได้ กรุณาคัดลอกจากแถบที่อยู่ด้านบน', 'error');
    }
  }

  function openInstallModal() {
    const modal = $('modal-install-guide');
    if (!modal) return;
    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  function closeInstallModal() {
    const modal = $('modal-install-guide');
    if (!modal) return;
    modal.classList.remove('is-open');
    if (!document.querySelector('.modal-backdrop.is-open')) {
      document.body.style.overflow = '';
    }
  }

  // ============================================================================
  // Render Dynamic Install Banner & Guide Modal
  // ============================================================================

  function syncInstallUi() {
    const headerBtn = $('btn-install-app');
    const banner = $('pwa-install-banner');
    const bannerDesc = $('pwa-banner-desc');
    const bannerBtnLabel = $('pwa-banner-btn-label');

    const standalone = isStandaloneMode();
    const env = detectEnvironment();

    if (standalone) {
      if (headerBtn) headerBtn.classList.add('hidden');
      if (banner) banner.classList.add('hidden');
      return;
    }

    if (headerBtn) {
      headerBtn.classList.remove('hidden');
    }

    if (bannerDesc && bannerBtnLabel) {
      if (deferredPrompt) {
        bannerDesc.textContent =
          'ติดตั้งเป็นแอปได้ทันทีใน 1 คลิก เพื่อเข้าดูบิลและส่งสลิปจากหน้าจอหลัก';
        bannerBtnLabel.textContent = 'ติดตั้งทันที';
      } else if (env.isInApp) {
        bannerDesc.textContent =
          'เปิดในเบราว์เซอร์หลัก (Chrome / Safari) เพื่อติดตั้งไอคอนไว้บนหน้าจอมือถือ';
        bannerBtnLabel.textContent = 'ดูวิธีติดตั้ง';
      } else if (env.isIOS) {
        bannerDesc.textContent =
          'เพิ่มไอคอนแอปไว้บนหน้าจอโฮม iPhone / iPad เพื่อเปิดใช้งานเต็มจอเหมือนแอปจริง';
        bannerBtnLabel.textContent = 'วิธีติดตั้ง';
      } else {
        bannerDesc.textContent =
          'ติดตั้งเป็นแอปไว้บนหน้าจอหลัก เพื่อเข้าดูบิลและแนบสลิปได้สะดวกรวดเร็ว';
        bannerBtnLabel.textContent = 'ติดตั้งแอป';
      }
    }

    if (banner) {
      const shouldShowBanner = !isBannerDismissedRecently();
      banner.classList.toggle('hidden', !shouldShowBanner);
    }
  }

  function renderInstallGuideMode(modeOverride) {
    const env = detectEnvironment();
    let mode = modeOverride;

    if (!mode) {
      if (env.isFileProtocol) {
        mode = 'file';
      } else if (env.isInApp) {
        mode = 'inapp';
      } else if (env.isIOS) {
        mode = 'ios';
      } else {
        mode = 'browser';
      }
    }

    const titleEl = $('install-guide-title');
    const subtitleEl = $('install-guide-subtitle');
    const sections = {
      inapp: $('install-guide-inapp'),
      ios: $('install-guide-ios'),
      browser: $('install-guide-browser'),
      file: $('install-guide-file')
    };

    Object.keys(sections).forEach((key) => {
      if (sections[key]) {
        sections[key].classList.toggle('hidden', key !== mode);
      }
    });

    const copyWrap = $('install-guide-copy-wrap');
    if (copyWrap) {
      copyWrap.classList.toggle('hidden', mode === 'file');
    }

    if (titleEl && subtitleEl) {
      if (mode === 'inapp') {
        titleEl.textContent = env.isLine
          ? 'เปิดจาก LINE ไปยังเบราว์เซอร์หลัก'
          : 'เปิดในเบราว์เซอร์หลักเพื่อติดตั้งแอป';
        subtitleEl.textContent = env.isIOS
          ? 'แอปแชทยังไม่รองรับการเพิ่มไอคอนโดยตรง กรุณาเปิดลิงก์นี้ใน Safari ก่อน'
          : 'แอปแชทยังไม่รองรับการติดตั้งแอปโดยตรง กรุณาเปิดลิงก์นี้ใน Chrome ก่อน';
      } else if (mode === 'ios') {
        titleEl.textContent = 'วิธีติดตั้งแอปบน iPhone / iPad';
        subtitleEl.textContent = 'ทำตาม 3 ขั้นตอนง่ายๆ ใน Safari เพื่อเพิ่มไอคอนไว้บนหน้าจอโฮม';
      } else if (mode === 'file') {
        titleEl.textContent = 'เปิดผ่านลิงก์เว็บออนไลน์เพื่อติดตั้ง';
        subtitleEl.textContent =
          'ขณะนี้กำลังเปิดไฟล์จากเครื่องโดยตรง (file://) การติดตั้งแอปต้องเปิดผ่านลิงก์เว็บ HTTPS หรือ Localhost';
      } else {
        titleEl.textContent = 'วิธีติดตั้งเว็บแอปลงบนอุปกรณ์';
        subtitleEl.textContent = env.isAndroid
          ? 'สามารถเพิ่มไอคอนแอปไว้บนหน้าจอหลักผ่านเมนูของเบราว์เซอร์ได้ทันที'
          : 'สามารถติดตั้งแอปไว้บนหน้าจอหลักหรือเดสก์ท็อปผ่านเมนูของเบราว์เซอร์ได้ทันที';
      }
    }

    openInstallModal();
  }

  async function handleInstallTrigger() {
    if (isStandaloneMode()) {
      showPwaToast('กำลังใช้งานในโหมดแอปที่ติดตั้งแล้ว', 'info');
      syncInstallUi();
      return;
    }

    if (deferredPrompt) {
      const promptEvent = deferredPrompt;
      deferredPrompt = null;
      try {
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        if (choice && choice.outcome === 'accepted') {
          showPwaToast('กำลังติดตั้งแอปลงบนอุปกรณ์ของคุณ...', 'success');
        }
      } catch (err) {
        renderInstallGuideMode();
      }
      syncInstallUi();
      return;
    }

    renderInstallGuideMode();
  }

  // ============================================================================
  // Service Worker Registration
  // ============================================================================

  function registerServiceWorker() {
    const env = detectEnvironment();
    if (!env.isSecureForSw || !('serviceWorker' in navigator)) {
      return;
    }

    const doRegister = () => {
      navigator.serviceWorker
        .register('./sw.js', { scope: './' })
        .catch(() => {
          // Silently ignore SW registration failures so the core app is never disrupted
        });
    };

    if (document.readyState === 'complete') {
      doRegister();
    } else {
      window.addEventListener('load', doRegister, { once: true });
    }
  }

  // ============================================================================
  // Event Binding & Boot
  // ============================================================================

  function bindPwaEvents() {
    const headerBtn = $('btn-install-app');
    if (headerBtn) {
      headerBtn.addEventListener('click', handleInstallTrigger);
    }

    const bannerInstallBtn = $('btn-banner-install');
    if (bannerInstallBtn) {
      bannerInstallBtn.addEventListener('click', handleInstallTrigger);
    }

    const bannerDismissBtn = $('btn-banner-dismiss');
    if (bannerDismissBtn) {
      bannerDismissBtn.addEventListener('click', () => {
        saveBannerDismissed();
        const banner = $('pwa-install-banner');
        if (banner) banner.classList.add('hidden');
      });
    }

    const copyUrlBtn = $('btn-install-copy-url');
    if (copyUrlBtn) {
      copyUrlBtn.addEventListener('click', copyCurrentPageUrl);
    }

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredPrompt = event;
      syncInstallUi();
    });

    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      installedDuringSession = true;
      closeInstallModal();
      syncInstallUi();
      showPwaToast('ติดตั้งแอปลงบนอุปกรณ์เรียบร้อยแล้ว', 'success');
    });

    if (window.matchMedia) {
      try {
        const mq = window.matchMedia('(display-mode: standalone)');
        if (typeof mq.addEventListener === 'function') {
          mq.addEventListener('change', syncInstallUi);
        }
      } catch (e) {
        // ignore older browsers
      }
    }
  }

  function initPwa() {
    bindPwaEvents();
    syncInstallUi();
    registerServiceWorker();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPwa);
  } else {
    initPwa();
  }

  SamsaraApp.pwa = {
    isStandalone: isStandaloneMode,
    detectEnvironment,
    triggerInstall: handleInstallTrigger,
    openInstallGuide: renderInstallGuideMode,
    resetBannerDismiss: () => {
      clearBannerDismissed();
      syncInstallUi();
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
