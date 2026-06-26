import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Static-site generation: render the app to HTML and inject it into the built
// client template, so the deployed index.html contains real content. Follows
// the Vite SSG guide (https://vite.dev/guide/ssr.html#pre-rendering-ssg).
const here = path.dirname(fileURLToPath(import.meta.url));
const abs = (p) => path.resolve(here, p);

const template = fs.readFileSync(abs('dist/static/index.html'), 'utf-8');
const { render } = await import(pathToFileURL(abs('dist/server/entry-server.js')).href);

const html = template.replace('<!--app-html-->', render());
fs.writeFileSync(abs('dist/static/index.html'), html);

// The server bundle is a build artifact only; keep the uploaded folder clean.
fs.rmSync(abs('dist/server'), { recursive: true, force: true });

console.log('prerendered dist/static/index.html');
