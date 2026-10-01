import { useEffect, useState, type FormEvent } from 'react';
import {
  defaultAppSettings,
  hasPendingWork,
  type Agent,
  type AppSettings,
  type Room,
  type WorkspaceSettingsInput,
} from '../shared/contracts.js';
import { api } from './api.js';
import { Participants } from './Participants.js';

export function SettingsPage({
  defaults,
  room,
  theme,
  onTheme,
  onDefaultsSaved,
  onWorkspaceSaved,
  onConfigure,
  onArchiveWorkspace,
  onDeleteWorkspace,
  onBack,
}: {
  defaults: AppSettings | null;
  room: Room | null;
  theme: 'dark' | 'light';
  onTheme: (theme: 'dark' | 'light') => void;
  onDefaultsSaved: (settings: AppSettings) => void;
  onWorkspaceSaved: (room: Room) => void;
  onConfigure: (agent: Agent) => void;
  onArchiveWorkspace: () => void;
  onDeleteWorkspace: () => void;
  onBack: () => void;
}) {
  return (
    <main className="settings-page" aria-label="Settings">
      <div className="settings-page-heading">
        <div>
          <span className="eyebrow">YOUR CONVERSATION ENVIRONMENT</span>
          <h1>Settings</h1>
          <p>Set your defaults, then tailor each workspace and its participants.</p>
        </div>
        <button onClick={onBack}>Back to conversation</button>
      </div>
      <section className="settings-section" aria-labelledby="preferences-heading">
        <div className="settings-section-heading">
          <span>01</span>
          <div>
            <h2 id="preferences-heading">Preferences</h2>
            <p>
              Appearance applies to this browser. Conversation defaults are saved by the service.
            </p>
          </div>
        </div>
        <label className="appearance-field">
          Theme
          <select
            aria-label="Theme"
            value={theme}
            onChange={(e) => onTheme(e.target.value as 'dark' | 'light')}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>
        {defaults ? (
          <DefaultsForm settings={defaults} onSaved={onDefaultsSaved} />
        ) : (
          <p role="status">Loading preferences…</p>
        )}
      </section>
      <section className="settings-section" aria-labelledby="workspace-settings-heading">
        <div className="settings-section-heading">
          <span>02</span>
          <div>
            <h2 id="workspace-settings-heading">Workspace</h2>
            <p>{room ? room.title : 'Choose or create a workspace to configure it.'}</p>
          </div>
        </div>
        {room && <WorkspaceForm key={room.id} room={room} onSaved={onWorkspaceSaved} />}
      </section>
      <section className="settings-section" aria-labelledby="participants-settings-heading">
        <div className="settings-section-heading">
          <span>03</span>
          <div>
            <h2 id="participants-settings-heading">Participants & connections</h2>
            <p>Each workspace has its own roles, models, output limits, and connection timeouts.</p>
          </div>
        </div>
        {room ? (
          <Participants
            key={room.id}
            room={room}
            onSaved={onWorkspaceSaved}
            onConfigure={onConfigure}
          />
        ) : (
          <p className="muted">Participant settings appear when a workspace is selected.</p>
        )}
      </section>
      {room && (
        <section className="settings-section archive-workspace" aria-labelledby="archive-heading">
          <div>
            <h2 id="archive-heading">
              {room.archivedAt ? 'Archived workspace' : 'Archive workspace'}
            </h2>
            <p>
              {room.archivedAt
                ? 'History stays available for reading, inspection, and export. Restore to change this workspace; it will remain paused until you resume.'
                : 'Keep the workspace and its history while moving it out of the active list. Finish or stop pending work first.'}
            </p>
            {room.archivedAt && (
              <p className="muted">Archived {new Date(room.archivedAt).toLocaleString()}</p>
            )}
          </div>
          <button disabled={!room.archivedAt && hasPendingWork(room)} onClick={onArchiveWorkspace}>
            {room.archivedAt ? 'Restore workspace' : 'Archive workspace'}
          </button>
        </section>
      )}
      {room && (
        <section className="settings-section danger-zone" aria-labelledby="deletion-heading">
          <div>
            <h2 id="deletion-heading">Delete workspace</h2>
            <p>
              Permanently remove this workspace, its participants, threads, and local conversation
              history. Active work will be cancelled.
            </p>
          </div>
          <button className="danger-button" onClick={onDeleteWorkspace}>
            Delete workspace
          </button>
        </section>
      )}
    </main>
  );
}

