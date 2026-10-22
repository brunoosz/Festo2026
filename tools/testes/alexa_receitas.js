// GitHub: https://github.com/brunoosz | LinkedIn: https://www.linkedin.com/in/brunocamperlingo/
// teste da Alexa: receitas por voz
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
const ini = src.indexOf("const Alexa = require('ask-sdk-core');");
const fim = src.indexOf('// palavra inicial');
const publicados = [], aplicadas = [];
const nivel = g => ({ gramas: g, esteira: g / 200, temp1: 100 + g / 10, temp2: 110 + g / 10 });
const ctx = {
    require, console, process: { env: {} },
    receitas: { atual: 0, niveis: [nivel(50), nivel(100), nivel(150), nivel(200)] },
    emergenciaGlobal: { ativa: false },
    nfcJanelaAberta: () => false,
    receitasAplicar: (i, o) => { aplicadas.push(`${i}:${o}`); ctx.receitas.atual = i; return true; },
    salvarLogNoArquivoDoDia: () => {}, horaAtualCurta: () => '00:00:00', io: { emit: () => {} }, mqttClient: { publish: (t, v) => publicados.push(t + ' ' + v) },
    MOTORES_SELAGEM: {}, ultimoEstadoSelagem: {}, ultimoEstadoSelagem2: {}, ultimaVelocidadeConhecida: '0.00'
};
for (const m of src.matchAll(/const (MQTT_TOPIC_[A-Z0-9_]+)\s*=\s*'([^']+)'/g)) ctx[m[1]] = m[2];   // tópicos
vm.createContext(ctx);
vm.runInContext(src.slice(ini, fim) + '\nthis.dizer = (t) => { const c = interpretarComandoServidor(t); return c ? executarComandoServidor(c) : null; };\nthis.entender = interpretarComandoServidor;', ctx);

const ok = m => console.log('  ok   ' + m);
const dizer = t => { aplicadas.length = 0; publicados.length = 0; return ctx.dizer(t); };
const atual = () => ctx.receitas.niveis[ctx.receitas.atual].gramas;

console.log('1) Entende as frases');
for (const [frase, tipo] of [['aumente a receita', 'receita_aumentar'], ['suba a receita', 'receita_aumentar'], ['diminua a receita', 'receita_diminuir'], ['baixe a receita', 'receita_diminuir'], ['qual a receita atual', 'receita_status'], ['aplique a receita de 100 gramas', 'receita_definir'], ['aplique a receita de cem gramas', 'receita_definir'], ['mude a receita para cento e cinquenta gramas', 'receita_definir'], ['libere a emergência', 'liberar_emergencia'], ['desligue a emergência', 'liberar_emergencia'], ['emergência', 'emergencia']])
    assert.strictEqual((ctx.entender(frase) || {}).tipo, tipo, frase);
ok('aumentar, diminuir, escolher o nível (inclusive por extenso), perguntar a atual, "liberar emergência" e "emergência"');
assert.strictEqual(ctx.entender('aplique a receita de duzentos gramas').gramas, 200); assert.strictEqual(ctx.entender('aplique a receita de cem gramas').gramas, 100); ok('"cem" e "duzentos" viram 100 e 200');
assert.strictEqual(ctx.entender('como funciona a receita'), null); ok('pergunta explicativa sobre receita vai para a IA, não vira comando');

