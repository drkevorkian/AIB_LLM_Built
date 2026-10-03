import { useState } from 'react';
import type { CollectionContext, Request, Room } from '../shared/contracts.js';
import { agentLabel, isAgentActive } from '../shared/contracts.js';
import { api, ApiError } from './api.js';

export function FrozenCollection({
  collection,
  room,
  snapshotId,
}: {
  collection: CollectionContext;
  room: Room;
  snapshotId: string;
}) {
  return (
    <div className="notice" role="note" aria-label="Frozen synthesis collection">
      <p>
        <strong>
          {collection.incomplete ? 'Incomplete answer set' : 'All recipients included'}
        </strong>{' '}
        · {collection.reason.replaceAll('_', ' ')} · {collection.includedMessageIds.length} included
        answers.
      </p>
      <p>
        Missing from this set:{' '}
        {collection.missingRespondents.length
          ? collection.missingRespondents
              .map(
                ({ agentId, status }) =>
                  `${agentLabel(room, agentId, snapshotId)} (${status} at closure)`,
              )
              .join(', ')
          : 'none'}
        .
      </p>
      <p>
        Compare the original answers, preserve conflicting claims and unresolved questions, and
        attribute them to their authors. Missing answers do not imply agreement.
      </p>
      <details>
        <summary>Exact included source message IDs</summary>
        <ul>
          {collection.includedMessageIds.map((id) => (
            <li key={id}>{id}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export function ResponseSet({
  request,
  room,
  onChanged,
}: {
  request: Request;
  room: Room;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState('');
  const source = request.synthesisRevisionOf
    ? room.requests.find((r) => r.id === request.sourceRequestId)
    : request;
  const latest = request.recipientIds.map((id) =>
    room.jobs.findLast(
      (job) => job.requestId === source?.id && job.agentId === id && job.kind === 'answer',
    ),
  );
  const completed = latest.filter((job) => job?.status === 'completed');
  const synthesis = room.jobs.findLast(
    (job) => job.requestId === request.id && job.kind === 'synthesis',
  );
  const revisions = room.requests.filter(
    (revision) => revision.synthesisRevisionOf && revision.sourceRequestId === source?.id,
  );
  const covered = revisions.some(
    (revision) =>
      revision.includedMessageIds.length === completed.length &&
      completed.every((job) => revision.includedMessageIds.includes(job!.messageId!)),
  );
  const pendingRevision = room.jobs.some(
    (job) =>
      revisions.some((revision) => revision.id === job.requestId) &&
      job.kind === 'synthesis' &&
      (job.status === 'queued' || job.status === 'running'),
  );
  const hasNew =
    !covered &&
    !pendingRevision &&
    completed.some((job) => !request.includedMessageIds.includes(job!.messageId!));
  const canUpdate =
    request.status === 'ready' &&
    !request.discussionId &&
    !request.relayId &&
    synthesis?.status === 'completed' &&
    hasNew &&
    room.agents.some((agent) => agent.id === request.synthesisAgentId && isAgentActive(agent));
  async function update() {
    if (busy || blocked) return;
    setBusy(true);
    setError('');
    try {
      await api.updatedSynthesis(room.id, {
        clientId: crypto.randomUUID(),
        requestId: request.id,
        expectedRevision: room.revision,
      });
      onChanged();
    } catch (cause) {
      setBlocked(true);
      setError(
        cause instanceof ApiError && cause.status < 500
          ? cause.message
          : 'The command may have completed. Refresh and inspect the response sets before requesting another synthesis.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="response-set" aria-label="Response set">
      <div>
        <span className="collection-label">RESPONSE SET</span>
        <strong>
          {completed.length} / {request.recipientIds.length} received
        </strong>
        <span className={`badge ${request.status}`}>{request.status.replace('_', ' ')}</span>
      </div>
      <p>
        {request.policy === 'all'
          ? 'Wait for every selected agent'
          : request.policy === 'any'
            ? 'Use the first complete answer'
            : request.policy === 'deadline'
              ? `Collect until the deadline; minimum ${request.minimumAnswers ?? 1} complete answers`
              : `Wait for ${request.quorum} complete answers`}
        {request.synthesisAgentId
          ? ` · then ${agentLabel(room, request.synthesisAgentId, request.snapshotId)} synthesizes`
          : request.phase === 'consultation'
            ? ' · then the coordinator continues'
            : ' · preserve individual answers'}
        .
      </p>
      <p>
        Remaining recipients{' '}
        {request.remainingWork === 'cancel'
          ? 'are cancelled after closure'
          : 'continue after closure'}
        .
      </p>
      <div className="respondents">
        {request.recipientIds.map((id, index) => (
          <span key={id} className={latest[index]?.status === 'completed' ? 'received' : ''}>
            {agentLabel(room, id, request.snapshotId)}
            <small>{latest[index]?.status ?? 'missing'}</small>
          </span>
        ))}
      </div>
      {(request.status === 'collecting' || request.status === 'unresolved') && (
        <small className="muted">
          {request.waitingSince
            ? `Deadline passed. Explicit wait keeps the original obligations; no automatic retry. Provider timeouts still apply. Stop cancels this work.`
            : `Deadline ${new Date(request.deadlineAt).toLocaleTimeString()}. Timeout: ${request.onTimeout === 'wait' ? 'keep waiting with the original obligations' : request.onTimeout === 'incomplete' ? `use an explicitly incomplete set if at least ${request.minimumAnswers ?? 1} answers complete; otherwise pause` : 'cancel unfinished work and pause this room'}.`}
        </small>
      )}
      {request.collection && (
        <FrozenCollection
          collection={request.collection}
          room={room}
          snapshotId={request.snapshotId}
        />
      )}
      {request.synthesisRevisionOf && (
        <p className="muted">
          Separate synthesis following response set {request.synthesisRevisionOf}. Earlier results
          remain unchanged.
        </p>
      )}
      {(canUpdate || blocked) && (
        <>
          <p className="muted">
            New late answers are available. Request a separate synthesis using the original frozen
            instructions, participant binding, and completed sources. This may incur another
            provider charge.
          </p>
          <button
            disabled={
              busy || blocked || !canUpdate || !!room.archivedAt || room.status === 'stopped'
            }
            onClick={() => {
              void update();
            }}
          >
            {busy ? 'Requesting synthesis…' : 'Request updated synthesis'}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {blocked && (
        <button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void api
              .room(room.id)
              .then(() => {
                setBlocked(false);
                setError('');
                onChanged();
              })
              .catch(() => setError('The response sets could not be refreshed. Try Refresh again.'))
              .finally(() => setBusy(false));
          }}
        >
          Refresh response sets
        </button>
      )}
    </div>
  );
}
