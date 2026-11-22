const GENERIC_SOCIAL_DOMAINS = new Set([
  'instagram.com',
  'facebook.com',
  'fb.com',
  'linktr.ee',
  'wa.me',
  'api.whatsapp.com',
  'whatsapp.com',
  'linkedin.com',
  'tiktok.com',
  'youtube.com',
  'youtu.be',
  'twitter.com',
  'x.com',
]);

/**
 * Normaliza telefone brasileiro tratando corretamente o DDD 55.
 * Só considera DDI 55 quando começa com 55 e possui 12 ou 13 dígitos.
 */
export function normalizePhone(raw) {
  const rawStr = String(raw ?? '').trim();
  const allDigits = rawStr.replace(/\D/g, '');
  if (!allDigits) {
    return {
      raw: rawStr,
      digits: '',
      e164: null,
      tipo: 'DESCONHECIDO',
      valido: false,
      whatsapp_provavel: false,
    };
  }

  let national = allDigits;
  if (allDigits.startsWith('55') && (allDigits.length === 12 || allDigits.length === 13)) {
    national = allDigits.slice(2);
  }

  if (national.length === 11 && national[2] === '9') {
    return {
      raw: rawStr,
      digits: national,
      e164: `55${national}`,
      tipo: 'CELULAR',
      valido: true,
      whatsapp_provavel: true,
    };
  }

  if (national.length === 10) {
    return {
      raw: rawStr,
      digits: national,
      e164: `55${national}`,
      tipo: 'FIXO',
      valido: true,
      whatsapp_provavel: false,
    };
  }

  return {
    raw: rawStr,
    digits: national,
    e164: null,
    tipo: 'DESCONHECIDO',
    valido: false,
    whatsapp_provavel: false,
  };
}

/**
 * Gera link wa.me seguro usando normalizePhone (sem duplicar DDI 55).
 */
export function buildWhatsAppLink(rawPhone, text = '') {
  const norm = normalizePhone(rawPhone);
  if (!norm.valido || !norm.e164) return null;
  const query = text ? `?text=${encodeURIComponent(text)}` : '';
  return `https://wa.me/${norm.e164}${query}`;
}

/**
 * Valida CNPJ brasileiro com cálculo dos 2 dígitos verificadores (módulo 11).
 */
export function validateCNPJ(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  const formatted = digits.length === 14
    ? `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`
    : '';

  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) {
    return { digits, formatted, valido: false };
  }

  const calcDigit = (base, weights) => {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) {
      sum += Number(base[i]) * weights[i];
    }
    const rem = sum % 11;
    return rem < 2 ? 0 : 11 - rem;
  };

  const d1 = calcDigit(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calcDigit(digits, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const valido = Number(digits[12]) === d1 && Number(digits[13]) === d2;

  return { digits, formatted, valido };
}

/**
 * Extrai domínio limpo em minúsculas para deduplicação.
 * Ignora domínios genéricos de redes sociais para não fundir empresas distintas.
 */
export function normalizeDomain(rawUrl) {
  const input = String(rawUrl ?? '').trim();
  if (!input) return null;

  const withProto = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  try {
    const u = new URL(withProto);
    let host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (!host || !host.includes('.')) return null;

    if (GENERIC_SOCIAL_DOMAINS.has(host)) return null;
    for (const social of GENERIC_SOCIAL_DOMAINS) {
      if (host.endsWith(`.${social}`)) return null;
    }

    return host;
  } catch {
    return null;
  }
}

/**
 * Normaliza URLs de redes sociais pelo host + caminho completo para comparação opcional.
 */
export function normalizeSocialUrl(rawUrl) {
  const input = String(rawUrl ?? '').trim();
  if (!input) return null;
  const withProto = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  try {
    const u = new URL(withProto);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const pathname = u.pathname.replace(/\/+$/, '').toLowerCase();
    return pathname ? `${host}${pathname}` : host;
  } catch {
    return null;
  }
}
