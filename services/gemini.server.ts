
import { GoogleGenAI, Type, FunctionDeclaration, Modality, Part, GenerateContentResponse } from "@google/genai";
import { calendarService } from "./calendar";

const calendarTools: FunctionDeclaration[] = [
  {
    name: "list_events",
    description: "Search or list calendar events. Use timeMin and timeMax (ISO RFC3339) to narrow down results. Useful for viewing the schedule.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        timeMin: { type: Type.STRING, description: "Lower bound for an event's end time (ISO 8601)." },
        timeMax: { type: Type.STRING, description: "Upper bound for an event's start time (ISO 8601)." }
      }
    }
  },
  {
    name: "create_event",
    description: "Create a new event in the user's primary calendar.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        summary: { type: Type.STRING, description: "Title of the event." },
        start: { type: Type.STRING, description: "Start time (YYYY-MM-DDTHH:mm:ss)." },
        end: { type: Type.STRING, description: "End time (YYYY-MM-DDTHH:mm:ss)." },
        description: { type: Type.STRING, description: "Optional description or notes." }
      },
      required: ["summary", "start"]
    }
  },
  {
    name: "update_event",
    description: "Modify an existing calendar event. Only provide fields that need updating.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING, description: "The unique ID of the event to update." },
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
    description: "Permanently remove an event from the calendar. Use with caution.",
    parameters: {
      type: Type.OBJECT,
      properties: { 
        id: { type: Type.STRING, description: "ID of the event to delete." } 
      },
      required: ["id"]
    }
  },
  {
    name: "clear_day",
    description: "Removes all single-day events for a specific date (YYYY-MM-DD). Keeps multi-day events safe.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        date: { type: Type.STRING, description: "The date to clear in YYYY-MM-DD format." }
      },
      required: ["date"]
    }
  },
  {
    name: "list_tasks",
    description: "Retrieve all tasks from the user's task lists, including completed ones."
  },
  {
    name: "create_task",
    description: "Add a new task to the default task list.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: "The name of the task." },
        dueDate: { type: Type.STRING, description: "Due date in YYYY-MM-DD format." },
        notes: { type: Type.STRING, description: "Additional details about the task." }
      },
      required: ["title"]
    }
  },
  {
    name: "update_task",
    description: "Update task details or mark as complete. Set completed: true to check it off.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING, description: "Unique task ID." },
        title: { type: Type.STRING },
        completed: { type: Type.BOOLEAN, description: "Status of completion." },
        dueDate: { type: Type.STRING, description: "Due date (YYYY-MM-DD)." },
        notes: { type: Type.STRING }
      },
      required: ["id"]
    }
  },
  {
    name: "delete_task",
    description: "Permanently delete a task. Not the same as completing it.",
    parameters: {
      type: Type.OBJECT,
      properties: { 
        id: { type: Type.STRING, description: "ID of the task to delete." } 
      },
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

export async function processChatAction(
  message: string, 
  history: any[], 
  accessToken: string, 
  confirmed: boolean = false, 
  source: 'web' | 'siri' = 'web'
) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("Missing API_KEY");

  const isSiri = source === 'siri';

  // Handling direct execution for confirmed/Siri actions
  if ((confirmed || isSiri) && message.startsWith("Executing ")) {
    const match = message.match(/Executing (\w+): (.*)/);
    if (match) {
      const toolName = match[1];
      const args = JSON.parse(match[2]);
      
      try {
        let result: any;
        switch (toolName) {
          case "delete_event": result = await calendarService.deleteEvent(args.id, accessToken); break;
          case "delete_task": result = await calendarService.deleteTask(args.id, accessToken); break;
          case "clear_day":
            const dayEvents = await calendarService.getEvents(`${args.date}T00:00:00Z`, `${args.date}T23:59:59Z`, accessToken);
            const eventsToDelete = dayEvents.filter(ev => !ev.isAllDay);
            for (const ev of eventsToDelete) { await calendarService.deleteEvent(ev.id, accessToken); }
            result = { ok: true, count: eventsToDelete.length };
            break;
          case "create_event": result = await calendarService.createEvent(args, accessToken); break;
          case "update_event": result = await calendarService.updateEvent(args.id, args, accessToken); break;
          case "create_task": result = await calendarService.createTask(args, accessToken); break;
          case "update_task": result = await calendarService.updateTask(args.id, args, accessToken); break;
          default: throw new Error(`Tool ${toolName} not supported in direct execution path.`);
        }
        return { text: `Success! I've updated your ${toolName.includes('task') ? 'tasks' : 'calendar'}.` };
      } catch (e: any) {
        return { text: `Action failed: ${e.message}` };
      }
    }
  }

  const ai = new GoogleGenAI({ apiKey });
  const currentNYTime = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

  const systemInstruction = `You are Chronos AI, an elite scheduling agent.
  Current Context: ${currentNYTime} (New York).

  PRINCIPLES:
  - Concise & Action-Oriented.
  - When asked about the schedule, use 'list_events' and 'list_tasks' first.
  - For deletions or clearing a whole day, ALWAYS ask for confirmation unless from Siri.
  - Clearly distinguish between "completing" a task and "deleting" it.
  - Present lists with clear formatting.
  - If requested to 'edit', first find the item's ID using a list tool.

  TOOL USAGE:
  - Use 'list_events' for visibility into the calendar.
  - Use 'list_tasks' for visibility into the task list.
  - If a user says "I'm done with...", suggest update_task(completed: true).`;

  const mappedHistory = history
    .filter(h => h.role === 'user' || h.role === 'assistant')
    .map(h => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }]
    }));

  const chat = ai.chats.create({
    model: "gemini-3-pro-preview", // Upgraded for better tool precision
    config: {
      systemInstruction,
      tools: [{ functionDeclarations: calendarTools }]
    },
    history: mappedHistory
  });

  let response = await chat.sendMessage({ message });

  let toolRounds = 0;
  while (response.functionCalls && response.functionCalls.length > 0 && toolRounds < 6) {
    const parts: Part[] = [];
    
    for (const call of response.functionCalls) {
      // Force direct execution for risky tools if Siri is the source
      if (isSiri && ["clear_day", "delete_event", "delete_task"].includes(call.name)) {
        const executionText = `Executing ${call.name}: ${JSON.stringify(call.args)}`;
        return processChatAction(executionText, history, accessToken, true, 'siri');
      }

      // UI Confirmations for destructive actions
      if (call.name === "clear_day") {
        return {
          text: `Are you sure you want to clear your single-day events for ${call.args.date}?`,
          ui: { type: "confirm", action: "clear_day", pending: { action: "clear_day", args: call.args } }
        };
      }
      if (call.name === "delete_event") {
        return {
          text: `Confirm deleting this event?`,
          ui: { type: "confirm", action: "delete_event", pending: { action: "delete_event", args: call.args } }
        };
      }
      if (call.name === "delete_task") {
        return {
          text: `Confirm deleting this task permanently?`,
          ui: { type: "confirm", action: "delete_task", pending: { action: "delete_task", args: call.args } }
        };
      }

      // Execute non-destructive tools immediately
      let result: any;
      try {
        switch (call.name) {
          case "list_events": result = await calendarService.getEvents(call.args.timeMin as string, call.args.timeMax as string, accessToken); break;
          case "create_event": result = await calendarService.createEvent(call.args as any, accessToken); break;
          case "update_event": result = await calendarService.updateEvent(call.args.id as string, call.args as any, accessToken); break;
          case "list_tasks": result = await calendarService.getTasks(accessToken); break;
          case "create_task": result = await calendarService.createTask(call.args as any, accessToken); break;
          case "update_task": result = await calendarService.updateTask(call.args.id as string, call.args as any, accessToken); break;
          default: result = { error: "Tool not supported" };
        }
      } catch (e: any) {
        result = { error: e.message };
      }
      parts.push({ functionResponse: { name: call.name, response: wrapToolResult(result) } });
    }
    
    response = await chat.sendMessage({ message: parts });
    toolRounds++;
  }

  const finalPrefix = isSiri ? "(Siri) " : "";
  return { text: finalPrefix + (extractModelText(response) || "Processed.") };
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