console.log('2) Troca de receita');
let fala = dizer('aumente a receita'); assert.ok(/100 gramas aplicada/.test(fala) && atual() === 100 && aplicadas[0] === '1:Alexa'); ok('aumentar: 50 → 100 g, aplicando o nível');
dizer('aumente a receita'); dizer('aumente a receita'); fala = dizer('aumente a receita'); assert.ok(/Já está na maior receita, de 200 gramas/.test(fala) && aplicadas.length === 0 && atual() === 200); ok('no limite de cima avisa e não aplica nada');
fala = dizer('diminua a receita'); assert.ok(/150 gramas aplicada/.test(fala) && atual() === 150); ok('diminuir: 200 → 150 g');
dizer('diminua a receita'); dizer('diminua a receita'); fala = dizer('diminua a receita'); assert.ok(/Já está na menor receita, de 50 gramas/.test(fala) && aplicadas.length === 0); ok('no limite de baixo avisa e não aplica nada');
fala = dizer('aplique a receita de 150 gramas'); assert.ok(/150 gramas aplicada/.test(fala) && atual() === 150 && /esteira a \d+ por cento/.test(fala) && /selagem 1 a \d+ graus/.test(fala)); ok('escolher o nível aplica e fala o que ele faz (esteira e temperaturas)');
fala = dizer('aplique a receita de 150 gramas'); assert.ok(/já está em uso/.test(fala) && aplicadas.length === 0); ok('receita que já está em uso: só avisa');
fala = dizer('aplique a receita de 75 gramas'); assert.ok(/Não existe receita de 75 gramas\. As receitas são 50, 100, 150 e 200 gramas/.test(fala) && aplicadas.length === 0); ok('receita que não existe: diz quais existem');
fala = dizer('qual a receita atual'); assert.ok(/A receita atual é a de 150 gramas/.test(fala) && /As receitas são 50, 100, 150 e 200/.test(fala) && aplicadas.length === 0); ok('"qual a receita atual" responde sem mexer em nada');
ctx.receitas.niveis[1].gramas = 120; fala = dizer('aplique a receita de 120 gramas'); assert.ok(/120 gramas aplicada/.test(fala)); ok('se a receita for editada na tela, a Alexa acompanha (120 g)'); ctx.receitas.niveis[1].gramas = 100;

console.log('3) Segurança');
ctx.emergenciaGlobal.ativa = true;
for (const frase of ['aumente a receita', 'aplique a receita de 100 gramas', 'mude a velocidade da esteira para 50', 'ligue a selagem 1']) {
    fala = dizer(frase); assert.ok(/A emergência está ativa e a máquina está travada/.test(fala) && /Dono ou Administrador/.test(fala) && aplicadas.length === 0 && publicados.length === 0, frase);
}
ok('com emergência ativa recusa receita, velocidade e temperatura, fala a verdade e não manda nada');
fala = dizer('libere a emergência'); assert.ok(/não dá para liberar a emergência por voz/.test(fala) && /site ou passando o cartão NFC/.test(fala) && publicados.length === 0); ok('a Alexa nunca libera a emergência: explica como liberar');
ctx.emergenciaGlobal.ativa = false;
fala = dizer('libere a emergência'); assert.ok(/não dá para liberar/.test(fala)); ok('mesmo sem emergência, "liberar emergência" não faz nada');
fala = dizer('emergência'); assert.ok(/máquina fica travada até um Dono ou Administrador liberar/.test(fala) && publicados.some(p => /emergencia 1/.test(p))); ok('acionar a emergência por voz avisa que fica travada até Dono/Adm liberar');

console.log('4) Opção: só com o cartão NFC');
const comCartao = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8').includes("process.env.ALEXA_RECEITA_EXIGE_CARTAO === '1'"); assert.ok(comCartao); ok('a variável ALEXA_RECEITA_EXIGE_CARTAO existe no servidor');
const ctx2 = Object.assign({}, ctx, { process: { env: { ALEXA_RECEITA_EXIGE_CARTAO: '1' } }, nfcJanelaAberta: () => false, receitas: { atual: 0, niveis: ctx.receitas.niveis }, emergenciaGlobal: { ativa: false } });
vm.createContext(ctx2); vm.runInContext(src.slice(ini, fim) + '\nthis.dizer = (t) => { const c = interpretarComandoServidor(t); return c ? executarComandoServidor(c) : null; };', ctx2);
aplicadas.length = 0; fala = ctx2.dizer('aumente a receita'); assert.ok(/passe antes o cartão de um Dono ou Administrador/.test(fala) && aplicadas.length === 0); ok('com a opção ligada e sem cartão: recusa e pede o cartão');
ctx2.nfcJanelaAberta = () => true; fala = ctx2.dizer('aumente a receita'); assert.ok(/100 gramas aplicada/.test(fala)); ok('com a janela do cartão aberta: troca normalmente');

console.log('\nALEXA RECEITAS: TUDO OK');
