
export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: string; // ISO string
  end: string;   // ISO string
  color?: string;
}

export interface CalendarTask {
  id: string;
  title: string;
  due?: string; // ISO string
  completed: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

export enum CalendarViewType {
  WEEK = 'WEEK',
  DAY = 'DAY',
  MONTH = 'MONTH'
}
