
export class ChronosBrain {
  async processMessage(
    message: string, 
    onUpdate: () => void, 
    accessToken: string, 
    history: any[] = [], 
    confirmed: boolean = false,
    source: 'web' | 'siri' = 'web'
  ) {
    const response = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'chat',
        payload: { message, accessToken, confirmed, history, source }
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to process message');
    }

    const data = await response.json();
    onUpdate(); 
    return data;
  }

  async generateSpeech(text: string): Promise<string | null> {
    const response = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'tts',
        payload: { text }
      })
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.result;
  }
}

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