// GitHub: https://github.com/brunoosz | LinkedIn: https://www.linkedin.com/in/brunocamperlingo/
'use strict';
// motor local
const fs = require('fs');
const path = require('path');

const PADRAO = {
    motorLocal: true,        // método antigo
    eixo: 'x',               // sentido
    sentido: 0,              // direção
    linha: 0.5,              // posição da linha
    limiarFundo: 28,         // diferença de cor
    fracColuna: 0.22,        // fração da faixa
    alfaFundo: 0.04,         // adaptação do fundo
    lacunaFrac: 0.04,        // buracos
    larguraMinFrac: 0.05,    // sujeira
    saltoMaxFrac: 0.35,      // movimento máximo
    framesPerdido: 4,        // quadros perdidos
    passo: 2,                // amostragem
    k: 3,                    // vizinhos
    limDesconhecido: 0.45,   // distância máxima
    larguraTipica: 0,        // largura do saco
    // servo separador
    servoAtivo: false,
    atrasoBaseMs: 1200,      // atraso do servo
    velRefEsteira: 0,        // velocidade de referência
    compensarVelocidade: true,
    tempoAbertoMs: 900,
    anguloEsq: 45,
    anguloCentro: 90,
    anguloDir: 135,
    velocidadeServo: 60,
    modoServo: 'auto',       // auto ou manual
    limMin: 0,               // limite mínimo
    limMax: 180,             // limite máximo
    pulsoMin: 500,           // pulso mínimo
    pulsoMax: 2400,          // pulso máximo
    inverterServo: false,
    voltarAuto: true,        // volta ao centro
    ladoPorClasse: {},       // exemplo de classe
    ladoDesconhecido: 'C'    // lado
};

const FRAMES_APRENDER_FUNDO = 8;
const MAX_AMOSTRAS_POR_CLASSE = 60;

function limitar(v, a, b, padrao) {
    v = Number(v);
    if (!isFinite(v)) return padrao;
    return Math.min(Math.max(v, a), b);
}

