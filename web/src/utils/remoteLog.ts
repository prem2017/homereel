/**
 * One line into the server's log, where `./1_run logs` shows it as
 * `[REMOTE ERROR]`. The TV has no devtools, so this is the only place its
 * failures can be read. Fire and forget: reporting a failure must never become
 * a failure of its own.
 */
export const reportToServer = (message: string, level = 'error'): void => {
  try {
    fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, message }),
    }).catch(() => { });
  } catch {
    // No fetch at all, or it threw before returning a promise.
  }
};
