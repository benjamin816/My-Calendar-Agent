/**
 * DEPRECATED: Idempotency is now handled directly by searching Google Calendar 
 * for fingerprint strings in event descriptions.
 */

export const idempotencyService = {
  get: async () => null,
  set: async () => {},
  isConfigured: () => false
};