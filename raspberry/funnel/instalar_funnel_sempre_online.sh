#!/bin/bash
# GitHub: https://github.com/brunoosz | LinkedIn: https://www.linkedin.com/in/brunocamperlingo/
# FLOWPACK - TAILSCALE FUNNEL SEMPRE ONLINE (instalador)
# Uso (no Raspberry, como root):   sudo bash instalar_funnel_sempre_online.sh
# O que faz: troca o servico antigo (que roda o funnel em primeiro plano e acaba derrubado pelo systemd) por um GUARDIAO que
# confere o site pela internet a cada 20 s e conserta sozinho (hora, rede, login, funnel, tailscaled e, em ultimo caso, reinicia o Raspberry).
[ "$(id -u)" -eq 0 ] || { echo "❌ Rode como root:  sudo bash $0"; exit 1; }
command -v tailscale > /dev/null 2>&1 || { echo "❌ O tailscale nao esta instalado."; exit 1; }
echo "1/6 Gravando o guardiao e o diagnostico..."
cat > /usr/local/bin/funnel-guardian.sh << 'FIM_GUARDIAO'
#!/bin/bash
# Guardiao do Tailscale Funnel - Dark Coders
# Fica rodando para sempre, confere a cada poucos segundos se o site esta no ar pela internet e CONSERTA sozinho:
# espera o relogio e a rede, religa o tailscale, refaz o funnel e, em ultimo caso, reinicia o Raspberry.
PORTA="${FUNNEL_PORTA:-5000}"
URL_PADRAO="${FUNNEL_URL:-darkcoders.tail5417c7.ts.net}"
INTERVALO="${FUNNEL_INTERVALO:-20}"
REBOOT_MIN="${FUNNEL_REBOOT_MIN:-30}"              # reinicia o Raspberry se ficar fora do ar por tanto tempo (0 = nunca)
ANO_MINIMO="${FUNNEL_ANO_MINIMO:-2026}"            # o Raspberry nao tem relogio proprio: espera a hora certa
MAX_RODADAS="${FUNNEL_MAX_RODADAS:-0}"             # 0 = infinito (so para testes)
TS="${TAILSCALE_BIN:-tailscale}"
DIR="${FUNNEL_DIR:-/var/lib/flowpack}"
TOPICO_NTFY="notificacaositefestodarkcoders"
mkdir -p "$DIR" 2>/dev/null
log()    { echo "$*"; }
avisar() { curl -s -m 10 -H "Title: $1" -d "$2" "https://ntfy.sh/$TOPICO_NTFY" > /dev/null 2>&1; }
hora_ok()       { [ "$(date +%Y)" -ge "$ANO_MINIMO" ]; }
internet_ok()   { ping -c 1 -W 2 1.1.1.1 > /dev/null 2>&1 || ping -c 1 -W 2 8.8.8.8 > /dev/null 2>&1; }
estado_ts()     { $TS status --json 2>/dev/null | grep -o '"BackendState": *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/'; }
nome_dns()      { n=$($TS status --json 2>/dev/null | grep -o '"DNSName": *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/; s/\.$//'); echo "${n:-$URL_PADRAO}"; }
funnel_ligado() { s=$($TS funnel status 2>&1); echo "$s" | grep -qi "Funnel on" && echo "$s" | grep -q ":$PORTA"; }
site_local_ok() { c=$(curl -s -m 6 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORTA/" 2>/dev/null); [ -n "$c" ] && [ "$c" != "000" ]; }
aplicar_funnel() {
  saida=$($TS funnel --bg "$PORTA" 2>&1); rc=$?
  log "funnel --bg $PORTA (codigo $rc): $(echo "$saida" | tr '\n' ' ' | cut -c1-220)"
  echo "$saida" | grep -qi "not enabled\|nao esta habilitado\|enable" && log "ATENCAO: ative o Funnel/HTTPS no painel do Tailscale (veja o guia)."
  return $rc
}
tentar_sincronizar_hora() { timedatectl set-ntp true > /dev/null 2>&1; systemctl restart systemd-timesyncd > /dev/null 2>&1; }

FALHAS=0; INICIO_FALHA=0; AVISADO=0; RODADA=0
log "Guardiao do Funnel iniciado (porta $PORTA, a cada ${INTERVALO}s, reiniciar Raspberry apos ${REBOOT_MIN} min fora do ar)"
while true; do
  RODADA=$((RODADA + 1)); ok=1; motivo=""
  if ! hora_ok; then
    log "relogio errado ($(date '+%F %T')); aguardando a hora certa pela internet"; tentar_sincronizar_hora
    [ "$MAX_RODADAS" -gt 0 ] && [ "$RODADA" -ge "$MAX_RODADAS" ] && break; sleep "$INTERVALO"; continue
  fi
  if ! internet_ok; then
    log "sem internet no Raspberry (o guarda-rede cuida disso); aguardando"
    [ "$MAX_RODADAS" -gt 0 ] && [ "$RODADA" -ge "$MAX_RODADAS" ] && break; sleep "$INTERVALO"; continue
  fi
  systemctl is-active --quiet tailscaled || { log "tailscaled parado; iniciando"; systemctl restart tailscaled; sleep 5; }
  est=$(estado_ts)
  case "$est" in
    Running) ;;
    NeedsLogin|NeedsMachineAuth) ok=0; motivo="deslogado";;
    *) timeout 25 $TS up > /dev/null 2>&1; ok=0; motivo="tailscale_${est:-sem_estado}";;
  esac
  if [ "$ok" = 1 ] && ! funnel_ligado; then
    log "funnel desligado; refazendo"; aplicar_funnel; sleep 3
    funnel_ligado || { ok=0; motivo="funnel_nao_ligou"; }
  fi
  if [ "$ok" = 1 ]; then
    if ! site_local_ok; then log "o site local (porta $PORTA) nao responde; reiniciando site_esteira"; systemctl restart site_esteira; sleep 8; fi
    DNS=$(nome_dns); cod=$(curl -s -m 12 -o /dev/null -w '%{http_code}' "https://$DNS/" 2>/dev/null)
    if [ -z "$cod" ] || [ "$cod" = "000" ]; then ok=0; motivo="publico_sem_resposta"; fi
  fi
  if [ "$ok" = 1 ]; then
    if [ "$FALHAS" -gt 0 ]; then log "RECUPERADO: funnel no ar de novo (apos $FALHAS falhas)"; [ "$AVISADO" = 1 ] && avisar "Site online de novo" "O Tailscale Funnel voltou ($DNS)."; fi
    FALHAS=0; INICIO_FALHA=0; AVISADO=0
  else
    FALHAS=$((FALHAS + 1)); [ "$INICIO_FALHA" = 0 ] && INICIO_FALHA=$(date +%s)
    log "FALHA $FALHAS: $motivo"
    if [ "$motivo" = "deslogado" ]; then
      log "O Tailscale pediu login: rode  sudo tailscale up  e abra o link (veja o guia; desative a expiracao da chave)."
      [ "$AVISADO" = 0 ] && [ "$FALHAS" -ge 3 ] && { avisar "Funnel: Tailscale deslogado" "Rode: sudo tailscale up  (e desative a expiracao da chave no painel)."; AVISADO=1; }
    else
      [ "$FALHAS" = 2 ] && { log "passo 1: refazendo o funnel do zero"; $TS funnel reset > /dev/null 2>&1; aplicar_funnel; }
      [ "$FALHAS" = 4 ] && { log "passo 2: reiniciando o tailscaled"; systemctl restart tailscaled; sleep 8; aplicar_funnel; }
      [ "$FALHAS" = 8 ] && [ "$AVISADO" = 0 ] && { avisar "Funnel fora do ar" "Motivo: $motivo. O guardiao continua tentando."; AVISADO=1; }
      fora=$(( $(date +%s) - INICIO_FALHA ))
      if [ "$REBOOT_MIN" -gt 0 ] && [ "$fora" -ge $((REBOOT_MIN * 60)) ]; then
        ULT=0; [ -f "$DIR/funnel-ultimo-reboot" ] && ULT=$(cat "$DIR/funnel-ultimo-reboot" 2>/dev/null || echo 0)
        if [ $(( $(date +%s) - ULT )) -ge 21600 ]; then
          log "fora do ar ha $((fora / 60)) min: reiniciando o Raspberry (no maximo 1 vez a cada 6 horas)"; date +%s > "$DIR/funnel-ultimo-reboot"; avisar "Raspberry reiniciando" "Funnel fora do ar ha $((fora / 60)) min ($motivo)."; sleep 3; systemctl reboot
        fi
      fi
    fi
  fi
  [ "$MAX_RODADAS" -gt 0 ] && [ "$RODADA" -ge "$MAX_RODADAS" ] && break
  sleep "$INTERVALO"
