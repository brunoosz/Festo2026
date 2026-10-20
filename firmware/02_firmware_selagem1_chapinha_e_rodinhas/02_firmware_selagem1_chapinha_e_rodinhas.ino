#include <WiFi.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <Adafruit_MLX90614.h>
#include <PID_v1.h>
#include <math.h>
#include <Preferences.h>

// ============================================================
// FLOWPACK - SELAGEM 1 COMPLETA (1 ESP32 SO)
// AQUECIMENTO: CHAPINHA + SSR Fotek SSR-25DA + GY-906 + PID
// MOTORES: 2 RODINHAS de carrinho (motor TT) que puxam o plastico,
// uma de cada lado, girando em SENTIDOS OPOSTOS, num driver L298N
// (placa vermelha): uma roda em cada canal, sempre na mesma velocidade.
// A logica e a mesma do teste feito no Arduino Uno:
//   roda A: IN1 alto, IN2 baixo   |   roda B: IN3 baixo, IN4 alto
//   velocidade maxima = ENA/ENB em 255 (100% no site)
//
// O aquecimento, o site, o Painel e a Alexa continuam exatamente iguais.
// No site, "Motor 1" e "Motor 2" da Selagem 1 comandam as DUAS rodas
// juntas (mexer em um move o outro).
// Funciona pelo site (Painel de Controle e Dashboard)
// e pelo Monitor Serial do Arduino IDE (115200).
//
// SEGURANCA (rede eletrica!):
// - Sensor com defeito ou temperatura >= 170 C: o aquecimento
//   DESLIGA e fica TRAVADO ate alguem usar RESETAR FALHA
//   (so libera se o sensor estiver lendo e a chapinha esfriou).
// - A emergencia do site desliga o aquecimento na hora.
// ============================================================


// ============================================================
// REDE (SITE)
// ============================================================

const char* ssid = "DarkCoders";
const char* password = "COLOQUE_A_SENHA_DO_WIFI";
const char* mqtt_server = "192.168.4.1";

WiFiClient espClient;
PubSubClient client(espClient);

const char* topic_dados             = "selagem/dados";
const char* topic_set_temperatura   = "selagem/set_temperatura";
const char* topic_ativar            = "selagem/ativar";
const char* topic_emergencia        = "selagem/emergencia";
const char* topic_resetar_seguranca = "selagem/resetar_seguranca";
const char* topic_reiniciar         = "selagem/reiniciar";
const char* topic_status            = "selagem/status_conexao";

// O site tem os controles "Motor 1" e "Motor 2" da Selagem 1.
// Como os dois motores estao no mesmo driver, o Motor 2 e um ESPELHO do Motor 1.
const char* topic_motor2_vel_set      = "selagem/motor2/velocidade/set";
const char* topic_motor2_vel_atual    = "selagem/motor2/velocidade/atual";
const char* topic_motor2_sentido_set  = "selagem/motor2/sentido/set";
const char* topic_motor2_sentido_atual = "selagem/motor2/sentido/atual";

// Os motores aparecem no site como um dispositivo a parte
const char* topic_motores_status    = "selagem/motores/status";
const char* topic_motores_reiniciar = "selagem/motores/reiniciar";

unsigned long ultimaTentativaWifi = 0;
bool wifiEstavaConectado = false;
unsigned long ultimaTentativaMqtt = 0;
unsigned long ultimoEnvioSite = 0;


// ============================================================
// PINAGEM
// ============================================================

// SSR Fotek: terminal 3 (+) neste pino, terminal 4 (-) no GND.
#define SSR_PIN 23

#define SDA_PIN 21
#define SCL_PIN 22

#define SSR_ON  HIGH
#define SSR_OFF LOW


// ============================================================
// SENSOR GY-906 (MLX90614, infravermelho, I2C)
// ============================================================

Adafruit_MLX90614 mlx = Adafruit_MLX90614();

bool sensorOK = false;


// ============================================================
// PID (ganhos da chapinha)
// ============================================================

double temperatura = 0.0;

// Comeca em 0: a chapinha so esquenta depois que alguem
// definir uma temperatura (site ou Serial).
double setpoint = 0.0;

double potencia = 0.0;   // 0 a 100 %

double Kp = 5.0;
double Ki = 0.08;
double Kd = 20.0;

PID pid(
  &temperatura,
  &potencia,
  &setpoint,
  Kp,
  Ki,
  Kd,
  DIRECT
);


// ============================================================
// CONTROLE DO SSR (liga/desliga por janela de tempo)
// ============================================================

const unsigned long JANELA_SSR = 2000;

unsigned long inicioJanela = 0;


// ============================================================
// SEGURANCA
// ============================================================

// A partir daqui o aquecimento desliga e trava
const double LIMITE_SEGURANCA = 170.0;

// So libera o RESET se a temperatura estiver abaixo de
// (LIMITE_SEGURANCA - MARGEM_RESET)
const double MARGEM_RESET = 20.0;

// Maior temperatura alvo aceita
const double SETPOINT_MAXIMO = LIMITE_SEGURANCA - 5.0;

// Quantas leituras ruins seguidas (1 por segundo) antes de travar.
// Evita travar por um piscar do sensor.
const int LEITURAS_RUINS_PARA_TRAVAR = 3;


