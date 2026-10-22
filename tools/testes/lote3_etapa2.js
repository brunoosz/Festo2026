// teste automatico do lote 3, etapa 2: Visualizador ve tudo em leitura, tutorial a cada login, roteiro novo e IA atualizada
// uso: node tools/testes/lote3_etapa2.js   (ou npm test)
const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const mqtt = require('mqtt');
const { criarUsuariosTeste, SENHA_TESTE } = require('../seed_teste');

const PORTA_SITE = 5064, PORTA_MQTT = 18835;
const B = `http://127.0.0.1:${PORTA_SITE}`;
const raiz = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flowpack-lote3e2-'));
const esperar = ms => new Promise(r => setTimeout(r, ms));
const ok = m => console.log('  ok   ' + m);
process.env.MOCK_MQTT_PORT = String(PORTA_MQTT);
const { iniciar } = require('../mock_mqtt');

const PERGUNTAS = [
    ['Como libero a emergência?', /dono|administrador|adm/i, /desbloquear|cart[aã]o/i],
    ['O que significam os bips?', /bip/i, /longo|curtos/i],
    ['Por que o MAIS não funciona?', /cart[aã]o/i, /30 segundos|bip m[eé]dio/i],
    ['O que o Visualizador pode fazer?', /visualizador/i, /somente leitura|n[aã]o controla|s[oó] olha/i],
    ['Quem pode cadastrar cartões NFC?', /dono/i, /cadastr/i],
    ['Quais são os níveis de receita?', /50/, /200/],
    ['Como funciona o separador?', /servo/i, /c[aâ]mera/i],
    ['Quais são os perfis de usuário?', /dono/i, /operário|operario/i],
    ['O botão de emergência do painel precisa de cartão?', /n[aã]o/i, /sempre/i],
    ['O que acontece quando a emergência é ativada?', /trava/i, /vermelh|borda/i]
];

