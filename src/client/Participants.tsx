import { useState, type FormEvent } from 'react';
import {
  hasPendingWork,
  agentLabel,
  isAgentActive,
  isAgentRemoved,
  maxParticipants,
  type Agent,
  type Room,
} from '../shared/contracts.js';
import { api } from './api.js';

export function Participants({
  room,
  onSaved,
  onConfigure,
  onRemove,
}: {
  room: Room;
  onSaved: (room: Room) => void;
  onConfigure: (agent: Agent) => void;
  onRemove: (agent: Agent) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('Contributor · provide an independent perspective');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const pending = hasPendingWork(room);
  const activeCount = room.agents.filter(isAgentActive).length;
  const current = room.agents.filter((agent) => !isAgentRemoved(agent));
  const removed = room.agents.filter(isAgentRemoved);

  async function run(work: () => Promise<Room>, message: string) {
    setBusy(true);
    setError('');
    setResult('');
    try {
      onSaved(await work());
      setResult(message);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to update participants.');
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function add(event: FormEvent) {
    event.preventDefault();
    if (
      await run(
        () => api.addAgent(room.id, { name, role }),
        'Participant added in simulation. Configure its connection when ready.',
      )
    )
      setAdding(false);
  }

  return (
    <div className="participant-management">
      <p className="muted">
        {activeCount} active · {current.length} / {maxParticipants} current participant identities.
        Deactivated participants keep their history and can be reactivated.
      </p>
      {pending && <p className="notice">Finish or stop pending work before changing the roster.</p>}
      {room.archivedAt && (
        <p className="notice">
          Restore this workspace before changing participants or running connection tests.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <p className="connection-result" role="status">
          {result}
        </p>
      )}
      <div className="settings-participants">
        {current.map((agent) => {
          const active = isAgentActive(agent);
          return (
            <div
              className={`settings-participant ${active ? '' : 'participant-inactive'}`}
              key={agent.id}
              data-agent-id={agent.id}
            >
              <span className={`avatar ${agent.color}`}>{agent.name.at(-1)}</span>
              <div>
                <strong>{agentLabel(room, agent.id)}</strong>
                <small>
                  {active ? 'Active' : 'Inactive'} · {agent.provider} / {agent.model}
                </small>
                <small>Identity: {agent.id}</small>
                <p>{agent.role}</p>
                <ParticipantHistory room={room} agentId={agent.id} />
              </div>
              <div className="participant-actions">
                <button disabled={busy} onClick={() => onConfigure(agent)}>
                  Configure {agentLabel(room, agent.id)}
                </button>
                <button
                  disabled={
                    busy || pending || Boolean(room.archivedAt) || (active && activeCount === 1)
                  }
                  title={
                    active && activeCount === 1
                      ? 'Keep at least one active participant.'
                      : undefined
                  }
                  onClick={() => {
                    void run(
                      () => api.setAgentActive(room.id, agent.id, !active),
                      `${agent.name} ${active ? 'deactivated' : 'reactivated'}. History retained.`,
                    );
                  }}
                >
                  {active ? 'Deactivate' : 'Reactivate'} {agentLabel(room, agent.id)}
                </button>
                <button
                  className="danger-button"
                  disabled={
                    busy || pending || Boolean(room.archivedAt) || (active && activeCount === 1)
                  }
                  title={
                    active && activeCount === 1
                      ? 'Keep at least one active participant.'
                      : undefined
                  }
                  onClick={() => onRemove(agent)}
                >
                  Remove {agentLabel(room, agent.id)}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {adding ? (
        <form
          className="room-form add-participant-form"
          onSubmit={(event) => {
            void add(event);
          }}
        >
          <h3>Add participant</h3>
          <fieldset className="settings-fields" disabled={Boolean(room.archivedAt)}>
            <label>
              New participant name
              <input
                aria-label="New participant name"
                required
                autoFocus
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              New participant role
              <textarea
                aria-label="New participant role"
                required
                rows={3}
                maxLength={3000}
                value={role}
                onChange={(e) => setRole(e.target.value)}
              />
            </label>
            <p className="muted">
              Starts in simulation. Its identity is separate from every other instance of the same
              provider or model.
            </p>
            <div className="settings-actions">
              <button
                className="primary"
                disabled={busy || pending || !name.trim() || !role.trim()}
              >
                {busy ? 'Adding…' : 'Create participant'}
              </button>
              <button type="button" disabled={busy} onClick={() => setAdding(false)}>
                Cancel
              </button>
            </div>
          </fieldset>
        </form>
      ) : (
        <button
          className="add-participant-button"
          disabled={
            busy || pending || Boolean(room.archivedAt) || current.length >= maxParticipants
          }
          onClick={() => {
            setName(
              room.agents.length < 26
                ? `AI ${String.fromCharCode(65 + room.agents.length)}`
                : `Participant ${room.agents.length + 1}`,
            );
            setError('');
            setResult('');
            setAdding(true);
          }}
        >
          Add participant
        </button>
      )}
      {current.length >= maxParticipants && (
        <p className="muted">
          This workspace has reached its current roster limit, including inactive participants.
          Remove an identity to free a slot, or create another workspace.
        </p>
      )}
      {removed.length > 0 && (
        <details className="removed-participants">
          <summary>Removed participants ({removed.length})</summary>
          <p className="muted">
            Retained records are read-only and cannot be reactivated. Messages, usage, prior
            settings, and frozen context remain. Thread deletion removes its conversation data; only
            workspace deletion removes retained participant settings. Removal does not erase data or
            prevent retained conversation text from reaching a provider.
          </p>
          {removed.map((agent) => (
            <div
              className="removed-participant"
              key={agent.id}
              data-agent-id={agent.id}
              role="group"
              aria-label={`Removed participant ${agent.name} (${agent.id})`}
            >
              <strong>
                {agent.name} · #{agent.rosterNumber}
              </strong>
              <small>Identity: {agent.id}</small>
              <small>Removed {new Date(agent.removedAt!).toLocaleString()}</small>
              <small>
                {agent.provider} / {agent.model}
              </small>
              <p>{agent.role}</p>
              <ParticipantHistory room={room} agentId={agent.id} />
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

function ParticipantHistory({ room, agentId }: { room: Room; agentId: string }) {
  const revisions = (room.agentRevisions ?? [])
    .filter((r) => r.agent.id === agentId)
    .toSorted((a, b) => (b.agent.configRevision ?? 0) - (a.agent.configRevision ?? 0));
  return (
    <details className="participant-history">
      <summary>Configuration history ({revisions.length})</summary>
      <ol>
        {revisions.map((revision) => (
          <li key={revision.agent.configRevision ?? 0}>
            <strong>
              Revision {revision.agent.configRevision ?? 0} ·{' '}
              {isAgentRemoved(revision.agent)
                ? 'Removed'
                : isAgentActive(revision.agent)
                  ? 'Active'
                  : 'Inactive'}{' '}
              · {revision.agent.name}
            </strong>
            <small>
              {revision.agent.provider} / {revision.agent.model} ·{' '}
              {revision.recordedAt
                ? new Date(revision.recordedAt).toLocaleString()
                : 'Recovered legacy configuration; edit time unknown'}
            </small>
            <p>{revision.agent.role}</p>
          </li>
        ))}
      </ol>
    </details>
  );
}
