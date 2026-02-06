
"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSession, signIn, signOut } from "next-auth/react";
import { CalendarEvent, CalendarTask, ChatMessage } from '../types';
import { calendarService, setCalendarToken } from '../services/calendar';
import { ChronosBrain, decodeAudio, playPcmAudio } from '../services/gemini.client';
import { format, eachDayOfInterval, addDays, isSameDay, parseISO, addMinutes, startOfDay, endOfDay, isWithinInterval } from 'date-fns';
import { 
  ChatBubbleLeftRightIcon, 
  MicrophoneIcon, 
  StopIcon, 
  ChevronLeftIcon, 
  ChevronRightIcon,
  ArrowPathIcon,
  CheckIcon,
  Cog6ToothIcon,
  Squares2X2Icon,
  ListBulletIcon,
  PaperAirplaneIcon,
  ArrowLeftOnRectangleIcon,
  ClockIcon,
  TrashIcon,
  SparklesIcon,
  CalendarDaysIcon
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
      // Fetch a bit more range than just 3 days to ensure multi-day events spanning into current window are caught
      const timeMin = startOfDay(addDays(currentDate, -7)).toISOString();
      const timeMax = endOfDay(addDays(currentDate, 14)).toISOString();
      const [evs, tks] = await Promise.all([
        calendarService.getEvents(timeMin, timeMax, session.accessToken as string),
        calendarService.getTasks(session.accessToken as string)
      ]);
      setEvents(evs);
      setTasks(tks);
    } catch (e: any) {
      console.error("Data refresh failed:", e);
      if (e.message === 'AUTH_EXPIRED') signIn('google');
    }
  }, [session, currentDate]);

  useEffect(() => {
    if (status === 'authenticated') refreshData();
  }, [status, refreshData]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (text?: string, voice: boolean = false, confirmed: boolean = false) => {
    const msg = text || inputText;
    if (!msg.trim() && !confirmed) return;

    let currentHistory = [...messages];

    if (!confirmed) {
      const userMsg: ChatMessage = {
        id: Date.now().toString(),
        role: 'user',
        content: msg,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, userMsg]);
      currentHistory.push(userMsg);
    }

    setInputText('');
    setIsProcessing(true);

    try {
      const result = await brainRef.current?.processMessage(
        msg, 
        refreshData, 
        session?.accessToken as string, 
        currentHistory,
        confirmed
      );
      
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
      refreshData();
    }
  };

  const handleDurationSelection = (mins: number, pending: any) => {
    const startStr = pending.args.start;
    const endStr = format(addMinutes(parseISO(startStr), mins), "yyyy-MM-dd'T'HH:mm:ss");
    const confirmationText = `Executing create_event: ${JSON.stringify({ ...pending.args, end: endStr })}`;
    handleSendMessage(confirmationText, false, true);
  };

  const handlePickEvent = (event: CalendarEvent, pending: any) => {
    const newArgs = { ...pending.args, id: event.id, summary: event.summary };
    const text = `I'm selecting "${event.summary}" for this action. Args: ${JSON.stringify(newArgs)}`;
    handleSendMessage(text, false, false);
  };

  const handleConfirmedAction = (pending: any) => {
    const confirmationText = `Executing ${pending.action}: ${JSON.stringify(pending.args)}`;
    handleSendMessage(confirmationText, false, true);
  };

  const toggleListening = () => {
    if (isListening) recognitionRef.current?.stop();
    else { recognitionRef.current?.start(); setIsListening(true); }
  };

  const displayDays = useMemo(() => {
    const start = startOfDay(currentDate);
    const end = endOfDay(addDays(start, 2));
    return eachDayOfInterval({ start, end });
  }, [currentDate]);

  const getEventsForDay = (day: Date) => {
    const dayStart = startOfDay(day);
    const dayEnd = endOfDay(day);
    
    return events.filter(e => {
      const eStart = parseISO(e.start);
      const eEnd = parseISO(e.end);
      
      // Check if event overlaps with the given day
      // Overlap condition: (Event Start <= Day End) AND (Event End >= Day Start)
      return eStart <= dayEnd && eEnd >= dayStart;
    }).sort((a, b) => parseISO(a.start).getTime() - parseISO(b.start).getTime());
  };

  const toggleTask = async (task: CalendarTask) => {
    if (!session?.accessToken || isProcessing) return;
    setIsProcessing(true);
    try {
      await calendarService.updateTask(task.id, { completed: !task.completed }, session.accessToken as string);
      await refreshData();
    } catch (e) { console.error(e); }
    finally { setIsProcessing(false); }
  };

  if (status === "loading") {
    return (
      <div className="h-screen flex items-center justify-center bg-[#f8fafc]">
        <div className="flex flex-col items-center gap-4">
          <SparklesIcon className="w-12 h-12 text-blue-600 animate-bounce" />
          <p className="text-slate-500 font-bold">Synchronizing Time...</p>
        </div>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="h-screen flex items-center justify-center bg-[#f8fafc] p-6">
        <div className="max-w-md w-full bg-white p-12 rounded-[2.5rem] shadow-2xl border border-slate-100 text-center space-y-8">
          <div className="w-24 h-24 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-3xl flex items-center justify-center text-white text-5xl font-bold mx-auto shadow-2xl rotate-3">C</div>
          <div className="space-y-2">
            <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">Chronos AI</h1>
            <p className="text-slate-500 font-medium">Your schedule, simplified by intelligence.</p>
          </div>
          <button onClick={() => signIn('google')} className="w-full bg-slate-900 text-white py-4 px-6 rounded-2xl font-bold hover:bg-slate-800 transition-all flex items-center justify-center gap-3 shadow-lg active:scale-95">
            Get Started with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#f8fafc] font-sans text-slate-900 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-20 lg:w-64 bg-white border-r border-slate-200 flex flex-col p-4 space-y-8">
        <div className="flex items-center gap-4 px-2">
          <div className="w-10 h-10 min-w-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-lg">C</div>
          <span className="font-bold text-xl hidden lg:block tracking-tight">Chronos AI</span>
        </div>
        <nav className="flex-1 space-y-1">
          <SidebarItem icon={<Squares2X2Icon className="w-6 h-6" />} label="Schedule" active={activeTab === 'calendar'} onClick={() => setActiveTab('calendar')} />
          <SidebarItem icon={<ListBulletIcon className="w-6 h-6" />} label="Tasks" active={activeTab === 'tasks'} onClick={() => setActiveTab('tasks')} />
          <SidebarItem icon={<Cog6ToothIcon className="w-6 h-6" />} label="Account" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
        </nav>
        <div className="px-2 pb-4">
          <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-100 overflow-hidden">
            {session?.user?.image ? (
              <img src={session.user.image} className="w-8 h-8 rounded-full shadow-sm" alt="User" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-slate-300 shadow-sm" />
            )}
            <div className="hidden lg:block overflow-hidden flex-1"><p className="text-sm font-bold truncate">{session?.user?.name}</p></div>
          </div>
        </div>
      </aside>

      {/* Main Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-20 flex items-center justify-between px-8 bg-white border-b border-slate-200">
          <div className="flex items-center gap-6">
             <div className="flex items-center gap-2">
                <button onClick={() => setCurrentDate(prev => addDays(prev, -3))} className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 transition-colors"><ChevronLeftIcon className="w-5 h-5"/></button>
                <button onClick={() => setCurrentDate(new Date())} className="px-4 py-1.5 text-xs font-bold bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors">Today</button>
                <button onClick={() => setCurrentDate(prev => addDays(prev, 3))} className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 transition-colors"><ChevronRightIcon className="w-5 h-5"/></button>
             </div>
             <h2 className="text-2xl font-black tracking-tight text-slate-900">{format(currentDate, 'MMMM yyyy')}</h2>
          </div>
          <button onClick={refreshData} className="p-2.5 hover:bg-slate-100 rounded-xl text-slate-500 transition-all active:rotate-180">
            <ArrowPathIcon className={cn("w-5 h-5", isProcessing && "animate-spin")} />
          </button>
        </header>

        <main className="flex-1 overflow-hidden flex flex-col p-6 space-y-6">
          {activeTab === 'calendar' && (
            <div className="flex-1 bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
              <div className="grid grid-cols-3 border-b border-slate-100 bg-slate-50/30">
                {displayDays.map(day => (
                  <div key={day.toISOString()} className="flex flex-col items-center justify-center py-4 border-l first:border-l-0 border-slate-100">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{format(day, 'EEEE')}</span>
                    <div className="flex items-center gap-3 mt-1">
                      <span className={cn("text-lg font-black h-10 w-10 flex items-center justify-center rounded-xl transition-all", isSameDay(day, new Date()) ? "bg-blue-600 text-white shadow-lg shadow-blue-200" : "text-slate-800")}>{format(day, 'd')}</span>
                      {isSameDay(day, new Date()) && <span className="text-[10px] font-black uppercase text-blue-600 tracking-tighter bg-blue-50 px-2 py-0.5 rounded-full">Today</span>}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex-1 grid grid-cols-3 overflow-hidden">
                {displayDays.map(day => {
                  const dayEvents = getEventsForDay(day);
                  return (
                    <div key={day.toISOString()} className="border-l first:border-l-0 border-slate-100 p-4 space-y-4 overflow-y-auto custom-scrollbar hover:bg-slate-50/50 transition-colors">
                      {dayEvents.map(e => {
                        const isMultiDay = !isSameDay(parseISO(e.start), parseISO(e.end));
                        return (
                          <div key={e.id} onClick={() => handleSendMessage(`Tell me about ${e.summary}`)} className={cn(
                            "bg-white border p-3.5 rounded-2xl shadow-sm hover:shadow-md transition-all cursor-pointer group hover:border-blue-400 relative overflow-hidden",
                            isMultiDay ? "border-l-4 border-l-blue-500" : "border-slate-200"
                          )}>
                            {isMultiDay && <div className="absolute top-0 right-0 p-1.5"><SparklesIcon className="w-3 h-3 text-blue-300"/></div>}
                            <p className="text-sm font-bold text-slate-900 group-hover:text-blue-600 transition-colors leading-snug">{e.summary}</p>
                            <div className="flex items-center gap-1.5 mt-2.5">
                              <ClockIcon className="w-3.5 h-3.5 text-slate-400" />
                              <p className="text-[11px] text-slate-500 font-bold uppercase tracking-tight">
                                {e.isAllDay ? 'All Day' : `${format(parseISO(e.start), 'h:mm a')} - ${format(parseISO(e.end), 'h:mm a')}`}
                              </p>
                            </div>
                            {isMultiDay && (
                              <p className="text-[9px] text-slate-400 font-bold mt-1.5 uppercase">
                                {format(parseISO(e.start), 'MMM d')} → {format(parseISO(e.end), 'MMM d')}
                              </p>
                            )}
                          </div>
                        );
                      })}
                      {dayEvents.length === 0 && (
                        <div className="h-full flex flex-col items-center justify-center opacity-10">
                          <CalendarDaysIcon className="w-10 h-10 text-slate-300" />
                          <p className="text-[10px] font-bold mt-2 uppercase tracking-widest">Clear Schedule</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'tasks' && (
            <div className="flex-1 bg-white rounded-3xl border border-slate-200 shadow-sm overflow-y-auto p-8 custom-scrollbar">
              <div className="max-w-2xl mx-auto space-y-8">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-2xl font-black flex items-center gap-3 text-slate-900"><ListBulletIcon className="w-7 h-7 text-blue-600" />Active Focus</h3>
                    <p className="text-slate-400 text-sm font-medium mt-1">Keep track of your priorities.</p>
                  </div>
                  <span className="px-4 py-1.5 bg-blue-50 text-blue-600 rounded-full text-xs font-black uppercase tracking-widest">{tasks.filter(t => !t.completed).length} Pending</span>
                </div>
                <div className="space-y-4">
                  {tasks.length > 0 ? tasks.map(task => (
                    <div key={task.id} className={cn("group flex items-center justify-between p-5 rounded-2xl border transition-all duration-300", task.completed ? "bg-slate-50 border-slate-100 opacity-60" : "bg-white border-slate-200 hover:border-blue-300 hover:shadow-xl hover:-translate-y-0.5")}>
                      <div className="flex items-center gap-5 cursor-pointer flex-1" onClick={() => toggleTask(task)}>
                        <div className={cn("w-8 h-8 rounded-xl border-2 flex items-center justify-center transition-all", task.completed ? "bg-green-500 border-green-500 shadow-lg shadow-green-100" : "border-slate-200 bg-white")}>{task.completed && <CheckIcon className="w-5 h-5 text-white stroke-[4]" />}</div>
                        <div>
                          <p className={cn("font-bold text-slate-900 text-lg", task.completed && "line-through text-slate-400")}>{task.title}</p>
                          {task.due && <p className="text-xs text-slate-400 font-bold mt-1 uppercase tracking-tighter flex items-center gap-1"><ClockIcon className="w-3 h-3"/> {format(parseISO(task.due), 'MMM d, yyyy')}</p>}
                        </div>
                      </div>
                      <button onClick={() => handleSendMessage(`Delete task ${task.title}`)} className="p-3 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"><TrashIcon className="w-5 h-5"/></button>
                    </div>
                  )) : (
                    <div className="text-center py-20 bg-slate-50/50 rounded-3xl border border-dashed border-slate-200">
                      <ListBulletIcon className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                      <p className="text-slate-400 font-bold">No tasks found. Try asking Chronos to create one!</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
             <div className="flex-1 bg-white rounded-3xl border border-slate-200 shadow-sm p-12 max-w-2xl mx-auto w-full text-center">
                <div className="w-24 h-24 bg-slate-100 rounded-[2rem] mx-auto mb-8 flex items-center justify-center shadow-inner">
                  <Cog6ToothIcon className="w-12 h-12 text-slate-400" />
                </div>
                <h3 className="text-2xl font-black mb-2 text-slate-900">Account Control</h3>
                <p className="text-slate-500 mb-12 font-medium">Your account is connected through Google. Disconnecting will remove your access until you sign in again.</p>
                <button onClick={() => signOut()} className="w-full flex items-center justify-center gap-3 p-6 bg-red-50 text-red-600 rounded-2xl font-black uppercase tracking-widest hover:bg-red-100 transition-all shadow-sm active:scale-95">
                  <ArrowLeftOnRectangleIcon className="w-6 h-6" />
                  <span>Disconnect Account</span>
                </button>
             </div>
          )}
        </main>
      </div>

      {/* Chat Sidebar */}
      <div className="w-[440px] bg-white border-l border-slate-200 flex flex-col shadow-2xl z-20">
        <header className="h-20 flex items-center px-8 border-b border-slate-100 justify-between">
          <div className="flex items-center">
            <div className="w-2.5 h-2.5 rounded-full bg-green-500 mr-3 shadow-lg shadow-green-200 animate-pulse" />
            <h3 className="font-black text-slate-900 tracking-tighter text-xl">Chronos AI</h3>
          </div>
          <SparklesIcon className="w-5 h-5 text-blue-500" />
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-slate-50/40">
          {messages.length === 0 && (
             <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-4 opacity-40">
                <ChatBubbleLeftRightIcon className="w-12 h-12 text-slate-300" />
                <p className="text-slate-400 font-bold">Say something like "Schedule a lunch meeting for tomorrow at 2pm"</p>
             </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={cn("flex flex-col animate-in slide-in-from-bottom-2 duration-300", m.role === 'user' ? 'items-end' : 'items-start')}>
              <div className={cn("max-w-[95%] p-5 rounded-3xl text-sm leading-relaxed shadow-sm", m.role === 'user' ? 'bg-slate-900 text-white font-medium rounded-br-none' : 'bg-white text-slate-800 border border-slate-100 rounded-bl-none')}>
                {m.content}
                
                {m.ui?.type === 'duration' && (
                  <div className="mt-5 grid grid-cols-3 gap-2">
                    {m.ui.options?.map(mins => (
                      <button key={mins} onClick={() => handleDurationSelection(mins, m.ui?.pending)} className="py-3 px-1 text-[11px] font-black border border-slate-100 rounded-xl hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-all active:scale-95">{mins}m</button>
                    ))}
                  </div>
                )}

                {m.ui?.type === 'pick' && (
                  <div className="mt-5 space-y-2">
                    {m.ui.options?.map((ev: CalendarEvent) => (
                      <button key={ev.id} onClick={() => handlePickEvent(ev, m.ui?.pending)} className="w-full text-left p-4 text-xs border border-slate-100 rounded-2xl hover:bg-blue-50 hover:border-blue-200 transition-all group/item">
                        <p className="font-black text-slate-900 mb-1 group-hover/item:text-blue-600 transition-colors">{ev.summary}</p>
                        <p className="text-[10px] text-slate-500 font-bold uppercase">{format(parseISO(ev.start), 'MMM d @ h:mm a')}</p>
                      </button>
                    ))}
                  </div>
                )}

                {m.ui?.type === 'confirm' && (
                  <div className="mt-5 flex gap-3">
                    <button onClick={() => handleConfirmedAction(m.ui?.pending)} className={cn("flex-1 py-4 rounded-2xl text-[11px] font-black uppercase tracking-widest text-white shadow-lg active:scale-95 transition-all", m.ui.action?.includes('delete') || m.ui.action === 'clear_day' ? 'bg-red-600 shadow-red-100 hover:bg-red-700' : 'bg-blue-600 shadow-blue-100 hover:bg-blue-700')}>Confirm Action</button>
                    <button onClick={() => setMessages(prev => prev.filter(msg => msg.id !== m.id))} className="flex-1 bg-slate-100 text-slate-600 py-4 rounded-2xl text-[11px] font-black uppercase tracking-widest active:scale-95 transition-all hover:bg-slate-200">Cancel</button>
                  </div>
                )}
              </div>
              <span className="text-[9px] text-slate-400 font-black mt-2 px-3 uppercase tracking-tighter">{format(m.timestamp, 'h:mm a')}</span>
            </div>
          ))}
          {isProcessing && (
            <div className="flex gap-1.5 p-4 items-center bg-white rounded-3xl border border-slate-100 shadow-sm w-fit animate-pulse">
              <div className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-bounce" />
              <div className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-bounce [animation-delay:0.2s]" />
              <div className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-bounce [animation-delay:0.4s]" />
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        <div className="p-8 border-t border-slate-100 bg-white">
          <div className="relative group">
            <input value={inputText} onChange={e => setInputText(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendMessage()} placeholder="Tell Chronos what's next..." className="w-full bg-slate-50 border-none rounded-[1.75rem] pl-7 pr-24 py-5 text-sm font-semibold focus:ring-4 focus:ring-blue-100 shadow-inner transition-all placeholder:text-slate-300" />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex gap-1">
              <button onClick={toggleListening} className={cn("p-2.5 rounded-2xl transition-all", isListening ? 'bg-red-500 text-white shadow-xl scale-110' : 'text-slate-400 hover:text-slate-900')}>
                {isListening ? <StopIcon className="w-6 h-6" /> : <MicrophoneIcon className="w-6 h-6" />}
              </button>
              <button onClick={() => handleSendMessage()} disabled={!inputText.trim() || isProcessing} className="p-2.5 bg-blue-600 text-white rounded-2xl disabled:opacity-30 transition-all active:scale-90 shadow-lg shadow-blue-100 disabled:shadow-none hover:bg-blue-700">
                <PaperAirplaneIcon className="w-6 h-6" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SidebarItem({ icon, label, active = false, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick?: () => void }) {
  return (
    <button onClick={onClick} className={cn("w-full flex items-center gap-5 p-4 rounded-2xl transition-all group relative", active ? "bg-slate-900 text-white font-black shadow-xl" : "text-slate-400 hover:bg-slate-50 hover:text-slate-900")}>
      {icon}
      <span className="hidden lg:block text-sm tracking-tight">{label}</span>
      {active && <div className="absolute right-3 w-2.5 h-2.5 bg-blue-500 rounded-full shadow-lg shadow-blue-400" />}
    </button>
  );
}
