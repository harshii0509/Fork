// Anonymous usage, sent to PostHog, to see how new people find their way around Fork.
// One random ID per install (no login, no name). Never commands, file names, paths or output:
// only which things get used, and for commands just an allow-listed tool name (toolOf).
// On by default; the start screen and Settings → Privacy turn it off. See DISTRIBUTION.md.
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The project key can only send events, not read them, so it's safe to ship. Empty = send nothing.
export const POSTHOG_KEY = 'phc_Azjw5QQ5bbxXz9gREpHK6SKbntQ4KC5ECWAu6z6hjAZp';
export const POSTHOG_HOST = 'https://us.i.posthog.com';

const TOOLS = new Set(('claude codex gemini git gh npm npx pnpm yarn bun node deno python python3 pip pip3 brew ' +
  'cd ls open code cursor cat mkdir touch mv cp rm trash clear exit vercel netlify').split(' '));
export const toolOf = (word) => (TOOLS.has(word) ? word : 'other');

// Only short plain values get through, whatever the window sends.
const clean = (props) => {
  const out = {};
  for (const [k, v] of Object.entries(props || {})) {
    if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 60);
  }
  if ('tool' in out) out.tool = toolOf(out.tool);
  return out;
};

// dir: where the ID and the on/off switch live. props: sent with every event. send(batch): posts it.
export function createAnalytics({ dir, props, send }) {
  const file = join(dir, 'analytics.json');
  const save = () => { try { writeFileSync(file, JSON.stringify(state)); } catch {} };
  let state = null;
  try { state = JSON.parse(readFileSync(file, 'utf8')); } catch {}
  const firstLaunch = !state?.id;
  if (firstLaunch) { state = { id: randomUUID(), on: true }; save(); }
  const session = randomUUID(); // one per launch
  let queue = [];
  return {
    firstLaunch,
    isOn: () => state.on,
    setOn(on) { state.on = !!on; if (!on) queue = []; save(); return state.on; },
    track(event, extra) {
      if (!state.on || !/^[a-z_]{1,40}$/.test(event)) return;
      queue.push({ event, distinct_id: state.id, timestamp: new Date().toISOString(),
        properties: { ...props, ...clean(extra), $session_id: session } });
    },
    flush() {
      if (!queue.length) return Promise.resolve();
      const batch = queue;
      queue = [];
      return Promise.resolve(send(batch)).catch(() => {}); // offline: those events are simply lost
    },
  };
}
