
import { NextResponse } from 'next/server';
import { siriStorage } from '@/services/siriStorage';

/**
 * Internal endpoint for Chronos UI to fetch pending Siri messages.
 * Clears the queue upon successful fetch.
 */
export async function GET() {
  try {
    const messages = siriStorage.popAll();
    return NextResponse.json({ messages });
  } catch (error: any) {
    return NextResponse.json({ error: "Failed to fetch pending messages" }, { status: 500 });
  }
}
