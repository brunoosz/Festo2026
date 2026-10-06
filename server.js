const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mqtt = require('mqtt');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const nunjucks = require('nunjucks');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Jimp = require('jimp');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const pastaLogs = path.join(__dirname, 'logs');
if (!fs.existsSync(pastaLogs)) fs.mkdirSync(pastaLogs);

const arquivoProducao = path.join(pastaLogs, 'historico_producao.json');
if (!fs.existsSync(arquivoProducao)) {
    fs.writeFileSync(arquivoProducao, JSON.stringify({}));
}

const pastaProducaoDiaria = path.join(pastaLogs, 'producao_diaria');
if (!fs.existsSync(pastaProducaoDiaria)) fs.mkdirSync(pastaProducaoDiaria);

const pastaKnowledge = path.join(__dirname, 'knowledge');
if (!fs.existsSync(pastaKnowledge)) {
    fs.mkdirSync(pastaKnowledge);
    const baseDefault = [{ id: 1, pergunta: "O que é este sistema?", resposta: "O Flow Pack é controlado pelo sistema Dark Coders via um Raspberry Pi conectado a um ESP32." }];
    fs.writeFileSync(path.join(pastaKnowledge, 'sistema.json'), JSON.stringify(baseDefault, null, 2));
}

// ================================================================================
// SISTEMA DE USUÁRIOS — 3 NÍVEIS: Dono (1) > Administrador (2) > Operário (3)
// ================================================================================

const NIVEL_DONO = 1;
const NIVEL_ADM = 2;
const NIVEL_OPERARIO = 3;

function nomeNivel(nivel) {
    if (nivel === NIVEL_DONO) return 'Dono';
    if (nivel === NIVEL_ADM) return 'Administrador';
    return 'Operário';
}

function nivelValido(nivel) {
    return nivel === NIVEL_DONO || nivel === NIVEL_ADM || nivel === NIVEL_OPERARIO;
}

// Telas que o Dono/Administrador pode liberar ou bloquear por usuário Operário.
// (Dono e Administrador sempre acessam todas. Dashboard e Configuração são
// sempre liberados, assim todo usuário tem pelo menos uma tela inicial.)
const PAGINAS_CONFIGURAVEIS = {
    dispenser: 'Dispenser',
    separador: 'Separador',
    receitas: 'Receitas',
    graficos: 'Produção',
    relatorios: 'Relatórios',
    visao: 'Visão Computacional',
    chat: 'Dark Coders AI',
    logs: 'Logs ao Vivo'
};

// Padrão de um Operário que ainda não teve permissões personalizadas.
const PERMISSOES_PADRAO_OPERARIO = {
    dispenser: true, separador: true, receitas: false, graficos: true,
    relatorios: true, visao: true, chat: true, logs: true
};

function permissoesEfetivas(usuario) {
    const efetivas = {};
    const ehOperario = usuario.nivel === NIVEL_OPERARIO;
    Object.keys(PAGINAS_CONFIGURAVEIS).forEach(pagina => {
        if (!ehOperario) { efetivas[pagina] = true; return; }
        const salva = usuario.permissoes && typeof usuario.permissoes[pagina] === 'boolean'
            ? usuario.permissoes[pagina] : PERMISSOES_PADRAO_OPERARIO[pagina];
        efetivas[pagina] = salva;
    });
    return efetivas;
}

const arquivoUsuarios = path.join(__dirname, 'usuarios.json');

function gerarHashSenha(senha) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(senha, salt, 64).toString('hex');
    return { salt, hash };
}

function verificarSenha(senha, salt, hashSalvo) {
    const hashTentativa = crypto.scryptSync(senha, salt, 64).toString('hex');
    const bufA = Buffer.from(hashTentativa, 'hex');
    const bufB = Buffer.from(hashSalvo, 'hex');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

function salvarUsuarios(usuarios) {
    fs.writeFileSync(arquivoUsuarios, JSON.stringify(usuarios, null, 2));
}

function encontrarChaveUsuarioIgnorandoCase(usuarios, nomeDigitado) {
    if (!nomeDigitado) return null;
    const alvo = nomeDigitado.toLowerCase();
    return Object.keys(usuarios).find(chave => chave.toLowerCase() === alvo) || null;
}

function carregarUsuarios() {
    let usuarios = {};
    try {
        usuarios = JSON.parse(fs.readFileSync(arquivoUsuarios, 'utf-8'));
    } catch (e) {
        return {};
    }

    let precisaMigrar = false;

    Object.keys(usuarios).forEach(chave => {
        const usuario = usuarios[chave];
        if (typeof usuario.nivel !== 'number' || !nivelValido(usuario.nivel)) {
            usuario.nivel = usuario.admin ? NIVEL_DONO : NIVEL_OPERARIO;
            delete usuario.admin;
            precisaMigrar = true;
        }
        // Usuários que já existiam antes dessa funcionalidade não são
        // forçados a ver o tutorial — só quem for criado daqui pra frente.
        if (typeof usuario.tutorialVisto !== 'boolean') {
            usuario.tutorialVisto = true;
            precisaMigrar = true;
        }
    });

    if (precisaMigrar) {
        salvarUsuarios(usuarios);
        console.log('🔄 Usuários migrados (níveis / tutorialVisto).');
    }

    return usuarios;
}

if (!fs.existsSync(arquivoUsuarios)) {
    const { salt, hash } = gerarHashSenha('admin');
    const usuariosPadrao = {
        admin: { salt, hash, nivel: NIVEL_DONO, acessibilidade: false, tutorialVisto: true }
    };
    salvarUsuarios(usuariosPadrao);
}

// ================================================================================
// BASE DE CONHECIMENTO
// ================================================================================

const STOPWORDS = new Set([
    'o','a','os','as','um','uma','uns','umas','de','da','do','das','dos','em','no','na','nos','nas',
    'que','qual','quais','como','por','pra','para','com','sem','e','ou','se','ao','aos',
    'meu','minha','meus','minhas','seu','sua','seus','suas','esse','essa','esses','essas','este','esta',
    'estes','estas','isso','isto','aquilo','aquele','aquela','aqui','ali','sobre','tem','ser',
    'estar','vai','vou','pode','poderia','gostaria','queria','quero','saber','me','eu','voce','você','tu','e'
]);

const SINONIMOS = {
    'rapido': 'veloz', 'rapida': 'veloz', 'ligeiro': 'veloz', 'veloz': 'veloz',
    'devagar': 'lento', 'vagaroso': 'lento', 'lento': 'lento', 'lenta': 'lento',
    'ligar': 'iniciar', 'acionar': 'iniciar', 'comecar': 'iniciar', 'iniciar': 'iniciar',
    'desligar': 'parar', 'travar': 'parar', 'interromper': 'parar', 'parar': 'parar', 'pausar': 'parar',
    'quebrado': 'defeito', 'estragado': 'defeito', 'com problema': 'defeito', 'falha': 'defeito', 'erro': 'defeito',
    'senha': 'senha', 'password': 'senha',
    'esqueci': 'esqueceu', 'perdi': 'esqueceu',
    'celular': 'smartphone', 'telefone': 'smartphone', 'smartphone': 'smartphone',
    'notebook': 'computador', 'pc': 'computador', 'laptop': 'computador', 'computador': 'computador',
    'grafico': 'grafico', 'gráfico': 'grafico',
    'perigoso': 'risco', 'perigo': 'risco', 'inseguro': 'risco',
    'app': 'sistema', 'aplicativo': 'sistema', 'programa': 'sistema', 'painel': 'sistema', 'site': 'sistema',
    'maquina': 'maquina', 'máquina': 'maquina', 'equipamento': 'maquina',
    'esteira': 'esteira', 'correia': 'esteira',
    'admin': 'administrador', 'adm': 'administrador', 'administrador': 'administrador',
    'selar': 'selagem', 'sela': 'selagem', 'sola': 'selagem',
    'cortar': 'corte', 'corta': 'corte',
    'bobina': 'bobina', 'plastico': 'plastico', 'plástico': 'plastico',
    'dispensador': 'dispenser', 'dosador': 'dispenser'
};

function normalizarTexto(texto) {
    return texto
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function extrairTokens(texto) {
    return normalizarTexto(texto)
        .split(' ')
        .filter(palavra => palavra.length >= 2 && !STOPWORDS.has(palavra))
        .map(palavra => SINONIMOS[palavra] || palavra)
        .map(palavra => palavra.slice(0, 5));
}

function calcularSimilaridade(tokensA, tokensB) {
    if (tokensA.length === 0 || tokensB.length === 0) return { score: 0, interseccao: 0 };
    const setA = new Set(tokensA);
    const setB = new Set(tokensB);
    let interseccao = 0;
    setA.forEach(token => { if (setB.has(token)) interseccao++; });
    const score = (2 * interseccao) / (setA.size + setB.size);
    return { score, interseccao };
}

let baseConhecimento = [];

function carregarBaseConhecimento() {
    baseConhecimento = [];
    const arquivos = fs.readdirSync(pastaKnowledge).filter(file => file.endsWith('.json'));

    arquivos.forEach(file => {
        try {
            const conteudo = JSON.parse(fs.readFileSync(path.join(pastaKnowledge, file), 'utf8'));
            conteudo.forEach(item => {
                const todasPerguntas = [item.pergunta, ...(item.perguntas_alternativas || [])];
                todasPerguntas.forEach(pergunta => {
                    baseConhecimento.push({
                        resposta: item.resposta,
                        perguntaOriginal: item.pergunta,
                        tokens: extrairTokens(pergunta)
                    });
                });
            });
        } catch (erro) {
            console.error(`❌ Erro ao carregar ${file}:`, erro.message);
        }
    });

    console.log(`🧠 Base de conhecimento carregada: ${baseConhecimento.length} variações (de ${arquivos.length} arquivos).`);
}
carregarBaseConhecimento();

fs.watch(pastaKnowledge, { persistent: true }, (eventType, filename) => {
    if (filename && filename.endsWith('.json')) {
        setTimeout(carregarBaseConhecimento, 300);
    }
});

const LIMIAR_MINIMO_CONFIANCA = 0.30;
const MINIMO_PALAVRAS_EM_COMUM = 2;

const ABERTURAS_HUMANIZADAS = [
    '', '', 'Boa pergunta! ', 'Show, deixa eu te explicar: ', 'Claro! ', 'Sobre isso: ', 'Consigo te ajudar com isso: '
];

const RESPOSTAS_NAO_SEI = [
    "Desculpe, ainda não tenho essa informação. Você pode pedir coisas como mudar a velocidade, mudar a temperatura, ou baixar o relatório.",
    "Hmm, essa eu não sei responder. Mas posso mudar a velocidade da esteira, a temperatura das selagens, ou te levar pra outra tela, é só pedir.",
    "Ainda não sei responder isso especificamente. Tenta pedir um comando, tipo: mude a velocidade para 50%.",
    "Não encontrei nada parecido na minha base. Posso executar comandos do site, como mudar temperatura ou mostrar os logs, se quiser."
];

function sortear(lista) {
    return lista[Math.floor(Math.random() * lista.length)];
}

function humanizarResposta(respostaOriginal) {
    return sortear(ABERTURAS_HUMANIZADAS) + respostaOriginal;
}

function buscarMelhorRespostaLocal(pergunta) {
    const tokensPergunta = extrairTokens(pergunta);
    let melhorScore = 0;
    let melhorInterseccao = 0;
    let melhorItem = null;

    baseConhecimento.forEach(item => {
        const { score, interseccao } = calcularSimilaridade(tokensPergunta, item.tokens);
        if (score > melhorScore) {
            melhorScore = score;
            melhorInterseccao = interseccao;
            melhorItem = item;
        }
    });

    if (melhorItem && melhorScore >= LIMIAR_MINIMO_CONFIANCA && melhorInterseccao >= MINIMO_PALAVRAS_EM_COMUM) {
        return humanizarResposta(melhorItem.resposta);
    }
    return sortear(RESPOSTAS_NAO_SEI);
}

function montarContextoRAG(pergunta, maxItens = 4) {
    const tokensPergunta = extrairTokens(pergunta);
    const melhoresPorPergunta = new Map();

    baseConhecimento.forEach(item => {
        const { score } = calcularSimilaridade(tokensPergunta, item.tokens);
        const atual = melhoresPorPergunta.get(item.perguntaOriginal);
        if (!atual || score > atual.score) {
            melhoresPorPergunta.set(item.perguntaOriginal, {
                score, pergunta: item.perguntaOriginal, resposta: item.resposta
            });
        }
    });

    const ordenado = [...melhoresPorPergunta.values()]
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxItens);

    if (ordenado.length === 0) {
        return "Nenhuma informação específica foi encontrada na base de conhecimento para esta pergunta.";
    }

    return ordenado.map(item => `- ${item.pergunta}: ${item.resposta}`).join('\n');
}

// ================================================================================
// IA ONLINE (TEXTO) — NVIDIA API, com auto-descoberta de modelos + fallback local
// ================================================================================

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || '';

const NVIDIA_MODELOS_CURADOS = [
    'nvidia/nemotron-3.5-lightning-30b-a3b',
    'deepseek-ai/deepseek-v4-flash-0731',
    'nvidia/nemotron-3-ultra-550b-a55b',
    'moonshotai/kimi-k3'
];

const PALAVRAS_EXCLUIR_MODELO = [
    'embed', 'tts', 'ocr', 'vsr', 'translate', 'safety', 'calibration', 'relighting',
    'retriever', 'cosmos', 'image', 'video', 'speech', 'riva', 'chatterbox', 'wan2',
    'reasoning', 'reasoner', 'thinking'
];

let modelosDinamicosCache = [];
let ultimaBuscaModelosDinamicos = 0;
let ultimoModeloFuncionando = null;

async function atualizarModelosDinamicos() {
    if (!NVIDIA_API_KEY) return;

    const agora = Date.now();
    if (agora - ultimaBuscaModelosDinamicos < 60 * 60 * 1000) return;
    ultimaBuscaModelosDinamicos = agora;

    try {
        const controlador = new AbortController();
        const timeoutId = setTimeout(() => controlador.abort(), 8000);

        const resposta = await fetch('https://integrate.api.nvidia.com/v1/models', {
            headers: { 'Authorization': `Bearer ${NVIDIA_API_KEY}` },
            signal: controlador.signal
        });
        clearTimeout(timeoutId);

        if (!resposta.ok) return;

        const dados = await resposta.json();
        const ids = (dados.data || []).map(m => m.id).filter(Boolean);

        modelosDinamicosCache = ids.filter(id => {
            const idMinusculo = id.toLowerCase();
            return !PALAVRAS_EXCLUIR_MODELO.some(palavra => idMinusculo.includes(palavra));
        });

        console.log(`🔎 Descoberta automática de modelos NVIDIA: ${modelosDinamicosCache.length} candidatos de reserva encontrados.`);
    } catch (e) {
        // Descoberta automática é só um bônus de segurança — se falhar, segue com a lista curada.
    }
}

const PADROES_VAZAMENTO_RACIOCINIO = [
    /here'?s a thinking process/i,
    /let me (analyze|think|break)/i,
    /^\s*\d+\.\s*\*\*(analyze|identify|check|determine)/im,
    /<think>/i,
    /chat_template/i,
    /system prompt/i,
    /user'?s (input|question|message) is/i
];

function respostaPareceVazamentoDeRaciocinio(texto) {
    return PADROES_VAZAMENTO_RACIOCINIO.some(padrao => padrao.test(texto));
}

function removerTagsPensamento(texto) {
    const indiceFechamento = texto.lastIndexOf('</think>');
    if (indiceFechamento !== -1) {
        return texto.slice(indiceFechamento + '</think>'.length).trim();
    }
    return texto;
}

const PROMPT_SISTEMA_BASE = `Você é a Dark Coders AI, assistente da máquina Flow Pack — um projeto acadêmico da FIAP em parceria com a FESTO, criado pelo time Dark Coders (5 alunos do 1º ano de Engenharia da Computação).

SOBRE O PROJETO (use quando for relevante, sem despejar tudo de uma vez):
A Flow Pack opera em 5 estágios: (1) Esteira transporta o produto; (2) bobina de plástico fornece o filme de selagem; (3) dispenser libera o produto sobre o plástico; (4) o plástico é dobrado e selado horizontalmente; (5) selagem vertical e corte separam uma unidade da outra. O site (Node.js/Express, Raspberry Pi) controla tudo em tempo real via MQTT com os ESP32 da máquina: velocidade, temperatura, gráficos, relatórios e visão computacional.

COMO CONVERSAR (siga rigorosamente):
- Converse como uma pessoa normal conversaria — natural, direto, sem parecer um script.
- Você já se apresentou uma vez quando o usuário abriu o chat. NUNCA repita sua apresentação completa ("Sou a Dark Coders AI...", "Como assistente da Flow Pack...") nas mensagens seguintes — isso é repetitivo e chato. Trate cada mensagem como parte de uma conversa contínua.
- Se for só uma saudação ou papo leve ("oi", "tudo bem?", "beleza"), responda de forma curta e simpática, como uma pessoa responderia — sem listar o que você pode fazer, a menos que perguntem.
- Respostas normais: 1 a 3 frases. Só se estenda se a pergunta pedir detalhe técnico de verdade.
- Quando os DADOS AO VIVO DA MÁQUINA estiverem disponíveis abaixo, USE ESSES NÚMEROS DIRETAMENTE na resposta — nunca diga que não tem a informação se ela estiver ali.
- Fale sobre o projeto Flow Pack, a equipe, o site e a parceria FIAP/FESTO. Se perguntarem algo totalmente fora disso, redirecione com leveza, sem repetir sempre a mesma frase padrão.
- Responda direto, sem narrar raciocínio — só a resposta final, em português do Brasil.\n- NUNCA use markdown (sem **negrito**, sem listas com *, sem #): suas respostas são faladas em voz alta, e esses símbolos ficam estranhos quando lidos. Escreva só texto corrido.\n- NUNCA use emojis.\n- NUNCA comece se apresentando nem repetindo o que você é: vá direto ao ponto, como numa conversa normal.\n- Se não souber responder algo, ou se pedirem uma ação que você não pode fazer só conversando, diga isso em poucas palavras e sugira comandos prontos, como: mudar a velocidade, mudar a temperatura de uma selagem, baixar o relatório em PDF, ou pedir para ver os últimos logs.`;

function montarContextoAoVivo() {
    const linhas = [];

    const velNormalizada = parseFloat(ultimaVelocidadeConhecida);
    const velPct = isNaN(velNormalizada) ? null : Math.round((velNormalizada > 1 ? velNormalizada : velNormalizada * 100));
    linhas.push(`Esteira: ${esp32Online ? 'conectada' : 'desconectada'}, velocidade atual ${velPct !== null ? velPct + '%' : 'desconhecida'}.`);

    linhas.push(`Selagem 1: ${selagemOnline ? 'conectada' : 'desconectada'}, temperatura atual ${ultimoEstadoSelagem.temperatura ?? '--'}°C, alvo ${ultimoEstadoSelagem.setpoint ?? '--'}°C, ${ultimoEstadoSelagem.habilitado ? 'ativa' : 'inativa'}, segurança: ${ultimoEstadoSelagem.seguranca || 'ok'}.`);

    linhas.push(`Selagem 2: ${selagem2Online ? 'conectada' : 'desconectada'}, temperatura atual ${ultimoEstadoSelagem2.temperatura ?? '--'}°C, alvo ${ultimoEstadoSelagem2.setpoint ?? '--'}°C, ${ultimoEstadoSelagem2.habilitado ? 'ativa' : 'inativa'}, segurança: ${ultimoEstadoSelagem2.seguranca || 'ok'}.`);

    Object.values(MOTORES_SELAGEM).forEach(m => {
        const v = parseFloat(m.velocidade);
        linhas.push(`${m.nome}: velocidade ${isNaN(v) ? 'desconhecida' : Math.round(v * 100) + '%'}, sentido ${m.sentido}.`);
    });

    return linhas.join('\n');
}

async function perguntarNvidia(promptSistema, perguntaUsuario, historico = []) {
    if (!NVIDIA_API_KEY) {
        throw new Error('Chave da API NVIDIA não configurada (NVIDIA_API_KEY).');
    }

    // Atualiza a lista em segundo plano, sem travar a resposta atual
    atualizarModelosDinamicos().catch(() => {});

    const listaTentativas = [];
    if (ultimoModeloFuncionando) listaTentativas.push(ultimoModeloFuncionando);
    NVIDIA_MODELOS_CURADOS.forEach(m => { if (!listaTentativas.includes(m)) listaTentativas.push(m); });
    modelosDinamicosCache.slice(0, 3).forEach(m => { if (!listaTentativas.includes(m)) listaTentativas.push(m); });

    const mensagens = [
        { role: 'system', content: promptSistema },
        ...historico,
        { role: 'user', content: perguntaUsuario }
    ];

    const ORCAMENTO_TOTAL_MS = 25000;
    const TIMEOUT_POR_MODELO_MS = 9000;
    const inicio = Date.now();
    let ultimoErro = null;

    for (const modelo of listaTentativas) {
        const restante = ORCAMENTO_TOTAL_MS - (Date.now() - inicio);
        if (restante < 2000) break;

        const controlador = new AbortController();
        const timeoutId = setTimeout(() => controlador.abort(), Math.min(TIMEOUT_POR_MODELO_MS, restante));
        const inicioModelo = Date.now();

        try {
            const resposta = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${NVIDIA_API_KEY}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    model: modelo,
                    messages: mensagens,
                    temperature: 0.5,
                    top_p: 0.9,
                    max_tokens: 200,
                    stream: false,
                    chat_template_kwargs: { thinking: false }
                }),
                signal: controlador.signal
            });

            if (!resposta.ok) {
                clearTimeout(timeoutId);
                const corpoErro = await resposta.text().catch(() => '');
                ultimoErro = new Error(`Modelo "${modelo}" respondeu HTTP ${resposta.status}: ${corpoErro.slice(0, 120)}`);
                if (ultimoModeloFuncionando === modelo) ultimoModeloFuncionando = null;
                if (resposta.status === 401 || resposta.status === 403) break;
                continue;
            }

            const dados = await resposta.json();
            clearTimeout(timeoutId);

            let texto = dados && dados.choices && dados.choices[0] &&
                        dados.choices[0].message && dados.choices[0].message.content;

            texto = removerTagsPensamento(texto || '').trim();

            if (!texto || respostaPareceVazamentoDeRaciocinio(texto)) {
                ultimoErro = new Error(`Modelo "${modelo}" devolveu resposta vazia ou raciocínio bruto.`);
                if (ultimoModeloFuncionando === modelo) ultimoModeloFuncionando = null;
                continue;
            }

            ultimoModeloFuncionando = modelo;
            console.log(`🤖 IA respondeu via ${modelo} em ${Date.now() - inicioModelo}ms`);
            return texto;

        } catch (erro) {
            clearTimeout(timeoutId);
            ultimoErro = erro.name === 'AbortError'
                ? new Error(`Modelo "${modelo}" demorou demais, passando para o próximo.`)
                : erro;
            console.warn('⚠️ ', ultimoErro.message);
            if (ultimoModeloFuncionando === modelo) ultimoModeloFuncionando = null;
            continue;
        }
    }

    throw ultimoErro || new Error('Nenhum modelo respondeu dentro do tempo limite.');
}