// ============================================================
// ESTADOS
// ============================================================

bool aquecimentoAtivo = false;

bool travado = false;
String motivoFalha = "";
String tipoFalha = "ok";     // "ok" | "erro_sensor" | "temperatura_alta"

int leiturasRuins = 0;

unsigned long ultimaLeitura = 0;
const unsigned long INTERVALO_LEITURA_MS = 1000;

unsigned long ultimoRelatorio = 0;


// ============================================================
// RODINHAS (L298N, 2 canais) - pinos, ajustes e dados
// Velocidade do site de 1 a 100% vai de PWMMIN (forca minima que gira)
// ate 255. Rampa suave. Na emergencia as rodas PARAM (sem reverso).
// ============================================================

Preferences memoria;

// L298N - canal A (roda A)
#define RODA_A_EN  25     // ENA (PWM)
#define RODA_A_IN1 26
#define RODA_A_IN2 27

// L298N - canal B (roda B)
#define RODA_B_EN  32     // ENB (PWM)
#define RODA_B_IN3 33
#define RODA_B_IN4 13



// ============================================================
// AJUSTES DOS MOTORES
// ============================================================

int pwmFreq = 1000;          // frequencia do PWM (comando PWMFREQ=; mais baixa = mais forca em baixa velocidade)
const int PWM_RESOLUCAO = 8;
const int PWM_MAX = 255;      // 100% = maximo real do driver
int pwmMinimo = 100;
int kickMs = 150;             // pulso inicial de 100% para vencer o atrito (comando KICK=; 0 desliga)
bool calibrando = false;
int calPwm = 0;
unsigned long calProximo = 0;           // menor forca que ainda move (comando PWMMIN=; fica salvo)

const unsigned long EMERGENCIA_REVERSO_MS = 1000;
const int EMERGENCIA_REVERSO_PCT_MINIMO = 50;

const int RAMPA_PASSO = 5;
const unsigned long RAMPA_INTERVALO_MS = 10;


struct Roda {
  int pinEN;
  int pinIN1;
  int pinIN2;
  int canal;                  // usado so no pacote ESP32 2.x
  bool invertida;             // a roda B gira ao contrario da A (comando RODAB INVERTER)
};

Roda rodas[2] = {
  { RODA_A_EN, RODA_A_IN1, RODA_A_IN2, 0, false },
  { RODA_B_EN, RODA_B_IN3, RODA_B_IN4, 1, true }
};

struct Motor {
  const char* nome;
  const char* topicoVelSet;
  const char* topicoVelAtual;
  const char* topicoSentidoSet;
  const char* topicoSentidoAtual;
  const char* chaveMemoria;
  int velocidadePct;
  int pwmAtual;
  bool sentidoInvertido;
  bool direcaoAtualFrente;
  bool emReverso;
  unsigned long fimReverso;
  unsigned long ultimoPasso;
  unsigned long kickFim;
};

Motor motores[] = {
  { "RODINHAS 1 e 2",
    "selagem/motor1/velocidade/set", "selagem/motor1/velocidade/atual",
    "selagem/motor1/sentido/set", "selagem/motor1/sentido/atual",
    "m1inv", 0, 0, false, true, false, 0, 0 }
};
const int QTD_MOTORES = 1;


// ============================================================
// SITE: envia o estado atual (formato que o site ja usa)
// ============================================================

void enviarDadosSite() {

  if (!client.connected()) return;

  String payload = "{";
  payload += "\"temperatura\":" + String(temperatura, 1) + ",";
  payload += "\"setpoint\":" + String(setpoint, 1) + ",";
  payload += "\"potencia\":" + String(potencia, 1) + ",";
  payload += "\"habilitado\":" + String(aquecimentoAtivo ? "true" : "false") + ",";
  payload += "\"seguranca\":\"" + tipoFalha + "\",";
  payload += "\"motivo\":\"" + motivoFalha + "\"";
  payload += "}";

  client.publish(topic_dados, payload.c_str());
}


// ============================================================
// DESLIGAR / PARAR / TRAVAR
// ============================================================

void desligarSSR() {

  digitalWrite(SSR_PIN, SSR_OFF);

}

void pararAquecimento() {

  desligarSSR();

  aquecimentoAtivo = false;

  potencia = 0;

  pid.SetMode(MANUAL);

  Serial.println();
  Serial.println("AQUECIMENTO OFF");

  enviarDadosSite();
}

void travar(String tipo, String motivo) {

  desligarSSR();

  aquecimentoAtivo = false;

  potencia = 0;

  pid.SetMode(MANUAL);

  travado = true;

  tipoFalha = tipo;

  motivoFalha = motivo;

  Serial.println();
  Serial.println("==============================");
  Serial.println("FALHA - AQUECIMENTO TRAVADO");
  Serial.print("Motivo: ");
  Serial.println(motivo);
  Serial.println("SSR DESLIGADO");
  Serial.println("Use RESET depois de corrigir.");
  Serial.println("==============================");

  enviarDadosSite();
}


// ============================================================
// LEITURA DO SENSOR (1 vez por segundo)
// ============================================================

bool leituraValida(double leitura) {

  if (isnan(leitura) || isinf(leitura)) return false;

  if (leitura < -70 || leitura > 380) return false;

  return true;
}

