# Política de Segurança

## Reportando uma vulnerabilidade

Não abra uma *issue* pública. Envie os detalhes por mensagem privada ao mantenedor ([@brunoosz](https://github.com/brunoosz)) para que a correção seja feita antes da divulgação.

## Recomendações para uso em produção

O projeto foi pensado para uma rede local isolada. Antes de expô-lo à internet:

- **Troque a senha padrão** `admin` assim que o sistema subir pela primeira vez.
- **Defina um segredo de sessão próprio.** Hoje o valor está fixo em `server.js` (`express-session`); mova-o para uma variável de ambiente.
- **Restrinja o CORS do Socket.IO**, que está com `origin: "*"`.
- **Proteja o broker MQTT** com usuário e senha, e não o exponha fora da rede da máquina.
- **Use HTTPS** (proxy reverso) quando o acesso for remoto. A skill da Alexa já exige HTTPS.
- **Não versione dados de execução:** `usuarios.json`, `logs/` e `.env` ficam fora do repositório.
- Mantenha as dependências atualizadas com `npm audit` e `npm update`.
