import { kv } from '@vercel/kv';

export interface IdempotencyRecord {
  outbox_id: string;
  status: 'processing' | 'succeeded' | 'failed';
  action_type?: string;
  calendar_id?: string;
  event_id?: string;
  start?: string;
  end?: string;
  created_at: number;
  updated_at: number;
  last_error?: string;
}

const PREFIX = 'chronos:idempotency:';
const TTL = 86400 * 7; // Keep records for 7 days

const isConfigured = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

export const idempotencyService = {
  get: async (outboxId: string): Promise<IdempotencyRecord | null> => {
    if (!isConfigured) return null;
    try {
      return await kv.get<IdempotencyRecord>(`${PREFIX}${outboxId}`);
    } catch (e) {
      console.error("[Idempotency] KV Get Error:", e);
      return null;
    }
  },

  set: async (outboxId: string, record: Partial<IdempotencyRecord>) => {
    if (!isConfigured) return;
    try {
      const existing = (await kv.get<IdempotencyRecord>(`${PREFIX}${outboxId}`)) || {
        outbox_id: outboxId,
        created_at: Date.now(),
      };

      const updated: IdempotencyRecord = {
        ...existing as IdempotencyRecord,
        ...record,
        updated_at: Date.now(),
      };

      await kv.set(`${PREFIX}${outboxId}`, updated, { ex: TTL });
    } catch (e) {
      console.error("[Idempotency] KV Set Error:", e);
    }
  },

  isConfigured: () => isConfigured
};
