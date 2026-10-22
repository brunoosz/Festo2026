// teste automatico do lote 3, etapa 3: editor do conteudo da pagina publica (so o Dono), links por colagem, versoes, fotos e previa
// uso: node tools/testes/lote3_etapa3.js   (ou npm test)
const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Jimp = require('jimp');
const { criarUsuariosTeste, SENHA_TESTE } = require('../seed_teste');
const SobreLink = require('../../public/js/sobre-link.js');

const PORTA = 5065;
const B = `http://127.0.0.1:${PORTA}`;
const raiz = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flowpack-lote3e3-'));
const esperar = ms => new Promise(r => setTimeout(r, ms));
const ok = m => console.log('  ok   ' + m);

(async () => {
    criarUsuariosTeste(path.join(tmp, 'usuarios.json'));
    const arq = path.join(tmp, 'sobre.json'), imgs = path.join(tmp, 'img'), backups = path.join(tmp, 'backups');
    fs.copyFileSync(path.join(raiz, 'data', 'sobre.json'), arq);
    let site = null, saida = '';
    const fim = c => { try { site.kill(); } catch (e) {} fs.rmSync(tmp, { recursive: true, force: true }); setTimeout(() => process.exit(c), 300); };
    try {
        site = spawn('node', ['server.js'], { cwd: raiz, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, {
            PORT: String(PORTA), MQTT_BROKER: 'mqtt://127.0.0.1:18897', USUARIOS_JSON: path.join(tmp, 'usuarios.json'), EMERGENCIA_JSON: path.join(tmp, 'e.json'), RECEITAS_JSON: path.join(tmp, 'r.json'),
            CARTOES_NFC_JSON: path.join(tmp, 'c.json'), SOBRE_JSON: arq, SOBRE_IMG_DIR: imgs, SOBRE_BACKUPS_DIR: backups, SESSION_SECRET: 'x' }) });
        site.stdout.on('data', d => { saida += d; }); site.stderr.on('data', d => { saida += d; });
        for (let i = 0; i < 60; i++) { await esperar(250); try { if ((await fetch(B + '/sobre')).status === 200) break; } catch (e) {} }
        const entrar = async nome => {
            const r = await fetch(B + '/', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `username=${nome}&password=${SENHA_TESTE}` });
            const c = (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map(x => x.split(';')[0]).join('; '); assert.ok(c.includes('connect.sid'), nome); return c;
        };
        const chamar = async (metodo, p, c, corpo, tipo) => {
            const r = await fetch(B + p, { method: metodo, redirect: 'manual', headers: Object.assign({ Cookie: c }, corpo !== undefined ? { 'Content-Type': tipo || 'application/json' } : {}), body: corpo === undefined ? undefined : (Buffer.isBuffer(corpo) ? corpo : JSON.stringify(corpo)) });
            const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {} return { status: r.status, json: j, texto: t, headers: r.headers };
        };
        const dono = await entrar('dono'), adm = await entrar('adm'), oper = await entrar('operario'), vis = await entrar('visualizador');

        console.log('1) Só o Dono: para os outros perfis nada existe (404)');
        const rotas = [['GET', '/sobre/editar'], ['GET', '/api/sobre'], ['PUT', '/api/sobre', { dados: {}, versaoBase: 1 }], ['POST', '/api/sobre/validar', { dados: {} }], ['GET', '/api/sobre/versoes'], ['POST', '/api/sobre/restaurar/sobre-20260101-000000', {}], ['POST', '/api/sobre/previa', { dados: {} }], ['GET', '/sobre/previa'], ['POST', '/api/sobre/foto/equipe?id=abc', Buffer.from('x'), 'application/octet-stream']];
        for (const [nome, c] of [['Adm', adm], ['Operário', oper], ['Visualizador', vis]]) for (const [m, p, corpo, tipo] of rotas) assert.strictEqual((await chamar(m, p, c, corpo, tipo)).status, 404, nome + ' ' + m + ' ' + p);
        ok('Adm, Operário e Visualizador recebem 404 em todas as rotas e APIs do editor (página, dados, salvar, versões, prévia e fotos)');
        const anon = await fetch(B + '/api/sobre', { redirect: 'manual' }); assert.strictEqual(anon.status, 302); ok('sem login: vai para a tela de login');
        assert.strictEqual((await chamar('GET', '/sobre/editar', dono)).status, 200); ok('o Dono abre o editor');
        const cfg = async c => (await chamar('GET', '/configuracoes', c)).texto;
        assert.ok((await cfg(dono)).includes('href="/sobre/editar"') && (await cfg(dono)).includes('aria-label="Mais"')); ok('em Configurações o Dono vê o círculo discreto (sem texto, aria-label neutro)');
        for (const c of [adm, oper, vis]) assert.ok(!(await cfg(c)).includes('/sobre/editar')); ok('os outros perfis não veem nem o círculo');
        const rastros = [(await chamar('GET', '/dashboard', dono)).texto, fs.readFileSync(path.join(raiz, 'public/js/tutorial-roteiro.js'), 'utf8'), fs.readFileSync(path.join(raiz, 'README.md'), 'utf8'),
            ...fs.readdirSync(path.join(raiz, 'knowledge')).map(f => fs.readFileSync(path.join(raiz, 'knowledge', f), 'utf8')), fs.readFileSync(path.join(raiz, 'views/base.html'), 'utf8')];
        assert.ok(rastros.every(t => !/sobre\/editar|editor do sobre|editar o sobre/i.test(t))); ok('nem o menu, nem o tutorial, nem a IA, nem o README público falam do editor');

        console.log('2) Colar o link cria a caixinha certa');
        const casos = [['https://www.linkedin.com/in/bruno-silva-4a1b2c3d/', 'linkedin', 'Bruno Silva'], ['github.com/brunoosz', 'github', 'brunoosz'], ['https://instagram.com/dark.coders', 'instagram'], ['https://youtu.be/abc123', 'youtube'], ['https://x.com/foo', 'x'], ['https://twitter.com/foo', 'x'], ['https://www.behance.net/ana', 'behance'], ['https://wa.me/5511912345678', 'whatsapp'], ['ana@exemplo.com', 'email'], ['mailto:ana@exemplo.com', 'email'], ['(11) 91234-5678', 'telefone'], ['meusite.com.br/portfolio', 'site']];
        for (const [entrada, tipo, nome] of casos) { const r = SobreLink.detectar(entrada); assert.ok(r.ok && r.tipo === tipo, entrada + ' -> ' + JSON.stringify(r)); if (nome) assert.strictEqual(r.sugestaoNome, nome); }
        ok('LinkedIn, GitHub, Instagram, YouTube, X/Twitter, Behance, WhatsApp, e-mail, telefone e site são reconhecidos só pelo texto');
        assert.strictEqual(SobreLink.detectar('(11) 91234-5678').url, 'tel:+5511912345678'); assert.strictEqual(SobreLink.detectar('(11) 91234-5678').extra.url, 'https://wa.me/5511912345678'); ok('telefone vira tel: e oferece também o WhatsApp');
        for (const ruim of ['javascript:alert(1)', 'data:text/html,1', 'ftp://x.com/a', 'isso nao e link', '']) assert.strictEqual(SobreLink.detectar(ruim).ok, false, ruim); ok('javascript:, data:, ftp e texto solto são recusados');
        const editor = (await chamar('GET', '/sobre/editar', dono)).texto;
        for (const t of ['data-colar', 'SobreLink.detectar', 'paste', 'draggable', 'data-acao="mover"', 'beforeunload', "'/api/sobre/previa'", 'Ordenar por data', 'Restaurar esta versão']) assert.ok(editor.includes(t) || editor.includes(t.replace(/'/g, '"')), t);
        assert.ok(!/<script[^>]+src="https?:/.test(editor)); ok('a tela do editor tem o campo de colar, setas, arrastar, aviso ao sair, prévia, ordenar por data e histórico (sem CDN)');

        console.log('3) Salvar, validação e conflito de versão');
        let r = await chamar('GET', '/api/sobre', dono); const dados = r.json.dados;
        assert.strictEqual(dados.secoes.length, 6); assert.ok(dados.equipe.every(p => p.id && Array.isArray(p.links))); assert.ok(Object.keys(r.json.icones).length === 10); ok('o editor recebe seções, integrantes com id e links em caixinhas, e os 10 ícones locais');
        const ruim = JSON.parse(JSON.stringify(dados));
        ruim.equipe[0].links.push({ id: 'abc12', tipo: 'site', rotulo: 'x', url: 'javascript:alert(1)', visivel: true }); ruim.equipe[0].email = 'sem-arroba'; ruim.equipe[0].telefone = '12'; ruim.equipe[1].nome = ''; ruim.quemSomos = 'a'.repeat(1600); ruim.jornada.push({ id: 'zzz1', data: '', titulo: '', texto: '' });
        r = await chamar('PUT', '/api/sobre', dono, { dados: ruim, versaoBase: dados.versao });
        assert.strictEqual(r.status, 422); const e = r.json.erros;
        assert.ok(e['equipe.0.links.' + (ruim.equipe[0].links.length - 1) + '.url'] && e['equipe.0.email'] && e['equipe.0.telefone'] && e['equipe.1.nome'] && e['quemSomos'] && e['jornada.' + (ruim.jornada.length - 1) + '.titulo']); ok('campos inválidos voltam com a mensagem de cada campo (422) e nada é salvo');
        assert.deepStrictEqual((await chamar('POST', '/api/sobre/validar', dono, { dados: ruim })).json.erros, e); ok('a validação ao vivo do editor devolve as mesmas mensagens');
        assert.ok(!fs.existsSync(backups)); ok('um salvamento recusado não cria backup');

        const novo = JSON.parse(JSON.stringify(dados));
        novo.quemSomos = 'Texto novo <script>alert(1)</script> da equipe.'; novo.grupo.frase = 'Frase <b>negrito</b>';
        novo.secoes = [novo.secoes[3], novo.secoes[0], novo.secoes[1], novo.secoes[2], novo.secoes[4], novo.secoes[5]]; novo.secoes.find(s => s.id === 'jornada').visivel = false;
        novo.equipe.push({ id: 'ana1', nome: 'Ana Maria Souza', foto: '', descricao: 'Desc', habilidades: ['JS'], contribuicao: '', links: [], email: 'ana@exemplo.com', telefone: '(11) 91234-5678', whatsapp: '', mostrarContatos: true, visivel: true });
        novo.equipe[novo.equipe.length - 1].links = ['https://www.linkedin.com/in/ana-souza', 'https://instagram.com/ana', 'https://youtu.be/xyz', 'https://github.com/ana'].map((u, i) => { const d = SobreLink.detectar(u); return { id: 'l' + i, tipo: d.tipo, rotulo: d.rotulo, url: d.url, visivel: i !== 2 }; });
        novo.equipe.push({ id: 'beto', nome: 'Beto Escondido', descricao: 'NaoMostrar', habilidades: [], links: [], email: '', telefone: '', whatsapp: '', mostrarContatos: false, visivel: false });
        novo.equipe.push({ id: 'caio', nome: 'Caio Sem Contato', descricao: 'Aparece', habilidades: [], links: [{ id: 'c1', tipo: 'github', rotulo: 'GitHub', url: 'https://github.com/caio', visivel: true }], email: 'caio@exemplo.com', telefone: '', whatsapp: '', mostrarContatos: false, visivel: true });
        novo.conecte.links = [{ id: 'g1', tipo: 'github', rotulo: 'GitHub do projeto', url: 'https://github.com/x/y', visivel: true }, { id: 'g2', tipo: 'email', rotulo: 'E-mail', url: 'mailto:grupo@exemplo.com', visivel: false }];
        r = await chamar('PUT', '/api/sobre', dono, { dados: novo, versaoBase: dados.versao }); assert.strictEqual(r.status, 200, JSON.stringify(r.json)); assert.strictEqual(r.json.dados.versao, dados.versao + 1); assert.strictEqual(r.json.dados.atualizadoPor, 'dono');
        ok('salvar grava a nova versão (versão + 1, quem e quando)');
        let pub = (await chamar('GET', '/sobre', '')).texto;
        const pos = id => pub.indexOf('id="' + id + '"');
        assert.ok(pos('equipe') > -1 && pos('equipe') < pos('quem-somos') && pos('quem-somos') < pos('projeto')); ok('a página pública segue a nova ordem das seções (Equipe primeiro)');
        assert.strictEqual(pos('jornada'), -1); assert.ok(!/href="#jornada"/.test(pub)); ok('seção desligada some da página e do menu');
        assert.ok(pub.includes('Texto novo &lt;script&gt;') && !pub.includes('<script>alert(1)') && pub.includes('Frase &lt;b&gt;negrito')); ok('HTML digitado aparece como texto');
        assert.ok(pub.includes('Ana Maria Souza') && !pub.includes('Beto Escondido') && !pub.includes('NaoMostrar')); ok('integrante com "aparecer" desligado não aparece');
        assert.ok(pub.includes('Caio Sem Contato') && !pub.includes('caio@exemplo.com') && !pub.includes('github.com/caio')); ok('com "mostrar contatos" desligado, e-mail e links dele não aparecem');
        const ana = pub.slice(pub.indexOf('Ana Maria Souza')).split('</article>')[0];
        assert.ok(ana.includes('mailto:ana@exemplo.com') && ana.includes('tel:+5511912345678') && ana.includes('linkedin.com/in/ana-souza') && ana.includes('instagram.com/ana') && ana.includes('github.com/ana') && !ana.includes('youtu.be/xyz') && (ana.match(/<svg/g) || []).length >= 5); ok('as caixinhas viram links com ícone SVG local; link desligado não aparece');
        assert.ok(pub.includes('github.com/x/y') && !pub.includes('grupo@exemplo.com')); ok('Conecte-se mostra só as caixinhas ligadas');
        const posNomes = ['Ana Maria Souza', 'Caio Sem Contato'].map(n => pub.indexOf(n)); assert.ok(posNomes[0] < posNomes[1]); ok('a ordem dos integrantes é a do editor');
        r = await chamar('PUT', '/api/sobre', dono, { dados: novo, versaoBase: dados.versao }); assert.strictEqual(r.status, 409); assert.ok(/editou antes/.test(r.json.erro)); ok('salvar com versão velha dá 409 ("alguém editou antes")');
        const hoje = (() => { const [d, m, a] = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }).split(', ')[0].split('/'); return `${a}-${m}-${d}`; })();
        assert.ok((await chamar('GET', '/api/logs/' + hoje, dono)).json.some(l => /Conteúdo editado por dono/.test(l.texto))); ok('o salvamento fica no log como "Conteúdo editado" (sem citar a página)');

        console.log('4) Backups (só os 10 mais recentes) e restaurar');
        const textoV2 = (await chamar('GET', '/api/sobre', dono)).json.dados; let v = textoV2;
        for (let i = 0; i < 12; i++) { v.quemSomos = 'Versão número ' + i; r = await chamar('PUT', '/api/sobre', dono, { dados: v, versaoBase: v.versao }); assert.strictEqual(r.status, 200); v = r.json.dados; }
        assert.strictEqual(fs.readdirSync(backups).length, 10); assert.strictEqual(r.json.versoes.length, 10); ok('depois de vários salvamentos sobram só os 10 backups mais recentes');
        const antigo = r.json.versoes[4]; const arquivoAntigo = JSON.parse(fs.readFileSync(path.join(backups, antigo.id + '.json'), 'utf8'));
        r = await chamar('POST', '/api/sobre/restaurar/' + antigo.id, dono, {}); assert.strictEqual(r.status, 200); assert.strictEqual(r.json.dados.quemSomos, arquivoAntigo.quemSomos); assert.ok(r.json.dados.versao > v.versao); ok('restaurar volta o conteúdo daquela versão (e conta como nova versão)');
        assert.strictEqual(fs.readdirSync(backups).length, 10); assert.ok((await chamar('GET', '/sobre', '')).texto.includes(arquivoAntigo.quemSomos)); ok('restaurar também guarda a versão que estava valendo, e a página pública reflete');
        assert.strictEqual((await chamar('POST', '/api/sobre/restaurar/..%2F..%2Fusuarios', dono, {})).status, 404); assert.strictEqual((await chamar('POST', '/api/sobre/restaurar/sobre-20200101-000000', dono, {})).status, 404); ok('id de backup inválido ou inexistente: 404 (sem acesso a outros arquivos)');

        console.log('5) Fotos (opcionais)');
        const png = await new Jimp(1600, 900, 0xFF8800FF).getBufferAsync(Jimp.MIME_PNG);
        v = (await chamar('GET', '/api/sobre', dono)).json.dados; const pessoaId = v.equipe[0].id;
        r = await chamar('POST', '/api/sobre/foto/equipe?id=' + pessoaId, dono, png, 'application/octet-stream'); assert.strictEqual(r.status, 200, JSON.stringify(r.json));
        const salvo = fs.readFileSync(path.join(imgs, 'equipe', r.json.arquivo)); assert.ok(salvo[0] === 0xFF && salvo[1] === 0xD8); const medidas = await Jimp.read(salvo); assert.ok(Math.max(medidas.bitmap.width, medidas.bitmap.height) === 800); assert.ok(!salvo.includes(Buffer.from('Exif'))); ok('PNG grande vira JPG de no máximo 800 px, sem EXIF');
        const foto1 = r.json.arquivo;
        assert.ok(!(await chamar('GET', '/sobre', '')).texto.includes(foto1)); ok('a foto enviada só aparece na página depois de salvar');
        v.equipe[0].foto = foto1; r = await chamar('PUT', '/api/sobre', dono, { dados: v, versaoBase: v.versao }); assert.strictEqual(r.status, 200); v = r.json.dados;
        assert.ok((await chamar('GET', '/sobre', '')).texto.includes('/img/equipe/' + foto1)); ok('depois de salvar, a foto aparece no cartão da página pública');
        r = await chamar('POST', '/api/sobre/foto/equipe?id=' + pessoaId, dono, png, 'application/octet-stream'); const foto2 = r.json.arquivo; v.equipe[0].foto = foto2;
        r = await chamar('PUT', '/api/sobre', dono, { dados: v, versaoBase: v.versao }); v = r.json.dados;
        assert.ok(!fs.existsSync(path.join(imgs, 'equipe', foto1)) && fs.existsSync(path.join(imgs, 'equipe', foto2))); ok('ao trocar a foto a antiga é apagada');
        v.equipe[0].foto = ''; r = await chamar('PUT', '/api/sobre', dono, { dados: v, versaoBase: v.versao }); v = r.json.dados;
        assert.ok(!fs.existsSync(path.join(imgs, 'equipe', foto2))); assert.ok(/class="sb-avatar sb-iniciais"/.test((await chamar('GET', '/sobre', '')).texto)); ok('ao remover a foto o arquivo é apagado e voltam as iniciais');
        assert.strictEqual((await chamar('POST', '/api/sobre/foto/equipe?id=' + pessoaId, dono, Buffer.from('isto nao e uma imagem'), 'application/octet-stream')).status, 415); ok('arquivo que não é imagem é recusado (conferido pelo conteúdo)');
        const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(20)]); assert.strictEqual((await chamar('POST', '/api/sobre/foto/equipe?id=' + pessoaId, dono, webp, 'application/octet-stream')).status, 415); ok('WEBP chegando direto é recusado com mensagem (o editor converte antes de enviar)');
        assert.strictEqual((await chamar('POST', '/api/sobre/foto/equipe?id=' + pessoaId, dono, Buffer.alloc(3.5 * 1024 * 1024, 1), 'application/octet-stream')).status, 413); ok('imagem acima de 3 MB é recusada');
        r = await chamar('POST', '/api/sobre/foto/projeto', dono, png, 'application/octet-stream'); assert.strictEqual(r.status, 200); assert.ok(/^[0-9a-f]{6}\.jpg$/.test(r.json.arquivo) && fs.existsSync(path.join(imgs, 'projeto', r.json.arquivo))); ok('foto da galeria do projeto vai para a pasta do projeto');
        v.projeto.galeria.push({ id: 'g1', arquivo: r.json.arquivo, legenda: 'Legenda <b>x</b>' }); r = await chamar('PUT', '/api/sobre', dono, { dados: v, versaoBase: v.versao }); v = r.json.dados;
        pub = (await chamar('GET', '/sobre', '')).texto; assert.ok(pub.includes('/img/projeto/') && pub.includes('Legenda &lt;b&gt;x')); ok('a galeria aparece na página (legenda escapada)');
        v.projeto.galeria = []; await chamar('PUT', '/api/sobre', dono, { dados: v, versaoBase: v.versao }); assert.ok(fs.readdirSync(path.join(imgs, 'projeto')).length === 0); ok('foto tirada da galeria também é apagada');

        console.log('6) Pré-visualização do rascunho (não publica)');
        v = (await chamar('GET', '/api/sobre', dono)).json.dados; const rascunho = JSON.parse(JSON.stringify(v)); rascunho.quemSomos = 'TEXTO SO DO RASCUNHO';
        assert.strictEqual((await chamar('GET', '/sobre/previa', dono)).status, 302); ok('sem rascunho, a prévia volta para o editor');
        assert.strictEqual((await chamar('POST', '/api/sobre/previa', dono, { dados: rascunho })).status, 200);
        const pre = await chamar('GET', '/sobre/previa', dono); assert.ok(pre.texto.includes('TEXTO SO DO RASCUNHO') && /Pré-visualização/.test(pre.texto) && /no-store/.test(pre.headers.get('cache-control'))); ok('a prévia mostra o rascunho com a faixa "ainda não publicado"');
        assert.ok(!(await chamar('GET', '/sobre', '')).texto.includes('TEXTO SO DO RASCUNHO') && JSON.parse(fs.readFileSync(arq, 'utf8')).quemSomos !== 'TEXTO SO DO RASCUNHO'); ok('a página pública e o arquivo salvo não mudam');

        console.log('7) Compatibilidade com o formato antigo');
        const { normalizar } = require('../../sobre_dados');
        const velho = normalizar({ equipe: [{ nome: 'Fulano', autorizou: true, links: { linkedin: 'https://linkedin.com/in/f', github: 'javascript:x' }, contato: { email: 'f@x.com', telefone: '11912345678' } }, { nome: 'Sem Auto', autorizou: false, descricao: 'oculto' }], conecte: { githubProjeto: 'https://github.com/a/b', emailGrupo: 'g@x.com' } });
        assert.ok(velho.equipe[0].mostrarContatos && velho.equipe[0].links.length === 2 && velho.equipe[0].email === 'f@x.com' && velho.equipe[1].descricao === '' && velho.equipe[1].mostrarContatos === false && velho.conecte.links.length === 2 && velho.secoes.length === 6); ok('o data/sobre.json antigo é convertido sem perder nada permitido (autorizou vira mostrar contatos)');

        console.log('\nLOTE 3 ETAPA 3: TUDO OK'); fim(0);
    } catch (e) { console.error('\nFALHOU: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n') : e)); console.error(saida.slice(0, 500)); fim(1); }
})();
