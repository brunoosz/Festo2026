#include <WiFi.h>
#include <PubSubClient.h>
#include <Preferences.h>

// ============================================================
// FLOWPACK - DISPENSER DE GRAOS
// ESP32 + 2 drivers BTS7960 (um para cada motor) + 2 motores DC 24V de 90 RPM
//
// Cada comando gira o motor em 1/4 de volta (ou varios quartos
// seguidos): gira por um tempo curto, FREIA e espera um instante.
//
// Motor de 90 RPM = 1,5 volta por segundo.
// 1/4 de volta a 100% leva cerca de 167 ms (15000 / RPM).
// O tempo exato se acerta no teste (botao TESTAR 1/4 DE VOLTA no site).
// Os parametros (velocidade, tempo, sentido) vem do site.
// Funciona pelo site e pelo Monitor Serial.
// ============================================================


// ============================================================
// REDE (SITE)
// ============================================================

const char* ssid = "DarkCoders";
const char* password = "COLOQUE_A_SENHA_DO_WIFI";
const char* mqtt_server = "192.168.4.1";

WiFiClient espClient;
PubSubClient client(espClient);
Preferences memoria;

const char* topic_status     = "dispenser/status";
const char* topic_estado     = "dispenser/estado";
const char* topic_concluido  = "dispenser/concluido";
const char* topic_dosar      = "dispenser/dosar";
const char* topic_emergencia = "dispenser/emergencia";
const char* topic_reiniciar  = "dispenser/reiniciar";

unsigned long ultimaTentativaWifi = 0;
bool wifiEstavaConectado = false;
unsigned long ultimaTentativaMqtt = 0;
unsigned long ultimoEnvioSite = 0;
unsigned long ultimoRelatorio = 0;


// ============================================================
// PINAGEM DOS 2 DRIVERS BTS7960
// ============================================================

// Motor 1 (reservatorio A)
#define M1_RPWM 25
#define M1_LPWM 26
#define M1_EN   27     // R_EN e L_EN ligados juntos

// Motor 2 (reservatorio B)
#define M2_RPWM 32
#define M2_LPWM 33
#define M2_EN   13     // R_EN e L_EN ligados juntos


// ============================================================
// AJUSTES
// ============================================================

const int PWM_FREQ = 20000;
const int PWM_RESOLUCAO = 8;

const unsigned long FREIO_MS = 90;       // tempo de freio no fim de cada quarto
const int MAX_QUARTOS = 4;

// Valores usados pelos comandos do Monitor Serial
// (os comandos do site trazem os proprios valores)
int serialPwm = 100;
unsigned long serialTempoMs = 170;   // ~1/4 de volta a 90 RPM, 100% de forca
unsigned long serialPausaMs = 250;


// ============================================================
// MOTORES
// ============================================================

const int F_PARADO = 0;
const int F_GIRANDO = 1;
const int F_FREANDO = 2;
const int F_PAUSA = 3;

struct Motor {
  const char* nome;
  int pinRPWM;
  int pinLPWM;
  int pinEN;
  int canalR;                 // usado so no pacote ESP32 2.x
  int canalL;
  const char* chaveMemoria;
  bool sentidoSerial;         // sentido usado nos comandos do Serial (salvo na memoria)

  bool ativo;
  int quartosTotal;
  int quartoAtual;
  int pwmPct;
  unsigned long tempoMs;
  unsigned long pausaMs;
  bool invertido;
  int fase;
  unsigned long inicioFase;
};

Motor motores[] = {
  { "MOTOR 1", M1_RPWM, M1_LPWM, M1_EN, 0, 1, "m1inv", false, false, 0, 0, 0, 0, 0, false, F_PARADO, 0 },
  { "MOTOR 2", M2_RPWM, M2_LPWM, M2_EN, 2, 3, "m2inv", false, false, 0, 0, 0, 0, 0, false, F_PARADO, 0 }
};
const int QTD_MOTORES = 2;


int limitar(int v, int minimo, int maximo) {
  if (v < minimo) return minimo;
  if (v > maximo) return maximo;
  return v;
}


// ============================================================
// PWM (compativel com pacote ESP32 2.x e 3.x)
// ============================================================

void configurarPwm(Motor& m) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(m.pinRPWM, PWM_FREQ, PWM_RESOLUCAO);
  ledcAttach(m.pinLPWM, PWM_FREQ, PWM_RESOLUCAO);
#else
  ledcSetup(m.canalR, PWM_FREQ, PWM_RESOLUCAO);
  ledcAttachPin(m.pinRPWM, m.canalR);
  ledcSetup(m.canalL, PWM_FREQ, PWM_RESOLUCAO);
  ledcAttachPin(m.pinLPWM, m.canalL);
