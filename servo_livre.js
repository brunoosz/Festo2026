// GitHub: https://github.com/brunoosz | LinkedIn: https://www.linkedin.com/in/brunocamperlingo/
// servo livre: validação, presets e sequências
const fs = require('fs');

const LIMITES = {
    angulo: [0, 180], velocidade: [1, 100], esperaMs: [0, 30000], abertoMs: [100, 5000],
    pulsoMin: [400, 1500], pulsoMax: [1500, 2600], maxPassos: 30, maxPresets: 20, maxSequencias: 20, maxRepeticoes: 100
};

function numero(v) {
    if (v === '' || v === null || typeof v === 'boolean' || Array.isArray(v)) return NaN;
    return Number(v);
}

// valor dentro da faixa (erro se fora)
function inteiroNaFaixa(v, [a, b], nome) {
    const n = numero(v);
    if (!isFinite(n)) throw new Error(`${nome} inválido.`);
    if (n < a || n > b) throw new Error(`${nome} precisa estar entre ${a} e ${b}.`);
    return Math.round(n);
}

function validarAngulo(v) { return inteiroNaFaixa(v, LIMITES.angulo, 'Ângulo'); }
function validarVelocidade(v) { return inteiroNaFaixa(v, LIMITES.velocidade, 'Velocidade'); }

function validarNome(v) {
    const n = String(v === undefined || v === null ? '' : v).trim().replace(/\s+/g, ' ');
    if (!n || n.length > 30) throw new Error('O nome precisa ter de 1 a 30 letras.');
    return n;
}

// calibração: aceita só o que veio, confere com o que já existe
function validarCalibracao(corpo, atual) {
    const c = corpo || {};
    const prox = {
        anguloEsq: atual.anguloEsq, anguloCentro: atual.anguloCentro, anguloDir: atual.anguloDir,
        limMin: atual.limMin, limMax: atual.limMax, pulsoMin: atual.pulsoMin, pulsoMax: atual.pulsoMax,
        inverterServo: !!atual.inverterServo, voltarAuto: atual.voltarAuto !== false,
        tempoAbertoMs: atual.tempoAbertoMs, velocidadeServo: atual.velocidadeServo
    };
    if (c.anguloEsq !== undefined) prox.anguloEsq = validarAngulo(c.anguloEsq);
    if (c.anguloCentro !== undefined) prox.anguloCentro = validarAngulo(c.anguloCentro);
    if (c.anguloDir !== undefined) prox.anguloDir = validarAngulo(c.anguloDir);
    if (c.limMin !== undefined) prox.limMin = validarAngulo(c.limMin);
    if (c.limMax !== undefined) prox.limMax = validarAngulo(c.limMax);
    if (c.pulsoMin !== undefined) prox.pulsoMin = inteiroNaFaixa(c.pulsoMin, LIMITES.pulsoMin, 'Pulso mínimo');
    if (c.pulsoMax !== undefined) prox.pulsoMax = inteiroNaFaixa(c.pulsoMax, LIMITES.pulsoMax, 'Pulso máximo');
    if (c.inverterServo !== undefined) prox.inverterServo = !!c.inverterServo;
    if (c.voltarAuto !== undefined) prox.voltarAuto = !!c.voltarAuto;
    if (c.tempoAbertoMs !== undefined) prox.tempoAbertoMs = inteiroNaFaixa(c.tempoAbertoMs, LIMITES.abertoMs, 'Tempo parado');
    if (c.velocidadeServo !== undefined) prox.velocidadeServo = validarVelocidade(c.velocidadeServo);
    if (prox.limMax - prox.limMin < 10) throw new Error('O limite máximo precisa ser pelo menos 10° maior que o mínimo.');
    if (prox.pulsoMax - prox.pulsoMin < 500) throw new Error('O pulso máximo precisa ser pelo menos 500 µs maior que o mínimo.');
    for (const [nome, v] of [['Esquerda', prox.anguloEsq], ['Centro', prox.anguloCentro], ['Direita', prox.anguloDir]]) {
        if (v < prox.limMin || v > prox.limMax) throw new Error(`${nome} (${v}°) está fora dos limites de segurança (${prox.limMin}° a ${prox.limMax}°).`);
    }
    return prox;
}

