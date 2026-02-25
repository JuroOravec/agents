/**
 * Filter entries using a JavaScript expression.
 *
 * Security: The expression is evaluated on the server via Function(). For local
 * preview only; never expose this to untrusted users.
 *
 * @param userScript - JS expression receiving `obj` (the log entry). E.g. obj.tool_name === 'Shell'
 * @returns Filter function for entries, or throws on syntax error.
 */
export function createFilterFn(
  userScript: string,
): (entry: { id: string; data: object }) => boolean {
  const trimmed = userScript.trim();
  if (!trimmed) {
    return () => true;
  }

  const body = `"use strict"; return !!(${trimmed})`;
  const fn = new Function('obj', body);
  return (entry: { id: string; data: object }) => {
    try {
      return Boolean(fn(entry.data));
    } catch {
      return false;
    }
  };
}

/**
 * Validate filter script (syntax check). Returns error message or null if valid.
 */
export function validateFilterScript(userScript: string): string | null {
  const trimmed = userScript.trim();
  if (!trimmed) return null;

  try {
    new Function('obj', `"use strict"; return !!(${trimmed})`);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
