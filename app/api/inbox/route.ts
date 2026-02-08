
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

    // Rule B: Extract OUTBOX_ID reliably
    const outboxIdMatch = bodyText.match(/OUTBOX_ID:\s*([^\s\n\r]+)/i);
    const outboxId = outboxIdMatch ? outboxIdMatch[1].trim() : null;
    
    // Extract actual user instruction (after --- if present, otherwise clean body)
    let userText = bodyText;
    const delimiterMatch = bodyText.match(/\n---\s*\n?([\s\S]*)$/);
    if (delimiterMatch) {
      userText = delimiterMatch[1].trim();
    } else {
      // If no delimiter, just remove the OUTBOX_ID line to avoid confusing the AI
      userText = bodyText.replace(/OUTBOX_ID:\s*[^\n]*\n?/i, '').trim();
    }

    const saEmail = process.env.CHRONOS_SA_CLIENT_EMAIL;
    const saKey = process.env.CHRONOS_SA_PRIVATE_KEY;
    const calendarId = process.env.CHRONOS_CALENDAR_ID;

    if (!saEmail || !saKey || !calendarId) {
      throw new Error("Server environment variables for headless execution are missing.");
    }

    const saAccessToken = await getServiceAccountToken(saEmail, saKey);

    // Rule B: Calendar-based Idempotency Check with wide window
    if (outboxId) {
      const fingerprint = `OUTBOX_ID=${outboxId}`;
      const now = new Date();
      // timeMin = now minus 30 days, timeMax = now plus 365 days
      const timeMin = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const timeMax = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
      
      const existingEvents = await calendarService.searchEvents(fingerprint, timeMin, timeMax, saAccessToken, calendarId);
      
      // Exact string containment check on the fingerprint
      const exactMatch = existingEvents.find(ev => ev.description && ev.description.includes(fingerprint));
      
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
          reminders_disabled: isTask // Existing tasks would have reminders disabled by policy
        });
      }
    }

    // Process via Gemini
    const result = await processHeadlessAction(userText, saAccessToken, calendarId, outboxId || undefined);
    const isTask = result.action === 'task_as_all_day_free_event';

    // Success Response following the requested JSON structure
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
