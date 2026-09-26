// Jev (TypeSafe's System One model): quick, typed judgments instead of generated text. Fork asks it two
// fixed questions, only when the person acts (⌘K, "What went wrong?") and Smarter matching is on:
//   - which built-in ⌘K command does this plain-English request mean?
//   - which of Fork's known errors (errors.mjs) is this, if any?
// Main process only, so the key never reaches the page. Any failure (offline, no key, limits) is null:
// Fork carries on as if Jev weren't there. Docs: https://docs.typesafe.ai/api
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = 'https://api.typesafe.ai/v1/systemone';
const HERE = dirname(fileURLToPath(import.meta.url));

// The key: TYPESAFE_API_KEY, else typesafe.json (put into the app by scripts/bundle-keys.mjs, never
// committed), else ~/.config/fork/typesafe-key when running from source.
export function loadKey() {
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY;
  try { return JSON.parse(readFileSync(join(HERE, 'typesafe.json'), 'utf8')).key || null; } catch {}
  const local = join(homedir(), '.config/fork/typesafe-key');
  try { return existsSync(local) ? readFileSync(local, 'utf8').trim() || null : null; } catch { return null; }
}

// ⌘K: pick one of the built-in commands, or "none".
export function commandQuestion(palette) {
  const criteria = Object.fromEntries(palette.map((p) => [p.label, `${p.why} (runs: ${p.cmd.trim()})`]));
  criteria.none = 'None of these do what the person asked for.';
  return { type: 'choice', criteria,
    instructions: 'A designer new to the terminal typed `request` into a command search. Which built-in command does what they asked for? Pick none if none of them does it.' };
}

// "What went wrong?": pick one of Fork's known errors, or "none". Each is described by its own general wording.
export function errorQuestion(errors, describe) {
  const criteria = Object.fromEntries(errors.map((e) => [e.id, describe(e.id)]));
  criteria.none = 'Something else: none of these explain this output.';
  return { type: 'choice', criteria,
    instructions: 'A command failed in a Mac terminal and printed `terminal_output`. Which of these known problems is it? Pick none if it is a different problem.' };
}

// One question -> { choice, confidence } or null. log: where to say what happened (dev only).
export async function judge(key, state, question, log = () => {}) {
  if (!key) return null;
  const t0 = Date.now();
  try {
    const r = await fetch(URL, {
      method: 'POST', signal: AbortSignal.timeout(3000),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'jev-latest', state, questions: { q: question } }),
    });
    if (!r.ok) { log(`[jev] ${r.status} in ${Date.now() - t0}ms`); return null; }
    const a = (await r.json()).answers?.q;
    log(`[jev] ${a?.choice} (${a?.confidence?.toFixed(2)}) in ${Date.now() - t0}ms`);
    return a?.choice ? { choice: a.choice, confidence: a.confidence ?? 0 } : null;
  } catch (e) {
    log(`[jev] failed: ${e.name}`);
    return null;
  }
}
