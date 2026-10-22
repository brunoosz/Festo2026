// GitHub: https://github.com/brunoosz | LinkedIn: https://www.linkedin.com/in/brunocamperlingo/
// overlay da visão
(function () {
    function criar(canvas, opcoes) {
        const opt = Object.assign({ fundo: true, banda: true }, opcoes || {});
        const ctx = canvas.getContext ? canvas.getContext('2d') : null;
        let imagem = null;
        let overlay = null;
        let rotulos = {};        // caixas
        let pendentes = [];      // contagens pendentes

        function tamanho() {
            if (imagem) return [imagem.naturalWidth || imagem.width, imagem.naturalHeight || imagem.height];
            if (overlay && overlay.w && overlay.h) return [overlay.w, overlay.h];
            return [320, 240];
        }

        function textoDoEvento(e) {
            if (e.classe) return e.classe + (typeof e.confianca === 'number' ? ' ' + Math.round(e.confianca * 100) + '%' : '');
            return e.motivo === 'desconhecido' ? 'Desconhecido' : 'Sem treino';
        }

        // rótulos
        function casarRotulos() {
            if (!overlay || !pendentes.length) return;
            const agora = Date.now();
            pendentes = pendentes.filter(p => agora - p.ts < 2500);
            const sobra = [];
            pendentes.forEach(p => {
                const livres = (overlay.segmentos || []).filter(s => s.contado && !rotulos[s.id])
                    .sort((a, b) => Math.abs((a.ini + a.fim) / 2 - overlay.linha) - Math.abs((b.ini + b.fim) / 2 - overlay.linha));
                if (livres.length) rotulos[livres[0].id] = { texto: p.texto, ts: agora }; else sobra.push(p);
            });
            pendentes = sobra;
        }

        function podarRotulos() {
            const ids = new Set((overlay ? overlay.segmentos || [] : []).map(s => s.id));
            Object.keys(rotulos).forEach(id => { if (!ids.has(Number(id))) delete rotulos[id]; });
        }

        function etiqueta(texto, x, y, w, h, cor) {
            ctx.font = 'bold 12px sans-serif';
            const larg = ctx.measureText(texto).width + 10;
            const px = Math.max(2, Math.min(w - larg - 2, x));
            const py = Math.max(14, Math.min(h - 4, y));
            ctx.fillStyle = 'rgba(15,23,42,0.85)'; ctx.fillRect(px, py - 13, larg, 17);
            ctx.strokeStyle = cor; ctx.lineWidth = 1.5; ctx.strokeRect(px, py - 13, larg, 17);
            ctx.fillStyle = '#ffffff'; ctx.fillText(texto, px + 5, py);
        }

        function desenhar() {
            if (!ctx) return;
            const [w, h] = tamanho();
            if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
            if (opt.fundo) {
                if (imagem) ctx.drawImage(imagem, 0, 0, w, h); else { ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, w, h); }
            } else {
                ctx.clearRect(0, 0, w, h);
            }
            if (!overlay) return;

            const horizontal = overlay.eixo !== 'y';
            const b0 = overlay.banda[0], b1 = overlay.banda[1];
            ctx.save();
            if (opt.banda) {
                ctx.fillStyle = 'rgba(37,99,235,0.18)'; ctx.strokeStyle = 'rgba(37,99,235,0.9)'; ctx.lineWidth = 2;
                if (horizontal) { ctx.fillRect(0, b0 * h, w, (b1 - b0) * h); ctx.strokeRect(0, b0 * h, w, (b1 - b0) * h); }
                else { ctx.fillRect(b0 * w, 0, (b1 - b0) * w, h); ctx.strokeRect(b0 * w, 0, (b1 - b0) * w, h); }
            }
            ctx.strokeStyle = '#f43f5e'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.beginPath();
            if (horizontal) { const x = overlay.linha * w; ctx.moveTo(x, Math.max(0, b0 * h - 14)); ctx.lineTo(x, Math.min(h, b1 * h + 14)); }
            else { const y = overlay.linha * h; ctx.moveTo(Math.max(0, b0 * w - 14), y); ctx.lineTo(Math.min(w, b1 * w + 14), y); }
            ctx.stroke(); ctx.setLineDash([]);

            (overlay.segmentos || []).forEach(s => {
                const cor = s.contado ? '#22c55e' : '#facc15';
                ctx.strokeStyle = cor; ctx.lineWidth = 3; ctx.fillStyle = cor; ctx.font = 'bold 13px sans-serif';
                let x, y, larg, alt;
                if (horizontal) { x = s.ini * w; y = b0 * h; larg = (s.fim - s.ini) * w; alt = (b1 - b0) * h; }
                else { x = b0 * w; y = s.ini * h; larg = (b1 - b0) * w; alt = (s.fim - s.ini) * h; }
                ctx.strokeRect(x, y, larg, alt);
                ctx.fillText('#' + s.id, x + 4, y - 5);
                const rotulo = rotulos[s.id];
                if (rotulo) etiqueta(rotulo.texto, x + 2, y + alt + 16, w, h, cor);
            });
            ctx.restore();
        }

        return {
            definirImagem(img) { imagem = img; desenhar(); },
            definirOverlay(o) { overlay = o; casarRotulos(); podarRotulos(); desenhar(); },
            registrarEvento(e) {
                if (!e || e.tipo === 'treino') return;
                const n = Math.max(1, e.quantidade || 1);
                for (let i = 0; i < n; i++) pendentes.push({ texto: textoDoEvento(e), ts: Date.now() });
                casarRotulos(); desenhar();
            },
            limpar() { overlay = null; rotulos = {}; pendentes = []; desenhar(); },
            desenhar
        };
    }

    window.OverlayVisao = { criar };
})();
