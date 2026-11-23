import { normalizePhone, validateCNPJ } from './hygiene.js';
import { validateExternalUrl } from './http/ssrf_guard.js';

const MAX_HTML_BYTES = 512 * 1024; // 512 KB
const cnpjCache = new Map();

const IGNORED_EMAIL_EXT_RE = /\.(png|jpe?g|gif|svg|webp|ico|js|css|woff2?|ttf|eot|map)$/i;
const IGNORED_EMAIL_DOMAIN_RE = /(sentry|wixpress|example\.com|yourdomain|domain\.com|email\.com|teste\.com)/i;
const IGNORED_IG_PATHS = new Set([
  'p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'about', 'legal', 'directory', 'developer', 'tv',
]);

const LINK_BIO_RE = /(?:linktr\.ee|bio\.site|beacons\.ai|instabio|canva\.site)/i;

export const SITE_DEPENDENT_PAIN_TAGS = new Set([
  'Sem HTTPS',
  'Site sem WhatsApp',
  'Sem Tráfego Rastreado',
  'Sem Mobile',
  'Site Lento',
  'E-commerce sem Pixel',
]);

function normalizeHeaders(headers = {}) {
  const out = {};
  if (!headers) return out;
  if (typeof headers.forEach === 'function') {
    headers.forEach((v, k) => { out[String(k).toLowerCase()] = String(v); });
  } else if (typeof headers === 'object') {
    for (const [k, v] of Object.entries(headers)) {
      out[String(k).toLowerCase()] = String(v ?? '');
    }
  }
  return out;
}

/**
 * Analisa HTML bruto e headers HTTP de um site para extrair sinais de 1ª e 2ª geração sem executar JS.
 */
