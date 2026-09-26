// The charts on the "Fork — how it's going" PostHog dashboard, as data. scripts/posthog-dashboard.mjs
// sends them; check.mjs makes sure every event Fork sends (dt.track / usage.track) shows up in one,
// so a new event can't be forgotten. Events deliberately left off go in NOT_CHARTED, with a reason.

export const NAME = 'Fork — how it\'s going';
export const NOT_CHARTED = { // event: why it isn't on the dashboard
  game_played: 'new; chart it once we know whether people play',
};

// --- Building blocks -------------------------------------------------------------------------------
const ev = (event, name, extra = {}) => ({ kind: 'EventsNode', event, name: event, custom_name: name, ...extra });
const where = (key, value) => ({ properties: [{ key, value: [value], operator: 'exact', type: 'event' }] });
const users = { math: 'dau' }; // unique installs (each install has its own random ID)
const trend = (series, { interval = 'week', from = '-90d', display = 'ActionsLineGraph', breakdown, formula } = {}) => ({
  kind: 'InsightVizNode',
  source: {
    kind: 'TrendsQuery', series, interval, dateRange: { date_from: from },
    ...(breakdown ? { breakdownFilter: { breakdown, breakdown_type: 'event' } } : {}),
    trendsFilter: { display, ...(formula ? { formula } : {}) },
  },
});
const funnel = (series, { from = '-90d', within = 1, unit = 'day' } = {}) => ({
  kind: 'InsightVizNode',
  source: { kind: 'FunnelsQuery', series, dateRange: { date_from: from },
    funnelsFilter: { funnelWindowInterval: within, funnelWindowIntervalUnit: unit, funnelVizType: 'steps' } },
});
const retention = () => ({
  kind: 'InsightVizNode',
  source: { kind: 'RetentionQuery', dateRange: { date_from: '-8w' },
    retentionFilter: { retentionType: 'retention_first_time', period: 'Week', totalIntervals: 8,
      targetEntity: { id: 'app_opened', type: 'events', name: 'app_opened' },
      returningEntity: { id: 'app_opened', type: 'events', name: 'app_opened' } } },
});

