import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test, type TestContext } from 'node:test';

const root = resolve('.');
const executable = join(root, 'node_modules', 'oxlint', 'bin', 'oxlint');
const configuration = readFileSync(join(root, '.oxlintrc.json'), 'utf8');
const lintCommand = (
  JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts.lint as string
).split(/\s+/);
assert.equal(lintCommand[0], 'oxlint');
assert.equal(lintCommand.at(-1), '.');
const lintOptions = lintCommand.slice(1, -1);
function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'aib-lint-gate-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const write = (path: string, text: string) => {
    const destination = join(directory, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, text);
    return destination;
  };
  write('.oxlintrc.json', configuration);
  const lint = (...args: string[]) => {
    const result = spawnSync(process.execPath, [executable, ...lintOptions, ...args], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null, 'Lint must exit normally rather than time out or crash.');
    return { status: result.status, output: result.stdout + result.stderr };
  };
  return { write, lint };
}

test('the committed lint gate rejects executable dynamic code and syntax faults while treating quoted model text as data', (t) => {
  const f = fixture(t);
  f.write(
    'unsafe.ts',
    'export function run(source: string) { return eval(source); }\nexport const compile = new Function("return 1");\n',
  );
  let result = f.lint('unsafe.ts');
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /no-eval/);
  assert.match(result.output, /no-new-func/);
  f.write('broken.tsx', 'export const Broken = <div>\n');
  result = f.lint('broken.tsx');
  assert.notEqual(result.status, 0, result.output);
  f.write(
    'source.ts',
    'export const modelText: string = "eval(source); new Function(\\\"return 1\\\"); <script>alert(1)</script>";\n',
  );
  result = f.lint('source.ts');
  assert.equal(result.status, 0, result.output);
});

test('intentional security-filter exceptions are narrow and unnecessary suppressions fail the gate', (t) => {
  const f = fixture(t);
  f.write(
    'filter.ts',
    'export const rejectsControl = (text: string) => /[\\u0000-\\u0020]/.test(text);\n',
  );
  let result = f.lint('filter.ts');
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /no-control-regex/);
  f.write(
    'filter.ts',
    '// oxlint-disable-next-line eslint/no-control-regex -- Intentional rejection boundary.\nexport const rejectsControl = (text: string) => /[\\u0000-\\u0020]/.test(text);\n',
  );
  result = f.lint('filter.ts');
  assert.equal(result.status, 0, result.output);
  f.write(
    'unused.ts',
    '// oxlint-disable-next-line eslint/no-control-regex -- Stale exception.\nexport const safe = true;\n',
  );
  result = f.lint('unused.ts');
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /unused|Unused/);
});

test('repository lint discovery includes new source, browser tests, and root tooling but excludes generated and local data', (t) => {
  const f = fixture(t);
  const retained = [
    'src/server/runtime.ts',
    'src/client/View.tsx',
    'tests/ui/flow.spec.ts',
    'vite.config.ts',
    'playwright.config.ts',
  ];
  for (const path of retained)
    f.write(
      path,
      path.endsWith('.tsx')
        ? 'export const View = () => <section>Safe source</section>;\n'
        : 'export const enabled: boolean = true;\n',
    );
  const ignored = [
    'node_modules/dependency/index.js',
    'dist/server/old.ts',
    '.data/private.ts',
    'coverage/result.js',
    'playwright-report/result.js',
    'test-results/result.js',
  ];
  for (const path of ignored) f.write(path, 'eval("fixture");\n');
  let result = f.lint('--debug', 'files', '.');
  assert.equal(result.status, 0, result.output);
  const normalized = result.output.replaceAll('\\', '/');
  for (const path of retained) assert.ok(normalized.includes(path), `${path} must be discovered`);
  for (const path of ignored) assert.ok(!normalized.includes(path), `${path} must be excluded`);
  result = f.lint('.');
  assert.equal(result.status, 0, result.output);
  f.write('src/server/new-module.ts', 'export const execute = (code: string) => eval(code);\n');
  result = f.lint('.');
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /new-module\.ts/);
});
