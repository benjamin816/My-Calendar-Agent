
import { NextRequest, NextResponse } from 'next/server';
import { processChatAction, processTTSAction } from '@/services/gemini.server';

export async function POST(req: NextRequest) {
  try {
    const { action, payload } = await req.json();

    if (!process.env.API_KEY) {
      return NextResponse.json({ error: "Missing API_KEY" }, { status: 500 });
    }

    if (action === 'chat') {
      const { message, history = [], accessToken } = payload;
      if (!accessToken) {
        return NextResponse.json({ error: "Missing Google Access Token" }, { status: 400 });
      }
      const result = await processChatAction(message, history, accessToken);
      return NextResponse.json({ result });
    }

    if (action === 'tts') {
      const { text } = payload;
      const result = await processTTSAction(text);
      return NextResponse.json({ result });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
