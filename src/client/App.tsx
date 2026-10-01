import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type {
  Agent,
  ContextSnapshot,
  Message,
  Request,
  Room,
  RoomSummary,
  SendInput,
} from '../shared/contracts.js';
import { api, watch } from './api.js';

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
    | 'inspect';
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
function nameOf(room: Room, id: string) {
  return id === 'human' ? 'You' : (room.agents.find((a) => a.id === id)?.name ?? id);
}
function time(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function App() {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [newRoom, setNewRoom] = useState(false);
  const [reply, setReply] = useState<Message | null>(null);
  const [inspect, setInspect] = useState<Message | null>(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('aib-theme') ?? 'dark');
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
        setRooms(list);
        setRoomId((current) => current ?? list[0]?.id ?? null);
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
    follow.current = true;
  }, [roomId]);
  useEffect(() => {
    if (!roomId) return;
    const abort = new AbortController();
    void api
      .room(roomId, abort.signal)
      .then(setRoom)
      .catch((e: unknown) => {
        if (!abort.signal.aborted) setError(errorText(e));
      });
    return () => abort.abort();
  }, [roomId, tick]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('aib-theme', theme);
  }, [theme]);
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
    setThreadId(id);
    setReply(null);
    follow.current = true;
    setFollowLatest(true);
  }
  const shown = room?.messages.filter((m) => !threadId || m.threadId === threadId) ?? [];
  const activeCount = room?.jobs.filter((j) => j.status === 'running').length ?? 0;
  const queueCount = room?.jobs.filter((j) => j.status === 'queued').length ?? 0;
  const snapshots =
    inspect && room ? room.snapshots.find((s) => s.id === inspect.snapshotId) : null;

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
          LOCAL SIMULATION<span className="version">v0.1.0</span>
        </div>
        <div className="header-actions">
          <span className={`connection ${connected ? 'online' : ''}`}>
            <i />
            {connected ? 'Service connected' : 'Reconnecting'}
          </span>
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
      <div className="workspace">
        <aside className="sidebar">
          <div className="section-heading">
            <h2>WORKSPACE</h2>
            <button className="icon-button" aria-label="New room" onClick={() => setNewRoom(true)}>
              <Glyph kind="plus" />
            </button>
          </div>
          <nav className="room-list" aria-label="Rooms">
            {rooms.map((r) => (
              <button
                className={`room-item ${r.id === roomId ? 'selected' : ''}`}
                key={r.id}
                onClick={() => setRoomId(r.id)}
              >
                <Glyph kind="chat" />
                <span>
                  {r.title}
                  <small>{r.status === 'running' ? 'Open conversation' : r.status}</small>
                </span>
              </button>
            ))}
          </nav>
          {room && (
            <>
              <div className="objective">
                <span className="eyebrow">SHARED OBJECTIVE</span>
                <p>{room.objective || 'No objective set.'}</p>
              </div>
              <div className="section-heading">
                <h2>THREADS</h2>
                <span>{room.threads.length}</span>
              </div>
              <nav className="thread-list" aria-label="Threads">
                <button className={!threadId ? 'selected' : ''} onClick={() => chooseThread(null)}>
                  <Glyph kind="branch" />
                  <span>All messages</span>
                  <small>{room.messages.length}</small>
                </button>
                {room.threads.map((t) => (
                  <button
                    className={threadId === t.id ? 'selected' : ''}
                    key={t.id}
                    onClick={() => chooseThread(t.id)}
                  >
                    <span className="thread-mark">#</span>
                    <span>{t.title}</span>
                    <small>{room.messages.filter((m) => m.threadId === t.id).length}</small>
                  </button>
                ))}
              </nav>
            </>
          )}
          <div className="sidebar-footer">
            <span className="eyebrow">YOUR MACHINE · YOUR WORKSPACE</span>
            <p>Messages stay local in this build. Simulated agents make no external calls.</p>
            <span className="muted">Work continues while the service runs.</span>
          </div>
        </aside>
        <main className="conversation">
          <div className="conversation-header">
            <div>
              <span className="eyebrow">{threadId ? 'THREAD' : 'CONVERSATION'}</span>
              <h1>
                {threadId
                  ? room?.threads.find((t) => t.id === threadId)?.title
                  : (room?.title ?? 'Loading workspace…')}
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
                    room.status === 'running' && !activeCount && !queueCount ? 'idle' : room.status
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
                disabled={busy || !room || room.status !== 'running'}
                onClick={() => {
                  void control('pause');
                }}
                title="Pause new dispatches; active answers may finish"
              >
                <Glyph kind="pause" size={14} />
                Pause
              </button>
              <button
                disabled={busy || !room || room.status === 'running'}
                onClick={() => {
                  void control('resume');
                }}
              >
                <Glyph kind="play" size={14} />
                Resume
              </button>
              <button
                className="stop-button"
                disabled={busy || !room || room.status === 'stopped'}
                onClick={() => {
                  void control('stop');
                }}
              >
                <Glyph kind="stop" size={13} />
                Stop
              </button>
            </div>
          </div>
          {room?.status === 'paused' && (
            <div className="notice">
              Dispatch is paused. Active answers may finish. Resume to run queued work.
            </div>
          )}
          {room?.status === 'stopped' && (
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
            {!room && (
              <div className="loading-placeholder" role="status">
                Opening room…
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
                  This first build uses deterministic simulated agents to verify the conversation
                  flow.
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
                  {m.type === 'question' && room.requests.find((r) => r.id === m.requestId) && (
                    <ResponseSet
                      request={room.requests.find((r) => r.id === m.requestId)!}
                      room={room}
                    />
                  )}
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
          {room && (
            <Composer
              key={room.id}
              room={room}
              threadId={threadId}
              reply={reply}
              onClearReply={() => setReply(null)}
              onSent={(id) => {
                setThreadId(id);
                setReply(null);
                setTick((v) => v + 1);
                follow.current = true;
              }}
              onError={setError}
            />
          )}
        </main>
        <aside className="activity-panel">
          <div className="section-heading">
            <h2>PARTICIPANTS</h2>
            <span>{room?.agents.length ?? 0}</span>
          </div>
          {room?.agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              room={room}
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
                Each generation counts as a turn. Updates do not. No provider charges in simulation.
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
      </div>
      {newRoom && (
        <NewRoom
          onClose={() => setNewRoom(false)}
          onCreated={(next) => {
            setRoomId(next.id);
            setTick((v) => v + 1);
            setNewRoom(false);
          }}
        />
      )}
      {inspect && room && (
        <Modal
          title={`Message #${inspect.sequence} · ${nameOf(room, inspect.authorId)}`}
          onClose={() => setInspect(null)}
        >
          <p className="muted">Message ID: {inspect.id}</p>
          <p>Visible to the room · reply to {inspect.replyTo ?? 'none'}</p>
          {snapshots ? (
            <Snapshot snapshot={snapshots} room={room} />
          ) : (
            <p>This message has no invocation context snapshot.</p>
          )}
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
  const agent = room.agents.find((a) => a.id === m.authorId);
  const prior = room.messages.find((p) => p.id === m.replyTo);
  return (
    <article
      className={`message ${agent?.color ?? 'human'} ${m.type}`}
      aria-label={`${nameOf(room, m.authorId)} ${m.type}`}
    >
      <div className={`avatar ${agent?.color ?? 'human'}`}>{agent ? agent.name.at(-1) : 'Y'}</div>
      <div className="message-content">
        <div className="message-meta">
          <strong>{nameOf(room, m.authorId)}</strong>
          <span>
            {m.type === 'synthesis'
              ? 'SYNTHESIS'
              : agent
                ? 'SIMULATED AGENT'
                : m.type.toUpperCase()}
          </span>
          <time dateTime={m.createdAt}>{time(m.createdAt)}</time>
          {m.status !== 'complete' && <Badge value={m.status} />}
        </div>
        <div className="address-line">
          To{' '}
          {m.recipientIds.length
            ? m.recipientIds.map((id) => nameOf(room, id)).join(', ')
            : 'room observers'}
          <span> · room-visible</span>
          {prior && <span> · replying to #{prior.sequence}</span>}
        </div>
        <p className="message-body">
          {m.body ||
            (m.status === 'streaming' ? 'Preparing a response…' : 'No answer text received.')}
          {m.status === 'streaming' && <span className="stream-cursor" />}
        </p>
        <div className="message-actions">
          <button onClick={onReply} disabled={m.status !== 'complete'}>
            Reply to {agent?.name ?? 'message'}
          </button>
          <button onClick={onInspect}>
            <Glyph kind="inspect" size={12} />
            Inspect context
          </button>
          <span>#{m.sequence}</span>
        </div>
      </div>
    </article>
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
          ? ` · then ${nameOf(room, request.synthesisAgentId)} synthesizes`
          : ' · preserve individual answers'}
      </p>
      <div className="respondents">
        {request.recipientIds.map((id) => {
          const job = room.jobs
            .filter((j) => j.requestId === request.id && j.agentId === id && j.kind === 'answer')
            .at(-1);
          return (
            <span key={id} className={job?.status === 'completed' ? 'received' : ''}>
              {nameOf(room, id)}
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
}: {
  agent: Agent;
  room: Room;
  onRetry: (id: string) => Promise<void>;
}) {
  const jobs = room.jobs.filter((j) => j.agentId === agent.id);
  const active = jobs.find((j) => j.status === 'running');
  const queued = jobs.filter((j) => j.status === 'queued').length;
  const latest = jobs.at(-1);
  const request = room.requests.find((r) => r.id === latest?.requestId);
  const retryable =
    latest &&
    ['failed', 'interrupted'].includes(latest.status) &&
    request &&
    !['cancelled', 'timed_out'].includes(request.status) &&
    (request.status !== 'ready' || latest.kind === 'synthesis');
  return (
    <div className={`agent-card ${agent.color}`}>
      <div className="agent-top">
        <span className={`avatar ${agent.color}`}>{agent.name.at(-1)}</span>
        <div>
          <strong>{agent.name}</strong>
          <small>simulation-v1</small>
        </div>
        <span className={`agent-state ${active ? 'working' : ''}`}>
          {active ? 'generating' : queued ? `${queued} queued` : 'idle'}
        </span>
      </div>
      <p>{agent.role}</p>
      {latest?.error && (
        <div className="job-error">
          {latest.error}
          {retryable && (
            <button
              onClick={() => {
                void onRetry(latest.id);
              }}
              disabled={room.status === 'stopped'}
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
  threadId,
  reply,
  onClearReply,
  onSent,
  onError,
}: {
  room: Room;
  threadId: string | null;
  reply: Message | null;
  onClearReply: () => void;
  onSent: (threadId: string) => void;
  onError: (error: string) => void;
}) {
  const [body, setBody] = useState('');
  const [recipients, setRecipients] = useState(room.agents.slice(1).map((a) => a.id));
  const [type, setType] = useState<'question' | 'update'>('question');
  const [policy, setPolicy] = useState<SendInput['policy']>('all');
  const [quorum, setQuorum] = useState(1);
  const [synthesis, setSynthesis] = useState(true);
  const [sending, setSending] = useState(false);
  const clientId = useRef<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (reply) {
      if (room.agents.some((a) => a.id === reply.authorId)) setRecipients([reply.authorId]);
      setSynthesis(false);
      setType('question');
      clientId.current = null;
      textarea.current?.focus();
    }
  }, [reply]);
  const synthesizer = room.agents.find((a) => !recipients.includes(a.id));
  async function send(event: FormEvent) {
    event.preventDefault();
    if (
      sending ||
      !body.trim() ||
      room.status === 'stopped' ||
      (type === 'question' && !recipients.length)
    )
      return;
    setSending(true);
    onError('');
    clientId.current ??= crypto.randomUUID();
    try {
      const result = await api.send(room.id, {
        clientId: clientId.current,
        body,
        type,
        recipientIds: recipients,
        policy,
        quorum,
        synthesisAgentId: type === 'question' && synthesis && synthesizer ? synthesizer.id : null,
        threadId,
        replyTo: reply?.id ?? null,
        deadlineSeconds: 120,
      });
      setBody('');
      clientId.current = null;
      onSent(result.threadId);
    } catch (e) {
      onError(errorText(e));
    } finally {
      setSending(false);
    }
  }
  return (
    <form
      className="composer"
      onSubmit={(e) => {
        void send(e);
      }}
    >
      {reply && (
        <div className="reply-indicator">
          Replying to {nameOf(room, reply.authorId)} · #{reply.sequence}
          <button type="button" onClick={onClearReply} aria-label="Cancel reply">
            <Glyph kind="close" size={14} />
          </button>
        </div>
      )}
      <div className="recipient-row">
        <span className="eyebrow">TO</span>
        {room.agents.map((a) => (
          <label
            className={`recipient ${a.color} ${recipients.includes(a.id) ? 'checked' : ''}`}
            key={a.id}
          >
            <input
              type="checkbox"
              checked={recipients.includes(a.id)}
              onChange={() => {
                clientId.current = null;
                setRecipients((prev) =>
                  prev.includes(a.id) ? prev.filter((id) => id !== a.id) : [...prev, a.id],
                );
              }}
            />
            <span>{a.name}</span>
          </label>
        ))}
        <span className="visibility-label">Visible to the room</span>
      </div>
      <textarea
        ref={textarea}
        aria-label="Message"
        placeholder={
          type === 'question'
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
            <option value="update">Update · no reply</option>
          </select>
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
                  disabled={!synthesizer}
                  onChange={(e) => {
                    setSynthesis(e.target.checked);
                    clientId.current = null;
                  }}
                />
                {synthesizer ? `${synthesizer.name} synthesizes` : 'No separate synthesizer'}
              </label>
            </>
          )}
        </div>
        <button
          className="primary send-button"
          type="submit"
          disabled={
            sending ||
            !body.trim() ||
            room.status === 'stopped' ||
            (type === 'question' && !recipients.length)
          }
        >
          {sending ? 'Sending…' : room.status === 'paused' ? 'Queue' : 'Send'}
          <Glyph kind="send" size={15} />
        </button>
      </div>
      <div className="composer-footnote">
        <span>
          {threadId ? 'This thread' : 'Starts a new thread'} ·{' '}
          {type === 'update'
            ? 'No agents invoked'
            : 'Independent answers from the same starting context'}
        </span>
        <span>Ctrl / ⌘ + Enter</span>
      </div>
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
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    return () => el.close();
  }, []);
  return (
    <dialog ref={dialog} onCancel={onClose} className="modal">
      <div className="modal-heading">
        <h2>{title}</h2>
        <button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <Glyph kind="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function NewRoom({ onClose, onCreated }: { onClose: () => void; onCreated: (room: Room) => void }) {
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [maxTurns, setMaxTurns] = useState(100);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      onCreated(await api.create({ title, objective, maxTurns }));
    } catch (ex) {
      setError(errorText(ex));
      setBusy(false);
    }
  }
  return (
    <Modal title="New conversation room" onClose={onClose}>
      <form
        className="room-form"
        onSubmit={(e) => {
          void create(e);
        }}
      >
        <label>
          Room name
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
        <p className="muted">
          Three independent simulated agents will join this room. No external calls.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy || !title.trim()}>
          {busy ? 'Creating…' : 'Create room'}
        </button>
      </form>
    </Modal>
  );
}
function Snapshot({ snapshot, room }: { snapshot: ContextSnapshot; room: Room }) {
  return (
    <div className="snapshot">
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
            <strong>{a.name}</strong>: {a.role}
          </p>
        ))}
      </details>
      {snapshot.messages.map((m) => (
        <div className="snapshot-message" key={m.id}>
          <strong>
            {nameOf(room, m.authorId)} · {m.type}
          </strong>
          <p>{m.body}</p>
          <small>{m.id}</small>
        </div>
      ))}
    </div>
  );
}