console.log(NVIDIA_API_KEY
    ? `🌐 IA online (NVIDIA) configurada. Modelos de chat: ${NVIDIA_MODELOS_CURADOS.join(' → ')}. Fallback local disponível se algo falhar.`
    : '⚠️  NVIDIA_API_KEY não configurada — usando só o sistema local por enquanto.');
if (NVIDIA_API_KEY) {
    io.emit('novo_log_servidor', { hora: horaAtualCurta(), texto: 'IA online (NVIDIA) inicializada e pronta.', tipo: 'sistema' });
}

// NOVO: eco ao vivo (não salvo em disco) — aparece em /logs assim que
// alguém estiver com a tela aberta no momento em que o servidor iniciar
if (NVIDIA_API_KEY) {
    io.emit('novo_log_servidor', { hora: horaAtualCurta(), texto: 'IA online (NVIDIA) inicializada e pronta.', tipo: 'sistema' });
}

// ================================================================================
// PRODUTOS DE REFERÊNCIA — fotos que a IA de visão usa pra comparar e reconhecer
// ================================================================================

const pastaProdutosReferencia = path.join(__dirname, 'produtos_referencia');
if (!fs.existsSync(pastaProdutosReferencia)) fs.mkdirSync(pastaProdutosReferencia);

const arquivoProdutosReferencia = path.join(__dirname, 'produtos_referencia.json');
if (!fs.existsSync(arquivoProdutosReferencia)) fs.writeFileSync(arquivoProdutosReferencia, JSON.stringify([]));

let produtosReferenciaCache = [];

function carregarProdutosReferenciaEmCache() {
    let metadados = [];
    try {
        metadados = JSON.parse(fs.readFileSync(arquivoProdutosReferencia, 'utf-8'));
    } catch (e) {
        metadados = [];
    }

    produtosReferenciaCache = metadados.map(item => {
        try {
            const caminhoArquivo = path.join(pastaProdutosReferencia, `${item.id}.jpg`);
            const buffer = fs.readFileSync(caminhoArquivo);
            return { id: item.id, nome: item.nome, base64: buffer.toString('base64') };
        } catch (e) {
            return null;
        }
    }).filter(Boolean);

    console.log(`📦 Produtos de referência carregados: ${produtosReferenciaCache.length}`);
}
carregarProdutosReferenciaEmCache();

const uploadMemoria = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});

async function adicionarProdutoReferencia(nome, bufferImagemOriginal) {
    const imagem = await Jimp.read(bufferImagemOriginal);
    imagem.resize(400, Jimp.AUTO);
    const bufferComprimido = await imagem.quality(80).getBufferAsync(Jimp.MIME_JPEG);

    const id = crypto.randomBytes(6).toString('hex');
    fs.writeFileSync(path.join(pastaProdutosReferencia, `${id}.jpg`), bufferComprimido);

    let metadados = [];
    try { metadados = JSON.parse(fs.readFileSync(arquivoProdutosReferencia, 'utf-8')); } catch (e) {}
    metadados.push({ id, nome });
    fs.writeFileSync(arquivoProdutosReferencia, JSON.stringify(metadados, null, 2));

    carregarProdutosReferenciaEmCache();
    return { id, nome };
}

function removerProdutoReferencia(id) {
    let metadados = [];
    try { metadados = JSON.parse(fs.readFileSync(arquivoProdutosReferencia, 'utf-8')); } catch (e) {}

    const existia = metadados.some(item => item.id === id);
    metadados = metadados.filter(item => item.id !== id);
    fs.writeFileSync(arquivoProdutosReferencia, JSON.stringify(metadados, null, 2));

    const caminhoArquivo = path.join(pastaProdutosReferencia, `${id}.jpg`);
    if (fs.existsSync(caminhoArquivo)) fs.unlinkSync(caminhoArquivo);

    carregarProdutosReferenciaEmCache();
    return existia;
}

// ================================================================================
// IA ONLINE (VISÃO) — compara a câmera com os produtos de referência cadastrados
// ================================================================================

const NVIDIA_MODELOS_VISAO = [
    'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
    'meta/muse-glimmer-30b'
];

let ultimoModeloVisaoFuncionando = null;
let aiVisaoOcupada = false;

const PROMPT_VISAO_GENERICO = 'Esta é uma foto recortada apenas da área central de uma esteira industrial de embalagem (Flow Pack), onde os produtos passam. A imagem pode estar um pouco borrada devido ao movimento da esteira — isso é normal e esperado, não exija nitidez perfeita. Existe um produto ou pacote visivelmente presente nesta área neste exato momento (mesmo que parcialmente cortado ou borrado)? Responda em uma única palavra: SIM ou NAO. Não explique, não descreva, apenas a palavra.';

function respostaVisaoGenericaEhValida(texto) {
    const limpo = texto.trim().toUpperCase();
    return limpo.includes('SIM') || limpo.includes('NAO') || limpo.includes('NÃO');
}

function respostaVisaoComReferenciaEhValida(texto, produtos) {
    const limpo = texto.trim().toUpperCase();
    if (limpo.includes('NENHUM')) return true;
    return produtos.some(p => limpo.includes(p.nome.toUpperCase()));
}

function extrairProdutoIdentificado(texto, produtos) {
    const limpo = texto.trim().toUpperCase();
    if (limpo.includes('NENHUM')) return null;
    const encontrado = produtos.find(p => limpo.includes(p.nome.toUpperCase()));
    return encontrado ? encontrado.nome : null;
}

async function recortarZonaDeInteresse(bufferImagemOriginal) {
    try {
        const imagem = await Jimp.read(bufferImagemOriginal);
        const largura = imagem.bitmap.width;
        const altura = imagem.bitmap.height;

        const alturaFaixa = (configVisao.zonaFim - configVisao.zonaInicio) * altura;
        const margem = alturaFaixa * 0.15;

        let yInicio = Math.max(0, Math.floor(configVisao.zonaInicio * altura - margem));
        let yFim = Math.min(altura, Math.ceil(configVisao.zonaFim * altura + margem));
        let alturaCorte = yFim - yInicio;

        if (alturaCorte < 10) {
            return await imagem.quality(85).getBufferAsync(Jimp.MIME_JPEG);
        }

        imagem.crop(0, yInicio, largura, alturaCorte);
        return await imagem.quality(85).getBufferAsync(Jimp.MIME_JPEG);

    } catch (erro) {
        console.warn('⚠️  Falha ao recortar a zona de interesse, usando imagem inteira:', erro.message);
        return bufferImagemOriginal;
    }
}

