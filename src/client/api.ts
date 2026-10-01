import type {
  CreateRoomInput,
  Room,
  RoomSummary,
  SendInput,
  SendResult,
} from '../shared/contracts.js';

let tokenPromise: Promise<string> | null = null;
async function token(): Promise<string> {
  tokenPromise ??= fetch('/api/session')
    .then(async (response) => {
      if (!response.ok) throw new Error('The local application service is unavailable.');
      return ((await response.json()) as { token: string }).token;
    })
    .catch((error: unknown) => {
      tokenPromise = null;
      throw error;
    });
  return tokenPromise;
}

async function request(path: string, options: RequestInit = {}, retry = true): Promise<Response> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'X-AIB-Token': await token(),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (response.status === 401 && retry) {
    tokenPromise = null;
    return request(path, options, false);
  }
  if (!response.ok) {
    const error = (await response.json()) as { error?: string; details?: string[] };
    throw new Error(error.details?.join(' · ') ?? error.error ?? 'The request failed.');
  }
  return response;
}

export const api = {
  list: async (signal?: AbortSignal) =>
    (await request('/rooms', { signal })).json() as Promise<RoomSummary[]>,
  room: async (id: string, signal?: AbortSignal) =>
    (await request(`/rooms/${id}`, { signal })).json() as Promise<Room>,
  create: async (input: CreateRoomInput) =>
    (
      await request('/rooms', { method: 'POST', body: JSON.stringify(input) })
    ).json() as Promise<Room>,
  send: async (id: string, input: SendInput) =>
    (
      await request(`/rooms/${id}/messages`, { method: 'POST', body: JSON.stringify(input) })
    ).json() as Promise<SendResult>,
  control: async (id: string, action: 'pause' | 'resume' | 'stop') => {
    await request(`/rooms/${id}/control`, { method: 'POST', body: JSON.stringify({ action }) });
  },
  retry: async (id: string, jobId: string) => {
    await request(`/rooms/${id}/retry`, { method: 'POST', body: JSON.stringify({ jobId }) });
  },
  export: async (id: string) => (await request(`/rooms/${id}/export`)).text(),
};

export async function watch(
  onChange: () => void,
  onConnection: (connected: boolean) => void,
  signal: AbortSignal,
) {
  while (!signal.aborted) {
    try {
      const response = await request('/events', { signal });
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      onConnection(true);
      onChange();
      while (!signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const event = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (event.startsWith('data: ')) onChange();
        }
      }
    } catch {
      if (signal.aborted) return;
    }
    onConnection(false);
    await new Promise<void>((done) => {
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', cancel);
        done();
      }, 1000);
      const cancel = () => {
        clearTimeout(timer);
        done();
      };
      signal.addEventListener('abort', cancel, { once: true });
    });
  }
}
