const express = require('express');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { pool, init } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const SECRET = process.env.SESSION_SECRET || 'troque-este-segredo-em-desenvolvimento';

// Chaves de acesso de cada equipe (definidas nas variáveis de ambiente)
const CHAVES = {
  coordenacao: process.env.CHAVE_COORDENACAO,
  musical: process.env.CHAVE_MUSICAL,
  producao: process.env.CHAVE_PRODUCAO,
};

const EMOJIS = ['❤️', '🙏', '🔥', '👏', '😊'];
const MAX_MB = 50;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024 },
});

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

// ---------- Sessão (cookie assinado) ----------
function assinar(valor) {
  return crypto.createHmac('sha256', SECRET).update(valor).digest('hex');
}

function criarToken(papel) {
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 30; // 30 dias
  const base = `${papel}.${exp}`;
  return `${base}.${assinar(base)}`;
}

function lerCookie(req, nome) {
  const header = req.headers.cookie || '';
  for (const parte of header.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nome) return decodeURIComponent(v.join('='));
  }
  return null;
}

function papelDaRequisicao(req) {
  const token = lerCookie(req, 'ft_sessao');
  if (!token) return 'visitante';
  const [papel, exp, sig] = token.split('.');
  if (!papel || !exp || !sig) return 'visitante';
  const esperado = assinar(`${papel}.${exp}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return 'visitante';
  if (Number(exp) < Date.now()) return 'visitante';
  if (!['coordenacao', 'musical', 'producao'].includes(papel)) return 'visitante';
  return papel;
}

app.use((req, _res, next) => {
  req.papel = papelDaRequisicao(req);
  next();
});

function exigir(...papeis) {
  return (req, res, next) => {
    if (papeis.includes(req.papel)) return next();
    res.status(403).json({ erro: 'Você não tem permissão para isso.' });
  };
}

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function igual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Limite simples de tentativas de login por IP
const tentativas = new Map();
function limitarLogin(req, res, next) {
  const ip = req.ip;
  const agora = Date.now();
  const reg = (tentativas.get(ip) || []).filter((t) => agora - t < 10 * 60 * 1000);
  if (reg.length >= 10) {
    return res.status(429).json({ erro: 'Muitas tentativas. Aguarde alguns minutos.' });
  }
  reg.push(agora);
  tentativas.set(ip, reg);
  next();
}

app.post('/api/login', limitarLogin, (req, res) => {
  const chave = String((req.body && req.body.chave) || '').trim();
  if (!chave) return res.status(400).json({ erro: 'Digite a chave de acesso.' });
  let papel = null;
  for (const [nome, valor] of Object.entries(CHAVES)) {
    if (valor && igual(chave, valor)) papel = nome;
  }
  if (!papel) return res.status(401).json({ erro: 'Chave inválida.' });
  const cookie = [
    `ft_sessao=${encodeURIComponent(criarToken(papel))}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${60 * 60 * 24 * 30}`,
    IS_PROD ? 'Secure' : '',
  ].filter(Boolean).join('; ');
  res.setHeader('Set-Cookie', cookie);
  res.json({ papel });
});

app.post('/api/logout', (_req, res) => {
  res.setHeader('Set-Cookie', 'ft_sessao=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => res.json({ papel: req.papel }));

// ---------- Mural ----------
app.get('/api/avisos', wrap(async (req, res) => {
  const membro = req.papel !== 'visitante';
  const { rows } = await pool.query(
    `SELECT id, titulo, texto, publico, criado_em FROM avisos
     ${membro ? '' : 'WHERE publico = TRUE'} ORDER BY criado_em DESC LIMIT 100`
  );
  res.json(rows);
}));

app.post('/api/avisos', exigir('coordenacao'), wrap(async (req, res) => {
  const { titulo, texto, publico } = req.body || {};
  if (!titulo || !String(titulo).trim()) return res.status(400).json({ erro: 'Informe o título.' });
  const { rows } = await pool.query(
    'INSERT INTO avisos (titulo, texto, publico) VALUES ($1,$2,$3) RETURNING *',
    [String(titulo).trim().slice(0, 150), String(texto || '').slice(0, 4000), publico === true]
  );
  res.status(201).json(rows[0]);
}));

app.delete('/api/avisos/:id', exigir('coordenacao'), wrap(async (req, res) => {
  await pool.query('DELETE FROM avisos WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ---------- Abba Musical (só membros) ----------
const membros = exigir('coordenacao', 'musical', 'producao');

app.get('/api/pastas', membros, wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT p.id, p.nome, p.descricao, COUNT(c.id)::int AS total
     FROM pastas p LEFT JOIN cifras c ON c.pasta_id = p.id
     GROUP BY p.id ORDER BY p.nome`
  );
  res.json(rows);
}));

