// npm run dashboard [-- --dry-run | --quiet]
// Brings the "Fork — how it's going" PostHog dashboard in line with scripts/dashboard-charts.mjs:
// charts are matched by name, so existing ones are updated, new ones added and dropped ones removed.
// The dashboard (and its link) stays the same. npm run release runs this after every release.
//
// Needs a PostHog *personal* API key (the key in analytics.mjs can only send events):
// PostHog → Settings → Personal API keys, scopes Project read, Dashboard write, Insight write, Query read.
// Put it in POSTHOG_PERSONAL_KEY, or in ~/.config/fork/posthog-key (chmod 600). Never in the repo.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { POSTHOG_KEY, POSTHOG_HOST } from '../analytics.mjs';
import { NAME, INSIGHTS } from './dashboard-charts.mjs';

const API = POSTHOG_HOST.replace('.i.posthog.com', '.posthog.com'); // us.i.posthog.com sends; us.posthog.com is the app
const dry = process.argv.includes('--dry-run');
const quiet = process.argv.includes('--quiet');
const say = (s) => { if (!quiet) console.log(s); };
const stop = (why) => { console.error(`✗ Dashboard: ${why}`); process.exit(1); };

if (dry) {
  for (const [name, , q] of INSIGHTS) console.log(`• ${name}  (${q.source.kind})`);
  console.log(`\nDry run: ${INSIGHTS.length} charts, nothing sent.`);
  process.exit(0);
}

let key = process.env.POSTHOG_PERSONAL_KEY;
try { key ||= readFileSync(join(homedir(), '.config/fork/posthog-key'), 'utf8').trim(); } catch {}
if (!key) stop('no PostHog personal API key. Put it in ~/.config/fork/posthog-key (see the top of this file).');

async function api(method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) stop(`PostHog said ${r.status} to ${method} ${path}:\n${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : null;
}

// The project whose send key is the one Fork ships with.
const projects = (await api('GET', '/api/projects/')).results;
const project = projects.find((p) => p.api_token === POSTHOG_KEY);
if (!project) stop(`none of this key's projects (${projects.map((p) => p.name).join(', ') || 'none'}) is the one Fork sends to.`);
const P = `/api/projects/${project.id}`;

const DESCRIPTION = 'Is Fork growing, do new people get through the first run, and what do they use? Kept in sync by '
  + 'scripts/posthog-dashboard.mjs (every release). Installs, not people: each install has one random ID.';
let dash = (await api('GET', `${P}/dashboards/?limit=200`)).results.find((d) => d.name === NAME && !d.deleted);
if (!dash) dash = await api('POST', `${P}/dashboards/`, { name: NAME, description: DESCRIPTION, pinned: true });
else dash = await api('GET', `${P}/dashboards/${dash.id}/`);

const onBoard = new Map((dash.tiles || []).filter((t) => t.insight && !t.insight.deleted).map((t) => [t.insight.name, t.insight]));
const counts = { updated: 0, added: 0, removed: 0 };
for (const [name, description, query] of INSIGHTS) {
  const have = onBoard.get(name);
  if (have) {
    await api('PATCH', `${P}/insights/${have.id}/`, { description, query });
    onBoard.delete(name);
    counts.updated++;
  } else {
    await api('POST', `${P}/insights/`, { name, description, query, dashboards: [dash.id] });
    counts.added++;
    say(`  + ${name}`);
  }
}
for (const [name, insight] of onBoard) { // on the dashboard, but no longer in dashboard-charts.mjs
  await api('PATCH', `${P}/insights/${insight.id}/`, { deleted: true });
  counts.removed++;
  say(`  − ${name}`);
}
if (dash.description !== DESCRIPTION) await api('PATCH', `${P}/dashboards/${dash.id}/`, { description: DESCRIPTION });

console.log(`✓ Dashboard: ${INSIGHTS.length} charts (${counts.updated} updated, ${counts.added} added, ${counts.removed} removed)`
  + ` · ${API}/project/${project.id}/dashboard/${dash.id}`);
