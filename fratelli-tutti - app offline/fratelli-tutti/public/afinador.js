// Afinador de violão, guitarra e baixo: usa o microfone, descobre a nota tocada e mostra
// quantos "cents" (centésimos de meio-tom) ela está do certo. Tudo roda no aparelho, sem internet.
(() => {
  // ---------- notas ----------
  const NOMES_S = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const NOMES_B = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
  const PT_S = ['Dó', 'Dó♯', 'Ré', 'Ré♯', 'Mi', 'Fá', 'Fá♯', 'Sol', 'Sol♯', 'Lá', 'Lá♯', 'Si'];
  const PT_B = ['Dó', 'Ré♭', 'Ré', 'Mi♭', 'Mi', 'Fá', 'Sol♭', 'Sol', 'Lá♭', 'Lá', 'Si♭', 'Si'];

  const freqDe = (midi, a4) => a4 * Math.pow(2, (midi - 69) / 12);
  const nota = (midi, bemol) => (bemol ? NOMES_B : NOMES_S)[midi % 12];
  const notaPt = (midi, bemol) => (bemol ? PT_B : PT_S)[midi % 12];
  const oitava = (midi) => Math.floor(midi / 12) - 1;

  // Cordas em números MIDI (E2 = 40, A2 = 45, ... E1 = 28 ...), da mais grave para a mais aguda
  const AFINACOES_VIOLAO = [
    { id: 'padrao', nome: 'Padrão (E A D G B E)', cordas: [40, 45, 50, 55, 59, 64] },
    { id: 'dropd', nome: 'Drop D (D A D G B E)', cordas: [38, 45, 50, 55, 59, 64] },
    { id: 'meio', nome: 'Meio tom abaixo (E♭)', cordas: [39, 44, 49, 54, 58, 63], bemol: true },
    { id: 'tom', nome: 'Um tom abaixo (D)', cordas: [38, 43, 48, 53, 57, 62] },
  ];
  const INSTRUMENTOS = {
    violao: { nome: 'Violão', afinacoes: AFINACOES_VIOLAO },
    guitarra: { nome: 'Guitarra', afinacoes: AFINACOES_VIOLAO },
    baixo: {
      nome: 'Baixo',
      afinacoes: [
        { id: '4', nome: '4 cordas (E A D G)', cordas: [28, 33, 38, 43] },
        { id: '5', nome: '5 cordas (B E A D G)', cordas: [23, 28, 33, 38, 43] },
        { id: 'dropd', nome: 'Drop D (D A D G)', cordas: [26, 33, 38, 43] },
        { id: 'meio', nome: 'Meio tom abaixo (E♭)', cordas: [27, 32, 37, 42], bemol: true },
      ],
    },
  };

  // ---------- detecção do tom (algoritmo YIN) ----------
  const LIMIAR_YIN = 0.2;
  const VOLUME_MINIMO = 0.006;

  // Reduz a taxa de amostragem tirando a média de blocos: deixa a conta bem mais leve
  function decimar(buf, fator) {
    if (fator <= 1) return buf;
    const n = Math.floor(buf.length / fator);
    const saida = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < fator; j++) s += buf[i * fator + j];
      saida[i] = s / fator;
    }
    return saida;
  }

  function volume(buf) {
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }

  // Devolve { freq, confianca } ou null quando não há uma nota clara
  function yin(buf, fs, fmin, fmax) {
    const n = buf.length;
    const tauMin = Math.max(2, Math.floor(fs / fmax));
    const tauMax = Math.min(Math.floor(fs / fmin), Math.floor(n * 0.6));
    if (tauMax <= tauMin + 2 || n - tauMax < tauMax) return null;
    const W = n - tauMax;
    const cmnd = new Float32Array(tauMax + 1);
    cmnd[0] = 1;
    let acumulado = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      let soma = 0;
      for (let i = 0; i < W; i++) {
        const x = buf[i] - buf[i + tau];
        soma += x * x;
      }
      acumulado += soma;
      cmnd[tau] = acumulado === 0 ? 1 : (soma * tau) / acumulado;
    }
    let tau = -1;
    for (let t = tauMin; t < tauMax; t++) {
      if (cmnd[t] < LIMIAR_YIN) {
        while (t + 1 < tauMax && cmnd[t + 1] < cmnd[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) {
      let m = tauMin;
      for (let t = tauMin; t < tauMax; t++) if (cmnd[t] < cmnd[m]) m = t;
      if (cmnd[m] > 0.35) return null;
      tau = m;
    }
    let melhor = tau;
    if (tau > 1 && tau < tauMax) {
      const a = cmnd[tau - 1], b = cmnd[tau], c = cmnd[tau + 1];
      const den = a - 2 * b + c;
      if (den !== 0) melhor = tau + (a - c) / (2 * den);
    }
    return { freq: fs / melhor, confianca: 1 - cmnd[tau] };
  }

  // Analisa um bloco de áudio cru. `alvo` (opcional) é a frequência da corda escolhida à mão.
  function detectar(bruto, fsBruta, afinacao, a4, alvo) {
    if (volume(bruto) < VOLUME_MINIMO) return null;
    const freqs = afinacao.cordas.map((m) => freqDe(m, a4));
    const fmin = (alvo ? alvo : Math.min(...freqs)) * (alvo ? 0.7 : 0.75);
    const fmax = (alvo ? alvo : Math.max(...freqs)) * (alvo ? 1.4 : 1.35);
    const fator = Math.max(1, Math.min(4, Math.floor(fsBruta / (fmax * 40))));
    const buf = decimar(bruto, fator);
    let media = 0;
    for (let i = 0; i < buf.length; i++) media += buf[i];
    media /= buf.length;
    const limpo = new Float32Array(buf.length);
    for (let i = 0; i < buf.length; i++) limpo[i] = buf[i] - media;
    return yin(limpo, fsBruta / fator, fmin, fmax);
  }

  // Dada a frequência ouvida, acha a corda mais próxima e o desvio em cents
  function avaliar(freq, afinacao, a4, indiceManual) {
    const freqs = afinacao.cordas.map((m) => freqDe(m, a4));
    let i = indiceManual;
    if (i == null || i < 0) {
      i = 0;
      let menor = Infinity;
      freqs.forEach((f, k) => {
        const d = Math.abs(Math.log2(freq / f));
        if (d < menor) { menor = d; i = k; }
      });
    }
    return { corda: i, cents: 1200 * Math.log2(freq / freqs[i]) };
  }

  const mediana = (v) => {
    const o = [...v].sort((a, b) => a - b);
    return o[Math.floor(o.length / 2)];
  };

  // ---------- tela ----------
  function el(tag, props, ...filhos) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    }
    for (const f of filhos.flat()) {
      if (f == null || f === false) continue;
      e.append(f.nodeType ? f : document.createTextNode(String(f)));
    }
    return e;
  }

  const CHAVE = 'ft_afinador';
  function lerPrefs() {
    const padrao = { inst: 'violao', afin: 'padrao', a4: 440 };
    try { return { ...padrao, ...JSON.parse(localStorage.getItem(CHAVE) || '{}') }; } catch (_) { return padrao; }
  }
  function salvarPrefs(p) { try { localStorage.setItem(CHAVE, JSON.stringify(p)); } catch (_) { /* ok */ } }

  let ativo = null; // só um afinador ligado por vez
  function parar() { if (ativo) { ativo.desligar(); ativo = null; } }

  function montar() {
    parar();
    const prefs = lerPrefs();
    if (!INSTRUMENTOS[prefs.inst]) prefs.inst = 'violao';
    prefs.a4 = Math.min(450, Math.max(430, Number(prefs.a4) || 440));

    const est = { manual: null, ligado: false, ultimos: [], ultimoSinal: 0, resultado: null };
    let stream = null, ctx = null, analyser = null, buf = null, timer = null, ctxTom = null;

    const instrumento = () => INSTRUMENTOS[prefs.inst];
    const afinacao = () => instrumento().afinacoes.find((a) => a.id === prefs.afin) || instrumento().afinacoes[0];

    // --- elementos fixos ---
    const nomeEl = el('div', { class: 'afin-nota' }, '—');
    const ptEl = el('div', { class: 'afin-pt' }, ' ');
    const hzEl = el('div', { class: 'afin-hz' }, ' ');
    const ponteiro = el('div', { class: 'medidor-ponteiro', style: 'left:50%' });
    const dicaEl = el('div', { class: 'afin-dica', 'aria-live': 'polite' }, 'Toque uma corda solta');
    const centsEl = el('div', { class: 'afin-cents' }, ' ');
    const medidor = el('div', { class: 'medidor', role: 'img', 'aria-label': 'Medidor de afinação' },
      el('div', { class: 'medidor-centro' }), ponteiro);
    const escala = el('div', { class: 'medidor-escala' }, el('span', {}, '♭ −50'), el('span', {}, '0'), el('span', {}, '+50 ♯'));
    const painel = el('div', { class: 'afin-painel sem-sinal' }, nomeEl, ptEl, medidor, escala, centsEl, dicaEl, hzEl);
    const cordasEl = el('div', { class: 'afin-cordas' });
    const msgEl = el('p', { class: 'erro', role: 'alert' });
    const instEl = el('div', { class: 'abas' });
    const afinSel = el('select', { 'aria-label': 'Afinação' });
    const a4El = el('strong', { class: 'afin-a4' });
    const btnLigar = el('button', { class: 'primario' }, 'Ligar microfone');
    const btnTocar = el('button', { disabled: true }, '🔊 Ouvir a nota');

    function pintarCordas() {
      const af = afinacao();
      const num = af.cordas.length;
      cordasEl.replaceChildren(
        el('button', { class: 'afin-corda' + (est.manual == null ? ' ativo' : ''), onclick: () => escolher(null) },
          el('span', { class: 'num' }, 'Auto'), el('b', {}, '⟳'), el('small', {}, 'detecta')),
        ...af.cordas.map((m, i) => {
          const detectada = est.resultado && est.manual == null && est.resultado.corda === i;
          return el('button', {
            class: 'afin-corda' + (est.manual === i ? ' ativo' : '') + (detectada ? ' detectada' : ''),
            onclick: () => escolher(i),
            'aria-label': `${num - i}ª corda, ${nota(m, af.bemol)}${oitava(m)}`,
          },
            el('span', { class: 'num' }, `${num - i}ª`),
            el('b', {}, nota(m, af.bemol)),
            el('small', {}, `${notaPt(m, af.bemol)} ${oitava(m)}`));
        }));
      btnTocar.disabled = est.manual == null;
    }

    function pintarSelecoes() {
      instEl.replaceChildren(...Object.entries(INSTRUMENTOS).map(([id, ins]) =>
        el('button', { class: prefs.inst === id ? 'ativo' : '', onclick: () => {
          prefs.inst = id; prefs.afin = INSTRUMENTOS[id].afinacoes[0].id; est.manual = null; est.ultimos = [];
          salvarPrefs(prefs); pintarSelecoes(); zerar();
        } }, ins.nome)));
      afinSel.replaceChildren(...instrumento().afinacoes.map((a) =>
        el('option', { value: a.id, selected: a.id === afinacao().id }, a.nome)));
      a4El.textContent = `Lá = ${prefs.a4} Hz`;
      pintarCordas();
    }

    function escolher(i) {
      est.manual = i; est.ultimos = []; pintarCordas(); zerar();
      if (i != null) tocarReferencia();
    }

    function zerar() {
      est.resultado = null;
      painel.className = 'afin-painel sem-sinal';
      nomeEl.textContent = est.manual != null ? nota(afinacao().cordas[est.manual], afinacao().bemol) : '—';
      ptEl.textContent = est.manual != null
        ? `${notaPt(afinacao().cordas[est.manual], afinacao().bemol)} ${oitava(afinacao().cordas[est.manual])}` : ' ';
      hzEl.textContent = est.manual != null ? `${freqDe(afinacao().cordas[est.manual], prefs.a4).toFixed(1)} Hz (alvo)` : ' ';
      centsEl.textContent = ' ';
      ponteiro.style.left = '50%';
      dicaEl.textContent = est.ligado ? 'Toque uma corda solta' : (est.manual != null ? 'Ligue o microfone e toque a corda' : 'Ligue o microfone');
    }

    function mostrar(r, freq) {
      const af = afinacao();
      const midi = af.cordas[r.corda];
      const c = r.cents;
      const abs = Math.abs(c);
      nomeEl.textContent = nota(midi, af.bemol);
      ptEl.textContent = `${notaPt(midi, af.bemol)} ${oitava(midi)}`;
      hzEl.textContent = `${freq.toFixed(1)} Hz`;
      const arred = Math.round(abs);
      centsEl.textContent = arred === 0 ? '0 cents' : `${c > 0 ? '+' : '−'}${arred} cents`;
      ponteiro.style.left = `${50 + Math.max(-50, Math.min(50, c))}%`;
      let classe, dica;
      if (abs <= 5) { classe = 'afinado'; dica = 'Afinado ✓'; }
      else if (abs <= 15) { classe = 'quase'; dica = c < 0 ? 'Quase… aperte um pouco' : 'Quase… afrouxe um pouco'; }
      else { classe = 'longe'; dica = c < 0 ? 'Grave demais: aperte a corda ↑' : 'Agudo demais: afrouxe a corda ↓'; }
      painel.className = `afin-painel ${classe}`;
      dicaEl.textContent = dica;
    }

    function ciclo() {
      if (!analyser) return;
      analyser.getFloatTimeDomainData(buf);
      const af = afinacao();
      const alvo = est.manual != null ? freqDe(af.cordas[est.manual], prefs.a4) : null;
      const lido = detectar(buf, ctx.sampleRate, af, prefs.a4, alvo);
      const agora = Date.now();
      if (lido && lido.confianca > 0.8) {
        est.ultimoSinal = agora;
        est.ultimos.push(lido.freq);
        if (est.ultimos.length > 5) est.ultimos.shift();
        const f = mediana(est.ultimos);
        est.resultado = avaliar(f, af, prefs.a4, est.manual);
        mostrar(est.resultado, f);
        if (est.manual == null) pintarCordas();
      } else if (agora - est.ultimoSinal > 900) {
        est.ultimos = [];
        if (est.resultado) { zerar(); pintarCordas(); }
      }
    }

    async function ligar() {
      msgEl.textContent = '';
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        msgEl.textContent = 'Este navegador não permite usar o microfone aqui. Use o Chrome (Android) ou o Safari (iPhone) e abra o site pelo endereço https.';
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') await ctx.resume();
        analyser = ctx.createAnalyser();
        analyser.fftSize = 8192;
        analyser.smoothingTimeConstant = 0;
        ctx.createMediaStreamSource(stream).connect(analyser);
        buf = new Float32Array(analyser.fftSize);
        timer = setInterval(ciclo, 80);
        est.ligado = true;
        btnLigar.textContent = 'Parar microfone';
        btnLigar.classList.remove('primario');
        zerar();
      } catch (e) {
        desligar();
        msgEl.textContent = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
          ? 'O microfone foi bloqueado. Permita o uso do microfone para este site nas configurações do navegador e tente de novo.'
          : 'Não foi possível ligar o microfone neste aparelho.';
      }
    }

    function desligar() {
      if (timer) clearInterval(timer);
      timer = null;
      if (stream) stream.getTracks().forEach((t) => t.stop());
      stream = null;
      if (ctx) { try { ctx.close(); } catch (_) { /* ok */ } }
      ctx = null; analyser = null;
      if (ctxTom) { try { ctxTom.close(); } catch (_) { /* ok */ } ctxTom = null; }
      est.ligado = false; est.ultimos = [];
      btnLigar.textContent = 'Ligar microfone';
      btnLigar.classList.add('primario');
      if (document.body.contains(painel)) zerar();
    }

    // Toca a nota da corda para afinar de ouvido (som com harmônicos, para os graves se ouvirem no celular)
    function tocarReferencia() {
      if (est.manual == null) return;
      try {
        if (!ctxTom) ctxTom = new (window.AudioContext || window.webkitAudioContext)();
        if (ctxTom.state === 'suspended') ctxTom.resume();
        const f = freqDe(afinacao().cordas[est.manual], prefs.a4);
        const t0 = ctxTom.currentTime;
        const osc = ctxTom.createOscillator();
        const filtro = ctxTom.createBiquadFilter();
        const ganho = ctxTom.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = f;
        filtro.type = 'lowpass';
        filtro.frequency.value = Math.max(900, f * 6);
        ganho.gain.setValueAtTime(0, t0);
        ganho.gain.linearRampToValueAtTime(0.22, t0 + 0.05);
        ganho.gain.exponentialRampToValueAtTime(0.0008, t0 + 2.2);
        osc.connect(filtro); filtro.connect(ganho); ganho.connect(ctxTom.destination);
        osc.start(t0); osc.stop(t0 + 2.3);
      } catch (_) { /* sem som neste aparelho */ }
    }

    afinSel.addEventListener('change', () => {
      prefs.afin = afinSel.value; est.manual = null; est.ultimos = []; salvarPrefs(prefs); pintarSelecoes(); zerar();
    });
    btnLigar.addEventListener('click', () => { if (est.ligado) desligar(); else ligar(); });
    btnTocar.addEventListener('click', tocarReferencia);
    const mudarA4 = (d) => {
      prefs.a4 = Math.min(450, Math.max(430, prefs.a4 + d)); salvarPrefs(prefs); a4El.textContent = `Lá = ${prefs.a4} Hz`;
      est.ultimos = []; if (est.manual != null) zerar();
    };

    const onVisivel = () => { if (document.hidden) desligar(); };
    document.addEventListener('visibilitychange', onVisivel);

    ativo = { desligar: () => { desligar(); document.removeEventListener('visibilitychange', onVisivel); } };

    pintarSelecoes();
    zerar();

    return el('div', { class: 'afinador' },
      instEl,
      el('div', { class: 'afin-opcoes' },
        el('label', { class: 'afin-rotulo' }, 'Afinação', afinSel),
        el('div', { class: 'afin-a4-caixa' },
          el('button', { 'aria-label': 'Baixar a referência em 1 Hz', onclick: () => mudarA4(-1) }, '−'),
          a4El,
          el('button', { 'aria-label': 'Subir a referência em 1 Hz', onclick: () => mudarA4(1) }, '+'))),
      painel,
      cordasEl,
      el('div', { class: 'linha afin-acoes' }, btnLigar, btnTocar),
      msgEl,
      el('p', { class: 'mudo' }, 'Deixe o ambiente quieto e toque uma corda solta de cada vez. Em "Auto" o afinador descobre sozinho qual corda é; toque numa corda para afinar só ela e ouvir a nota de referência.'));
  }

  const api = { montar, parar, _teste: { yin, detectar, avaliar, decimar, volume, freqDe, INSTRUMENTOS } };
  (typeof window !== 'undefined' ? window : globalThis).Afinador = api;
})();