void lerSensor() {

  if (!sensorOK) {

    sensorOK = mlx.begin();

    if (sensorOK) Serial.println(">>> GY-906 encontrado.");
  }

  bool ok = false;

  if (sensorOK) {

    double leitura = mlx.readObjectTempC();

    if (leituraValida(leitura)) {
      temperatura = leitura;
      ok = true;
    }
  }

  if (ok) {

    leiturasRuins = 0;

    if (!travado && temperatura >= LIMITE_SEGURANCA) {
      travar("temperatura_alta", "Temperatura acima do limite");
    }

    return;
  }

  leiturasRuins++;

  if (!travado && leiturasRuins >= LEITURAS_RUINS_PARA_TRAVAR) {

    if (!sensorOK) travar("erro_sensor", "GY-906 nao encontrado");
    else           travar("erro_sensor", "Falha na leitura do GY-906");
  }
}


// ============================================================
// SETPOINT
// ============================================================

void definirSetpoint(double novaTemperatura) {

  if (novaTemperatura > 0 && novaTemperatura <= SETPOINT_MAXIMO) {

    setpoint = novaTemperatura;

    Serial.println();
    Serial.print("Novo setpoint: ");
    Serial.print(setpoint);
    Serial.println(" C");
  }
  else {

    Serial.println();
    Serial.print("Temperatura recusada: ");
    Serial.print(novaTemperatura);
    Serial.print(" C (aceito de 1 ate ");
    Serial.print(SETPOINT_MAXIMO);
    Serial.println(" C).");
  }

  enviarDadosSite();
}


// ============================================================
// LIGAR O AQUECIMENTO
// ============================================================

void iniciarAquecimento() {

  if (travado) {

    Serial.println();
    Serial.println("Existe uma falha ativa.");
    Serial.println("Use RESET antes de ligar.");

    enviarDadosSite();
    return;
  }

  if (setpoint <= 0) {

    Serial.println();
    Serial.println("Defina a temperatura antes de ligar (ex: TEMP=120).");

    enviarDadosSite();
    return;
  }

  inicioJanela = millis();

  potencia = 0;

  pid.SetMode(MANUAL);

  pid.SetMode(AUTOMATIC);

  aquecimentoAtivo = true;

  Serial.println();
  Serial.println("==============================");
  Serial.println("AQUECIMENTO ON");
  Serial.print("Setpoint: ");
  Serial.print(setpoint);
  Serial.println(" C");
  Serial.println("==============================");

  enviarDadosSite();
}


// ============================================================
// RESET DA FALHA
// ============================================================

void resetarFalha() {

  desligarSSR();

  aquecimentoAtivo = false;

  potencia = 0;

  pid.SetMode(MANUAL);

  if (!travado) {

    Serial.println();
    Serial.println("Nao ha falha ativa.");

    enviarDadosSite();
    return;
  }

  if (!sensorOK) sensorOK = mlx.begin();

  double leitura = sensorOK ? mlx.readObjectTempC() : NAN;

  if (!leituraValida(leitura)) {

    Serial.println();
    Serial.println("RESET negado: o sensor ainda apresenta erro.");

    enviarDadosSite();
    return;
  }

  temperatura = leitura;

  double limiteReset = LIMITE_SEGURANCA - MARGEM_RESET;

  if (temperatura >= limiteReset) {

    Serial.println();
    Serial.print("RESET negado: temperatura ainda em ");
    Serial.print(temperatura);
    Serial.print(" C (precisa ficar abaixo de ");
    Serial.print(limiteReset);
    Serial.println(" C).");

    enviarDadosSite();
    return;
  }

  travado = false;

  tipoFalha = "ok";

  motivoFalha = "";

  leiturasRuins = 0;

  Serial.println();
  Serial.println("RESET realizado. Sistema pronto.");

  enviarDadosSite();
}


// ============================================================
// PWM (compativel com pacote ESP32 2.x e 3.x)
// ============================================================

void configurarPwmRodas() {
  for (int i = 0; i < 2; i++) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
    ledcAttach(rodas[i].pinEN, pwmFreq, PWM_RESOLUCAO);
#else
    ledcSetup(rodas[i].canal, pwmFreq, PWM_RESOLUCAO);
    ledcAttachPin(rodas[i].pinEN, rodas[i].canal);
#endif
  }
}

void escreverPwmRoda(int i, int valor) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(rodas[i].pinEN, valor);
#else
  ledcWrite(rodas[i].canal, valor);
#endif
}

// Aplica nas DUAS rodas: a roda B gira ao contrario da A
void aplicarMotor(Motor& m, int pwm, bool frente) {

  for (int i = 0; i < 2; i++) {

    if (pwm <= 0) {
      escreverPwmRoda(i, 0);
      digitalWrite(rodas[i].pinIN1, LOW);
      digitalWrite(rodas[i].pinIN2, LOW);
      continue;
    }

    bool sentido = frente;
    if (rodas[i].invertida) sentido = !sentido;

    digitalWrite(rodas[i].pinIN1, sentido ? HIGH : LOW);
    digitalWrite(rodas[i].pinIN2, sentido ? LOW : HIGH);
    escreverPwmRoda(i, pwm);
  }
}

