import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  defaultAppSettings,
  hasPendingWork,
  type Agent,
  type AppSettings,
  type Room,
  type WorkspaceSettingsInput,
  type ProviderConcurrency,
  maxConcurrentRequests,
  workspaceInstructionHistory,
} from '../shared/contracts.js';
import { api } from './api.js';
import { Participants } from './Participants.js';
import { themes, isTheme, type Theme } from './themes.js';

export function SettingsPage({
  defaults,
  room,
  theme,
  onTheme,
  onLayoutReset,
  onDefaultsSaved,
  onWorkspaceSaved,
  onConfigure,
  onRemoveParticipant,
  onArchiveWorkspace,
  onDeleteWorkspace,
  onBack,
}: {
  defaults: AppSettings | null;
  room: Room | null;
  theme: Theme;
  onTheme: (theme: Theme) => void;
  onLayoutReset: () => void;
  onDefaultsSaved: (settings: AppSettings) => void;
  onWorkspaceSaved: (room: Room) => void;
  onConfigure: (agent: Agent) => void;
  onRemoveParticipant: (agent: Agent) => void;
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
            onChange={(e) => {
              if (isTheme(e.target.value)) onTheme(e.target.value);
            }}
          >
            {themes.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <div className="layout-preference">
          <div>
            <h3>Panel widths</h3>
            <p>Desktop widths stay in this browser. Narrow screens use compact panels.</p>
          </div>
          <button onClick={onLayoutReset}>Reset panel widths</button>
        </div>
        {defaults ? (
          <>
            <DefaultsForm settings={defaults} onSaved={onDefaultsSaved} />
            <ProviderLimitsForm settings={defaults} onSaved={onDefaultsSaved} />
          </>
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
            onRemove={onRemoveParticipant}
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

const providerLimitLabels: Record<keyof ProviderConcurrency, string> = {
  simulated: 'Simulation request limit',
  openai: 'OpenAI request limit',
  xai: 'xAI request limit',
  gemini: 'Gemini request limit',
  ollama: 'Ollama request limit',
  'openai-compatible': 'OpenAI-compatible request limit',
};

function ProviderLimitsForm({
  settings,
  onSaved,
}: {
  settings: AppSettings;
  onSaved: (settings: AppSettings) => void;
}) {
  const [value, setValue] = useState({ ...settings.providerConcurrency });
  const [dirty, setDirty] = useState(false);
  const edited = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  useEffect(() => {
    if (!edited.current) setValue({ ...settings.providerConcurrency });
  }, [settings.providerConcurrency]);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setResult('');
    try {
      const saved = await api.saveProviderConcurrency(value);
      edited.current = false;
      onSaved(saved);
      setDirty(false);
      setResult('Provider request limits saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save provider limits.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="room-form"
      onSubmit={(e) => {
        void save(e);
      }}
    >
      <h3>Provider request limits</h3>
      <p className="muted">
        Four service slots are shared by generations and connection checks. Each provider limit
        applies across workspaces, models, and endpoints. Lowering a limit lets active requests
        finish; raising it can start already queued work.
      </p>
      <div className="settings-grid">
        {(Object.keys(providerLimitLabels) as (keyof ProviderConcurrency)[]).map((provider) => (
          <label key={provider}>
            {providerLimitLabels[provider]}
            <input
              type="number"
              required
              min={1}
              max={maxConcurrentRequests}
              value={value[provider]}
              onChange={(e) => {
                edited.current = true;
                setValue((previous) => ({ ...previous, [provider]: Number(e.target.value) }));
                setDirty(true);
                setResult('');
              }}
            />
          </label>
        ))}
      </div>
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
      <button className="primary" disabled={busy || !dirty}>
        {busy ? 'Saving provider limits…' : 'Save provider limits'}
      </button>
    </form>
  );
}

function WorkspaceForm({ room, onSaved }: { room: Room; onSaved: (room: Room) => void }) {
  const [value, setValue] = useState<WorkspaceSettingsInput>({
    title: room.title,
    objective: room.objective,
    humanInstructions: room.humanInstructions ?? '',
    expectedInstructionRevision: room.instructionRevision ?? 0,
    maxTurns: room.maxTurns,
    maxConcurrentRequests: room.maxConcurrentRequests ?? maxConcurrentRequests,
  });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const pending = hasPendingWork(room);
  useEffect(() => {
    if (!dirty)
      setValue({
        title: room.title,
        objective: room.objective,
        humanInstructions: room.humanInstructions ?? '',
        expectedInstructionRevision: room.instructionRevision ?? 0,
        maxTurns: room.maxTurns,
        maxConcurrentRequests: room.maxConcurrentRequests ?? maxConcurrentRequests,
      });
  }, [
    room.title,
    room.objective,
    room.humanInstructions,
    room.instructionRevision,
    room.maxTurns,
    room.maxConcurrentRequests,
    dirty,
  ]);
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
        'Workspace settings saved. New requests use these instructions; existing invocation context stays unchanged.',
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
        <label>
          Workspace instructions
          <textarea
            aria-label="Workspace instructions"
            rows={5}
            maxLength={3000}
            value={value.humanInstructions ?? ''}
            onChange={(e) => update({ humanInstructions: e.target.value })}
          />
        </label>
        <p className="muted">
          Revision {room.instructionRevision ?? 0}. Applies to new requests in this workspace.
          Retries and ongoing workflows retain their submitted objective, instructions, and roles.
          Connection checks omit workspace instructions.
        </p>
        <p className="muted">
          {room.turnsUsed} turns already used. Deleting threads keeps that usage; changing the
          objective affects new requests.
        </p>
        <label>
          Workspace request limit
          <input
            type="number"
            required
            min={1}
            max={maxConcurrentRequests}
            value={value.maxConcurrentRequests ?? maxConcurrentRequests}
            onChange={(e) => update({ maxConcurrentRequests: Number(e.target.value) })}
          />
        </label>
        <p className="muted">Generations and connection checks share this workspace limit.</p>
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
      <details className="instruction-history">
        <summary>
          Workspace instruction history ({workspaceInstructionHistory(room).length})
        </summary>
        <ol>
          {workspaceInstructionHistory(room)
            .toReversed()
            .map((entry) => (
              <li key={entry.revision}>
                <strong>
                  Revision {entry.revision} ·{' '}
                  {entry.source === 'created'
                    ? 'Created'
                    : entry.source === 'edited'
                      ? 'Edited'
                      : 'Recovered current settings'}
                </strong>
                <p>
                  {entry.recordedAt
                    ? new Date(entry.recordedAt).toLocaleString()
                    : 'Edit time unknown; earlier unrecorded edits cannot be recovered.'}
                </p>
                <p>
                  <strong>Objective:</strong> {entry.objective || 'No shared objective.'}
                </p>
                <pre
                  className="instruction-text"
                  tabIndex={0}
                  aria-label={`Workspace instructions revision ${entry.revision}`}
                >
                  {entry.humanInstructions || 'No additional instructions.'}
                </pre>
              </li>
            ))}
        </ol>
      </details>
    </form>
  );
}
