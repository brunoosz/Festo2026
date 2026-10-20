// broker MQTT de mentira para testar o site sem a maquina
// uso: npm run mock   (com --sem-esp32 so sobe o broker, sem as placas de mentira)
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
    const pub = (t, v) => c.publish(t, typeof v === 'string' ? v : JSON.stringify(v));

    c.on('connect', () => {
        c.subscribe(['esteira/velocidade/set', 'selagem/set_temperatura', 'selagem/ativar', 'selagem2/set_temperatura', 'selagem2/ativar']);
        console.log('Placas de mentira ligadas: esteira, selagem 1, selagem 2, dispenser');
    });
    c.on('message', (t, m) => {
        const v = m.toString();
        if (t === 'esteira/velocidade/set') velocidade = v;
        if (t === 'selagem/set_temperatura') setpoint1 = Number(v);
        if (t === 'selagem/ativar') ligada1 = v === '1';
        if (t === 'selagem2/set_temperatura') setpoint2 = Number(v);
        if (t === 'selagem2/ativar') ligada2 = v === '1';
    });

    setInterval(() => {
        temp1 += ((ligada1 ? setpoint1 : 25) - temp1) * 0.1;
        temp2 += ((ligada2 ? setpoint2 : 25) - temp2) * 0.1;
        pub('esteira/status', 'online');
        pub('esteira/velocidade/atual', velocidade);
        pub('esteira/sentido/atual', 'normal');
        pub('selagem/status_conexao', 'online');
        pub('selagem/dados', { temperatura: +temp1.toFixed(1), setpoint: setpoint1, habilitado: ligada1, seguranca: 'ok' });
        pub('selagem2/status_conexao', 'online');
        pub('selagem2/dados', { temperatura: +temp2.toFixed(1), setpoint: setpoint2, habilitado: ligada2, seguranca: 'ok' });
        pub('selagem/motores/status', 'online');
        pub('selagem2/motor/status', 'online');
        pub('dispenser/status', 'online');
        pub('dispenser/estado', { m1: { ocupado: false, restantes: 0 }, m2: { ocupado: false, restantes: 0 } });
    }, 1000);
}

module.exports = { iniciar };
if (require.main === module) iniciar().catch(e => { console.error(e.message); process.exit(1); });
