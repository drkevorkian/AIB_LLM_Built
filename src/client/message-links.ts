/** Conversation links must have an explicit web origin and cannot embed credentials. */
export function safeMessageUrl(value: string): string | undefined {
  if (!/^https?:\/\//i.test(value) || /[\u0000-\u0020\u007f\\]/.test(value)) return;
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    )
      return;
    return url.href;
  } catch {
    return;
  }
}
