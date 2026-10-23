#!/bin/bash
# GitHub: https://github.com/brunoosz | LinkedIn: https://www.linkedin.com/in/brunocamperlingo/
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
