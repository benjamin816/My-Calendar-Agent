
"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CalendarEvent, CalendarTask, ChatMessage, CalendarViewType } from '../types';
import { calendarService, setCalendarToken } from '../services/calendar';
import { ChronosBrain, decodeAudio, playPcmAudio } from '../services/gemini';
import { 
  CalendarIcon, 
  ChatBubbleLeftRightIcon, 
  CheckCircleIcon, 
  MicrophoneIcon, 
  StopIcon, 
  PlusIcon, 
  ChevronLeftIcon, 
  ChevronRightIcon,
  ArrowRightOnRectangleIcon,
  UserCircleIcon,
  InformationCircleIcon
} from '@heroicons/react/24/outline';

export default function ChronosApp() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [viewType, setViewType] = useState<CalendarViewType>(CalendarViewType.WEEK);
  const [currentDate, setCurrentDate] = useState(new Date());

  const brainRef = useRef<ChronosBrain | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  // Initialize Chronos Brain
  useEffect(() => {
    brainRef.current = new ChronosBrain();
    
    // Auth from localStorage for this simple implementation
    const savedToken = localStorage.getItem('google_calendar_token');
    if (savedToken) {
      setToken(savedToken);
      setCalendarToken(savedToken);
    }

    if (typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        handleSendMessage(transcript);
      };
      recognitionRef.current.onend = () => setIsListening(false);
    }
  }, []);

  const refreshData = useCallback(async () => {
    if (!token) return;
    try {
      const [evs, tks] = await Promise.all([
        calendarService.getEvents(),
        calendarService.getTasks()
      ]);
      setEvents(evs);
      setTasks(tks);
    } catch (e: any) {
      console.error(e);
    }
  }, [token]);

  useEffect(() => {
    if (token) refreshData();
  }, [token, refreshData]);

  const handleSendMessage = async (text?: string) => {
    const messageToSend = text || inputText;
    if (!messageToSend.trim()) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: messageToSend,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setIsProcessing(true);

    try {
      const responseText = await brainRef.current?.processMessage(messageToSend, refreshData);
      if (responseText) {
        const assistantMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: responseText,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, assistantMsg]);
        
        if (text) {
          const audioBase64 = await brainRef.current?.generateSpeech(responseText);
          if (audioBase64) {
            const bytes = decodeAudio(audioBase64);
            playPcmAudio(bytes);
          }
        }
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      recognitionRef.current?.start();
      setIsListening(true);
    }
  };

  if (!token) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md w-full bg-white p-10 rounded-3xl shadow-xl text-center space-y-6">
          <div className="w-20 h-20 bg-blue-600 rounded-2xl flex items-center justify-center text-white text-4xl font-bold mx-auto shadow-lg">C</div>
          <div>
            <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Chronos AI</h1>
            <p className="text-slate-500 mt-2">Log in via the Google Identity Service to begin.</p>
          </div>
          <p className="text-xs text-slate-400">Please set up your Google OAuth credentials in the Google Cloud Console and use the local storage token bridge for this demo.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Main UI remains functionally identical but optimized for Next.js */}
      <div className="flex-1 flex flex-col min-w-0 border-r border-slate-200">
        <header className="h-16 flex items-center justify-between px-6 bg-white border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold">C</div>
            <h1 className="text-xl font-bold tracking-tight text-slate-800">Chronos AI</h1>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setCurrentDate(new Date(currentDate.setDate(currentDate.getDate() - 7)))} className="p-1 hover:bg-slate-100 rounded-full"><ChevronLeftIcon className="w-5 h-5"/></button>
            <span className="text-sm font-bold mx-2">{currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
            <button onClick={() => setCurrentDate(new Date(currentDate.setDate(currentDate.getDate() + 7)))} className="p-1 hover:bg-slate-100 rounded-full"><ChevronRightIcon className="w-5 h-5"/></button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6 custom-scrollbar">
           <div className="grid grid-cols-7 gap-4">
             {/* Calendar Grid Logic Simplified for Next.js View */}
             {events.slice(0, 10).map(e => (
               <div key={e.id} className="bg-blue-600 text-white p-2 rounded-lg text-xs font-bold truncate">
                 {e.summary}
               </div>
             ))}
           </div>
        </main>
      </div>

      <div className="w-96 bg-white flex flex-col shadow-2xl z-10 border-l border-slate-200">
        <div className="h-16 flex items-center px-6 border-b border-slate-100">
          <ChatBubbleLeftRightIcon className="w-6 h-6 text-blue-600 mr-2" />
          <h2 className="font-bold">Chronos Brain</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] p-3 rounded-2xl text-sm ${m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-800'}`}>
                {m.content}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        <div className="p-6 border-t border-slate-100">
          <div className="flex gap-2">
            <input 
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
              placeholder="Talk to Chronos..."
              className="flex-1 bg-slate-50 border-none rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500"
            />
            <button onClick={toggleListening} className={`p-2 rounded-xl ${isListening ? 'bg-red-500 text-white' : 'bg-slate-200 text-slate-600'}`}>
              <MicrophoneIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
