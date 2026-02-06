import { GoogleGenAI, Type, FunctionDeclaration, Modality, Part, GenerateContentResponse } from "@google/genai";
import { calendarService } from "./calendar";

const calendarTools: FunctionDeclaration[] = [
  {
    name: "list_events",
    description: "Search/list calendar events.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        timeMin: { type: Type.STRING, description: "ISO string" },
        timeMax: { type: Type.STRING, description: "ISO string" }
      }
    }
  },
  {
    name: "create_event",
    description: "Create a new calendar event.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        summary: { type: Type.STRING, description: "Event title" },
        start: { type: Type.STRING, description: "Start time (local ISO)" },
        end: { type: Type.STRING, description: "End time (local ISO)" },
        description: { type: Type.STRING }
      },
      required: ["summary", "start"]
    }
  },
  {
    name: "update_event",
    description: "Modify an existing event. REQUIRES an 'id'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING },
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
      properties: {
        id: { type: Type.STRING }
      },
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
      properties: {
        id: { type: Type.STRING }
      },
      required: ["id"]
    }
  }
];

function asObject(x: unknown): Record<string, unknown> {
  if (x == null) return { ok: true };
  if (Array.isArray(x)) return { items: x };
  if (typeof x === "object") return x as Record<string, unknown>;
  return { value: x };
}

function extractModelText(response: GenerateContentResponse): string {
  if (response.text) return response.text;
  const parts = response.candidates?.[0]?.content?.parts || [];
  return parts.map(p => p.text || '').join('').trim();
}

export async function processChatAction(message: string, history: any[], accessToken: string, confirmed: boolean = false) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("Missing API_KEY");

  const ai = new GoogleGenAI({ apiKey });
  const currentNYTime = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

  const systemInstruction = `You are Chronos, a highly efficient calendar and task assistant.
  RULES:
  1. TIMEZONE: America/New_York.
  2. CURRENT TIME: ${currentNYTime}.
  3. TASKS: You can create, list, update (mark complete), and delete tasks.
  4. EVENTS: You can create, list, edit, and delete events.
  5. IDS: If the user refers to "it" or "that task", look at previous tool outputs in history to find the correct ID.`;

  const chat = ai.chats.create({
    model: "gemini-3-flash-preview",
    config: {
      systemInstruction,
      tools: [{ functionDeclarations: calendarTools }]
    },
    history: history.map(h => ({
      role: h.role === 'assistant' ? 'model' : h.role,
      parts: [{ text: h.content }]
    }))
  });

  const prompt = confirmed ? `[SYSTEM: Confirmed execution] ${message}` : message;
  let response = await chat.sendMessage({ message: prompt });
  
  if (response.functionCalls && response.functionCalls.length > 0) {
    const parts: Part[] = [];
    let lastTool = "";
    let lastRes: any = null;

    for (const call of response.functionCalls) {
      let result: any;
      lastTool = call.name;
      try {
        switch (call.name) {
          case "list_events": result = await calendarService.getEvents(call.args.timeMin as string, call.args.timeMax as string, accessToken); break;
          case "create_event": result = await calendarService.createEvent(call.args as any, accessToken); break;
          case "update_event": result = await calendarService.updateEvent(call.args.id as string, call.args as any, accessToken); break;
          case "delete_event": result = await calendarService.deleteEvent(call.args.id as string, accessToken); break;
          case "list_tasks": result = await calendarService.getTasks(accessToken); break;
          case "create_task": result = await calendarService.createTask(call.args as any, accessToken); break;
          case "update_task": result = await calendarService.updateTask(call.args.id as string, call.args as any, accessToken); break;
          case "delete_task": result = await calendarService.deleteTask(call.args.id as string, accessToken); break;
          default: result = { error: "Unknown tool" };
        }
      } catch (e: any) {
        result = { error: e.message };
      }
      lastRes = result;
      parts.push({ functionResponse: { name: call.name, response: asObject(result) } });
    }

    const finalResponse = await chat.sendMessage({ message: { role: 'user', parts } });
    let finalOutput = extractModelText(finalResponse);

    if (!finalOutput) {
      finalOutput = lastRes?.error ? `Error: ${lastRes.error}` : "Action completed successfully.";
    }

    return { text: finalOutput };
  }

  return { text: extractModelText(response) };
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