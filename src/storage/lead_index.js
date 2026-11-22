import { normalizePhone, validateCNPJ, normalizeDomain } from '../hygiene.js';

export function normalizedText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function normalizeSourceUrl(rawUrl) {
  const raw = String(rawUrl ?? '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    u.hash = '';
    const cleanPath = u.pathname.replace(/\/+$/, '');
    return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${cleanPath}${u.search}`;
  } catch {
    return raw.toLowerCase().replace(/\/+$/, '');
  }
}

export function validCnpjKey(raw) {
  const res = validateCNPJ(raw);
  return res.valido ? res.digits : '';
}

export function extractPhoneKeys(row) {
  const keys = [];
  for (const field of [row?.whatsapp, row?.telefone, row?.phone]) {
    if (!field) continue;
    const norm = normalizePhone(field);
    if (norm.valido && norm.digits) keys.push(norm.digits);
  }
  return keys;
}

function nameCityKey(row) {
  const name = normalizedText(row?.nome_fantasia || row?.nome);
  if (!name) return '';
  const city = normalizedText(row?.cidade || 'Governador Valadares');
  return `${name}::${city}`;
}

function addToMap(map, key, id) {
  if (!key) return;
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(id);
}

function removeFromMap(map, key, id) {
  if (!key) return;
  const set = map.get(key);
  if (!set) return;
  set.delete(id);
  if (set.size === 0) map.delete(key);
}

function summarizeMatch(row) {
  return {
    id: row.id,
    nome_fantasia: row.nome_fantasia,
    cidade: row.cidade,
    whatsapp: row.whatsapp,
    telefone: row.telefone,
    cnpj: row.cnpj,
    fonte_url: row.fonte_url,
  };
}

/**
 * Índices secundários em RAM para lookups O(1) por ID, URL, CNPJ, telefone, domínio e nome+cidade.
 */
export class LeadIndex {
  constructor() {
    this.byId = new Map();
    this.byFonteUrl = new Map();
    this.byCnpj = new Map();
    this.byPhone = new Map();
    this.byDomain = new Map();
    this.byNameCity = new Map();
    this.byCity = new Map();
    this._keysById = new Map();
  }

  clear() {
    this.byId.clear();
    this.byFonteUrl.clear();
    this.byCnpj.clear();
    this.byPhone.clear();
    this.byDomain.clear();
    this.byNameCity.clear();
    this.byCity.clear();
    this._keysById.clear();
  }

  rebuild(leads) {
    this.clear();
    if (!Array.isArray(leads)) return;
    for (const lead of leads) {
      if (lead && lead.id) this.upsert(lead);
    }
  }

  upsert(lead) {
    if (!lead || !lead.id) return;
    if (this.byId.has(lead.id)) {
      this.remove(lead.id);
    }

    const id = lead.id;
    const urlKey = normalizeSourceUrl(lead.fonte_url);
    const cnpjKey = validCnpjKey(lead.cnpj);
    const phones = extractPhoneKeys(lead);
    const domainKey = normalizeDomain(lead.website) || '';
    const ncKey = nameCityKey(lead);
    const cityKey = normalizedText(lead.cidade || 'Governador Valadares');

    this.byId.set(id, lead);
    addToMap(this.byFonteUrl, urlKey, id);
    addToMap(this.byCnpj, cnpjKey, id);
    for (const p of phones) addToMap(this.byPhone, p, id);
    addToMap(this.byDomain, domainKey, id);
    addToMap(this.byNameCity, ncKey, id);
    addToMap(this.byCity, cityKey, id);

    this._keysById.set(id, { urlKey, cnpjKey, phones, domainKey, ncKey, cityKey });
  }

  remove(id) {
    if (!this.byId.has(id)) return false;
    this.byId.delete(id);
    const prev = this._keysById.get(id);
    if (prev) {
      removeFromMap(this.byFonteUrl, prev.urlKey, id);
      removeFromMap(this.byCnpj, prev.cnpjKey, id);
      for (const p of prev.phones) removeFromMap(this.byPhone, p, id);
      removeFromMap(this.byDomain, prev.domainKey, id);
      removeFromMap(this.byNameCity, prev.ncKey, id);
      removeFromMap(this.byCity, prev.cityKey, id);
      this._keysById.delete(id);
    }
    return true;
  }

  getById(id) {
    return this.byId.get(id) || null;
  }

  findDuplicateCandidates(candidate, excludeId = null) {
    if (!candidate || typeof candidate !== 'object') return [];
    const matchedIds = new Set();

    const collect = (set) => {
      if (!set) return;
      for (const id of set) {
        if (id !== excludeId) matchedIds.add(id);
      }
    };

    const urlKey = normalizeSourceUrl(candidate.fonte_url);
    if (urlKey) collect(this.byFonteUrl.get(urlKey));

    const cnpjKey = validCnpjKey(candidate.cnpj);
    if (cnpjKey) collect(this.byCnpj.get(cnpjKey));

    for (const p of extractPhoneKeys(candidate)) {
      collect(this.byPhone.get(p));
    }

    const domainKey = normalizeDomain(candidate.website);
    if (domainKey) collect(this.byDomain.get(domainKey));

    const ncKey = nameCityKey(candidate);
    if (ncKey) collect(this.byNameCity.get(ncKey));

    // Fallback parcial escopado apenas à mesma cidade quando nome >= 7 chars + endereço/bairro
    const name = normalizedText(candidate.nome_fantasia || candidate.nome);
    const addr = normalizedText(candidate.endereco || candidate.address);
    const neighborhood = normalizedText(candidate.bairro);
    if (name.length >= 7 && (addr || neighborhood)) {
      const cityKey = normalizedText(candidate.cidade || 'Governador Valadares');
      const cityIds = this.byCity.get(cityKey);
      if (cityIds) {
        for (const id of cityIds) {
          if (id === excludeId || matchedIds.has(id)) continue;
          const row = this.byId.get(id);
          if (!row) continue;
          const rowName = normalizedText(row.nome_fantasia);
          if (rowName.length < 7) continue;
          if (!(rowName.includes(name) || name.includes(rowName))) continue;
          const rowAddr = normalizedText(row.endereco);
          const addrMatch = Boolean(addr && rowAddr && (rowAddr.includes(addr) || addr.includes(rowAddr)));
          const neighMatch = Boolean(neighborhood && normalizedText(row.bairro) === neighborhood);
          if (addrMatch || neighMatch) matchedIds.add(id);
        }
      }
    }

    const matches = [];
    for (const id of matchedIds) {
      const row = this.byId.get(id);
      if (row) matches.push(summarizeMatch(row));
    }
    return matches;
  }

  getStats() {
    return {
      total_indexed: this.byId.size,
      by_fonte_url: this.byFonteUrl.size,
      by_cnpj: this.byCnpj.size,
      by_phone: this.byPhone.size,
      by_domain: this.byDomain.size,
      by_name_city: this.byNameCity.size,
    };
  }
}
