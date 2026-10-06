// Bundles @pierre/trees (the Files tree) into vendor/trees.js for a plain <script> tag: the renderer has no
// bundler, and Trees imports preact by name. Run `npm run vendor` after updating @pierre/trees.
import { build } from 'esbuild';

await build({
  stdin: { contents: "export { FileTree } from '@pierre/trees';", resolveDir: process.cwd() },
  bundle: true, format: 'iife', globalName: 'Trees', minify: true, target: 'chrome140',
  outfile: 'vendor/trees.js', legalComments: 'eof', logLevel: 'info',
});
