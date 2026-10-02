import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CodeBlock, CodeContent } from '../src/client/CodeBlock.js';
import { codeLanguage, highlightCode } from '../src/client/code-highlighting.js';

function highlighted(text: string, language: string) {
  const result = highlightCode(text, language);
  if (result.status !== 'ready') assert.fail(result.reason);
  assert.equal(result.tokens.map((token) => text.slice(token.start, token.end)).join(''), text);
  return result.tokens.map((token) => ({
    kind: token.kind,
    text: text.slice(token.start, token.end),
  }));
}
function html(text: string, language: string) {
  return renderToStaticMarkup(
    createElement(CodeContent, { text, presentation: highlightCode(text, language) }),
  );
}

test('highlighting recognizes only explicit bounded fence aliases, without language guessing or prototype names', () => {
  for (const [label, language] of [
    ['JS', 'javascript'],
    ['javascript', 'javascript'],
    ['ts', 'typescript'],
    ['TypeScript', 'typescript'],
    ['JSON', 'json'],
    ['py', 'python'],
    ['Python', 'python'],
  ])
    assert.equal(codeLanguage(label), language);
  for (const label of [
    undefined,
    '',
    'constructor',
    '__proto__',
    'toString',
    'html',
    'tsx',
    'sh',
    ' js ',
    '../python',
    'javascript\n',
    'j'.repeat(51),
  ]) {
    assert.equal(codeLanguage(label), undefined);
    assert.equal(highlightCode('const answer = 42;', label).status, 'unavailable');
  }
  const plain = renderToStaticMarkup(createElement(CodeBlock, { text: 'const answer = 42;\n' }));
  assert.doesNotMatch(plain, /code-token|Toggle code highlighting/);
  const available = renderToStaticMarkup(
    createElement(CodeBlock, { text: 'const answer = 42;\n', language: 'js' }),
  );
  assert.match(available, /aria-pressed="false"/);
  assert.doesNotMatch(available, /code-token/);
});

test('JavaScript and TypeScript distinguish whole keywords, strings, comments, and numeric literals without changing text', () => {
  const source =
    'const answer: number = 0x2a;\n// return "<script>"\n/* class */\nlet returning = `value ${answer}`;\nconst caféconst = "quoted \\"word\\"";\n';
  const ts = highlighted(source, 'ts');
  assert.ok(ts.some((token) => token.kind === 'keyword' && token.text === 'const'));
  assert.ok(ts.some((token) => token.kind === 'keyword' && token.text === 'number'));
  assert.ok(ts.some((token) => token.kind === 'number' && token.text === '0x2a'));
  assert.ok(ts.some((token) => token.kind === 'comment' && token.text === '// return "<script>"'));
  assert.ok(ts.some((token) => token.kind === 'comment' && token.text === '/* class */'));
  assert.ok(ts.some((token) => token.kind === 'string' && token.text === '`value ${answer}`'));
  assert.ok(ts.some((token) => token.kind === 'plain' && token.text.includes('returning')));
  assert.ok(ts.some((token) => token.kind === 'plain' && token.text.includes('caféconst')));
  assert.ok(
    !highlighted('let answer: number = .5e+2;', 'js').some(
      (token) => token.kind === 'keyword' && token.text === 'number',
    ),
  );
  assert.ok(
    highlighted('let value = 123n;', 'js').some(
      (token) => token.kind === 'number' && token.text === '123n',
    ),
  );
  const separated = highlighted('#!/usr/bin/env node\n// first\u2028const x = 1;', 'js');
  assert.ok(
    separated.some((token) => token.kind === 'comment' && token.text === '#!/usr/bin/env node'),
  );
  assert.ok(separated.some((token) => token.kind === 'keyword' && token.text === 'const'));
});

test('Python preserves triple-quoted strings and comments while recognizing its own case-sensitive keywords', () => {
  const source =
    'def result():\n    """return True\n😀 and <img>"""\n    # None is source data\n    return True if café else None\n';
  const tokens = highlighted(source, 'python');
  assert.ok(
    tokens.some(
      (token) => token.kind === 'string' && token.text === '"""return True\n😀 and <img>"""',
    ),
  );
  assert.ok(
    tokens.some((token) => token.kind === 'comment' && token.text === '# None is source data'),
  );
  for (const word of ['def', 'return', 'True', 'None'])
    assert.ok(tokens.some((token) => token.kind === 'keyword' && token.text === word));
  assert.ok(!highlighted('true false null', 'py').some((token) => token.kind === 'keyword'));
});

test('JSON highlights quoted property names, escaped strings, numbers, and literals without interpreting their values', () => {
  const source = '{"a\\"b": "<script> & 😀", "amount": -4.25e+2, "ready": true, "empty": null}\r\n';
  const tokens = highlighted(source, 'json');
  assert.ok(tokens.some((token) => token.kind === 'property' && token.text === '"a\\"b"'));
  assert.ok(tokens.some((token) => token.kind === 'string' && token.text === '"<script> & 😀"'));
  assert.ok(tokens.some((token) => token.kind === 'number' && token.text === '-4.25e+2'));
  for (const word of ['true', 'null'])
    assert.ok(tokens.some((token) => token.kind === 'keyword' && token.text === word));
  assert.equal(html(source, 'json').includes('<script>'), false);
});