async function perguntarVisaoNvidia(bufferImagemCandidata) {
    if (!NVIDIA_API_KEY) {
        throw new Error('Chave da API NVIDIA não configurada (NVIDIA_API_KEY).');
    }

    const produtos = produtosReferenciaCache;
    const usandoReferencia = produtos.length > 0;

    const dataUrlCandidato = `data:image/jpeg;base64,${bufferImagemCandidata.toString('base64')}`;

    let conteudoMensagem;

    if (usandoReferencia) {
        const nomesProdutos = produtos.map(p => p.nome).join(', ');

        conteudoMensagem = [
            { type: 'text', text: `Você vai comparar fotos de referência de produtos conhecidos com uma imagem atual de uma esteira industrial. Os produtos cadastrados são: ${nomesProdutos}.` }
        ];

        produtos.forEach(p => {
            conteudoMensagem.push({ type: 'text', text: `Foto de referência do produto "${p.nome}":` });
            conteudoMensagem.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${p.base64}` } });
        });

        conteudoMensagem.push({ type: 'text', text: 'Agora esta é a imagem ATUAL, já recortada só na região onde os produtos passam pela esteira:' });
        conteudoMensagem.push({ type: 'image_url', image_url: { url: dataUrlCandidato } });
        conteudoMensagem.push({
            type: 'text',
            text: `A imagem atual pode estar um pouco borrada ou com o objeto parcialmente cortado nas bordas, por causa do movimento da esteira — isso é normal, não exija nitidez perfeita. Compare o formato geral, cor e tamanho do objeto na imagem atual com as fotos de referência acima. Se o objeto parecer o mesmo item de algum dos produtos cadastrados (${nomesProdutos}), mesmo que parcialmente visível ou borrado, responda com APENAS o nome exato desse produto. Só responda NENHUM se a imagem atual claramente não tiver nenhum objeto na área central, ou se o objeto for visivelmente diferente de todos os produtos cadastrados. Não explique, não descreva, apenas o nome do produto ou a palavra NENHUM.`
        });
    } else {
        conteudoMensagem = [
            { type: 'text', text: PROMPT_VISAO_GENERICO },
            { type: 'image_url', image_url: { url: dataUrlCandidato } }
        ];
    }

    const listaTentativas = [];
    if (ultimoModeloVisaoFuncionando) listaTentativas.push(ultimoModeloVisaoFuncionando);
    NVIDIA_MODELOS_VISAO.forEach(m => { if (!listaTentativas.includes(m)) listaTentativas.push(m); });

    let ultimoErro = null;

    for (const modelo of listaTentativas) {
        const controlador = new AbortController();
        const timeoutId = setTimeout(() => controlador.abort(), 20000);

        try {
            const resposta = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${NVIDIA_API_KEY}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    model: modelo,
                    messages: [{ role: 'user', content: conteudoMensagem }],
                    temperature: 0.1,
                    max_tokens: 20,
                    stream: false,
                    chat_template_kwargs: { thinking: false }
                }),
                signal: controlador.signal
            });

            clearTimeout(timeoutId);

            if (!resposta.ok) {
                const corpoErro = await resposta.text().catch(() => '');

                if (resposta.status === 410 || resposta.status === 404) {
                    console.warn(`⚠️  Modelo de visão "${modelo}" indisponível, tentando o próximo...`);
                    if (ultimoModeloVisaoFuncionando === modelo) ultimoModeloVisaoFuncionando = null;
                    ultimoErro = new Error(`Modelo de visão indisponível: ${corpoErro.slice(0, 150)}`);
                    continue;
                }

                throw new Error(`NVIDIA API (visão) respondeu HTTP ${resposta.status}: ${corpoErro.slice(0, 200)}`);
            }

            const dados = await resposta.json();
            let texto = dados && dados.choices && dados.choices[0] &&
                        dados.choices[0].message && dados.choices[0].message.content;

            if (!texto) throw new Error('Resposta de visão veio vazia.');

            texto = removerTagsPensamento(texto).trim();

            const valida = usandoReferencia
                ? respostaVisaoComReferenciaEhValida(texto, produtos)
                : respostaVisaoGenericaEhValida(texto);

            if (!valida || respostaPareceVazamentoDeRaciocinio(texto)) {
                console.warn(`⚠️  Modelo de visão "${modelo}" não retornou resposta clara, tentando o próximo...`);
                if (ultimoModeloVisaoFuncionando === modelo) ultimoModeloVisaoFuncionando = null;
                ultimoErro = new Error(`Modelo de visão "${modelo}" retornou resposta inválida.`);
                continue;
            }

            ultimoModeloVisaoFuncionando = modelo;

            if (usandoReferencia) {
                const produtoIdentificado = extrairProdutoIdentificado(texto, produtos);
                return { simNao: !!produtoIdentificado, textoBruto: texto, produtoIdentificado };
            } else {
                return { simNao: texto.toUpperCase().includes('SIM'), textoBruto: texto, produtoIdentificado: null };
            }

        } catch (erro) {
            clearTimeout(timeoutId);
            if (erro.name === 'AbortError') { ultimoErro = erro; continue; }
            ultimoErro = erro;
        }
    }

    throw ultimoErro || new Error('Nenhum modelo de visão respondeu.');
}

let historicoVerificacoesIA = [];

function registrarVerificacaoIA(registro) {
    historicoVerificacoesIA.unshift(registro);
    if (historicoVerificacoesIA.length > 12) historicoVerificacoesIA.pop();
    io.emit('visao_verificacao_ia', registro);
}

function horaAtualCurta() {
    return new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function decidirContagemComIA(bufferImagemCandidata) {
    if (!configVisao.usarIaVisao || !NVIDIA_API_KEY) {
        return { confirmado: true, viaIA: false, produtoIdentificado: null };
    }

    if (aiVisaoOcupada) {
        return { confirmado: true, viaIA: false, produtoIdentificado: null };
    }

    aiVisaoOcupada = true;
    try {
        const { simNao, textoBruto, produtoIdentificado } = await perguntarVisaoNvidia(bufferImagemCandidata);

        registrarVerificacaoIA({
            hora: horaAtualCurta(),
            imagem: bufferImagemCandidata.toString('base64'),
            resposta: textoBruto,
            contado: simNao
        });

        return { confirmado: simNao, viaIA: true, produtoIdentificado };
    } catch (erro) {
        console.warn('⚠️  IA de visão falhou ao confirmar produto, contando pelo método local:', erro.message);

        registrarVerificacaoIA({
            hora: horaAtualCurta(),
            imagem: bufferImagemCandidata.toString('base64'),
            resposta: 'IA indisponível (contado pelo método local)',
            contado: true
        });

        return { confirmado: true, viaIA: false, produtoIdentificado: null };
    } finally {
        aiVisaoOcupada = false;
    }
}

// ================================================================================
// HISTÓRICO DE CHAT — NA MEMÓRIA, PRIVADO POR USUÁRIO
// ================================================================================
let historicosChat = {};

function gerarIdMensagem() {
    return crypto.randomBytes(6).toString('hex');
}

// ================================================================================
// VISÃO COMPUTACIONAL — gatilho local (diferença de quadros) + confirmação por IA
// ================================================================================

const arquivoConfigVisao = path.join(__dirname, 'config_visao.json');

function carregarConfigVisao() {
    try {
        const carregado = JSON.parse(fs.readFileSync(arquivoConfigVisao, 'utf-8'));
        if (typeof carregado.usarIaVisao !== 'boolean') carregado.usarIaVisao = true;
        return carregado;
    } catch (e) {
        return {
            ip: '',
            porta: 80,
            caminho: '/cam-lo.jpg',
            zonaInicio: 0.4,
            zonaFim: 0.6,
            limiar: 25,
            intervaloMs: 400,
            usarIaVisao: true
        };
    }
}

function salvarConfigVisao(config) {
    fs.writeFileSync(arquivoConfigVisao, JSON.stringify(config, null, 2));
}

let configVisao = carregarConfigVisao();
if (!fs.existsSync(arquivoConfigVisao)) salvarConfigVisao(configVisao);

const arquivoProducaoVisao = path.join(pastaLogs, 'historico_producao_visao.json');
if (!fs.existsSync(arquivoProducaoVisao)) fs.writeFileSync(arquivoProducaoVisao, JSON.stringify({}));

const arquivoProducaoPorProduto = path.join(pastaLogs, 'historico_producao_por_produto.json');
if (!fs.existsSync(arquivoProducaoPorProduto)) fs.writeFileSync(arquivoProducaoPorProduto, JSON.stringify({}));

function obterDataPtBrAgora() {
    return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }).split(', ')[0];
}

function registrarProdutoContadoVisao(nomeProduto) {
    let historico = {};
    if (fs.existsSync(arquivoProducaoVisao)) {
        try { historico = JSON.parse(fs.readFileSync(arquivoProducaoVisao, 'utf-8')); } catch(e) {}
    }
    const dataHoje = obterDataPtBrAgora();
    if (!historico[dataHoje]) historico[dataHoje] = 0;
    historico[dataHoje] += 1;
    fs.writeFileSync(arquivoProducaoVisao, JSON.stringify(historico, null, 2));

    if (nomeProduto) {
        let historicoPorProduto = {};
        if (fs.existsSync(arquivoProducaoPorProduto)) {
            try { historicoPorProduto = JSON.parse(fs.readFileSync(arquivoProducaoPorProduto, 'utf-8')); } catch(e) {}
        }
        if (!historicoPorProduto[dataHoje]) historicoPorProduto[dataHoje] = {};
        if (!historicoPorProduto[dataHoje][nomeProduto]) historicoPorProduto[dataHoje][nomeProduto] = 0;
        historicoPorProduto[dataHoje][nomeProduto] += 1;
        fs.writeFileSync(arquivoProducaoPorProduto, JSON.stringify(historicoPorProduto, null, 2));
    }

    return historico[dataHoje];
}

function obterContagemHojeVisao() {
    let historico = {};
    if (fs.existsSync(arquivoProducaoVisao)) {
        try { historico = JSON.parse(fs.readFileSync(arquivoProducaoVisao, 'utf-8')); } catch(e) {}
    }
    return historico[obterDataPtBrAgora()] || 0;
}

function obterContagemPorProdutoHoje() {
    let historicoPorProduto = {};
    if (fs.existsSync(arquivoProducaoPorProduto)) {
        try { historicoPorProduto = JSON.parse(fs.readFileSync(arquivoProducaoPorProduto, 'utf-8')); } catch(e) {}
    }
    return historicoPorProduto[obterDataPtBrAgora()] || {};
}

let cameraOnline = false;
let frameAnteriorMedia = null;
let estadoContagemVisao = 'aguardando';
let contadorFramesObjeto = 0;
let ultimoTempoContagem = 0;
const FRAMES_MINIMOS_OBJETO = 2;
const COOLDOWN_MS = 800;

async function detectarCandidatoLocal(bufferImagem) {
    const imagem = await Jimp.read(bufferImagem);
    imagem.resize(160, Jimp.AUTO);
    imagem.greyscale();

    const largura = imagem.bitmap.width;
    const altura = imagem.bitmap.height;
    const dadosBrutos = imagem.bitmap.data;

    const faixaInicio = Math.floor(altura * configVisao.zonaInicio);
    const faixaFim = Math.max(faixaInicio + 1, Math.floor(altura * configVisao.zonaFim));

    let soma = 0;
    let totalPixels = 0;

    for (let y = faixaInicio; y < faixaFim; y++) {
        const inicioLinha = y * largura * 4;
        for (let x = 0; x < largura; x++) {
            soma += dadosBrutos[inicioLinha + x * 4];
            totalPixels++;
        }
    }

    const mediaAtual = totalPixels > 0 ? soma / totalPixels : 0;
    let produtoCandidato = false;

    if (frameAnteriorMedia !== null) {
        const diferenca = Math.abs(mediaAtual - frameAnteriorMedia);
        const limiar = configVisao.limiar;

        if (estadoContagemVisao === 'aguardando' && diferenca > limiar) {
            estadoContagemVisao = 'objeto_presente';
            contadorFramesObjeto = 1;
        } else if (estadoContagemVisao === 'objeto_presente') {
            if (diferenca > limiar) {
                contadorFramesObjeto++;
            } else {
                const agora = Date.now();
                if (contadorFramesObjeto >= FRAMES_MINIMOS_OBJETO && (agora - ultimoTempoContagem) > COOLDOWN_MS) {
                    produtoCandidato = true;
                    ultimoTempoContagem = agora;
                }
                estadoContagemVisao = 'aguardando';
                contadorFramesObjeto = 0;
            }
        }
    }

    frameAnteriorMedia = mediaAtual;
    return produtoCandidato;
}

function processarCandidatoDeProduto(bufferImagemCandidata) {
    decidirContagemComIA(bufferImagemCandidata)
        .then(({ confirmado, viaIA, produtoIdentificado }) => {
            if (confirmado) {
                const total = registrarProdutoContadoVisao(produtoIdentificado);
                io.emit('visao_produto_contado', { total, viaIA, produtoIdentificado });
            }
        })
        .catch(() => {
            const total = registrarProdutoContadoVisao(null);
            io.emit('visao_produto_contado', { total, viaIA: false, produtoIdentificado: null });
        });
}

async function cicloPollingVisao() {
    if (!configVisao.ip) {
        if (cameraOnline) {
            cameraOnline = false;
            io.emit('visao_status', { online: false, motivo: 'Nenhum IP de câmera configurado.' });
        }
        setTimeout(cicloPollingVisao, 3000);
        return;
    }

    const url = `http://${configVisao.ip}:${configVisao.porta || 80}${configVisao.caminho}`;
    const inicioQuadro = Date.now();

    try {
        const controlador = new AbortController();
        const timeoutId = setTimeout(() => controlador.abort(), 3000);
        const resposta = await fetch(url, { signal: controlador.signal });
        clearTimeout(timeoutId);

        if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);

        const arrayBuffer = await resposta.arrayBuffer();
        const bufferImagem = Buffer.from(arrayBuffer);

        if (!cameraOnline) {
            cameraOnline = true;
            io.emit('visao_status', { online: true });
        }

        if (separadorMotor.getConfig().motorLocal) {
            // motor local do Separador: conta, reconhece e aciona o servo sem depender de internet
            io.emit('visao_frame', {
                imagem: bufferImagem.toString('base64'),
                contagemHoje: obterContagemHojeVisao()
            });
            await separadorTratarFrame(bufferImagem);
        } else {
            const produtoCandidato = await detectarCandidatoLocal(bufferImagem);

            io.emit('visao_frame', {
                imagem: bufferImagem.toString('base64'),
                contagemHoje: obterContagemHojeVisao()
            });

            if (produtoCandidato) {
                recortarZonaDeInteresse(bufferImagem)
                    .then(bufferRecortado => processarCandidatoDeProduto(bufferRecortado))
                    .catch(() => processarCandidatoDeProduto(bufferImagem));
            }
        }

        setTimeout(cicloPollingVisao, separadorProximoAtraso(inicioQuadro));

    } catch (erro) {
        if (cameraOnline) {
            cameraOnline = false;
            io.emit('visao_status', { online: false, motivo: erro.message });
        }
        setTimeout(cicloPollingVisao, 3000);
    }
}

// ================================================================================
// SEPARADOR (fase 2) - visao local + servo separador
// ================================================================================
const { criarMotorSeparador } = require('./separador_engine');
const separadorMotor = criarMotorSeparador({
    Jimp,
    pastaDados: __dirname,
    obterCamera: () => configVisao,
    aoTreino: (info) => io.emit('separador_treino', info)
});
let separadorOnline = false;
let separadorEstado = null;
let ultimaMsgSeparador = 0;
const separadorRecentes = [];

function separadorPublicarConfig() {
    try {
        const c = separadorMotor.getConfig();
        mqttClient.publish('separador/config', JSON.stringify({
            esq: c.anguloEsq, centro: c.anguloCentro, dir: c.anguloDir, vel: c.velocidadeServo, aberto: c.tempoAbertoMs
        }), { retain: true });
    } catch (e) {}
}

function separadorLadoPara(classe) {
    const c = separadorMotor.getConfig();
    if (!classe) return c.ladoDesconhecido || 'C';
    return (c.ladoPorClasse && c.ladoPorClasse[classe]) || 'C';
}

// atraso entre a linha de contagem e o servo (ajustado pela velocidade atual da esteira)
function separadorAtrasoMs() {
    const c = separadorMotor.getConfig();
    let atraso = c.atrasoBaseMs;
    const v = parseFloat(ultimaVelocidadeConhecida) || 0;
    if (c.compensarVelocidade && c.velRefEsteira > 0) {
        if (v <= 0.01) return null;
        atraso = atraso * (c.velRefEsteira / v);
    }
    return Math.round(Math.min(15000, Math.max(0, atraso)));
}

// o proximo quadro e pedido logo que o anterior termina (nao espera o intervalo inteiro)
function separadorProximoAtraso(inicioQuadro) {
    if (!separadorMotor.getConfig().motorLocal) return configVisao.intervaloMs || 400;
    return Math.max(20, 120 - (Date.now() - inicioQuadro));
}

async function separadorTratarFrame(buffer) {
    let r;
    try { r = await separadorMotor.processarFrame(buffer, Date.now()); }
    catch (e) { console.warn('Separador (visao local):', e.message); return; }

    const est = separadorMotor.estado();
    io.emit('separador_overlay', { sobreposicao: r.sobreposicao, aprendendoFundo: est.aprendendoFundo, framesFaltando: est.framesFaltando, fps: est.fps });

    for (const ev of r.eventos) {
        if (ev.tipo === 'treino') {
            io.emit('separador_treino_amostra', { classe: ev.classe, miniatura: ev.miniatura, restante: ev.restante });
            continue;
        }

        for (let i = 0; i < ev.quantidade; i++) {
            const total = registrarProdutoContadoVisao(ev.classe);
            io.emit('visao_produto_contado', { total, viaIA: false, produtoIdentificado: ev.classe });
        }

        const lado = separadorLadoPara(ev.classe);
        const cfg = separadorMotor.getConfig();
        let atraso = null;
        if (cfg.servoAtivo && (lado === 'E' || lado === 'D')) {
            atraso = separadorAtrasoMs();
            if (atraso !== null) mqttClient.publish('separador/desviar', lado + ';' + atraso + ';' + cfg.tempoAbertoMs);
        }

        const registro = {
            hora: horaAtualCurta(), classe: ev.classe, confianca: ev.confianca, quantidade: ev.quantidade,
            motivo: ev.motivo, lado: (cfg.servoAtivo && atraso !== null) ? lado : 'C', atrasoMs: atraso, miniatura: ev.miniatura
        };
        separadorRecentes.unshift(registro);
        if (separadorRecentes.length > 20) separadorRecentes.pop();
        io.emit('separador_evento', registro);

        const texto = ev.classe ? `${ev.classe} (${Math.round(ev.confianca * 100)}%) - visao local` : (ev.motivo === 'desconhecido' ? 'Desconhecido - visao local' : 'Sem treino - visao local');
        try { registrarVerificacaoIA({ hora: registro.hora, imagem: ev.miniatura || '', resposta: texto, contado: true }); } catch (e) {}
    }
}

function separadorTratarMqtt(topic, valor) {
    if (topic === 'separador/status') {
        ultimaMsgSeparador = Date.now();
        const novo = (valor === 'online');
        if (novo !== separadorOnline) {
            separadorOnline = novo;
            io.emit('separador_servo', { online: separadorOnline, estado: separadorEstado });
            if (novo) separadorPublicarConfig();
        }
    }
    if (topic === 'separador/estado') {
        ultimaMsgSeparador = Date.now();
        try { separadorEstado = JSON.parse(valor); } catch (e) { return; }
        if (!separadorOnline) separadorOnline = true;
        io.emit('separador_servo', { online: separadorOnline, estado: separadorEstado });
    }
}

setInterval(() => {
    if (separadorOnline && Date.now() - ultimaMsgSeparador > 8000) {
        separadorOnline = false;
        io.emit('separador_servo', { online: false, estado: separadorEstado });
    }
}, 2000);


cicloPollingVisao();

// ================================================================================
// SELAGEM 1 — controle real de temperatura via MQTT
// ================================================================================

let selagemOnline = false;
let ultimoEstadoSelagem = { temperatura: 0, setpoint: 0, potencia: 0, habilitado: false, seguranca: 'ok' };
let ultimaSegurancaSelagemAvisada = 'ok';

let selagem2Online = false;
let ultimoEstadoSelagem2 = { temperatura: 0, setpoint: 0, potencia: 0, habilitado: false, seguranca: 'ok' };
let ultimaSegurancaSelagem2Avisada = 'ok';

function salvarLogNoArquivoDoDia(logComUsuario) {
    const dataLocal = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }).split(', ')[0];
    const partes = dataLocal.split('/');
    const dataFormatada = `${partes[2]}-${partes[1]}-${partes[0]}`;
    const arquivo = path.join(pastaLogs, `${dataFormatada}.json`);

    let logsDoDia = [];
    if (fs.existsSync(arquivo)) {
        try { logsDoDia = JSON.parse(fs.readFileSync(arquivo, 'utf-8')); } catch(e) {}
    }
    logsDoDia.push(logComUsuario);
    fs.writeFileSync(arquivo, JSON.stringify(logsDoDia, null, 2));
}

function registrarLogDeAcesso(nomeUsuario, tipoEvento) {
    const hora = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    const texto = tipoEvento === 'login'
        ? `${nomeUsuario} fez login no sistema`
        : `${nomeUsuario} fez logout do sistema`;

    const log = {
        hora,
        texto,
        classe: 'text-blue-600 font-bold',
        usuario: nomeUsuario,
        tipo: 'login'
    };

    salvarLogNoArquivoDoDia(log);
    io.emit('novo_log_servidor', log);
}

// ================================================================================

// --- CONFIGURAÇÕES DO SERVIDOR ---
const MQTT_BROKER = 'mqtt://192.168.4.1'; 
const MQTT_TOPIC_ATUAL = 'esteira/velocidade/atual';
const MQTT_TOPIC_SET = 'esteira/velocidade/set';
const MQTT_TOPIC_STATUS = 'esteira/status';
const MQTT_TOPIC_EMERGENCIA_ESTEIRA = 'esteira/emergencia';
const MQTT_TOPIC_SENTIDO_SET = 'esteira/sentido/set';
const MQTT_TOPIC_SENTIDO_ATUAL = 'esteira/sentido/atual';

const MQTT_TOPIC_SELAGEM_DADOS = 'selagem/dados';
const MQTT_TOPIC_SELAGEM_SET = 'selagem/set_temperatura';
const MQTT_TOPIC_SELAGEM_ATIVAR = 'selagem/ativar';
const MQTT_TOPIC_SELAGEM_EMERGENCIA = 'selagem/emergencia';
const MQTT_TOPIC_SELAGEM_STATUS = 'selagem/status_conexao';

const MQTT_TOPIC_SELAGEM2_DADOS = 'selagem2/dados';
const MQTT_TOPIC_SELAGEM2_SET = 'selagem2/set_temperatura';
const MQTT_TOPIC_SELAGEM2_ATIVAR = 'selagem2/ativar';
const MQTT_TOPIC_SELAGEM2_EMERGENCIA = 'selagem2/emergencia';
const MQTT_TOPIC_SELAGEM2_STATUS = 'selagem2/status_conexao';

let ultimaVelocidadeConhecida = "0.00";
let esp32Online = false;
let sentidoEsteira = 'normal';

// ================================================================================
// PAINEL DE CONTROLE: motores das selagens. O servidor guarda o ultimo valor
// de cada um, pra tela mostrar o valor salvo ao recarregar ou trocar de tela.
// ================================================================================
const MOTORES_SELAGEM = {
    s1m1: {
        nome: 'Selagem 1 - Motor 1', dispositivo: 'selagem1motor',
        topicoSet: 'selagem/motor1/velocidade/set', topicoAtual: 'selagem/motor1/velocidade/atual',
        topicoSentidoSet: 'selagem/motor1/sentido/set', topicoSentidoAtual: 'selagem/motor1/sentido/atual',
        velocidade: '0.00', sentido: 'normal'
    },
    s1m2: {
        nome: 'Selagem 1 - Motor 2', dispositivo: 'selagem1motor',
        topicoSet: 'selagem/motor2/velocidade/set', topicoAtual: 'selagem/motor2/velocidade/atual',
        topicoSentidoSet: 'selagem/motor2/sentido/set', topicoSentidoAtual: 'selagem/motor2/sentido/atual',
        velocidade: '0.00', sentido: 'normal'
    },
    s2m: {
        nome: 'Selagem 2 - Motor', dispositivo: 'selagem2motor',
        topicoSet: 'selagem2/motor/velocidade/set', topicoAtual: 'selagem2/motor/velocidade/atual',
        topicoSentidoSet: 'selagem2/motor/sentido/set', topicoSentidoAtual: 'selagem2/motor/sentido/atual',
        velocidade: '0.00', sentido: 'normal'
    }
};
// ================================================================================
// DISPENSER: ESP32 proprio com 2 motores (driver L298N). O servidor guarda a
// configuracao (velocidade, tempo de 1/4 de volta etc.) e manda os parametros
// completos a cada dosagem, entao o ESP32 nao precisa guardar nada.
// ================================================================================
const MQTT_TOPIC_DISP_STATUS = 'dispenser/status';
const MQTT_TOPIC_DISP_ESTADO = 'dispenser/estado';
const MQTT_TOPIC_DISP_CONCLUIDO = 'dispenser/concluido';
const MQTT_TOPIC_DISP_DOSAR = 'dispenser/dosar';
const MQTT_TOPIC_DISP_EMERGENCIA = 'dispenser/emergencia';
const MQTT_TOPIC_DISP_REINICIAR = 'dispenser/reiniciar';

let dispenserOnline = false;
let ultimaMsgDispenser = 0;
let dispenserMotores = { 1: { ocupado: false, restantes: 0 }, 2: { ocupado: false, restantes: 0 } };
let dispenserUltimaDose = null;
let dispenserContador = { dia: '', doses: 0, quartosPorReservatorio: { A: 0, B: 0 } };

const ARQUIVO_CONFIG_DISPENSER = path.join(__dirname, 'dispenser_config.json');
const CONFIG_PADRAO_DISPENSER = {
    reservatorios: {
        A: { nome: 'Arroz',  motor: 1, gramasPorBolso: 50, pwm: 100, tempoQuartoMs: 170, pausaMs: 250, sentidoInvertido: false },
        B: { nome: 'Feijão', motor: 2, gramasPorBolso: 50, pwm: 100, tempoQuartoMs: 170, pausaMs: 250, sentidoInvertido: false }
    },
    doses: [
        { gramas: 50, ativo: true }, { gramas: 100, ativo: true },
        { gramas: 150, ativo: true }, { gramas: 200, ativo: true }
    ]
};

function limitarNumero(valor, minimo, maximo, padrao) {
    const n = Number(valor);
    if (!Number.isFinite(n)) return padrao;
    return Math.min(maximo, Math.max(minimo, n));
}

// Aceita qualquer objeto e devolve uma configuracao completa e valida
// (valores fora da faixa sao corrigidos para o limite mais proximo)
function normalizarConfigDispenser(entrada) {
    const base = JSON.parse(JSON.stringify(CONFIG_PADRAO_DISPENSER));
    const e = entrada && typeof entrada === 'object' ? entrada : {};
    ['A', 'B'].forEach(r => {
        const padrao = base.reservatorios[r];
        const v = (e.reservatorios && e.reservatorios[r]) || {};
        const nome = typeof v.nome === 'string' ? v.nome.trim().slice(0, 20) : '';
        padrao.nome = nome || padrao.nome;
        padrao.gramasPorBolso = limitarNumero(v.gramasPorBolso, 10, 150, padrao.gramasPorBolso);
        padrao.pwm = Math.round(limitarNumero(v.pwm, 20, 100, padrao.pwm));
        padrao.tempoQuartoMs = Math.round(limitarNumero(v.tempoQuartoMs, 50, 2000, padrao.tempoQuartoMs));
        padrao.pausaMs = Math.round(limitarNumero(v.pausaMs, 0, 2000, padrao.pausaMs));
        padrao.sentidoInvertido = v.sentidoInvertido === true;
    });
    base.doses.forEach(d => {
        const v = Array.isArray(e.doses) ? e.doses.find(x => x && Number(x.gramas) === d.gramas) : null;
        if (v) d.ativo = v.ativo === true;
    });
    return base;
}

function carregarConfigDispenser() {
    try {
        if (fs.existsSync(ARQUIVO_CONFIG_DISPENSER)) {
            return normalizarConfigDispenser(JSON.parse(fs.readFileSync(ARQUIVO_CONFIG_DISPENSER, 'utf-8')));
        }
    } catch (e) {
        console.warn('⚠️  Não consegui ler dispenser_config.json, usando os valores padrão:', e.message);
    }
    return normalizarConfigDispenser(null);
}
let configDispenser = carregarConfigDispenser();

function visaoPublicaConfigDispenser(c) {
    return {
        reservatorios: {
            A: { nome: c.reservatorios.A.nome, gramasPorBolso: c.reservatorios.A.gramasPorBolso },
            B: { nome: c.reservatorios.B.nome, gramasPorBolso: c.reservatorios.B.gramasPorBolso }
        },
        doses: c.doses
    };
}

function dataHojeDispenser() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

function contadorDeHojeDispenser() {
    if (dispenserContador.dia !== dataHojeDispenser()) {
        dispenserContador = { dia: dataHojeDispenser(), doses: 0, quartosPorReservatorio: { A: 0, B: 0 } };
    }
    return dispenserContador;
}

function estadoDispenserParaTela(completo) {
    const c = contadorDeHojeDispenser();
    return {
        online: dispenserOnline,
        motores: dispenserMotores,
        ultimaDose: dispenserUltimaDose,
        contador: { doses: c.doses, quartosPorReservatorio: c.quartosPorReservatorio },
        config: completo ? configDispenser : visaoPublicaConfigDispenser(configDispenser)
    };
}

let ultimoEstadoDispenserEmitido = '';
function emitirEstadoDispenser(forcar) {
    const conteudo = JSON.stringify(estadoDispenserParaTela(false));
    if (!forcar && conteudo === ultimoEstadoDispenserEmitido) return;
    ultimoEstadoDispenserEmitido = conteudo;
    io.emit('dispenser_estado', JSON.parse(conteudo));
}

