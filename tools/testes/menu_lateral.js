// GitHub: https://github.com/brunoosz | LinkedIn: https://www.linkedin.com/in/brunocamperlingo/
// teste do menu lateral: sanduíche, só ícones, lembrança e teclado
const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { criarUsuariosTeste, SENHA_TESTE } = require('../seed_teste');

const PORTA = 5070, B = `http://127.0.0.1:${PORTA}`;
const raiz = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flowpack-menu-'));
const esperar = ms => new Promise(r => setTimeout(r, ms));
const ok = m => console.log('  ok   ' + m);
let chromium = null;
for (const c of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { chromium = require(c).chromium; break; } catch (e) {} }
if (!chromium) { console.log('  (pulado: Playwright não instalado)'); process.exit(0); }

(async () => {
    criarUsuariosTeste(path.join(tmp, 'usuarios.json'));
    let site = null, nav = null;
    const fim = c => { try { site.kill(); } catch (e) {} try { nav && nav.close(); } catch (e) {} fs.rmSync(tmp, { recursive: true, force: true }); setTimeout(() => process.exit(c), 300); };
    try {
        site = spawn('node', ['server.js'], { cwd: raiz, stdio: 'ignore', env: Object.assign({}, process.env, { PORT: String(PORTA), MQTT_BROKER: 'mqtt://127.0.0.1:18899', USUARIOS_JSON: path.join(tmp, 'usuarios.json'), EMERGENCIA_JSON: path.join(tmp, 'e.json'), RECEITAS_JSON: path.join(tmp, 'r.json'), CARTOES_NFC_JSON: path.join(tmp, 'c.json'), SEPARADOR_DADOS_DIR: tmp, SERVO_LIVRE_JSON: path.join(tmp, 's.json'), SESSION_SECRET: 'x' }) });
        for (let i = 0; i < 60; i++) { await esperar(250); try { if ((await fetch(B + '/sobre')).status === 200) break; } catch (e) {} }
        nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] }).catch(() => chromium.launch({ args: ['--no-sandbox'] }));
        const abrir = async (usuario, largura, extra) => {
            const ctx = await nav.newContext(Object.assign({ viewport: { width: largura, height: 800 } }, extra || {}));
            const p = await ctx.newPage(); const erros = []; p.on('pageerror', e => erros.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erros.push(m.text()); });
            await p.goto(B + '/'); await p.fill('input[name=username]', usuario); await p.fill('input[name=password]', SENHA_TESTE); await p.keyboard.press('Enter'); await p.waitForTimeout(900);
            await p.goto(B + '/dashboard'); await p.waitForTimeout(600);
            return { ctx, p, erros };
        };
        const larg = p => p.$eval('#sidebar-mobile', e => Math.round(e.getBoundingClientRect().width));
        const visivel = (p, sel) => p.$eval(sel, e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 2 && cs.opacity > 0.1; });

        console.log('1) Computador: expandido → só ícones');
        let { ctx, p, erros } = await abrir('dono', 1280);
        assert.strictEqual(await larg(p), 288); assert.strictEqual(await p.getAttribute('#btn-hamburguer', 'aria-expanded'), 'true'); assert.ok(await visivel(p, '#link-separador .sb-rotulo'));
        const mainAntes = await p.$eval('main', e => Math.round(e.getBoundingClientRect().width));
        await p.click('#btn-hamburguer'); await p.waitForTimeout(450);
        assert.strictEqual(await larg(p), 64); assert.strictEqual(await p.getAttribute('#btn-hamburguer', 'aria-expanded'), 'false'); assert.strictEqual(await p.getAttribute('#btn-hamburguer', 'aria-label'), 'Expandir menu'); ok('o menu vira uma faixa de 64 px e o botão avisa (aria-expanded=false)');
        assert.ok(!(await visivel(p, '#link-separador .sb-rotulo'))); assert.strictEqual(await p.getAttribute('#link-separador', 'title'), 'Separador'); assert.strictEqual(await p.getAttribute('#link-visao', 'title'), 'Visão Computacional'); ok('só aparecem os ícones, com o nome na dica (title) de cada item');
        const mainDepois = await p.$eval('main', e => Math.round(e.getBoundingClientRect().width)); assert.strictEqual(mainDepois - mainAntes, 224); assert.strictEqual(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0); ok('o conteúdo ocupa o espaço liberado, sem barra lateral e sem sobrar');
        const iconeCentro = await p.$eval('#link-operacao svg', e => { const r = e.getBoundingClientRect(); return Math.round(r.left + r.width / 2); }); assert.ok(Math.abs(iconeCentro - 32) <= 2, 'ícone fora do centro: ' + iconeCentro); ok('os ícones ficam centralizados na faixa');
        assert.ok(await p.$eval('#link-operacao', e => /e0f2fe|border-l-4/.test(e.className) && getComputedStyle(e).boxShadow !== 'none')); ok('a página atual continua destacada no modo só ícones');
        await p.click('#btn-hamburguer'); await p.waitForTimeout(450); assert.strictEqual(await larg(p), 288); assert.strictEqual(await p.getAttribute('#link-separador', 'title'), null); ok('ao expandir mostra ícone + nome de novo');
        await p.click('#btn-hamburguer'); await p.waitForTimeout(400);
        await p.reload(); await p.waitForTimeout(600); assert.strictEqual(await larg(p), 64); ok('a escolha fica lembrada ao recarregar (localStorage)');
        await p.goto(B + '/separador'); await p.waitForTimeout(600); assert.strictEqual(await larg(p), 64); assert.ok(await p.$eval('#link-separador', e => getComputedStyle(e).boxShadow !== 'none')); ok('trocar de página mantém o menu recolhido e destaca a nova página');
        await p.focus('#btn-hamburguer'); await p.keyboard.press('Enter'); await p.waitForTimeout(450); assert.strictEqual(await larg(p), 288); ok('o botão funciona pelo teclado (Enter)');
        await p.keyboard.press('Space'); await p.waitForTimeout(450); assert.strictEqual(await larg(p), 64); await p.keyboard.press('Space'); await p.waitForTimeout(450);
        assert.deepStrictEqual(erros, []); ok('sem erros no console'); await ctx.close();

        console.log('2) Animação do sanduíche (tracinhos → X)');
        ({ ctx, p, erros } = await abrir('dono', 1280));
        const barras = () => p.$$eval('.sb-barras i', l => l.map(i => { const cs = getComputedStyle(i); return { t: cs.transform, o: cs.opacity, d: cs.transitionDuration }; }));
        let b = await barras(); assert.ok(b[0].t !== 'none' && b[1].o === '0' && b[2].t !== 'none', 'menu aberto = X'); assert.ok(b.every(x => /0\.2/.test(x.d)), 'duração: ' + b[0].d);
        await p.click('#btn-hamburguer'); await p.waitForTimeout(60); const meio = await barras(); await p.waitForTimeout(400); const fechado = await barras();
        assert.ok(meio[1].o !== '0' || meio[0].t !== b[0].t, 'sem animação no meio'); assert.ok(fechado.every(x => x.t === 'none') && fechado[1].o === '1');
        await p.click('#btn-hamburguer'); await p.waitForTimeout(450); const volta = await barras(); assert.ok(volta[0].t !== 'none' && volta[1].o === '0'); ok('menu aberto mostra o X, recolhido mostra os três tracinhos, e a troca anima (~220 ms)');
        await ctx.close();

        console.log('3) Celular (380 px): gaveta por cima do conteúdo');
        ({ ctx, p, erros } = await abrir('operario', 380));
        assert.ok((await larg(p)) <= 323); assert.ok(await p.$eval('#sidebar-mobile', e => e.getBoundingClientRect().right <= 2)); assert.strictEqual(await p.getAttribute('#btn-hamburguer', 'aria-expanded'), 'false'); assert.strictEqual(await p.getAttribute('#btn-hamburguer', 'aria-label'), 'Abrir menu');
        await p.click('#btn-hamburguer'); await p.waitForTimeout(450);
        assert.ok(await p.$eval('#sidebar-mobile', e => e.getBoundingClientRect().left >= -2)); assert.ok(await visivel(p, '#link-separador .sb-rotulo')); assert.strictEqual(await p.getAttribute('#btn-hamburguer', 'aria-expanded'), 'true'); ok('abre como gaveta com ícone + nome e o botão vira X');
        await p.keyboard.press('Escape'); await p.waitForTimeout(450); assert.ok(await p.$eval('#sidebar-mobile', e => e.getBoundingClientRect().right <= 2)); assert.strictEqual(await p.getAttribute('#btn-hamburguer', 'aria-expanded'), 'false'); ok('Esc fecha a gaveta e devolve o foco ao botão');
        assert.strictEqual(await p.evaluate(() => document.activeElement.id), 'btn-hamburguer');
        await p.click('#btn-hamburguer'); await p.waitForTimeout(400); await p.mouse.click(350, 400); await p.waitForTimeout(450); assert.ok(await p.$eval('#sidebar-mobile', e => e.getBoundingClientRect().right <= 2)); ok('tocar fora da gaveta também fecha');
        assert.strictEqual(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0); assert.deepStrictEqual(erros, []); await ctx.close();

        console.log('4) Perfis: cada um vê só as suas telas');
        for (const u of ['dono', 'adm', 'operario', 'visualizador']) {
            const jar = await abrir(u, 1280);
            const itens = await jar.p.$$eval('#sidebar-mobile nav a', l => l.map(a => a.id));
            const html = await jar.p.content(); const esperados = (html.match(/data-spa-link/g) || []).length;
            assert.ok(itens.length >= 5 && itens.includes('link-operacao') && itens.includes('link-configuracoes'), u);
            if (u === 'operario') assert.ok(!itens.includes('link-usuarios'), 'operário não vê usuários'); if (u === 'dono') assert.ok(itens.includes('link-usuarios'));
            const semRotulo = await jar.p.$$eval('#sidebar-mobile nav a', l => l.filter(a => !a.querySelector('svg') || !a.querySelector('.sb-rotulo')).map(a => a.id));
            assert.deepStrictEqual(semRotulo, [], u + ' sem ícone/rótulo: ' + semRotulo);
            await jar.p.click('#btn-hamburguer'); await jar.p.waitForTimeout(400); assert.strictEqual(await larg(jar.p), 64); await jar.p.click('#btn-hamburguer'); await jar.p.waitForTimeout(300);
            assert.deepStrictEqual(jar.erros, [], u); await jar.ctx.close();
        }
        ok('Dono, Adm, Operário e Visualizador: cada item tem ícone e nome, as permissões continuam e não há erros');

        console.log('5) Movimento reduzido');
        ({ ctx, p, erros } = await abrir('dono', 1280, { reducedMotion: 'reduce' }));
        assert.ok(await p.$eval('#sidebar-mobile', e => getComputedStyle(e).transitionDuration.split(',').every(x => parseFloat(x) === 0))); assert.ok((await barras()).every(x => /^0s(, 0s)*$/.test(x.d))); ok('com "reduzir movimento" ligado nenhuma animação roda'); await ctx.close();

        console.log('\nMENU LATERAL: TUDO OK'); fim(0);
    } catch (e) { console.error('\nFALHOU: ' + (e && e.stack || e)); fim(1); }
})();