test('the character bound preserves Unicode and shows complete plain text rather than a partial highlighted prefix', () => {
  highlighted('a'.repeat(20000), 'js');
  highlighted('😀'.repeat(10000), 'py');
  const source = 'a'.repeat(20001);
  const result = highlightCode(source, 'js');
  assert.equal(result.status, 'unavailable');
  if (result.status === 'unavailable') assert.match(result.reason, /20,000 characters/);
  assert.equal(html(source, 'js'), '<code>' + source + '</code>');
  assert.equal(highlightCode('😀'.repeat(10001), 'py').status, 'unavailable');
});

test('line and token-run limits allow their boundary and fall back without dropping any code', () => {
  highlighted('x\n'.repeat(1000), 'js');
  highlighted('x\r\n'.repeat(1000), 'py');
  for (const boundary of ['\r', '\u2028', '\u2029']) {
    assert.equal(highlightCode(('x' + boundary).repeat(1001), 'js').status, 'unavailable');
  }
  const lines = 'x\n'.repeat(1001);
  const lineResult = highlightCode(lines, 'js');
  assert.equal(lineResult.status, 'unavailable');
  if (lineResult.status === 'unavailable') assert.match(lineResult.reason, /1,000 lines/);
  assert.equal(html(lines, 'js'), '<code>' + lines + '</code>');
  assert.equal(highlighted('true '.repeat(1000), 'json').length, 2000);
  const runs = 'true '.repeat(1001);
  const runResult = highlightCode(runs, 'json');
  assert.equal(runResult.status, 'unavailable');
  if (runResult.status === 'unavailable') assert.match(runResult.reason, /2,000 token runs/);
  assert.equal(html(runs, 'json'), '<code>' + runs + '</code>');
});

test('unfinished syntax and adversarial mixed text finish within the bounds and preserve every source code unit', () => {
  for (const source of [
    '"\\',
    '/*'.repeat(5000),
    '"'.repeat(300),
    '"""not closed\n',
    '0'.repeat(15000) + 'e+',
    '`'.repeat(301),
    'const πconst = "\u0000😀";\r\n',
  ])
    for (const language of ['js', 'ts', 'json', 'py']) {
      const result = highlightCode(source, language);
      if (result.status === 'ready')
        assert.equal(
          result.tokens.map((token) => source.slice(token.start, token.end)).join(''),
          source,
        );
      else assert.match(result.reason, /limited/);
    }
  const pieces = [
    '"',
    "'",
    '`',
    '\\',
    '\n',
    '\r',
    '/',
    '*',
    'const',
    'true',
    '😀',
    'é',
    '<script>',
    '\u0000',
    '123e+',
    ' ',
  ];
  let seed = 271828;
  for (let n = 0; n < 128; n++) {
    let source = '';
    for (let i = 0; i < 80; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      source += pieces[seed % pieces.length];
    }
    for (const language of ['js', 'ts', 'json', 'py']) highlighted(source, language);
  }
});

test('highlighted React output contains only escaped code text and application-owned span classes', () => {
  const source =
    'const injected = "<img src=https://evil.example/pixel onerror=alert(1)>";\n// <form action="/api/rooms"><script>run()</script>\nwindow.highlightInjected=true;\n';
  const rendered = html(source, 'js');
  assert.match(rendered, /code-token code-keyword/);
  assert.match(rendered, /&lt;img/);
  assert.match(rendered, /&lt;form/);
  assert.doesNotMatch(
    rendered,
    /<(?:script|img|form|a|iframe|style|link)\b|<[^>]+(?:href|src|style|onclick|onerror)=/,
  );
  for (const match of rendered.matchAll(/<span ([^>]+)>/g))
    assert.match(
      match[1]!,
      /^class="code-token code-(?:keyword|string|property|comment|number|punctuation)"$/,
    );
  const unknown = renderToStaticMarkup(
    createElement(CodeBlock, { text: source, language: 'constructor' }),
  );
  assert.match(unknown, /disabled=""/);
  assert.match(unknown, /This block stays plain/);
  assert.doesNotMatch(unknown, /code-token/);
});

test('every token color meets normal-text contrast against the code background in both existing themes', () => {
  const theme = readFileSync('src/client/theme.css', 'utf8');
  const styles = readFileSync('src/client/styles.css', 'utf8');
  const tokenColors = [
    ...styles.matchAll(
      /\.code-block \.code-(?:keyword|string|property|comment|number|punctuation)\s*\{\s*color: var\(--([\w-]+)\);\s*\}/g,
    ),
  ].map((match) => match[1]!);
  assert.equal(tokenColors.length, 6);
  const luminance = (hex: string) => {
    const channels = [0, 2, 4].map((i) => {
      const value = parseInt(hex.slice(i, i + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  };
  const themes = [...theme.matchAll(/:root(?:\[data-theme='light'\])?\s*\{([^}]+)\}/g)];
  assert.equal(themes.length, 2);
  for (const match of themes) {
    const colors = new Map(
      [...match[1]!.matchAll(/--([\w-]+): #([\da-f]{6});/g)].map((m) => [m[1]!, m[2]!]),
    );
    const background = luminance(colors.get('inset')!);
    for (const name of tokenColors) {
      const foreground = luminance(colors.get(name)!);
      const ratio =
        (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      assert.ok(ratio >= 4.5, name + ' contrast ' + ratio);
    }
  }
});
