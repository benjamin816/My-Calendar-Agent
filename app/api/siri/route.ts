import { NextRequest, NextResponse } from 'next/server';
import { processChatAction } from '@/services/gemini.server';

/**
 * SIRI SHORTCUT WEBHOOK
 * 
 * Headers: 
 *   X-CHRONOS-KEY: 12345678
 * 
 * Body:
 *   {
 *     "text": "Schedule a meeting with Dave at 3pm tomorrow",
 *     "accessToken": "YA29..."
 *   }
 */
export async function POST(req: NextRequest) {
  try {
    const siriKey = req.headers.get('X-CHRONOS-KEY');
    
    // User defined secret key for Siri Shortcut authentication
    const secret = "12345678";

    if (siriKey !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { text } = await req.json();

    if (!text) {
      return NextResponse.json({ error: "Missing dictated text" }, { status: 400 });
    }


    // Process the action using the shared server-side logic
    const result = await processChatAction(text, [], accessToken, false, 'siri');

    return NextResponse.json({ 
      ok: true, 
      assistant: result.text 
    });
  } catch (error: any) {
    console.error("Siri Webhook Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
