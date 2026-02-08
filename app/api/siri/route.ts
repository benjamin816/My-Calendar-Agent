import { NextRequest, NextResponse } from 'next/server';
import { siriStorage } from '@/services/siriStorage';

/**
 * SIRI SHORTCUT WEBHOOK
 * 
 * Extracts dictated text from Siri and either stores it in KV or 
 * passes it directly via URL parameter for stateless handling.
 */
export async function POST(req: NextRequest) {
  try {
    const siriKey = req.headers.get('x-chronos-key');
    const secret = process.env.CHRONOS_SIRI_KEY;

    // Optional but recommended security check
    if (secret && siriKey !== secret) {
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

    // Try to persist durably if KV is available, but don't crash if it's not
    const storedInKv = await siriStorage.push(extractedText);
    if (!storedInKv && !siriStorage.isConfigured()) {
      console.warn("[Chronos] KV not configured, falling back to stateless URL parameter.");
    }

    // Return a deep link. 
    // We always include the text in the URL as a robust fallback for the UI.
    const baseUrl = process.env.NEXTAUTH_URL || `https://${req.headers.get('host')}`;
    const encodedText = encodeURIComponent(extractedText);
    
    return NextResponse.json({ 
      ok: true,
      extracted: extractedText.substring(0, 30) + "...",
      storage: siriStorage.isConfigured() ? "kv" : "stateless-fallback",
      deepLink: `${baseUrl}/ai?text=${encodedText}&source=siri`
    });
    
  } catch (error: any) {
    console.error("Siri Webhook Error:", error);
    // Return a 500 only for actual code crashes, not configuration issues
    return NextResponse.json({ 
      error: "Internal server error during siri processing",
      details: error.message 
    }, { status: 500 });
  }
}