function DefaultsForm({
  settings,
  onSaved,
}: {
  settings: AppSettings;
  onSaved: (settings: AppSettings) => void;
}) {
  const [value, setValue] = useState(settings);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  useEffect(() => {
    if (!dirty) setValue(settings);
  }, [settings, dirty]);
  function update(patch: Partial<AppSettings>) {
    setValue((v) => ({ ...v, ...patch }));
    setDirty(true);
    setResult('');
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setResult('');
    try {
      const saved = await api.saveSettings(value);
      onSaved(saved);
      setDirty(false);
      setResult('Defaults saved. New workspaces and newly opened composers use these values.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save defaults.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="room-form defaults-form"
      onSubmit={(e) => {
        void save(e);
      }}
    >
      <div className="settings-grid">
        <label>
          Default workspace turn limit
          <input
            type="number"
            required
            min={1}
            max={1000}
            value={value.defaultMaxTurns}
            onChange={(e) => update({ defaultMaxTurns: Number(e.target.value) })}
          />
        </label>
        <label>
          Default response deadline (seconds)
          <input
            type="number"
            required
            min={5}
            max={600}
            value={value.defaultDeadlineSeconds}
            onChange={(e) => update({ defaultDeadlineSeconds: Number(e.target.value) })}
          />
        </label>
        <label>
          Default response policy
          <select
            value={value.defaultPolicy}
            aria-label="Default response policy"
            onChange={(e) =>
              update({ defaultPolicy: e.target.value as AppSettings['defaultPolicy'] })
            }
          >
            <option value="all">All responses</option>
            <option value="any">First complete response</option>
            <option value="quorum">Quorum</option>
          </select>
        </label>
        <label>
          Default synthesis
          <select
            value={String(value.defaultSynthesis)}
            aria-label="Default synthesis"
            onChange={(e) => update({ defaultSynthesis: e.target.value === 'true' })}
          >
            <option value="true">Synthesize collected answers</option>
            <option value="false">Keep individual answers</option>
          </select>
        </label>
        <label>
          Default discussion peer rounds
          <input
            type="number"
            required
            min={1}
            max={10}
            value={value.defaultDiscussionRounds}
            onChange={(e) => update({ defaultDiscussionRounds: Number(e.target.value) })}
          />
        </label>
        <label>
          Default discussion turn allowance
          <input
            type="number"
            required
            min={2}
            max={50}
            value={value.defaultDiscussionTurns}
            onChange={(e) => update({ defaultDiscussionTurns: Number(e.target.value) })}
          />
        </label>
      </div>
      <p className="muted">
        Existing workspaces, active work, and open drafts keep their current settings. Quorum starts
        at one response and can be adjusted for each message.
      </p>
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
      <div className="settings-actions">
        <button className="primary" disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save defaults'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setValue({ ...defaultAppSettings });
            setDirty(true);
            setResult('Defaults restored in this form. Save to apply them.');
          }}
        >
          Restore defaults
        </button>
      </div>
    </form>
  );
}

function WorkspaceForm({ room, onSaved }: { room: Room; onSaved: (room: Room) => void }) {
  const [value, setValue] = useState<WorkspaceSettingsInput>({
    title: room.title,
    objective: room.objective,
    maxTurns: room.maxTurns,
  });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const pending = hasPendingWork(room);
  useEffect(() => {
    if (!dirty) setValue({ title: room.title, objective: room.objective, maxTurns: room.maxTurns });
  }, [room.title, room.objective, room.maxTurns, dirty]);
  function update(patch: Partial<WorkspaceSettingsInput>) {
    setValue((v) => ({ ...v, ...patch }));
    setDirty(true);
    setResult('');
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setResult('');
    try {
      const saved = await api.configureWorkspace(room.id, value);
      onSaved(saved);
      setDirty(false);
      setResult(
        'Workspace settings saved. Previous invocation snapshots keep their original objective.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save workspace settings.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="room-form workspace-settings-form"
      onSubmit={(e) => {
        void save(e);
      }}
    >
      {pending && (
        <p className="notice">Finish or stop pending work before saving workspace settings.</p>
      )}
      {room.archivedAt && (
        <p className="notice">Restore this workspace before changing its settings.</p>
      )}
      <fieldset className="settings-fields" disabled={Boolean(room.archivedAt)}>
        <label>
          Workspace name
          <input
            required
            maxLength={100}
            value={value.title}
            onChange={(e) => update({ title: e.target.value })}
          />
        </label>
        <label>
          Shared objective
          <textarea
            aria-label="Shared objective"
            rows={3}
            maxLength={3000}
            value={value.objective}
            onChange={(e) => update({ objective: e.target.value })}
          />
        </label>
        <label>
          Workspace turn limit
          <input
            type="number"
            required
            min={Math.max(1, room.turnsUsed)}
            max={1000}
            value={value.maxTurns}
            onChange={(e) => update({ maxTurns: Number(e.target.value) })}
          />
        </label>
        <p className="muted">
          {room.turnsUsed} turns already used. Deleting threads keeps that usage; changing the
          objective affects new requests.
        </p>
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
        <button className="primary" disabled={busy || pending || !dirty}>
          {busy ? 'Saving…' : 'Save workspace'}
        </button>
      </fieldset>
    </form>
  );
}
