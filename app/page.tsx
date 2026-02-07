"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSession, signIn, signOut } from "next-auth/react";
import { CalendarEvent, CalendarTask, ChatMessage } from '../types';
import { calendarService, setCalendarToken } from '../services/calendar';
import { ChronosBrain, decodeAudio, playPcmAudio } from '../services/gemini.client';
import { format, eachDayOfInterval, addDays, isSameDay, parseISO, addMinutes, startOfDay, endOfDay, subDays } from 'date-fns';
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
  CpuChipIcon
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
  const [activeTab, setActiveTab] = useState<'calendar' | 'tasks' | 'settings' | 'chat'>('calendar');

  const brainRef = useRef<ChronosBrain | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  // Set AI tab as default on mobile on initial load
  useEffect(() => {
    const isMobile = window.innerWidth < 1024;
    if (isMobile) {
      setActiveTab('chat');
    }
  }, []);

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
    if (activeTab === 'chat' || (typeof window !== 'undefined' && window.innerWidth >= 1024)) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, activeTab]);

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
      const eEnd = e.isAllDay ? subDays(parseISO(e.end), 0) : parseISO(e.end);
      
      if (e.isAllDay) {
        const exclusiveEnd = parseISO(e.end);
        return eStart < dayEnd && exclusiveEnd > dayStart;
      }
      
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
      <div className="h-[100dvh] flex items-center justify-center bg-[#f8fafc]">
        <div className="flex flex-col items-center gap-4">
          <SparklesIcon className="w-12 h-12 text-blue-600 animate-bounce" />
          <p className="text-slate-500 font-bold">Synchronizing Time...</p>
        </div>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="h-[100dvh] flex items-center justify-center bg-[#f8fafc] p-6 overflow-hidden">
        <div className="max-w-md w-full bg-white p-8 lg:p-12 rounded-[2.5rem] shadow-2xl border border-slate-100 text-center space-y-8 animate-in fade-in zoom-in duration-500">
          <div className="w-20 h-20 lg:w-24 lg:h-24 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-3xl flex items-center justify-center text-white text-4xl lg:text-5xl font-bold mx-auto shadow-2xl rotate-3">C</div>
          <div className="space-y-2">
            <h1 className="text-3xl lg:text-4xl font-extrabold text-slate-900 tracking-tight">Chronos AI</h1>
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
    <div className="flex flex-col lg:flex-row h-[100dvh] max-h-[100dvh] bg-[#f8fafc] font-sans text-slate-900 overflow-hidden overscroll-none">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-64 bg-white border-r border-slate-200 flex-col p-4 space-y-8">
        <div className="flex items-center gap-4 px-2">
          <div className="w-10 h-10 min-w-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-lg">C</div>
          <span className="font-bold text-xl tracking-tight">Chronos AI</span>
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
            <div className="overflow-hidden flex-1"><p className="text-sm font-bold truncate">{session?.user?.name}</p></div>
          </div>
        </div>
      </aside>

      {/* Main Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden pb-16 lg:pb-0">
        <header className="h-16 lg:h-20 flex items-center justify-between px-4 lg:px-8 bg-white border-b border-slate-200 flex-shrink-0">
          <div className="flex items-center gap-2 lg:gap-6">
             <div className="flex items-center gap-1 lg:gap-2">
                <button onClick={() => setCurrentDate(prev => addDays(prev, -1))} className="p-1.5 lg:p-2 hover:bg-slate-100 rounded-xl text-slate-400 transition-colors"><ChevronLeftIcon className="w-4 h-4 lg:w-5 lg:h-5"/></button>
                <button onClick={() => setCurrentDate(new Date())} className="px-2 lg:px-4 py-1 lg:py-1.5 text-[10px] lg:text-xs font-bold bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors">Today</button>
                <button onClick={() => setCurrentDate(prev => addDays(prev, 1))} className="p-1.5 lg:p-2 hover:bg-slate-100 rounded-xl text-slate-400 transition-colors"><ChevronRightIcon className="w-4 h-4 lg:w-5 lg:h-5"/></button>
             </div>
             <h2 className="text-sm lg:text-2xl font-black tracking-tight text-slate-900 truncate max-w-[120px] lg:max-w-none">{format(currentDate, 'MMMM yyyy')}</h2>
          </div>
          <button onClick={refreshData} className="p-2 lg:p-2.5 hover:bg-slate-100 rounded-xl text-slate-500 transition-all active:rotate-180">
            <ArrowPathIcon className={cn("w-4 h-4 lg:w-5 lg:h-5", isProcessing && "animate-spin")} />
          </button>
        </header>

        <main className="flex-1 overflow-hidden p-3 lg:p-6 flex flex-col min-h-0">
          {activeTab === 'calendar' && (
            <div className="flex-1 bg-white rounded-[2rem] lg:rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-0">
              <div className="grid grid-cols-3 border-b border-slate-100 bg-slate-50/30 flex-shrink-0">
                {displayDays.map(day => (
                  <div key={day.toISOString()} className="flex flex-col items-center justify-center py-2 lg:py-4 border-l first:border-l-0 border-slate-100">
                    <span className="text-[8px] lg:text-[10px] font-bold text-slate-400 uppercase tracking-widest">{format(day, 'EEE')}</span>
                    <div className="flex items-center gap-1 lg:gap-3 mt-1">
                      <span className={cn("text-sm lg:text-lg font-black h-8 w-8 lg:h-10 lg:w-10 flex items-center justify-center rounded-lg lg:rounded-xl transition-all", isSameDay(day, new Date()) ? "bg-blue-600 text-white shadow-lg shadow-blue-200" : "text-slate-800")}>{format(day, 'd')}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 overflow-hidden min-h-0">
                {/* Mobile: Single-column events scrollable area */}
                <div className="lg:hidden flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-white overscroll-contain">
                  {getEventsForDay(currentDate).map(e => (
                    <EventCard key={e.id} event={e} onClick={() => { setActiveTab('chat'); handleSendMessage(`Tell me about ${e.summary}`); }} />
                  ))}
                  {getEventsForDay(currentDate).length === 0 && <EmptyDayView />}
                </div>
                {/* Desktop Multi-column view */}
                {displayDays.map(day => (
                  <div key={day.toISOString()} className="hidden lg:block border-l first:border-l-0 border-slate-100 p-4 space-y-4 overflow-y-auto custom-scrollbar hover:bg-slate-50/50 transition-colors overscroll-contain">
                    {getEventsForDay(day).map(e => (
                      <EventCard key={e.id} event={e} onClick={() => handleSendMessage(`Tell me about ${e.summary}`)} />
                    ))}
                    {getEventsForDay(day).length === 0 && <EmptyDayView />}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'tasks' && (
            <div className="flex-1 bg-white rounded-[2rem] lg:rounded-3xl border border-slate-200 shadow-sm overflow-y-auto p-4 lg:p-8 custom-scrollbar overscroll-contain min-h-0">
              <div className="max-w-2xl mx-auto space-y-6 lg:space-y-8">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xl lg:text-2xl font-black flex items-center gap-2 lg:gap-3 text-slate-900"><ListBulletIcon className="w-6 h-6 lg:w-7 lg:h-7 text-blue-600" />Active Focus</h3>
                    <p className="text-slate-400 text-xs lg:text-sm font-medium mt-1">Keep track of your priorities.</p>
                  </div>
                  <span className="px-3 py-1 lg:px-4 lg:py-1.5 bg-blue-50 text-blue-600 rounded-full text-[10px] lg:text-xs font-black uppercase tracking-widest">{tasks.filter(t => !t.completed).length} Pending</span>
                </div>
                <div className="space-y-3 lg:space-y-4 pb-4">
                  {tasks.length > 0 ? tasks.map(task => (
                    <div key={task.id} className={cn("group flex items-center justify-between p-4 lg:p-5 rounded-2xl border transition-all duration-300", task.completed ? "bg-slate-50 border-slate-100 opacity-60" : "bg-white border-slate-200 hover:border-blue-300 hover:shadow-xl")}>
                      <div className="flex items-center gap-4 lg:gap-5 cursor-pointer flex-1" onClick={() => toggleTask(task)}>
                        <div className={cn("w-7 h-7 lg:w-8 lg:h-8 rounded-lg lg:rounded-xl border-2 flex items-center justify-center transition-all", task.completed ? "bg-green-500 border-green-500" : "border-slate-200 bg-white")}>{task.completed && <CheckIcon className="w-4 h-4 lg:w-5 lg:h-5 text-white stroke-[4]" />}</div>
                        <div className="flex-1">
                          <p className={cn("font-bold text-slate-900 text-base lg:text-lg", task.completed && "line-through text-slate-400")}>{task.title}</p>
                          {task.due && <p className="text-[10px] lg:text-xs text-slate-400 font-bold mt-1 uppercase tracking-tighter flex items-center gap-1"><ClockIcon className="w-3 h-3"/> {format(parseISO(task.due), 'MMM d, yyyy')}</p>}
                        </div>
                      </div>
                      <button onClick={() => handleSendMessage(`Delete task ${task.title}`)} className="p-2 lg:p-3 text-slate-300 hover:text-red-500 transition-all opacity-100 lg:opacity-0 lg:group-hover:opacity-100"><TrashIcon className="w-5 h-5"/></button>
                    </div>
                  )) : (
                    <div className="text-center py-12 lg:py-20 bg-slate-50/50 rounded-3xl border border-dashed border-slate-200">
                      <ListBulletIcon className="w-10 h-10 lg:w-12 lg:h-12 text-slate-200 mx-auto mb-4" />
                      <p className="text-slate-400 font-bold text-sm">No tasks found. Try asking Chronos to create one!</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
             <div className="flex-1 bg-white rounded-[2rem] lg:rounded-3xl border border-slate-200 shadow-sm p-6 lg:p-12 max-w-2xl mx-auto w-full text-center flex flex-col justify-center overflow-y-auto overscroll-contain min-h-0">
                <div className="w-20 h-20 lg:w-24 lg:h-24 bg-slate-100 rounded-[1.75rem] lg:rounded-[2rem] mx-auto mb-6 lg:mb-8 flex items-center justify-center">
                  <Cog6ToothIcon className="w-10 h-10 lg:w-12 lg:h-12 text-slate-400" />
                </div>
                <h3 className="text-xl lg:text-2xl font-black mb-2 text-slate-900">Account Control</h3>
                <p className="text-slate-500 mb-8 lg:mb-12 text-sm lg:text-base font-medium">Your account is connected through Google. Disconnecting will remove your access until you sign in again.</p>
                <button onClick={() => signOut()} className="w-full flex items-center justify-center gap-3 p-4 lg:p-6 bg-red-50 text-red-600 rounded-2xl font-black uppercase tracking-widest hover:bg-red-100 transition-all active:scale-95">
                  <ArrowLeftOnRectangleIcon className="w-5 h-5 lg:w-6 lg:h-6" />
                  <span>Disconnect Account</span>
                </button>
             </div>
          )}

          {activeTab === 'chat' && (
            <div className="lg:hidden flex-1 flex flex-col bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden min-h-0">
               <ChatInterface 
                  messages={messages} 
                  inputText={inputText} 
                  setInputText={setInputText} 
                  isProcessing={isProcessing} 
                  isListening={isListening} 
                  toggleListening={toggleListening} 
                  handleSendMessage={handleSendMessage} 
                  handleDurationSelection={handleDurationSelection} 
                  handlePickEvent={handlePickEvent} 
                  handleConfirmedAction={handleConfirmedAction}
                  setMessages={setMessages}
                  chatEndRef={chatEndRef}
               />
            </div>
          )}
        </main>
      </div>

      {/* Desktop Chat Sidebar */}
      <div className="hidden lg:flex w-[400px] xl:w-[440px] bg-white border-l border-slate-200 flex-col shadow-2xl z-20 overflow-hidden h-full">
        <header className="h-20 flex items-center px-8 border-b border-slate-100 justify-between flex-shrink-0">
          <div className="flex items-center">
            <div className="w-2.5 h-2.5 rounded-full bg-green-500 mr-3 shadow-lg shadow-green-200 animate-pulse" />
            <h3 className="font-black text-slate-900 tracking-tighter text-xl">Assistant</h3>
          </div>
          <SparklesIcon className="w-5 h-5 text-blue-500" />
        </header>
        <ChatInterface 
          messages={messages} 
          inputText={inputText} 
          setInputText={setInputText} 
          isProcessing={isProcessing} 
          isListening={isListening} 
          toggleListening={toggleListening} 
          handleSendMessage={handleSendMessage} 
          handleDurationSelection={handleDurationSelection} 
          handlePickEvent={handlePickEvent} 
          handleConfirmedAction={handleConfirmedAction}
          setMessages={setMessages}
          chatEndRef={chatEndRef}
        />
      </div>

      {/* Mobile Tab Bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex items-center justify-around h-16 z-50 px-2 pb-safe shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
         <MobileNavItem icon={<Squares2X2Icon className="w-6 h-6"/>} active={activeTab === 'calendar'} onClick={() => setActiveTab('calendar')} label="Schedule" />
         <MobileNavItem icon={<ListBulletIcon className="w-6 h-6"/>} active={activeTab === 'tasks'} onClick={() => setActiveTab('tasks')} label="Tasks" />
         <MobileNavItem icon={<CpuChipIcon className="w-7 h-7"/>} active={activeTab === 'chat'} onClick={() => setActiveTab('chat')} label="AI" />
         <MobileNavItem icon={<Cog6ToothIcon className="w-6 h-6"/>} active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} label="Account" />
      </nav>
    </div>
  );
}

function EventCard({ event, onClick }: { event: CalendarEvent, onClick: () => void }) {
  const startDt = parseISO(event.start);
  const endDt = parseISO(event.end);
  const isMultiDay = event.isAllDay 
    ? !isSameDay(startDt, subDays(endDt, 1))
    : !isSameDay(startDt, endDt);

  return (
    <div onClick={onClick} className={cn(
      "bg-white border p-3 lg:p-4 rounded-2xl shadow-sm hover:shadow-md transition-all cursor-pointer group hover:border-blue-400 relative overflow-hidden",
      isMultiDay ? "border-l-4 border-l-blue-500" : "border-slate-200"
    )}>
      {isMultiDay && <div className="absolute top-0 right-0 p-1.5"><SparklesIcon className="w-3 h-3 text-blue-300"/></div>}
      <p className="text-sm font-bold text-slate-900 group-hover:text-blue-600 transition-colors leading-snug">{event.summary}</p>
      <div className="flex items-center gap-1.5 mt-2">
        <ClockIcon className="w-3.5 h-3.5 text-slate-400" />
        <p className="text-[10px] lg:text-[11px] text-slate-500 font-bold uppercase tracking-tight">
          {event.isAllDay ? 'All Day' : `${format(startDt, 'h:mm a')} - ${format(endDt, 'h:mm a')}`}
        </p>
      </div>
      {isMultiDay && (
        <p className="text-[9px] text-slate-400 font-bold mt-1.5 uppercase">
          {format(startDt, 'MMM d')} → {format(event.isAllDay ? subDays(endDt, 1) : endDt, 'MMM d')}
        </p>
      )}
    </div>
  );
}

function EmptyDayView() {
  return (
    <div className="h-full py-10 flex flex-col items-center justify-center opacity-10">
      <CalendarDaysIcon className="w-10 h-10 text-slate-300" />
      <p className="text-[10px] font-bold mt-2 uppercase tracking-widest">Clear Schedule</p>
    </div>
  );
}

function ChatInterface({ 
  messages, inputText, setInputText, isProcessing, isListening, toggleListening, 
  handleSendMessage, handleDurationSelection, handlePickEvent, handleConfirmedAction, setMessages, chatEndRef 
}: any) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden h-full">
      <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-6 custom-scrollbar bg-slate-50/40 overscroll-contain">
        {messages.length === 0 && (
           <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-4 opacity-40">
              <ChatBubbleLeftRightIcon className="w-12 h-12 text-slate-300" />
              <p className="text-slate-400 font-bold text-sm lg:text-base italic">Say something like "Schedule a lunch meeting for tomorrow at 2pm"</p>
           </div>
        )}
        {messages.map((m: ChatMessage) => (
          <div key={m.id} className={cn("flex flex-col animate-in slide-in-from-bottom-2 duration-300", m.role === 'user' ? 'items-end' : 'items-start')}>
            <div className={cn("max-w-[95%] p-4 lg:p-5 rounded-[1.75rem] text-sm leading-relaxed shadow-sm", m.role === 'user' ? 'bg-slate-900 text-white font-medium rounded-br-none' : 'bg-white text-slate-800 border border-slate-100 rounded-bl-none')}>
              {m.content}
              
              {m.ui?.type === 'duration' && (
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {m.ui.options?.map((mins: number) => (
                    <button key={mins} onClick={() => handleDurationSelection(mins, m.ui?.pending)} className="py-2.5 px-1 text-[10px] font-black border border-slate-100 rounded-xl hover:bg-blue-600 hover:text-white transition-all">{mins}m</button>
                  ))}
                </div>
              )}

              {m.ui?.type === 'pick' && (
                <div className="mt-4 space-y-2">
                  {m.ui.options?.map((ev: CalendarEvent) => (
                    <button key={ev.id} onClick={() => handlePickEvent(ev, m.ui?.pending)} className="w-full text-left p-3 text-xs border border-slate-100 rounded-2xl hover:bg-blue-50 transition-all">
                      <p className="font-black text-slate-900 mb-0.5">{ev.summary}</p>
                      <p className="text-[9px] text-slate-500 font-bold uppercase">{format(parseISO(ev.start), 'MMM d @ h:mm a')}</p>
                    </button>
                  ))}
                </div>
              )}

              {m.ui?.type === 'confirm' && (
                <div className="mt-4 flex flex-col sm:flex-row gap-2">
                  <button onClick={() => handleConfirmedAction(m.ui?.pending)} className={cn("flex-1 py-3 lg:py-4 rounded-xl lg:rounded-2xl text-[10px] font-black uppercase tracking-widest text-white shadow-lg transition-all", m.ui.action?.includes('delete') || m.ui.action === 'clear_day' ? 'bg-red-600' : 'bg-blue-600')}>Confirm</button>
                  <button onClick={() => setMessages((prev: ChatMessage[]) => prev.filter(msg => msg.id !== m.id))} className="flex-1 bg-slate-100 text-slate-600 py-3 lg:py-4 rounded-xl lg:rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all">Cancel</button>
                </div>
              )}
            </div>
            <span className="text-[8px] lg:text-[9px] text-slate-400 font-black mt-1.5 px-3 uppercase tracking-tighter">{format(m.timestamp, 'h:mm a')}</span>
          </div>
        ))}
        {isProcessing && (
          <div className="flex gap-1.5 p-3 items-center bg-white rounded-full border border-slate-100 shadow-sm w-fit animate-pulse">
            <div className="w-1 h-1 bg-blue-600 rounded-full animate-bounce" />
            <div className="w-1 h-1 bg-blue-600 rounded-full animate-bounce [animation-delay:0.2s]" />
            <div className="w-1 h-1 bg-blue-600 rounded-full animate-bounce [animation-delay:0.4s]" />
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <div className="p-4 lg:p-8 border-t border-slate-100 bg-white flex-shrink-0">
        <div className="relative group">
          <input 
            value={inputText} 
            onChange={e => setInputText(e.target.value)} 
            onKeyDown={e => e.key === 'Enter' && handleSendMessage()} 
            placeholder="Tell Chronos what's next..." 
            className="w-full bg-slate-50 border-none rounded-2xl lg:rounded-[1.75rem] pl-4 lg:pl-7 pr-20 lg:pr-24 py-4 lg:py-5 text-base font-semibold focus:ring-2 lg:focus:ring-4 focus:ring-blue-100 transition-all placeholder:text-slate-300" 
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
            <button onClick={toggleListening} className={cn("p-2 rounded-xl transition-all", isListening ? 'bg-red-500 text-white shadow-lg' : 'text-slate-400 hover:text-slate-900')}>
              {isListening ? <StopIcon className="w-5 h-5 lg:w-6 lg:h-6" /> : <MicrophoneIcon className="w-5 h-5 lg:w-6 lg:h-6" />}
            </button>
            <button onClick={() => handleSendMessage()} disabled={!inputText.trim() || isProcessing} className="p-2 bg-blue-600 text-white rounded-xl disabled:opacity-30 transition-all shadow-md lg:shadow-lg shadow-blue-100 disabled:shadow-none">
              <PaperAirplaneIcon className="w-5 h-5 lg:w-6 lg:h-6" />
            </button>
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

function MobileNavItem({ icon, active, onClick, label }: any) {
  return (
    <button onClick={onClick} className={cn("flex flex-col items-center justify-center gap-1 flex-1 transition-all h-full", active ? "text-blue-600" : "text-slate-400")}>
       <div className={cn("transition-transform duration-300", active && "scale-110")}>{icon}</div>
       <span className="text-[10px] font-black uppercase tracking-tighter">{label}</span>
       {active && <div className="w-1 h-1 bg-blue-600 rounded-full mt-0.5" />}
    </button>
  );
}