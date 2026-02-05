
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CalendarEvent, CalendarTask, ChatMessage, CalendarViewType } from './types';
import { calendarService, setCalendarToken } from './services/calendar';
import { ChronosBrain, decodeAudio, playPcmAudio } from './services/gemini';
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
  UserCircleIcon
} from '@heroicons/react/24/outline';

const CLIENT_ID = '171928887280-fogep1i46dnqfla2igkv0cjk16vi03at.apps.googleusercontent.com'; // Ideally set via env or config

const App: React.FC = () => {
  const [token, setToken] = useState<string | null>(localStorage.getItem('google_calendar_token'));
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
  const tokenClientRef = useRef<any>(null);

  // Initialize Google Auth
  useEffect(() => {
    const initGsi = () => {
      if (!(window as any).google) return;
      tokenClientRef.current = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks',
        callback: (resp: any) => {
          if (resp.error) return;
          setToken(resp.access_token);
          setCalendarToken(resp.access_token);
          localStorage.setItem('google_calendar_token', resp.access_token);
          refreshData();
        },
      });
    };
    
    const checkGsi = setInterval(() => {
      if ((window as any).google) {
        initGsi();
        clearInterval(checkGsi);
      }
    }, 100);

    return () => clearInterval(checkGsi);
  }, []);

  useEffect(() => {
    if (token) {
      setCalendarToken(token);
      refreshData();
      fetchUserProfile(token);
    }
  }, [token]);

  const fetchUserProfile = async (token: string) => {
    try {
      const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (resp.ok) setUser(await resp.json());
    } catch (e) {
      console.error("Failed to fetch user info", e);
    }
  };

  const handleLogin = () => {
    if (tokenClientRef.current) {
      tokenClientRef.current.requestAccessToken({ prompt: 'consent' });
    } else {
      alert("Google Identity Services not initialized. Is the Client ID correct?");
    }
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    setEvents([]);
    setTasks([]);
    localStorage.removeItem('google_calendar_token');
  };

  // Initialize brain and data
  useEffect(() => {
    brainRef.current = new ChronosBrain();
    
    // Setup Speech Recognition
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
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
      if (e.message === 'AUTH_EXPIRED') {
        handleLogout();
      }
      console.error(e);
    }
  }, [token]);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(scrollToBottom, [messages]);

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
      <div className="h-screen flex items-center justify-center bg-slate-50">
        <div className="max-w-md w-full bg-white p-10 rounded-3xl shadow-xl text-center space-y-6">
          <div className="w-20 h-20 bg-blue-600 rounded-2xl flex items-center justify-center text-white text-4xl font-bold mx-auto shadow-lg">C</div>
          <div>
            <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Chronos AI</h1>
            <p className="text-slate-500 mt-2">Connect your Google account to manage your life with AI.</p>
          </div>
          <button 
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-3 py-4 px-6 bg-white border border-slate-200 rounded-2xl font-bold text-slate-700 hover:bg-slate-50 transition-all shadow-sm"
          >
            <img src="https://www.gstatic.com/images/branding/product/1x/gsa_512dp.png" className="w-6 h-6" alt="Google" />
            Sign in with Google
          </button>
          <p className="text-xs text-slate-400">Requires access to your Calendar and Tasks.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Sidebar - Calendar & Tasks */}
      <div className="flex-1 flex flex-col min-w-0 border-r border-slate-200">
        {/* Header */}
        <header className="h-16 flex items-center justify-between px-6 bg-white border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold">C</div>
            <h1 className="text-xl font-bold tracking-tight text-slate-800">Chronos AI</h1>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex bg-slate-100 rounded-lg p-1">
              {Object.values(CalendarViewType).map(v => (
                <button
                  key={v}
                  onClick={() => setViewType(v)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${viewType === v ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  {v}
                </button>
              ))}
            </div>
            <div className="h-8 w-px bg-slate-200"></div>
            <div className="flex items-center gap-1">
              <button className="p-1 hover:bg-slate-100 rounded-full" onClick={() => setCurrentDate(new Date(currentDate.setDate(currentDate.getDate() - 7)))}><ChevronLeftIcon className="w-5 h-5 text-slate-500"/></button>
              <span className="text-sm font-bold min-w-[140px] text-center">{currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
              <button className="p-1 hover:bg-slate-100 rounded-full" onClick={() => setCurrentDate(new Date(currentDate.setDate(currentDate.getDate() + 7)))}><ChevronRightIcon className="w-5 h-5 text-slate-500"/></button>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <main className="flex-1 flex overflow-hidden">
          {/* Calendar Grid */}
          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar bg-slate-50/50">
            <CalendarGrid events={events} currentDate={currentDate} />
          </div>

          {/* Right Panel - Tasks & Profile */}
          <div className="w-80 bg-white border-l border-slate-200 flex flex-col">
            <div className="p-6 border-b border-slate-50">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <CheckCircleIcon className="w-5 h-5 text-blue-600" />
                  Real Tasks
                </h2>
                <button className="p-1 text-blue-600 hover:bg-blue-50 rounded" onClick={refreshData}><PlusIcon className="w-5 h-5"/></button>
              </div>
              <div className="space-y-2 overflow-y-auto max-h-[calc(100vh-280px)] custom-scrollbar pr-2">
                {tasks.length === 0 && <p className="text-xs text-slate-400 text-center py-4 italic">No tasks found</p>}
                {tasks.map(task => (
                  <div key={task.id} className="group flex items-center gap-3 p-3 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer border border-transparent hover:border-slate-200">
                    <div className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center ${task.completed ? 'bg-blue-600 border-blue-600' : 'border-slate-300 group-hover:border-blue-400'}`}>
                      {task.completed && <div className="w-2 h-2 bg-white rounded-full"></div>}
                    </div>
                    <div className="min-w-0">
                      <p className={`text-sm truncate ${task.completed ? 'line-through text-slate-400' : 'text-slate-700 font-medium'}`}>{task.title}</p>
                      {task.due && <p className="text-[10px] text-slate-400">{new Date(task.due).toLocaleDateString()}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            {/* User Profile Footer */}
            <div className="mt-auto p-6 border-t border-slate-100 bg-slate-50/30">
              <div className="flex items-center gap-3">
                {user?.picture ? (
                  <img src={user.picture} className="w-10 h-10 rounded-full ring-2 ring-white shadow-sm" alt="Profile" />
                ) : (
                  <UserCircleIcon className="w-10 h-10 text-slate-400" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800 truncate">{user?.name || 'Google User'}</p>
                  <p className="text-[10px] text-slate-500 truncate">{user?.email}</p>
                </div>
                <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-red-500 transition-colors" title="Sign out">
                  <ArrowRightOnRectangleIcon className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Chat Agent Panel */}
      <div className="w-96 bg-white flex flex-col shadow-2xl z-10">
        <div className="h-16 flex items-center px-6 border-b border-slate-100">
          <ChatBubbleLeftRightIcon className="w-6 h-6 text-blue-600 mr-2" />
          <h2 className="font-bold">Chronos Brain</h2>
          <div className="ml-auto flex items-center gap-2">
             <span className="text-[10px] text-blue-600 font-bold bg-blue-50 px-2 py-0.5 rounded-full uppercase tracking-widest">Real-time</span>
          </div>
        </div>

        {/* Chat History */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
          {messages.length === 0 && (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <CalendarIcon className="w-8 h-8 text-blue-500" />
              </div>
              <h3 className="font-bold text-slate-800">Your Actual Schedule</h3>
              <p className="text-sm text-slate-500 px-8 mt-2">I am now connected to your Google Calendar. Ask me to view, create, or update anything.</p>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] p-3 rounded-2xl text-sm ${
                m.role === 'user' 
                  ? 'bg-blue-600 text-white rounded-tr-none shadow-md shadow-blue-100' 
                  : 'bg-slate-100 text-slate-800 rounded-tl-none'
              }`}>
                {m.content}
                <div className={`text-[10px] mt-1 opacity-60 ${m.role === 'user' ? 'text-right' : 'text-left'}`}>
                  {m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          ))}
          {isProcessing && (
            <div className="flex justify-start">
              <div className="bg-slate-100 p-3 rounded-2xl rounded-tl-none flex gap-1 items-center">
                <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse"></div>
                <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse delay-75"></div>
                <div className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-pulse delay-150"></div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-6 border-t border-slate-100">
          <div className="relative flex items-end gap-2">
            <div className="flex-1 relative">
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder="Type your command..."
                className="w-full bg-slate-50 border-none rounded-2xl py-3 pl-4 pr-12 focus:ring-2 focus:ring-blue-500 transition-all resize-none max-h-32 min-h-[48px] text-sm"
              />
              <button 
                onClick={toggleListening}
                className={`absolute right-2 bottom-2 p-2 rounded-xl transition-all ${
                  isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                }`}
              >
                {isListening ? <StopIcon className="w-5 h-5"/> : <MicrophoneIcon className="w-5 h-5" />}
              </button>
            </div>
            <button 
              onClick={() => handleSendMessage()}
              disabled={isProcessing || !inputText.trim()}
              className="bg-blue-600 text-white p-3 rounded-2xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-200"
            >
              <svg className="w-5 h-5 rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Helper Component: Calendar Grid (remains largely same but handles dates better)
const CalendarGrid: React.FC<{ events: CalendarEvent[]; currentDate: Date }> = ({ events, currentDate }) => {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hours = Array.from({ length: 24 }, (_, i) => i);
  
  const startOfWeek = new Date(currentDate);
  startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());
  
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    return d;
  });

  return (
    <div className="flex flex-col bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="grid grid-cols-8 border-b border-slate-100 bg-white sticky top-0 z-30">
        <div className="p-4 border-r border-slate-100 bg-slate-50/50"></div>
        {weekDates.map((d, i) => (
          <div key={i} className={`p-4 text-center border-r last:border-r-0 border-slate-100 ${d.toDateString() === new Date().toDateString() ? 'bg-blue-50/50' : ''}`}>
            <span className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{days[i]}</span>
            <span className={`text-xl font-black ${d.toDateString() === new Date().toDateString() ? 'text-blue-600' : 'text-slate-800'}`}>{d.getDate()}</span>
          </div>
        ))}
      </div>

      <div className="relative grid grid-cols-8">
        <div className="col-span-1 border-r border-slate-100 bg-slate-50/20">
          {hours.map(h => (
            <div key={h} className="h-20 border-b border-slate-100/50 last:border-b-0 px-3 py-2 text-[10px] font-bold text-slate-400 text-right">
              {h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h-12} PM`}
            </div>
          ))}
        </div>

        {weekDates.map((date, dayIdx) => (
          <div key={dayIdx} className="relative col-span-1 border-r last:border-r-0 border-slate-100">
            {hours.map(h => (
              <div key={h} className="h-20 border-b border-slate-100/50 last:border-b-0"></div>
            ))}
            
            {events.filter(e => new Date(e.start).toDateString() === date.toDateString()).map(event => {
              const start = new Date(event.start);
              const end = new Date(event.end);
              const startHour = start.getHours() + (start.getMinutes() / 60);
              const endHour = end.getHours() + (end.getMinutes() / 60);
              const top = startHour * 80;
              const height = Math.max((endHour - startHour) * 80, 24); // Minimum height

              return (
                <div 
                  key={event.id}
                  style={{ top: `${top}px`, height: `${height}px`, backgroundColor: '#3b82f6' }}
                  className="absolute left-1 right-1 rounded-xl shadow-lg shadow-blue-100 p-2 text-white overflow-hidden cursor-pointer hover:scale-[1.03] hover:z-40 transition-all z-20 border-l-4 border-blue-700"
                >
                  <p className="text-[10px] font-black truncate leading-tight">{event.summary}</p>
                  {height > 40 && (
                    <p className="text-[9px] opacity-90 font-medium truncate">
                      {start.toLocaleTimeString([], {hour: 'numeric', minute:'2-digit'})}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

export default App;
