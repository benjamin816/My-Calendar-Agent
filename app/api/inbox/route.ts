import { NextRequest, NextResponse } from 'next/server';
import { JWT } from 'google-auth-library';
import { processHeadlessAction } from '@/services/gemini.server';
import { calendarService } from '@/services/calendar';

// Force Node.js runtime to ensure full crypto support for PEM decoding
export const runtime = 'nodejs';

/**
 * Exchanges Google Service Account credentials for an OAuth2 Access Token.
 * Implements robust key normalization to handle common environment variable formatting issues.
 */
async function getServiceAccountToken(email: string, rawPrivateKey: string) {
  if (!rawPrivateKey) {
    throw new Error('CHRONOS_SA_PRIVATE_KEY is missing.');
  }

  // 1. Normalization
  let normalizedKey = rawPrivateKey.trim();
  
  // Strip surrounding double quotes if present (often added by env loaders)
  if (normalizedKey.startsWith('"') && normalizedKey.endsWith('"')) {
    normalizedKey = normalizedKey.slice(1, -1);
  }

  // Convert literal escaped characters to actual control characters
  // Handle both Windows (\r\n) and Unix (\n) escaped literals
  normalizedKey = normalizedKey
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .trim();

  // 2. Safe Debug Logging
  console.log(`[Chronos Auth] Normalized Key Stats:`, {
    hasKey: true,
    startsWithBegin: normalizedKey.startsWith('-----BEGIN PRIVATE KEY-----'),
    endsWithEnd: normalizedKey.endsWith('-----END PRIVATE KEY-----'),
    containsLiteralSlashN: rawPrivateKey.includes('\\n'),
    containsRealNewlines: normalizedKey.includes('\n'),
    keyLength: normalizedKey.length
  });

  // 3. Fail Fast
  if (!normalizedKey.startsWith('-----BEGIN PRIVATE KEY-----') || !normalizedKey.endsWith('-----END PRIVATE KEY-----')) {
    throw new Error('Invalid private key format: Missing PEM markers (BEGIN/END PRIVATE KEY). Check CHRONOS_SA_PRIVATE_KEY.');
  }

  try {
    const client = new JWT({
      email: email,
      key: normalizedKey,
      scopes: ['https://www.googleapis.com/auth/calendar.events'],
    });

    const credentials = await client.getAccessToken();
    if (!credentials.token) {
      throw new Error('Token exchange successful but returned an empty access token.');
    }
    return credentials.token;
  } catch (err: any) {
    console.error('[Chronos Auth] Exchange Failed:', err.message);
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

    // 1. Parse OUTBOX_ID for idempotency
    const outboxIdMatch = bodyText.match(/OUTBOX_ID:\s*([^\s\n\r]+)/i);
    const outboxId = outboxIdMatch ? outboxIdMatch[1].trim() : null;

    const saEmail = process.env.CHRONOS_SA_CLIENT_EMAIL;
    const saKey = process.env.CHRONOS_SA_PRIVATE_KEY;
    const calendarId = process.env.CHRONOS_CALENDAR_ID;

    if (!saEmail || !saKey || !calendarId) {
      throw new Error("Missing SA_CLIENT_EMAIL, SA_PRIVATE_KEY, or CALENDAR_ID in environment.");
    }

    // AUTH FIX: Use robust normalization within the exchange function
    const saAccessToken = await getServiceAccountToken(saEmail, saKey);

    // 2. Idempotency Check
    if (outboxId) {
      const fingerprintQuery = `OUTBOX_ID=${outboxId}`;
      const now = new Date();
      const timeMin = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
      const timeMax = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
      
      const existingEvents = await calendarService.searchEvents(fingerprintQuery, timeMin, timeMax, saAccessToken, calendarId);
      const exactMatch = existingEvents.find(ev => ev.description && ev.description.includes(fingerprintQuery));
      
      if (exactMatch) {
        return NextResponse.json({
          ok: true,
          outbox_id: outboxId,
          idempotent: true,
          event_id: exactMatch.id,
          action: exactMatch.summary.startsWith('[Task]') ? 'task_as_all_day_free_event' : 'timed_event'
        });
      }
    }

    // 3. Process with AI
    let userText = bodyText;
    const delimiterMatch = bodyText.match(/\n---\s*\n?([\s\S]*)$/);
    if (delimiterMatch) {
      userText = delimiterMatch[1].trim();
    } else {
      userText = bodyText.replace(/OUTBOX_ID:\s*[^\n]*\n?/i, '').trim();
    }

    const result = await processHeadlessAction(userText, saAccessToken, calendarId, outboxId || undefined);

    return NextResponse.json({
      ok: true,
      outbox_id: outboxId || "not_provided",
      idempotent: false,
      event_id: result.eventId,
      action: result.action,
      calendar_id: calendarId,
      date: result.start.split('T')[0]
    });

  } catch (error: any) {
    console.error("[Inbox API Error]", error);
    return NextResponse.json({ 
      ok: false,
      error: error.message || "Execution failed"
    }, { status: 500 });
  }
}