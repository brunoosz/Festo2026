// GitHub: https://github.com/brunoosz | LinkedIn: https://www.linkedin.com/in/brunocamperlingo/
// teste do certificado da Alexa: cadeia da Amazon e certificado velho em cache
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { criarUsuariosTeste } = require('../seed_teste');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flowpack-alexacert-'));
criarUsuariosTeste(path.join(tmp, 'usuarios.json'));
Object.assign(process.env, { PORT: '5072', MQTT_BROKER: 'mqtt://127.0.0.1:18899', USUARIOS_JSON: path.join(tmp, 'usuarios.json'), EMERGENCIA_JSON: path.join(tmp, 'e.json'), RECEITAS_JSON: path.join(tmp, 'r.json'), CARTOES_NFC_JSON: path.join(tmp, 'c.json'), SEPARADOR_DADOS_DIR: tmp, SERVO_LIVRE_JSON: path.join(tmp, 's.json'), SESSION_SECRET: 'x' });
const ok = m => console.log('  ok   ' + m);

(async () => {
    try {
        const { validarCadeiaAlexa, verificarPedidoAlexa } = require('../../server.js');
        const pem = fs.readFileSync(path.join(__dirname, 'fixtures', 'echo-api-cert-12.pem'), 'utf8');
        const principal = validarCadeiaAlexa(pem);
        assert.ok(principal.checkHost('echo-api.amazon.com')); ok('a cadeia real da Amazon (com o certificado cruzado Starfield no fim) é aceita');
        assert.throws(() => validarCadeiaAlexa(pem.replace(/(-----BEGIN CERTIFICATE-----\n)(.{10})/, '$1AAAAAAAAAA')), /./); ok('arquivo adulterado é recusado');
        const soFolha = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)[0];
        assert.throws(() => validarCadeiaAlexa(soFolha), /confiavel/); ok('certificado sem cadeia confiável é recusado');
        await assert.rejects(verificarPedidoAlexa({}, '{}', {}), /endereco do certificado/); ok('pedido sem endereço de certificado da Amazon é recusado');
        await assert.rejects(verificarPedidoAlexa({ signaturecertchainurl: 'https://evil.example.com/echo.api/x.pem' }, '{}', {}), /endereco do certificado/); ok('endereço de certificado que não é da Amazon é recusado');
        console.log('\nALEXA CERTIFICADO: TUDO OK'); process.exit(0);
    } catch (e) { console.error('\nFALHOU: ' + (e && e.stack || e)); process.exit(1); }
})();
