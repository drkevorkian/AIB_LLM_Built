import { useState, type FormEvent } from 'react';
import {
  hasPendingWork,
  agentLabel,
  isAgentActive,
  maxParticipants,
  type Agent,
  type Room,
} from '../shared/contracts.js';
import { api } from './api.js';

export function Participants({
  room,
  onSaved,
  onConfigure,
}: {
  room: Room;
  onSaved: (room: Room) => void;
  onConfigure: (agent: Agent) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('Contributor · provide an independent perspective');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const pending = hasPendingWork(room);
  const activeCount = room.agents.filter(isAgentActive).length;

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
        {activeCount} active · {room.agents.length} / {maxParticipants} participant identities.
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
        {room.agents.map((agent) => {
          const active = isAgentActive(agent);
          const revisions = (room.agentRevisions ?? [])
            .filter((r) => r.agent.id === agent.id)
            .toSorted((a, b) => (b.agent.configRevision ?? 0) - (a.agent.configRevision ?? 0));
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
                <details className="participant-history">
                  <summary>Configuration history ({revisions.length})</summary>
                  <ol>
                    {revisions.map((revision) => (
                      <li key={revision.agent.configRevision ?? 0}>
                        <strong>
                          Revision {revision.agent.configRevision ?? 0} ·{' '}
                          {isAgentActive(revision.agent) ? 'Active' : 'Inactive'} ·{' '}
                          {revision.agent.name}
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
            busy || pending || Boolean(room.archivedAt) || room.agents.length >= maxParticipants
          }
          onClick={() => {
            setName(`AI ${String.fromCharCode(65 + room.agents.length)}`);
            setError('');
            setResult('');
            setAdding(true);
          }}
        >
          Add participant
        </button>
      )}
      {room.agents.length >= maxParticipants && (
        <p className="muted">
          This workspace has reached its identity limit. Reactivate an existing participant or
          create another workspace.
        </p>
      )}
    </div>
  );
}
