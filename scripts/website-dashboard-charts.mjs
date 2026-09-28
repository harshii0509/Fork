// The charts on the "Fork website — who visits" PostHog dashboard, as data. scripts/posthog-dashboard.mjs
// sends them alongside the app's (dashboard-charts.mjs). The site (repo fork-website) sends to the same
// PostHog project as the app, and every event it sends carries site: fork-website, so each chart filters on that.

import { ev, where, users, trend, funnel } from './dashboard-charts.mjs';

export const NAME = 'Fork website — who visits';
export const DESCRIPTION = 'How many people visit fork-terminal.vercel.app, where they come from, and how many click Download. '
  + 'Kept in sync by scripts/posthog-dashboard.mjs. The site keeps no cookies, so every visit counts on its own: visits, not people.';

// A site event, plus any extra filters (where(...)) on top of site: fork-website.
const web = (event, name, extra = {}) =>
  ev(event, name, { ...extra, properties: [...where('site', 'fork-website').properties, ...(extra.properties || [])] });
const page = (name) => web('$pageview', name);

// --- The dashboard, top to bottom: visits, downloads, what people click --------------------------
export const INSIGHTS = [
  // Visits
  ['Visits per day', 'Page views of the site, last 30 days.',
    trend([page('Visits')], { interval: 'day', from: '-30d' })],
  ['Visits per week', 'Same, per week, last 90 days.',
    trend([page('Visits')], { display: 'ActionsBar' })],
  ['Where visitors come from', 'The site people came from, last 30 days. $direct = typed the link, or came from an app that hides it (X, Slack, iMessage…).',
    trend([page('Visits')], { from: '-30d', display: 'ActionsBarValue', breakdown: '$referring_domain' })],
  ['Countries', 'Visits by country, last 30 days.',
    trend([page('Visits')], { from: '-30d', display: 'ActionsBarValue', breakdown: '$geoip_country_name' })],
  ['Desktop vs phone', 'Fork is a Mac app, so people on a phone can\'t download it there and then.',
    trend([page('Visits')], { from: '-30d', display: 'ActionsPie', breakdown: '$device_type' })],

  // Downloads
  ['Visit → Download', 'Of the visits, how many clicked Download for Mac. The number that matters most.',
    funnel([page('Visited the site'), web('download_clicked', 'Clicked Download')], { within: 1, unit: 'hour' })],
  ['Download clicks per day', 'Last 30 days.',
    trend([web('download_clicked', 'Download clicks')], { interval: 'day', from: '-30d', display: 'ActionsBar' })],
  ['Downloads vs new installs', 'Download clicks on the site next to Fork being opened for the first time. The gap is people who '
    + 'downloaded but never opened it (or got stuck on the "can\'t be opened" warning). Also counts installs that didn\'t come from the site.',
    trend([web('download_clicked', 'Download clicks'), ev('app_opened', 'New installs', { ...users, ...where('first_launch', 'true') })],
      { interval: 'day', from: '-30d' })],

  // What people click
  ['What people click', 'Every link the site tracks, last 30 days.',
    trend([web('download_clicked', 'Download'), web('github_clicked', 'GitHub'),
      web('social_clicked', 'X', where('network', 'x')), web('social_clicked', 'LinkedIn', where('network', 'linkedin'))],
      { from: '-30d', display: 'ActionsBarValue' })],
  ['What\'s cooking visits', 'Visits to the changelog (/whats-cooking) per day, last 30 days, and clicks on the ways in from the home page (the sticky note and the footer link).',
    trend([web('$pageview', 'Changelog visits', where('$pathname', '/whats-cooking')), web('cooking_clicked', 'Came from the home page')], { interval: 'day', from: '-30d' })],
  ['Snowman: found → snow', 'Of the visits, how many poked the snowman, and how many poked it enough to make it snow.',
    funnel([page('Visited the site'), web('snowman_poked', 'Poked the snowman'), web('snow_unlocked', 'Made it snow')], { within: 1, unit: 'hour' })],
];
