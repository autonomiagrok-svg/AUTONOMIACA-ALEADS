import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Adapter de persistência JSON com Write-Ahead Log (WAL NDJSON) e compactação atômica.
 * Compatível 100% com o formato existente de data/leads.json e Node >= 20 sem dependências externas.
 */
export class WalJsonAdapter {
  constructor(snapshotFile, { compactThreshold = 50 } = {}) {
    this.snapshotFile = path.resolve(snapshotFile);
    this.walFile = this.snapshotFile.replace(/\.json$/i, '') + '.wal.ndjson';
    this.compactThreshold = Math.max(1, Number(compactThreshold) || 50);
    this.walOps = 0;
    this.lastCompactAt = null;
    this.writeQueue = Promise.resolve();
  }

  _writeSnapshotSync(leads) {
    fs.mkdirSync(path.dirname(this.snapshotFile), { recursive: true });
    const tmp = `${this.snapshotFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(leads, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, this.snapshotFile);
    if (fs.existsSync(this.walFile)) {
      fs.writeFileSync(this.walFile, '', { encoding: 'utf8', mode: 0o600 });
    }
    this.walOps = 0;
    this.lastCompactAt = new Date().toISOString();
  }

  async _writeSnapshotAsync(leads) {
    const payload = JSON.stringify(leads, null, 2);
    await fs.promises.mkdir(path.dirname(this.snapshotFile), { recursive: true });
    const tmp = `${this.snapshotFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.promises.writeFile(tmp, payload, { encoding: 'utf8', mode: 0o600 });
    await fs.promises.rename(tmp, this.snapshotFile);
    if (fs.existsSync(this.walFile)) {
      await fs.promises.writeFile(this.walFile, '', { encoding: 'utf8', mode: 0o600 });
    }
    this.walOps = 0;
    this.lastCompactAt = new Date().toISOString();
  }

  /**
   * Carrega o snapshot JSON e faz replay resiliente do WAL (ignorando eventual linha final truncada).
   * Se houver operações no WAL, compacta automaticamente de volta para o snapshot atômico.
   */
  load() {
    let baseLeads = [];
    if (!fs.existsSync(this.snapshotFile)) {
      fs.mkdirSync(path.dirname(this.snapshotFile), { recursive: true });
      fs.writeFileSync(this.snapshotFile, '[]', { encoding: 'utf8', mode: 0o600 });
    } else {
      const raw = fs.readFileSync(this.snapshotFile, 'utf8').trim();
      const parsed = raw ? JSON.parse(raw) : [];
      baseLeads = Array.isArray(parsed) ? parsed : [];
    }

    const map = new Map();
    for (const item of baseLeads) {
      if (item && item.id) map.set(item.id, item);
    }

    let replayed = 0;
    let hadWalContent = false;
    if (fs.existsSync(this.walFile)) {
      const walRaw = fs.readFileSync(this.walFile, 'utf8');
      if (walRaw.trim().length > 0) {
        hadWalContent = true;
        const lines = walRaw.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const entry = JSON.parse(trimmed);
            if (entry.op === 'UPSERT' && entry.lead && entry.lead.id) {
              map.set(entry.lead.id, entry.lead);
              replayed++;
            } else if (entry.op === 'DELETE' && entry.id) {
              map.delete(entry.id);
              replayed++;
            } else if (entry.op === 'REPLACE_ALL' && Array.isArray(entry.leads)) {
              map.clear();
              for (const l of entry.leads) {
                if (l && l.id) map.set(l.id, l);
              }
              replayed++;
            }
          } catch {
            // Ignora linha corrompida/truncada por queda abrupta de energia
          }
        }
      }
    }

    const finalLeads = [...map.values()];
    if (replayed > 0 || hadWalContent) {
      this._writeSnapshotSync(finalLeads);
    }

    return finalLeads;
  }

  appendUpsert(lead, getSnapshotFn = null) {
    const line = JSON.stringify({ op: 'UPSERT', ts: Date.now(), lead }) + '\n';
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.promises.mkdir(path.dirname(this.walFile), { recursive: true });
      await fs.promises.appendFile(this.walFile, line, { encoding: 'utf8', mode: 0o600 });
      this.walOps++;
      if (this.walOps >= this.compactThreshold && typeof getSnapshotFn === 'function') {
        await this._writeSnapshotAsync(getSnapshotFn());
      }
    }).catch((err) => {
      console.error('Erro no WAL appendUpsert:', err);
      throw err;
    });
    return this.writeQueue;
  }

  appendDelete(id, getSnapshotFn = null) {
    const line = JSON.stringify({ op: 'DELETE', ts: Date.now(), id }) + '\n';
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.promises.mkdir(path.dirname(this.walFile), { recursive: true });
      await fs.promises.appendFile(this.walFile, line, { encoding: 'utf8', mode: 0o600 });
      this.walOps++;
      if (this.walOps >= this.compactThreshold && typeof getSnapshotFn === 'function') {
        await this._writeSnapshotAsync(getSnapshotFn());
      }
    }).catch((err) => {
      console.error('Erro no WAL appendDelete:', err);
      throw err;
    });
    return this.writeQueue;
  }

  replaceAll(allLeads) {
    const snapshot = [...allLeads];
    this.writeQueue = this.writeQueue.then(async () => {
      await this._writeSnapshotAsync(snapshot);
    }).catch((err) => {
      console.error('Erro no WAL replaceAll:', err);
      throw err;
    });
    return this.writeQueue;
  }

  compact(allLeads) {
    return this.replaceAll(allLeads);
  }

  flush() {
    return this.writeQueue;
  }

  getStats() {
    const snapshot_bytes = fs.existsSync(this.snapshotFile) ? fs.statSync(this.snapshotFile).size : 0;
    const wal_bytes = fs.existsSync(this.walFile) ? fs.statSync(this.walFile).size : 0;
    return {
      wal_ops: this.walOps,
      compact_threshold: this.compactThreshold,
      snapshot_bytes,
      wal_bytes,
      last_compact_at: this.lastCompactAt,
      snapshot_file: path.basename(this.snapshotFile),
      wal_file: path.basename(this.walFile),
    };
  }
}
