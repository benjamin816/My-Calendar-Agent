
"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSession, signIn, signOut } from "next-auth/react";
import { CalendarEvent, CalendarTask, ChatMessage, CalendarViewType } from '../types';
import { calendarService, setCalendarToken } from '../services/calendar';
import { ChronosBrain, decodeAudio, playPcmAudio } from '../services/gemini.client';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, addDays, isSameDay, parseISO, compareAsc } from 'date-fns';
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
  ClockIcon
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
      if (e.message === 'AUTH_EXPIRED') {
        signIn('google');
      }
    }
  }, [session]);

  useEffect(() => {
    if (status === 'authenticated') {
      refreshData();
    }
  }, [status, refreshData]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (text?: string, voice: boolean = false) => {
    const msg = text || inputText;
    if (!msg.trim() || !session?.accessToken) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: msg,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setIsProcessing(true);

    try {
      const responseText = await brainRef.current?.processMessage(msg, refreshData, session.accessToken as string);
      if (responseText) {
        const assistantMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: responseText,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, assistantMsg]);
        
        if (voice) {
          const audioBase64 = await brainRef.current?.generateSpeech(responseText);
          if (audioBase64) {
            playPcmAudio(decodeAudio(audioBase64));
          }
        }
      }
    } catch (error: any) {
      console.error(error);
      const errorMsg: ChatMessage = {
        id: Date.now().toString(),
        role: 'system',
        content: `Error: ${error.message}`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMsg]);
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

  const weekDays = useMemo(() => {
    const start = startOfWeek(currentDate);
    const end = endOfWeek(currentDate);
    return eachDayOfInterval({ start, end });
  }, [currentDate]);

  const getDayItems = (day: Date) => {
    const dayEvents = events.filter(e => isSameDay(parseISO(e.start), day));
    const dayTasks = tasks.filter(t => t.due && isSameDay(parseISO(t.due), day));
    
    const sorted = [...dayEvents.map(e => ({ type: 'event' as const, ...e })), ...dayTasks.map(t => ({ type: 'task' as const, ...t }))];
    return sorted.sort((a, b) => {
      const timeA = 'start' in a ? parseISO(a.start) : parseISO(a.due!);
      const timeB = 'start' in b ? parseISO(b.start) : parseISO(b.due!);
      return compareAsc(timeA, timeB);
    });
  };

  const toggleTask = async (task: CalendarTask) => {
    if (!session?.accessToken) return;
    try {
      await calendarService.updateTask(task.id, { completed: !task.completed }, session.accessToken as string);
      refreshData();
    } catch (e) {
      console.error(e);
    }
  };

  // Logic to show duration buttons if the last assistant message mentions duration
  const showDurationPresets = useMemo(() => {
    if (messages.length === 0 || isProcessing) return false;
    const lastMsg = messages[messages.length - 1];
    return lastMsg.role === 'assistant' && (
      lastMsg.content.toLowerCase().includes('how long') || 
      lastMsg.content.toLowerCase().includes('duration') ||
      lastMsg.content.toLowerCase().includes('minutes')
    );
  }, [messages, isProcessing]);

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
          <div className="space-y-4">
            <button 
              onClick={() => signIn('google')}
              className="w-full bg-slate-900 text-white py-4 px-6 rounded-2xl font-bold hover:bg-slate-800 transition-all flex items-center justify-center gap-3 shadow-lg hover:shadow-xl active:scale-95"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Sign in with Google
            </button>
            <p className="text-xs text-slate-400 leading-relaxed">
              We need access to your Google Calendar and Tasks to help manage your day effectively.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#f8fafc] font-sans text-slate-900 overflow-hidden">
      {/* Sidebar Navigation */}
      <aside className="w-20 lg:w-64 bg-white border-r border-slate-200 flex flex-col p-4 space-y-8 transition-all">
        <div className="flex items-center gap-4 px-2">
          <div className="w-10 h-10 min-w-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-lg">C</div>
          <span className="font-bold text-xl hidden lg:block tracking-tight">Chronos AI</span>
        </div>

        <nav className="flex-1 space-y-1">
          <SidebarItem 
            icon={<Squares2X2Icon className="w-6 h-6" />} 
            label="Dashboard" 
            active={activeTab === 'calendar'} 
            onClick={() => setActiveTab('calendar')} 
          />
          <SidebarItem 
            icon={<ListBulletIcon className="w-6 h-6" />} 
            label="Tasks" 
            active={activeTab === 'tasks'} 
            onClick={() => setActiveTab('tasks')} 
          />
          <SidebarItem 
            icon={<Cog6ToothIcon className="w-6 h-6" />} 
            label="Settings" 
            active={activeTab === 'settings'}
            onClick={() => setActiveTab('settings')}
          />
        </nav>

        <div className="px-2 pb-4">
          <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-100">
            {session?.user?.image ? (
              <img src={session.user.image} className="w-8 h-8 rounded-full shadow-sm" alt="User" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-orange-400 to-rose-400 shadow-sm" />
            )}
            <div className="hidden lg:block overflow-hidden">
              <p className="text-sm font-bold truncate">{session?.user?.name || 'User'}</p>
              <p className="text-[10px] text-slate-400 truncate">Connected</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-20 flex items-center justify-between px-8 bg-white border-b border-slate-200">
          <div className="flex items-center gap-6">
             <div className="flex items-center gap-2">
                <button 
                  onClick={() => setCurrentDate(addDays(currentDate, -7))}
                  className="p-2 hover:bg-slate-100 rounded-xl transition-colors text-slate-400"
                >
                  <ChevronLeftIcon className="w-5 h-5"/>
                </button>
                <button 
                  onClick={() => setCurrentDate(addDays(currentDate, 7))}
                  className="p-2 hover:bg-slate-100 rounded-xl transition-colors text-slate-400"
                >
                  <ChevronRightIcon className="w-5 h-5"/>
                </button>
             </div>
             <h2 className="text-2xl font-bold tracking-tight">
               {activeTab === 'settings' ? 'Settings' : format(currentDate, 'MMMM yyyy')}
             </h2>
          </div>

          <div className="flex items-center gap-3">
            <button 
              onClick={refreshData}
              className="p-2.5 hover:bg-slate-100 rounded-xl transition-colors text-slate-500 group"
            >
              <ArrowPathIcon className={cn("w-5 h-5", isProcessing && "animate-spin")} />
            </button>
            <button 
              onClick={() => handleSendMessage("Show my agenda for this week")}
              className="bg-blue-600 text-white px-5 py-2.5 rounded-xl font-bold text-sm shadow-md hover:shadow-lg hover:bg-blue-700 transition-all active:scale-95 flex items-center gap-2"
            >
              <PlusIcon className="w-5 h-5" />
              <span>Ask Chronos</span>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-hidden flex flex-col p-6 space-y-6">
          {activeTab === 'calendar' && (
            <div className="flex-1 bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
              <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/50">
                {weekDays.map(day => (
                  <div key={day.toISOString()} className="flex flex-col items-center justify-center py-3 border-l first:border-l-0 border-slate-100">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{format(day, 'EEE')}</span>
                    <span className={cn(
                      "text-xl font-bold mt-1 h-9 w-9 flex items-center justify-center rounded-full transition-colors",
                      isSameDay(day, new Date()) ? "bg-blue-600 text-white" : "text-slate-800"
                    )}>
                      {format(day, 'd')}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex-1 grid grid-cols-7 overflow-hidden">
                {weekDays.map(day => (
                  <div key={day.toISOString()} className="border-l first:border-l-0 border-slate-100 overflow-y-auto custom-scrollbar p-3 space-y-3 bg-white/50">
                    {getDayItems(day).map((item: any) => (
                      <div 
                        key={item.id} 
                        className={cn(
                          "p-3 rounded-2xl border transition-all cursor-pointer group/card",
                          item.type === 'event' 
                            ? "bg-blue-50/50 border-blue-100 hover:border-blue-300" 
                            : "bg-slate-50/80 border-slate-100 hover:border-slate-300"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                           <p className={cn("text-xs font-bold leading-tight", item.type === 'event' ? "text-blue-900" : "text-slate-900")}>
                             {item.type === 'event' ? item.summary : item.title}
                           </p>
                           {item.type === 'event' && <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1" />}
                        </div>
                        
                        <div className="flex items-center gap-1.5 mt-2">
                          <ClockIcon className="w-3 h-3 text-slate-400" />
                          <p className="text-[10px] font-bold text-slate-400">
                             {item.type === 'event' ? format(parseISO(item.start), 'h:mm a') : 'All Day'}
                          </p>
                        </div>

                        {item.type === 'task' && item.completed && (
                          <div className="mt-2 flex items-center gap-1 text-[10px] text-green-600 font-bold">
                             <CheckIcon className="w-3 h-3" />
                             Done
                          </div>
                        )}
                      </div>
                    ))}
                    {getDayItems(day).length === 0 && (
                      <div className="h-full flex flex-col items-center justify-center opacity-20 py-20">
                         <CalendarIcon className="w-10 h-10 text-slate-300" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'tasks' && (
            <div className="flex-1 bg-white rounded-3xl border border-slate-200 shadow-sm overflow-y-auto p-8 space-y-8 custom-scrollbar">
              <div className="max-w-3xl mx-auto space-y-6">
                <h3 className="text-2xl font-bold flex items-center gap-3">
                  <ListBulletIcon className="w-7 h-7 text-blue-600" />
                  My Tasks
                </h3>
                
                <div className="space-y-3">
                  {tasks.length === 0 ? (
                    <div className="text-center py-12 bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200">
                      <p className="text-slate-400 font-medium">No tasks found. Tell Chronos to add some!</p>
                    </div>
                  ) : (
                    tasks.map(task => (
                      <div 
                        key={task.id} 
                        className={cn(
                          "group flex items-center justify-between p-5 rounded-2xl border transition-all cursor-pointer",
                          task.completed ? "bg-slate-50 border-slate-100 opacity-60" : "bg-white border-slate-200 hover:border-blue-400 hover:shadow-lg"
                        )}
                        onClick={() => toggleTask(task)}
                      >
                        <div className="flex items-center gap-4">
                          <div className={cn(
                            "w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all",
                            task.completed ? "bg-green-500 border-green-500" : "border-slate-300 group-hover:border-blue-500"
                          )}>
                            {task.completed && <CheckIcon className="w-4 h-4 text-white" />}
                          </div>
                          <div>
                            <p className={cn("font-bold text-lg", task.completed && "line-through text-slate-400")}>{task.title}</p>
                            {task.due && (
                              <p className="text-xs text-slate-400 font-medium mt-1">Due {format(parseISO(task.due), 'MMM d, h:mm a')}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="flex-1 bg-white rounded-3xl border border-slate-200 shadow-sm overflow-y-auto p-8 space-y-8 custom-scrollbar">
              <div className="max-w-3xl mx-auto space-y-12">
                <section className="space-y-6">
                  <h3 className="text-xl font-bold text-slate-900 border-b pb-4">Account Information</h3>
                  <div className="flex items-center gap-6 p-6 bg-slate-50 rounded-3xl border border-slate-100">
                    <img src={session?.user?.image || ''} className="w-20 h-20 rounded-full border-4 border-white shadow-lg" alt="Avatar" />
                    <div>
                      <p className="text-xl font-bold">{session?.user?.name}</p>
                      <p className="text-slate-500 font-medium">{session?.user?.email}</p>
                      <div className="mt-3 inline-flex items-center gap-2 bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full text-xs font-bold">
                        <CheckIcon className="w-3 h-3" />
                        Google Calendar Connected
                      </div>
                    </div>
                  </div>
                </section>

                <section className="space-y-6">
                  <h3 className="text-xl font-bold text-slate-900 border-b pb-4">Actions</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <button 
                       onClick={() => signIn('google')}
                       className="flex items-center gap-4 p-5 bg-white border border-slate-200 rounded-2xl hover:border-blue-500 hover:shadow-md transition-all text-left"
                     >
                        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600">
                          <ArrowPathIcon className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="font-bold">Reconnect Account</p>
                          <p className="text-xs text-slate-400">Refresh calendar permissions</p>
                        </div>
                     </button>
                     <button 
                       onClick={() => signOut()}
                       className="flex items-center gap-4 p-5 bg-white border border-slate-200 rounded-2xl hover:border-red-500 hover:shadow-md transition-all text-left group"
                     >
                        <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center text-red-600 group-hover:bg-red-500 group-hover:text-white transition-colors">
                          <ArrowLeftOnRectangleIcon className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="font-bold">Sign Out</p>
                          <p className="text-xs text-slate-400">Disconnect from Chronos AI</p>
                        </div>
                     </button>
                  </div>
                </section>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Right Drawer: Chronos Brain */}
      <div className="w-[400px] bg-white border-l border-slate-200 flex flex-col shadow-[-10px_0_20px_rgba(0,0,0,0.02)] z-20">
        <header className="h-20 flex items-center px-8 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600">
              <ChatBubbleLeftRightIcon className="w-5 h-5" />
            </div>
            <h3 className="font-extrabold text-lg">Chronos Brain</h3>
          </div>
          <div className="ml-auto">
            <div className={cn(
              "w-2.5 h-2.5 rounded-full",
              isProcessing ? "bg-amber-400 animate-pulse" : "bg-emerald-400"
            )} />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar bg-gradient-to-b from-white to-slate-50/50">
          {messages.length === 0 && (
             <div className="text-center py-12 space-y-4 px-4">
                <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center text-blue-600 mx-auto animate-bounce">
                  <CalendarIcon className="w-8 h-8" />
                </div>
                <h4 className="font-bold text-slate-800">Hello, I'm Chronos</h4>
                <p className="text-sm text-slate-500 leading-relaxed">
                  I can manage your schedule and tasks. Try saying:<br/>
                  <span className="italic">"Schedule a dinner date tomorrow at 6 PM"</span> or 
                  <span className="italic"> "What's my agenda for today?"</span>
                </p>
             </div>
          )}
          
          {messages.map((m) => (
            <div key={m.id} className={cn("flex flex-col animate-in slide-in-from-bottom-2 duration-300", m.role === 'user' ? 'items-end' : 'items-start')}>
              <div className={cn(
                "max-w-[85%] p-4 rounded-3xl text-sm shadow-sm",
                m.role === 'user' 
                  ? 'bg-blue-600 text-white rounded-tr-none' 
                  : m.role === 'system'
                  ? 'bg-red-50 text-red-600 border border-red-100 rounded-tl-none'
                  : 'bg-white border border-slate-100 text-slate-800 rounded-tl-none font-medium whitespace-pre-wrap'
              )}>
                {m.content}
              </div>
              <span className="text-[10px] text-slate-300 font-bold mt-1 uppercase tracking-tight px-1">
                {format(m.timestamp, 'h:mm a')}
              </span>
            </div>
          ))}

          {isProcessing && (
            <div className="flex items-start gap-2 animate-in fade-in duration-300">
               <div className="flex gap-1.5 p-3 bg-white border border-slate-100 rounded-2xl rounded-tl-none">
                 <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                 <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                 <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
               </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        <div className="p-6 border-t border-slate-100 bg-white">
          {showDurationPresets && (
            <div className="flex flex-wrap gap-2 mb-4 animate-in slide-in-from-bottom-4">
              {['15m', '30m', '45m', '1h', '2h', '3h'].map(preset => (
                <button
                  key={preset}
                  onClick={() => handleSendMessage(preset)}
                  className="px-3 py-1.5 bg-blue-50 text-blue-600 border border-blue-100 rounded-full text-xs font-bold hover:bg-blue-600 hover:text-white transition-all active:scale-95"
                >
                  {preset}
                </button>
              ))}
            </div>
          )}

          <div className="relative group">
            <input 
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
              placeholder="Ask Chronos anything..."
              className="w-full bg-slate-50 border-none rounded-[1.5rem] pl-6 pr-24 py-5 text-sm font-medium focus:ring-2 focus:ring-blue-500 transition-all placeholder:text-slate-400 shadow-inner"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
              <button 
                onClick={toggleListening} 
                className={cn(
                  "p-2.5 rounded-2xl transition-all active:scale-90",
                  isListening ? 'bg-red-500 text-white shadow-lg animate-pulse' : 'bg-white text-slate-400 border border-slate-100 hover:text-blue-600'
                )}
              >
                {isListening ? <StopIcon className="w-5 h-5" /> : <MicrophoneIcon className="w-5 h-5" />}
              </button>
              <button 
                onClick={() => handleSendMessage()}
                disabled={!inputText.trim()}
                className="p-2.5 bg-blue-600 text-white rounded-2xl shadow-lg hover:shadow-xl hover:bg-blue-700 active:scale-90 disabled:opacity-50 transition-all"
              >
                <PaperAirplaneIcon className="w-5 h-5" />
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
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-4 p-4 rounded-2xl transition-all group relative",
        active ? "bg-blue-50 text-blue-600 font-bold" : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"
      )}
    >
      <div className={cn("transition-transform group-hover:scale-110", active && "scale-110")}>
        {icon}
      </div>
      <span className="hidden lg:block text-sm tracking-tight">{label}</span>
      {active && (
        <div className="absolute right-2 w-1.5 h-1.5 bg-blue-600 rounded-full hidden lg:block" />
      )}
    </button>
  );
}
