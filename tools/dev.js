// sobe o site no seu computador em modo de teste, sem tocar nos dados reais
// uso: npm run dev   (em outro terminal: npm run mock)
const fs = require('fs');
const path = require('path');
const { criarUsuariosTeste, SENHA_TESTE } = require('./seed_teste');

const pasta = path.join(__dirname, '..', 'data-teste');
fs.mkdirSync(pasta, { recursive: true });

process.env.MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://127.0.0.1:1883';
process.env.USUARIOS_JSON = process.env.USUARIOS_JSON || path.join(pasta, 'usuarios.json');
process.env.EMERGENCIA_JSON = process.env.EMERGENCIA_JSON || path.join(pasta, 'emergencia_estado.json');
process.env.RECEITAS_JSON = process.env.RECEITAS_JSON || path.join(pasta, 'receitas.json');

process.env.CARTOES_NFC_JSON = process.env.CARTOES_NFC_JSON || path.join(pasta, 'cartoes_nfc.json');

if (!fs.existsSync(process.env.USUARIOS_JSON)) criarUsuariosTeste(process.env.USUARIOS_JSON);

console.log('MODO DE TESTE: dados em data-teste/ (o usuarios.json real nao e usado)');
console.log(`Logins: dono, adm, operario, visualizador  |  senha: ${SENHA_TESTE}`);
console.log(`Abra http://localhost:${process.env.PORT || 5000}`);

require('../server.js');