function registrarLogDispenser(texto, usuario) {
    const log = {
        hora: new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
        texto: texto,
        classe: 'text-slate-700 font-medium',
        usuario: usuario || 'Sistema',
        tipo: 'sistema'
    };
    salvarLogNoArquivoDoDia(log);
    io.emit('novo_log_servidor', log);
}

function liberarMotoresDispenser() {
    dispenserMotores = { 1: { ocupado: false, restantes: 0 }, 2: { ocupado: false, restantes: 0 } };
}

const TOPICOS_REINICIAR = { esteira: 'esteira/reiniciar', selagem1: 'selagem/reiniciar', selagem2: 'selagem2/reiniciar', selagem2motor: 'selagem2/motor/reiniciar', selagem1motor: 'selagem/motores/reiniciar' };

// Selagem 2 agora tem 2 ESP32: um so para o aquecimento e outro so para o motor
const MQTT_TOPIC_SELAGEM2_MOTOR_STATUS = 'selagem2/motor/status';
let selagem2MotorOnline = false;
let ultimaMsgSelagem2Motor = 0;

const MQTT_TOPIC_SELAGEM1_MOTOR_STATUS = 'selagem/motores/status';
let selagem1MotorOnline = false;
let ultimaMsgSelagem1Motor = 0;

const env = nunjucks.configure('views', { autoescape: true, express: app, watch: true });
env.addGlobal('url_for', function(dir, file) {
    if (dir === 'static') return '/' + file.filename;
    return '/' + dir;
});

app.set('view engine', 'html');
// ================================================================================
// ALEXA - skill "Dark Coders"
// A Alexa manda o pedido falado pra ca. Se for um COMANDO (velocidade,
// temperatura, ligar, desligar, emergencia), o servidor executa na hora.
// Se for uma PERGUNTA, a mesma IA do site responde.
// Esta rota fica ANTES do express.json de proposito: a Amazon exige que a
// assinatura do pedido seja conferida com o corpo original.
// ================================================================================
const Alexa = require('ask-sdk-core');
const { ExpressAdapter } = require('ask-sdk-express-adapter');

// Cole aqui o ID da sua skill (Alexa Developer Console > sua skill > "Copy Skill ID")
const ALEXA_SKILL_ID = 'amzn1.ask.skill.588fe905-2c30-4573-9a32-30a4fe4bf076';

const NUMEROS_POR_EXTENSO_VOZ = {
    'zero': 0, 'dois': 2, 'duas': 2, 'tres': 3, 'quatro': 4, 'cinco': 5, 'seis': 6, 'sete': 7,
    'oito': 8, 'nove': 9, 'dez': 10, 'onze': 11, 'doze': 12, 'treze': 13, 'catorze': 14,
    'quatorze': 14, 'quinze': 15, 'dezesseis': 16, 'dezessete': 17, 'dezoito': 18, 'dezenove': 19,
    'vinte': 20, 'trinta': 30, 'quarenta': 40, 'cinquenta': 50, 'sessenta': 60, 'setenta': 70,
    'oitenta': 80, 'noventa': 90, 'cem': 100, 'cento': 100, 'duzentos': 200, 'duzentas': 200
};

function converterNumerosFalados(texto) {
    const palavras = Object.keys(NUMEROS_POR_EXTENSO_VOZ).join('|');
    let t = texto;
    // "cento e cinquenta e cinco" -> junta as partes somando
    const regexComposto = new RegExp(`\\b(${palavras})((?:\\s+e\\s+(?:${palavras}))+)\\b`, 'g');
    t = t.replace(regexComposto, (trecho) => {
        const total = trecho.split(/\s+e\s+/).reduce((soma, p) => soma + (NUMEROS_POR_EXTENSO_VOZ[p.trim()] || 0), 0);
        return String(total);
    });
    const regexSimples = new RegExp(`\\b(${palavras})\\b`, 'g');
    return t.replace(regexSimples, (p) => String(NUMEROS_POR_EXTENSO_VOZ[p]));
}

function normalizarPedidoVoz(texto) {
    let t = (texto || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    t = t.replace(/\bselagem (um|uma)\b/g, 'selagem 1').replace(/\bselagem dois\b/g, 'selagem 2')
         .replace(/\bmotor (um|uma)\b/g, 'motor 1').replace(/\bmotor dois\b/g, 'motor 2')
         .replace(/\bprimeira selagem\b/g, 'selagem 1').replace(/\bsegunda selagem\b/g, 'selagem 2');
    t = converterNumerosFalados(t);
    return t.replace(/\s*por\s*cento/g, '%').replace(/\s+/g, ' ');
}

// Entende o pedido e devolve um comando, ou null se for pergunta
function interpretarComandoServidor(textoOriginal) {
    const t = normalizarPedidoVoz(textoOriginal);

    if (/emergencia/.test(t)) return { tipo: 'emergencia' };
    if (/^(qual|quais|quanto|quanta|como|o que|por que|porque|me explique|explique|me diga|me fale)\b/.test(t)) return null;

    const semNumerosDeNome = t.replace(/selagem\s*[12]\b/g, 'selagem').replace(/motor\s*[12]\b/g, 'motor');
    const matchNumero = semNumerosDeNome.match(/(\d{1,3})/);
    const numero = matchNumero ? parseInt(matchNumero[1], 10) : null;
    const ehLigar = /\b(liga|ligue|ligar|ative|ativa|ativar|inicie|inicia|iniciar|acione|aciona)\b/.test(t);
    const ehDesligar = /\b(desliga|desligue|desligar|desative|desativa|pare|parar|zera|zere|zerar)\b/.test(t) || /^para\b/.test(t);
    const numeroSelagem = /selagem\s*2\b/.test(t) ? 2 : 1;

    // Desligar tudo
    if (ehDesligar && /\b(tudo|maquina|todos)\b/.test(t)) return { tipo: 'desligar_tudo' };

    // Motores das selagens
    if (/\bmotor\b/.test(t) && /selagem/.test(t)) {
        let id = 's1m1';
        if (numeroSelagem === 2) id = 's2m';
        else if (/motor\s*2\b/.test(t)) id = 's1m2';
        if (numero !== null) return { tipo: 'motor', id, valor: Math.min(100, numero) };
        if (ehDesligar) return { tipo: 'motor', id, valor: 0 };
        if (ehLigar) return { tipo: 'motor', id, valor: 50 };
    }

    // Temperatura / aquecimento das selagens
    if (/temperatura|graus|aquec|esquent|resistencia|selagem/.test(t)) {
        if (numero !== null && /temperatura|graus|selagem/.test(t)) {
            return { tipo: 'temperatura', numero: numeroSelagem, valor: Math.min(250, numero) };
        }
        if (ehDesligar) return { tipo: 'aquecimento', numero: numeroSelagem, valor: false };
        if (ehLigar) return { tipo: 'aquecimento', numero: numeroSelagem, valor: true };
    }

    // Esteira / velocidade
    if (/velocidade|esteira|potencia/.test(t)) {
        if (numero !== null) return { tipo: 'velocidade', valor: Math.min(100, numero) };
        if (ehDesligar) return { tipo: 'velocidade', valor: 0 };
        if (ehLigar) return { tipo: 'velocidade', valor: 50 };
    }

    return null;
}

function registrarLogDaAlexa(texto, tipo) {
    const log = {
        hora: new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
        texto: texto,
        classe: 'text-slate-700 font-medium',
        usuario: 'Alexa (voz)',
        tipo: tipo || 'sistema'
    };
    salvarLogNoArquivoDoDia(log);
    io.emit('novo_log_servidor', log);
}

function definirVelocidadeEsteiraServidor(pct) {
    const valor = (pct / 100).toFixed(2);
    ultimaVelocidadeConhecida = valor;
    io.emit('atualizar_velocidade', { velocidade: valor });
    mqttClient.publish(MQTT_TOPIC_SET, valor);
}

function definirMotorSelagemServidor(id, pct) {
    const m = MOTORES_SELAGEM[id];
    if (!m) return;
    m.velocidade = (pct / 100).toFixed(2);
    io.emit('motor_selagem_velocidade', { id, velocidade: m.velocidade });
    mqttClient.publish(m.topicoSet, m.velocidade);
}

function definirAquecimentoServidor(numero, ligar) {
    const estado = numero === 2 ? ultimoEstadoSelagem2 : ultimoEstadoSelagem;
    estado.habilitado = !!ligar;
    io.emit(numero === 2 ? 'atualizar_temperatura2' : 'atualizar_temperatura', estado);
    mqttClient.publish(numero === 2 ? MQTT_TOPIC_SELAGEM2_ATIVAR : MQTT_TOPIC_SELAGEM_ATIVAR, ligar ? '1' : '0');
}

// Executa o comando e devolve a frase que a Alexa vai falar
function executarComandoServidor(cmd) {
    if (cmd.tipo === 'velocidade') {
        definirVelocidadeEsteiraServidor(cmd.valor);
        registrarLogDaAlexa(`Velocidade da esteira alterada pela Alexa para ${cmd.valor}%`, 'velocidade');
        return cmd.valor === 0 ? 'Esteira desligada.' : `Velocidade da esteira alterada para ${cmd.valor} por cento.`;
    }
    if (cmd.tipo === 'motor') {
        const nome = MOTORES_SELAGEM[cmd.id].nome;
        definirMotorSelagemServidor(cmd.id, cmd.valor);
        registrarLogDaAlexa(`${nome} alterado pela Alexa para ${cmd.valor}%`, 'velocidade');
        return cmd.valor === 0 ? `${nome} desligado.` : `${nome} em ${cmd.valor} por cento.`;
    }
    if (cmd.tipo === 'temperatura') {
        const estado = cmd.numero === 2 ? ultimoEstadoSelagem2 : ultimoEstadoSelagem;
        estado.setpoint = cmd.valor;
        io.emit(cmd.numero === 2 ? 'atualizar_temperatura2' : 'atualizar_temperatura', estado);
        mqttClient.publish(cmd.numero === 2 ? MQTT_TOPIC_SELAGEM2_SET : MQTT_TOPIC_SELAGEM_SET, String(cmd.valor));
        registrarLogDaAlexa(`Temperatura alvo da Selagem ${cmd.numero} ajustada pela Alexa para ${cmd.valor}°C`, 'temperatura');
        const aviso = estado.habilitado ? '' : ' Lembrando que o aquecimento dela está desligado.';
        return `Temperatura da selagem ${cmd.numero} ajustada para ${cmd.valor} graus.${aviso}`;
    }
    if (cmd.tipo === 'aquecimento') {
        definirAquecimentoServidor(cmd.numero, cmd.valor);
        registrarLogDaAlexa(`Aquecimento da Selagem ${cmd.numero} ${cmd.valor ? 'LIGADO' : 'DESLIGADO'} pela Alexa`, 'temperatura');
        return `Aquecimento da selagem ${cmd.numero} ${cmd.valor ? 'ligado' : 'desligado'}.`;
    }
    if (cmd.tipo === 'desligar_tudo') {
        definirVelocidadeEsteiraServidor(0);
        Object.keys(MOTORES_SELAGEM).forEach(id => definirMotorSelagemServidor(id, 0));
        definirAquecimentoServidor(1, false);
        definirAquecimentoServidor(2, false);
        registrarLogDaAlexa('Alexa desligou todos os motores e aquecimentos.', 'sistema');
        return 'Pronto, desliguei todos os motores e os aquecimentos.';
    }
    if (cmd.tipo === 'emergencia') {
        mqttClient.publish(MQTT_TOPIC_EMERGENCIA_ESTEIRA, '1');
        mqttClient.publish(MQTT_TOPIC_SELAGEM_EMERGENCIA, '1');
        mqttClient.publish(MQTT_TOPIC_SELAGEM2_EMERGENCIA, '1');
        mqttClient.publish(MQTT_TOPIC_DISP_EMERGENCIA, '1'); mqttClient.publish('separador/emergencia', '1'); // Alexa -> Dispenser
        ultimaVelocidadeConhecida = '0.00';
        Object.entries(MOTORES_SELAGEM).forEach(([id, m]) => {
            m.velocidade = '0.00';
            io.emit('motor_selagem_velocidade', { id, velocidade: '0.00' });
        });
        ultimoEstadoSelagem.habilitado = false;
        ultimoEstadoSelagem2.habilitado = false;
        io.emit('atualizar_temperatura', ultimoEstadoSelagem);
        io.emit('atualizar_temperatura2', ultimoEstadoSelagem2);
        io.emit('emergencia_remota', {});   // trava os botoes de quem estiver com o site aberto
        registrarLogDaAlexa('PARADA DE EMERGÊNCIA acionada pela Alexa.', 'emergencia');
        return 'Parada de emergência acionada. Todos os motores e aquecimentos foram parados.';
    }
    return 'Não entendi esse comando.';
}

function limparTextoParaAlexa(texto) {
    return (texto || '')
        .replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1').replace(/#{1,6}\s?/g, '')
        .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
        .replace(/&/g, ' e ').replace(/[<>]/g, ' ')
        .replace(/\s{2,}/g, ' ').trim();
}

// A Alexa espera no maximo ~8 segundos, entao a IA tem 6,5s pra responder
async function responderPerguntaParaAlexa(pergunta) {
    if (!NVIDIA_API_KEY) return limparTextoParaAlexa(buscarMelhorRespostaLocal(pergunta));
    const promptSistema = `${PROMPT_SISTEMA_BASE}\n\nDADOS AO VIVO DA MÁQUINA (agora mesmo):\n${montarContextoAoVivo()}\n\nContexto adicional da base de conhecimento (pode ou não ser relevante):\n${montarContextoRAG(pergunta)}\n\nIMPORTANTE: sua resposta será FALADA pela Alexa. Responda em no máximo 2 frases curtas.`;
    const limiteDeTempo = new Promise(resolve => setTimeout(() => resolve(null), 6500));
    try {
        const resposta = await Promise.race([perguntarNvidia(promptSistema, pergunta), limiteDeTempo]);
        if (resposta) return limparTextoParaAlexa(resposta);
    } catch (erro) {
        console.warn('Alexa: IA online falhou:', erro.message);
    }
    return 'Essa demorou demais para eu pensar. Pode perguntar de novo?';
}

// Cada intencao da skill guarda a palavra inicial que a Alexa "come"
const PREFIXOS_INTENCOES = {
    AjustarIntent: 'mude',
    LigarIntent: 'ligue',
    DesligarIntent: 'desligue',
    PerguntaQualIntent: 'qual',
    PerguntaComoIntent: 'como',
    PerguntaOQueIntent: 'o que',
    ExplicarIntent: 'me explique'
};

const FRASE_CONTINUAR = ' Mais alguma coisa?';

const AlexaAbrirHandler = {
    canHandle(h) { return Alexa.getRequestType(h.requestEnvelope) === 'LaunchRequest'; },
    handle(h) {
        registrarLogDaAlexa('Skill Dark Coders aberta na Alexa.', 'sistema');
        return h.responseBuilder
            .speak('Dark Coders pronto. O que você precisa?')
            .reprompt('Pode falar um comando, por exemplo: mude a velocidade para 50 por cento.')
            .getResponse();
    }
};

const AlexaPedidoHandler = {
    canHandle(h) {
        return Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest'
            && (PREFIXOS_INTENCOES[Alexa.getIntentName(h.requestEnvelope)] !== undefined
                || Alexa.getIntentName(h.requestEnvelope) === 'EmergenciaIntent');
    },
    async handle(h) {
        const intencao = Alexa.getIntentName(h.requestEnvelope);
        let texto;
        if (intencao === 'EmergenciaIntent') {
            texto = 'emergencia';
        } else {
            const pedido = Alexa.getSlotValue(h.requestEnvelope, 'pedido') || '';
            texto = `${PREFIXOS_INTENCOES[intencao]} ${pedido}`.trim();
        }
        console.log(`🗣️  Alexa ouviu: "${texto}"`);

        const cmd = interpretarComandoServidor(texto);
        const resposta = cmd ? executarComandoServidor(cmd) : await responderPerguntaParaAlexa(texto);

        return h.responseBuilder
            .speak(resposta + FRASE_CONTINUAR)
            .reprompt('Quer mais alguma coisa?')
            .getResponse();
    }
};

const AlexaAjudaHandler = {
    canHandle(h) {
        return Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(h.requestEnvelope) === 'AMAZON.HelpIntent';
    },
    handle(h) {
        const fala = 'Você pode dizer, por exemplo: mude a velocidade para 60 por cento, ligue o aquecimento da selagem 1, '
            + 'mude a temperatura da selagem 2 para 150 graus, desligue tudo, ou emergência. '
            + 'Também pode me perguntar qual a temperatura agora. O que você quer fazer?';
        return h.responseBuilder.speak(fala).reprompt('O que você quer fazer?').getResponse();
    }
};

const AlexaSairHandler = {
    canHandle(h) {
        const nome = Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' ? Alexa.getIntentName(h.requestEnvelope) : '';
        return ['AMAZON.StopIntent', 'AMAZON.CancelIntent', 'AMAZON.NavigateHomeIntent'].includes(nome);
    },
    handle(h) {
        return h.responseBuilder.speak('Até mais!').withShouldEndSession(true).getResponse();
    }
};

const AlexaNaoEntendiHandler = {
    canHandle(h) {
        return Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(h.requestEnvelope) === 'AMAZON.FallbackIntent';
    },
    handle(h) {
        return h.responseBuilder
            .speak('Não entendi. Tente dizer, por exemplo: mude a velocidade para 50 por cento.')
            .reprompt('O que você quer fazer?')
            .getResponse();
    }
};

const AlexaFimDeSessaoHandler = {
    canHandle(h) { return Alexa.getRequestType(h.requestEnvelope) === 'SessionEndedRequest'; },
    handle(h) { return h.responseBuilder.getResponse(); }
};

const AlexaErroHandler = {
    canHandle() { return true; },
    handle(h, erro) {
        console.error('Erro na skill da Alexa:', erro);
        return h.responseBuilder
            .speak('Tive um problema para fazer isso agora. Pode tentar de novo?')
            .reprompt('Pode tentar de novo?')
            .getResponse();
    }
};

const construtorSkillAlexa = Alexa.SkillBuilders.custom()
    .addRequestHandlers(AlexaAbrirHandler, AlexaPedidoHandler, AlexaAjudaHandler, AlexaSairHandler, AlexaNaoEntendiHandler, AlexaFimDeSessaoHandler)
    .addErrorHandlers(AlexaErroHandler);
if (ALEXA_SKILL_ID) construtorSkillAlexa.withSkillId(ALEXA_SKILL_ID);

// ================================================================================
// VERIFICACAO DE SEGURANCA DA ALEXA COM CERTIFICADO GUARDADO
// O certificado da Amazon e baixado uma vez so e fica guardado (memoria + arquivo),
// entao a conferencia de cada pedido leva milissegundos.
// ================================================================================
const tls = require('tls');
const https = require('https');
const { X509Certificate } = crypto;

const ARQUIVO_CACHE_CERT_ALEXA = path.join(__dirname, 'alexa_cert_cache.json');
let certificadosAlexaGuardados = {};
try { certificadosAlexaGuardados = JSON.parse(fs.readFileSync(ARQUIVO_CACHE_CERT_ALEXA, 'utf-8')); } catch (e) {}
const cadeiasAlexaValidadas = {};
let raizesConfiaveis = null;

function urlCertificadoAlexaValida(endereco) {
    try {
        const u = new URL(endereco);
        return u.protocol === 'https:'
            && u.hostname.toLowerCase() === 's3.amazonaws.com'
            && u.pathname.startsWith('/echo.api/')
            && (u.port === '' || u.port === '443');
    } catch (e) {
        return false;
    }
}

function baixarTextoAlexa(endereco) {
    return new Promise((resolve, reject) => {
        const pedido = https.get(endereco, { timeout: 7000 }, (resposta) => {
            if (resposta.statusCode !== 200) {
                resposta.resume();
                return reject(new Error(`download do certificado deu HTTP ${resposta.statusCode}`));
            }
            let dados = '';
            resposta.on('data', (parte) => { dados += parte; });
            resposta.on('end', () => resolve(dados));
        });
        pedido.on('error', reject);
        pedido.on('timeout', () => pedido.destroy(new Error('download do certificado demorou demais')));
    });
}

function validarCadeiaAlexa(pem) {
    const blocos = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
    if (blocos.length === 0) throw new Error('arquivo de certificado vazio');
    const certificados = blocos.map(b => new X509Certificate(b));
    const principal = certificados[0];

    if (!principal.checkHost('echo-api.amazon.com')) throw new Error('certificado nao pertence a Alexa');
    for (let i = 0; i < certificados.length - 1; i++) {
        if (!certificados[i].verify(certificados[i + 1].publicKey)) throw new Error('cadeia de certificados quebrada');
    }

    if (!raizesConfiaveis) raizesConfiaveis = tls.rootCertificates.map(r => new X509Certificate(r));
    const ultimo = certificados[certificados.length - 1];
    const terminaEmRaiz = raizesConfiaveis.some(raiz => {
        try {
            return raiz.fingerprint256 === ultimo.fingerprint256
                || (ultimo.checkIssued(raiz) && ultimo.verify(raiz.publicKey));
        } catch (e) {
            return false;
        }
    });
    if (!terminaEmRaiz) throw new Error('certificado nao termina numa autoridade confiavel');
    return principal;
}

async function obterCertificadoAlexa(endereco) {
    if (cadeiasAlexaValidadas[endereco]) return cadeiasAlexaValidadas[endereco];

    let pem = certificadosAlexaGuardados[endereco];
    if (!pem) {
        console.log('📨 Alexa: baixando certificado da Amazon (so acontece uma vez)...');
        pem = await baixarTextoAlexa(endereco);
    }

    const principal = validarCadeiaAlexa(pem);
    cadeiasAlexaValidadas[endereco] = principal;

    if (certificadosAlexaGuardados[endereco] !== pem) {
        certificadosAlexaGuardados[endereco] = pem;
        try { fs.writeFileSync(ARQUIVO_CACHE_CERT_ALEXA, JSON.stringify(certificadosAlexaGuardados)); } catch (e) {}
    }
    return principal;
}

async function verificarPedidoAlexa(cabecalhos, corpoOriginal, envelope) {
    const enderecoCert = cabecalhos['signaturecertchainurl'];
    if (!enderecoCert || !urlCertificadoAlexaValida(enderecoCert)) throw new Error('endereco do certificado invalido');

    const principal = await obterCertificadoAlexa(enderecoCert);
    const agora = Date.now();
    if (agora < Date.parse(principal.validFrom) || agora > Date.parse(principal.validTo)) {
        delete cadeiasAlexaValidadas[enderecoCert];
        throw new Error('certificado da Amazon fora da validade');
    }

    const assinatura256 = cabecalhos['signature-256'];
    const assinaturaAntiga = cabecalhos['signature'];
    let assinaturaOk = false;
    if (assinatura256) {
        assinaturaOk = crypto.createVerify('RSA-SHA256').update(corpoOriginal).verify(principal.publicKey, assinatura256, 'base64');
    } else if (assinaturaAntiga) {
        assinaturaOk = crypto.createVerify('RSA-SHA1').update(corpoOriginal).verify(principal.publicKey, assinaturaAntiga, 'base64');
    }
    if (!assinaturaOk) throw new Error('assinatura do pedido nao confere');

    const horario = Date.parse(envelope && envelope.request && envelope.request.timestamp);
    if (!horario || Math.abs(agora - horario) > 150000) throw new Error('horario do pedido fora do limite (confira o relogio do Raspberry)');

    if (ALEXA_SKILL_ID) {
        const idRecebido = (envelope.context && envelope.context.System && envelope.context.System.application && envelope.context.System.application.applicationId)
            || (envelope.session && envelope.session.application && envelope.session.application.applicationId);
        if (idRecebido !== ALEXA_SKILL_ID) throw new Error('pedido de outra skill');
    }
}

const skillAlexa = construtorSkillAlexa.create();

// Deixa tudo pronto ao ligar: carrega as autoridades confiaveis e valida o
// certificado guardado ANTES da Alexa chamar, pra nenhum pedido passar de 8s
setTimeout(() => {
    const inicioPreparo = Date.now();
    try { raizesConfiaveis = tls.rootCertificates.map(r => new X509Certificate(r)); } catch (e) {}
    Promise.all(Object.keys(certificadosAlexaGuardados).map(u => obterCertificadoAlexa(u).catch(() => {})))
        .then(() => console.log(`📨 Alexa: verificacao preparada em ${Date.now() - inicioPreparo} ms`));
}, 3000);

app.post('/alexa', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    const inicio = Date.now();
    try {
        const corpoOriginal = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
        const envelope = JSON.parse(corpoOriginal);
        const inicioVerificacao = Date.now();
        await verificarPedidoAlexa(req.headers, corpoOriginal, envelope);
        console.log(`📨 Alexa: verificacao levou ${Date.now() - inicioVerificacao} ms`);
        const resposta = await skillAlexa.invoke(envelope);
        const tipoPedido = envelope.request ? envelope.request.type : '?';
        const nomeIntencao = envelope.request && envelope.request.intent ? envelope.request.intent.name : '';
        const falaEnviada = resposta.response && resposta.response.outputSpeech ? resposta.response.outputSpeech.ssml : '(sem fala)';
        const vaiFechar = resposta.response ? resposta.response.shouldEndSession : '?';
        console.log(`📨 Alexa: pedido=${tipoPedido} ${nomeIntencao} | fala=${falaEnviada} | fechar=${vaiFechar}`);
        res.json(resposta);
        console.log(`📨 Alexa: respondi em ${Date.now() - inicio} ms`);
    } catch (erro) {
        console.warn(`📨 Alexa: pedido recusado (${erro.message}) em ${Date.now() - inicio} ms`);
        res.status(400).json({ erro: 'pedido invalido' });
    }
});

