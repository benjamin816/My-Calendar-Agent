import { kv } from '@vercel/kv';

/**
 * Durable storage for pending Siri messages using Vercel KV.
 * This ensures messages persist across serverless function invocations.
 */

interface PendingSiriMessage {
  text: string;
  timestamp: number;
}

const STORAGE_KEY = 'chronos:siri:queue';
const TTL_SECONDS = 600; // 10 minutes

const isConfigured = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

console.log(`[Chronos] Siri KV Storage status: ${isConfigured ? 'ENABLED' : 'DISABLED (Missing env vars)'}`);

export const siriStorage = {
  isConfigured: () => isConfigured,
  
  push: async (text: string) => {
    if (!isConfigured) return false;
    
    try {
      const newMessage: PendingSiriMessage = { text, timestamp: Date.now() };
      // We store as a list/array in KV. Using RPush (Redis equivalent)
      await kv.rpush(STORAGE_KEY, JSON.stringify(newMessage));
      // Set expiry on the whole key to cleanup stale data
      await kv.expire(STORAGE_KEY, TTL_SECONDS);
      return true;
    } catch (e) {
      console.error("[Chronos] Failed to push to KV:", e);
      return false;
    }
  },
  
  popAll: async (): Promise<PendingSiriMessage[]> => {
    if (!isConfigured) return [];
    
    try {
      // Atomically fetch and delete the queue
      const pipeline = kv.pipeline();
      pipeline.lrange(STORAGE_KEY, 0, -1);
      pipeline.del(STORAGE_KEY);
      
      const results = await pipeline.exec();
      if (!results) return [];
      
      const [messages] = results as [string[], any];
      
      if (!messages || !Array.isArray(messages)) return [];
      
      return messages.map(m => typeof m === 'string' ? JSON.parse(m) : m);
    } catch (e) {
      console.error("[Chronos] Failed to pop from KV:", e);
      return [];
    }
  }
};