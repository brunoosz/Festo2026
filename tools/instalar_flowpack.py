#!/usr/bin/env python3
# GitHub: https://github.com/brunoosz | LinkedIn: https://www.linkedin.com/in/brunocamperlingo/
# instalador
import os, sys, shutil, subprocess, datetime

BASE = sys.argv[1] if len(sys.argv) > 1 else "/root/site_esteira"
CAMINHO_SERVER = os.path.join(BASE, "server.js")
CAMINHO_BASE = os.path.join(BASE, "views", "base.html")
CAMINHO_DISP = os.path.join(BASE, "views", "dispenser.html")
CAMINHO_CTRL = os.path.join(BASE, "views", "controle.html")
PASTA_MANUAIS = os.path.join(BASE, "manuais")

res = []

for caminho in (CAMINHO_SERVER, CAMINHO_BASE):
    if not os.path.exists(caminho):
        print("❌ Nao achei " + caminho + ". Confira se a pasta do site e " + BASE)
        sys.exit(1)

carimbo = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
for caminho in (CAMINHO_SERVER, CAMINHO_BASE):
    shutil.copy2(caminho, caminho + ".bak_" + carimbo)
print("Copias de seguranca criadas (.bak_" + carimbo + ")")
print()

def ler(caminho):
    return open(caminho, encoding="utf-8").read()

def gravar(caminho, texto):
    open(caminho, "w", encoding="utf-8").write(texto)

def trocar(texto, nome, antigo, novo, marcador, modo="trocar"):
    # modo
    if marcador in texto:
        res.append("⏭️  %s: ja estava aplicado." % nome)
        return texto
    if texto.count(antigo) != 1:
        res.append("❌ %s: trecho nao encontrado (ou repetido), me avisa." % nome)
        return texto
    if modo == "depois":
        novo = antigo + novo
    elif modo == "antes":
        novo = novo + antigo
    res.append("✅ %s: aplicado." % nome)
    return texto.replace(antigo, novo, 1)

# server.js
c = ler(CAMINHO_SERVER)

def troca(nome, antigo, novo, marcador):
    global c
    c = trocar(c, nome, antigo, novo, marcador)

# selagem 1 dividida
troca("Motor 1 da Selagem 1 num ESP32 próprio",
      "nome: 'Selagem 1 - Motor 1', dispositivo: 'selagem1',",
      "nome: 'Selagem 1 - Motor 1', dispositivo: 'selagem1motor',",
      "nome: 'Selagem 1 - Motor 1', dispositivo: 'selagem1motor',")
troca("Motor 2 da Selagem 1 num ESP32 próprio",
      "nome: 'Selagem 1 - Motor 2', dispositivo: 'selagem1',",
      "nome: 'Selagem 1 - Motor 2', dispositivo: 'selagem1motor',",
      "nome: 'Selagem 1 - Motor 2', dispositivo: 'selagem1motor',")

# reiniciar
troca("Reiniciar o ESP32 dos motores da Selagem 1",
      "selagem2motor: 'selagem2/motor/reiniciar' };",
      "selagem2motor: 'selagem2/motor/reiniciar', selagem1motor: 'selagem/motores/reiniciar' };",
      "selagem1motor: 'selagem/motores/reiniciar'")
troca("Estado do ESP32 dos motores da Selagem 1",
      "let ultimaMsgSelagem2Motor = 0;",
      "let ultimaMsgSelagem2Motor = 0;\n\nconst MQTT_TOPIC_SELAGEM1_MOTOR_STATUS = 'selagem/motores/status';\nlet selagem1MotorOnline = false;\nlet ultimaMsgSelagem1Motor = 0;",
      "MQTT_TOPIC_SELAGEM1_MOTOR_STATUS =")
troca("Inscrição no status dos motores da Selagem 1",
      ".concat([MQTT_TOPIC_SELAGEM2_MOTOR_STATUS])",
      ".concat([MQTT_TOPIC_SELAGEM2_MOTOR_STATUS, MQTT_TOPIC_SELAGEM1_MOTOR_STATUS])",
      "MQTT_TOPIC_SELAGEM2_MOTOR_STATUS, MQTT_TOPIC_SELAGEM1_MOTOR_STATUS")

# sinal de vida
troca("Sinal de vida dos motores separado do aquecimento",
      "    if (topic.startsWith('selagem/motor')) ultimaMsgSelagem1 = Date.now();",
      "    if (topic.startsWith('selagem/motor')) ultimaMsgSelagem1Motor = Date.now();   // inclui selagem/motores/status",
      "ultimaMsgSelagem1Motor = Date.now();")
troca("Status online/offline do ESP32 dos motores da Selagem 1",
      "    // ESP32 do motor da selagem 2 (separado do aquecimento)",
      """    // ESP32 dos motores da selagem 1 (separado do aquecimento)
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

    // ESP32 do motor da selagem 2 (separado do aquecimento)""",
      "ESP32 dos motores da selagem 1 (separado do aquecimento)", )
troca("Aquecimento da Selagem 1 só fica online pelos dados dele",
      "    if ((topic === MQTT_TOPIC_SELAGEM_DADOS || topic.startsWith('selagem/motor')) && !selagemOnline) {",
      "    if (topic === MQTT_TOPIC_SELAGEM_DADOS && !selagemOnline) {",
      "    if (topic === MQTT_TOPIC_SELAGEM_DADOS && !selagemOnline) {")

# vigia
troca("Vigia: lista de dispositivos",
      "let estadoOnlineAnterior = { esteira: false, selagem1: false, selagem2: false, selagem2motor: false };",
      "let estadoOnlineAnterior = { esteira: false, selagem1: false, selagem2: false, selagem2motor: false, selagem1motor: false };",
      "selagem2motor: false, selagem1motor: false };")
troca("Vigia: sem sinal do ESP32 dos motores da Selagem 1",
      "    // Vigia do ESP32 do motor da selagem 2: sem sinal de vida por 8s, fica offline",
      """    // Vigia do ESP32 dos motores da selagem 1: sem sinal de vida por 8s, fica offline
    if (selagem1MotorOnline && (Date.now() - ultimaMsgSelagem1Motor) > 8000) {
        selagem1MotorOnline = false;
        io.emit('status_selagem1motor', { online: false });
        io.emit('novo_log_servidor', { hora: horaAtualCurta(), texto: 'ESP32 dos Motores da Selagem 1 parou de responder, marcado como OFFLINE.', tipo: 'sistema' });
    }

    // Vigia do ESP32 do motor da selagem 2: sem sinal de vida por 8s, fica offline""",
      "Vigia do ESP32 dos motores da selagem 1")
troca("Vigia: estado atual",
      "selagem2: selagem2Online, selagem2motor: selagem2MotorOnline };",
      "selagem2: selagem2Online, selagem2motor: selagem2MotorOnline, selagem1motor: selagem1MotorOnline };",
      "selagem2motor: selagem2MotorOnline, selagem1motor: selagem1MotorOnline };")
troca("Vigia: zerar motores da Selagem 1 ao cair",
      "['selagem1', 'selagem2', 'selagem2motor'].forEach(dispositivo => {",
      "['selagem1', 'selagem2', 'selagem2motor', 'selagem1motor'].forEach(dispositivo => {",
      "'selagem2motor', 'selagem1motor'].forEach")

# painel
troca("API do Painel inclui os motores da Selagem 1",
      "        selagem2motor: { online: selagem2MotorOnline },",
      "        selagem2motor: { online: selagem2MotorOnline },\n        selagem1motor: { online: selagem1MotorOnline },",
      "selagem1motor: { online: selagem1MotorOnline },")
troca("Enviar estado dos motores da Selagem 1 ao conectar",
      "    socket.emit('status_selagem2motor', { online: selagem2MotorOnline });",
      "    socket.emit('status_selagem2motor', { online: selagem2MotorOnline });\n    socket.emit('status_selagem1motor', { online: selagem1MotorOnline });",
      "socket.emit('status_selagem1motor'")


# dispenser e manuais
BLOCO_ESTADO = r'''// ================================================================================
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

'''
BLOCO_MENSAGENS = r'''
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
'''
BLOCO_ROTAS = r'''// ================================================================================
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

app.get('/dispenser', loginObrigatorio, (req, res) => res.render('dispenser.html'));

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
    mqttClient.publish(MQTT_TOPIC_DISP_EMERGENCIA, '1');
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

'''
BLOCO_INSCRICAO = r'''
    mqttClient.subscribe([MQTT_TOPIC_DISP_STATUS, MQTT_TOPIC_DISP_ESTADO, MQTT_TOPIC_DISP_CONCLUIDO]);
'''

c = trocar(c, "Dispenser: estado e configuracao",
           "const TOPICOS_REINICIAR = {", BLOCO_ESTADO, "MQTT_TOPIC_DISP_STATUS =", "antes")
