// teste automatico da etapa 2: perfil Visualizador (so olha) e telas liberaveis por usuario
// uso: node tools/testes/etapa2.js   (ou npm test)
const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mqtt = require('mqtt');
const { io: ioc } = require('socket.io-client');
const { criarUsuariosTeste, SENHA_TESTE } = require('../seed_teste');

const PORTA_SITE = 5056, PORTA_MQTT = 18831;
const B = `http://127.0.0.1:${PORTA_SITE}`;
const raiz = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flowpack-teste2-'));
const esperar = ms => new Promise(r => setTimeout(r, ms));
const ok = m => console.log('  ok   ' + m);
const MOVIMENTO = /\/(set|set_temperatura|ativar|dosar|desviar|teste|emergencia|liberar|config|reiniciar|resetar_seguranca)\s/;

process.env.MOCK_MQTT_PORT = String(PORTA_MQTT);
const { iniciar } = require('../mock_mqtt');

(async () => {
    criarUsuariosTeste(path.join(tmp, 'usuarios.json'));
    const { aedes, servidor } = await iniciar({ placas: false });
    const gravado = [];
    aedes.on('publish', (p, c) => { if (c) gravado.push(p.topic + ' ' + p.payload.toString()); });
    const movimentos = () => gravado.filter(x => MOVIMENTO.test(x));

    let site = null, saida = '';
    const fim = codigo => { try { site.kill(); } catch (e) {} servidor.close(); try { aedes.close(); } catch (e) {} fs.rmSync(tmp, { recursive: true, force: true }); setTimeout(() => process.exit(codigo), 300); };

    try {
        site = spawn('node', ['server.js'], {
            cwd: raiz, stdio: ['ignore', 'pipe', 'pipe'],
            env: Object.assign({}, process.env, {
                PORT: String(PORTA_SITE), MQTT_BROKER: `mqtt://127.0.0.1:${PORTA_MQTT}`,
                USUARIOS_JSON: path.join(tmp, 'usuarios.json'), EMERGENCIA_JSON: path.join(tmp, 'emergencia.json'),
                RECEITAS_JSON: path.join(tmp, 'receitas.json'), SESSION_SECRET: 'segredo-so-de-teste'
            })
        });
        site.stdout.on('data', d => { saida += d; }); site.stderr.on('data', d => { saida += d; });
        for (let i = 0; i < 60; i++) { await esperar(250); try { if ((await fetch(B + '/sobre')).status === 200) break; } catch (e) {} }

        // o servidor publica a configuracao do separador logo depois de conectar no MQTT: espera isso passar antes de medir
        for (let i = 0; i < 40 && !gravado.some(x => x.startsWith('separador/config')); i++) await esperar(250);
        await esperar(300);

        const entrar = async (u, senha) => {
            const resp = await fetch(B + '/', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `username=${u}&password=${senha || SENHA_TESTE}` });
            const c = (resp.headers.getSetCookie ? resp.headers.getSetCookie() : []).map(x => x.split(';')[0]).join('; ');
            assert.ok(c.includes('connect.sid'), 'login falhou para ' + u); return c;
        };
        const chamar = async (metodo, p, c, corpo) => {
            const r = await fetch(B + p, { method: metodo, redirect: 'manual', headers: Object.assign({ Cookie: c }, corpo !== undefined ? { 'Content-Type': 'application/json' } : {}), body: corpo !== undefined ? JSON.stringify(corpo) : undefined });
            const texto = await r.text(); let json = null; try { json = JSON.parse(texto); } catch (e) {}
            return { status: r.status, json, texto, local: r.headers.get('location') };
        };
        const dono = await entrar('dono'), adm = await entrar('adm'), oper = await entrar('operario'), vis = await entrar('visualizador');

        console.log('1) Perfis antigos continuam iguais');
        for (const [nome, c] of [['dono', dono], ['adm', adm], ['operario', oper]]) assert.strictEqual((await chamar('GET', '/dashboard', c)).status, 200);
        ok('Dono, Administrador e Operário entram e abrem o dashboard');
        assert.strictEqual((await chamar('GET', '/controle', adm)).status, 200); assert.strictEqual((await chamar('GET', '/usuarios', adm)).status, 200);
        ok('Administrador abre Painel de Controle e Usuários');
        assert.strictEqual((await chamar('GET', '/controle', oper)).status, 403); assert.strictEqual((await chamar('GET', '/sistema', oper)).status, 403);
        ok('Operário continua sem acesso às telas de administrador');
        const menuOper = (await chamar('GET', '/dashboard', oper)).texto, menuAdm = (await chamar('GET', '/dashboard', adm)).texto;
        assert.ok(!menuOper.includes('href="/controle"') && menuAdm.includes('href="/controle"') && menuAdm.includes('href="/usuarios"')); ok('menu: Operário sem as telas de administrador, Administrador com elas');
        assert.strictEqual((await chamar('POST', '/api/receitas/aplicar', oper, { indice: 1 })).status, 403); assert.strictEqual((await chamar('GET', '/dispenser', oper)).status, 200);
        ok('Operário segue como antes: sem Receitas por padrão, com Dispenser');
        assert.strictEqual((await chamar('POST', '/api/receitas/aplicar', dono, { indice: 1 })).status, 200); ok('Dono aplica receita normalmente');

        console.log('2) Visualizador: o que pode');
        for (const rota of ['/dashboard', '/dispenser', '/separador', '/receitas', '/graficos', '/relatorios', '/visao', '/chat', '/logs', '/controle', '/sistema', '/usuarios', '/configuracoes'])
            assert.strictEqual((await chamar('GET', rota, vis)).status, 200, 'nao abriu ' + rota);
        ok('abre todas as 13 telas (padrão: todas liberadas)');
        const painel = (await chamar('GET', '/dashboard', vis)).texto;
        assert.ok(painel.includes('somente-leitura') && painel.includes('window.__somenteLeitura = true')); ok('a tela vem marcada como somente leitura');
        for (const rota of ['/api/receitas', '/api/dispenser/estado', '/api/separador/estado', '/api/usuarios', '/api/painel/estado', '/api/emergencia', '/api/esteira/status'])
            assert.strictEqual((await chamar('GET', rota, vis)).status, 200, 'nao leu ' + rota);
        ok('lê os dados em tempo real (receitas, dispenser, separador, usuários, painel, emergência)');
        let r = await chamar('POST', '/api/chat', vis, { pergunta: 'oi' }); assert.strictEqual(r.status, 200); assert.ok(r.json && r.json.resposta); ok('conversa com a IA');

        console.log('3) Visualizador: o que NÃO pode (HTTP)');
        gravado.length = 0;
        const proibidos = [
            ['POST', '/api/receitas/aplicar', { indice: 1 }], ['POST', '/api/receitas', { niveis: [] }],
            ['POST', '/api/dispenser/dosar', { gramas: 100, reservatorios: ['A'] }], ['POST', '/api/dispenser/parar', {}],
            ['POST', '/api/dispenser/config', {}], ['POST', '/api/dispenser/teste', {}],
            ['POST', '/api/separador/servo/teste', { lado: 'E' }], ['POST', '/api/separador/servo/ref-velocidade', {}],
            ['POST', '/api/separador/config', { servoAtivo: true }], ['POST', '/api/separador/fundo', {}],
            ['POST', '/api/separador/treino/iniciar', {}], ['POST', '/api/separador/treino/parar', {}], ['DELETE', '/api/separador/treino/x'],
            ['POST', '/api/visao/config', {}], ['POST', '/api/visao/produtos', {}], ['POST', '/api/visao/produtos/capturar', {}], ['DELETE', '/api/visao/produtos/x'],
            ['POST', '/api/emergencia/liberar', {}],
            ['POST', '/api/usuarios', { usuario: 'intruso', senha: '1234', nivel: 1 }],
            ['POST', '/api/usuarios/operario/senha', { senha: 'abcd' }], ['POST', '/api/usuarios/operario/nivel', { nivel: 1 }],
            ['POST', '/api/usuarios/operario/permissoes', { permissoes: {} }], ['POST', '/api/usuarios/visualizador/telas', { telas: [] }],
            ['DELETE', '/api/usuarios/operario'], ['POST', '/mudar-senha', {}]
        ];
        for (const [m, p, corpo] of proibidos) { r = await chamar(m, p, vis, corpo || {}); assert.strictEqual(r.status, 403, `${m} ${p} devolveu ${r.status}`); }
        await esperar(500);
        ok(`${proibidos.length} ações de controle e de cadastro recusadas (403)`);
        assert.strictEqual(movimentos().length, 0, 'vazou para o MQTT: ' + movimentos().join(' | ')); ok('nada chegou ao MQTT');
        const lista = (await chamar('GET', '/api/usuarios', dono)).json.usuarios;
        assert.ok(!lista.find(u => u.usuario === 'intruso') && lista.find(u => u.usuario === 'operario').nivel === 3 && lista.find(u => u.usuario === 'dono').nivel === 1);
        ok('nenhum usuário foi criado, apagado ou promovido');

        console.log('4) Visualizador: o que NÃO pode (socket)');
        const sockVis = ioc(B, { extraHeaders: { cookie: vis }, transports: ['websocket'] });
        const erros = []; sockVis.on('error', e => erros.push(e)); await new Promise(res => sockVis.on('connect', res));
        const antes = (await chamar('GET', '/api/esteira/status', vis)).json.velocidade;
        gravado.length = 0;
        sockVis.emit('comando_esteira', { acao: 'velocidade', valor: 0.9 }); sockVis.emit('comando_esteira', { acao: 'emergencia' });
        sockVis.emit('comando_painel', { acao: 'velocidade', id: 's1m1', valor: 0.8 }); sockVis.emit('comando_sentido', { acao: 'inverter' });
        sockVis.emit('comando_selagem', { acao: 'setpoint', valor: 150 }); sockVis.emit('comando_selagem', { acao: 'ativar', valor: true });
        sockVis.emit('comando_selagem2', { acao: 'setpoint', valor: 150 }); sockVis.emit('novo_log', { hora: '00:00', texto: 'intruso' });
        sockVis.emit('registrar_producao', { dataPtBr: '01/01/2000', pacotes: 999 });
        await esperar(900);
        assert.strictEqual(gravado.length, 0, 'o servidor publicou no MQTT: ' + gravado.join(' | ')); ok('9 eventos de controle por socket descartados, nada no MQTT');
        assert.strictEqual((await chamar('GET', '/api/esteira/status', vis)).json.velocidade, antes); ok('a velocidade da esteira não mudou');
        assert.ok(sockVis.connected); ok('a tela continua conectada recebendo dados');
        const sockDono = ioc(B, { extraHeaders: { cookie: dono }, transports: ['websocket'] }); await new Promise(res => sockDono.on('connect', res));
        gravado.length = 0; sockDono.emit('comando_esteira', { acao: 'velocidade', valor: 0.4 }); await esperar(500);
        assert.ok(gravado.some(x => x.startsWith('esteira/velocidade/set 0.4'))); ok('(controle) o mesmo comando feito pelo Dono funciona');
        sockDono.close(); sockVis.close();
        const semLogin = ioc(B, { transports: ['websocket'], reconnection: false });
        const motivo = await new Promise(res => { semLogin.on('connect_error', e => res(e.message)); semLogin.on('connect', () => res('conectou')); });
        assert.strictEqual(motivo, 'nao autorizado'); ok('quem não fez login nem consegue conectar no socket'); semLogin.close();

        console.log('5) Telas liberadas pelo Dono');
        r = await chamar('POST', '/api/usuarios', adm, { usuario: 'vis_adm', senha: '1234', nivel: 4 }); assert.strictEqual(r.status, 403); ok('Administrador não cria Visualizador (só o Dono)');
        r = await chamar('POST', '/api/usuarios', dono, { usuario: 'vis2', senha: '1234', nivel: 4 }); assert.strictEqual(r.status, 200);
        let novo = (await chamar('GET', '/api/usuarios', dono)).json.usuarios.find(u => u.usuario === 'vis2');
        assert.strictEqual(novo.nomeNivel, 'Visualizador'); assert.strictEqual(novo.telasPermitidas.length, 12); ok('Visualizador novo nasce com todas as 12 telas ligadas');
        r = await chamar('POST', '/api/usuarios/vis2/telas', adm, { telas: [] }); assert.strictEqual(r.status, 403); ok('Administrador não mexe nas telas (só o Dono)');
        r = await chamar('POST', '/api/usuarios/operario/telas', dono, { telas: [] }); assert.strictEqual(r.status, 400); ok('só dá para escolher telas de Visualizador');
        const vis2 = await entrar('vis2');
        r = await chamar('POST', '/api/usuarios/vis2/telas', dono, { telas: ['dispenser', 'chat', 'usuarios'] }); assert.strictEqual(r.status, 200);
        r = await chamar('GET', '/receitas', vis2); assert.ok(r.status === 302 && r.local === '/dashboard'); ok('tela desligada (Receitas): volta para o dashboard');
        r = await chamar('GET', '/api/sistema/status', vis2); assert.strictEqual(r.status, 403); ok('a API da tela desligada também é recusada');
        assert.strictEqual((await chamar('GET', '/sistema', vis2)).status, 302); ok('Status do Sistema desligado: efeito imediato, sem novo login');
        assert.strictEqual((await chamar('GET', '/dispenser', vis2)).status, 200); ok('tela ligada (Dispenser) abre');
        const menu2 = (await chamar('GET', '/dashboard', vis2)).texto;
        assert.ok(menu2.includes('href="/dispenser"') && menu2.includes('href="/chat"') && menu2.includes('href="/usuarios"') && !menu2.includes('href="/sistema"') && !menu2.includes('href="/receitas"') && !menu2.includes('href="/controle"'));
        ok('o menu mostra só as telas liberadas');
        r = await chamar('POST', '/api/usuarios/vis2/telas', dono, { telas: ['dispenser'] }); assert.strictEqual(r.status, 200);
        assert.strictEqual((await chamar('GET', '/usuarios', vis2)).status, 302); ok('Dono desliga "Usuários" e vale na hora');
        r = await chamar('POST', '/api/usuarios', vis, { usuario: 'x', senha: '1234', nivel: 3 }); assert.strictEqual(r.status, 403); ok('com a tela Usuários liberada, ela é somente leitura');

        console.log('6) Registro das tentativas');
        const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
        const logs = (await chamar('GET', '/api/logs/' + hoje, dono)).json || [];
        assert.ok(logs.some(l => /Visualizador visualizador tentou/.test(l.texto) && /bloqueado/.test(l.texto)), 'sem registro das tentativas');
        ok('as tentativas bloqueadas ficam nos Logs');

        console.log('\nETAPA 2: TUDO OK'); fim(0);
    } catch (err) {
        console.log('\nFALHOU:', String(err.message).slice(0, 500)); console.log('--- log do site:\n' + saida.slice(-900)); fim(1);
    }
})();
