// GitHub: https://github.com/brunoosz | LinkedIn: https://www.linkedin.com/in/brunocamperlingo/
// alarmes da selagem 2
(function () {
    const A = {
        erro_sensor: { texto: 'Sensor sem leitura (aquecimento desligado)', nivel: 'erro' },
        sobretemperatura: { texto: 'Temperatura acima do limite (desligado)', nivel: 'erro' },
        sem_aquecimento: { texto: 'A barra não está esquentando: confira sensor, resistência e SSR (desligado)', nivel: 'erro' },
        sensor_quente: { texto: 'Sensor muito quente (desligado)', nivel: 'erro' },
        sensor_quente_aviso: { texto: 'Sensor esquentando (aviso)', nivel: 'aviso' },
        temperatura_alta: { texto: 'Temperatura crítica! Selagem travada por segurança.', nivel: 'erro' }
    };
    window.Selagem2Alarmes = {
        lista: A,
        info: (s) => A[s] || null,
        // aviso amarelo não trava o controle
        ok: (s) => !s || s === 'ok' || s === 'sensor_quente_aviso',
        critico: (s) => !!(A[s] && A[s].nivel === 'erro')
    };
})();
