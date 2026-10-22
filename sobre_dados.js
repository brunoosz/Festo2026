// GitHub: https://github.com/brunoosz | LinkedIn: https://www.linkedin.com/in/brunocamperlingo/
// dados do Sobre nós
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Link = require('./public/js/sobre-link.js');

const SECOES = ['hero', 'quemSomos', 'projeto', 'equipe', 'jornada', 'conecte'];
const LIMITES = { equipe: 12, jornada: 20, linksPessoa: 10, linksGrupo: 12, galeria: 12, aprendemos: 10, tecnologias: 20, processo: 12, habilidades: 8, videos: 6, backups: 10 };
const MAX = { nome: 120, frase: 200, curso: 200, texto: 1500, descricao: 600, contribuicao: 600, habilidade: 50, rotulo: 40, url: 300, email: 120, telefone: 40, data: 40, titulo: 80, marco: 400, legenda: 160, etapaNome: 60, etapaTexto: 160, aprendizado: 200, tecnologia: 50 };

const txt = (v, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const lista = (v, max = 30) => (Array.isArray(v) ? v.slice(0, max) : []);
const novoId = () => crypto.randomBytes(5).toString('hex');
const idSeguro = v => (typeof v === 'string' && /^[a-z0-9-]{3,40}$/.test(v) ? v : novoId());
const nomeImagem = v => { const t = txt(v, 120); return /^[\w][\w.-]*\.(png|jpe?g|webp|gif|svg)$/i.test(t) ? t : ''; };
const emailValido = v => { const t = txt(v, MAX.email); return Link.REGEX_EMAIL.test(t) ? t : ''; };
const telefoneBruto = v => txt(v, MAX.telefone).replace(/[^\d+()\-\s.]/g, '');
const telefoneValido = v => { const d = telefoneBruto(v).replace(/\D/g, ''); return d.length >= 8 && d.length <= 15; };

function iniciais(nome) {
    const p = nome.split(/\s+/).filter(Boolean);
    return p.length ? (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() : '?';
}

// modelo de edição
function linkNovo(l, max) {
    l = l && typeof l === 'object' ? l : {};
    const url = txt(l.url, MAX.url);
    const det = Link.detectar(url);
    const tipo = Link.TIPOS.includes(l.tipo) ? l.tipo : (det.ok ? det.tipo : 'site');
    return { id: idSeguro(l.id), tipo, rotulo: txt(l.rotulo, MAX.rotulo) || Link.ROTULOS[tipo], url, visivel: l.visivel !== false };
}

function linksDoFormatoAntigo(l) {
    const saida = [];
    if (!l || typeof l !== 'object' || Array.isArray(l)) return saida;
    [['linkedin', 'linkedin'], ['github', 'github'], ['portfolio', 'site']].forEach(([k, tipo]) => { if (l[k]) saida.push({ tipo, url: l[k] }); });
    if (l.outro && l.outro.url) saida.push({ tipo: 'site', rotulo: l.outro.nome, url: l.outro.url });
    return saida;
}

function pessoaEdicao(p) {
    const r = pessoaEdicaoBase(p);
    // mostrar contatos
    const temContato = !!(r.email || r.telefone || r.whatsapp || r.links.length);
    const desligado = p && typeof p === 'object' && (p.mostrarContatos === false || (p.mostrarContatos === undefined && p.autorizou === false && temContato));
    r.mostrarContatos = !(desligado && temContato);
    return r;
}

function pessoaEdicaoBase(p) {
    p = p && typeof p === 'object' ? p : {};
    const antigo = p.autorizou !== undefined && p.mostrarContatos === undefined;       // formato antigo
    const semAutorizacao = antigo && p.autorizou !== true;
    const c = p.contato && typeof p.contato === 'object' ? p.contato : {};
    const bruto = semAutorizacao ? {} : p;
    const links = Array.isArray(p.links) ? p.links : linksDoFormatoAntigo(p.links);
    return {
        id: idSeguro(p.id), nome: txt(p.nome, MAX.nome),
        foto: semAutorizacao ? '' : nomeImagem(p.foto),
        descricao: semAutorizacao ? '' : txt(bruto.descricao, MAX.descricao),
        habilidades: semAutorizacao ? [] : lista(bruto.habilidades, LIMITES.habilidades).map(h => txt(h, MAX.habilidade)).filter(Boolean),
        contribuicao: semAutorizacao ? '' : txt(bruto.contribuicao, MAX.contribuicao),
        links: semAutorizacao ? [] : lista(links, LIMITES.linksPessoa).map(l => linkNovo(l)),
        email: semAutorizacao ? '' : txt(p.email !== undefined ? p.email : c.email, MAX.email),
        telefone: semAutorizacao ? '' : telefoneBruto(p.telefone !== undefined ? p.telefone : c.telefone),
        whatsapp: semAutorizacao ? '' : telefoneBruto(p.whatsapp !== undefined ? p.whatsapp : c.whatsapp),
        mostrarContatos: true,   // ajuste abaixo
        visivel: p.visivel !== false
    };
}

function secoesEdicao(v) {
    const vistas = new Set(), saida = [];
    lista(v, 12).forEach(s => { if (s && SECOES.includes(s.id) && !vistas.has(s.id)) { vistas.add(s.id); saida.push({ id: s.id, visivel: s.visivel !== false }); } });
    SECOES.forEach(id => { if (!vistas.has(id)) saida.push({ id, visivel: true }); });
    return saida;
}

function normalizar(bruto) {
    const d = bruto && typeof bruto === 'object' ? bruto : {};
    const g = d.grupo || {}, pr = d.projeto || {}, co = d.conecte && typeof d.conecte === 'object' ? d.conecte : {};
    let linksGrupo = Array.isArray(co.links) ? co.links : [];
    if (!Array.isArray(co.links)) {                                    // Conecte-se antigo
        if (co.githubProjeto) linksGrupo.push({ tipo: 'github', rotulo: 'GitHub do projeto', url: co.githubProjeto });
        if (co.emailGrupo) linksGrupo.push({ tipo: 'email', url: 'mailto:' + co.emailGrupo });
    }
    return {
        versao: Number.isInteger(d.versao) && d.versao > 0 ? d.versao : 1,
        atualizadoEm: txt(d.atualizadoEm, 40), atualizadoPor: txt(d.atualizadoPor, 60),
        secoes: secoesEdicao(d.secoes),
        grupo: { nome: txt(g.nome, 80) || 'Dark Coders', frase: txt(g.frase, MAX.frase), curso: txt(g.curso, MAX.curso), logo: nomeImagem(g.logo) },
        quemSomos: txt(d.quemSomos, MAX.texto),
        projeto: {
            problema: txt(pr.problema, MAX.texto), solucao: txt(pr.solucao, MAX.texto), integracao: txt(pr.integracao, MAX.texto),
            processo: lista(pr.processo, LIMITES.processo).map(e => ({ nome: txt(e && e.nome, MAX.etapaNome), texto: txt(e && e.texto, MAX.etapaTexto) })).filter(e => e.nome),
            tecnologias: lista(pr.tecnologias, LIMITES.tecnologias).map(t => txt(t, MAX.tecnologia)).filter(Boolean),
            galeria: lista(pr.galeria, LIMITES.galeria).map(f => ({ id: idSeguro(f && f.id), arquivo: nomeImagem(f && (f.arquivo || f.foto)), legenda: txt(f && f.legenda, MAX.legenda) })).filter(f => f.arquivo)
        },
        equipe: lista(d.equipe, LIMITES.equipe).map(pessoaEdicao).filter(p => p.nome),
        jornada: lista(d.jornada, LIMITES.jornada).map(m => ({ id: idSeguro(m && m.id), data: txt(m && m.data, MAX.data), titulo: txt(m && m.titulo, MAX.titulo), texto: txt(m && m.texto, MAX.marco) })).filter(m => m.titulo),
        aprendemos: lista(d.aprendemos, LIMITES.aprendemos).map(a => txt(a, MAX.aprendizado)).filter(Boolean),
        conecte: {
            links: lista(linksGrupo, LIMITES.linksGrupo).map(l => linkNovo(l)),
            videos: lista(co.videos, LIMITES.videos).map(v => ({ titulo: txt(v && v.titulo, MAX.titulo), url: txt(v && v.url, MAX.url) })).filter(v => v.url)
        }
    };
}

// validação
function validar(bruto) {
    const erros = {};
    const d = bruto && typeof bruto === 'object' ? bruto : {};
    const longo = (caminho, v, max, nome) => { if (typeof v === 'string' && v.trim().length > max) erros[caminho] = `${nome}: no máximo ${max} caracteres.`; };
    const limite = (caminho, v, max, nome) => { if (Array.isArray(v) && v.length > max) erros[caminho] = `No máximo ${max} ${nome}.`; };
    const g = d.grupo || {}, pr = d.projeto || {}, co = d.conecte || {};
    longo('grupo.nome', g.nome, 80, 'Nome'); longo('grupo.frase', g.frase, MAX.frase, 'Frase'); longo('grupo.curso', g.curso, MAX.curso, 'Curso');
    longo('quemSomos', d.quemSomos, MAX.texto, 'Texto');
    longo('projeto.problema', pr.problema, MAX.texto, 'Texto'); longo('projeto.solucao', pr.solucao, MAX.texto, 'Texto'); longo('projeto.integracao', pr.integracao, MAX.texto, 'Texto');
    limite('projeto.tecnologias', pr.tecnologias, LIMITES.tecnologias, 'tecnologias'); limite('projeto.galeria', pr.galeria, LIMITES.galeria, 'fotos na galeria'); limite('projeto.processo', pr.processo, LIMITES.processo, 'etapas');
    lista(pr.galeria, 40).forEach((f, i) => longo(`projeto.galeria.${i}.legenda`, f && f.legenda, MAX.legenda, 'Legenda'));
    limite('equipe', d.equipe, LIMITES.equipe, 'integrantes'); limite('jornada', d.jornada, LIMITES.jornada, 'marcos'); limite('aprendemos', d.aprendemos, LIMITES.aprendemos, 'itens');

    const confereLinks = (prefixo, links, max) => {
        limite(prefixo, links, max, 'links');
        lista(links, 40).forEach((l, i) => {
            const url = l && typeof l.url === 'string' ? l.url.trim() : '';
            if (!url) erros[`${prefixo}.${i}.url`] = 'Endereço vazio.';
            else if (url.length > MAX.url) erros[`${prefixo}.${i}.url`] = `No máximo ${MAX.url} caracteres.`;
            else if (!Link.urlPermitida(url)) erros[`${prefixo}.${i}.url`] = 'Só links http/https, e-mail (mailto:) e telefone (tel:).';
            longo(`${prefixo}.${i}.rotulo`, l && l.rotulo, MAX.rotulo, 'Nome');
        });
    };
    lista(d.equipe, 40).forEach((p, i) => {
        p = p || {};
        const nome = typeof p.nome === 'string' ? p.nome.trim() : '';
        if (!nome) erros[`equipe.${i}.nome`] = 'Escreva o nome.'; else longo(`equipe.${i}.nome`, nome, MAX.nome, 'Nome');
        longo(`equipe.${i}.descricao`, p.descricao, MAX.descricao, 'Descrição'); longo(`equipe.${i}.contribuicao`, p.contribuicao, MAX.contribuicao, 'Texto');
        limite(`equipe.${i}.habilidades`, p.habilidades, LIMITES.habilidades, 'habilidades');
        if (p.email && !emailValido(p.email)) erros[`equipe.${i}.email`] = 'E-mail inválido. Exemplo: nome@exemplo.com';
        if (p.telefone && !telefoneValido(p.telefone)) erros[`equipe.${i}.telefone`] = 'Telefone inválido. Exemplo: (11) 91234-5678';
        if (p.whatsapp && !telefoneValido(p.whatsapp)) erros[`equipe.${i}.whatsapp`] = 'WhatsApp inválido. Exemplo: (11) 91234-5678';
        confereLinks(`equipe.${i}.links`, p.links, LIMITES.linksPessoa);
    });
    lista(d.jornada, 40).forEach((m, i) => {
        m = m || {};
        if (!(typeof m.titulo === 'string' && m.titulo.trim())) erros[`jornada.${i}.titulo`] = 'Escreva o título do marco.';
        longo(`jornada.${i}.titulo`, m.titulo, MAX.titulo, 'Título'); longo(`jornada.${i}.texto`, m.texto, MAX.marco, 'Texto'); longo(`jornada.${i}.data`, m.data, MAX.data, 'Data');
    });
    confereLinks('conecte.links', co.links, LIMITES.linksGrupo);
    lista(co.videos, 20).forEach((v, i) => { if (v && v.url && !Link.urlPermitida(String(v.url).trim())) erros[`conecte.videos.${i}.url`] = 'Só links http/https.'; });
    return { erros, limpo: normalizar(d) };
}

// versão pública
function paraPublico(edicao, opcoes = {}) {
    const existe = opcoes.existeArquivo || (() => true);
    const linhaLink = l => ({ tipo: l.tipo, rotulo: l.rotulo, url: l.url, externo: /^https?:/.test(l.url) });
    const equipe = edicao.equipe.filter(p => p.visivel).map(p => {
        const mostra = p.mostrarContatos;
        const links = [];
        if (mostra) {
            p.links.filter(l => l.visivel && Link.urlPermitida(l.url)).forEach(l => links.push(linhaLink(l)));
            if (emailValido(p.email)) links.push({ tipo: 'email', rotulo: 'E-mail', url: 'mailto:' + p.email, externo: false });
            if (telefoneValido(p.telefone)) links.push({ tipo: 'telefone', rotulo: 'Ligar', url: 'tel:+' + Link.numeroInternacional(p.telefone), externo: false });
            if (telefoneValido(p.whatsapp)) links.push({ tipo: 'whatsapp', rotulo: 'WhatsApp', url: 'https://wa.me/' + Link.numeroInternacional(p.whatsapp), externo: true });
        }
        return { id: p.id, nome: p.nome, iniciais: iniciais(p.nome), foto: p.foto && existe('equipe/' + p.foto) ? p.foto : '', descricao: p.descricao, habilidades: p.habilidades, contribuicao: p.contribuicao, links };
    });
    const conecteLinks = edicao.conecte.links.filter(l => l.visivel && Link.urlPermitida(l.url)).map(linhaLink);
    equipe.forEach(p => p.links.filter(l => l.tipo === 'linkedin').forEach(l => conecteLinks.push({ tipo: 'linkedin', rotulo: 'LinkedIn · ' + p.nome.split(' ')[0], url: l.url, externo: true })));
    const ancora = { hero: 'topo', quemSomos: 'quem-somos', projeto: 'projeto', equipe: 'equipe', jornada: 'jornada', conecte: 'contato' };
    const titulo = { quemSomos: 'Quem somos', projeto: 'O projeto', equipe: 'Equipe', jornada: 'Jornada', conecte: 'Contato' };
    const secoes = edicao.secoes.filter(s => s.visivel).map(s => ({ id: s.id, ancora: ancora[s.id], titulo: titulo[s.id] || '' }));
    return {
        versao: edicao.versao, secoes, grupo: edicao.grupo, quemSomos: edicao.quemSomos,
        projeto: Object.assign({}, edicao.projeto, { galeria: edicao.projeto.galeria.filter(f => existe('projeto/' + f.arquivo)) }),
        equipe, jornada: edicao.jornada, aprendemos: edicao.aprendemos,
        conecte: { links: conecteLinks, videos: edicao.conecte.videos.filter(v => Link.urlPermitida(v.url)) }
    };
}

// arquivo e backups
function lerArquivo(caminho) {
    let bruto = {};
    try { bruto = JSON.parse(fs.readFileSync(caminho, 'utf-8')); } catch (e) {}
    return normalizar(bruto);
}

const carimbo = (d = new Date()) => {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

function listarBackups(pasta) {
    let arquivos = [];
    try { arquivos = fs.readdirSync(pasta).filter(f => /^sobre-\d{8}-\d{6}(-\d+)?\.json$/.test(f)); } catch (e) {}
    return arquivos.sort().reverse().map(f => {
        let meta = {};
        try { meta = JSON.parse(fs.readFileSync(path.join(pasta, f), 'utf-8')); } catch (e) {}
        return { id: f.replace(/\.json$/, ''), versao: meta.versao || null, atualizadoEm: meta.atualizadoEm || '', atualizadoPor: meta.atualizadoPor || '' };
    });
}

function guardarBackup(caminho, pasta) {
    if (!fs.existsSync(caminho)) return null;
    fs.mkdirSync(pasta, { recursive: true });
    let nome = `sobre-${carimbo()}`, n = 1;
    while (fs.existsSync(path.join(pasta, nome + '.json'))) nome = `sobre-${carimbo()}-${n++}`;
    fs.copyFileSync(caminho, path.join(pasta, nome + '.json'));
    listarBackups(pasta).slice(LIMITES.backups).forEach(b => { try { fs.unlinkSync(path.join(pasta, b.id + '.json')); } catch (e) {} });
    return nome;
}

// gravar versão
function salvar(caminho, pasta, limpo, usuario, leitura) {
    leitura = leitura || caminho;
    guardarBackup(leitura, pasta);
    const atual = lerArquivo(leitura);
    const novo = Object.assign({}, limpo, { versao: atual.versao + 1, atualizadoEm: new Date().toISOString(), atualizadoPor: usuario });
    fs.mkdirSync(path.dirname(caminho), { recursive: true });
    fs.writeFileSync(caminho, JSON.stringify(novo, null, 2));
    return novo;
}

function restaurar(caminho, pasta, id, usuario, leitura) {
    if (!/^sobre-\d{8}-\d{6}(-\d+)?$/.test(id)) return null;
    const arquivo = path.join(pasta, id + '.json');
    if (!fs.existsSync(arquivo)) return null;
    let antiga; try { antiga = normalizar(JSON.parse(fs.readFileSync(arquivo, 'utf-8'))); } catch (e) { return null; }
    return salvar(caminho, pasta, antiga, usuario, leitura);
}

// compatibilidade
function carregar(caminho, opcoes) { return paraPublico(lerArquivo(caminho), opcoes); }

module.exports = { SECOES, LIMITES, MAX, normalizar, validar, paraPublico, lerArquivo, listarBackups, guardarBackup, salvar, restaurar, carregar, novoId, idSeguro };
