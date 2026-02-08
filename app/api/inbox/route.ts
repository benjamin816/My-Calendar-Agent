import { NextRequest, NextResponse } from 'next/server';
import { JWT } from 'google-auth-library';
import { processHeadlessAction } from '@/services/gemini.server';
import { calendarService } from '@/services/calendar';

/**
 * Exchanges a Google Service Account credentials for an OAuth2 Access Token using the official library.
 * This is robust against PEM formatting issues and OpenSSL 3 decoder errors common in serverless environments.
 */
async function getServiceAccountToken(email: string, privateKey: string) {
  // 1. Normalize literal \n characters to actual newlines
  let normalizedKey = privateKey.replace(/\\n/g, '\n');
  
  // 2. Strip surrounding quotes (often added by environment variable managers)
  if (normalizedKey.startsWith('"') && normalizedKey.endsWith('"')) {
    normalizedKey = normalizedKey.slice(1, -1);
  }
  
  // 3. Trim whitespace
  normalizedKey = normalizedKey.trim();

  // 4. Assert PEM structure before attempting to decode
  if (!normalizedKey.startsWith('-----BEGIN PRIVATE KEY-----') || !normalizedKey.endsWith('-----END PRIVATE KEY-----')) {
    throw new Error('Invalid Google Service Account Private Key format. The key must start with "-----BEGIN PRIVATE KEY-----" and end with "-----END PRIVATE KEY-----". Please check your CHRONOS_SA_PRIVATE_KEY environment variable.');
  }

  try {
    const client = new JWT({
      email: email,
      key: normalizedKey,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });

    const credentials = await client.getAccessToken();
    if (!credentials.token) {
      throw new Error('Google Auth Library successfully contacted the server but no token was returned.');
    }
    return credentials.token;
  } catch (err: any) {
    console.error('[Service Account Auth Failure]', err);
    throw new Error(`Google Authentication failed: ${err.message}`);
  }
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('x-chronos-key');
    const expectedKey = process.env.CHRONOS_INBOX_KEY;

    if (!expectedKey || authHeader !== expectedKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const bodyText = await req.text();
    if (!bodyText || !bodyText.trim()) {
      return NextResponse.json({ error: "Missing text payload" }, { status: 400 });
    }

    // 1️⃣ Parse OUTBOX_ID immediately
    const outboxIdMatch = bodyText.match(/OUTBOX_ID:\s*([^\s\n\r]+)/i);
    const outboxId = outboxIdMatch ? outboxIdMatch[1].trim() : null;

    if (!outboxId) {
      console.warn("[Chronos Inbox] Missing OUTBOX_ID in payload. Idempotency disabled.");
    }

    const saEmail = process.env.CHRONOS_SA_CLIENT_EMAIL;
    const saKey = process.env.CHRONOS_SA_PRIVATE_KEY;
    const calendarId = process.env.CHRONOS_CALENDAR_ID;

    if (!saEmail || !saKey || !calendarId) {
      throw new Error("Server environment variables for headless execution are missing (SA_CLIENT_EMAIL, SA_PRIVATE_KEY, or CALENDAR_ID).");
    }

    // AUTH FIX: Using google-auth-library with proper key normalization
    const saAccessToken = await getServiceAccountToken(saEmail, saKey);

    // 2️⃣ Calendar-based idempotency check (BEFORE creation)
    if (outboxId) {
      const fingerprintQuery = `OUTBOX_ID=${outboxId}`;
      const now = new Date();
      // Look back 60 days and forward 365 days for safety
      const timeMin = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
      const timeMax = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
      
      const existingEvents = await calendarService.searchEvents(fingerprintQuery, timeMin, timeMax, saAccessToken, calendarId);
      
      // Exact string containment check on the fingerprint
      const exactMatch = existingEvents.find(ev => ev.description && ev.description.includes(fingerprintQuery));
      
      if (exactMatch) {
        const isTask = exactMatch.summary.startsWith('[Task]');
        return NextResponse.json({
          ok: true,
          outbox_id: outboxId,
          idempotent: true,
          event_id: exactMatch.id,
          action: isTask ? 'task_as_all_day_free_event' : 'timed_event',
          calendar_id: calendarId,
          date: exactMatch.start.split('T')[0],
          reminders_disabled: isTask
        });
      }
    }

    // 3️⃣ Only if NOT found → proceed with AI generation and execution
    let userText = bodyText;
    const delimiterMatch = bodyText.match(/\n---\s*\n?([\s\S]*)$/);
    if (delimiterMatch) {
      userText = delimiterMatch[1].trim();
    } else {
      userText = bodyText.replace(/OUTBOX_ID:\s*[^\n]*\n?/i, '').trim();
    }

    const result = await processHeadlessAction(userText, saAccessToken, calendarId, outboxId || undefined);
    const isTask = result.action === 'task_as_all_day_free_event';

    return NextResponse.json({
      ok: true,
      outbox_id: outboxId || "not_provided",
      idempotent: false,
      event_id: result.eventId,
      action: result.action,
      calendar_id: calendarId,
      date: result.start.split('T')[0],
      reminders_disabled: isTask
    });

  } catch (error: any) {
    console.error("[Inbox API Error]", error);
    return NextResponse.json({ 
      ok: false,
      error: error.message || "Headless execution failed"
    }, { status: 500 });
  }
}