app.post('/api/pastas', exigir('musical'), wrap(async (req, res) => {
  const { nome, descricao } = req.body || {};
  if (!nome || !String(nome).trim()) return res.status(400).json({ erro: 'Informe o nome da pasta.' });
  const { rows } = await pool.query(
    'INSERT INTO pastas (nome, descricao) VALUES ($1,$2) RETURNING *',
    [String(nome).trim().slice(0, 100), String(descricao || '').slice(0, 300)]
  );
  res.status(201).json(rows[0]);
}));

app.delete('/api/pastas/:id', exigir('musical', 'coordenacao'), wrap(async (req, res) => {
  await pool.query('DELETE FROM pastas WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

app.get('/api/pastas/:id/cifras', membros, wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, titulo, artista, tom FROM cifras WHERE pasta_id = $1 ORDER BY titulo',
    [req.params.id]
  );
  res.json(rows);
}));

app.post('/api/pastas/:id/cifras', exigir('musical'), wrap(async (req, res) => {
  const { titulo, artista, tom, texto } = req.body || {};
  if (!titulo || !String(titulo).trim()) return res.status(400).json({ erro: 'Informe o título.' });
  const { rows } = await pool.query(
    `INSERT INTO cifras (pasta_id, titulo, artista, tom, texto)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [req.params.id, String(titulo).trim().slice(0, 150), String(artista || '').slice(0, 100),
     String(tom || '').slice(0, 10), String(texto || '').slice(0, 30000)]
  );
  res.status(201).json(rows[0]);
}));

app.get('/api/cifras/:id', membros, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM cifras WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ erro: 'Cifra não encontrada.' });
  res.json(rows[0]);
}));

app.put('/api/cifras/:id', exigir('musical'), wrap(async (req, res) => {
  const { titulo, artista, tom, texto } = req.body || {};
  if (!titulo || !String(titulo).trim()) return res.status(400).json({ erro: 'Informe o título.' });
  await pool.query(
    `UPDATE cifras SET titulo=$1, artista=$2, tom=$3, texto=$4, atualizado_em=NOW() WHERE id=$5`,
    [String(titulo).trim().slice(0, 150), String(artista || '').slice(0, 100),
     String(tom || '').slice(0, 10), String(texto || '').slice(0, 30000), req.params.id]
  );
  res.json({ ok: true });
}));

app.delete('/api/cifras/:id', exigir('musical', 'coordenacao'), wrap(async (req, res) => {
  await pool.query('DELETE FROM cifras WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ---------- Galeria da Mídia ----------
app.get('/api/midias', wrap(async (req, res) => {
  const tipo = ['foto', 'reel', 'video'].includes(req.query.tipo) ? req.query.tipo : null;
  const { rows } = await pool.query(
    `SELECT m.id, m.tipo, m.titulo, m.mime, m.criado_em,
       (SELECT COUNT(*)::int FROM reacoes r WHERE r.midia_id = m.id) AS reacoes,
       (SELECT COUNT(*)::int FROM comentarios c WHERE c.midia_id = m.id) AS comentarios
     FROM midias m ${tipo ? 'WHERE m.tipo = $1' : ''} ORDER BY m.criado_em DESC LIMIT 200`,
    tipo ? [tipo] : []
  );
  res.json(rows);
}));

app.get('/api/midias/:id/arquivo', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT mime, dados FROM midias WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).end();
  const { mime, dados } = rows[0];
  const total = dados.length;
  res.setHeader('Content-Type', mime);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let inicio = m && m[1] ? parseInt(m[1], 10) : 0;
    let fim = m && m[2] ? parseInt(m[2], 10) : total - 1;
    if (Number.isNaN(inicio) || inicio >= total) return res.status(416).end();
    fim = Math.min(fim, total - 1);
    res.status(206);
    res.setHeader('Content-Range', `bytes ${inicio}-${fim}/${total}`);
    res.setHeader('Content-Length', fim - inicio + 1);
    return res.end(dados.subarray(inicio, fim + 1));
  }
  res.setHeader('Content-Length', total);
  res.end(dados);
}));

app.post('/api/midias', exigir('producao'), (req, res, next) => {
  upload.single('arquivo')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? `Arquivo maior que ${MAX_MB} MB.` : 'Falha no envio do arquivo.';
      return res.status(400).json({ erro: msg });
    }
    next();
  });
}, wrap(async (req, res) => {
  const { tipo, titulo } = req.body || {};
  const f = req.file;
  if (!f) return res.status(400).json({ erro: 'Escolha um arquivo.' });
  if (!['foto', 'reel', 'video'].includes(tipo)) return res.status(400).json({ erro: 'Tipo inválido.' });
  const ehFoto = tipo === 'foto';
  if (ehFoto && !f.mimetype.startsWith('image/')) return res.status(400).json({ erro: 'Envie uma imagem.' });
  if (!ehFoto && !f.mimetype.startsWith('video/')) return res.status(400).json({ erro: 'Envie um vídeo.' });
  const { rows } = await pool.query(
    'INSERT INTO midias (tipo, titulo, mime, dados) VALUES ($1,$2,$3,$4) RETURNING id',
    [tipo, String(titulo || '').slice(0, 150), f.mimetype, f.buffer]
  );
  res.status(201).json(rows[0]);
}));

app.delete('/api/midias/:id', exigir('producao', 'coordenacao'), wrap(async (req, res) => {
  await pool.query('DELETE FROM midias WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

app.get('/api/midias/:id/interacoes', wrap(async (req, res) => {
  const visitante = String(req.query.v || '');
  const reacoes = await pool.query(
    `SELECT emoji, COUNT(*)::int AS total, BOOL_OR(visitante = $2) AS minha
     FROM reacoes WHERE midia_id = $1 GROUP BY emoji`,
    [req.params.id, visitante]
  );
  const comentarios = await pool.query(
    'SELECT id, nome, texto, criado_em FROM comentarios WHERE midia_id = $1 ORDER BY criado_em',
    [req.params.id]
  );
  res.json({ reacoes: reacoes.rows, comentarios: comentarios.rows });
}));

app.post('/api/midias/:id/reacao', wrap(async (req, res) => {
  const { emoji, visitante } = req.body || {};
  if (!EMOJIS.includes(emoji) || !visitante) return res.status(400).json({ erro: 'Reação inválida.' });
  const v = String(visitante).slice(0, 64);
  const del = await pool.query(
    'DELETE FROM reacoes WHERE midia_id=$1 AND visitante=$2 AND emoji=$3',
    [req.params.id, v, emoji]
  );
  if (del.rowCount === 0) {
    await pool.query(
      'INSERT INTO reacoes (midia_id, visitante, emoji) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [req.params.id, v, emoji]
    );
  }
  res.json({ ok: true });
}));

app.post('/api/midias/:id/comentarios', wrap(async (req, res) => {
  const nome = String((req.body && req.body.nome) || '').trim().slice(0, 60);
  const texto = String((req.body && req.body.texto) || '').trim().slice(0, 500);
  if (!nome || !texto) return res.status(400).json({ erro: 'Informe seu nome e o comentário.' });
  await pool.query(
    'INSERT INTO comentarios (midia_id, nome, texto) VALUES ($1,$2,$3)',
    [req.params.id, nome, texto]
  );
  res.status(201).json({ ok: true });
}));

app.delete('/api/comentarios/:id', exigir('coordenacao', 'producao'), wrap(async (req, res) => {
  await pool.query('DELETE FROM comentarios WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

app.get('/saude', (_req, res) => res.send('ok'));

// ---------- Front-end ----------
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, arquivo) => {
    // O service worker precisa ser sempre revalidado para o site se atualizar no aparelho
    if (arquivo.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
    if (arquivo.endsWith('.webmanifest')) res.setHeader('Content-Type', 'application/manifest+json');
  },
}));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ erro: 'Erro interno do servidor.' });
});

init()
  .then(() => app.listen(PORT, () => console.log(`Fratelli Tutti no ar na porta ${PORT}`)))
  .catch((e) => {
    console.error('Falha ao iniciar o banco de dados:', e.message);
    process.exit(1);
  });
