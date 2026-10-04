import { useRef, useState, type FormEvent } from 'react';
import type {
  ContextSnapshot,
  ContextSummary,
  Room,
  SummaryContext,
  SummaryOriginal,
  SummarySource,
} from '../shared/contracts.js';
import { agentLabel } from '../shared/contracts.js';
import { api, ApiError } from './api.js';
import { CopyButton } from './CopyButton.js';

function OriginalSource({
  roomId,
  summaryId,
  source,
}: {
  roomId: string;
  summaryId: string;
  source: SummarySource;
}) {
  const [original, setOriginal] = useState<SummaryOriginal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="summary-source">
      <p>
        <strong>
          {source.authorName} · #{source.sequence} · {source.type}
        </strong>
        {source.decision ? ` · coordinator ${source.decision.kind} decision` : ''}
      </p>
      <p className="source-text">{source.excerpt}</p>
      <small>
        {source.id} · JSON body SHA-256 {source.sha256}
      </small>
      {source.truncated && (
        <p className="notice">
          This excerpt omits original text. Retrieve the original when this summary is insufficient.
        </p>
      )}
      {source.decision && (
        <details>
          <summary>Original decision links</summary>
          <pre>{JSON.stringify(source.decision, null, 2)}</pre>
        </details>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError('');
          void api
            .summarySource(roomId, summaryId, source.id)
            .then(setOriginal)
            .catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : 'Original source unavailable.'),
            )
            .finally(() => setBusy(false));
        }}
      >
        {busy ? 'Retrieving…' : `Retrieve original #${source.sequence}`}
      </button>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {original && (
        <div role="region" aria-label={`Original source #${source.sequence}`}>
          <p className="muted">
            Exact retained original · {original.authorName}. Reading it makes no provider call.
          </p>
          <pre className="source-text">{original.body}</pre>
          <CopyButton text={original.body} label={`Copy original #${source.sequence}`} />
        </div>
      )}
    </div>
  );
}
export function FrozenSummary({ memory, roomId }: { memory: SummaryContext; roomId: string }) {
  return (
    <div className="context-summary" role="note" aria-label="Frozen context summary">
      <p>
        <strong>{memory.title}</strong> · human-reviewed summary · {memory.sources.length} original
        source links.
      </p>
      {memory.invalidatedAt ? (
        <p className="notice">
          Source deletion invalidated and redacted this summary. It cannot supply a new request or
          retry.
        </p>
      ) : (
        <>
          <p className="source-text">
            <strong>Overview:</strong> {memory.overview}
          </p>
          <p className="source-text">
            <strong>Disagreements:</strong> {memory.disagreements}
          </p>
          <p className="source-text">
            <strong>Open questions:</strong> {memory.openQuestions}
          </p>
          <p className="muted">
            Notes and excerpts preserve attribution; they do not establish agreement, completeness
            or model comprehension. Only explicitly retrieved originals join the next question.
            Instructions and routing stay application controlled.
          </p>
          <p>
            Full originals selected for this context:{' '}
            {memory.retrievedSourceIds.length ? memory.retrievedSourceIds.join(', ') : 'none'}.
          </p>
          <details>
            <summary>Summary source ledger and originals</summary>
            {memory.sources.map((source) => (
              <OriginalSource
                key={source.id}
                roomId={roomId}
                summaryId={memory.id}
                source={source}
              />
            ))}
          </details>
        </>
      )}
    </div>
  );
}
export function FrozenBudget({ delivery }: { delivery: NonNullable<ContextSnapshot['delivery']> }) {
  return (
    <div className="notice" role="note" aria-label="Frozen model context budget">
      <p>
        <strong>
          {delivery.provider} / {delivery.model}
        </strong>{' '}
        · {delivery.measuredCharacters} / {delivery.maxCharacters} application prompt characters ·{' '}
        {delivery.overflow === 'reject' ? 'reject overflow' : 'omit oldest unprotected history'}.
      </p>
      <p>
        Exact system/user text count; provider tokenization and protocol overhead are separate.{' '}
        {delivery.omittedMessageIds.length} original history messages omitted under this reviewed
        policy. Protected instructions, task, retrieved sources and collected answers remain.
      </p>
      {!!delivery.omittedMessageIds.length && (
        <details>
          <summary>Exact omitted original message IDs</summary>
          <ul>
            {delivery.omittedMessageIds.map((id) => (
              <li key={id}>{id}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
export function ContextCursors({ room, agentId }: { room: Room; agentId: string }) {
  const cursors = (room.contextCursors ?? [])
    .filter((cursor) => cursor.agentId === agentId)
    .toSorted((a, b) => b.deliveryNumber - a.deliveryNumber);
  return (
    <details className="context-cursors">
      <summary>Inspect supplied context</summary>
      <p className="muted">
        Locally prepared invocation records. They do not prove remote receipt, reading,
        comprehension or retention. Cursors never suppress sources or trigger work.
      </p>
      {!cursors.length && (
        <p>No recorded context delivery. Legacy invocations have no recovered cursor.</p>
      )}
      {cursors.map((cursor) => (
        <div key={cursor.threadId}>
          <p>
            <strong>
              {room.threads.find((thread) => thread.id === cursor.threadId)?.title ??
                cursor.threadId}
            </strong>{' '}
            · local delivery {cursor.deliveryNumber}
          </p>
          <p>
            {cursor.provider} / {cursor.model} · snapshot sequence {cursor.sourceSequence} ·{' '}
            {room.jobs.find((job) => job.id === cursor.jobId)?.status ?? 'historical'}.
          </p>
          <p>
            {cursor.messageIds.length} complete source bodies · {cursor.summarySourceIds.length}{' '}
            summary references · {cursor.retrievedSourceIds.length} retrieved originals ·{' '}
            {cursor.omittedMessageIds.length} budget omissions.
          </p>
          {!!cursor.deletedSourceIds?.length && (
            <p className="notice">
              {cursor.deletedSourceIds.length} source links were redacted by deletion.
            </p>
          )}
          <details>
            <summary>Exact supplied source IDs</summary>
            <pre>
              {JSON.stringify(
                {
                  messages: cursor.messageIds,
                  summarySources: cursor.summarySourceIds,
                  retrieved: cursor.retrievedSourceIds,
                  omitted: cursor.omittedMessageIds,
                },
                null,
                2,
              )}
            </pre>
          </details>
        </div>
      ))}
    </details>
  );
}
export function ContextSummaries({
  room,
  threadId,
  onChanged,
}: {
  room: Room;
  threadId: string | null;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [reviewRevision, setReviewRevision] = useState(0);
  const [reviewThreadId, setReviewThreadId] = useState('');
  const [sources, setSources] = useState<Room['messages']>([]);
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [overview, setOverview] = useState('');
  const [disagreements, setDisagreements] = useState('');
  const [openQuestions, setOpenQuestions] = useState('');
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState('');
  const clientId = useRef<string | null>(null);
  const summaries = room.contextSummaries ?? [];
  function begin() {
    const selectedThread =
      threadId ?? room.messages.findLast((message) => message.status === 'complete')?.threadId;
    if (!selectedThread) return;
    setReviewThreadId(selectedThread);
    setReviewRevision(room.revision);
    setSources(
      room.messages.filter(
        (message) => message.threadId === selectedThread && message.status === 'complete',
      ),
    );
    setSourceIds([]);
    setTitle('');
    setOverview('');
    setDisagreements('');
    setOpenQuestions('');
    setBlocked(false);
    setError('');
    clientId.current = crypto.randomUUID();
    setEditing(true);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || blocked || room.archivedAt || !sourceIds.length) return;
    setBusy(true);
    setError('');
    try {
      await api.createContextSummary(room.id, {
        clientId: clientId.current!,
        expectedRevision: reviewRevision,
        threadId: reviewThreadId,
        sourceIds,
        title,
        overview,
        disagreements,
        openQuestions,
      });
      setEditing(false);
      onChanged();
    } catch (cause) {
      setBlocked(true);
      setError(
        cause instanceof ApiError && cause.status < 500
          ? cause.message
          : 'The summary may have been saved. Refresh and inspect summaries before another save.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="context-memory-panel">
      <summary>
        Context summaries · {summaries.filter((summary) => !summary.invalidatedAt).length}
      </summary>
      <div className="context-memory-content">
        <p className="muted">
          Create an explicit human-reviewed summary of 1–50 completed messages. Keep disagreements
          and open questions separate; say when you have not assessed them. Source excerpts, authors
          and original decision links remain attributable. Saving makes no provider call or
          conversation turn. Originals are retained.
        </p>
        <button
          type="button"
          disabled={
            busy ||
            !!room.archivedAt ||
            !room.messages.some((message) => message.status === 'complete')
          }
          onClick={begin}
        >
          Create context summary
        </button>
        {editing && (
          <form
            className="room-form summary-form"
            onSubmit={(event) => {
              void save(event);
            }}
          >
            <fieldset disabled={busy || blocked || !!room.archivedAt}>
              <p>
                Reviewed workspace revision {reviewRevision} · thread{' '}
                {room.threads.find((thread) => thread.id === reviewThreadId)?.title ??
                  reviewThreadId}
                .
              </p>
              <label>
                Summary title
                <input
                  autoFocus
                  required
                  maxLength={100}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <fieldset className="summary-source-selection">
                <legend>Completed summary sources (choose up to 50)</legend>
                {sources.map((message) => (
                  <label className="context-check" key={message.id}>
                    <input
                      type="checkbox"
                      aria-label={`Summarize source #${message.sequence}`}
                      checked={sourceIds.includes(message.id)}
                      disabled={!sourceIds.includes(message.id) && sourceIds.length >= 50}
                      onChange={(event) =>
                        setSourceIds((ids) =>
                          event.target.checked
                            ? [...ids, message.id]
                            : ids.filter((id) => id !== message.id),
                        )
                      }
                    />
                    <span>
                      {message.authorId === 'human'
                        ? 'Human'
                        : agentLabel(room, message.authorId, message.snapshotId)}{' '}
                      · #{message.sequence} · {message.type}
                      <span className="source-text">
                        {message.body.slice(0, 240)}
                        {message.body.length > 240 ? '…' : ''}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <label>
                Summary overview
                <textarea
                  required
                  rows={3}
                  maxLength={4000}
                  value={overview}
                  onChange={(event) => setOverview(event.target.value)}
                />
              </label>
              <label>
                Disagreements to preserve
                <textarea
                  required
                  rows={2}
                  maxLength={3000}
                  placeholder="Attribute conflicting claims, or state that disagreement has not been assessed."
                  value={disagreements}
                  onChange={(event) => setDisagreements(event.target.value)}
                />
              </label>
              <label>
                Open questions to preserve
                <textarea
                  required
                  rows={2}
                  maxLength={3000}
                  placeholder="Retain unanswered questions and uncertainties, or state that they have not been assessed."
                  value={openQuestions}
                  onChange={(event) => setOpenQuestions(event.target.value)}
                />
              </label>
              <button className="primary" disabled={!sourceIds.length}>
                {busy ? 'Saving…' : 'Save context summary'}
              </button>
            </fieldset>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {blocked && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void api
                    .room(room.id)
                    .then((current) => {
                      if (
                        current.contextSummaries?.some(
                          (summary: ContextSummary) => summary.clientId === clientId.current,
                        )
                      ) {
                        setEditing(false);
                        onChanged();
                        return;
                      }
                      const available = current.messages.filter(
                        (message) =>
                          message.threadId === reviewThreadId && message.status === 'complete',
                      );
                      setSources(available);
                      setSourceIds((ids) =>
                        ids.filter((id) => available.some((message) => message.id === id)),
                      );
                      setReviewRevision(current.revision);
                      clientId.current = crypto.randomUUID();
                      setBlocked(false);
                      setError('');
                      onChanged();
                    })
                    .catch(() =>
                      setError('The summary review could not be refreshed. Try Refresh again.'),
                    )
                    .finally(() => setBusy(false));
                }}
              >
                Refresh summary review
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => setEditing(false)}>
              Cancel summary
            </button>
          </form>
        )}
        {summaries.map((summary) => (
          <details key={summary.id}>
            <summary>
              {summary.title} · {summary.sources.length} sources
            </summary>
            <FrozenSummary roomId={room.id} memory={summary} />
          </details>
        ))}
      </div>
    </details>
  );
}
export function SummaryChoice({
  room,
  value,
  onChange,
  disabled,
}: {
  room: Room;
  value: { summaryId: string; sourceIds: string[] } | null;
  onChange: (value: { summaryId: string; sourceIds: string[] } | null) => void;
  disabled: boolean;
}) {
  const summaries = (room.contextSummaries ?? []).filter((summary) => !summary.invalidatedAt);
  const selected = summaries.find((summary) => summary.id === value?.summaryId);
  return (
    <div className="summary-choice">
      <label>
        Question context summary
        <select
          disabled={disabled}
          value={value?.summaryId ?? ''}
          onChange={(event) =>
            onChange(event.target.value ? { summaryId: event.target.value, sourceIds: [] } : null)
          }
        >
          <option value="">Complete relevant history</option>
          {summaries.map((summary) => (
            <option key={summary.id} value={summary.id}>
              {summary.title} · {summary.sources.length} source links
            </option>
          ))}
        </select>
      </label>
      {value && !selected && (
        <p className="notice">
          The selected summary is unavailable. Choose complete history or a reviewed summary before
          sending. Your draft is retained.
        </p>
      )}
      {selected && (
        <details>
          <summary>Review summary and choose original sources</summary>
          <FrozenSummary
            memory={{ ...selected, retrievedSourceIds: value!.sourceIds }}
            roomId={room.id}
          />
          <fieldset disabled={disabled}>
            <legend>Include full originals when the summary is insufficient</legend>
            {selected.sources.map((source) => (
              <label className="context-check" key={source.id}>
                <input
                  type="checkbox"
                  aria-label={`Include original #${source.sequence}`}
                  checked={value!.sourceIds.includes(source.id)}
                  onChange={(event) =>
                    onChange({
                      summaryId: selected.id,
                      sourceIds: event.target.checked
                        ? [...value!.sourceIds, source.id]
                        : value!.sourceIds.filter((id) => id !== source.id),
                    })
                  }
                />
                {source.authorName} · #{source.sequence} · {source.type}
              </label>
            ))}
          </fieldset>
          <p className="muted">
            Your next question explicitly authorizes this summary and checked originals. Reply
            targets are retained automatically. Each recipient gets the same submitted base; sibling
            answers remain isolated. Retrieved originals are protected by the model budget.
          </p>
        </details>
      )}
    </div>
  );
}
