// GitHub: https://github.com/brunoosz | LinkedIn: https://www.linkedin.com/in/brunocamperlingo/
#include <WiFi.h>
#include <PubSubClient.h>
#include <Preferences.h>
#include <math.h>

// esteira


// rede

const char* ssid = "DarkCoders";
const char* password = "COLOQUE_A_SENHA_DO_WIFI";
const char* mqtt_server = "192.168.4.1";

WiFiClient espClient;
PubSubClient client(espClient);

const char* topic_set_vel       = "esteira/velocidade/set";
const char* topic_atual_vel     = "esteira/velocidade/atual";
const char* topic_status        = "esteira/status";
const char* topic_set_sentido   = "esteira/sentido/set";
const char* topic_atual_sentido = "esteira/sentido/atual";
const char* topic_emergencia    = "esteira/emergencia";
const char* topic_reiniciar     = "esteira/reiniciar";
const char* topic_botao         = "esteira/botao";      // valores do botão
const char* topic_liberar       = "esteira/liberar";    // destravar
const char* topic_estado_emerg  = "esteira/estado_emergencia"; // estado da emergência

unsigned long ultimaTentativaWifi = 0;
bool wifiEstavaConectado = false;
unsigned long ultimaTentativaMqtt = 0;
unsigned long ultimoEnvio = 0;
unsigned long ultimoEnvioSentido = 0;

Preferences memoria;


// pinagem

// BTS7960
#define PIN_RPWM 25
#define PIN_LPWM 26
#define PIN_EN   27      // pinos de ativação

// botão de emergência
#define BTN_EMERGENCIA 32


// ajustes do motor

const int PWM_FREQ = 20000;
const int PWM_RESOLUCAO = 8;
const int PWM_MAX = 255;
const int PWM_MINIMO = 50;               // força mínima

const unsigned long EMERGENCIA_REVERSO_MS = 1000;
const int EMERGENCIA_REVERSO_PCT_MINIMO = 50;

const int RAMPA_PASSO = 5;
const unsigned long RAMPA_INTERVALO_MS = 10;

bool emergenciaTravada = false;   // trava salva
int velocidadePct = 0;
int pwmAtual = 0;
bool sentidoInvertido = false;
bool direcaoAtualFrente = true;
bool emReverso = false;
unsigned long fimReverso = 0;
unsigned long ultimoPasso = 0;


// botões

// tempo mínimo
struct Botao {
  int pino;
  const char* nome;
  unsigned long msMinimo;      // tempo apertado
  bool armado;
  bool baixo;
  unsigned long inicio;
  bool disparado;
  bool alto;
  unsigned long altoDesde;
};

Botao botoes[1] = {
  { BTN_EMERGENCIA, "emergencia", 120, false, false, 0, false, false, 0 }
};

const unsigned long BOTOES_APOS_LIGAR_MS = 3000;
const unsigned long BOTAO_SOLTO_PARA_ARMAR_MS = 1000;
unsigned long ultimaAmostraBotoes = 0;
bool avisouBotaoPreso = false;


// PWM

void configurarPwm() {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(PIN_RPWM, PWM_FREQ, PWM_RESOLUCAO);
  ledcAttach(PIN_LPWM, PWM_FREQ, PWM_RESOLUCAO);
#else
  ledcSetup(0, PWM_FREQ, PWM_RESOLUCAO);
  ledcAttachPin(PIN_RPWM, 0);
  ledcSetup(1, PWM_FREQ, PWM_RESOLUCAO);
  ledcAttachPin(PIN_LPWM, 1);
#endif
}

void escreverPwm(bool ladoR, int valor) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(ladoR ? PIN_RPWM : PIN_LPWM, valor);
#else
  ledcWrite(ladoR ? 0 : 1, valor);
#endif
}

