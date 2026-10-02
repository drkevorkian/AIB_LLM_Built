export type CodeLanguage = 'javascript' | 'typescript' | 'json' | 'python';
export type CodeToken = {
  start: number;
  end: number;
  kind: 'plain' | 'keyword' | 'string' | 'property' | 'comment' | 'number' | 'punctuation';
};
export type CodeHighlight =
  { status: 'ready'; tokens: CodeToken[] } | { status: 'unavailable'; reason: string };

export const codeHighlightLimits = { characters: 20000, lines: 1000, tokens: 2000 } as const;
const aliases = new Map<string, CodeLanguage>([
  ['javascript', 'javascript'],
  ['js', 'javascript'],
  ['typescript', 'typescript'],
  ['ts', 'typescript'],
  ['json', 'json'],
  ['python', 'python'],
  ['py', 'python'],
]);
const javascript = new Set(
  'as async await break case catch class const continue debugger default delete do else export extends false finally for from function get if import in instanceof let new null of return set static super switch this throw true try typeof var void while with yield'.split(
    ' ',
  ),
);
const typescript = new Set([
  ...javascript,
  ...'abstract any asserts bigint boolean declare enum implements infer interface is keyof module namespace never number override private protected public readonly require satisfies string symbol type undefined unique unknown'.split(
    ' ',
  ),
]);
const python = new Set(
  'False None True and as assert async await break case class continue def del elif else except finally for from global if import in is lambda match nonlocal not or pass raise return try while with yield'.split(
    ' ',
  ),
);
const json = new Set(['true', 'false', 'null']);
const words = { javascript, typescript, python, json };
// Fixed, sticky, nonrecursive patterns; source text and fence labels never define a regex.
const jsonNumber = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const codeNumber =
  /(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*(?:\.[\d_]+)?|\.[\d_]+)(?:[eE][+-]?[\d_]+)?)[nj]?/y;

export function codeLanguage(label?: string): CodeLanguage | undefined {
  if (!label || label.length > 50) return;
  return aliases.get(label.toLowerCase());
}

function lineBreak(char: string | undefined): boolean {
  return char === '\n' || char === '\r' || char === '\u2028' || char === '\u2029';
}

/** Cheap checks never infer a language from content. CRLF counts once; trailing breaks add no line. */
export function codeHighlightReason(text: string, label?: string): string | undefined {
  if (!codeLanguage(label))
    return 'Highlighting supports JavaScript, TypeScript, JSON, and Python. This block stays plain.';
  if (!text) return 'There is no code to highlight.';
  if (text.length > codeHighlightLimits.characters)
    return 'This block stays plain: highlighting is limited to 20,000 characters.';
  let lines = 1;
  for (let i = 0; i < text.length; i++) {
    const boundary = lineBreak(text[i]);
    if (text[i] === '\r' && text[i + 1] === '\n') i++;
    if (boundary && i < text.length - 1 && ++lines > codeHighlightLimits.lines)
      return 'This block stays plain: highlighting is limited to 1,000 lines.';
  }
}

function identifier(char: string | undefined, start = false): boolean {
  return (
    char !== undefined &&
    (/[a-zA-Z_$]/.test(char) ||
      (!start && /\d/.test(char)) ||
      (char.charCodeAt(0) >= 128 && !/\s/.test(char)))
  );
}

/** Bounded lexical aid, not a validator. Output contains offsets and fixed categories only. */
export function highlightCode(text: string, label?: string): CodeHighlight {
  try {
    const reason = codeHighlightReason(text, label);
    if (reason) return { status: 'unavailable', reason };
    const language = codeLanguage(label)!;
    const tokens: CodeToken[] = [];
    let i = 0;
    while (i < text.length) {
      const start = i;
      const char = text[i]!;
      let kind: CodeToken['kind'] = 'plain';
      const js = language === 'javascript' || language === 'typescript';
      if (
        (js && (text.startsWith('//', i) || (i === 0 && text.startsWith('#!', i)))) ||
        (language === 'python' && char === '#')
      ) {
        while (i < text.length && !lineBreak(text[i])) i++;
        kind = 'comment';
      } else if (js && text.startsWith('/*', i)) {
        const end = text.indexOf('*/', i + 2);
        i = end < 0 ? text.length : end + 2;
        kind = 'comment';
      } else if (char === '"' || (language !== 'json' && (char === "'" || (js && char === '`')))) {
        const triple = language === 'python' && text.startsWith(char.repeat(3), i);
        const delimiter = triple ? char.repeat(3) : char;
        i += delimiter.length;
        while (i < text.length) {
          if (text[i] === '\\') i = Math.min(text.length, i + 2);
          else if (text.startsWith(delimiter, i)) {
            i += delimiter.length;
            break;
          } else if (!triple && char !== '`' && (text[i] === '\n' || text[i] === '\r')) break;
          else i++;
        }
        kind = 'string';
        if (language === 'json') {
          let next = i;
          while (next < text.length && /\s/.test(text[next]!)) next++;
          if (text[next] === ':') kind = 'property';
        }
      } else if (identifier(char, true)) {
        while (identifier(text[++i])) {
          // Non-ASCII identifiers remain literal; match keywords only as a complete token.
        }
        if (words[language].has(text.slice(start, i))) kind = 'keyword';
      } else {
        const number = language === 'json' ? jsonNumber : codeNumber;
        number.lastIndex = i;
        const match = number.exec(text);
        if (match) {
          i += match[0].length;
          kind = 'number';
        } else {
          i++;
          if ('{}[]().,;:+-*/%=!<>?&|^~'.includes(char)) kind = 'punctuation';
        }
      }
      const previous = tokens.at(-1);
      if (previous?.kind === kind) previous.end = i;
      else {
        if (tokens.length >= codeHighlightLimits.tokens)
          return {
            status: 'unavailable',
            reason: 'This block stays plain: highlighting is limited to 2,000 token runs.',
          };
        tokens.push({ start, end: i, kind });
      }
    }
    return { status: 'ready', tokens };
  } catch {
    return {
      status: 'unavailable',
      reason: 'Highlighting is unavailable. Original code is shown.',
    };
  }
}
