
import { GoogleGenAI, Type, FunctionDeclaration, Modality, Part } from "@google/genai";
import { calendarService } from "./calendar";

const calendarTools: FunctionDeclaration[] = [
  {
    name: "list_events",
    description: "Search/list events for a specific time range. Use this to find IDs before updating or deleting.",
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
        end: { type: Type.STRING, description: "ISO date string for end time." },
        description: { type: Type.STRING, description: "Details about the event" }
      },
      required: ["summary", "start"]
    }
  },
  {
    name: "update_event",
    description: "Update an existing calendar event (reschedule, rename, or change details).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING, description: "Unique ID of the event to update (Mandatory)" },
        summary: { type: Type.STRING, description: "New title" },
        start: { type: Type.STRING, description: "New start time" },
        end: { type: Type.STRING, description: "New end time" },
        description: { type: Type.STRING, description: "New description" }
      },
      required: ["id"]
    }
  },
  {
    name: "delete_event",
    description: "Permanently remove an event from the calendar.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING, description: "Unique ID of the event to remove (Mandatory)" }
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
    description: "Add a new task. Requires a date.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: "Title of the task" },
        dueDate: { type: Type.STRING, description: "Due date (YYYY-MM-DD)" }
      },
      required: ["title", "dueDate"]
    }
  },
  {
    name: "mark_task_completed",
    description: "Complete or uncomplete a task.",
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
      Timezone: America/New_York (All user times are in this timezone).
      Current Time: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}.
      
      BEHAVIOR RULES:
      1. RESCHEDULING/ALTERING: Always search for events first using 'list_events' to find the correct 'id'. Then use 'update_event'.
      2. DELETING: Always search for the event first to get the 'id'. Use 'delete_event' for removals.
      3. DURATION: If a user creates an event without an end time, the system will prompt them via UI.
      4. CONFIRMATION: The system intercepts updates and deletions for confirmation. 
      5. FORMAT: Use Markdown for all text responses. Mention events clearly.`,
      tools: [{ functionDeclarations: calendarTools }]
    },
    history: history
  });

  let response = await chat.sendMessage({ message });
  
  if (response.functionCalls && response.functionCalls.length > 0) {
    const firstCall = response.functionCalls[0];

    // Intercept Create Event for Duration
    if (firstCall.name === "create_event" && !confirmed) {
      const args = firstCall.args as any;
      if (!args.end || args.end === args.start) {
        return {
          text: "I need an end time for that event. How long should it be?",
          ui: {
            type: 'duration',
            options: [15, 30, 45, 60, 90, 120],
            pending: { action: 'create_event', args: args }
          }
        };
      }
    }

    // Intercept Update for Confirmation
    if (firstCall.name === "update_event" && !confirmed) {
      const args = firstCall.args as any;
      return {
        text: `I've found the event. Ready to apply those changes?`,
        ui: {
          type: 'confirm',
          action: 'update_event',
          pending: { action: 'update_event', args: args },
          message: `Update event ${args.summary ? `to "${args.summary}"` : ''} ${args.start ? `at ${new Date(args.start).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}` : ''}?`
        }
      };
    }

    // Intercept Delete for Confirmation
    if (firstCall.name === "delete_event" && !confirmed) {
      const args = firstCall.args as any;
      return {
        text: "Are you sure you want to remove this event?",
        ui: {
          type: 'confirm',
          action: 'delete_event',
          pending: { action: 'delete_event', args: args },
          message: `Permanently delete the selected event?`
        }
      };
    }

    // Execute Tools
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
            apiResult = { status: "deleted successfully" };
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
