// GitHub: https://github.com/brunoosz | LinkedIn: https://www.linkedin.com/in/brunocamperlingo/
// teste lote 3, etapa 1
const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mqtt = require('mqtt');
const { criarUsuariosTeste, SENHA_TESTE } = require('../seed_teste');

const PORTA_SITE = 5063, PORTA_MQTT = 18834;
const B = `http://127.0.0.1:${PORTA_SITE}`;
const raiz = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flowpack-lote3e1-'));
const esperar = ms => new Promise(r => setTimeout(r, ms));
const ok = m => console.log('  ok   ' + m);
process.env.MOCK_MQTT_PORT = String(PORTA_MQTT);
const { iniciar } = require('../mock_mqtt');

(async () => {
    criarUsuariosTeste(path.join(tmp, 'usuarios.json'));
    const { aedes, servidor } = await iniciar({ placas: false });
    let site = null, saida = '';
    const fim = c => { try { site.kill(); } catch (e) {} servidor.close(); try { aedes.close(); } catch (e) {} fs.rmSync(tmp, { recursive: true, force: true }); setTimeout(() => process.exit(c), 300); };
    try {
        site = spawn('node', ['server.js'], { cwd: raiz, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, {
            PORT: String(PORTA_SITE), MQTT_BROKER: `mqtt://127.0.0.1:${PORTA_MQTT}`, USUARIOS_JSON: path.join(tmp, 'usuarios.json'), EMERGENCIA_JSON: path.join(tmp, 'e.json'),
            RECEITAS_JSON: path.join(tmp, 'r.json'), CARTOES_NFC_JSON: path.join(tmp, 'c.json'), SESSION_SECRET: 'x' }) });
        site.stdout.on('data', d => { saida += d; }); site.stderr.on('data', d => { saida += d; });
        for (let i = 0; i < 60; i++) { await esperar(250); try { if ((await fetch(B + '/sobre')).status === 200) break; } catch (e) {} }
        await esperar(800);
        const entrar = async nome => {
            const r = await fetch(B + '/', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `username=${nome}&password=${SENHA_TESTE}` });
            return (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map(x => x.split(';')[0]).join('; ');
        };
        const get = async (p, c) => { const r = await fetch(B + p, { headers: { Cookie: c } }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {} return { status: r.status, json: j, texto: t }; };

        console.log('1) A moldura existe em todas as telas');
        for (const nome of ['dono', 'adm', 'operario', 'visualizador']) {
            const c = await entrar(nome); const h = (await get('/dashboard', c)).texto;
            assert.ok(h.includes('id="emergencia-borda"') && h.includes('id="emergencia-aviso"'), nome);
        }
        ok('Dono, Adm, Operário e Visualizador recebem a camada vermelha (fica no base.html, fora do conteúdo da SPA)');
        const base = fs.readFileSync(path.join(raiz, 'views', 'base.html'), 'utf8');
        assert.ok(/#emergencia-borda\s*\{[^}]*position:\s*fixed;\s*inset:\s*0[^}]*pointer-events:\s*none/.test(base)); ok('é fixa, cobre a tela toda e não bloqueia cliques');
        assert.ok(/border:\s*4px solid #ef4444/.test(base) && /pulso-borda-emergencia/.test(base)); ok('mesma espessura e animação da moldura azul do tutorial, em vermelho');
        assert.ok(/body\.emergencia-ativa #tutorial-borda-ativa\s*\{\s*display:\s*none/.test(base)); ok('enquanto a emergência está ativa, o vermelho vence o azul (e o azul volta ao liberar)');
        assert.ok(/prefers-reduced-motion/.test(base)); ok('respeita "reduzir movimento" (brilho fixo, sem pulsar)');
        const z = Number((base.match(/#emergencia-borda\s*\{[^}]*z-index:\s*(\d+)/) || [])[1]); assert.ok(z > 1000 && z < 999990); ok('fica acima do conteúdo e abaixo dos modais e do tutorial');
        assert.ok(/classList\.toggle\('emergencia-ativa'/.test(base) && /fetch\('\/api\/emergencia'/.test(base) && /emergencia_estado/.test(base)); ok('liga e desliga pela classe no body, pelo evento do servidor e confere o estado ao abrir a página');
        const mod = fs.readFileSync(path.join(raiz, 'public', 'js', 'modelo3d-view.js'), 'utf8');
        assert.ok(/m3v-borda/.test(mod) && /emergencia-ativa \.m3v-tela-cheia/.test(mod)); ok('a tela cheia do modelo 3D tem a própria moldura vermelha');

        console.log('2) O estado vem do servidor');
        const dono = await entrar('dono');
        assert.strictEqual((await get('/api/emergencia', dono)).json.ativa, false); ok('sem emergência: estado normal');
        const placa = mqtt.connect(`mqtt://127.0.0.1:${PORTA_MQTT}`); await new Promise(r => placa.on('connect', r));
        placa.publish('esteira/botao', 'emergencia'); await esperar(600);
        for (const nome of ['visualizador', 'operario']) assert.strictEqual((await get('/api/emergencia', await entrar(nome))).json.ativa, true);
        ok('com a emergência ativa, qualquer perfil que abrir o site recebe ativa=true (a borda aparece na hora)');
        const r = await fetch(B + '/api/emergencia/liberar', { method: 'POST', headers: { Cookie: dono } }); assert.strictEqual(r.status, 200);
        assert.strictEqual((await get('/api/emergencia', await entrar('operario'))).json.ativa, false); ok('liberada: volta ao normal');
        placa.end(true);
        console.log('\nLOTE 3 ETAPA 1: TUDO OK'); fim(0);
    } catch (e) { console.error('\nFALHOU: ' + (e && e.message)); console.error(saida.slice(0, 500)); fim(1); }
})();
