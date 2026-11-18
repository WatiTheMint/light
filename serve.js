// Крошечный статический сервер для превью: node serve.js [порт]
// POST /__snap/<имя> с dataURL канваса кладёт кадр в .snaps/<имя>.png (для проверок без окна).
const http = require('http');
const fs = require('fs');
const path = require('path');

const port = Number(process.argv[2]) || 5185;
const root = __dirname;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (req.method === 'POST' && url.startsWith('/__snap/')) {
    const name = path.basename(url).replace(/[^\w-]/g, '') || 'snap';
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      fs.mkdirSync(path.join(root, '.snaps'), { recursive: true });
      fs.writeFileSync(path.join(root, '.snaps', name + '.png'), Buffer.from(body.split(',')[1] || '', 'base64'));
      res.writeHead(200); res.end('ok');
    });
    return;
  }
  const file = path.normalize(path.join(root, url === '/' ? 'index.html' : url));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    const head = { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
    // Range нужен браузеру, чтобы перематывать и зацикливать аудио.
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (m) {
      const start = m[1] ? Number(m[1]) : Math.max(0, data.length - Number(m[2]));
      const end = m[1] && m[2] ? Math.min(Number(m[2]), data.length - 1) : data.length - 1;
      if (start >= data.length || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${data.length}` }); return res.end(); }
      res.writeHead(206, Object.assign(head, { 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': end - start + 1 }));
      return res.end(data.subarray(start, end + 1));
    }
    res.writeHead(200, Object.assign(head, { 'Content-Length': data.length }));
    res.end(data);
  });
}).listen(port, '127.0.0.1', () => console.log('poka-gorit-svet: http://127.0.0.1:' + port));
