import type {
  CreateRoomInput,
  Room,
  RoomSummary,
  SendInput,
  SendResult,
  AgentSettingsInput,
  ProviderStatus,
  AppSettings,
  WorkspaceSettingsInput,
  AddAgentInput,
} from '../shared/contracts.js';

let tokenPromise: Promise<string> | null = null;
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
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
    throw new ApiError(
      response.status,
      error.details?.join(' · ') ?? error.error ?? 'The request failed.',
    );
  }
  return response;
}

export const api = {
  settings: async (signal?: AbortSignal) =>
    (await request('/settings', { signal })).json() as Promise<AppSettings>,
  saveSettings: async (input: AppSettings) =>
    (
      await request('/settings', { method: 'PUT', body: JSON.stringify(input) })
    ).json() as Promise<AppSettings>,
  configureWorkspace: async (id: string, input: WorkspaceSettingsInput) =>
    (
      await request(`/rooms/${id}/settings`, { method: 'PUT', body: JSON.stringify(input) })
    ).json() as Promise<Room>,
  setWorkspaceArchived: async (id: string, archived: boolean) =>
    (
      await request(`/rooms/${id}/archive`, { method: 'PUT', body: JSON.stringify({ archived }) })
    ).json() as Promise<Room>,
  renameThread: async (id: string, threadId: string, title: string) =>
    (
      await request(`/rooms/${id}/threads/${threadId}`, {
        method: 'PUT',
        body: JSON.stringify({ title }),
      })
    ).json() as Promise<Room>,
  deleteWorkspace: async (id: string) => {
    await request(`/rooms/${id}`, { method: 'DELETE' });
  },
  deleteThread: async (id: string, threadId: string) =>
    (
      await request(`/rooms/${id}/threads/${threadId}`, { method: 'DELETE' })
    ).json() as Promise<Room>,
  providers: async () => (await request('/providers')).json() as Promise<ProviderStatus[]>,
  models: async (provider: string, baseUrl: string) =>
    (
      await request(`/providers/${provider}/models?baseUrl=${encodeURIComponent(baseUrl)}`)
    ).json() as Promise<string[]>,
  configureAgent: async (id: string, input: AgentSettingsInput) => {
    await request(`/rooms/${id}/agents`, { method: 'POST', body: JSON.stringify(input) });
  },
  addAgent: async (id: string, input: AddAgentInput) =>
    (
      await request(`/rooms/${id}/participants`, { method: 'POST', body: JSON.stringify(input) })
    ).json() as Promise<Room>,
  setAgentActive: async (id: string, agentId: string, active: boolean) =>
    (
      await request(`/rooms/${id}/participants/${agentId}`, {
        method: 'PUT',
        body: JSON.stringify({ active }),
      })
    ).json() as Promise<Room>,
  testConnection: async (id: string, agentId: string) =>
    (
      await request(`/rooms/${id}/connection-test`, {
        method: 'POST',
        body: JSON.stringify({ agentId }),
      })
    ).json() as Promise<{ reply: string }>,
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
  stopDiscussion: async (id: string, discussionId: string) => {
    await request(`/rooms/${id}/discussion-stop`, {
      method: 'POST',
      body: JSON.stringify({ discussionId }),
    });
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