void aplicarMotor(int pwm, bool frente) {

  if (pwm <= 0) {
    escreverPwm(true, 0);
    escreverPwm(false, 0);
    return;
  }

  if (frente) {
    escreverPwm(false, 0);
    escreverPwm(true, pwm);
  }
  else {
    escreverPwm(true, 0);
    escreverPwm(false, pwm);
  }
}

int pctParaPwm(int pct) {
  if (pct <= 0) return 0;
  if (pct > 100) pct = 100;
  return map(pct, 1, 100, PWM_MINIMO, PWM_MAX);
}


// publicação

void publicarVelocidade() {

  if (!client.connected()) return;

  String valor = String(velocidadePct / 100.0, 2);
  client.publish(topic_atual_vel, valor.c_str());
}

void publicarSentido() {

  if (!client.connected()) return;

  client.publish(topic_atual_sentido, sentidoInvertido ? "invertido" : "normal", true);
}

void publicarEstadoEmergencia() {

  if (!client.connected()) return;

  client.publish(topic_estado_emerg, emergenciaTravada ? "ativa" : "liberada", true);
}

void publicarBotao(const char* nome) {

  if (client.connected()) client.publish(topic_botao, nome);
}


// ações

void definirVelocidade(int pct, const char* origem) {

  if (emergenciaTravada) {
    Serial.print(">>> VELOCIDADE (");
    Serial.print(origem);
    Serial.println(") IGNORADA: emergencia ativa. Libere no site.");
    return;
  }

  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;

  velocidadePct = pct;

  Serial.print(">>> VELOCIDADE (");
  Serial.print(origem);
  Serial.print("): ");
  Serial.print(pct);
  Serial.println("%");

  publicarVelocidade();
}

void definirSentido(bool invertido, const char* origem) {

  if (emergenciaTravada) {
    Serial.println(">>> SENTIDO IGNORADO: emergencia ativa. Libere no site.");
    return;
  }

  sentidoInvertido = invertido;
  memoria.putBool("inv", invertido);

  Serial.print(">>> SENTIDO (");
  Serial.print(origem);
  Serial.print("): ");
  Serial.println(invertido ? "INVERTIDO" : "NORMAL");

  publicarSentido();
}

// parada de emergência
void emergencia(const char* origem) {

  if (emergenciaTravada) {
    Serial.print(">>> EMERGENCIA (");
    Serial.print(origem);
    Serial.println("): ja estava travada.");
    return;
  }

  emergenciaTravada = true;
  memoria.putBool("emerg", true);

  int pctReverso = max(velocidadePct, EMERGENCIA_REVERSO_PCT_MINIMO);

  velocidadePct = 0;
  aplicarMotor(0, direcaoAtualFrente);

  delay(100);

  pwmAtual = 0;
  aplicarMotor(pctParaPwm(pctReverso), !direcaoAtualFrente);

  emReverso = true;
  fimReverso = millis() + EMERGENCIA_REVERSO_MS;

  Serial.print(">>> EMERGENCIA (");
  Serial.print(origem);
  Serial.println("): esteira girando ao contrario por 1s e TRAVADA ate liberar no site");

  publicarVelocidade();
  publicarEstadoEmergencia();
}

void liberarEmergencia(const char* origem) {

  if (!emergenciaTravada) return;

  emergenciaTravada = false;
  memoria.putBool("emerg", false);
  velocidadePct = 0;

  Serial.print(">>> EMERGENCIA LIBERADA (");
  Serial.print(origem);
  Serial.println("). Esteira parada, pronta para uso.");

  publicarVelocidade();
  publicarEstadoEmergencia();
}

