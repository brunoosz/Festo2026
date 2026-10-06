# Skill da Alexa

A skill tem cinco comandos: ligar a máquina com a receita de 50, 100, 150 ou 200 g, e a parada de emergência. Depois de qualquer um deles a skill se fecha sozinha.

## Como funciona

1. "Alexa, abrir controle máquina" (ou dizer "ligar" dentro da skill): a Alexa pergunta com qual pré-definição ligar.
2. Você responde "50 gramas", "100 gramas", "150 gramas" ou "200 gramas". O servidor aplica a receita correspondente (esteira, motores e temperaturas), liga os dois aquecimentos e a skill fecha.
3. "emergência" aciona a Parada de Emergência e também fecha a skill.

As pré-definições vêm da tela **Receitas** do site. Se você mudar os gramas de um nível por lá, a Alexa passa a aceitar o novo valor.

Depois de uma emergência, destrave a Parada de Emergência no site antes de ligar de novo.

## Como aplicar no console da Alexa

1. Abra o [Alexa Developer Console](https://developer.amazon.com/alexa/console/ask) e entre na skill.
2. Vá em **Build > Interaction Model > JSON Editor**.
3. Apague o conteúdo e cole o arquivo [`modelo_de_interacao.json`](modelo_de_interacao.json).
4. Confira a linha `invocationName`. Ela precisa ser o nome que você já usa para abrir a skill (hoje o manual cita "controle máquina"). Se for outro, troque aqui antes de salvar.
5. Clique em **Save Model** e depois em **Build Model**.
6. Em **Endpoint**, o endereço continua o mesmo (`https://seu-endereco/alexa`). Não precisa mudar.
7. Em **Test**, escolha "Development" e teste: "abrir controle máquina", depois "50 gramas".

Os intents antigos (mudar velocidade, temperatura, perguntas e outros) deixam de existir no modelo. O código do servidor que trata esses pedidos continua no `server.js`, mas não é mais chamado.
