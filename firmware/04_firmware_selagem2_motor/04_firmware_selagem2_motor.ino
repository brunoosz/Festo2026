// GitHub: https://github.com/brunoosz | LinkedIn: https://www.linkedin.com/in/brunocamperlingo/
#include <WiFi.h>
#include <PubSubClient.h>
#include <Preferences.h>

// selagem 2 motor

// rede
const char* ssid = "DarkCoders";
const char* password = "COLOQUE_A_SENHA_DO_WIFI";
const char* mqtt_server = "192.168.4.1";

WiFiClient espClient;
PubSubClient client(espClient);
Preferences memoria;

const char* topic_vel_set        = "selagem2/motor/velocidade/set";
const char* topic_vel_atual      = "selagem2/motor/velocidade/atual";
const char* topic_status         = "selagem2/motor/status";
const char* topic_sentido_set    = "selagem2/motor/sentido/set";
const char* topic_sentido_atual  = "selagem2/motor/sentido/atual";
const char* topic_reiniciar      = "selagem2/motor/reiniciar";
const char* topic_emergencia     = "selagem2/emergencia";   // emergência

// BTS7960
const int PIN_RPWM = 25;
const int PIN_LPWM = 26;
const int PIN_EN   = 27;   // pinos de ativação

const int PWM_FREQ = 20000;
const int PWM_RESOLUCAO = 8;
const int PWM_MAX = 255;         // 100% real
const int PWM_MINIMO = 50;       // força mínima

const unsigned long EMERGENCIA_REVERSO_MS = 1000;
const int EMERGENCIA_REVERSO_PCT_MINIMO = 50;
const int RAMPA_PASSO = 5;
const unsigned long RAMPA_INTERVALO_MS = 10;

// estado
int velocidadePct = 0;
int pwmAtual = 0;
bool sentidoInvertido = false;
bool direcaoAtualFrente = true;
bool emReversoEmergencia = false;
unsigned long fimReversoEmergencia = 0;

// temporizadores
unsigned long ultimoEnvioDados = 0;
const unsigned long INTERVALO_ENVIO_MS = 1000;
unsigned long ultimoLogSerial = 0;
const unsigned long INTERVALO_LOG_SERIAL_MS = 1000;
unsigned long ultimaTentativaWifi = 0;
const unsigned long INTERVALO_TENTATIVA_WIFI_MS = 10000;
bool wifiEstavaConectado = false;
unsigned long ultimaTentativaMqtt = 0;
const unsigned long INTERVALO_TENTATIVA_MQTT_MS = 5000;

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

void escreverPwm(int pino, int valor) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(pino, valor);
#else
  ledcWrite(pino == PIN_RPWM ? 0 : 1, valor);
#endif
}

void aplicarMotor(int pwm, bool frente) {
  if (pwm <= 0) {
    escreverPwm(PIN_RPWM, 0);
    escreverPwm(PIN_LPWM, 0);
    return;
  }
  if (frente) {
    escreverPwm(PIN_LPWM, 0);
    escreverPwm(PIN_RPWM, pwm);
  } else {
    escreverPwm(PIN_RPWM, 0);
    escreverPwm(PIN_LPWM, pwm);
  }
}

int pctParaPwm(int pct) {
  if (pct <= 0) return 0;
  if (pct > 100) pct = 100;
  return map(pct, 1, 100, PWM_MINIMO, PWM_MAX);
}

// publicações
void publicarVelocidade() {
  if (!client.connected()) return;
  String valor = String(velocidadePct / 100.0, 2);
  client.publish(topic_vel_atual, valor.c_str());
}

void publicarSentido() {
  if (!client.connected()) return;
  client.publish(topic_sentido_atual, sentidoInvertido ? "invertido" : "normal", true);
}

// ações
void definirVelocidade(int pct, const String& origem) {
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;
  velocidadePct = pct;
  Serial.print(">>> VELOCIDADE ("); Serial.print(origem); Serial.print("): ");
  Serial.print(velocidadePct); Serial.println("%");
  publicarVelocidade();
}

