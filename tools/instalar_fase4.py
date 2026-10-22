#!/usr/bin/env python3
# GitHub: https://github.com/brunoosz | LinkedIn: https://www.linkedin.com/in/brunocamperlingo/
# fase 4
import os, sys, re, base64, shutil, subprocess, datetime
BASE = sys.argv[1] if len(sys.argv) > 1 else "/root/site_esteira"
SERVER = os.path.join(BASE, "server.js"); BASEHTML = os.path.join(BASE, "views", "base.html")
BLOCO = base64.b64decode("Ci8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09Ci8vIEVNRVJHRU5DSUEgR0xPQkFMOiBkZXBvaXMgZGUgYWNpb25hZGEsIE5BREEgc2UgbW92ZSBhdGUgYWxndWVtIExJQkVSQVIgbm8gc2l0ZQovLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQpjb25zdCBBUlFfRU1FUkdFTkNJQSA9IHBhdGguam9pbihfX2Rpcm5hbWUsICdlbWVyZ2VuY2lhX2VzdGFkby5qc29uJyk7CmxldCBlbWVyZ2VuY2lhR2xvYmFsID0geyBhdGl2YTogZmFsc2UsIGRlc2RlOiBudWxsLCBvcmlnZW06IG51bGwgfTsKdHJ5IHsgZW1lcmdlbmNpYUdsb2JhbCA9IE9iamVjdC5hc3NpZ24oZW1lcmdlbmNpYUdsb2JhbCwgSlNPTi5wYXJzZShmcy5yZWFkRmlsZVN5bmMoQVJRX0VNRVJHRU5DSUEsICd1dGYtOCcpKSk7IH0gY2F0Y2ggKGUpIHt9CmZ1bmN0aW9uIGVtZXJnZW5jaWFTYWx2YXIoKSB7IHRyeSB7IGZzLndyaXRlRmlsZVN5bmMoQVJRX0VNRVJHRU5DSUEsIEpTT04uc3RyaW5naWZ5KGVtZXJnZW5jaWFHbG9iYWwpKTsgfSBjYXRjaCAoZSkge30gfQoKLy8gY29tYW5kb3MgZGUgbW92aW1lbnRvOiBibG9xdWVhZG9zIGVucXVhbnRvIGEgZW1lcmdlbmNpYSBlc3RpdmVyIGF0aXZhCmNvbnN0IFJFR0VYX01PVklNRU5UTyA9IC8oXC9zZXQkfFwvc2V0X3RlbXBlcmF0dXJhJHxcL2F0aXZhciR8XC9kb3NhciR8XC9kZXN2aWFyJHxcL3Rlc3RlJHxyZXNldGFyX3NlZ3VyYW5jYSQpLzsKY29uc3QgbXF0dFB1YmxpY2FyT3JpZ2luYWwgPSBtcXR0Q2xpZW50LnB1Ymxpc2guYmluZChtcXR0Q2xpZW50KTsKCmZ1bmN0aW9uIGVtZXJnZW5jaWFBdGl2YXIob3JpZ2VtKSB7CiAgICBpZiAoZW1lcmdlbmNpYUdsb2JhbC5hdGl2YSkgcmV0dXJuOwogICAgZW1lcmdlbmNpYUdsb2JhbCA9IHsgYXRpdmE6IHRydWUsIGRlc2RlOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksIG9yaWdlbTogb3JpZ2VtIHx8ICdkZXNjb25oZWNpZGEnIH07CiAgICBlbWVyZ2VuY2lhU2FsdmFyKCk7CiAgICBpby5lbWl0KCdlbWVyZ2VuY2lhX2VzdGFkbycsIGVtZXJnZW5jaWFHbG9iYWwpOwogICAgY29uc3QgdGV4dG8gPSAnRU1FUkdFTkNJQSBBVElWQSAoJyArIGVtZXJnZW5jaWFHbG9iYWwub3JpZ2VtICsgJykuIEEgbWFxdWluYSBmaWNhIHRyYXZhZGEgYXRlIGFsZ3VlbSBsaWJlcmFyIG5vIHNpdGUuJzsKICAgIGlvLmVtaXQoJ25vdm9fbG9nX3NlcnZpZG9yJywgeyBob3JhOiBob3JhQXR1YWxDdXJ0YSgpLCB0ZXh0bywgdGlwbzogJ2VtZXJnZW5jaWEnIH0pOwogICAgdHJ5IHsgc2FsdmFyTG9nTm9BcnF1aXZvRG9EaWEoYFske2hvcmFBdHVhbEN1cnRhKCl9XSAke3RleHRvfWApOyB9IGNhdGNoIChlKSB7fQp9CgpmdW5jdGlvbiBlbWVyZ2VuY2lhTGliZXJhcihxdWVtKSB7CiAgICBpZiAoIWVtZXJnZW5jaWFHbG9iYWwuYXRpdmEpIHJldHVybjsKICAgIGVtZXJnZW5jaWFHbG9iYWwgPSB7IGF0aXZhOiBmYWxzZSwgZGVzZGU6IG51bGwsIG9yaWdlbTogbnVsbCB9OwogICAgZW1lcmdlbmNpYVNhbHZhcigpOwogICAgbXF0dFB1YmxpY2FyT3JpZ2luYWwoJ2VzdGVpcmEvbGliZXJhcicsICcxJyk7CiAgICBtcXR0UHVibGljYXJPcmlnaW5hbCgnc2VwYXJhZG9yL2xpYmVyYXInLCAnMScpOwogICAgaW8uZW1pdCgnZW1lcmdlbmNpYV9lc3RhZG8nLCBlbWVyZ2VuY2lhR2xvYmFsKTsKICAgIGNvbnN0IHRleHRvID0gJ0VNRVJHRU5DSUEgTElCRVJBREEgcG9yICcgKyAocXVlbSB8fCAndXN1YXJpbycpICsgJy4gTWFxdWluYSBwcm9udGEgcGFyYSB1c28uJzsKICAgIGlvLmVtaXQoJ25vdm9fbG9nX3NlcnZpZG9yJywgeyBob3JhOiBob3JhQXR1YWxDdXJ0YSgpLCB0ZXh0bywgdGlwbzogJ3Npc3RlbWEnIH0pOwogICAgdHJ5IHsgc2FsdmFyTG9nTm9BcnF1aXZvRG9EaWEoYFske2hvcmFBdHVhbEN1cnRhKCl9XSAke3RleHRvfWApOyB9IGNhdGNoIChlKSB7fQp9CgovLyBhIGVzdGVpcmEgYXZpc2EgbyBwcm9wcmlvIGVzdGFkbyAoZWxhIGd1YXJkYSBhIHRyYXZhIG1lc21vIGRlc2xpZ2FkYSkKZnVuY3Rpb24gZW1lcmdlbmNpYVRyYXRhckVzdGVpcmEodmFsb3IpIHsKICAgIGlmICh2YWxvciA9PT0gJ2F0aXZhJyAmJiAhZW1lcmdlbmNpYUdsb2JhbC5hdGl2YSkgZW1lcmdlbmNpYUF0aXZhcignZXN0ZWlyYSAoYm90YW8gZmlzaWNvKScpOwogICAgaWYgKHZhbG9yID09PSAnbGliZXJhZGEnICYmIGVtZXJnZW5jaWFHbG9iYWwuYXRpdmEpIG1xdHRQdWJsaWNhck9yaWdpbmFsKCdlc3RlaXJhL2VtZXJnZW5jaWEnLCAnMScpOwp9CgptcXR0Q2xpZW50LnB1Ymxpc2ggPSBmdW5jdGlvbiAodG9waWNvLCBtZW5zYWdlbSwgLi4ucmVzdG8pIHsKICAgIGNvbnN0IHQgPSBTdHJpbmcodG9waWNvKTsKICAgIGlmICh0ID09PSAnZXN0ZWlyYS9lbWVyZ2VuY2lhJyAmJiBTdHJpbmcobWVuc2FnZW0pID09PSAnMScpIGVtZXJnZW5jaWFBdGl2YXIoJ3NpdGUsIEFsZXhhIG91IGJvdGFvJyk7CiAgICBpZiAoZW1lcmdlbmNpYUdsb2JhbC5hdGl2YSAmJiBSRUdFWF9NT1ZJTUVOVE8udGVzdCh0KSkgewogICAgICAgIGNvbnNvbGUubG9nKCfwn5uRIEVtZXJnZW5jaWEgYXRpdmE6IGNvbWFuZG8gYmxvcXVlYWRvICgnICsgdCArICcpJyk7CiAgICAgICAgcmV0dXJuIG1xdHRDbGllbnQ7CiAgICB9CiAgICByZXR1cm4gbXF0dFB1YmxpY2FyT3JpZ2luYWwodG9waWNvLCBtZW5zYWdlbSwgLi4ucmVzdG8pOwp9Owo=").decode("utf-8"); ROTAS = base64.b64decode("Ci8vIC0tLSBlbWVyZ2VuY2lhIGdsb2JhbDogZXN0YWRvIGUgbGliZXJhY2FvIChzbyBvIHNpdGUgbGliZXJhKSAtLS0KYXBwLmdldCgnL2FwaS9lbWVyZ2VuY2lhJywgbG9naW5PYnJpZ2F0b3JpbywgKHJlcSwgcmVzKSA9PiByZXMuanNvbihlbWVyZ2VuY2lhR2xvYmFsKSk7CmFwcC5wb3N0KCcvYXBpL2VtZXJnZW5jaWEvbGliZXJhcicsIGxvZ2luT2JyaWdhdG9yaW8sIChyZXEsIHJlcykgPT4gewogICAgZW1lcmdlbmNpYUxpYmVyYXIocmVzLmxvY2Fscy51c3VhcmlvTG9nYWRvIHx8IChyZXEuc2Vzc2lvbiAmJiByZXEuc2Vzc2lvbi51c3VhcmlvKSB8fCAndXN1YXJpbycpOwogICAgcmVzLmpzb24oZW1lcmdlbmNpYUdsb2JhbCk7Cn0pOwo=").decode("utf-8")
for f in (SERVER, BASEHTML):
    if not os.path.exists(f): print("❌ Nao achei " + f); sys.exit(1)
