import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type {
  Agent,
  ContextSnapshot,
  Message,
  Request,
  Room,
  RoomSummary,
  Relay,
  Discussion,
  SendInput,
  AppSettings,
} from '../shared/contracts.js';
import { api, ApiError, watch } from './api.js';
import { AgentSettings } from './AgentSettings.js';
import { SettingsPage } from './SettingsPage.js';
import { searchWorkspaces, searchThreads, type WorkspaceView } from './search.js';
import { CopyButton } from './CopyButton.js';
import { MessageText } from './MessageText.js';
import {
  agentAtSnapshot,
  agentLabel,
  isAgentActive,
  maxParticipants,
  hasPendingWork,
} from '../shared/contracts.js';

type DeleteTarget =
  | { kind: 'workspace'; id: string; title: string }
  | { kind: 'thread'; id: string; roomId: string; title: string };
type ArchiveTarget = { id: string; title: string; archived: boolean };
type RenameTarget = { roomId: string; id: string; title: string };

function Glyph({
  kind,
  size = 18,
}: {
  kind:
    | 'chat'
    | 'plus'
    | 'send'
    | 'pause'
    | 'play'
    | 'stop'
    | 'download'
    | 'close'
    | 'branch'
    | 'inspect'
    | 'edit'
    | 'trash';
  size?: number;
}) {
  const paths = {
    chat: 'M4 4h16v12H9l-5 4V4Z M8 8h8 M8 12h5',
    plus: 'M12 5v14 M5 12h14',
    send: 'm3 3 18 9-18 9 4-9-4-9Z M7 12h14',
    pause: 'M8 5v14 M16 5v14',
    play: 'm8 5 11 7-11 7V5Z',
    stop: 'M6 6h12v12H6V6Z',
    download: 'M12 3v12 m-5-5 5 5 5-5 M4 17v4h16v-4',
    close: 'm6 6 12 12 M6 18 18 6',
    branch: 'M7 3v18 M7 12h6a4 4 0 0 0 4-4V3',
    inspect: 'M4 6h16 M4 12h16 M4 18h10',
    edit: 'm15 4 5 5 M4 20l5-1L20 8l-4-4L5 15l-1 5Z',
    trash: 'M4 6h16 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7',
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      <path d={paths[kind]} />
    </svg>
  );
}
function Badge({ value }: { value: string }) {
  return <span className={`badge ${value}`}>{value.replaceAll('_', ' ')}</span>;
}
function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'The operation failed.';
}
function nameOf(room: Room, id: string, snapshotId?: string | null) {
  return id === 'human' ? 'You' : agentLabel(room, id, snapshotId);
}
function time(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function App() {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [listLoaded, setListLoaded] = useState(false);
  const [defaults, setDefaults] = useState<AppSettings | null>(null);
  const [settingsPage, setSettingsPage] = useState(() => location.hash === '#settings');
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ArchiveTarget | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [workspaceSearch, setWorkspaceSearch] = useState('');
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('active');
  const [threadSearch, setThreadSearch] = useState('');
  const [roomId, setRoomId] = useState<string | null>(null);
  const selectedRoomId = useRef<string | null>(null);
  selectedRoomId.current = roomId;
  const [loadedRoom, setRoom] = useState<Room | null>(null);
  const room = loadedRoom?.id === roomId ? loadedRoom : null;
  const [threadId, setThreadId] = useState<string | null>(null);
  const selectedThreadId = useRef<string | null>(null);
  selectedThreadId.current = threadId;
  const [tick, setTick] = useState(0);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [newRoom, setNewRoom] = useState(false);
  const [reply, setReply] = useState<Message | null>(null);
  const [inspect, setInspect] = useState<Message | null>(null);
  const [settings, setSettings] = useState<Agent | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    localStorage.getItem('aib-theme') === 'light' ? 'light' : 'dark',
  );
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [followLatest, setFollowLatest] = useState(true);

  useEffect(() => {
    const abort = new AbortController();
    let pending: ReturnType<typeof setTimeout> | null = null;
    void watch(
      () => {
        if (!pending)
          pending = setTimeout(() => {
            pending = null;
            setTick((v) => v + 1);
          }, 100);
      },
      setConnected,
      abort.signal,
    );
    return () => {
      abort.abort();
      if (pending) clearTimeout(pending);
    };
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    void api
      .list(abort.signal)
      .then((list) => {
        if (abort.signal.aborted) return;
        setRooms(list);
        if (!listLoaded && list.length && list.every((r) => r.archivedAt))
          setWorkspaceView('archived');
        setListLoaded(true);
        setRoomId((current) =>
          current && list.some((r) => r.id === current)
            ? current
            : (list.find((r) => !r.archivedAt)?.id ?? list[0]?.id ?? null),
        );
      })
      .catch((e: unknown) => {
        if (!abort.signal.aborted) setError(errorText(e));
      });
    return () => abort.abort();
  }, [tick]);
  useEffect(() => {
    const abort = new AbortController();
    void api
      .settings(abort.signal)
      .then((next) => {
        if (!abort.signal.aborted) setDefaults(next);
      })
      .catch((e: unknown) => {
        if (!abort.signal.aborted) setError(errorText(e));
      });
    return () => abort.abort();
  }, [tick]);
  useEffect(() => {
    setRoom(null);
    setThreadId(null);
    setReply(null);
    setInspect(null);
    setSettings(null);
    setRenameTarget(null);
    setThreadSearch('');
    follow.current = true;
  }, [roomId]);
  useEffect(() => {
    if (!roomId) return;
    const abort = new AbortController();
    void api
      .room(roomId, abort.signal)
      .then((next) => {
        if (!abort.signal.aborted)
          setRoom((current) =>
            current?.id === next.id && current.revision > next.revision ? current : next,
          );
      })
      .catch((e: unknown) => {
        if (!abort.signal.aborted) {
          if (e instanceof ApiError && e.status === 404) {
            setRoom(null);
            setRoomId(null);
            setTick((v) => v + 1);
          } else setError(errorText(e));
        }
      });
    return () => abort.abort();
  }, [roomId, tick]);
  useEffect(() => {
    if (!room) return;
    if (threadId && !room.threads.some((t) => t.id === threadId)) setThreadId(null);
    if (reply && !room.messages.some((m) => m.id === reply.id)) setReply(null);
    if (
      reply &&
      reply.authorId !== 'human' &&
      !room.agents.some((a) => a.id === reply.authorId && isAgentActive(a))
    )
      setReply(null);
    if (inspect && !room.messages.some((m) => m.id === inspect.id)) setInspect(null);
    if (
      renameTarget &&
      (renameTarget.roomId !== room.id || !room.threads.some((t) => t.id === renameTarget.id))
    )
      setRenameTarget(null);
  }, [room, threadId, reply, inspect]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('aib-theme', theme);
  }, [theme]);
  useEffect(() => {
    if (settingsPage) history.replaceState(null, '', '#settings');
    else if (location.hash === '#settings')
      history.replaceState(null, '', location.pathname + location.search);
  }, [settingsPage]);
  useEffect(() => {
    if (follow.current && scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [room?.revision, threadId]);

  async function control(action: 'pause' | 'resume' | 'stop') {
    if (!roomId) return;
    setBusy(true);
    setError('');
    try {
      await api.control(roomId, action);
      setTick((v) => v + 1);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    if (!roomId) return;
    try {
      const text = await api.export(roomId);
      const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'conversation.md';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(errorText(e));
    }
  }
  function chooseThread(id: string | null) {
    setSettingsPage(false);
    setThreadId(id);
    setReply(null);
    follow.current = true;
    setFollowLatest(true);
  }
  function workspaceSaved(next: Room) {
    setRoom((current) =>
      current?.id === next.id && current.revision > next.revision ? current : next,
    );
    setTick((v) => v + 1);
  }
  async function archive(target: ArchiveTarget) {
    const next = await api.setWorkspaceArchived(target.id, target.archived);
    if (roomId === target.id) workspaceSaved(next);
    else setTick((v) => v + 1);
    setWorkspaceView(target.archived ? 'archived' : 'active');
    setWorkspaceSearch('');
    setArchiveTarget(null);
  }
  async function remove(target: DeleteTarget) {
    if (target.kind === 'workspace') {
      await api.deleteWorkspace(target.id);
      const remaining = rooms.filter((r) => r.id !== target.id);
      setRooms(remaining);
      if (roomId === target.id) {
        setRoom(null);
        setRoomId(remaining[0]?.id ?? null);
      }
    } else {
      const next = await api.deleteThread(target.roomId, target.id);
      if (roomId === target.roomId) {
        setRoom(next);
        if (threadId === target.id) setThreadId(null);
        if (reply?.threadId === target.id) setReply(null);
        if (inspect?.threadId === target.id) setInspect(null);
      }
    }
    setDeleteTarget(null);
    setTick((v) => v + 1);
  }
  const shown = room?.messages.filter((m) => !threadId || m.threadId === threadId) ?? [];
  const activeCount = room?.jobs.filter((j) => j.status === 'running').length ?? 0;
  const queueCount = room?.jobs.filter((j) => j.status === 'queued').length ?? 0;
  const liveCount =
    room?.agents.filter((a) => isAgentActive(a) && a.provider !== 'simulated').length ?? 0;
  const reservedTurns = room
    ? room.jobs.filter((j) => j.status === 'queued' && !j.discussionId).length +
      room.requests.filter((r) => r.status === 'collecting' && r.synthesisAgentId).length +
      room.relays
        .filter((r) => ['running', 'blocked'].includes(r.status))
        .reduce((n, r) => n + r.order.length - r.requestIds.length, 0) +
      room.discussions
        .filter((d) => ['running', 'waiting', 'blocked'].includes(d.status))
        .reduce((n, d) => n + d.maxTurns - d.turnsUsed, 0)
    : 0;
  const snapshots =
    inspect && room ? room.snapshots.find((s) => s.id === inspect.snapshotId) : null;
  const visibleRooms = searchWorkspaces(rooms, workspaceSearch, workspaceView);
  const visibleThreads = room ? searchThreads(room, threadSearch) : [];

  return (
    <div className="application">
      <header className="app-header">
        <div className="brand">
          <span className="brand-symbol">
            <Glyph kind="chat" size={21} />
          </span>
          <span>
            AI Conversation Room<small>AIB / LLM BUILT</small>
          </span>
        </div>
        <div className="header-center">
          <span className="demo-dot" />
          {liveCount
            ? `${liveCount} LIVE AGENT${liveCount === 1 ? '' : 'S'} CONFIGURED`
            : 'SIMULATION'}
          <span className="version">v0.7.0</span>
        </div>
        <div className="header-actions">
          <span className={`connection ${connected ? 'online' : ''}`}>
            <i />
            {connected ? 'Service connected' : 'Reconnecting'}
          </span>
          <button
            className={`quiet compact ${settingsPage ? 'selected' : ''}`}
            aria-pressed={settingsPage}
            onClick={() => setSettingsPage((current) => !current)}
          >
            Settings
          </button>
          <button
            className="quiet compact"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
        </div>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button onClick={() => setError('')} aria-label="Dismiss error">
            <Glyph kind="close" />
          </button>
        </div>
      )}
      <div className={`workspace ${settingsPage ? 'settings-open' : ''}`}>
        <aside className="sidebar">
          <div className="section-heading">
            <h2>WORKSPACE</h2>
            <button
              className="icon-button"
              aria-label="New workspace"
              disabled={!defaults}
              onClick={() => setNewRoom(true)}
            >
              <Glyph kind="plus" />
            </button>
          </div>
          <div className="navigation-search">
            <label>
              <span className="sr-only">Search workspaces</span>
              <input
                type="search"
                aria-label="Search workspaces"
                placeholder="Search name or objective"
                maxLength={200}
                value={workspaceSearch}
                onChange={(e) => setWorkspaceSearch(e.target.value)}
              />
            </label>
            {workspaceSearch && (
              <button
                className="quiet compact"
                aria-label="Clear workspace search"
                onClick={() => setWorkspaceSearch('')}
              >
                Clear
              </button>
            )}
            <select
              aria-label="Workspace view"
              value={workspaceView}
              onChange={(e) => setWorkspaceView(e.target.value as WorkspaceView)}
            >
              <option value="active">Active workspaces</option>
              <option value="archived">Archived workspaces</option>
              <option value="all">All workspaces</option>
            </select>
          </div>
          <nav className="room-list" aria-label="Rooms">
            {visibleRooms.map((r) => (
              <div className="workspace-entry" key={r.id}>
                <button
                  className={`room-item ${r.id === roomId ? 'selected' : ''}`}
                  onClick={() => setRoomId(r.id)}
                >
                  <Glyph kind="chat" />
                  <span>
                    {r.title}
                    <small>
                      {r.archivedAt
                        ? 'Archived'
                        : r.status === 'running'
                          ? 'Open conversation'
                          : r.status}
                    </small>
                  </span>
                </button>
                <button
                  className="icon-button delete-item"
                  aria-label={`Delete workspace ${r.title}`}
                  onClick={() => setDeleteTarget({ kind: 'workspace', id: r.id, title: r.title })}
                >
                  <Glyph kind="trash" size={15} />
                </button>
              </div>
            ))}
            {listLoaded && !visibleRooms.length && (
              <p className="navigation-empty" role="status">
                {workspaceSearch.trim()
                  ? 'No matching workspaces.'
                  : `No ${workspaceView === 'archived' ? 'archived ' : workspaceView === 'active' ? 'active ' : ''}workspaces.`}
              </p>
            )}
          </nav>
          {room && (
            <>
              <div className="objective">
                <span className="eyebrow">SHARED OBJECTIVE</span>
                <p>{room.objective || 'No objective set.'}</p>
              </div>
              <div className="section-heading">
                <h2>THREADS</h2>
                <span>
                  {threadSearch.trim() ? `${visibleThreads.length} / ` : ''}
                  {room.threads.length}
                </span>
              </div>
              <div className="navigation-search thread-search">
                <label>
                  <span className="sr-only">Search threads</span>
                  <input
                    type="search"
                    aria-label="Search threads"
                    placeholder="Search names or messages"
                    maxLength={200}
                    value={threadSearch}
                    onChange={(e) => setThreadSearch(e.target.value)}
                  />
                </label>
                {threadSearch && (
                  <button
                    className="quiet compact"
                    aria-label="Clear thread search"
                    onClick={() => setThreadSearch('')}
                  >
                    Clear
                  </button>
                )}
              </div>
              <nav
                className={`thread-list ${threadSearch.trim() ? 'searching' : ''}`}
                aria-label="Threads"
              >
                <button className={!threadId ? 'selected' : ''} onClick={() => chooseThread(null)}>
                  <Glyph kind="branch" />
                  <span>All messages</span>
                  <small>{room.messages.length}</small>
                </button>
                {visibleThreads.map(({ thread: t, snippet }) => (
                  <div className="thread-entry" key={t.id}>
                    <button
                      className={threadId === t.id ? 'selected' : ''}
                      onClick={() => chooseThread(t.id)}
                    >
                      <span className="thread-mark">#</span>
                      <span className="thread-label">
                        {t.title}
                        {snippet && <small className="search-snippet">{snippet}</small>}
                      </span>
                      <small>{room.messages.filter((m) => m.threadId === t.id).length}</small>
                    </button>
                    <button
                      className="icon-button rename-item"
                      aria-label={`Rename thread ${t.title}`}
                      disabled={Boolean(room.archivedAt)}
                      onClick={() => setRenameTarget({ roomId: room.id, id: t.id, title: t.title })}
                    >
                      <Glyph kind="edit" size={14} />
                    </button>
                    <button
                      className="icon-button delete-item"
                      aria-label={`Delete thread ${t.title}`}
                      disabled={Boolean(room.archivedAt)}
                      onClick={() =>
                        setDeleteTarget({
                          kind: 'thread',
                          roomId: room.id,
                          id: t.id,
                          title: t.title,
                        })
                      }
                    >
                      <Glyph kind="trash" size={14} />
                    </button>
                  </div>
                ))}
                {threadSearch.trim() && !visibleThreads.length && (
                  <p className="navigation-empty" role="status">
                    No matching threads.
                  </p>
                )}
              </nav>
            </>
          )}
          <div className="sidebar-footer">
            <span className="eyebrow">YOUR MACHINE · YOUR WORKSPACE</span>
            <p>
              {liveCount
                ? 'Live providers receive the objective, participant roles, and frozen conversation context for their turns.'
                : 'Participants use simulation until you configure a live provider.'}
            </p>
            <span className="muted">Work continues while the service runs.</span>
          </div>
        </aside>
        <main className="conversation" hidden={settingsPage}>
          <div className="conversation-header">
            <div>
              <span className="eyebrow">{threadId ? 'THREAD' : 'CONVERSATION'}</span>
              <h1>
                {threadId
                  ? room?.threads.find((t) => t.id === threadId)?.title
                  : (room?.title ??
                    (listLoaded && !roomId ? 'No workspace selected' : 'Loading workspace…'))}
              </h1>
            </div>
            <button
              className="icon-button"
              aria-label="Export conversation"
              onClick={() => {
                void download();
              }}
              disabled={!room}
            >
              <Glyph kind="download" />
            </button>
          </div>
          <div className="control-bar">
            <div className="room-state">
              {room && (
                <Badge
                  value={
                    room.archivedAt
                      ? 'archived'
                      : room.status === 'running' && !activeCount && !queueCount
                        ? 'idle'
                        : room.status
                  }
                />
              )}
              <span>
                {activeCount} generating<span className="separator">/</span>
                {queueCount} queued
              </span>
            </div>
            <div className="controls">
              <button
                disabled={busy || !room || Boolean(room.archivedAt) || room.status !== 'running'}
                onClick={() => {
                  void control('pause');
                }}
                title="Pause new dispatches; active answers may finish"
              >
                <Glyph kind="pause" size={14} />
                Pause
              </button>
              <button
                disabled={busy || !room || Boolean(room.archivedAt) || room.status === 'running'}
                onClick={() => {
                  void control('resume');
                }}
              >
                <Glyph kind="play" size={14} />
                Resume
              </button>
              <button
                className="stop-button"
                disabled={busy || !room || Boolean(room.archivedAt) || room.status === 'stopped'}
                onClick={() => {
                  void control('stop');
                }}
              >
                <Glyph kind="stop" size={13} />
                Stop
              </button>
            </div>
          </div>
          {room?.archivedAt && (
            <div className="notice archived-notice" role="status">
              <span>
                This workspace is archived. History is available for inspection and export.
              </span>
              <button
                onClick={() =>
                  setArchiveTarget({ id: room.id, title: room.title, archived: false })
                }
              >
                Restore workspace
              </button>
            </div>
          )}
          {!room?.archivedAt && room?.status === 'paused' && (
            <div className="notice">
              Dispatch is paused. Active answers may finish. Resume to run queued work.
            </div>
          )}
          {!room?.archivedAt && room?.status === 'stopped' && (
            <div className="notice">
              This room is stopped. Unfinished work was cancelled. Resume to ask a new question.
            </div>
          )}
          <div
            className="message-scroll"
            ref={scrollRef}
            onScroll={() => {
              const el = scrollRef.current!;
              follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70;
              setFollowLatest(follow.current);
            }}
          >
            {!room && roomId && (
              <div className="loading-placeholder" role="status">
                Opening room…
              </div>
            )}
            {!room && !roomId && listLoaded && (
              <div className="welcome empty-workspace">
                <div className="welcome-icon">
                  <Glyph kind="chat" size={28} />
                </div>
                <span className="eyebrow">A FRESH START</span>
                <h2>No workspaces yet.</h2>
                <p>Create a workspace to bring your participants and conversations together.</p>
                <button className="primary" disabled={!defaults} onClick={() => setNewRoom(true)}>
                  Create workspace
                </button>
              </div>
            )}
            {room && !shown.length && (
              <div className="welcome">
                <div className="welcome-icon">
                  <Glyph kind="branch" size={28} />
                </div>
                <span className="eyebrow">INDEPENDENT PERSPECTIVES. SHARED CONTEXT.</span>
                <h2>Start a conversation.</h2>
                <p>
                  Ask one agent a focused question, or ask several at once.
                  <br />
                  Their answers stay separate. Synthesis begins when the response set is ready.
                </p>
                <div className="welcome-grid">
                  <div>
                    <strong>01</strong>
                    <span>Choose who answers</span>
                  </div>
                  <div>
                    <strong>02</strong>
                    <span>Collect their perspectives</span>
                  </div>
                  <div>
                    <strong>03</strong>
                    <span>Follow up with anyone</span>
                  </div>
                </div>
                <p className="simulation-note">
                  {liveCount
                    ? 'Live connections are selected. Provider usage may incur charges.'
                    : 'Configure a participant to connect a real model. Simulation remains available for testing.'}
                </p>
              </div>
            )}
            {room &&
              shown.map((m) => (
                <div key={m.id}>
                  <MessageCard
                    message={m}
                    room={room}
                    onReply={() => {
                      setReply(m);
                      setThreadId(m.threadId);
                    }}
                    onInspect={() => setInspect(m)}
                  />
                  {m.type === 'question' &&
                    room.requests.find((r) => r.id === m.requestId && r.phase !== 'decision') && (
                      <ResponseSet
                        request={room.requests.find((r) => r.id === m.requestId)!}
                        room={room}
                      />
                    )}
                  {room.relays
                    .filter((r) => r.messageId === m.id)
                    .map((r) => (
                      <RelayCard key={r.id} relay={r} room={room} />
                    ))}
                  {room.discussions
                    .filter((d) => d.messageId === m.id)
                    .map((d) => (
                      <DiscussionCard
                        key={d.id}
                        discussion={d}
                        room={room}
                        onStop={async () => {
                          try {
                            await api.stopDiscussion(room.id, d.id);
                            setTick((v) => v + 1);
                          } catch (e) {
                            setError(errorText(e));
                          }
                        }}
                      />
                    ))}
                </div>
              ))}
          </div>
          {!followLatest && (
            <button
              className="jump-latest"
              onClick={() => {
                follow.current = true;
                setFollowLatest(true);
                if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
              }}
            >
              Jump to latest ↓
            </button>
          )}
          {room && defaults && (
            <Composer
              key={room.id}
              room={room}
              defaults={defaults}
              threadId={threadId}
              reply={reply}
              onClearReply={() => setReply(null)}
              onSent={async (id) => {
                const priorThread = selectedThreadId.current;
                if (selectedRoomId.current === room.id) {
                  setReply(null);
                  follow.current = true;
                }
                try {
                  const next = await api.room(room.id);
                  if (selectedRoomId.current !== room.id) return;
                  setRoom((current) =>
                    current?.id === next.id && current.revision > next.revision ? current : next,
                  );
                  if (selectedThreadId.current === priorThread)
                    setThreadId(next.threads.some((thread) => thread.id === id) ? id : null);
                } catch {
                  if (selectedRoomId.current === room.id)
                    setError('Message saved. Refresh the workspace to load its updated history.');
                } finally {
                  setTick((value) => value + 1);
                }
              }}
              onError={setError}
            />
          )}
        </main>
        <aside className="activity-panel" hidden={settingsPage}>
          <div className="section-heading">
            <h2>PARTICIPANTS</h2>
            <span>{room?.agents.filter(isAgentActive).length ?? 0} active</span>
          </div>
          {room?.agents.filter(isAgentActive).map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              room={room}
              onConfigure={() => setSettings(agent)}
              onRetry={async (id) => {
                try {
                  await api.retry(room.id, id);
                  setTick((v) => v + 1);
                } catch (e) {
                  setError(errorText(e));
                }
              }}
            />
          ))}
          {room?.agents.some((agent) => !isAgentActive(agent)) && (
            <button className="quiet" onClick={() => setSettingsPage(true)}>
              Manage inactive participants
            </button>
          )}
          {room && (
            <div className="budget-card">
              <div className="section-heading">
                <h2>SESSION LIMIT</h2>
                <span>
                  {room.turnsUsed} / {room.maxTurns}
                </span>
              </div>
              <progress value={room.turnsUsed} max={room.maxTurns} aria-label="Turns used" />
              <p>
                {Math.max(0, room.maxTurns - room.turnsUsed - reservedTurns)} available ·{' '}
                {reservedTurns} reserved
              </p>
              <p>
                Each generation counts as a turn. Updates do not. Live provider usage may incur
                charges.
              </p>
            </div>
          )}
          <div className="section-heading event-heading">
            <h2>ACTIVITY</h2>
            <span>RECENT</span>
          </div>
          <div className="event-list">
            {room?.events
              .slice(-7)
              .reverse()
              .map((event) => (
                <div className="event" key={event.id}>
                  <i />
                  <div>
                    <strong>{event.type.replaceAll('.', ' / ')}</strong>
                    <p>{event.detail}</p>
                    <small>{time(event.createdAt)}</small>
                  </div>
                </div>
              ))}
          </div>
          <div className="engine-note">
            <span className="eyebrow">CONVERSATION RULE</span>
            <p>
              Visible to everyone.
              <br />
              Answered by selected agents.
            </p>
            <small>A mention alone never starts a turn.</small>
          </div>
        </aside>
        {settingsPage && (
          <SettingsPage
            defaults={defaults}
            room={room}
            theme={theme}
            onTheme={setTheme}
            onDefaultsSaved={(next) => {
              setDefaults(next);
              setTick((v) => v + 1);
            }}
            onWorkspaceSaved={workspaceSaved}
            onArchiveWorkspace={() => {
              if (room)
                setArchiveTarget({ id: room.id, title: room.title, archived: !room.archivedAt });
            }}
            onConfigure={setSettings}
            onDeleteWorkspace={() => {
              if (room) setDeleteTarget({ kind: 'workspace', id: room.id, title: room.title });
            }}
            onBack={() => setSettingsPage(false)}
          />
        )}
      </div>
      {newRoom && defaults && (
        <NewRoom
          defaults={defaults}
          onClose={() => setNewRoom(false)}
          onCreated={(next) => {
            setWorkspaceView('active');
            setWorkspaceSearch('');
            setRooms((current) => [next, ...current]);
            setRoomId(next.id);
            setTick((v) => v + 1);
            setNewRoom(false);
            setSettingsPage(false);
          }}
        />
      )}
      {deleteTarget && (
        <DeleteConfirmation
          target={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDelete={() => remove(deleteTarget)}
        />
      )}
      {archiveTarget && (
        <ArchiveConfirmation
          target={archiveTarget}
          pending={Boolean(room?.id === archiveTarget.id && hasPendingWork(room))}
          onClose={() => setArchiveTarget(null)}
          onConfirm={() => archive(archiveTarget)}
        />
      )}
      {renameTarget && (
        <RenameThread
          target={renameTarget}
          archived={Boolean(room?.archivedAt)}
          onClose={() => setRenameTarget(null)}
          onSave={async (title) => {
            const next = await api.renameThread(renameTarget.roomId, renameTarget.id, title);
            if (roomId === renameTarget.roomId) workspaceSaved(next);
            setRenameTarget(null);
          }}
        />
      )}
      {inspect && room && (
        <Modal
          title={`Message #${inspect.sequence} · ${nameOf(room, inspect.authorId, inspect.snapshotId)}`}
          onClose={() => setInspect(null)}
        >
          <p className="muted">Message ID: {inspect.id}</p>
          <p>Visible to the room · reply to {inspect.replyTo ?? 'none'}</p>
          {room.jobs
            .filter((j) => j.messageId === inspect.id)
            .map((j) => (
              <div key={j.id} className="muted">
                <p>
                  Attempt: {j.id} · {j.kind} · {j.status}
                  {j.previousJobId ? ` · follows ${j.previousJobId}` : ''}
                </p>
                {j.error && <p className="form-error">{j.error}</p>}
                {j.agentAction && (
                  <p>
                    Coordinator chose {j.agentAction.kind}
                    {j.agentAction.kind === 'ask'
                      ? ` · ${j.agentAction.policy} · to ${j.agentAction.recipientIds.map((id) => nameOf(room, id, j.snapshotId)).join(', ')}`
                      : ''}
                    .
                  </p>
                )}
                <p>
                  Provider request: {j.providerRequestId ?? 'not reported'} · Input tokens:{' '}
                  {j.usage?.inputTokens ?? 'not reported'} · Output tokens:{' '}
                  {j.usage?.outputTokens ?? 'not reported'}
                </p>
              </div>
            ))}
          {snapshots ? (
            <Snapshot snapshot={snapshots} room={room} />
          ) : (
            <p>This message has no invocation context snapshot.</p>
          )}
        </Modal>
      )}
      {settings && room && (
        <Modal title={`Configure ${nameOf(room, settings.id)}`} onClose={() => setSettings(null)}>
          <AgentSettings room={room} agent={settings} onSaved={() => setTick((v) => v + 1)} />
        </Modal>
      )}
    </div>
  );
}

