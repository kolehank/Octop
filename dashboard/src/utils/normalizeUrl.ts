/** Ensure a navigable URL — ``baidu.com`` → ``https://baidu.com``. */
export function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (/^(?:https?|about|file):/i.test(t)) return t;
  return `https://${t}`;
}