// rampa
void atualizarMotor() {

  if (emReverso) {

    if (millis() >= fimReverso) {
      aplicarMotor(0, direcaoAtualFrente);
      pwmAtual = 0;
      emReverso = false;
      Serial.println(">>> reverso concluido, esteira parada.");
    }

    return;
  }

  if (millis() - ultimoPasso < RAMPA_INTERVALO_MS) return;
  ultimoPasso = millis();

  bool direcaoDesejada = !sentidoInvertido;
  int alvo = pctParaPwm(velocidadePct);

  if (direcaoDesejada != direcaoAtualFrente && pwmAtual > 0) alvo = 0;
  if (pwmAtual == 0) direcaoAtualFrente = direcaoDesejada;

  if (pwmAtual < alvo) pwmAtual = min(pwmAtual + RAMPA_PASSO, alvo);
  else if (pwmAtual > alvo) pwmAtual = max(pwmAtual - RAMPA_PASSO * 2, alvo);

  aplicarMotor(pwmAtual, direcaoAtualFrente);
}


// botões

void botaoApertado(const char* nome, unsigned long duracaoMs) {

  Serial.print(">>> BOTAO: ");
  Serial.print(nome);
  Serial.print(" (apertado ha ");
  Serial.print(duracaoMs);
  Serial.println(" ms)");

  if (String(nome) == "emergencia") {
    emergencia("BOTAO");
    publicarBotao(nome);
    return;
  }

}

void lerBotoes() {

  unsigned long agora = millis();

  if (agora - ultimaAmostraBotoes < 5) return;
  ultimaAmostraBotoes = agora;

  bool aposLigar = agora > BOTOES_APOS_LIGAR_MS;

  for (int i = 0; i < 1; i++) {

    Botao& b = botoes[i];

    if (digitalRead(b.pino) == HIGH) {

      if (!b.alto) {
        b.alto = true;
        b.altoDesde = agora;
      }

      b.baixo = false;
      b.disparado = false;

      if (!b.armado && agora - b.altoDesde >= BOTAO_SOLTO_PARA_ARMAR_MS) b.armado = true;

      continue;
    }

    b.alto = false;

    if (!b.baixo) {
      b.baixo = true;
      b.inicio = agora;
    }

    if (!aposLigar || !b.armado || b.disparado) {
      if (aposLigar && !b.armado && !avisouBotaoPreso && agora - b.inicio > 2000) {
        avisouBotaoPreso = true;
        Serial.print(">>> AVISO: botao ");
        Serial.print(b.nome);
        Serial.println(" esta lendo APERTADO sem parar (fio solto, em curto ou sem pull-up). Ignorado.");
      }
      continue;
    }

    if (agora - b.inicio >= b.msMinimo) {
      b.disparado = true;
      botaoApertado(b.nome, agora - b.inicio);
    }
  }
}


// monitor serial

void mostrarStatus() {

  Serial.println();
  Serial.println("===== ESTEIRA =====");
  Serial.print("Velocidade: ");
  Serial.print(velocidadePct);
  Serial.print("% | PWM ");
  Serial.println(pwmAtual);
  Serial.print("Sentido: ");
  Serial.println(sentidoInvertido ? "INVERTIDO" : "NORMAL");
  Serial.print("Emergencia: ");
  Serial.println(emergenciaTravada ? "ATIVA (travada ate liberar no site)" : "liberada");
  Serial.print("Botao de emergencia (1 = solto): ");
  Serial.println(digitalRead(BTN_EMERGENCIA));
  Serial.print("Site: ");
  Serial.println(client.connected() ? "CONECTADO" : "DESCONECTADO");
  Serial.println("===================");
}

void processarComando(String comando) {

  comando.trim();
  comando.toUpperCase();

  if (comando.length() == 0) return;

  if (comando.startsWith("V=")) definirVelocidade(comando.substring(2).toInt(), "SERIAL");
  else if (comando == "INVERTER") definirSentido(!sentidoInvertido, "SERIAL");
  else if (comando == "EMERGENCIA") emergencia("SERIAL");
  else if (comando == "STATUS") mostrarStatus();
  else if (comando == "AJUDA") {
    Serial.println("V=60  INVERTER  EMERGENCIA  STATUS  AJUDA  (com a emergencia ativa so o site libera)");
    Serial.println("Botao de emergencia: GPIO 32 (outro lado no GND)");
  }
  else Serial.println("Comando desconhecido. Digite AJUDA.");
}


