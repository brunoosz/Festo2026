// teste automatico da etapa 3: servo no Painel de Controle e caixas da visao compartilhadas entre as telas
// uso: node tools/testes/etapa3.js   (ou npm test)
const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const mqtt = require('mqtt');
const { criarUsuariosTeste, SENHA_TESTE } = require('../seed_teste');

const PORTA_SITE = 5057, PORTA_MQTT = 18832;
const B = `http://127.0.0.1:${PORTA_SITE}`;
const raiz = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flowpack-teste3-'));
const esperar = ms => new Promise(r => setTimeout(r, ms));
const ok = m => console.log('  ok   ' + m);

process.env.MOCK_MQTT_PORT = String(PORTA_MQTT);
const { iniciar } = require('../mock_mqtt');

// ---------- parte 1: o desenho (public/js/overlay-visao.js) com um canvas de mentira ----------
function canvasDeMentira() {
    const chamadas = [];
    const ctx = {
        fillStyle: '', strokeStyle: '', lineWidth: 1, font: '',
        save() {}, restore() {}, setLineDash() {}, beginPath() {}, stroke() { chamadas.push(['stroke', this.strokeStyle]); },
        moveTo(x, y) { chamadas.push(['moveTo', x, y]); }, lineTo() {},
        measureText(t) { return { width: t.length * 7 }; },
        fillRect(...a) { chamadas.push(['fillRect', this.fillStyle, ...a]); }, strokeRect(...a) { chamadas.push(['strokeRect', this.strokeStyle, ...a]); },
        fillText(t, x, y) { chamadas.push(['fillText', t, x, y]); }, clearRect() { chamadas.push(['clearRect']); }, drawImage() { chamadas.push(['drawImage']); }
    };
    return { canvas: { width: 320, height: 240, getContext: () => ctx }, chamadas };
}
function testarDesenho() {
    const janela = {};
    vm.runInNewContext(fs.readFileSync(path.join(raiz, 'public', 'js', 'overlay-visao.js'), 'utf8'), { window: janela, Date });
    const overlay = { w: 320, h: 240, eixo: 'x', linha: 0.5, banda: [0.4, 0.6], segmentos: [{ id: 1, ini: 0.1, fim: 0.2, contado: false }, { id: 2, ini: 0.45, fim: 0.55, contado: true }] };

    let { canvas, chamadas } = canvasDeMentira();
    let vis = janela.OverlayVisao.criar(canvas);
    vis.definirOverlay(overlay);
    assert.ok(chamadas.some(c => c[0] === 'fillRect' && /0\.18/.test(c[1]) && Math.round(c[3]) === 96 && Math.round(c[5]) === 48), 'faixa azul'); ok('desenha a faixa azul de detecção');
    assert.ok(chamadas.some(c => c[0] === 'moveTo' && c[1] === 160), 'linha'); ok('desenha a linha de contagem');
    assert.ok(chamadas.some(c => c[0] === 'strokeRect' && c[1] === '#facc15') && chamadas.some(c => c[0] === 'strokeRect' && c[1] === '#22c55e')); ok('caixa amarela (acompanhando) e verde (já contada)');
    assert.ok(chamadas.some(c => c[0] === 'fillText' && c[1] === '#1') && chamadas.some(c => c[0] === 'fillText' && c[1] === '#2')); ok('numera cada caixa');
    chamadas.length = 0; vis.registrarEvento({ classe: 'Arroz', confianca: 0.92, quantidade: 1 });
    const rotulo = chamadas.find(c => c[0] === 'fillText' && c[1] === 'Arroz 92%');
    assert.ok(rotulo && rotulo[2] >= 0.45 * 320 - 4, 'rotulo na caixa contada'); ok('mostra o nome do produto e a confiança (%) perto da caixa contada');
    assert.ok(!chamadas.some(c => c[0] === 'fillText' && /Arroz/.test(c[1]) && c[2] < 0.3 * 320), 'rotulo na caixa errada'); ok('o rótulo não vai para a caixa que ainda não foi contada');
    vis.registrarEvento({ classe: null, motivo: 'desconhecido', confianca: 0, quantidade: 1 }); vis.definirOverlay(Object.assign({}, overlay, { segmentos: [] }));
    chamadas.length = 0; vis.definirOverlay(overlay);
    assert.ok(!chamadas.some(c => c[0] === 'fillText' && /Arroz/.test(c[1])), 'rotulo antigo reapareceu'); ok('o rótulo some junto com a caixa');

    ({ canvas, chamadas } = canvasDeMentira());
    vis = janela.OverlayVisao.criar(canvas, { fundo: false, banda: false });
    vis.definirOverlay(overlay);
    assert.ok(chamadas.some(c => c[0] === 'clearRect') && !chamadas.some(c => c[0] === 'drawImage') && !chamadas.some(c => c[0] === 'fillRect' && /0\.18/.test(c[1])), 'modo so overlay');
    assert.ok(chamadas.some(c => c[0] === 'strokeRect')); ok('na tela Visão: só a camada por cima da imagem (sem repetir a faixa que ela já tem)');
}

