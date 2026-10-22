#!/bin/bash
# GitHub: https://github.com/brunoosz | LinkedIn: https://www.linkedin.com/in/brunocamperlingo/
# guarda-rede

DIR="${GUARDA_DIR:-/var/lib/flowpack}"
LOG="${GUARDA_LOG:-/var/log/guarda-rede.log}"
SYS="${GUARDA_SYS:-/sys}"
INTERVALO="${GUARDA_INTERVALO:-15}"
ALVOS="${GUARDA_ALVOS:-1.1.1.1 8.8.8.8}"
IFACES="${GUARDA_IFACES:-usb0 eth0}"
TOPICO_NTFY="notificacaositefestodarkcoders"
EST="$DIR/rede.json"
CTR="$DIR/guarda-estado.env"

mkdir -p "$DIR"

agora()  { date +%s; }
data()   { date '+%F %T'; }
log()    { echo "$(data) $*" >> "$LOG"; }
avisar() { curl -s -m 10 -H "Title: $1" -H "Priority: ${3:-default}" -d "$2" "https://ntfy.sh/$TOPICO_NTFY" > /dev/null 2>&1; }

# estado entre rodadas
FALHAS=0; QUEDA_INICIO=0; NIVEL=0; NOTIFICADO=0
QUEDAS_HOJE=0; DIA=""; ULTIMA_QUEDA=""; ULTIMA_RECUP=""; ULTIMO_MOTIVO=""
[ -f "$CTR" ] && . "$CTR"
salvar_ctr() {
  cat > "$CTR" << FIM
FALHAS=$FALHAS
QUEDA_INICIO=$QUEDA_INICIO
NIVEL=$NIVEL
NOTIFICADO=$NOTIFICADO
QUEDAS_HOJE=$QUEDAS_HOJE
DIA="$DIA"
ULTIMA_QUEDA="$ULTIMA_QUEDA"
ULTIMA_RECUP="$ULTIMA_RECUP"
ULTIMO_MOTIVO="$ULTIMO_MOTIVO"
FIM
}

# consultas
existe_iface() { [ -e "$SYS/class/net/$1" ]; }
ip_da()        { ip -4 -o addr show dev "$1" 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1; }
gateway_da()   { ip route show default dev "$1" 2>/dev/null | awk '/default/ {for(i=1;i<=NF;i++) if($i=="via") {print $(i+1); exit}}'; }
rota_padrao_iface() { ip route show default 2>/dev/null | awk '/default/ {for(i=1;i<=NF;i++) if($i=="dev") {print $(i+1); exit}}'; }

# retorna 0 se respondeu
LATENCIA=""
internet_por() {
  local iface="$1" alvo saida
  LATENCIA=""
  for alvo in $ALVOS; do
    saida=$(ping -c 1 -W 2 -I "$iface" "$alvo" 2>/dev/null) && {
      LATENCIA=$(echo "$saida" | grep -o 'time=[0-9.]*' | head -1 | cut -d= -f2)
      return 0
    }
  done
  return 1
}

# consertos
renovar_dhcp() {
  local iface="$1"
  log "  acao: renovando o endereco (DHCP) em $iface"
  if command -v dhclient > /dev/null 2>&1; then
    dhclient -r "$iface" > /dev/null 2>&1; dhclient -1 "$iface" > /dev/null 2>&1
  elif command -v dhcpcd > /dev/null 2>&1; then
    dhcpcd -n "$iface" > /dev/null 2>&1
  elif command -v networkctl > /dev/null 2>&1; then
    networkctl reconfigure "$iface" > /dev/null 2>&1
  else
    ifdown "$iface" > /dev/null 2>&1; ifup "$iface" > /dev/null 2>&1
  fi
}

reiniciar_iface() {
  local iface="$1"
  log "  acao: desligando e ligando a interface $iface"
  ip link set "$iface" down; sleep 2; ip link set "$iface" up; sleep 3
  renovar_dhcp "$iface"
}

