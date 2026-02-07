
/**
 * Simple in-memory storage for pending Siri messages.
 * Since this runs in a server environment, these messages will persist 
 * until the process restarts or they are consumed by the client.
 */

interface PendingSiriMessage {
  text: string;
  timestamp: number;
}

let pendingMessages: PendingSiriMessage[] = [];

export const siriStorage = {
  push: (text: string) => {
    pendingMessages.push({ text, timestamp: Date.now() });
  },
  popAll: (): PendingSiriMessage[] => {
    const messages = [...pendingMessages];
    pendingMessages = [];
    return messages;
  }
};
