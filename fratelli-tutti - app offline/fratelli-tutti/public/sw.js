const VERSAO = 'v1';
const SHELL = 'ft-shell-' + VERSAO;
const API = 'ft-api-v1';
const MIDIA = 'ft-media-v1';
const ARQUIVOS = ['/index.html', '/style.css', '/app.js', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith('ft-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (/^\/api\/midias\/\d+\/arquivo$/.test(url.pathname)) return e.respondWith(midia(req));
  if (url.pathname.startsWith('/api/')) return e.respondWith(apiRede(req));
  if (url.pathname === '/sw.js') return;
  e.respondWith(shell(req));
});

// Páginas e arquivos do site: usa a cópia salva e atualiza em segundo plano
async function shell(req) {
  const c = await caches.open(SHELL);
  const chave = req.mode === 'navigate' ? '/index.html' : req;
  const salvo = await c.match(chave);
  const rede = fetch(req)
    .then((r) => { if (r.ok) c.put(chave, r.clone()); return r; })
    .catch(() => null);
  return salvo || (await rede) || new Response('Sem conexão', { status: 503 });
}

// Dados (avisos, cifras, listas): tenta a internet; se falhar ou demorar, usa a cópia salva
async function apiRede(req) {
  const c = await caches.open(API);
  const salvo = await c.match(req);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), salvo ? 5000 : 30000);
    const r = await fetch(req, { signal: ctrl.signal });
    clearTimeout(t);
    if (r.ok) c.put(req, r.clone());
    return r;
  } catch (_) {
    if (salvo) return salvo;
    return new Response(
      JSON.stringify({ erro: 'Sem conexão e este conteúdo ainda não foi salvo no aparelho.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// Fotos e vídeos: guarda o arquivo inteiro e sabe responder trechos (Range) a partir dele
async function midia(req) {
  const c = await caches.open(MIDIA);
  const chave = new Request(req.url);
  const salvo = await c.match(chave);
  const range = req.headers.get('range');
  if (salvo) {
    if (!range) return salvo;
    const buf = await salvo.arrayBuffer();
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const ini = m && m[1] ? parseInt(m[1], 10) : 0;
    const fim = Math.min(m && m[2] ? parseInt(m[2], 10) : buf.byteLength - 1, buf.byteLength - 1);
    return new Response(buf.slice(ini, fim + 1), {
      status: 206,
      headers: {
        'Content-Type': salvo.headers.get('Content-Type') || 'application/octet-stream',
        'Content-Range': `bytes ${ini}-${fim}/${buf.byteLength}`,
        'Content-Length': String(fim - ini + 1),
        'Accept-Ranges': 'bytes',
      },
    });
  }
  try {
    const r = await fetch(req);
    if (r.status === 200) c.put(chave, r.clone());
    return r;
  } catch (_) {
    return new Response('', { status: 503 });
  }
}
