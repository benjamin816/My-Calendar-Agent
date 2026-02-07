import { GoogleGenAI, Type, FunctionDeclaration, Modality, Part, GenerateContentResponse } from "@google/genai";
import { calendarService } from "./calendar";

const calendarTools: FunctionDeclaration[] = [
  {
    name: "list_events",
    description: "Search or list calendar events. Use timeMin and timeMax to filter.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        timeMin: { type: Type.STRING, description: "ISO RFC3339 string start time." },
        timeMax: { type: Type.STRING, description: "ISO RFC3339 string end time." }
      }
    }
  },
  {
    name: "clear_day",
    description: "Delete all single-day events on a specific day. Multi-day events are PRESERVED.",
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
    description: "Modify an existing event (extend, shorten, rename). Provide 'id' if known.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING, description: "Unique ID of the event." },
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
    description: "Remove an event permanently. Verbalize the event name first.",
    parameters: {
      type: Type.OBJECT,
      properties: { id: { type: Type.STRING } },
      required: ["id"]
    }
  },
  {
    name: "list_tasks",
    description: "Get user tasks from the default list."
  },
  {
    name: "create_task",
    description: "Add a new task.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        dueDate: { type: Type.STRING, description: "YYYY-MM-DD format" },
        notes: { type: Type.STRING }
      },
      required: ["title"]
    }
  },
  {
    name: "update_task",
    description: "Edit an existing task or mark it as complete. Use completed: true for 'checked off'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING },
        title: { type: Type.STRING },
        completed: { type: Type.BOOLEAN, description: "Whether the task is checked off/finished." },
        dueDate: { type: Type.STRING, description: "YYYY-MM-DD format" }
      },
      required: ["id"]
    }
  },
  {
    name: "delete_task",
    description: "Remove/Delete a task permanently. This is different from completing it.",
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

async function verifyAction(toolName: string, id: string | null, accessToken: string, date?: string): Promise<boolean> {
  try {
    switch (toolName) {
      case "create_event":
      case "update_event":
        if (!id) return false;
        const events = await calendarService.getEvents(undefined, undefined, accessToken);
        return !!events.find(e => e.id === id);
      case "delete_event":
        if (!id) return false;
        const all = await calendarService.getEvents(undefined, undefined, accessToken);
        return !all.find(e => e.id === id);
      case "clear_day":
        if (!date) return false;
        const dayEvs = await calendarService.getEvents(`${date}T00:00:00Z`, `${date}T23:59:59Z`, accessToken);
        const rangeStart = new Date(`${date}T00:00:00Z`);
        const rangeEnd = new Date(`${date}T23:59:59Z`);
        const remainingInDay = dayEvs.filter(ev => {
          const s = new Date(ev.start);
          const e = new Date(ev.end);
          return s >= rangeStart && e <= rangeEnd;
        });
        return remainingInDay.length === 0;
      default:
        return true;
    }
  } catch (e) {
    return false;
  }
}

export async function processChatAction(message: string, history: any[], accessToken: string, confirmed: boolean = false) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("Missing API_KEY");

  if (confirmed && message.startsWith("Executing ")) {
    const match = message.match(/Executing (\w+): (.*)/);
    if (match) {
      const toolName = match[1];
      const args = JSON.parse(match[2]);
      
      try {
        let result: any;
        switch (toolName) {
          case "delete_event": 
            result = await calendarService.deleteEvent(args.id, accessToken); 
            break;
          case "delete_task": 
            result = await calendarService.deleteTask(args.id, accessToken); 
            break;
          case "clear_day":
            const dayEvents = await calendarService.getEvents(`${args.date}T00:00:00Z`, `${args.date}T23:59:59Z`, accessToken);
            const rangeStart = new Date(`${args.date}T00:00:00Z`);
            const rangeEnd = new Date(`${args.date}T23:59:59Z`);
            const eventsToDelete = dayEvents.filter(ev => {
              const s = new Date(ev.start);
              const e = new Date(ev.end);
              return s >= rangeStart && e <= rangeEnd;
            });
            for (const ev of eventsToDelete) { await calendarService.deleteEvent(ev.id, accessToken); }
            result = { ok: true, count: eventsToDelete.length };
            break;
          case "create_event":
            result = await calendarService.createEvent(args, accessToken);
            break;
          case "update_event":
            result = await calendarService.updateEvent(args.id, args, accessToken);
            break;
          case "update_task":
            result = await calendarService.updateTask(args.id, args, accessToken);
            break;
          default:
            throw new Error(`Tool ${toolName} not supported in confirmation path.`);
        }

        await verifyAction(toolName, result?.id || args.id, accessToken, args.date);
        return { text: `Done. I've updated your schedule as requested.` };
      } catch (e: any) {
        return { text: `I encountered an issue: ${e.message}` };
      }
    }
  }

  const ai = new GoogleGenAI({ apiKey });
  const currentNYTime = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

  const systemInstruction = `You are Chronos AI.
  RULES:
  - Current Time: ${currentNYTime} (America/New_York).
  - TASK COMPLETION VS DELETION: 
    - If a user says "I finished [task]", "Check off [task]", or "Task [task] is done", use update_task with completed: true.
    - If a user says "Delete [task]", "Remove [task]", or "Get rid of [task]", use delete_task. 
    - VERBALLY explain the difference if the user seems confused.
  - DELETIONS: Verbally list names before showing confirmation.
  - CLEAR_DAY: Only delete single-day events.
  - ACCURACY: Always specify what you are acting upon.`;

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

  let toolRounds = 0;
  while (response.functionCalls && response.functionCalls.length > 0 && toolRounds < 5) {
    const parts: Part[] = [];
    for (const call of response.functionCalls) {
      
      if (call.name === "clear_day") {
        const evs = await calendarService.getEvents(`${call.args.date}T00:00:00Z`, `${call.args.date}T23:59:59Z`, accessToken);
        const rangeS = new Date(`${call.args.date}T00:00:00Z`);
        const rangeE = new Date(`${call.args.date}T23:59:59Z`);
        const targets = evs.filter(ev => new Date(ev.start) >= rangeS && new Date(ev.end) <= rangeE);
        const others = evs.length - targets.length;
        
        const names = targets.map(t => `"${t.summary}"`).join(", ");
        const text = targets.length > 0 
          ? `I'm prepared to clear your schedule for ${call.args.date}. This will remove: ${names}. ${others > 0 ? `I'll preserve your ${others} multi-day event(s).` : ''} Should I proceed?`
          : `I didn't find any single-day events to clear on ${call.args.date}${others > 0 ? `, but I am keeping your ${others} multi-day event(s) safe.` : '.'}`;

        return {
          text,
          ui: targets.length > 0 ? {
            type: "confirm",
            action: "clear_day",
            pending: { action: "clear_day", args: call.args }
          } : undefined
        };
      }

      if (call.name === "delete_event") {
        const allEvs = await calendarService.getEvents(undefined, undefined, accessToken);
        const target = allEvs.find(e => e.id === call.args.id);
        return {
          text: `I've prepared to delete "${target?.summary || 'this event'}". Confirm to remove it?`,
          ui: {
            type: "confirm",
            action: "delete_event",
            pending: { action: "delete_event", args: call.args }
          }
        };
      }

      if (call.name === "delete_task") {
        const allTasks = await calendarService.getTasks(accessToken);
        const target = allTasks.find(t => t.id === call.args.id);
        return {
          text: `I've prepared to permanently DELETE "${target?.title || 'this task'}". This is different from checking it off. Should I remove it?`,
          ui: {
            type: "confirm",
            action: "delete_task",
            pending: { action: "delete_task", args: call.args }
          }
        };
      }

      let result: any;
      try {
        switch (call.name) {
          case "list_events": result = await calendarService.getEvents(call.args.timeMin as string, call.args.timeMax as string, accessToken); break;
          case "create_event": result = await calendarService.createEvent(call.args as any, accessToken); break;
          case "update_event": result = await calendarService.updateEvent(call.args.id as string, call.args as any, accessToken); break;
          case "list_tasks": result = await calendarService.getTasks(accessToken); break;
          case "create_task": result = await calendarService.createTask(call.args as any, accessToken); break;
          case "update_task": result = await calendarService.updateTask(call.args.id as string, call.args as any, accessToken); break;
          default: throw new Error(`Tool not implemented: ${call.name}`);
        }
      } catch (e: any) {
        return { text: `Error: ${e.message}` };
      }

      parts.push({ functionResponse: { name: call.name, response: wrapToolResult(result) } });
    }
    response = await chat.sendMessage({ message: parts });
    toolRounds++;
  }

  return { text: extractModelText(response) || "I've updated your calendar." };
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
