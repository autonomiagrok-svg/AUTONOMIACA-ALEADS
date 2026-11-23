export function isAllowedOrigin(origin) {
  if (!origin) return false;
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)
    || /^chrome-extension:\/\/[a-z0-9_-]+$/i.test(origin);
}

export function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'Origin');
    res.setHeader('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('access-control-allow-headers', 'Content-Type, Authorization, x-access-key, Idempotency-Key');
  }
}

export function applySecurityHeaders(res) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader(
    'content-security-policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  );
}

export function sendJson(res, status, data, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(data));
}

export function parseJsonBody(req, { maxBytes = 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on('data', (c) => {
      if (bytes > maxBytes) return;
      bytes += c.length;
      if (bytes > maxBytes) {
        reject(Object.assign(new Error('Corpo da requisição excede 1 MB'), { status: 413 }));
      } else {
        chunks.push(c);
      }
    });
    req.on('end', () => {
      if (bytes > maxBytes) return;
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error('JSON inválido'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Middleware de Idempotência em RAM com TTL (10 min) e teto FIFO (2.000 entradas).
 */
export function withIdempotency(handler, { ttlMs = 10 * 60 * 1000, maxEntries = 2000 } = {}) {
  const cache = new Map();

  function pruneExpired(now) {
    for (const [k, entry] of cache.entries()) {
      if (now - entry.ts > ttlMs) cache.delete(k);
    }
  }

  return async function idempotentHandler(ctx) {
    const rawKey = ctx.req.headers['idempotency-key'];
    const key = String(Array.isArray(rawKey) ? rawKey[0] : (rawKey || '')).trim();
    if (!key) return handler(ctx);

    const cacheKey = `${ctx.req.method}:${ctx.url.pathname}:${key}`;
    const now = Date.now();
    const hit = cache.get(cacheKey);
    if (hit) {
      if (now - hit.ts <= ttlMs) {
        return ctx.send(hit.status, hit.body, { ...hit.headers, 'x-idempotent-replay': 'true' });
      }
      cache.delete(cacheKey);
    }

    const origSend = ctx.send;
    let sent = false;
    ctx.send = (status, data, headers = {}) => {
      if (!sent && status < 500) {
        sent = true;
        pruneExpired(Date.now());
        while (cache.size >= maxEntries) {
          const oldest = cache.keys().next().value;
          if (oldest === undefined) break;
          cache.delete(oldest);
        }
        cache.set(cacheKey, { status, body: data, headers: { ...headers }, ts: Date.now() });
      }
      return origSend(status, data, headers);
    };

    return handler(ctx);
  };
}

function compilePattern(pattern) {
  const clean = String(pattern || '/').replace(/\/+$/, '') || '/';
  const parts = clean === '/' ? [] : clean.slice(1).split('/');
  const paramNames = [];
  let staticCount = 0;

  const segments = parts.map((seg) => {
    if (seg.startsWith(':')) {
      const name = seg.slice(1);
      paramNames.push(name);
      return { type: 'param', name };
    }
    staticCount++;
    return { type: 'static', value: seg };
  });

  return {
    pattern: clean,
    segments,
    staticCount,
    paramCount: paramNames.length,
  };
}

export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler, opts = {}) {
    const compiled = compilePattern(pattern);
    const wrapped = opts.idempotent ? withIdempotency(handler, opts.idempotencyOptions) : handler;
    this.routes.push({
      method: String(method || 'GET').toUpperCase(),
      ...compiled,
      handler: wrapped,
    });
    // Precedência determinística: rotas estáticas (mais segmentos fixos, menos params) primeiro
    this.routes.sort((a, b) => {
      if (b.staticCount !== a.staticCount) return b.staticCount - a.staticCount;
      if (a.paramCount !== b.paramCount) return a.paramCount - b.paramCount;
      return b.segments.length - a.segments.length;
    });
    return this;
  }

  match(method, pathname) {
    const upper = String(method || 'GET').toUpperCase();
    const clean = String(pathname || '/').replace(/\/+$/, '') || '/';
    const parts = clean === '/' ? [] : clean.slice(1).split('/');

    for (const r of this.routes) {
      if (r.method !== upper || r.segments.length !== parts.length) continue;
      const params = {};
      let ok = true;
      for (let i = 0; i < parts.length; i++) {
        const seg = r.segments[i];
        if (seg.type === 'static') {
          if (seg.value !== parts[i]) { ok = false; break; }
        } else {
          try {
            params[seg.name] = decodeURIComponent(parts[i]);
          } catch {
            params[seg.name] = parts[i];
          }
        }
      }
      if (ok) return { handler: r.handler, params };
    }
    return null;
  }
}
