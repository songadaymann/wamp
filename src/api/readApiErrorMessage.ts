/** Read an error body once, preserving useful server text and caller fallbacks. */
export async function readApiErrorMessage(response: Response, fallback: string): Promise<string> {
  const text = await response.text().catch(() => '');
  if (!text.trim()) return fallback;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object' && 'error' in parsed
      && typeof parsed.error === 'string' && parsed.error.trim()) {
      return parsed.error;
    }
  } catch {
    // Proxies often return HTML or plain text instead of the API JSON shape.
  }
  return text;
}
