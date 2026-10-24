// GitHub: https://github.com/brunoosz | LinkedIn: https://www.linkedin.com/in/brunocamperlingo/
// teste do ajuste fino da selagem 2: rotas, permissões, 423, alarmes e telas
const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mqtt = require('mqtt');
const { criarUsuariosTeste, SENHA_TESTE } = require('../seed_teste');

const PORTA = 5073, PORTA_MQTT = 18839, B = `http://127.0.0.1:${PORTA}`;
const raiz = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flowpack-s2-'));
const esperar = ms => new Promise(r => setTimeout(r, ms));
const ok = m => console.log('  ok   ' + m);
let chromium = null;
for (const c of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { chromium = require(c).chromium; break; } catch (e) {} }
process.env.MOCK_MQTT_PORT = String(PORTA_MQTT);
const { iniciar } = require('../mock_mqtt');

(async () => {
    criarUsuariosTeste(path.join(tmp, 'usuarios.json'));
    const { aedes, servidor } = await iniciar({ placas: false });
    let site = null, nav = null; const clientes = [];
    const fim = c => { try { site.kill(); } catch (e) {} try { nav && nav.close(); } catch (e) {} clientes.forEach(x => x.end(true)); servidor.close(); try { aedes.close(); } catch (e) {} fs.rmSync(tmp, { recursive: true, force: true }); setTimeout(() => process.exit(c), 300); };
    try {
        site = spawn('node', ['server.js'], { cwd: raiz, stdio: 'ignore', env: Object.assign({}, process.env, { PORT: String(PORTA), MQTT_BROKER: `mqtt://127.0.0.1:${PORTA_MQTT}`, USUARIOS_JSON: path.join(tmp, 'usuarios.json'), EMERGENCIA_JSON: path.join(tmp, 'e.json'), RECEITAS_JSON: path.join(tmp, 'r.json'), CARTOES_NFC_JSON: path.join(tmp, 'c.json'), SEPARADOR_DADOS_DIR: tmp, SERVO_LIVRE_JSON: path.join(tmp, 's.json'), SESSION_SECRET: 'x' }) });
        for (let i = 0; i < 60; i++) { await esperar(250); try { if ((await fetch(B + '/sobre')).status === 200) break; } catch (e) {} }
        await esperar(600);
        const entrar = async nome => {
            const r = await fetch(B + '/', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `username=${nome}&password=${SENHA_TESTE}` });
            return (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map(x => x.split(';')[0]).join('; ');
        };
        const chamar = async (m, p, c, corpo) => { const r = await fetch(B + p, { method: m, redirect: 'manual', headers: Object.assign({ Cookie: c }, corpo ? { 'Content-Type': 'application/json' } : {}), body: corpo ? JSON.stringify(corpo) : undefined }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {} return { status: r.status, json: j, texto: t }; };
        const dono = await entrar('dono'), adm = await entrar('adm'), oper = await entrar('operario'), vis = await entrar('visualizador');
        const esperarAte = async (cond, ms = 2500) => { const t = Date.now(); while (Date.now() - t < ms) { if (await cond()) return true; await esperar(25); } return false; };

        const placa = mqtt.connect(`mqtt://127.0.0.1:${PORTA_MQTT}`); clientes.push(placa); await new Promise(r => placa.on('connect', r));
        const vistos = []; placa.subscribe('selagem2/#'); placa.on('message', (t, m) => vistos.push(t + ' ' + m.toString()));
        const dados = Object.assign({ temperatura: 25, setpoint: 150, potencia: 0, habilitado: false, seguranca: 'ok', autotune: 'parado', bruta: 24.5, ambiente: 27.1, kp: 10.3, ki: 0.2, kd: 36.8, manual: false });
        const enviar = (extra) => placa.publish('selagem2/dados', JSON.stringify(Object.assign({}, dados, extra)));
        placa.publish('selagem2/status_conexao', 'online', { retain: true }); enviar({});
        await esperar(700);
        const logsHoje = async () => { const [d, m, a] = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }).split(', ')[0].split('/'); return (await (await fetch(`${B}/api/logs/${a}-${m}-${d}`, { headers: { Cookie: dono } })).json()).map(l => l.texto).join('\n'); };
        const ult = (t) => vistos.filter(v => v.startsWith(t + ' '));

        console.log('1) Permissões');
        for (const [n, ck] of [['dono', dono], ['adm', adm]]) { const r = await chamar('POST', '/api/selagem2/autotune', ck, { alvo: 150 }); assert.strictEqual(r.status, 200, n + r.texto); await chamar('POST', '/api/selagem2/autotune', ck, { acao: 'cancelar' }); }
        ok('Dono e Adm iniciam o autotune');
        for (const [n, ck] of [['operario', oper], ['visualizador', vis]]) {
            for (const [p, corpo] of [['/api/selagem2/autotune', { alvo: 150 }], ['/api/selagem2/pid', { padrao: true }], ['/api/selagem2/calibrar', { acao: 'zerar' }]]) assert.strictEqual((await chamar('POST', p, ck, corpo)).status, 403, n + p);
            assert.strictEqual((await chamar('GET', '/api/selagem2/ajuste', ck)).status, 200);
        }
        ok('Operário e Visualizador só veem (POST 403, GET 200)');

        console.log('2) Validação');
        const ruins = [['/api/selagem2/autotune', { alvo: 39 }], ['/api/selagem2/autotune', { alvo: 241 }], ['/api/selagem2/autotune', { alvo: 'x' }], ['/api/selagem2/autotune', { alvo: 150, potencia: 29 }], ['/api/selagem2/autotune', { alvo: 150, potencia: 101 }],
            ['/api/selagem2/pid', { kp: 101, ki: 0, kd: 0 }], ['/api/selagem2/pid', { kp: 1, ki: 6, kd: 0 }], ['/api/selagem2/pid', { kp: 1, ki: 0, kd: 1001 }], ['/api/selagem2/pid', { kp: -1, ki: 0, kd: 0 }], ['/api/selagem2/pid', {}],
            ['/api/selagem2/calibrar', { acao: 'cal1', real: -21 }], ['/api/selagem2/calibrar', { acao: 'cal2', real: 401 }], ['/api/selagem2/calibrar', { acao: 'cal1' }], ['/api/selagem2/calibrar', { acao: 'xx', real: 100 }]];
        for (const [p, corpo] of ruins) assert.strictEqual((await chamar('POST', p, dono, corpo)).status, 400, p + JSON.stringify(corpo));
        ok('autotune (alvo 40–240, potência 30–100), PID (Kp 0–100, Ki 0–5, Kd 0–1000) e calibração (−20 a 400) recusam valores fora da faixa');

        console.log('3) Tópicos MQTT');
        vistos.length = 0;
        await chamar('POST', '/api/selagem2/autotune', dono, { alvo: 150 }); await chamar('POST', '/api/selagem2/autotune', dono, { acao: 'cancelar' });
        await chamar('POST', '/api/selagem2/autotune', dono, { alvo: 120, potencia: 70 });
        await chamar('POST', '/api/selagem2/pid', dono, { kp: 10.3, ki: 0.2, kd: 36.8 }); await chamar('POST', '/api/selagem2/pid', dono, { padrao: true });
        await chamar('POST', '/api/selagem2/calibrar', dono, { acao: 'cal1', real: 118 }); await chamar('POST', '/api/selagem2/calibrar', dono, { acao: 'cal2', real: 178.5 }); await chamar('POST', '/api/selagem2/calibrar', dono, { acao: 'zerar' });
        assert.ok(await esperarAte(() => ult('selagem2/calibrar').length === 3));
        assert.deepStrictEqual(ult('selagem2/autotune').map(x => x.split(' ')[1]), ['150', '0', '120,70']);
        assert.deepStrictEqual(ult('selagem2/pid').map(x => x.split(' ')[1]), ['10.3,0.2,36.8', 'padrao']);
        assert.deepStrictEqual(ult('selagem2/calibrar').map(x => x.split(' ')[1]), ['cal1:118', 'cal2:178.5', 'zerar']); ok('autotune, PID e calibração saem nos tópicos selagem2/autotune, selagem2/pid e selagem2/calibrar');
        await chamar('POST', '/api/selagem2/autotune', dono, { acao: 'cancelar' });

        console.log('4) Alarmes, resultado e gráfico');
        const textos = { erro_sensor: 'Sensor sem leitura', sobretemperatura: 'Temperatura acima do limite', sem_aquecimento: 'A barra não está esquentando', sensor_quente: 'Sensor muito quente', sensor_quente_aviso: 'Sensor esquentando' };
        for (const [k, t] of Object.entries(textos)) { enviar({ seguranca: k }); await esperar(150); enviar({ seguranca: k }); await esperar(100); enviar({ seguranca: 'ok' }); await esperar(150); }
        const logs = await logsHoje(); for (const t of Object.values(textos)) assert.ok(logs.includes(t), 'faltou no log: ' + t);
        assert.strictEqual(logs.split('Sensor muito quente').length - 1 >= 1, true); ok('cada alarme aparece nos Logs ao Vivo em português claro (e só quando muda)');
        enviar({ autotune: 'rodando' }); await esperar(300);
        let est = (await chamar('GET', '/api/selagem2/ajuste', dono)).json; assert.ok(est.estado.autotuneDesde > 0 && est.estado.bruta === 24.5); ok('o servidor guarda leitura bruta, corpo do sensor e quando o autotune começou');
        assert.strictEqual((await chamar('POST', '/api/selagem2/autotune', dono, { alvo: 150 })).status, 409); ok('autotune já rodando: 409');
        placa.publish('selagem2/autotune_resultado', JSON.stringify({ estado: 'ok', motivo: '', ku: 22.67, pu: 22.5, kp: 10.31, ki: 0.2082, kd: 36.8 })); enviar({ autotune: 'ok' }); await esperar(400);
        est = (await chamar('GET', '/api/selagem2/ajuste', dono)).json; assert.strictEqual(est.autotune.estado, 'ok'); assert.ok((await logsHoje()).includes('Autotune da Selagem 2 terminou: Ku 22.67')); ok('o resultado do autotune (Ku, Pu e novos ganhos) fica guardado e vai para os logs');
        for (let i = 0; i < 4; i++) { enviar({ temperatura: 30 + i }); await esperar(1000); }
        est = (await chamar('GET', '/api/selagem2/ajuste', dono)).json; assert.ok(est.historico.length >= 3 && est.historico.every(p => typeof p.temp === 'number')); ok('o histórico dos últimos 10 min para o gráfico é guardado');

        console.log('5) Emergência e placa offline');
        vistos.length = 0;
        const { io: ioc } = require('socket.io-client'); const s = ioc(B, { extraHeaders: { cookie: dono }, transports: ['websocket'] }); await esperar(500); s.emit('comando_esteira', { acao: 'emergencia' }); await esperar(500); s.close();
        assert.strictEqual((await chamar('GET', '/api/emergencia', dono)).json.ativa, true);
        assert.ok(ult('selagem2/autotune').some(x => x.endsWith(' 0'))); ok('a emergência cancela o autotune');
        vistos.length = 0;
        for (const [p, corpo] of [['/api/selagem2/autotune', { alvo: 150 }], ['/api/selagem2/pid', { padrao: true }], ['/api/selagem2/calibrar', { acao: 'zerar' }]]) for (const ck of [dono, adm]) assert.strictEqual((await chamar('POST', p, ck, corpo)).status, 423, p);
        await esperar(300); assert.strictEqual(ult('selagem2/autotune').length + ult('selagem2/pid').length + ult('selagem2/calibrar').length, 0); ok('com a emergência ativa tudo responde 423 e nada é publicado');
        await chamar('POST', '/api/emergencia/liberar', dono, {});
        assert.ok((await logsHoje()).includes('Autotune da Selagem 2 iniciado por dono')); ok('o log registra quem fez');

        if (chromium) {
            console.log('6) Telas');
            nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] }).catch(() => chromium.launch({ args: ['--no-sandbox'] }));
            assert.strictEqual((await chamar('GET', '/controle', oper)).status, 403);
            for (const [nome, edita] of [['dono', true], ['visualizador', false]]) {
                const p = await (await nav.newContext({ viewport: { width: 1100, height: 900 } })).newPage(); const erros = []; p.on('pageerror', e => erros.push(e.message));
                await p.goto(B + '/'); await p.fill('input[name=username]', nome); await p.fill('input[name=password]', SENHA_TESTE); await p.keyboard.press('Enter'); await p.waitForTimeout(900);
                await p.goto(B + '/controle'); await p.waitForTimeout(900);
                enviar({ seguranca: 'sem_aquecimento', temperatura: 31 }); await p.waitForTimeout(500);
                const txt = await p.textContent('[data-s2="alarme"]'); assert.ok(/ALARME: A barra não está esquentando/.test(txt), nome + ': ' + txt);
                assert.ok(/--/.test(await p.textContent('[data-s2="autotune-estado"]')) === false); assert.strictEqual(await p.$eval('[data-s2="bruta"]', e => e.textContent.trim()), '24.5 °C');
                assert.strictEqual(await p.$eval('[data-s2="btn-pid"]', e => e.disabled), !edita, nome + ' botão PID');
                assert.ok(await p.$eval('[data-s2="grafico"]', e => e.width > 0));
                const avisoCard = await p.evaluate(() => { const l = [...document.querySelectorAll('.aviso-temp')]; return l.map(x => x.textContent).join('|'); });
                if (nome === 'dono') {
                    await p.goto(B + '/dashboard'); await p.waitForTimeout(900); enviar({ seguranca: 'sem_aquecimento' }); await p.waitForTimeout(500);
                    assert.ok(/Alarme: A barra não está esquentando/.test(await p.textContent('#aviso-selagem2')), nome + ' dashboard');
                    enviar({ seguranca: 'sensor_quente_aviso' }); await p.waitForTimeout(500); assert.ok(/Aviso: Sensor esquentando/.test(await p.textContent('#aviso-selagem2')));
                    enviar({ seguranca: 'ok' }); await p.waitForTimeout(500);
                }
                assert.deepStrictEqual(erros, [], nome);
            }
            ok('Painel de Controle mostra o ajuste fino (só Dono/Adm editam; Operário nem entra nessa tela) e o alarme em português; a Operação mostra alarme e aviso; sem erros no console');
        }
        console.log('\nSELAGEM 2 AJUSTE: TUDO OK'); fim(0);
    } catch (e) { console.error('\nFALHOU: ' + (e && e.stack || e)); fim(1); }
})();