// site

void callbackMqtt(char* topic, byte* payload, unsigned int length) {

  String mensagem;
  for (unsigned int i = 0; i < length; i++) mensagem += (char)payload[i];
  mensagem.trim();

  String topico = String(topic);

  if (topico == topic_set_vel) {
    float v = mensagem.toFloat();
    int pct = (v <= 1.0) ? (int)round(v * 100) : (int)round(v);
    definirVelocidade(pct, "SITE");
  }
  else if (topico == topic_set_sentido) {
    definirSentido(mensagem == "invertido" || mensagem == "1", "SITE");
  }
  else if (topico == topic_emergencia) {
    emergencia("SITE");
  }
  else if (topico == topic_liberar) {
    liberarEmergencia("SITE");
  }
  else if (topico == topic_reiniciar) {
    Serial.println("Reiniciando por comando do site...");
    aplicarMotor(0, true);
    delay(200);
    ESP.restart();
  }
}

void gerenciarWifi() {

  bool conectadoAgora = (WiFi.status() == WL_CONNECTED);

  if (conectadoAgora && !wifiEstavaConectado) {
    Serial.print(">>> WiFi conectado! IP: ");
    Serial.println(WiFi.localIP());
    wifiEstavaConectado = true;
    return;
  }

  if (!conectadoAgora && wifiEstavaConectado) {
    Serial.println(">>> WiFi caiu! Os botoes e o Serial continuam funcionando.");
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

  if (client.connect("ESP32_Esteira", topic_status, 0, true, "offline")) {

    Serial.println("CONECTADO!");

    client.subscribe(topic_set_vel);
    client.subscribe(topic_set_sentido);
    client.subscribe(topic_emergencia);
    client.subscribe(topic_liberar);
    client.subscribe(topic_reiniciar);

    client.publish(topic_status, "online", true);

    publicarVelocidade();
    publicarSentido();
    publicarEstadoEmergencia();
  }
  else {
    Serial.print("falha (codigo ");
    Serial.print(client.state());
    Serial.println("), tentando de novo...");
  }
}


// setup e loop

void setup() {

  Serial.begin(115200);

  pinMode(PIN_EN, OUTPUT);
  digitalWrite(PIN_EN, LOW);

  configurarPwm();
  aplicarMotor(0, true);

  pinMode(BTN_EMERGENCIA, INPUT_PULLUP);

  memoria.begin("esteira", false);
  sentidoInvertido = memoria.getBool("inv", false);
  direcaoAtualFrente = !sentidoInvertido;
  emergenciaTravada = memoria.getBool("emerg", false);

  digitalWrite(PIN_EN, HIGH);

  Serial.println();
  Serial.println("==============================");
  Serial.println("FLOWPACK - ESTEIRA");
  Serial.println("==============================");
  Serial.println("BTS7960: RPWM 25 / LPWM 26 / EN 27");
  Serial.println("Botao de emergencia: GPIO 32 (MAIS/MENOS ficam no painel NFC)");
  if (emergenciaTravada) Serial.println("!!! EMERGENCIA ATIVA (salva antes de desligar): libere no site para usar a esteira.");

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  ultimaTentativaWifi = millis();

  client.setServer(mqtt_server, 1883);
  client.setCallback(callbackMqtt);
}

void loop() {

  gerenciarWifi();
  gerenciarMqtt();
  if (client.connected()) client.loop();

  lerBotoes();

  if (Serial.available()) processarComando(Serial.readStringUntil('\n'));

  atualizarMotor();

  // sinal de vida
  if (millis() - ultimoEnvio >= 1000) {
    ultimoEnvio = millis();
    publicarVelocidade();
  }

  if (millis() - ultimoEnvioSentido >= 5000) {
    ultimoEnvioSentido = millis();
    publicarSentido();
  }
}
