
export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: string; // ISO string
  end: string;   // ISO string
  color?: string;
  isAllDay?: boolean;
}

export interface CalendarTask {
  id: string;
  title: string;
  due?: string; // ISO string (Date only part matters)
  completed: boolean;
  notes?: string;
}

export interface UIPayload {
  type: 'duration' | 'confirm' | 'pick';
  action?: string;
  options?: any[];
  pending: any;
  message?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  ui?: UIPayload;
  source?: 'web' | 'siri';
  processed?: boolean;
}

export enum CalendarViewType {
  WEEK = 'WEEK',
  DAY = 'DAY',
  MONTH = 'MONTH'
}
