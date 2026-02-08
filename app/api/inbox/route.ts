import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { Buffer } from 'buffer';
import { processHeadlessAction } from '@/services/gemini.server';
import { calendarService } from '@/services/calendar';

/**
 * Exchanges a Google Service Account JWT for an OAuth2 Access Token.
 */
async function getServiceAccountToken(email: string, privateKey: string) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: email,
    sub: email,
    scope: 'https://www.googleapis.com/auth/calendar',
    aud: 'https://oauth2.googleapis.com/token',
    iat,
    exp,
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  
  const formattedKey = privateKey.replace(/\\n/g, '\n');
  
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(`${encodedHeader}.${encodedPayload}`)
    .sign(formattedKey, 'base64url');

  const jwt = `${encodedHeader}.${encodedPayload}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Google Auth failed: ${data.error_description || data.error}`);
  return data.access_token;
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

    // 1. Parse OUTBOX_ID
    let outboxId: string | null = null;
    let userText = bodyText;
    const outboxMatch = bodyText.match(/^OUTBOX_ID:\s*([^\n\r]+)/);
    if (outboxMatch) {
      outboxId = outboxMatch[1].trim();
      userText = bodyText.replace(/^OUTBOX_ID:[^\n]*\n?(---\n?)?/, '').trim();
    }

    const saEmail = process.env.CHRONOS_SA_CLIENT_EMAIL;
    const saKey = process.env.CHRONOS_SA_PRIVATE_KEY;
    const calendarId = process.env.CHRONOS_CALENDAR_ID;

    if (!saEmail || !saKey || !calendarId) {
      throw new Error("Server environment variables for headless execution are missing.");
    }

    // 2. Get Service Account Token
    const saAccessToken = await getServiceAccountToken(saEmail, saKey);

    // 3. Calendar-based Idempotency Check
    if (outboxId) {
      const searchQuery = `OUTBOX_ID=${outboxId}`;
      // Search +/- 30 days window for safety as requested
      const now = new Date();
      const timeMin = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const timeMax = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
      
      const existingEvents = await calendarService.searchEvents(searchQuery, timeMin, timeMax, saAccessToken, calendarId);
      
      if (existingEvents.length > 0) {
        const match = existingEvents[0];
        const isTask = match.summary.startsWith('[Task]');
        
        return NextResponse.json({
          ok: true,
          outbox_id: outboxId,
          idempotent: true,
          action: isTask ? 'task_as_all_day_free_event' : 'timed_event',
          calendar_id: calendarId,
          event_id: match.id,
          start: match.start,
          end: match.end
        });
      }
    }

    // 4. Process via Gemini and Execute
    const result = await processHeadlessAction(userText, saAccessToken, calendarId, outboxId || undefined);

    // 5. Success Response
    return NextResponse.json({
      ok: true,
      outbox_id: outboxId || "not_provided",
      idempotent: false,
      action: result.action,
      calendar_id: result.calendarId,
      event_id: result.eventId,
      start: result.start,
      end: result.end
    });

  } catch (error: any) {
    console.error("[Inbox API Error]", error);
    return NextResponse.json({ 
      ok: false,
      error: error.message || "Headless execution failed"
    }, { status: 500 });
  }
}