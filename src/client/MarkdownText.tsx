import { memo, useId, useMemo, useRef, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CopyButton } from './CopyButton.js';
import { safeMessageUrl } from './message-links.js';
import { focusFootnote, messageFootnotes } from './message-footnotes.js';

// This is a presentation allowlist, not an HTML parser. Raw HTML stays escaped text.
const allowedElements = [
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'em',
  'del',
  'br',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'a',
  'img',
  'hr',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'input',
  'section',
  'sup',
];
const remarkPlugins = [remarkGfm];
function WebLink({ href, children }: { href?: string; children?: ReactNode }) {
  const safe = href && safeMessageUrl(href);
  return safe ? (
    <a href={safe} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
      {children}
    </a>
  ) : (
    <span className="blocked-link" title="Link destination is blocked">
      {children}
    </span>
  );
}
const components: Components = {
  h1: ({ children }) => <h3>{children}</h3>,
  h2: ({ children }) => <h4>{children}</h4>,
  h3: ({ children }) => <h5>{children}</h5>,
  h4: ({ children }) => <h6>{children}</h6>,
  h5: ({ children }) => <h6>{children}</h6>,
  h6: ({ children }) => <h6>{children}</h6>,
  a: WebLink,
  img: ({ alt }) => (
    <span className="image-placeholder">[Image: {alt || 'untitled'} — not loaded]</span>
  ),
  input: ({ checked }) => (
    <input
      type="checkbox"
      checked={Boolean(checked)}
      disabled
      aria-label={checked ? 'Completed task' : 'Incomplete task'}
    />
  ),
  code: ({ children }) => <code>{children}</code>,
  pre: ({ node }) => {
    const code = node?.children.find(
      (child) => child.type === 'element' && child.tagName === 'code',
    );
    if (!code || code.type !== 'element') return null;
    const text = code.children.map((child) => (child.type === 'text' ? child.value : '')).join('');
    const classes = code.properties.className;
    const language = Array.isArray(classes)
      ? classes
          .map(String)
          .find((value) => /^language-[a-z\d_+.-]{1,50}$/i.test(value))
          ?.slice(9)
      : undefined;
    return (
      <div className="code-block">
        <div className="code-heading">
          <span>{language || 'Plain text'}</span>
          <CopyButton text={text} label="Copy code" />
        </div>
        <pre tabIndex={0} aria-label={language ? `${language} code` : 'Code block'}>
          <code>{text}</code>
        </pre>
      </div>
    );
  },
  table: ({ children }) => (
    <div className="markdown-table" tabIndex={0} role="region" aria-label="Message table">
      <table>{children}</table>
    </div>
  ),
};

export default memo(function MarkdownText({ text, scopeId }: { text: string; scopeId?: string }) {
  const fallbackScope = useId();
  const root = useRef<HTMLDivElement>(null);
  const scope = scopeId ?? fallbackScope;
  const footnotes = useMemo(() => messageFootnotes(scope), [scope]);
  const scopedComponents: Components = {
    ...components,
    a: (props) => {
      const control = props.node && footnotes.controls.get(props.node);
      if (!control) return <WebLink href={props.href}>{props.children}</WebLink>;
      return (
        <button
          type="button"
          className={`footnote-control ${control.id ? 'footnote-reference' : 'footnote-backref'}`}
          id={control.id}
          aria-label={control.label}
          aria-controls={control.target}
          onClick={() => focusFootnote(root.current, control.target)}
        >
          {props.children}
        </button>
      );
    },
    h2: ({ children, node }) => (
      <h4 id={node ? footnotes.headings.get(node) : undefined}>{children}</h4>
    ),
    li: ({ children, node }) => {
      const id = node && footnotes.targets.get(node);
      const task =
        Array.isArray(node?.properties.className) &&
        node.properties.className.includes('task-list-item');
      return (
        <li id={id} tabIndex={id ? -1 : undefined} className={task ? 'task-list-item' : undefined}>
          {children}
        </li>
      );
    },
    section: ({ children, node }) => {
      const info = node && footnotes.sections.get(node);
      return info ? (
        <section
          className="message-footnotes"
          aria-labelledby={info.heading}
          aria-label={info.heading ? undefined : 'Footnotes'}
        >
          {info.notice && (
            <p className="footnote-notice" role="status">
              {info.notice}
            </p>
          )}
          {children}
        </section>
      ) : (
        <>{children}</>
      );
    },
  };
  return (
    <div className="formatted-message" ref={root}>
      <Markdown
        allowedElements={allowedElements}
        unwrapDisallowed
        remarkPlugins={remarkPlugins}
        components={scopedComponents}
        rehypePlugins={[footnotes.plugin]}
        urlTransform={(value, key) => (key === 'href' ? safeMessageUrl(value) : undefined)}
      >
        {text}
      </Markdown>
    </div>
  );
});
