// GitHub: https://github.com/brunoosz | LinkedIn: https://www.linkedin.com/in/brunocamperlingo/
// broker de teste
const net = require('net');
const mqtt = require('mqtt');

const PORTA = parseInt(process.env.MOCK_MQTT_PORT, 10) || 1883;
const comPlacas = !process.argv.includes('--sem-esp32');

async function iniciar(opcoes = {}) {
    const { Aedes } = require('aedes');
    const aedes = await Aedes.createBroker();
    const servidor = net.createServer(aedes.handle);
    await new Promise(ok => servidor.listen(PORTA, '127.0.0.1', ok));
    console.log(`Broker MQTT de teste em mqtt://127.0.0.1:${PORTA}`);
    if (opcoes.placas === undefined ? comPlacas : opcoes.placas) placasDeMentira();
    return { aedes, servidor };
}

function placasDeMentira() {
    const c = mqtt.connect(`mqtt://127.0.0.1:${PORTA}`);
    let velocidade = '0.00';
    let setpoint1 = 0, setpoint2 = 0, ligada1 = false, ligada2 = false, temp1 = 25, temp2 = 25;
    let servo = { lado: 'C', fila: 0, angulos: { E: 45, C: 90, D: 135 }, angulo: 90, alvo: 90, vel: 60 };
    let voltaAoCentro = null;
    let autotune = 'parado', pid = { kp: 10.3, ki: 0.2, kd: 36.8 };
    const pub = (t, v) => c.publish(t, typeof v === 'string' ? v : JSON.stringify(v));

    c.on('connect', () => {
        c.subscribe(['esteira/velocidade/set', 'selagem/set_temperatura', 'selagem/ativar', 'selagem2/set_temperatura', 'selagem2/ativar', 'separador/teste', 'separador/config', 'separador/servo/angulo', 'separador/servo/parar', 'separador/desviar', 'selagem2/autotune', 'selagem2/pid', 'selagem2/calibrar', 'nfc/resultado', 'painel/resultado']);
        console.log('Placas de mentira ligadas: esteira, selagem 1, selagem 2, dispenser, servo do separador, painel NFC');
        console.log('Painel NFC de mentira: digite aqui  cartao <NUMERO-HEX>  |  mais  |  menos  |  emergencia  (ex.: cartao A1B2C3D4)');
    });
    c.on('message', (t, m) => {
        const v = m.toString();
        if (t === 'nfc/resultado') console.log('[painel] cartao ->', v);
        if (t === 'painel/resultado') console.log('[painel] botao ->', v);
        if (t === 'esteira/velocidade/set') velocidade = v;
        if (t === 'selagem/set_temperatura') setpoint1 = Number(v);
        if (t === 'selagem/ativar') ligada1 = v === '1';
        if (t === 'selagem2/set_temperatura') setpoint2 = Number(v);
        if (t === 'selagem2/ativar') ligada2 = v === '1';
        if (t === 'separador/config') { try { const j = JSON.parse(v); servo.angulos = { E: j.esq, C: j.centro, D: j.dir }; } catch (e) {} }
        if (t === 'separador/teste' && servo.angulos[v] !== undefined) {
            servo.lado = v; servo.alvo = servo.angulos[v]; clearTimeout(voltaAoCentro);
            if (v !== 'C') voltaAoCentro = setTimeout(() => { servo.lado = 'C'; servo.alvo = servo.angulos.C; }, 1500);
        }
        // selagem 2: ajuste fino de mentira
        if (t === 'selagem2/autotune' && v !== '0') {
            autotune = 'rodando';
            setTimeout(() => { if (autotune !== 'rodando') return; autotune = 'ok'; pid = { kp: 10.31, ki: 0.2082, kd: 36.8 }; pub('selagem2/autotune_resultado', { estado: 'ok', motivo: '', ku: 22.67, pu: 22.5, ...pid }); }, 8000);
        }
        if (t === 'selagem2/autotune' && v === '0') autotune = 'parado';
        if (t === 'selagem2/pid' && v !== 'padrao') { const [kp, ki, kd] = v.split(',').map(Number); pid = { kp, ki, kd }; }
        // servo livre
        if (t === 'separador/servo/angulo') {
            try { const j = JSON.parse(v); servo.alvo = j.a; servo.vel = j.v || servo.vel; servo.lado = 'M'; clearTimeout(voltaAoCentro); if (j.h > 0) voltaAoCentro = setTimeout(() => { servo.lado = 'C'; servo.alvo = servo.angulos.C; }, j.h); } catch (e) {}
        }
        if (t === 'separador/servo/parar') { servo.alvo = servo.angulo; clearTimeout(voltaAoCentro); }
        if (t === 'separador/desviar') {
            const [lado, atraso, aberto] = v.split(';');
            setTimeout(() => { servo.lado = lado; servo.alvo = servo.angulos[lado]; clearTimeout(voltaAoCentro); voltaAoCentro = setTimeout(() => { servo.lado = 'C'; servo.alvo = servo.angulos.C; }, Number(aberto) || 900); }, Number(atraso) || 0);
        }
    });

    setInterval(() => {
        const passo = 0.15 + (servo.vel - 1) * 5.85 / 99;
        servo.angulo += Math.max(-passo * 10, Math.min(passo * 10, servo.alvo - servo.angulo));
    }, 100);

    setInterval(() => {
        temp1 += ((ligada1 ? setpoint1 : 25) - temp1) * 0.1;
        temp2 += ((ligada2 ? setpoint2 : 25) - temp2) * 0.1;
        pub('esteira/status', 'online');
        pub('esteira/velocidade/atual', velocidade);
        pub('esteira/sentido/atual', 'normal');
        pub('selagem/status_conexao', 'online');
        pub('selagem/dados', { temperatura: +temp1.toFixed(1), setpoint: setpoint1, habilitado: ligada1, seguranca: 'ok' });
        pub('selagem2/status_conexao', 'online');
        pub('selagem2/dados', { temperatura: +temp2.toFixed(1), setpoint: setpoint2, potencia: ligada2 ? 40 : 0, habilitado: ligada2, seguranca: 'ok', autotune, bruta: +(temp2 - 1.5).toFixed(1), ambiente: 27.4, kp: pid.kp, ki: pid.ki, kd: pid.kd, manual: false });
        pub('selagem/motores/status', 'online');
        pub('selagem2/motor/status', 'online');
        pub('dispenser/status', 'online');
        pub('nfc/status', 'online');
        pub('separador/status', 'online');
        pub('separador/estado', { lado: servo.lado, angulo: +servo.angulo.toFixed(1), fila: servo.fila });
        pub('dispenser/estado', { m1: { ocupado: false, restantes: 0 }, m2: { ocupado: false, restantes: 0 } });
    }, 1000);

    // painel de mentira
    if (process.stdin.isTTY) {
        require('readline').createInterface({ input: process.stdin }).on('line', linha => {
            const [cmd, arg] = linha.trim().split(/\s+/);
            if (cmd === 'cartao' && arg) pub('nfc/leitura', arg);
            else if (['mais', 'menos', 'emergencia'].includes(cmd)) pub('painel/botao', cmd);
        });
    }
}

module.exports = { iniciar };
if (require.main === module) iniciar().catch(e => { console.error(e.message); process.exit(1); });
