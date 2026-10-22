// visualizador do modelo 3D da maquina (three.js local), usado no Dashboard e na pagina Modelo 3D
// uso: const v = Modelo3D.criar({ area, msg, botoes: { girar, vista, estrutura, tela } }); v.carregar(url); v.destruir();
(function () {
    const FOLGA = 1.4;                 // distancia = raio / sin(fov/2) * FOLGA (maquina inteira com folga nas bordas)
    const DIRECAO = [0.85, 0.6, 1.0];  // de onde a camera olha por padrao

    function injetarEstilo() {
        if (document.getElementById('m3v-estilo')) return;
        const s = document.createElement('style'); s.id = 'm3v-estilo';
        s.textContent = [
            '.m3v-btn{border:2px solid #1e293b;background:#fff;color:#1e293b;border-radius:9px;padding:5px 10px;font-size:11px;font-weight:800;cursor:pointer}',
            '.m3v-btn.on{background:#1e293b;color:#fff}',
            '.m3v-cheia{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;height:100dvh!important;z-index:2147483000!important;border-radius:0!important;margin:0!important}',
            '.m3v-barra{position:absolute;z-index:5;top:calc(env(safe-area-inset-top,0px) + 10px);right:calc(env(safe-area-inset-right,0px) + 10px);display:none;flex-wrap:wrap;justify-content:flex-end;gap:8px;max-width:calc(100% - 20px);padding:8px;border-radius:14px;background:rgba(15,23,42,.72);transition:opacity .25s}',
            '.m3v-barra.m3v-ativa{display:flex}',
            '.m3v-barra.m3v-oculta{opacity:0;pointer-events:none}',
            '.m3v-barra button{min-width:44px;min-height:44px;padding:0 12px;border:2px solid rgba(255,255,255,.55);background:rgba(30,41,59,.9);color:#fff;border-radius:10px;font-size:13px;font-weight:800;cursor:pointer;touch-action:manipulation}',
            '.m3v-barra button.on{background:#2563eb;border-color:#93c5fd}',
            '.m3v-barra button.m3v-sair{background:#dc2626;border-color:#fecaca;font-size:20px}'
        ].join('');
        document.head.appendChild(s);
    }

    function criar(opcoes) {
        injetarEstilo();
        const area = opcoes.area, msg = opcoes.msg, botoes = opcoes.botoes || {};
        let T, renderer, scene, camera, controls, modelo = null, chao = null, grade = null;
        let raio = 1, fovEfetivo = 0, distQuadro = 1, girar = false, estrutura = false;
        let interagindo = false, visivel = true, sujo = true, raf = 0, destruido = false, animZoom = 0;
        let telaCheia = false, simulada = false, overflowAnterior = '', temporizadorBarra = 0, barra = null, botoesBarra = {};
        const dir = { x: DIRECAO[0], y: DIRECAO[1], z: DIRECAO[2] };
        const pedir = () => { sujo = true; };

        function mensagem(t) { if (msg) { msg.style.display = 'flex'; msg.innerHTML = t; } }
        function esconderMsg() { if (msg) msg.style.display = 'none'; }

        // ---------- estados dos botoes (cartao e barra da tela cheia) ----------
        function marcar() {
            [[botoes.girar, botoesBarra.girar, girar], [botoes.estrutura, botoesBarra.estrutura, estrutura]].forEach(([a, b, on]) => {
                [a, b].forEach(x => { if (x) { x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); } });
            });
            if (botoes.tela) botoes.tela.textContent = telaCheia ? 'Sair da tela cheia' : 'Tela cheia';
        }

        // ---------- enquadramento ----------
        function calcularQuadro() {
            if (!camera || !modelo) return;
            const vfov = camera.fov * Math.PI / 180;
            const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
            fovEfetivo = Math.min(vfov, hfov);                       // retrato: manda a largura
            distQuadro = raio / Math.sin(fovEfetivo / 2) * FOLGA;
            controls.minDistance = raio * 0.3; controls.maxDistance = Math.max(raio * 4, distQuadro * 1.2);
        }
        function distanciaAtual() { return camera.position.distanceTo(controls.target); }
        function posicionar(distancia) {
            const d = Math.min(controls.maxDistance, Math.max(controls.minDistance, distancia));
            const v = camera.position.clone().sub(controls.target).normalize();
            camera.position.copy(controls.target).addScaledVector(v, d);
            controls.update(); pedir();
        }
        function vistaInicial() {
            controls.target.set(0, 0, 0);
            const n = Math.hypot(dir.x, dir.y, dir.z);
            camera.position.set(dir.x / n * distQuadro, dir.y / n * distQuadro, dir.z / n * distQuadro);
            camera.near = raio / 100; camera.far = raio * 100; camera.updateProjectionMatrix();
            controls.update(); pedir();
        }
        function aoRedimensionar() {
            if (!renderer || destruido) return;
            const w = Math.max(1, area.clientWidth), h = Math.max(1, area.clientHeight);
            const anterior = distQuadro;
            renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
            if (modelo) {
                calcularQuadro();
                posicionar(distanciaAtual() / anterior * distQuadro);   // mantem o zoom do usuario em proporcao ao novo quadro
            }
            pedir();
        }

        // ---------- aplicar estados ----------
        function aplicarEstrutura() {
            if (!modelo) return;
            modelo.traverse(o => { if (o.isMesh && o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.wireframe = estrutura; }); });
            pedir();
        }
        function alternarGirar() { girar = !girar; marcar(); pedir(); }
        function alternarEstrutura() { estrutura = !estrutura; aplicarEstrutura(); marcar(); }
        function vista() {
            girar = false; estrutura = false;
            if (modelo) { modelo.rotation.set(0, 0, 0); aplicarEstrutura(); }
            if (camera) vistaInicial();
            marcar(); mostrarBarra();
        }
        function zoom(fator) {
            if (!camera) return;
            cancelAnimationFrame(animZoom);
            const ini = distanciaAtual(), fim = Math.min(controls.maxDistance, Math.max(controls.minDistance, ini * fator)), t0 = performance.now();
            const passo = (agora) => {
                const k = Math.min(1, (agora - t0) / 220), suave = 1 - Math.pow(1 - k, 3);
                posicionar(ini + (fim - ini) * suave);
                if (k < 1 && !destruido) animZoom = requestAnimationFrame(passo);
            };
            animZoom = requestAnimationFrame(passo);
            mostrarBarra();
        }

        // ---------- tela cheia (nativa ou simulada, para iPhone) ----------
        function elementoCheio() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
        function atualizarTelaCheia(ativa) {
            if (telaCheia === ativa) return;
            telaCheia = ativa;
            if (barra) { barra.classList.toggle('m3v-ativa', ativa); }
            marcar();
            if (ativa) mostrarBarra(); else { clearTimeout(temporizadorBarra); simulada = false; }
            setTimeout(aoRedimensionar, 60); setTimeout(aoRedimensionar, 350);
        }
        function entrarSimulada() {
            simulada = true; window.__m3vSimulada = true; area.classList.add('m3v-cheia');
            overflowAnterior = document.body.style.overflow; document.body.style.overflow = 'hidden';
            try { history.pushState({ m3v: 1 }, ''); } catch (e) {}
            atualizarTelaCheia(true);
        }
        function sairSimulada(voltarHistorico) {
            if (!simulada) return;
            area.classList.remove('m3v-cheia'); document.body.style.overflow = overflowAnterior;
            window.__m3vSimulada = false;
            if (voltarHistorico && history.state && history.state.m3v) { window.__m3vIgnorarPopstate = true; try { history.back(); } catch (e) { window.__m3vIgnorarPopstate = false; } }
            atualizarTelaCheia(false);
        }
        async function entrarTelaCheia() {
            const pedido = area.requestFullscreen || area.webkitRequestFullscreen;
            if (pedido) {
                try { const r = pedido.call(area); if (r && r.then) await r; return; } catch (e) {}
            }
            entrarSimulada();
        }
        function sairTelaCheia() {
            if (simulada) { sairSimulada(true); return; }
            const sair = document.exitFullscreen || document.webkitExitFullscreen;
            if (sair) { try { sair.call(document); } catch (e) {} }
        }
        function alternarTela() { if (telaCheia) sairTelaCheia(); else entrarTelaCheia(); }
        function aoMudarFullscreen() { atualizarTelaCheia(elementoCheio() === area || (simulada && telaCheia)); }
        function aoTeclar(e) { if (e.key === 'Escape' && simulada) sairSimulada(true); }
        function aoVoltar() { if (simulada && !(history.state && history.state.m3v)) sairSimulada(false); }

        // ---------- barra de botoes da tela cheia (some sozinha apos 4 s) ----------
        function mostrarBarra() {
            if (!barra || !telaCheia) return;
            barra.classList.remove('m3v-oculta');
            clearTimeout(temporizadorBarra);
            temporizadorBarra = setTimeout(() => { if (telaCheia) barra.classList.add('m3v-oculta'); }, 4000);
        }
        function montarBarra() {
            barra = document.createElement('div'); barra.className = 'm3v-barra'; barra.setAttribute('role', 'toolbar'); barra.setAttribute('aria-label', 'Controles do modelo 3D');
            const itens = [
                ['sair', '✕', 'Sair da tela cheia', sairTelaCheia, 'm3v-sair'],
                ['girar', 'Girar', 'Girar sozinho', alternarGirar],
                ['mais', '+', 'Aproximar', () => zoom(0.8)],
                ['menos', '−', 'Afastar', () => zoom(1.25)],
                ['vista', 'Vista', 'Voltar à vista inicial', vista],
                ['estrutura', 'Estrutura', 'Mostrar estrutura', alternarEstrutura]
            ];
            itens.forEach(([id, texto, rotulo, acao, extra]) => {
                const b = document.createElement('button'); b.type = 'button'; b.textContent = texto; b.title = rotulo; b.setAttribute('aria-label', rotulo);
                b.setAttribute('data-leitura-ok', ''); if (extra) b.classList.add(extra);
                b.addEventListener('click', (e) => { e.stopPropagation(); acao(); mostrarBarra(); });
                barra.appendChild(b); botoesBarra[id] = b;
            });
            area.appendChild(barra);
            ['pointerdown', 'pointermove', 'touchstart', 'wheel'].forEach(ev => area.addEventListener(ev, mostrarBarra, { passive: true }));
        }

        // ---------- inicio ----------
        async function iniciar() {
            try {
                T = await import('/vendor3d/three.module.min.js');
                var OC = (await import('/vendor3d/addons/controls/OrbitControls.js')).OrbitControls;
                var GL = (await import('/vendor3d/addons/loaders/GLTFLoader.js')).GLTFLoader;
            } catch (e) { mensagem('Visualizador 3D não instalado (public/vendor3d).'); return false; }
            if (destruido) return false;
            try { renderer = new T.WebGLRenderer({ antialias: (window.devicePixelRatio || 1) <= 1, powerPreference: 'low-power' }); }
            catch (e) { mensagem('Este aparelho não abriu o 3D (WebGL indisponível).'); return false; }
            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
            renderer.domElement.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%';
            area.appendChild(renderer.domElement);
            scene = new T.Scene(); scene.background = new T.Color(0x0f172a);
            camera = new T.PerspectiveCamera(40, 1, 0.01, 1000);
            scene.add(new T.HemisphereLight(0xffffff, 0x8899aa, 1.2));
            const sol = new T.DirectionalLight(0xffffff, 1.2); sol.position.set(2, 4, 3); scene.add(sol);
            const topo = new T.DirectionalLight(0xffffff, 0.8); topo.position.set(0, 10, 0.5); scene.add(topo);
            controls = new OC(camera, renderer.domElement);
            controls.enableDamping = false;
            controls.addEventListener('change', pedir);
            controls.addEventListener('start', () => { interagindo = true; });
            controls.addEventListener('end', () => { interagindo = false; });
            iniciar.GL = GL;
            montarBarra();
            if ('ResizeObserver' in window) { iniciar.ro = new ResizeObserver(aoRedimensionar); iniciar.ro.observe(area); } else window.addEventListener('resize', aoRedimensionar);
            document.addEventListener('fullscreenchange', aoMudarFullscreen); document.addEventListener('webkitfullscreenchange', aoMudarFullscreen);
            document.addEventListener('keydown', aoTeclar); window.addEventListener('popstate', aoVoltar);
            if ('IntersectionObserver' in window) { iniciar.io = new IntersectionObserver(e => { visivel = e[0].isIntersecting; if (visivel) pedir(); }); iniciar.io.observe(area); }
            aoRedimensionar();
            const laco = () => {
                raf = requestAnimationFrame(laco);
                if (destruido || !visivel || document.hidden) return;
                if (girar && !interagindo && modelo) { modelo.rotation.y += 0.004; sujo = true; }
                if (sujo) { sujo = false; renderer.render(scene, camera); }
            };
            laco();
            return true;
        }

        let pronto = null;
        function carregar(url) {
            mensagem('Carregando o modelo 3D...');
            if (!pronto) pronto = iniciar();
            return pronto.then(ok => {
                if (!ok) return;
                new iniciar.GL().load(url, (g) => {
                    if (destruido) return;
                    if (modelo) scene.remove(modelo);
                    modelo = g.scene;
                    modelo.traverse(o => { if (o.isMesh && o.material) { o.material.flatShading = true; o.material.needsUpdate = true; } });
                    scene.add(modelo);
                    const caixa = new T.Box3().setFromObject(modelo), centro = caixa.getCenter(new T.Vector3()), tam = caixa.getSize(new T.Vector3());
                    modelo.position.sub(centro);                          // gira em torno do proprio centro
                    const esfera = new T.Box3().setFromObject(modelo).getBoundingSphere(new T.Sphere());
                    raio = esfera.radius || 1;
                    const base = -tam.y / 2, r = Math.max(tam.x, tam.y, tam.z) || 1;
                    if (chao) { scene.remove(chao); scene.remove(grade); }
                    chao = new T.Mesh(new T.CircleGeometry(r * 0.75, 64), new T.MeshBasicMaterial({ color: 0x1e293b })); chao.rotation.x = -Math.PI / 2; chao.position.y = base - r * 0.002; scene.add(chao);
                    grade = new T.GridHelper(r * 1.5, 24, 0x475569, 0x334155); grade.position.y = base - r * 0.001; scene.add(grade);
                    calcularQuadro(); vistaInicial(); aplicarEstrutura(); esconderMsg(); pedir();
                }, null, () => mensagem('Não consegui abrir o modelo (.glb).'));
            });
        }

        // botoes do cartao
        if (botoes.girar) botoes.girar.addEventListener('click', alternarGirar);
        if (botoes.vista) botoes.vista.addEventListener('click', vista);
        if (botoes.estrutura) botoes.estrutura.addEventListener('click', alternarEstrutura);
        if (botoes.tela) botoes.tela.addEventListener('click', alternarTela);
        marcar();

        function destruir() {
            destruido = true; cancelAnimationFrame(raf); cancelAnimationFrame(animZoom); clearTimeout(temporizadorBarra);
            if (simulada) { area.classList.remove('m3v-cheia'); document.body.style.overflow = overflowAnterior; window.__m3vSimulada = false; }
            if (elementoCheio() === area) { try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) {} }
            if (iniciar.ro) iniciar.ro.disconnect(); else window.removeEventListener('resize', aoRedimensionar);
            if (iniciar.io) iniciar.io.disconnect();
            document.removeEventListener('fullscreenchange', aoMudarFullscreen); document.removeEventListener('webkitfullscreenchange', aoMudarFullscreen);
            document.removeEventListener('keydown', aoTeclar); window.removeEventListener('popstate', aoVoltar);
            if (controls) controls.dispose();
            if (renderer) { renderer.dispose(); try { renderer.forceContextLoss(); } catch (e) {} }
        }

        // quanto da tela a maquina ocupa (0 a 1 em cada eixo), para conferir o enquadramento
        function ocupacao() {
            if (!modelo) return null;
            camera.updateMatrixWorld(); modelo.updateMatrixWorld(true);
            const caixa = new T.Box3().setFromObject(modelo); let minX = 9, maxX = -9, minY = 9, maxY = -9;
            for (let i = 0; i < 8; i++) {
                const p = new T.Vector3(i & 1 ? caixa.max.x : caixa.min.x, i & 2 ? caixa.max.y : caixa.min.y, i & 4 ? caixa.max.z : caixa.min.z).project(camera);
                minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
            }
            return { esquerda: (minX + 1) / 2, direita: (1 - maxX) / 2, baixo: (minY + 1) / 2, cima: (1 - maxY) / 2 };
        }

        const api = { carregar, destruir, ocupacao, vista, alternarGirar, alternarEstrutura, zoom, alternarTela, estado: () => ({ girar, estrutura, telaCheia, simulada, distancia: camera ? distanciaAtual() : 0, quadro: distQuadro, raio, rotacao: modelo ? modelo.rotation.y : 0, barraVisivel: !!barra && telaCheia && !barra.classList.contains('m3v-oculta') }) };
        area.__modelo3d = api;
        return api;
    }

    window.Modelo3D = { criar };
})();