int pctParaPwm(int pct) {
  if (pct <= 0) return 0;
  if (pct > 100) pct = 100;
  return map(pct, 1, 100, pwmMinimo, PWM_MAX);
}


// ============================================================
// SITE: publicacao
// ============================================================

void publicarMotor(Motor& m) {
  if (!client.connected()) return;
  String valor = String(m.velocidadePct / 100.0, 2);
  client.publish(m.topicoVelAtual, valor.c_str());
  client.publish(topic_motor2_vel_atual, valor.c_str());
}

void publicarSentidoMotor(Motor& m) {
  if (!client.connected()) return;
  client.publish(m.topicoSentidoAtual, m.sentidoInvertido ? "invertido" : "normal", true);
  client.publish(topic_motor2_sentido_atual, m.sentidoInvertido ? "invertido" : "normal", true);
}

void publicarTodosMotores() {
  for (int i = 0; i < QTD_MOTORES; i++) {
    publicarMotor(motores[i]);
    publicarSentidoMotor(motores[i]);
  }
}


// ============================================================
// ACOES (site e Monitor Serial)
// ============================================================

void definirVelocidadeMotor(Motor& m, int pct, const String& origem) {

  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;

  m.velocidadePct = pct;

  Serial.print(">>> ");
  Serial.print(m.nome);
  Serial.print(" VELOCIDADE (");
  Serial.print(origem);
  Serial.print("): ");
  Serial.print(pct);
  Serial.println("%");

  publicarMotor(m);
}

void definirSentidoMotor(Motor& m, bool invertido, const String& origem) {

  m.sentidoInvertido = invertido;
  memoria.putBool(m.chaveMemoria, invertido);

  Serial.print(">>> ");
  Serial.print(m.nome);
  Serial.print(" SENTIDO (");
  Serial.print(origem);
  Serial.print("): ");
  Serial.println(invertido ? "INVERTIDO" : "NORMAL");

  publicarSentidoMotor(m);
}

// Para as rodas na hora (sem reverso: o plastico nao deve voltar)
void emergenciaMotores(const String& origem) {

  calibrando = false;

  for (int i = 0; i < QTD_MOTORES; i++) {
    Motor& m = motores[i];
    m.velocidadePct = 0;
    m.pwmAtual = 0;
    m.emReverso = false;
    aplicarMotor(m, 0, m.direcaoAtualFrente);
    publicarMotor(m);
  }

  Serial.print(">>> EMERGENCIA (");
  Serial.print(origem);
  Serial.println("): rodas paradas");
}

void pararTodosMotores() {
  for (int i = 0; i < QTD_MOTORES; i++) {
    motores[i].velocidadePct = 0;
    motores[i].pwmAtual = 0;
    aplicarMotor(motores[i], 0, true);
  }
}

// Rampa suave + troca de sentido segura (desacelera ate parar antes de inverter)
void atualizarMotor(Motor& m) {

  if (m.emReverso) {
    if (millis() >= m.fimReverso) {
      aplicarMotor(m, 0, m.direcaoAtualFrente);
      m.pwmAtual = 0;
      m.emReverso = false;
    }
    return;
  }

  // segurando o pulso inicial de 100% (vence o atrito para a roda sair do lugar)
  if (millis() < m.kickFim) {
    aplicarMotor(m, PWM_MAX, m.direcaoAtualFrente);
    return;
  }

  if (millis() - m.ultimoPasso < RAMPA_INTERVALO_MS) return;
  m.ultimoPasso = millis();

  bool direcaoDesejada = !m.sentidoInvertido;
  int alvo = pctParaPwm(m.velocidadePct);

  if (direcaoDesejada != m.direcaoAtualFrente && m.pwmAtual > 0) alvo = 0;
  if (m.pwmAtual == 0) m.direcaoAtualFrente = direcaoDesejada;

  // parada total -> velocidade baixa: da o pulso inicial
  if (m.pwmAtual == 0 && alvo > 0 && alvo < PWM_MAX && kickMs > 0) {
    m.pwmAtual = PWM_MAX;
    m.kickFim = millis() + kickMs;
    aplicarMotor(m, PWM_MAX, m.direcaoAtualFrente);
    return;
  }

  if (m.pwmAtual < alvo) m.pwmAtual = min(m.pwmAtual + RAMPA_PASSO, alvo);
  else if (m.pwmAtual > alvo) m.pwmAtual = max(m.pwmAtual - RAMPA_PASSO * 2, alvo);

  aplicarMotor(m, m.pwmAtual, m.direcaoAtualFrente);
}

void atualizarMotores() {
  for (int i = 0; i < QTD_MOTORES; i++) atualizarMotor(motores[i]);
}

void configurarMotores() {

  memoria.begin("selagem1", false);

  pwmMinimo = memoria.getInt("pwmmin", 100);
  kickMs = memoria.getInt("kick", 150);
  pwmFreq = memoria.getInt("freq", 1000);
  rodas[1].invertida = memoria.getBool("rbinv", true);

  for (int i = 0; i < 2; i++) {
    pinMode(rodas[i].pinIN1, OUTPUT);
    pinMode(rodas[i].pinIN2, OUTPUT);
    digitalWrite(rodas[i].pinIN1, LOW);
    digitalWrite(rodas[i].pinIN2, LOW);
  }

  configurarPwmRodas();

  for (int i = 0; i < QTD_MOTORES; i++) {
    Motor& m = motores[i];
    aplicarMotor(m, 0, true);
    m.sentidoInvertido = memoria.getBool(m.chaveMemoria, false);
    m.direcaoAtualFrente = !m.sentidoInvertido;
  }
}

