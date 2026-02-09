import { NextRequest, NextResponse } from 'next/server';
import { JWT } from 'google-auth-library';
import { processHeadlessAction } from '@/services/gemini.server';
import { calendarService } from '@/services/calendar';

// Force Node.js runtime to ensure full crypto support for PEM decoding
export const runtime = 'nodejs';

// Diagnostic Buckets for self-healing/debugging
const BUCKETS = {
  MISSING_ENV: 'missing_env',
  BAD_KEY_FORMAT: 'bad_key_format',
  TOKEN_EXCHANGE_FAILED: 'token_exchange_failed',
  CALENDAR_WRITE_FAILED: 'calendar_write_failed',
  UNAUTHORIZED: 'unauthorized',
  EXECUTION_FAILED: 'execution_failed'
};

/**
 * Exchanges Google Service Account credentials for an OAuth2 Access Token.
 * Implements masked logging and diagnostic checks.
 */
async function getServiceAccountToken(email: string, rawPrivateKey: string, traceId: string) {
  // 1. Log Presence (Boolean only)
  console.log(`[Chronos Auth][${traceId}] Validation: EmailPresent=${!!email}, KeyPresent=${!!rawPrivateKey}`);

  if (!rawPrivateKey) {
    const err = new Error('CHRONOS_SA_PRIVATE_KEY is missing.');
    (err as any).bucket = BUCKETS.MISSING_ENV;
    throw err;
  }

  // 2. Masked Diagnostic Logging
  const head = rawPrivateKey.substring(0, 30);
  const tail = rawPrivateKey.substring(rawPrivateKey.length - 30);
  console.log(`[Chronos Auth][${traceId}] Key Diagnostics:`);
  console.log(`  - Head: "${head}..."`);
  console.log(`  - Tail: "...${tail}"`);
  console.log(`  - Contains Literal \\n: ${rawPrivateKey.includes('\\n')}`);
  console.log(`  - Contains Real Newlines: ${rawPrivateKey.includes('\n')}`);

  // 3. Normalization
  let normalizedKey = rawPrivateKey.trim();
  if (normalizedKey.startsWith('"') && normalizedKey.endsWith('"')) {
    normalizedKey = normalizedKey.slice(1, -1);
  }
  normalizedKey = normalizedKey
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .trim();

  const hasBegin = normalizedKey.startsWith('-----BEGIN PRIVATE KEY-----');
  const hasEnd = normalizedKey.endsWith('-----END PRIVATE KEY-----');
  console.log(`  - Normalized Markers: BEGIN=${hasBegin}, END=${hasEnd}`);

  if (!hasBegin || !hasEnd) {
    const err = new Error('Invalid private key format: Missing PEM markers (BEGIN/END).');
    (err as any).bucket = BUCKETS.BAD_KEY_FORMAT;
    throw err;
  }

  try {
    const client = new JWT({
      email: email,
      key: normalizedKey,
      scopes: ['https://www.googleapis.com/auth/calendar.events'],
    });

    const credentials = await client.getAccessToken();
    if (!credentials.token) {
      const err = new Error('Token exchange successful but returned empty token.');
      (err as any).bucket = BUCKETS.TOKEN_EXCHANGE_FAILED;
      throw err;
    }
    
    console.log(`[Chronos Auth][${traceId}] Google auth success.`);
    return credentials.token;
  } catch (err: any) {
    console.error(`[Chronos Auth][${traceId}] Exchange error:`, err.message);
    if (!err.bucket) err.bucket = BUCKETS.TOKEN_EXCHANGE_FAILED;
    throw err;
  }
}

