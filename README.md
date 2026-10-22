<div align="center">

<img src="public/logo.png" alt="Dark Coders" width="110">

# Flow Pack: Sistema de Controle

Aplicação web para operar e monitorar uma máquina de embalagem Flow Pack em tempo real.

![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A5%2020.6-339933?logo=nodedotjs&logoColor=white)
![Raspberry Pi](https://img.shields.io/badge/Raspberry%20Pi-3B%2B-C51A4A?logo=raspberrypi&logoColor=white)
![MQTT](https://img.shields.io/badge/MQTT-Mosquitto-660066?logo=mqtt&logoColor=white)
![Licença](https://img.shields.io/badge/licen%C3%A7a-MIT-blue)

</div>

<p align="center">
  <img src="docs/img/dashboard.png" alt="Tela de operação do sistema" width="900">
</p>

## Visão geral

Projeto da equipe **Dark Coders** (Engenharia da Computação, FIAP) para a **Festo 2026**. O sistema roda em um Raspberry Pi, que se comunica por MQTT com os ESP32 de cada módulo da máquina e entrega uma interface web para operação, acompanhamento da produção e manutenção.

A linha de embalagem é composta por esteira, bobina de filme, dispenser, braço formador, selagem horizontal, selagem final e separador de itens. Cada módulo tem controle individual, indicador de conexão e registro de eventos.

## Funcionalidades

| Módulo | Descrição |
|---|---|
| Operação | Velocidade da esteira, temperatura das selagens, estado dos módulos e modelo 3D da máquina. |
| Painel de Controle | Motores e aquecimento de cada selagem, sentido da esteira, reinício e reset de cada placa. Tem também a seção **Separador (servo)**: estado da conexão, teste esquerda/centro/direita, ângulos, velocidade, tempo aberto e liga/desliga do servo (somente Administrador e Dono). |
| Dispenser | Seleção do grão e da quantidade (1/4, 1/2, 3/4 ou 1 volta do rotor) e acionamento da dosagem. |
| Separador | Contagem e reconhecimento de produtos por câmera, com servo que desvia cada item. Inclui treinamento por classe e calibração de fundo. |
| Visão Computacional | Zona de detecção, produtos de referência e confirmação por IA. A câmera mostra o que a IA lê, igual ao Separador: linha de contagem, caixas numeradas (amarela = acompanhando, verde = contada) e nome do produto com a confiança em %. |
| Receitas | Níveis de 50, 100, 150 e 200 g com velocidade e temperatura predefinidas. |
| Produção e Relatórios | Gráficos por hora e por dia e exportação de relatórios em PDF. |
| Dark Coders AI | Assistente com base de conhecimento local e IA online opcional. Aceita comandos por texto e por voz. |
| Alexa | Skill própria com cinco comandos: ligar com a receita de 50, 100, 150 ou 200 g e parada de emergência. |
| Logs ao Vivo | Registro em tempo real de tudo o que acontece, com usuário e origem (site, assistente ou Alexa). |
| Status do Sistema | Internet, Raspberry (temperatura, memória, alimentação) e conexão de cada dispositivo. |
| Usuários | Quatro níveis de acesso e permissão de telas por usuário. |
| Cartões NFC | Cadastro de cartões de Dono/Administrador que liberam a emergência e os botões do painel. |
| Manuais | Manuais em PDF de cada módulo e da máquina completa. |

A **Parada de Emergência** fica visível em todas as telas e também responde ao botão físico da esteira e à Alexa. Depois de acionada, **a máquina inteira fica travada** (esteira, selagens, dispenser, separador, receitas e botões MAIS/MENOS) até alguém clicar em **DESBLOQUEAR** no site. A trava vale para todos os aparelhos, continua se o servidor reiniciar, e a esteira e o servo também lembram dela se forem desligados.

**Cartão NFC e painel físico.** Um ESP32 só para o painel (leitor RC522 ou PN532, buzzer, LEDs e 3 botões) manda o número do cartão por MQTT (`nfc/leitura`) e o servidor decide (`nfc/resultado`). Só cartão de Dono ou Administrador libera a emergência; passar o cartão também libera os botões **MAIS** e **MENOS** por 30 s (cada uso renova; variável `NFC_JANELA_MS`). O botão de **EMERGÊNCIA** do painel vale sempre. Três recusas seguidas bloqueiam o leitor por 30 s. Só o Dono cadastra e apaga cartões, na tela **Cartões NFC** (`/nfc`, Dono e Administrador); a tela mostra só o final de 4 dígitos. Desbloquear a emergência pelo site agora também exige Dono ou Administrador. Firmwares em [`firmware/`](firmware) e guia de montagem em [`docs/hardware/guia_painel_nfc.txt`](docs/hardware/guia_painel_nfc.txt). O número do cartão pode ser copiado por cartões "mágicos": serve para o projeto, não é segurança forte.

A página pública [`/sobre`](views/sobre.html) (acessível sem login, pelo link "Sobre nós" da tela de login) tem menu fixo com as seções quem somos, o projeto (com galeria), a equipe (cartões com contatos), a jornada e o contato; a ordem e a visibilidade das seções e das pessoas vêm dos dados. O texto original fica em [`data/sobre.json`](data/sobre.json) e traz a versão, a ordem das seções, os integrantes (cada um com `mostrarContatos` e `visivel`, e os links como caixinhas com tipo, nome e endereço) e a jornada. As alterações salvas ficam em `data/sobre_editado.json` (fora do git, para o `git pull` nunca dar conflito), as fotos em `public/img/equipe/` e `public/img/projeto/`, e os 10 últimos backups em `data/sobre_backups/`. Para voltar a uma versão antiga na mão, copie um backup por cima de `data/sobre_editado.json` e reinicie o site. Os ícones dos links são SVG locais (`sobre_icones.json`) e todo texto é escapado na saída.

<p align="center">
  <img src="docs/img/painel-controle.png" alt="Painel de Controle" width="440">
  <img src="docs/img/dispenser.png" alt="Dispenser" width="440">
</p>
<p align="center">
  <img src="docs/img/producao.png" alt="Produção" width="440">
  <img src="docs/img/relatorios.png" alt="Relatórios" width="440">
</p>
<p align="center">
  <img src="docs/img/chat.png" alt="Dark Coders AI" width="440">
  <img src="docs/img/status-sistema.png" alt="Status do Sistema" width="440">
</p>

### Modelo 3D

A máquina pode ser visualizada em 3D no próprio site (Dashboard e tela Modelo 3D), com rotação, zoom e modo estrutura. O visualizador usa Three.js com os arquivos servidos localmente, então funciona sem internet. O modelo fica em [`public/modelo/maquina.glb`](public/modelo); para trocá-lo, basta substituir o arquivo.

<p align="center">
  <img src="docs/img/modelo-3d.gif" alt="Modelo 3D da máquina girando" width="720">
</p>

## Arquitetura

<p align="center">
  <img src="docs/img/arquitetura.svg" alt="Diagrama de arquitetura" width="900">
</p>

- **Back-end:** Node.js, Express 5, Socket.IO e Nunjucks.
- **Front-end:** HTML e JavaScript, Tailwind CSS, Chart.js, jsPDF e Three.js, todos servidos localmente.
- **Mensageria:** MQTT, com o broker Mosquitto no próprio Raspberry.
- **Persistência:** arquivos JSON e a pasta `logs/`. Não há banco de dados, o que mantém o consumo baixo para o Raspberry Pi 3B+.
- **IA:** busca por similaridade na base local (`knowledge/`) e, opcionalmente, modelos da NVIDIA para o chat e a visão.

### Tópicos MQTT

| Módulo | Tópicos |
|---|---|
| Esteira | `esteira/velocidade/set`, `esteira/velocidade/atual`, `esteira/sentido/set`, `esteira/sentido/atual`, `esteira/status`, `esteira/emergencia` |
| Selagem 1 | `selagem/set_temperatura`, `selagem/ativar`, `selagem/dados`, `selagem/status_conexao`, `selagem/emergencia`, `selagem/motores/status` |
| Selagem 2 | `selagem2/set_temperatura`, `selagem2/ativar`, `selagem2/dados`, `selagem2/status_conexao`, `selagem2/emergencia`, `selagem2/motor/status` |
| Dispenser | `dispenser/dosar`, `dispenser/estado`, `dispenser/concluido`, `dispenser/status`, `dispenser/reiniciar`, `dispenser/emergencia` |
| Separador | `separador/desviar`, `separador/config`, `separador/estado`, `separador/status`, `separador/teste`, `separador/emergencia` |

## Instalação

### Requisitos

- Node.js 20.6 ou superior
- Broker MQTT acessível (por exemplo, Mosquitto)
- ESP32 dos módulos (opcional para apenas visualizar a interface)

### Passos

```bash
git clone https://github.com/brunoosz/Festo2026.git
cd Festo2026
npm install
cp .env.example .env
npm start
```

A aplicação fica disponível em `http://localhost:5000`. A porta está definida no início do [`server.js`](server.js) e o endereço do broker pode ser trocado pela variável `MQTT_BROKER`.

Na primeira execução, caso não exista `usuarios.json`, é criado o usuário `admin` com senha `admin`. **Altere a senha em Configuração antes de qualquer uso real.**

### Testando no seu computador (preview)

Não precisa do Raspberry nem das placas. Em dois terminais:

```bash
npm install
npm run mock   # broker MQTT de mentira com placas falsas (inclui o servo do separador)
npm run dev    # o site, em http://localhost:5000
```

O `dev` usa a pasta `data-teste/` (nada do `usuarios.json` real é tocado) e cria os logins `dono`, `adm`, `operario` e `visualizador`, todos com a senha `1234`. Para rodar os testes automáticos: `npm test`.

### Variáveis de ambiente

| Variável | Descrição | Obrigatória |
|---|---|---|
| `NVIDIA_API_KEY` | Chave da API NVIDIA para o chat e a visão por IA. Sem ela, o chat responde apenas com a base local. | Não |
| `SESSION_SECRET` | Segredo das sessões e dos cookies. Se ausente, é gerado e salvo em `.session_secret`. | Não |
| `MQTT_BROKER` | Endereço do broker MQTT. Padrão: `mqtt://192.168.4.1`. | Não |
| `PORT` | Porta do site. Padrão: `5000`. | Não |

Para que o Node leia o `.env` automaticamente, use `npm run start:env`.

## Implantação no Raspberry Pi

### Atualização

O script [`atualizar.sh`](atualizar.sh) baixa a versão mais recente do GitHub preservando os dados da máquina: `usuarios.json`, receitas, fotos de referência, configurações, `.env` e logs. Em seguida instala as dependências e reinicia o serviço (pm2 ou systemd).

```bash
cd ~/site_esteira && git fetch origin main && git checkout origin/main -- atualizar.sh && bash atualizar.sh
```

Antes de qualquer alteração, uma cópia dos dados é salva em `../festo2026_backup/`. Para atualizar a partir de outra branch, informe o nome: `bash atualizar.sh nome-da-branch`.

### Acesso externo com Tailscale Funnel

O sistema pode ser acessado fora da rede local por meio do [Tailscale Funnel](https://tailscale.com/kb/1223/funnel), que publica a porta do servidor em um endereço HTTPS:

```bash
sudo tailscale funnel --bg 5000
```

Como a tela de login passa a ficar pública, o servidor aplica as seguintes proteções:

- cookie de "lembrar de mim" assinado, que não pode ser forjado;
- segredo de sessão fora do código-fonte;
- bloqueio por 15 minutos após 8 tentativas de login incorretas a partir do mesmo IP.
- o canal em tempo real (socket) só aceita quem fez login.

Recomendações adicionais estão em [SECURITY.md](SECURITY.md).

## Usuários e permissões

| Nível | Permissões |
|---|---|
| Dono | Acesso total, incluindo promover e apagar usuários. |
| Administrador | Controla a máquina, cria usuários e altera senhas dos níveis abaixo do seu. |
| Operário | Acessa apenas as telas liberadas pelo Dono ou pelo Administrador. |
| Visualizador | Só olha: acompanha em tempo real as telas liberadas e conversa com a IA, mas não controla nada. |

O **Visualizador** é pensado para quem só precisa acompanhar a máquina (professores, visitantes). Ele vê todas as telas em modo somente leitura, inclusive Painel de Controle, Status do Sistema, Usuários e Cartões NFC (as telas sensíveis mostram os dados ocultos: sem o final dos cartões, sem linhas de log da rede e só nome e perfil dos usuários). Não aciona velocidade, temperatura, receitas, dosagem, servo, ajustes da visão nem a emergência (o botão fica escondido e aparece só um aviso "Máquina travada" quando há emergência), e não cria nem altera usuários. A IA responde perguntas para ele, mas não executa comandos. Só o Dono cria Visualizadores e escolhe, em **Usuários → Telas**, quais das 12 telas cada um enxerga (por padrão todas). O tutorial começa sozinho em **todo** login do Visualizador (pular vale só para aquela sessão). O bloqueio é feito no servidor (HTTP e socket), não só escondendo botões, e as tentativas bloqueadas ficam nos Logs.

**Tutorial:** o roteiro do tour guiado fica em [`public/js/tutorial-roteiro.js`](public/js/tutorial-roteiro.js) (um passo por item, com a tela, o destaque e o perfil que o vê). Para os demais perfis ele abre na primeira vez, e **Rever tutorial** fica em Configurações e no Chat. A IA usa os textos da pasta `knowledge/` (recarregados sozinhos ao salvar) e conhece o estado ao vivo: emergência, leitor NFC, janela dos botões MAIS/MENOS, receita atual e servo.

Em **Usuários**, o Dono ou o Administrador define, para cada Operário, quais telas ficam disponíveis: Dispenser, Separador, Receitas, Produção, Relatórios, Visão Computacional, Dark Coders AI e Logs. Por padrão, o Operário acessa todas, exceto Receitas. Dashboard e Configuração estão sempre liberados. A restrição é aplicada no menu e no servidor, portanto o acesso direto pela URL também é bloqueado.

<p align="center">
  <img src="docs/img/login.png" alt="Tela de login" width="440">
  <img src="docs/img/usuarios.png" alt="Gerenciamento de usuários" width="440">
</p>

## Integração com a Alexa

A skill tem cinco comandos. Depois de cada um ela se fecha sozinha, então é preciso abrir de novo para dar outro.

| Você diz | O que acontece |
|---|---|
| "Alexa, abrir controle máquina" (ou "ligar") | A Alexa pergunta com qual pré-definição ligar. |
| "50 gramas" | Aplica a receita de 50 g, liga a esteira, os motores e os dois aquecimentos, e fecha a skill. |
| "100 gramas" | Igual, com a receita de 100 g. |
| "150 gramas" | Igual, com a receita de 150 g. |
| "200 gramas" | Igual, com a receita de 200 g. |
| "emergência" | Aciona a Parada de Emergência em todos os módulos e fecha a skill. |

Se a máquina estiver travada por uma emergência, a Alexa avisa e não liga nada. As pré-definições são as receitas da tela **Receitas**, então os valores de cada uma (velocidade, motores e temperaturas) são os que estiverem cadastrados lá.

Os pedidos chegam em `POST /alexa`. Antes de executar qualquer comando, o servidor valida a assinatura e o certificado da Amazon e confere o ID da skill. O endereço precisa ser público e usar HTTPS, o que o Tailscale Funnel atende.

O modelo de interação da skill está em [`alexa/modelo_de_interacao.json`](alexa/modelo_de_interacao.json). Para aplicar no console da Alexa, siga o [`alexa/LEIA-ME.md`](alexa/LEIA-ME.md).

## Estrutura do repositório

```
.
├── server.js              Servidor: rotas, MQTT, Socket.IO, Alexa e IA
├── separador_engine.js    Contagem e desvio de produtos do separador
├── atualizar.sh           Atualização do Raspberry Pi
├── alexa/                 Modelo de interação da skill da Alexa
├── firmware/              Códigos dos ESP32 (Arduino IDE)
├── tools/                 Preview local, testes automáticos e instaladores antigos
├── data/                  Textos editáveis do site (página Sobre nós)
├── views/                 Telas (templates Nunjucks)
├── public/                Arquivos estáticos, bibliotecas e modelo 3D
├── knowledge/             Base de conhecimento do assistente
├── manuais/               Manuais em PDF
├── docs/img/              Imagens usadas neste README
├── docs/hardware/         Pinagens de cada placa e bibliotecas do Arduino
├── dispenser_config.json  Configuração do dispenser
├── config_visao.json      Configuração da câmera e da visão
└── .env.example           Modelo de variáveis de ambiente
```

## Manuais

Os manuais em PDF ficam em [`manuais/`](manuais) e também podem ser baixados pelo botão **Manuais** do próprio sistema.

| Documento | Arquivo |
|---|---|
| Máquina completa | [`Manual_Maquina_FlowPack.pdf`](manuais/Manual_Maquina_FlowPack.pdf) |
| Esteira | [`Manual_Esteira_FlowPack.pdf`](manuais/Manual_Esteira_FlowPack.pdf) |
| Dispenser | [`Manual_Dispenser_FlowPack.pdf`](manuais/Manual_Dispenser_FlowPack.pdf) |
| Braço formador | [`Manual_BracoFormador_FlowPack.pdf`](manuais/Manual_BracoFormador_FlowPack.pdf) |
| Selagem 1 | [`Manual_Selagem1_FlowPack.pdf`](manuais/Manual_Selagem1_FlowPack.pdf) |
| Selagem 2 | [`Manual_Selagem2_FlowPack.pdf`](manuais/Manual_Selagem2_FlowPack.pdf) |
| Cartão NFC e acesso | [`Manual_NFC_FlowPack.pdf`](manuais/Manual_NFC_FlowPack.pdf) |
| Botões e painel | [`Manual_Botoes_Painel_FlowPack.pdf`](manuais/Manual_Botoes_Painel_FlowPack.pdf) |

Já está cadastrado, esperando o PDF (aparece "PDF ainda não adicionado" até o arquivo existir): `Manual_Alexa_FlowPack.pdf`.

**Como adicionar um manual:** copie o PDF para a pasta `manuais/` com o nome exato acima. Ele passa a abrir sozinho, sem reiniciar o site (a existência do arquivo é conferida a cada acesso).
Para um manual novo, acrescente uma linha na lista `LISTA_MANUAIS` do `server.js` (id, título, arquivo e descrição).

## Contribuição

Consulte [CONTRIBUTING.md](CONTRIBUTING.md) antes de abrir um pull request.

## Licença

Distribuído sob a licença MIT. Consulte o arquivo [LICENSE](LICENSE).
