// GitHub: https://github.com/brunoosz | LinkedIn: https://www.linkedin.com/in/brunocamperlingo/
// teste do servo livre: rotas, permissões, validação, 423 e tópicos MQTT
const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mqtt = require('mqtt');
const { criarUsuariosTeste, SENHA_TESTE } = require('../seed_teste');

const PORTA = 5069, PORTA_MQTT = 18838, B = `http://127.0.0.1:${PORTA}`;
const raiz = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flowpack-servo-'));
const esperar = ms => new Promise(r => setTimeout(r, ms));
const ok = m => console.log('  ok   ' + m);
process.env.MOCK_MQTT_PORT = String(PORTA_MQTT);
const { iniciar } = require('../mock_mqtt');
const SL = require('../../servo_livre');

(async () => {
    criarUsuariosTeste(path.join(tmp, 'usuarios.json'));
    const { aedes, servidor } = await iniciar({ placas: false });
    let site = null, saida = '';
    const clientes = [];
    const fim = c => { try { site.kill(); } catch (e) {} clientes.forEach(x => x.end(true)); servidor.close(); try { aedes.close(); } catch (e) {} fs.rmSync(tmp, { recursive: true, force: true }); setTimeout(() => process.exit(c), 300); };
    try {
        console.log('1) Validação (módulo servo_livre)');
        assert.strictEqual(SL.validarAngulo('90'), 90); assert.throws(() => SL.validarAngulo(181)); assert.throws(() => SL.validarAngulo(-1)); assert.throws(() => SL.validarAngulo('abc')); assert.throws(() => SL.validarAngulo(null)); assert.throws(() => SL.validarAngulo(true));
        assert.throws(() => SL.validarVelocidade(0)); assert.throws(() => SL.validarVelocidade(101)); assert.strictEqual(SL.validarVelocidade(100), 100);
        assert.throws(() => SL.validarPassos([])); assert.throws(() => SL.validarPassos(Array(31).fill({ angulo: 10 }))); assert.throws(() => SL.validarPassos([{ angulo: 10, esperaMs: 99999 }]));
        const base = { anguloEsq: 45, anguloCentro: 90, anguloDir: 135, limMin: 0, limMax: 180, pulsoMin: 500, pulsoMax: 2400, inverterServo: false, voltarAuto: true, tempoAbertoMs: 900, velocidadeServo: 60 };
        assert.throws(() => SL.validarCalibracao({ limMin: 100, limMax: 105 }, base)); assert.throws(() => SL.validarCalibracao({ pulsoMin: 1000, pulsoMax: 1400 }, base)); assert.throws(() => SL.validarCalibracao({ limMin: 60 }, base));
        assert.throws(() => SL.validarCalibracao({ pulsoMin: 100 }, base)); assert.throws(() => SL.validarCalibracao({ pulsoMax: 3000 }, base));
        assert.strictEqual(SL.validarCalibracao({ anguloEsq: 30 }, base).anguloEsq, 30); ok('ângulo, velocidade, passos, limites e pulsos recusam valores fora da faixa');

        site = spawn('node', ['server.js'], { cwd: raiz, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { PORT: String(PORTA), MQTT_BROKER: `mqtt://127.0.0.1:${PORTA_MQTT}`, USUARIOS_JSON: path.join(tmp, 'usuarios.json'), EMERGENCIA_JSON: path.join(tmp, 'e.json'), RECEITAS_JSON: path.join(tmp, 'r.json'), CARTOES_NFC_JSON: path.join(tmp, 'c.json'), SEPARADOR_DADOS_DIR: tmp, SERVO_LIVRE_JSON: path.join(tmp, 'servo.json'), SESSION_SECRET: 'x' }) });
        site.stdout.on('data', d => { saida += d; }); site.stderr.on('data', d => { saida += d; });
        for (let i = 0; i < 60; i++) { await esperar(250); try { if ((await fetch(B + '/sobre')).status === 200) break; } catch (e) {} }
        await esperar(600);
        const entrar = async nome => {
            const r = await fetch(B + '/', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `username=${nome}&password=${SENHA_TESTE}` });
            return (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map(x => x.split(';')[0]).join('; ');
        };
        const chamar = async (m, p, c, corpo) => { const r = await fetch(B + p, { method: m, redirect: 'manual', headers: Object.assign({ Cookie: c }, corpo ? { 'Content-Type': 'application/json' } : {}), body: corpo ? JSON.stringify(corpo) : undefined }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {} return { status: r.status, json: j, texto: t }; };
        const dono = await entrar('dono'), adm = await entrar('adm'), oper = await entrar('operario'), vis = await entrar('visualizador');
        const esperarAte = async (cond, ms = 2000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await cond()) return true; await esperar(25); } return false; };
        const livre = () => esperar(70);

        // placa de mentira do separador
        const c = mqtt.connect(`mqtt://127.0.0.1:${PORTA_MQTT}`); clientes.push(c); await new Promise(r => c.on('connect', r));
        const msgs = [];
        c.subscribe(['separador/#']); c.on('message', (t, m) => msgs.push({ t, m: m.toString() }));
        const placa = { travado: false };
        const batimento = setInterval(() => { c.publish('separador/status', 'online'); c.publish('separador/estado', JSON.stringify({ lado: 'C', angulo: 90, fila: 0, travado: placa.travado })); }, 150);
        await esperar(700);
        const ultimas = (t) => msgs.filter(x => x.t === t);

        console.log('2) Permissões');
        for (const [nome, ck] of [['dono', dono], ['adm', adm], ['operario', oper]]) {
            const r = await chamar('POST', '/api/separador/servo/angulo', ck, { angulo: 100, velocidade: 50 }); assert.strictEqual(r.status, 200, nome + ' ' + r.texto); await livre(); await esperar(60);
        }
        ok('Dono, Adm e Operário movem o servo');
        let r = await chamar('POST', '/api/separador/servo/angulo', vis, { angulo: 100 }); assert.strictEqual(r.status, 403);
        for (const [m, p, corpo] of [['POST', '/api/separador/servo/lado', { lado: 'E' }], ['POST', '/api/separador/servo/parar', {}], ['POST', '/api/separador/servo/modo', { modo: 'manual' }], ['POST', '/api/separador/servo/calibracao', { anguloEsq: 40 }], ['POST', '/api/separador/servo/preset', { nome: 'x' }], ['POST', '/api/separador/servo/sequencia/executar', { passos: [{ angulo: 10 }] }], ['POST', '/api/separador/servo/simular', { lado: 'E' }]]) {
            r = await chamar(m, p, vis, corpo); assert.strictEqual(r.status, 403, p);
        }
        r = await chamar('GET', '/api/separador/servo', vis); assert.strictEqual(r.status, 200); ok('Visualizador só vê (GET 200, qualquer comando 403)');

        console.log('3) Validação nas rotas e tópicos MQTT');
        for (const corpo of [{ angulo: 181 }, { angulo: -5 }, { angulo: 'x' }, {}, { angulo: 90, velocidade: 0 }, { angulo: 90, velocidade: 101 }]) { await livre(); r = await chamar('POST', '/api/separador/servo/angulo', dono, corpo); assert.strictEqual(r.status, 400, JSON.stringify(corpo)); }
        ok('ângulo e velocidade inválidos: 400');
        msgs.length = 0; await livre(); r = await chamar('POST', '/api/separador/servo/angulo', dono, { angulo: 120, velocidade: 30 }); assert.strictEqual(r.status, 200);
        assert.ok(await esperarAte(() => ultimas('separador/servo/angulo').length === 1)); assert.deepStrictEqual(JSON.parse(ultimas('separador/servo/angulo')[0].m), { a: 120, v: 30, h: 0 }); ok('publica separador/servo/angulo com ângulo e velocidade');
        r = await chamar('POST', '/api/separador/servo/angulo', dono, { angulo: 10 }); assert.strictEqual(r.status, 429); ok('mais de ~20 pedidos por segundo: 429 (protege o MQTT)');
        await livre(); msgs.length = 0; await chamar('POST', '/api/separador/servo/lado', dono, { lado: 'E' }); assert.ok(await esperarAte(() => ultimas('separador/servo/angulo').length === 1));
        assert.deepStrictEqual(JSON.parse(ultimas('separador/servo/angulo')[0].m), { a: 45, v: 60, h: 900 }); ok('botão ESQUERDA usa o ângulo calibrado e volta ao centro sozinho (h = tempo parado)');
        await livre(); r = await chamar('POST', '/api/separador/servo/lado', dono, { lado: 'X' }); assert.strictEqual(r.status, 400);
        await livre(); msgs.length = 0; r = await chamar('POST', '/api/separador/servo/calibracao', dono, { limMin: 20, limMax: 160, pulsoMin: 600, pulsoMax: 2300, inverterServo: true, anguloEsq: 30, anguloDir: 150 }); assert.strictEqual(r.status, 200, r.texto);
        assert.ok(await esperarAte(() => ultimas('separador/servo/config').length >= 1)); assert.deepStrictEqual(JSON.parse(ultimas('separador/servo/config').pop().m), { limMin: 20, limMax: 160, pulsoMin: 600, pulsoMax: 2300, inv: 1 }); ok('calibração salva e publicada em separador/servo/config');
        r = await chamar('POST', '/api/separador/servo/calibracao', dono, { limMin: 100, limMax: 105 }); assert.strictEqual(r.status, 400);
        r = await chamar('POST', '/api/separador/servo/calibracao', dono, { anguloEsq: 5 }); assert.strictEqual(r.status, 400); ok('ângulo fora do limite de segurança e limites absurdos: 400');
        await livre(); msgs.length = 0; await chamar('POST', '/api/separador/servo/angulo', dono, { angulo: 5, velocidade: 50 }); assert.ok(await esperarAte(() => ultimas('separador/servo/angulo').length === 1));
        assert.strictEqual(JSON.parse(ultimas('separador/servo/angulo')[0].m).a, 20); ok('o servidor corta o ângulo no limite mínimo configurado');
        await chamar('POST', '/api/separador/servo/calibracao', dono, { limMin: 0, limMax: 180, anguloEsq: 45, anguloDir: 135, inverterServo: false });

        console.log('4) Modo, presets e simulação');
        r = await chamar('POST', '/api/separador/servo/modo', dono, { modo: 'x' }); assert.strictEqual(r.status, 400);
        r = await chamar('POST', '/api/separador/servo/modo', oper, { modo: 'manual' }); assert.strictEqual(r.status, 200);
        assert.strictEqual((await chamar('GET', '/api/separador/servo', oper)).json.modo, 'manual'); ok('modo Manual/Automático (Operário pode trocar) e fica salvo');
        await chamar('POST', '/api/separador/servo/modo', oper, { modo: 'auto' });
        r = await chamar('POST', '/api/separador/servo/preset', oper, { nome: 'Desvio leve' }); assert.strictEqual(r.status, 200);
        await chamar('POST', '/api/separador/servo/calibracao', dono, { anguloEsq: 70, anguloDir: 110 });
        r = await chamar('POST', '/api/separador/servo/preset', dono, { nome: 'Desvio forte' }); assert.strictEqual(r.status, 200);
        r = await chamar('POST', '/api/separador/servo/preset/aplicar', dono, { nome: 'desvio leve' }); assert.strictEqual(r.status, 200); assert.strictEqual(r.json.calibracao.anguloEsq, 45);
        assert.strictEqual((await chamar('POST', '/api/separador/servo/preset', dono, { nome: '' })).status, 400); assert.strictEqual((await chamar('POST', '/api/separador/servo/preset/aplicar', dono, { nome: 'nao existe' })).status, 404);
        r = await chamar('DELETE', '/api/separador/servo/preset/' + encodeURIComponent('Desvio forte'), dono); assert.strictEqual(r.status, 200); assert.strictEqual(r.json.presets.length, 1); ok('presets: salvar, aplicar, apagar');
        msgs.length = 0; r = await chamar('POST', '/api/separador/servo/simular', dono, { lado: 'D' }); assert.strictEqual(r.status, 200);
        assert.ok(await esperarAte(() => ultimas('separador/desviar').length === 1)); assert.ok(/^D;\d+;900$/.test(ultimas('separador/desviar')[0].m)); assert.strictEqual((await chamar('POST', '/api/separador/servo/simular', dono, { lado: 'C' })).status, 400); ok('simular produto usa o mesmo tópico separador/desviar do automático');

        console.log('5) Sequências');
        r = await chamar('POST', '/api/separador/servo/sequencia', oper, { nome: 'Vai e volta', passos: [{ angulo: 30, velocidade: 100, esperaMs: 100 }, { angulo: 150, velocidade: 100, esperaMs: 100 }], repetir: 0 }); assert.strictEqual(r.status, 200, r.texto);
        assert.strictEqual((await chamar('POST', '/api/separador/servo/sequencia', dono, { nome: 'ruim', passos: [{ angulo: 400 }] })).status, 400);
        msgs.length = 0; r = await chamar('POST', '/api/separador/servo/sequencia/executar', dono, { nome: 'Vai e volta' }); assert.strictEqual(r.status, 200);
        assert.ok(await esperarAte(() => ultimas('separador/servo/angulo').length >= 4, 4000), 'a sequência não repetiu'); ok('sequência salva roda e repete até parar');
        r = await chamar('POST', '/api/separador/servo/sequencia/parar', oper, {}); assert.strictEqual(r.status, 200);
        assert.ok(await esperarAte(() => ultimas('separador/servo/parar').length === 1)); const n = ultimas('separador/servo/angulo').length; await esperar(1500); assert.strictEqual(ultimas('separador/servo/angulo').length, n); ok('PARAR interrompe na hora (publica separador/servo/parar e nenhum passo novo sai)');
        assert.strictEqual((await chamar('GET', '/api/separador/servo', dono)).json.sequencia.rodando, false);
        r = await chamar('POST', '/api/separador/servo/sequencia/executar', dono, { passos: [{ angulo: 60, velocidade: 100, esperaMs: 0 }], repetir: 2 }); assert.strictEqual(r.status, 200);
        assert.ok(await esperarAte(async () => !(await chamar('GET', '/api/separador/servo', dono)).json.sequencia.rodando, 3000)); ok('sequência com número de repetições termina sozinha');
        r = await chamar('DELETE', '/api/separador/servo/sequencia/' + encodeURIComponent('Vai e volta'), dono); assert.strictEqual(r.status, 200);

        console.log('6) Emergência trava tudo (423)');
        await chamar('POST', '/api/separador/servo/sequencia/executar', dono, { passos: [{ angulo: 20, velocidade: 1, esperaMs: 3000 }, { angulo: 160, velocidade: 1, esperaMs: 3000 }], repetir: 0 });
        await esperar(200);
        r = await chamar('POST', '/api/emergencia/ativar', dono, {}); if (r.status === 404) { const { io: ioc } = require('socket.io-client'); const s = ioc(B, { extraHeaders: { cookie: dono }, transports: ['websocket'] }); await esperar(500); s.emit('comando_esteira', { acao: 'emergencia' }); await esperar(300); s.close(); }
        assert.strictEqual((await chamar('GET', '/api/emergencia', dono)).json.ativa, true);
        assert.strictEqual((await chamar('GET', '/api/separador/servo', dono)).json.sequencia.rodando, false); ok('a emergência para a sequência em andamento');
        msgs.length = 0;
        for (const ck of [dono, adm, oper]) {
            for (const [m, p, corpo] of [['POST', '/api/separador/servo/angulo', { angulo: 90 }], ['POST', '/api/separador/servo/lado', { lado: 'E' }], ['POST', '/api/separador/servo/parar', {}], ['POST', '/api/separador/servo/modo', { modo: 'manual' }], ['POST', '/api/separador/servo/calibracao', { anguloEsq: 40 }], ['POST', '/api/separador/servo/preset/aplicar', { nome: 'Desvio leve' }], ['POST', '/api/separador/servo/sequencia/executar', { passos: [{ angulo: 10 }] }], ['POST', '/api/separador/servo/sequencia/parar', {}], ['POST', '/api/separador/servo/simular', { lado: 'E' }]]) {
                await livre(); r = await chamar(m, p, ck, corpo); assert.strictEqual(r.status, 423, p + ' → ' + r.status);
            }
        }
        await esperar(300); assert.strictEqual(ultimas('separador/servo/angulo').length, 0); assert.strictEqual(ultimas('separador/desviar').length, 0); ok('com emergência ativa todos os controles respondem 423 e nada é publicado para o servo');
        await chamar('POST', '/api/emergencia/liberar', dono, {}); await esperar(400);
        await livre(); r = await chamar('POST', '/api/separador/servo/angulo', dono, { angulo: 90 }); assert.strictEqual(r.status, 200); ok('depois de liberar, o servo volta a responder');

        console.log('7) Log e placa offline');
        const [d, mm, a] = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }).split(', ')[0].split('/');
        const logs = (await (await fetch(`${B}/api/logs/${a}-${mm}-${d}`, { headers: { Cookie: dono } })).json()).map(l => l.texto).join('\n');
        assert.ok(/Servo movido por dono/.test(logs) && /Servo movido por operario/.test(logs)); ok('o log diz "Servo movido por <usuário>"');
        clearInterval(batimento); await esperar(9500);
        await livre(); r = await chamar('POST', '/api/separador/servo/angulo', dono, { angulo: 90 }); assert.strictEqual(r.status, 409); ok('com a placa desligada: 409 explicando, sem travar o site');

        console.log('8) Firmware');
        const fw = fs.readFileSync(path.join(raiz, 'firmware', '06_firmware_separador_servo', '06_firmware_separador_servo.ino'), 'utf8');
        for (const t of ['separador/servo/angulo', 'separador/servo/config', 'separador/servo/parar', 'separador/desviar', 'separador/teste', 'separador/config']) assert.ok(fw.includes('"' + t + '"'), t);
        assert.ok(/client\.subscribe\(topic_liberar\)/.test(fw) && /client\.subscribe\(topic_servo_ang\)/.test(fw) && /client\.subscribe\(topic_servo_cfg\)/.test(fw) && /client\.subscribe\(topic_servo_parar\)/.test(fw));
        assert.ok(/vel < 1 \|\| vel > 100/.test(fw) && /graus < 0 \|\| graus > 180/.test(fw) && /pmx - pmn < 500/.test(fw)); ok('o firmware mantém os tópicos antigos, assina os novos e valida ângulo, velocidade e pulsos');

        console.log('\nSERVO LIVRE: TUDO OK'); fim(0);
    } catch (e) { console.error('\nFALHOU: ' + (e && e.stack || e)); console.error(saida.slice(-600)); fim(1); }
})();
