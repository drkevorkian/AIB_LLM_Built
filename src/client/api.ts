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
  AgentRemovalInput,
  ConnectionTestKind,
  ConnectionTestResult,
  RoomActivity,
  BulkWorkspaceInput,
  BulkWorkspacePreview,
  BulkWorkspaceResult,
  ProviderConcurrency,
  UpdatedSynthesisInput,
  ContextSummaryInput,
  ContextSummary,
  SummaryOriginal,
  ArtifactUploadInput,
  ArtifactVersion,
  ArtifactPreview,
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
  uploadArtifact: async (id: string, input: ArtifactUploadInput) =>
    (
      await request(`/rooms/${id}/artifacts`, {
        method: 'POST',
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(15000),
      })
    ).json() as Promise<ArtifactVersion>,
  artifactPreview: async (id: string, versionId: string) =>
    (
      await request(`/rooms/${id}/artifacts/${versionId}/preview`, {
        signal: AbortSignal.timeout(5000),
      })
    ).json() as Promise<ArtifactPreview>,
  artifactOriginal: async (id: string, versionId: string) =>
    (
      await request(`/rooms/${id}/artifacts/${versionId}/original`, {
        signal: AbortSignal.timeout(5000),
      })
    ).blob(),
  createContextSummary: async (id: string, input: ContextSummaryInput) =>
    (
      await request(`/rooms/${id}/context-summaries`, {
        method: 'POST',
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(15000),
      })
    ).json() as Promise<ContextSummary>,
  summarySource: async (id: string, summaryId: string, sourceId: string) =>
    (
      await request(`/rooms/${id}/context-summaries/${summaryId}/sources/${sourceId}`, {
        signal: AbortSignal.timeout(5000),
      })
    ).json() as Promise<SummaryOriginal>,
  previewWorkspaces: async (input: BulkWorkspaceInput, signal?: AbortSignal) =>
    (
      await request('/workspaces/bulk/preview', {
        method: 'POST',
        body: JSON.stringify(input),
        signal,
      })
    ).json() as Promise<BulkWorkspacePreview>,
  confirmWorkspaces: async (preview: BulkWorkspacePreview) =>
    (
      await request('/workspaces/bulk/confirm', {
        method: 'POST',
        body: JSON.stringify({ token: preview.token }),
      })
    ).json() as Promise<BulkWorkspaceResult>,
  cancelWorkspacePreview: async (token: string) => {
    await request('/workspaces/bulk/preview-cancel', {
      method: 'POST',
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(5000),
    });
  },
  settings: async (signal?: AbortSignal) =>
    (await request('/settings', { signal })).json() as Promise<AppSettings>,
  saveSettings: async (input: AppSettings) => {
    // Conversation defaults can be dirty while another view edits provider limits.
    const { providerConcurrency: _limits, ...defaults } = input;
    return (
      await request('/settings', { method: 'PUT', body: JSON.stringify(defaults) })
    ).json() as Promise<AppSettings>;
  },
  saveProviderConcurrency: async (input: ProviderConcurrency) =>
    (
      await request('/settings/provider-limits', { method: 'PUT', body: JSON.stringify(input) })
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
  removeAgent: async (id: string, agentId: string, input: AgentRemovalInput) =>
    (
      await request(`/rooms/${id}/participants/${agentId}`, {
        method: 'DELETE',
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(15000),
      })
    ).json() as Promise<Room>,
  testConnection: async (id: string, agentId: string, kind: ConnectionTestKind = 'greeting') =>
    (
      await request(`/rooms/${id}/connection-test`, {
        method: 'POST',
        body: JSON.stringify({ agentId, kind }),
      })
    ).json() as Promise<ConnectionTestResult>,
  list: async (signal?: AbortSignal) =>
    (await request('/rooms', { signal })).json() as Promise<RoomSummary[]>,
  room: async (id: string, signal?: AbortSignal) =>
    (await request(`/rooms/${id}`, { signal })).json() as Promise<Room>,
  activity: async (id: string, signal?: AbortSignal) =>
    (await request(`/rooms/${id}/activity`, { signal })).json() as Promise<RoomActivity>,
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
  updatedSynthesis: async (id: string, input: UpdatedSynthesisInput) =>
    (
      await request(`/rooms/${id}/updated-synthesis`, {
        method: 'POST',
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(15000),
      })
    ).json() as Promise<SendResult>,
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
