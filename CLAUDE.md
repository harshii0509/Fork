# Working on Fork

Fork is a terminal for designers who work with AI agents (Electron). Before changing anything, read:

- [docs/TECHNICAL.md](docs/TECHNICAL.md): how it's built. Processes, every file, every `dt` IPC call, every library, what's stored, how the tricky parts work, how to test.
- [docs/IA.md](docs/IA.md): how it's organised for the person using it. Every place, tab, setting and shortcut, and the words Fork uses.
- [docs/states-and-flows.md](docs/states-and-flows.md): terminal states, edge cases and flows for the redesign.

## Keep the docs current: same commit as the code

Every change updates the docs that it affects, before it's called done:

- **TECHNICAL.md** when you add, rename or remove a file, a `dt` call or IPC channel, a library (or change why it's used), something Fork stores, or how a feature works. Add a dated line to its Log.
- **IA.md** when you add, move, rename or remove a place on screen, a panel tab, a setting, a shortcut or a word in the UI. Add a dated line to its Log.

`npm run check` fails when a top-level script, a package, a `dt` call, a panel tab or a settings page is missing from the docs, but it can't check the prose. Keep that true too.

## Also on every change
- Plain words in the UI and the docs. The app is always **Fork**, never "designer-terminal".
- Don't favour one AI tool in general copy; name Claude only where a feature depends on it.
- Run `npm run check`. Check UI changes in the running app (`npm run ui`, or over CDP, see TECHNICAL.md §7).
