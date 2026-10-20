#include <WiFi.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <Adafruit_MLX90614.h>
#include <PID_v1.h>

// ================================================================================
// SELAGEM 2 (ROTATIVA) - ESP32 DO AQUECIMENTO
// Fita de NiCr + SSR-25DD + sensor IR GY-906 + PID
// Controle pelo site (MQTT) e pelo Monitor Serial do Arduino IDE
// Nada desliga sozinho: temperatura alta ou falha de leitura so geram AVISO
// ================================================================================

// ------------------------------- REDE -------------------------------------------
const char* ssid = "DarkCoders";
const char* password = "COLOQUE_A_SENHA_DO_WIFI";
const char* mqtt_server = "192.168.4.1";

WiFiClient espClient;
PubSubClient client(espClient);

const char* topic_dados           = "selagem2/dados";
const char* topic_set_temperatura = "selagem2/set_temperatura";
const char* topic_ativar          = "selagem2/ativar";
const char* topic_emergencia      = "selagem2/emergencia";
const char* topic_status          = "selagem2/status_conexao";
const char* topic_reiniciar       = "selagem2/reiniciar";

// ------------------------------- SENSOR IR (GY-906) ----------------------------
const int PIN_SDA = 21;
const int PIN_SCL = 22;
Adafruit_MLX90614 sensor = Adafruit_MLX90614();
bool sensorEncontrado = false;

// ------------------------------- SSR-25DD ---------------------------------------
const int SSR_PIN = 25;

// ------------------------------- PID --------------------------------------------
// Saida do PID em milissegundos: quanto tempo o SSR fica ligado dentro da janela
const unsigned long JANELA_MS = 2000;
double temperaturaAtual = 0;
double saidaPID = 0;          // 0 a JANELA_MS
double potencia = 0;          // 0 a 100% (so pra mostrar)
double setpoint = 0;          // comeca em 0 ao ligar a placa

double Kp = 12.0;
double Ki = 0.35;
double Kd = 20.0;

PID controlePID(&temperaturaAtual, &saidaPID, &setpoint, Kp, Ki, Kd, DIRECT);
unsigned long inicioJanela = 0;

// ------------------------------- AVISOS -----------------------------------------
const double TEMP_MAX_ALVO = 250.0;   // maior alvo aceito
const double TEMP_AVISO = 260.0;      // acima disso so mostra AVISO no site
bool habilitado = false;
String estadoSeguranca = "ok";        // "ok" | "erro_sensor" | "temperatura_alta"

// ------------------------------- TEMPORIZADORES ---------------------------------
unsigned long ultimaLeituraSensor = 0;
const unsigned long INTERVALO_LEITURA_MS = 500;
unsigned long ultimoEnvioDados = 0;
const unsigned long INTERVALO_ENVIO_MS = 1000;
unsigned long ultimoLogSerial = 0;
const unsigned long INTERVALO_LOG_SERIAL_MS = 1000;
unsigned long ultimaTentativaWifi = 0;
const unsigned long INTERVALO_TENTATIVA_WIFI_MS = 10000;
bool wifiEstavaConectado = false;
unsigned long ultimaTentativaMqtt = 0;
const unsigned long INTERVALO_TENTATIVA_MQTT_MS = 5000;

// ================================================================================
// PUBLICACAO PRO SITE
// ================================================================================
void publicarDados() {
  if (!client.connected()) return;
  String payload = "{";
  payload += "\"temperatura\":" + String(temperaturaAtual, 1) + ",";
  payload += "\"setpoint\":" + String(setpoint, 1) + ",";
  payload += "\"potencia\":" + String(potencia, 1) + ",";
  payload += "\"habilitado\":" + String(habilitado ? "true" : "false") + ",";
  payload += "\"seguranca\":\"" + estadoSeguranca + "\"";
  payload += "}";
  client.publish(topic_dados, payload.c_str());
}

// ================================================================================
// ACOES (site e Monitor Serial)
// ================================================================================
void definirSetpoint(double valor, const String& origem) {
  if (valor < 0) valor = 0;
  if (valor > TEMP_MAX_ALVO) valor = TEMP_MAX_ALVO;
  setpoint = valor;
  Serial.print(">>> TEMPERATURA ALVO ("); Serial.print(origem); Serial.print("): ");
  Serial.print(setpoint); Serial.println(" C");
  publicarDados();
}