carimbo = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
for f in (SERVER, BASEHTML): shutil.copy2(f, f + ".bak_" + carimbo)
print("Copias de seguranca criadas (.bak_" + carimbo + ")\n")
res = []; c = open(SERVER, encoding="utf-8").read()
def aplicar(nome, marcador, fn, obrigatorio=True):
    global c
    if marcador in c: res.append("⏭️  %s: ja estava aplicado." % nome); return
    try: novo = fn(c)
    except Exception as e: res.append(("❌ " if obrigatorio else "⚠️  ") + "%s: %s" % (nome, e)); return
    if novo == c: res.append(("❌ " if obrigatorio else "⚠️  ") + "%s: trecho nao encontrado." % nome); return
    c = novo; res.append("✅ %s: aplicado." % nome)
def unico(t, a):
    if t.count(a) != 1: raise Exception("trecho nao encontrado (%d vezes)" % t.count(a))
def f_bloco(t):
    a = "const mqttClient = mqtt.connect(MQTT_BROKER);"; unico(t, a); return t.replace(a, a + "\n" + BLOCO, 1)
def f_rotas(t):
    a = "app.get('/dispenser', loginObrigatorio, (req, res) => res.render('dispenser.html'));"; unico(t, a); return t.replace(a, a + "\n" + ROTAS, 1)
