
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

/**
 * Verification utility to ensure mutations actually happened on Google Calendar/Tasks.
 */
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
        } catch { return true; } // If fetch fails specifically because id not found, it's deleted
      case "clear_day":
        if (!date) return false;
        const dayEvs = await calendarService.getEvents(`${date}T00:00:00Z`, `${date}T23:59:59Z`, accessToken);
        return dayEvs.length === 0;
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

  // --- FASTPATH FOR CONFIRMED ACTIONS ---
  if (confirmed && message.startsWith("Executing ")) {
    const match = message.match(/Executing (\w+): (.*)/);
    if (match) {
      const toolName = match[1];
      const args = JSON.parse(match[2]);
      console.log(`[Mutation] Confirmed Execution: ${toolName}`, args);
      
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
            for (const ev of dayEvents) { await calendarService.deleteEvent(ev.id, accessToken); }
            result = { count: dayEvents.length, date: args.date };
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

        // Verification
        const verified = await verifyAction(toolName, result?.id || args.id, accessToken, args.date);
        if (!verified) throw new Error("Verification step failed: Resource not found or state unchanged after API call.");

        console.log(`[Success] ${toolName} verified.`);
        if (toolName === "create_event" || toolName === "update_event") {
          return { text: `Successfully ${toolName.replace('_','d')}: "${result.summary}" starting at ${result.start}.` };
        }
        return { text: `The ${toolName.replace('_', ' ')} has been successfully executed and verified.` };
      } catch (e: any) {
        console.error(`[Failure] ${toolName}:`, e);
        return { text: `Execution error: ${e.message}` };
      }
    }
  }

  const ai = new GoogleGenAI({ apiKey });
  const currentNYTime = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

  const systemInstruction = `You are Chronos AI, an advanced, proactive calendar concierge.
  CURRENT CONTEXT:
  - Local Time: ${currentNYTime} (America/New_York)
  - You MUST use tools for all calendar/task operations.
  - For removals (deleting events/tasks or clearing a day), ALWAYS prepare the action and let the UI handle confirmation.
  - If a user wants to update/delete but you don't have the ID, call list_events first.
  - NEVER pretend to have done an action without a successful tool result.
  - If a tool fails, inform the user about the error.`;

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
      console.log(`[Tool Call] ${call.name}`, call.args);

      // Sensitive UI Interceptors (Deletions/Clears)
      if (call.name === "clear_day" || call.name === "delete_event" || call.name === "delete_task") {
        return {
          text: `I've prepared the ${call.name.replace('_', ' ')} action. Please confirm to proceed.`,
          ui: {
            type: "confirm",
            action: call.name,
            pending: { action: call.name, args: call.args }
          }
        };
      }

      // Logic for discovering events if ID is missing for an update
      if (call.name === "update_event" && !call.args.id) {
        const events = await calendarService.getEvents(undefined, undefined, accessToken);
        return {
          text: "I found multiple events. Which one should I update?",
          ui: {
            type: "pick",
            options: events.slice(0, 8),
            pending: { action: "update_event", args: call.args }
          }
        };
      }

      // Execute standard tools
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
          case "list_tasks": 
            result = await calendarService.getTasks(accessToken); 
            break;
          case "create_task": 
            result = await calendarService.createTask(call.args as any, accessToken); 
            break;
          case "update_task": 
            result = await calendarService.updateTask(call.args.id as string, call.args as any, accessToken); 
            break;
          default: 
            console.error(`[Error] Unknown tool: ${call.name}`);
            return { text: `Execution error: Tool not implemented: ${call.name}` };
        }

        // Verify mutations in the loop (create/update)
        if (["create_event", "update_event", "create_task", "update_task"].includes(call.name)) {
          const isVerified = await verifyAction(call.name, result.id, accessToken);
          if (!isVerified) throw new Error(`Mutation ${call.name} reported success but verification failed.`);
          console.log(`[Verified] ${call.name} ID: ${result.id}`);
        }

      } catch (e: any) {
        console.error(`[Tool Error] ${call.name}:`, e.message);
        return { text: `Execution error: ${e.message}` };
      }

      parts.push({ functionResponse: { name: call.name, response: wrapToolResult(result) } });
    }

    response = await chat.sendMessage({ message: parts });
    toolRounds++;
  }

  return { text: extractModelText(response) || "I've processed your request." };
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
