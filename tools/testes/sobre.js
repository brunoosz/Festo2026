// teste automatico da pagina publica "Sobre nos" (5 secoes, cartoes da equipe, dados de data/sobre.json)
// uso: node tools/testes/sobre.js   (ou npm test)
const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { criarUsuariosTeste } = require('../seed_teste');

const PORTA = 5059;
const B = `http://127.0.0.1:${PORTA}`;
const raiz = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flowpack-testesobre-'));
const esperar = ms => new Promise(r => setTimeout(r, ms));
const ok = m => console.log('  ok   ' + m);

const dados = {
    grupo: { nome: 'Grupo <b>Teste</b>', frase: 'Frase', curso: 'Curso', logo: '' },
    quemSomos: 'Texto <script>alert(1)</script> quem somos',
    projeto: { problema: 'P', solucao: 'S', integracao: 'I', processo: [{ nome: 'Etapa A', texto: 'x' }], tecnologias: ['Node.js'], galeria: [{ arquivo: '../../etc/passwd', legenda: 'ruim' }, { arquivo: 'ok.jpg', legenda: 'Legenda boa' }] },
    equipe: [
        { nome: 'Ana Maria Souza', foto: '', descricao: 'Desc <img src=x onerror=alert(1)>', habilidades: ['JS'], contribuicao: 'Fez coisas', autorizou: true,
          links: { linkedin: 'https://linkedin.com/in/ana', github: 'javascript:alert(1)', portfolio: '', outro: { nome: 'Behance', url: 'https://behance.net/ana' } },
          contato: { email: 'ana@exemplo.com', telefone: '(11) 91234-5678', whatsapp: '11912345678' } },
        { nome: 'Beto Sem Foto', foto: 'nao-existe.jpg', descricao: 'Oculta', habilidades: ['X'], autorizou: false, contato: { email: 'beto@exemplo.com' } },
        { nome: 'Caio Vazio', autorizou: true }
    ],
    jornada: [{ data: '2026', titulo: 'Marco 1', texto: 'Texto do marco' }],
    aprendemos: ['Aprendizado 1'],
    conecte: { githubProjeto: 'https://github.com/x/y', emailGrupo: '', videos: [] }
};

(async () => {
    criarUsuariosTeste(path.join(tmp, 'usuarios.json'));
    const arq = path.join(tmp, 'sobre.json');
    let site = null, saida = '';
    const subir = async () => {
        site = spawn('node', ['server.js'], { cwd: raiz, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, {
            PORT: String(PORTA), MQTT_BROKER: 'mqtt://127.0.0.1:18899', SOBRE_JSON: arq, USUARIOS_JSON: path.join(tmp, 'usuarios.json'),
            EMERGENCIA_JSON: path.join(tmp, 'e.json'), RECEITAS_JSON: path.join(tmp, 'r.json'), CARTOES_NFC_JSON: path.join(tmp, 'c.json'), SESSION_SECRET: 'x' }) });
        site.stdout.on('data', d => { saida += d; }); site.stderr.on('data', d => { saida += d; });
        for (let i = 0; i < 60; i++) { await esperar(250); try { if ((await fetch(B + '/sobre')).status === 200) return; } catch (e) {} }
    };
    const fim = c => { try { site.kill(); } catch (e) {} fs.rmSync(tmp, { recursive: true, force: true }); setTimeout(() => process.exit(c), 300); };
    try {
        fs.writeFileSync(arq, JSON.stringify(dados));
        await subir();
        const pagina = async () => (await fetch(B + '/sobre')).text();
        let h = await pagina();

        console.log('1) Estrutura');
        for (const id of ['quem-somos', 'projeto', 'equipe', 'jornada', 'contato']) assert.ok(h.includes('id="' + id + '"') && h.includes('href="#' + id + '"'), id);
        ok('as 5 seções existem e o menu do topo tem uma âncora para cada uma');
        assert.ok(/ENTRAR NO SISTEMA/.test(h) && h.includes('href="/"')); ok('botão "Entrar no sistema"');
        assert.ok(h.includes('Marco 1') && h.includes('Aprendizado 1') && h.includes('Etapa A') && h.includes('Node.js')); ok('jornada, aprendizados, linha do processo e tecnologias vêm do JSON');

        console.log('2) Cartões da equipe');
        assert.ok(h.includes('Ana Maria Souza') && h.includes('Caio Vazio') && h.includes('Beto Sem Foto')); ok('um cartão por integrante');
        assert.ok(h.includes('>AS<') && h.includes('>CV<')); ok('sem foto aparece o círculo com as iniciais (sem aviso de erro)');
        assert.ok(h.includes('href="mailto:ana@exemplo.com"')); ok('e-mail vira mailto:');
        assert.ok(h.includes('href="tel:+5511912345678"')); ok('telefone vira tel:');
        assert.ok(h.includes('https://wa.me/5511912345678')); ok('WhatsApp vira link wa.me');
        assert.ok(h.includes('https://linkedin.com/in/ana') && h.includes('Behance')); ok('LinkedIn e outro link aparecem');
        assert.ok(!h.includes('javascript:')); ok('link com javascript: é descartado');
        assert.ok(!h.includes('beto@exemplo.com') && !h.includes('Oculta') && !h.includes('nao-existe.jpg')); ok('quem não autorizou mostra só o nome');
        const caio = h.slice(h.indexOf('Caio Vazio')); assert.ok(!/mailto:|tel:|wa\.me/.test(caio.split('</article>')[0])); ok('campo vazio some (sem links nem botões)');
        assert.ok(!/(<a[^>]+href="https?:[^>]*>)/.test(h.replace(/<a[^>]+target="_blank"[^>]+rel="noopener noreferrer"[^>]*>/g, ''))); ok('todo link externo tem target="_blank" rel="noopener noreferrer"');

        console.log('3) Segurança');
        assert.ok(!h.includes('<script>alert(1)') && !h.includes('<img src=x') && !h.includes('<b>Teste</b>')); ok('HTML dentro do JSON é escapado');
        assert.ok(!h.includes('etc/passwd') && h.includes('/img/projeto/ok.jpg') && h.includes('Legenda boa')); ok('nome de imagem perigoso é descartado; a galeria só usa public/img/projeto');
        assert.ok(!/socket\.io|\/api\//.test(h) && !/<script[^>]+src="https?:/.test(h)); ok('sem API, sem socket e sem CDN');
        assert.ok(!/RM\s*\d/.test(h)); ok('RM não aparece');

        console.log('4) Arquivo ausente ou inválido');
        fs.writeFileSync(arq, '{ isso nao e json'); h = await pagina();
        assert.ok(h.includes('ENTRAR NO SISTEMA') && h.includes('Dark Coders')); ok('JSON inválido -> página mínima, sem erro');
        fs.rmSync(arq); h = await pagina(); assert.ok(h.includes('ENTRAR NO SISTEMA')); ok('arquivo ausente -> página mínima, sem erro');
        fs.writeFileSync(arq, '{"equipe":"texto","jornada":5,"projeto":null}'); h = await pagina(); assert.ok(h.includes('ENTRAR NO SISTEMA')); ok('tipos errados no JSON não derrubam a página');
        assert.strictEqual((await fetch(B + '/dashboard', { redirect: 'manual' })).status, 302); ok('o resto do site continua pedindo login');

        console.log('\nSOBRE: TUDO OK'); fim(0);
    } catch (e) { console.error('\nFALHOU: ' + (e && e.message)); console.error(saida.slice(-800)); fim(1); }
})();
