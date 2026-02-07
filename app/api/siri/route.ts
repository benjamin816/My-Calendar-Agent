
import { NextRequest, NextResponse } from 'next/server';
import { siriStorage } from '@/services/siriStorage';

/**
 * SIRI SHORTCUT WEBHOOK
 * 
 * Headers: 
 *   X-CHRONOS-KEY: [Value of process.env.CHRONOS_SIRI_KEY]
 * 
 * Body:
 *   {
 *     "text": "Schedule a meeting with Dave at 3pm tomorrow"
 *   }
 * 
 * This endpoint returns immediately after storing the text.
 * The actual AI processing happens when the user opens the app.
 */
export async function POST(req: NextRequest) {
  try {
    const siriKey = req.headers.get('x-chronos-key');
    const secret = process.env.CHRONOS_SIRI_KEY;

    if (!secret || siriKey !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { text } = await req.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: "Missing dictated text" }, { status: 400 });
    }

    // Store the message for the frontend to pick up
    siriStorage.push(text);

    return NextResponse.json({ 
      ok: true 
    });
  } catch (error: any) {
    console.error("Siri Webhook Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
