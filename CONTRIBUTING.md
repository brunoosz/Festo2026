# Contribuindo

Obrigado por querer contribuir com o projeto Festo 2026!

## Fluxo de trabalho

1. Faça um *fork* e crie uma branch a partir de `main`:
   ```bash
   git checkout -b feat/minha-melhoria
   ```
2. Faça suas alterações e teste localmente com `npm start`.
3. Use mensagens de commit claras, no formato `tipo: descrição` (`feat`, `fix`, `docs`, `refactor`):
   ```
   feat: adiciona gráfico de temperatura por selagem
   ```
4. Abra um *Pull Request* explicando o que mudou e por quê.

## Boas práticas

- Nunca faça commit de senhas, chaves de API, `.env` ou `usuarios.json`.
- Teste mudanças que enviam comandos MQTT com a máquina parada ou desconectada.
- Mantenha a parada de emergência sempre funcional.
- Ao adicionar perguntas ao chat, siga o formato dos arquivos em `knowledge/`.

## Reportando problemas

Abra uma *issue* descrevendo o comportamento esperado, o observado e os passos para reproduzir. Para falhas de segurança, siga o [SECURITY.md](SECURITY.md).
