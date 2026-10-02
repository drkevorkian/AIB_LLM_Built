import { useId, useMemo, useState } from 'react';
import { CopyButton } from './CopyButton.js';
import {
  codeHighlightReason,
  highlightCode,
  type CodeHighlight,
  type CodeToken,
} from './code-highlighting.js';

const tokenClasses: Record<CodeToken['kind'], string> = {
  plain: '',
  keyword: 'code-keyword',
  string: 'code-string',
  property: 'code-property',
  comment: 'code-comment',
  number: 'code-number',
  punctuation: 'code-punctuation',
};

/** React text children preserve code; no HTML, source properties, or grammar classes are accepted. */
export function CodeContent({
  text,
  presentation,
}: {
  text: string;
  presentation?: CodeHighlight;
}) {
  return (
    <code>
      {presentation?.status === 'ready'
        ? presentation.tokens.map((token) => {
            const value = text.slice(token.start, token.end);
            const className = tokenClasses[token.kind];
            return className ? (
              <span key={token.start} className={`code-token ${className}`}>
                {value}
              </span>
            ) : (
              value
            );
          })
        : text}
    </code>
  );
}

export function CodeBlock({ text, language }: { text: string; language?: string }) {
  const id = `aib-code-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [choice, setChoice] = useState<{ text: string; language?: string } | null>(null);
  const requested = choice?.text === text && choice.language === language;
  const eligibility = useMemo(() => codeHighlightReason(text, language), [text, language]);
  const presentation = useMemo(
    () => (requested ? highlightCode(text, language) : undefined),
    [text, language, requested],
  );
  const highlighted = presentation?.status === 'ready';
  const reason =
    eligibility ?? (presentation?.status === 'unavailable' ? presentation.reason : undefined);
  return (
    <div className="code-block">
      <div className="code-heading">
        <span>{language || 'Plain text'}</span>
        <div className="code-actions">
          {!!language && (
            <button
              type="button"
              aria-label="Toggle code highlighting"
              aria-pressed={highlighted}
              aria-controls={id}
              disabled={Boolean(reason)}
              onClick={() => setChoice(requested ? null : { text, language })}
            >
              {highlighted ? 'Plain code' : 'Highlight code'}
            </button>
          )}
          <CopyButton text={text} label="Copy code" />
        </div>
      </div>
      {!!language && reason && (
        <p className="code-highlight-notice" role="status">
          {reason}
        </p>
      )}
      <pre id={id} tabIndex={0} aria-label={language ? `${language} code` : 'Code block'}>
        <CodeContent text={text} presentation={presentation} />
      </pre>
    </div>
  );
}
