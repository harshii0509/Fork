// npm run dmg:background: renders dmg-background.html to background@2x.png (1200×800) and
// background.png (600×400). electron-builder picks both up for Fork.dmg's window.
import { app, BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 600, H = 400;
app.dock?.hide();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: W, height: H, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadFile(join(HERE, 'dmg-background.html'));
  await new Promise((r) => setTimeout(r, 300)); // fonts and first paint
  let img = await win.webContents.capturePage();
  if (img.getSize().width < W * 2) { // a 1x screen: draw at 2x zoom instead, so @2x is really sharp
    win.webContents.setZoomFactor(2);
    win.setContentSize(W * 2, H * 2);
    await new Promise((r) => setTimeout(r, 300));
    img = await win.webContents.capturePage();
  }
  const retina = img.resize({ width: W * 2, height: H * 2, quality: 'best' });
  writeFileSync(join(HERE, 'background@2x.png'), retina.toPNG());
  writeFileSync(join(HERE, 'background.png'), retina.resize({ width: W, height: H, quality: 'best' }).toPNG());
  console.log('wrote build/background.png (600×400) and build/background@2x.png (1200×800)');
  app.quit();
});
