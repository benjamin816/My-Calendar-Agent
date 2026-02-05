
import { GoogleGenAI, Type, FunctionDeclaration, Modality, Part } from "@google/genai";
import { calendarService } from "./calendar";

const calendarTools: FunctionDeclaration[] = [
  {
    name: "list_events",
    description: "Get a list of calendar events for a specific time range.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        timeMin: { type: Type.STRING, description: "ISO date string for start of range" },
        timeMax: { type: Type.STRING, description: "ISO date string for end of range" }
      }
    }
  },
  {
    name: "create_event",
    description: "Create a new calendar event.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        summary: { type: Type.STRING, description: "The title of the event" },
        start: { type: Type.STRING, description: "ISO date string for start time" },
        end: { type: Type.STRING, description: "ISO date string for end time. If missing or same as start, it will trigger a duration prompt." },
        description: { type: Type.STRING, description: "Details about the event" }
      },
      required: ["summary", "start"]
    }
  },
  {
    name: "update_event",
    description: "Update an existing calendar event (including moving it).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING, description: "Unique ID of the event to update" },
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
    description: "Remove an event from the calendar.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING, description: "Unique ID of the event to remove" }
      },
      required: ["id"]
    }
  },
  {
    name: "list_tasks",
    description: "Get the current list of tasks."
  },
  {
    name: "create_task",
    description: "Add a new task to the task list. Requires a date.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: "Title of the task" },
        dueDate: { type: Type.STRING, description: "Mandatory due date (YYYY-MM-DD format)" }
      },
      required: ["title", "dueDate"]
    }
  },
  {
    name: "mark_task_completed",
    description: "Mark a task as completed or incomplete.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING },
        completed: { type: Type.BOOLEAN }
      },
      required: ["id", "completed"]
    }
  }
];

export async function processChatAction(message: string, history: any[], accessToken: string, confirmed: boolean = false) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("Missing API_KEY environment variable");

  const ai = new GoogleGenAI({ apiKey });
  const chat = ai.chats.create({
    model: "gemini-3-flash-preview",
    config: {
      systemInstruction: `You are Chronos, a calendar agent.
      Timezone: America/New_York. 
      Current Time: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}.
      
      RULES:
      1. When creating an event, if the user doesn't specify an end time or duration, provide the start time to the 'create_event' tool. The system will handle the prompt.
      2. When moving or updating an event's time, the system will intercept and ask for confirmation.
      3. Tasks MUST have a dueDate (YYYY-MM-DD). If not provided, ask the user. Ignore task times, only use dates.
      4. Always use Markdown for responses.`,
      tools: [{ functionDeclarations: calendarTools }]
    },
    history: history
  });

  let response = await chat.sendMessage({ message });
  
  if (response.functionCalls && response.functionCalls.length > 0) {
    const firstCall = response.functionCalls[0];

    // Intercept Create Event for Duration
    if (firstCall.name === "create_event") {
      const args = firstCall.args as any;
      if (!args.end || args.end === args.start) {
        return {
          text: "How long should this event be?",
          ui: {
            type: 'duration',
            options: [15, 30, 45, 60, 120, 180],
            pending: { action: 'create_event', args: args }
          }
        };
      }
    }

    // Intercept Move/Update Event for Confirmation (unless already confirmed)
    if (firstCall.name === "update_event" && !confirmed) {
      const args = firstCall.args as any;
      if (args.start || args.end) {
        return {
          text: `I'm ready to update that event. Should I proceed?`,
          ui: {
            type: 'confirm',
            action: 'update_event',
            pending: { action: 'update_event', args: args },
            message: `Update event "${args.summary || 'selected event'}" to ${args.start ? new Date(args.start).toLocaleString() : 'new time'}?`
          }
        };
      }
    }

    // Process Tools
    const functionResponseParts: Part[] = [];
    for (const call of response.functionCalls) {
      let apiResult: any;
      try {
        switch (call.name) {
          case "list_events":
            apiResult = await calendarService.getEvents(call.args.timeMin as string, call.args.timeMax as string, accessToken);
            break;
          case "create_event":
            apiResult = await calendarService.createEvent(call.args as any, accessToken);
            break;
          case "update_event":
            apiResult = await calendarService.updateEvent(call.args.id as string, call.args as any, accessToken);
            break;
          case "delete_event":
            await calendarService.deleteEvent(call.args.id as string, accessToken);
            apiResult = { status: "deleted" };
            break;
          case "list_tasks":
            apiResult = await calendarService.getTasks(accessToken);
            break;
          case "create_task":
            apiResult = await calendarService.createTask(call.args as any, accessToken);
            break;
          case "mark_task_completed":
            apiResult = await calendarService.updateTask(call.args.id as string, { completed: call.args.completed as boolean }, accessToken);
            break;
        }
      } catch (e: any) {
        apiResult = { error: e.message };
      }
      functionResponseParts.push({
        functionResponse: { name: call.name, response: { result: apiResult } }
      });
    }

    response = await chat.sendMessage({ message: functionResponseParts });
  }

  return { text: response.text };
}

export async function processTTSAction(text: string) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("Missing API_KEY environment variable");
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
