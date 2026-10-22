# Skill da Alexa

A skill liga a máquina com a receita de 50, 100, 150 ou 200 g e aciona a parada de emergência (depois desses comandos a skill se fecha sozinha). Também troca de receita por voz: aumentar, diminuir, escolher o nível e perguntar qual está em uso.

## Como funciona

1. "Alexa, abrir controle máquina" (ou dizer "ligar" dentro da skill): a Alexa pergunta com qual pré-definição ligar.
2. Você responde "50 gramas", "100 gramas", "150 gramas" ou "200 gramas". O servidor aplica a receita correspondente (esteira, motores e temperaturas), liga os dois aquecimentos e a skill fecha.
3. "emergência" aciona a Parada de Emergência e também fecha a skill.

As pré-definições vêm da tela **Receitas** do site. Se você mudar os gramas de um nível por lá, a Alexa passa a aceitar o novo valor.

Depois de uma emergência, destrave a Parada de Emergência no site antes de ligar de novo.

## Receitas por voz

Dentro da skill (depois de "abrir controle máquina"):

| Você diz | O que acontece |
|---|---|
| "aumente a receita" | Sobe um nível: 50 → 100 → 150 → 200 g, aplicando velocidades e temperaturas do nível. |
| "diminua a receita" | Desce um nível. |
| "aplique a receita de 100 gramas" (ou "mude a receita para cento e cinquenta gramas") | Escolhe o nível. |
| "qual a receita atual" | Diz o nível e o que ele aplica. |

- No limite ela avisa ("Já está na maior receita, de 200 gramas") e não manda nada. Receita que não existe ("75 gramas") recebe a lista das que existem.
- As receitas são as da tela **Receitas**: se você mudar lá, a Alexa acompanha.
- **Emergência ativa:** a Alexa recusa qualquer comando de movimento e diz a verdade ("A emergência está ativa e a máquina está travada...").
- A Alexa **nunca libera a emergência** ("libere a emergência" só explica que é pelo site ou pelo cartão NFC). Depois de acionar a emergência por voz, ela avisa que a máquina fica travada até um Dono ou Administrador liberar.
- Opcional: para só trocar de receita com a janela do cartão NFC aberta (cartão passado há menos de 30 s), crie a variável `ALEXA_RECEITA_EXIGE_CARTAO=1` no serviço (`sudo systemctl edit site_esteira` e, em `[Service]`, `Environment="ALEXA_RECEITA_EXIGE_CARTAO=1"`).

## Como aplicar no console da Alexa

1. Abra o [Alexa Developer Console](https://developer.amazon.com/alexa/console/ask) e entre na skill.
2. Vá em **Build > Interaction Model > JSON Editor**.
3. Apague o conteúdo e cole o arquivo [`modelo_de_interacao.json`](modelo_de_interacao.json). Se a skill já tem os 5 comandos e você só quer as receitas, cole apenas as 4 intenções novas (`AumentarIntent`, `DiminuirIntent`, `AplicarIntent` e `LiberarIntent`) dentro de `intents`.
4. Confira a linha `invocationName`. Ela precisa ser o nome que você já usa para abrir a skill (hoje o manual cita "controle máquina"). Se for outro, troque aqui antes de salvar.
5. Clique em **Save Model** e depois em **Build Model**.
6. Em **Endpoint**, o endereço continua o mesmo (`https://seu-endereco/alexa`). Não precisa mudar.
7. Em **Test**, escolha "Development" e teste: "abrir controle máquina", depois "50 gramas" e, em outra sessão, "aumente a receita", "diminua a receita", "aplique a receita de cem gramas", "qual a receita atual" e "libere a emergência" (ela deve recusar).

Os intents antigos (mudar velocidade, temperatura, perguntas e outros) não fazem parte do modelo. O código do servidor que trata esses pedidos continua no `server.js` (é ele que entende as frases de receita), mas só é chamado pelas intenções que existirem no console.
