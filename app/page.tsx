
"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { CalendarEvent, CalendarTask, ChatMessage, CalendarViewType } from '../types';
import { calendarService, setCalendarToken } from '../services/calendar';
import { ChronosBrain, decodeAudio, playPcmAudio } from '../services/gemini.client';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, addDays, isSameDay, parseISO } from 'date-fns';
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
  PaperAirplaneIcon
} from '@heroicons/react/24/outline';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function ChronosApp() {
  const [token, setToken] = useState<string | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [activeTab, setActiveTab] = useState<'calendar' | 'tasks'>('calendar');

  const brainRef = useRef<ChronosBrain | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    brainRef.current = new ChronosBrain();
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
        handleSendMessage(transcript, true);
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
      console.error("Data refresh failed:", e);
    }
  }, [token]);

  useEffect(() => {
    if (token) refreshData();
  }, [token, refreshData]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (text?: string, voice: boolean = false) => {
    const msg = text || inputText;
    if (!msg.trim() || !token) return;

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
      const responseText = await brainRef.current?.processMessage(msg, refreshData, token);
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

  const hourRows = Array.from({ length: 15 }, (_, i) => i + 7); // 7 AM to 9 PM

  const getEventsForDayAndHour = (day: Date, hour: number) => {
    return events.filter(e => {
      const start = parseISO(e.start);
      return isSameDay(start, day) && start.getHours() === hour;
    });
  };

  const toggleTask = async (task: CalendarTask) => {
    try {
      await calendarService.updateTask(task.id, { completed: !task.completed });
      refreshData();
    } catch (e) {
      console.error(e);
    }
  };

  if (!token) {
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
              onClick={() => {
                const mockToken = "SIMULATED_TOKEN";
                localStorage.setItem('google_calendar_token', mockToken);
                setToken(mockToken);
                setCalendarToken(mockToken);
              }}
              className="w-full bg-slate-900 text-white py-4 px-6 rounded-2xl font-bold hover:bg-slate-800 transition-all flex items-center justify-center gap-3 shadow-lg hover:shadow-xl active:scale-95"
            >
              Sign in with Google
            </button>
            <p className="text-xs text-slate-400 leading-relaxed">
              To use this in production, set up OAuth 2.0 in Google Cloud Console. 
              Currently using a simulated login for demonstration.
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
            icon={<BellIcon className="w-6 h-6" />} 
            label="Notifications" 
          />
          <SidebarItem 
            icon={<Cog6ToothIcon className="w-6 h-6" />} 
            label="Settings" 
          />
        </nav>

        <div className="px-2 pb-4">
          <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-100">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-orange-400 to-rose-400 shadow-sm" />
            <div className="hidden lg:block overflow-hidden">
              <p className="text-sm font-bold truncate">Benjamin</p>
              <p className="text-[10px] text-slate-400 truncate">Pro Account</p>
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
               {format(currentDate, 'MMMM yyyy')}
             </h2>
          </div>

          <div className="flex items-center gap-3">
            <button 
              onClick={refreshData}
              className="p-2.5 hover:bg-slate-100 rounded-xl transition-colors text-slate-500 group"
            >
              <ArrowPathIcon className={cn("w-5 h-5", isProcessing && "animate-spin")} />
            </button>
            <button className="bg-blue-600 text-white px-5 py-2.5 rounded-xl font-bold text-sm shadow-md hover:shadow-lg hover:bg-blue-700 transition-all active:scale-95 flex items-center gap-2">
              <PlusIcon className="w-5 h-5" />
              <span>Create Event</span>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-hidden flex flex-col p-6 space-y-6">
          {activeTab === 'calendar' ? (
            <div className="flex-1 bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
              {/* Weekday Headers */}
              <div className="grid grid-cols-[80px_repeat(7,1fr)] border-b border-slate-100 bg-slate-50/50">
                <div className="h-14" />
                {weekDays.map(day => (
                  <div key={day.toISOString()} className="flex flex-col items-center justify-center py-3 border-l border-slate-100">
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

              {/* Time Grid */}
              <div className="flex-1 overflow-y-auto custom-scrollbar relative">
                {hourRows.map(hour => (
                  <div key={hour} className="grid grid-cols-[80px_repeat(7,1fr)] min-h-[100px] border-b border-slate-50 group">
                    <div className="text-right pr-4 pt-4 text-xs font-bold text-slate-300">
                      {hour > 12 ? `${hour - 12} PM` : `${hour} AM`}
                    </div>
                    {weekDays.map(day => {
                      const dayEvents = getEventsForDayAndHour(day, hour);
                      return (
                        <div key={day.toISOString()} className="border-l border-slate-50 p-1 relative group-hover:bg-slate-50/30 transition-colors">
                          {dayEvents.map(e => (
                            <div 
                              key={e.id} 
                              className="bg-blue-50 border-l-4 border-blue-500 p-2.5 rounded-r-lg mb-1 shadow-sm hover:shadow-md transition-all cursor-pointer group/event overflow-hidden"
                            >
                              <p className="text-xs font-bold text-blue-900 truncate leading-tight">{e.summary}</p>
                              <p className="text-[10px] text-blue-700/70 font-medium mt-0.5">{format(parseISO(e.start), 'h:mm a')}</p>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                ))}
                
                {/* Current Time Indicator */}
                {isSameDay(currentDate, new Date()) && (
                  <div 
                    className="absolute left-[80px] right-0 border-t-2 border-red-500 z-10 pointer-events-none flex items-center"
                    style={{ top: `${((new Date().getHours() - 7) * 100) + (new Date().getMinutes() / 60 * 100)}px` }}
                  >
                    <div className="w-3 h-3 bg-red-500 rounded-full -ml-1.5 shadow-sm" />
                  </div>
                )}
              </div>
            </div>
          ) : (
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
                  <span className="italic">"Schedule a meeting with Sarah for tomorrow at 2 PM"</span> or 
                  <span className="italic"> "What's my agenda for this week?"</span>
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
                  : 'bg-white border border-slate-100 text-slate-800 rounded-tl-none font-medium'
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

        <div className="p-8 border-t border-slate-100 bg-white">
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
