
import { CalendarEvent, CalendarTask } from '../types';

const BASE_URL = 'https://www.googleapis.com/calendar/v3';
const TASKS_BASE_URL = 'https://www.googleapis.com/tasks/v1';
const TIMEZONE = 'America/New_York';

let accessToken: string | null = null;

export const setCalendarToken = (token: string) => {
  accessToken = token;
};

/**
 * Normalizes input to YYYY-MM-DDTHH:mm:ss without timezone/offset for America/New_York.
 * Google API takes { dateTime: "...", timeZone: "..." } to handle the actual offset.
 */
function normalizeNYDateTime(input: string | Date): string {
  if (typeof input === 'string') {
    // Remove any existing timezone suffix (Z or +HH:mm or -HH:mm)
    let stripped = input.replace(/(Z|[+-]\d{2}:\d{2})$/, '');
    
    // Handle YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(stripped)) {
      return `${stripped}T00:00:00`;
    }
    
    // Handle YYYY-MM-DDTHH:mm
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(stripped)) {
      return `${stripped}:00`;
    }

    // Basic validation of standard format
    const match = stripped.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
    if (match) return match[1];
    
    return stripped;
  }

  // Handle Date object by formatting it in NY timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(input);
  const p = (type: string) => parts.find(p => p.type === type)?.value;
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}:${p('second')}`;
}

async function calendarFetch(path: string, token: string | null, options: RequestInit = {}) {
  const activeToken = token || accessToken;
  if (!activeToken) throw new Error('Not authenticated with Google');
  
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${activeToken}`,
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

async function tasksFetch(path: string, token: string | null, options: RequestInit = {}) {
  const activeToken = token || accessToken;
  if (!activeToken) throw new Error('Not authenticated with Google');
  
  const response = await fetch(`${TASKS_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${activeToken}`,
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
  getEvents: async (timeMin?: string, timeMax?: string, token: string | null = null): Promise<CalendarEvent[]> => {
    const params = new URLSearchParams({
      timeMin: timeMin || new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString(),
      timeMax: timeMax || new Date(new Date().setMonth(new Date().getMonth() + 2)).toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      timeZone: TIMEZONE,
    });
    const data = await calendarFetch(`/calendars/primary/events?${params}`, token);
    return (data.items || []).map((item: any) => ({
      id: item.id,
      summary: item.summary || '(No Title)',
      description: item.description,
      start: item.start.dateTime || item.start.date,
      end: item.end.dateTime || item.end.date,
      isAllDay: !!item.start.date,
      color: item.colorId ? '#4285f4' : '#4285f4',
    }));
  },

  createEvent: async (event: Omit<CalendarEvent, 'id'>, token: string | null = null): Promise<CalendarEvent> => {
    const normalizedStart = normalizeNYDateTime(event.start);
    let normalizedEnd = normalizeNYDateTime(event.end || event.start);
    
    // Simple check: if end <= start, default to 1 hour
    if (new Date(normalizedEnd) <= new Date(normalizedStart)) {
      const d = new Date(normalizedStart);
      d.setHours(d.getHours() + 1);
      normalizedEnd = normalizeNYDateTime(d);
    }

    const body = {
      summary: event.summary,
      description: event.description,
      start: { dateTime: normalizedStart, timeZone: TIMEZONE },
      end: { dateTime: normalizedEnd, timeZone: TIMEZONE },
    };
    const data = await calendarFetch('/calendars/primary/events', token, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return {
      id: data.id,
      summary: data.summary,
      start: data.start.dateTime || data.start.date,
      end: data.end.dateTime || data.end.date,
    };
  },

  updateEvent: async (id: string, updates: Partial<CalendarEvent>, token: string | null = null): Promise<CalendarEvent> => {
    const body: any = {};
    if (updates.summary) body.summary = updates.summary;
    if (updates.description) body.description = updates.description;
    if (updates.start) body.start = { dateTime: normalizeNYDateTime(updates.start), timeZone: TIMEZONE };
    if (updates.end) body.end = { dateTime: normalizeNYDateTime(updates.end), timeZone: TIMEZONE };

    const data = await calendarFetch(`/calendars/primary/events/${id}`, token, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return {
      id: data.id,
      summary: data.summary,
      start: data.start.dateTime || data.start.date,
      end: data.end.dateTime || data.end.date,
    };
  },

  deleteEvent: async (id: string, token: string | null = null): Promise<any> => {
    await calendarFetch(`/calendars/primary/events/${id}`, token, { method: 'DELETE' });
    return { ok: true, id, status: 'deleted' };
  },

  getTasks: async (token: string | null = null): Promise<CalendarTask[]> => {
    try {
      const data = await tasksFetch(`/lists/@default/tasks`, token);
      return (data.items || []).map((item: any) => ({
        id: item.id,
        title: item.title,
        due: item.due,
        completed: item.status === 'completed',
        notes: item.notes,
      }));
    } catch (e) {
      console.warn('Failed to fetch tasks', e);
      return [];
    }
  },

  createTask: async (task: { title: string; dueDate?: string; notes?: string }, token: string | null = null): Promise<CalendarTask> => {
    const body = {
      title: task.title,
      due: task.dueDate ? new Date(task.dueDate).toISOString() : undefined,
      notes: task.notes,
    };
    const data = await tasksFetch(`/lists/@default/tasks`, token, {
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

  updateTask: async (id: string, updates: Partial<CalendarTask>, token: string | null = null): Promise<CalendarTask> => {
    const body: any = {};
    if (updates.title) body.title = updates.title;
    if (updates.notes) body.notes = updates.notes;
    if (updates.completed !== undefined) body.status = updates.completed ? 'completed' : 'needsAction';
    if (updates.due) body.due = new Date(updates.due).toISOString();

    const data = await tasksFetch(`/lists/@default/tasks/${id}`, token, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return {
      id: data.id,
      title: data.title,
      due: data.due,
      completed: data.status === 'completed',
    };
  },

  deleteTask: async (id: string, token: string | null = null): Promise<any> => {
    await tasksFetch(`/lists/@default/tasks/${id}`, token, { method: 'DELETE' });
    return { ok: true, id, status: 'deleted' };
  }
};