resetar_usb() {
  local iface="$1" dispositivo
  dispositivo=$(dirname "$(readlink -f "$SYS/class/net/$iface/device" 2>/dev/null)")
  if [ -n "$dispositivo" ] && [ -w "$dispositivo/authorized" ]; then
    log "  acao: reiniciando a conexao USB do celular ($dispositivo)"
    echo 0 > "$dispositivo/authorized"; sleep 3; echo 1 > "$dispositivo/authorized"; sleep 6
    renovar_dhcp "$iface"
  else
    log "  nao achei o dispositivo USB de $iface para reiniciar"
  fi
}

reaplicar_nat() {
  log "  acao: refazendo o compartilhamento (NAT) para o Wi-Fi DarkCoders"
  sysctl -w net.ipv4.ip_forward=1 > /dev/null 2>&1
  systemctl restart darkcoders-nat.service > /dev/null 2>&1
}

# escrita do estado
escrever_json() {
  local internet="$1" uplink="$2" ip="$3" gw="$4" lat="$5" motivo="$6" acao="$7"
  cat > "$EST.tmp" << FIM
{"hora":"$(data)","epoch":$(agora),"internet":$internet,"uplink":"$uplink","ip":"$ip","gateway":"$gw","latencia_ms":${lat:-null},"falhas_seguidas":$FALHAS,"motivo":"$motivo","acao":"$acao","quedas_hoje":$QUEDAS_HOJE,"ultima_queda":"$ULTIMA_QUEDA","ultima_recuperacao":"$ULTIMA_RECUP","ifaces":"$(for i in $IFACES; do existe_iface $i && echo -n "$i "; done)"}
FIM
  mv "$EST.tmp" "$EST"
}