c = trocar(c, "Dispenser: inscricao nos topicos",
           "console.log('✅ Conectado ao Broker MQTT com sucesso!');", BLOCO_INSCRICAO,
           "MQTT_TOPIC_DISP_STATUS, MQTT_TOPIC_DISP_ESTADO", "depois")
c = trocar(c, "Dispenser: mensagens do ESP32",
           "const valor = message.toString();", BLOCO_MENSAGENS, "topic === MQTT_TOPIC_DISP_ESTADO", "depois")
c = trocar(c, "Dispenser: pagina, API e Manuais",
           "// --- API DO PAINEL DE CONTROLE ---", BLOCO_ROTAS, "app.get('/dispenser'", "antes")

# emergência do dispenser
c = trocar(c, "Emergencia do site para o Dispenser",
           'mqttClient.publish(MQTT_TOPIC_SELAGEM2_EMERGENCIA, "1");',
           '\n            mqttClient.publish(MQTT_TOPIC_DISP_EMERGENCIA, "1"); // Site -> Dispenser\n            liberarMotoresDispenser();\n            emitirEstadoDispenser(true);',
           '// Site -> Dispenser', "depois")
if "executarComandoServidor" in c:
    c = trocar(c, "Emergencia da Alexa para o Dispenser",
               "mqttClient.publish(MQTT_TOPIC_SELAGEM2_EMERGENCIA, '1');",
               "\n        mqttClient.publish(MQTT_TOPIC_DISP_EMERGENCIA, '1'); // Alexa -> Dispenser",
               "// Alexa -> Dispenser", "depois")
else:
    res.append("⏭️  Emergencia da Alexa: a Alexa nao esta instalada, nada a fazer.")

gravar(CAMINHO_SERVER, c)

# base.html
b = ler(CAMINHO_BASE)

LINK_DISPENSER = '''
                <a href="/dispenser" data-spa-link class="flex items-center gap-3 px-4 py-3.5 sm:py-3 rounded-lg text-sm font-medium transition hover:bg-gray-50 active:bg-gray-100 text-gray-600" id="link-dispenser">
                    <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16l-5.5 8v6l-5 2v-8z"/></svg>
                    Dispenser
                </a>'''

if 'id="link-dispenser"' in b:
    res.append("⏭️  Menu Dispenser: ja estava aplicado.")
else:
    i = b.find('id="link-operacao"')
    j = b.find('</a>', i) if i != -1 else -1
    if i == -1 or j == -1:
        res.append("❌ Menu Dispenser: nao achei o link Operacao, me avisa.")
    else:
        j += len('</a>')
        b = b[:j] + LINK_DISPENSER + b[j:]
        res.append("✅ Menu Dispenser: aplicado.")

b = trocar(b, "Menu ativo no Dispenser",
           "else if (caminho === '/logs') idAlvo = 'link-logs';",
           "\n                else if (caminho === '/dispenser') idAlvo = 'link-dispenser';",
           "idAlvo = 'link-dispenser'", "depois")

BOTAO_MANUAIS = '''
            <button type="button" data-abrir-manuais class="w-full flex items-center justify-center gap-2 mb-2 bg-blue-50 border border-blue-100 hover:bg-blue-100 active:bg-blue-200 text-blue-700 py-3 rounded-lg text-xs font-bold transition uppercase tracking-wider cursor-pointer shadow-sm">
                <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>
                Manuais
            </button>'''
b = trocar(b, "Botao Manuais no menu (acima de Sair do Sistema)",
           '<div class="p-3 sm:p-4 border-t border-gray-100">', BOTAO_MANUAIS,
           "data-abrir-manuais class=\"w-full", "depois")

ICONE_TOPO = '''<button type="button" data-abrir-manuais title="Manuais (PDF)" class="hidden sm:flex w-9 h-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 hover:text-blue-600 hover:border-blue-300 transition cursor-pointer shadow-sm">
                    <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>
                </button>
                '''
b = trocar(b, "Icone de Manuais ao lado do relogio",
           '<div class="text-base sm:text-2xl font-light text-gray-800 px-0.5 sm:px-4" id="relogio-topo">--:--</div>',
           ICONE_TOPO, 'title="Manuais (PDF)"', "antes")

MODAL_MANUAIS = r'''
<!-- MANUAIS (botao no menu e no topo) -->
<div id="modal-manuais" class="hidden fixed inset-0 bg-black/50 flex items-center justify-center z-[999990] p-3">
    <div class="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between mb-1">
            <h3 class="font-black text-slate-800 text-lg">Manuais</h3>
            <button id="manuais-fechar" class="w-8 h-8 rounded-full hover:bg-slate-100 text-slate-500 cursor-pointer" aria-label="Fechar">✕</button>
        </div>
        <p class="text-xs text-slate-500 mb-4">Baixe o PDF para ler no celular ou no computador.</p>
        <div id="manuais-lista" class="space-y-2"><p class="text-sm text-slate-400">Carregando...</p></div>
    </div>
</div>
<script>
(function () {
    const modal = document.getElementById('modal-manuais');
    const lista = document.getElementById('manuais-lista');
    function formatarTamanho(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
    async function abrir() {
        const overlay = document.getElementById('overlay-sidebar');
        if (overlay && !overlay.classList.contains('hidden') && window.innerWidth < 768) overlay.click();
        modal.classList.remove('hidden');
        lista.innerHTML = '<p class="text-sm text-slate-400">Carregando...</p>';
        try {
            const r = await fetch('/api/manuais');
            const manuais = await r.json();
            lista.innerHTML = '';
            manuais.forEach(m => {
                const linha = document.createElement('div');
                linha.className = 'flex items-center gap-3 border border-slate-200 rounded-xl p-3';
                const botao = m.disponivel
                    ? '<a href="/manuais/baixar/' + m.id + '" class="shrink-0 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3 py-2 rounded-lg">Baixar PDF</a>'
                    : '<span class="shrink-0 bg-slate-100 text-slate-400 text-xs font-bold px-3 py-2 rounded-lg">Em breve</span>';
                linha.innerHTML = '<div class="w-10 h-10 rounded-lg bg-red-50 text-red-600 flex items-center justify-center text-[10px] font-black shrink-0">PDF</div>' +
                    '<div class="min-w-0 flex-1"><div class="font-bold text-sm text-slate-800">' + m.titulo + '</div><div class="text-[11px] text-slate-400">' + m.descricao + (m.disponivel ? ' · ' + formatarTamanho(m.tamanho) : '') + '</div></div>' + botao;
                lista.appendChild(linha);
            });
        } catch (e) {
            lista.innerHTML = '<p class="text-sm text-red-500">Não foi possível carregar a lista de manuais.</p>';
        }
    }
    function fechar() { modal.classList.add('hidden'); }
    window.abrirManuais = abrir;
    document.querySelectorAll('[data-abrir-manuais]').forEach(b => b.addEventListener('click', abrir));
    document.getElementById('manuais-fechar').addEventListener('click', fechar);
    modal.addEventListener('click', (e) => { if (e.target === modal) fechar(); });
})();
</script>
'''
b = trocar(b, "Janela de Manuais",
           '<div id="tutorial-borda-ativa" class="hidden"></div>', MODAL_MANUAIS, 'id="modal-manuais"', "antes")
gravar(CAMINHO_BASE, b)