void definirHabilitado(bool ligar, const String& origem) {
  habilitado = ligar;
  if (ligar) {
    inicioJanela = millis();
    controlePID.SetMode(AUTOMATIC);
  } else {
    controlePID.SetMode(MANUAL);
    saidaPID = 0;
    potencia = 0;
    digitalWrite(SSR_PIN, LOW);
  }
  Serial.print(">>> AQUECIMENTO "); Serial.print(ligar ? "LIGADO" : "DESLIGADO");
  Serial.print(" ("); Serial.print(origem); Serial.println(")");
  publicarDados();
}

void acionarEmergencia(const String& origem) {
  definirHabilitado(false, origem);
  Serial.print(">>> EMERGENCIA ("); Serial.print(origem); Serial.println("): aquecimento desligado");
}

// ================================================================================
// SENSOR: se falhar, so avisa e o PID continua com a ultima leitura valida
// ================================================================================
void lerSensor() {
  if (!sensorEncontrado && sensor.begin()) {
    sensorEncontrado = true;
    Serial.println(">>> Sensor GY-906 encontrado.");
  }
  if (!sensorEncontrado) {
    estadoSeguranca = "erro_sensor";
    return;
  }

  double leitura = sensor.readObjectTempC();
  if (isnan(leitura) || leitura < -70 || leitura > 380) {
    estadoSeguranca = "erro_sensor";
    return;
  }

  temperaturaAtual = leitura;
  estadoSeguranca = (temperaturaAtual >= TEMP_AVISO) ? "temperatura_alta" : "ok";
}

// Liga/desliga o SSR dentro da janela de tempo conforme o PID
void controlarAquecimento() {
  if (!habilitado) {
    saidaPID = 0;
    potencia = 0;
    digitalWrite(SSR_PIN, LOW);
    return;
  }
  controlePID.Compute();
  potencia = saidaPID / JANELA_MS * 100.0;

  unsigned long agora = millis();
  if (agora - inicioJanela >= JANELA_MS) inicioJanela = agora;
  digitalWrite(SSR_PIN, (agora - inicioJanela) < (unsigned long)saidaPID ? HIGH : LOW);
}

// ================================================================================
// MONITOR SERIAL
// ================================================================================
void mostrarAjuda() {
  Serial.println();
  Serial.println("==================================================");
  Serial.println("COMANDOS - SELAGEM 2 AQUECIMENTO (MONITOR SERIAL):");
  Serial.println("  LIGAR / DESLIGAR   - liga/desliga o aquecimento (ON/OFF tambem)");
  Serial.println("  TEMP <0-250>       - temperatura alvo, ex: TEMP 80");
  Serial.println("  EMERGENCIA         - desliga o aquecimento");
  Serial.println("  REINICIAR          - reinicia o ESP32");
  Serial.println("  STATUS             - mostra tudo");
  Serial.println("  AJUDA              - mostra esta lista");
  Serial.println("==================================================");
  Serial.println();
}

void mostrarStatus() {
  Serial.println();
  Serial.println("--------- STATUS SELAGEM 2 AQUECIMENTO ---------");
  Serial.print("Sensor GY-906:  "); Serial.println(sensorEncontrado ? "OK" : "NAO ENCONTRADO");
  Serial.print("Temperatura:    "); Serial.print(temperaturaAtual); Serial.println(" C");
  Serial.print("Alvo:           "); Serial.print(setpoint); Serial.println(" C");
  Serial.print("Aquecimento:    "); Serial.println(habilitado ? "LIGADO" : "DESLIGADO");
  Serial.print("Potencia PID:   "); Serial.print(potencia); Serial.println(" %");
  Serial.print("Aviso:          "); Serial.println(estadoSeguranca);
  Serial.print("WiFi:           "); Serial.println(WiFi.status() == WL_CONNECTED ? "CONECTADO" : "DESCONECTADO");
  Serial.print("Site (MQTT):    "); Serial.println(client.connected() ? "CONECTADO" : "DESCONECTADO");
  Serial.println("------------------------------------------------");
  Serial.println();
}

