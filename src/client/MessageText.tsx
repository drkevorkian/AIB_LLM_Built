import { Component, Suspense, lazy, useId, type ReactNode } from 'react';

const MarkdownText = lazy(() => import('./MarkdownText.js'));

class FormattingBoundary extends Component<
  { text: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <>
        <div className="message-literal">{this.props.text}</div>
        <small className="formatting-notice" role="status">
          Formatted view unavailable. Original text is shown.
        </small>
      </>
    ) : (
      this.props.children
    );
  }
}

/** Streamed text remains literal until the attempt ends; the stored body is never changed. */
export function MessageText({
  text,
  source = false,
  streaming = false,
  placeholder = 'No answer text received.',
}: {
  text: string;
  source?: boolean;
  streaming?: boolean;
  placeholder?: string;
}) {
  const scopeId = useId();
  const literal = source || streaming || !text;
  return (
    <div
      className={`message-body ${literal ? 'message-literal' : 'message-markdown'}${source ? ' message-source' : ''}`}
    >
      {literal ? (
        text || placeholder
      ) : (
        <FormattingBoundary text={text}>
          <Suspense fallback={<span className="message-literal">{text}</span>}>
            <MarkdownText text={text} scopeId={scopeId} />
          </Suspense>
        </FormattingBoundary>
      )}
      {streaming && <span className="stream-cursor" aria-hidden="true" />}
    </div>
  );
}