void acionarEmergencia(const String& origem) {
  int pctReverso = max(velocidadePct, EMERGENCIA_REVERSO_PCT_MINIMO);
  velocidadePct = 0;
  aplicarMotor(0, direcaoAtualFrente);
  delay(100);
  pwmAtual = 0;
  aplicarMotor(pctParaPwm(pctReverso), !direcaoAtualFrente);
  emReversoEmergencia = true;
  fimReversoEmergencia = millis() + EMERGENCIA_REVERSO_MS;
  Serial.print(">>> EMERGENCIA ("); Serial.print(origem);
  Serial.println("): girando ao contrario por 1 segundo e parando");
  publicarVelocidade();
}

void definirSentido(bool invertido, const String& origem) {
  sentidoInvertido = invertido;
  memoria.putBool("invertido", invertido);
  Serial.print(">>> SENTIDO ("); Serial.print(origem); Serial.print("): ");
  Serial.println(invertido ? "INVERTIDO" : "NORMAL");
  publicarSentido();
}

// rampa
void atualizarMotor() {
  if (emReversoEmergencia) {
    if (millis() >= fimReversoEmergencia) {
      aplicarMotor(0, direcaoAtualFrente);
      pwmAtual = 0;
      emReversoEmergencia = false;
      Serial.println(">>> Reverso da emergencia concluido, motor parado.");
    }
    return;
  }

  static unsigned long ultimoPasso = 0;
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

// monitor serial
void mostrarAjuda() {
  Serial.println();
  Serial.println("==================================================");
  Serial.println("COMANDOS - SELAGEM 2 MOTOR (MONITOR SERIAL):");
  Serial.println("  VEL <0-100>          - velocidade em %, ex: VEL 60");
  Serial.println("  PARAR                - para o motor");
  Serial.println("  EMERGENCIA           - reverso de 1s e para");
  Serial.println("  INVERTER             - inverte o sentido atual");
  Serial.println("  SENTIDO NORMAL       - define sentido normal");
  Serial.println("  SENTIDO INVERTIDO    - define sentido invertido");
  Serial.println("  REINICIAR            - reinicia o ESP32");
  Serial.println("  STATUS               - mostra o estado atual");
  Serial.println("  AJUDA                - mostra esta lista");
  Serial.println("==================================================");
  Serial.println();
}

void mostrarStatus() {
  Serial.println();
  Serial.println("--------- STATUS SELAGEM 2 MOTOR ---------");
  Serial.print("Velocidade pedida: "); Serial.print(velocidadePct); Serial.println("%");
  Serial.print("PWM aplicado:      "); Serial.print(pwmAtual); Serial.println(" / 255");
  Serial.print("Sentido:           "); Serial.println(sentidoInvertido ? "INVERTIDO" : "NORMAL");
  Serial.print("Em reverso emerg.: "); Serial.println(emReversoEmergencia ? "SIM" : "NAO");
  Serial.print("WiFi:              "); Serial.println(WiFi.status() == WL_CONNECTED ? "CONECTADO" : "DESCONECTADO");
  Serial.print("Site (MQTT):       "); Serial.println(client.connected() ? "CONECTADO" : "DESCONECTADO");
  Serial.println("-----------------------------------------");
  Serial.println();
}

void processarSerial() {
  if (!Serial.available()) return;
  String linha = Serial.readStringUntil('\n');
  linha.trim();
  if (linha.length() == 0) return;
  String cmd = linha;
  cmd.toUpperCase();

  if (cmd.startsWith("VEL")) {
    String v = linha.substring(3);
    v.trim();
    if (v.length() == 0) Serial.println(">>> Use: VEL <0-100>, ex: VEL 60");
    else definirVelocidade(v.toInt(), "SERIAL");
  } else if (cmd == "PARAR") {
    definirVelocidade(0, "SERIAL");
  } else if (cmd == "EMERGENCIA") {
    acionarEmergencia("SERIAL");
  } else if (cmd == "INVERTER") {
    definirSentido(!sentidoInvertido, "SERIAL");
  } else if (cmd == "SENTIDO NORMAL") {
    definirSentido(false, "SERIAL");
  } else if (cmd == "SENTIDO INVERTIDO") {
    definirSentido(true, "SERIAL");
  } else if (cmd == "REINICIAR") {
    Serial.println(">>> REINICIANDO...");
    aplicarMotor(0, direcaoAtualFrente);
    delay(200);
    ESP.restart();
  } else if (cmd == "STATUS") {
    mostrarStatus();
  } else if (cmd == "AJUDA" || cmd == "HELP") {
    mostrarAjuda();
  } else {
    Serial.print(">>> Comando desconhecido: \""); Serial.print(linha);
    Serial.println("\". Digite AJUDA.");
  }
}

// mensagens do site
void callbackMqtt(char* topic, byte* payload, unsigned int length) {
  String mensagem;
  for (unsigned int i = 0; i < length; i++) mensagem += (char)payload[i];
  mensagem.trim();
  String topico = String(topic);

  if (topico == topic_vel_set) {
    float v = mensagem.toFloat();
    int pct = (v <= 1.0) ? (int)round(v * 100) : (int)round(v);
    definirVelocidade(pct, "SITE");
  }
  if (topico == topic_emergencia) acionarEmergencia("SITE");
  if (topico == topic_sentido_set) definirSentido(mensagem == "invertido" || mensagem == "1", "SITE");
  if (topico == topic_reiniciar) {
    Serial.println(">>> REINICIANDO POR COMANDO DO SITE...");
    aplicarMotor(0, direcaoAtualFrente);
    delay(200);
    ESP.restart();
  }
}

// Wi-Fi e MQTT
void gerenciarWifi() {
  bool conectadoAgora = (WiFi.status() == WL_CONNECTED);
  if (conectadoAgora && !wifiEstavaConectado) {
    Serial.print(">>> WiFi conectado! IP: ");
    Serial.println(WiFi.localIP());
    wifiEstavaConectado = true;
    return;
  }
  if (!conectadoAgora && wifiEstavaConectado) {
    Serial.println(">>> WiFi caiu! Continua operando pelo Serial. Tentando reconectar...");
    wifiEstavaConectado = false;
  }
  if (conectadoAgora) return;
  if (millis() - ultimaTentativaWifi >= INTERVALO_TENTATIVA_WIFI_MS) {
    ultimaTentativaWifi = millis();
    Serial.print(">>> Tentando conectar ao WiFi: ");
    Serial.println(ssid);
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid, password);
  }
}