void inscreverMotores() {

  for (int i = 0; i < QTD_MOTORES; i++) {
    client.subscribe(motores[i].topicoVelSet);
    client.subscribe(motores[i].topicoSentidoSet);
  }

  client.subscribe(topic_motor2_vel_set);
  client.subscribe(topic_motor2_sentido_set);
}

void tratarMensagemMotor(const String& topico, const String& mensagem) {

  // Comandos do "Motor 2" do site: mesmo driver, mesmo efeito
  if (topico == topic_motor2_vel_set) {
    float v = mensagem.toFloat();
    int pct = (v <= 1.0) ? (int)round(v * 100) : (int)round(v);
    definirVelocidadeMotor(motores[0], pct, "SITE (motor 2)");
    return;
  }

  if (topico == topic_motor2_sentido_set) {
    definirSentidoMotor(motores[0], mensagem == "invertido" || mensagem == "1", "SITE (motor 2)");
    return;
  }

  for (int i = 0; i < QTD_MOTORES; i++) {

    Motor& m = motores[i];

    if (topico == m.topicoVelSet) {
      float v = mensagem.toFloat();
      int pct = (v <= 1.0) ? (int)round(v * 100) : (int)round(v);
      definirVelocidadeMotor(m, pct, "SITE");
    }

    if (topico == m.topicoSentidoSet) {
      definirSentidoMotor(m, mensagem == "invertido" || mensagem == "1", "SITE");
    }
  }
}

void mostrarStatusMotores() {

  Motor& m = motores[0];

  Serial.print(m.nome);
  Serial.print(": ");
  Serial.print(m.velocidadePct);
  Serial.print("% | PWM ");
  Serial.print(m.pwmAtual);
  Serial.print(" | ");
  Serial.println(m.sentidoInvertido ? "INVERTIDO" : "NORMAL");

  Serial.print("  Kick: ");
  Serial.print(kickMs);
  Serial.print(" ms | Freq PWM: ");
  Serial.print(pwmFreq);
  Serial.println(" Hz");
  Serial.print("  PWM minimo: ");
  Serial.print(pwmMinimo);
  Serial.print(" | Roda B: ");
  Serial.println(rodas[1].invertida ? "ao contrario da A (certo para rolos opostos)" : "mesmo sentido da A");
}

void comandoMotorSerial(String comando) {

  // Aceita M=60, M1=60 ou M2=60: os dois motores sao um so, no mesmo driver
  String resto = comando.substring(1);

  if (resto.startsWith("1") || resto.startsWith("2")) resto = resto.substring(1);

  resto.trim();

  if (resto.startsWith("=")) {
    definirVelocidadeMotor(motores[0], resto.substring(1).toInt(), "SERIAL");
  }
  else if (resto == "PARAR") {
    definirVelocidadeMotor(motores[0], 0, "SERIAL");
  }
  else if (resto == "INVERTER") {
    definirSentidoMotor(motores[0], !motores[0].sentidoInvertido, "SERIAL");
  }
  else {
    Serial.println("Use: M=60 | M PARAR | M INVERTER");
  }
}

// ============================================================
// TESTE DA FIACAO DO SSR (so para diagnostico)
// Liga o pino do SSR por 3 segundos, sem passar pelo PID.
// Se o LED do SSR acender, o fio e o pino estao certos.
// ============================================================

void testarSSR() {

  if (aquecimentoAtivo) {
    Serial.println("Desligue o aquecimento antes do teste (comando DESLIGAR).");
    return;
  }

  Serial.println();
  Serial.print("TESTE DO SSR: GPIO ");
  Serial.print(SSR_PIN);
  Serial.println(" ligado por 3 segundos...");

  digitalWrite(SSR_PIN, SSR_ON);

  delay(3000);

  desligarSSR();

  Serial.println("Fim do teste. O LED do SSR acendeu?");
  Serial.println("  SIM = fiacao certa (veja o STATUS: alvo, falha, sensor).");
  Serial.println("  NAO = o fio do terminal 3 nao esta nesse GPIO.");
}


// ============================================================
// COMANDOS DO MONITOR SERIAL
// ============================================================

// ============================================================
// TESTE DAS RODINHAS (a mesma sequencia do teste feito no Arduino Uno)
// A: IN1 alto / IN2 baixo   B: IN3 baixo / IN4 alto   ENA/ENB no maximo
// ============================================================

void testarRodas() {

  Serial.println();
  Serial.println("TESTE DAS RODINHAS: as duas giram a 100% por 3 segundos...");

  aplicarMotor(motores[0], PWM_MAX, true);

  delay(3000);

  aplicarMotor(motores[0], 0, true);

  Serial.println("Fim do teste. As rodas giraram em sentidos opostos?");
  Serial.println("  SIM = fiacao certa. NAO = confira IN1..IN4, ENA/ENB, alimentacao do L298N e o GND comum.");
}