done
FIM_GUARDIAO
chmod +x /usr/local/bin/funnel-guardian.sh
cat > /usr/local/bin/funnel-diagnostico.sh << 'FIM_DIAG'
#!/bin/bash
# Diagnostico do Tailscale Funnel - rode:  sudo bash funnel-diagnostico.sh   (salva em /root/funnel-diagnostico.txt para voce me mandar)
SAIDA=/root/funnel-diagnostico.txt
{
echo "=== DATA/HORA (o Raspberry nao tem relogio proprio) ==="; date; timedatectl 2>/dev/null | grep -i "synchronized\|NTP\|Local time"
echo; echo "=== REDE ==="; ip -br a; echo; ip route | head -6
echo; echo "=== INTERNET E DNS ==="; ping -c 2 -W 2 1.1.1.1 2>&1 | tail -2; getent hosts login.tailscale.com || echo "DNS NAO resolve login.tailscale.com"
curl -s -m 8 -o /dev/null -w "controlplane.tailscale.com -> HTTP %{http_code}\n" https://controlplane.tailscale.com/key?v=1 2>&1
echo; echo "=== TAILSCALE ==="; tailscale version 2>&1 | head -2; systemctl is-active tailscaled; tailscale status 2>&1 | head -8
tailscale status --json 2>/dev/null | grep -o '"BackendState": *"[^"]*"' | head -1
echo; echo "=== FUNNEL ==="; tailscale funnel status 2>&1; tailscale serve status 2>&1 | head -6
echo; echo "=== SITE LOCAL ==="; curl -s -m 6 -o /dev/null -w "http://127.0.0.1:5000 -> HTTP %{http_code}\n" http://127.0.0.1:5000/; systemctl is-active site_esteira
echo; echo "=== SERVICOS ==="; systemctl is-enabled tailscaled funnel-guardian.service tailscale-funnel.service 2>&1; systemctl is-active funnel-guardian.service
echo; echo "=== ULTIMAS LINHAS: guardiao ==="; journalctl -u funnel-guardian -n 25 --no-pager 2>&1 | cut -c1-200
echo; echo "=== ULTIMAS LINHAS: tailscaled ==="; journalctl -u tailscaled -n 25 --no-pager 2>&1 | cut -c1-200
echo; echo "=== SERVICO ANTIGO (se existir) ==="; journalctl -u tailscale-funnel.service -n 10 --no-pager 2>&1 | cut -c1-200
} 2>&1 | tee "$SAIDA"
echo; echo "Salvei em $SAIDA - me mande o conteudo."
FIM_DIAG
chmod +x /usr/local/bin/funnel-diagnostico.sh
echo "2/6 Desligando o servico antigo do funnel (se existir)..."
if [ -f /etc/systemd/system/tailscale-funnel.service ]; then
  systemctl disable --now tailscale-funnel.service > /dev/null 2>&1
  mv /etc/systemd/system/tailscale-funnel.service /etc/systemd/system/tailscale-funnel.service.antigo
  echo "   servico antigo desativado (guardado como .antigo)"
