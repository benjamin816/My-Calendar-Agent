
import { GoogleGenAI, Type, FunctionDeclaration, Modality } from "@google/genai";
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
        summary: { type: Type.STRING },
        start: { type: Type.STRING, description: "ISO date string" },
        end: { type: Type.STRING, description: "ISO date string" },
        description: { type: Type.STRING }
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
    description: "Remove an event from the calendar.",
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
    description: "Get the current list of tasks."
  },
  {
    name: "create_task",
    description: "Add a new task to the task list.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        due: { type: Type.STRING }
      },
      required: ["title"]
    }
  }
];

export class ChronosBrain {
  private ai: any;
  private chat: any;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY || "" });
    this.chat = this.ai.chats.create({
      model: "gemini-3-flash-preview",
      config: {
        systemInstruction: `You are Chronos, a highly efficient calendar and task management agent. 
        You have direct access to the user's calendar and tasks.
        When a user asks to do something, check their schedule if needed. 
        You can perform multiple actions at once (e.g., "Schedule a meeting and add a task").
        Today is ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}.
        Be concise, friendly, and helpful. If a time is ambiguous, ask for clarification.`,
        tools: [{ functionDeclarations: calendarTools }]
      }
    });
  }

  async processMessage(message: string, onUpdate: () => void) {
    let response = await this.chat.sendMessage({ message });
    
    // Handle function calls
    while (response.functionCalls && response.functionCalls.length > 0) {
      const toolResults = [];
      
      for (const call of response.functionCalls) {
        let result: any = "Success";
        try {
          switch (call.name) {
            case "list_events":
              result = await calendarService.getEvents();
              break;
            case "create_event":
              result = await calendarService.createEvent(call.args as any);
              break;
            case "update_event":
              result = await calendarService.updateEvent(call.args.id as string, call.args);
              break;
            case "delete_event":
              await calendarService.deleteEvent(call.args.id as string);
              break;
            case "list_tasks":
              result = await calendarService.getTasks();
              break;
            case "create_task":
              result = await calendarService.createTask(call.args as any);
              break;
          }
        } catch (e: any) {
          result = `Error: ${e.message}`;
        }
        
        toolResults.push({
          id: call.id,
          name: call.name,
          response: { result }
        });
      }

      onUpdate(); // Trigger UI refresh after actions

      // Send responses back to model
      response = await this.chat.sendMessage({
        toolResponses: { functionResponses: toolResults }
      });
    }

    return response.text;
  }

  async generateSpeech(text: string): Promise<string | null> {
    try {
      const speechAi = new GoogleGenAI({ apiKey: process.env.API_KEY || "" });
      const response = await speechAi.models.generateContent({
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
    } catch (e) {
      console.error("Speech generation failed", e);
      return null;
    }
  }
}

// Audio helpers
export const decodeAudio = (base64: string) => {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

export const playPcmAudio = async (data: Uint8Array) => {
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  const dataInt16 = new Int16Array(data.buffer);
  const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
  const channelData = buffer.getChannelData(0);
  for (let i = 0; i < dataInt16.length; i++) {
    channelData[i] = dataInt16[i] / 32768.0;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
};
