// Bundles the libraries for plain <script> tags (the renderer has no bundler, and they import their own
// packages by name). Run `npm run vendor` after updating any of them.
// - @pierre/trees, the Files tree → vendor/trees.js, one file exposing window.Trees.
// - @pierre/diffs, the code preview → vendor/diffs/, ES modules split per language and theme, so a file only
//   loads the grammar it needs; renderer.js imports it the first time a file needs it. Plus worker.js.
// - @lucasmarkes/hairline, the line pictures on the New workspace cards → vendor/hairline.js, window.Hairline,
//   only the figures Fork uses (the custom folders figure runs on vendor/hairline-kernel.js instead).
import { rmSync } from 'node:fs';
import { build } from 'esbuild';

const common = { bundle: true, minify: true, target: 'chrome140', legalComments: 'eof', logLevel: 'info' };
await build({ ...common, stdin: { contents: "export { FileTree } from '@pierre/trees';", resolveDir: process.cwd() },
  format: 'iife', globalName: 'Trees', outfile: 'vendor/trees.js' });
rmSync('vendor/diffs', { recursive: true, force: true });
await build({ ...common, stdin: { contents: "export { File } from '@pierre/diffs';\nexport { getOrCreateWorkerPoolSingleton } from '@pierre/diffs/worker';",
  resolveDir: process.cwd() }, format: 'esm', splitting: true, outdir: 'vendor/diffs', entryNames: 'diffs', chunkNames: 'c/[hash]', logLevel: 'warning' });
// Colouring runs in a worker so a big file never freezes the window (renderer.js showCode).
await build({ ...common, entryPoints: ['node_modules/@pierre/diffs/dist/worker/worker.js'], format: 'esm', outfile: 'vendor/diffs/worker.js', logLevel: 'warning' });
// The stock figures on the New workspace cards. Its MIT notice goes on top: the package ships none in the code.
await build({ ...common, stdin: { contents: "export { loupe, branches } from '@lucasmarkes/hairline';", resolveDir: process.cwd() },
  format: 'iife', globalName: 'Hairline', outfile: 'vendor/hairline.js',
  banner: { js: '/*! @lucasmarkes/hairline 0.5.0 · MIT License · Copyright (c) 2026 Lucas Marques */' } });
