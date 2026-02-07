import { NextRequest, NextResponse } from 'next/server';
import { siriStorage } from '@/services/siriStorage';

/**
 * SIRI SHORTCUT WEBHOOK (ROBUST VERSION)
 * 
 * Handles multiple payload formats from iOS Shortcuts, focusing on 
 * extracting spoken commands from various JSON shapes.
 */
export async function POST(req: NextRequest) {
  try {
    // 1. AUTHENTICATION
    const siriKey = req.headers.get('x-chronos-key');
    const secret = process.env.CHRONOS_SIRI_KEY;

    if (!secret || siriKey !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const contentType = req.headers.get('content-type') || '';
    const bodyText = await req.text();
    
    let extractedText: string | null = null;
    let diagnosticInfo: any = {
      contentType,
      bodyPreview: bodyText.substring(0, 100),
      bodyLength: bodyText.length,
      keysReceived: [],
      types: {},
      branch: 'none'
    };

    // 2. EXTRACTION LOGIC
    
    // Attempt 1: JSON Parsing
    if (bodyText.trim().startsWith('{')) {
      try {
        const body = JSON.parse(bodyText);
        diagnosticInfo.parsedAs = 'json';
        diagnosticInfo.keysReceived = Object.keys(body);
        diagnosticInfo.types = {
          text: typeof body.text,
          value: typeof body.value,
          key: typeof body.key,
          Text: typeof body.Text
        };

        // Rule 1: Prefer body.text if it is a non-empty string
        if (typeof body.text === 'string' && body.text.trim()) {
          extractedText = body.text.trim();
          diagnosticInfo.branch = 'body.text (string)';
        }
        // Rule 2: Else if body.value is a non-empty string, use that
        else if (typeof body.value === 'string' && body.value.trim()) {
          extractedText = body.value.trim();
          diagnosticInfo.branch = 'body.value (string)';
        }
        // Rule 3: Else if body.key === "text" and body.value is a non-empty string, use body.value
        else if (body.key === 'text' && typeof body.value === 'string' && body.value.trim()) {
          extractedText = body.value.trim();
          diagnosticInfo.branch = 'body.key=text && body.value (string)';
        }
        // Rule 4: Else if body.text is an object and has .value or .text string, use it
        else if (typeof body.text === 'object' && body.text !== null) {
          const inner = body.text.value || body.text.text;
          if (typeof inner === 'string' && inner.trim()) {
            extractedText = inner.trim();
            diagnosticInfo.branch = 'body.text (object).value/text';
          }
        }
        
        // Rule 5: Scan known candidate fields
        if (!extractedText) {
          const candidates = ['text', 'Text', 'value', 'Value', 'dictatedText', 'DictatedText', 'command', 'input'];
          for (const k of candidates) {
            if (typeof body[k] === 'string' && body[k].trim()) {
              extractedText = body[k].trim();
              diagnosticInfo.branch = `candidate field: ${k}`;
              break;
            }
          }
        }
      } catch (e) {
        diagnosticInfo.jsonError = (e as Error).message;
      }
    }

    // Attempt 2: Form Data Fallback
    if (!extractedText && (contentType.includes('form') || bodyText.includes('='))) {
      try {
        const params = new URLSearchParams(bodyText);
        const possibleKeys = ['text', 'Text', 'value', 'dictatedText', 'command', 'input'];
        for (const key of possibleKeys) {
          const val = params.get(key);
          if (val && val.trim()) {
            extractedText = val.trim();
            diagnosticInfo.parsedAs = 'form-data';
            diagnosticInfo.branch = `form key: ${key}`;
            break;
          }
        }
      } catch (e) {}
    }

    // Attempt 3: Raw Text Fallback
    if (!extractedText && bodyText.trim()) {
      if (!bodyText.trim().startsWith('{') || bodyText.length < 5) {
        extractedText = bodyText.trim();
        diagnosticInfo.parsedAs = 'raw-text';
        diagnosticInfo.branch = 'raw body text';
      }
    }

    // 3. FINAL VALIDATION & STORAGE
    if (!extractedText) {
      console.warn("[Siri Webhook] Failed to extract text:", diagnosticInfo);
      return NextResponse.json({ 
        error: "Missing dictated text",
        debug: {
          contentType: diagnosticInfo.contentType,
          keys: diagnosticInfo.keysReceived,
          types: diagnosticInfo.types,
          parsedAs: diagnosticInfo.parsedAs
        }
      }, { status: 400 });
    }

    // Log extraction success for debugging
    console.log(`[Siri Webhook] Extracted text from branch "${diagnosticInfo.branch}": "${extractedText.substring(0, 30)}..."`);

    // Store the message for the frontend to pick up
    siriStorage.push(extractedText);

    return NextResponse.json({ 
      ok: true,
      extracted: extractedText.substring(0, 20) + "..."
    });
    
  } catch (error: any) {
    console.error("Siri Webhook Critical Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
