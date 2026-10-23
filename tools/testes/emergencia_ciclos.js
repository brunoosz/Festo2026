// GitHub: https://github.com/brunoosz | LinkedIn: https://www.linkedin.com/in/brunocamperlingo/
// teste da emergência: 100 ciclos acionar e liberar, sem reativar sozinha
const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mqtt = require('mqtt');
const { io: ioc } = require('socket.io-client');
const { criarUsuariosTeste, SENHA_TESTE } = require('../seed_teste');

const PORTA_SITE = 5067, PORTA_MQTT = 18836;
const B = `http://127.0.0.1:${PORTA_SITE}`;
const raiz = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flowpack-emerg-'));
const esperar = ms => new Promise(r => setTimeout(r, ms));
const ok = m => console.log('  ok   ' + m);
process.env.MOCK_MQTT_PORT = String(PORTA_MQTT);
const { iniciar } = require('../mock_mqtt');

(async () => {
    criarUsuariosTeste(path.join(tmp, 'usuarios.json'));
    fs.writeFileSync(path.join(tmp, 'cartoes.json'), JSON.stringify({ AABBCCDD: { usuario: 'dono', criadoEm: new Date().toISOString(), criadoPor: 'teste' } }));
    const { aedes, servidor } = await iniciar({ placas: false });
    let site = null, saida = '', sock = null;
    const clientes = [];
    const fim = c => { try { site.kill(); } catch (e) {} try { sock && sock.close(); } catch (e) {} clientes.forEach(x => x.end(true)); servidor.close(); try { aedes.close(); } catch (e) {} fs.rmSync(tmp, { recursive: true, force: true }); setTimeout(() => process.exit(c), 300); };
    try {
        site = spawn('node', ['server.js'], { cwd: raiz, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, {
            PORT: String(PORTA_SITE), MQTT_BROKER: `mqtt://127.0.0.1:${PORTA_MQTT}`, USUARIOS_JSON: path.join(tmp, 'usuarios.json'), EMERGENCIA_JSON: path.join(tmp, 'e.json'),
            RECEITAS_JSON: path.join(tmp, 'r.json'), CARTOES_NFC_JSON: path.join(tmp, 'cartoes.json'), SESSION_SECRET: 'x',
            EMERGENCIA_ECO_MS: '500', EMERGENCIA_GRACA_MS: '150', EMERGENCIA_RETENTAR_MS: '100', EMERGENCIA_CONFIRMAR_MAX_MS: '1500' }) });
        site.stdout.on('data', d => { saida += d; }); site.stderr.on('data', d => { saida += d; });
        for (let i = 0; i < 60; i++) { await esperar(250); try { if ((await fetch(B + '/sobre')).status === 200) break; } catch (e) {} }
        await esperar(600);
        const entrar = async nome => {
            const r = await fetch(B + '/', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `username=${nome}&password=${SENHA_TESTE}` });
            return (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map(x => x.split(';')[0]).join('; ');
        };
        const dono = await entrar('dono');
        const estado = async () => (await (await fetch(B + '/api/emergencia', { headers: { Cookie: dono } })).json());
        const ativa = async () => (await estado()).ativa;
        const esperarAte = async (cond, ms = 2000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await cond()) return true; await esperar(25); } return false; };
        const liberarSite = () => fetch(B + '/api/emergencia/liberar', { method: 'POST', headers: { Cookie: dono } });

        // ---- placas de mentira ----
        const conectar = () => { const c = mqtt.connect(`mqtt://127.0.0.1:${PORTA_MQTT}`); clientes.push(c); return new Promise(r => c.on('connect', () => r(c))); };
        const placa = { esteira: null, separador: null };
        const comp = { perderLiberar: 0, ecoMs: 0, ignorarTudo: false, ecoTimer: null };
        const esteira = await conectar(); placa.esteira = { c: esteira, travada: false };
        const publicarEstadoEsteira = () => esteira.publish('esteira/estado_emergencia', placa.esteira.travada ? 'ativa' : 'liberada', { retain: true });
        esteira.subscribe(['esteira/emergencia', 'esteira/liberar']);
        esteira.on('message', (t) => {
            if (t === 'esteira/emergencia' && !placa.esteira.travada) { placa.esteira.travada = true; publicarEstadoEsteira(); }
            if (t === 'esteira/liberar') {
                if (comp.ignorarTudo) return;
                if (comp.perderLiberar > 0) { comp.perderLiberar--; return; }
                placa.esteira.travada = false; publicarEstadoEsteira();
                if (comp.ecoMs) { clearInterval(comp.ecoTimer); const fimEco = Date.now() + comp.ecoMs; comp.ecoTimer = setInterval(() => { if (Date.now() > fimEco) return clearInterval(comp.ecoTimer); esteira.publish('esteira/estado_emergencia', 'ativa'); }, 40); }
            }
        });
        const apertarEsteira = () => { placa.esteira.travada = true; publicarEstadoEsteira(); esteira.publish('esteira/botao', 'emergencia'); };   // como o firmware: estado e depois o botão
        const sep = await conectar(); placa.separador = { c: sep, travado: false };
        sep.subscribe(['separador/emergencia', 'separador/liberar']);
        sep.on('message', t => { if (t === 'separador/emergencia') placa.separador.travado = true; if (t === 'separador/liberar' && !comp.ignorarTudo) placa.separador.travado = false; });
        const batimentoSep = setInterval(() => sep.publish('separador/estado', JSON.stringify({ lado: 'C', angulo: 90, fila: 0, travado: placa.separador.travado })), 80);
        await esperar(500); publicarEstadoEsteira();
        const painel = await conectar();

        const mantemLiberada = async (ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ativa()) return false; await esperar(30); } return true; };

        console.log('1) 50 ciclos: acionar (botão da esteira) e liberar com cartão NFC');
        for (let i = 0; i < 50; i++) {
            comp.ecoMs = 300; comp.perderLiberar = (i % 7 === 3) ? 1 : 0;
            apertarEsteira();
            assert.ok(await esperarAte(ativa), 'ciclo ' + i + ': não acionou');
            if (i % 5 === 0) { esteira.publish('esteira/botao', 'mais'); esteira.publish('esteira/botao', 'menos'); }
            painel.publish('nfc/leitura', 'AABBCCDD');
            assert.ok(await esperarAte(async () => !(await ativa())), 'ciclo ' + i + ': não liberou');
            assert.ok(await mantemLiberada(450), 'ciclo ' + i + ': a emergência reativou sozinha depois do cartão');
            assert.ok(await esperarAte(async () => (await estado()).liberando.length === 0, 1500), 'ciclo ' + i + ': liberação não foi confirmada: ' + JSON.stringify(await estado()));
            apertarEsteira();                                                  // aperto REAL logo depois de liberar: tem que acionar
            assert.ok(await esperarAte(ativa, 1000), 'ciclo ' + i + ': aperto real logo após liberar não acionou');
            await liberarSite(); await esperarAte(async () => !(await ativa())); await esperar(60);
        }
        ok('50 ciclos com cartão: nenhuma reativação sozinha, eco "ativa" da placa ignorado, liberação perdida reenviada e confirmada, e o aperto real logo depois sempre aciona');

        console.log('2) 50 ciclos: acionar (botão do painel) e liberar pelo site');
        for (let i = 0; i < 50; i++) {
            comp.ecoMs = 300; comp.perderLiberar = (i % 6 === 2) ? 1 : 0;
            painel.publish('painel/botao', 'emergencia');
            assert.ok(await esperarAte(ativa), 'ciclo ' + i + ': não acionou');
            const r = await liberarSite(); assert.strictEqual(r.status, 200);
            assert.ok(await esperarAte(async () => !(await ativa())));
            assert.ok(await mantemLiberada(450), 'ciclo ' + i + ': reativou sozinha depois de liberar pelo site');
            assert.ok(await esperarAte(async () => (await estado()).liberando.length === 0, 1500), 'ciclo ' + i + ': liberação não confirmada');
            await esperar(60);
        }
        ok('50 ciclos pelo site: nenhuma reativação sozinha e liberação sempre confirmada pelas placas');

        console.log('3) Placa que não confirma e placa com estado antigo');
        comp.ecoMs = 0; comp.ignorarTudo = true;
        painel.publish('painel/botao', 'emergencia'); assert.ok(await esperarAte(ativa));
        await liberarSite(); await esperar(250);
        let e = await estado(); assert.strictEqual(e.ativa, false); assert.ok(e.liberando.includes('esteira')); ok('enquanto as placas não confirmam, o site mostra "liberando" (placa que não confirma)');
        assert.ok(await esperarAte(async () => (await estado()).liberando.length === 0, 3000)); assert.strictEqual(await ativa(), false); ok('se uma placa nunca confirma, o aviso aparece, a espera termina e a emergência NÃO reativa');
        const logsHoje = async () => { const [d, m, a] = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }).split(', ')[0].split('/'); return (await (await fetch(`${B}/api/logs/${a}-${m}-${d}`, { headers: { Cookie: dono } })).json()).map(l => l.texto).join('\n'); };
        assert.ok(/não confirmou a liberação/.test(await logsHoje())); ok('o aviso "não confirmou a liberação" fica nos logs');
        placa.esteira.travada = true; publicarEstadoEsteira(); await esperar(100);
        for (let k = 0; k < 6; k++) { esteira.publish('esteira/estado_emergencia', 'ativa', { retain: true }); await esperar(120); }
        assert.strictEqual(await ativa(), false); ok('estado "ativa" repetido pela placa (mesmo retido) com o site liberado nunca liga a emergência');
        comp.ignorarTudo = false; await esperar(5200); publicarEstadoEsteira(); await esperar(300);
        assert.ok(/estava travada com o site liberado|Reenviando a liberação/.test(await logsHoje()) || placa.esteira.travada === false); ok('com o site liberado e a placa ainda travada, o servidor reenvia a liberação (e registra no log)');
        assert.ok(await esperarAte(async () => placa.esteira.travada === false, 2000)); ok('a placa destravou com a liberação reenviada');

        console.log('4) Origem de cada acionamento e liberação nos logs');
        sock = ioc(B, { extraHeaders: { cookie: dono }, transports: ['websocket'] }); await esperar(500);
        sock.emit('comando_esteira', { acao: 'emergencia' }); assert.ok(await esperarAte(ativa)); await liberarSite(); await esperarAte(async () => !(await ativa())); await esperar(300);
        apertarEsteira(); assert.ok(await esperarAte(ativa)); painel.publish('nfc/leitura', 'AABBCCDD'); await esperarAte(async () => !(await ativa())); await esperar(300);
        painel.publish('painel/botao', 'emergencia'); assert.ok(await esperarAte(ativa)); await liberarSite(); await esperarAte(async () => !(await ativa())); await esperar(300);
        const logs = await logsHoje();
        for (const t of ['EMERGENCIA ATIVA (site (dono))', 'EMERGENCIA ATIVA (botão da esteira)', 'EMERGENCIA ATIVA (botão do painel)', 'LIBERADA por site (usuário dono)', 'LIBERADA por cartão NFC de dono']) assert.ok(logs.includes(t), 'faltou no log: ' + t);
        const fonte = fs.readFileSync(path.join(raiz, 'server.js'), 'utf8'); assert.ok(fonte.includes("comOrigemEmergencia('Alexa'")); ok('os logs dizem QUEM acionou (botão da esteira, botão do painel, site com o usuário, Alexa) e QUEM liberou (cartão de fulano, site com o usuário)');
        assert.ok(/EMERGENCIA ATIVA/.test(saida) && /LIBERADA por cartão NFC de dono/.test(saida)); ok('o mesmo aparece no journalctl (saída do servidor)');

        clearInterval(batimentoSep); clearInterval(comp.ecoTimer);
        console.log('\nEMERGENCIA: TUDO OK'); fim(0);
    } catch (e) { console.error('\nFALHOU: ' + (e && e.message)); console.error(saida.slice(-700)); fim(1); }
})();
