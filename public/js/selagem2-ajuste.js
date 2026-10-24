// GitHub: https://github.com/brunoosz | LinkedIn: https://www.linkedin.com/in/brunocamperlingo/
// ajuste fino da selagem 2
(function () {
    window.Selagem2Ajuste = {
        iniciar: function (raiz, opcoes) {
            const podeEditar = !!(opcoes && opcoes.podeEditar);
            const ouvintes = [];
            const el = (id) => raiz.querySelector('[data-s2="' + id + '"]');
            let estado = null, online = false, autotune = null, historico = [], emergencia = false;
            let relogio = null;

            function ouvir(evento, fn) { globalSocket.on(evento, fn); ouvintes.push([evento, fn]); }
            function toast(msg, erro) {
                const d = document.createElement('div');
                d.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-[999996] px-4 py-3 rounded-xl shadow-lg text-sm font-bold text-white max-w-[90vw] text-center ' + (erro ? 'bg-red-600' : 'bg-slate-800');
                d.textContent = msg; document.body.appendChild(d); setTimeout(() => d.remove(), 3200);
            }
            async function api(url, corpo) {
                try {
                    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo || {}) });
                    let d = {}; try { d = await r.json(); } catch (e) {}
                    if (!r.ok) toast(d.erro || 'Não foi possível.', true);
                    return r.ok;
                } catch (e) { toast('Sem conexão com o servidor.', true); return false; }
            }
            const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v.toFixed(d) : '--');

            // alarme em português claro
            function mostrarAlarme() {
                const box = el('alarme'); if (!estado) return;
                const info = window.Selagem2Alarmes.info(estado.seguranca);
                if (!online) { box.className = 'text-xs font-bold rounded-lg px-3 py-2 bg-slate-100 text-slate-600'; box.textContent = 'Selagem 2 desconectada da rede.'; box.hidden = false; return; }
                if (!info) { box.hidden = true; return; }
                box.hidden = false;
                box.className = 'text-xs font-bold rounded-lg px-3 py-2 ' + (info.nivel === 'aviso' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-700');
                box.textContent = (info.nivel === 'aviso' ? 'AVISO: ' : 'ALARME: ') + info.texto + (info.nivel === 'erro' ? '. Ligue o aquecimento de novo depois de resolver.' : '');
            }

            function mostrarEstado() {
                if (!estado) return;
                el('bruta').textContent = num(estado.bruta, 1) + ' °C';
                el('ambiente').textContent = num(estado.ambiente, 1) + ' °C';
                el('temp').textContent = num(estado.temperatura, 1) + ' °C';
                const em = estado.autotune;
                const txt = { parado: 'Parado', rodando: 'Rodando', ok: 'Concluído', abortado: 'Abortado' }[em] || '--';
                let t = 'Autotune: ' + txt;
                if (em === 'rodando' && estado.autotuneDesde) { const s = Math.floor((Date.now() - estado.autotuneDesde) / 1000); t += ' · ' + Math.floor(s / 60) + ' min ' + (s % 60) + ' s'; }
                el('autotune-estado').textContent = t;
                el('btn-autotune').disabled = !podeEditar || emergencia || !online || em === 'rodando';
                el('btn-cancelar').disabled = !podeEditar || em !== 'rodando';
                [['kp', estado.kp], ['ki', estado.ki], ['kd', estado.kd]].forEach(([k, v]) => { const i = el(k); if (i && document.activeElement !== i && typeof v === 'number') i.value = v; });
                mostrarAlarme();
            }

            function mostrarResultado() {
                const box = el('resultado'); if (!autotune) { box.textContent = ''; return; }
                if (autotune.estado === 'ok') box.textContent = 'Último autotune: Ku ' + num(autotune.ku, 2) + ' · Pu ' + num(autotune.pu, 1) + ' s → Kp ' + num(autotune.kp, 2) + ', Ki ' + num(autotune.ki, 4) + ', Kd ' + num(autotune.kd, 1);
                else box.textContent = 'Último autotune: ' + (autotune.estado || 'parou') + (autotune.motivo ? ' (' + autotune.motivo + ')' : '');
            }

            // gráfico dos últimos 10 min (canvas)
            function desenhar() {
                const c = el('grafico'); if (!c) return;
                const w = c.clientWidth || 300, h = 150, dpr = window.devicePixelRatio || 1;
                if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; c.style.height = h + 'px'; }
                const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
                const agora = Date.now(), ini = agora - 600000;
                const pts = historico.filter(p => p.t >= ini);
                g.font = '10px sans-serif'; g.fillStyle = '#94a3b8';
                if (pts.length < 2) { g.fillText('Aguardando dados...', 10, 20); return; }
                const maxT = Math.max(60, ...pts.map(p => Math.max(p.temp, p.alvo || 0))) + 10;
                const X = (t) => 34 + ((t - ini) / 600000) * (w - 42), Yt = (v) => h - 18 - (v / maxT) * (h - 28), Yp = (v) => h - 18 - (v / 100) * (h - 28);
                g.strokeStyle = '#e2e8f0'; g.lineWidth = 1;
                for (let v = 0; v <= maxT; v += (maxT > 200 ? 100 : 50)) { g.beginPath(); g.moveTo(34, Yt(v)); g.lineTo(w - 8, Yt(v)); g.stroke(); g.fillText(v + '°', 4, Yt(v) + 3); }
                g.fillText('-10 min', 34, h - 4); g.fillText('agora', w - 34, h - 4);
                const linha = (cor, f, y, tracejado) => { g.strokeStyle = cor; g.lineWidth = 2; g.setLineDash(tracejado ? [5, 4] : []); g.beginPath(); let i = 0; pts.forEach(p => { const v = f(p); if (v === null || v === undefined) return; if (i++ === 0) g.moveTo(X(p.t), y(v)); else g.lineTo(X(p.t), y(v)); }); g.stroke(); g.setLineDash([]); };
                linha('#f59e0b', p => p.pot, Yp, false);
                linha('#64748b', p => p.alvo, Yt, true);
                linha('#dc2626', p => p.temp, Yt, false);
            }

            function aplicarEmergencia(ativa) { emergencia = !!ativa; mostrarEstado(); }
            const sairEmergencia = window.EmergenciaGlobal ? window.EmergenciaGlobal.assinar(aplicarEmergencia) : () => {};

            async function carregar() {
                try {
                    const r = await fetch('/api/selagem2/ajuste'); const d = await r.json();
                    estado = d.estado; online = d.online; autotune = d.autotune; historico = d.historico || []; emergencia = d.emergencia;
                    mostrarEstado(); mostrarResultado(); desenhar();
                } catch (e) {}
            }

            ouvir('atualizar_temperatura2', (d) => {
                estado = d; online = true;
                const ult = historico[historico.length - 1];
                if (typeof d.temperatura === 'number' && (!ult || Date.now() - ult.t >= 2800)) { historico.push({ t: Date.now(), temp: d.temperatura, alvo: d.setpoint, pot: d.potencia }); }
                mostrarEstado();
            });
            ouvir('status_selagem2', (d) => { online = !!(d && d.online); mostrarEstado(); });
            ouvir('selagem2_autotune', (r) => { autotune = r; mostrarResultado(); });

            if (podeEditar) {
                el('btn-autotune').addEventListener('click', async () => {
                    if (!confirm('Rodar o autotune com a barra VAZIA e SEM plástico? A barra vai esquentar e esfriar sozinha por alguns minutos. Não mexa nela.')) return;
                    const alvo = Number(el('alvo-autotune').value);
                    if (await api('/api/selagem2/autotune', { alvo })) toast('Autotune iniciado.');
                });
                el('btn-cancelar').addEventListener('click', async () => { if (await api('/api/selagem2/autotune', { acao: 'cancelar' })) toast('Autotune cancelado.'); });
                el('btn-pid').addEventListener('click', async () => { if (await api('/api/selagem2/pid', { kp: Number(el('kp').value), ki: Number(el('ki').value), kd: Number(el('kd').value) })) toast('Ganhos aplicados.'); });
                el('btn-pid-padrao').addEventListener('click', async () => { if (confirm('Voltar os ganhos PID ao padrão?') && await api('/api/selagem2/pid', { padrao: true })) toast('Ganhos padrão.'); });
                el('btn-cal1').addEventListener('click', async () => { if (await api('/api/selagem2/calibrar', { acao: 'cal1', real: Number(el('real').value) })) toast('Ponto 1 gravado.'); });
                el('btn-cal2').addEventListener('click', async () => { if (await api('/api/selagem2/calibrar', { acao: 'cal2', real: Number(el('real').value) })) toast('Ponto 2 gravado.'); });
                el('btn-zerar').addEventListener('click', async () => { if (confirm('Zerar a calibração da leitura?') && await api('/api/selagem2/calibrar', { acao: 'zerar' })) toast('Calibração zerada.'); });
            } else {
                raiz.querySelectorAll('[data-s2-editar]').forEach(e => { e.disabled = true; e.classList.add('opacity-50', 'cursor-not-allowed'); });
            }

            carregar();
            relogio = setInterval(() => { mostrarEstado(); desenhar(); }, 3000);
            return function limpar() {
                ouvintes.forEach(([e, f]) => globalSocket.off(e, f));
                clearInterval(relogio); sairEmergencia();
            };
        }
    };
})();
