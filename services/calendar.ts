
import { CalendarEvent, CalendarTask } from '../types';

const BASE_URL = 'https://www.googleapis.com/calendar/v3';
const TASKS_BASE_URL = 'https://www.googleapis.com/tasks/v1';

let accessToken: string | null = null;

export const setCalendarToken = (token: string) => {
  accessToken = token;
};

async function calendarFetch(path: string, options: RequestInit = {}) {
  if (!accessToken) throw new Error('Not authenticated with Google');
  
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (response.status === 401) throw new Error('AUTH_EXPIRED');
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || 'API request failed');
  }
  
  return response.status === 204 ? null : response.json();
}

async function tasksFetch(path: string, options: RequestInit = {}) {
  if (!accessToken) throw new Error('Not authenticated with Google');
  
  const response = await fetch(`${TASKS_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (response.status === 401) throw new Error('AUTH_EXPIRED');
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || 'API request failed');
  }
  
  return response.status === 204 ? null : response.json();
}

export const calendarService = {
  getEvents: async (timeMin?: string, timeMax?: string): Promise<CalendarEvent[]> => {
    const params = new URLSearchParams({
      timeMin: timeMin || new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString(),
      timeMax: timeMax || new Date(new Date().setMonth(new Date().getMonth() + 1)).toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
    });
    const data = await calendarFetch(`/calendars/primary/events?${params}`);
    return (data.items || []).map((item: any) => ({
      id: item.id,
      summary: item.summary,
      description: item.description,
      start: item.start.dateTime || item.start.date,
      end: item.end.dateTime || item.end.date,
      color: item.colorId ? '#4285f4' : '#4285f4', // Simplified coloring
    }));
  },

  createEvent: async (event: Omit<CalendarEvent, 'id'>): Promise<CalendarEvent> => {
    const body = {
      summary: event.summary,
      description: event.description,
      start: { dateTime: new Date(event.start).toISOString() },
      end: { dateTime: new Date(event.end).toISOString() },
    };
    const data = await calendarFetch('/calendars/primary/events', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return {
      id: data.id,
      summary: data.summary,
      start: data.start.dateTime,
      end: data.end.dateTime,
    };
  },

  updateEvent: async (id: string, updates: Partial<CalendarEvent>): Promise<CalendarEvent> => {
    const body: any = {};
    if (updates.summary) body.summary = updates.summary;
    if (updates.description) body.description = updates.description;
    if (updates.start) body.start = { dateTime: new Date(updates.start).toISOString() };
    if (updates.end) body.end = { dateTime: new Date(updates.end).toISOString() };

    const data = await calendarFetch(`/calendars/primary/events/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return data;
  },

  deleteEvent: async (id: string): Promise<void> => {
    await calendarFetch(`/calendars/primary/events/${id}`, { method: 'DELETE' });
  },

  getTasks: async (): Promise<CalendarTask[]> => {
    // Fetches from the default list
    const lists = await tasksFetch('/users/@me/lists');
    const defaultListId = lists.items?.[0]?.id;
    if (!defaultListId) return [];

    const data = await tasksFetch(`/lists/${defaultListId}/tasks`);
    return (data.items || []).map((item: any) => ({
      id: item.id,
      title: item.title,
      due: item.due,
      completed: item.status === 'completed',
    }));
  },

  createTask: async (task: Omit<CalendarTask, 'id'>): Promise<CalendarTask> => {
    const lists = await tasksFetch('/users/@me/lists');
    const defaultListId = lists.items?.[0]?.id;
    const body = {
      title: task.title,
      due: task.due ? new Date(task.due).toISOString() : undefined,
    };
    const data = await tasksFetch(`/lists/${defaultListId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return {
      id: data.id,
      title: data.title,
      due: data.due,
      completed: data.status === 'completed',
    };
  },

  updateTask: async (id: string, updates: Partial<CalendarTask>): Promise<CalendarTask> => {
    const lists = await tasksFetch('/users/@me/lists');
    const defaultListId = lists.items?.[0]?.id;
    const body: any = {};
    if (updates.title) body.title = updates.title;
    if (updates.completed !== undefined) body.status = updates.completed ? 'completed' : 'needsAction';

    const data = await tasksFetch(`/lists/${defaultListId}/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return data;
  }
};
