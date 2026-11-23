(() => {
  const sessionSeen = new Map();
  let deepCaptureAborted = false;
  let activeMissionRunnerId = null;

  const HOURS_OR_STATUS_RE = /\b(abre|fecha|aberto|fechado|24\s*horas|temporariamente\s+fechado|permanentemente\s+fechado)\b|\b(?:seg|ter|qua|qui|sex|s[aá]b|dom)\.\s*[aà]s\b|\b\d{1,2}:\d{2}\b/i;
  const STREET_RE = /\b(rua|r\.|av\.|avenida|travessa|tv\.|pra[cç]a|p[cç]a\.|rodovia|alameda|al\.|estrada|largo|vila|br-\d+|mg-\d+)\b|,\s*\d{1,5}\b|\d{5}-?\d{3}/i;
  const REVIEW_NOISE_RE = /\b(excelente|atendimento|comida|recomendo|[oó]timo|maravilhoso|adorei|p[eé]ssimo|ambiente|pre[cç]o|demorou|gostoso|delicioso|top|nota\s*10)\b/i;
  const SERVICE_ATTR_RE = /^(refei[cç][aã]o\s+no\s+local|para\s+viagem|entrega|retirada|drive-through|consumo\s+no\s+local|acesso\s+para\s+cadeirantes|pre[cç]o\s+m[eé]dio|r\$|\$+).*$/i;
  const END_OF_LIST_RE = /(chegou\s+ao\s+final\s+da\s+lista|reached\s+the\s+end\s+of\s+the\s+list|fim\s+da\s+lista)/i;

  function cleanMapsUrl(href) {
    if (!href) return null;
    try {
      const u = new URL(href, window.location.origin);
      const match = u.pathname.match(/(\/maps\/place\/[^/]+(?:\/[^/]+)?)/);
      if (match) return `https://www.google.com${match[1]}`;
      return `${u.origin}${u.pathname}`;
    } catch {
      return null;
    }
  }

  function cleanWebsiteUrl(href) {
    if (!href) return null;
    try {
      const u = new URL(href, window.location.origin);
      if (u.hostname.includes('google.') && u.pathname === '/url') {
        const q = u.searchParams.get('q') || u.searchParams.get('url');
        if (q) return q;
      }
      if (u.hostname.includes('google.com') && u.pathname.startsWith('/maps')) return null;
      return u.href;
    } catch {
      return null;
    }
  }

  function mapCategory(raw) {
    const cat = String(raw || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (!cat) return 'OUTRO';
    if (/restaurante|churrascaria|pizzaria|bistro|cantina|sushi|comida|osteria/.test(cat)) return 'RESTAURANTE';
    if (/bar|pub|choperia|chopperia|boteco|lounge/.test(cat)) return 'BAR';
    if (/lanchonete|hamburgueria|hamburger|acai|pastelaria|cafe|cafeteria|snack/.test(cat)) return 'LANCHONETE';
    if (/padaria|panificadora|confeitaria/.test(cat)) return 'PADARIA';
    if (/supermercado|hipermercado|atacarejo/.test(cat)) return 'SUPERMERCADO';
    if (/mercado|minimercado|mercearia|emporio|hortifruti/.test(cat)) return 'MERCADO';
    if (/adega|bebida|vinho|cervejaria/.test(cat)) return 'ADEGA';
    if (/hotel|pousada|resort|hostel/.test(cat)) return 'HOTEL';
    if (/evento|buffet|cerimonial|festas/.test(cat)) return 'EVENTOS';
    if (/clinica|consultorio|odonto|dentista|medico|saude|fisioterapia|psicolog/.test(cat)) return 'CLINICA';
    if (/academia|fitness|crossfit|pilates|musculacao/.test(cat)) return 'ACADEMIA';
    if (/oficina|mecanica|auto center|funilaria|borracharia/.test(cat)) return 'OFICINA';
    if (/farmacia|drogaria/.test(cat)) return 'FARMACIA';
    if (/salao|barbearia|estetica|beleza|manicure/.test(cat)) return 'SALAO';
    if (/pet\s*shop|veterinari|banho\s*e\s*tosa|racao|animais/.test(cat)) return 'PETSHOP';
    if (/imobiliaria|corretor/.test(cat)) return 'IMOBILIARIA';
    if (/escritorio|contabilidade|advocacia|consultoria/.test(cat)) return 'ESCRITORIO';
    if (/loja|boutique|comercio|magazine/.test(cat)) return 'LOJA';
    return 'OUTRO';
  }

  function isLikelyMobile(phoneStr) {
    let d = String(phoneStr || '').replace(/\D/g, '');
    if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
    return d.length === 11 && d[2] === '9';
  }

  function isValidAddressCandidate(line) {
    const text = String(line || '').trim();
    if (!text || text.length < 5) return false;
    if (HOURS_OR_STATUS_RE.test(text)) return false;
    return STREET_RE.test(text);
  }

  function isValidCategoryCandidate(line) {
    const text = String(line || '').trim();
    if (!text || text.length > 45) return false;
    if (/["“”]/.test(text)) return false;
    if (HOURS_OR_STATUS_RE.test(text)) return false;
    if (REVIEW_NOISE_RE.test(text)) return false;
    if (SERVICE_ATTR_RE.test(text)) return false;
    if (/^\d+([.,]\d+)?$/.test(text) || /^R\$/.test(text)) return false;
    if (STREET_RE.test(text)) return false;
    return true;
  }

  function parseAddressParts(fullAddress, searchFallback) {
    const raw = String(fullAddress || '').replace(/^Endere[cç]o:\s*/i, '').trim();
    if (raw && HOURS_OR_STATUS_RE.test(raw) && !STREET_RE.test(raw)) {
      return parseAddressParts('', searchFallback);
    }

    let bairro = '';
    let cidade = '';
    let uf = 'MG';

    const ufMatch = raw.match(/,\s*([^,-]+?)\s*-\s*([A-Z]{2})(?:\s*,|\s*$)/);
    if (ufMatch) {
      cidade = ufMatch[1].trim();
      uf = ufMatch[2].trim().toUpperCase();
    }

    const bairroFullMatch = raw.match(/\s-\s([^,]+),\s*[^,-]+\s*-\s*[A-Z]{2}/);
    if (bairroFullMatch) {
      bairro = bairroFullMatch[1].trim();
    } else {
      const dashBairro = raw.match(/,\s*\d+\s*[-–]\s*([^-,\d][^,]{2,35})(?:,|$)/);
      if (dashBairro && !/^(sub\s*solo|sala|loja|andar|bloco|lj)/i.test(dashBairro[1].trim())) {
        bairro = dashBairro[1].trim();
      } else {
        const commaParts = raw.split(',').map((p) => p.trim()).filter(Boolean);
        if (commaParts.length >= 3 && !/^\d+$/.test(commaParts[2]) && !/\d{5}-?\d{3}/.test(commaParts[2])) {
          const cand = commaParts[2].split(' - ')[0].trim();
          if (cand && cand !== cidade && !/^[A-Z]{2}$/.test(cand)) bairro = cand;
        }
      }
    }

    if (!cidade && searchFallback) {
      const emMatch = String(searchFallback).match(/\bem\s+(.+?)\s+([A-Za-z]{2})$/i);
      if (emMatch) {
        cidade = emMatch[1].trim();
        uf = emMatch[2].trim().toUpperCase();
      } else {
        const tokens = String(searchFallback).split(/[,|-]/).map((s) => s.trim()).filter(Boolean);
        if (tokens.length >= 2) {
          const last = tokens[tokens.length - 1];
          if (/^[A-Za-z]{2}$/.test(last)) {
            uf = last.toUpperCase();
            cidade = tokens[tokens.length - 2] || '';
          } else {
            cidade = last;
          }
        }
      }
    }

    return {
      endereco: raw || null,
      bairro: bairro || null,
      cidade: cidade || 'Governador Valadares',
      uf,
    };
  }

  function parseRating(text) {
    if (!text) return { avaliacao: null, total_avaliacoes: null };
    const clean = String(text).replace(/\u00a0/g, ' ').trim();
    const scoreMatch = clean.match(/(\d[.,]\d)/);
    const countMatch = clean.match(/\((\d[\d.]*)\)|(\d[\d.]*)\s*(?:avalia[cç][oõ]es|reviews)/i);
    const avaliacao = scoreMatch ? Number(scoreMatch[1].replace(',', '.')) : null;
    const rawCount = countMatch ? (countMatch[1] || countMatch[2] || '').replace(/\./g, '') : '';
    const total_avaliacoes = rawCount ? Number(rawCount) : null;
    return {
      avaliacao: Number.isFinite(avaliacao) && avaliacao <= 5 ? avaliacao : null,
      total_avaliacoes: Number.isFinite(total_avaliacoes) ? total_avaliacoes : null,
    };
  }

  function extractPhoneFromText(text) {
    const match = String(text || '').match(/(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9\s*)?\d{4}[-\s]?\d{4}/);
    return match ? match[0].trim() : null;
  }

  function getSearchQuery() {
    const input = document.querySelector('#searchboxinput') || document.querySelector('input[name="q"]');
    return input ? input.value : '';
  }

  function extractFromDetailPanel(searchQuery) {
    const main = document.querySelector('div[role="main"]');
    if (!main) return null;

    const heading = main.querySelector('h1');
    const nome = heading ? heading.textContent.trim() : '';
    if (!nome) return null;

    const telLink = main.querySelector('a[href^="tel:"]');
    const phoneBtn = main.querySelector('button[data-item-id^="phone:"]');
    const rawPhone = telLink
      ? telLink.getAttribute('href').replace(/^tel:/i, '').trim()
      : (phoneBtn ? (phoneBtn.getAttribute('aria-label') || phoneBtn.textContent || '').replace(/^Telefone:\s*/i, '').trim() : null);

    const addrBtn = main.querySelector('button[data-item-id="address"]');
    const rawAddr = addrBtn ? (addrBtn.getAttribute('aria-label') || addrBtn.textContent || '') : '';

    const webLink = main.querySelector('a[data-item-id="authority"]');
    const website = webLink ? cleanWebsiteUrl(webLink.getAttribute('href')) : null;

    const catBtn = main.querySelector('button[jsaction*="category"]') || main.querySelector('button.DkEaL');
    const rawCat = catBtn ? catBtn.textContent.trim() : null;
    const categoria_raw = rawCat && isValidCategoryCandidate(rawCat) ? rawCat : null;

    const ratingEl = main.querySelector('div[jsaction*="pane.rating"], span[role="img"][aria-label*="estrela"], span[aria-label*="estrelas"], span[aria-label*="stars"]');
    const ratingBlock = ratingEl?.parentElement?.textContent || ratingEl?.getAttribute('aria-label') || '';
    const { avaliacao, total_avaliacoes } = parseRating(ratingBlock);

    const addrParts = parseAddressParts(rawAddr, searchQuery);
    const cleanPhone = rawPhone ? extractPhoneFromText(rawPhone) || rawPhone : null;
    const whatsapp = cleanPhone && isLikelyMobile(cleanPhone) ? cleanPhone : null;

    const placeUrl = cleanMapsUrl(window.location.href);
    const fonte_url = placeUrl && placeUrl.includes('/maps/place/') ? placeUrl : null;

    return {
      nome_fantasia: nome,
      categoria_raw,
      segmento: mapCategory(categoria_raw),
      telefone: cleanPhone,
      whatsapp,
      website,
      endereco: addrParts.endereco,
      bairro: addrParts.bairro,
      cidade: addrParts.cidade,
      uf: addrParts.uf,
      avaliacao,
      total_avaliacoes,
      fonte: 'Google Maps (Captura Assistida)',
      fonte_tipo: 'MAPS',
      fonte_url,
    };
  }

  function extractFromCardElement(link, searchQuery) {
    const fonte_url = cleanMapsUrl(link.getAttribute('href'));
    const nome = (link.getAttribute('aria-label') || link.textContent || '').trim();
    if (!nome || !fonte_url) return null;

    const card = link.closest('[jsaction]')?.parentElement || link.parentElement;
    const cardText = card ? card.innerText || card.textContent || '' : '';
    const lines = cardText.split('\n').map((l) => l.trim()).filter(Boolean);

    const ratingEl = card?.querySelector('span[role="img"][aria-label]');
    const ratingText = ratingEl ? `${ratingEl.getAttribute('aria-label')} ${cardText}` : cardText;
    const { avaliacao, total_avaliacoes } = parseRating(ratingText);

    const tel = extractPhoneFromText(cardText);
    const whatsapp = tel && isLikelyMobile(tel) ? tel : null;

    const webAnchor = card?.querySelector('a[href^="http"]:not([href*="google.com/maps"])');
    const website = webAnchor ? cleanWebsiteUrl(webAnchor.getAttribute('href')) : null;

    let categoria_raw = null;
    let endereco = null;

    for (const line of lines) {
      if (line === nome) continue;
      const segments = line.split('·').map((s) => s.trim()).filter(Boolean);
      for (const seg of segments) {
        if (HOURS_OR_STATUS_RE.test(seg)) continue;
        if (!endereco && isValidAddressCandidate(seg)) {
          endereco = seg;
          continue;
        }
        if (!categoria_raw && isValidCategoryCandidate(seg)) {
          categoria_raw = seg;
        }
      }
    }

    const addrParts = parseAddressParts(endereco, searchQuery);
    return {
      nome_fantasia: nome,
      categoria_raw,
      segmento: mapCategory(categoria_raw),
      telefone: tel,
      whatsapp,
      website,
      endereco: addrParts.endereco,
      bairro: addrParts.bairro,
      cidade: addrParts.cidade,
      uf: addrParts.uf,
      avaliacao,
      total_avaliacoes,
      fonte: 'Google Maps (Captura Assistida)',
      fonte_tipo: 'MAPS',
      fonte_url,
    };
  }

  function dedupeKey(item) {
    if (item.fonte_url) return `url:${item.fonte_url}`;
    const n = String(item.nome_fantasia || '').toLowerCase().trim();
    const e = String(item.endereco || '').toLowerCase().trim();
    return `ne:${n}|${e}`;
  }

  function mergeIntoSession(item) {
    const key = dedupeKey(item);
    const prev = sessionSeen.get(key);
    if (!prev) {
      sessionSeen.set(key, item);
      return item;
    }
    const merged = {
      ...prev,
      ...Object.fromEntries(Object.entries(item).filter(([, v]) => v !== null && v !== undefined && v !== '')),
    };
    sessionSeen.set(key, merged);
    return merged;
  }

  function collectUniqueFeedLinks() {
    const feed = document.querySelector('div[role="feed"]');
    const scope = feed || document;
    const links = Array.from(scope.querySelectorAll('a[href*="/maps/place/"]'));
    const byUrl = new Map();
    for (const link of links) {
      const url = cleanMapsUrl(link.getAttribute('href'));
      const name = (link.getAttribute('aria-label') || link.textContent || '').trim();
      if (!url || !name) continue;
      if (!byUrl.has(url)) byUrl.set(url, { link, url, name });
    }
    return { feed, items: Array.from(byUrl.values()) };
  }

  function captureVisible() {
    const searchQuery = getSearchQuery();
    const detail = extractFromDetailPanel(searchQuery);
    if (detail) mergeIntoSession(detail);
    const { items } = collectUniqueFeedLinks();
    for (const entry of items) {
      const lead = extractFromCardElement(entry.link, searchQuery);
      if (lead) mergeIntoSession(lead);
    }
    return Array.from(sessionSeen.values());
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function interruptibleSleep(ms, isAbortedFn) {
    const step = 150;
    for (let elapsed = 0; elapsed < ms; elapsed += step) {
      if (isAbortedFn()) return;
      await sleep(Math.min(step, ms - elapsed));
    }
  }

  function randomScrollDelay() {
    return 1300 + Math.floor(Math.random() * 600); // 1300-1900ms
  }

  function randomClickDelay() {
    return 1400 + Math.floor(Math.random() * 800); // 1400-2200ms
  }

  function sendBgMessage(payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (res) => {
          if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message });
          resolve(res || { ok: false });
        });
      } catch (err) {
        resolve({ ok: false, error: err?.message || 'Erro runtime' });
      }
    });
  }

  async function waitForFeed(isAbortedFn, maxWaitMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (isAbortedFn()) return null;
      const feed = document.querySelector('div[role="feed"]');
      if (feed) return feed;
      await sleep(300);
    }
    return null;
  }

  /**
   * FASE 1 OBRIGATÓRIA: Rola o feed do Google Maps exaustivamente até o final da lista.
   */
  async function scrollFeedToEnd({ onProgress, isAbortedFn, checkRemoteStopFn } = {}) {
    const feed = await waitForFeed(isAbortedFn, 15000);
    if (!feed) {
      const { items } = collectUniqueFeedLinks();
      return { items, reachedEnd: false };
    }

    let lastCount = 0;
    let stalled = 0;
    let reachedEnd = false;
    let cycle = 0;

    while (!isAbortedFn()) {
      cycle++;
      feed.scrollTop = feed.scrollHeight;
      feed.dispatchEvent(new Event('scroll', { bubbles: true }));

      await interruptibleSleep(randomScrollDelay(), isAbortedFn);
      if (isAbortedFn()) break;

      const { items } = collectUniqueFeedLinks();
      const count = items.length;
      const feedText = feed.innerText || feed.textContent || '';
      const hasEndMarker = END_OF_LIST_RE.test(feedText);

      if (count > lastCount) {
        lastCount = count;
        stalled = 0;
      } else {
        stalled++;
        // Pequeno nudge para destravar lazy-load do Google Maps
        feed.scrollTop = Math.max(0, feed.scrollTop - 200);
        await interruptibleSleep(250, isAbortedFn);
        if (isAbortedFn()) break;
        feed.scrollTop = feed.scrollHeight;
        feed.dispatchEvent(new Event('scroll', { bubbles: true }));
      }

      if (hasEndMarker || stalled >= 5) {
        reachedEnd = true;
      }

      if (typeof onProgress === 'function') {
        await onProgress({ discovered: count, reachedEnd, stalled });
      }

      if (reachedEnd) break;

      if (typeof checkRemoteStopFn === 'function' && cycle % 2 === 0) {
        if (await checkRemoteStopFn()) break;
      }
    }

    const finalSnap = collectUniqueFeedLinks();
    return { items: finalSnap.items, reachedEnd };
  }

  function createMissionHud(mission, onStopClick) {
    document.getElementById('autonomia-maps-hud')?.remove();
    const hud = document.createElement('div');
    hud.id = 'autonomia-maps-hud';
    hud.style.cssText = [
      'position:fixed', 'bottom:18px', 'right:18px', 'z-index:2147483647',
      'width:330px', 'background:#0b132b', 'color:#e2e8f0',
      'border:1px solid #00d2ff', 'border-radius:14px', 'padding:12px 14px',
      'box-shadow:0 12px 32px rgba(0,0,0,0.55)',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
      'font-size:12px', 'line-height:1.45',
    ].join(';');

    hud.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px">
        <strong style="color:#00d2ff;font-size:13px">⚡ AutonomIA Maps</strong>
        <button id="autonomiaHudStop" type="button" style="background:#991b1b;color:#fff;border:0;border-radius:8px;padding:4px 10px;font-weight:700;cursor:pointer;font-size:11px">🛑 Parar</button>
      </div>
      <div style="color:#94a3b8;font-size:11px;margin-bottom:6px">${mission.query}</div>
      <div id="autonomiaHudPhase" style="font-weight:700;color:#fff">⏳ Preparando lista do Google Maps...</div>
      <div id="autonomiaHudStats" style="color:#38bdf8;margin-top:4px;font-size:11px"></div>
    `;

    document.body.appendChild(hud);
    hud.querySelector('#autonomiaHudStop')?.addEventListener('click', onStopClick);

    return {
      setStatus(phaseText, statsText = '') {
        const p = hud.querySelector('#autonomiaHudPhase');
        const s = hud.querySelector('#autonomiaHudStats');
        if (p) p.textContent = phaseText;
        if (s) s.textContent = statsText;
      },
      finish(finalText, statsText = '') {
        this.setStatus(finalText, statsText);
        const btn = hud.querySelector('#autonomiaHudStop');
        if (btn) {
          btn.textContent = 'Fechar';
          btn.style.background = '#1e293b';
          btn.onclick = () => hud.remove();
        }
      },
    };
  }

  /**
   * Runner autônomo disparado via #autonomia_mission={ID}:
   * Fase 1 (Rolagem Obrigatória até o Final) -> Fase 2 (Captura Profunda de 100% + Streaming a cada 5).
   */
  async function runMissionAutonomous(missionId, bridgeOpts = {}) {
    if (activeMissionRunnerId === missionId) return;
    const serverUrl = bridgeOpts.serverUrl || null;
    const accessKey = bridgeOpts.accessKey || null;
    const bgMissionMsg = (payload) => sendBgMessage({
      ...payload,
      ...(serverUrl ? { serverUrl } : {}),
      ...(accessKey ? { accessKey } : {}),
    });

    const res = await bgMissionMsg({ type: 'GET_ACTIVE_MISSION' });
    const mission = res?.data?.mission;
    if (!mission || mission.id !== missionId || mission.status !== 'RUNNING') return;

    activeMissionRunnerId = missionId;
    let stopped = false;

    const checkRemoteStop = async () => {
      if (stopped) return true;
      const latest = await bgMissionMsg({ type: 'GET_ACTIVE_MISSION' });
      const st = latest?.data?.mission?.status;
      if (st && st !== 'RUNNING') {
        stopped = true;
        return true;
      }
      return false;
    };

    const hud = createMissionHud(mission, async () => {
      stopped = true;
      hud.setStatus('⏹️ Interrompendo e salvando buffer...');
      await bgMissionMsg({ type: 'STOP_MISSION', missionId, reason: 'Parado no HUD do Google Maps' });
    });

    // FASE 1 — Rolagem obrigatória até o final
    hud.setStatus('📜 Fase 1: Rolando até o final da lista...');
    await bgMissionMsg({
      type: 'UPDATE_MISSION_PROGRESS',
      missionId,
      patch: { phase: 'SCROLLING_TO_END', message: 'Fase 1 iniciada: rolando feed até o fim' },
    });

    const scrollRes = await scrollFeedToEnd({
      isAbortedFn: () => stopped,
      checkRemoteStopFn: checkRemoteStop,
      onProgress: async ({ discovered, reachedEnd }) => {
        hud.setStatus(
          reachedEnd ? `✅ Fim da lista atingido! (${discovered} encontrados)` : `📜 Rolando até o final... ${discovered} encontrados`,
          'Fase 1 de 2 — Nenhum estabelecimento será deixado para trás'
        );
        await bgMissionMsg({
          type: 'UPDATE_MISSION_PROGRESS',
          missionId,
          patch: {
            phase: 'SCROLLING_TO_END',
            scroll_discovered: discovered,
            reached_end: reachedEnd,
          },
        });
      },
    });

    const uniqueTargets = scrollRes.items || [];
    const totalToCapture = uniqueTargets.length;

    if (stopped) {
      hud.finish(`⏹️ Missão parada na Fase 1 (${totalToCapture} encontrados)`);
      activeMissionRunnerId = null;
      return;
    }

    // FASE 2 — Captura profunda de 100% dos cards descobertos
    await bgMissionMsg({
      type: 'UPDATE_MISSION_PROGRESS',
      missionId,
      patch: {
        phase: 'DEEP_CAPTURING',
        scroll_discovered: totalToCapture,
        reached_end: true,
        total_to_capture: totalToCapture,
        captured_count: 0,
        message: `Fase 2 iniciada: capturando 100% dos ${totalToCapture} estabelecimentos`,
      },
    });

    const searchQuery = getSearchQuery() || mission.query;
    const visitedUrls = new Set();
    let batchBuffer = [];
    let capturedCount = 0;
    let sentCount = 0;

    const flushBuffer = async () => {
      if (!batchBuffer.length) return;
      const toSend = batchBuffer;
      batchBuffer = [];
      const resp = await bgMissionMsg({
        type: 'SEND_MAPS_BATCH',
        missionId,
        leads: toSend,
        autoDiagnose: mission.auto_diagnose,
        progress: { captured_count: capturedCount, total_to_capture: totalToCapture },
      });
      if (resp?.ok) {
        sentCount += toSend.length;
      }
    };

    for (let i = 0; i < uniqueTargets.length; i++) {
      if (stopped) break;
      if (i > 0 && i % 3 === 0) {
        if (await checkRemoteStop()) break;
      }

      const target = uniqueTargets[i];
      if (visitedUrls.has(target.url)) continue;
      visitedUrls.add(target.url);

      // Re-localiza o link no DOM caso o virtual scroller tenha re-renderizado
      let liveLink = target.link;
      if (!document.contains(liveLink)) {
        const fresh = collectUniqueFeedLinks().items.find((x) => x.url === target.url);
        if (fresh) liveLink = fresh.link;
      }

      const cardLead = liveLink && document.contains(liveLink)
        ? extractFromCardElement(liveLink, searchQuery)
        : null;

      try {
        if (liveLink && document.contains(liveLink)) {
          liveLink.scrollIntoView({ behavior: 'auto', block: 'center' });
          liveLink.click();
        }
      } catch {
        // Ignora erro de clique pontual
      }

      await interruptibleSleep(randomClickDelay(), () => stopped);
      if (stopped) break;

      const detail = extractFromDetailPanel(searchQuery);
      let finalLead = cardLead;
      if (detail && (detail.fonte_url === target.url || detail.nome_fantasia.toLowerCase() === target.name.toLowerCase())) {
        finalLead = {
          ...(cardLead || {}),
          ...Object.fromEntries(Object.entries(detail).filter(([, v]) => v !== null && v !== undefined && v !== '')),
          fonte_url: target.url,
        };
      }

      if (finalLead) {
        if (!finalLead.cidade || finalLead.cidade === 'Governador Valadares') {
          finalLead.cidade = mission.cidade;
          finalLead.uf = mission.uf;
        }
        const merged = mergeIntoSession(finalLead);
        batchBuffer.push(merged);
      }

      capturedCount = i + 1;
      hud.setStatus(
        `🔍 Capturando ${capturedCount}/${totalToCapture} • Enviados: ${sentCount}`,
        finalLead?.nome_fantasia ? `Atual: ${finalLead.nome_fantasia}${finalLead.telefone ? ' 📞' : ''}` : ''
      );

      if (batchBuffer.length >= 5) {
        await flushBuffer();
        hud.setStatus(
          `🔍 Capturando ${capturedCount}/${totalToCapture} • Enviados: ${sentCount}`,
          'Lote enviado com Raio-X + Matriz ao vivo'
        );
      }
    }

    await flushBuffer();

    if (stopped) {
      hud.finish(`⏹️ Parado (${capturedCount}/${totalToCapture} capturados · ${sentCount} enviados)`);
    } else {
      await bgMissionMsg({
        type: 'COMPLETE_MISSION',
        missionId,
        summary: {
          captured_count: capturedCount,
          total_to_capture: totalToCapture,
          reached_end: true,
        },
      });
      hud.finish(`✅ Lista inteira capturada! (${capturedCount} estabelecimentos)`, `Total enviados ao Caça Leads: ${sentCount}`);
    }

    activeMissionRunnerId = null;
  }

  function detectMissionHash() {
    const hash = String(window.location.hash || '');
    const m = hash.match(/autonomia_mission=([a-zA-Z0-9_-]+)/);
    if (!m || !m[1]) return;

    const apiMatch = hash.match(/autonomia_api=([^&]+)/);
    const keyMatch = hash.match(/autonomia_key=([^&]+)/);
    let apiUrl = null;
    let accessKey = null;

    if (apiMatch && apiMatch[1]) {
      try {
        apiUrl = decodeURIComponent(apiMatch[1]).trim().replace(/\/+$/, '');
      } catch {
        apiUrl = null;
      }
    }
    if (keyMatch && keyMatch[1]) {
      try {
        accessKey = decodeURIComponent(keyMatch[1]).trim();
      } catch {
        accessKey = null;
      }
    }

    if (apiUrl) {
      const toStore = { serverUrl: apiUrl };
      if (accessKey !== null) toStore.accessKey = accessKey;
      try {
        chrome.storage?.local?.set?.(toStore);
      } catch {
        // Ignora se storage indisponível
      }
    }

    setTimeout(() => runMissionAutonomous(m[1], { serverUrl: apiUrl, accessKey }), 1200);
  }

  // Modo Manual pelo Popup: agora também executa Fase 1 (Rolagem até o final) + Fase 2 (100% dos cards)
  async function runManualDeepCapture(port, existingQueue = []) {
    deepCaptureAborted = false;
    const searchQuery = getSearchQuery();
    const knownWithPhone = new Set(
      (existingQueue || [])
        .filter((x) => x.telefone || x.whatsapp)
        .map((x) => dedupeKey(x))
    );
    for (const [k, v] of sessionSeen.entries()) {
      if (v.telefone || v.whatsapp) knownWithPhone.add(k);
    }

    const scrollRes = await scrollFeedToEnd({
      isAbortedFn: () => deepCaptureAborted,
      onProgress: ({ discovered, reachedEnd }) => {
        try {
          port.postMessage({ type: 'SCROLL_PROGRESS', discovered, reachedEnd });
        } catch {
          deepCaptureAborted = true;
        }
      },
    });

    if (deepCaptureAborted) {
      try { port.postMessage({ type: 'DONE', aborted: true, processed: 0, total: 0 }); } catch {}
      return;
    }

    const targets = (scrollRes.items || []).filter((t) => !knownWithPhone.has(`url:${t.url}`));
    if (!targets.length) {
      try { port.postMessage({ type: 'DONE', aborted: false, processed: 0, total: 0 }); } catch {}
      return;
    }

    let processed = 0;
    for (let i = 0; i < targets.length; i++) {
      if (deepCaptureAborted) break;
      const target = targets[i];
      let liveLink = target.link;
      if (!document.contains(liveLink)) {
        const fresh = collectUniqueFeedLinks().items.find((x) => x.url === target.url);
        if (fresh) liveLink = fresh.link;
      }

      const cardLead = liveLink && document.contains(liveLink)
        ? extractFromCardElement(liveLink, searchQuery)
        : null;

      try {
        if (liveLink && document.contains(liveLink)) {
          liveLink.scrollIntoView({ behavior: 'auto', block: 'center' });
          liveLink.click();
        }
      } catch {}

      await interruptibleSleep(randomClickDelay(), () => deepCaptureAborted);
      if (deepCaptureAborted) break;

      const detail = extractFromDetailPanel(searchQuery);
      let finalLead = cardLead;
      if (detail && (detail.fonte_url === target.url || detail.nome_fantasia.toLowerCase() === target.name.toLowerCase())) {
        finalLead = {
          ...(cardLead || {}),
          ...Object.fromEntries(Object.entries(detail).filter(([, v]) => v !== null && v !== undefined && v !== '')),
          fonte_url: target.url,
        };
      }

      if (finalLead) {
        const merged = mergeIntoSession(finalLead);
        processed++;
        try {
          port.postMessage({ type: 'PROGRESS', current: i + 1, total: targets.length, lead: merged });
        } catch {
          deepCaptureAborted = true;
          break;
        }
      }
    }

    try {
      port.postMessage({ type: 'DONE', aborted: deepCaptureAborted, processed, total: targets.length });
    } catch {}
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'CAPTURE_VISIBLE') {
      try {
        const leads = captureVisible();
        sendResponse({ ok: true, leads });
      } catch (err) {
        sendResponse({ ok: false, error: err.message || 'Erro ao ler página do Maps' });
      }
      return true;
    }
    return false;
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'deep-capture') return;
    port.onDisconnect.addListener(() => {
      deepCaptureAborted = true;
    });
    port.onMessage.addListener((msg) => {
      if (msg?.type === 'START_DEEP_CAPTURE') {
        runManualDeepCapture(port, msg.existingQueue);
      } else if (msg?.type === 'STOP_DEEP_CAPTURE') {
        deepCaptureAborted = true;
      }
    });
  });

  window.addEventListener('hashchange', detectMissionHash);
  detectMissionHash();
})();
