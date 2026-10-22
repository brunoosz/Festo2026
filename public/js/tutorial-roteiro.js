// GitHub: https://github.com/brunoosz | LinkedIn: https://www.linkedin.com/in/brunocamperlingo/
// roteiro do tutorial
window.ROTEIRO_TUTORIAL = [
    { pagina: null, exceto: [4], titulo: 'Bem-vindo(a) ao tour!', texto: 'Vou te mostrar as principais telas do sistema, uma por uma. Clique em Próximo quando quiser continuar.' },
    { pagina: null, perfis: [4], titulo: 'Bem-vindo(a), Visualizador!', texto: 'Você acompanha tudo em tempo real, mas não controla a máquina. Vou mostrar as telas que você pode ver. Clique em Próximo para continuar ou em Pular para sair (o tour volta no próximo login).' },

    { pagina: '/dashboard', titulo: 'Máquina em 3D', texto: 'Aqui a máquina aparece em 3D. Use Girar, Vista, Estrutura e Tela cheia; em tela cheia os botões ficam no canto da imagem.', alvoSeletor: '#dash3d-card' },
    { pagina: '/dashboard', titulo: 'Controle da Esteira', texto: 'Este card controla a VELOCIDADE da esteira em tempo real. Durante o tutorial, nada disso afeta a máquina de verdade.', alvoSeletor: '#card-controle-esteira', exceto: [4] },
    { pagina: '/dashboard', titulo: 'Esteira e selagens', texto: 'Aqui você vê a velocidade da esteira e a temperatura das duas selagens em tempo real, cada uma independente da outra.', alvoSeletor: '#card-controle-esteira, #card-selagem1, #card-selagem2', perfis: [4] },
    { pagina: '/dashboard', titulo: 'Selagem 1', texto: 'Card da SELAGEM 1, com o próprio controle de temperatura, independente da Selagem 2.', alvoSeletor: '#card-selagem1', exceto: [4] },
    { pagina: '/dashboard', titulo: 'Selagem 2', texto: 'Card da SELAGEM 2, com sensor e controle próprios.', alvoSeletor: '#card-selagem2', exceto: [4] },
    { pagina: '/dashboard', exceto: [4], titulo: 'Parada de Emergência', texto: 'O botão vermelho, sempre visível no topo, para tudo. Com a emergência ativa a máquina fica travada e a tela ganha uma borda vermelha brilhando. Só Dono e Administrador liberam: pelo botão DESBLOQUEAR ou passando um cartão NFC cadastrado.', alvoSeletor: '#btn-emergencia-global' },
    { pagina: '/dashboard', perfis: [4], titulo: 'Emergência', texto: 'Quando a emergência é acionada a máquina inteira trava e a tela ganha uma borda vermelha brilhando, com o aviso Máquina travada. Só Dono e Administrador liberam (botão DESBLOQUEAR ou cartão NFC); você apenas acompanha.' },

    { pagina: '/controle', titulo: 'Painel de Controle', texto: 'Aqui ficam as velocidades, as temperaturas e o servo do separador (teste esquerda/centro/direita, ângulos e velocidade).', alvoSeletor: '#card-servo' },
    { pagina: '/receitas', titulo: 'Receitas', texto: 'Quatro níveis prontos: 50, 100, 150 e 200 g. Cada nível guarda a velocidade da esteira, das selagens e as temperaturas. Os botões MAIS e MENOS do painel sobem e descem o nível.', alvoSeletor: '#tut-receitas' },
    { pagina: '/dispenser', titulo: 'Dispenser', texto: 'Aqui você escolhe o grão e a quantidade (frações de volta do rotor) e acompanha a dosagem.', alvoSeletor: '#tut-dispenser' },
    { pagina: '/separador', titulo: 'Separador', texto: 'A câmera e a visão local contam e reconhecem os produtos, e o servo desvia cada um para o lado certo. A tela tem treino, ajuste de detecção e servo.', alvoSeletor: '#tut-separador' },
    { pagina: '/visao', titulo: 'Visão Computacional', texto: 'A câmera identifica os produtos na esteira. As caixas ao redor de cada item mostram o que a IA está lendo: amarela acompanhando, verde já contada, com o nome e a confiança.' },

    { pagina: '/graficos', titulo: 'Produção em Gráficos', texto: 'Acompanhe a produção em gráficos, por dia, semana, mês ou ano.', alvoSeletor: '#card-grafico-producao' },
    { pagina: '/relatorios', titulo: 'Relatórios', texto: 'Todos os eventos do sistema ficam registrados aqui, incluindo logins e emergências. O botão de PDF gera o relatório completo do dia.', alvoSeletor: '#btn-baixar-pdf' },
    { pagina: '/logs', titulo: 'Logs ao Vivo', texto: 'Cada login, mudança de velocidade, ajuste de temperatura e emergência aparece aqui em tempo real, cada tipo com uma cor.' },
    { pagina: '/sistema', titulo: 'Status do Sistema', texto: 'Mostra se a internet e o Raspberry estão bem (temperatura, memória, alimentação) e quais placas estão online.', alvoSeletor: '#tut-sistema' },

    { pagina: '/nfc', titulo: 'Cartões NFC', texto: 'Um cartão de Dono ou Administrador libera a emergência e também libera os botões MAIS e MENOS do painel por 30 segundos. Só o Dono cadastra e apaga cartões.', alvoSeletor: '#tut-nfc', soAdmin: true },
    { pagina: '/nfc', titulo: 'Cartões NFC (somente leitura)', texto: 'Aqui aparece o estado do leitor e dos cartões. Os números ficam ocultos e você só observa: nada é alterado por este perfil.', alvoSeletor: '#tut-nfc', perfis: [4] },
    { pagina: '/usuarios', titulo: 'Usuários e perfis', texto: 'Quatro perfis: Dono (tudo), Administrador (controla a máquina e gerencia os níveis abaixo), Operário (opera e aplica receitas) e Visualizador (só vê). Dono e Administrador liberam a emergência.', alvoSeletor: '#tut-usuarios' },

    { pagina: '/chat', titulo: 'Dark Coders AI', texto: 'Esta sou eu! Pergunte qualquer coisa sobre o projeto ou o sistema, a qualquer momento.' },
    { pagina: null, titulo: 'Manuais', texto: 'O botão Manuais, no menu e no topo (com o Sobre nós ao lado), abre os PDFs de cada módulo da máquina, do cartão NFC, dos botões do painel e da Alexa (os que ainda não foram adicionados aparecem avisando).' },
    { pagina: null, titulo: 'Sobre nós', texto: 'A página pública Sobre nós apresenta a equipe e o projeto para qualquer pessoa. Abra pelo botão ao lado de Manuais (no topo, ou no menu no celular) ou pelo link da tela de login, que não pede senha.' },
    { pagina: '/configuracoes', titulo: 'Configurações', texto: 'Por fim, aqui você troca a senha, ativa o leitor de tela e pode rever este tutorial quando quiser.' },

    { pagina: null, exceto: [4], titulo: 'Tudo pronto!', texto: 'Esse foi o tour pelo sistema. Você pode rever este tutorial a qualquer momento, em Configurações ou no Chat.' },
    { pagina: null, perfis: [4], titulo: 'Tudo pronto!', texto: 'Lembre-se: o seu perfil é só de visualização. Você pode olhar todas as telas e conversar comigo, mas não pode controlar a máquina nem alterar dados. Este tour volta a cada login e pode ser revisto em Configurações.' }
];
