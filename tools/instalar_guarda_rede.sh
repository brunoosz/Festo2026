#!/bin/bash
# Instala o guarda-rede e as protecoes do site no Raspberry (rodar como root).
#   sudo bash instalar_guarda_rede.sh
# Pode rodar de novo sem problema (nao duplica nada).

P="${PREFIXO:-}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
ORIGEM="$(cd "$(dirname "$0")" && pwd)"

ok()   { echo "✅ $*"; }
pula() { echo "⏭️  $*"; }
erro() { echo "❌ $*"; }

if [ -z "$P" ] && [ "$(id -u)" != "0" ]; then erro "Rode como root:  sudo bash $0"; exit 1; fi
if [ ! -f "$ORIGEM/guarda-rede-darkcoders.sh" ]; then erro "Nao achei guarda-rede-darkcoders.sh na mesma pasta deste instalador."; exit 1; fi

# 1) script do guarda-rede
mkdir -p "$P/usr/local/bin" "$P/var/lib/flowpack" "$P/etc/systemd/system/site_esteira.service.d"
if cmp -s "$ORIGEM/guarda-rede-darkcoders.sh" "$P/usr/local/bin/guarda-rede-darkcoders.sh"; then
  pula "Guarda-rede: script ja estava atualizado."
else
  install -m 755 "$ORIGEM/guarda-rede-darkcoders.sh" "$P/usr/local/bin/guarda-rede-darkcoders.sh" && ok "Guarda-rede: script instalado."
fi

# 2) servico do guarda-rede
UNIT="$P/etc/systemd/system/guarda-rede-darkcoders.service"
cat > "$UNIT.novo" << 'FIM'
[Unit]
Description=Guarda-rede Dark Coders (mantem a internet do celular chegando)
After=network.target

[Service]
ExecStart=/usr/local/bin/guarda-rede-darkcoders.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
FIM
if [ -f "$UNIT" ] && cmp -s "$UNIT" "$UNIT.novo"; then rm -f "$UNIT.novo"; pula "Guarda-rede: servico ja existia."; else mv "$UNIT.novo" "$UNIT"; ok "Guarda-rede: servico criado."; fi

# 3) protecao do site: reinicia sozinho se cair e o sistema nao o escolhe quando falta memoria
DROP="$P/etc/systemd/system/site_esteira.service.d/protecao.conf"
cat > "$DROP.novo" << 'FIM'
[Service]
Restart=always
RestartSec=3
OOMScoreAdjust=-500
FIM
if [ -f "$DROP" ] && cmp -s "$DROP" "$DROP.novo"; then rm -f "$DROP.novo"; pula "Site: protecao (reinicio automatico e prioridade de memoria) ja existia."; else mv "$DROP.novo" "$DROP"; ok "Site: reinicia sozinho se cair e e o ultimo a ser derrubado se faltar memoria."; fi

# 4) memoria virtual (swap) se o Raspberry nao tiver nenhuma
if [ "${PULAR_SWAP:-0}" = "1" ]; then
  pula "Swap: pulado."
elif [ -n "$(swapon --show --noheadings 2>/dev/null)" ]; then
  pula "Swap: o Raspberry ja tem memoria virtual ($(swapon --show --noheadings | awk '{print $3}' | head -1))."
else
  if fallocate -l 1G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=1024 status=none; then
    chmod 600 /swapfile && mkswap /swapfile > /dev/null && swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    ok "Swap: criei 1 GB de memoria virtual (evita o site ser morto por falta de memoria)."
  else
    erro "Swap: nao consegui criar o arquivo (falta de espaco?)."
  fi
fi
SW="$P/etc/sysctl.d/99-flowpack.conf"
mkdir -p "$P/etc/sysctl.d"
if [ -f "$SW" ]; then
  pula "Swappiness ja configurado."
elif echo "vm.swappiness=10" > "$SW"; then
  sysctl -q -p "$SW" > /dev/null 2>&1
  ok "Swap: so usa a memoria virtual quando precisa (swappiness 10)."
else
  erro "Swappiness: nao consegui gravar $SW"
fi

# 5) liga tudo
"$SYSTEMCTL" daemon-reload
"$SYSTEMCTL" enable guarda-rede-darkcoders.service > /dev/null 2>&1
"$SYSTEMCTL" restart guarda-rede-darkcoders.service && ok "Guarda-rede ligado."
echo
echo "Para acompanhar:   tail -f /var/log/guarda-rede.log"
echo "Estado atual:      cat /var/lib/flowpack/rede.json"
echo "A protecao do site vale no proximo reinicio dele:  sudo systemctl restart site_esteira"
