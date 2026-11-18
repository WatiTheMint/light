// Собирает игру в один HTML-файл для публикации: node build.js
// Стили и скрипты встраиваются, обёртка <html>/<head>/<body> снимается (её добавляет площадка).
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let html = read('index.html');

html = html.replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g, (_, p) => `<style>\n${read(p)}</style>`);
html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (_, p) => `<script>\n${read(p).replace(/<\/script/gi, '<\\/script')}</script>`);

html = html
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<html[^>]*>\s*/i, '')
  .replace(/<\/html>\s*/i, '')
  .replace(/<head>\s*/i, '')
  .replace(/<\/head>\s*/i, '')
  .replace(/<body>\s*/i, '')
  .replace(/<\/body>\s*/i, '')
  .replace(/<meta charset="utf-8">\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '');

fs.mkdirSync(path.join(root, 'dist', 'audio'), { recursive: true });
const out = path.join(root, 'dist', 'poka-gorit-svet.html');
fs.writeFileSync(out, html);
// Музыка лежит рядом со страницей: audio/lullaby.mp3 (при публикации передаётся отдельным файлом).
for (const f of fs.readdirSync(path.join(root, 'audio'))) fs.copyFileSync(path.join(root, 'audio', f), path.join(root, 'dist', 'audio', f));
console.log('built', out, (html.length / 1024).toFixed(1) + ' KB', 'title at', html.indexOf('<title>'));
