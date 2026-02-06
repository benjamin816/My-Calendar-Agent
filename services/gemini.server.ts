
import { GoogleGenAI, Type, FunctionDeclaration, Modality, Part } from "@google/genai";
import { calendarService } from "./calendar";

const calendarTools: FunctionDeclaration[] = [
  {
    name: "list_events",
    description: "Search/list calendar events. CRITICAL: Use this to find the correct 'id' before attempting to update or delete an event.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        timeMin: { type: Type.STRING, description: "ISO string (EST)" },
        timeMax: { type: Type.STRING, description: "ISO string (EST)" }
      }
    }
  },
  {
    name: "create_event",
    description: "Create a new calendar event.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        summary: { type: Type.STRING, description: "Event title" },
        start: { type: Type.STRING, description: "Start time (EST ISO string)" },
        end: { type: Type.STRING, description: "End time (EST ISO string)" },
        description: { type: Type.STRING }
      },
      required: ["summary", "start"]
    }
  },
  {
    name: "update_event",
    description: "Modify an existing event. REQUIRES an 'id'. Search first if unknown.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING, description: "ID from list_events" },
        summary: { type: Type.STRING },
        start: { type: Type.STRING },
        end: { type: Type.STRING },
        description: { type: Type.STRING }
      },
      required: ["id"]
    }
  },
  {
    name: "delete_event",
    description: "Remove an event. REQUIRES an 'id'. Search first if unknown.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING, description: "ID from list_events" }
      },
      required: ["id"]
    }
  },
  {
    name: "list_tasks",
    description: "Get user tasks."
  },
  {
    name: "create_task",
    description: "Add a task with a specific date.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        dueDate: { type: Type.STRING, description: "YYYY-MM-DD" }
      },
      required: ["title", "dueDate"]
    }
  }
];

export async function processChatAction(message: string, history: any[], accessToken: string, confirmed: boolean = false) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("Missing API_KEY");

  const ai = new GoogleGenAI({ apiKey });
  
  // Create system instruction with current context
  const systemInstruction = `You are Chronos, a calendar agent.
  CRITICAL: 
  1. ALL TIMES ARE America/New_York (EST/EDT). NEVER use UTC.
  2. Current Context Time: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}.
  3. When a user asks to "remove", "reschedule", or "change" an event, you MUST call 'list_events' first to find the 'id' and current details.
  4. Once you have the 'id', call the appropriate 'update_event' or 'delete_event' tool.
  5. If the user confirms an action, proceed immediately with the tool call.
  6. Always respond in Markdown.`;

  const chat = ai.chats.create({
    model: "gemini-3-flash-preview",
    config: {
      systemInstruction,
      tools: [{ functionDeclarations: calendarTools }]
    },
    history: history
  });

  // If user is confirming, we force the context to "The user confirmed, proceed with [Original Action]"
  const prompt = confirmed ? `User has confirmed the following action. Proceed with the tool call now: ${message}` : message;
  
  let response = await chat.sendMessage({ message: prompt });
  
  // Handle Tool Calls
  if (response.functionCalls && response.functionCalls.length > 0) {
    const firstCall = response.functionCalls[0];

    // Check for UI Interceptions (Duration / Confirmation)
    if (!confirmed) {
      if (firstCall.name === "create_event") {
        const args = firstCall.args as any;
        if (!args.end || args.end === args.start) {
          return {
            text: "How long should this event be?",
            ui: { type: 'duration', options: [15, 30, 45, 60, 90, 120], pending: { action: 'create_event', args: args } }
          };
        }
      }

      if (firstCall.name === "update_event") {
        return {
          text: "I found the event. Ready to apply the changes?",
          ui: { 
            type: 'confirm', 
            action: 'update_event', 
            pending: { action: 'update_event', args: firstCall.args },
            message: `Apply changes to "${(firstCall.args as any).summary || 'event'}"?`
          }
        };
      }

      if (firstCall.name === "delete_event") {
        return {
          text: "Are you sure you want to remove this?",
          ui: { 
            type: 'confirm', 
            action: 'delete_event', 
            pending: { action: 'delete_event', args: firstCall.args },
            message: "Permanently delete this event?"
          }
        };
      }
    }

    // Execute Tools
    const functionResponseParts: Part[] = [];
    for (const call of response.functionCalls) {
      let result: any;
      try {
        switch (call.name) {
          case "list_events":
            result = await calendarService.getEvents(call.args.timeMin as string, call.args.timeMax as string, accessToken);
            break;
          case "create_event":
            result = await calendarService.createEvent(call.args as any, accessToken);
            break;
          case "update_event":
            result = await calendarService.updateEvent(call.args.id as string, call.args as any, accessToken);
            break;
          case "delete_event":
            await calendarService.deleteEvent(call.args.id as string, accessToken);
            result = { status: "success", message: "Event removed" };
            break;
          case "list_tasks":
            result = await calendarService.getTasks(accessToken);
            break;
          case "create_task":
            result = await calendarService.createTask(call.args as any, accessToken);
            break;
        }
      } catch (e: any) {
        result = { error: e.message };
      }
      functionResponseParts.push({ functionResponse: { name: call.name, response: { result } } });
    }

    // Get final text confirmation from model
    const finalResponse = await chat.sendMessage({ message: functionResponseParts });
    return { text: finalResponse.text };
  }

  return { text: response.text };
}

export async function processTTSAction(text: string) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("Missing API_KEY");
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
    },
  });
  return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
}