def f_sub(t):
    a = "mqttClient.subscribe([MQTT_TOPIC_DISP_STATUS, MQTT_TOPIC_DISP_ESTADO, MQTT_TOPIC_DISP_CONCLUIDO]);"; unico(t, a); return t.replace(a, a + "\n    mqttClient.subscribe(['esteira/estado_emergencia']);", 1)
def f_msg(t):
    a = "mqttClient.on('message', (topic, message) => {\n    const valor = message.toString();"; unico(t, a); return t.replace(a, a + "\n    if (topic === 'esteira/estado_emergencia') emergenciaTratarEsteira(valor);", 1)
def f_socket(t):
    a = "io.on('connection', (socket) => {"; unico(t, a); return t.replace(a, a + "\n    socket.emit('emergencia_estado', emergenciaGlobal);", 1)
def guarda(ancora, nome):
    def f(t):
        unico(t, ancora); return t.replace(ancora, ancora + "\n    if (emergenciaGlobal.ativa) return res.status(423).json({ erro: 'Emergencia ativa: libere no site (botao DESBLOQUEAR) antes de usar a maquina.' });", 1)
    return f
aplicar("Servidor: trava global da emergencia", "EMERGENCIA GLOBAL: depois de acionada", f_bloco)
aplicar("Servidor: rotas de estado e liberacao", "/api/emergencia/liberar", f_rotas)
aplicar("Servidor: inscricao do estado da esteira", "esteira/estado_emergencia'])", f_sub)
aplicar("Servidor: tratamento do estado da esteira", "emergenciaTratarEsteira(valor);", f_msg)
aplicar("Servidor: avisa a tela ao conectar", "socket.emit('emergencia_estado'", f_socket)
c1 = "app.post('/api/dispenser/dosar', loginObrigatorio, (req, res) => {"
aplicar("Dispenser: nao doseia em emergencia", "app.post('/api/dispenser/dosar'XX", guarda(c1, 'd'), False) if False else None
if "res.status(423)" not in c.split(c1)[1][:300] if c1 in c else False:
    c = c.replace(c1, c1 + "\n    if (emergenciaGlobal.ativa) return res.status(423).json({ erro: 'Emergencia ativa: libere no site (botao DESBLOQUEAR) antes de usar a maquina.' });", 1); res.append("✅ Dispenser: nao doseia em emergencia: aplicado.")
