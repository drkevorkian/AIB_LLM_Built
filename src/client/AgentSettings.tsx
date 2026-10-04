import { useEffect, useState, type FormEvent } from 'react';
import type {
  Agent,
  AgentSettingsInput,
  ProviderKind,
  ProviderStatus,
  Room,
} from '../shared/contracts.js';
import { api } from './api.js';
import { hasPendingWork, isAgentActive } from '../shared/contracts.js';

export function AgentSettings({
  room,
  agent,
  onSaved,
}: {
  room: Room;
  agent: Agent;
  onSaved: () => void;
}) {
  const [value, setValue] = useState<AgentSettingsInput>({
    agentId: agent.id,
    name: agent.name,
    role: agent.role,
    provider: agent.provider,
    model: agent.model,
    baseUrl: agent.baseUrl ?? '',
    maxOutputTokens: agent.maxOutputTokens ?? 4096,
    timeoutSeconds: agent.timeoutSeconds ?? 180,
    contextPolicy: agent.contextPolicy ?? null,
  });
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [saved, setSaved] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const pending = hasPendingWork(room);
  useEffect(() => {
    let current = true;
    void api
      .providers()
      .then((p) => {
        if (current) setProviders(p);
      })
      .catch(() => {
        if (current) setError('Unable to load connection status.');
      });
    return () => {
      current = false;
    };
  }, []);
  function update(patch: Partial<AgentSettingsInput>) {
    setValue((v) => ({ ...v, ...patch }));
    setSaved(false);
    setResult('');
    setError('');
  }
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    setResult('');
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The operation failed.');
    } finally {
      setBusy(false);
    }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    void action(async () => {
      await api.configureAgent(room.id, value);
      setSaved(true);
      setResult('Settings saved. New messages use this connection.');
      onSaved();
    });
  }
  const provider = providers.find((p) => p.id === value.provider);
  const custom = value.provider === 'ollama' || value.provider === 'openai-compatible';
  return (
    <form className="room-form agent-settings" onSubmit={save}>
      {room.archivedAt && (
        <p className="notice">
          Restore this workspace before saving settings or testing a connection.
        </p>
      )}
      <fieldset className="settings-fields" disabled={Boolean(room.archivedAt)}>
        {pending && (
          <p className="notice">Finish or stop pending work before saving participant settings.</p>
        )}
        {!room.agents.some((a) => a.id === agent.id && isAgentActive(a)) && (
          <p className="notice">
            This participant is inactive. You can edit its connection settings; reactivate it before
            sending or testing.
          </p>
        )}
        <div className="settings-grid">
          <label>
            Participant name
            <input
              required
              maxLength={60}
              value={value.name}
              onChange={(e) => update({ name: e.target.value })}
            />
          </label>
          <label>
            Provider
            <select
              aria-label="Provider"
              value={value.provider}
              onChange={(e) => {
                const provider = e.target.value as ProviderKind;
                update({
                  provider,
                  model: provider === 'simulated' ? 'simulation-v1' : '',
                  baseUrl: provider === 'ollama' ? 'http://127.0.0.1:11434' : '',
                  contextPolicy: null,
                });
                setModels([]);
              }}
            >
              {providers.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Role and instructions
          <textarea
            required
            rows={3}
            maxLength={3000}
            value={value.role}
            onChange={(e) => update({ role: e.target.value })}
          />
        </label>
        {custom && (
          <label>
            Server URL
            <input
              type="url"
              required
              value={value.baseUrl}
              placeholder={
                value.provider === 'ollama'
                  ? 'http://127.0.0.1:11434'
                  : 'https://your-server.example/v1'
              }
              onChange={(e) => update({ baseUrl: e.target.value, contextPolicy: null })}
            />
          </label>
        )}
        <label>
          Model ID
          <input
            required
            list={`models-${agent.id}`}
            maxLength={200}
            value={value.model}
            placeholder="Exact text-generation model ID from your provider"
            onChange={(e) => update({ model: e.target.value, contextPolicy: null })}
          />
          <datalist id={`models-${agent.id}`}>
            {models.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
        </label>
        <button
          type="button"
          className="quiet"
          disabled={busy || (custom && !value.baseUrl)}
          onClick={() => {
            void action(async () => {
              const names = await api.models(value.provider, value.baseUrl ?? '');
              setModels(names);
              setResult(
                `${names.length} model IDs loaded. Choose a text-generation model supported by this connection.`,
              );
            });
          }}
        >
          Load available models
        </button>
        <div className="settings-grid">
          <label>
            Output token limit
            <input
              required
              type="number"
              min={128}
              max={16384}
              value={value.maxOutputTokens}
              onChange={(e) => update({ maxOutputTokens: Number(e.target.value) })}
            />
          </label>
          <label>
            Connection timeout (seconds)
            <input
              required
              type="number"
              min={5}
              max={600}
              value={value.timeoutSeconds}
              onChange={(e) => update({ timeoutSeconds: Number(e.target.value) })}
            />
          </label>
        </div>
        <label className="context-check">
          <input
            type="checkbox"
            checked={Boolean(value.contextPolicy)}
            onChange={(e) =>
              update({
                contextPolicy: e.target.checked
                  ? { maxCharacters: 64000, overflow: 'reject' }
                  : null,
              })
            }
          />
          Use a reviewed context budget for this model
        </label>
        {value.contextPolicy && (
          <div className="settings-grid">
            <label>
              Model context text budget (characters)
              <input
                required
                type="number"
                min={4096}
                max={262144}
                value={value.contextPolicy.maxCharacters}
                onChange={(e) =>
                  update({
                    contextPolicy: {
                      ...value.contextPolicy!,
                      maxCharacters: Number(e.target.value),
                    },
                  })
                }
              />
            </label>
            <label>
              Context overflow rule
              <select
                value={value.contextPolicy.overflow}
                onChange={(e) =>
                  update({
                    contextPolicy: {
                      ...value.contextPolicy!,
                      overflow: e.target.value as 'reject' | 'trim_oldest',
                    },
                  })
                }
              >
                <option value="reject">Reject the invocation</option>
                <option value="trim_oldest">Omit oldest unprotected history</option>
              </select>
            </label>
          </div>
        )}
        <p className="muted">
          Budget for {value.provider} / {value.model || 'the selected model'}: exact application
          prompt characters, including instructions and data. Review the provider's native
          input/output token limits separately; this is not a token-window guarantee. Changing
          provider or model clears this reviewed policy. Omissions are recorded; protected sources
          cannot be trimmed. Without this policy the existing 64,000-character snapshot limit
          applies.
        </p>
        {provider?.keyEnvironment && (
          <p className="credential-status">
            {value.provider === 'openai-compatible'
              ? 'Optional server key'
              : provider.configured
                ? 'API key is set in the service'
                : 'API key is missing'}
            : <code>{provider.keyEnvironment}</code>. Set it in your local <code>.env</code> file or
            service environment, then restart the service. Keys are never stored in the room or
            returned to this page.
          </p>
        )}
        <p className="muted">
          {value.provider === 'simulated'
            ? 'Simulation produces predefined text and makes no external calls.'
            : value.provider === 'ollama'
              ? 'Start Ollama locally and install your selected model before sending.'
              : 'This uses the provider API. Browser account sessions and website subscriptions are separate.'}
        </p>
        <p className="muted">
          Live turns send workspace instructions, the shared objective, participant roles, frozen
          thread context, and your current request to the selected provider. Test connection sends
          only a short greeting request and the participant roles. It may incur provider charges and
          does not consume a room turn.
        </p>
        <p className="muted">
          Test coordinator checks the structured finish decision needed for Agent discussion. It
          sends a test request and participant roles, with no thread history, shared objective, or
          workspace instructions. Each test makes one request, may incur provider charges, and is
          limited to 30 seconds or the saved timeout if shorter. Simulation checks only the local
          fixture. Results apply to the tested configuration at that time; they do not guarantee
          later discussions.
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
          <button className="primary" disabled={busy || pending}>
            {busy ? 'Working…' : 'Save settings'}
          </button>
          <button
            type="button"
            disabled={
              busy ||
              pending ||
              !saved ||
              !room.agents.some((a) => a.id === agent.id && isAgentActive(a)) ||
              (!provider?.configured && value.provider !== 'openai-compatible')
            }
            onClick={() => {
              void action(async () => {
                const { reply } = await api.testConnection(room.id, agent.id);
                setResult(`Connection succeeded: ${reply}`);
              });
            }}
          >
            Test connection
          </button>
          <button
            type="button"
            disabled={
              busy ||
              pending ||
              !saved ||
              !room.agents.some((a) => a.id === agent.id && isAgentActive(a)) ||
              (!provider?.configured && value.provider !== 'openai-compatible')
            }
            onClick={() => {
              void action(async () => {
                const checked = await api.testConnection(room.id, agent.id, 'coordinator');
                setResult(
                  `${checked.provider === 'simulated' ? 'Simulated coordinator check passed' : 'Coordinator check passed'}: ${checked.provider} / ${checked.model} · configuration ${checked.configRevision}. Checked ${checked.testedAt}. Valid completed finish decision received.`,
                );
              });
            }}
          >
            Test coordinator
          </button>
        </div>
      </fieldset>
    </form>
  );
}
