(() => {
  const NOMES = {
    coordenacao: 'Coordenação',
    musical: 'Equipe musical',
    producao: 'Equipe de produção',
    visitante: 'Visitante',
  };
  const EMOJIS = ['❤️', '🙏', '🔥', '👏', '😊'];
  const $ = (s) => document.querySelector(s);
  const app = $('#app');
  const estado = { papel: 'visitante', aba: 'mural', secaoAbba: 'repertorio', tipoGaleria: 'foto', pasta: null, cifra: null };

  // ---------- utilitários ----------
  function h(tag, props, ...filhos) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    }
    for (const f of filhos.flat()) {
      if (f == null || f === false) continue;
      el.append(f.nodeType ? f : document.createTextNode(String(f)));
    }
    return el;
  }

  // ---------- modo offline: fila de alterações, aviso de rede, cópia local ----------
  const FILA = 'ft_fila';
  const lerFila = () => { try { return JSON.parse(localStorage.getItem(FILA) || '[]'); } catch (_) { return []; } };
  const salvarFila = (f) => { try { localStorage.setItem(FILA, JSON.stringify(f)); } catch (_) { /* ok */ } };
  const limparCacheApi = () => (window.caches ? caches.delete('ft-api-v1') : Promise.resolve());

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { t.hidden = true; }, 5000);
  }

  function atualizarRede() {
    const partes = [];
    if (!navigator.onLine) partes.push('Sem internet');
    const n = lerFila().length;
    if (n) partes.push(`${n} ${n === 1 ? 'alteração pendente' : 'alterações pendentes'}`);
    const el = $('#rede');
    el.textContent = partes.join(' · ');
    el.hidden = partes.length === 0;
  }

  let sincronizando = false;
  async function sincronizar() {
    if (sincronizando || !navigator.onLine || !lerFila().length) return;
    sincronizando = true;
    let enviou = false;
    try {
      for (;;) {
        const fila = lerFila();
        if (!fila.length) break;
        const it = fila[0];
        let r;
        try {
          r = await fetch(it.c, {
            method: it.m,
            credentials: 'same-origin',
            headers: it.j ? { 'Content-Type': 'application/json' } : undefined,
            body: it.j || undefined,
          });
        } catch (_) { break; }
        if (r.status === 401 || r.status === 403) break; // precisa entrar de novo; mantém na fila
        fila.shift();
        salvarFila(fila);
        enviou = true;
      }
    } finally {
      sincronizando = false;
      atualizarRede();
    }
    if (enviou) {
      await limparCacheApi();
      toast('Alterações pendentes enviadas.');
      renderizar();
      baixarParaOffline();
    }
  }

  // Guarda no aparelho o que dá para consultar sem internet (avisos, cifras, listas da galeria)
  let ultimoDownload = 0;
  async function baixarParaOffline() {
    if (!navigator.onLine || Date.now() - ultimoDownload < 60000) return;
    ultimoDownload = Date.now();
    try {
      await api('/api/avisos');
      for (const t of ['foto', 'reel', 'video']) await api('/api/midias?tipo=' + t);
      await api('/api/midias');
      if (!membro()) return;
      const pastas = await api('/api/pastas');
      for (const p of pastas) {
        const cifras = await api(`/api/pastas/${p.id}/cifras`);
        for (let i = 0; i < cifras.length; i += 6) {
          await Promise.all(cifras.slice(i, i + 6).map((c) => api('/api/cifras/' + c.id)));
        }
      }
    } catch (_) { /* sem problema: tenta de novo na próxima vez */ }
  }

  async function api(caminho, opcoes = {}) {
    const metodo = (opcoes.method || (opcoes.json ? 'POST' : 'GET')).toUpperCase();
    const init = { credentials: 'same-origin', ...opcoes, method: metodo };
    if (opcoes.json) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(opcoes.json);
      delete init.json;
    }
    let r;
    try {
      r = await fetch(caminho, init);
    } catch (_) {
      const upload = opcoes.body instanceof FormData;
      const podeFila = !upload && metodo !== 'GET' && !/^\/api\/(login|logout)/.test(caminho);
      if (podeFila) {
        const f = lerFila();
        f.push({ m: metodo, c: caminho, j: init.body || null });
        salvarFila(f);
        atualizarRede();
        toast('Sem conexão: a alteração foi salva no aparelho e será enviada quando a internet voltar.');
        return { pendente: true };
      }
      throw new Error(upload
        ? 'Sem conexão. O envio de fotos e vídeos precisa de internet.'
        : 'Sem conexão com o servidor.');
    }
    let corpo = {};
    try { corpo = await r.json(); } catch (_) { /* sem corpo */ }
    if (!r.ok) throw new Error(corpo.erro || 'Algo deu errado.');
    return corpo;
  }

  const data = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const membro = () => estado.papel !== 'visitante';
  const is = (...p) => p.includes(estado.papel);

  function idVisitante() {
    try {
      let v = localStorage.getItem('ft_visitante');
      if (!v) {
        v = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
        localStorage.setItem('ft_visitante', v);
      }
      return v;
    } catch (_) { return 'anonimo'; }
  }

  function erroEm(el, e) { el.textContent = e.message; }

  // ---------- tema ----------
  function aplicarTema(t) {
    if (t === 'claro' || t === 'escuro') document.documentElement.dataset.tema = t;
    else delete document.documentElement.dataset.tema;
  }
  let temaSalvo = 'sistema';
  try { temaSalvo = localStorage.getItem('ft_tema') || 'sistema'; } catch (_) { /* ok */ }
  $('#tema').value = temaSalvo;
  aplicarTema(temaSalvo);
  $('#tema').addEventListener('change', (e) => {
    aplicarTema(e.target.value);
    try { localStorage.setItem('ft_tema', e.target.value); } catch (_) { /* ok */ }
  });

  // ---------- login ----------
  const dlg = $('#dlgLogin');
  $('#btnEntrar').addEventListener('click', async () => {
    if (membro()) {
      if (lerFila().length && !confirm('Há alterações ainda não enviadas. Sair mesmo assim?')) return;
      try { await api('/api/logout', { method: 'POST' }); }
      catch (_) { toast('Conecte-se à internet para sair.'); return; }
      await limparCacheApi();
      estado.papel = 'visitante';
      atualizarTopo();
      renderizar();
    } else {
      $('#erroLogin').textContent = '';
      $('#chave').value = '';
      dlg.showModal();
      $('#chave').focus();
    }
  });
  $('#cancelarLogin').addEventListener('click', () => dlg.close());
  $('#formLogin').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/login', { json: { chave: $('#chave').value } });
      estado.papel = r.papel;
      await limparCacheApi();
      dlg.close();
      atualizarTopo();
      renderizar();
      sincronizar();
      ultimoDownload = 0;
      baixarParaOffline();
    } catch (err) { erroEm($('#erroLogin'), err); }
  });

  function atualizarTopo() {
    $('#quem').textContent = membro() ? NOMES[estado.papel] : '';
    $('#btnEntrar').textContent = membro() ? 'Sair' : 'Entrar';
    $('#btnEntrar').classList.toggle('primario', !membro());
    document.querySelectorAll('#menu button').forEach((b) =>
      b.classList.toggle('ativo', b.dataset.aba === estado.aba));
  }

  document.querySelectorAll('#menu button').forEach((b) =>
    b.addEventListener('click', () => { location.hash = b.dataset.aba; }));

  // ---------- Mural ----------
  async function viewMural() {
    const raiz = h('div', {}, h('h1', {}, 'Mural do Fratelli'));
    if (is('coordenacao')) {
      const erro = h('p', { class: 'erro' });
      const form = h('form', {},
        h('h2', {}, 'Novo aviso'),
        h('input', { name: 'titulo', placeholder: 'Título', required: true, maxlength: 150 }),
        h('textarea', { name: 'texto', placeholder: 'Texto do aviso' }),
        h('div', { class: 'linha' },
          h('button', { type: 'submit', class: 'primario', 'data-publico': 'true' }, 'Publicar para todos (público)'),
          h('button', { type: 'submit', 'data-publico': 'false' }, 'Publicar só para o ministério')),
        erro);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await api('/api/avisos', { json: {
            titulo: form.titulo.value, texto: form.texto.value,
            publico: e.submitter.dataset.publico === 'true',
          } });
          renderizar();
        } catch (err) { erroEm(erro, err); }
      });
      raiz.append(h('div', { class: 'card' }, form));
    }
    if (!membro()) {
      raiz.append(h('p', { class: 'mudo' }, 'Avisos públicos da agenda do ministério.'));
    }
    const avisos = await api('/api/avisos');
    if (!avisos.length) raiz.append(h('p', { class: 'mudo' }, 'Nenhum aviso por enquanto.'));
    for (const a of avisos) {
      raiz.append(h('div', { class: 'card' },
        h('div', { class: 'linha' },
          h('h2', { style: 'margin:0;flex:1' }, a.titulo),
          membro() && h('span', { class: 'etiqueta' + (a.publico ? ' pub' : '') },
            a.publico ? 'Público' : 'Só ministério')),
        h('p', { style: 'white-space:pre-wrap;margin:8px 0' }, a.texto),
        h('div', { class: 'linha' },
          h('span', { class: 'mudo' }, data(a.criado_em)),
          is('coordenacao') && h('button', { class: 'perigo', onclick: async () => {
            if (confirm('Apagar este aviso?')) { await api('/api/avisos/' + a.id, { method: 'DELETE' }); renderizar(); }
          } }, 'Apagar'))));
    }
    return raiz;
  }

  // ---------- Abba Musical ----------
  async function viewAbba() {
    if (!membro()) {
      return h('div', {}, h('h1', {}, 'Abba Musical'),
        h('div', { class: 'card' }, 'Esta área é só para a coordenação, a equipe musical e a produção. Entre com a chave da sua equipe.'));
    }
    if (estado.cifra) return viewCifra(estado.cifra);
    if (estado.pasta) return viewPasta(estado.pasta);

    // Duas seções dentro do Abba Musical: Repertório e Afinador
    const abas = h('div', { class: 'abas' }, [['repertorio', 'Repertório', 'abba'], ['afinador', 'Afinador', 'abba/afinador']].map(([s, nome, hash]) =>
      h('button', { class: estado.secaoAbba === s ? 'ativo' : '', onclick: () => { location.hash = hash; } }, nome)));
    if (estado.secaoAbba === 'afinador') {
      return h('div', {}, h('h1', {}, 'Abba Musical'), abas,
        window.Afinador ? window.Afinador.montar()
          : h('div', { class: 'card' }, 'Feche e abra o site de novo para ativar o afinador.'));
    }

    const raiz = h('div', {}, h('h1', {}, 'Abba Musical'), abas, h('p', { class: 'mudo' }, 'Pastas de repertório.'));
    if (is('musical')) {
      const erro = h('p', { class: 'erro' });
      const form = h('form', {},
        h('h2', {}, 'Nova pasta'),
        h('input', { name: 'nome', placeholder: 'Nome (ex.: Missa de domingo)', required: true, maxlength: 100 }),
        h('input', { name: 'descricao', placeholder: 'Descrição (opcional)', maxlength: 300 }),
        h('button', { type: 'submit', class: 'primario' }, 'Criar pasta'), erro);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await api('/api/pastas', { json: { nome: form.nome.value, descricao: form.descricao.value } }); renderizar(); }
        catch (err) { erroEm(erro, err); }
      });
      raiz.append(h('div', { class: 'card' }, form));
    }
    const pastas = await api('/api/pastas');
    if (!pastas.length) raiz.append(h('p', { class: 'mudo' }, 'Nenhuma pasta criada ainda.'));
    for (const p of pastas) {
      raiz.append(h('div', { class: 'card lista-item', onclick: () => { estado.pasta = p; renderizar(); } },
        h('h2', { style: 'margin:0' }, p.nome),
        p.descricao && h('div', { class: 'mudo' }, p.descricao),
        h('div', { class: 'mudo' }, `${p.total} ${p.total === 1 ? 'cifra' : 'cifras'}`)));
    }
    return raiz;
  }

  async function viewPasta(pasta) {
    const raiz = h('div', {},
      h('button', { class: 'link', onclick: () => { estado.pasta = null; renderizar(); } }, '← Pastas'),
      h('h1', { style: 'margin-top:8px' }, pasta.nome));
    if (is('musical')) {
      raiz.append(formCifra(pasta.id, null));
    }
    if (is('musical', 'coordenacao')) {
      raiz.append(h('div', { class: 'linha', style: 'margin-bottom:12px' },
        h('button', { class: 'perigo', onclick: async () => {
          if (confirm('Apagar esta pasta e todas as cifras dela?')) {
            await api('/api/pastas/' + pasta.id, { method: 'DELETE' });
            estado.pasta = null; renderizar();
          }
        } }, 'Apagar pasta')));
    }
    const cifras = await api(`/api/pastas/${pasta.id}/cifras`);
    if (!cifras.length) raiz.append(h('p', { class: 'mudo' }, 'Nenhuma cifra nesta pasta.'));
    for (const c of cifras) {
      raiz.append(h('div', { class: 'card lista-item', onclick: () => { estado.cifra = c.id; renderizar(); } },
        h('h2', { style: 'margin:0' }, c.titulo),
        h('div', { class: 'mudo' }, [c.artista, c.tom && `Tom: ${c.tom}`].filter(Boolean).join(' · '))));
    }
    return raiz;
  }

  function formCifra(pastaId, existente) {
    const erro = h('p', { class: 'erro' });
    const form = h('form', {},
      h('h2', {}, existente ? 'Editar cifra' : 'Nova cifra'),
      h('input', { name: 'titulo', placeholder: 'Título', required: true, maxlength: 150, value: existente ? existente.titulo : '' }),
      h('div', { class: 'linha' },
        h('input', { name: 'artista', placeholder: 'Artista / compositor', style: 'flex:2', value: existente ? existente.artista : '' }),
        h('input', { name: 'tom', placeholder: 'Tom', style: 'flex:1', maxlength: 10, value: existente ? existente.tom : '' })),
      h('textarea', { name: 'texto', placeholder: 'Cole aqui a letra com os acordes', style: 'min-height:220px;font-family:ui-monospace,Menlo,Consolas,monospace' }, existente ? existente.texto : ''),
      h('div', { class: 'linha' },
        h('button', { type: 'submit', class: 'primario' }, 'Salvar'),
        existente && h('button', { type: 'button', onclick: () => renderizar() }, 'Cancelar')),
      erro);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const corpo = { titulo: form.titulo.value, artista: form.artista.value, tom: form.tom.value, texto: form.texto.value };
      try {
        if (existente) await api('/api/cifras/' + existente.id, { method: 'PUT', json: corpo });
        else await api(`/api/pastas/${pastaId}/cifras`, { json: corpo });
        renderizar();
      } catch (err) { erroEm(erro, err); }
    });
    return h('div', { class: 'card' }, form);
  }

  // ---------- Transposição de cifras ----------
  const NOTAS_S = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const NOTAS_B = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const BASE_NOTA = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const TONS_BEMOL = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm']);
  const RE_ACORDE = /^[A-G][#b]?(?:m(?!aj)|min|maj|M|dim|aug|sus|add|°|º|ø|\+|-|\d+|[#b]\d+|\([^)]*\))*(?:\/[A-G][#b]?)?$/;
  const RE_NEUTRO = /^(\|+|\/|-+|%|\(?x\d+\)?|\(?\d+x\)?|N\.?C\.?)$/i;

  function indiceNota(r) {
    let i = BASE_NOTA[r[0]];
    if (r[1] === '#') i += 1;
    else if (r[1] === 'b') i -= 1;
    return ((i % 12) + 12) % 12;
  }

  function transporAcorde(tok, n, bemois) {
    const m = /^([A-G][#b]?)(.*?)(?:\/([A-G][#b]?))?$/.exec(tok);
    if (!m) return tok;
    const tab = bemois ? NOTAS_B : NOTAS_S;
    const nome = (r) => tab[(indiceNota(r) + n + 120) % 12];
    return nome(m[1]) + m[2] + (m[3] ? '/' + nome(m[3]) : '');
  }

  // A cifra já usa bemóis? Só olha acordes de verdade (linhas de acordes e [colchetes]),
  // para não confundir palavras da letra como "Abençoa" com o acorde Ab.
  function temBemol(texto) {
    const bemol = (p) => RE_ACORDE.test(p) && /(^|\/)[A-G]b/.test(p);
    return String(texto || '').split('\n').some((l) => (ehLinhaDeAcordes(l)
      ? l.trim().split(/\s+/).some(bemol)
      : [...l.matchAll(/\[([^\]\s]+)\]/g)].some((m) => bemol(m[1]))));
  }

  // Decide se o tom de destino se escreve com bemóis (Bb, Eb...) ou sustenidos (F#, C#...)
  function usaBemois(tom, n, texto) {
    const t = (tom || '').trim();
    const m = /^([A-G][#b]?)(m(?!aj))?/.exec(t);
    if (m && RE_ACORDE.test(t)) {
      const raiz = NOTAS_B[(indiceNota(m[1]) + n + 120) % 12];
      // Gb e F# valem o mesmo: fica F#, a menos que a cifra já use bemóis
      if (raiz === 'Gb' && !m[2]) return /^[A-G]b/.test(t) || temBemol(texto);
      return TONS_BEMOL.has(raiz + (m[2] ? 'm' : ''));
    }
    return temBemol(texto);
  }

  function ehLinhaDeAcordes(linha) {
    const toks = linha.trim().split(/\s+/).filter(Boolean);
    if (!toks.length) return false;
    let acordes = 0;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (RE_ACORDE.test(t)) acordes++;
      else if (RE_NEUTRO.test(t) || (i === 0 && /^\S+:$/.test(t))) continue;
      else return false;
    }
    return acordes > 0;
  }

  // Troca os acordes mantendo o alinhamento com a letra
  function transporLinhaAcordes(linha, n, bemois) {
    let divida = 0;
    return linha.split(/(\s+)/).map((p) => {
      if (!p) return p;
      if (/^\s+$/.test(p)) {
        if (divida > 0) {
          const tira = Math.min(divida, Math.max(p.length - 1, 0));
          divida -= tira;
          return p.slice(tira);
        }
        if (divida < 0) {
          const r = p + ' '.repeat(-divida);
          divida = 0;
          return r;
        }
        return p;
      }
      if (RE_ACORDE.test(p)) {
        const novo = transporAcorde(p, n, bemois);
        divida += novo.length - p.length;
        return novo;
      }
      return p;
    }).join('');
  }

  function transporTexto(texto, n, bemois) {
    if (!n) return texto;
    return texto.split('\n').map((l) => (ehLinhaDeAcordes(l)
      ? transporLinhaAcordes(l, n, bemois)
      : l.replace(/\[([^\]\s]+)\]/g, (m, c) => (RE_ACORDE.test(c) ? `[${transporAcorde(c, n, bemois)}]` : m)))
    ).join('\n');
  }

  async function viewCifra(id) {
    const c = await api('/api/cifras/' + id);
    const voltar = h('button', { class: 'link', onclick: () => { estado.cifra = null; renderizar(); } }, '← ' + (estado.pasta ? estado.pasta.nome : 'Pastas'));
    if (estado.editando) return h('div', {}, voltar, formCifra(c.pasta_id, c));

    if (estado.transpId !== id) { estado.transpId = id; estado.transp = 0; }
    const tomOrig = (c.tom || '').trim();
    const tomOk = RE_ACORDE.test(tomOrig);
    const pre = h('pre', { class: 'cifra' });
    const tomAtual = h('strong', { class: 'tom-atual' });
    const btnOriginal = h('button', { onclick: () => ir(0) }, 'Original');
    const btnSalvar = h('button', { class: 'primario', onclick: async () => {
      if (!confirm('Salvar a cifra neste tom para todos os músicos?')) return;
      const n = estado.transp;
      const bem = usaBemois(tomOrig, n, c.texto);
      await api('/api/cifras/' + c.id, { method: 'PUT', json: {
        titulo: c.titulo, artista: c.artista,
        tom: tomOk ? transporAcorde(tomOrig, n, bem) : c.tom,
        texto: transporTexto(c.texto, n, bem),
      } });
      estado.transp = 0;
      renderizar();
    } }, 'Salvar neste tom');
    const seletor = tomOk ? h('select', { 'aria-label': 'Escolher o tom', onchange: (e) => ir(Number(e.target.value)) },
      Array.from({ length: 12 }, (_, i) => h('option', { value: i },
        transporAcorde(tomOrig, i, usaBemois(tomOrig, i, c.texto)) + (i === 0 ? ' (original)' : '')))) : null;

    function pintar() {
      const n = estado.transp;
      const bem = usaBemois(tomOrig, n, c.texto);
      const texto = transporTexto(c.texto, n, bem);
      // Linhas só de acordes ficam coloridas; acordes entre [colchetes] no meio da letra também
      pre.replaceChildren(...texto.split('\n').map((l) => {
        if (ehLinhaDeAcordes(l)) return h('span', { class: 'acorde' }, l + '\n');
        const partes = l.split(/(\[[^\]\s]+\])/).map((p) =>
          (/^\[.+\]$/.test(p) && RE_ACORDE.test(p.slice(1, -1)) ? h('span', { class: 'acorde' }, p) : p));
        return h('span', {}, ...partes, '\n');
      }));
      tomAtual.textContent = tomOk ? transporAcorde(tomOrig, n, bem) : (n ? `${n > 6 ? n - 12 : '+' + n} meio-tom` : 'original');
      if (seletor) seletor.value = String(n);
      btnOriginal.hidden = n === 0;
      btnSalvar.hidden = n === 0 || !is('musical');
    }
    function ir(v) { estado.transp = ((v % 12) + 12) % 12; pintar(); }

    const barra = h('div', { class: 'tom' },
      h('span', { class: 'mudo' }, 'Tom'),
      h('button', { 'aria-label': 'Descer meio tom', onclick: () => ir(estado.transp - 1) }, '−'),
      tomAtual,
      h('button', { 'aria-label': 'Subir meio tom', onclick: () => ir(estado.transp + 1) }, '+'),
      seletor, btnOriginal, btnSalvar);
    pintar();

    return h('div', {}, voltar,
      h('h1', { style: 'margin-top:8px' }, c.titulo),
      h('p', { class: 'mudo' }, [c.artista, tomOrig && `Tom original: ${tomOrig}`].filter(Boolean).join(' · ')),
      barra,
      pre,
      h('div', { class: 'linha' },
        is('musical') && h('button', { onclick: () => { estado.editando = true; renderizar(); } }, 'Editar'),
        is('musical', 'coordenacao') && h('button', { class: 'perigo', onclick: async () => {
          if (confirm('Apagar esta cifra?')) {
            await api('/api/cifras/' + c.id, { method: 'DELETE' });
            estado.cifra = null; renderizar();
          }
        } }, 'Apagar')));
  }

  // ---------- Galeria ----------
  const TIPOS = [['foto', 'Fotos'], ['reel', 'Reels'], ['video', 'Vídeos']];

  async function viewGaleria() {
    const raiz = h('div', {}, h('h1', {}, 'Galeria da Mídia'));
    const abas = h('div', { class: 'abas' }, TIPOS.map(([t, nome]) =>
      h('button', { class: estado.tipoGaleria === t ? 'ativo' : '', onclick: () => { estado.tipoGaleria = t; renderizar(); } }, nome)));
    raiz.append(abas);

    if (is('producao')) {
      const erro = h('p', { class: 'erro' });
      const form = h('form', {},
        h('h2', {}, 'Adicionar à galeria'),
        h('select', { name: 'tipo' }, TIPOS.map(([t, n]) => h('option', { value: t, selected: t === estado.tipoGaleria }, n.replace(/s$/, '')))),
        h('input', { name: 'titulo', placeholder: 'Legenda (opcional)', maxlength: 150 }),
        h('input', { name: 'arquivo', type: 'file', accept: 'image/*,video/*', required: true }),
        h('button', { type: 'submit', class: 'primario' }, 'Enviar'), erro);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        erro.textContent = 'Enviando…';
        try {
          await api('/api/midias', { method: 'POST', body: new FormData(form) });
          renderizar();
        } catch (err) { erroEm(erro, err); }
      });
      raiz.append(h('div', { class: 'card' }, form));
    }

    const itens = await api('/api/midias?tipo=' + estado.tipoGaleria);
    if (!itens.length) raiz.append(h('p', { class: 'mudo' }, 'Nada por aqui ainda.'));
    const grade = h('div', { class: 'grade ' + (estado.tipoGaleria === 'reel' ? 'reels' : estado.tipoGaleria === 'video' ? 'videos' : '') });
    for (const m of itens) {
      const src = `/api/midias/${m.id}/arquivo`;
      const midia = m.tipo === 'foto'
        ? h('img', { src, alt: m.titulo || 'Foto', loading: 'lazy' })
        : h('video', { src: src + '#t=0.1', preload: 'metadata', muted: true, playsinline: true });
      grade.append(h('div', { class: 'miniatura', onclick: () => abrirMidia(m) },
        midia,
        h('div', { class: 'info' }, `${m.reacoes} ❤ · ${m.comentarios} 💬${m.titulo ? ' · ' + m.titulo : ''}`)));
    }
    raiz.append(grade);
    return raiz;
  }

  const dlgMidia = $('#dlgMidia');
  dlgMidia.addEventListener('close', () => {
    dlgMidia.innerHTML = '';
    if (location.hash.startsWith('#midia=')) history.replaceState(null, '', '#galeria');
  });
  dlgMidia.addEventListener('click', (e) => { if (e.target === dlgMidia) dlgMidia.close(); });

  async function abrirMidia(m) {
    const src = `/api/midias/${m.id}/arquivo`;
    const v = idVisitante();
    async function montar() {
      const inter = await api(`/api/midias/${m.id}/interacoes?v=${encodeURIComponent(v)}`);
      const mapa = Object.fromEntries(inter.reacoes.map((r) => [r.emoji, r]));
      let salvo = false;
      if (m.tipo !== 'foto' && window.caches) {
        try { salvo = !!(await (await caches.open('ft-media-v1')).match(src)); } catch (_) { /* ok */ }
      }
      const erro = h('p', { class: 'erro' });
      const form = h('form', { class: 'linha', style: 'margin-top:10px' },
        h('input', { name: 'nome', placeholder: 'Seu nome', style: 'flex:1;min-width:120px', maxlength: 60, required: true, value: lerNome() }),
        h('input', { name: 'texto', placeholder: 'Escreva um comentário', style: 'flex:3;min-width:180px', maxlength: 500, required: true }),
        h('button', { type: 'submit', class: 'primario' }, 'Comentar'));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          salvarNome(form.nome.value);
          await api(`/api/midias/${m.id}/comentarios`, { json: { nome: form.nome.value, texto: form.texto.value } });
          montar();
        } catch (err) { erroEm(erro, err); }
      });
      dlgMidia.replaceChildren(
        h('div', { class: 'linha', style: 'margin-bottom:10px' },
          h('strong', { style: 'flex:1' }, m.titulo || (m.tipo === 'foto' ? 'Foto' : 'Vídeo')),
          h('button', { onclick: () => dlgMidia.close() }, 'Fechar')),
        m.tipo === 'foto' ? h('img', { src, alt: m.titulo || 'Foto' }) : h('video', { src, controls: true, playsinline: true, autoplay: true }),
        h('div', { class: 'reacoes' }, EMOJIS.map((em) => {
          const r = mapa[em];
          return h('button', { class: r && r.minha ? 'minha' : '', onclick: async () => {
            await api(`/api/midias/${m.id}/reacao`, { json: { emoji: em, visitante: v } });
            montar();
          } }, `${em} ${r ? r.total : ''}`.trim());
        }),
        h('button', { onclick: () => compartilhar(m) }, '↗ Compartilhar'),
        m.tipo !== 'foto' && window.caches && h('button', { disabled: salvo, onclick: async (e) => {
          e.target.textContent = 'Baixando…';
          try { await (await fetch(src)).blob(); } catch (_) { toast('Não foi possível baixar o vídeo.'); }
          montar();
        } }, salvo ? '✓ Disponível offline' : '⬇ Salvar para ver offline')),
        is('producao', 'coordenacao') && h('button', { class: 'perigo', onclick: async () => {
          if (confirm('Apagar esta mídia?')) {
            await api('/api/midias/' + m.id, { method: 'DELETE' });
            if (window.caches) { try { (await caches.open('ft-media-v1')).delete(src); } catch (_) { /* ok */ } }
            dlgMidia.close(); renderizar();
          }
        } }, 'Apagar mídia'),
        h('h2', { style: 'margin-top:14px' }, `Comentários (${inter.comentarios.length})`),
        inter.comentarios.map((c) => h('div', { class: 'comentario' },
          h('div', { class: 'linha' },
            h('b', { style: 'flex:1' }, c.nome),
            h('span', { class: 'mudo' }, data(c.criado_em)),
            is('coordenacao', 'producao') && h('button', { class: 'perigo', onclick: async () => {
              await api('/api/comentarios/' + c.id, { method: 'DELETE' }); montar();
            } }, 'Apagar')),
          h('div', { style: 'white-space:pre-wrap' }, c.texto))),
        form, erro);
    }
    await montar();
    if (!dlgMidia.open) dlgMidia.showModal();
  }

  function lerNome() { try { return localStorage.getItem('ft_nome') || ''; } catch (_) { return ''; } }
  function salvarNome(n) { try { localStorage.setItem('ft_nome', n); } catch (_) { /* ok */ } }

  async function compartilhar(m) {
    const url = `${location.origin}/#midia=${m.id}`;
    try {
      if (navigator.share) await navigator.share({ title: m.titulo || 'Fratelli Tutti', url });
      else { await navigator.clipboard.writeText(url); alert('Link copiado!'); }
    } catch (_) { /* cancelado */ }
  }

  // ---------- roteamento ----------
  async function renderizar() {
    if (window.Afinador) window.Afinador.parar(); // desliga o microfone ao sair da tela do afinador
    atualizarTopo();
    if (estado.aba !== 'abba') { estado.pasta = null; estado.cifra = null; }
    if (!estado.cifra) estado.editando = false;
    app.replaceChildren(h('p', { class: 'mudo' }, 'Carregando…'));
    try {
      const view = estado.aba === 'abba' ? await viewAbba()
        : estado.aba === 'galeria' ? await viewGaleria() : await viewMural();
      app.replaceChildren(view);
    } catch (e) {
      app.replaceChildren(h('div', { class: 'card' }, h('p', { class: 'erro' }, e.message)));
    }
  }

  async function rota() {
    const hash = location.hash.replace('#', '');
    if (hash.startsWith('midia=')) {
      estado.aba = 'galeria';
      const id = Number(hash.split('=')[1]);
      const todas = await api('/api/midias');
      const m = todas.find((x) => x.id === id);
      if (m) estado.tipoGaleria = m.tipo;
      await renderizar();
      if (m) abrirMidia(m);
      return;
    }
    const [base, sub] = hash.split('/');
    estado.aba = ['mural', 'abba', 'galeria'].includes(base) ? base : 'mural';
    estado.secaoAbba = estado.aba === 'abba' && sub === 'afinador' ? 'afinador' : 'repertorio';
    estado.pasta = null; estado.cifra = null;
    renderizar();
  }

  window.addEventListener('hashchange', rota);

  window.addEventListener('online', () => { atualizarRede(); sincronizar(); baixarParaOffline(); });
  window.addEventListener('offline', atualizarRede);
  setInterval(sincronizar, 60000);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* sem modo offline neste navegador */ });
    });
  }

  (async () => {
    try { estado.papel = (await api('/api/me')).papel; } catch (_) { /* visitante */ }
    atualizarTopo();
    atualizarRede();
    rota();
    sincronizar();
    baixarParaOffline();
  })();
})();