// ============================================================
// CALIBRAR: acha a menor forca que faz as rodas girarem
// Digite CALIBRAR, espere o PWM subir e, quando as DUAS rodas
// comecarem a girar, digite OK. O valor e salvo (com uma folga).
// ============================================================

void terminarCalibracao(bool ok) {

  calibrando = false;
  aplicarMotor(motores[0], 0, true);
  motores[0].pwmAtual = 0;

  if (ok) {
    pwmMinimo = min(calPwm + 10, 250);
    memoria.putInt("pwmmin", pwmMinimo);
    Serial.print("CALIBRADO: PWM minimo = ");
    Serial.println(pwmMinimo);
    Serial.println("Agora 1% no site gira na menor velocidade possivel.");
  }
  else {
    Serial.println("Calibracao cancelada (nada foi salvo).");
  }
}

void iniciarCalibracao() {

  if (motores[0].velocidadePct > 0 || motores[0].pwmAtual > 0) {
    Serial.println("Pare as rodas antes (M PARAR).");
    return;
  }

  calibrando = true;
  calPwm = 30;
  calProximo = millis() + 500;

  Serial.println();
  Serial.println("CALIBRACAO: o PWM vai subir devagar.");
  Serial.println("Quando as DUAS rodas comecarem a girar, digite OK (qualquer outra coisa cancela).");
}

void atualizarCalibracao() {

  if (!calibrando || millis() < calProximo) return;

  calProximo = millis() + 500;
  calPwm += 5;

  if (calPwm > PWM_MAX) {
    terminarCalibracao(false);
    Serial.println("Nao girou ate 255: confira a alimentacao do L298N e o GND comum.");
    return;
  }

  aplicarMotor(motores[0], calPwm, true);

  Serial.print("PWM ");
  Serial.println(calPwm);
}

void mostrarAjuda() {

  Serial.println();
  Serial.println("COMANDOS:");
  Serial.println();
  Serial.println("LIGAR  (ou ON)");
  Serial.println("DESLIGAR  (ou OFF)");
  Serial.println("TEMP=120  (ou TEMP 120)");
  Serial.println("RESET  (ou RESETAR)");
  Serial.println("TESTE SSR  (liga o SSR por 3 s para testar a fiacao)");
  Serial.println("EMERGENCIA  (aquecimento OFF + motores em reverso 1s)");
  Serial.println("M=60  (velocidade das 2 rodinhas, 0 a 100)");
  Serial.println("M PARAR  |  M INVERTER  (inverte as duas)");
  Serial.println("RODAB INVERTER  (inverte so a roda B, se girar errado)");
  Serial.println("PWMMIN=90  (forca minima que faz as rodas girarem)");
  Serial.println("CALIBRAR  (acha sozinho a forca minima: digite OK quando girar)");
  Serial.println("KICK=150  (pulso inicial em ms para vencer o atrito; 0 desliga)");
  Serial.println("PWMFREQ=1000  (frequencia do PWM em Hz; depois REINICIAR)");
  Serial.println("TESTE RODAS  (gira as duas a 100% por 3 s, como no teste do Arduino)");
  Serial.println("STATUS");
  Serial.println("REINICIAR");
  Serial.println("AJUDA");
  Serial.println();
}

void mostrarStatus() {

  Serial.println();
  Serial.println("===== SELAGEM 1 - AQUECIMENTO =====");

  Serial.print("Sensor GY-906: ");
  Serial.println(sensorOK ? "OK" : "NAO ENCONTRADO");

  Serial.print("Temperatura: ");
  Serial.print(temperatura);
  Serial.println(" C");

  Serial.print("Setpoint: ");
  Serial.print(setpoint);
  Serial.println(" C");

  Serial.print("Potencia PID: ");
  Serial.print(potencia);
  Serial.println(" %");

  Serial.print("Aquecimento: ");
  Serial.println(aquecimentoAtivo ? "ON" : "OFF");

  Serial.print("Falha: ");
  if (travado) {
    Serial.print("SIM (");
    Serial.print(motivoFalha);
    Serial.println(")");
  }
  else {
    Serial.println("NAO");
  }

  mostrarStatusMotores();

  Serial.print("Limite de seguranca: ");
  Serial.print(LIMITE_SEGURANCA);
  Serial.println(" C");

  Serial.print("WiFi: ");
  Serial.println(WiFi.status() == WL_CONNECTED ? "CONECTADO" : "DESCONECTADO");

  Serial.print("Site: ");
  Serial.println(client.connected() ? "CONECTADO" : "DESCONECTADO");

  Serial.println("===================================");
}

