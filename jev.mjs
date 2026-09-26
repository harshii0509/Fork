// Jev (TypeSafe's System One model): quick, typed judgments instead of generated text. Fork asks it two
// fixed questions, only when the person acts (⌘K, "What went wrong?") and Smarter matching is on:
//   - which built-in ⌘K command does this plain-English request mean?
//   - which of Fork's known errors (errors.mjs) is this, if any?
// They go through Fork's website (fork-website app/api/jev/route.ts), which holds the TypeSafe key, so no key
// is inside the app. That server only accepts these two questions (INSTRUCTIONS). Any failure (offline,
// limits, server down) is null: Fork carries on as if Jev weren't there. FORK_JEV_URL points it elsewhere
// for testing, e.g. http://localhost:3000/api/jev with the website running locally.
export const JEV_URL = process.env.FORK_JEV_URL || 'https://fork-terminal.vercel.app/api/jev';
export const INSTRUCTIONS = {
  command: 'A designer new to the terminal typed `request` into a command search. Which built-in command does what they asked for? Pick none if none of them does it.',
  error: 'A command failed in a Mac terminal and printed `terminal_output`. Which of these known problems is it? Pick none if it is a different problem.',
};

// ⌘K: pick one of the built-in commands, or "none".
export function commandQuestion(palette) {
  const criteria = Object.fromEntries(palette.map((p) => [p.label, `${p.why} (runs: ${p.cmd.trim()})`]));
  criteria.none = 'None of these do what the person asked for.';
  return { type: 'choice', criteria, instructions: INSTRUCTIONS.command };
}

// "What went wrong?": pick one of Fork's known errors, or "none". Each is described by its own general wording.
export function errorQuestion(errors, describe) {
  const criteria = Object.fromEntries(errors.map((e) => [e.id, describe(e.id)]));
  criteria.none = 'Something else: none of these explain this output.';
  return { type: 'choice', criteria, instructions: INSTRUCTIONS.error };
}

// One question -> { choice, confidence } or null. log: where to say what happened (dev only).
export async function judge(state, question, log = () => {}, url = JEV_URL) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      method: 'POST', signal: AbortSignal.timeout(3000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, question }),
    });
    if (!r.ok) { log(`[jev] ${r.status} in ${Date.now() - t0}ms`); return null; }
    const a = await r.json();
    log(`[jev] ${a?.choice} (${a?.confidence?.toFixed(2)}) in ${Date.now() - t0}ms`);
    return a?.choice ? { choice: a.choice, confidence: a.confidence ?? 0 } : null;
  } catch (e) {
    log(`[jev] failed: ${e.name}`);
    return null;
  }
}