else echo "   nao havia servico antigo"; fi
echo "3/6 Deixando o tailscaled mais robusto (espera a rede e reinicia sozinho)..."
mkdir -p /etc/systemd/system/tailscaled.service.d
cat > /etc/systemd/system/tailscaled.service.d/99-darkcoders.conf << 'EOF'
[Unit]
After=network-online.target
Wants=network-online.target
[Service]
Restart=always
RestartSec=5
EOF
echo "4/6 Criando o servico do guardiao..."
cat > /etc/systemd/system/funnel-guardian.service << 'EOF'
[Unit]
Description=Guardiao do Tailscale Funnel (Dark Coders)
After=network-online.target tailscaled.service
Wants=network-online.target tailscaled.service
[Service]
Type=simple
ExecStart=/usr/local/bin/funnel-guardian.sh
Restart=always
RestartSec=10
[Install]
WantedBy=multi-user.target
EOF
echo "5/6 Ligando a sincronizacao de hora e ativando tudo..."
timedatectl set-ntp true > /dev/null 2>&1
systemctl daemon-reload; systemctl enable tailscaled > /dev/null 2>&1; systemctl restart tailscaled; sleep 3
systemctl enable --now funnel-guardian.service
echo "6/6 Aguardando o guardiao trabalhar (25 s)..."; sleep 25
echo; echo "---- guardiao ----"; journalctl -u funnel-guardian -n 12 --no-pager | cut -c1-170
echo; echo "---- funnel ----"; tailscale funnel status 2>&1 | head -6
echo; echo "---- tailscale ----"; tailscale status 2>&1 | head -3
echo; echo "✅ Instalado. Acompanhe ao vivo:  journalctl -u funnel-guardian -f      Diagnostico completo:  sudo funnel-diagnostico.sh"
echo "   Se aparecer 'deslogado': rode  sudo tailscale up  e abra o link (e desative a expiracao da chave no painel do Tailscale - veja o guia)."
