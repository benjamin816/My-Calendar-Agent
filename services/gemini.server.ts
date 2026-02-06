
import { GoogleGenAI, Type, FunctionDeclaration, Modality, Part, GenerateContentResponse } from "@google/genai";
import { calendarService } from "./calendar";

const calendarTools: FunctionDeclaration[] = [
  {
    name: "list_events",
    description: "Search/list calendar events.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        timeMin: { type: Type.STRING, description: "ISO string (Z or Offset)" },
        timeMax: { type: Type.STRING, description: "ISO string (Z or Offset)" }
      }
    }
  },
  {
    name: "clear_day",
    description: "Delete all events on a specific day.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        date: { type: Type.STRING, description: "The date to clear in YYYY-MM-DD format." }
      },
      required: ["date"]
    }
  },
  {
    name: "create_event",
    description: "Create a new calendar event.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        summary: { type: Type.STRING, description: "Event title" },
        start: { type: Type.STRING, description: "Start time (local ISO YYYY-MM-DDTHH:mm:ss)" },
        end: { type: Type.STRING, description: "End time (local ISO YYYY-MM-DDTHH:mm:ss)" },
        description: { type: Type.STRING }
      },
      required: ["summary", "start"]
    }
  },
  {
    name: "update_event",
    description: "Modify an existing event. Provide 'id' if known.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING, description: "Unique ID of the event." },
        summary: { type: Type.STRING },
        start: { type: Type.STRING },
        end: { type: Type.STRING },
        description: { type: Type.STRING }
      }
    }
  },
  {
    name: "delete_event",
    description: "Remove an event by 'id'.",
    parameters: {
      type: Type.OBJECT,
      properties: { id: { type: Type.STRING } },
      required: ["id"]
    }
  },
  {
    name: "list_tasks",
    description: "Get user tasks."
  },
  {
    name: "create_task",
    description: "Add a new task.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        dueDate: { type: Type.STRING, description: "YYYY-MM-DD" },
        notes: { type: Type.STRING }
      },
      required: ["title"]
    }
  },
  {
    name: "update_task",
    description: "Edit an existing task.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING },
        title: { type: Type.STRING },
        completed: { type: Type.BOOLEAN },
        dueDate: { type: Type.STRING }
      },
      required: ["id"]
    }
  },
  {
    name: "delete_task",
    description: "Remove a task.",
    parameters: {
      type: Type.OBJECT,
      properties: { id: { type: Type.STRING } },
      required: ["id"]
    }
  }
];

function wrapToolResult(x: unknown): Record<string, unknown> {
  if (x == null) return { ok: true };
  if (Array.isArray(x)) return { items: x };
  if (typeof x === "object") return x as Record<string, unknown>;
  return { value: String(x) };
}

function extractModelText(response: GenerateContentResponse): string {
  if (response.text) return response.text;
  const parts = response.candidates?.[0]?.content?.parts || [];
  return parts.map(p => p.text || '').join('').trim();
}

export async function processChatAction(message: string, history: any[], accessToken: string, confirmed: boolean = false) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("Missing API_KEY");

  // Fastpath for confirmed UI actions
  if (confirmed && message.startsWith("Executing ")) {
    const match = message.match(/Executing (\w+): (.*)/);
    if (match) {
      const toolName = match[1];
      const args = JSON.parse(match[2]);
      try {
        let result: any;
        switch (toolName) {
          case "list_events": result = await calendarService.getEvents(args.timeMin, args.timeMax, accessToken); break;
          case "clear_day":
            const dayEvents = await calendarService.getEvents(`${args.date}T00:00:00`, `${args.date}T23:59:59`, accessToken);
            for (const ev of dayEvents) { await calendarService.deleteEvent(ev.id, accessToken); }
            return { text: `Cleared ${dayEvents.length} events from ${args.date}.` };
          case "create_event": result = await calendarService.createEvent(args, accessToken); break;
          case "update_event": result = await calendarService.updateEvent(args.id, args, accessToken); break;
          case "delete_event": result = await calendarService.deleteEvent(args.id, accessToken); break;
          case "list_tasks": result = await calendarService.getTasks(accessToken); break;
          case "create_task": result = await calendarService.createTask(args, accessToken); break;
          case "update_task": result = await calendarService.updateTask(args.id, args, accessToken); break;
          case "delete_task": result = await calendarService.deleteTask(args.id, accessToken); break;
        }
        return { text: "Action successfully completed." };
      } catch (e: any) {
        return { text: `Execution error: ${e.message}` };
      }
    }
  }

  const ai = new GoogleGenAI({ apiKey });
  const currentNYTime = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

  const systemInstruction = `You are Chronos AI, a smart calendar concierge.
  TIMEZONE: America/New_York.
  TIME: ${currentNYTime}.
  Always use tools for schedule changes. Require confirmation for deletions.`;

  const mappedHistory = history
    .filter(h => h.role === 'user' || h.role === 'assistant')
    .map(h => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }]
    }));

  const chat = ai.chats.create({
    model: "gemini-3-flash-preview",
    config: {
      systemInstruction,
      tools: [{ functionDeclarations: calendarTools }]
    },
    history: mappedHistory
  });

  let response = await chat.sendMessage({ message });

  let lastToolExecuted = "";
  let lastResult: any = null;
  let toolRounds = 0;
  const maxRounds = 3;

  while (response.functionCalls && response.functionCalls.length > 0 && toolRounds < maxRounds) {
    const parts: Part[] = [];
    for (const call of response.functionCalls) {
      lastToolExecuted = call.name;

      // Sensitive UI Interceptors
      if (call.name === "clear_day" || call.name === "delete_event" || call.name === "delete_task") {
        return {
          text: `Should I go ahead and ${call.name.replace('_', ' ')}?`,
          ui: {
            type: "confirm",
            action: call.name,
            message: `Confirm ${call.name.replace('_', ' ')}?`,
            pending: { action: call.name, args: call.args }
          }
        };
      }

      if (call.name === "update_event" && !call.args.id) {
        const events = await calendarService.getEvents(undefined, undefined, accessToken);
        return {
          text: "I found multiple events. Which one should I modify?",
          ui: {
            type: "pick",
            options: events.slice(0, 6),
            pending: { action: "update_event", args: call.args }
          }
        };
      }

      // Standard Tool Execution
      let result: any;
      try {
        switch (call.name) {
          case "list_events": result = await calendarService.getEvents(call.args.timeMin as string, call.args.timeMax as string, accessToken); break;
          case "create_event": result = await calendarService.createEvent(call.args as any, accessToken); break;
          case "list_tasks": result = await calendarService.getTasks(accessToken); break;
          case "create_task": result = await calendarService.createTask(call.args as any, accessToken); break;
          case "update_task": result = await calendarService.updateTask(call.args.id as string, call.args as any, accessToken); break;
          default: result = { status: "unknown_tool" };
        }
      } catch (e: any) {
        result = { error: e.message };
      }
      lastResult = result;
      parts.push({ functionResponse: { name: call.name, response: wrapToolResult(result) } });
    }

    // Fixed: Passing structured message object for tool response
    response = await chat.sendMessage({ message: { role: 'user', parts } });
    toolRounds++;
  }

  let finalOutput = extractModelText(response);
  if (!finalOutput && lastToolExecuted) {
    finalOutput = lastResult?.error ? `Error: ${lastResult.error}` : `I've finished the ${lastToolExecuted.replace('_', ' ')}.`;
  }

  return { text: finalOutput || "Done." };
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
