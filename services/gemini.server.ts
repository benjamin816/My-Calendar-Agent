
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
    description: "Add a new task. Note: Chronos policy transforms this into an all-day transparent event on the calendar.",
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

export async function processChatAction(
  message: string, 
  history: any[], 
  accessToken: string, 
  confirmed: boolean = false, 
  source: 'web' | 'siri' = 'web'
) {
  const isSiri = source === 'siri';

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
          case "create_task": 
            // Chronos Policy: Task -> All-day Free Event
            result = await calendarService.createEvent(
              { 
                summary: `[Task] ${args.title}`, 
                description: args.notes || '', 
                start: args.dueDate || new Date().toISOString().split('T')[0],
                end: args.dueDate || new Date().toISOString().split('T')[0]
              }, 
              accessToken, 
              'primary', 
              { transparency: 'transparent', isAllDay: true }
            ); 
            break;
          case "update_task": result = await calendarService.updateTask(args.id, args, accessToken); break;
          default: throw new Error(`Tool ${toolName} not supported in direct execution path.`);
        }
        return { text: `Done! I've updated your schedule as requested.` };
      } catch (e: any) {
        return { text: `I encountered an error while updating: ${e.message}` };
      }
    }
  }

  // Always use process.env.API_KEY directly when initializing the GoogleGenAI client instance
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const currentNYTime = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

  const systemInstruction = `You are Chronos AI, an elite scheduling agent.
  Current Context: ${currentNYTime} (New York).

  PRINCIPLES:
  - Concise & Action-Oriented.
  - When asked about the schedule, use 'list_events' and 'list_tasks' first.
  - IMPORTANT: All new "tasks" must be created as All-Day Events marked "Free" (Transparent).
  - Clearly distinguish between "completing" a task and "deleting" it.
  - Present lists with clear, readable formatting.

  TOOL USAGE:
  - Use 'list_events' for calendar visibility.
  - Use 'list_tasks' for task visibility.
  - Create tasks using 'create_task' tool (the implementation will handle the conversion to Calendar).`;

  const mappedHistory = history
    .filter(h => h.role === 'user' || h.role === 'assistant')
    .map(h => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }]
    }));

  const chat = ai.chats.create({
    model: "gemini-3-pro-preview",
    config: {
      systemInstruction,
      tools: [{ functionDeclarations: calendarTools }],
      thinkingConfig: { thinkingBudget: 4096 }
    },
    history: mappedHistory
  });

  let response = await chat.sendMessage({ message });

  let toolRounds = 0;
  while (response.functionCalls && response.functionCalls.length > 0 && toolRounds < 8) {
    const parts: Part[] = [];
    
    for (const call of response.functionCalls) {
      if (isSiri && ["clear_day", "delete_event", "delete_task", "create_event", "update_event", "create_task", "update_task"].includes(call.name)) {
        const executionText = `Executing ${call.name}: ${JSON.stringify(call.args)}`;
        return processChatAction(executionText, history, accessToken, true, 'siri');
      }

      let result: any;
      try {
        switch (call.name) {
          case "list_events": result = await calendarService.getEvents(call.args.timeMin as string, call.args.timeMax as string, accessToken); break;
          case "create_event": result = await calendarService.createEvent(call.args as any, accessToken); break;
          case "update_event": result = await calendarService.updateEvent(call.args.id as string, call.args as any, accessToken); break;
          case "list_tasks": result = await calendarService.getTasks(accessToken); break;
          case "create_task": 
            // Chronos Policy Enforcement
            result = await calendarService.createEvent(
              { 
                summary: `[Task] ${call.args.title}`, 
                description: call.args.notes as string || '', 
                start: (call.args.dueDate as string) || new Date().toISOString().split('T')[0],
                end: (call.args.dueDate as string) || new Date().toISOString().split('T')[0]
              }, 
              accessToken, 
              'primary', 
              { transparency: 'transparent', isAllDay: true }
            ); 
            break;
          case "update_task": result = await calendarService.updateTask(call.args.id as string, call.args as any, accessToken); break;
          default: result = { error: "Tool not implemented" };
        }
      } catch (e: any) {
        result = { error: e.message };
      }
      parts.push({ functionResponse: { name: call.name, response: wrapToolResult(result) } });
    }
    
    // Pass multi-part message response back to the chat.
    // Fixed: Pass the parts array directly as the message value to match SDK expected type: Part | Part[]
    response = await chat.sendMessage({ message: parts });
    toolRounds++;
  }

  return { text: response.text || "I've processed your request." };
}

/**
 * Headless execution logic for /api/inbox.
 * Processes text and executes actions using a service account token.
 */
export async function processHeadlessAction(text: string, accessToken: string, calendarId: string, outboxId?: string) {
  // Always use process.env.API_KEY directly when initializing the GoogleGenAI client instance
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const currentNYTime = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

  const systemInstruction = `You are a background scheduler for Chronos.
  Context: ${currentNYTime} (NY).
  Goal: Identify user intent to create a 'task' or 'event'.
  Policy:
  - If it's a 'task' (deadline-oriented), use 'create_task'.
  - If it's an 'event' (scheduled time), use 'create_event'.
  ONLY use one of these two.`;

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: text,
    config: {
      systemInstruction,
      tools: [{ functionDeclarations: calendarTools }]
    }
  });

  const call = response.functionCalls?.[0];
  if (!call) throw new Error("Could not parse actionable command.");

  const fingerprint = outboxId ? `\n\n[Fingerprint]\nOUTBOX_ID=${outboxId}\nsource=BrainDump` : '';
  let result: any;
  let finalAction: string;

  if (call.name === 'create_task') {
    finalAction = 'task_as_all_day_free_event';
    const dueDate = (call.args.dueDate as string) || new Date().toISOString().split('T')[0];
    result = await calendarService.createEvent(
      { 
        summary: `[Task] ${call.args.title}`, 
        description: ((call.args.notes as string) || '') + fingerprint, 
        start: dueDate, 
        end: dueDate 
      },
      accessToken,
      calendarId,
      { transparency: 'transparent', isAllDay: true }
    );
  } else if (call.name === 'create_event') {
    finalAction = 'timed_event';
    result = await calendarService.createEvent(
      {
        ...(call.args as any),
        description: ((call.args.description as string) || '') + fingerprint,
      },
      accessToken,
      calendarId,
      { transparency: 'opaque', isAllDay: false }
    );
  } else {
    throw new Error(`Command '${call.name}' is not supported in the headless inbox.`);
  }

  return {
    success: true,
    action: finalAction,
    calendarId,
    eventId: result.id,
    summary: result.summary,
    start: result.start,
    end: result.end
  };
}

/**
 * Handles Text-to-Speech generation.
 */
export async function processTTSAction(text: string) {
  // Always use process.env.API_KEY directly when initializing the GoogleGenAI client instance
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
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