void gerenciarMqtt() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (client.connected()) return;
  if (millis() - ultimaTentativaMqtt < INTERVALO_TENTATIVA_MQTT_MS) return;
  ultimaTentativaMqtt = millis();

  Serial.print(">>> Conectando ao site (MQTT)... ");
  if (client.connect("ESP32_Selagem2_Motor", topic_status, 0, true, "offline")) {
    Serial.println("CONECTADO!");
    client.subscribe(topic_vel_set);
    client.subscribe(topic_emergencia);
    client.subscribe(topic_sentido_set);
    client.subscribe(topic_reiniciar);
    client.publish(topic_status, "online", true);
    publicarSentido();
    publicarVelocidade();
  } else {
    Serial.print("Falha (codigo "); Serial.print(client.state());
    Serial.println("). Tentando de novo em breve...");
  }
}

// setup e loop
void setup() {
  Serial.begin(115200);
  Serial.println();
  Serial.println("==========================================");
  Serial.println("SELAGEM 2 (ROTATIVA) - MOTOR BTS7960");
  Serial.println("==========================================");

  pinMode(PIN_EN, OUTPUT);
  digitalWrite(PIN_EN, LOW);
  configurarPwm();
  aplicarMotor(0, true);

  memoria.begin("sel2motor", false);
  sentidoInvertido = memoria.getBool("invertido", false);
  direcaoAtualFrente = !sentidoInvertido;
  digitalWrite(PIN_EN, HIGH);

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  ultimaTentativaWifi = millis();
  client.setServer(mqtt_server, 1883);
  client.setCallback(callbackMqtt);

  mostrarAjuda();
}

void loop() {
  gerenciarWifi();
  gerenciarMqtt();
  if (client.connected()) client.loop();

  processarSerial();
  atualizarMotor();

  // sinal de vida
  if (millis() - ultimoEnvioDados >= INTERVALO_ENVIO_MS) {
    ultimoEnvioDados = millis();
    publicarVelocidade();
  }

  if (millis() - ultimoLogSerial >= INTERVALO_LOG_SERIAL_MS) {
    ultimoLogSerial = millis();
    Serial.print("Velocidade: "); Serial.print(velocidadePct);
    Serial.print("% | PWM: "); Serial.print(pwmAtual);
    Serial.print(" | Sentido: "); Serial.print(sentidoInvertido ? "INVERTIDO" : "NORMAL");
    Serial.print(" | Site: "); Serial.println(client.connected() ? "OK" : "OFF");
  }
}
