// Runs before npm run dist / npm run app: puts the TypeSafe (Jev) key into typesafe.json so it ships
// inside Fork.app. typesafe.json is gitignored: the key must never reach the public repo.
// The key comes from TYPESAFE_API_KEY or ~/.config/fork/typesafe-key. No key: Fork ships without Jev.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'typesafe.json');
const local = join(homedir(), '.config/fork/typesafe-key');
const key = process.env.TYPESAFE_API_KEY || (existsSync(local) ? readFileSync(local, 'utf8').trim() : '');

if (key) {
  writeFileSync(out, JSON.stringify({ key }));
  console.log('Jev key bundled (typesafe.json, not committed).');
} else {
  rmSync(out, { force: true });
  console.log('No Jev key found: this build won\'t use Jev (see scripts/bundle-keys.mjs).');
}
