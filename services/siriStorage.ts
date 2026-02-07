
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

export const siriStorage = {
  push: async (text: string) => {
    const newMessage: PendingSiriMessage = { text, timestamp: Date.now() };
    // We store as a list/array in KV. Using RPush (Redis equivalent)
    await kv.rpush(STORAGE_KEY, JSON.stringify(newMessage));
    // Set expiry on the whole key to cleanup stale data
    await kv.expire(STORAGE_KEY, TTL_SECONDS);
  },
  popAll: async (): Promise<PendingSiriMessage[]> => {
    // Atomically fetch and delete the queue
    const pipeline = kv.pipeline();
    pipeline.lrange(STORAGE_KEY, 0, -1);
    pipeline.del(STORAGE_KEY);
    
    const [messages] = await pipeline.exec() as [string[], any];
    
    if (!messages || !Array.isArray(messages)) return [];
    
    return messages.map(m => typeof m === 'string' ? JSON.parse(m) : m);
  }
};
