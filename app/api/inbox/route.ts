import { NextRequest, NextResponse } from 'next/server';
import { JWT } from 'google-auth-library';
import { processHeadlessAction } from '@/services/gemini.server';
import { calendarService } from '@/services/calendar';

/**
 * Exchanges a Google Service Account credentials for an OAuth2 Access Token using the official library.
 * This is robust against PEM formatting issues and OpenSSL 3 decoder errors common in serverless environments.
 */
async function getServiceAccountToken(email: string, privateKey: string) {
  if (!privateKey) {
    throw new Error('CHRONOS_SA_PRIVATE_KEY is missing from environment variables.');
  }

  // 1. Safe Debug Logging (No secrets revealed)
  const rawLength = privateKey.length;
  const hasLiteralSlashN = privateKey.includes('\\n');
  const hasLiteralSlashR = privateKey.includes('\\r');
  const startsWithQuote = privateKey.startsWith('"');
  
  // 2. Normalization Process
  let normalizedKey = privateKey.trim();
  
  // Strip surrounding double quotes if present
  if (normalizedKey.startsWith('"') && normalizedKey.endsWith('"')) {
    normalizedKey = normalizedKey.slice(1, -1);
  }

  // Convert literal escaped characters to actual control characters
  normalizedKey = normalizedKey
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .trim();

  // 3. Final Verification
  const finalStartsWithBegin = normalizedKey.startsWith('-----BEGIN PRIVATE KEY-----');
  const finalEndsWithEnd = normalizedKey.endsWith('-----END PRIVATE KEY-----');

  console.log(`[Chronos Auth] Normalization complete. stats: { rawLength: ${rawLength}, hasLiteralSlashN: ${hasLiteralSlashN}, hasLiteralSlashR: ${hasLiteralSlashR}, startsWithQuote: ${startsWithQuote}, validPEMHeader: ${finalStartsWithBegin}, validPEMFooter: ${finalEndsWithEnd} }`);

  if (!finalStartsWithBegin || !finalEndsWithEnd) {
    throw new Error(`Invalid Google Service Account Private Key format. The normalized key failed PEM structure validation. Starts with BEGIN: ${finalStartsWithBegin}, Ends with END: ${finalEndsWithEnd}. Check CHRONOS_SA_PRIVATE_KEY.`);
  }

  try {
    const client = new JWT({
      email: email,
      key: normalizedKey,
      scopes: ['https://www.googleapis.com/auth/calendar.events'], // Using more specific scope as requested
    });

    const credentials = await client.getAccessToken();
    if (!credentials.token) {
      throw new Error('Google Auth Library returned successfully but the access token field is empty.');
    }
    return credentials.token;
  } catch (err: any) {
    console.error('[Chronos Auth Error]', err);
    throw new Error(`Google Authentication failed during token exchange: ${err.message}`);
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

    // AUTH FIX: Robust key normalization
    const saAccessToken = await getServiceAccountToken(saEmail, saKey);

    // 2️⃣ Calendar-based idempotency check (BEFORE creation)
    if (outboxId) {
      const fingerprintQuery = `OUTBOX_ID=${outboxId}`;
      const now = new Date();
      // Look back 60 days and forward 365 days
      const timeMin = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
      const timeMax = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
      
      const existingEvents = await calendarService.searchEvents(fingerprintQuery, timeMin, timeMax, saAccessToken, calendarId);
      
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