app.use(express.static(path.join(__dirname, 'public'))); 
app.use(express.urlencoded({ extended: true })); 
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

const sessionMiddleware = session({ secret: 'flowpack_chave_secreta', resave: false, saveUninitialized: false });
app.use(sessionMiddleware);

console.log(`🔌 Tentando conectar ao broker MQTT em: ${MQTT_BROKER} ...`);
const mqttClient = mqtt.connect(MQTT_BROKER);

mqttClient.on('connect', () => {
    console.log('✅ Conectado ao Broker MQTT com sucesso!');
    mqttClient.subscribe([MQTT_TOPIC_DISP_STATUS, MQTT_TOPIC_DISP_ESTADO, MQTT_TOPIC_DISP_CONCLUIDO]);
    mqttClient.subscribe(['esteira/botao']);
    mqttClient.subscribe(['separador/status', 'separador/estado']);
    setTimeout(separadorPublicarConfig, 600);

    mqttClient.subscribe(Object.values(MOTORES_SELAGEM).flatMap(m => [m.topicoAtual, m.topicoSentidoAtual]).concat([MQTT_TOPIC_SELAGEM2_MOTOR_STATUS, MQTT_TOPIC_SELAGEM1_MOTOR_STATUS]));
    io.emit('novo_log_servidor', { hora: horaAtualCurta(), texto: 'Broker MQTT conectado com sucesso.', tipo: 'sistema' });
    mqttClient.subscribe([
        MQTT_TOPIC_ATUAL,
        MQTT_TOPIC_STATUS,
        MQTT_TOPIC_SENTIDO_ATUAL,
        MQTT_TOPIC_SELAGEM_DADOS,
        MQTT_TOPIC_SELAGEM_STATUS,
        MQTT_TOPIC_SELAGEM2_DADOS,
        MQTT_TOPIC_SELAGEM2_STATUS
    ], (err) => {
        if (err) console.error('❌ Erro ao se inscrever nos tópicos:', err.message);
    });
});

mqttClient.on('error', (erro) => {
    console.error('❌ ERRO DE CONEXÃO MQTT:', erro.message);
    io.emit('novo_log_servidor', { hora: horaAtualCurta(), texto: `Erro de conexão MQTT: ${erro.message}`, tipo: 'sistema' });
});
mqttClient.on('reconnect', () => {
    console.log('🔄 Tentando reconectar ao broker MQTT...');
    io.emit('novo_log_servidor', { hora: horaAtualCurta(), texto: 'Tentando reconectar ao broker MQTT...', tipo: 'sistema' });
});
mqttClient.on('offline', () => {
    console.log('⚠️  Cliente MQTT ficou OFFLINE.');
    io.emit('novo_log_servidor', { hora: horaAtualCurta(), texto: 'Cliente MQTT ficou OFFLINE.', tipo: 'sistema' });
});

// NOVO: guarda quando foi a ÚLTIMA vez que cada aparelho mandou
// QUALQUER mensagem — usado pro watchdog abaixo detectar desconexão
// física real, mesmo sem aviso educado do ESP32
let ultimaMsgEsteira = 0;
let ultimaMsgSelagem1 = 0;
let ultimaMsgSelagem2 = 0;

mqttClient.on('message', (topic, message) => {
    const valor = message.toString();
    if (topic === 'esteira/botao') receitasTratarBotao(valor);
    if (topic.startsWith('separador/')) separadorTratarMqtt(topic, valor);
    // Dispenser (ESP32 proprio)
    if (topic === MQTT_TOPIC_DISP_STATUS || topic === MQTT_TOPIC_DISP_ESTADO || topic === MQTT_TOPIC_DISP_CONCLUIDO) ultimaMsgDispenser = Date.now();
    if (topic === MQTT_TOPIC_DISP_STATUS) {
        const novoStatus = (valor === 'online');
        if (novoStatus !== dispenserOnline) {
            dispenserOnline = novoStatus;
            if (!novoStatus) liberarMotoresDispenser();
            registrarLogDispenser(`ESP32 do Dispenser ficou ${novoStatus ? 'ONLINE' : 'OFFLINE'} na rede.`);
            emitirEstadoDispenser(true);
        }
    }
    if (topic === MQTT_TOPIC_DISP_ESTADO) {
        try {
            const d = JSON.parse(valor);
            [1, 2].forEach(n => {
                const m = d['m' + n];
                if (m) dispenserMotores[n] = { ocupado: !!m.ocupado, restantes: Number(m.restantes) || 0 };
            });
            if (!dispenserOnline) {
                dispenserOnline = true;
                registrarLogDispenser('ESP32 do Dispenser voltou a responder (ONLINE).');
            }
            emitirEstadoDispenser(false);
        } catch (e) { /* mensagem incompleta: ignora */ }
    }
    if (topic === MQTT_TOPIC_DISP_CONCLUIDO) {
        try {
            const d = JSON.parse(valor);
            registrarLogDispenser(`Dispenser: motor ${d.motor} concluiu ${d.quartos} quarto(s) de volta.`);
            io.emit('dispenser_concluido', d);
        } catch (e) { /* ignora */ }
    }


    // Painel de Controle: velocidade e sentido dos motores das selagens
    for (const [id, m] of Object.entries(MOTORES_SELAGEM)) {
        if (topic === m.topicoAtual) {
            m.velocidade = valor;
            io.emit('motor_selagem_velocidade', { id, velocidade: valor });
        }
        if (topic === m.topicoSentidoAtual) {
            m.sentido = valor === 'invertido' ? 'invertido' : 'normal';
            io.emit('motor_selagem_sentido', { id, sentido: m.sentido });
        }
    }
    if (topic.startsWith('selagem/motor')) ultimaMsgSelagem1Motor = Date.now();   // inclui selagem/motores/status
    if (topic.startsWith('selagem2/motor')) ultimaMsgSelagem2Motor = Date.now();

    // ESP32 dos motores da selagem 1 (separado do aquecimento)
    if (topic === MQTT_TOPIC_SELAGEM1_MOTOR_STATUS) {
        const novoStatus = (valor === 'online');
        if (novoStatus !== selagem1MotorOnline) {
            selagem1MotorOnline = novoStatus;
            io.emit('status_selagem1motor', { online: novoStatus });
            io.emit('novo_log_servidor', { hora: horaAtualCurta(), texto: `ESP32 dos Motores da Selagem 1 ficou ${novoStatus ? 'ONLINE' : 'OFFLINE'} na rede.`, tipo: 'sistema' });
        }
    }
    if ((topic === MOTORES_SELAGEM.s1m1.topicoAtual || topic === MOTORES_SELAGEM.s1m2.topicoAtual) && !selagem1MotorOnline) {
        selagem1MotorOnline = true;
        io.emit('status_selagem1motor', { online: true });
        io.emit('novo_log_servidor', { hora: horaAtualCurta(), texto: 'ESP32 dos Motores da Selagem 1 voltou a responder (ONLINE).', tipo: 'sistema' });
    }

    // ESP32 do motor da selagem 2 (separado do aquecimento)
    if (topic === MQTT_TOPIC_SELAGEM2_MOTOR_STATUS) {
        const novoStatus = (valor === 'online');
        if (novoStatus !== selagem2MotorOnline) {
            selagem2MotorOnline = novoStatus;
            io.emit('status_selagem2motor', { online: novoStatus });
            io.emit('novo_log_servidor', { hora: horaAtualCurta(), texto: `ESP32 do Motor da Selagem 2 ficou ${novoStatus ? 'ONLINE' : 'OFFLINE'} na rede.`, tipo: 'sistema' });
        }
    }
    if (topic === MOTORES_SELAGEM.s2m.topicoAtual && !selagem2MotorOnline) {
        selagem2MotorOnline = true;
        io.emit('status_selagem2motor', { online: true });
        io.emit('novo_log_servidor', { hora: horaAtualCurta(), texto: 'ESP32 do Motor da Selagem 2 voltou a responder (ONLINE).', tipo: 'sistema' });
    }

    // Se o sinal de vida voltou depois de uma queda, volta a ficar online sozinho
    if (topic === MQTT_TOPIC_ATUAL && !esp32Online) {
        esp32Online = true;
        io.emit('status_esp32', { online: true });
        io.emit('novo_log_servidor', { hora: horaAtualCurta(), texto: 'ESP32 da Esteira voltou a responder (ONLINE).', tipo: 'sistema' });
    }
    if (topic === MQTT_TOPIC_SELAGEM_DADOS && !selagemOnline) {
        selagemOnline = true;
        io.emit('status_selagem', { online: true });
        io.emit('novo_log_servidor', { hora: horaAtualCurta(), texto: 'ESP32 da Selagem 1 voltou a responder (ONLINE).', tipo: 'sistema' });
    }
    if (topic === MQTT_TOPIC_SELAGEM2_DADOS && !selagem2Online) {
        selagem2Online = true;
        io.emit('status_selagem2', { online: true });
        io.emit('novo_log_servidor', { hora: horaAtualCurta(), texto: 'ESP32 da Selagem 2 voltou a responder (ONLINE).', tipo: 'sistema' });
    }

    if (topic === MQTT_TOPIC_ATUAL || topic === MQTT_TOPIC_STATUS) ultimaMsgEsteira = Date.now();
    if (topic === MQTT_TOPIC_SELAGEM_DADOS || topic === MQTT_TOPIC_SELAGEM_STATUS) ultimaMsgSelagem1 = Date.now();
    if (topic === MQTT_TOPIC_SELAGEM2_DADOS || topic === MQTT_TOPIC_SELAGEM2_STATUS) ultimaMsgSelagem2 = Date.now();

    if (topic === MQTT_TOPIC_SENTIDO_ATUAL) {
        const novoSentido = valor === 'invertido' ? 'invertido' : 'normal';
        if (novoSentido !== sentidoEsteira) {
            sentidoEsteira = novoSentido;
            io.emit('sentido_esteira', { sentido: sentidoEsteira });
        }
    }

    if (topic === MQTT_TOPIC_ATUAL) {
        ultimaVelocidadeConhecida = valor;
        try { io.emit('atualizar_velocidade', { velocidade: valor }); } catch (e) {}
    }

    if (topic === MQTT_TOPIC_STATUS) {
        const novoStatus = (valor === 'online');
        if (novoStatus !== esp32Online) {
            esp32Online = novoStatus;
            io.emit('status_esp32', { online: esp32Online });
            io.emit('novo_log_servidor', { hora: horaAtualCurta(), texto: `ESP32 da Esteira ficou ${novoStatus ? 'ONLINE' : 'OFFLINE'}.`, tipo: 'sistema' });
        }
    }

    if (topic === MQTT_TOPIC_SELAGEM_DADOS) {
        try {
            const dados = JSON.parse(valor);
            ultimoEstadoSelagem = dados;
            io.emit('atualizar_temperatura', dados);

            if (dados.seguranca !== 'ok' && dados.seguranca !== ultimaSegurancaSelagemAvisada) {
                const hora = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
                const textoAlerta = dados.seguranca === 'temperatura_alta'
                    ? `⚠️ AVISO: Temperatura da selagem 1 muito alta (${dados.temperatura}°C).`
                    : `⚠️ AVISO: Falha na leitura do sensor da selagem 1 (usando a última leitura válida).`;

                const logCritico = { hora, texto: textoAlerta, classe: 'text-red-600 font-bold', usuario: 'Sistema (Selagem 1)', tipo: 'temperatura_critica' };
                salvarLogNoArquivoDoDia(logCritico);
                io.emit('novo_log_servidor', logCritico);
            }
            if (dados.seguranca === 'ok' && ultimaSegurancaSelagemAvisada && ultimaSegurancaSelagemAvisada !== 'ok') {
                io.emit('novo_log_servidor', { hora: horaAtualCurta(), texto: 'Selagem 1 voltou ao normal, aviso resolvido.', tipo: 'temperatura' });
            }
            ultimaSegurancaSelagemAvisada = dados.seguranca;
        } catch (e) {
            console.error('Erro ao interpretar dados da selagem 1:', e.message);
        }
    }

    if (topic === MQTT_TOPIC_SELAGEM_STATUS) {
        const novoStatus = (valor === 'online');
        if (novoStatus !== selagemOnline) {
            selagemOnline = novoStatus;
            io.emit('status_selagem', { online: selagemOnline });
            io.emit('novo_log_servidor', { hora: horaAtualCurta(), texto: `ESP32 da Selagem 1 ficou ${novoStatus ? 'ONLINE' : 'OFFLINE'} na rede.`, tipo: 'sistema' });
        }
    }

    if (topic === MQTT_TOPIC_SELAGEM2_DADOS) {
        try {
            const dados = JSON.parse(valor);
            ultimoEstadoSelagem2 = dados;
            io.emit('atualizar_temperatura2', dados);

            if (dados.seguranca !== 'ok' && dados.seguranca !== ultimaSegurancaSelagem2Avisada) {
                const hora = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
                const textoAlerta = dados.seguranca === 'temperatura_alta'
                    ? `⚠️ AVISO: Temperatura da selagem 2 muito alta (${dados.temperatura}°C).`
                    : `⚠️ AVISO: Falha na leitura do sensor da selagem 2 (usando a última leitura válida).`;

                const logCritico = { hora, texto: textoAlerta, classe: 'text-red-600 font-bold', usuario: 'Sistema (Selagem 2)', tipo: 'temperatura_critica' };
                salvarLogNoArquivoDoDia(logCritico);
                io.emit('novo_log_servidor', logCritico);
            }
            if (dados.seguranca === 'ok' && ultimaSegurancaSelagem2Avisada && ultimaSegurancaSelagem2Avisada !== 'ok') {
                io.emit('novo_log_servidor', { hora: horaAtualCurta(), texto: 'Selagem 2 voltou ao normal, aviso resolvido.', tipo: 'temperatura' });
            }
            ultimaSegurancaSelagem2Avisada = dados.seguranca;
        } catch (e) {
            console.error('Erro ao interpretar dados da selagem 2:', e.message);
        }
    }

    if (topic === MQTT_TOPIC_SELAGEM2_STATUS) {
        const novoStatus = (valor === 'online');
        if (novoStatus !== selagem2Online) {
            selagem2Online = novoStatus;
            io.emit('status_selagem2', { online: selagem2Online });
            io.emit('novo_log_servidor', { hora: horaAtualCurta(), texto: `ESP32 da Selagem 2 ficou ${novoStatus ? 'ONLINE' : 'OFFLINE'} na rede.`, tipo: 'sistema' });
        }
    }
});

