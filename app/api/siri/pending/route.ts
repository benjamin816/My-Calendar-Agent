
import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { siriStorage } from '@/services/siriStorage';

/**
 * Fetches and clears pending Siri messages for the authenticated user.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const messages = await siriStorage.popAll();
    return NextResponse.json({ messages });
  } catch (error: any) {
    console.error("Pending Siri API Error:", error);
    return NextResponse.json({ error: "Failed to fetch pending messages" }, { status: 500 });
  }
}
