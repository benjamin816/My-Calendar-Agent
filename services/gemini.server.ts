
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
        end: { type: Type.STRING, description: "ISO date string for end time" },
        description: { type: Type.STRING, description: "Details about the event" }
      },
      required: ["summary", "start", "end"]
    }
  },
  {
    name: "update_event",
    description: "Update an existing calendar event.",
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
    description: "Add a new task to the task list.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: "Title of the task" },
        due: { type: Type.STRING, description: "Mandatory due date (ISO string at midnight or start of day)" }
      },
      required: ["title", "due"]
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

export async function processChatAction(message: string, history: any[], accessToken: string, clientContext?: string) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("Missing API_KEY environment variable");

  const ai = new GoogleGenAI({ apiKey });
  const chat = ai.chats.create({
    model: "gemini-3-flash-preview",
    config: {
      systemInstruction: `You are Chronos, a highly efficient calendar and task management agent. 
      Access to Google Calendar and Tasks is active.

      CORE RULES:
      1. TIMEZONE SENSITIVITY: Always use the user's local context provided: ${clientContext || new Date().toString()}.
      2. EVENT CREATION: When a user wants to schedule something:
         - Ask for the duration if not specified (default 1h). 
         - Explicitly mention the duration options: 15m, 30m, 45m, 1h, 2h, 3h.
      3. CONFIRMATION: Always ask "Is this correct?" before moving, deleting, or updating an event. Do not execute tool until confirmed.
      4. TASKS: Always demand a due date for tasks. Tasks are for whole days, events are for specific times. 
      5. PRECISION: If a user says "6 PM tomorrow", ensure the 'start' parameter is exactly 18:00 local time on that day.
      6. RESPONSE: Keep it snappy. No long introductions. Just "Scheduled [Event] for [Time]" or "Created task [Task] for [Date]".

      Format responses in Markdown.`,
      tools: [{ functionDeclarations: calendarTools }]
    },
    history: history
  });

  let response = await chat.sendMessage({ message });
  
  while (response.functionCalls && response.functionCalls.length > 0) {
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
            apiResult = { status: "deleted", id: call.args.id };
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
          default:
            apiResult = { error: "Unknown tool called" };
        }
      } catch (e: any) {
        apiResult = { error: e.message || "Operation failed" };
      }
      
      functionResponseParts.push({
        functionResponse: {
          name: call.name,
          response: { result: apiResult }
        }
      });
    }

    response = await chat.sendMessage({
      message: functionResponseParts
    });
  }

  return response.text;
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
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    },
  });

  return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
}