// passos de sequência
function validarPassos(passos) {
    if (!Array.isArray(passos) || !passos.length) throw new Error('A sequência precisa de pelo menos 1 passo.');
    if (passos.length > LIMITES.maxPassos) throw new Error(`No máximo ${LIMITES.maxPassos} passos.`);
    return passos.map((p, i) => {
        try {
            return {
                angulo: validarAngulo(p && p.angulo),
                velocidade: validarVelocidade(p && p.velocidade === undefined ? 60 : p.velocidade),
                esperaMs: inteiroNaFaixa(p && p.esperaMs === undefined ? 0 : p.esperaMs, LIMITES.esperaMs, 'Espera')
            };
        } catch (e) { throw new Error(`Passo ${i + 1}: ${e.message}`); }
    });
}

// repetir: número de vezes ou 0 = até parar
function validarRepeticoes(v) {
    if (v === undefined || v === null) return 1;
    return inteiroNaFaixa(v, [0, LIMITES.maxRepeticoes], 'Repetições');
}

// mesmo cálculo do firmware (graus por passo de 10 ms)
function grausPorPasso(vel) { return 0.15 + (vel - 1) * (6.0 - 0.15) / 99.0; }
function tempoDeslocamentoMs(de, para, vel) {
    return Math.ceil(Math.abs(para - de) / grausPorPasso(vel)) * 10;
}

function criarArmazem(arquivo) {
    let dados = { presets: [], sequencias: [] };
    try {
        const lido = JSON.parse(fs.readFileSync(arquivo, 'utf-8'));
        if (Array.isArray(lido.presets)) dados.presets = lido.presets;
        if (Array.isArray(lido.sequencias)) dados.sequencias = lido.sequencias;
    } catch (e) {}
    const salvar = () => { try { fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2)); } catch (e) {} };
    const achar = (lista, nome) => lista.findIndex(x => x.nome.toLowerCase() === String(nome).trim().toLowerCase());

    return {
        listar: () => ({ presets: dados.presets, sequencias: dados.sequencias }),
        salvarPreset(nome, calib) {
            nome = validarNome(nome);
            const item = { nome, anguloEsq: calib.anguloEsq, anguloCentro: calib.anguloCentro, anguloDir: calib.anguloDir, velocidadeServo: calib.velocidadeServo, tempoAbertoMs: calib.tempoAbertoMs };
            const i = achar(dados.presets, nome);
            if (i >= 0) dados.presets[i] = item;
            else { if (dados.presets.length >= LIMITES.maxPresets) throw new Error(`No máximo ${LIMITES.maxPresets} presets.`); dados.presets.push(item); }
            salvar(); return item;
        },
        pegarPreset(nome) { const i = achar(dados.presets, nome); return i >= 0 ? dados.presets[i] : null; },
        apagarPreset(nome) { const i = achar(dados.presets, nome); if (i < 0) return false; dados.presets.splice(i, 1); salvar(); return true; },
        salvarSequencia(nome, passos, repetir) {
            nome = validarNome(nome);
            const item = { nome, passos: validarPassos(passos), repetir: validarRepeticoes(repetir) };
            const i = achar(dados.sequencias, nome);
            if (i >= 0) dados.sequencias[i] = item;
            else { if (dados.sequencias.length >= LIMITES.maxSequencias) throw new Error(`No máximo ${LIMITES.maxSequencias} sequências.`); dados.sequencias.push(item); }
            salvar(); return item;
        },
        pegarSequencia(nome) { const i = achar(dados.sequencias, nome); return i >= 0 ? dados.sequencias[i] : null; },
        apagarSequencia(nome) { const i = achar(dados.sequencias, nome); if (i < 0) return false; dados.sequencias.splice(i, 1); salvar(); return true; }
    };
}

module.exports = { LIMITES, validarAngulo, validarVelocidade, validarNome, validarCalibracao, validarPassos, validarRepeticoes, tempoDeslocamentoMs, criarArmazem };