#endif
}

void escreverPwm(Motor& m, bool ladoR, int duty) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(ladoR ? m.pinRPWM : m.pinLPWM, duty);
#else
  ledcWrite(ladoR ? m.canalR : m.canalL, duty);
#endif
}

// Gira no sentido pedido com a forca pedida (0 a 100%)
void girar(Motor& m, bool invertido, int pwmPct) {
  int duty = (limitar(pwmPct, 0, 100) * 255) / 100;
  digitalWrite(m.pinEN, HIGH);
  escreverPwm(m, invertido, 0);      // zera o lado que nao sera usado
  escreverPwm(m, !invertido, duty);  // normal = RPWM · invertido = LPWM
}

// Freio ativo: driver ligado com os dois lados em zero
// (os dois fios do motor ficam no GND e ele para rapido)
void freiar(Motor& m) {
  escreverPwm(m, true, 0);
  escreverPwm(m, false, 0);
  digitalWrite(m.pinEN, HIGH);
}

// Solta o motor (driver desligado: sem forca e sem freio)
void soltar(Motor& m) {
  escreverPwm(m, true, 0);
  escreverPwm(m, false, 0);
  digitalWrite(m.pinEN, LOW);
}


// ============================================================
// SITE: publicacao
// ============================================================

void publicarEstado() {

  if (!client.connected()) return;

  String payload = "{";

  for (int i = 0; i < QTD_MOTORES; i++) {

    Motor& m = motores[i];
    int restantes = m.ativo ? (m.quartosTotal - m.quartoAtual) : 0;

    payload += "\"m" + String(i + 1) + "\":{\"ocupado\":" + String(m.ativo ? "true" : "false");
    payload += ",\"restantes\":" + String(restantes) + "}";

    if (i < QTD_MOTORES - 1) payload += ",";
  }

  payload += "}";

  client.publish(topic_estado, payload.c_str());
}

void publicarConcluido(int numeroMotor, int quartos) {
  if (!client.connected()) return;
  String payload = "{\"motor\":" + String(numeroMotor) + ",\"quartos\":" + String(quartos) + "}";
  client.publish(topic_concluido, payload.c_str());
}


// ============================================================
// DOSAGEM: maquina de estados (sem delay, o Serial e o site
// continuam respondendo enquanto o motor gira)
// ============================================================

void iniciarQuarto(Motor& m) {
  girar(m, m.invertido, m.pwmPct);
  m.fase = F_GIRANDO;
  m.inicioFase = millis();
}

bool iniciarDosagem(int numeroMotor, int quartos, int pwmPct, unsigned long tempoMs, bool invertido, unsigned long pausaMs, const String& origem) {

  if (numeroMotor < 1 || numeroMotor > QTD_MOTORES) return false;

  Motor& m = motores[numeroMotor - 1];

  if (m.ativo) {
    Serial.print(">>> ");
    Serial.print(m.nome);
    Serial.println(" ainda esta girando, comando ignorado.");
    return false;
  }

  m.quartosTotal = limitar(quartos, 1, MAX_QUARTOS);
  m.quartoAtual = 0;
  m.pwmPct = limitar(pwmPct, 20, 100);
  m.tempoMs = (tempoMs < 10) ? 10 : (tempoMs > 2000 ? 2000 : tempoMs);
  m.pausaMs = (pausaMs > 2000) ? 2000 : pausaMs;
  m.invertido = invertido;
  m.ativo = true;

  Serial.print(">>> ");
  Serial.print(m.nome);
  Serial.print(" (");
  Serial.print(origem);
  Serial.print("): ");
  Serial.print(m.quartosTotal);
  Serial.print(" quarto(s) | forca ");
  Serial.print(m.pwmPct);
  Serial.print("% | ");
  Serial.print(m.tempoMs);
  Serial.print(" ms | pausa ");
  Serial.print(m.pausaMs);
  Serial.print(" ms | ");
  Serial.println(m.invertido ? "INVERTIDO" : "NORMAL");

  iniciarQuarto(m);
  publicarEstado();
  return true;
}

void atualizarMotor(int indice) {

  Motor& m = motores[indice];

  if (!m.ativo) return;

  unsigned long agora = millis();
  unsigned long decorrido = agora - m.inicioFase;

  if (m.fase == F_GIRANDO) {

    if (decorrido >= m.tempoMs) {
      freiar(m);
      m.fase = F_FREANDO;
      m.inicioFase = agora;
    }
  }
  else if (m.fase == F_FREANDO) {

    if (decorrido >= FREIO_MS) {

      soltar(m);
      m.quartoAtual++;

      if (m.quartoAtual >= m.quartosTotal) {

        m.ativo = false;
        m.fase = F_PARADO;

        Serial.print(">>> ");
        Serial.print(m.nome);
        Serial.println(": dosagem concluida.");

        publicarConcluido(indice + 1, m.quartosTotal);
        publicarEstado();
      }
      else if (m.pausaMs > 0) {
        m.fase = F_PAUSA;
        m.inicioFase = agora;
      }
      else {
        iniciarQuarto(m);
      }
    }
  }
  else if (m.fase == F_PAUSA) {

    if (decorrido >= m.pausaMs) iniciarQuarto(m);
  }
}