// NOVO: WATCHDOG DE CONEXÃO REAL — a cada 3s, verifica se cada aparelho
// ainda está "vivo" de verdade. Se nenhuma mensagem chegar dentro do
// limite (mesmo que o status antigo ainda diga "online"), força offline
// sozinho. Isso corrige o botão de recarregar mentir quando alguém
// desliga a energia sem avisar educadamente antes.
const LIMITE_ESTEIRA_MS = 8000;
const LIMITE_SELAGEM_MS = 4000;

setInterval(() => {
    const agora = Date.now();

    if (esp32Online && (agora - ultimaMsgEsteira) > LIMITE_ESTEIRA_MS) {
        esp32Online = false;
        io.emit('status_esp32', { online: false });
        io.emit('novo_log_servidor', { hora: horaAtualCurta(), texto: 'ESP32 da Esteira parou de responder — marcado como OFFLINE.', tipo: 'sistema' });
    }
    if (selagemOnline && (agora - ultimaMsgSelagem1) > LIMITE_SELAGEM_MS) {
        selagemOnline = false;
        io.emit('status_selagem', { online: false });
        io.emit('novo_log_servidor', { hora: horaAtualCurta(), texto: 'ESP32 da Selagem 1 parou de responder — marcado como OFFLINE.', tipo: 'sistema' });
    }
    if (selagem2Online && (agora - ultimaMsgSelagem2) > LIMITE_SELAGEM_MS) {
        selagem2Online = false;
        io.emit('status_selagem2', { online: false });
        io.emit('novo_log_servidor', { hora: horaAtualCurta(), texto: 'ESP32 da Selagem 2 parou de responder — marcado como OFFLINE.', tipo: 'sistema' });
    }
}, 3000);

// PAINEL DE CONTROLE: quando um ESP32 cai, os valores dele voltam pra 0
// (ele reinicia parado). Enquanto estiver conectado, o ultimo valor fica salvo.
let estadoOnlineAnterior = { esteira: false, selagem1: false, selagem2: false, selagem2motor: false, selagem1motor: false };
setInterval(() => {
    // Vigia do ESP32 dos motores da selagem 1: sem sinal de vida por 8s, fica offline
    if (selagem1MotorOnline && (Date.now() - ultimaMsgSelagem1Motor) > 8000) {
        selagem1MotorOnline = false;
        io.emit('status_selagem1motor', { online: false });
        io.emit('novo_log_servidor', { hora: horaAtualCurta(), texto: 'ESP32 dos Motores da Selagem 1 parou de responder, marcado como OFFLINE.', tipo: 'sistema' });
    }

    // Vigia do ESP32 do motor da selagem 2: sem sinal de vida por 8s, fica offline
    if (selagem2MotorOnline && (Date.now() - ultimaMsgSelagem2Motor) > 8000) {
        selagem2MotorOnline = false;
        io.emit('status_selagem2motor', { online: false });
        io.emit('novo_log_servidor', { hora: horaAtualCurta(), texto: 'ESP32 do Motor da Selagem 2 parou de responder, marcado como OFFLINE.', tipo: 'sistema' });
    }

    const agoraOnline = { esteira: esp32Online, selagem1: selagemOnline, selagem2: selagem2Online, selagem2motor: selagem2MotorOnline, selagem1motor: selagem1MotorOnline };

    if (estadoOnlineAnterior.esteira && !agoraOnline.esteira) {
        ultimaVelocidadeConhecida = '0.00';
        io.emit('atualizar_velocidade', { velocidade: '0.00' });
    }

    ['selagem1', 'selagem2', 'selagem2motor', 'selagem1motor'].forEach(dispositivo => {
        if (!(estadoOnlineAnterior[dispositivo] && !agoraOnline[dispositivo])) return;

        Object.entries(MOTORES_SELAGEM).forEach(([id, m]) => {
            if (m.dispositivo === dispositivo) {
                m.velocidade = '0.00';
                io.emit('motor_selagem_velocidade', { id, velocidade: '0.00' });
            }
        });

        if (dispositivo === 'selagem1' || dispositivo === 'selagem2') {
            const estado = dispositivo === 'selagem1' ? ultimoEstadoSelagem : ultimoEstadoSelagem2;
            estado.setpoint = 0;
            estado.potencia = 0;
            estado.habilitado = false;
            io.emit(dispositivo === 'selagem1' ? 'atualizar_temperatura' : 'atualizar_temperatura2', estado);
        }
    });

    estadoOnlineAnterior = agoraOnline;
}, 1000);

// --- MIDDLEWARES DE ACESSO ---
function loginObrigatorio(req, res, next) {
    const usuarioAtivo = req.session.usuario || req.cookies.lembrar_usuario;
    if (!usuarioAtivo) return res.redirect('/');

    const usuarios = carregarUsuarios();
    const dadosUsuario = usuarios[usuarioAtivo];

    if (!dadosUsuario) {
        req.session.destroy(() => {});
        res.clearCookie('lembrar_usuario');
        return res.redirect('/');
    }

    res.locals.usuarioLogado = usuarioAtivo;
    res.locals.nivelUsuario = dadosUsuario.nivel;
    res.locals.nomeNivelUsuario = nomeNivel(dadosUsuario.nivel);
    res.locals.isDono = dadosUsuario.nivel === NIVEL_DONO;
    res.locals.isAdmin = dadosUsuario.nivel === NIVEL_DONO || dadosUsuario.nivel === NIVEL_ADM;
    res.locals.acessibilidadeAtiva = !!dadosUsuario.acessibilidade;
    res.locals.tutorialObrigatorio = !dadosUsuario.tutorialVisto;
    res.locals.permissoes = permissoesEfetivas(dadosUsuario);
    next();
}

// Bloqueia a tela (ou a API da tela) se o usuário não tiver essa permissão.
function paginaPermitida(pagina) {
    return (req, res, next) => {
        if (res.locals.permissoes && res.locals.permissoes[pagina]) return next();
        if (req.path.startsWith('/api/')) return res.status(403).json({ erro: 'Você não tem permissão para acessar esta área.' });
        return res.status(403).send('Acesso negado. Você não tem permissão para acessar esta tela. Fale com um administrador.');
    };
}

function adminObrigatorio(req, res, next) {
    if (!res.locals.isAdmin) {
        return res.status(403).send('Acesso negado. Esta área é restrita a administradores.');
    }
    next();
}

function donoObrigatorio(req, res, next) {
    if (!res.locals.isDono) {
        return res.status(403).json({ erro: 'Esta ação é restrita ao Dono do sistema.' });
    }
    next();
}

// --- ROTAS ---
app.all('/', (req, res) => {
    if (req.cookies.lembrar_usuario || req.session.logado) return res.redirect('/dashboard');

    if (req.method === 'POST') {
        const usuarios = carregarUsuarios();
        const chaveEncontrada = encontrarChaveUsuarioIgnorandoCase(usuarios, req.body.username);
        const usuario = chaveEncontrada ? usuarios[chaveEncontrada] : null;

        if (usuario && verificarSenha(req.body.password, usuario.salt, usuario.hash)) {
            req.session.logado = true;
            req.session.usuario = chaveEncontrada;

            if (req.body.remember) {
                res.cookie('lembrar_usuario', chaveEncontrada, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true });
            }

            registrarLogDeAcesso(chaveEncontrada, 'login');

            return res.redirect('/dashboard');
        } else {
            return res.render('login.html', { erro: 'Usuário ou senha incorretos!' });
        }
    }
    res.render('login.html');
});

app.post('/mudar-senha', loginObrigatorio, (req, res) => {
    const usuarios = carregarUsuarios();
    const usuario = usuarios[res.locals.usuarioLogado];

    if (usuario && verificarSenha(req.body.senha_antiga, usuario.salt, usuario.hash)) {
        const { salt, hash } = gerarHashSenha(req.body.senha_nova);
        usuario.salt = salt;
        usuario.hash = hash;
        salvarUsuarios(usuarios);
        res.render('configuracoes.html', { sucesso: 'Senha atualizada com sucesso!' });
    } else {
        res.render('configuracoes.html', { erro: 'A senha atual está incorreta!' });
    }
});

app.get('/dashboard', loginObrigatorio, (req, res) => res.render('dashboard.html'));
app.get('/graficos', loginObrigatorio, paginaPermitida('graficos'), (req, res) => res.render('graficos.html'));
app.get('/relatorios', loginObrigatorio, paginaPermitida('relatorios'), (req, res) => res.render('relatorios.html'));
app.get('/configuracoes', loginObrigatorio, (req, res) => res.render('configuracoes.html'));
app.get('/chat', loginObrigatorio, paginaPermitida('chat'), (req, res) => res.render('chat.html'));
app.get('/controle', loginObrigatorio, adminObrigatorio, (req, res) => res.render('controle.html'));
app.get('/logs', loginObrigatorio, paginaPermitida('logs'), (req, res) => res.render('logs.html'));
app.get('/usuarios', loginObrigatorio, adminObrigatorio, (req, res) => res.render('usuarios.html'));
app.get('/visao', loginObrigatorio, paginaPermitida('visao'), (req, res) => res.render('visao.html'));

app.get('/logout', (req, res) => {
    const usuarioQueSaiu = req.session.usuario || req.cookies.lembrar_usuario;

    if (usuarioQueSaiu) {
        registrarLogDeAcesso(usuarioQueSaiu, 'logout');
    }

    req.session.destroy();
    res.clearCookie('lembrar_usuario');
    res.redirect('/');
});

// --- API DE GERENCIAMENTO DE USUÁRIOS ---
app.get('/api/usuarios', loginObrigatorio, adminObrigatorio, (req, res) => {
    const usuarios = carregarUsuarios();
    const lista = Object.keys(usuarios).map(nome => ({
        usuario: nome,
        nivel: usuarios[nome].nivel,
        nomeNivel: nomeNivel(usuarios[nome].nivel),
        acessibilidade: !!usuarios[nome].acessibilidade,
        permissoes: permissoesEfetivas(usuarios[nome])
    }));
    res.json({ usuarios: lista, paginas: PAGINAS_CONFIGURAVEIS });
});

// Define quais telas um Operário pode acessar (Dono ou Administrador).
app.post('/api/usuarios/:usuario/permissoes', loginObrigatorio, adminObrigatorio, (req, res) => {
    const usuarios = carregarUsuarios();
    const alvo = usuarios[req.params.usuario];

    if (!alvo) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    if (alvo.nivel !== NIVEL_OPERARIO) {
        return res.status(400).json({ erro: 'Só é possível restringir telas de usuários Operário.' });
    }

    const recebidas = (req.body && req.body.permissoes) || {};
    const novas = {};
    Object.keys(PAGINAS_CONFIGURAVEIS).forEach(pagina => {
        novas[pagina] = typeof recebidas[pagina] === 'boolean' ? recebidas[pagina] : permissoesEfetivas(alvo)[pagina];
    });

    alvo.permissoes = novas;
    salvarUsuarios(usuarios);
    res.json({ sucesso: true, permissoes: novas });
});

app.post('/api/usuarios', loginObrigatorio, adminObrigatorio, (req, res) => {
    const { usuario, senha, nivel, acessibilidade } = req.body;

    if (!usuario || !senha) {
        return res.status(400).json({ erro: 'Usuário e senha são obrigatórios.' });
    }
    if (senha.length < 4) {
        return res.status(400).json({ erro: 'A senha deve ter pelo menos 4 caracteres.' });
    }

    const nivelSolicitado = parseInt(nivel, 10);
    if (!nivelValido(nivelSolicitado)) {
        return res.status(400).json({ erro: 'Nível de usuário inválido.' });
    }

    if (!res.locals.isDono && nivelSolicitado !== NIVEL_OPERARIO) {
        return res.status(403).json({ erro: 'Administradores só podem cadastrar usuários no nível Operário.' });
    }

    const usuarios = carregarUsuarios();
    const chave = usuario.trim();

    if (encontrarChaveUsuarioIgnorandoCase(usuarios, chave)) {
        return res.status(400).json({ erro: 'Este usuário já existe.' });
    }

    const { salt, hash } = gerarHashSenha(senha);
    // Todo usuário recém-criado começa com tutorialVisto: false — no
    // primeiro login dele, o tutorial abre sozinho, obrigatoriamente.
    usuarios[chave] = { salt, hash, nivel: nivelSolicitado, acessibilidade: !!acessibilidade, tutorialVisto: false };
    salvarUsuarios(usuarios);

    res.json({ sucesso: true });
});

app.post('/api/usuarios/:usuario/senha', loginObrigatorio, adminObrigatorio, (req, res) => {
    const usuarios = carregarUsuarios();
    const alvo = usuarios[req.params.usuario];

    if (!alvo) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    if (!req.body.senha || req.body.senha.length < 4) {
        return res.status(400).json({ erro: 'A nova senha deve ter pelo menos 4 caracteres.' });
    }

    if (!res.locals.isDono && alvo.nivel <= res.locals.nivelUsuario) {
        return res.status(403).json({ erro: 'Você só pode alterar a senha de usuários com nível abaixo do seu.' });
    }

    const { salt, hash } = gerarHashSenha(req.body.senha);
    alvo.salt = salt;
    alvo.hash = hash;
    salvarUsuarios(usuarios);

    res.json({ sucesso: true });
});

app.post('/api/usuarios/:usuario/nivel', loginObrigatorio, donoObrigatorio, (req, res) => {
    const usuarios = carregarUsuarios();
    const alvo = usuarios[req.params.usuario];

    if (!alvo) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    const novoNivel = parseInt(req.body.nivel, 10);
    if (!nivelValido(novoNivel)) {
        return res.status(400).json({ erro: 'Nível de usuário inválido.' });
    }

    if (req.params.usuario === res.locals.usuarioLogado && novoNivel !== NIVEL_DONO) {
        const totalDonos = Object.values(usuarios).filter(u => u.nivel === NIVEL_DONO).length;
        if (totalDonos <= 1) {
            return res.status(400).json({ erro: 'Não é possível rebaixar o último Dono do sistema.' });
        }
    }

    alvo.nivel = novoNivel;
    salvarUsuarios(usuarios);

    res.json({ sucesso: true });
});

app.delete('/api/usuarios/:usuario', loginObrigatorio, donoObrigatorio, (req, res) => {
    const usuarios = carregarUsuarios();
    const alvo = req.params.usuario;

    if (!usuarios[alvo]) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    if (alvo === res.locals.usuarioLogado) {
        return res.status(400).json({ erro: 'Você não pode remover a si mesmo enquanto está logado.' });
    }

    const totalDonos = Object.values(usuarios).filter(u => u.nivel === NIVEL_DONO).length;
    if (usuarios[alvo].nivel === NIVEL_DONO && totalDonos <= 1) {
        return res.status(400).json({ erro: 'Não é possível remover o último Dono do sistema.' });
    }

    delete usuarios[alvo];
    salvarUsuarios(usuarios);

    res.json({ sucesso: true });
});

app.post('/api/usuario/acessibilidade', loginObrigatorio, (req, res) => {
    const usuarios = carregarUsuarios();
    const usuario = usuarios[res.locals.usuarioLogado];

    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    usuario.acessibilidade = !!req.body.ativo;
    salvarUsuarios(usuarios);

    res.json({ sucesso: true, ativo: usuario.acessibilidade });
});

// Marca que esse usuário já viu o tutorial — chamado automaticamente
// quando o tutorial termina ou é pulado, pra nunca mais forçar de novo.
app.post('/api/usuario/tutorial-visto', loginObrigatorio, (req, res) => {
    const usuarios = carregarUsuarios();
    const usuario = usuarios[res.locals.usuarioLogado];

    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    usuario.tutorialVisto = true;
    salvarUsuarios(usuarios);

    res.json({ sucesso: true });
});

// --- API DO CHAT ---
app.get('/api/chat/historico', loginObrigatorio, paginaPermitida('chat'), (req, res) => {
    const usuario = res.locals.usuarioLogado;
    res.json(historicosChat[usuario] || []);
});

const REGEX_SAUDACAO = /^((oi+|ola+|opa|e ai|eai|eae|salve|fala|bom dia|boa tarde|boa noite|tudo bem|tudo bom|tudo certo|beleza|blz|como vai|como voce esta)[\s!?.,]*)+$/;
const RESPOSTAS_SAUDACAO = [
    'Oi! Em que posso te ajudar?',
    'Olá! Do que você precisa?',
    'Oi, tudo certo por aqui. Como posso ajudar?',
    'E aí! Posso te ajudar com alguma coisa?'
];

function respostaQuandoApiFalha(pergunta) {
    const local = buscarMelhorRespostaLocal(pergunta);
    if (RESPOSTAS_NAO_SEI.includes(local)) {
        return 'Minha conexão com a IA online oscilou agora e não consegui responder. Pode repetir a pergunta?';
    }
    return local;
}

app.post('/api/chat', loginObrigatorio, paginaPermitida('chat'), async (req, res) => {
    const usuario = res.locals.usuarioLogado;
    const perguntaRecebida = (req.body.pergunta || '').trim();
    if (!historicosChat[usuario]) historicosChat[usuario] = [];

    const perguntaNormalizada = perguntaRecebida.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    let respostaFinal;

    if (REGEX_SAUDACAO.test(perguntaNormalizada)) {
        respostaFinal = sortear(RESPOSTAS_SAUDACAO);
    } else if (NVIDIA_API_KEY) {
        try {
            const contexto = montarContextoRAG(perguntaRecebida);
            const dadosAoVivo = montarContextoAoVivo();
            const promptSistema = `${PROMPT_SISTEMA_BASE}\n\nDADOS AO VIVO DA MÁQUINA (agora mesmo):\n${dadosAoVivo}\n\nContexto adicional da base de conhecimento (pode ou não ser relevante pra esta pergunta):\n${contexto}`;
            const historico = historicosChat[usuario].slice(-4).flatMap(item => [
                { role: 'user', content: item.pergunta },
                { role: 'assistant', content: item.resposta }
            ]);
            respostaFinal = await perguntarNvidia(promptSistema, perguntaRecebida, historico);
        } catch (erro) {
            console.error('⚠️  IA online falhou:', erro.message);
            respostaFinal = respostaQuandoApiFalha(perguntaRecebida);
        }
    } else {
        respostaFinal = buscarMelhorRespostaLocal(perguntaRecebida);
    }

    const hora = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    const parId = gerarIdMensagem();

    if (!historicosChat[usuario]) historicosChat[usuario] = [];
    historicosChat[usuario].push({ parId, hora, pergunta: perguntaRecebida, resposta: respostaFinal });

    res.json({ resposta: respostaFinal, parId, hora });
});

app.delete('/api/chat/mensagem/:parId', loginObrigatorio, paginaPermitida('chat'), (req, res) => {
    const usuario = res.locals.usuarioLogado;
    if (!historicosChat[usuario]) return res.json({ sucesso: true });

    historicosChat[usuario] = historicosChat[usuario].filter(item => item.parId !== req.params.parId);
    res.json({ sucesso: true });
});

app.delete('/api/chat/limpar', loginObrigatorio, paginaPermitida('chat'), (req, res) => {
    const usuario = res.locals.usuarioLogado;
    historicosChat[usuario] = [];
    res.json({ sucesso: true });
});

// --- API DA VISÃO COMPUTACIONAL ---
app.get('/api/visao/config', loginObrigatorio, adminObrigatorio, (req, res) => {
    res.json(configVisao);
});