(async () => {
    console.log('1) Desenho compartilhado'); testarDesenho();

    criarUsuariosTeste(path.join(tmp, 'usuarios.json'));
    const { aedes, servidor } = await iniciar({ placas: false });
    const gravado = [];
    aedes.on('publish', (p, c) => { if (c) gravado.push(p.topic + ' ' + p.payload.toString()); });
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
        for (let i = 0; i < 40 && !gravado.some(x => x.startsWith('separador/config')); i++) await esperar(250);

        const entrar = async u => {
            const resp = await fetch(B + '/', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `username=${u}&password=${SENHA_TESTE}` });
            const c = (resp.headers.getSetCookie ? resp.headers.getSetCookie() : []).map(x => x.split(';')[0]).join('; ');
            assert.ok(c.includes('connect.sid'), 'login falhou para ' + u); return c;
        };
        const chamar = async (metodo, p, c, corpo) => {
            const r = await fetch(B + p, { method: metodo, redirect: 'manual', headers: Object.assign({ Cookie: c }, corpo !== undefined ? { 'Content-Type': 'application/json' } : {}), body: corpo !== undefined ? JSON.stringify(corpo) : undefined });
            const texto = await r.text(); let json = null; try { json = JSON.parse(texto); } catch (e) {}
            return { status: r.status, json, texto };
        };
        const adm = await entrar('adm'), oper = await entrar('operario'), vis = await entrar('visualizador');

        console.log('2) As duas telas usam o mesmo desenho');
        assert.strictEqual((await fetch(B + '/js/overlay-visao.js')).status, 200); ok('o arquivo compartilhado é servido (sem CDN)');
        for (const rota of ['/separador', '/visao']) assert.ok((await chamar('GET', rota, adm)).texto.includes('/js/overlay-visao.js'), rota);
        ok('as telas Separador e Visão carregam o mesmo arquivo');
        const fonteSeparador = fs.readFileSync(path.join(raiz, 'views', 'separador.html'), 'utf8');
        assert.ok(!/strokeRect|setLineDash/.test(fonteSeparador)); ok('o código de desenho não está mais duplicado na tela Separador');
        const visao = (await chamar('GET', '/visao', adm)).texto;
        assert.ok(visao.includes('id="overlay-camera"') && visao.includes("'separador_overlay'") && visao.includes("'separador_evento'")); ok('a tela Visão recebe a sobreposição e as contagens do separador');

        // servo de mentira: avisa que esta online e informa o estado
        const esp = mqtt.connect(`mqtt://127.0.0.1:${PORTA_MQTT}`); await new Promise(res => esp.on('connect', res));
        const avisarServo = () => { esp.publish('separador/status', 'online'); esp.publish('separador/estado', JSON.stringify({ lado: 'C', angulo: 90, fila: 0 })); };
        avisarServo(); const batimento = setInterval(avisarServo, 1000); await esperar(600);

        console.log('3) Servo no Painel de Controle');
        const painel = (await chamar('GET', '/controle', adm)).texto;
        for (const id of ['card-servo', 'led-painel-servo', 'servo-teste-e', 'servo-teste-c', 'servo-teste-d', 'servo-ang-esq', 'servo-ang-cen', 'servo-ang-dir', 'servo-vel', 'servo-aberto', 'servo-ativo'])
            assert.ok(painel.includes('id="' + id + '"'), 'faltou ' + id);
        ok('o painel tem LED, estado, testes E/C/D, ângulos, velocidade, tempo aberto e "servo ligado"');
        assert.strictEqual((await chamar('GET', '/controle', oper)).status, 403); ok('Operário continua sem acesso ao painel');

        gravado.length = 0;
        let r = await chamar('POST', '/api/separador/config', adm, { anguloEsq: 50, anguloCentro: 88, anguloDir: 130, velocidadeServo: 70, tempoAbertoMs: 800, servoAtivo: true });
        assert.strictEqual(r.status, 200); await esperar(400);
        const cfg = gravado.find(x => x.startsWith('separador/config '));
        assert.ok(cfg && /"esq":50/.test(cfg) && /"centro":88/.test(cfg) && /"dir":130/.test(cfg) && /"vel":70/.test(cfg) && /"aberto":800/.test(cfg), 'config nao chegou: ' + cfg);
        ok('mudar ângulos, velocidade e tempo aberto chama /api/separador/config e o ESP32 recebe separador/config');
        const est = (await chamar('GET', '/api/separador/estado', adm)).json;
        assert.ok(est.config.anguloEsq === 50 && est.config.servoAtivo === true && est.config.tempoAbertoMs === 800 && est.servo); ok('o painel lê de volta os valores e o estado do servo');
        gravado.length = 0;
        for (const lado of ['E', 'C', 'D']) { r = await chamar('POST', '/api/separador/servo/teste', adm, { lado }); assert.strictEqual(r.status, 200, 'teste ' + lado); }
        await esperar(400);
        assert.strictEqual(gravado.filter(x => x.startsWith('separador/teste')).length, 3); ok('testar esquerda, centro e direita publica separador/teste (3 vezes)');

        console.log('4) Emergência trava o servo');
        esp.publish('esteira/botao', 'emergencia'); await esperar(700);
        gravado.length = 0;
        r = await chamar('POST', '/api/separador/servo/teste', adm, { lado: 'E' });
        assert.strictEqual(r.status, 423); assert.ok(/mergencia/.test(r.json.erro)); ok('com emergência ativa o teste do servo responde 423 com a mensagem');
        await esperar(300); assert.ok(!gravado.some(x => x.startsWith('separador/teste')), 'servo mexeu'); ok('e nada chega ao servo');
        const painelTravado = (await chamar('POST', '/api/emergencia/liberar', adm, {})); assert.strictEqual(painelTravado.status, 200); ok('depois de desbloquear, volta ao normal');
        r = await chamar('POST', '/api/separador/servo/teste', adm, { lado: 'C' }); assert.strictEqual(r.status, 200);
        clearInterval(batimento); esp.end(true);

        console.log('5) Visualizador');
        const estVis = (await chamar('GET', '/api/separador/estado', vis)).json;
        assert.ok(estVis.config && estVis.servo); ok('enxerga o estado e os valores do servo (somente leitura)');
        assert.strictEqual((await chamar('GET', '/controle', vis)).status, 200); ok('abre o Painel de Controle');
        assert.strictEqual((await chamar('POST', '/api/separador/servo/teste', vis, { lado: 'E' })).status, 403);
        assert.strictEqual((await chamar('POST', '/api/separador/config', vis, { anguloEsq: 10 })).status, 403); ok('mas não consegue testar nem alterar o servo (403)');

        console.log('\nETAPA 3: TUDO OK'); fim(0);
    } catch (err) {
        console.log('\nFALHOU:', String(err.message).slice(0, 500)); console.log('--- log do site:\n' + saida.slice(-900)); fim(1);
    }
})().catch(e => { console.log('FALHOU:', e.message); process.exit(1); });
