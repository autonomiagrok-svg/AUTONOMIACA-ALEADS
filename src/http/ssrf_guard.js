import dns from 'node:dns/promises';
import net from 'node:net';

function isBlockedIpv4(ip) {
  const parts = String(ip || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8
  if (a === 169 && b === 254) return true; // 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  return false;
}

function expandIpv6Groups(rawIp) {
  let ip = String(rawIp || '').toLowerCase().split('%')[0];
  if (ip.includes('.')) {
    const lastColon = ip.lastIndexOf(':');
    const v4Part = ip.slice(lastColon + 1);
    const octets = v4Part.split('.').map(Number);
    if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    ip = `${ip.slice(0, lastColon)}:${hi}:${lo}`;
  }
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
  const missing = 8 - (left.length + right.length);
  if (missing < 0 || (halves.length === 1 && left.length !== 8)) return null;
  const full = [...left, ...Array(missing).fill('0'), ...right];
  return full.map((g) => parseInt(g, 16));
}

function isBlockedIpv6(ip) {
  const groups = expandIpv6Groups(ip);
  if (!groups) return true;

  const isAllZeroExceptLast = groups.slice(0, 7).every((g) => g === 0);
  if (isAllZeroExceptLast && (groups[7] === 0 || groups[7] === 1)) {
    return true; // :: e ::1
  }

  // fc00::/7 (Unique Local Addresses: fc00..fdff)
  if ((groups[0] & 0xfe00) === 0xfc00) return true;

  // fe80::/10 (Link-local: fe80..febf)
  if ((groups[0] & 0xffc0) === 0xfe80) return true;

  // IPv4-mapped ::ffff:0:0/96 (0:0:0:0:0:ffff:xxxx:yyyy)
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const v4 = [
      (groups[6] >> 8) & 0xff,
      groups[6] & 0xff,
      (groups[7] >> 8) & 0xff,
      groups[7] & 0xff,
    ].join('.');
    return isBlockedIpv4(v4);
  }

  return false;
}

function isBlockedIp(rawIp) {
  const ip = String(rawIp || '').trim().replace(/^\[|\]$/g, '');
  const family = net.isIP(ip);
  if (family === 4) return isBlockedIpv4(ip);
  if (family === 6) return isBlockedIpv6(ip);
  return true;
}

function createSsrfError(message) {
  const err = new Error(message);
  err.code = 'SSRF_BLOCKED';
  return err;
}

/**
 * Valida uma URL externa antes do fetch server-side para prevenir ataques SSRF.
 */
export async function validateExternalUrl(rawUrl, { lookupImpl = dns.lookup } = {}) {
  let url;
  try {
    url = new URL(String(rawUrl || '').trim());
  } catch {
    throw createSsrfError('URL inválida para auditoria externa');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw createSsrfError(`Protocolo não permitido (${url.protocol})`);
  }

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!host) {
    throw createSsrfError('Hostname ausente na URL');
  }

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw createSsrfError(`Hostname local bloqueado (${host})`);
  }

  if (net.isIP(host)) {
    if (isBlockedIp(host)) {
      throw createSsrfError(`Endereço IP privado ou reservado bloqueado (${host})`);
    }
    return { url: url.href, hostname: host, addresses: [host] };
  }

  let resolved;
  try {
    resolved = await lookupImpl(host, { all: true });
  } catch (err) {
    throw createSsrfError(`Falha ao resolver DNS de ${host}: ${err?.message || 'erro desconhecido'}`);
  }

  const list = Array.isArray(resolved) ? resolved : (resolved ? [resolved] : []);
  if (!list.length) {
    throw createSsrfError(`Nenhum endereço DNS encontrado para ${host}`);
  }

  const addresses = [];
  for (const entry of list) {
    const addr = typeof entry === 'string' ? entry : entry?.address;
    if (!addr || isBlockedIp(addr)) {
      throw createSsrfError(`Destino resolvido para IP privado ou reservado (${addr || 'inválido'})`);
    }
    addresses.push(addr);
  }

  return { url: url.href, hostname: host, addresses };
}
