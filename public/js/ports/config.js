/**
 * Porta 3 USB-C (Frontend) — Config v1.0, Feature Flags, Modos de Interface e Hidratação de Tenant.
 */
(function (root) {
  const UI_MODE_KEY = 'autonomia_ui_mode';
  const SIMPLIFIED_VIEWS = ['motor', 'leads', 'dialer', 'agenda'];
  const ADVANCED_VIEWS = [
    'dashboard', 'leads', 'agenda', 'dialer', 'intelligence', 'motor', 'pipeline', 'templates', 'novo', 'pesquisa',
  ];

  const DEFAULT_CONFIG = {
    contract_version: '1.0',
    shell_enabled: true,
    ui_mode: 'avancado',
    storage_mode: 'persistent',
    tenant: {
      id: 'default',
      brand_name: 'AutonomIA Systems',
      ramo: 'Sistemas Inteligentes, Agentes Digitais e Automação de Processos',
      slogan: 'Sistemas Inteligentes · Caça Leads',
      default_city: 'Governador Valadares',
      default_uf: 'MG',
      operators: [
        { name: 'Rafael Oliveira', role: 'Especialista em Sistemas & Automação Inteligente', badge: 'Especialista em Sistemas' },
        { name: 'Sara Rosseto', role: 'Consultora de Inteligência Operacional & IA', badge: 'Consultora de IA & Processos' },
      ],
    },
    feature_flags: {
      maps_autopilot: true,
      xray_v2: true,
      empirical_calibration: true,
      territory_lookalike: true,
      offline_sync: true,
    },
  };

  let activeConfig = structuredClone(DEFAULT_CONFIG);

  function getAdapter() {
    return root.RuntimeAdapter || null;
  }

  function mergeConfig(base, overrides = {}) {
    const src = overrides && typeof overrides === 'object' ? overrides : {};
    const tenantSrc = src.tenant && typeof src.tenant === 'object' ? src.tenant : {};
    const flagsSrc = src.feature_flags && typeof src.feature_flags === 'object' ? src.feature_flags : {};
    const uiModeRaw = src.ui_mode ?? base.ui_mode;
    return {
      contract_version: '1.0',
      shell_enabled: src.shell_enabled !== undefined ? Boolean(src.shell_enabled) : base.shell_enabled,
      ui_mode: uiModeRaw === 'simplificado' ? 'simplificado' : 'avancado',
      storage_mode: src.storage_mode === 'ephemeral' ? 'ephemeral' : (src.storage_mode || base.storage_mode),
      tenant: {
        ...base.tenant,
        ...tenantSrc,
        operators: Array.isArray(tenantSrc.operators) && tenantSrc.operators.length
          ? tenantSrc.operators.map((op) => ({ ...op }))
          : base.tenant.operators.map((op) => ({ ...op })),
      },
      feature_flags: {
        ...base.feature_flags,
        ...flagsSrc,
      },
    };
  }

  function getVisibleViews(mode = activeConfig.ui_mode) {
    return mode === 'simplificado' ? [...SIMPLIFIED_VIEWS] : [...ADVANCED_VIEWS];
  }

  function applyDomHydration() {
    if (typeof document === 'undefined') return;
    document.body?.classList.toggle('shell-disabled', !activeConfig.shell_enabled);

    const brandNameEl = document.getElementById('brandName');
    if (brandNameEl) brandNameEl.textContent = activeConfig.tenant.brand_name;

    const brandSloganEl = document.getElementById('brandSlogan');
    if (brandSloganEl) brandSloganEl.textContent = activeConfig.tenant.slogan;

    const opSelect = document.getElementById('operatorProfile');
    if (opSelect && Array.isArray(activeConfig.tenant.operators) && activeConfig.tenant.operators.length) {
      const prev = opSelect.value;
      opSelect.innerHTML = '';
      for (const op of activeConfig.tenant.operators) {
        const opt = document.createElement('option');
        opt.value = op.name;
        opt.textContent = op.name;
        opSelect.appendChild(opt);
      }
      if (activeConfig.tenant.operators.some((o) => o.name === prev)) {
        opSelect.value = prev;
      }
    }

    const visible = new Set(getVisibleViews(activeConfig.ui_mode));
    document.querySelectorAll('.sidebar nav .nav').forEach((btn) => {
      const view = btn.dataset.view;
      btn.classList.toggle('hidden', !visible.has(view));
    });

    const toggleBtn = document.getElementById('uiModeToggle');
    if (toggleBtn) {
      const isSimple = activeConfig.ui_mode === 'simplificado';
      toggleBtn.textContent = isSimple ? '⚡ Modo: Operacional' : '🧠 Modo: Estratégico';
      toggleBtn.title = isSimple
        ? 'Exibindo 4 abas operacionais (clique para alternar para Estratégico)'
        : 'Exibindo todas as abas estratégicas (clique para alternar para Operacional)';
      toggleBtn.dataset.uiMode = activeConfig.ui_mode;
    }

    const ephemBadge = document.getElementById('ephemeralStorageBadge');
    if (ephemBadge) {
      ephemBadge.classList.toggle('hidden', activeConfig.storage_mode !== 'ephemeral');
    }
  }

  async function init(overrides = null) {
    let remote = {};
    try {
      const adapter = getAdapter();
      if (adapter?.http && typeof root.fetch === 'function') {
        remote = await adapter.http('/api/config');
      }
    } catch {
      remote = {};
    }

    const savedUiMode = getAdapter()?.getStorage?.(UI_MODE_KEY);
    let next = mergeConfig(DEFAULT_CONFIG, remote);
    if (savedUiMode === 'simplificado' || savedUiMode === 'avancado') {
      next = mergeConfig(next, { ui_mode: savedUiMode });
    }
    if (overrides && typeof overrides === 'object') {
      next = mergeConfig(next, overrides);
    }
    activeConfig = next;
    applyDomHydration();
    return activeConfig;
  }

  function get() {
    return activeConfig;
  }

  function setUiMode(mode) {
    const clean = mode === 'simplificado' ? 'simplificado' : 'avancado';
    activeConfig = mergeConfig(activeConfig, { ui_mode: clean });
    getAdapter()?.setStorage?.(UI_MODE_KEY, clean);
    applyDomHydration();
    return activeConfig.ui_mode;
  }

  function setShellEnabled(enabled) {
    activeConfig = mergeConfig(activeConfig, { shell_enabled: Boolean(enabled) });
    applyDomHydration();
    return activeConfig.shell_enabled;
  }

  root.AppPorts = root.AppPorts || {};
  root.AppPorts.config = {
    SIMPLIFIED_VIEWS,
    ADVANCED_VIEWS,
    init,
    get,
    setUiMode,
    setShellEnabled,
    getVisibleViews,
    applyDomHydration,
    mergeConfig,
  };
})(typeof window !== 'undefined' ? window : globalThis);
