// prepara os dados da pagina publica "Sobre nos" (data/sobre.json)
// tudo vira texto simples: o Nunjucks escapa o HTML, aqui so se filtram links e nomes de imagem
const txt = (v, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const lista = (v, max = 30) => (Array.isArray(v) ? v.slice(0, max) : []);
const soLinkWeb = v => { const t = txt(v, 300); return /^https?:\/\/[^\s"'<>]+$/i.test(t) ? t : ''; };
const nomeImagem = v => { const t = txt(v, 120); return /^[\w][\w.-]*\.(png|jpe?g|webp|gif|svg)$/i.test(t) ? t : ''; };
const emailValido = v => { const t = txt(v, 120); return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(t) ? t : ''; };

function digitos(v) {
    let d = txt(v, 40).replace(/\D/g, '');
    if (d.length < 8 || d.length > 15) return '';
    if (d.length <= 11) d = '55' + d;                 // DDD + numero brasileiro
    return d;
}

function iniciais(nome) {
    const p = nome.split(/\s+/).filter(Boolean);
    if (!p.length) return '?';
    return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

function pessoa(p) {
    p = p && typeof p === 'object' ? p : {};
    const nome = txt(p.nome, 120);
    if (!nome) return null;
    const base = { nome, iniciais: iniciais(nome), autorizou: p.autorizou === true };
    if (!base.autorizou) return Object.assign(base, { foto: '', descricao: '', habilidades: [], contribuicao: '', links: [], email: '', telefone: '', whatsapp: '' });
    const l = p.links && typeof p.links === 'object' ? p.links : {};
    const c = p.contato && typeof p.contato === 'object' ? p.contato : {};
    const links = [];
    [['LinkedIn', l.linkedin], ['GitHub', l.github], ['Portfólio', l.portfolio]].forEach(([r, u]) => { if (soLinkWeb(u)) links.push({ rotulo: r, url: soLinkWeb(u) }); });
    if (l.outro && soLinkWeb(l.outro.url)) links.push({ rotulo: txt(l.outro.nome, 40) || 'Link', url: soLinkWeb(l.outro.url) });
    const tel = digitos(c.telefone), wa = digitos(c.whatsapp);
    return Object.assign(base, {
        foto: nomeImagem(p.foto),
        descricao: txt(p.descricao),
        habilidades: lista(p.habilidades, 8).map(h => txt(h, 50)).filter(Boolean),
        contribuicao: txt(p.contribuicao),
        links,
        email: emailValido(c.email),
        telefone: tel, telefoneTexto: txt(c.telefone, 40),
        whatsapp: wa
    });
}

function normalizar(bruto) {
    const d = bruto && typeof bruto === 'object' ? bruto : {};
    const g = d.grupo || {}, pr = d.projeto || {}, co = d.conecte || {};
    const equipe = lista(d.equipe, 20).map(pessoa).filter(Boolean);
    return {
        grupo: { nome: txt(g.nome, 80) || 'Dark Coders', frase: txt(g.frase, 200), curso: txt(g.curso, 200), logo: nomeImagem(g.logo) },
        quemSomos: txt(d.quemSomos, 1500),
        projeto: {
            problema: txt(pr.problema, 1200), solucao: txt(pr.solucao, 1200), integracao: txt(pr.integracao, 1200),
            processo: lista(pr.processo, 12).map(e => ({ nome: txt(e && e.nome, 60), texto: txt(e && e.texto, 160) })).filter(e => e.nome),
            tecnologias: lista(pr.tecnologias, 20).map(t => txt(t, 50)).filter(Boolean),
            galeria: lista(pr.galeria, 12).map(f => ({ arquivo: nomeImagem(f && f.arquivo), legenda: txt(f && f.legenda, 160) })).filter(f => f.arquivo)
        },
        equipe,
        jornada: lista(d.jornada, 12).map(m => ({ data: txt(m && m.data, 40), titulo: txt(m && m.titulo, 80), texto: txt(m && m.texto, 400) })).filter(m => m.titulo),
        aprendemos: lista(d.aprendemos, 10).map(a => txt(a, 200)).filter(Boolean),
        conecte: {
            github: soLinkWeb(co.githubProjeto), email: emailValido(co.emailGrupo),
            videos: lista(co.videos, 6).map(v => ({ titulo: txt(v && v.titulo, 80), url: soLinkWeb(v && v.url) })).filter(v => v.url)
        }
    };
}

// arquivo ausente ou invalido: versao minima, sem erro
function carregar(caminho) {
    let bruto = {};
    try { bruto = JSON.parse(require('fs').readFileSync(caminho, 'utf-8')); } catch (e) {}
    return normalizar(bruto);
}

module.exports = { normalizar, carregar };
