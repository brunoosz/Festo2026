// GitHub: https://github.com/brunoosz | LinkedIn: https://www.linkedin.com/in/brunocamperlingo/
// teste NFC
const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mqtt = require('mqtt');
const { criarUsuariosTeste, SENHA_TESTE } = require('../seed_teste');

const PORTA_SITE = 5058, PORTA_MQTT = 18833;
const B = `http://127.0.0.1:${PORTA_SITE}`;
const raiz = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flowpack-testenfc-'));
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
    const fim = codigo => { try { site.kill(); } catch (e) {} servidor.close(); try { aedes.close(); } catch (e) {} fs.rmSync(tmp, { recursive: true, force: true }); setTimeout(() => process.exit(codigo), 300); };

    try {
        site = spawn('node', ['server.js'], {
            cwd: raiz, stdio: ['ignore', 'pipe', 'pipe'],
            env: Object.assign({}, process.env, {
                PORT: String(PORTA_SITE), MQTT_BROKER: `mqtt://127.0.0.1:${PORTA_MQTT}`, NFC_JANELA_MS: '2500',
                USUARIOS_JSON: path.join(tmp, 'usuarios.json'), EMERGENCIA_JSON: path.join(tmp, 'emergencia.json'),
                RECEITAS_JSON: path.join(tmp, 'receitas.json'), CARTOES_NFC_JSON: path.join(tmp, 'cartoes.json'), SESSION_SECRET: 'segredo-so-de-teste'
            })
        });
        site.stdout.on('data', d => { saida += d; }); site.stderr.on('data', d => { saida += d; });
        for (let i = 0; i < 60; i++) { await esperar(250); try { if ((await fetch(B + '/sobre')).status === 200) break; } catch (e) {} }
        await esperar(800);

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
        const dono = await entrar('dono'), adm = await entrar('adm'), oper = await entrar('operario'), vis = await entrar('visualizador');

        const placa = mqtt.connect(`mqtt://127.0.0.1:${PORTA_MQTT}`); await new Promise(res => placa.on('connect', res));
        const respostas = [];
        placa.subscribe(['nfc/resultado', 'painel/resultado']); placa.on('message', (t, m) => respostas.push(t.split('/')[0] + ':' + m.toString()));
        const ultima = async (acao) => { respostas.length = 0; acao(); await esperar(450); return respostas[respostas.length - 1]; };
        const cartao = uid => ultima(() => placa.publish('nfc/leitura', uid));
        const botao = b => ultima(() => placa.publish('painel/botao', b));
        const receita = async () => (await chamar('GET', '/api/receitas', dono)).json.atual;
        placa.publish('nfc/status', 'online'); await esperar(300);

        console.log('1) Tela e acesso');
        assert.strictEqual((await chamar('GET', '/nfc', adm)).status, 200); ok('Adm abre a tela Cartões NFC');
        assert.ok((await chamar('GET', '/nfc', dono)).texto.includes('link-nfc')); ok('o menu mostra "Cartões NFC" para Dono/Adm');
        assert.notStrictEqual((await chamar('GET', '/nfc', oper)).status, 200); assert.notStrictEqual((await chamar('GET', '/api/nfc/estado', oper)).status, 200);
        ok('Operário não abre a tela nem a API de cartões');
        assert.strictEqual((await chamar('GET', '/api/nfc/estado', vis)).json.podeCadastrar, false); assert.strictEqual((await chamar('POST', '/api/nfc/cadastrar', vis, { usuario: 'dono' })).status, 403);
        ok('Visualizador só olha (sem cadastrar); os dados mascarados são testados em lote3_etapa2')
        assert.ok(!(await chamar('GET', '/dashboard', oper)).texto.includes('id="link-nfc"')); ok('Operário nem vê o item no menu');
        let st = (await chamar('GET', '/api/nfc/estado', adm)).json; assert.strictEqual(st.online, true); assert.strictEqual(st.podeCadastrar, false); ok('o leitor aparece online; Adm vê mas não cadastra');

        console.log('2) Cadastro (só o Dono)');
        assert.strictEqual((await chamar('POST', '/api/nfc/cadastrar', adm, { usuario: 'dono' })).status, 403); ok('Adm não consegue cadastrar cartão');
        assert.strictEqual((await chamar('POST', '/api/nfc/cadastrar', dono, { usuario: 'operario' })).status, 400); ok('não dá para cadastrar cartão de Operário');
        assert.strictEqual((await chamar('POST', '/api/nfc/cadastrar', dono, { usuario: 'dono' })).status, 200);
        assert.strictEqual(await cartao('AABBCCDD'), 'nfc:cadastrado'); ok('Dono cadastra o cartão e a placa recebe "cadastrado"');
        assert.strictEqual((await chamar('POST', '/api/nfc/cadastrar', dono, { usuario: 'adm' })).status, 200);
        assert.strictEqual(await cartao('11223344'), 'nfc:cadastrado'); ok('cartão do Adm cadastrado');
        assert.strictEqual((await chamar('POST', '/api/nfc/cadastrar', dono, { usuario: 'adm' })).status, 200);
        assert.strictEqual(await cartao('AABBCCDD'), 'nfc:negado'); await chamar('POST', '/api/nfc/cadastrar/cancelar', dono, {}); ok('um cartão não pode ficar com dois usuários');
        st = (await chamar('GET', '/api/nfc/estado', dono)).json;
        assert.strictEqual(st.cartoes.length, 2); assert.ok(st.cartoes.every(c => c.final.length === 4)); assert.ok(!JSON.stringify(st).includes('AABBCCDD')); ok('a lista mostra só o final de 4 dígitos (o número completo não sai do servidor)');

        console.log('3) Cartão libera a emergência');
        placa.publish('esteira/botao', 'emergencia'); await esperar(500);
        assert.strictEqual((await chamar('GET', '/api/emergencia', dono)).json.ativa, true); ok('emergência ativa');
        assert.strictEqual(await cartao('DEADBEEF'), 'nfc:negado'); assert.strictEqual((await chamar('GET', '/api/emergencia', dono)).json.ativa, true); ok('cartão desconhecido -> "negado" e nada libera');
        gravado.length = 0;
        assert.strictEqual(await cartao('AABBCCDD'), 'nfc:liberado'); assert.strictEqual((await chamar('GET', '/api/emergencia', dono)).json.ativa, false);
        assert.ok(gravado.includes('esteira/liberar 1')); ok('cartão do Dono -> "liberado" e a máquina destrava');
        assert.strictEqual(await cartao('11223344'), 'nfc:ok'); ok('sem emergência o cartão só responde "ok"');
        assert.strictEqual((await chamar('POST', '/api/emergencia/liberar', oper, {})).status, 403); ok('Operário não libera pelo site (403)');
        assert.strictEqual((await chamar('POST', '/api/emergencia/liberar', vis, {})).status, 403); ok('Visualizador também não');

        const [dd, mm, aa] = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }).split(', ')[0].split('/');
        const diaLogs = (await chamar('GET', `/api/logs/${aa}-${mm}-${dd}`, dono)).json;
        assert.ok(Array.isArray(diaLogs) && diaLogs.length && diaLogs.every(l => l && typeof l.texto === 'string'), 'log com item sem texto');
        assert.ok(diaLogs.some(l => /NFC|EMERGENCIA/i.test(l.texto))); ok('os logs de emergência e de cartão aparecem no histórico (Relatórios) como registros completos');

        console.log('4) Bloqueio por recusas seguidas');
        for (const u of ['01010101', '02020202']) assert.strictEqual(await cartao(u), 'nfc:negado');
        assert.strictEqual(await cartao('03030303'), 'nfc:negado');
        assert.strictEqual(await cartao('AABBCCDD'), 'nfc:bloqueado'); ok('3 recusas seguidas bloqueiam o leitor (até o cartão bom é recusado)');
        st = (await chamar('GET', '/api/nfc/estado', adm)).json; assert.ok(st.bloqueadoS > 0); ok('a tela mostra o tempo de bloqueio');

        console.log('5) Botões MAIS/MENOS do painel (janela de 2,5 s neste teste)');
        // fim do bloqueio
        await esperar(30500);
        assert.strictEqual((await chamar('POST', '/api/usuarios/adm/nivel', dono, { nivel: 3 })).status, 200);
        assert.strictEqual(await cartao('11223344'), 'nfc:negado'); ok('usuário rebaixado para Operário -> o cartão dele é recusado');
        assert.strictEqual((await chamar('POST', '/api/usuarios/adm/nivel', dono, { nivel: 2 })).status, 200);
        assert.strictEqual(await cartao('11223344'), 'nfc:ok'); ok('promovido de volta, o cartão volta a valer');
        await esperar(2800);
        const r0 = await receita();
        assert.strictEqual(await botao('mais'), 'painel:sem_permissao'); assert.strictEqual(await receita(), r0); ok('MAIS sem cartão -> "sem_permissao" e a receita não muda');
        assert.strictEqual(await cartao('AABBCCDD'), 'nfc:ok');
        assert.strictEqual(await botao('mais'), 'painel:ok'); assert.strictEqual(await receita(), r0 + 1); ok('com cartão aceito, MAIS sobe a receita');
        assert.strictEqual(await botao('menos'), 'painel:ok'); assert.strictEqual(await receita(), r0); ok('MENOS desce (cada uso renova a janela)');
        await esperar(2800);
        assert.strictEqual(await botao('mais'), 'painel:sem_permissao'); assert.strictEqual(await receita(), r0); ok('a janela fecha sozinha');
        placa.publish('esteira/botao', 'mais'); await esperar(400); assert.strictEqual(await receita(), r0); ok('o botão antigo MAIS da esteira também exige o cartão');
        assert.strictEqual(await cartao('AABBCCDD'), 'nfc:ok'); await botao('emergencia');
        await esperar(500);
        assert.strictEqual((await chamar('GET', '/api/emergencia', dono)).json.ativa, true); ok('EMERGÊNCIA do painel funciona sempre (com ou sem cartão)');
        assert.strictEqual(await botao('mais'), 'painel:travado'); ok('em emergência MAIS/MENOS respondem "travado"');
        assert.strictEqual(await cartao('AABBCCDD'), 'nfc:liberado'); assert.strictEqual(await botao('mais'), 'painel:ok'); ok('o cartão libera a emergência e abre a janela de novo');

        console.log('6) Cartão apagado e Sistema');
        st = (await chamar('GET', '/api/nfc/estado', dono)).json;
        assert.strictEqual((await chamar('DELETE', '/api/nfc/cartoes/' + st.cartoes[0].id, adm)).status, 403); ok('Adm não apaga cartão');
        assert.strictEqual((await chamar('DELETE', '/api/nfc/cartoes/' + st.cartoes[0].id, dono)).status, 200);
        assert.strictEqual((await chamar('GET', '/api/nfc/estado', dono)).json.cartoes.length, 1); ok('Dono apaga cartão');
        const sis = (await chamar('GET', '/api/sistema/status', adm)).json;
        assert.ok(sis.dispositivos.some(d => d.id === 'nfc')); ok('o Status do Sistema lista o leitor NFC');

        placa.end(true);
        console.log('\nNFC: TUDO OK'); fim(0);
    } catch (e) {
        console.error('\nFALHOU: ' + (e && e.message)); if (/ECONN|undefined/.test(String(e && e.message))) console.error(saida.slice(-1500)); fim(1);
    }
})();
