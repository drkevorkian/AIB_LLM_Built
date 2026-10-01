import { ProviderError } from './providers.js';

/** Frame incrementally across arbitrary network and UTF-8 boundaries; always close the socket. */
export async function* lines(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let skipLF = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      const decoded = done ? decoder.decode() : decoder.decode(value, { stream: true });
      for (const char of decoded) {
        if (skipLF) {
          skipLF = false;
          if (char === '\n') continue;
        }
        if (char === '\r' || char === '\n') {
          yield buffer;
          buffer = '';
          skipLF = char === '\r';
        } else {
          buffer += char;
          if (buffer.length > 1_000_000)
            throw new ProviderError('Provider stream frame exceeds the size limit.');
        }
      }
      if (done) break;
    }
    if (buffer) yield buffer;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function* sse(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  let data: string[] = [];
  let size = 0;
  for await (const line of lines(body)) {
    if (!line) {
      if (data.length) yield data.join('\n');
      data = [];
      size = 0;
    } else if (line.startsWith('data:')) {
      const value = line.slice(5).replace(/^ /, '');
      data.push(value);
      size += value.length;
      if (size > 1_000_000)
        throw new ProviderError('Provider stream event exceeds the size limit.');
    }
  }
  if (data.length) yield data.join('\n');
}