elif c1 in c: res.append("⏭️  Dispenser: nao doseia em emergencia: ja estava aplicado.")
else: res.append("⚠️  Dispenser: rota de dosagem nao encontrada (o bloqueio geral dos comandos continua valendo).")
for ancora, nome in (("app.post('/api/receitas/aplicar', loginObrigatorio, (req, res) => {", "Receitas: nao aplica em emergencia"), ("app.post('/api/separador/servo/teste', loginObrigatorio, adminObrigatorio, (req, res) => {", "Separador: teste do servo bloqueado em emergencia")):
    if ancora in c:
        if "res.status(423)" in c.split(ancora)[1][:300]: res.append("⏭️  %s: ja estava aplicado." % nome)
        else: c = c.replace(ancora, ancora + "\n    if (emergenciaGlobal.ativa) return res.status(423).json({ erro: 'Emergencia ativa: libere no site (botao DESBLOQUEAR) antes de usar a maquina.' });", 1); res.append("✅ %s: aplicado." % nome)
    else: res.append("⚠️  %s: rota nao encontrada (fase 2/3 instaladas?)." % nome)
a = "    if (!receitas.botoesAtivos) return;"
if a in c and "emergenciaGlobal.ativa) return;" not in c.split(a)[0][-200:]: c = c.replace(a, "    if (emergenciaGlobal.ativa) return;\n" + a, 1); res.append("✅ Botoes MAIS/MENOS: ignorados em emergencia: aplicado.")
elif a in c: res.append("⏭️  Botoes MAIS/MENOS: ja estava aplicado.")
else: res.append("⚠️  Botoes MAIS/MENOS: trecho nao encontrado (fase 3 instalada?).")
open(SERVER, "w", encoding="utf-8").write(c)
b = open(BASEHTML, encoding="utf-8").read()
if "/api/emergencia/liberar" in b: res.append("⏭️  Tela: botao de emergencia ja usa o servidor.")
else:
    ini = b.find("btnEmergencia.addEventListener('click', () => {"); fim = b.find("atualizarVisualBotao();\n            });", ini)
    rem = "globalSocket.on('emergencia_remota', () => {\n                if (!emergenciaAtivada) btnEmergencia.click();\n            });"
    if ini < 0 or fim < 0 or rem not in b: res.append("❌ Tela: nao achei o botao de emergencia no base.html.")
    else:
        fim += len("atualizarVisualBotao();\n            });")
        novo = """function aplicarEstadoEmergencia(ativa) {
                if (emergenciaAtivada === ativa) return;
                emergenciaAtivada = ativa; sessionStorage.setItem('estado_emergencia', ativa); atualizarVisualBotao();
            }
            btnEmergencia.addEventListener('click', async () => {
                if (emergenciaAtivada) {
                    if (!confirm('Liberar a máquina? Confira se está tudo seguro antes de continuar.')) return;
                    try { const r = await fetch('/api/emergencia/liberar', { method: 'POST' }); if (!r.ok) { alert('Não foi possível liberar a emergência.'); return; } }
                    catch (e) { alert('Sem conexão com o servidor.'); return; }
                    adicionarLogInvisivel('SISTEMA DESBLOQUEADO. Pronto para operação.', 'emergencia');
                    return;
                }
                emergenciaAtivada = true; sessionStorage.setItem('estado_emergencia', true);
                globalSocket.emit('comando_esteira', { acao: 'emergencia' });
                adicionarLogInvisivel('SISTEMA DE EMERGÊNCIA ATIVADO. Velocidade zerada.', 'emergencia');
                atualizarVisualBotao();
            });
            globalSocket.on('emergencia_estado', (d) => aplicarEstadoEmergencia(!!(d && d.ativa)));"""
        b = b[:ini] + novo + b[fim:]; b = b.replace(rem, "globalSocket.on('emergencia_remota', () => { aplicarEstadoEmergencia(true); });", 1)
        open(BASEHTML, "w", encoding="utf-8").write(b); res.append("✅ Tela: DESBLOQUEAR agora libera pelo servidor (vale para todos os aparelhos).")
print("\n".join(res)); print()
ok = subprocess.run(["node", "-c", SERVER], capture_output=True, text=True)
if ok.returncode == 0: print("✅ server.js sem erro de sintaxe.")
else: print("❌ ERRO DE SINTAXE:"); print(ok.stderr); print("Para voltar:  cp " + SERVER + ".bak_" + carimbo + " " + SERVER); sys.exit(1)
print("⚠️  Teve ❌/⚠️ acima. Me mande essas linhas." if any(l[:1] in "❌⚠" for l in res) else "\nTudo certo! Reinicie:  sudo systemctl restart site_esteira   (depois Ctrl+Shift+R)")
