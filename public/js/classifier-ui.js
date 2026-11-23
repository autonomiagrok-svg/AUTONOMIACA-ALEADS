/**
 * Camada de UI para Classificação Inteligente (Fatos + 4 Modos + Lentes Customizadas) e Rastreabilidade de Origem.
 */
(function () {
  const MODE_STORAGE_KEY = 'autonomia_scoring_mode';
  window.CUSTOM_LENSES = [];

  window.loadCustomLenses = async function loadCustomLenses() {
    try {
      const res = await window.api('/api/lenses');
      window.CUSTOM_LENSES = Array.isArray(res.items) ? res.items : [];
    } catch {
      window.CUSTOM_LENSES = [];
    }
    return window.CUSTOM_LENSES;
  };

  window.getActiveScoringMode = function getActiveScoringMode() {
    const saved = localStorage.getItem(MODE_STORAGE_KEY);
    const modes = window.ScoringModes?.SCORING_MODES || [];
    if (saved && modes.some((m) => m.id === saved)) return saved;
    if (saved && window.CUSTOM_LENSES.some((l) => l.id === saved)) return saved;
    return 'equilibrado';
  };

  window.getActiveLensOrMode = function getActiveLensOrMode() {
    const activeId = window.getActiveScoringMode();
    const custom = window.CUSTOM_LENSES.find((l) => l.id === activeId);
    return custom || activeId;
  };

  window.getActiveModeLabel = function getActiveModeLabel() {
    const active = window.getActiveLensOrMode();
    if (active && typeof active === 'object') return active.nome;
    const modeObj = (window.ScoringModes?.SCORING_MODES || []).find((m) => m.id === active);
    return modeObj?.short || active;
  };

  window.setActiveScoringMode = function setActiveScoringMode(modeId) {
    localStorage.setItem(MODE_STORAGE_KEY, modeId);
  };

  window.formatBreakdownTooltip = function formatBreakdownTooltip(breakdown) {
    if (!Array.isArray(breakdown) || !breakdown.length) return '';
    return breakdown
      .map((b) => `${b.fator}: ${b.pontos > 0 ? '+' : ''}${b.pontos}`)
      .join(' | ');
  };

  window.renderBreakdownChips = function renderBreakdownChips(breakdown) {
    if (!Array.isArray(breakdown) || !breakdown.length) return '';
    return breakdown
      .map((b) => {
        const cls = b.pontos > 0 ? 'pos' : 'neg';
        const sign = b.pontos > 0 ? '+' : '';
        return `<span class="breakdown-chip ${cls}">${window.esc(b.fator)} <strong>${sign}${b.pontos}</strong></span>`;
      })
      .join(' ');
  };

  window.inferLeadOrigin = function inferLeadOrigin(lead) {
    if (window.DomainSignals?.inferOrigin) {
      return window.DomainSignals.inferOrigin(lead);
    }
    const fonte = String(lead?.fonte || '');
    const url = String(lead?.fonte_url || '');
    const lote = String(lead?.lote_origem || '');
    if (lead?.fonte_tipo === 'MAPS' || /google\s*maps/i.test(fonte) || url.includes('google.com/maps')) {
      return { key: 'MAPS', label: 'Maps' };
    }
    if (/openstreetmap|overpass/i.test(fonte) || url.includes('openstreetmap.org')) {
      return { key: 'OSM', label: 'OSM' };
    }
    if (/csv|importa[cç][aã]o/i.test(fonte) || /^CSV\s*•/i.test(lote)) {
      return { key: 'CSV', label: 'CSV' };
    }
    return { key: 'MANUAL', label: 'Manual' };
  };

  window.renderOriginBadge = function renderOriginBadge(lead) {
    const { key, label } = window.inferLeadOrigin(lead);
    const title = lead?.lote_origem || lead?.fonte || label;
    return `<span class="origin-badge origin-${key}" title="${window.esc(title)}">${label}</span>`;
  };

  const FALLBACK_SITE_DEPENDENT_TAGS = new Set([
    'Sem HTTPS', 'Site sem WhatsApp', 'Sem Tráfego Rastreado', 'Sem Mobile', 'Site Lento', 'E-commerce sem Pixel',
  ]);

  window.renderPainBadges = function renderPainBadges(tags) {
    if (!Array.isArray(tags) || !tags.length) return '';
    const siteDep = window.DomainSignals?.SITE_DEPENDENT_PAIN_TAGS || FALLBACK_SITE_DEPENDENT_TAGS;
    const hasNoOnlineSite = tags.includes('Sem Site') || tags.includes('Site Fora do Ar') || tags.includes('Só Link na Bio');
    const cleanTags = hasNoOnlineSite ? tags.filter((t) => !siteDep.has(t)) : tags;
    return cleanTags
      .map((tag) => {
        const isCritical = tag === 'CNPJ Inativo' || tag === 'Site Fora do Ar';
        const isInfo = tag === 'Empresa Recente';
        const cls = isCritical ? 'critical' : (isInfo ? 'info' : 'opportunity');
        return `<span class="pain-badge ${cls}">${window.esc(tag)}</span>`;
      })
      .join(' ');
  };

  window.renderClassifierModeBar = function renderClassifierModeBar(visibleLeadIds = []) {
    const modes = window.ScoringModes?.SCORING_MODES || [];
    const customLenses = window.CUSTOM_LENSES || [];
    const activeId = window.getActiveScoringMode();
    const activeCustom = customLenses.find((l) => l.id === activeId);
    const activeNative = modes.find((m) => m.id === activeId);
    const activeDesc = activeCustom?.descricao || activeNative?.description || '';

    return `
      <div class="panel classifier-bar">
        <div class="classifier-bar-head">
          <div>
            <strong>🎯 Lente / Modo de Classificação:</strong>
            <span class="muted" style="margin-left:6px">${window.esc(activeDesc)}</span>
          </div>
          <div class="actions" style="margin:0">
            <button type="button" class="btn" id="btnDiagnoseBatch" ${visibleLeadIds.length ? '' : 'disabled'}>
              🔬 Diagnosticar Visíveis (${Math.min(visibleLeadIds.length, 20)})
            </button>
          </div>
        </div>
        <div class="mode-pills" role="tablist" aria-label="Modos e lentes de classificação">
          ${modes.map((m) => `
            <button type="button"
              class="mode-pill ${m.id === activeId ? 'active' : ''}"
              data-mode="${window.esc(m.id)}"
              title="${window.esc(m.description)}">
              ${window.esc(m.short)}
            </button>
          `).join('')}
          ${customLenses.map((l) => `
            <button type="button"
              class="mode-pill custom ${l.id === activeId ? 'active' : ''}"
              data-mode="${window.esc(l.id)}"
              title="${window.esc(l.descricao || l.nome)}">
              ✨ ${window.esc(l.nome)}
            </button>
          `).join('')}
        </div>
        <div id="diagnoseBatchStatus" class="muted hidden" style="margin-top:8px"></div>
      </div>`;
  };

  window.bindClassifierBarEvents = function bindClassifierBarEvents(onModeChanged, visibleLeadIds, onDiagnosed) {
    document.querySelectorAll('.mode-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        const modeId = btn.dataset.mode;
        window.setActiveScoringMode(modeId);
        onModeChanged(modeId);
      });
    });

    const batchBtn = document.getElementById('btnDiagnoseBatch');
    if (batchBtn) {
      batchBtn.addEventListener('click', async () => {
        const ids = (visibleLeadIds || []).slice(0, 20);
        if (!ids.length) return;
        const statusEl = document.getElementById('diagnoseBatchStatus');
        batchBtn.disabled = true;
        batchBtn.textContent = '⏳ Diagnosticando lote...';
        if (statusEl) {
          statusEl.textContent = `Executando Raio-X HTTP + BrasilAPI em ${ids.length} lead(s) (concorrência controlada 3)...`;
          statusEl.classList.remove('hidden');
        }
        try {
          const res = await window.api('/api/leads/diagnose-batch', {
            method: 'POST',
            body: JSON.stringify({ ids }),
          });
          window.toast?.(`Diagnóstico concluído em ${res.diagnosed} lead(s)!`);
          if (typeof onDiagnosed === 'function') await onDiagnosed(res.items || []);
        } catch (err) {
          if (!err?.offlineNotified) window.toast?.('Erro no diagnóstico: ' + err.message);
        } finally {
          batchBtn.disabled = false;
          batchBtn.textContent = `🔬 Diagnosticar Visíveis (${ids.length})`;
          if (statusEl) statusEl.classList.add('hidden');
        }
      });
    }
  };

  window.diagnoseSingleLead = async function diagnoseSingleLead(id) {
    const btn = document.getElementById('btnDiagnoseSingle');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Diagnosticando...';
    }
    try {
      await window.api(`/api/leads/${id}/diagnose`, { method: 'POST', body: JSON.stringify({}) });
      window.toast?.('Raio-X do lead atualizado!');
      if (typeof window.openLead === 'function') await window.openLead(id);
    } catch (err) {
      if (!err?.offlineNotified) window.toast?.('Erro no diagnóstico: ' + err.message);
      if (btn) {
        btn.disabled = false;
        btn.textContent = '🔬 Diagnosticar Lead';
      }
    }
  };
})();
