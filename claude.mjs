// Ask AI: one Claude Code session (Haiku) kept warm while it's likely to be used, so an answer takes ~3s
// instead of ~6s for a fresh `claude -p` each time. It reuses the person's own Claude Code login.
// Fork warms it when ⌘K opens or "What went wrong?" is pressed; nothing is sent until Ask AI is pressed.
// It closes after 5 minutes unused, and starts fresh every few asks so the history stays small.
// Main process only. Any failure (no Claude, not logged in, timeout) is null.
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

const IDLE_MS = +process.env.FORK_AI_IDLE_MS || 5 * 60_000; // FORK_AI_IDLE_MS: a short timer, for testing
const FRESH_AFTER = 8, TIMEOUT_MS = 60_000;
const SYSTEM = 'You help a designer who is new to the Mac terminal. Each message is a new, independent request: ' +
  'follow its instructions exactly and ignore earlier messages.';

// Claude's reply as lines, without code fences or blank lines.
export const toLines = (text) => text.replace(/```\w*/g, '').trim().split('\n').map((l) => l.trim()).filter(Boolean);

let proc = null, asked = 0, idle, waiting = null, queue = Promise.resolve();

export function warm() {
  clearTimeout(idle);
  idle = setTimeout(stop, IDLE_MS);
  if (proc) return;
  const p = spawn('claude', ['-p', '--model', 'haiku', '--tools', '', '--no-session-persistence', '--setting-sources', '',
    '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--system-prompt', SYSTEM],
  { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'ignore'] });
  proc = p; asked = 0;
  let buf = '';
  p.stdout.on('data', (d) => {
    buf += d;
    for (let i; (i = buf.indexOf('\n')) >= 0;) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.type === 'result' && proc === p) finish(!m.is_error && m.result ? toLines(m.result) : null);
    }
  });
  // Exited or never started (no Claude, not logged in): whoever waits gets null. A session that was already
  // replaced or stopped says nothing, so it can't answer for the next one.
  const gone = () => { if (proc !== p) return; proc = null; finish(null); };
  p.on('error', gone);
  p.on('exit', gone);
  p.stdin.on('error', () => {}); // writing to a session that just died
}

function finish(answer) { const w = waiting; waiting = null; w?.(answer); }

export function stop() {
  clearTimeout(idle);
  const p = proc; proc = null;
  if (!p) return;
  p.stdin.end();
  setTimeout(() => p.kill(), 2000).unref(); // in case it doesn't exit by itself
}

// One ask at a time, so answers can't cross. instructions: what this ask is for; prompt: the details.
export function ask(instructions, prompt) {
  const run = () => new Promise((resolve) => {
    warm();
    if (++asked > FRESH_AFTER) { stop(); warm(); asked = 1; } // the history grows with each ask: start over now and then
    const timer = setTimeout(() => { stop(); finish(null); }, TIMEOUT_MS);
    waiting = (answer) => { clearTimeout(timer); resolve(answer); };
    proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: `${instructions}\n\n${prompt}` } }) + '\n');
  });
  return (queue = queue.then(run, run));
}
