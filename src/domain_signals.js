import { normalizePhone } from './hygiene.js';

export const SITE_DEPENDENT_PAIN_TAGS = new Set([
  'Sem HTTPS',
  'Site sem WhatsApp',
  'Sem Tráfego Rastreado',
  'Sem Mobile',
  'Site Lento',
  'E-commerce sem Pixel',
]);

export const LINK_BIO_RE = /(?:linktr\.ee|bio\.site|beacons\.ai|instabio|canva\.site)/i;

export const SEGMENTS_CATALOG = {
  RESTAURANTE: 'Restaurante',
  LANCHONETE: 'Lanchonete',
  PADARIA: 'Padaria',
  MERCADO: 'Supermercado',
  ADEGA: 'Adega',
  CLINICA: 'Clínica',
  ACADEMIA: 'Academia',
  OFICINA: 'Oficina Mecânica',
  SALAO: 'Salão de Beleza',
  PETSHOP: 'Pet Shop',
  FARMACIA: 'Farmácia',
  IMOBILIARIA: 'Imobiliária',
  ESCRITORIO: 'Escritório de Contabilidade',
  BAR: 'Bar',
  HOTEL: 'Hotel',
  LOJA: 'Loja',
};

const DEFAULT_ALLOWED_SEGMENTS = [
  'BAR', 'RESTAURANTE', 'LANCHONETE', 'PADARIA', 'MERCADO', 'ADEGA', 'HOTEL', 'EVENTOS', 'SUPERMERCADO',
  'CLINICA', 'ACADEMIA', 'OFICINA', 'FARMACIA', 'SALAO', 'PETSHOP', 'IMOBILIARIA', 'ESCRITORIO', 'LOJA', 'OUTRO',
];

export function getSegmentSearchLabel(segmento) {
  const key = String(segmento || 'RESTAURANTE').trim().toUpperCase();
  return SEGMENTS_CATALOG[key] || key;
}

export function mapCategoryToSegment(rawCategory, explicitSegment, allowedSegments = DEFAULT_ALLOWED_SEGMENTS) {
  const allowed = Array.isArray(allowedSegments) && allowedSegments.length ? allowedSegments : DEFAULT_ALLOWED_SEGMENTS;
  const exp = String(explicitSegment || '').trim().toUpperCase();
  if (exp && exp !== 'OUTRO' && allowed.includes(exp)) return exp;

  const cat = String(rawCategory || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (!cat) return allowed.includes(exp) ? exp : 'OUTRO';
  if (/restaurante|churrascaria|pizzaria|bistro|cantina|sushi|comida|osteria/.test(cat)) return 'RESTAURANTE';
  if (/bar|pub|choperia|chopperia|boteco|lounge/.test(cat)) return 'BAR';
  if (/lanchonete|hamburgueria|hamburger|acai|pastelaria|cafe|cafeteria|padoca|snack/.test(cat)) return 'LANCHONETE';
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
  if (/imobiliaria|corretor de imoveis/.test(cat)) return 'IMOBILIARIA';
  if (/escritorio|contabilidade|advocacia|consultoria/.test(cat)) return 'ESCRITORIO';
  if (/loja|boutique|comercio|magazine/.test(cat)) return 'LOJA';
  return allowed.includes(exp) ? exp : 'OUTRO';
}

/**
 * Sanitiza etiquetas de dor em tempo de leitura/gravação, removendo etiquetas que dependem
 * de um site próprio online quando o lead não tem site, tem só Link na Bio ou site fora do ar.
 */
export function sanitizePainTags(lead) {
  const tags = new Set(Array.isArray(lead?.etiquetas_dor) ? lead.etiquetas_dor.filter(Boolean) : []);
  const rawSite = String(lead?.website || '').trim();
  const audit = lead?.diagnostico_fatos?.website_audit || null;
  const isLinkBio = Boolean(
    rawSite && (
      LINK_BIO_RE.test(rawSite)
      || (Array.isArray(audit?.stack_detectada) && audit.stack_detectada.includes('LINK_BIO'))
    )
  );
  const siteOffline = audit?.online === false;
  const shouldStripSiteDependent = !rawSite
    || isLinkBio
    || siteOffline
    || tags.has('Sem Site')
    || tags.has('Site Fora do Ar')
    || tags.has('Só Link na Bio');

  if (shouldStripSiteDependent) {
    for (const depTag of SITE_DEPENDENT_PAIN_TAGS) {
      tags.delete(depTag);
    }
  }

  if (!rawSite) {
    tags.delete('Site Fora do Ar');
    tags.delete('Só Link na Bio');
    tags.add('Sem Site');
  } else if (isLinkBio) {
    tags.delete('Sem Site');
    tags.add('Só Link na Bio');
  } else if (siteOffline) {
    tags.delete('Sem Site');
    tags.add('Site Fora do Ar');
  }

  return [...tags];
}

/**
 * Extrai perfil canônico de contatos do lead (WhatsApp, celular, fixo, e-mail).
 */
export function extractContactProfile(lead) {
  const waNorm = normalizePhone(lead?.whatsapp);
  const telNorm = normalizePhone(lead?.telefone);
  const waInvalid = lead?.whatsapp_status === 'INVALIDO';
  const hasRawMobile = (waNorm.valido && waNorm.whatsapp_provavel) || (telNorm.valido && telNorm.whatsapp_provavel);
  const hasMobile = !waInvalid && hasRawMobile;
  const hasLandline = (waNorm.valido && waNorm.tipo === 'FIXO') || (telNorm.valido && telNorm.tipo === 'FIXO');
  const isLandlineOnly = hasLandline && !hasRawMobile;
  const hasAnyPhone = waNorm.valido || telNorm.valido;
  const hasEmail = Boolean(lead?.email);
  const primaryPhone = lead?.whatsapp || lead?.telefone || null;
  const primaryType = hasRawMobile ? 'CELULAR' : (hasLandline ? 'FIXO' : 'DESCONHECIDO');

  return {
    hasMobile,
    hasLandline,
    hasAnyPhone,
    hasEmail,
    waInvalid,
    primaryPhone,
    primaryType,
    isLandlineOnly,
  };
}

export function inferOrigin(lead) {
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
}

export function inferOriginKey(lead) {
  return inferOrigin(lead).key;
}

export function hashString(str) {
  const s = String(str ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function toIsoDateLocal(d = new Date()) {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDaysIsoDate(baseDateOrStr, days = 0) {
  const delta = Number(days || 0);
  if (typeof baseDateOrStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(baseDateOrStr.trim())) {
    const dt = new Date(`${baseDateOrStr.trim()}T12:00:00Z`);
    if (Number.isNaN(dt.getTime())) return '';
    dt.setUTCDate(dt.getUTCDate() + delta);
    return dt.toISOString().slice(0, 10);
  }
  const base = baseDateOrStr instanceof Date ? baseDateOrStr : new Date(baseDateOrStr || Date.now());
  if (Number.isNaN(base.getTime())) return '';
  const dt = new Date(base.getTime());
  dt.setDate(dt.getDate() + delta);
  return toIsoDateLocal(dt);
}

export function isValidIsoDate(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(`${str}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === str;
}