# páginas novas
PAGINA_DISPENSER = r'''{% extends 'base.html' %}

{% block title %}Dispenser{% endblock %}

{% block content %}
<div class="flex flex-col gap-4 sm:gap-5 max-w-5xl mx-auto w-full">

    <!-- Cabeçalho -->
    <div class="card-painel">
        <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-3 min-w-0">
                <div class="w-11 h-11 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                    <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16l-5.5 8v6l-5 2v-8z"/></svg>
                </div>
                <div class="min-w-0">
                    <h2 class="text-sm sm:text-base font-black text-slate-800 uppercase tracking-wider">Dispenser de Grãos</h2>
                    <p class="text-[11px] text-slate-400">Escolha o grão e a quantidade e toque em DOSAR.</p>
                </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                <div class="flex items-center gap-1.5 bg-white border border-slate-200 rounded-full px-3 py-1.5 shadow-sm">
                    <span id="disp-led" class="w-2.5 h-2.5 rounded-full bg-slate-400 shrink-0"></span>
                    <span class="text-[10px] font-bold text-slate-700">DISPENSER</span>
                </div>
                <button id="disp-btn-config" class="hidden w-9 h-9 bg-white border border-slate-200 rounded-full items-center justify-center text-slate-500 hover:text-blue-600 hover:border-blue-300 active:bg-blue-50 transition cursor-pointer shadow-sm" title="Configurar o Dispenser (Administrador / Dono)">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                </button>
            </div>
        </div>
        <p id="disp-aviso" class="hidden mt-3 text-xs font-bold rounded-lg px-3 py-2"></p>
    </div>

    <!-- 1. Qual grão -->
    <div class="card-painel">
        <h3 class="text-xs font-black text-slate-500 uppercase tracking-widest mb-3">1 · Qual grão?</h3>
        <div id="disp-reservatorios" class="grid grid-cols-1 sm:grid-cols-3 gap-3"></div>
    </div>

    <!-- 2. Quantidade -->
    <div class="card-painel">
        <h3 class="text-xs font-black text-slate-500 uppercase tracking-widest mb-3">2 · Quantidade</h3>
        <div id="disp-doses" class="grid grid-cols-2 lg:grid-cols-4 gap-3"></div>
        <p id="disp-resumo" class="mt-3 text-xs text-slate-500 min-h-[1.25rem]"></p>
    </div>

    <!-- 3. Dosar -->
    <div class="card-painel">
        <button id="disp-btn-dosar" class="w-full bg-[#10b981] hover:bg-[#059669] active:bg-[#047857] text-white font-black py-4 rounded-xl shadow-md transition cursor-pointer tracking-widest text-lg disabled:opacity-40 disabled:cursor-not-allowed">DOSAR</button>
        <div id="disp-progresso" class="hidden mt-3">
            <div class="flex justify-between text-[11px] font-bold text-slate-500 mb-1"><span id="disp-progresso-texto">Dosando...</span><span id="disp-progresso-pct"></span></div>
            <div class="h-2.5 bg-slate-200 rounded-full overflow-hidden"><div id="disp-progresso-barra" class="h-full bg-blue-500 rounded-full transition-all duration-300" style="width:0%"></div></div>
            <button id="disp-btn-parar" class="mt-3 w-full bg-slate-600 hover:bg-slate-700 active:bg-slate-800 text-white font-bold py-2.5 rounded-lg transition cursor-pointer text-xs tracking-wider">PARAR DOSAGEM</button>
        </div>
        <p class="text-[11px] text-slate-400 mt-3 flex items-center gap-1.5">
            <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 118 0v3"/></svg>
            Velocidade e demais ajustes são definidos pelo Administrador e ficam travados para o operador.
        </p>
    </div>

    <!-- Última dosagem + contadores -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="card-painel">
            <h3 class="text-xs font-black text-slate-500 uppercase tracking-widest mb-2">Última dosagem</h3>
            <p id="disp-ultima" class="text-sm text-slate-700">Nenhuma dosagem desde que o sistema ligou.</p>
        </div>
        <div class="card-painel">
            <h3 class="text-xs font-black text-slate-500 uppercase tracking-widest mb-2">Hoje</h3>
            <p id="disp-contador" class="text-sm text-slate-700">0 dosagens</p>
        </div>
    </div>
</div>

<!-- Configuração (Administrador / Dono) -->
<div id="disp-modal-config" class="hidden fixed inset-0 bg-black/50 flex items-start sm:items-center justify-center z-50 p-3 overflow-y-auto">
    <div class="bg-white rounded-2xl shadow-xl w-full max-w-3xl p-4 sm:p-6 my-4">
        <div class="flex items-center justify-between mb-1">
            <h3 class="font-black text-slate-800 text-lg">Configurar o Dispenser</h3>
            <button id="disp-cfg-fechar" class="w-8 h-8 rounded-full hover:bg-slate-100 text-slate-500 cursor-pointer" aria-label="Fechar">✕</button>
        </div>
        <p class="text-xs text-slate-500 mb-4">Os ajustes abaixo valem para todos os operadores. Use <b>Testar</b> antes de salvar: o teste usa os valores que estão na tela.</p>

        <div id="disp-cfg-reservatorios" class="grid grid-cols-1 md:grid-cols-2 gap-4"></div>

        <h4 class="text-xs font-black text-slate-500 uppercase tracking-widest mt-5 mb-2">Quantidades disponíveis para o operador</h4>
        <div id="disp-cfg-doses" class="flex flex-wrap gap-4"></div>

        <p id="disp-cfg-msg" class="hidden mt-4 text-xs font-bold rounded-lg px-3 py-2"></p>

        <div class="flex gap-3 mt-5">
            <button id="disp-cfg-cancelar" class="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-2.5 rounded-lg transition cursor-pointer">Cancelar</button>
            <button id="disp-cfg-salvar" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-lg transition shadow-md cursor-pointer">Salvar</button>
        </div>
    </div>
</div>

<script>
(function () {
    const permissaoTotal = (window.__nivelUsuarioInicial || 3) <= 2;
    const LED_ON = "w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.6)] shrink-0";
    const LED_OFF = "w-2.5 h-2.5 rounded-full bg-slate-400 shrink-0";
    const COR_GRAO = { A: '#f4ecd8', B: '#8a5a3a' };
    const ROTULO_QUARTOS = { 1: '¼ de volta', 2: '½ volta', 3: '¾ de volta', 4: '1 volta' };

    const el = (id) => document.getElementById(id);
    const btnEmergencia = el('btn-emergencia-global');

    let estado = {
        online: false,
        motores: { 1: { ocupado: false, restantes: 0 }, 2: { ocupado: false, restantes: 0 } },
        ultimaDose: null,
        contador: { doses: 0, quartosPorReservatorio: { A: 0, B: 0 } },
        config: null
    };
    let escolha = { reservatorio: 'A', gramas: 100 };
    try { const salvo = JSON.parse(localStorage.getItem('dispenser_escolha') || 'null'); if (salvo) escolha = salvo; } catch (e) {}
    let emEmergencia = sessionStorage.getItem('estado_emergencia') === 'true';
    let aguardando = false;
    let totalEmAndamento = 0;
    const ouvintes = [];
    function ouvir(evento, funcao) { globalSocket.on(evento, funcao); ouvintes.push([evento, funcao]); }

    // ---------------------------------------------------------------- utilidades
    function toast(msg, tipo) {
        const d = document.createElement('div');
        d.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-[999996] px-4 py-3 rounded-xl shadow-lg text-sm font-bold text-white max-w-[90vw] text-center ' + (tipo === 'erro' ? 'bg-red-600' : 'bg-slate-800');
        d.textContent = msg;
        document.body.appendChild(d);
        setTimeout(() => d.remove(), 3400);
    }

    async function api(url, metodo, corpo) {
        try {
            const r = await fetch(url, {
                method: metodo || 'GET',
                headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
                body: corpo ? JSON.stringify(corpo) : undefined
            });
            let dados = {};
            try { dados = await r.json(); } catch (e) {}
            return { ok: r.ok, dados };
        } catch (e) {
            return { ok: false, dados: { erro: 'Sem conexão com o servidor.' } };
        }
    }

    function nomeReservatorio(r) {
        const c = estado.config;
        return c && c.reservatorios[r] ? c.reservatorios[r].nome : (r === 'A' ? 'Reservatório A' : 'Reservatório B');
    }

    function motorOcupado() { return estado.motores[1].ocupado || estado.motores[2].ocupado; }
    function reservatoriosEscolhidos() { return escolha.reservatorio === 'AB' ? ['A', 'B'] : [escolha.reservatorio]; }

    function svgPizza(n) {
        const cx = 50, cy = 50, r = 42;
        let h = '<svg viewBox="0 0 100 100" class="w-16 h-16 mx-auto">';
        for (let i = 0; i < 4; i++) {
            const a1 = (-90 + 90 * i) * Math.PI / 180, a2 = (-90 + 90 * (i + 1)) * Math.PI / 180;
            const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1), x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
            h += '<path d="M' + cx + ',' + cy + ' L' + x1.toFixed(1) + ',' + y1.toFixed(1) + ' A' + r + ',' + r + ' 0 0 1 ' + x2.toFixed(1) + ',' + y2.toFixed(1) + ' Z" fill="' + (i < n ? '#1d6fe0' : '#e2e8f0') + '" stroke="#ffffff" stroke-width="3"/>';
        }
        return h + '</svg>';
    }

    function svgFunil(cor) {
        return '<svg viewBox="0 0 40 40" class="w-9 h-9 shrink-0"><polygon points="5,6 35,6 25,28 15,28" fill="#e6c9a0" stroke="#b48f62" stroke-width="2"/><polygon points="8,11 32,11 24.5,27 15.5,27" fill="' + cor + '"/><rect x="17" y="28" width="6" height="8" rx="1" fill="#94a3b8"/></svg>';
    }

    // ---------------------------------------------------------------- telas
    function renderReservatorios() {
        const caixa = el('disp-reservatorios');
        const nomeA = nomeReservatorio('A'), nomeB = nomeReservatorio('B');
        const opcoes = [
            { id: 'A', rotulo: nomeA, icone: svgFunil(COR_GRAO.A) },
            { id: 'B', rotulo: nomeB, icone: svgFunil(COR_GRAO.B) },
            { id: 'AB', rotulo: nomeA + ' + ' + nomeB, icone: svgFunil(COR_GRAO.A) + svgFunil(COR_GRAO.B) }
        ];
        caixa.innerHTML = '';
        opcoes.forEach(o => {
            const b = document.createElement('button');
            const sel = escolha.reservatorio === o.id;
            b.type = 'button';
            b.className = 'flex items-center gap-3 border-2 rounded-xl px-4 py-3 text-left transition cursor-pointer ' + (sel ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200' : 'border-slate-200 bg-white hover:border-blue-300');
            b.innerHTML = o.icone + '<span class="font-bold text-sm text-slate-800">' + o.rotulo + '</span>';
            b.addEventListener('click', () => { escolha.reservatorio = o.id; salvarEscolha(); renderTudo(); });
            caixa.appendChild(b);
        });
    }

    function renderDoses() {
        const caixa = el('disp-doses');
        const doses = (estado.config ? estado.config.doses : []).filter(d => d.ativo);
        if (doses.length && !doses.some(d => d.gramas === escolha.gramas)) escolha.gramas = doses[0].gramas;
        caixa.innerHTML = '';
        doses.forEach(d => {
            const quartos = Math.round(d.gramas / 50);
            const sel = escolha.gramas === d.gramas;
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'border-2 rounded-xl px-3 py-4 text-center transition cursor-pointer ' + (sel ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200' : 'border-slate-200 bg-white hover:border-blue-300');
            b.innerHTML = svgPizza(quartos) + '<div class="mt-2 text-2xl font-black text-slate-800">' + d.gramas + ' g</div><div class="text-[11px] font-bold text-blue-600">' + ROTULO_QUARTOS[quartos] + '</div>';
            b.addEventListener('click', () => { escolha.gramas = d.gramas; salvarEscolha(); renderTudo(); });
            caixa.appendChild(b);
        });
        if (!doses.length) caixa.innerHTML = '<p class="text-sm text-slate-400 col-span-full">Nenhuma quantidade disponível. Peça a um Administrador para ativar.</p>';
    }

    function renderResumo() {
        const quartos = Math.round(escolha.gramas / 50);
        const res = reservatoriosEscolhidos();
        const partes = res.map(r => {
            const gpb = estado.config && estado.config.reservatorios[r] ? estado.config.reservatorios[r].gramasPorBolso : 50;
            return nomeReservatorio(r) + ' (≈ ' + Math.round(quartos * gpb) + ' g reais)';
        });
        el('disp-resumo').textContent = 'Vai dosar ' + ROTULO_QUARTOS[quartos] + ' do rotor: ' + partes.join(' e ') + '.';
    }

    function mostrarAviso(texto, tipo) {
        const a = el('disp-aviso');
        if (!texto) { a.classList.add('hidden'); return; }
        a.textContent = texto;
        a.className = 'mt-3 text-xs font-bold rounded-lg px-3 py-2 ' + (tipo === 'erro' ? 'bg-red-50 text-red-600 border border-red-200' : (tipo === 'info' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-amber-50 text-amber-700 border border-amber-200'));
    }

    function podeDosar() {
        return estado.online && !motorOcupado() && !emEmergencia && !aguardando && !!estado.config
            && estado.config.doses.some(d => d.ativo && d.gramas === escolha.gramas);
    }

    function atualizarBotoes() {
        const ocupado = motorOcupado();
        el('disp-led').className = estado.online ? LED_ON : LED_OFF;
        el('disp-btn-dosar').disabled = !podeDosar();
        el('disp-btn-dosar').textContent = ocupado ? 'DOSANDO...' : 'DOSAR';

        const prog = el('disp-progresso');
        if (ocupado) {
            prog.classList.remove('hidden');
            const restantes = Math.max(estado.motores[1].restantes, estado.motores[2].restantes);
            if (totalEmAndamento > 0) {
                const feito = Math.max(0, Math.min(1, 1 - restantes / totalEmAndamento));
                el('disp-progresso-barra').style.width = Math.round(feito * 100) + '%';
                el('disp-progresso-pct').textContent = Math.round(feito * 100) + '%';
            } else {
                el('disp-progresso-barra').style.width = '60%';
                el('disp-progresso-pct').textContent = '';
            }
        } else {
            prog.classList.add('hidden');
            totalEmAndamento = 0;
        }

        if (emEmergencia) mostrarAviso('EMERGÊNCIA ATIVA: a dosagem está bloqueada. Desbloqueie pelo botão no topo da tela.', 'erro');
        else if (!estado.online) mostrarAviso('O Dispenser está desconectado da rede. Verifique a alimentação do equipamento.', 'alerta');
        else if (ocupado) mostrarAviso('Dosagem em andamento...', 'info');
        else mostrarAviso('');
    }

    function renderUltima() {
        const u = estado.ultimaDose;
        el('disp-ultima').textContent = u
            ? u.hora + ' · ' + u.gramas + ' g de ' + u.nomes.join(' + ') + ' · por ' + u.usuario
            : 'Nenhuma dosagem desde que o sistema ligou.';
        const c = estado.contador;
        const gA = Math.round((c.quartosPorReservatorio.A || 0) * 50), gB = Math.round((c.quartosPorReservatorio.B || 0) * 50);
        el('disp-contador').textContent = c.doses + (c.doses === 1 ? ' dosagem' : ' dosagens') + ' · ' + nomeReservatorio('A') + ' ≈ ' + gA + ' g · ' + nomeReservatorio('B') + ' ≈ ' + gB + ' g (valores nominais)';
    }

    function renderTudo() {
        renderReservatorios();
        renderDoses();
        renderResumo();
        renderUltima();
        atualizarBotoes();
    }

    function salvarEscolha() { try { localStorage.setItem('dispenser_escolha', JSON.stringify(escolha)); } catch (e) {} }

    function aplicarEstado(novo) {
        if (!novo) return;
        estado = Object.assign({}, estado, novo);
        renderTudo();
    }

    // ---------------------------------------------------------------- ações
    async function dosar() {
        if (!podeDosar()) return;
        const quartos = Math.round(escolha.gramas / 50);
        if (window.__tutorialAtivo) { toast('Modo de teste do tutorial: nada foi enviado à máquina.'); return; }
        aguardando = true; atualizarBotoes();
        const r = await api('/api/dispenser/dosar', 'POST', { gramas: escolha.gramas, reservatorios: reservatoriosEscolhidos() });
        aguardando = false;
        if (r.ok) { totalEmAndamento = quartos; toast('Dosagem enviada!'); }
        else toast(r.dados.erro || 'Não foi possível dosar.', 'erro');
        atualizarBotoes();
    }

    async function pararDosagem() {
        if (window.__tutorialAtivo) return;
        const r = await api('/api/dispenser/parar', 'POST', {});
        toast(r.ok ? 'Dosagem interrompida.' : (r.dados.erro || 'Não foi possível parar.'), r.ok ? undefined : 'erro');
    }

    el('disp-btn-dosar').addEventListener('click', dosar);
    el('disp-btn-parar').addEventListener('click', pararDosagem);

    // ---------------------------------------------------------------- configuração (Administrador / Dono)
    const modal = el('disp-modal-config');
    let cfgEditavel = null;

    function msgCfg(texto, tipo) {
        const m = el('disp-cfg-msg');
        if (!texto) { m.classList.add('hidden'); return; }
        m.textContent = texto;
        m.className = 'mt-4 text-xs font-bold rounded-lg px-3 py-2 ' + (tipo === 'erro' ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200');
    }

    function lerFormulario() {
        const cfg = JSON.parse(JSON.stringify(cfgEditavel));
        ['A', 'B'].forEach(r => {
            const caixa = document.querySelector('[data-cfg-res="' + r + '"]');
            const c = cfg.reservatorios[r];
            c.nome = caixa.querySelector('.f-nome').value.trim();
            c.gramasPorBolso = parseFloat(caixa.querySelector('.f-gpb').value);
            c.pwm = parseInt(caixa.querySelector('.f-pwm').value, 10);
            c.tempoQuartoMs = parseInt(caixa.querySelector('.f-tempo').value, 10);
            c.pausaMs = parseInt(caixa.querySelector('.f-pausa').value, 10);
            c.sentidoInvertido = caixa.querySelector('.f-sentido').value === 'invertido';
        });
        cfg.doses.forEach((d, i) => { d.ativo = document.querySelector('[data-cfg-dose="' + i + '"]').checked; });
        return cfg;
    }

    function desenharConfig() {
        const caixa = el('disp-cfg-reservatorios');
        caixa.innerHTML = '';
        ['A', 'B'].forEach(r => {
            const c = cfgEditavel.reservatorios[r];
            const d = document.createElement('div');
            d.setAttribute('data-cfg-res', r);
            d.className = 'border-2 border-slate-200 rounded-xl p-4 space-y-3';
            d.innerHTML =
                '<div class="flex items-center gap-2">' + svgFunil(COR_GRAO[r]) + '<div><div class="font-black text-slate-800 text-sm">Reservatório ' + r + '</div><div class="text-[10px] text-slate-400 uppercase font-bold">Motor ' + c.motor + '</div></div></div>' +
                '<label class="block text-[11px] font-bold text-slate-600">Nome do grão<input class="f-nome mt-1 w-full border-2 border-slate-200 rounded-lg px-3 py-2 text-sm" maxlength="20" value="' + c.nome.replace(/"/g, '&quot;') + '"></label>' +
                '<label class="block text-[11px] font-bold text-slate-600">Gramas reais por bolso (calibração com balança)<input class="f-gpb mt-1 w-full border-2 border-slate-200 rounded-lg px-3 py-2 text-sm" type="number" min="10" max="150" step="0.5" value="' + c.gramasPorBolso + '"></label>' +
                '<label class="block text-[11px] font-bold text-slate-600">Velocidade do motor: <span class="f-pwm-txt text-blue-600">' + c.pwm + '%</span><input class="f-pwm mt-1 w-full range-slider" type="range" min="20" max="100" step="5" value="' + c.pwm + '"></label>' +
                '<div class="grid grid-cols-2 gap-3">' +
                '<label class="block text-[11px] font-bold text-slate-600">Tempo de ¼ de volta (ms)<input class="f-tempo mt-1 w-full border-2 border-slate-200 rounded-lg px-3 py-2 text-sm" type="number" min="50" max="2000" step="10" value="' + c.tempoQuartoMs + '"></label>' +
                '<label class="block text-[11px] font-bold text-slate-600">Pausa entre ¼ (ms)<input class="f-pausa mt-1 w-full border-2 border-slate-200 rounded-lg px-3 py-2 text-sm" type="number" min="0" max="2000" step="10" value="' + c.pausaMs + '"></label>' +
                '</div>' +
                '<label class="block text-[11px] font-bold text-slate-600">Sentido de giro<select class="f-sentido mt-1 w-full border-2 border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"><option value="normal"' + (c.sentidoInvertido ? '' : ' selected') + '>Normal</option><option value="invertido"' + (c.sentidoInvertido ? ' selected' : '') + '>Invertido</option></select></label>' +
                '<div class="grid grid-cols-3 gap-2 pt-1">' +
                '<button type="button" class="f-testar col-span-3 bg-orange-500 hover:bg-orange-600 text-white text-[11px] font-bold py-2 rounded-lg cursor-pointer">TESTAR ¼ DE VOLTA</button>' +
                '<button type="button" class="f-aj-menos bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold py-2 rounded-lg cursor-pointer">◀ 30 ms</button>' +
                '<div class="text-[10px] text-slate-400 text-center self-center leading-tight">ajuste fino do alinhamento</div>' +
                '<button type="button" class="f-aj-mais bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold py-2 rounded-lg cursor-pointer">30 ms ▶</button>' +
                '</div>';
            caixa.appendChild(d);

            const pwm = d.querySelector('.f-pwm');
            pwm.addEventListener('input', () => { d.querySelector('.f-pwm-txt').textContent = pwm.value + '%'; });
            const sobreposicao = () => {
                const f = lerFormulario().reservatorios[r];
                return { pwm: f.pwm, tempoQuartoMs: f.tempoQuartoMs, pausaMs: f.pausaMs, sentidoInvertido: f.sentidoInvertido };
            };
            d.querySelector('.f-testar').addEventListener('click', async () => {
                const x = await api('/api/dispenser/teste', 'POST', Object.assign({ reservatorio: r, tipo: 'quarto' }, sobreposicao()));
                msgCfg(x.ok ? 'Teste enviado: o motor ' + c.motor + ' vai girar ¼ de volta.' : (x.dados.erro || 'Falha no teste.'), x.ok ? 'ok' : 'erro');
            });
            d.querySelector('.f-aj-menos').addEventListener('click', async () => {
                const x = await api('/api/dispenser/teste', 'POST', { reservatorio: r, tipo: 'ajuste', ajusteMs: -30 });
                if (!x.ok) msgCfg(x.dados.erro || 'Falha no ajuste.', 'erro');
            });
            d.querySelector('.f-aj-mais').addEventListener('click', async () => {
                const x = await api('/api/dispenser/teste', 'POST', { reservatorio: r, tipo: 'ajuste', ajusteMs: 30 });
                if (!x.ok) msgCfg(x.dados.erro || 'Falha no ajuste.', 'erro');
            });
        });

        const dosesCaixa = el('disp-cfg-doses');
        dosesCaixa.innerHTML = '';
        cfgEditavel.doses.forEach((dose, i) => {
            const l = document.createElement('label');
            l.className = 'flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer';
            l.innerHTML = '<input type="checkbox" data-cfg-dose="' + i + '" class="w-5 h-5 rounded border-slate-300"' + (dose.ativo ? ' checked' : '') + '> ' + dose.gramas + ' g <span class="text-[10px] text-slate-400 font-normal">(' + ROTULO_QUARTOS[Math.round(dose.gramas / 50)] + ')</span>';
            dosesCaixa.appendChild(l);
        });
    }

    async function abrirConfig() {
        if (!permissaoTotal) return;
        const r = await api('/api/dispenser/estado');
        if (!r.ok || !r.dados.config) { toast('Não foi possível carregar a configuração.', 'erro'); return; }
        cfgEditavel = JSON.parse(JSON.stringify(r.dados.config));
        msgCfg('');
        desenharConfig();
        modal.classList.remove('hidden');
    }
    function fecharConfig() { modal.classList.add('hidden'); }

    async function salvarConfig() {
        const cfg = lerFormulario();
        const r = await api('/api/dispenser/config', 'POST', cfg);
        if (r.ok) { msgCfg('Configuração salva!', 'ok'); setTimeout(fecharConfig, 700); await carregar(); }
        else msgCfg(r.dados.erro || 'Não foi possível salvar.', 'erro');
    }

    if (permissaoTotal) {
        el('disp-btn-config').classList.remove('hidden');
        el('disp-btn-config').classList.add('flex');
    }
    el('disp-btn-config').addEventListener('click', abrirConfig);
    el('disp-cfg-fechar').addEventListener('click', fecharConfig);
    el('disp-cfg-cancelar').addEventListener('click', fecharConfig);
    el('disp-cfg-salvar').addEventListener('click', salvarConfig);
    modal.addEventListener('click', (e) => { if (e.target === modal) fecharConfig(); });

    // ---------------------------------------------------------------- estado ao vivo
    async function carregar() {
        const r = await api('/api/dispenser/estado');
        if (r.ok) aplicarEstado(r.dados);
    }

    function handlerEmergencia() {
        setTimeout(() => { emEmergencia = sessionStorage.getItem('estado_emergencia') === 'true'; atualizarBotoes(); }, 0);
    }
    if (btnEmergencia) btnEmergencia.addEventListener('click', handlerEmergencia);

    ouvir('dispenser_estado', (dados) => aplicarEstado(dados));
    ouvir('dispenser_config', (cfg) => { estado.config = Object.assign({}, estado.config, cfg); renderTudo(); });
    ouvir('emergencia_remota', () => { emEmergencia = true; atualizarBotoes(); });

    renderTudo();
    carregar();

    window.__cleanupPagina = function () {
        ouvintes.forEach(([evento, funcao]) => globalSocket.off(evento, funcao));
        if (btnEmergencia) btnEmergencia.removeEventListener('click', handlerEmergencia);
    };
})();
</script>
{% endblock %}
'''
PAGINA_CONTROLE = r'''{% extends 'base.html' %}

{% block title %}Painel de Controle{% endblock %}

{% block content %}
<div class="flex flex-col gap-4 sm:gap-6">

    <!-- Barra de status: LEDs dos ESP32 + emergencia + recarregar -->
    <div class="card-painel">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
                <h2 class="text-sm sm:text-base font-black text-slate-800 uppercase tracking-wider">Painel de Controle</h2>
                <p class="text-[11px] text-slate-400">Velocidades e temperaturas de toda a máquina. Os valores ficam salvos ao trocar de tela.</p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
                <div class="flex items-center gap-1.5 bg-white border border-slate-200 rounded-full px-3 py-1.5 shadow-sm">
                    <span id="led-painel-esteira" class="w-2.5 h-2.5 rounded-full bg-slate-400 shrink-0"></span>
                    <span class="text-[10px] font-bold text-slate-700">ESTEIRA</span>
                </div>
                <div class="flex items-center gap-1.5 bg-white border border-slate-200 rounded-full px-3 py-1.5 shadow-sm">
                    <span id="led-painel-selagem1" class="w-2.5 h-2.5 rounded-full bg-slate-400 shrink-0"></span>
                    <span class="text-[10px] font-bold text-slate-700">SEL. 1 AQUEC.</span>
                </div>
                <div class="flex items-center gap-1.5 bg-white border border-slate-200 rounded-full px-3 py-1.5 shadow-sm">
                    <span id="led-painel-selagem1motor" class="w-2.5 h-2.5 rounded-full bg-slate-400 shrink-0"></span>
                    <span class="text-[10px] font-bold text-slate-700">SEL. 1 MOTORES</span>
                </div>
                <div class="flex items-center gap-1.5 bg-white border border-slate-200 rounded-full px-3 py-1.5 shadow-sm">
                    <span id="led-painel-selagem2" class="w-2.5 h-2.5 rounded-full bg-slate-400 shrink-0"></span>
                    <span class="text-[10px] font-bold text-slate-700">SEL. 2 AQUEC.</span>
                </div>
                <div class="flex items-center gap-1.5 bg-white border border-slate-200 rounded-full px-3 py-1.5 shadow-sm">
                    <span id="led-painel-selagem2motor" class="w-2.5 h-2.5 rounded-full bg-slate-400 shrink-0"></span>
                    <span class="text-[10px] font-bold text-slate-700">SEL. 2 MOTOR</span>
                </div>
                <div class="flex items-center gap-1.5 bg-white border border-slate-200 rounded-full px-3 py-1.5 shadow-sm">
                    <span id="led-painel-emerg" class="w-2.5 h-2.5 rounded-full bg-slate-400 shrink-0"></span>
                    <span class="text-[10px] font-bold text-slate-700">EMERG.</span>
                </div>
                <button id="btn-painel-recarregar" title="Recarregar status recebido" class="w-8 h-8 bg-white border border-slate-200 rounded-full flex items-center justify-center text-slate-500 hover:text-blue-600 hover:border-blue-300 active:bg-blue-50 transition cursor-pointer shadow-sm shrink-0">
                    <svg id="icone-painel-recarregar" class="w-4 h-4 transition-transform duration-500" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                    </svg>
                </button>
            </div>
        </div>
        <p id="aviso-painel-emergencia" class="hidden mt-3 text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            EMERGÊNCIA ATIVA: todos os controles estão bloqueados. Desbloqueie pelo botão no topo da tela.
        </p>
    </div>

    <div>
        <h3 class="text-xs font-black text-slate-500 uppercase tracking-widest mb-2">Velocidades</h3>
        <div id="grade-motores" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4"></div>
    </div>

    <div>
        <h3 class="text-xs font-black text-slate-500 uppercase tracking-widest mb-2">Temperaturas</h3>
        <div id="grade-temperaturas" class="grid grid-cols-1 md:grid-cols-2 gap-4"></div>
    </div>

</div>

<script>
(function() {
    const CLASSE_LED_ON = "w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.6)] shrink-0";
    const CLASSE_LED_OFF = "w-2.5 h-2.5 rounded-full bg-slate-400 shrink-0";
    const CLASSE_LED_EMERG = "w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse shadow-[0_0_8px_rgba(220,38,38,0.8)] shrink-0";

    const btnEmergenciaGlobal = document.getElementById('btn-emergencia-global');
    const ledEmerg = document.getElementById('led-painel-emerg');
    const avisoEmergencia = document.getElementById('aviso-painel-emergencia');
    const btnRecarregar = document.getElementById('btn-painel-recarregar');
    const iconeRecarregar = document.getElementById('icone-painel-recarregar');

    const ledsDispositivo = {
        esteira: document.getElementById('led-painel-esteira'),
        selagem1: document.getElementById('led-painel-selagem1'),
        selagem1motor: document.getElementById('led-painel-selagem1motor'),
        selagem2: document.getElementById('led-painel-selagem2'),
        selagem2motor: document.getElementById('led-painel-selagem2motor')
    };
    const nomesDispositivo = { esteira: 'Esteira', selagem1: 'Selagem 1 (aquecimento)', selagem1motor: 'Selagem 1 (motores)', selagem2: 'Selagem 2 (aquecimento)', selagem2motor: 'Selagem 2 (motor)' };
    const online = { esteira: false, selagem1: false, selagem1motor: false, selagem2: false, selagem2motor: false };
    let emEmergencia = sessionStorage.getItem('estado_emergencia') === 'true';

    // Registro dos ouvintes do socket, pra limpar tudo ao sair da tela
    const ouvintes = [];
    function ouvir(evento, funcao) {
        globalSocket.on(evento, funcao);
        ouvintes.push([evento, funcao]);
    }

    function adicionarLog(mensagem, tipo) {
        if (window.__tutorialAtivo) return;
        const hora = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        globalSocket.emit('novo_log', { hora: hora, texto: mensagem, tipo: tipo || 'sistema' });
    }

    // ================================================================================
    // MOTORES (Esteira + 3 motores das selagens)
    // ================================================================================
    const MOTORES = [
        { id: 'esteira', titulo: 'Esteira', dispositivo: 'esteira', reiniciar: 'REINICIAR ESP32 DA ESTEIRA' },
        { id: 's1m1', titulo: 'Selagem 1 - Motor 1', dispositivo: 'selagem1motor', reiniciar: 'REINICIAR ESP32 DOS MOTORES (1 e 2)' },
        { id: 's1m2', titulo: 'Selagem 1 - Motor 2', dispositivo: 'selagem1motor' },
        { id: 's2m', titulo: 'Selagem 2 - Motor', dispositivo: 'selagem2motor', reiniciar: 'REINICIAR ESP32 DO MOTOR' }
    ];

    function htmlCardMotor(m) {
        return `
        <div class="card-painel flex flex-col" data-motor="${m.id}">
            <div class="flex items-center justify-between border-b border-slate-100 pb-2 mb-3">
                <h3 class="text-xs sm:text-sm uppercase font-bold text-slate-800">${m.titulo}</h3>
                <span class="led ${CLASSE_LED_OFF}"></span>
            </div>
            <div class="text-center my-2">
                <span class="visor text-4xl font-black text-slate-800">0%</span>
                <p class="text-[10px] text-blue-500 uppercase font-bold mt-1">Potência do Motor</p>
            </div>
            <input type="range" min="0" max="1" step="0.01" value="0" class="slider range-slider w-full mb-3 cursor-pointer">
            <p class="aviso hidden text-[11px] text-amber-600 font-bold mb-2">ESP32 desconectado da rede.</p>
            <div class="grid grid-cols-2 gap-2">
                <button class="btn-iniciar w-full bg-[#10b981] hover:bg-[#059669] active:bg-[#047857] text-white font-bold py-2.5 rounded-lg shadow transition cursor-pointer text-xs">INICIAR</button>
                <button class="btn-parar w-full bg-slate-500 hover:bg-slate-600 active:bg-slate-700 text-white font-bold py-2.5 rounded-lg shadow transition cursor-pointer text-xs">PARAR</button>
            </div>
            <div class="mt-3 flex items-center justify-between gap-2">
                <span class="text-[11px] font-bold text-slate-500 uppercase">Sentido: <span class="texto-sentido text-blue-600">NORMAL</span></span>
                <button class="btn-inverter bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-[10px] font-bold px-3 py-2 rounded-lg transition cursor-pointer">INVERTER</button>
            </div>
            ${m.reiniciar ? `<button class="btn-reiniciar mt-3 w-full bg-slate-700 hover:bg-slate-800 text-white text-[11px] font-bold py-2 rounded-lg transition cursor-pointer">${m.reiniciar}</button>` : ''}
        </div>`;
    }

    const gradeMotores = document.getElementById('grade-motores');
    gradeMotores.innerHTML = MOTORES.map(htmlCardMotor).join('');

    const controlesMotor = {};

    MOTORES.forEach(m => {
        const card = gradeMotores.querySelector(`[data-motor="${m.id}"]`);
        const ctrl = {
            config: m,
            led: card.querySelector('.led'),
            visor: card.querySelector('.visor'),
            slider: card.querySelector('.slider'),
            aviso: card.querySelector('.aviso'),
            textoSentido: card.querySelector('.texto-sentido'),
            botoes: card.querySelectorAll('button'),
            arrastando: false,
            sentido: 'normal'
        };
        controlesMotor[m.id] = ctrl;

        function enviarVelocidade(pct) {
            if (emEmergencia) return;
            const valor = (pct / 100).toFixed(2);
            if (m.id === 'esteira') {
                globalSocket.emit('comando_esteira', { acao: 'velocidade', valor: valor });
            } else {
                globalSocket.emit('comando_painel', { acao: 'motor_velocidade', id: m.id, valor: valor });
            }
            ctrl.slider.value = pct / 100;
            ctrl.visor.innerText = pct + '%';
            adicionarLog(`Velocidade de ${m.titulo} alterada para ${pct}% (Painel de Controle)`, 'velocidade');
        }

        ctrl.slider.addEventListener('input', (e) => {
            ctrl.arrastando = true;
            ctrl.visor.innerText = Math.round(e.target.value * 100) + '%';
        });
        ctrl.slider.addEventListener('change', (e) => {
            ctrl.arrastando = false;
            enviarVelocidade(Math.round(e.target.value * 100));
        });
        card.querySelector('.btn-iniciar').addEventListener('click', () => enviarVelocidade(50));
        card.querySelector('.btn-parar').addEventListener('click', () => enviarVelocidade(0));

        card.querySelector('.btn-inverter').addEventListener('click', () => {
            if (emEmergencia) return;
            const novo = ctrl.sentido === 'invertido' ? 'normal' : 'invertido';
            if (!confirm(`Inverter o sentido de ${m.titulo} para ${novo.toUpperCase()}?`)) return;
            if (m.id === 'esteira') {
                globalSocket.emit('comando_painel', { acao: 'esteira_sentido', sentido: novo });
            } else {
                globalSocket.emit('comando_painel', { acao: 'motor_sentido', id: m.id, sentido: novo });
            }
            adicionarLog(`Sentido de ${m.titulo} alterado para ${novo.toUpperCase()}`, 'velocidade');
        });

        const btnReiniciar = card.querySelector('.btn-reiniciar');
        if (btnReiniciar) {
            btnReiniciar.addEventListener('click', () => reiniciarDispositivo(m.dispositivo));
        }
    });

    function aplicarVelocidadeMotor(id, velocidade) {
        const ctrl = controlesMotor[id];
        if (!ctrl || ctrl.arrastando || velocidade === 'EMERGENCIA') return;
        const v = parseFloat(velocidade);
        if (isNaN(v)) return;
        const fracao = v > 1 ? v / 100 : v;
        ctrl.slider.value = fracao;
        ctrl.visor.innerText = Math.round(fracao * 100) + '%';
    }

    function aplicarSentidoMotor(id, sentido) {
        const ctrl = controlesMotor[id];
        if (!ctrl || !sentido) return;
        ctrl.sentido = sentido;
        ctrl.textoSentido.innerText = sentido === 'invertido' ? 'INVERTIDO' : 'NORMAL';
        ctrl.textoSentido.className = 'texto-sentido ' + (sentido === 'invertido' ? 'text-amber-600' : 'text-blue-600');
    }

    // ================================================================================
    // TEMPERATURAS (Selagem 1 e Selagem 2)
    // ================================================================================
    const SELAGENS = [
        { numero: 1, titulo: 'Temperatura da Selagem 1', dispositivo: 'selagem1', eventoDados: 'atualizar_temperatura', eventoComando: 'comando_selagem' },
        { numero: 2, titulo: 'Temperatura da Selagem 2', dispositivo: 'selagem2', eventoDados: 'atualizar_temperatura2', eventoComando: 'comando_selagem2' }
    ];

    function htmlCardTemperatura(s) {
        return `
        <div class="card-painel flex flex-col" data-selagem="${s.numero}">
            <div class="flex items-center justify-between border-b border-slate-100 pb-2 mb-3 gap-2">
                <h3 class="text-xs sm:text-sm uppercase font-bold text-slate-800">${s.titulo}</h3>
                <label class="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 cursor-pointer select-none">
                    <input type="checkbox" class="check-ignorar rounded border-slate-300 w-3.5 h-3.5">
                    Ignorar aviso
                </label>
            </div>
            <div class="flex items-center justify-between mb-2">
                <span class="estado-aquecimento text-[10px] font-black px-2 py-1 rounded-full bg-slate-100 text-slate-500">AQUECIMENTO DESLIGADO</span>
                <span class="potencia text-[10px] font-bold text-slate-400">Potência: 0%</span>
            </div>
            <div class="text-center my-2">
                <span class="visor-temp text-4xl font-black text-slate-800">--°C</span>
                <p class="text-[10px] text-slate-500 uppercase font-bold mt-1">Leitura em Tempo Real</p>
            </div>
            <div class="flex justify-between text-xs font-bold text-slate-600 mb-2">
                <span>Alvo:</span>
                <span class="alvo-texto text-slate-500">0°C</span>
            </div>
            <input type="range" min="0" max="250" step="5" value="0" class="slider-temp range-slider w-full mb-2 cursor-pointer">
            <p class="aviso-temp hidden text-[11px] text-amber-600 font-bold mb-2"></p>
            <div class="grid grid-cols-2 gap-2 mt-1">
                <button class="btn-ligar w-full bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white font-bold py-2.5 rounded-lg shadow transition cursor-pointer text-xs">LIGAR AQUECIMENTO</button>
                <button class="btn-desligar w-full bg-slate-500 hover:bg-slate-600 active:bg-slate-700 text-white font-bold py-2.5 rounded-lg shadow transition cursor-pointer text-xs">DESLIGAR</button>
            </div>
            <button class="btn-resetar mt-2 w-full bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-bold py-2 rounded-lg shadow transition cursor-pointer text-[11px]">RESETAR FALHA</button>
            <button class="btn-reiniciar mt-3 w-full bg-slate-700 hover:bg-slate-800 text-white text-[11px] font-bold py-2 rounded-lg transition cursor-pointer">REINICIAR ESP32 DO AQUECIMENTO</button>
        </div>`;
    }

    const gradeTemperaturas = document.getElementById('grade-temperaturas');
    gradeTemperaturas.innerHTML = SELAGENS.map(htmlCardTemperatura).join('');

    const controlesTemp = {};

    SELAGENS.forEach(s => {
        const card = gradeTemperaturas.querySelector(`[data-selagem="${s.numero}"]`);
        const ctrl = {
            config: s,
            visor: card.querySelector('.visor-temp'),
            alvo: card.querySelector('.alvo-texto'),
            slider: card.querySelector('.slider-temp'),
            aviso: card.querySelector('.aviso-temp'),
            estado: card.querySelector('.estado-aquecimento'),
            potencia: card.querySelector('.potencia'),
            checkIgnorar: card.querySelector('.check-ignorar'),
            botoes: card.querySelectorAll('button'),
            arrastando: false,
            ultimaSeguranca: 'ok',
            ultimoHabilitado: false,
            ultimoMotivo: ''
        };
        controlesTemp[s.numero] = ctrl;

        ctrl.slider.addEventListener('input', (e) => {
            ctrl.arrastando = true;
            ctrl.alvo.innerText = e.target.value + '°C';
        });
        ctrl.slider.addEventListener('change', (e) => {
            ctrl.arrastando = false;
            if (emEmergencia) return;
            globalSocket.emit(s.eventoComando, { acao: 'setpoint', valor: e.target.value });
            adicionarLog(`Temperatura alvo da Selagem ${s.numero} ajustada para ${e.target.value}°C (Painel de Controle)`, 'temperatura');
        });

        card.querySelector('.btn-ligar').addEventListener('click', () => {
            if (emEmergencia) return;
            globalSocket.emit('comando_painel', { acao: 'aquecimento', numero: s.numero, valor: true });
            adicionarLog(`Aquecimento da Selagem ${s.numero} LIGADO (Painel de Controle)`, 'temperatura');
        });
        card.querySelector('.btn-desligar').addEventListener('click', () => {
            globalSocket.emit('comando_painel', { acao: 'aquecimento', numero: s.numero, valor: false });
            adicionarLog(`Aquecimento da Selagem ${s.numero} DESLIGADO (Painel de Controle)`, 'temperatura');
        });
        card.querySelector('.btn-resetar').addEventListener('click', () => {
            globalSocket.emit('comando_painel', { acao: 'resetar_falha', numero: s.numero });
            adicionarLog(`Solicitado RESET de falha da Selagem ${s.numero} (Painel de Controle)`, 'temperatura');
        });
        ctrl.checkIgnorar.addEventListener('change', () => atualizarAvisoTemp(s.numero));
        card.querySelector('.btn-reiniciar').addEventListener('click', () => reiniciarDispositivo(s.dispositivo));
    });

    function atualizarAvisoTemp(numero) {
        const ctrl = controlesTemp[numero];
        const disp = ctrl.config.dispositivo;
        if (!online[disp]) {
            ctrl.aviso.innerText = 'ESP32 desconectado da rede.';
            ctrl.aviso.classList.remove('hidden');
            return;
        }
        if (ctrl.checkIgnorar.checked || ctrl.ultimaSeguranca === 'ok') {
            ctrl.aviso.classList.add('hidden');
            return;
        }
        const base = ctrl.ultimaSeguranca === 'temperatura_alta'
            ? 'AVISO: temperatura muito alta!'
            : 'AVISO: falha no sensor de temperatura.';
        const motivo = ctrl.ultimoMotivo ? ` (${ctrl.ultimoMotivo})` : '';
        const situacao = ctrl.ultimoHabilitado
            ? ' O aquecimento continua funcionando.'
            : ' Aquecimento desligado: corrija o problema e clique em RESETAR FALHA.';
        ctrl.aviso.innerText = base + motivo + situacao;
        ctrl.aviso.classList.remove('hidden');
    }

    function aplicarDadosTemperatura(numero, dados) {
        const ctrl = controlesTemp[numero];
        if (!ctrl || !dados) return;
        if (typeof dados.temperatura === 'number') ctrl.visor.innerText = dados.temperatura.toFixed(1) + '°C';
        if (!ctrl.arrastando && typeof dados.setpoint === 'number') {
            ctrl.slider.value = dados.setpoint;
            ctrl.alvo.innerText = Math.round(dados.setpoint) + '°C';
        }
        if (typeof dados.potencia === 'number') ctrl.potencia.innerText = 'Potência: ' + Math.round(dados.potencia) + '%';
        if (dados.habilitado) {
            ctrl.estado.innerText = 'AQUECIMENTO LIGADO';
            ctrl.estado.className = 'estado-aquecimento text-[10px] font-black px-2 py-1 rounded-full bg-orange-100 text-orange-600';
        } else {
            ctrl.estado.innerText = 'AQUECIMENTO DESLIGADO';
            ctrl.estado.className = 'estado-aquecimento text-[10px] font-black px-2 py-1 rounded-full bg-slate-100 text-slate-500';
        }
        ctrl.ultimaSeguranca = dados.seguranca || 'ok';
        ctrl.ultimoHabilitado = !!dados.habilitado;
        ctrl.ultimoMotivo = dados.motivo || '';
        atualizarAvisoTemp(numero);
    }

    // ================================================================================
    // CONEXÃO, EMERGÊNCIA E REINÍCIO
    // ================================================================================
    function aplicarOnline(dispositivo, estaOnline) {
        online[dispositivo] = !!estaOnline;
        const classe = online[dispositivo] ? CLASSE_LED_ON : CLASSE_LED_OFF;
        ledsDispositivo[dispositivo].className = classe;
        MOTORES.forEach(m => {
            if (m.dispositivo !== dispositivo) return;
            const ctrl = controlesMotor[m.id];
            ctrl.led.className = 'led ' + classe;
            ctrl.aviso.classList.toggle('hidden', online[dispositivo]);
        });
        SELAGENS.forEach(s => { if (s.dispositivo === dispositivo) atualizarAvisoTemp(s.numero); });
    }

    function reiniciarDispositivo(dispositivo) {
        if (!confirm(`Reiniciar o ESP32 da ${nomesDispositivo[dispositivo]}? Ele vai ficar fora do ar por alguns segundos e voltar PARADO.`)) return;
        globalSocket.emit('comando_painel', { acao: 'reiniciar', dispositivo: dispositivo });
        adicionarLog(`Solicitado reinício do ESP32 da ${nomesDispositivo[dispositivo]} (Painel de Controle)`, 'sistema');
    }

    function aplicarEmergencia() {
        emEmergencia = sessionStorage.getItem('estado_emergencia') === 'true';
        ledEmerg.className = emEmergencia ? CLASSE_LED_EMERG : CLASSE_LED_OFF;
        avisoEmergencia.classList.toggle('hidden', !emEmergencia);

        const todos = [
            ...Object.values(controlesMotor).flatMap(c => [c.slider, ...c.botoes]),
            ...Object.values(controlesTemp).flatMap(c => [c.slider, ...c.botoes])
        ];
        todos.forEach(el => {
            el.disabled = emEmergencia;
            el.classList.toggle('opacity-50', emEmergencia);
            el.classList.toggle('cursor-not-allowed', emEmergencia);
        });
    }

    function handlerEmergencia() { setTimeout(aplicarEmergencia, 0); }
    btnEmergenciaGlobal.addEventListener('click', handlerEmergencia);

    // ================================================================================
    // ESTADO INICIAL (valores salvos no servidor) + RECARREGAR
    // ================================================================================
    function buscarEstado() {
        return fetch('/api/painel/estado')
            .then(r => r.json())
            .then(d => {
                aplicarOnline('esteira', d.esteira.online);
                aplicarOnline('selagem1', d.selagem1.online);
                aplicarOnline('selagem2', d.selagem2.online);
                aplicarOnline('selagem2motor', d.selagem2motor ? d.selagem2motor.online : false);
                aplicarOnline('selagem1motor', d.selagem1motor ? d.selagem1motor.online : false);
                aplicarVelocidadeMotor('esteira', d.esteira.velocidade);
                aplicarSentidoMotor('esteira', d.esteira.sentido);
                Object.entries(d.motores || {}).forEach(([id, m]) => {
                    aplicarVelocidadeMotor(id, m.velocidade);
                    aplicarSentidoMotor(id, m.sentido);
                });
                aplicarDadosTemperatura(1, d.selagem1.estado);
                aplicarDadosTemperatura(2, d.selagem2.estado);
            })
            .catch(erro => console.error('Erro ao buscar o estado do painel:', erro));
    }

    btnRecarregar.addEventListener('click', () => {
        iconeRecarregar.style.transform = 'rotate(360deg)';
        buscarEstado().finally(() => {
            setTimeout(() => { iconeRecarregar.style.transform = 'rotate(0deg)'; }, 500);
        });
    });

    // Atualizações ao vivo
    ouvir('status_esp32', (data) => aplicarOnline('esteira', data.online));
    ouvir('status_selagem', (data) => aplicarOnline('selagem1', data.online));
    ouvir('status_selagem2', (data) => aplicarOnline('selagem2', data.online));
    ouvir('status_selagem2motor', (data) => aplicarOnline('selagem2motor', data.online));
    ouvir('status_selagem1motor', (data) => aplicarOnline('selagem1motor', data.online));
    ouvir('atualizar_velocidade', (data) => aplicarVelocidadeMotor('esteira', data.velocidade));
    ouvir('sentido_esteira', (data) => aplicarSentidoMotor('esteira', data.sentido));
    ouvir('motor_selagem_velocidade', (data) => aplicarVelocidadeMotor(data.id, data.velocidade));
    ouvir('motor_selagem_sentido', (data) => aplicarSentidoMotor(data.id, data.sentido));
    ouvir('atualizar_temperatura', (dados) => aplicarDadosTemperatura(1, dados));
    ouvir('atualizar_temperatura2', (dados) => aplicarDadosTemperatura(2, dados));

    buscarEstado();
    aplicarEmergencia();

    window.__cleanupPagina = function() {
        ouvintes.forEach(([evento, funcao]) => globalSocket.off(evento, funcao));
        btnEmergenciaGlobal.removeEventListener('click', handlerEmergencia);
    };
})();
</script>
{% endblock %}
'''

