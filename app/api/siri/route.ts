
import { NextRequest, NextResponse } from 'next/server';
import { siriStorage } from '@/services/siriStorage';

/**
 * SIRI SHORTCUT WEBHOOK
 * 
 * Extracts dictated text from Siri and stores it durably for the UI to consume.
 */
export async function POST(req: NextRequest) {
  try {
    const siriKey = req.headers.get('x-chronos-key');
    const secret = process.env.CHRONOS_SIRI_KEY;

    if (!secret || siriKey !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const bodyText = await req.text();
    let extractedText: string | null = null;

    if (bodyText.trim().startsWith('{')) {
      try {
        const body = JSON.parse(bodyText);
        extractedText = body.text || body.value || body.dictatedText || body.command;
      } catch (e) {}
    }

    if (!extractedText && bodyText.trim()) {
      extractedText = bodyText.trim();
    }

    if (!extractedText) {
      return NextResponse.json({ error: "Missing dictated text" }, { status: 400 });
    }

    // Persist durably
    await siriStorage.push(extractedText);

    // Return a deep link so the Shortcut can "Open URL" immediately
    const baseUrl = process.env.NEXTAUTH_URL || `https://${req.headers.get('host')}`;
    
    return NextResponse.json({ 
      ok: true,
      extracted: extractedText.substring(0, 30) + "...",
      deepLink: `${baseUrl}/ai?from=siri`
    });
    
  } catch (error: any) {
    console.error("Siri Webhook Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