# uma rodada
ciclo() {
  local hoje atual escolhida="" iface gw ip motivo="ok" acao="" nivel_desejado
  hoje=$(date +%F)
  if [ "$DIA" != "$hoje" ]; then DIA="$hoje"; QUEDAS_HOJE=0; fi

  # interface com internet
  atual=$(rota_padrao_iface)
  for iface in $atual $IFACES; do
    [ -z "$iface" ] && continue
    existe_iface "$iface" || continue
    [ -z "$(ip_da "$iface")" ] && continue
    if internet_por "$iface"; then escolhida="$iface"; break; fi
  done

  if [ -n "$escolhida" ]; then
    # rota padrão
    if [ -n "$atual" ] && [ "$atual" != "$escolhida" ]; then
      gw=$(gateway_da "$escolhida"); [ -z "$gw" ] && gw=$(ip route show dev "$escolhida" 2>/dev/null | awk '/default/ {print $3; exit}')
      if [ -n "$gw" ]; then
        log "  acao: a rota padrao usava $atual (sem internet); trocando para $escolhida"
        ip route replace default via "$gw" dev "$escolhida" metric 50
        acao="rota_trocada_para_$escolhida"
      fi
    fi
    ip=$(ip_da "$escolhida"); gw=$(gateway_da "$escolhida")
    [ -n "$gw" ] && ping -c 1 -W 1 -I "$escolhida" "$gw" > /dev/null 2>&1   # keepalive

    if [ "$FALHAS" -ge 2 ]; then
      local dur=$(( $(agora) - QUEDA_INICIO ))
      ULTIMA_RECUP="$(data)"
      log "RECUPERADA: internet voltou por $escolhida depois de ${dur}s ($ULTIMO_MOTIVO)"
      reaplicar_nat
      systemctl start --no-block vigia-site-darkcoders.service > /dev/null 2>&1
      [ "$NOTIFICADO" = "1" ] && avisar "Internet voltou" "Voltou por $escolhida depois de ${dur}s. Motivo da queda: $ULTIMO_MOTIVO." default
    fi
    FALHAS=0; NIVEL=0; NOTIFICADO=0
    escrever_json true "$escolhida" "$ip" "$gw" "$LATENCIA" "ok" "$acao"
    salvar_ctr
    return 0
  fi

  # sem internet
  FALHAS=$((FALHAS + 1))
  [ "$FALHAS" -eq 1 ] && QUEDA_INICIO=$(agora)
  iface=""
  for i in $atual $IFACES; do [ -n "$i" ] && existe_iface "$i" && { iface="$i"; break; }; done
  if [ -z "$iface" ]; then
    motivo="tethering_desligado"
  else
    ip=$(ip_da "$iface"); gw=$(gateway_da "$iface")
    if [ -z "$ip" ]; then motivo="sem_ip"
    elif [ -n "$gw" ] && ! ping -c 1 -W 2 -I "$iface" "$gw" > /dev/null 2>&1; then motivo="celular_mudo"
    else motivo="sem_dados_no_celular"; fi
  fi
  ULTIMO_MOTIVO="$motivo"

  if [ "$FALHAS" -eq 2 ]; then
    QUEDAS_HOJE=$((QUEDAS_HOJE + 1)); ULTIMA_QUEDA="$(data)"
    log "QUEDA: sem internet ha ~$((FALHAS * INTERVALO))s. Motivo provavel: $motivo (interface: ${iface:-nenhuma})"
  fi

  # consertar
  if [ "$FALHAS" -ge 2 ]; then
    nivel_desejado=0
    [ "$FALHAS" -ge 2 ] && nivel_desejado=1
    [ "$FALHAS" -ge 4 ] && nivel_desejado=2
    [ "$FALHAS" -ge 6 ] && nivel_desejado=3
    # repetir nível 3
    if [ "$FALHAS" -gt 6 ] && [ $(( (FALHAS - 6) % 8 )) -eq 0 ]; then nivel_desejado=3; NIVEL=2; fi
    if [ "$nivel_desejado" -gt "$NIVEL" ] && [ -n "$iface" ]; then
      NIVEL=$nivel_desejado
      case "$motivo:$nivel_desejado" in
        sem_ip:1)               renovar_dhcp "$iface"; acao="dhcp" ;;
        sem_ip:2|celular_mudo:1) reiniciar_iface "$iface"; acao="reiniciou_interface" ;;
        sem_ip:3|celular_mudo:2|celular_mudo:3) resetar_usb "$iface"; acao="reset_usb" ;;
        sem_dados_no_celular:1) reaplicar_nat; acao="nat" ;;
        sem_dados_no_celular:2) renovar_dhcp "$iface"; acao="dhcp" ;;
        sem_dados_no_celular:3) log "  o celular esta conectado mas sem dados moveis/Wi-Fi: confira o plano e o sinal"; acao="aviso_celular" ;;
      esac
    fi
    [ "$motivo" = "tethering_desligado" ] && acao="aguardando_celular"
  fi

  # aviso de queda
  if [ "$FALHAS" -ge 4 ] && [ "$NOTIFICADO" = "0" ]; then
    NOTIFICADO=1
    case "$motivo" in
      tethering_desligado)  texto="Celular desconectado: ligue de novo o tethering USB." ;;
      sem_ip)               texto="O celular nao entregou endereco. Tentando renovar." ;;
      celular_mudo)         texto="O celular conectou mas nao responde. Reiniciando a conexao USB." ;;
      *)                    texto="O celular esta conectado mas sem internet (dados/sinal)." ;;
    esac
    avisar "Sem internet no Raspberry" "$texto" high
  fi

  escrever_json false "${iface:-nenhuma}" "$ip" "$gw" "" "$motivo" "$acao"
  salvar_ctr
}

if [ "${GUARDA_UM_CICLO:-0}" = "1" ]; then ciclo; exit 0; fi

log "guarda-rede iniciado (a cada ${INTERVALO}s; interfaces: $IFACES)"
while true; do
  ciclo
  sleep "$INTERVALO"
done
