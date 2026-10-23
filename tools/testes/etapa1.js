// GitHub: https://github.com/brunoosz | LinkedIn: https://www.linkedin.com/in/brunocamperlingo/
// teste etapa 1
const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mqtt = require('mqtt');
const { io: ioc } = require('socket.io-client');
const { criarUsuariosTeste, SENHA_TESTE } = require('../seed_teste');

const PORTA_SITE = 5055, PORTA_MQTT = 18830;
const B = `http://127.0.0.1:${PORTA_SITE}`;
const raiz = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flowpack-teste-'));
const esperar = ms => new Promise(r => setTimeout(r, ms));
const ok = m => console.log('  ok   ' + m);

process.env.MOCK_MQTT_PORT = String(PORTA_MQTT);
const { iniciar } = require('../mock_mqtt');

(async () => {
    criarUsuariosTeste(path.join(tmp, 'usuarios.json'));
    const { aedes, servidor } = await iniciar({ placas: false });
    const gravado = [];
    aedes.on('publish', (p, c) => { if (c) gravado.push(p.topic + ' ' + p.payload.toString()); });

    let site = null, saida = '';
    const subir = async () => {
        site = spawn('node', ['server.js'], {
            cwd: raiz, stdio: ['ignore', 'pipe', 'pipe'],
            env: Object.assign({}, process.env, {
                PORT: String(PORTA_SITE), MQTT_BROKER: `mqtt://127.0.0.1:${PORTA_MQTT}`,
                USUARIOS_JSON: path.join(tmp, 'usuarios.json'), EMERGENCIA_JSON: path.join(tmp, 'emergencia.json'),
                RECEITAS_JSON: path.join(tmp, 'receitas.json'), SESSION_SECRET: 'segredo-so-de-teste'
            })
        });
        site.stdout.on('data', d => { saida += d; }); site.stderr.on('data', d => { saida += d; });
        for (let i = 0; i < 60; i++) { await esperar(250); try { const r = await fetch(B + '/sobre'); if (r.status === 200) return; } catch (e) {} }
        throw new Error('o site nao subiu');
    };
    const fim = codigo => { try { site.kill(); } catch (e) {} servidor.close(); try { aedes.close(); } catch (e) {} fs.rmSync(tmp, { recursive: true, force: true }); setTimeout(() => process.exit(codigo), 300); };

    try {
        await subir();

        console.log('1) Pagina "Sobre nos"');
        let r = await fetch(B + '/sobre', { redirect: 'manual' });
        assert.strictEqual(r.status, 200); ok('GET /sobre abre SEM login (200)');
        const html = await r.text();
        assert.ok(html.includes('Dark Coders') && html.includes('Bruno Ridolfi'), 'faltou o conteudo');
        ok('mostra a equipe e o projeto');
        assert.ok(!/(src|href)="https?:\/\/[^"]*\.(js|css|woff2?)"|<script[^>]+src="https?:|<link[^>]+href="https?:|<img[^>]+src="https?:/.test(html), 'tem recurso externo (CDN)'); ok('funciona offline (nenhum script, estilo ou imagem externos)');
        assert.ok(!/socket\.io|\/api\//.test(html), 'expoe API/socket'); ok('nao expoe nenhuma API nem socket');
        assert.ok(!/RM \d/.test(html), 'mostrou RM'); ok('RM escondido por padrao');
        assert.ok(html.includes('href="/"') && /entrar no sistema/i.test(html), 'sem botao de entrar'); ok('tem o botao "Entrar no sistema"');
        const login = await (await fetch(B + '/')).text();
        assert.ok(login.includes('href="/sobre"') && login.includes('Sobre nós'), 'sem link no login'); ok('o link "Sobre nos" aparece na tela de login');
        r = await fetch(B + '/dashboard', { redirect: 'manual' });
        assert.ok(r.status === 302 && r.headers.get('location') === '/', 'dashboard sem login'); ok('/dashboard sem login continua pedindo login');
        r = await fetch(B + '/api/emergencia', { redirect: 'manual' }); assert.strictEqual(r.status, 302); ok('as APIs continuam protegidas por login');

        console.log('2) Emergencia travada (fase 4)');
        const entrar = async u => {
            const resp = await fetch(B + '/', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `username=${u}&password=${SENHA_TESTE}` });
            const c = (resp.headers.getSetCookie ? resp.headers.getSetCookie() : []).map(x => x.split(';')[0]).join('; ');
            assert.ok(c.includes('connect.sid'), 'login falhou para ' + u); return c;
        };
        const get = async (p, c) => { const x = await fetch(B + p, { headers: { Cookie: c } }); let j = null; try { j = await x.json(); } catch (e) {} return { status: x.status, json: j }; };
        const enviar = async (p, c, corpo) => { const x = await fetch(B + p, { method: 'POST', headers: { Cookie: c, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo || {}) }); let j = null; try { j = await x.json(); } catch (e) {} return { status: x.status, json: j }; };
        let dono = await entrar('dono'), oper = await entrar('operario'), adm = await entrar('adm');
        const esp = mqtt.connect(`mqtt://127.0.0.1:${PORTA_MQTT}`); await new Promise(res => esp.on('connect', res));
        const sock = ioc(B, { extraHeaders: { cookie: dono }, transports: ['websocket'] });
        const eventos = []; sock.on('emergencia_estado', d => eventos.push(d)); await esperar(700);

        assert.strictEqual((await get('/api/emergencia', oper)).json.ativa, false); ok('comeca sem emergencia');
        assert.strictEqual(eventos[eventos.length - 1].ativa, false); ok('a tela recebe o estado ao conectar');

        gravado.length = 0; esp.publish('esteira/botao', 'emergencia'); await esperar(700);
        let e = (await get('/api/emergencia', oper)).json;
        assert.strictEqual(e.ativa, true); ok('botao fisico da esteira trava a maquina (origem: ' + e.origem + ')');
        ['esteira/emergencia 1', 'selagem/emergencia 1', 'selagem2/emergencia 1', 'dispenser/emergencia 1', 'separador/emergencia 1']
            .forEach(x => assert.ok(gravado.includes(x), 'faltou ' + x));
        ok('manda emergencia para esteira, selagens, dispenser e separador');
        assert.strictEqual(eventos[eventos.length - 1].ativa, true); ok('todas as telas abertas travam');

        gravado.length = 0; sock.emit('comando_esteira', { acao: 'velocidade', valor: 0.7 }); await esperar(500);
        assert.ok(!gravado.some(x => x.startsWith('esteira/velocidade/set')), 'velocidade vazou'); ok('velocidade da esteira bloqueada');
        esp.publish('esteira/botao', 'mais'); await esperar(400);
        assert.ok(!gravado.some(x => /\/set(_temperatura)? /.test(x)), 'botao MAIS vazou'); ok('botao MAIS ignorado');
        r = await enviar('/api/receitas/aplicar', dono, { indice: 2 }); assert.strictEqual(r.status, 423); ok('aplicar receita: 423');
        r = await enviar('/api/dispenser/dosar', oper, { gramas: 100, reservatorios: ['A'] }); assert.strictEqual(r.status, 423); ok('dosar no dispenser: 423');
        r = await enviar('/api/separador/servo/teste', adm, { lado: 'E' }); assert.strictEqual(r.status, 423); ok('testar o servo: 423');
        gravado.length = 0; sock.emit('comando_esteira', { acao: 'emergencia' }); await esperar(400);
        assert.ok(gravado.includes('esteira/emergencia 1')); ok('mas o comando de emergencia continua passando');

        console.log('3) Reiniciar o site NAO destrava');
        sock.close(); site.kill(); await esperar(800); await subir();
        dono = await entrar('dono'); oper = await entrar('operario');
        e = (await get('/api/emergencia', oper)).json; assert.strictEqual(e.ativa, true); ok('depois de reiniciar, a emergencia continua ativa');

        console.log('4) Liberar no site');
        r = await enviar('/api/emergencia/liberar', oper); assert.strictEqual(r.status, 403); ok('Operário não consegue liberar pelo site (só Dono ou Adm)');
        gravado.length = 0; r = await enviar('/api/emergencia/liberar', dono); assert.strictEqual(r.json.ativa, false); await esperar(500);
        ok('Dono libera pelo site');
        assert.ok(gravado.includes('esteira/liberar 1') && gravado.includes('separador/liberar 1')); ok('o site manda esteira/liberar e separador/liberar');
        gravado.length = 0; r = await enviar('/api/receitas/aplicar', dono, { indice: 1 }); assert.strictEqual(r.status, 200); await esperar(400);
        assert.ok(gravado.some(x => x.startsWith('esteira/velocidade/set'))); ok('depois de liberar, tudo volta a funcionar');

        console.log('5) Estado antigo da esteira nao liga a emergencia');
        esp.publish('esteira/estado_emergencia', 'ativa'); await esperar(600);
        e = (await get('/api/emergencia', dono)).json; assert.strictEqual(e.ativa, false); ok('a esteira avisa "ativa" com o site liberado: o site NAO trava (so reenvia a liberacao)');
        await enviar('/api/emergencia/liberar', dono); await esperar(300);

        esp.end(true);
        console.log('\nETAPA 1: TUDO OK'); fim(0);
    } catch (err) {
        console.log('\nFALHOU:', String(err.message).slice(0, 400)); console.log('--- log do site:\n' + saida.slice(-900)); fim(1);
    }
})();