function MessageCard({
  message: m,
  room,
  onReply,
  onInspect,
}: {
  message: Message;
  room: Room;
  onReply: () => void;
  onInspect: () => void;
}) {
  const [source, setSource] = useState(false);
  const agent = room.agents.find((a) => a.id === m.authorId);
  const binding = agentAtSnapshot(room, m.authorId, m.snapshotId);
  const prior = room.messages.find((p) => p.id === m.replyTo);
  const attempt = room.jobs.find((j) => j.messageId === m.id);
  const response = room.requests.find((r) => r.id === attempt?.requestId);
  return (
    <article
      className={`message ${agent?.color ?? 'human'} ${m.type}`}
      aria-label={`${nameOf(room, m.authorId, m.snapshotId)} ${m.type}`}
    >
      <div className={`avatar ${agent?.color ?? 'human'}`}>
        {binding ? binding.name.at(-1) : 'Y'}
      </div>
      <div className="message-content">
        <div className="message-meta">
          <strong>{nameOf(room, m.authorId, m.snapshotId)}</strong>
          <span>
            {m.type === 'synthesis'
              ? 'SYNTHESIS'
              : agent
                ? binding?.provider === 'simulated'
                  ? 'SIMULATED AGENT'
                  : `${binding?.provider.toUpperCase()} / ${binding?.model}`
                : m.type.toUpperCase()}
          </span>
          <time dateTime={m.createdAt}>{time(m.createdAt)}</time>
          {m.status !== 'complete' && <Badge value={m.status} />}
        </div>
        <div className="address-line">
          To{' '}
          {m.recipientIds.length
            ? m.recipientIds.map((id) => nameOf(room, id, m.snapshotId)).join(', ')
            : 'room observers'}
          <span> · room-visible</span>
          {prior && <span> · replying to #{prior.sequence}</span>}
          {response?.phase === 'consultation' &&
            response.status === 'ready' &&
            m.status === 'complete' &&
            !response.includedMessageIds.includes(m.id) && (
              <span> · arrived after the set closed</span>
            )}
        </div>
        <MessageText
          text={m.body}
          source={source}
          streaming={m.status === 'streaming'}
          placeholder={
            attempt?.kind === 'decision'
              ? m.status === 'streaming'
                ? 'Choosing the next question or final answer…'
                : 'No coordinator action accepted. Inspect this attempt for details.'
              : m.status === 'streaming'
                ? 'Preparing a response…'
                : 'No answer text received.'
          }
        />
        <div className="message-actions">
          <button
            onClick={onReply}
            disabled={
              Boolean(room.archivedAt) ||
              m.status !== 'complete' ||
              (agent && !isAgentActive(agent))
            }
            title={
              agent && !isAgentActive(agent)
                ? 'Reactivate this participant in Settings to reply.'
                : undefined
            }
          >
            Reply to {agent ? nameOf(room, agent.id) : 'message'}
          </button>
          <button onClick={onInspect}>
            <Glyph kind="inspect" size={12} />
            Inspect context
          </button>
          {!!m.body && (
            <>
              <button
                type="button"
                aria-pressed={source}
                onClick={() => setSource((value) => !value)}
              >
                {source ? 'View formatted' : 'View source'}
              </button>
              <CopyButton
                text={m.body}
                label="Copy message"
                onUnavailable={() => setSource(true)}
              />
            </>
          )}
          <span className="message-sequence">#{m.sequence}</span>
        </div>
      </div>
    </article>
  );
}

function RelayCard({ relay, room }: { relay: Relay; room: Room }) {
  const snapshotId = room.messages.find((m) => m.id === relay.messageId)?.snapshotId;
  return (
    <div className="response-set relay-status" aria-label="Relay progress">
      <div>
        <span className="collection-label">AUTOMATIC RELAY</span>
        <strong>
          {relay.completedSteps} / {relay.order.length} complete
        </strong>
        <Badge value={relay.status} />
      </div>
      <p>{relay.order.map((id) => nameOf(room, id, snapshotId)).join(' → ')}</p>
      <small className="muted">
        Each completed answer is delivered to the next selected agent. The final answer returns to
        you.
      </small>
      {relay.error && <p className="form-error">{relay.error}</p>}
    </div>
  );
}

function DiscussionCard({
  discussion: d,
  room,
  onStop,
}: {
  discussion: Discussion;
  room: Room;
  onStop: () => Promise<void>;
}) {
  const [stopping, setStopping] = useState(false);
  const open = ['running', 'waiting', 'blocked'].includes(d.status);
  return (
    <div className="response-set discussion-status" aria-label="Discussion progress">
      <div>
        <span className="collection-label">AGENT DISCUSSION</span>
        <strong>
          {nameOf(room, d.leaderId, room.messages.find((m) => m.id === d.messageId)?.snapshotId)}{' '}
          coordinates
        </strong>
        <Badge value={d.status} />
      </div>
      <p>
        {d.roundsUsed} / {d.maxRounds} peer rounds · {d.turnsUsed} / {d.maxTurns} turns used
      </p>
      <small className="muted">
        The coordinator chooses peers, a collection policy, and targeted follow-ups. Peer answers
        stay separate. One correction attempt per invalid decision may run within this allowance.
      </small>
      {d.error && <p className="form-error">{d.error}</p>}
      {open && (
        <button
          type="button"
          className="quiet discussion-stop"
          disabled={stopping}
          onClick={() => {
            setStopping(true);
            void onStop().finally(() => setStopping(false));
          }}
        >
          {stopping ? 'Stopping…' : 'Stop discussion'}
        </button>
      )}
    </div>
  );
}

function ResponseSet({ request, room }: { request: Request; room: Room }) {
  const completed = request.recipientIds.filter((id) =>
    room.jobs.some(
      (j) =>
        j.requestId === request.id &&
        j.agentId === id &&
        j.kind === 'answer' &&
        j.status === 'completed',
    ),
  ).length;
  return (
    <div className="response-set">
      <div>
        <span className="collection-label">RESPONSE SET</span>
        <strong>
          {completed} / {request.recipientIds.length} received
        </strong>
        <Badge value={request.status} />
      </div>
      <p>
        {request.policy === 'all'
          ? 'Wait for every selected agent'
          : request.policy === 'any'
            ? 'Use the first complete answer; remaining agents continue'
            : `Wait for ${request.quorum} complete answers`}
        {request.synthesisAgentId
          ? ` · then ${nameOf(room, request.synthesisAgentId, request.snapshotId)} synthesizes`
          : request.phase === 'consultation'
            ? ` · then ${nameOf(room, room.discussions.find((d) => d.id === request.discussionId)!.leaderId, request.snapshotId)} continues`
            : ' · preserve individual answers'}
      </p>
      <div className="respondents">
        {request.recipientIds.map((id) => {
          const job = room.jobs
            .filter((j) => j.requestId === request.id && j.agentId === id && j.kind === 'answer')
            .at(-1);
          return (
            <span key={id} className={job?.status === 'completed' ? 'received' : ''}>
              {nameOf(room, id, request.snapshotId)}
              <small>{job?.status}</small>
            </span>
          );
        })}
      </div>
      {request.status === 'collecting' && (
        <small className="muted">
          Deadline {time(request.deadlineAt)}. Timeout pauses this room.
        </small>
      )}
    </div>
  );
}

function AgentCard({
  agent,
  room,
  onRetry,
  onConfigure,
}: {
  agent: Agent;
  room: Room;
  onRetry: (id: string) => Promise<void>;
  onConfigure: () => void;
}) {
  const jobs = room.jobs.filter((j) => j.agentId === agent.id);
  const active = jobs.find((j) => j.status === 'running');
  const queued = jobs.filter((j) => j.status === 'queued').length;
  const latest = jobs.at(-1);
  const request = room.requests.find((r) => r.id === latest?.requestId);
  const discussion = room.discussions.find((d) => d.id === latest?.discussionId);
  const retryable =
    latest &&
    ![latest.snapshotId, request?.snapshotId].some(
      (id) => room.snapshots.find((s) => s.id === id)?.deletedMessageIds?.length,
    ) &&
    ['failed', 'interrupted'].includes(latest.status) &&
    request &&
    !['cancelled', 'timed_out'].includes(request.status) &&
    (request.status !== 'ready' || latest.kind === 'synthesis') &&
    (!discussion || !['completed', 'cancelled'].includes(discussion.status));
  return (
    <div className={`agent-card ${agent.color}`}>
      <div className="agent-top">
        <span className={`avatar ${agent.color}`}>{agent.name.at(-1)}</span>
        <div>
          <strong>{nameOf(room, agent.id)}</strong>
          <small>
            {agent.provider} / {agent.model}
          </small>
        </div>
        <span className={`agent-state ${active ? 'working' : ''}`}>
          {active ? 'generating' : queued ? `${queued} queued` : 'idle'}
        </span>
      </div>
      <p>{agent.role}</p>
      <button className="configure-agent" onClick={onConfigure}>
        Configure {nameOf(room, agent.id)}
      </button>
      {latest?.error && (
        <div className="job-error">
          {latest.error}
          {retryable && (
            <button
              onClick={() => {
                void onRetry(latest.id);
              }}
              disabled={Boolean(room.archivedAt) || room.status === 'stopped'}
            >
              Retry this attempt
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Composer({
  room,
  defaults,
  threadId,
  reply,
  onClearReply,
  onSent,
  onError,
}: {
  room: Room;
  defaults: AppSettings;
  threadId: string | null;
  reply: Message | null;
  onClearReply: () => void;
  onSent: (threadId: string) => Promise<void>;
  onError: (error: string) => void;
}) {
  const activeAgents = room.agents.filter(isAgentActive);
  const [body, setBody] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [recipients, setRecipients] = useState(() =>
    (activeAgents.length > 1 ? activeAgents.slice(1) : activeAgents).map((a) => a.id),
  );
  const [type, setType] = useState<'question' | 'update' | 'relay' | 'discussion'>('question');
  const [leaderId, setLeaderId] = useState(activeAgents[0]?.id ?? '');
  const [maxRounds, setMaxRounds] = useState(defaults.defaultDiscussionRounds);
  const [maxTurns, setMaxTurns] = useState(defaults.defaultDiscussionTurns);
  const [relayOrder, setRelayOrder] = useState(() =>
    activeAgents.length > 1
      ? [
          activeAgents[0]!.id,
          ...activeAgents
            .slice(1)
            .toReversed()
            .map((a) => a.id),
          activeAgents[0]!.id,
        ]
      : activeAgents.map((a) => a.id),
  );
  const [policy, setPolicy] = useState<SendInput['policy']>(defaults.defaultPolicy);
  const [quorum, setQuorum] = useState(1);
  const [synthesis, setSynthesis] = useState(defaults.defaultSynthesis);
  const [synthesizerId, setSynthesizerId] = useState(
    activeAgents.length > 1 ? activeAgents[0]!.id : '',
  );
  const [sending, setSending] = useState(false);
  const [deadlineSeconds, setDeadlineSeconds] = useState(defaults.defaultDeadlineSeconds);
  const clientId = useRef<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const rosterKey = activeAgents.map((a) => a.id).join(',');
  const previousRoster = useRef(rosterKey);
  const [rosterChanged, setRosterChanged] = useState(false);
  useEffect(() => {
    if (previousRoster.current === rosterKey) return;
    previousRoster.current = rosterKey;
    const ids = new Set(activeAgents.map((a) => a.id));
    setRecipients((prior) => prior.filter((id) => ids.has(id)));
    setRelayOrder((prior) => prior.filter((id) => ids.has(id)));
    setLeaderId((prior) => (ids.has(prior) ? prior : (activeAgents[0]?.id ?? '')));
    setSynthesizerId((prior) => (ids.has(prior) ? prior : ''));
    setQuorum((prior) =>
      Math.min(prior, Math.max(1, recipients.filter((id) => ids.has(id)).length)),
    );
    clientId.current = null;
    setRosterChanged(true);
  }, [rosterKey]);
  useEffect(() => {
    if (reply) {
      if (activeAgents.some((a) => a.id === reply.authorId)) setRecipients([reply.authorId]);
      setSynthesis(false);
      setType('question');
      clientId.current = null;
      textarea.current?.focus();
    }
  }, [reply]);
  const synthesizer = activeAgents.find(
    (a) => a.id === synthesizerId && !recipients.includes(a.id),
  );
  const synthesisCandidate = synthesizer ?? activeAgents.find((a) => !recipients.includes(a.id));
  const invalidRouting =
    (type === 'question' && !recipients.length) ||
    (type === 'relay' && !relayOrder.length) ||
    (type === 'discussion' && !leaderId);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (
      sending ||
      refreshing ||
      !body.trim() ||
      room.archivedAt ||
      room.status === 'stopped' ||
      invalidRouting
    )
      return;
    setSending(true);
    onError('');
    clientId.current ??= crypto.randomUUID();
    try {
      const result = await api.send(room.id, {
        clientId: clientId.current,
        body,
        type: type === 'relay' || type === 'discussion' ? 'question' : type,
        recipientIds:
          type === 'discussion'
            ? [leaderId]
            : type === 'relay'
              ? relayOrder.slice(0, 1)
              : recipients,
        policy: type === 'relay' || type === 'discussion' ? 'all' : policy,
        quorum,
        synthesisAgentId: type === 'question' && synthesis && synthesizer ? synthesizer.id : null,
        threadId,
        replyTo: reply?.id ?? null,
        deadlineSeconds,
        relayOrder: type === 'relay' ? relayOrder : [],
        discussion: type === 'discussion' ? { maxRounds, maxTurns } : null,
      });
      setBody('');
      setRosterChanged(false);
      clientId.current = null;
      setRefreshing(true);
      setSending(false);
      await onSent(result.threadId);
    } catch (e) {
      onError(errorText(e));
    } finally {
      setSending(false);
      setRefreshing(false);
    }
  }
  return (
    <form
      className="composer"
      onSubmit={(e) => {
        void send(e);
      }}
    >
      <fieldset className="composer-fields" disabled={Boolean(room.archivedAt)}>
        {rosterChanged && (
          <p className="notice">
            Participants changed. Review recipients, coordinator, and relay steps before sending.
            Your draft is preserved.
          </p>
        )}
        {reply && (
          <div className="reply-indicator">
            Replying to {nameOf(room, reply.authorId, reply.snapshotId)} · #{reply.sequence}
            <button type="button" onClick={onClearReply} aria-label="Cancel reply">
              <Glyph kind="close" size={14} />
            </button>
          </div>
        )}
        {type !== 'relay' && type !== 'discussion' && (
          <div className="recipient-row">
            <span className="eyebrow">TO</span>
            {activeAgents.map((a) => (
              <label
                className={`recipient ${a.color} ${recipients.includes(a.id) ? 'checked' : ''}`}
                key={a.id}
              >
                <input
                  type="checkbox"
                  checked={recipients.includes(a.id)}
                  onChange={() => {
                    clientId.current = null;
                    const next = recipients.includes(a.id)
                      ? recipients.filter((id) => id !== a.id)
                      : [...recipients, a.id];
                    setRecipients(next);
                    setSynthesizerId(
                      activeAgents.find((agent) => !next.includes(agent.id))?.id ?? '',
                    );
                  }}
                />
                <span>{nameOf(room, a.id)}</span>
              </label>
            ))}
            <span className="visibility-label">Visible to the room</span>
          </div>
        )}
        {type === 'discussion' && (
          <div className="discussion-editor">
            <label>
              Coordinator
              <select
                aria-label="Discussion coordinator"
                value={leaderId}
                onChange={(e) => {
                  setLeaderId(e.target.value);
                  clientId.current = null;
                }}
              >
                {activeAgents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {nameOf(room, a.id)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Peer rounds
              <input
                aria-label="Maximum peer rounds"
                type="number"
                required
                min={1}
                max={10}
                value={maxRounds}
                onChange={(e) => {
                  setMaxRounds(Number(e.target.value));
                  clientId.current = null;
                }}
              />
            </label>
            <label>
              Turn allowance
              <input
                aria-label="Discussion turn allowance"
                type="number"
                required
                min={2}
                max={50}
                value={maxTurns}
                onChange={(e) => {
                  setMaxTurns(Number(e.target.value));
                  clientId.current = null;
                }}
              />
            </label>
            <p>
              Allow {nameOf(room, leaderId)} to ask permitted active peers, collect answers, and
              follow up. All messages stay visible to you.
            </p>
          </div>
        )}
        {type === 'relay' && (
          <div className="relay-editor">
            <span className="eyebrow">RELAY ORDER</span>
            <div className="relay-steps">
              {relayOrder.map((id, index) => (
                <label key={index}>
                  <span>{index + 1}</span>
                  <select
                    aria-label={`Relay step ${index + 1}`}
                    value={id}
                    onChange={(e) => {
                      setRelayOrder((order) =>
                        order.map((value, i) => (i === index ? e.target.value : value)),
                      );
                      clientId.current = null;
                    }}
                  >
                    {activeAgents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {nameOf(room, a.id)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label={`Remove relay step ${index + 1}`}
                    disabled={relayOrder.length === 1}
                    onClick={() => {
                      setRelayOrder((order) => order.filter((_, i) => i !== index));
                      clientId.current = null;
                    }}
                  >
                    ×
                  </button>
                </label>
              ))}
            </div>
            <button
              type="button"
              disabled={relayOrder.length >= 12}
              onClick={() => {
                setRelayOrder((order) => [...order, activeAgents[0]!.id]);
                clientId.current = null;
              }}
            >
              Add relay step
            </button>
          </div>
        )}
        <textarea
          ref={textarea}
          aria-label="Message"
          placeholder={
            type !== 'update'
              ? 'What should the agents explore?'
              : 'Share an update. No replies will be scheduled.'
          }
          value={body}
          maxLength={12000}
          rows={3}
          onChange={(e) => {
            setBody(e.target.value);
            clientId.current = null;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          disabled={sending || room.status === 'stopped'}
        />
        <div className="composer-bottom">
          <div className="composer-options">
            <select
              aria-label="Message type"
              value={type}
              onChange={(e) => {
                setType(e.target.value as typeof type);
                clientId.current = null;
              }}
            >
              <option value="question">Question</option>
              <option value="relay">Automatic relay</option>
              <option value="discussion">Agent discussion</option>
              <option value="update">Update · no reply</option>
            </select>
            {type !== 'update' && (
              <label className="deadline-option">
                Deadline (s)
                <input
                  aria-label="Response deadline in seconds"
                  className="quorum"
                  type="number"
                  required
                  min={5}
                  max={600}
                  value={deadlineSeconds}
                  onChange={(e) => {
                    setDeadlineSeconds(Number(e.target.value));
                    clientId.current = null;
                  }}
                />
              </label>
            )}
            {type === 'question' && (
              <>
                <select
                  aria-label="Response policy"
                  value={policy}
                  onChange={(e) => {
                    setPolicy(e.target.value as typeof policy);
                    clientId.current = null;
                  }}
                >
                  <option value="all">Wait for all</option>
                  <option value="any">First answer</option>
                  <option value="quorum">Quorum</option>
                </select>
                {policy === 'quorum' && (
                  <input
                    className="quorum"
                    aria-label="Required answers"
                    type="number"
                    min={1}
                    max={Math.max(1, recipients.length)}
                    value={quorum}
                    onChange={(e) => {
                      setQuorum(Number(e.target.value));
                      clientId.current = null;
                    }}
                  />
                )}
                <label className="synthesis-option">
                  <input
                    type="checkbox"
                    checked={synthesis && !!synthesizer}
                    disabled={!synthesisCandidate}
                    onChange={(e) => {
                      setSynthesis(e.target.checked);
                      if (e.target.checked && !synthesizer && synthesisCandidate)
                        setSynthesizerId(synthesisCandidate.id);
                      clientId.current = null;
                    }}
                  />
                  {synthesizer
                    ? `${nameOf(room, synthesizer.id)} synthesizes`
                    : synthesisCandidate
                      ? 'Synthesize collected answers'
                      : 'No separate synthesizer'}
                </label>
              </>
            )}
          </div>
          <button
            className="primary send-button"
            type="submit"
            disabled={
              sending || refreshing || !body.trim() || room.status === 'stopped' || invalidRouting
            }
          >
            {sending
              ? 'Sending…'
              : refreshing
                ? 'Updating…'
                : room.status === 'paused'
                  ? 'Queue'
                  : 'Send'}
            <Glyph kind="send" size={15} />
          </button>
        </div>
        <div className="composer-footnote">
          <span>
            {threadId ? 'This thread' : 'Starts a new thread'} ·{' '}
            {type === 'update'
              ? 'No agents invoked'
              : type === 'relay'
                ? `${relayOrder.length} turns reserved; each hop waits for the previous answer`
                : type === 'discussion'
                  ? `${maxTurns} turns reserved, including decisions, peer answers, and correction attempts`
                  : 'Independent answers from the same starting context'}
          </span>
          <span>Ctrl / ⌘ + Enter</span>
        </div>
      </fieldset>
    </form>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    return () => el.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="modal"
      aria-labelledby={titleId}
    >
      <div className="modal-heading">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <Glyph kind="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function DeleteConfirmation({
  target,
  onClose,
  onDelete,
}: {
  target: DeleteTarget;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function remove() {
    setBusy(true);
    setError('');
    try {
      await onDelete();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`Delete ${target.kind}?`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="delete-confirmation">
        <p className="delete-name">{target.title}</p>
        <p>
          {target.kind === 'workspace'
            ? 'This permanently deletes the workspace, its participants, all threads, messages, and local history. Active work is cancelled.'
            : 'This permanently deletes this thread, its messages, and stored source copies. Pending work that uses this context is cancelled. Other threads and turns already used are kept.'}
        </p>
        <p className="muted">
          This cannot be undone. Copies already sent to providers or exported to files remain
          outside this app.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="settings-actions">
          <button type="button" autoFocus disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className="danger-button"
            disabled={busy}
            onClick={() => {
              void remove();
            }}
          >
            {busy ? 'Deleting…' : `Delete ${target.kind}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
function ArchiveConfirmation({
  target,
  pending,
  onClose,
  onConfirm,
}: {
  target: ArchiveTarget;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal
      title={`${target.archived ? 'Archive' : 'Restore'} workspace?`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="archive-confirmation">
        <p className="delete-name">{target.title}</p>
        <p>
          {target.archived
            ? 'Keep this workspace and its full history in the archive. Finish or stop pending work first. Archived workspaces cannot send messages, run connection tests, or change settings.'
            : 'Return this workspace to the active list. Its history and consumed turns stay unchanged. It remains paused until you explicitly resume.'}
        </p>
        {target.archived && pending && (
          <p className="notice">Finish or stop pending work before archiving.</p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="settings-actions">
          <button autoFocus disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={busy || (target.archived && pending)}
            onClick={() => {
              setBusy(true);
              setError('');
              void onConfirm().catch((e: unknown) => {
                setError(errorText(e));
                setBusy(false);
              });
            }}
          >
            {busy ? 'Working…' : `${target.archived ? 'Archive' : 'Restore'} workspace`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function RenameThread({
  target,
  archived,
  onClose,
  onSave,
}: {
  target: RenameTarget;
  archived: boolean;
  onClose: () => void;
  onSave: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(target.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal
      title="Rename thread"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="room-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || archived || !title.trim()) return;
          setBusy(true);
          setError('');
          void onSave(title).catch((e: unknown) => {
            setError(errorText(e));
            setBusy(false);
          });
        }}
      >
        <p className="muted">
          Change the name without changing messages, reply links, or pending work.
        </p>
        {archived && <p className="notice">Restore this workspace before renaming its threads.</p>}
        <label>
          Thread name
          <input
            autoFocus
            required
            maxLength={100}
            value={title}
            disabled={busy || archived}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="settings-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy || archived || !title.trim()}>
            {busy ? 'Saving…' : 'Save thread name'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function NewRoom({
  defaults,
  onClose,
  onCreated,
}: {
  defaults: AppSettings;
  onClose: () => void;
  onCreated: (room: Room) => void;
}) {
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [maxTurns, setMaxTurns] = useState(defaults.defaultMaxTurns);
  const [participantCount, setParticipantCount] = useState(3);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      onCreated(await api.create({ title, objective, maxTurns, participantCount }));
    } catch (ex) {
      setError(errorText(ex));
      setBusy(false);
    }
  }
  return (
    <Modal title="New workspace" onClose={onClose}>
      <form
        className="room-form"
        onSubmit={(e) => {
          void create(e);
        }}
      >
        <label>
          Workspace name
          <input
            value={title}
            maxLength={100}
            required
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What are we working on?"
            autoFocus
          />
        </label>
        <label>
          Shared objective
          <textarea
            value={objective}
            rows={4}
            maxLength={3000}
            onChange={(e) => setObjective(e.target.value)}
            placeholder="Give the agents a clear objective."
          />
        </label>
        <label>
          Turn limit
          <input
            type="number"
            value={maxTurns}
            min={1}
            max={1000}
            required
            onChange={(e) => setMaxTurns(Number(e.target.value))}
          />
        </label>
        <label>
          Participant count
          <input
            type="number"
            required
            min={1}
            max={maxParticipants}
            value={participantCount}
            onChange={(e) => setParticipantCount(Number(e.target.value))}
          />
        </label>
        <p className="muted">
          Participants start in simulation. Configure each to connect a real model. Add or
          deactivate participants in Settings.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy || !title.trim()}>
          {busy ? 'Creating…' : 'Create workspace'}
        </button>
      </form>
    </Modal>
  );
}
function Snapshot({ snapshot, room }: { snapshot: ContextSnapshot; room: Room }) {
  return (
    <div className="snapshot">
      {!!snapshot.deletedMessageIds?.length && (
        <p className="notice">
          {snapshot.deletedMessageIds.length} source{' '}
          {snapshot.deletedMessageIds.length === 1 ? 'message was' : 'messages were'} removed by
          thread deletion. This is a redacted record of the prior invocation and cannot be reused
          for a retry.
        </p>
      )}
      <div className="snapshot-meta">
        <Badge value="frozen" />
        <span>
          Through sequence {snapshot.sequence} · {snapshot.messages.length} source messages
        </span>
      </div>
      <p>
        <strong>Objective:</strong> {snapshot.objective}
      </p>
      <details>
        <summary>Participant roles at invocation</summary>
        {snapshot.agents.map((a) => (
          <p key={a.id}>
            <strong>{a.name}</strong>: {a.role} · {a.provider} / {a.model} · configuration{' '}
            {a.configRevision ?? 0}
          </p>
        ))}
      </details>
      {snapshot.messages.map((m) => (
        <div className="snapshot-message" key={m.id}>
          <strong>
            {m.authorId === 'human'
              ? 'You'
              : (m.authorName ??
                snapshot.agents.find((a) => a.id === m.authorId)?.name ??
                nameOf(room, m.authorId))}{' '}
            · {m.type}
          </strong>
          <p>{m.body}</p>
          <small>{m.id}</small>
        </div>
      ))}
    </div>
  );
}
