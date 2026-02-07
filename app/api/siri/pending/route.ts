
import { NextResponse } from 'next/server';
/**
 * DEPRECATED
 * Siri handoff now uses direct URL parameters in the shortcut's "Open URL" action.
 */
export async function GET() {
  return NextResponse.json({ messages: [], deprecated: true });
}
