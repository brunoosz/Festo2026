# Política de Segurança

## Reportando uma vulnerabilidade

Não abra uma *issue* pública. Envie os detalhes por mensagem privada ao mantenedor ([@brunoosz](https://github.com/brunoosz)) para que a correção seja feita antes da divulgação.

## Recomendações para uso em produção

O projeto foi pensado para uma rede local, mas a gente também usa pelo Tailscale Funnel. Antes de expor à internet:

- **Troque a senha padrão** `admin` assim que o sistema subir pela primeira vez.
- **Segredo de sessão:** vem de `SESSION_SECRET` no `.env`. Se não existir, o servidor gera um e guarda em `.session_secret` (fora do repositório). Não compartilhe esse arquivo.
- **Login:** o servidor bloqueia o IP por 15 minutos depois de 8 senhas erradas. Isso ajuda, mas não substitui uma senha forte.
- **Restrinja o CORS do Socket.IO**, que está com `origin: "*"`.
- **Proteja o broker MQTT** com usuário e senha, e não o exponha fora da rede da máquina.
- **Use HTTPS** (proxy reverso) quando o acesso for remoto. A skill da Alexa já exige HTTPS.
- **Não versione dados de execução:** `usuarios.json`, `logs/` e `.env` ficam fora do repositório.
- Mantenha as dependências atualizadas com `npm audit` e `npm update`.