export async function POST(req: NextRequest) {
  const traceId = req.headers.get('x-forward-trace-id') || req.headers.get('x-request-id') || `trace-${Date.now()}`;
  
  try {
    console.log(`[Chronos Inbox][${traceId}] Incoming request received.`);
    
    const authHeader = req.headers.get('x-chronos-key');
    const expectedKey = process.env.CHRONOS_INBOX_KEY;

    if (!expectedKey || authHeader !== expectedKey) {
      console.warn(`[Chronos Inbox][${traceId}] Unauthorized access attempt.`);
      return NextResponse.json({ 
        ok: false, 
        error: "Unauthorized", 
        error_bucket: BUCKETS.UNAUTHORIZED,
        trace_id: traceId 
      }, { status: 401 });
    }

    const bodyText = await req.text();
    if (!bodyText || !bodyText.trim()) {
      return NextResponse.json({ 
        ok: false, 
        error: "Missing text payload", 
        error_bucket: BUCKETS.EXECUTION_FAILED,
        trace_id: traceId 
      }, { status: 400 });
    }

    // 1. Env Check
    const saEmail = process.env.CHRONOS_SA_CLIENT_EMAIL;
    const saKey = process.env.CHRONOS_SA_PRIVATE_KEY;
    const calendarId = process.env.CHRONOS_CALENDAR_ID;

    if (!saEmail || !saKey || !calendarId) {
      const err = new Error("Missing required environment variables (SA_EMAIL, SA_KEY, or CALENDAR_ID).");
      (err as any).bucket = BUCKETS.MISSING_ENV;
      throw err;
    }

    // 2. Auth Stage
    const saAccessToken = await getServiceAccountToken(saEmail, saKey, traceId);

    // 3. Idempotency Check
    const outboxIdMatch = bodyText.match(/OUTBOX_ID:\s*([^\s\n\r]+)/i);
    const outboxId = outboxIdMatch ? outboxIdMatch[1].trim() : null;

    if (outboxId) {
      const fingerprintQuery = `OUTBOX_ID=${outboxId}`;
      const now = new Date();
      const timeMin = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
      const timeMax = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
      
      const existingEvents = await calendarService.searchEvents(fingerprintQuery, timeMin, timeMax, saAccessToken, calendarId);
      const exactMatch = existingEvents.find(ev => ev.description && ev.description.includes(fingerprintQuery));
      
      if (exactMatch) {
        console.log(`[Chronos Inbox][${traceId}] Idempotent match. Event ID: ${exactMatch.id}`);
        return NextResponse.json({
          ok: true,
          outbox_id: outboxId,
          idempotent: true,
          event_id: exactMatch.id,
          trace_id: traceId,
          action: exactMatch.summary.startsWith('[Task]') ? 'task_as_all_day_free_event' : 'timed_event'
        });
      }
    }

    // 4. AI Processing Stage
    let userText = bodyText;
    const delimiterMatch = bodyText.match(/\n---\s*\n?([\s\S]*)$/);
    if (delimiterMatch) {
      userText = delimiterMatch[1].trim();
    } else {
      userText = bodyText.replace(/OUTBOX_ID:\s*[^\n]*\n?/i, '').trim();
    }

    console.log(`[Chronos Inbox][${traceId}] Processing with AI...`);
    try {
      const result = await processHeadlessAction(userText, saAccessToken, calendarId, outboxId || undefined);
      console.log(`[Chronos Inbox][${traceId}] Created/Updated event. ID: ${result.eventId}`);

      return NextResponse.json({
        ok: true,
        outbox_id: outboxId || "not_provided",
        idempotent: false,
        event_id: result.eventId,
        action: result.action,
        calendar_id: calendarId,
        date: result.start.split('T')[0],
        trace_id: traceId
      });
    } catch (aiErr: any) {
      aiErr.bucket = BUCKETS.CALENDAR_WRITE_FAILED;
      throw aiErr;
    }

  } catch (error: any) {
    const bucket = error.bucket || BUCKETS.EXECUTION_FAILED;
    console.error(`[Chronos Inbox][${traceId}][Bucket: ${bucket}] Error:`, error.message);
    
    return NextResponse.json({ 
      ok: false,
      error: error.message || "Execution failed",
      error_bucket: bucket,
      trace_id: traceId
    }, { status: 500 });
  }
}