
import { NextRequest, NextResponse } from 'next/server';

/**
 * SIRI SHORTCUT WEBHOOK (Stateless)
 * 
 * Instead of persisting dictated text in a database, this returns a deep link
 * that the Siri Shortcut can open to hand over the command to the Chronos UI.
 */
export async function POST(req: NextRequest) {
  try {
    const siriKey = req.headers.get('x-chronos-key');
    const secret = process.env.CHRONOS_SIRI_KEY;

    // Security check
    if (!secret || siriKey !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let extractedText: string | null = null;
    const contentType = req.headers.get('content-type') || '';

    // Handle JSON or Plain Text dictated commands
    if (contentType.includes('application/json')) {
      const body = await req.json();
      extractedText = body.text || body.value || body.dictatedText || body.command;
    } else {
      const bodyText = await req.text();
      // Try parsing as JSON if it looks like it
      if (bodyText.trim().startsWith('{')) {
        try {
          const body = JSON.parse(bodyText);
          extractedText = body.text || body.value || body.dictatedText || body.command;
        } catch (e) {
          extractedText = bodyText.trim();
        }
      } else {
        extractedText = bodyText.trim();
      }
    }

    if (!extractedText) {
      return NextResponse.json({ error: "Missing dictated text" }, { status: 400 });
    }

    // Construct the direct deep link for the iOS Shortcut
    const baseUrl = process.env.NEXTAUTH_URL || `https://${req.headers.get('host')}`;
    const redirectUrl = `${baseUrl}/ai?text=${encodeURIComponent(extractedText)}`;
    
    return NextResponse.json({ 
      ok: true,
      redirectUrl
    });
    
  } catch (error: any) {
    console.error("Siri Webhook Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
