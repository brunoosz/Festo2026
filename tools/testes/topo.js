// teste automatico: botao Sobre nós ao lado de Manuais e receita selecionada sempre visivel no topo
// uso: node tools/testes/topo.js   (ou npm test)
const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { criarUsuariosTeste, SENHA_TESTE } = require('../seed_teste');

const PORTA = 5066, B = `http://127.0.0.1:${PORTA}`;
const raiz = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flowpack-topo-'));
const esperar = ms => new Promise(r => setTimeout(r, ms));
const ok = m => console.log('  ok   ' + m);

(async () => {
    criarUsuariosTeste(path.join(tmp, 'usuarios.json'));
    let site = null, saida = '';
    const fim = c => { try { site.kill(); } catch (e) {} fs.rmSync(tmp, { recursive: true, force: true }); setTimeout(() => process.exit(c), 300); };
    try {
        site = spawn('node', ['server.js'], { cwd: raiz, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { PORT: String(PORTA), MQTT_BROKER: 'mqtt://127.0.0.1:18896', USUARIOS_JSON: path.join(tmp, 'usuarios.json'), EMERGENCIA_JSON: path.join(tmp, 'e.json'), RECEITAS_JSON: path.join(tmp, 'r.json'), CARTOES_NFC_JSON: path.join(tmp, 'c.json'), SESSION_SECRET: 'x' }) });
        site.stdout.on('data', d => { saida += d; }); site.stderr.on('data', d => { saida += d; });
        for (let i = 0; i < 60; i++) { await esperar(250); try { if ((await fetch(B + '/sobre')).status === 200) break; } catch (e) {} }
        const entrar = async nome => {
            const r = await fetch(B + '/', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `username=${nome}&password=${SENHA_TESTE}` });
            return (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map(x => x.split(';')[0]).join('; ');
        };
        const chamar = async (m, p, c, corpo) => { const r = await fetch(B + p, { method: m, redirect: 'manual', headers: Object.assign({ Cookie: c }, corpo ? { 'Content-Type': 'application/json' } : {}), body: corpo ? JSON.stringify(corpo) : undefined }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {} return { status: r.status, json: j, texto: t }; };
        const dono = await entrar('dono');

        console.log('1) Sobre nós ao lado de Manuais');
        for (const n of ['dono', 'adm', 'operario', 'visualizador']) {
            const h = (await chamar('GET', '/dashboard', await entrar(n))).texto;
            assert.ok((h.match(/<a href="\/sobre" target="_blank" rel="noopener"/g) || []).length === 2, n);
        }
        ok('todos os perfis têm o botão Sobre nós no topo (ao lado de Manuais) e no menu lateral, abrindo em nova aba');

        console.log('2) Receita selecionada no topo');
        for (const n of ['dono', 'adm', 'operario', 'visualizador']) {
            const r = await chamar('GET', '/api/receita-atual', await entrar(n)); assert.strictEqual(r.status, 200, n); assert.ok(r.json.gramas > 0, n);
        }
        ok('todos os perfis recebem a receita atual (inclusive Operário sem acesso à tela Receitas e Visualizador)');
        const h = (await chamar('GET', '/dashboard', dono)).texto; assert.ok(h.includes('id="receita-topo"') && h.includes("globalSocket.on('receita_atual'") && h.includes("'/api/receita-atual'")); ok('o topo mostra a receita ao abrir a página e muda ao vivo quando alguém aplica outra');
        const niveis = (await chamar('GET', '/api/receitas', dono)).json.niveis;
        for (const i of [0, 1, 2, 3]) { await chamar('POST', '/api/receitas/aplicar', dono, { indice: i }); assert.strictEqual((await chamar('GET', '/api/receita-atual', dono)).json.gramas, niveis[i].gramas); }
        ok('aplicando os 4 níveis (' + niveis.map(n => n.gramas).join(', ') + ' g) o topo acompanha cada um');
        assert.strictEqual((await fetch(B + '/api/receita-atual', { redirect: 'manual' })).status, 302); ok('sem login não responde');

        console.log('\nTOPO: TUDO OK'); fim(0);
    } catch (e) { console.error('\nFALHOU: ' + (e && e.message)); console.error(saida.slice(0, 400)); fim(1); }
})();