app.post('/api/visao/config', loginObrigatorio, adminObrigatorio, (req, res) => {
    const { ip, porta, caminho, zonaInicio, zonaFim, limiar, intervaloMs, usarIaVisao } = req.body;

    configVisao = {
        ip: (ip || '').trim(),
        porta: parseInt(porta) || 80,
        caminho: caminho && caminho.trim() ? caminho.trim() : '/cam-lo.jpg',
        zonaInicio: Math.min(Math.max(parseFloat(zonaInicio) || 0.4, 0), 0.9),
        zonaFim: Math.min(Math.max(parseFloat(zonaFim) || 0.6, 0.1), 1),
        limiar: Math.max(parseFloat(limiar) || 25, 1),
        intervaloMs: Math.max(parseInt(intervaloMs) || 400, 150),
        usarIaVisao: !!usarIaVisao
    };

    salvarConfigVisao(configVisao);
    frameAnteriorMedia = null;
    estadoContagemVisao = 'aguardando';
    contadorFramesObjeto = 0;

    res.json({ sucesso: true, config: configVisao });
});

app.get('/api/visao/status', loginObrigatorio, (req, res) => {
    res.json({ online: cameraOnline, contagemHoje: obterContagemHojeVisao(), config: configVisao });
});

app.get('/api/producao/visao/historico', loginObrigatorio, (req, res) => {
    if (fs.existsSync(arquivoProducaoVisao)) res.json(JSON.parse(fs.readFileSync(arquivoProducaoVisao, 'utf-8')));
    else res.json({});
});

app.get('/api/producao/visao/por-produto-hoje', loginObrigatorio, (req, res) => {
    res.json(obterContagemPorProdutoHoje());
});

app.get('/api/visao/verificacoes', loginObrigatorio, (req, res) => {
    res.json(historicoVerificacoesIA);
});

// --- API DOS PRODUTOS DE REFERÊNCIA ---
app.get('/api/visao/produtos', loginObrigatorio, (req, res) => {
    res.json(produtosReferenciaCache.map(p => ({ id: p.id, nome: p.nome, imagem: p.base64 })));
});

app.post('/api/visao/produtos', loginObrigatorio, adminObrigatorio, uploadMemoria.single('foto'), async (req, res) => {
    try {
        const nome = (req.body.nome || '').trim();

        if (!nome) {
            return res.status(400).json({ erro: 'Informe um nome para o produto.' });
        }
        if (!req.file) {
            return res.status(400).json({ erro: 'Envie uma foto do produto.' });
        }

        const produto = await adicionarProdutoReferencia(nome, req.file.buffer);
        res.json({ sucesso: true, produto });

    } catch (erro) {
        console.error('Erro ao adicionar produto de referência:', erro.message);
        res.status(500).json({ erro: 'Não foi possível processar a foto enviada.' });
    }
});

app.post('/api/visao/produtos/capturar', loginObrigatorio, adminObrigatorio, async (req, res) => {
    try {
        const nome = (req.body.nome || '').trim();
        const imagemBase64 = req.body.imagemBase64;

        if (!nome) {
            return res.status(400).json({ erro: 'Informe um nome para o produto.' });
        }
        if (!imagemBase64) {
            return res.status(400).json({ erro: 'Nenhuma foto foi capturada da câmera ainda.' });
        }

        const buffer = Buffer.from(imagemBase64, 'base64');
        const produto = await adicionarProdutoReferencia(nome, buffer);
        res.json({ sucesso: true, produto });

    } catch (erro) {
        console.error('Erro ao capturar produto de referência da câmera:', erro.message);
        res.status(500).json({ erro: 'Não foi possível processar a foto capturada.' });
    }
});

app.delete('/api/visao/produtos/:id', loginObrigatorio, adminObrigatorio, (req, res) => {
    const removido = removerProdutoReferencia(req.params.id);
    if (!removido) return res.status(404).json({ erro: 'Produto não encontrado.' });
    res.json({ sucesso: true });
});

// --- ROTA DOS LOGS E DA PRODUÇÃO ---
app.get('/api/logs/:data', loginObrigatorio, (req, res) => {
    const arquivo = path.join(pastaLogs, `${req.params.data}.json`);
    if (fs.existsSync(arquivo)) res.json(JSON.parse(fs.readFileSync(arquivo, 'utf-8')));
    else res.json([]);
});

app.get('/api/producao/historico', loginObrigatorio, (req, res) => {
    if (fs.existsSync(arquivoProducao)) res.json(JSON.parse(fs.readFileSync(arquivoProducao, 'utf-8')));
    else res.json({});
});

app.get('/api/producao/pontos/:data', loginObrigatorio, (req, res) => {
    const arquivo = path.join(pastaProducaoDiaria, `${req.params.data}.json`);
    if (fs.existsSync(arquivo)) res.json(JSON.parse(fs.readFileSync(arquivo, 'utf-8')));
    else res.json([]);
});

// ================================================================================
// DISPENSER: pagina, API e vigia de conexao
// ================================================================================
setInterval(() => {
    if (dispenserOnline && (Date.now() - ultimaMsgDispenser) > 8000) {
        dispenserOnline = false;
        liberarMotoresDispenser();
        registrarLogDispenser('ESP32 do Dispenser parou de responder, marcado como OFFLINE.');
        emitirEstadoDispenser(true);
    }
}, 3000);

app.get('/dispenser', loginObrigatorio, paginaPermitida('dispenser'), (req, res) => res.render('dispenser.html'));

// ================================================================================
// RECEITAS (niveis de 50/100/150/200 g) + BOTOES FISICOS + MODELO 3D
// ================================================================================
const ARQ_RECEITAS = path.join(__dirname, 'receitas.json');
const RECEITAS_PADRAO = {
    botoesAtivos: true,
    atual: 0,
    niveis: [
        { gramas: 50,  esteira: 0.30, s1: 0.50, s2: 0.50, temp1: 120, temp2: 140 },
        { gramas: 100, esteira: 0.40, s1: 0.60, s2: 0.60, temp1: 125, temp2: 145 },
        { gramas: 150, esteira: 0.50, s1: 0.70, s2: 0.70, temp1: 130, temp2: 150 },
        { gramas: 200, esteira: 0.60, s1: 0.80, s2: 0.80, temp1: 135, temp2: 155 }
    ]
};

function receitasNormalizar(r) {
    const num = (v, min, max) => (v === null || v === undefined || v === '' || !isFinite(Number(v))) ? null : Math.min(Math.max(Number(v), min), max);
    const base = (r && Array.isArray(r.niveis) && r.niveis.length) ? r.niveis.slice(0, 8) : RECEITAS_PADRAO.niveis;
    const niveis = base.map((n, i) => ({
        gramas: Math.round(num(n.gramas, 10, 1000) || RECEITAS_PADRAO.niveis[Math.min(i, 3)].gramas),
        esteira: num(n.esteira, 0, 1), s1: num(n.s1, 0, 1), s2: num(n.s2, 0, 1),
        temp1: num(n.temp1, 0, 165), temp2: num(n.temp2, 0, 250)
    }));
    const atual = Math.min(Math.max(parseInt(r && r.atual, 10) || 0, 0), niveis.length - 1);
    return { botoesAtivos: !(r && r.botoesAtivos === false), atual, niveis };
}

let receitas = receitasNormalizar(RECEITAS_PADRAO);
try { receitas = receitasNormalizar(JSON.parse(fs.readFileSync(ARQ_RECEITAS, 'utf-8'))); } catch (e) {}
function receitasSalvar() { try { fs.writeFileSync(ARQ_RECEITAS, JSON.stringify(receitas, null, 2)); } catch (e) { console.warn('Receitas: nao consegui salvar:', e.message); } }

function receitasAplicar(indice, origem) {
    const n = receitas.niveis[indice];
    if (!n) return false;
    receitas.atual = indice;
    receitasSalvar();
    const fmt = (v) => Number(v).toFixed(2);
    if (n.esteira !== null) {
        mqttClient.publish(MQTT_TOPIC_SET, fmt(n.esteira));
        ultimaVelocidadeConhecida = fmt(n.esteira);
        try { io.emit('atualizar_velocidade', { velocidade: fmt(n.esteira) }); } catch (e) {}
    }
    const motor = (id, v) => {
        if (v === null || !MOTORES_SELAGEM[id]) return;
        mqttClient.publish(MOTORES_SELAGEM[id].topicoSet, fmt(v));
        MOTORES_SELAGEM[id].velocidade = fmt(v);
        io.emit('motor_selagem_velocidade', { id, velocidade: fmt(v) });
    };
    motor('s1m1', n.s1); motor('s1m2', n.s1); motor('s2m', n.s2);
    if (n.temp1 !== null) mqttClient.publish(MQTT_TOPIC_SELAGEM_SET, String(n.temp1));
    if (n.temp2 !== null) mqttClient.publish(MQTT_TOPIC_SELAGEM2_SET, String(n.temp2));
    io.emit('receita_atual', { indice, niveis: receitas.niveis, origem });
    io.emit('novo_log_servidor', { hora: horaAtualCurta(), texto: `Receita de ${n.gramas} g aplicada (${origem}).`, tipo: 'sistema' });
    try { salvarLogNoArquivoDoDia(`[${horaAtualCurta()}] Receita de ${n.gramas} g aplicada (${origem}).`); } catch (e) {}
    return true;
}

function receitasEmergenciaFisica() {
    mqttClient.publish(MQTT_TOPIC_EMERGENCIA_ESTEIRA, '1');
    mqttClient.publish(MQTT_TOPIC_SELAGEM_EMERGENCIA, '1');
    mqttClient.publish(MQTT_TOPIC_SELAGEM2_EMERGENCIA, '1');
    mqttClient.publish(MQTT_TOPIC_DISP_EMERGENCIA, '1');
    mqttClient.publish('separador/emergencia', '1');
    ultimaVelocidadeConhecida = '0.00';
    Object.entries(MOTORES_SELAGEM).forEach(([id, m]) => { m.velocidade = '0.00'; io.emit('motor_selagem_velocidade', { id, velocidade: '0.00' }); });
    ultimoEstadoSelagem.habilitado = false;
    ultimoEstadoSelagem2.habilitado = false;
    io.emit('atualizar_temperatura', ultimoEstadoSelagem);
    io.emit('atualizar_temperatura2', ultimoEstadoSelagem2);
    io.emit('emergencia_remota', {});
    io.emit('novo_log_servidor', { hora: horaAtualCurta(), texto: 'PARADA DE EMERGENCIA acionada pelo botao fisico da maquina.', tipo: 'emergencia' });
    try { salvarLogNoArquivoDoDia(`[${horaAtualCurta()}] PARADA DE EMERGENCIA acionada pelo botao fisico da maquina.`); } catch (e) {}
}

function receitasTratarBotao(valor) {
    if (valor === 'emergencia') { receitasEmergenciaFisica(); return; }
    if (!receitas.botoesAtivos) return;
    if (valor === 'mais') receitasAplicar(Math.min(receitas.niveis.length - 1, receitas.atual + 1), 'botao MAIS');
    if (valor === 'menos') receitasAplicar(Math.max(0, receitas.atual - 1), 'botao MENOS');
}

app.get('/receitas', loginObrigatorio, paginaPermitida('receitas'), (req, res) => res.render('receitas.html'));
app.get('/api/receitas', loginObrigatorio, paginaPermitida('receitas'), (req, res) => res.json(receitas));
app.post('/api/receitas', loginObrigatorio, adminObrigatorio, paginaPermitida('receitas'), (req, res) => {
    receitas = receitasNormalizar(Object.assign({}, receitas, req.body || {}, { atual: receitas.atual }));
    receitasSalvar();
    io.emit('receita_atual', { indice: receitas.atual, niveis: receitas.niveis, origem: 'edicao' });
    res.json(receitas);
});
app.post('/api/receitas/aplicar', loginObrigatorio, paginaPermitida('receitas'), (req, res) => {
    const i = parseInt(req.body && req.body.indice, 10);
    if (!receitasAplicar(i, 'site')) return res.status(400).json({ erro: 'Nivel invalido.' });
    res.json({ sucesso: true, atual: receitas.atual });
});

app.get('/modelo3d', loginObrigatorio, (req, res) => res.render('modelo3d.html'));
app.get('/api/modelo3d', loginObrigatorio, (req, res) => {
    try {
        const pasta = path.join(__dirname, 'public', 'modelo');
        res.json(fs.readdirSync(pasta).filter(f => /\.(glb|gltf)$/i.test(f)).sort()
            .map(f => ({ nome: f.replace(/\.(glb|gltf)$/i, '').replace(/[_-]+/g, ' '), url: '/modelo/' + encodeURIComponent(f) })));
    } catch (e) { res.json([]); }
});


// ================================================================================
// SEPARADOR (fase 2) - paginas e API
// ================================================================================
app.get('/separador', loginObrigatorio, paginaPermitida('separador'), (req, res) => res.render('separador.html'));

function separadorConfigCompleta() {
    return Object.assign({}, separadorMotor.getConfig(), {
        camera: { zonaInicio: configVisao.zonaInicio, zonaFim: configVisao.zonaFim }
    });
}

app.get('/api/separador/estado', loginObrigatorio, (req, res) => {
    const admin = !!res.locals.isAdmin;
    res.json({
        camera: { online: cameraOnline },
        servo: { online: separadorOnline, estado: separadorEstado },
        motor: separadorMotor.estado(),
        motorLocal: separadorMotor.getConfig().motorLocal,
        config: admin ? separadorConfigCompleta() : null,
        classes: separadorMotor.listarTreino(admin ? 6 : 0).map(c => ({ nome: c.nome, amostras: c.amostras })),
        recentes: separadorRecentes,
        porProduto: obterContagemPorProdutoHoje(),
        contagemHoje: obterContagemHojeVisao(),
        velEsteira: parseFloat(ultimaVelocidadeConhecida) || 0
    });
});

app.post('/api/separador/config', loginObrigatorio, adminObrigatorio, (req, res) => {
    try {
        const corpo = req.body || {};
        if (corpo.camera && typeof corpo.camera === 'object') {
            const zi = Math.min(Math.max(parseFloat(corpo.camera.zonaInicio), 0), 0.95);
            const zf = Math.min(Math.max(parseFloat(corpo.camera.zonaFim), zi + 0.02), 1);
            if (isFinite(zi) && isFinite(zf)) {
                configVisao = Object.assign({}, configVisao, { zonaInicio: zi, zonaFim: zf });
                salvarConfigVisao(configVisao);
                separadorMotor.recalibrarFundo();
            }
        }
        const antes = JSON.stringify([separadorMotor.getConfig().eixo]);
        separadorMotor.setConfig(corpo);
        if (JSON.stringify([separadorMotor.getConfig().eixo]) !== antes) separadorMotor.recalibrarFundo();
        separadorPublicarConfig();
        res.json({ sucesso: true, config: separadorConfigCompleta() });
    } catch (e) {
        res.status(400).json({ erro: e.message });
    }
});

app.post('/api/separador/fundo', loginObrigatorio, adminObrigatorio, (req, res) => {
    separadorMotor.recalibrarFundo();
    res.json({ sucesso: true });
});

app.get('/api/separador/treino', loginObrigatorio, adminObrigatorio, (req, res) => {
    res.json(separadorMotor.listarTreino(6));
});

app.post('/api/separador/treino/iniciar', loginObrigatorio, adminObrigatorio, (req, res) => {
    try {
        const t = separadorMotor.iniciarTreino(req.body.classe, req.body.quantidade);
        res.json({ sucesso: true, treino: t });
    } catch (e) {
        res.status(400).json({ erro: e.message });
    }
});

app.post('/api/separador/treino/parar', loginObrigatorio, adminObrigatorio, (req, res) => {
    separadorMotor.pararTreino();
    res.json({ sucesso: true });
});

app.delete('/api/separador/treino/:classe', loginObrigatorio, adminObrigatorio, (req, res) => {
    if (!separadorMotor.removerClasse(req.params.classe)) return res.status(404).json({ erro: 'Produto nao encontrado.' });
    res.json({ sucesso: true });
});

app.post('/api/separador/servo/teste', loginObrigatorio, adminObrigatorio, (req, res) => {
    const lado = req.body && req.body.lado;
    if (lado !== 'E' && lado !== 'D' && lado !== 'C') return res.status(400).json({ erro: 'Lado invalido.' });
    if (!separadorOnline) return res.status(409).json({ erro: 'O servo (ESP32 do separador) esta desconectado.' });
    mqttClient.publish('separador/teste', lado);
    res.json({ sucesso: true });
});

app.post('/api/separador/servo/ref-velocidade', loginObrigatorio, adminObrigatorio, (req, res) => {
    const v = parseFloat(ultimaVelocidadeConhecida) || 0;
    if (v <= 0.01) return res.status(409).json({ erro: 'A esteira esta parada. Ligue a esteira na velocidade da apresentacao e tente de novo.' });
    separadorMotor.setConfig({ velRefEsteira: v });
    res.json({ sucesso: true, velRefEsteira: v });
});

// ================================================================================
// STATUS DO SISTEMA (internet, vigia, Raspberry e dispositivos)
// ================================================================================
const { execFile: execFileSistema } = require('child_process');
const osSistema = require('os');
const ARQ_REDE_JSON = process.env.FLOWPACK_REDE_JSON || '/var/lib/flowpack/rede.json';
const ARQ_LOG_REDE = process.env.FLOWPACK_LOG_REDE || '/var/log/guarda-rede.log';
const ARQ_LOG_VIGIA = process.env.FLOWPACK_LOG_VIGIA || '/var/log/vigia-site.log';

function sistemaUltimasLinhas(caminho, n) {
    try { return fs.readFileSync(caminho, 'utf-8').trim().split('\n').slice(-n); } catch (e) { return []; }
}

function sistemaMeminfo() {
    const r = {};
    try {
        fs.readFileSync('/proc/meminfo', 'utf-8').split('\n').forEach(l => {
            const m = l.match(/^(\w+):\s+(\d+)/);
            if (m) r[m[1]] = parseInt(m[2], 10);
        });
    } catch (e) {}
    return r;
}

let sistemaCacheThrottled = { t: 0, valor: null };
function sistemaLerThrottled(cb) {
    if (Date.now() - sistemaCacheThrottled.t < 5000) return cb(sistemaCacheThrottled.valor);
    execFileSistema('vcgencmd', ['get_throttled'], { timeout: 1500 }, (err, saida) => {
        let valor = null;
        if (!err && saida) {
            const m = String(saida).match(/0x([0-9a-fA-F]+)/);
            if (m) {
                const n = parseInt(m[1], 16);
                valor = {
                    bruto: '0x' + m[1],
                    subtensaoAgora: !!(n & 0x1), freqLimitadaAgora: !!(n & 0x2), throttledAgora: !!(n & 0x4), tempAltaAgora: !!(n & 0x8),
                    subtensaoJaOcorreu: !!(n & 0x10000), throttledJaOcorreu: !!(n & 0x40000)
                };
            }
        }
        sistemaCacheThrottled = { t: Date.now(), valor };
        cb(valor);
    });
}

app.get('/sistema', loginObrigatorio, adminObrigatorio, (req, res) => res.render('sistema.html'));