// --- The dashboard, top to bottom: growth, first run, what people do, what gets used -------------
export const INSIGHTS = [
  // Growth
  ['New installs per week', 'People opening Fork for the very first time. Each install counts once.',
    trend([ev('app_opened', 'New installs', { ...users, ...where('first_launch', 'true') })], { display: 'ActionsBar' })],
  ['Active installs per week', 'Installs that opened Fork at least once that week. The main "is it growing" line.',
    trend([ev('app_opened', 'Active installs', users)])],
  ['Active installs per day', 'Same, per day, last 30 days.',
    trend([ev('app_opened', 'Active installs', users)], { interval: 'day', from: '-30d' })],
  ['Do people come back?', 'Of the people who first opened Fork in a week, how many opened it again in the weeks after.',
    retention()],
  ['Which version people are on', 'Installs per Fork version, last 14 days. After a release, the new version should take over within days (the update pill).',
    trend([ev('app_opened', 'Installs', users)], { from: '-14d', interval: 'day', display: 'ActionsBar', breakdown: 'app_version' })],

  // First run
  ['First run: from opening to a first command', 'Of new installs, how many finish the welcome cards, pick where to work, and run something on day one.',
    funnel([ev('app_opened', 'Opened Fork for the first time', where('first_launch', 'true')), ev('welcome_done', 'Finished the welcome cards'),
      ev('start_choice', 'Picked where to work'), ev('command_run', 'Ran a command')])],
  ['Welcome cards: finished or skipped', 'Skipped is broken down by the card people left on (0 = first card).',
    trend([ev('welcome_done', 'Finished'), ev('welcome_skipped', 'Skipped')], { display: 'ActionsBarValue', from: '-90d' })],
  ['Where people skip the welcome', 'Welcome cards skipped, by card (0, 1 or 2).',
    trend([ev('welcome_skipped', 'Skipped')], { display: 'ActionsBarValue', breakdown: 'card' })],
  ['Tour: finished, or which step people skip at', 'tour_done vs tour_skipped, broken down by the step they were on.',
    trend([ev('tour_done', 'Finished the tour'), ev('tour_skipped', 'Skipped the tour')], { display: 'ActionsBarValue', breakdown: 'step' })],
  ['Start screen: what people choose', 'A recent folder, choosing a folder, a GitHub project, or "Just open the terminal".',
    trend([ev('start_choice', 'Choices')], { display: 'ActionsPie', breakdown: 'choice' })],

  // What people do
  ['Commands: typed by people vs typed by Fork', 'Fork = a chip, the sidebar or ⌘K typed it. Typed = the person wrote it. Typed going up over time means people are learning.',
    trend([ev('command_run', 'Commands')], { breakdown: 'source' })],
  ['Which tools people run', 'Installs running each tool at least once, last 30 days. claude vs codex answers "which AI do our people use".',
    trend([ev('command_run', 'Installs', users)], { from: '-30d', display: 'ActionsBarValue', breakdown: 'tool' })],
  ['⌘K: opened → used', 'How often ⌘K leads to running something.',
    funnel([ev('palette_opened', 'Opened ⌘K'), ev('palette_used', 'Used a result')], { within: 10, unit: 'minute' })],
  ['⌘K: presets vs asking AI', 'preset = ran a command from the list · jev = ran the answer Jev found for plain words · ask_claude = used Ask AI.',
    trend([ev('palette_used', 'Used')], { display: 'ActionsBarValue', breakdown: 'kind' })],
  ['⌘K: did asking AI work?', 'ok = Claude returned a command. false means it failed (not logged in, no Claude, or no answer). Answers Jev found show as kind jev in the chart above.',
    trend([ev('palette_used', 'Asked AI', where('kind', 'ask_claude'))], { display: 'ActionsBarValue', breakdown: 'ok' })],
  ['When something fails: explained → fixed', 'A command failed, the person clicked "What went wrong?", then "Type the fix".',
    funnel([ev('command_failed', 'A command failed'), ev('error_explained', 'Clicked "What went wrong?"'), ev('fix_used', 'Used the fix')], { within: 30, unit: 'minute' })],
  ['Errors Fork explains itself', 'Which common errors people hit, answered by Fork\'s own library (errors.mjs), last 30 days. The top ones deserve the best copy.',
    trend([ev('error_explained', 'Explained by Fork', where('source', 'fork'))], { from: '-30d', display: 'ActionsBarValue', breakdown: 'id' })],
  ['Explained by Fork vs AI', 'fork = the library knew it · jev = Jev matched it to a library entry · unknown = neither did (worth a new entry) · ai = someone asked Claude.',
    trend([ev('error_explained', 'Explanations')], { from: '-30d', display: 'ActionsBarValue', breakdown: 'source' })],
  ['What fails most', 'Failed commands by tool, last 30 days. Good candidates for better help.',
    trend([ev('command_failed', 'Failures')], { from: '-30d', display: 'ActionsBarValue', breakdown: 'tool' })],

  // What gets used
  ['Minutes Fork stays open', 'Median minutes per session (from open to quit), per week.',
    trend([ev('app_closed', 'Median minutes open', { math: 'median', math_property: 'minutes_open' })])],
  ['Features used (installs, last 30 days)', 'How many installs used each feature at least once.',
    trend([
      ev('file_previewed', 'Previewed a file', users), ev('app_preview_shown', 'Showed their app', users),
      ev('folder_opened', 'Moved folders', users), ev('tab_opened', 'Opened a tab', users), ev('pane_split', 'Split a pane', users),
      ev('find_opened', 'Used ⌘F', users), ev('session_restored', 'Came back to restored tabs', users),
      ev('tour_replayed', 'Replayed the tour', users), ev('update_clicked', 'Updated from the pill', users),
      ev('preview_toggled', 'Opened or closed the preview (⌘P)', users), ev('sidebar_toggled', 'Hid or showed the sidebar (⌘B)', users),
    ], { from: '-30d', display: 'ActionsBarValue' })],
  ['Settings people change', 'Which settings get changed, last 30 days (theme, font, restore, links & files…).',
    trend([ev('setting_changed', 'Changes')], { from: '-30d', display: 'ActionsBarValue', breakdown: 'setting' })],
];

// Every event name the charts use.
export const chartedEvents = () => {
  const out = new Set();
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (o.kind === 'EventsNode') out.add(o.event);
    if (o.type === 'events' && o.id) out.add(o.id); // retention entities
    for (const v of Object.values(o)) walk(v);
  };
  walk(INSIGHTS.map(([, , q]) => q));
  return out;
};