void processarComando(String comando) {

  comando.trim();

  comando.toUpperCase();

  if (comando.length() == 0) return;

  if (calibrando) {
    terminarCalibracao(comando == "OK");
    return;
  }

  if (comando == "LIGAR" || comando == "ON") {

    iniciarAquecimento();

  }
  else if (comando == "DESLIGAR" || comando == "OFF") {

    pararAquecimento();

  }
  else if (comando == "RESET" || comando == "RESETAR") {

    resetarFalha();

  }
  else if (comando.startsWith("TEMP")) {

    String valor = comando.substring(4);

    if (valor.startsWith("=")) valor = valor.substring(1);

    valor.trim();

    if (valor.length() == 0) {
      Serial.println("Use: TEMP=120");
    }
    else {
      definirSetpoint(valor.toFloat());
    }

  }
  else if (comando == "TESTE RODAS" || comando == "TESTERODAS") {

    if (motores[0].pwmAtual > 0 || motores[0].velocidadePct > 0) Serial.println("Pare as rodas antes (M PARAR).");
    else testarRodas();

  }
  else if (comando.startsWith("RODAB")) {

    rodas[1].invertida = !rodas[1].invertida;
    memoria.putBool("rbinv", rodas[1].invertida);
    aplicarMotor(motores[0], motores[0].pwmAtual, motores[0].direcaoAtualFrente);
    Serial.println(rodas[1].invertida ? "Roda B: ao contrario da A" : "Roda B: mesmo sentido da A");

  }
  else if (comando == "CALIBRAR") {

    iniciarCalibracao();

  }
  else if (comando.startsWith("KICK")) {

    String valor = comando.substring(4);
    if (valor.startsWith("=")) valor = valor.substring(1);
    int v = valor.toInt();

    if (v >= 0 && v <= 500) {
      kickMs = v;
      memoria.putInt("kick", v);
      Serial.print("Kick: ");
      Serial.print(v);
      Serial.println(" ms");
    }
    else {
      Serial.println("Use KICK=150 (0 a 500)");
    }

  }
  else if (comando.startsWith("PWMFREQ")) {

    String valor = comando.substring(7);
    if (valor.startsWith("=")) valor = valor.substring(1);
    int v = valor.toInt();

    if (v >= 200 && v <= 20000) {
      memoria.putInt("freq", v);
      Serial.print("Frequencia salva: ");
      Serial.print(v);
      Serial.println(" Hz. Digite REINICIAR para valer.");
    }
    else {
      Serial.println("Use PWMFREQ=1000 (200 a 20000)");
    }

  }
  else if (comando.startsWith("PWMMIN")) {

    String valor = comando.substring(6);
    if (valor.startsWith("=")) valor = valor.substring(1);
    int v = valor.toInt();

    if (v >= 20 && v <= 250) {
      pwmMinimo = v;
      memoria.putInt("pwmmin", v);
      Serial.print("PWM minimo: ");
      Serial.println(v);
    }
    else {
      Serial.println("Use PWMMIN=90 (valor de 20 a 250)");
    }

  }
  else if (comando.startsWith("M")) {

    comandoMotorSerial(comando);

  }
  else if (comando == "EMERGENCIA") {

    pararAquecimento();

    emergenciaMotores("SERIAL");

  }
  else if (comando == "TESTE SSR" || comando == "TESTESSR") {

    testarSSR();

  }
  else if (comando == "STATUS") {

    mostrarStatus();

  }
  else if (comando == "REINICIAR") {

    Serial.println("Reiniciando o ESP32...");
    desligarSSR();
    pararTodosMotores();
    delay(200);
    ESP.restart();

  }
  else if (comando == "AJUDA" || comando == "HELP") {

    mostrarAjuda();

  }
  else {

    Serial.print("Comando desconhecido: ");
    Serial.println(comando);
    Serial.println("Digite AJUDA para ver a lista.");

  }
}


// ============================================================
// SITE: comandos que chegam pelo MQTT
// ============================================================

void callbackMqtt(char* topic, byte* payload, unsigned int length) {

  String mensagem;
  for (unsigned int i = 0; i < length; i++) mensagem += (char)payload[i];
  mensagem.trim();

  String topico = String(topic);

  Serial.print(">>> Site: ");
  Serial.print(topico);
  Serial.print(" = ");
  Serial.println(mensagem);

  tratarMensagemMotor(topico, mensagem);

  if (topico == topic_set_temperatura) {
    definirSetpoint(mensagem.toDouble());
  }
  else if (topico == topic_ativar) {
    if (mensagem == "1" || mensagem == "true") iniciarAquecimento();
    else pararAquecimento();
  }
  else if (topico == topic_emergencia) {
    pararAquecimento();
    emergenciaMotores("SITE");
  }
  else if (topico == topic_resetar_seguranca) {
    resetarFalha();
  }
  else if (topico == topic_reiniciar || topico == topic_motores_reiniciar) {
    Serial.println("Reiniciando por comando do site...");
    desligarSSR();
    pararTodosMotores();
    delay(200);
    ESP.restart();
  }
}


// ============================================================
// SITE: WiFi e MQTT sem travar o resto do programa
// ============================================================

void gerenciarWifi() {

  bool conectadoAgora = (WiFi.status() == WL_CONNECTED);

  if (conectadoAgora && !wifiEstavaConectado) {
    Serial.print(">>> WiFi conectado! IP: ");
    Serial.println(WiFi.localIP());
    wifiEstavaConectado = true;
    return;
  }

  if (!conectadoAgora && wifiEstavaConectado) {
    Serial.println(">>> WiFi caiu! O Serial continua funcionando. Tentando reconectar...");
    wifiEstavaConectado = false;
  }

  if (conectadoAgora) return;

  if (millis() - ultimaTentativaWifi >= 10000) {
    ultimaTentativaWifi = millis();
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid, password);
  }
}

