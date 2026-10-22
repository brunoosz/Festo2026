// GitHub: https://github.com/brunoosz | LinkedIn: https://www.linkedin.com/in/brunocamperlingo/
// tipo do link
(function (raiz, fabrica) {
    if (typeof module === 'object' && module.exports) module.exports = fabrica();
    else raiz.SobreLink = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
    const ROTULOS = { linkedin: 'LinkedIn', github: 'GitHub', instagram: 'Instagram', youtube: 'YouTube', x: 'X', behance: 'Behance', whatsapp: 'WhatsApp', email: 'E-mail', telefone: 'Telefone', site: 'Site' };
    const TIPOS = Object.keys(ROTULOS);
    const REGEX_EMAIL = /^[^\s@<>"'()]+@[^\s@<>"'()]+\.[^\s@<>"'()]+$/;

    function digitos(texto) { return String(texto || '').replace(/\D/g, ''); }
    function numeroInternacional(texto) {
        let d = digitos(texto);
        if (d.length < 8 || d.length > 15) return '';
        if (d.length <= 11) d = '55' + d;                       // número brasileiro
        return d;
    }
    function pareceTelefone(t) { return /^[+(\d][\d\s().\-]{6,}$/.test(t) && digitos(t).length >= 8 && digitos(t).length <= 15; }

    function tipoDoEndereco(host, caminho) {
        host = host.replace(/^www\./, '').toLowerCase();
        const e = (d) => host === d || host.endsWith('.' + d);
        if (e('linkedin.com') || host === 'lnkd.in') return 'linkedin';
        if (e('github.com')) return 'github';
        if (e('instagram.com') || host === 'instagr.am') return 'instagram';
        if (e('youtube.com') || host === 'youtu.be') return 'youtube';
        if (host === 'x.com' || e('twitter.com')) return 'x';
        if (e('behance.net')) return 'behance';
        if (host === 'wa.me' || e('whatsapp.com')) return 'whatsapp';
        return 'site';
    }

    function bonito(slug) {
        const partes = String(slug || '').split(/[-_.]+/).filter(Boolean);
        while (partes.length > 1 && /^(?=.*\d)[a-z0-9]{5,}$/i.test(partes[partes.length - 1])) partes.pop();   // sufixos
        return partes.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
    }

    // resultado
    function detectar(entrada) {
        let t = String(entrada || '').trim();
        if (!t) return { ok: false, erro: 'Cole um endereço, e-mail ou telefone.' };
        if (t.length > 300) return { ok: false, erro: 'Texto grande demais.' };

        if (/^mailto:/i.test(t)) t = t.replace(/^mailto:/i, '');
        if (REGEX_EMAIL.test(t)) return { ok: true, tipo: 'email', rotulo: ROTULOS.email, url: 'mailto:' + t };

        if (/^tel:/i.test(t)) t = t.replace(/^tel:/i, '');
        if (pareceTelefone(t)) {
            const n = numeroInternacional(t);
            return { ok: true, tipo: 'telefone', rotulo: ROTULOS.telefone, url: 'tel:+' + n, extra: { tipo: 'whatsapp', rotulo: ROTULOS.whatsapp, url: 'https://wa.me/' + n } };
        }

        if (/^[a-z][a-z0-9+.\-]*:/i.test(t) && !/^https?:\/\//i.test(t)) return { ok: false, erro: 'Só aceito links http/https, e-mail e telefone.' };
        let u = t;
        if (!/^https?:\/\//i.test(u)) {
            if (/\s/.test(u) || !/^[^\s/]+\.[a-z]{2,}([/?#].*)?$/i.test(u)) return { ok: false, erro: 'Isso não parece um link, e-mail ou telefone.' };
            u = 'https://' + u;
        }
        let url;
        try { url = new URL(u); } catch (e) { return { ok: false, erro: 'Link inválido.' }; }
        if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) return { ok: false, erro: 'Link inválido.' };
        const tipo = tipoDoEndereco(url.hostname, url.pathname);
        const partes = url.pathname.split('/').filter(Boolean);
        let sugestaoNome = '';
        if (tipo === 'linkedin' && /^(in|pub)$/i.test(partes[0] || '') && partes[1]) sugestaoNome = bonito(decodeURIComponent(partes[1]));
        else if (tipo === 'github' && partes[0]) sugestaoNome = partes[0];
        else if ((tipo === 'instagram' || tipo === 'x' || tipo === 'behance') && partes[0]) sugestaoNome = partes[0].replace(/^@/, '');
        return { ok: true, tipo, rotulo: ROTULOS[tipo], url: url.href, sugestaoNome };
    }

    // conferir link
    function urlPermitida(url) {
        const t = String(url || '').trim();
        if (/^https?:\/\/[^\s"'<>]+$/i.test(t)) { try { return /^https?:$/.test(new URL(t).protocol); } catch (e) { return false; } }
        if (/^mailto:[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/i.test(t)) return true;
        if (/^tel:\+?\d{8,15}$/.test(t)) return true;
        return false;
    }

    return { detectar, urlPermitida, numeroInternacional, ROTULOS, TIPOS, REGEX_EMAIL };
});
