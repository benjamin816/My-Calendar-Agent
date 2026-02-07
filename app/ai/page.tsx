
"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react';
import { useSession, signIn, signOut } from "next-auth/react";
import { useSearchParams, useRouter } from 'next/navigation';
import { CalendarEvent, CalendarTask, ChatMessage } from '../../types';
import { calendarService, setCalendarToken } from '../../services/calendar';
import { ChronosBrain, decodeAudio, playPcmAudio } from '../../services/gemini.client';
import { format, addDays, isSameDay, endOfDay } from 'date-fns';
import { 
  MicrophoneIcon, 
  ChevronLeftIcon, 
  ChevronRightIcon,
  ArrowPathIcon,
  CheckIcon,
  Cog6ToothIcon,
  Squares2X2Icon,
  PaperAirplaneIcon,
  ArrowLeftOnRectangleIcon,
  ClockIcon,
  SparklesIcon,
  CalendarDaysIcon,
  CpuChipIcon,
  ExclamationCircleIcon,
  BellAlertIcon,
  QuestionMarkCircleIcon,
  TrashIcon
} from '@heroicons/react/24/outline';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const startOfDayHelper = (date: Date | number): Date => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

function ChronosAppContent() {
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [activeTab, setActiveTab] = useState<'calendar' | 'settings' | 'chat'>('chat');

  const brainRef = useRef<ChronosBrain | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const hasHandledParam = useRef(false);

  const isToday = isSameDay(currentDate, new Date());

  // Auto-scroll to bottom of chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isProcessing]);

  // Initialization & Data Loading
  useEffect(() => {
    brainRef.current = new ChronosBrain();
    const saved = localStorage.getItem('chronos_chat_history');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setMessages(parsed.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) })));
      } catch (e) {
        setMessages([{ id: 'welcome', role: 'assistant', content: "Welcome back! How's your day looking?", timestamp: new Date() }]);
      }
    } else {
      setMessages([{ id: 'welcome', role: 'assistant', content: "Hello! I'm Chronos AI. I can manage your calendar and tasks. What's on your mind?", timestamp: new Date() }]);
    }

    if (typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.onresult = (event: any) => {
        handleSendMessage(event.results[0][0].transcript, true);
      };
      recognitionRef.current.onend = () => setIsListening(false);
    }
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem('chronos_chat_history', JSON.stringify(messages));
    }
  }, [messages]);

  const refreshData = useCallback(async () => {
    if (!session?.accessToken) return;
    setCalendarToken(session.accessToken as string);
    try {
      const timeMin = startOfDayHelper(addDays(currentDate, -7)).toISOString();
      const timeMax = endOfDay(addDays(currentDate, 14)).toISOString();
      const [evs, tks] = await Promise.all([
        calendarService.getEvents(timeMin, timeMax, session.accessToken as string),
        calendarService.getTasks(session.accessToken as string)
      ]);
      setEvents(evs);
      setTasks(tks);
    } catch (e) { console.error("Refresh error:", e); }
  }, [session, currentDate]);

  useEffect(() => { if (status === 'authenticated') refreshData(); }, [status, refreshData]);

  // Message Handling
  const handleSendMessage = useCallback(async (text?: string, voice: boolean = false, confirmed: boolean = false, clearHistory: boolean = false) => {
    const msg = text || inputText;
    if (!msg.trim() && !confirmed) return;

    if (clearHistory) {
      // CLEAR CHAT: Reset messages to just the current user input
      setMessages([{ id: Date.now().toString(), role: 'user', content: msg, timestamp: new Date() }]);
    } else if (!confirmed) {
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', content: msg, timestamp: new Date() }]);
    }

    setInputText('');
    setIsProcessing(true);

    try {
      // Use an empty history array if clearHistory is true to force a fresh brain context
      const currentHistory = clearHistory ? [] : messages;
      const result = await brainRef.current?.processMessage(msg, refreshData, session?.accessToken as string, currentHistory, confirmed);
      
      if (result) {
        const assistantMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: 'assistant', content: result.text, timestamp: new Date(), ui: result.ui };
        setMessages(prev => clearHistory ? [prev[0], assistantMsg] : [...prev, assistantMsg]);
        if (voice && result.text) {
          const audio = await brainRef.current?.generateSpeech(result.text);
          if (audio) playPcmAudio(decodeAudio(audio));
        }
      }
    } catch (e: any) {
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', content: `Error: ${e.message}`, timestamp: new Date() }]);
    } finally {
      setIsProcessing(false);
      refreshData();
    }
  }, [inputText, messages, session, refreshData]);

  // Siri/URL Parameter Handoff Logic
  useEffect(() => {
    if (status !== 'authenticated' || hasHandledParam.current) return;

    const textParam = searchParams.get('text');
    if (textParam) {
      hasHandledParam.current = true;
      setActiveTab('chat');
      // Execute dictated command: clear old chat, auto-send, and trigger voice response
      handleSendMessage(textParam, true, false, true);
      // Clean up the URL to prevent re-execution on refresh
      router.replace('/ai');
    }
  }, [status, searchParams, router, handleSendMessage]);

  const resetChat = () => {
    if (confirm("Are you sure you want to clear the conversation history?")) {
      setMessages([{ id: 'welcome', role: 'assistant', content: "Chat reset. How can I help you manage your schedule?", timestamp: new Date() }]);
      localStorage.removeItem('chronos_chat_history');
    }
  };

  // UI Helpers
  const toggleTask = async (task: CalendarTask) => {
    if (!session?.accessToken || isProcessing) return;
    setIsProcessing(true);
    try {
      await calendarService.updateTask(task.id, { completed: !task.completed }, session.accessToken as string);
      await refreshData();
    } catch (e) { console.error(e); } finally { setIsProcessing(false); }
  };

  const currentDayContent = useMemo(() => {
    const dayStr = format(currentDate, 'yyyy-MM-dd');
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const dayEnd = endOfDay(currentDate);
    const dayStart = startOfDayHelper(currentDate);

    const dayEvents = events.filter(e => {
      const s = new Date(e.start);
      const end = new Date(e.end);
      return e.isAllDay ? (s <= dayEnd && end >= dayStart) : (s <= dayEnd && end >= dayStart);
    }).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    const dayTasks = tasks.filter(t => t.due && t.due.split('T')[0] === dayStr);
    const overdue = isToday ? tasks.filter(t => t.due && t.due.split('T')[0] < todayStr && !t.completed) : [];

    return { events: dayEvents, tasks: dayTasks, overdue };
  }, [events, tasks, currentDate, isToday]);

  if (status === "loading") return (
    <div className="h-screen flex items-center justify-center bg-slate-50">
       <div className="flex flex-col items-center gap-4">
          <SparklesIcon className="w-10 h-10 text-blue-600 animate-spin" />
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Restoring Connection</p>
       </div>
    </div>
  );

  return (
    <div className="flex flex-col lg:flex-row h-[100dvh] max-h-[100dvh] bg-slate-50 font-sans text-slate-900 overflow-hidden">
      {/* Sidebar Desktop */}
      <aside className="hidden lg:flex w-72 bg-white border-r border-slate-200 flex-col p-6 space-y-10">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white font-black text-2xl shadow-xl shadow-blue-200">C</div>
          <span className="font-black text-2xl tracking-tighter">Chronos</span>
        </div>
        <nav className="flex-1 space-y-2">
          <SidebarItem icon={<CpuChipIcon className="w-6 h-6" />} label="AI Assistant" active={activeTab === 'chat'} onClick={() => setActiveTab('chat')} />
          <SidebarItem icon={<Squares2X2Icon className="w-6 h-6" />} label="My Schedule" active={activeTab === 'calendar'} onClick={() => setActiveTab('calendar')} />
          <SidebarItem icon={<Cog6ToothIcon className="w-6 h-6" />} label="Settings" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
        </nav>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-h-0 relative h-full pb-20 lg:pb-0">
        <header className="h-16 lg:h-20 shrink-0 flex items-center justify-between px-6 lg:px-10 bg-white/80 backdrop-blur-md border-b border-slate-200 z-10">
          <h2 className="text-lg lg:text-2xl font-black tracking-tight flex items-center gap-3">
            {activeTab === 'calendar' ? 'Daily View' : activeTab === 'settings' ? 'Account' : 'Assistant'}
          </h2>
          <div className="flex items-center gap-2">
            {activeTab === 'chat' && (
               <button onClick={resetChat} title="Clear Chat History" className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all">
                 <TrashIcon className="w-5 h-5" />
               </button>
            )}
            <button onClick={refreshData} title="Sync Data" className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all">
              <ArrowPathIcon className={cn("w-5 h-5", isProcessing && "animate-spin")} />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-hidden p-3 lg:p-8 flex flex-col min-h-0">
          {activeTab === 'calendar' && (
            <div className="flex-1 bg-white rounded-3xl lg:rounded-[2.5rem] border border-slate-200 shadow-xl shadow-slate-200/50 overflow-hidden flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex items-center justify-between p-4 lg:p-8 border-b border-slate-100">
                {!isToday ? (
                  <button onClick={() => setCurrentDate(d => addDays(d, -1))} className="p-2 lg:p-3 hover:bg-slate-50 rounded-2xl border border-slate-100 transition-all">
                    <ChevronLeftIcon className="w-5 h-5 lg:w-6 lg:h-6" />
                  </button>
                ) : (
                  <div className="w-10 lg:w-12 h-10 lg:h-12" />
                )}
                <div className="text-center">
                  <p className="text-2xl lg:text-4xl font-black text-slate-900 tracking-tighter">{format(currentDate, 'd')}</p>
                  <p className={cn("text-[8px] lg:text-[10px] font-black uppercase tracking-[0.3em]", isToday ? "text-blue-600" : "text-slate-400")}>{format(currentDate, 'EEEE')}</p>
                </div>
                <button onClick={() => setCurrentDate(d => addDays(d, 1))} className="p-2 lg:p-3 hover:bg-slate-50 rounded-2xl border border-slate-100 transition-all">
                  <ChevronRightIcon className="w-5 h-5 lg:w-6 lg:h-6" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-8 custom-scrollbar overscroll-contain">
                {isToday && currentDayContent.overdue.length > 0 && (
                  <div className="space-y-3 animate-in slide-in-from-left duration-500">
                    <h4 className="flex items-center gap-2 text-[10px] font-black text-red-500 uppercase tracking-widest px-2"><BellAlertIcon className="w-4 h-4" /> Overdue</h4>
                    <div className="space-y-2">
                      {currentDayContent.overdue.map(t => <TaskItem key={t.id} task={t} onToggle={() => toggleTask(t)} isOverdue />)}
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Events</h4>
                  <div className="space-y-3">
                    {currentDayContent.events.map(e => (
                      <EventItem key={e.id} event={e} onAsk={() => { setActiveTab('chat'); handleSendMessage(`Tell me more about the event "${e.summary}" on my calendar.`); }} />
                    ))}
                    {currentDayContent.events.length === 0 && <EmptyState label="Clear Skies Today" />}
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-[10px] font-black text-blue-600 uppercase tracking-widest px-2">Tasks</h4>
                  <div className="space-y-2">
                    {currentDayContent.tasks.map(t => <TaskItem key={t.id} task={t} onToggle={() => toggleTask(t)} />)}
                    {currentDayContent.tasks.length === 0 && <EmptyState label="No Tasks Due" />}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'chat' && (
            <div className="flex-1 flex flex-col bg-white rounded-3xl lg:rounded-[2.5rem] border border-slate-200 shadow-xl overflow-hidden min-h-0 animate-in fade-in duration-500">
              <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-6 bg-slate-50/30 custom-scrollbar overscroll-contain">
                {messages.map((m: ChatMessage) => (
                  <div key={m.id} className={cn("flex flex-col animate-in fade-in slide-in-from-bottom-2", m.role === 'user' ? 'items-end' : 'items-start')}>
                    <div className={cn("max-w-[90%] lg:max-w-[85%] p-4 lg:p-5 rounded-2xl lg:rounded-[2rem] text-sm shadow-sm whitespace-pre-wrap", m.role === 'user' ? 'bg-slate-900 text-white rounded-tr-none' : 'bg-white text-slate-800 border border-slate-200 rounded-tl-none')}>
                      {m.content}
                      {m.ui?.type === 'confirm' && (
                        <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4">
                          <button onClick={() => handleSendMessage(`Executing ${m.ui?.pending.action}: ${JSON.stringify(m.ui?.pending.args)}`, false, true)} className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold text-[10px] uppercase tracking-widest shadow-lg shadow-blue-200 active:scale-95 transition-all">Confirm Action</button>
                          <button onClick={() => setMessages(prev => prev.filter(msg => msg.id !== m.id))} className="w-full py-3 bg-slate-100 text-slate-600 rounded-xl font-bold text-[10px] uppercase tracking-widest active:scale-95 transition-all">Dismiss</button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {isProcessing && <ThinkingIndicator />}
                <div ref={chatEndRef} />
              </div>

              <div className="p-4 lg:p-6 bg-white border-t border-slate-100 shrink-0">
                <div className="relative flex items-center gap-2 lg:gap-3 bg-slate-50 border-2 border-transparent focus-within:border-blue-100 focus-within:bg-white rounded-2xl lg:rounded-3xl p-1 pr-2 shadow-inner transition-all">
                  <input 
                    value={inputText} onChange={e => setInputText(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
                    placeholder="Ask Chronos..." className="flex-1 bg-transparent pl-4 lg:pl-6 py-4 font-semibold outline-none text-sm lg:text-base"
                  />
                  <div className="flex items-center gap-1">
                    <button onClick={() => { if(isListening) recognitionRef.current.stop(); else { recognitionRef.current.start(); setIsListening(true); }}} className={cn("p-2 lg:p-3 rounded-xl transition-all", isListening ? "bg-red-500 text-white animate-pulse" : "text-slate-400 hover:bg-slate-100")}>
                      <MicrophoneIcon className="w-5 h-5 lg:w-6 lg:h-6" />
                    </button>
                    <button onClick={() => handleSendMessage()} className="p-2.5 lg:p-3 bg-blue-600 text-white rounded-xl lg:rounded-2xl hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all active:scale-90">
                      <PaperAirplaneIcon className="w-5 h-5 lg:w-6 lg:h-6" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="flex-1 bg-white rounded-3xl lg:rounded-[2.5rem] border border-slate-200 p-6 lg:p-12 text-center flex flex-col items-center justify-center animate-in zoom-in duration-500">
               <div className="w-20 h-20 lg:w-24 lg:h-24 bg-slate-50 rounded-3xl flex items-center justify-center mb-6 lg:mb-8"><Cog6ToothIcon className="w-10 h-10 lg:w-12 lg:h-12 text-slate-400" /></div>
               <h3 className="text-xl lg:text-2xl font-black mb-1">{session?.user?.name}</h3>
               <p className="text-sm lg:text-base text-slate-500 mb-8 lg:mb-10 font-bold">{session?.user?.email}</p>
               <div className="w-full max-w-sm">
                 <button onClick={() => signOut({ callbackUrl: '/' })} className="w-full py-4 px-6 bg-red-50 text-red-600 rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-3 active:scale-95 transition-all hover:bg-red-100">
                   <ArrowLeftOnRectangleIcon className="w-5 h-5" /> Sign Out
                 </button>
               </div>
            </div>
          )}
        </main>
      </div>

      <nav className="lg:hidden fixed bottom-0 left-0 right-0 h-20 bg-white border-t border-slate-200 flex items-center justify-around z-50 px-4 pb-safe shadow-[0_-4px_20px_-5px_rgba(0,0,0,0.1)]">
        <MobileNavItem icon={<CpuChipIcon className="w-6 h-6" />} label="AI" active={activeTab === 'chat'} onClick={() => setActiveTab('chat')} />
        <MobileNavItem icon={<Squares2X2Icon className="w-6 h-6" />} label="Schedule" active={activeTab === 'calendar'} onClick={() => setActiveTab('calendar')} />
        <MobileNavItem icon={<Cog6ToothIcon className="w-6 h-6" />} label="Me" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
      </nav>
    </div>
  );
}

function SidebarItem({ icon, label, active, onClick }: any) {
  return (
    <button onClick={onClick} className={cn("w-full flex items-center gap-4 p-4 rounded-2xl transition-all", active ? "bg-slate-900 text-white font-bold shadow-xl shadow-slate-200" : "text-slate-400 hover:bg-slate-50 hover:text-slate-900 font-semibold")}>
      {icon} <span>{label}</span>
    </button>
  );
}

function MobileNavItem({ icon, label, active, onClick }: any) {
  return (
    <button onClick={onClick} className={cn("flex flex-col items-center gap-1 transition-all active:scale-90", active ? "text-blue-600" : "text-slate-400")}>
      <div className={cn("p-2 rounded-xl", active && "bg-blue-50")}>{icon}</div>
      <span className="text-[10px] font-black uppercase tracking-widest">{label}</span>
    </button>
  );
}

function EventItem({ event, onAsk }: any) {
  return (
    <div className="bg-white border border-slate-200 p-4 lg:p-6 rounded-3xl shadow-sm hover:border-blue-400 cursor-pointer group transition-all relative">
      <div className="flex justify-between items-start mb-2 lg:mb-3">
        <p className="text-base lg:text-lg font-black text-slate-900 group-hover:text-blue-600 transition-colors leading-tight">{event.summary}</p>
        <button onClick={onAsk} className="p-2 opacity-0 group-hover:opacity-100 transition-opacity bg-blue-50 text-blue-600 rounded-lg"><QuestionMarkCircleIcon className="w-4 h-4 lg:w-5 lg:h-5" /></button>
      </div>
      <div className="flex items-center gap-2 text-[8px] lg:text-[10px] font-black text-slate-400 uppercase tracking-widest">
        <ClockIcon className="w-3 h-3 lg:w-4 lg:h-4" />
        {event.isAllDay ? "All Day Event" : `${format(new Date(event.start), 'h:mm a')} - ${format(new Date(event.end), 'h:mm a')}`}
      </div>
    </div>
  );
}

function TaskItem({ task, onToggle, isOverdue }: any) {
  return (
    <div className={cn("bg-white border p-4 lg:p-5 rounded-3xl flex items-center gap-4 lg:gap-5 transition-all group", isOverdue ? "border-red-200 bg-red-50/10" : "border-slate-200")}>
      <button onClick={onToggle} className={cn("w-7 h-7 lg:w-8 lg:h-8 rounded-xl border-2 transition-all flex items-center justify-center shrink-0 active:scale-90", task.completed ? "bg-green-500 border-green-500" : isOverdue ? "border-red-300 bg-white hover:border-red-500" : "border-slate-200 bg-white hover:border-slate-400")}>
        {task.completed && <CheckIcon className="w-4 h-4 lg:w-5 lg:h-5 text-white stroke-[3]" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {isOverdue && !task.completed && <ExclamationCircleIcon className="w-4 h-4 text-red-500" />}
          <p className={cn("text-sm lg:text-base font-bold truncate transition-all", task.completed && "line-through text-slate-400", isOverdue && !task.completed && "text-red-900")}>{task.title}</p>
        </div>
        {task.notes && <p className="text-[8px] lg:text-[10px] text-slate-400 truncate mt-1">{task.notes}</p>}
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="py-12 flex flex-col items-center justify-center opacity-10">
      <CalendarDaysIcon className="w-10 h-10 lg:w-12 lg:h-12" />
      <p className="text-[8px] lg:text-[10px] font-black uppercase tracking-[0.4em] mt-4">{label}</p>
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 px-4 py-3 bg-white/50 border border-slate-100 rounded-2xl self-start animate-pulse">
      <div className="flex gap-1">
        <div className="w-1 h-1 lg:w-1.5 lg:h-1.5 bg-blue-600 rounded-full animate-bounce"></div>
        <div className="w-1 h-1 lg:w-1.5 lg:h-1.5 bg-blue-600 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
        <div className="w-1 h-1 lg:w-1.5 lg:h-1.5 bg-blue-600 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
      </div>
      <span className="text-[8px] lg:text-[10px] font-black uppercase tracking-widest text-slate-400">Thinking</span>
    </div>
  );
}

export default function ChronosApp() {
  return (
    <Suspense fallback={<div className="h-screen flex items-center justify-center bg-slate-50"><div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div></div>}>
      <ChronosAppContent />
    </Suspense>
  );
}
