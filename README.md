<div align="center">

<img src="public/logo.png" alt="Dark Coders" width="140" />

# Festo 2026 — Sistema de Controle Flow Pack

**Plataforma web industrial para operar, monitorar e analisar uma máquina de embalagem Flow Pack em tempo real.**

![Node.js](https://img.shields.io/badge/Node.js-Express_5-339933?logo=nodedotjs&logoColor=white)
![MQTT](https://img.shields.io/badge/MQTT-ESP32-660066?logo=mqtt&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-tempo_real-010101?logo=socketdotio&logoColor=white)
![Raspberry Pi](https://img.shields.io/badge/Raspberry_Pi-3B+-C51A4A?logo=raspberrypi&logoColor=white)
![Licença](https://img.shields.io/badge/licen%C3%A7a-MIT-blue)

Desenvolvido pela equipe **Dark Coders** para a **Festo 2026**.

</div>

---

## Sobre o projeto

A Flow Pack é uma máquina que embala produtos em filme plástico em cinco estágios: **esteira → bobina de filme → dispenser → selagem horizontal → selagem vertical e corte**.

Este sistema roda em um **Raspberry Pi** e se comunica via **MQTT** com os **ESP32** de cada módulo da máquina. Pelo navegador, o operador controla velocidade, temperatura e dosagem, acompanha gráficos e relatórios de produção, usa visão computacional para contar e identificar produtos e até comanda a máquina por voz com a **Alexa**.

## Funcionalidades

| Módulo | O que faz |
|---|---|
| **Dashboard** | Visão geral em tempo real: velocidade, temperatura, status dos ESP32 e produção |
| **Controle** | Velocidade da esteira e dos motores, temperatura das duas selagens, parada de emergência |
| **Dispenser** | Dosagem por reservatório (gramas por dose, PWM, tempos) |
| **Separador** | Desvio automático de produtos com servo, treinamento por classe e calibração de fundo |
| **Visão computacional** | Câmera ESP32-CAM com detecção por zona e identificação de produto por IA |
| **Receitas** | Presets de velocidade e temperatura aplicáveis com um clique |
| **Gráficos e Relatórios** | Histórico de produção por dia, exportação em PDF |
| **Modelo 3D** | Visualização interativa da máquina (Three.js) |
| **Chat Dark Coders AI** | Assistente técnico com base de conhecimento local e IA online opcional (NVIDIA) |
| **Alexa** | Skill de voz para comandos (velocidade, temperatura, emergência) e perguntas |
| **Usuários e permissões** | 3 níveis: Dono, Administrador e Operário, com senhas protegidas por scrypt |
| **Logs** | Registro de todas as ações, inclusive as feitas por voz |
| **Manuais** | PDFs de cada módulo da máquina em [`manuais/`](manuais) |

## Arquitetura

```
┌──────────────┐   HTTP / WebSocket   ┌─────────────────────────┐    MQTT     ┌────────────────┐
│  Navegador   │ ◄──────────────────► │  Raspberry Pi           │ ◄─────────► │  ESP32 (esteira,│
│  (operador)  │                      │  Node.js + Express      │  broker     │  selagem, dispe-│
└──────────────┘                      │  Socket.IO + Nunjucks   │  Mosquitto  │  nser, separador)│
┌──────────────┐   HTTPS (webhook)    │                         │             └────────────────┘
│  Alexa Skill │ ◄──────────────────► │  /alexa                 │   HTTP      ┌────────────────┐
└──────────────┘                      │                         │ ◄─────────► │  ESP32-CAM      │
                                      └─────────────────────────┘             └────────────────┘
```

- **Back-end:** Node.js, Express 5, Socket.IO, Nunjucks, sessões com `express-session`
- **Front-end:** HTML, JavaScript e Tailwind CSS, Chart.js, jsPDF, Three.js
- **Comunicação com hardware:** MQTT (broker no próprio Raspberry Pi)
- **Persistência:** arquivos JSON em disco (sem banco de dados externo, ideal para o Pi 3B+)
- **IA:** busca por similaridade em base local (`knowledge/`) e, opcionalmente, modelos NVIDIA

## Estrutura do repositório

```
.
├── server.js               # Servidor: rotas, MQTT, Socket.IO, Alexa, IA
├── separador_engine.js     # Lógica do separador de produtos
├── views/                  # Páginas (templates Nunjucks)
├── public/                 # Arquivos estáticos (JS, imagens, modelo 3D)
├── knowledge/              # Base de conhecimento do chat (JSON)
├── manuais/                # Manuais em PDF de cada módulo
├── dispenser_config.json   # Configuração do dispenser
├── config_visao.json       # Configuração da câmera / visão
├── .env.example            # Modelo de variáveis de ambiente
└── package.json
```

## Como executar

### Pré-requisitos

- [Node.js](https://nodejs.org) 20.6 ou superior
- Um broker MQTT (ex.: [Mosquitto](https://mosquitto.org)) acessível na rede
- ESP32 dos módulos da máquina (opcional para apenas ver a interface)

### Instalação

```bash
git clone https://github.com/brunoosz/Festo2026.git
cd Festo2026
npm install
```

### Configuração

Copie o modelo de variáveis de ambiente e preencha o que precisar:

```bash
cp .env.example .env
```

| Variável | Descrição | Obrigatória |
|---|---|---|
| `NVIDIA_API_KEY` | Chave da API NVIDIA para o chat e a visão por IA. Sem ela, o sistema usa só a base local | Não |

> O endereço do broker MQTT (`mqtt://192.168.4.1`) e a porta do servidor (`5000`) estão definidos no início de [`server.js`](server.js). Altere conforme a sua rede.

### Iniciando

```bash
npm start          # sem variáveis de ambiente
npm run start:env  # carrega as variáveis do arquivo .env
```

Acesse **http://localhost:5000** (ou o IP do Raspberry Pi na rede local).

Na primeira execução, se não existir `usuarios.json`, é criado o usuário **`admin`** com senha **`admin`**. **Troque a senha imediatamente** em Configurações.

## Níveis de acesso

| Nível | Papel | Pode |
|---|---|---|
| 1 | **Dono** | Tudo, incluindo promover/remover usuários |
| 2 | **Administrador** | Controlar a máquina, criar usuários e alterar senhas |
| 3 | **Operário** | Telas liberadas pelo Dono/Administrador (veja abaixo) |

### Telas por usuário

Para cada **Operário**, o Dono ou o Administrador escolhe quais telas ele acessa em **Usuários → Telas**: Dispenser, Separador, Receitas, Produção, Relatórios, Visão Computacional, Dark Coders AI e Logs. Por padrão, o Operário vê tudo, **exceto Receitas**. O Dashboard e a Configuração ficam sempre liberados. O bloqueio vale no menu e também no servidor, então o acesso direto pela URL é negado.

## Integração com a Alexa

A skill **Dark Coders** envia pedidos para `POST /alexa`. O servidor valida a assinatura e o certificado da Amazon e confere o ID da skill antes de executar qualquer comando. O endpoint precisa estar acessível por HTTPS público (ex.: via túnel).

## Segurança

- Senhas armazenadas com **scrypt + salt** único por usuário
- Rotas protegidas por login e por nível de permissão
- Webhook da Alexa com verificação de certificado e assinatura

Recomendações para uso real em produção estão em [SECURITY.md](SECURITY.md).

## Contribuindo

Veja [CONTRIBUTING.md](CONTRIBUTING.md).

## Equipe

**Dark Coders** — Festo 2026

## Licença

Distribuído sob a licença MIT. Veja [LICENSE](LICENSE).