// Para tudo na hora (sem reverso: o rotor so precisa parar)
void emergencia(const String& origem) {

  for (int i = 0; i < QTD_MOTORES; i++) {
    Motor& m = motores[i];
    m.ativo = false;
    m.fase = F_PARADO;
    freiar(m);
  }

  delay(80);

  for (int i = 0; i < QTD_MOTORES; i++) soltar(motores[i]);

  Serial.print(">>> EMERGENCIA (");
  Serial.print(origem);
  Serial.println("): motores parados");

  publicarEstado();
}

void pararTudoParaReiniciar() {
  for (int i = 0; i < QTD_MOTORES; i++) {
    motores[i].ativo = false;
    soltar(motores[i]);
  }
}


// ============================================================
// COMANDOS DO MONITOR SERIAL
// ============================================================

void mostrarAjuda() {

  Serial.println();
  Serial.println("COMANDOS:");
  Serial.println();
  Serial.println("M1 QUARTO     (gira 1/4 de volta no motor 1)");
  Serial.println("M1 Q=2        (gira 2 quartos seguidos, ate 4)");
  Serial.println("M1 DOSE=100   (dose em gramas: 50 g = 1 quarto)");
  Serial.println("M1 PARAR      (idem M2 para todos os comandos acima)");
  Serial.println("M1 INVERTER   (inverte o sentido do Serial e salva)");
  Serial.println("PWM=100       (forca do motor, 20 a 100)");
  Serial.println("TEMPO=300     (ms de giro por quarto)");
  Serial.println("PAUSA=250     (ms de pausa entre quartos)");
  Serial.println("EMERGENCIA");
  Serial.println("STATUS");
  Serial.println("REINICIAR");
  Serial.println("AJUDA");
  Serial.println();
}

void mostrarStatus() {

  Serial.println();
  Serial.println("===== DISPENSER =====");

  for (int i = 0; i < QTD_MOTORES; i++) {

    Motor& m = motores[i];

    Serial.print(m.nome);
    Serial.print(": ");
    Serial.print(m.ativo ? "GIRANDO" : "parado");
    Serial.print(" | sentido do Serial: ");
    Serial.println(m.sentidoSerial ? "INVERTIDO" : "NORMAL");
  }

  Serial.print("Serial -> forca ");
  Serial.print(serialPwm);
  Serial.print("% | tempo ");
  Serial.print(serialTempoMs);
  Serial.print(" ms | pausa ");
  Serial.print(serialPausaMs);
  Serial.println(" ms");

  Serial.print("WiFi: ");
  Serial.println(WiFi.status() == WL_CONNECTED ? "CONECTADO" : "DESCONECTADO");

  Serial.print("Site: ");
  Serial.println(client.connected() ? "CONECTADO" : "DESCONECTADO");

  Serial.println("=====================");
}

void comandoMotorSerial(String comando) {

  int idx = (comando.charAt(1) == '2') ? 1 : 0;
  Motor& m = motores[idx];

  String resto = comando.substring(2);
  resto.trim();

  if (resto == "QUARTO") {
    iniciarDosagem(idx + 1, 1, serialPwm, serialTempoMs, m.sentidoSerial, serialPausaMs, "SERIAL");
  }
  else if (resto.startsWith("Q=")) {
    iniciarDosagem(idx + 1, resto.substring(2).toInt(), serialPwm, serialTempoMs, m.sentidoSerial, serialPausaMs, "SERIAL");
  }
  else if (resto.startsWith("DOSE=")) {
    int gramas = resto.substring(5).toInt();
    iniciarDosagem(idx + 1, gramas / 50, serialPwm, serialTempoMs, m.sentidoSerial, serialPausaMs, "SERIAL");
  }
  else if (resto == "PARAR") {
    m.ativo = false;
    m.fase = F_PARADO;
    freiar(m);
    delay(60);
    soltar(m);
    Serial.print(">>> ");
    Serial.print(m.nome);
    Serial.println(" parado.");
    publicarEstado();
  }
  else if (resto == "INVERTER") {
    m.sentidoSerial = !m.sentidoSerial;
    memoria.putBool(m.chaveMemoria, m.sentidoSerial);
    Serial.print(">>> ");
    Serial.print(m.nome);
    Serial.print(" sentido do Serial: ");
    Serial.println(m.sentidoSerial ? "INVERTIDO" : "NORMAL");
  }
  else {
    Serial.println("Use: M1 QUARTO | M1 Q=2 | M1 DOSE=100 | M1 PARAR | M1 INVERTER (idem M2)");
  }
}

