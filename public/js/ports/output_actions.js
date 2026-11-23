/**
 * Porta 2 USB-C (Frontend) — OutputActions injetáveis para comunicação, cópia e exportação.
 */
(function (root) {
  function defaultOpenWhatsApp(phone, text = '') {
    const url = root.Hygiene?.buildWhatsAppLink?.(phone, text) || null;
    if (!url) return { ok: false, url: null };
    const opened = root.RuntimeAdapter?.openExternal(url) ?? false;
    return { ok: opened, url };
  }

  function defaultCallPhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return { ok: false, url: null };
    const url = `tel:${digits}`;
    const opened = root.RuntimeAdapter?.openExternal(url) ?? false;
    return { ok: opened, url };
  }

  function defaultOpenEmail(email, subject = '', body = '') {
    const clean = String(email || '').trim();
    if (!clean) return { ok: false, url: null };
    const url = `mailto:${clean}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    const opened = root.RuntimeAdapter?.openExternal(url) ?? false;
    return { ok: opened, url };
  }

  function defaultCopyText(text) {
    return root.RuntimeAdapter?.copyToClipboard(text) ?? Promise.resolve(false);
  }

  function defaultExportCsv() {
    return root.RuntimeAdapter?.downloadAuthenticated('/api/export.csv', 'autonomia-systems-caca-leads.csv');
  }

  function defaultExportBackup() {
    return root.RuntimeAdapter?.downloadAuthenticated('/api/system/backup', 'autonomia-leads-backup.json');
  }

  const actions = {
    openWhatsApp: defaultOpenWhatsApp,
    callPhone: defaultCallPhone,
    openEmail: defaultOpenEmail,
    copyText: defaultCopyText,
    exportCsv: defaultExportCsv,
    exportBackup: defaultExportBackup,
    configure(overrides = {}) {
      if (!overrides || typeof overrides !== 'object') return;
      for (const key of ['openWhatsApp', 'callPhone', 'openEmail', 'copyText', 'exportCsv', 'exportBackup']) {
        if (typeof overrides[key] === 'function') {
          actions[key] = overrides[key];
        }
      }
    },
  };

  root.AppPorts = root.AppPorts || {};
  root.AppPorts.outputActions = actions;
})(typeof window !== 'undefined' ? window : globalThis);
