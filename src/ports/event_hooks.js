import crypto from 'node:crypto';
import { getConfig } from '../config.js';

export const EVENT_NAMES = Object.freeze({
  LEAD_CAPTURED: 'lead.captured',
  LEAD_DIAGNOSED: 'lead.diagnosed',
  LEAD_CONTACTED: 'lead.contacted',
  LEAD_SIGNAL_RECORDED: 'lead.signal_recorded',
  LEAD_FOLLOWUP_SCHEDULED: 'lead.followup_scheduled',
  LEAD_CONVERTED: 'lead.converted',
  MISSION_COMPLETED: 'mission.completed',
});

/**
 * Porta 2 USB-C (Contrato v1.0): Barramento Canônico de Eventos de Domínio.
 */
export class EventHooks {
  constructor() {
    this.listeners = new Map();
  }

  subscribe(event, fn) {
    if (typeof fn !== 'function') {
      throw new TypeError('Listener deve ser uma função');
    }
    const evt = String(event || '*');
    if (!this.listeners.has(evt)) {
      this.listeners.set(evt, new Set());
    }
    const set = this.listeners.get(evt);
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size === 0) this.listeners.delete(evt);
    };
  }

  clear() {
    this.listeners.clear();
  }

  emit(event, data = {}, { idempotency_key, tenant_id } = {}) {
    const envelope = {
      event,
      contract_version: '1.0',
      idempotency_key: idempotency_key || crypto.randomUUID(),
      occurred_at: new Date().toISOString(),
      tenant_id: tenant_id || getConfig().tenant.id,
      data,
    };

    const targets = [
      ...(this.listeners.get(event) || []),
      ...(event !== '*' ? (this.listeners.get('*') || []) : []),
    ];

    for (const fn of targets) {
      try {
        const res = fn(envelope);
        if (res && typeof res.catch === 'function') {
          res.catch((err) => {
            console.error(`Erro assíncrono em listener de ${event}:`, err);
          });
        }
      } catch (err) {
        console.error(`Erro em listener de ${event}:`, err);
      }
    }

    return envelope;
  }
}

export const eventHooks = new EventHooks();
