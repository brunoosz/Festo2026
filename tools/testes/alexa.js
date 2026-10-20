// teste da skill da Alexa com pedidos simulados (nao precisa de internet nem do certificado da Amazon)
// uso: node tools/testes/alexa.js
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
const ini = src.indexOf('// cada intencao da skill guarda');
const fim = src.indexOf('if (ALEXA_SKILL_ID) construtorSkillAlexa');
const acoes = [];
const ctx = {
    Alexa: require('ask-sdk-core'), console,
    receitas: { atual: 0, niveis: [{ gramas: 50 }, { gramas: 100 }, { gramas: 150 }, { gramas: 200 }] },
    emergenciaGlobal: { ativa: false },
    receitasAplicar: (i, o) => { acoes.push(`receita:${i}:${o}`); return true; },
    definirAquecimentoServidor: (n, l) => acoes.push(`aquecimento:${n}:${l}`),
    registrarLogDaAlexa: () => {},
    executarComandoServidor: c => { acoes.push('exec:' + c.tipo); return 'Parada de emergência acionada. Todos os motores e aquecimentos foram parados.'; },
    interpretarComandoServidor: () => null, responderPerguntaParaAlexa: async () => 'x'
};
vm.createContext(ctx);
vm.runInContext(src.slice(ini, fim) + `
this.skill = Alexa.SkillBuilders.custom().addRequestHandlers(AlexaAbrirHandler, AlexaLigarMaquinaHandler,
  AlexaPredefinicaoHandler, AlexaEmergenciaHandler, AlexaPedidoHandler, AlexaAjudaHandler, AlexaSairHandler,
  AlexaNaoEntendiHandler, AlexaFimDeSessaoHandler).create();`, ctx);

const envelope = req => ({
    version: '1.0',
    session: { new: true, sessionId: 's', application: { applicationId: 'x' }, user: { userId: 'u' } },
    context: { System: { application: { applicationId: 'x' }, user: { userId: 'u' }, device: { deviceId: 'd' } } },
    request: Object.assign({ requestId: 'r', timestamp: new Date().toISOString(), locale: 'pt-BR' }, req)
});
const pedido = (nome, slots) => envelope({
    type: 'IntentRequest',
    intent: { name: nome, confirmationStatus: 'NONE', slots: Object.fromEntries(Object.entries(slots || {}).map(([k, v]) => [k, { name: k, value: v, confirmationStatus: 'NONE' }])) }
});
async function falar(e) {
    acoes.length = 0;
    const r = await ctx.skill.invoke(e);
    return { fala: (r.response.outputSpeech.ssml || '').replace(/<[^>]+>/g, ''), encerra: r.response.shouldEndSession === true, acoes: acoes.slice() };
}
const ok = m => console.log('  ok   ' + m);

(async () => {
    let r = await falar(envelope({ type: 'LaunchRequest' }));
    assert.ok(r.fala.includes('Com qual pré-definição') && !r.encerra); ok('abrir a skill pergunta a pré-definição');
    r = await falar(pedido('LigarMaquinaIntent'));
    assert.ok(r.fala.includes('50, 100, 150 ou 200 gramas') && !r.encerra); ok('"ligar" pergunta a pré-definição');
    for (const [g, i] of [[50, 0], [100, 1], [150, 2], [200, 3]]) {
        r = await falar(pedido('PredefinicaoIntent', { gramas: String(g) }));
        assert.ok(r.encerra && r.acoes.includes(`receita:${i}:Alexa`) && r.acoes.includes('aquecimento:1:true') && r.acoes.includes('aquecimento:2:true'));
        ok(`${g} gramas aplica a receita ${i}, liga os aquecimentos e fecha a skill`);
    }
    r = await falar(pedido('PredefinicaoIntent', { gramas: '75' }));
    assert.ok(!r.encerra && r.acoes.length === 0 && r.fala.includes('Não tenho')); ok('valor que não existe (75) pergunta de novo, sem ligar nada');
    r = await falar(pedido('EmergenciaIntent'));
    assert.ok(r.encerra && r.acoes.includes('exec:emergencia')); ok('emergência aciona a parada e fecha a skill');
    ctx.emergenciaGlobal.ativa = true;
    r = await falar(pedido('PredefinicaoIntent', { gramas: '50' }));
    assert.ok(r.encerra && r.acoes.length === 0 && r.fala.includes('travada')); ok('com a máquina travada, a Alexa avisa e não liga nada');
    r = await falar(envelope({ type: 'LaunchRequest' }));
    assert.ok(r.encerra && r.fala.includes('travada')); ok('abrir a skill com a máquina travada também avisa');
    r = await falar(pedido('EmergenciaIntent'));
    assert.ok(r.acoes.includes('exec:emergencia')); ok('a emergência continua disponível mesmo travada');
    console.log('\nALEXA: TUDO OK');
})().catch(e => { console.log('\nFALHOU:', e.message); process.exit(1); });
