// teste automatico do lote 2, etapa 1: ordem da lista do NFC, 3 novos manuais e arquivos do modelo 3D
// uso: node tools/testes/lote2_etapa1.js   (ou npm test)
const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { criarUsuariosTeste, SENHA_TESTE } = require('../seed_teste');

const PORTA = 5062;
const B = `http://127.0.0.1:${PORTA}`;
const raiz = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flowpack-lote2e1-'));
const esperar = ms => new Promise(r => setTimeout(r, ms));
const ok = m => console.log('  ok   ' + m);
const pdfFalso = path.join(raiz, 'manuais', 'Manual_Alexa_FlowPack.pdf');

(async () => {
    const arqUsuarios = path.join(tmp, 'usuarios.json');
    const u = criarUsuariosTeste(arqUsuarios);
    // mais usuarios, fora de ordem alfabetica, para provar a ordenacao
    Object.assign(u, { zeca: Object.assign({}, u.dono), bia: Object.assign({}, u.dono), carlos: Object.assign({}, u.adm), ana: Object.assign({}, u.adm) });
    fs.writeFileSync(arqUsuarios, JSON.stringify(u, null, 2));
    let site = null, saida = '';
    const fim = c => { try { site.kill(); } catch (e) {} try { fs.rmSync(pdfFalso, { force: true }); } catch (e) {} fs.rmSync(tmp, { recursive: true, force: true }); setTimeout(() => process.exit(c), 300); };
    try {
        assert.ok(!fs.existsSync(pdfFalso), 'o PDF de teste ja existe em manuais/ (apague antes de testar)');
        site = spawn('node', ['server.js'], { cwd: raiz, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, {
            PORT: String(PORTA), MQTT_BROKER: 'mqtt://127.0.0.1:18898', USUARIOS_JSON: arqUsuarios, EMERGENCIA_JSON: path.join(tmp, 'e.json'),
            RECEITAS_JSON: path.join(tmp, 'r.json'), CARTOES_NFC_JSON: path.join(tmp, 'c.json'), SESSION_SECRET: 'x' }) });
        site.stdout.on('data', d => { saida += d; }); site.stderr.on('data', d => { saida += d; });
        for (let i = 0; i < 60; i++) { await esperar(250); try { if ((await fetch(B + '/sobre')).status === 200) break; } catch (e) {} }

        const entrar = async nome => {
            const r = await fetch(B + '/', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `username=${nome}&password=${SENHA_TESTE}` });
            const c = (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map(x => x.split(';')[0]).join('; ');
            assert.ok(c.includes('connect.sid'), 'login ' + nome); return c;
        };
        const get = async (p, c) => { const r = await fetch(B + p, { redirect: 'manual', headers: { Cookie: c } }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {} return { status: r.status, json: j, texto: t }; };

        console.log('1) Lista "Para qual usuário" no NFC');
        let c = await entrar('dono'), r = await get('/api/nfc/estado', c);
        assert.deepStrictEqual(r.json.elegiveis, ['dono', 'bia', 'zeca', 'adm', 'ana', 'carlos']);
        ok('Dono logado: ele primeiro, depois os outros Donos (A-Z), depois os Adm (A-Z)');
        assert.strictEqual(r.json.usuarioAtual, 'dono'); ok('a API informa quem é o usuário logado (para marcar "(você)")');
        c = await entrar('ana'); r = await get('/api/nfc/estado', c);
        assert.deepStrictEqual(r.json.elegiveis, ['ana', 'bia', 'dono', 'zeca', 'adm', 'carlos']); ok('Adm logada: ela primeiro; depois os Donos e os demais Adm em ordem alfabética');
        assert.ok(!r.json.elegiveis.includes('operario') && !r.json.elegiveis.includes('visualizador')); ok('Operário e Visualizador continuam fora da lista');
        const pagina = fs.readFileSync(path.join(raiz, 'views', 'nfc.html'), 'utf8');
        assert.ok(pagina.includes("'(você)'") === false && pagina.includes('(você)') && pagina.includes('selected')); ok('a tela marca "(você)" e já deixa o primeiro selecionado');
        assert.strictEqual((await get('/api/nfc/estado', await entrar('operario'))).status, 403); ok('regras de permissão não mudaram (Operário 403)');

        console.log('2) Manuais');
        c = await entrar('adm'); r = await get('/api/manuais', c);
        const ids = r.json.map(m => m.id); for (const id of ['alexa', 'nfc', 'painel']) assert.ok(ids.includes(id), id);
        ok('a lista tem os 3 manuais novos (Alexa, Cartão NFC e acesso, Botões e painel)');
        const novo = r.json.find(m => m.id === 'alexa'); assert.strictEqual(novo.disponivel, false); assert.ok(novo.titulo && novo.descricao); ok('sem o PDF: aparece como não disponível, com título e descrição');
        assert.strictEqual((await get('/manuais/baixar/alexa', c)).status, 404); ok('e o download responde 404 amigável (sem link quebrado)');
        assert.ok(fs.readFileSync(path.join(raiz, 'views', 'base.html'), 'utf8').includes('PDF ainda')); ok('a tela mostra "PDF ainda não adicionado"');
        fs.writeFileSync(pdfFalso, '%PDF-1.4\n%teste\n');
        r = await get('/api/manuais', c); assert.strictEqual(r.json.find(m => m.id === 'alexa').disponivel, true);
        assert.strictEqual((await get('/manuais/baixar/alexa', c)).status, 200); ok('ao copiar o PDF com o nome certo ele passa a abrir sozinho, sem reiniciar o site');
        fs.rmSync(pdfFalso);
        assert.strictEqual((await get('/api/manuais', c)).json.find(m => m.id === 'alexa').disponivel, false); ok('e some de novo se o arquivo for removido');
        c = await entrar('visualizador'); assert.strictEqual((await get('/api/manuais', c)).status, 200); ok('Visualizador também vê os manuais (só leitura)');

        console.log('3) Modelo 3D');
        const js = await get('/js/modelo3d-view.js', c); assert.strictEqual(js.status, 200); ok('o módulo 3D compartilhado é servido (sem CDN)');
        for (const t of ['FOLGA', 'minDistance', 'maxDistance', 'fullscreenchange', 'm3v-cheia', 'safe-area-inset', 'webkitRequestFullscreen', 'Escape', 'popstate']) assert.ok(js.texto.includes(t), t);
        ok('tem enquadramento por esfera, limites de zoom, tela cheia nativa e simulada (iPhone), ESC e botão voltar');
        assert.ok(!/https?:\/\/(?!www\.w3)/.test(js.texto.replace(/\/\/ .*$/gm, ''))); ok('sem endereços externos');
        for (const p of ['/dashboard', '/modelo3d']) { const t = (await get(p, await entrar('dono'))).texto; assert.ok(t.includes('/js/modelo3d-view.js') && t.includes('Modelo3D.criar')); }
        ok('Dashboard e página Modelo 3D usam o mesmo módulo (sem código duplicado)');
        assert.ok((await get('/dashboard', await entrar('dono'))).texto.includes('id="d3-estrutura"')); ok('o cartão do Dashboard agora tem o botão Estrutura');

        console.log('\nLOTE 2 ETAPA 1: TUDO OK'); fim(0);
    } catch (e) { console.error('\nFALHOU: ' + (e && e.message), e && e.cause && e.cause.code); console.error(saida.slice(0, 600)); fim(1); }
})();