def escrever_pagina(nome, caminho, conteudo, marcador):
    if os.path.exists(caminho) and marcador in ler(caminho):
        res.append("⏭️  Pagina %s: ja estava atualizada." % nome)
    else:
        gravar(caminho, conteudo)
        res.append("✅ Pagina %s: gravada." % nome)

os.makedirs(os.path.join(BASE, "views"), exist_ok=True)
escrever_pagina("Dispenser (views/dispenser.html)", CAMINHO_DISP, PAGINA_DISPENSER, "disp-modal-config")
escrever_pagina("Painel de Controle (views/controle.html)", CAMINHO_CTRL, PAGINA_CONTROLE, "led-painel-selagem1motor")

if not os.path.isdir(PASTA_MANUAIS):
    os.makedirs(PASTA_MANUAIS)
    res.append("✅ Pasta dos manuais criada: " + PASTA_MANUAIS)
else:
    res.append("⏭️  Pasta dos manuais: ja existia.")

# checagem
print("\n".join(res))
print()
ok = subprocess.run(["node", "-c", CAMINHO_SERVER], capture_output=True, text=True)
if ok.returncode == 0:
    print("✅ server.js sem erro de sintaxe.")
else:
    print("❌ ERRO DE SINTAXE no server.js:")
    print(ok.stderr)
    print("Para voltar ao que era antes:  cp " + CAMINHO_SERVER + ".bak_" + carimbo + " " + CAMINHO_SERVER)
    sys.exit(1)

if any(l.startswith("❌") for l in res):
    print("⚠️  Teve ❌ acima. Me mande essas linhas antes de reiniciar o site.")
else:
    print()
    print("Tudo certo! Agora reinicie o site:")
    print("    sudo systemctl restart site_esteira")
    print("Depois aperte Ctrl+Shift+R no navegador.")
    print("Os PDFs dos manuais vao na pasta: " + PASTA_MANUAIS)