export function parseWebsiteHtml(html, headers = {}, rawUrl = '') {
  const source = String(html || '');
  const hdrs = normalizeHeaders(headers);
  const hdrText = Object.entries(hdrs).map(([k, v]) => `${k}:${v}`).join('\n');

  const has_whatsapp = /wa\.me\/|api\.whatsapp\.com\/|whatsapp:\/\/|whatsapp-button|btn-whatsapp|widget.*whatsapp/i.test(source);
  const has_meta_pixel = /connect\.facebook\.net|fbq\s*\(|fbevents\.js/i.test(source);
  const has_gtm_or_ads = /googletagmanager\.com|gtag\s*\(|googleadservices\.com/i.test(source);

  const rawEmails = source.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  const emailSet = new Set();
  for (const em of rawEmails) {
    const clean = em.toLowerCase().trim();
    if (IGNORED_EMAIL_EXT_RE.test(clean)) continue;
    if (IGNORED_EMAIL_DOMAIN_RE.test(clean)) continue;
    emailSet.add(clean);
    if (emailSet.size >= 5) break;
  }

  let instagram_found = null;
  const igRe = /https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._]{2,30})(?:\/|\?|"|'|\s|$)/gi;
  let m;
  while ((m = igRe.exec(source)) !== null) {
    const handle = m[1].toLowerCase();
    if (IGNORED_IG_PATHS.has(handle)) continue;
    instagram_found = `https://instagram.com/${m[1]}`;
    break;
  }

  // Raio-X 2ª geração: Stack, E-commerce, Mobile Viewport, SEO básico e Schema Local
  const stack = new Set();
  if (/cdn\.shopify\.com|myshopify\.com|shopify\.theme/i.test(source) || /x-shopify/i.test(hdrText)) stack.add('SHOPIFY');
  if (/tiendanube|nuvemshop|d26lpennugtm8s\.cloudfront\.net/i.test(source)) stack.add('NUVEMSHOP');
  if (/woocommerce|wc-block|wc-cart/i.test(source)) stack.add('WOOCOMMERCE');
  if (/tray\.com\.br|images\.tcdn\.com\.br/i.test(source)) stack.add('TRAY');
  if (/lojaintegrada|cdn\.awsli\.com\.br/i.test(source)) stack.add('LOJA_INTEGRADA');
  if (/wp-content|wp-includes/i.test(source)) stack.add('WORDPRESS');
  if (/wixstatic\.com|wix-thunderbolt/i.test(source) || /x-wix-/i.test(hdrText)) stack.add('WIX');
  if (/elementor/i.test(source)) stack.add('ELEMENTOR');
  if (/d335luupugsy2\.cloudfront\.net|rdstation/i.test(source)) stack.add('RD_STATION');

  const isLinkBioUrl = LINK_BIO_RE.test(String(rawUrl || ''));
  const hasFullPlatform = stack.size > 0;
  if (isLinkBioUrl || (!hasFullPlatform && LINK_BIO_RE.test(source))) {
    stack.add('LINK_BIO');
  }

  const stack_detectada = [...stack];
  const ecomPlatforms = ['SHOPIFY', 'NUVEMSHOP', 'WOOCOMMERCE', 'TRAY', 'LOJA_INTEGRADA'];
  const has_ecommerce = stack_detectada.some((s) => ecomPlatforms.includes(s))
    || /(?:\/checkout\b|\/carrinho\b|add-to-cart|adicionar ao carrinho|finalizar compra)/i.test(source);

  const has_viewport_mobile = /<meta\s[^>]*name\s*=\s*["']viewport["'][^>]*>/i.test(source);

  const titleMatch = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const titleText = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';
  const hasMetaDesc = /<meta\s[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["'][^"']{5,}["'][^>]*>|<meta\s[^>]*content\s*=\s*["'][^"']{5,}["'][^>]*name\s*=\s*["']description["'][^>]*>/i.test(source);
  const seo_basico_ok = titleText.length > 5 && hasMetaDesc;

  const has_schema_local = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?(?:LocalBusiness|Organization)[\s\S]*?<\/script>/i.test(source);

  return {
    has_whatsapp,
    has_meta_pixel,
    has_gtm_or_ads,
    emails_found: [...emailSet],
    instagram_found,
    stack_detectada,
    has_ecommerce,
    has_viewport_mobile,
    seo_basico_ok,
    has_schema_local,
  };
}

async function readStreamLimited(res, maxBytes = MAX_HTML_BYTES) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const text = await res.text();
    return text.slice(0, maxBytes);
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      const remaining = maxBytes - total;
      if (chunk.byteLength >= remaining) {
        chunks.push(chunk.subarray(0, remaining));
        total += remaining;
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(chunk);
      total += chunk.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

function normalizeCandidateUrls(rawUrl) {
  const input = String(rawUrl || '').trim();
  if (!input) return [];
  const stripped = input.replace(/^https?:\/\//i, '');
  return [`https://${stripped}`, `http://${stripped}`];
}

function emptyAuditResult(error) {
  return {
    online: false,
    https: false,
    ttfb_ms: null,
    has_whatsapp: false,
    has_meta_pixel: false,
    has_gtm_or_ads: false,
    emails_found: [],
    instagram_found: null,
    stack_detectada: [],
    has_ecommerce: false,
    has_viewport_mobile: false,
    seo_basico_ok: false,
    has_schema_local: false,
    error,
  };
}

/**
 * Raio-X HTTP leve em site comercial (HTTPS primeiro, fallback HTTP, teto de 512 KB, mede TTFB).
 */
export async function auditWebsite(rawUrl, { fetchImpl = fetch, validateUrlImpl = null } = {}) {
  const candidates = normalizeCandidateUrls(rawUrl);
  if (!candidates.length) {
    return emptyAuditResult('URL ausente');
  }

  const validator = validateUrlImpl !== null
    ? validateUrlImpl
    : (fetchImpl === fetch ? validateExternalUrl : null);

  let lastError = null;
  for (const url of candidates) {
    if (typeof validator === 'function') {
      try {
        await validator(url);
      } catch (err) {
        return emptyAuditResult(err?.message || 'URL bloqueada por segurança');
      }
    }
    try {
      const t0 = performance.now();
      const res = await fetchImpl(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(5000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AutonomIA-LeadsBot/2.0)',
          'Accept': 'text/html,application/xhtml+xml',
        },
      });
      const ttfb_ms = Math.round(performance.now() - t0);
      const html = await readStreamLimited(res, MAX_HTML_BYTES);
      const finalUrl = res.url || url;
      const parsed = parseWebsiteHtml(html, res.headers, finalUrl);
      const online = res.status >= 200 && res.status < 400;
      const isHttps = finalUrl.toLowerCase().startsWith('https://');
      return {
        online,
        https: isHttps,
        ttfb_ms,
        status_code: res.status,
        final_url: finalUrl,
        ...parsed,
        error: online ? null : `HTTP ${res.status}`,
      };
    } catch (err) {
      lastError = err?.message || 'Falha de conexão';
    }
  }

  return emptyAuditResult(lastError || 'Site inacessível');
}

/**
 * Consulta BrasilAPI para CNPJ válido com cache em memória.
 */
export async function enrichCNPJ(rawCnpj, { fetchImpl = fetch, skipCache = false } = {}) {
  const check = validateCNPJ(rawCnpj);
  if (!check.valido) return null;

  if (!skipCache && cnpjCache.has(check.digits)) {
    return cnpjCache.get(check.digits);
  }

  try {
    const res = await fetchImpl(`https://brasilapi.com.br/api/cnpj/v1/${check.digits}`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const socios = (Array.isArray(data.qsa) ? data.qsa : [])
      .map((s) => String(s?.nome_socio || s?.nome || '').trim())
      .filter(Boolean)
      .slice(0, 5);

    const info = {
      cnpj: check.digits,
      razao_social: data.razao_social || null,
      nome_fantasia: data.nome_fantasia || null,
      situacao_cadastral: data.descricao_situacao_cadastral || String(data.situacao_cadastral || '') || null,
      data_inicio_atividade: data.data_inicio_atividade || null,
      capital_social: typeof data.capital_social === 'number' ? data.capital_social : Number(data.capital_social) || 0,
      cnae_fiscal_descricao: data.cnae_fiscal_descricao || null,
      socios,
    };

    if (!skipCache) cnpjCache.set(check.digits, info);
    return info;
  } catch {
    return null;
  }
}

function isRecentCompany(dateStr, referenceDate = new Date()) {
  if (!dateStr) return false;
  const opened = new Date(dateStr);
  if (Number.isNaN(opened.getTime())) return false;
  const diffMonths = (referenceDate.getTime() - opened.getTime()) / (1000 * 60 * 60 * 24 * 30.4375);
  return diffMonths >= 0 && diffMonths <= 18;
}

/**
 * Gera etiquetas de dor padronizadas (1ª e 2ª geração) a partir do lead e dos fatos coletados.
 */
export function buildPainTags(lead, facts = {}, referenceDate = new Date()) {
  const tags = new Set();
  const audit = facts?.website_audit || null;
  const cnpjInfo = facts?.cnpj_info || null;

  const rawSite = String(lead?.website || '').trim();
  const isLinkBio = Boolean(
    rawSite && (
      LINK_BIO_RE.test(rawSite)
      || (Array.isArray(audit?.stack_detectada) && audit.stack_detectada.includes('LINK_BIO'))
    )
  );

  if (!rawSite) {
    tags.add('Sem Site');
  } else if (isLinkBio) {
    tags.add('Só Link na Bio');
  } else if (audit) {
    if (!audit.online) {
      tags.add('Site Fora do Ar');
    } else {
      if (!audit.https) tags.add('Sem HTTPS');
      if (!audit.has_whatsapp) tags.add('Site sem WhatsApp');
      if (!audit.has_meta_pixel && !audit.has_gtm_or_ads) tags.add('Sem Tráfego Rastreado');
      if (typeof audit.ttfb_ms === 'number' && audit.ttfb_ms >= 1800) tags.add('Site Lento');
      if (audit.has_viewport_mobile === false) tags.add('Sem Mobile');
      if (audit.has_ecommerce === true && !audit.has_meta_pixel && !audit.has_gtm_or_ads) {
        tags.add('E-commerce sem Pixel');
      }
    }
  }

  const waNorm = normalizePhone(lead?.whatsapp);
  const telNorm = normalizePhone(lead?.telefone);
  const hasMobile = (waNorm.valido && waNorm.whatsapp_provavel) || (telNorm.valido && telNorm.whatsapp_provavel);
  const hasFixo = (waNorm.valido && waNorm.tipo === 'FIXO') || (telNorm.valido && telNorm.tipo === 'FIXO');
  if (hasFixo && !hasMobile) {
    tags.add('Só Telefone Fixo');
  }

  if (cnpjInfo) {
    const sit = String(cnpjInfo.situacao_cadastral || '').trim().toUpperCase();
    if (sit && sit !== 'ATIVA' && sit !== '2') {
      tags.add('CNPJ Inativo');
    }
    if (isRecentCompany(cnpjInfo.data_inicio_atividade, referenceDate)) {
      tags.add('Empresa Recente');
    }
  }

  return [...tags];
}

/**
 * Coleta fatos brutos (Website 2ª Geração + BrasilAPI) e retorna o pacote de diagnóstico para persistência.
 */
export async function collectLeadFacts(lead, deps = {}) {
  const [website_audit, cnpj_info] = await Promise.all([
    lead?.website ? auditWebsite(lead.website, deps) : Promise.resolve(null),
    lead?.cnpj ? enrichCNPJ(lead.cnpj, deps) : Promise.resolve(null),
  ]);

  const diagnostico_fatos = {
    website_audit,
    cnpj_info,
  };

  const etiquetas_dor = buildPainTags(lead, diagnostico_fatos, deps.referenceDate || new Date());
  const redes = Array.isArray(lead?.redes_sociais) ? [...lead.redes_sociais] : [];
  if (website_audit?.instagram_found && !redes.some((r) => r.toLowerCase().includes('instagram.com'))) {
    redes.push(`instagram:${website_audit.instagram_found}`);
  }

  const patch = {
    diagnostico_fatos,
    diagnostico_em: new Date().toISOString(),
    etiquetas_dor,
    redes_sociais: redes,
  };

  if (!lead?.email && website_audit?.emails_found?.length) {
    patch.email = website_audit.emails_found[0];
  }
  if (!lead?.razao_social && cnpj_info?.razao_social) {
    patch.razao_social = cnpj_info.razao_social;
  }
  if (cnpj_info?.socios?.length) {
    patch.socios = cnpj_info.socios;
  }

  return patch;
}

export function clearCnpjCache() {
  cnpjCache.clear();
}