void gerenciarMqtt() {

  if (WiFi.status() != WL_CONNECTED) return;
  if (client.connected()) return;
  if (millis() - ultimaTentativaMqtt < 5000) return;
  ultimaTentativaMqtt = millis();

  Serial.print(">>> Conectando ao site... ");

  if (client.connect("ESP32_Selagem1", topic_status, 0, true, "offline")) {

    Serial.println("CONECTADO!");

    client.subscribe(topic_set_temperatura);
    client.subscribe(topic_ativar);
    client.subscribe(topic_emergencia);
    client.subscribe(topic_resetar_seguranca);
    client.subscribe(topic_reiniciar);
    client.subscribe(topic_motores_reiniciar);
    inscreverMotores();

    client.publish(topic_status, "online", true);
    client.publish(topic_motores_status, "online");

    enviarDadosSite();
    publicarTodosMotores();
  }
  else {
    Serial.print("falha (codigo ");
    Serial.print(client.state());
    Serial.println("), tentando de novo...");
  }
}


// ============================================================
// SETUP
// ============================================================

void setup() {

  Serial.begin(115200);

  // SSR sempre comeca desligado
  pinMode(SSR_PIN, OUTPUT);

  desligarSSR();

  configurarMotores();

  Wire.begin(SDA_PIN, SCL_PIN);

  Serial.println();
  Serial.println("==============================");
  Serial.println("FLOWPACK");
  Serial.println("SELAGEM 1 - AQUECIMENTO + 2 MOTORES");
  Serial.println("==============================");
  Serial.print("SSR (terminal 3)  : GPIO ");
  Serial.println(SSR_PIN);
  Serial.print("Sensor GY-906     : SDA ");
  Serial.print(SDA_PIN);
  Serial.print(" / SCL ");
  Serial.println(SCL_PIN);
  Serial.print("L298N roda A      : ENA ");
  Serial.print(RODA_A_EN);
  Serial.print(" / IN1 ");
  Serial.print(RODA_A_IN1);
  Serial.print(" / IN2 ");
  Serial.println(RODA_A_IN2);
  Serial.print("L298N roda B      : ENB ");
  Serial.print(RODA_B_EN);
  Serial.print(" / IN3 ");
  Serial.print(RODA_B_IN3);
  Serial.print(" / IN4 ");
  Serial.println(RODA_B_IN4);

  sensorOK = mlx.begin();

  if (sensorOK) {

    Serial.println("GY-906 OK");

  }
  else {

    Serial.println("ERRO: GY-906 NAO ENCONTRADO");
    Serial.println("Confira: VIN 3.3V, GND, SDA 21, SCL 22.");

  }

  pid.SetOutputLimits(0, 100);

  pid.SetSampleTime(1000);

  pid.SetMode(MANUAL);

  inicioJanela = millis();

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  ultimaTentativaWifi = millis();

  client.setServer(mqtt_server, 1883);
  client.setCallback(callbackMqtt);

  mostrarAjuda();
}


// ============================================================
// LOOP
// ============================================================

void loop() {

  unsigned long agora = millis();

  gerenciarWifi();
  gerenciarMqtt();
  if (client.connected()) client.loop();

  if (calibrando) atualizarCalibracao();
  else atualizarMotores();

  if (Serial.available()) {

    String comando = Serial.readStringUntil('\n');

    processarComando(comando);
  }

  // ---------------- sensor ----------------

  if (agora - ultimaLeitura >= INTERVALO_LEITURA_MS) {

    ultimaLeitura = agora;

    lerSensor();
  }

  // ---------------- PID + SSR ----------------

  if (aquecimentoAtivo && !travado) {

    pid.Compute();

    if (agora - inicioJanela >= JANELA_SSR) inicioJanela = agora;

    unsigned long tempoLigado = (unsigned long)(JANELA_SSR * potencia / 100.0);

    if ((agora - inicioJanela) < tempoLigado) digitalWrite(SSR_PIN, SSR_ON);
    else                                       digitalWrite(SSR_PIN, SSR_OFF);
  }
  else {

    desligarSSR();
  }

  // ---------------- site (sinal de vida) ----------------

  if (agora - ultimoEnvioSite >= 1000) {

    ultimoEnvioSite = agora;

    enviarDadosSite();

    for (int i = 0; i < QTD_MOTORES; i++) publicarMotor(motores[i]);

    if (client.connected()) client.publish(topic_motores_status, "online");
  }

  // ---------------- relatorio no Serial ----------------

  if (agora - ultimoRelatorio >= 1000) {

    ultimoRelatorio = agora;

    Serial.print("Temp: ");
    Serial.print(temperatura, 1);
    Serial.print(" C | SP: ");
    Serial.print(setpoint, 1);
    Serial.print(" C | PID: ");
    Serial.print(potencia, 1);
    Serial.print("% | Aquec: ");
    Serial.print(aquecimentoAtivo ? "ON" : "OFF");
    Serial.print(" | SSR: ");
    Serial.print(digitalRead(SSR_PIN) ? "ON" : "OFF");
    Serial.print(" | Falha: ");
    Serial.print(travado ? motivoFalha : String("nao"));
    Serial.print(" | Motores: ");
    Serial.print(motores[0].velocidadePct);
    Serial.print("%");

    Serial.print(" | Site: ");
    Serial.println(client.connected() ? "OK" : "OFF");
  }
}