function criarMotorSeparador(opcoes) {
    const Jimp = opcoes.Jimp;
    const pastaDados = opcoes.pastaDados;
    const obterCamera = opcoes.obterCamera || (() => ({ zonaInicio: 0.4, zonaFim: 0.6 }));
    const aoTreino = opcoes.aoTreino || (() => {});
    const J = (Jimp && typeof Jimp.read !== 'function' && Jimp.Jimp) ? Jimp.Jimp : Jimp;

    const arquivoConfig = path.join(pastaDados, 'config_separador.json');
    const arquivoTreino = path.join(pastaDados, 'visao_treino.json');

    // config
    let config = Object.assign({}, PADRAO);
    try { Object.assign(config, JSON.parse(fs.readFileSync(arquivoConfig, 'utf-8'))); } catch (e) {}
    config.ladoPorClasse = Object.assign({}, config.ladoPorClasse);

    function salvarConfig() {
        try { fs.writeFileSync(arquivoConfig, JSON.stringify(config, null, 2)); } catch (e) {}
    }

    function validarLado(v, padrao) { return (v === 'E' || v === 'D' || v === 'C') ? v : padrao; }

    function setConfig(p) {
        if (!p || typeof p !== 'object') return config;
        const c = config;
        if (p.motorLocal !== undefined) c.motorLocal = !!p.motorLocal;
        if (p.eixo !== undefined) c.eixo = (p.eixo === 'y') ? 'y' : 'x';
        if (p.sentido !== undefined) c.sentido = [-1, 0, 1].includes(Number(p.sentido)) ? Number(p.sentido) : 0;
        if (p.linha !== undefined) c.linha = limitar(p.linha, 0.1, 0.9, c.linha);
        if (p.limiarFundo !== undefined) c.limiarFundo = limitar(p.limiarFundo, 5, 120, c.limiarFundo);
        if (p.fracColuna !== undefined) c.fracColuna = limitar(p.fracColuna, 0.03, 0.9, c.fracColuna);
        if (p.alfaFundo !== undefined) c.alfaFundo = limitar(p.alfaFundo, 0, 0.3, c.alfaFundo);
        if (p.lacunaFrac !== undefined) c.lacunaFrac = limitar(p.lacunaFrac, 0, 0.2, c.lacunaFrac);
        if (p.larguraMinFrac !== undefined) c.larguraMinFrac = limitar(p.larguraMinFrac, 0.01, 0.5, c.larguraMinFrac);
        if (p.limDesconhecido !== undefined) c.limDesconhecido = limitar(p.limDesconhecido, 0.05, 2, c.limDesconhecido);
        if (p.larguraTipica !== undefined) c.larguraTipica = limitar(p.larguraTipica, 0, 1, c.larguraTipica);
        if (p.servoAtivo !== undefined) c.servoAtivo = !!p.servoAtivo;
        if (p.atrasoBaseMs !== undefined) c.atrasoBaseMs = limitar(p.atrasoBaseMs, 0, 15000, c.atrasoBaseMs);
        if (p.velRefEsteira !== undefined) c.velRefEsteira = limitar(p.velRefEsteira, 0, 1, c.velRefEsteira);
        if (p.compensarVelocidade !== undefined) c.compensarVelocidade = !!p.compensarVelocidade;
        if (p.tempoAbertoMs !== undefined) c.tempoAbertoMs = limitar(p.tempoAbertoMs, 100, 5000, c.tempoAbertoMs);
        if (p.anguloEsq !== undefined) c.anguloEsq = Math.round(limitar(p.anguloEsq, 0, 180, c.anguloEsq));
        if (p.anguloCentro !== undefined) c.anguloCentro = Math.round(limitar(p.anguloCentro, 0, 180, c.anguloCentro));
        if (p.anguloDir !== undefined) c.anguloDir = Math.round(limitar(p.anguloDir, 0, 180, c.anguloDir));
        if (p.velocidadeServo !== undefined) c.velocidadeServo = Math.round(limitar(p.velocidadeServo, 1, 100, c.velocidadeServo));
        if (p.modoServo !== undefined) c.modoServo = (p.modoServo === 'manual') ? 'manual' : 'auto';
        if (p.limMin !== undefined) c.limMin = Math.round(limitar(p.limMin, 0, 170, c.limMin));
        if (p.limMax !== undefined) c.limMax = Math.round(limitar(p.limMax, 10, 180, c.limMax));
        if (p.pulsoMin !== undefined) c.pulsoMin = Math.round(limitar(p.pulsoMin, 400, 1500, c.pulsoMin));
        if (p.pulsoMax !== undefined) c.pulsoMax = Math.round(limitar(p.pulsoMax, 1500, 2600, c.pulsoMax));
        if (p.inverterServo !== undefined) c.inverterServo = !!p.inverterServo;
        if (p.voltarAuto !== undefined) c.voltarAuto = !!p.voltarAuto;
        if (p.ladoDesconhecido !== undefined) c.ladoDesconhecido = validarLado(p.ladoDesconhecido, c.ladoDesconhecido);
        if (p.ladoPorClasse && typeof p.ladoPorClasse === 'object') {
            Object.keys(p.ladoPorClasse).slice(0, 30).forEach(nome => {
                c.ladoPorClasse[String(nome).slice(0, 40)] = validarLado(p.ladoPorClasse[nome], 'C');
            });
        }
        salvarConfig();
        resetarRastreio();
        return config;
    }

    // treino
    let treino = { classes: {} };
    try { treino = JSON.parse(fs.readFileSync(arquivoTreino, 'utf-8')); } catch (e) {}
    if (!treino.classes) treino.classes = {};

    function salvarTreino() {
        try { fs.writeFileSync(arquivoTreino, JSON.stringify(treino)); } catch (e) {}
    }

    let treinando = null;   // progresso

    function iniciarTreino(classe, quantidade) {
        classe = String(classe || '').trim().slice(0, 40);
        if (!classe) throw new Error('Informe o nome do produto.');
        quantidade = Math.round(limitar(quantidade, 1, 60, 10));
        treinando = { classe, restante: quantidade, total: quantidade };
        if (!treino.classes[classe]) treino.classes[classe] = [];
        aoTreino({ ativo: true, classe, restante: quantidade, total: quantidade });
        return treinando;
    }

    function pararTreino() {
        const antes = treinando;
        treinando = null;
        aoTreino({ ativo: false, classe: antes ? antes.classe : null, restante: 0, total: antes ? antes.total : 0 });
        salvarTreino();
    }

    function removerClasse(nome) {
        if (!treino.classes[nome]) return false;
        delete treino.classes[nome];
        if (config.ladoPorClasse[nome] !== undefined) { delete config.ladoPorClasse[nome]; salvarConfig(); }
        salvarTreino();
        return true;
    }

    function listarTreino(maxMiniaturas) {
        maxMiniaturas = maxMiniaturas === undefined ? 6 : maxMiniaturas;
        return Object.keys(treino.classes).map(nome => ({
            nome,
            amostras: treino.classes[nome].length,
            lado: config.ladoPorClasse[nome] || 'C',
            miniaturas: treino.classes[nome].slice(-maxMiniaturas).map(a => a.mini).filter(Boolean)
        }));
    }

    function nomesDasClasses() { return Object.keys(treino.classes); }

    // reconhecimento
    function classificar(f) {
        const todas = [];
        Object.keys(treino.classes).forEach(nome => {
            treino.classes[nome].forEach(a => {
                let d = 0;
                for (let i = 0; i < f.length; i++) { const x = f[i] - a.f[i]; d += x * x; }
                todas.push({ nome, d: Math.sqrt(d) });
            });
        });
        if (!todas.length) return { classe: null, confianca: 0, dist: null, motivo: 'sem_treino' };
        todas.sort((a, b) => a.d - b.d);
        const dmin = todas[0].d;
        if (dmin > config.limDesconhecido) return { classe: null, confianca: 0, dist: dmin, motivo: 'desconhecido' };
        const viz = todas.slice(0, Math.min(config.k, todas.length));
        const votos = {}; let soma = 0;
        viz.forEach(v => { const w = 1 / (v.d + 0.05); votos[v.nome] = (votos[v.nome] || 0) + w; soma += w; });
        let melhor = null;
        Object.keys(votos).forEach(n => { if (melhor === null || votos[n] > votos[melhor]) melhor = n; });
        return { classe: melhor, confianca: soma ? votos[melhor] / soma : 0, dist: dmin };
    }

    function rgbParaHsv(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
        let h = 0;
        if (d > 0) {
            if (mx === r) h = ((g - b) / d) % 6;
            else if (mx === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h *= 60; if (h < 0) h += 360;
        }
        return { h, s: mx === 0 ? 0 : d / mx, v: mx };
    }

    // estado
    let bg = null;              // fundo
    let dims = '';              // mudança de tamanho
    let aprender = FRAMES_APRENDER_FUNDO;
    let acumulador = null;
    let acumulados = 0;
    let tracks = [];
    let fantasmas = [];         // contados recentes
    let proximoId = 1;
    let mudancasGlobais = 0;
    let ultimoFps = 0;
    let ultimoFrameMs = 0;
    const contagens = { total: 0, porClasse: {} };

    function resetarRastreio() { tracks = []; fantasmas = []; }

    function recalibrarFundo() {
        bg = null; acumulador = null; acumulados = 0; aprender = FRAMES_APRENDER_FUNDO; tracks = []; fantasmas = [];
    }

    function estado() {
        return {
            aprendendoFundo: aprender > 0,
            framesFaltando: aprender,
            treino: treinando ? { ativo: true, classe: treinando.classe, restante: treinando.restante, total: treinando.total } : { ativo: false },
            classes: listarTreino(0).map(c => ({ nome: c.nome, amostras: c.amostras, lado: c.lado })),
            larguraTipica: config.larguraTipica,
            contagens,
            fps: ultimoFps,
            mudancasGlobais
        };
    }

    // miniatura
    async function miniatura(img, x, y, w, h) {
        try {
            x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
            w = Math.max(8, Math.min(Math.floor(w), img.bitmap.width - x));
            h = Math.max(8, Math.min(Math.floor(h), img.bitmap.height - y));
            let c = img.clone();
            let url;
            if (typeof c.getBase64Async === 'function') {                   // jimp 0.x
                c = c.crop(x, y, w, h).resize(96, J.AUTO).quality(60);
                url = await c.getBase64Async(J.MIME_JPEG);
            } else {                                                        // jimp 1.x
                c = c.crop({ x, y, w, h }).resize({ w: 96 });
                url = await c.getBase64('image/jpeg', { quality: 60 });
            }
            return String(url).replace(/^data:image\/jpeg;base64,/, '');
        } catch (e) { return null; }
    }

    // processar quadro
    async function processarFrame(buffer, agoraMs) {
        agoraMs = agoraMs || Date.now();
        const img = await J.read(buffer);
        const w = img.bitmap.width, h = img.bitmap.height, data = img.bitmap.data;
        const cam = obterCamera() || {};
        const zi = limitar(cam.zonaInicio, 0, 0.95, 0.4);
        const zf = limitar(cam.zonaFim, zi + 0.02, 1, Math.min(1, zi + 0.2));
        const passo = Math.max(1, config.passo | 0);
        const eixoX = config.eixo !== 'y';

        const ao = eixoX ? w : h;       // comprimento
        const pe = eixoX ? h : w;       // largura
        const p0 = Math.floor(zi * pe), p1 = Math.max(p0 + passo, Math.ceil(zf * pe));
        const L = Math.ceil(ao / passo), T = Math.max(1, Math.ceil((p1 - p0) / passo));
        const N = L * T;

        // amostragem
        const cur = new Uint8Array(N * 3);
        for (let a = 0; a < L; a++) {
            for (let t = 0; t < T; t++) {
                const xa = eixoX ? Math.min(w - 1, a * passo) : Math.min(w - 1, p0 + t * passo);
                const ya = eixoX ? Math.min(h - 1, p0 + t * passo) : Math.min(h - 1, a * passo);
                const si = (ya * w + xa) * 4, di = (a * T + t) * 3;
                cur[di] = data[si]; cur[di + 1] = data[si + 1]; cur[di + 2] = data[si + 2];
            }
        }

        const chave = L + 'x' + T + eixoX;
        if (chave !== dims) { dims = chave; bg = null; acumulador = null; acumulados = 0; aprender = FRAMES_APRENDER_FUNDO; tracks = []; fantasmas = []; }

        const sobreposicao = { w, h, eixo: config.eixo, linha: config.linha, banda: [zi, zf], segmentos: [], aprendendo: false, sinal: 0 };

        // aprendendo fundo
        if (aprender > 0) {
            if (!acumulador) { acumulador = new Float32Array(N * 3); acumulados = 0; }
            for (let i = 0; i < N * 3; i++) acumulador[i] += cur[i];
            acumulados++; aprender--;
            if (aprender === 0) {
                bg = new Float32Array(N * 3);
                for (let i = 0; i < N * 3; i++) bg[i] = acumulador[i] / acumulados;
                acumulador = null;
            }
            sobreposicao.aprendendo = true;
            return { sobreposicao, eventos: [] };
        }

        // diferença do fundo
        const limiar = config.limiarFundo;
        const contaFg = new Uint16Array(L);
        const fgCel = new Uint8Array(N);
        for (let a = 0; a < L; a++) {
            let c = 0;
            for (let t = 0; t < T; t++) {
                const i = (a * T + t) * 3;
                const d = Math.max(Math.abs(cur[i] - bg[i]), Math.abs(cur[i + 1] - bg[i + 1]), Math.abs(cur[i + 2] - bg[i + 2]));
                if (d > limiar) { fgCel[a * T + t] = 1; c++; }
            }
            contaFg[a] = c;
        }
        // colunas diferentes
        const frac = new Float32Array(L);
        for (let a = 0; a < L; a++) {
            const e = contaFg[Math.max(0, a - 1)], c = contaFg[a], d = contaFg[Math.min(L - 1, a + 1)];
            frac[a] = (e + c + d) / (3 * T);
        }
        let sinalMax = 0;
        for (let a = 0; a < L; a++) if (frac[a] > sinalMax) sinalMax = frac[a];

        // histerese
        const fgCol = new Uint8Array(L);
        const alto = config.fracColuna, baixo = config.fracColuna * 0.5;
        for (let a = 0; a < L; a++) if (frac[a] >= alto) fgCol[a] = 1;
        for (let a = 1; a < L; a++) if (!fgCol[a] && fgCol[a - 1] && frac[a] >= baixo) fgCol[a] = 1;
        for (let a = L - 2; a >= 0; a--) if (!fgCol[a] && fgCol[a + 1] && frac[a] >= baixo) fgCol[a] = 1;
        let nFg = 0;
        for (let a = 0; a < L; a++) if (fgCol[a]) nFg++;
        sobreposicao.sinal = Math.min(1, sinalMax / Math.max(0.01, alto) / 2);   // fator

        // luz mudou
        if (nFg / L > 0.85) {
            mudancasGlobais++;
            for (let i = 0; i < N * 3; i++) bg[i] = cur[i];
            tracks = []; fantasmas = [];
            return { sobreposicao, eventos: [] };
        }

        // adaptação do fundo
        const alfa = config.alfaFundo;
        if (alfa > 0) {
            for (let a = 0; a < L; a++) {
                for (let t = 0; t < T; t++) {
                    if (fgCel[a * T + t]) continue;
                    const i = (a * T + t) * 3;
                    bg[i] += alfa * (cur[i] - bg[i]);
                    bg[i + 1] += alfa * (cur[i + 1] - bg[i + 1]);
                    bg[i + 2] += alfa * (cur[i + 2] - bg[i + 2]);
                }
            }
        }

        // objetos
        let lacuna = Math.max(1, Math.round(config.lacunaFrac * L));
        if (config.larguraTipica > 0) lacuna = Math.max(lacuna, Math.round(0.3 * config.larguraTipica * L));
        const minimo = Math.max(2, Math.round(config.larguraMinFrac * L));
        let segmentos = [];
        let ini = -1, ultimo = -1;
        for (let a = 0; a < L; a++) {
            if (fgCol[a]) {
                if (ini < 0) ini = a;
                else if (a - ultimo > lacuna + 1) { segmentos.push([ini, ultimo]); ini = a; }
                ultimo = a;
            }
        }
        if (ini >= 0) segmentos.push([ini, ultimo]);
        segmentos = segmentos.filter(s => (s[1] - s[0] + 1) >= minimo);

        // rastreio
        const usados = new Set();
        const saltoMax = config.saltoMaxFrac;
        const objetos = segmentos.map(s => ({ ini: s[0], fim: s[1], cx: ((s[0] + s[1] + 1) / 2) / L, larg: (s[1] - s[0] + 1) / L }));
        objetos.forEach(o => {
            let melhor = null, dm = Infinity;
            tracks.forEach(tr => {
                if (usados.has(tr.id)) return;
                const d = Math.abs(tr.cx - o.cx);
                if (d < dm && d <= saltoMax) { dm = d; melhor = tr; }
            });
            if (melhor) {
                usados.add(melhor.id);
                melhor.anterior = melhor.cx; melhor.cx = o.cx; melhor.larg = o.larg;
                melhor.v = (o.cx - melhor.anterior) / Math.max(1, agoraMs - (melhor.visto || agoraMs));
                melhor.ini = o.ini; melhor.fim = o.fim; melhor.perdido = 0; melhor.visto = agoraMs;
                o.track = melhor;
            } else {
                const novo = { id: proximoId++, cx: o.cx, anterior: o.cx, larg: o.larg, ini: o.ini, fim: o.fim, perdido: 0, contado: false, visto: agoraMs, v: 0 };
                // objeto contado
                for (let k = 0; k < fantasmas.length; k++) {
                    const f = fantasmas[k];
                    const previsto = f.cx + f.v * (agoraMs - f.visto);
                    if (Math.abs(previsto - o.cx) <= f.larg * 0.8 + 0.08) {
                        if (f.contado) novo.contado = true;      // já contado
                        else novo.anterior = f.cx;               // sumiu
                        fantasmas.splice(k, 1); break;
                    }
                }
                tracks.push(novo); usados.add(novo.id); o.track = novo;
            }
        });
        tracks.forEach(tr => { if (!usados.has(tr.id)) tr.perdido++; });
        tracks.forEach(tr => {
            if (tr.perdido > config.framesPerdido) fantasmas.push({ cx: tr.cx, v: tr.v || 0, larg: tr.larg, visto: tr.visto, contado: tr.contado });
        });
        tracks = tracks.filter(tr => tr.perdido <= config.framesPerdido);
        fantasmas = fantasmas.filter(f => agoraMs - f.visto < 2500);

        sobreposicao.segmentos = objetos.map(o => ({ id: o.track.id, ini: o.ini / L, fim: (o.fim + 1) / L, contado: o.track.contado }));

        // cruzou a linha
        const eventos = [];
        const linha = config.linha;
        for (const o of objetos) {
            const tr = o.track;
            if (tr.contado) continue;
            const cruzouCres = tr.anterior < linha && tr.cx >= linha;
            const cruzouDec = tr.anterior > linha && tr.cx <= linha;
            const cruzou = (config.sentido === 1) ? cruzouCres : (config.sentido === -1) ? cruzouDec : (cruzouCres || cruzouDec);
            if (!cruzou) continue;
            tr.contado = true;

            // sacos no objeto
            let quantidade = 1;
            if (config.larguraTipica > 0 && o.larg > 1.6 * config.larguraTipica) quantidade = Math.max(1, Math.round(o.larg / config.larguraTipica));
            else if (config.larguraTipica <= 0 || o.larg <= 1.3 * config.larguraTipica) {
                config.larguraTipica = config.larguraTipica > 0 ? 0.85 * config.larguraTipica + 0.15 * o.larg : o.larg;
            }

            // cor e textura
            let n = 0, sr = 0, sg = 0, sb = 0, ss = 0, sv = 0, sv2 = 0, escuras = 0, claras = 0, sx = 0, sy = 0, total = 0;
            for (let a = o.ini; a <= o.fim; a++) {
                for (let t = 0; t < T; t++) {
                    total++;
                    if (!fgCel[a * T + t]) continue;
                    const i = (a * T + t) * 3;
                    const hsv = rgbParaHsv(cur[i], cur[i + 1], cur[i + 2]);
                    n++; sr += cur[i]; sg += cur[i + 1]; sb += cur[i + 2]; ss += hsv.s; sv += hsv.v; sv2 += hsv.v * hsv.v;
                    if (hsv.v < 0.35) escuras++; if (hsv.v > 0.8) claras++;
                    const rad = hsv.h * Math.PI / 180; sx += Math.sin(rad) * hsv.s; sy += Math.cos(rad) * hsv.s;
                }
            }
            const f = n ? [
                sr / n / 255, sg / n / 255, sb / n / 255, ss / n, sv / n,
                Math.sqrt(Math.max(0, sv2 / n - (sv / n) * (sv / n))),
                escuras / n, claras / n, n / Math.max(1, total), sx / n, sy / n
            ] : new Array(11).fill(0);

            // recorte
            const mx = eixoX ? o.ini * passo : p0, my = eixoX ? p0 : o.ini * passo;
            const mw = eixoX ? (o.fim - o.ini + 1) * passo : (p1 - p0), mh = eixoX ? (p1 - p0) : (o.fim - o.ini + 1) * passo;
            const mini = await miniatura(img, mx - 4, my - 4, mw + 8, mh + 8);

            if (treinando) {
                const lista = treino.classes[treinando.classe] || (treino.classes[treinando.classe] = []);
                lista.push({ f, t: agoraMs, mini });
                while (lista.length > MAX_AMOSTRAS_POR_CLASSE) lista.shift();
                treinando.restante--;
                const info = { ativo: treinando.restante > 0, classe: treinando.classe, restante: Math.max(0, treinando.restante), total: treinando.total, miniatura: mini };
                if (treinando.restante <= 0) { treinando = null; salvarTreino(); }
                aoTreino(info);
                eventos.push({ tipo: 'treino', classe: info.classe, miniatura: mini, restante: info.restante });
                continue;
            }

            const r = classificar(f);
            eventos.push({ tipo: 'contagem', quantidade, classe: r.classe, confianca: r.confianca, distancia: r.dist, motivo: r.motivo || null, miniatura: mini, largura: o.larg, trackId: tr.id });
            contagens.total += quantidade;
            const nomeC = r.classe || 'Desconhecido';
            contagens.porClasse[nomeC] = (contagens.porClasse[nomeC] || 0) + quantidade;
        }
        if (eventos.some(e => e.tipo === 'contagem' && e.quantidade === 1)) salvarConfigSeMudou();

        const t1 = Date.now();
        if (ultimoFrameMs) { const dt = t1 - ultimoFrameMs; if (dt > 0) ultimoFps = Math.round((0.7 * ultimoFps + 0.3 * (1000 / dt)) * 10) / 10; }
        ultimoFrameMs = t1;
        return { sobreposicao, eventos };
    }

    let ultimaLarguraSalva = -1;
    function salvarConfigSeMudou() {
        if (Math.abs(config.larguraTipica - ultimaLarguraSalva) > 0.01) { ultimaLarguraSalva = config.larguraTipica; salvarConfig(); }
    }

    return {
        processarFrame, getConfig: () => config, setConfig, recalibrarFundo, estado,
        iniciarTreino, pararTreino, removerClasse, listarTreino, nomesDasClasses, classificar,
        _debug: { treino: () => treino }
    };
}

module.exports = { criarMotorSeparador, PADRAO };
