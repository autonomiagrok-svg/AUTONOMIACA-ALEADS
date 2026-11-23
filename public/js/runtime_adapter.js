/**
 * Invariante 3 — IRuntimeAdapter: abstrai rede, storage, diálogos acessíveis, clipboard, links e downloads.
 * Elimina 100% de window.prompt() e window.confirm() nativos.
 */
(function (root) {
  const memoryStorage = new Map();
  let dialogResolve = null;

  function ensureDialogHost() {
    if (typeof document === 'undefined') return null;
    let host = document.getElementById('dialogModal');
    if (!host) {
      host = document.createElement('div');
      host.id = 'dialogModal';
      host.className = 'modal hidden';
      document.body.appendChild(host);
    }
    return host;
  }

  function escHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getStorage(key) {
    try {
      return root.localStorage?.getItem(key) ?? null;
    } catch {
      return memoryStorage.has(key) ? memoryStorage.get(key) : null;
    }
  }

  function setStorage(key, value) {
    const str = String(value ?? '');
    memoryStorage.set(key, str);
    try {
      root.localStorage?.setItem(key, str);
    } catch {
      // Fallback apenas em memória
    }
  }

  function removeStorage(key) {
    memoryStorage.delete(key);
    try {
      root.localStorage?.removeItem(key);
    } catch {
      // Ignora erro de storage
    }
  }

  function closeActiveDialog(result) {
    const host = typeof document !== 'undefined' ? document.getElementById('dialogModal') : null;
    if (host) {
      host.classList.add('hidden');
      host.innerHTML = '';
    }
    const resolve = dialogResolve;
    dialogResolve = null;
    if (typeof resolve === 'function') resolve(result);
  }

  function confirmDialog({
    title = 'Confirmar ação',
    message = '',
    confirmLabel = 'Confirmar',
    cancelLabel = 'Cancelar',
    danger = false,
  } = {}) {
    const host = ensureDialogHost();
    if (!host) return Promise.resolve(false);
    if (dialogResolve) closeActiveDialog(false);

    return new Promise((resolve) => {
      dialogResolve = resolve;
      host.classList.remove('hidden');
      host.setAttribute('role', 'alertdialog');
      host.setAttribute('aria-modal', 'true');
      host.innerHTML = `
        <div class="modal-box dialog-box" tabindex="-1" aria-labelledby="rtDialogTitle">
          <h3 id="rtDialogTitle" style="margin:0 0 8px">${escHtml(title)}</h3>
          <p class="muted" style="margin:0;white-space:pre-line;line-height:1.5">${escHtml(message)}</p>
          <div class="actions" style="justify-content:flex-end;margin-top:18px">
            <button type="button" class="btn" id="rtDialogCancel">${escHtml(cancelLabel)}</button>
            <button type="button" class="btn ${danger ? 'danger' : 'primary'}" id="rtDialogConfirm">${escHtml(confirmLabel)}</button>
          </div>
        </div>`;

      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cleanup();
          closeActiveDialog(false);
        }
      };
      const cleanup = () => {
        document.removeEventListener('keydown', onKey);
      };

      document.addEventListener('keydown', onKey);
      host.addEventListener('click', (e) => {
        if (e.target === host) {
          cleanup();
          closeActiveDialog(false);
        }
      }, { once: true });

      document.getElementById('rtDialogCancel')?.addEventListener('click', () => {
        cleanup();
        closeActiveDialog(false);
      });
      document.getElementById('rtDialogConfirm')?.addEventListener('click', () => {
        cleanup();
        closeActiveDialog(true);
      });
      (danger ? document.getElementById('rtDialogCancel') : document.getElementById('rtDialogConfirm'))?.focus();
    });
  }

  function promptDialog({
    title = 'Informar valor',
    message = '',
    placeholder = '',
    defaultValue = '',
    inputType = 'text',
    confirmLabel = 'Confirmar',
    cancelLabel = 'Cancelar',
  } = {}) {
    const host = ensureDialogHost();
    if (!host) return Promise.resolve(null);
    if (dialogResolve) closeActiveDialog(null);

    return new Promise((resolve) => {
      dialogResolve = resolve;
      host.classList.remove('hidden');
      host.setAttribute('role', 'alertdialog');
      host.setAttribute('aria-modal', 'true');
      host.innerHTML = `
        <div class="modal-box dialog-box" tabindex="-1" aria-labelledby="rtDialogTitle">
          <h3 id="rtDialogTitle" style="margin:0 0 8px">${escHtml(title)}</h3>
          ${message ? `<p class="muted" style="margin:0 0 12px;white-space:pre-line;line-height:1.5">${escHtml(message)}</p>` : ''}
          <form id="rtDialogForm">
            <input id="rtDialogInput" type="${escHtml(inputType)}" placeholder="${escHtml(placeholder)}" value="${escHtml(defaultValue)}" />
            <div class="actions" style="justify-content:flex-end;margin-top:16px">
              <button type="button" class="btn" id="rtDialogCancel">${escHtml(cancelLabel)}</button>
              <button type="submit" class="btn primary" id="rtDialogConfirm">${escHtml(confirmLabel)}</button>
            </div>
          </form>
        </div>`;

      const input = document.getElementById('rtDialogInput');
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cleanup();
          closeActiveDialog(null);
        }
      };
      const cleanup = () => {
        document.removeEventListener('keydown', onKey);
      };

      document.addEventListener('keydown', onKey);
      host.addEventListener('click', (e) => {
        if (e.target === host) {
          cleanup();
          closeActiveDialog(null);
        }
      }, { once: true });

      document.getElementById('rtDialogCancel')?.addEventListener('click', () => {
        cleanup();
        closeActiveDialog(null);
      });
      document.getElementById('rtDialogForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const val = input ? input.value : '';
        cleanup();
        closeActiveDialog(val);
      });
      input?.focus();
      input?.select?.();
    });
  }

  async function requestAccessKeyPrompt() {
    const entered = await promptDialog({
      title: 'Servidor Protegido',
      message: 'Digite a chave de acesso para autenticar sua sessão:',
      placeholder: 'Chave de acesso',
      inputType: 'password',
      confirmLabel: 'Desbloquear',
    });
    if (entered !== null && entered.trim()) {
      setStorage('autonomia_access_key', entered.trim());
      return entered.trim();
    }
    return null;
  }

  async function http(path, opts = {}) {
    const { _retriedAuth, ...fetchOpts } = opts;
    const headers = {
      'content-type': 'application/json',
      'x-access-key': getStorage('autonomia_access_key') || '',
      ...(fetchOpts.headers || {}),
    };
    const r = await fetch(path, { ...fetchOpts, headers });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && data.auth_required && !_retriedAuth) {
      const key = await requestAccessKeyPrompt();
      if (key) return http(path, { ...fetchOpts, _retriedAuth: true });
    }
    if (!r.ok) throw new Error(data.error || r.statusText);
    return data;
  }

  function openExternal(rawUrl) {
    const str = String(rawUrl || '').trim();
    if (!str) return false;
    try {
      const candidate = /^[a-z][a-z\d+.-]*:/i.test(str) ? str : `https://${str.replace(/^\/\//, '')}`;
      const u = new URL(candidate);
      if (!['http:', 'https:', 'tel:', 'mailto:'].includes(u.protocol)) return false;
      if (u.protocol === 'tel:' || u.protocol === 'mailto:') {
        root.open(u.href, '_self');
      } else {
        root.open(u.href, '_blank', 'noopener,noreferrer');
      }
      return true;
    } catch {
      return false;
    }
  }

  async function copyToClipboard(text) {
    const value = String(text ?? '');
    if (!value) return false;
    try {
      if (root.navigator?.clipboard?.writeText) {
        await root.navigator.clipboard.writeText(value);
        return true;
      }
    } catch {
      // Fallback para execCommand
    }
    if (typeof document === 'undefined') return false;
    const field = document.createElement('textarea');
    field.value = value;
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    field.remove();
    return copied;
  }

  function downloadBlob(blobOrContent, filename = 'download.bin', mimeType = 'application/octet-stream') {
    if (typeof document === 'undefined') return;
    const blob = blobOrContent instanceof Blob
      ? blobOrContent
      : new Blob([blobOrContent], { type: mimeType });
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
  }

  async function downloadAuthenticated(url, fallbackFilename = 'download.bin', _retriedAuth = false) {
    const r = await fetch(url, {
      headers: {
        'x-access-key': getStorage('autonomia_access_key') || '',
      },
    });
    if (r.status === 401 && !_retriedAuth) {
      const data = await r.json().catch(() => ({}));
      if (data.auth_required) {
        const key = await requestAccessKeyPrompt();
        if (key) return downloadAuthenticated(url, fallbackFilename, true);
      }
      throw new Error(data.error || 'Não autorizado');
    }
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      throw new Error(data.error || r.statusText || `HTTP ${r.status}`);
    }
    const cd = r.headers.get('content-disposition') || '';
    const match = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
    const filename = match?.[1] ? decodeURIComponent(match[1].trim()) : fallbackFilename;
    const blob = await r.blob();
    downloadBlob(blob, filename);
    return filename;
  }

  root.RuntimeAdapter = {
    http,
    getStorage,
    setStorage,
    removeStorage,
    openExternal,
    copyToClipboard,
    downloadBlob,
    downloadAuthenticated,
    confirmDialog,
    promptDialog,
  };
})(typeof window !== 'undefined' ? window : globalThis);
