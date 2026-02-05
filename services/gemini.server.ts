
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
        due: { type: Type.STRING, description: "Optional due date (ISO string)" }
      },
      required: ["title"]
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

export async function processChatAction(message: string, history: any[], accessToken: string) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("Missing API_KEY environment variable");

  const ai = new GoogleGenAI({ apiKey });
  const chat = ai.chats.create({
    model: "gemini-3-flash-preview",
    config: {
      systemInstruction: `You are Chronos, a highly efficient calendar and task management agent. 
      You have direct access to the user's Google Calendar and Tasks.
      Always check for conflicting events before creating new ones.
      If a time is not provided for an event, ask the user. 
      Current Context: ${new Date().toString()}.
      Format your responses nicely using Markdown. Mention specific dates and times when confirming actions.`,
      tools: [{ functionDeclarations: calendarTools }]
    },
    history: history
  });

  // Initial message to the model
  let response = await chat.sendMessage({ message });
  
  // Handle sequential or parallel function calls
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
      
      // The response must be an object as per SDK requirements
      functionResponseParts.push({
        functionResponse: {
          name: call.name,
          response: { result: apiResult }
        }
      });
    }

    // Send results back to the model in the required array format
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
