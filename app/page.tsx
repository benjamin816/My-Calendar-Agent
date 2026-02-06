
"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSession, signIn, signOut } from "next-auth/react";
import { CalendarEvent, CalendarTask, ChatMessage, CalendarViewType } from '../types';
import { calendarService, setCalendarToken } from '../services/calendar';
import { ChronosBrain, decodeAudio, playPcmAudio } from '../services/gemini.client';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, addDays, isSameDay, parseISO, addMinutes } from 'date-fns';
import { 
  CalendarIcon, 
  ChatBubbleLeftRightIcon, 
  MicrophoneIcon, 
  StopIcon, 
  PlusIcon, 
  ChevronLeftIcon, 
  ChevronRightIcon,
  ArrowPathIcon,
  CheckIcon,
  BellIcon,
  Cog6ToothIcon,
  Squares2X2Icon,
  ListBulletIcon,
  PaperAirplaneIcon,
  ArrowLeftOnRectangleIcon,
  XMarkIcon,
  ClockIcon,
  TrashIcon
} from '@heroicons/react/24/outline';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function ChronosApp() {
  const { data: session, status } = useSession();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [activeTab, setActiveTab] = useState<'calendar' | 'tasks' | 'settings'>('calendar');

  const brainRef = useRef<ChronosBrain | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    brainRef.current = new ChronosBrain();
    if (typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        handleSendMessage(transcript, true);
      };
      recognitionRef.current.onend = () => setIsListening(false);
    }
  }, []);

  const refreshData = useCallback(async () => {
    if (!session?.accessToken) return;
    try {
      setCalendarToken(session.accessToken as string);
      const [evs, tks] = await Promise.all([
        calendarService.getEvents(undefined, undefined, session.accessToken as string),
        calendarService.getTasks(session.accessToken as string)
      ]);
      setEvents(evs);
      setTasks(tks);
    } catch (e: any) {
      console.error("Data refresh failed:", e);
      if (e.message === 'AUTH_EXPIRED') signIn('google');
    }
  }, [session]);

  useEffect(() => {
    if (status === 'authenticated') refreshData();
  }, [status, refreshData]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (text?: string, voice: boolean = false, confirmed: boolean = false) => {
    const msg = text || inputText;
    if (!msg.trim() && !confirmed) return;

    if (!confirmed) {
      const userMsg: ChatMessage = {
        id: Date.now().toString(),
        role: 'user',
        content: msg,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, userMsg]);
    }

    setInputText('');
    setIsProcessing(true);

    try {
      const result = await brainRef.current?.processMessage(msg, refreshData, session?.accessToken as string, confirmed);
      if (result) {
        const assistantMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: result.text,
          timestamp: new Date(),
          ui: result.ui
        };
        setMessages(prev => [...prev, assistantMsg]);
        if (voice && result.text) {
          const audioBase64 = await brainRef.current?.generateSpeech(result.text);
          if (audioBase64) playPcmAudio(decodeAudio(audioBase64));
        }
      }
    } catch (error: any) {
      console.error(error);
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', content: `Error: ${error.message}`, timestamp: new Date() }]);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDurationSelection = (mins: number, pending: any) => {
    const start = new Date(pending.args.start);
    const end = addMinutes(start, mins).toISOString();
    const newMsg = `Proceed with creating "${pending.args.summary}" starting at ${pending.args.start} and ending at ${end} (Duration: ${mins} minutes).`;
    handleSendMessage(newMsg);
  };

  const handlePickEvent = (event: CalendarEvent, pending: any) => {
    const newArgs = { ...pending.args, id: event.id, summary: event.summary };
    const confirmationText = `Selected event "${event.summary}" (${event.id}). Proceed with ${pending.action}: ${JSON.stringify(newArgs)}`;
    handleSendMessage(confirmationText, false, true);
  };

  const handleConfirmedAction = (pending: any) => {
    const confirmationText = `Executing ${pending.action}: ${JSON.stringify(pending.args)}`;
    handleSendMessage(confirmationText, false, true);
  };

  const toggleListening = () => {
    if (isListening) recognitionRef.current?.stop();
    else { recognitionRef.current?.start(); setIsListening(true); }
  };

  const weekDays = useMemo(() => {
    const start = startOfWeek(currentDate);
    const end = endOfWeek(currentDate);
    return eachDayOfInterval({ start, end });
  }, [currentDate]);

  const getEventsForDay = (day: Date) => {
    return events.filter(e => isSameDay(parseISO(e.start), day)).sort((a, b) => parseISO(a.start).getTime() - parseISO(b.start).getTime());
  };

  const toggleTask = async (task: CalendarTask) => {
    if (!session?.accessToken) return;
    try {
      await calendarService.updateTask(task.id, { completed: !task.completed }, session.accessToken as string);
      refreshData();
    } catch (e) { console.error(e); }
  };

  if (status === "loading") {
    return (
      <div className="h-screen flex items-center justify-center bg-[#f8fafc]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-500 font-bold animate-pulse">Syncing with Chronos...</p>
        </div>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="h-screen flex items-center justify-center bg-[#f8fafc] p-6">
        <div className="max-w-md w-full bg-white p-12 rounded-[2.5rem] shadow-2xl border border-slate-100 text-center space-y-8 animate-in fade-in zoom-in duration-500">
          <div className="w-24 h-24 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-3xl flex items-center justify-center text-white text-5xl font-bold mx-auto shadow-2xl rotate-3">C</div>
          <div className="space-y-2">
            <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">Chronos AI</h1>
            <p className="text-slate-500 font-medium">Your schedule, simplified by intelligence.</p>
          </div>
          <button onClick={() => signIn('google')} className="w-full bg-slate-900 text-white py-4 px-6 rounded-2xl font-bold hover:bg-slate-800 transition-all flex items-center justify-center gap-3 shadow-lg hover:shadow-xl active:scale-95">
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#f8fafc] font-sans text-slate-900 overflow-hidden">
      <aside className="w-20 lg:w-64 bg-white border-r border-slate-200 flex flex-col p-4 space-y-8 transition-all">
        <div className="flex items-center gap-4 px-2">
          <div className="w-10 h-10 min-w-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-lg">C</div>
          <span className="font-bold text-xl hidden lg:block tracking-tight">Chronos AI</span>
        </div>
        <nav className="flex-1 space-y-1">
          <SidebarItem icon={<Squares2X2Icon className="w-6 h-6" />} label="Dashboard" active={activeTab === 'calendar'} onClick={() => setActiveTab('calendar')} />
          <SidebarItem icon={<ListBulletIcon className="w-6 h-6" />} label="Tasks" active={activeTab === 'tasks'} onClick={() => setActiveTab('tasks')} />
          <SidebarItem icon={<Cog6ToothIcon className="w-6 h-6" />} label="Settings" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
        </nav>
        <div className="px-2 pb-4">
          <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-100">
            {session?.user?.image ? (
              <img src={session.user.image} className="w-8 h-8 rounded-full shadow-sm" alt="User" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-orange-400 to-rose-400 shadow-sm" />
            )}
            <div className="hidden lg:block overflow-hidden"><p className="text-sm font-bold truncate">{session?.user?.name || 'User'}</p></div>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-0">
        <header className="h-20 flex items-center justify-between px-8 bg-white border-b border-slate-200">
          <div className="flex items-center gap-6">
             <div className="flex items-center gap-2">
                <button onClick={() => setCurrentDate(addDays(currentDate, -7))} className="p-2 hover:bg-slate-100 rounded-xl transition-colors text-slate-400"><ChevronLeftIcon className="w-5 h-5"/></button>
                <button onClick={() => setCurrentDate(addDays(currentDate, 7))} className="p-2 hover:bg-slate-100 rounded-xl transition-colors text-slate-400"><ChevronRightIcon className="w-5 h-5"/></button>
             </div>
             <h2 className="text-2xl font-bold tracking-tight">{format(currentDate, 'MMMM yyyy')}</h2>
          </div>
          <button onClick={refreshData} className="p-2.5 hover:bg-slate-100 rounded-xl transition-colors text-slate-500 group"><ArrowPathIcon className={cn("w-5 h-5", isProcessing && "animate-spin")} /></button>
        </header>

        <main className="flex-1 overflow-hidden flex flex-col p-6 space-y-6">
          {activeTab === 'calendar' && (
            <div className="flex-1 bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
              <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/50">
                {weekDays.map(day => (
                  <div key={day.toISOString()} className="flex flex-col items-center justify-center py-3 border-l first:border-l-0 border-slate-100">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{format(day, 'EEE')}</span>
                    <span className={cn("text-lg font-bold mt-1 h-8 w-8 flex items-center justify-center rounded-full", isSameDay(day, new Date()) ? "bg-blue-600 text-white" : "text-slate-800")}>{format(day, 'd')}</span>
                  </div>
                ))}
              </div>
              <div className="flex-1 grid grid-cols-7 overflow-hidden">
                {weekDays.map(day => {
                  const dayEvents = getEventsForDay(day);
                  return (
                    <div key={day.toISOString()} className="border-l first:border-l-0 border-slate-100 p-3 space-y-3 overflow-y-auto custom-scrollbar bg-slate-50/10">
                      {dayEvents.map(e => (
                        <div key={e.id} className="bg-white border border-slate-200 p-3 rounded-2xl shadow-sm hover:shadow-md transition-all cursor-pointer group">
                          <p className="text-xs font-bold text-slate-900 leading-tight group-hover:text-blue-600 transition-colors">{e.summary}</p>
                          <div className="flex items-center gap-1.5 mt-2">
                            <ClockIcon className="w-3 h-3 text-slate-400" />
                            <p className="text-[10px] text-slate-500 font-medium">
                              {e.isAllDay ? 'All-day' : `${format(parseISO(e.start), 'h:mm a')} - ${format(parseISO(e.end), 'h:mm a')}`}
                            </p>
                          </div>
                        </div>
                      ))}
                      {dayEvents.length === 0 && <div className="h-full flex items-center justify-center"><p className="text-[10px] text-slate-300 font-bold uppercase tracking-widest rotate-90">Empty</p></div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'tasks' && (
            <div className="flex-1 bg-white rounded-3xl border border-slate-200 shadow-sm overflow-y-auto p-8 custom-scrollbar">
              <div className="max-w-2xl mx-auto space-y-6">
                <h3 className="text-2xl font-bold flex items-center gap-3"><ListBulletIcon className="w-7 h-7 text-blue-600" />My Tasks</h3>
                <div className="space-y-3">
                  {tasks.map(task => (
                    <div key={task.id} className={cn("flex items-center justify-between p-4 rounded-2xl border cursor-pointer", task.completed ? "bg-slate-50 border-slate-100 opacity-60" : "bg-white border-slate-200 hover:border-blue-400")} onClick={() => toggleTask(task)}>
                      <div className="flex items-center gap-4">
                        <div className={cn("w-6 h-6 rounded-full border-2 flex items-center justify-center", task.completed ? "bg-green-500 border-green-500" : "border-slate-300")}>{task.completed && <CheckIcon className="w-3 h-3 text-white" />}</div>
                        <div>
                          <p className={cn("font-bold", task.completed && "line-through text-slate-400")}>{task.title}</p>
                          {task.due && <p className="text-xs text-slate-400 font-medium mt-0.5">Due {format(parseISO(task.due), 'MMM d')}</p>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
             <div className="flex-1 bg-white rounded-3xl border border-slate-200 shadow-sm p-8 max-w-2xl mx-auto w-full">
                <h3 className="text-xl font-bold border-b pb-4 mb-6">Account Settings</h3>
                <button onClick={() => signOut()} className="w-full flex items-center justify-between p-4 bg-red-50 text-red-600 rounded-2xl font-bold hover:bg-red-100 transition-colors">
                  <span>Sign Out of Chronos AI</span>
                  <ArrowLeftOnRectangleIcon className="w-5 h-5" />
                </button>
             </div>
          )}
        </main>
      </div>

      <div className="w-[400px] bg-white border-l border-slate-200 flex flex-col shadow-xl z-20">
        <header className="h-20 flex items-center px-8 border-b border-slate-100">
          <ChatBubbleLeftRightIcon className="w-5 h-5 text-blue-600 mr-2" />
          <h3 className="font-extrabold text-lg">Chronos Brain</h3>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
          {messages.map((m) => (
            <div key={m.id} className={cn("flex flex-col", m.role === 'user' ? 'items-end' : 'items-start')}>
              <div className={cn("max-w-[90%] p-4 rounded-2xl text-sm shadow-sm", m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-50 text-slate-800')}>
                {m.content}
                {m.ui?.type === 'duration' && (
                  <div className="mt-4 p-3 bg-white rounded-xl border border-blue-100 space-y-3">
                    <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mb-2">Select Duration</p>
                    <div className="grid grid-cols-3 gap-2">
                      {m.ui.options?.map(mins => (
                        <button key={mins} onClick={() => handleDurationSelection(mins, m.ui?.pending)} className="py-2 text-xs font-bold border border-slate-100 rounded-lg hover:bg-blue-50 hover:text-blue-600 transition-all">{mins}m</button>
                      ))}
                    </div>
                  </div>
                )}
                {m.ui?.type === 'pick' && (
                  <div className="mt-4 p-3 bg-white rounded-xl border border-indigo-100 space-y-2">
                    <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest mb-2">Which Event?</p>
                    <div className="space-y-1 max-h-48 overflow-y-auto custom-scrollbar">
                      {m.ui.options?.map((ev: CalendarEvent) => (
                        <button key={ev.id} onClick={() => handlePickEvent(ev, m.ui?.pending)} className="w-full text-left p-2 text-xs border border-slate-50 rounded-lg hover:bg-indigo-50 transition-all">
                          <p className="font-bold text-slate-800 truncate">{ev.summary}</p>
                          <p className="text-[10px] text-slate-400">{format(parseISO(ev.start), 'MMM d, h:mm a')}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {m.ui?.type === 'confirm' && (
                  <div className={cn("mt-4 p-4 rounded-xl border shadow-sm space-y-3", m.ui.action === 'delete_event' ? 'bg-red-50 border-red-100' : 'bg-white border-amber-100')}>
                    <div className="flex items-center gap-2">
                      {m.ui.action === 'delete_event' ? <TrashIcon className="w-4 h-4 text-red-600" /> : <ClockIcon className="w-4 h-4 text-amber-600" />}
                      <p className={cn("text-xs font-bold", m.ui.action === 'delete_event' ? 'text-red-700' : 'text-amber-700')}>{m.ui.message}</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handleConfirmedAction(m.ui?.pending)} className={cn("flex-1 py-2 rounded-lg text-xs font-bold text-white transition-all shadow-sm active:scale-95", m.ui.action === 'delete_event' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700')}>Confirm</button>
                      <button onClick={() => setMessages(prev => prev.filter(msg => msg.id !== m.id))} className="flex-1 bg-slate-100 text-slate-600 py-2 rounded-lg text-xs font-bold hover:bg-slate-200">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
              <span className="text-[10px] text-slate-300 font-bold mt-1 px-1">{format(m.timestamp, 'h:mm a')}</span>
            </div>
          ))}
          {isProcessing && <div className="flex gap-1 p-2"><div className="w-1 h-1 bg-slate-300 rounded-full animate-bounce" /><div className="w-1 h-1 bg-slate-300 rounded-full animate-bounce [animation-delay:0.2s]" /><div className="w-1 h-1 bg-slate-300 rounded-full animate-bounce [animation-delay:0.4s]" /></div>}
          <div ref={chatEndRef} />
        </div>

        <div className="p-6 border-t border-slate-100">
          <div className="relative">
            <input value={inputText} onChange={e => setInputText(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendMessage()} placeholder="Ask Chronos..." className="w-full bg-slate-50 border-none rounded-2xl pl-5 pr-20 py-4 text-sm font-medium focus:ring-2 focus:ring-blue-500 shadow-inner" />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
              <button onClick={toggleListening} className={cn("p-2 rounded-xl transition-all", isListening ? 'bg-red-500 text-white' : 'text-slate-400 hover:text-blue-600')}>{isListening ? <StopIcon className="w-5 h-5" /> : <MicrophoneIcon className="w-5 h-5" />}</button>
              <button onClick={() => handleSendMessage()} disabled={!inputText.trim()} className="p-2 bg-blue-600 text-white rounded-xl disabled:opacity-50"><PaperAirplaneIcon className="w-5 h-5" /></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SidebarItem({ icon, label, active = false, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick?: () => void }) {
  return (
    <button onClick={onClick} className={cn("w-full flex items-center gap-4 p-4 rounded-2xl transition-all group relative", active ? "bg-blue-50 text-blue-600 font-bold" : "text-slate-400 hover:bg-slate-50 hover:text-slate-600")}>
      {icon}
      <span className="hidden lg:block text-sm tracking-tight">{label}</span>
      {active && <div className="absolute right-2 w-1.5 h-1.5 bg-blue-600 rounded-full" />}
    </button>
  );
}