void processarComando(String comando) {

  comando.trim();
  comando.toUpperCase();

  if (comando.length() == 0) return;

  if (comando.startsWith("M1") || comando.startsWith("M2")) {
    comandoMotorSerial(comando);
  }
  else if (comando.startsWith("PWM=")) {
    serialPwm = limitar(comando.substring(4).toInt(), 20, 100);
    Serial.print("Forca do Serial: ");
    Serial.print(serialPwm);
    Serial.println("%");
  }
  else if (comando.startsWith("TEMPO=")) {
    serialTempoMs = (unsigned long)limitar(comando.substring(6).toInt(), 10, 2000);
    Serial.print("Tempo por quarto: ");
    Serial.print(serialTempoMs);
    Serial.println(" ms");
  }
  else if (comando.startsWith("PAUSA=")) {
    serialPausaMs = (unsigned long)limitar(comando.substring(6).toInt(), 0, 2000);
    Serial.print("Pausa entre quartos: ");
    Serial.print(serialPausaMs);
    Serial.println(" ms");
  }
  else if (comando == "EMERGENCIA") {
    emergencia("SERIAL");
  }
  else if (comando == "STATUS") {
    mostrarStatus();
  }
  else if (comando == "REINICIAR") {
    Serial.println("Reiniciando o ESP32...");
    pararTudoParaReiniciar();
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

  char texto[64];
  unsigned int n = (length < sizeof(texto) - 1) ? length : sizeof(texto) - 1;
  for (unsigned int i = 0; i < n; i++) texto[i] = (char)payload[i];
  texto[n] = '\0';

  String topico = String(topic);

  if (topico == topic_dosar) {

    // Formato: motor;quartos;forca;tempoMs;invertido;pausaMs
    int motor = 0, quartos = 0, forca = 0, invertido = 0;
    unsigned long tempo = 0, pausa = 0;

    int lidos = sscanf(texto, "%d;%d;%d;%lu;%d;%lu", &motor, &quartos, &forca, &tempo, &invertido, &pausa);

    if (lidos == 6) {
      iniciarDosagem(motor, quartos, forca, tempo, invertido == 1, pausa, "SITE");
    }
    else {
      Serial.print(">>> Comando de dosagem invalido: ");
      Serial.println(texto);
    }
  }
  else if (topico == topic_emergencia) {
    emergencia("SITE");
  }
  else if (topico == topic_reiniciar) {
    Serial.println("Reiniciando por comando do site...");
    pararTudoParaReiniciar();
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

  if (client.connect("ESP32_Dispenser", topic_status, 0, true, "offline")) {

    Serial.println("CONECTADO!");

    client.subscribe(topic_dosar);
    client.subscribe(topic_emergencia);
    client.subscribe(topic_reiniciar);

    client.publish(topic_status, "online", true);
    publicarEstado();
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

  Serial.println();
  Serial.println("==============================");
  Serial.println("FLOWPACK");
  Serial.println("DISPENSER DE GRAOS (2x BTS7960)");
  Serial.println("==============================");

  memoria.begin("dispenser", false);

  for (int i = 0; i < QTD_MOTORES; i++) {

    Motor& m = motores[i];

    pinMode(m.pinEN, OUTPUT);
    digitalWrite(m.pinEN, LOW);

    configurarPwm(m);
    soltar(m);

    m.sentidoSerial = memoria.getBool(m.chaveMemoria, false);
  }

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

  if (Serial.available()) {
    String comando = Serial.readStringUntil('\n');
    processarComando(comando);
  }

  for (int i = 0; i < QTD_MOTORES; i++) atualizarMotor(i);

  // Sinal de vida para o site a cada 1 segundo
  if (agora - ultimoEnvioSite >= 1000) {
    ultimoEnvioSite = agora;
    publicarEstado();
  }

  if (agora - ultimoRelatorio >= 2000) {

    ultimoRelatorio = agora;

    Serial.print("M1: ");
    Serial.print(motores[0].ativo ? "GIRANDO" : "parado");
    Serial.print(" | M2: ");
    Serial.print(motores[1].ativo ? "GIRANDO" : "parado");
    Serial.print(" | Site: ");
    Serial.println(client.connected() ? "OK" : "OFF");
  }
}