void processarSerial() {
  if (!Serial.available()) return;
  String linha = Serial.readStringUntil('\n');
  linha.trim();
  if (linha.length() == 0) return;
  String cmd = linha;
  cmd.toUpperCase();

  if (cmd == "LIGAR" || cmd == "ON") {
    definirHabilitado(true, "SERIAL");
  } else if (cmd == "DESLIGAR" || cmd == "OFF") {
    definirHabilitado(false, "SERIAL");
  } else if (cmd.startsWith("TEMP")) {
    String v = linha.substring(4);
    v.trim();
    if (v.length() == 0) Serial.println(">>> Use: TEMP <0-250>, ex: TEMP 80");
    else definirSetpoint(v.toDouble(), "SERIAL");
  } else if (cmd == "EMERGENCIA") {
    acionarEmergencia("SERIAL");
  } else if (cmd == "REINICIAR") {
    Serial.println(">>> REINICIANDO...");
    digitalWrite(SSR_PIN, LOW);
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

// ================================================================================
// MQTT - mensagens vindas do site
// ================================================================================
void callbackMqtt(char* topic, byte* payload, unsigned int length) {
  String mensagem;
  for (unsigned int i = 0; i < length; i++) mensagem += (char)payload[i];
  mensagem.trim();
  String topico = String(topic);

  if (topico == topic_set_temperatura) definirSetpoint(mensagem.toDouble(), "SITE");
  if (topico == topic_ativar) definirHabilitado(mensagem == "1" || mensagem == "true", "SITE");
  if (topico == topic_emergencia) acionarEmergencia("SITE");
  if (topico == topic_reiniciar) {
    Serial.println(">>> REINICIANDO POR COMANDO DO SITE...");
    digitalWrite(SSR_PIN, LOW);
    delay(200);
    ESP.restart();
  }
}

// ================================================================================
// WIFI E MQTT (nao-bloqueantes)
// ================================================================================
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
  if (client.connect("ESP32_Selagem2_Aquecimento", topic_status, 0, true, "offline")) {
    Serial.println("CONECTADO!");
    client.subscribe(topic_set_temperatura);
    client.subscribe(topic_ativar);
    client.subscribe(topic_emergencia);
    client.subscribe(topic_reiniciar);
    client.publish(topic_status, "online", true);
    publicarDados();
  } else {
    Serial.print("Falha (codigo "); Serial.print(client.state());
    Serial.println("). Tentando de novo em breve...");
  }
}

// ================================================================================
// SETUP E LOOP
// ================================================================================
void setup() {
  Serial.begin(115200);
  Serial.println();
  Serial.println("===========================================");
  Serial.println("SELAGEM 2 (ROTATIVA) - AQUECIMENTO NiCr");
  Serial.println("===========================================");

  pinMode(SSR_PIN, OUTPUT);
  digitalWrite(SSR_PIN, LOW);

  Wire.begin(PIN_SDA, PIN_SCL);
  if (sensor.begin()) {
    sensorEncontrado = true;
    Serial.println(">>> Sensor GY-906 encontrado.");
  } else {
    Serial.println(">>> AVISO: sensor GY-906 nao encontrado (confira VIN, GND, SDA 21, SCL 22).");
  }

  controlePID.SetOutputLimits(0, JANELA_MS);
  controlePID.SetSampleTime(500);
  controlePID.SetMode(MANUAL);
  inicioJanela = millis();

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

  if (millis() - ultimaLeituraSensor >= INTERVALO_LEITURA_MS) {
    ultimaLeituraSensor = millis();
    lerSensor();
  }

  controlarAquecimento();

  if (millis() - ultimoEnvioDados >= INTERVALO_ENVIO_MS) {
    ultimoEnvioDados = millis();
    publicarDados();
  }

  if (millis() - ultimoLogSerial >= INTERVALO_LOG_SERIAL_MS) {
    ultimoLogSerial = millis();
    Serial.print("Temp: "); Serial.print(temperaturaAtual, 1);
    Serial.print(" C / Alvo: "); Serial.print(setpoint, 0);
    Serial.print(" | Aquec: "); Serial.print(habilitado ? "ON " : "OFF");
    Serial.print(" "); Serial.print(potencia, 0); Serial.print("%");
    Serial.print(" | Aviso: "); Serial.print(estadoSeguranca);
    Serial.print(" | Site: "); Serial.println(client.connected() ? "OK" : "OFF");
  }
}
