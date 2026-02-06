
import { GoogleGenAI, Type, FunctionDeclaration, Modality, Part, GenerateContentResponse } from "@google/genai";
import { calendarService } from "./calendar";

const calendarTools: FunctionDeclaration[] = [
  {
    name: "list_events",
    description: "Search or list calendar events. Use timeMin and timeMax to filter.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        timeMin: { type: Type.STRING, description: "ISO string start time." },
        timeMax: { type: Type.STRING, description: "ISO string end time." }
      }
    }
  },
  {
    name: "clear_day",
    description: "Delete all events on a specific day. Only events ENTIRELY within this day will be removed.",
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
    description: "Remove an event by 'id'.",
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
    description: "Edit an existing task.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING },
        title: { type: Type.STRING },
        completed: { type: Type.BOOLEAN },
        dueDate: { type: Type.STRING, description: "YYYY-MM-DD format" }
      },
      required: ["id"]
    }
  },
  {
    name: "delete_task",
    description: "Remove a task by ID.",
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
        try {
          const all = await calendarService.getEvents(undefined, undefined, accessToken);
          return !all.find(e => e.id === id);
        } catch { return true; } 
      case "clear_day":
        if (!date) return false;
        const dayEvs = await calendarService.getEvents(`${date}T00:00:00Z`, `${date}T23:59:59Z`, accessToken);
        // During verification, clear_day is only "verified" if no events ENTIRELY in that day remain
        const rangeStart = new Date(`${date}T00:00:00`);
        const rangeEnd = new Date(`${date}T23:59:59`);
        const remainingInDay = dayEvs.filter(ev => {
          const s = new Date(ev.start);
          const e = new Date(ev.end);
          return s >= rangeStart && e <= rangeEnd;
        });
        return remainingInDay.length === 0;
      case "create_task":
      case "update_task":
        if (!id) return false;
        const tasks = await calendarService.getTasks(accessToken);
        return !!tasks.find(t => t.id === id);
      case "delete_task":
        if (!id) return false;
        const allTasks = await calendarService.getTasks(accessToken);
        return !allTasks.find(t => t.id === id);
      default:
        return true;
    }
  } catch (e) {
    console.error(`Verification failed for ${toolName}:`, e);
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
            const dayEvents = await calendarService.getEvents(`${args.date}T00:00:00`, `${args.date}T23:59:59`, accessToken);
            const rangeStart = new Date(`${args.date}T00:00:00`);
            const rangeEnd = new Date(`${args.date}T23:59:59`);
            
            // Only delete events that fall ENTIRELY within the day
            const eventsToDelete = dayEvents.filter(ev => {
              const s = new Date(ev.start);
              const e = new Date(ev.end);
              return s >= rangeStart && e <= rangeEnd;
            });

            for (const ev of eventsToDelete) { await calendarService.deleteEvent(ev.id, accessToken); }
            result = { count: eventsToDelete.length, date: args.date };
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

        const verified = await verifyAction(toolName, result?.id || args.id, accessToken, args.date);
        if (!verified) throw new Error("Verification failed: State unchanged.");

        if (toolName === "create_event" || toolName === "update_event") {
          return { text: `Success! I've updated your schedule. "${result.summary}" is set.` };
        }
        return { text: `Action completed. Your schedule has been updated and verified.` };
      } catch (e: any) {
        return { text: `I encountered an issue while finalizing that: ${e.message}` };
      }
    }
  }

  const ai = new GoogleGenAI({ apiKey });
  const currentNYTime = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

  const systemInstruction = `You are Chronos AI.
  RULES:
  - Local Time: ${currentNYTime} (America/New_York).
  - DELETIONS/CLEARING: You MUST provide a textual summary of EXACTLY which events are being affected before presenting the confirmation UI.
  - CLEAR_DAY: This only deletes events that START and END on that specific day. Multi-day events spanning across the day are PRESERVED. Mention this to the user.
  - MODIFICATIONS: If a user asks to "extend my meeting through Friday" or "end it on Monday", use update_event with the calculated new ISO timestamps.
  - VERBAL CONFIRMATION: In your response text, explicitly name the events being modified or deleted. 
  Example: "I've prepared to delete your 'Doctor Appointment'. Should I proceed?"
  Example: "I'm clearing today. This will remove 'Gym' and 'Lunch', but I'll keep your multi-day 'Ski Trip'. Confirm?"`;

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
  const maxRounds = 5;

  while (response.functionCalls && response.functionCalls.length > 0 && toolRounds < maxRounds) {
    const parts: Part[] = [];
    for (const call of response.functionCalls) {
      
      // UI Interceptor for Deletions
      if (call.name === "clear_day") {
        const evs = await calendarService.getEvents(`${call.args.date}T00:00:00`, `${call.args.date}T23:59:59`, accessToken);
        const rangeS = new Date(`${call.args.date}T00:00:00`);
        const rangeE = new Date(`${call.args.date}T23:59:59`);
        const targets = evs.filter(ev => new Date(ev.start) >= rangeS && new Date(ev.end) <= rangeE);
        const multiDayCount = evs.length - targets.length;
        
        const names = targets.map(t => `"${t.summary}"`).join(", ");
        const text = targets.length > 0 
          ? `I've prepared to clear your day. This will remove: ${names}. ${multiDayCount > 0 ? `I'm preserving ${multiDayCount} multi-day event(s) as they aren't contained entirely within this date.` : ''} Shall I proceed?`
          : `I didn't find any single-day events to clear on ${call.args.date}${multiDayCount > 0 ? `, but I am keeping your ${multiDayCount} multi-day event(s) safe.` : '.'}`;

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
        // Find title for verbal confirmation
        const allEvs = await calendarService.getEvents(undefined, undefined, accessToken);
        const target = allEvs.find(e => e.id === call.args.id);
        const title = target ? `"${target.summary}"` : "this event";
        return {
          text: `I've prepared to delete ${title}. Confirm to remove it from your calendar?`,
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
        const title = target ? `"${target.title}"` : "this task";
        return {
          text: `I've prepared to delete ${title}. Should I remove it?`,
          ui: {
            type: "confirm",
            action: "delete_task",
            pending: { action: "delete_task", args: call.args }
          }
        };
      }

      // Handle discovery for updates if ID missing
      if (call.name === "update_event" && !call.args.id) {
        const events = await calendarService.getEvents(undefined, undefined, accessToken);
        return {
          text: "I found multiple events. Which one should I modify?",
          ui: {
            type: "pick",
            options: events.slice(0, 8),
            pending: { action: "update_event", args: call.args }
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

        if (["create_event", "update_event", "create_task", "update_task"].includes(call.name)) {
          const isVerified = await verifyAction(call.name, result.id, accessToken);
          if (!isVerified) throw new Error(`Mutation reported success but verification failed.`);
        }
      } catch (e: any) {
        return { text: `I ran into a problem: ${e.message}` };
      }

      parts.push({ functionResponse: { name: call.name, response: wrapToolResult(result) } });
    }

    response = await chat.sendMessage({ message: parts });
    toolRounds++;
  }

  return { text: extractModelText(response) || "I've finished updating your schedule." };
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