app.get('/api/sistema/status', loginObrigatorio, adminObrigatorio, (req, res) => {
    sistemaLerThrottled((throttled) => {
        let rede = null, redeIdadeS = null;
        try {
            rede = JSON.parse(fs.readFileSync(ARQ_REDE_JSON, 'utf-8'));
            redeIdadeS = Math.round(Date.now() / 1000 - (rede.epoch || 0));
        } catch (e) {}

        const mi = sistemaMeminfo();
        let tempCpu = null;
        try { tempCpu = parseInt(fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf-8'), 10) / 1000; } catch (e) {}

        const linhasVigia = sistemaUltimasLinhas(ARQ_LOG_VIGIA, 12);
        let vigiaUltimo = null;
        for (let i = linhasVigia.length - 1; i >= 0; i--) {
            if (/OK: site acessivel/.test(linhasVigia[i])) { vigiaUltimo = { ok: true, linha: linhasVigia[i] }; break; }
            if (/falhou|FALHA|FORA/.test(linhasVigia[i])) { vigiaUltimo = { ok: false, linha: linhasVigia[i] }; break; }
        }

        res.json({
            agora: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
            rede, redeIdadeS,
            guardaRedeInstalado: !!rede,
            vigia: { linhas: linhasVigia, ultimo: vigiaUltimo },
            sistema: {
                uptimeS: Math.round(osSistema.uptime()), siteUptimeS: Math.round(process.uptime()),
                load: osSistema.loadavg().map(x => Math.round(x * 100) / 100),
                memTotalMB: Math.round((mi.MemTotal || osSistema.totalmem() / 1024) / 1024),
                memDisponivelMB: Math.round((mi.MemAvailable || osSistema.freemem() / 1024) / 1024),
                swapTotalMB: Math.round((mi.SwapTotal || 0) / 1024), swapLivreMB: Math.round((mi.SwapFree || 0) / 1024),
                siteMemMB: Math.round(process.memoryUsage().rss / 1048576),
                tempCpu, throttled
            },
            dispositivos: [
                { id: 'esteira', nome: 'Esteira', online: !!esp32Online },
                { id: 'selagem1', nome: 'Selagem 1 - aquecimento', online: !!selagemOnline },
                { id: 'selagem1m', nome: 'Selagem 1 - rodinhas', online: !!selagem1MotorOnline },
                { id: 'selagem2', nome: 'Selagem 2 - aquecimento', online: !!selagem2Online },
                { id: 'selagem2m', nome: 'Selagem 2 - motor', online: !!selagem2MotorOnline },
                { id: 'dispenser', nome: 'Dispenser', online: !!dispenserOnline },
                { id: 'separador', nome: 'Separador (servo)', online: !!separadorOnline },
                { id: 'camera', nome: 'Camera', online: !!cameraOnline }
            ]
        });
    });
});

app.get('/api/sistema/log-rede', loginObrigatorio, adminObrigatorio, (req, res) => {
    res.type('text/plain').send(sistemaUltimasLinhas(ARQ_LOG_REDE, 150).join('\n') || '(sem registros ainda)');
});


app.get('/api/dispenser/estado', loginObrigatorio, (req, res) => {
    res.json(estadoDispenserParaTela(res.locals.isAdmin === true));
});

app.post('/api/dispenser/dosar', loginObrigatorio, (req, res) => {
    const usuario = res.locals.usuarioLogado;
    const corpo = req.body || {};
    const gramas = parseInt(corpo.gramas, 10);

    let reservatorios = Array.isArray(corpo.reservatorios) ? corpo.reservatorios : [];
    reservatorios = [...new Set(reservatorios.map(r => String(r).toUpperCase()))].filter(r => r === 'A' || r === 'B');

    const dose = configDispenser.doses.find(d => d.gramas === gramas && d.ativo);
    if (!dose) return res.status(400).json({ erro: 'Essa quantidade não está disponível.' });
    if (reservatorios.length === 0) return res.status(400).json({ erro: 'Escolha o grão que será dosado.' });
    if (!dispenserOnline || !mqttClient.connected) return res.status(409).json({ erro: 'O Dispenser está desconectado da rede.' });
    if (reservatorios.some(r => dispenserMotores[configDispenser.reservatorios[r].motor].ocupado)) {
        return res.status(409).json({ erro: 'O Dispenser ainda está dosando. Aguarde terminar.' });
    }

    const quartos = Math.round(gramas / 50);
    reservatorios.forEach(r => {
        const c = configDispenser.reservatorios[r];
        mqttClient.publish(MQTT_TOPIC_DISP_DOSAR, `${c.motor};${quartos};${c.pwm};${c.tempoQuartoMs};${c.sentidoInvertido ? 1 : 0};${c.pausaMs}`);
        dispenserMotores[c.motor] = { ocupado: true, restantes: quartos };
    });

    const contador = contadorDeHojeDispenser();
    contador.doses += 1;
    reservatorios.forEach(r => { contador.quartosPorReservatorio[r] += quartos; });

    const nomes = reservatorios.map(r => configDispenser.reservatorios[r].nome);
    dispenserUltimaDose = {
        hora: new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }),
        usuario, gramas, nomes
    };
    registrarLogDispenser(`Dispenser: ${gramas} g de ${nomes.join(' + ')} solicitados (${quartos} quarto(s) de volta).`, usuario);
    emitirEstadoDispenser(true);
    res.json({ ok: true, quartos, reservatorios });
});

app.post('/api/dispenser/parar', loginObrigatorio, (req, res) => {
    mqttClient.publish(MQTT_TOPIC_DISP_EMERGENCIA, '1'); mqttClient.publish('separador/emergencia', '1');
    liberarMotoresDispenser();
    registrarLogDispenser('Dispenser: dosagem interrompida pelo operador.', res.locals.usuarioLogado);
    emitirEstadoDispenser(true);
    res.json({ ok: true });
});

app.post('/api/dispenser/config', loginObrigatorio, adminObrigatorio, (req, res) => {
    const nova = normalizarConfigDispenser(req.body);
    if (!nova.doses.some(d => d.ativo)) {
        return res.status(400).json({ erro: 'Deixe pelo menos uma quantidade ativa para o operador.' });
    }
    try {
        fs.writeFileSync(ARQUIVO_CONFIG_DISPENSER, JSON.stringify(nova, null, 2));
    } catch (e) {
        return res.status(500).json({ erro: 'Não consegui salvar o arquivo de configuração.' });
    }
    configDispenser = nova;
    registrarLogDispenser('Configuração do Dispenser alterada.', res.locals.usuarioLogado);
    emitirEstadoDispenser(true);
    io.emit('dispenser_config', visaoPublicaConfigDispenser(configDispenser));
    res.json({ ok: true, config: configDispenser });
});

app.post('/api/dispenser/teste', loginObrigatorio, adminObrigatorio, (req, res) => {
    const corpo = req.body || {};
    const r = String(corpo.reservatorio || '').toUpperCase();
    if (r !== 'A' && r !== 'B') return res.status(400).json({ erro: 'Reservatório inválido.' });
    if (!dispenserOnline || !mqttClient.connected) return res.status(409).json({ erro: 'O Dispenser está desconectado da rede.' });

    const c = configDispenser.reservatorios[r];
    if (dispenserMotores[c.motor].ocupado) return res.status(409).json({ erro: 'O motor ainda está girando. Aguarde.' });

    let payload;
    if (corpo.tipo === 'ajuste') {
        const ms = Math.round(limitarNumero(corpo.ajusteMs, -500, 500, 0));
        if (ms === 0) return res.status(400).json({ erro: 'Ajuste inválido.' });
        const sentido = (c.sentidoInvertido ? 1 : 0) ^ (ms < 0 ? 1 : 0);
        payload = `${c.motor};1;${Math.min(c.pwm, 70)};${Math.abs(ms)};${sentido};0`;
    } else {
        const pwm = Math.round(limitarNumero(corpo.pwm, 20, 100, c.pwm));
        const tempo = Math.round(limitarNumero(corpo.tempoQuartoMs, 50, 2000, c.tempoQuartoMs));
        const pausa = Math.round(limitarNumero(corpo.pausaMs, 0, 2000, c.pausaMs));
        const invertido = corpo.sentidoInvertido === undefined ? c.sentidoInvertido : corpo.sentidoInvertido === true;
        payload = `${c.motor};1;${pwm};${tempo};${invertido ? 1 : 0};${pausa}`;
    }
    mqttClient.publish(MQTT_TOPIC_DISP_DOSAR, payload);
    dispenserMotores[c.motor] = { ocupado: true, restantes: 1 };
    registrarLogDispenser(`Dispenser: teste no reservatório ${r} (${corpo.tipo === 'ajuste' ? 'ajuste fino' : '¼ de volta'}).`, res.locals.usuarioLogado);
    emitirEstadoDispenser(true);
    res.json({ ok: true });
});

// ================================================================================
// MANUAIS EM PDF: os arquivos ficam na pasta "manuais" (ao lado do server.js)
// ================================================================================
const PASTA_MANUAIS = path.join(__dirname, 'manuais');
const LISTA_MANUAIS = [
    { id: 'maquina',   titulo: 'Manual da Máquina Completa', arquivo: 'Manual_Maquina_FlowPack.pdf',      descricao: 'Visão geral, segurança, operação e sistema de controle.' },
    { id: 'dispenser', titulo: 'Módulo Dispenser',           arquivo: 'Manual_Dispenser_FlowPack.pdf',    descricao: 'Dosagem de grãos por fração de volta.' },
    { id: 'braco',     titulo: 'Módulo Braço Formador',      arquivo: 'Manual_BracoFormador_FlowPack.pdf', descricao: 'Formação e dobra do plástico.' },
    { id: 'selagem1',  titulo: 'Módulo Selagem 1',           arquivo: 'Manual_Selagem1_FlowPack.pdf',     descricao: 'Selagem transversal.' },
    { id: 'selagem2',  titulo: 'Módulo Selagem 2',           arquivo: 'Manual_Selagem2_FlowPack.pdf',     descricao: 'Selagem rotativa e corte.' },
    { id: 'esteira',   titulo: 'Módulo Esteira',             arquivo: 'Manual_Esteira_FlowPack.pdf',      descricao: 'Transporte do produto ao longo da linha.' }
];

app.get('/api/manuais', loginObrigatorio, (req, res) => {
    res.json(LISTA_MANUAIS.map(m => {
        const caminho = path.join(PASTA_MANUAIS, m.arquivo);
        let tamanho = 0;
        try { tamanho = fs.statSync(caminho).size; } catch (e) {}
        return { id: m.id, titulo: m.titulo, descricao: m.descricao, disponivel: tamanho > 0, tamanho };
    }));
});

app.get('/manuais/baixar/:id', loginObrigatorio, (req, res) => {
    const m = LISTA_MANUAIS.find(x => x.id === req.params.id);
    if (!m) return res.status(404).send('Manual não encontrado.');
    const caminho = path.join(PASTA_MANUAIS, m.arquivo);
    if (!fs.existsSync(caminho)) return res.status(404).send('Este manual ainda não está disponível.');
    registrarLogDispenser(`Manual baixado: ${m.titulo}.`, res.locals.usuarioLogado);
    res.download(caminho, m.arquivo);
});

// --- API DO PAINEL DE CONTROLE ---
app.get('/api/painel/estado', loginObrigatorio, adminObrigatorio, (req, res) => {
    const motores = {};
    Object.entries(MOTORES_SELAGEM).forEach(([id, m]) => {
        motores[id] = { nome: m.nome, dispositivo: m.dispositivo, velocidade: m.velocidade, sentido: m.sentido };
    });
    res.json({
        esteira: { online: esp32Online, velocidade: ultimaVelocidadeConhecida, sentido: sentidoEsteira },
        selagem1: { online: selagemOnline, estado: ultimoEstadoSelagem },
        selagem2: { online: selagem2Online, estado: ultimoEstadoSelagem2 },
        selagem2motor: { online: selagem2MotorOnline },
        selagem1motor: { online: selagem1MotorOnline },
        motores
    });
});

// --- API DA ESTEIRA ---
app.get('/api/esteira/status', loginObrigatorio, (req, res) => {
    res.json({ online: esp32Online, velocidade: ultimaVelocidadeConhecida });
});

// --- API DA SELAGEM 1 ---
app.get('/api/selagem/status', loginObrigatorio, (req, res) => {
    res.json({ online: selagemOnline, estado: ultimoEstadoSelagem });
});

// --- API DA SELAGEM 2 ---
app.get('/api/selagem2/status', loginObrigatorio, (req, res) => {
    res.json({ online: selagem2Online, estado: ultimoEstadoSelagem2 });
});

// --- SOCKET.IO ---
function envolverMiddleware(middleware) {
    return (socket, next) => middleware(socket.request, {}, next);
}

io.use(envolverMiddleware(cookieParser()));
io.use(envolverMiddleware(sessionMiddleware));

io.use((socket, next) => {
    const req = socket.request;
    const usuarioAtivo = (req.session && req.session.usuario) || (req.cookies && req.cookies.lembrar_usuario);
    socket.data.usuario = usuarioAtivo || 'Desconhecido';
    next();
});

io.on('connection', (socket) => {
    socket.emit('separador_servo', { online: separadorOnline, estado: separadorEstado });
    socket.emit('atualizar_velocidade', { velocidade: ultimaVelocidadeConhecida });
    socket.emit('status_esp32', { online: esp32Online });
    socket.emit('sentido_esteira', { sentido: sentidoEsteira });
    socket.emit('visao_status', { online: cameraOnline });
    socket.emit('atualizar_temperatura', ultimoEstadoSelagem);
    socket.emit('status_selagem', { online: selagemOnline });
    socket.emit('atualizar_temperatura2', ultimoEstadoSelagem2);
    socket.emit('status_selagem2', { online: selagem2Online });
    socket.emit('status_selagem2motor', { online: selagem2MotorOnline });
    socket.emit('status_selagem1motor', { online: selagem1MotorOnline });
    Object.entries(MOTORES_SELAGEM).forEach(([id, m]) => {
        socket.emit('motor_selagem_velocidade', { id, velocidade: m.velocidade });
        socket.emit('motor_selagem_sentido', { id, sentido: m.sentido });
    });

    socket.on('comando_esteira', (data) => {
        if (data.acao === 'velocidade') {
            // NOVO: grava o valor comandado na hora — não depende do ESP32
            // ecoar de volta, então a tela nunca "esquece" o valor ao trocar
            // de aba, mesmo sem hardware físico conectado
            ultimaVelocidadeConhecida = data.valor.toString();
            io.emit('atualizar_velocidade', { velocidade: ultimaVelocidadeConhecida });
            mqttClient.publish(MQTT_TOPIC_SET, data.valor.toString());
        } else if (data.acao === 'emergencia') {
            // Esteira: o proprio ESP32 gira ao contrario por 1s e para
            mqttClient.publish(MQTT_TOPIC_EMERGENCIA_ESTEIRA, "1");
            ultimaVelocidadeConhecida = "0.00";
            mqttClient.publish(MQTT_TOPIC_SELAGEM_EMERGENCIA, "1");
            mqttClient.publish(MQTT_TOPIC_SELAGEM2_EMERGENCIA, "1");
            mqttClient.publish(MQTT_TOPIC_DISP_EMERGENCIA, "1"); mqttClient.publish('separador/emergencia', '1'); // Site -> Dispenser
            liberarMotoresDispenser();
            emitirEstadoDispenser(true);
            Object.entries(MOTORES_SELAGEM).forEach(([id, m]) => {
                m.velocidade = '0.00';
                io.emit('motor_selagem_velocidade', { id, velocidade: '0.00' });
            });
            ultimoEstadoSelagem.habilitado = false;
            ultimoEstadoSelagem2.habilitado = false;
            io.emit('atualizar_temperatura', ultimoEstadoSelagem);
            io.emit('atualizar_temperatura2', ultimoEstadoSelagem2);
        }
    });

    // PAINEL DE CONTROLE: somente Admin e Dono
    socket.on('comando_painel', (data) => {
        if (!data) return;
        const usuarios = carregarUsuarios();
        const dadosUsuario = usuarios[socket.data.usuario];
        if (!dadosUsuario || (dadosUsuario.nivel !== NIVEL_DONO && dadosUsuario.nivel !== NIVEL_ADM)) return;

        if (data.acao === 'motor_velocidade') {
            const m = MOTORES_SELAGEM[data.id];
            if (!m) return;
            const v = Math.max(0, Math.min(1, parseFloat(data.valor) || 0));
            m.velocidade = v.toFixed(2);
            io.emit('motor_selagem_velocidade', { id: data.id, velocidade: m.velocidade });
            mqttClient.publish(m.topicoSet, m.velocidade);
        } else if (data.acao === 'motor_sentido') {
            const m = MOTORES_SELAGEM[data.id];
            if (!m) return;
            mqttClient.publish(m.topicoSentidoSet, data.sentido === 'invertido' ? 'invertido' : 'normal');
        } else if (data.acao === 'esteira_sentido') {
            mqttClient.publish(MQTT_TOPIC_SENTIDO_SET, data.sentido === 'invertido' ? 'invertido' : 'normal');
        } else if (data.acao === 'aquecimento') {
            const numero = data.numero === 2 ? 2 : 1;
            const estado = numero === 2 ? ultimoEstadoSelagem2 : ultimoEstadoSelagem;
            estado.habilitado = !!data.valor;
            io.emit(numero === 2 ? 'atualizar_temperatura2' : 'atualizar_temperatura', estado);
            mqttClient.publish(numero === 2 ? MQTT_TOPIC_SELAGEM2_ATIVAR : MQTT_TOPIC_SELAGEM_ATIVAR, data.valor ? '1' : '0');
        } else if (data.acao === 'reiniciar') {
            const topico = TOPICOS_REINICIAR[data.dispositivo];
            if (topico) mqttClient.publish(topico, '1');
        }
    });

    // Inverter sentido da esteira: somente o Dono
    socket.on('comando_sentido', (data) => {
        const usuarios = carregarUsuarios();
        const dadosUsuario = usuarios[socket.data.usuario];
        if (!dadosUsuario || dadosUsuario.nivel !== NIVEL_DONO) return;
        const novo = data && data.sentido === 'invertido' ? 'invertido' : 'normal';
        mqttClient.publish(MQTT_TOPIC_SENTIDO_SET, novo);
    });

    socket.on('comando_selagem', (data) => {
        if (data.acao === 'setpoint') {
            ultimoEstadoSelagem.setpoint = parseFloat(data.valor);
            io.emit('atualizar_temperatura', ultimoEstadoSelagem);
            mqttClient.publish(MQTT_TOPIC_SELAGEM_SET, data.valor.toString());
        } else if (data.acao === 'ativar') {
            // Ignorado: o aquecimento agora so liga/desliga pelo Painel de Controle (ou emergencia)
        } else if (data.acao === 'resetar_seguranca') {
            mqttClient.publish('selagem/resetar_seguranca', '1');
        }
    });

    socket.on('comando_selagem2', (data) => {
        if (data.acao === 'setpoint') {
            ultimoEstadoSelagem2.setpoint = parseFloat(data.valor);
            io.emit('atualizar_temperatura2', ultimoEstadoSelagem2);
            mqttClient.publish(MQTT_TOPIC_SELAGEM2_SET, data.valor.toString());
        } else if (data.acao === 'ativar') {
            // Ignorado: o aquecimento agora so liga/desliga pelo Painel de Controle (ou emergencia) - selagem 2
        } else if (data.acao === 'resetar_seguranca') {
            mqttClient.publish('selagem2/resetar_seguranca', '1');
        }
    });

    socket.on('novo_log', (log) => {
        const logComUsuario = {
            hora: log.hora,
            texto: log.texto,
            classe: log.classe || 'text-slate-700 font-medium',
            usuario: socket.data.usuario,
            tipo: log.tipo || 'sistema'
        };
        salvarLogNoArquivoDoDia(logComUsuario);
        io.emit('novo_log_servidor', logComUsuario);
    });

    socket.on('registrar_producao', (data) => {
        let historico = {};
        if (fs.existsSync(arquivoProducao)) {
            try { historico = JSON.parse(fs.readFileSync(arquivoProducao, 'utf-8')); } catch(e) {}
        }
        if (!historico[data.dataPtBr]) historico[data.dataPtBr] = 0;
        historico[data.dataPtBr] += data.pacotes;
        fs.writeFileSync(arquivoProducao, JSON.stringify(historico, null, 2));

        const dataLocal = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }).split(', ')[0];
        const partes = dataLocal.split('/');
        const dataFormatada = `${partes[2]}-${partes[1]}-${partes[0]}`;
        const arquivoPontos = path.join(pastaProducaoDiaria, `${dataFormatada}.json`);

        let pontosDoDia = [];
        if (fs.existsSync(arquivoPontos)) {
            try { pontosDoDia = JSON.parse(fs.readFileSync(arquivoPontos, 'utf-8')); } catch(e) {}
        }
        pontosDoDia.push({ hora: data.hora || dataLocal, pacotes: data.pacotes });
        fs.writeFileSync(arquivoPontos, JSON.stringify(pontosDoDia, null, 2));
    });
});

server.listen(5000, '0.0.0.0', () => {
    console.log('\n🚀 SISTEMA INDUSTRIAL LIBERADO NA REDE LOCAL (Porta 5000)\n');
});