#!/usr/bin/env bash
# atualiza o site no raspberry sem perder usuarios, receitas, fotos e configs
# uso: bash atualizar.sh [branch]   (padrao: main)

set -euo pipefail

BRANCH="${1:-main}"
PASTA="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PASTA"

DADOS=(usuarios.json receitas.json produtos_referencia.json produtos_referencia
       config_visao.json dispenser_config.json alexa_cert_cache.json
       .env .session_secret logs)

BACKUP="$PASTA/../festo2026_backup/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP"
for item in "${DADOS[@]}"; do
    [ -e "$item" ] && cp -a "$item" "$BACKUP/"
done
echo "backup salvo em $BACKUP"

echo "baixando a branch $BRANCH..."
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"

for item in "${DADOS[@]}"; do
    if [ -e "$BACKUP/$item" ]; then
        rm -rf "./$item"
        cp -a "$BACKUP/$item" "./$item"
    fi
done
echo "dados restaurados"

npm install --omit=dev --no-audit --no-fund

reiniciar() {
    if command -v pm2 >/dev/null 2>&1 && pm2 jlist 2>/dev/null | grep -q '"name"'; then
        pm2 restart all && return 0
    fi
    local svc
    svc="$(systemctl list-units --type=service --all --no-legend 2>/dev/null \
        | awk '{print $1}' | grep -iE 'flowpack|festo|darkcoders|dark-coders' | head -n1 || true)"
    if [ -n "$svc" ]; then
        sudo systemctl restart "$svc" && return 0
    fi
    return 1
}

if reiniciar; then
    echo "site reiniciado"
else
    echo "nao achei o servico (pm2/systemd). reinicie o site do jeito que voce usa, ex: node server.js"
fi
