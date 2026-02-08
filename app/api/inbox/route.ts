import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { Buffer } from 'buffer';
import { processHeadlessAction } from '@/services/gemini.server';
import { idempotencyService } from '@/services/idempotency';

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
  let outboxId: string | null = null;
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

    // 1. Parse OUTBOX_ID from the custom text format
    let userText = bodyText;
    const outboxMatch = bodyText.match(/^OUTBOX_ID:\s*([^\n\r]+)/);
    if (outboxMatch) {
      outboxId = outboxMatch[1].trim();
      // Clean up header and delimiter for Gemini's benefit
      userText = bodyText.replace(/^OUTBOX_ID:[^\n]*\n?(---\n?)?/, '').trim();
    }

    // 2. Idempotency Check
    if (outboxId) {
      const existing = await idempotencyService.get(outboxId);
      if (existing) {
        if (existing.status === 'succeeded') {
          return NextResponse.json({
            ok: true,
            outbox_id: outboxId,
            action: existing.action_type,
            calendar_id: existing.calendar_id,
            event_id: existing.event_id,
            start: existing.start,
            end: existing.end,
            idempotent: true
          });
        }
        if (existing.status === 'processing') {
          // Return a structured response that indicates it's already in progress
          return NextResponse.json({
            ok: false,
            outbox_id: outboxId,
            error: "Still processing previous request",
            retry_after: 5
          }, { status: 409 });
        }
        // If status is 'failed', we allow a retry.
      }
      
      // Start tracking
      await idempotencyService.set(outboxId, { status: 'processing' });
    }

    const saEmail = process.env.CHRONOS_SA_CLIENT_EMAIL;
    const saKey = process.env.CHRONOS_SA_PRIVATE_KEY;
    const calendarId = process.env.CHRONOS_CALENDAR_ID;

    if (!saEmail || !saKey || !calendarId) {
      throw new Error("Server environment variables for headless execution are missing.");
    }

    // 3. Get Service Account Token
    const saAccessToken = await getServiceAccountToken(saEmail, saKey);

    // 4. Process via Gemini and Execute
    const result = await processHeadlessAction(userText, saAccessToken, calendarId, outboxId || undefined);

    // 5. Save Success Record
    if (outboxId) {
      // Fix: Changed result.calendar_id to result.calendarId to match returned type from processHeadlessAction
      await idempotencyService.set(outboxId, {
        status: 'succeeded',
        action_type: result.action,
        calendar_id: result.calendarId,
        event_id: result.eventId,
        start: result.start,
        end: result.end
      });
    }

    console.log(`[Inbox] Successfully processed headless request. Created ${result.action}: ${result.eventId}`);
    
    // Fix: Changed result.calendar_id to result.calendarId to match returned type from processHeadlessAction
    return NextResponse.json({
      ok: true,
      outbox_id: outboxId || "not_provided",
      action: result.action,
      calendar_id: result.calendarId,
      event_id: result.eventId,
      start: result.start,
      end: result.end,
      idempotent: false
    });

  } catch (error: any) {
    console.error("[Inbox API Error]", error);
    
    // Save Failure Record
    if (outboxId) {
      await idempotencyService.set(outboxId, {
        status: 'failed',
        last_error: error.message
      });
    }

    return NextResponse.json({ 
      ok: false,
      outbox_id: outboxId || "not_provided",
      error: error.message || "Headless execution failed"
    }, { status: 500 });
  }
}