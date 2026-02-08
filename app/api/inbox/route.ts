import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
// Fix: Explicitly import Buffer to resolve the "Cannot find name 'Buffer'" error
import { Buffer } from 'buffer';
import { processHeadlessAction } from '@/services/gemini.server';

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
  
  // Handle newlines in private key if they were escaped in env vars
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

    const textInput = await req.text();
    if (!textInput || !textInput.trim()) {
      return NextResponse.json({ error: "Missing text payload" }, { status: 400 });
    }

    const saEmail = process.env.CHRONOS_SA_CLIENT_EMAIL;
    const saKey = process.env.CHRONOS_SA_PRIVATE_KEY;
    const calendarId = process.env.CHRONOS_CALENDAR_ID;

    if (!saEmail || !saKey || !calendarId) {
      console.error("Missing headless environment variables");
      return NextResponse.json({ error: "Server configuration missing" }, { status: 500 });
    }

    // 1. Get Service Account Token
    const saAccessToken = await getServiceAccountToken(saEmail, saKey);

    // 2. Process via Gemini and Execute
    const result = await processHeadlessAction(textInput, saAccessToken, calendarId);

    console.log(`[Inbox] Successfully processed headless request. Created ${result.action}: ${result.eventId}`);
    
    return NextResponse.json(result);

  } catch (error: any) {
    console.error("[Inbox API Error]", error);
    return NextResponse.json({ 
      error: error.message || "Headless execution failed",
      details: error.stack 
    }, { status: 500 });
  }
}
