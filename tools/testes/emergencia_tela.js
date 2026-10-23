// GitHub: https://github.com/brunoosz | LinkedIn: https://www.linkedin.com/in/brunocamperlingo/
// teste da tela: indicador sempre igual ao servidor
const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { criarUsuariosTeste, SENHA_TESTE } = require('../seed_teste');

const PORTA = 5068, PORTA_MQTT = 18837, B = `http://127.0.0.1:${PORTA}`;
const raiz = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flowpack-tela-'));
const esperar = ms => new Promise(r => setTimeout(r, ms));
const ok = m => console.log('  ok   ' + m);
let chromium = null;
for (const c of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { chromium = require(c).chromium; break; } catch (e) {} }
if (!chromium) { console.log('  (pulado: Playwright não instalado)'); process.exit(0); }
process.env.MOCK_MQTT_PORT = String(PORTA_MQTT);
const { iniciar } = require('../mock_mqtt');

(async () => {
    criarUsuariosTeste(path.join(tmp, 'usuarios.json'));
    const { aedes, servidor } = await iniciar({ placas: false });
    let site = null, nav = null;
    const fim = c => { try { site.kill(); } catch (e) {} try { nav && nav.close(); } catch (e) {} servidor.close(); try { aedes.close(); } catch (e) {} fs.rmSync(tmp, { recursive: true, force: true }); setTimeout(() => process.exit(c), 300); };
    try {
        site = spawn('node', ['server.js'], { cwd: raiz, stdio: 'ignore', env: Object.assign({}, process.env, { PORT: String(PORTA), MQTT_BROKER: `mqtt://127.0.0.1:${PORTA_MQTT}`, USUARIOS_JSON: path.join(tmp, 'usuarios.json'), EMERGENCIA_JSON: path.join(tmp, 'e.json'), RECEITAS_JSON: path.join(tmp, 'r.json'), CARTOES_NFC_JSON: path.join(tmp, 'c.json'), SESSION_SECRET: 'x', EMERGENCIA_CONFIRMAR_MAX_MS: '500' }) });
        for (let i = 0; i < 60; i++) { await esperar(250); try { if ((await fetch(B + '/sobre')).status === 200) break; } catch (e) {} }
        nav = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSERS_PATH ? path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium') : '/opt/pw-browsers/chromium', args: ['--no-sandbox'] }).catch(() => chromium.launch({ args: ['--no-sandbox'] }));
        const p = await (await nav.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
        const erros = []; p.on('pageerror', e => erros.push(e.message));
        await p.goto(B + '/'); await p.fill('input[name=username]', 'dono'); await p.fill('input[name=password]', SENHA_TESTE); await p.keyboard.press('Enter'); await p.waitForTimeout(1200);
        const cookie = (await p.context().cookies()).map(c => c.name + '=' + c.value).join('; ');
        const servidorAtiva = async () => (await (await fetch(B + '/api/emergencia', { headers: { Cookie: cookie } })).json()).ativa;
        const tela = () => p.evaluate(() => ({ botao: document.getElementById('btn-emergencia-global').dataset.emergencia, borda: getComputedStyle(document.getElementById('emergencia-borda')).display !== 'none', aviso: getComputedStyle(document.getElementById('emergencia-aviso')).display !== 'none', led: (document.getElementById('led-emerg') || {}).className || '' }));
        const igual = async (ativa, rotulo) => {
            for (let i = 0; i < 40; i++) { const t = await tela(); if (t.borda === ativa && t.aviso === ativa && (t.botao === 'ativa') === ativa) return t; await esperar(100); }
            assert.fail(rotulo + ': tela diferente do servidor ' + JSON.stringify(await tela()));
        };
        const pedirAtivar = () => p.evaluate(() => globalSocket.emit('comando_esteira', { acao: 'emergencia' }));
        const liberar = () => fetch(B + '/api/emergencia/liberar', { method: 'POST', headers: { Cookie: cookie } });

        console.log('1) Dashboard: acionar e liberar várias vezes');
        await p.goto(B + '/dashboard'); await p.waitForTimeout(800); await igual(false, 'início');
        for (let i = 0; i < 5; i++) {
            await pedirAtivar(); assert.ok(await servidorAtiva()); const t = await igual(true, 'ativa ' + i); assert.ok(/red-600/.test(t.led), 'LED do painel apagado');
            await liberar(); assert.strictEqual(await servidorAtiva(), false); const l = await igual(false, 'liberada ' + i); assert.ok(!/red-600/.test(l.led), 'LED do painel aceso');
        }
        ok('borda vermelha, aviso, botão e LED do painel sempre iguais ao servidor (5 ciclos)');

        console.log('2) Socket cai e volta');
        await pedirAtivar(); await igual(true, 'antes de cair');
        await p.evaluate(() => globalSocket.disconnect()); await liberar(); await esperar(300);
        assert.strictEqual((await tela()).borda, true); ok('com o socket caído a tela segue o último estado conhecido (não inventa)');
        await p.evaluate(() => globalSocket.connect()); await igual(false, 'depois de reconectar'); ok('ao reconectar o socket a tela sincroniza com o servidor');

        console.log('3) Troca de página e outras telas');
        for (const rota of ['/controle', '/dispenser', '/dashboard']) {
            await pedirAtivar().catch(() => {}); await fetch(B + '/api/emergencia', { headers: { Cookie: cookie } });
            await p.goto(B + rota); await p.waitForTimeout(700);
            if (!(await servidorAtiva())) await pedirAtivar();
            await igual(true, rota + ' ativa');
            await liberar(); await igual(false, rota + ' liberada');
        }
        ok('/controle, /dispenser e /dashboard seguem o servidor ao acionar e liberar');

        console.log('4) Ressincronização sem evento (10 s / foco)');
        await pedirAtivar(); await igual(true, 'antes de perder evento');
        await p.evaluate(() => { globalSocket.off('emergencia_estado'); }); await liberar(); await esperar(300);
        assert.strictEqual((await tela()).borda, true);
        await p.evaluate(() => window.dispatchEvent(new Event('focus'))); await igual(false, 'depois do foco'); ok('mesmo sem receber o evento, ao voltar o foco a tela corrige sozinha');

        assert.deepStrictEqual(erros, [], 'erros na página: ' + erros.join(' | '));
        ok('nenhum erro de JavaScript nas telas');
        console.log('\nTELA DA EMERGENCIA: TUDO OK'); fim(0);
    } catch (e) { console.error('\nFALHOU: ' + (e && e.message)); fim(1); }
})();
