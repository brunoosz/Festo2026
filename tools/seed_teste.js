// GitHub: https://github.com/brunoosz | LinkedIn: https://www.linkedin.com/in/brunocamperlingo/
// usuários de teste
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SENHA_TESTE = '1234';

function senhaHash(senha) {
    const salt = crypto.randomBytes(16).toString('hex');
    return { salt, hash: crypto.scryptSync(senha, salt, 64).toString('hex') };
}

function criarUsuariosTeste(arquivo) {
    const base = { tutorialVisto: true, acessibilidade: false };
    const usuarios = {
        dono:     Object.assign({ nivel: 1 }, base, senhaHash(SENHA_TESTE)),
        adm:      Object.assign({ nivel: 2 }, base, senhaHash(SENHA_TESTE)),
        operario: Object.assign({ nivel: 3 }, base, senhaHash(SENHA_TESTE)),
        visualizador: Object.assign({ nivel: 4, telasPermitidas: ['dispenser', 'separador', 'receitas', 'graficos', 'relatorios', 'visao', 'chat', 'logs', 'controle', 'sistema', 'usuarios'] }, base, senhaHash(SENHA_TESTE))
    };
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.writeFileSync(arquivo, JSON.stringify(usuarios, null, 2));
    return usuarios;
}

module.exports = { criarUsuariosTeste, SENHA_TESTE };

if (require.main === module) {
    const arquivo = path.resolve(process.argv[2] || path.join(__dirname, '..', 'data-teste', 'usuarios.json'));
    criarUsuariosTeste(arquivo);
    console.log(`Usuarios de teste criados em ${arquivo}`);
    console.log(`Logins: dono, adm, operario, visualizador  |  senha de todos: ${SENHA_TESTE}`);
}
