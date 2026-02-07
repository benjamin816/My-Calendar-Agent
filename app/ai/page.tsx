
"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react';
import { useSession, signIn, signOut } from "next-auth/react";
import { useSearchParams, useRouter } from 'next/navigation';
import { CalendarEvent, CalendarTask, ChatMessage } from '../../types';
import { calendarService, setCalendarToken } from '../../services/calendar';
import { ChronosBrain, decodeAudio, playPcmAudio } from '../../services/gemini.client';
// Fix: Removed unused exports (eachDayOfInterval, isBefore, isAfter) and the missing parseISO export.
import { format, addDays, isSameDay, addMinutes, endOfDay } from 'date-fns';
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
  CalendarDaysIcon,
  CpuChipIcon,
  ArrowUturnLeftIcon,
  InformationCircleIcon
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

const subDaysHelper = (date: Date | number, amount: number): Date => {
  return addDays(date, -amount);
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
  
  const [activeTab, setActiveTab] = useState<'calendar' | 'tasks' | 'settings' | 'chat'>('chat');

  const brainRef = useRef<ChronosBrain | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const lastProcessedRid = useRef<string | null>(null);

  const isToday = isSameDay(currentDate, new Date());

  useEffect(() => {
    const lastSessionDate = localStorage.getItem('last_session_date');
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    
    if (lastSessionDate && lastSessionDate !== todayStr) {
      setMessages([]);
      localStorage.removeItem('chronos_chat_history');
    } else {
      const saved = localStorage.getItem('chronos_chat_history');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          setMessages(parsed.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) })));
        } catch (e) {
          console.error("Failed to restore chat history", e);
        }
      } else {
        const welcome: ChatMessage = {
          id: 'welcome',
          role: 'assistant',
          content: "Hello! I'm Chronos AI. I can help you manage your calendar, create tasks, or clear your schedule for the day. What's on your mind?",
          timestamp: new Date()
        };
        setMessages([welcome]);
      }
    }
    localStorage.setItem('last_session_date', todayStr);
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem('chronos_chat_history', JSON.stringify(messages));
    }
  }, [messages]);

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
      const timeMin = startOfDayHelper(addDays(currentDate, -14)).toISOString();
      const timeMax = endOfDay(addDays(currentDate, 30)).toISOString();
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

  const handleSendMessage = useCallback(async (text?: string, voice: boolean = false, confirmed: boolean = false, source: 'web' | 'siri' = 'web') => {
    const msg = text || inputText;
    if (!msg.trim() && !confirmed) return;

    let currentHistory = [...messages];

    if (!confirmed) {
      const userMsg: ChatMessage = {
        id: Date.now().toString(),
        role: 'user',
        content: msg,
        timestamp: new Date(),
        source: source,
        processed: false
      };
      setMessages(prev => {
        const newMsgs = [...prev, userMsg];
        currentHistory = newMsgs;
        return newMsgs;
      });
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
        setMessages(prev => {
          return prev.map(m => (m.role === 'user' && m.content === msg) ? { ...m, processed: true } : m).concat(assistantMsg);
        });
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
  }, [inputText, messages, session, refreshData]);

  useEffect(() => {
    const siri = searchParams.get('siri');
    const text = searchParams.get('text');
    const rid = searchParams.get('rid');

    if (siri === '1') {
      setActiveTab('chat');
    }

    if (siri === '1' && text && rid && rid !== lastProcessedRid.current) {
      lastProcessedRid.current = rid;
      handleSendMessage(text, false, false, 'siri');
      
      const url = new URL(window.location.href);
      url.searchParams.delete('siri');
      url.searchParams.delete('text');
      url.searchParams.delete('rid');
      window.history.replaceState({}, '', url.toString());
    }
  }, [searchParams, handleSendMessage]);

  useEffect(() => {
    if (status === 'authenticated') refreshData();
  }, [status, refreshData]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const resetChat = () => {
    const welcome: ChatMessage = {
      id: Date.now().toString(),
      role: 'assistant',
      content: "Resetting our conversation. How can I help you with your schedule now?",
      timestamp: new Date()
    };
    setMessages([welcome]);
    localStorage.removeItem('chronos_chat_history');
  };

  const handleDurationSelection = (mins: number, pending: any) => {
    const startStr = pending.args.start;
    const endStr = format(addMinutes(new Date(startStr), mins), "yyyy-MM-dd'T'HH:mm:ss");
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

  const getEventsForDay = (day: Date) => {
    const dayEnd = endOfDay(day);
    const dayStart = startOfDayHelper(day);
    return events.filter(e => {
      const eStart = new Date(e.start);
      const eEnd = e.isAllDay ? subDaysHelper(new Date(e.end), 0) : new Date(e.end);
      if (e.isAllDay) {
        const exclusiveEnd = new Date(e.end);
        return eStart < dayEnd && exclusiveEnd > dayStart;
      }
      return eStart <= dayEnd && eEnd >= dayStart;
    }).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  };

  const getTasksForDay = (day: Date) => {
    return tasks.filter(t => {
      if (!t.due) return false;
      return t.due.split('T')[0] === format(day, 'yyyy-MM-dd');
    });
  };

  const groupedTasks = useMemo(() => {
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const result = {
      overdue: [] as CalendarTask[],
      today: [] as CalendarTask[],
      upcoming: [] as CalendarTask[],
      noDate: [] as CalendarTask[],
      completed: [] as CalendarTask[],
    };

    tasks.forEach(t => {
      if (t.completed) {
        result.completed.push(t);
        return;
      }
      if (!t.due) {
        result.noDate.push(t);
        return;
      }
      const dueStr = t.due.split('T')[0];
      if (dueStr === todayStr) {
        result.today.push(t);
      } else if (dueStr < todayStr) {
        result.overdue.push(t);
      } else {
        result.upcoming.push(t);
      }
    });

    // Sort upcoming by date
    result.upcoming.sort((a, b) => a.due!.localeCompare(b.due!));
    result.overdue.sort((a, b) => a.due!.localeCompare(b.due!));
    
    return result;
  }, [tasks]);

  const toggleTask = async (task: CalendarTask) => {
    if (!session?.accessToken || isProcessing) return;
    setIsProcessing(true);
    try {
      await calendarService.updateTask(task.id, { completed: !task.completed }, session.accessToken as string);
      await refreshData();
    } catch (e) { console.error(e); }
    finally { setIsProcessing(false); }
  };

  if (status === "loading") return null;
  if (status === "unauthenticated") {
    return (
      <div className="h-screen flex items-center justify-center p-8 text-center flex-col gap-4">
        <h2 className="text-2xl font-black">Authentication Required</h2>
        <button onClick={() => signIn('google')} className="bg-slate-900 text-white px-8 py-3 rounded-2xl font-bold">Sign In</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row h-[100dvh] max-h-[100dvh] bg-[#f8fafc] font-sans text-slate-900 overflow-hidden overscroll-none">
      <aside className="hidden lg:flex w-64 bg-white border-r border-slate-200 flex-col p-4 space-y-8">
        <div className="flex items-center gap-4 px-2">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-lg">C</div>
          <span className="font-bold text-xl tracking-tight">Chronos AI</span>
        </div>
        <nav className="flex-1 space-y-1">
          <SidebarItem icon={<CpuChipIcon className="w-6 h-6" />} label="AI Assistant" active={activeTab === 'chat'} onClick={() => setActiveTab('chat')} />
          <SidebarItem icon={<Squares2X2Icon className="w-6 h-6" />} label="Schedule" active={activeTab === 'calendar'} onClick={() => setActiveTab('calendar')} />
          <SidebarItem icon={<ListBulletIcon className="w-6 h-6" />} label="Tasks" active={activeTab === 'tasks'} onClick={() => setActiveTab('tasks')} />
          <SidebarItem icon={<Cog6ToothIcon className="w-6 h-6" />} label="Account" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
        </nav>
      </aside>

      <div className="flex-1 flex flex-col min-0 h-full overflow-hidden pb-16 lg:pb-0">
        <header className="h-16 lg:h-20 flex items-center justify-between px-4 lg:px-8 bg-white border-b border-slate-200">
          <div className="flex items-center gap-2 lg:gap-6">
             {activeTab === 'calendar' && (
               <button onClick={() => setCurrentDate(new Date())} className="px-3 py-1 text-xs font-bold bg-slate-100 text-slate-600 rounded-lg">Today</button>
             )}
             <h2 className="text-lg lg:text-2xl font-black tracking-tight">
               {activeTab === 'tasks' ? 'Task Manager' : format(currentDate, 'MMMM yyyy')}
             </h2>
          </div>
          <div className="flex items-center gap-2">
            {tasks.length > 0 && activeTab === 'tasks' && (
              <span className="hidden md:inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800">
                {tasks.filter(t => !t.completed).length} Pending
              </span>
            )}
            <button onClick={refreshData} className="p-2 hover:bg-slate-100 rounded-xl transition-all active:scale-90">
              <ArrowPathIcon className={cn("w-5 h-5 text-slate-600", isProcessing && "animate-spin")} />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-hidden p-3 lg:p-6 flex flex-col min-h-0">
          {activeTab === 'calendar' && (
            <div className="flex-1 bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-0 animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="flex items-center justify-between py-8 px-4 border-b border-slate-100 bg-white">
                <div className="w-12">
                  <button onClick={() => setCurrentDate(prev => addDays(prev, -1))} className="p-2 hover:bg-slate-100 rounded-xl">
                    <ChevronLeftIcon className="w-7 h-7" />
                  </button>
                </div>
                <div className="text-center flex-1">
                  <div className="text-4xl lg:text-5xl font-black text-slate-900 leading-none mb-1">{format(currentDate, 'd')}</div>
                  <h3 className={cn("text-[10px] lg:text-xs font-black uppercase tracking-[0.25em]", isToday ? "text-blue-600" : "text-slate-400")}>{format(currentDate, 'EEEE')}</h3>
                </div>
                <div className="w-12 flex justify-end">
                  <button onClick={() => setCurrentDate(prev => addDays(prev, 1))} className="p-2 hover:bg-slate-100 rounded-xl">
                    <ChevronRightIcon className="w-7 h-7" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-4 custom-scrollbar overscroll-contain">
                <div className="space-y-4">
                  <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 px-2">Events</h4>
                  {getEventsForDay(currentDate).map(e => (
                    <EventCard key={e.id} event={e} onClick={() => handleSendMessage(`Tell me about ${e.summary}`)} />
                  ))}
                  {getEventsForDay(currentDate).length === 0 && <EmptyDayView label="No Events Today" />}
                </div>

                <div className="pt-6 space-y-4">
                  <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 px-2">Tasks for Today</h4>
                  {getTasksForDay(currentDate).map(t => (
                    <TaskCard key={t.id} task={t} onToggle={() => toggleTask(t)} />
                  ))}
                  {getTasksForDay(currentDate).length === 0 && <EmptyDayView label="No Tasks for Today" />}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'tasks' && (
            <div className="flex-1 bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-0 animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="flex-1 overflow-y-auto p-4 lg:p-8 custom-scrollbar overscroll-contain">
                <div className="max-w-3xl mx-auto space-y-10">
                  {groupedTasks.overdue.length > 0 && (
                    <section className="space-y-3">
                      <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-red-500 px-2 flex items-center gap-2">
                        <InformationCircleIcon className="w-4 h-4" />
                        Overdue
                      </h4>
                      {groupedTasks.overdue.map(t => <TaskCard key={t.id} task={t} onToggle={() => toggleTask(t)} />)}
                    </section>
                  )}

                  <section className="space-y-3">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-600 px-2">Today</h4>
                    {groupedTasks.today.length > 0 ? (
                      groupedTasks.today.map(t => <TaskCard key={t.id} task={t} onToggle={() => toggleTask(t)} />)
                    ) : (
                      <p className="text-xs text-slate-400 italic px-2">You're all caught up for today.</p>
                    )}
                  </section>

                  {groupedTasks.noDate.length > 0 && (
                    <section className="space-y-3">
                      <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 px-2">Someday / No Date</h4>
                      {groupedTasks.noDate.map(t => <TaskCard key={t.id} task={t} onToggle={() => toggleTask(t)} />)}
                    </section>
                  )}

                  {groupedTasks.upcoming.length > 0 && (
                    <section className="space-y-3">
                      <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 px-2">Upcoming</h4>
                      {groupedTasks.upcoming.map(t => <TaskCard key={t.id} task={t} onToggle={() => toggleTask(t)} />)}
                    </section>
                  )}

                  {groupedTasks.completed.length > 0 && (
                    <section className="space-y-3 opacity-60">
                      <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 px-2">Recently Completed</h4>
                      {groupedTasks.completed.slice(0, 5).map(t => <TaskCard key={t.id} task={t} onToggle={() => toggleTask(t)} />)}
                    </section>
                  )}

                  {tasks.length === 0 && (
                    <div className="py-20 flex flex-col items-center justify-center text-slate-300">
                      <ListBulletIcon className="w-16 h-16 mb-4" />
                      <p className="font-black uppercase tracking-widest text-sm">No tasks found</p>
                      <p className="text-xs mt-2">Ask the AI to create a new task for you.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'chat' && (
            <div className="flex-1 flex flex-col bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden min-h-0 animate-in fade-in slide-in-from-bottom-4 duration-300">
               <ChatInterface 
                  messages={messages} inputText={inputText} setInputText={setInputText} isProcessing={isProcessing} isListening={isListening} toggleListening={toggleListening} 
                  handleSendMessage={handleSendMessage} handleDurationSelection={handleDurationSelection} handlePickEvent={handlePickEvent} handleConfirmedAction={handleConfirmedAction} setMessages={setMessages} chatEndRef={chatEndRef} onReset={resetChat}
               />
            </div>
          )}

          {activeTab === 'settings' && (
             <div className="flex-1 bg-white rounded-[2rem] border border-slate-200 shadow-sm p-8 text-center flex flex-col justify-center animate-in fade-in zoom-in duration-300">
                <div className="w-20 h-20 bg-slate-100 rounded-2xl mx-auto mb-6 flex items-center justify-center"><Cog6ToothIcon className="w-10 h-10 text-slate-400" /></div>
                <h3 className="text-xl font-black mb-2">Account</h3>
                <p className="text-slate-500 mb-2 font-bold">{session?.user?.name}</p>
                <p className="text-xs text-slate-400 mb-8">{session?.user?.email}</p>
                <button onClick={() => signOut({ callbackUrl: '/' })} className="w-full max-w-xs mx-auto flex items-center justify-center gap-3 p-4 bg-red-50 text-red-600 rounded-2xl font-black uppercase tracking-widest active:scale-95 transition-all">
                  <ArrowLeftOnRectangleIcon className="w-5 h-5" />
                  <span>Logout</span>
                </button>
             </div>
          )}
        </main>
      </div>

      <div className={cn(
        "hidden w-[400px] bg-white border-l border-slate-200 flex-col shadow-2xl z-20 h-full transition-all duration-300",
        activeTab === 'chat' ? "lg:hidden" : "lg:flex"
      )}>
        <header className="h-20 flex items-center px-8 border-b border-slate-100 justify-between">
          <h3 className="font-black text-xl flex items-center gap-2">
            <CpuChipIcon className="w-6 h-6 text-blue-600" />
            Assistant
          </h3>
          <button onClick={resetChat} className="p-2 hover:bg-slate-100 rounded-xl transition-all active:scale-90" title="Reset Conversation">
            <ArrowUturnLeftIcon className="w-5 h-5 text-slate-400" />
          </button>
        </header>
        <ChatInterface 
          messages={messages} inputText={inputText} setInputText={setInputText} isProcessing={isProcessing} isListening={isListening} toggleListening={toggleListening} 
          handleSendMessage={handleSendMessage} handleDurationSelection={handleDurationSelection} handlePickEvent={handlePickEvent} handleConfirmedAction={handleConfirmedAction} setMessages={setMessages} chatEndRef={chatEndRef} onReset={resetChat}
        />
      </div>

      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex items-center justify-around h-16 z-50 px-2">
         <MobileNavItem icon={<CpuChipIcon className="w-6 h-6"/>} active={activeTab === 'chat'} onClick={() => setActiveTab('chat')} label="AI" />
         <MobileNavItem icon={<Squares2X2Icon className="w-6 h-6"/>} active={activeTab === 'calendar'} onClick={() => setActiveTab('calendar')} label="Daily" />
         <MobileNavItem icon={<ListBulletIcon className="w-6 h-6"/>} active={activeTab === 'tasks'} onClick={() => setActiveTab('tasks')} label="Tasks" />
         <MobileNavItem icon={<Cog6ToothIcon className="w-6 h-6"/>} active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} label="Account" />
      </nav>
    </div>
  );
}

export default function ChronosApp() {
  return (
    <Suspense fallback={<div className="h-screen bg-[#f8fafc]" />}>
      <ChronosAppContent />
    </Suspense>
  );
}

function SidebarItem({ icon, label, active = false, onClick }: any) {
  return (
    <button onClick={onClick} className={cn("w-full flex items-center gap-5 p-4 rounded-2xl transition-all", active ? "bg-slate-900 text-white font-black shadow-lg" : "text-slate-400 hover:bg-slate-50 hover:text-slate-900")}>
      {icon} <span className="text-sm">{label}</span>
    </button>
  );
}

function MobileNavItem({ icon, active, onClick, label }: any) {
  return (
    <button onClick={onClick} className={cn("flex flex-col items-center justify-center gap-1 flex-1 h-full transition-all active:scale-90", active ? "text-blue-600" : "text-slate-400")}>
       <div className={cn("p-1.5 rounded-lg transition-colors", active && "bg-blue-50")}>{icon}</div>
       <span className="text-[10px] font-black uppercase tracking-tighter">{label}</span>
    </button>
  );
}

function EventCard({ event, onClick }: any) {
  return (
    <div onClick={onClick} className="bg-white border border-slate-200 p-4 lg:p-6 rounded-2xl shadow-sm hover:border-blue-400 cursor-pointer active:scale-[0.98] transition-all group">
      <p className="text-base lg:text-lg font-bold group-hover:text-blue-600 transition-colors">{event.summary}</p>
      <div className="flex items-center gap-1.5 mt-3 text-[10px] lg:text-xs text-slate-500 font-bold uppercase tracking-wider">
        <ClockIcon className="w-4 h-4" />
        {event.isAllDay ? 'All Day' : `${format(new Date(event.start), 'h:mm a')} - ${format(new Date(event.end), 'h:mm a')}`}
      </div>
    </div>
  );
}

function TaskCard({ task, onToggle }: any) {
  const dueInfo = useMemo(() => {
    if (!task.due) return null;
    const dueStr = task.due.split('T')[0];
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    if (dueStr === todayStr) return 'Due Today';
    // Fix: Replaced parseISO with new Date() as parseISO was not exported from date-fns.
    return `Due ${format(new Date(task.due), 'MMM d')}`;
  }, [task.due]);

  const isOverdue = task.due && !task.completed && task.due.split('T')[0] < format(new Date(), 'yyyy-MM-dd');

  return (
    <div className={cn("bg-white border p-4 lg:p-6 rounded-2xl flex items-center gap-4 transition-all hover:shadow-md", isOverdue ? "border-red-100 bg-red-50/20" : "border-slate-200")}>
      <button onClick={onToggle} className={cn("w-7 h-7 rounded-xl border-2 transition-all flex items-center justify-center shrink-0 active:scale-90", task.completed ? "bg-green-500 border-green-500" : "border-slate-200 hover:border-slate-400 bg-white")}>
        {task.completed && <CheckIcon className="w-4 h-4 text-white stroke-[3]" />}
      </button>
      <div className="flex-1 min-w-0">
        <p className={cn("text-base lg:text-lg font-bold truncate transition-all", task.completed && "line-through text-slate-400")}>{task.title}</p>
        <div className="flex items-center gap-3 mt-1">
          {dueInfo && <span className={cn("text-[9px] font-black uppercase tracking-widest", isOverdue ? "text-red-500" : "text-slate-400")}>{dueInfo}</span>}
          {task.notes && <p className="text-[10px] text-slate-400 truncate flex-1">{task.notes}</p>}
        </div>
      </div>
    </div>
  );
}

function EmptyDayView({ label = "Nothing Scheduled" }: { label?: string }) {
  return (
    <div className="py-10 flex flex-col items-center justify-center opacity-10">
      <CalendarDaysIcon className="w-10 h-10" />
      <p className="text-[9px] font-black mt-3 uppercase tracking-[0.3em]">{label}</p>
    </div>
  );
}

function ChatInterface({ 
  messages, inputText, setInputText, isProcessing, isListening, toggleListening, 
  handleSendMessage, handleDurationSelection, handlePickEvent, handleConfirmedAction, setMessages, chatEndRef, onReset 
}: any) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden h-full">
      <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-6 bg-slate-50/40 custom-scrollbar overscroll-contain">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center opacity-20 text-center space-y-4">
            <SparklesIcon className="w-16 h-16" />
            <div>
              <p className="font-black text-xl uppercase tracking-widest">Assistant</p>
              <p className="text-sm font-bold mt-1">Ready for your schedule</p>
            </div>
          </div>
        )}
        {messages.map((m: ChatMessage) => (
          <div key={m.id} className={cn("flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-300", m.role === 'user' ? 'items-end' : 'items-start')}>
            {m.source === 'siri' && (
              <div className="flex items-center gap-1.5 mb-1 px-3">
                <CpuChipIcon className="w-3 h-3 text-blue-500" />
                <span className="text-[9px] font-black text-blue-500 uppercase tracking-widest">Siri Input</span>
              </div>
            )}
            <div className={cn("max-w-[90%] p-4 rounded-[1.5rem] text-sm shadow-sm whitespace-pre-wrap transition-all", m.role === 'user' ? 'bg-slate-900 text-white rounded-br-none' : 'bg-white text-slate-800 border border-slate-100 rounded-bl-none')}>
              {m.content}
              {m.ui?.type === 'confirm' && (
                <div className="mt-4 flex gap-2">
                  <button onClick={() => handleConfirmedAction(m.ui?.pending)} className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest active:scale-95 transition-transform">Confirm</button>
                  <button onClick={() => setMessages((prev: any) => prev.filter((msg: any) => msg.id !== m.id))} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-black text-[10px] uppercase tracking-widest active:scale-95 transition-transform">Cancel</button>
                </div>
              )}
            </div>
          </div>
        ))}
        {isProcessing && (
          <div className="flex items-center gap-2 px-4">
            <div className="flex gap-1">
              <span className="w-1 h-1 bg-blue-400 rounded-full animate-bounce"></span>
              <span className="w-1 h-1 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
              <span className="w-1 h-1 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
            </div>
            <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Thinking</span>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>
      <div className="p-4 lg:p-6 border-t border-slate-100 bg-white">
        <div className="relative">
          <input 
            value={inputText} onChange={e => setInputText(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendMessage()} 
            placeholder="How can I help?" className="w-full bg-slate-50 border-none rounded-2xl pl-5 pr-20 py-4 font-semibold focus:ring-4 focus:ring-blue-100 transition-all outline-none" 
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
            <button onClick={toggleListening} className={cn("p-2 rounded-xl transition-all active:scale-90", isListening ? 'bg-red-500 text-white animate-pulse' : 'text-slate-400 hover:text-slate-600')}><MicrophoneIcon className="w-5 h-5" /></button>
            <button onClick={() => handleSendMessage()} className="p-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all active:scale-90"><PaperAirplaneIcon className="w-5 h-5" /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