(async () => {
    const arqUsuarios = path.join(tmp, 'usuarios.json');
    const u = criarUsuariosTeste(arqUsuarios);
    const antigas = ['dispenser', 'separador', 'receitas', 'graficos', 'relatorios', 'visao', 'chat', 'logs', 'controle', 'sistema', 'usuarios'];
    u.visantiga = Object.assign({}, u.visualizador, { telasPermitidas: antigas.slice() });
    u.vispersonalizada = Object.assign({}, u.visualizador, { telasPermitidas: ['dashboard', 'logs'] });
    fs.writeFileSync(arqUsuarios, JSON.stringify(u, null, 2));
    const { aedes, servidor } = await iniciar({ placas: false });
    let site = null, saida = '';
    const fim = c => { try { site.kill(); } catch (e) {} servidor.close(); try { aedes.close(); } catch (e) {} fs.rmSync(tmp, { recursive: true, force: true }); setTimeout(() => process.exit(c), 300); };
    try {
        const env = Object.assign({}, process.env, { PORT: String(PORTA_SITE), MQTT_BROKER: `mqtt://127.0.0.1:${PORTA_MQTT}`, USUARIOS_JSON: arqUsuarios, EMERGENCIA_JSON: path.join(tmp, 'e.json'),
            RECEITAS_JSON: path.join(tmp, 'r.json'), CARTOES_NFC_JSON: path.join(tmp, 'c.json'), NFC_JANELA_MS: '2000', SESSION_SECRET: 'x' });
        delete env.NVIDIA_API_KEY;
        site = spawn('node', ['server.js'], { cwd: raiz, stdio: ['ignore', 'pipe', 'pipe'], env });
        site.stdout.on('data', d => { saida += d; }); site.stderr.on('data', d => { saida += d; });
        for (let i = 0; i < 60; i++) { await esperar(250); try { if ((await fetch(B + '/sobre')).status === 200) break; } catch (e) {} }
        await esperar(800);
        const entrar = async nome => {
            const r = await fetch(B + '/', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `username=${nome}&password=${SENHA_TESTE}` });
            const c = (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map(x => x.split(';')[0]).join('; '); assert.ok(c.includes('connect.sid'), 'login ' + nome); return c;
        };
        const chamar = async (metodo, p, c, corpo) => {
            const r = await fetch(B + p, { method: metodo, redirect: 'manual', headers: Object.assign({ Cookie: c }, corpo !== undefined ? { 'Content-Type': 'application/json' } : {}), body: corpo !== undefined ? JSON.stringify(corpo) : undefined });
            const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {} return { status: r.status, json: j, texto: t };
        };
        const placa = mqtt.connect(`mqtt://127.0.0.1:${PORTA_MQTT}`); await new Promise(r => placa.on('connect', r));
        placa.publish('nfc/status', 'online'); await esperar(300);
        const dono = await entrar('dono'), vis = await entrar('visualizador'), oper = await entrar('operario');

        console.log('1) Visualizador vê todas as telas, só em leitura');
        for (const rota of ['/dashboard', '/controle', '/dispenser', '/separador', '/receitas', '/graficos', '/relatorios', '/visao', '/chat', '/logs', '/sistema', '/usuarios', '/nfc', '/configuracoes'])
            assert.strictEqual((await chamar('GET', rota, vis)).status, 200, rota);
        ok('abre as 14 telas, inclusive Painel de Controle, Status do Sistema, Usuários e Cartões NFC');
        assert.ok((await chamar('GET', '/dashboard', vis)).texto.includes('id="link-nfc"')); ok('o menu dele mostra Cartões NFC');
        assert.ok(!(await chamar('GET', '/dashboard', oper)).texto.includes('id="link-nfc"') && (await chamar('GET', '/nfc', oper)).status === 403); ok('Operário continua sem a tela de cartões');

        // cadastra um cartao (Dono) para ver o mascaramento
        await chamar('POST', '/api/nfc/cadastrar', dono, { usuario: 'dono' }); placa.publish('nfc/leitura', 'AABBCCDD'); await esperar(500);
        placa.publish('nfc/leitura', 'AABBCCDD'); await esperar(400);
        const comoDono = (await chamar('GET', '/api/nfc/estado', dono)).json; assert.strictEqual(comoDono.cartoes[0].final, 'CCDD'); assert.strictEqual(comoDono.podeCadastrar, true);
        const comoVis = (await chamar('GET', '/api/nfc/estado', vis)); const txt = JSON.stringify(comoVis.json);
        assert.strictEqual(comoVis.status, 200); assert.ok(!txt.includes('CCDD') && txt.includes('••••')); assert.strictEqual(comoVis.json.podeCadastrar, false); assert.deepStrictEqual(comoVis.json.elegiveis, []);
        assert.ok(comoVis.json.cartoes.every(c => c.id === '')); ok('Cartões NFC para o Visualizador: sem o final do número, sem identificador e sem cadastro');
        for (const [m, p, c] of [['POST', '/api/nfc/cadastrar', { usuario: 'dono' }], ['DELETE', '/api/nfc/cartoes/x'], ['POST', '/api/emergencia/liberar', {}], ['POST', '/api/receitas/aplicar', { indice: 1 }], ['POST', '/api/separador/servo/teste', { lado: 'E' }]])
            assert.strictEqual((await chamar(m, p, vis, c || {})).status, 403, p);
        ok('cadastrar/apagar cartão, liberar emergência, receitas e servo: 403 para o Visualizador');
        const us = (await chamar('GET', '/api/usuarios', vis)).json; assert.ok(us.somenteLeitura && us.usuarios.every(x => Object.keys(x).sort().join() === 'acessibilidade,nivel,nomeNivel,permissoes,usuario' && Object.keys(x.permissoes).length === 0)); ok('Usuários para o Visualizador: só nome e perfil');
        const sis = (await chamar('GET', '/api/sistema/status', vis)).json; assert.deepStrictEqual(sis.vigia.linhas, []); assert.ok(sis.dispositivos.length >= 8); ok('Status do Sistema: placas visíveis, sem linhas de log da rede');
        assert.ok(/oculto/.test((await chamar('GET', '/api/sistema/log-rede', vis)).texto)); ok('o log da rede aparece oculto');
        assert.strictEqual((await chamar('GET', '/sobre/editar', vis)).status, 404); ok('nenhuma tela de edição do Sobre nós existe para ele');

        console.log('2) Listas antigas de telas do Visualizador');
        assert.strictEqual((await chamar('GET', '/nfc', await entrar('visantiga'))).status, 200); ok('lista antiga (todas as 11 telas) passa a incluir Cartões NFC');
        const pers = await entrar('vispersonalizada'); const r = await chamar('GET', '/nfc', pers); assert.strictEqual(r.status, 302); ok('lista personalizada sem a tela continua sem ela (o Dono decide)');

        console.log('3) Tutorial');
        const flag = t => /__tutorialObrigatorioInicial = (true|false)/.exec(t)[1];
        assert.strictEqual(flag((await chamar('GET', '/dashboard', vis)).texto), 'true'); ok('Visualizador: o tutorial começa sozinho ao logar');
        await chamar('POST', '/api/usuario/tutorial-visto', vis, {});
        assert.strictEqual(flag((await chamar('GET', '/dashboard', vis)).texto), 'false'); ok('pular/concluir vale só para esta sessão');
        const vis2 = await entrar('visualizador'); assert.strictEqual(flag((await chamar('GET', '/dashboard', vis2)).texto), 'true'); ok('no próximo login o tutorial começa de novo');
        assert.ok(JSON.parse(fs.readFileSync(arqUsuarios, 'utf8')).visualizador.tutorialVisto === true, 'nao deveria mudar'); ok('e nada é gravado no usuarios.json');
        assert.strictEqual(flag((await chamar('GET', '/dashboard', dono)).texto), 'false'); ok('Dono e demais perfis mantêm o comportamento antigo (só na primeira vez)');
        assert.ok((await chamar('GET', '/configuracoes', vis)).texto.includes('btn-rever-tutorial') && (await chamar('GET', '/configuracoes', oper)).texto.includes('btn-rever-tutorial')); ok('"Rever tutorial" existe em Configurações para todos');

        console.log('4) Roteiro do tutorial');
        const janela = {}; vm.runInNewContext(fs.readFileSync(path.join(raiz, 'public', 'js', 'tutorial-roteiro.js'), 'utf8'), { window: janela });
        const roteiro = janela.ROTEIRO_TUTORIAL; assert.ok(roteiro.length >= 20 && roteiro.every(p => p.titulo && p.texto));
        const paginas = new Set(roteiro.map(p => p.pagina).filter(Boolean));
        for (const p of ['/dashboard', '/controle', '/receitas', '/dispenser', '/separador', '/visao', '/graficos', '/relatorios', '/logs', '/sistema', '/nfc', '/usuarios', '/chat', '/configuracoes']) assert.ok(paginas.has(p), p);
        ok('o roteiro cobre todas as telas atuais (em um único arquivo editável)');
        const tudo = roteiro.map(p => p.titulo + ' ' + p.texto).join(' ');
        for (const t of [/emerg[eê]ncia/i, /borda vermelha/i, /NFC/, /Manuais/, /Sobre nós/, /Dark Coders AI/, /3D/]) assert.ok(t.test(tudo), String(t));
        ok('fala de emergência (borda vermelha), cartão NFC, manuais, Sobre nós, IA e modelo 3D');
        assert.ok(!/editor|editar o sobre|sobre\/editar/i.test(tudo + fs.readFileSync(path.join(raiz, 'views', 'base.html'), 'utf8').match(/tutorial[\s\S]{0,200}/g).join(''))); ok('nenhum passo menciona o editor do Sobre nós');
        assert.ok(roteiro.some(p => p.perfis && p.perfis.includes(4) && /só de visualização/.test(p.texto))); ok('o tutorial do Visualizador termina dizendo que ele só pode visualizar');
        assert.ok(roteiro.filter(p => p.pagina === '/nfc' && p.soAdmin).length === 1 && roteiro.filter(p => p.perfis && p.perfis.includes(4) && p.pagina === '/nfc').length === 1); ok('há versão do passo do NFC para Dono/Adm e outra (somente leitura) para o Visualizador');

        await esperar(2500);   // a janela dos botoes (aberta pelo cartao do teste) fecha
        console.log('5) IA: 10 perguntas de teste (sem internet: base local) e estado ao vivo');
        for (const [pergunta, ...padroes] of PERGUNTAS) {
            const r = await chamar('POST', '/api/chat', vis, { pergunta }); assert.strictEqual(r.status, 200, pergunta);
            const resp = r.json.resposta; console.log('       P: ' + pergunta + '\n       R: ' + resp.slice(0, 170).replace(/\n/g, ' ') + (resp.length > 170 ? '...' : ''));
            for (const p of padroes) assert.ok(p.test(resp), 'resposta fraca para "' + pergunta + '": ' + resp);
        }
        ok('as 10 respostas estão corretas (inclusive para o perfil Visualizador)');
        const ia = async (pergunta, c = dono) => (await chamar('POST', '/api/chat', c, { pergunta })).json.resposta;
        placa.publish('esteira/botao', 'emergencia'); await esperar(600);
        let resp = await ia('A emergência está ativa?'); assert.ok(/ATIVA/.test(resp) && /Dono ou o Administrador/.test(resp)); ok('com emergência ativa a IA diz que está ativa e quem libera');
        resp = await ia('por que os botões mais e menos estão bloqueados?'); assert.ok(/emergência/.test(resp) && /travados/.test(resp)); ok('e explica que MAIS/MENOS estão travados por causa da emergência');
        placa.publish('nfc/leitura', 'AABBCCDD'); await esperar(500);
        assert.ok(/liberada/.test(await ia('a emergência está ativa agora?'))); ok('depois do cartão a IA já sabe que foi liberada');
        assert.ok(/liberados por mais/.test(await ia('os botões do painel estão liberados?'))); ok('sabe que a janela dos botões está aberta (e por quantos segundos)');
        assert.ok(/receita atual é a de \d+ g/.test(await ia('qual é a receita atual?', vis))); ok('sabe a receita atual (também para o Visualizador)');
        assert.ok(/online/.test(await ia('o leitor nfc está online?'))); ok('sabe se o leitor NFC está online');
        const base = fs.readFileSync(path.join(raiz, 'server.js'), 'utf8');
        assert.ok(/FATOS ATUALIZADOS DO SISTEMA/.test(base) && /MAIS\/MENOS por 30 s/.test(base) && /Emergência: \$\{/.test(base)); ok('o prompt dos modelos online e o estado ao vivo enviado a eles foram atualizados');

        placa.end(true);
        console.log('\nLOTE 3 ETAPA 2: TUDO OK'); fim(0);
    } catch (e) { console.error('\nFALHOU: ' + (e && e.message)); console.error(saida.slice(0, 400)); fim(1); }
})();
