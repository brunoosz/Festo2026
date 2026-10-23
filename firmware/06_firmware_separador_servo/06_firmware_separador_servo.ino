// GitHub: https://github.com/brunoosz | LinkedIn: https://www.linkedin.com/in/brunocamperlingo/
#include <WiFi.h>
#include <PubSubClient.h>
#include <Preferences.h>
#include <math.h>

// separador


// rede

const char* ssid = "DarkCoders";
const char* password = "COLOQUE_A_SENHA_DO_WIFI";
const char* mqtt_server = "192.168.4.1";

WiFiClient espClient;
PubSubClient client(espClient);

const char* topic_status      = "separador/status";
const char* topic_estado      = "separador/estado";
const char* topic_desviar     = "separador/desviar";      // formato do pedido
const char* topic_teste       = "separador/teste";        // lado
const char* topic_config      = "separador/config";       // ajustes em JSON
const char* topic_emergencia  = "separador/emergencia";
const char* topic_reiniciar   = "separador/reiniciar";
const char* topic_liberar     = "separador/liberar";      // destravar
const char* topic_servo_ang   = "separador/servo/angulo";   // {"a":90,"v":60,"h":0}
const char* topic_servo_cfg   = "separador/servo/config";   // limites e pulsos
const char* topic_servo_parar = "separador/servo/parar";    // para na hora

unsigned long ultimaTentativaWifi = 0;
bool wifiEstavaConectado = false;
unsigned long ultimaTentativaMqtt = 0;
unsigned long ultimoEstado = 0;


// servo

#define SERVO_PIN 18

const int SERVO_FREQ = 50;
const int SERVO_RES = 14;
int pulsoMin = 500;               // pulso mínimo (us)
int pulsoMax = 2400;              // pulso máximo (us)
int limMin = 0;                   // limite de segurança
int limMax = 180;
bool inverter = false;

Preferences memoria;

// sem trava na placa: a trava vale só no site
bool travado = false;


// ajustes

int angEsq = 45;
int angCentro = 90;
int angDir = 135;
int velocidade = 60;              // velocidade
int velAtiva = 60;                // velocidade do movimento atual
unsigned long abertoPadraoMs = 900;


// estado do servo

float angulo = 90;                // posição atual
float alvo = 90;                  // destino
char ladoAtual = 'C';             // C, E, D ou M (manual)
unsigned long fimSegurar = 0;
unsigned long ultimoPasso = 0;
int ultimoDuty = -1;
unsigned long ultimoEscrito = 0;

struct Pedido {
  unsigned long quando;           // hora de abrir
  char lado;
  unsigned long aberto;
};

const int MAX_FILA = 10;
Pedido fila[MAX_FILA];
int nFila = 0;


// escrita do servo

void configurarServo() {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(SERVO_PIN, SERVO_FREQ, SERVO_RES);
#else
  ledcSetup(0, SERVO_FREQ, SERVO_RES);
  ledcAttachPin(SERVO_PIN, 0);
#endif
}

void escreverServo(float graus) {

  if (graus < limMin) graus = limMin;
  if (graus > limMax) graus = limMax;
  if (inverter) graus = 180 - graus;

  float us = pulsoMin + (graus / 180.0) * (pulsoMax - pulsoMin);
  int duty = (int)(us * 16384.0 / 20000.0);

  if (duty == ultimoDuty && millis() - ultimoEscrito < 500) return;

  ultimoDuty = duty;
  ultimoEscrito = millis();

#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(SERVO_PIN, duty);
#else
  ledcWrite(0, duty);
#endif
}

int dentroDosLimites(int graus) {
  if (graus < limMin) return limMin;
  if (graus > limMax) return limMax;
  return graus;
}

int anguloDoLado(char lado) {
  if (lado == 'E') return dentroDosLimites(angEsq);
  if (lado == 'D') return dentroDosLimites(angDir);
  return dentroDosLimites(angCentro);
}

// passo do servo
float grausPorPasso() {
  return 0.15 + (velAtiva - 1) * (6.0 - 0.15) / 99.0;
}


// salvar e carregar

void salvarAjustes() {
  memoria.putInt("esq", angEsq);
  memoria.putInt("centro", angCentro);
  memoria.putInt("dir", angDir);
  memoria.putInt("vel", velocidade);
  memoria.putInt("aberto", (int)abertoPadraoMs);
}

void salvarServoConfig() {
  memoria.putInt("limMin", limMin);
  memoria.putInt("limMax", limMax);
  memoria.putInt("pMin", pulsoMin);
  memoria.putInt("pMax", pulsoMax);
  memoria.putBool("inv", inverter);
}

void carregarAjustes() {
  angEsq = memoria.getInt("esq", 45);
  angCentro = memoria.getInt("centro", 90);
  angDir = memoria.getInt("dir", 135);
  velocidade = memoria.getInt("vel", 60);
  abertoPadraoMs = memoria.getInt("aberto", 900);
  limMin = memoria.getInt("limMin", 0);
  limMax = memoria.getInt("limMax", 180);
  pulsoMin = memoria.getInt("pMin", 500);
  pulsoMax = memoria.getInt("pMax", 2400);
  inverter = memoria.getBool("inv", false);
  velAtiva = velocidade;
}


// status

void enviarEstado() {

  if (!client.connected()) return;

  String payload = "{";
  payload += "\"lado\":\"" + String(ladoAtual) + "\",";
  payload += "\"angulo\":" + String(angulo, 1) + ",";
  payload += "\"fila\":" + String(nFila) + ",";
  payload += "\"esq\":" + String(angEsq) + ",";
  payload += "\"centro\":" + String(angCentro) + ",";
  payload += "\"dir\":" + String(angDir) + ",";
  payload += "\"vel\":" + String(velocidade) + ",";
  payload += "\"aberto\":" + String((int)abertoPadraoMs) + ",";
  payload += "\"limMin\":" + String(limMin) + ",";
  payload += "\"limMax\":" + String(limMax) + ",";
  payload += "\"pulsoMin\":" + String(pulsoMin) + ",";
  payload += "\"pulsoMax\":" + String(pulsoMax) + ",";
  payload += "\"inv\":" + String(inverter ? "true" : "false") + ",";
  payload += "\"travado\":" + String(travado ? "true" : "false");
  payload += "}";

  client.publish(topic_estado, payload.c_str());
}


// fila de pedidos

void adicionarPedido(char lado, unsigned long atrasoMs, unsigned long abertoMs) {

  if (travado) {
    Serial.println("Pedido ignorado: emergencia ativa. Libere no site.");
    return;
  }

  if (lado != 'E' && lado != 'D') return;

  if (nFila >= MAX_FILA) {
    Serial.println("Fila cheia: pedido ignorado.");
    return;
  }

  if (abertoMs < 100) abertoMs = 100;
  if (abertoMs > 5000) abertoMs = 5000;
  if (atrasoMs > 15000) atrasoMs = 15000;

  fila[nFila].quando = millis() + atrasoMs;
  fila[nFila].lado = lado;
  fila[nFila].aberto = abertoMs;
  nFila++;

  Serial.print("Pedido: ");
  Serial.print(lado == 'E' ? "ESQUERDA" : "DIREITA");
  Serial.print(" em ");
  Serial.print(atrasoMs);
  Serial.print(" ms, aberto ");
  Serial.print(abertoMs);
  Serial.println(" ms");
}

void removerPedido(int i) {
  for (int k = i; k < nFila - 1; k++) fila[k] = fila[k + 1];
  nFila--;
}

void limparFilaEVoltar() {
  nFila = 0;
  ladoAtual = 'C';
  velAtiva = velocidade;
  alvo = anguloDoLado('C');
  fimSegurar = 0;
}

// pedido vencido
void processarFila(unsigned long agora) {

  int escolhido = -1;

  for (int i = 0; i < nFila; i++) {
    if (fila[i].quando <= agora && (escolhido < 0 || fila[i].quando < fila[escolhido].quando)) escolhido = i;
  }

  if (escolhido < 0) return;

  Pedido p = fila[escolhido];

  // manual parado cede ao pedido automático
  if (ladoAtual == 'M' && fimSegurar == 0) { ladoAtual = 'C'; alvo = anguloDoLado('C'); }
  velAtiva = velocidade;

  if (ladoAtual == p.lado) {
    // já aberto
    if (agora + p.aberto > fimSegurar) fimSegurar = agora + p.aberto;
    removerPedido(escolhido);
    return;
  }

  if (ladoAtual == 'C' && fabs(angulo - anguloDoLado('C')) < 3.0) {
    ladoAtual = p.lado;
    alvo = anguloDoLado(p.lado);
    fimSegurar = agora + p.aberto;
    removerPedido(escolhido);
    return;
  }

  // na fila
}


// comandos

void testarLado(char lado) {

  if (travado) {
    Serial.println("Teste ignorado: emergencia ativa. Libere no site.");
    return;
  }

  if (lado == 'C') {
    limparFilaEVoltar();
    Serial.println("Teste: CENTRO");
    return;
  }

  nFila = 0;
  velAtiva = velocidade;
  ladoAtual = lado;
  alvo = anguloDoLado(lado);
  fimSegurar = millis() + abertoPadraoMs;

  Serial.print("Teste: ");
  Serial.println(lado == 'E' ? "ESQUERDA" : "DIREITA");
}

int numeroDoJson(const String& texto, const char* chave, int padrao) {

  String procura = "\"" + String(chave) + "\":";
  int i = texto.indexOf(procura);

  if (i < 0) return padrao;

  return texto.substring(i + procura.length()).toInt();
}

void aplicarConfigJson(const String& json) {

  int esq = numeroDoJson(json, "esq", angEsq);
  int centro = numeroDoJson(json, "centro", angCentro);
  int dir = numeroDoJson(json, "dir", angDir);
  int vel = numeroDoJson(json, "vel", velocidade);
  int aberto = numeroDoJson(json, "aberto", (int)abertoPadraoMs);

  if (esq < 0 || esq > 180 || centro < 0 || centro > 180 || dir < 0 || dir > 180 ||
      vel < 1 || vel > 100 || aberto < 100 || aberto > 5000) {
    Serial.println("Ajustes recusados: valor fora da faixa.");
    return;
  }

  angEsq = esq;
  angCentro = centro;
  angDir = dir;
  velocidade = vel;
  abertoPadraoMs = aberto;

  if (ladoAtual == 'C') alvo = anguloDoLado('C');
  else if (ladoAtual != 'M') alvo = anguloDoLado(ladoAtual);

  salvarAjustes();

  Serial.println("Ajustes atualizados pelo site.");

  enviarEstado();
}

// mover para um ângulo
void moverServo(int graus, int vel, unsigned long segurar) {

  if (travado) {
    Serial.println("Movimento ignorado: emergencia ativa. Libere no site.");
    return;
  }

  if (graus < 0 || graus > 180 || vel < 1 || vel > 100 || segurar > 30000) {
    Serial.println("Movimento recusado: valor fora da faixa.");
    return;
  }

  graus = dentroDosLimites(graus);

  nFila = 0;
  velAtiva = vel;
  ladoAtual = 'M';
  alvo = graus;
  fimSegurar = segurar > 0 ? millis() + segurar : 0;

  // sem tempo e no centro: lado centro
  if (segurar == 0 && graus == anguloDoLado('C')) ladoAtual = 'C';

  Serial.print("Servo -> ");
  Serial.print(graus);
  Serial.print(" graus, vel ");
  Serial.println(vel);
}

// para na hora
void pararServo() {
  nFila = 0;
  alvo = angulo;
  ladoAtual = 'M';
  fimSegurar = 0;
  Serial.println("PARADO na posicao atual.");
}

void aplicarServoConfig(const String& json) {

  int mn = numeroDoJson(json, "limMin", limMin);
  int mx = numeroDoJson(json, "limMax", limMax);
  int pmn = numeroDoJson(json, "pulsoMin", pulsoMin);
  int pmx = numeroDoJson(json, "pulsoMax", pulsoMax);
  int inv = numeroDoJson(json, "inv", inverter ? 1 : 0);

  if (mn < 0 || mx > 180 || mx - mn < 10 || pmn < 400 || pmn > 1500 || pmx < 1500 || pmx > 2600 || pmx - pmn < 500) {
    Serial.println("Config do servo recusada: valor fora da faixa.");
    return;
  }

  limMin = mn;
  limMax = mx;
  pulsoMin = pmn;
  pulsoMax = pmx;
  inverter = (inv != 0);
  ultimoDuty = -1;

  salvarServoConfig();
  Serial.println("Config do servo atualizada pelo site.");
  enviarEstado();
}

void mostrarStatus() {

  Serial.println();
  Serial.println("===== SEPARADOR =====");
  Serial.print("Lado: ");
  Serial.println(ladoAtual == 'C' ? "CENTRO" : (ladoAtual == 'E' ? "ESQUERDA" : "DIREITA"));
  Serial.print("Angulo: ");
  Serial.print(angulo, 1);
  Serial.print(" | Fila: ");
  Serial.println(nFila);
  Serial.print("Esquerda ");
  Serial.print(angEsq);
  Serial.print(" | Centro ");
  Serial.print(angCentro);
  Serial.print(" | Direita ");
  Serial.println(angDir);
  Serial.print("Velocidade ");
  Serial.print(velocidade);
  Serial.print(" | Aberto ");
  Serial.print((int)abertoPadraoMs);
  Serial.println(" ms");
  Serial.print("Emergencia: ");
  Serial.println(travado ? "ATIVA (libere no site)" : "liberada");
  Serial.print("Site: ");
  Serial.println(client.connected() ? "CONECTADO" : "DESCONECTADO");
  Serial.println("=====================");
}

void mostrarAjuda() {

  Serial.println();
  Serial.println("COMANDOS:");
  Serial.println("E  (abre para a esquerda)   D  (direita)   C  (centro)");
  Serial.println("ESQ=45  CENTRO=90  DIR=135  (angulos de 0 a 180)");
  Serial.println("VEL=60  (1 a 100)    ABERTO=900  (ms)");
  Serial.println("STATUS    PARAR    REINICIAR    AJUDA");
  Serial.println();
}

void salvarEMostrar(const char* nome, int valor) {
  salvarAjustes();
  Serial.print(nome);
  Serial.print(" = ");
  Serial.println(valor);
  if (ladoAtual == 'C') alvo = anguloDoLado('C');
  enviarEstado();
}

void processarComando(String comando) {

  comando.trim();
  comando.toUpperCase();

  if (comando.length() == 0) return;

  if (comando == "E" || comando == "D" || comando == "C") {
    testarLado(comando.charAt(0));
  }
  else if (comando.startsWith("ESQ=")) {
    int v = comando.substring(4).toInt();
    if (v >= 0 && v <= 180) { angEsq = v; salvarEMostrar("Esquerda", v); }
    else Serial.println("Use ESQ=45 (0 a 180)");
  }
  else if (comando.startsWith("CENTRO=")) {
    int v = comando.substring(7).toInt();
    if (v >= 0 && v <= 180) { angCentro = v; salvarEMostrar("Centro", v); }
    else Serial.println("Use CENTRO=90 (0 a 180)");
  }
  else if (comando.startsWith("DIR=")) {
    int v = comando.substring(4).toInt();
    if (v >= 0 && v <= 180) { angDir = v; salvarEMostrar("Direita", v); }
    else Serial.println("Use DIR=135 (0 a 180)");
  }
  else if (comando.startsWith("VEL=")) {
    int v = comando.substring(4).toInt();
    if (v >= 1 && v <= 100) { velocidade = v; salvarEMostrar("Velocidade", v); }
    else Serial.println("Use VEL=60 (1 a 100)");
  }
  else if (comando.startsWith("ABERTO=")) {
    int v = comando.substring(7).toInt();
    if (v >= 100 && v <= 5000) { abertoPadraoMs = v; salvarEMostrar("Aberto (ms)", v); }
    else Serial.println("Use ABERTO=900 (100 a 5000)");
  }
  else if (comando == "PARAR" || comando == "EMERGENCIA") {
    limparFilaEVoltar();
    Serial.println("PARADO: fila limpa, voltando ao centro.");
  }
  else if (comando == "STATUS") {
    mostrarStatus();
  }
  else if (comando == "REINICIAR") {
    Serial.println("Reiniciando o ESP32...");
    delay(200);
    ESP.restart();
  }
  else if (comando == "AJUDA" || comando == "HELP") {
    mostrarAjuda();
  }
  else {
    Serial.print("Comando desconhecido: ");
    Serial.println(comando);
    Serial.println("Digite AJUDA.");
  }
}


// site

void callbackMqtt(char* topic, byte* payload, unsigned int length) {

  String mensagem;
  for (unsigned int i = 0; i < length; i++) mensagem += (char)payload[i];
  mensagem.trim();

  String topico = String(topic);

  if (topico == topic_desviar) {

    // formato do pedido
    int p1 = mensagem.indexOf(';');
    int p2 = mensagem.indexOf(';', p1 + 1);

    if (p1 < 0) return;

    char lado = mensagem.charAt(0);
    unsigned long atraso = (p1 >= 0 && p2 > p1) ? mensagem.substring(p1 + 1, p2).toInt() : mensagem.substring(p1 + 1).toInt();
    unsigned long aberto = (p2 > p1) ? mensagem.substring(p2 + 1).toInt() : abertoPadraoMs;

    adicionarPedido(lado, atraso, aberto > 0 ? aberto : abertoPadraoMs);
  }
  else if (topico == topic_teste) {
    char lado = mensagem.length() ? mensagem.charAt(0) : 'C';
    if (lado == 'E' || lado == 'D' || lado == 'C') testarLado(lado);
  }
  else if (topico == topic_config) {
    aplicarConfigJson(mensagem);
  }
  else if (topico == topic_servo_ang) {
    moverServo(numeroDoJson(mensagem, "a", -1), numeroDoJson(mensagem, "v", velocidade), (unsigned long)max(0, numeroDoJson(mensagem, "h", 0)));
  }
  else if (topico == topic_servo_cfg) {
    aplicarServoConfig(mensagem);
  }
  else if (topico == topic_servo_parar) {
    pararServo();
  }
  else if (topico == topic_emergencia) {
    limparFilaEVoltar();
    enviarEstado();
    Serial.println(">>> EMERGENCIA: fila limpa e servo no centro. O site fica travado ate liberar.");
  }
  else if (topico == topic_liberar) {
    travado = false;
    memoria.putBool("trav", false);
    enviarEstado();
    Serial.println(">>> LIBERADO pelo site. Servo pronto.");
  }
  else if (topico == topic_reiniciar) {
    Serial.println("Reiniciando por comando do site...");
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
    Serial.println(">>> WiFi caiu! O servo continua funcionando. Tentando reconectar...");
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

  if (client.connect("ESP32_Separador", topic_status, 0, true, "offline")) {

    Serial.println("CONECTADO!");

    client.subscribe(topic_desviar);
    client.subscribe(topic_teste);
    client.subscribe(topic_config);
    client.subscribe(topic_emergencia);
    client.subscribe(topic_reiniciar);
    client.subscribe(topic_liberar);
    client.subscribe(topic_servo_ang);
    client.subscribe(topic_servo_cfg);
    client.subscribe(topic_servo_parar);

    client.publish(topic_status, "online", true);

    enviarEstado();
  }
  else {
    Serial.print("falha (codigo ");
    Serial.print(client.state());
    Serial.println("), tentando de novo...");
  }
}


// setup

void setup() {

  Serial.begin(115200);

  memoria.begin("separador", false);
  carregarAjustes();
  travado = false;
  memoria.putBool("trav", false);   // apaga trava de versões antigas

  configurarServo();

  angulo = anguloDoLado('C');
  alvo = anguloDoLado('C');
  escreverServo(angulo);

  Serial.println();
  Serial.println("==============================");
  Serial.println("FLOWPACK - SEPARADOR (SERVO)");
  Serial.println("==============================");
  Serial.print("Servo no GPIO ");
  Serial.println(SERVO_PIN);

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  ultimaTentativaWifi = millis();

  client.setServer(mqtt_server, 1883);
  client.setCallback(callbackMqtt);

  mostrarAjuda();
}


// loop

void loop() {

  unsigned long agora = millis();

  gerenciarWifi();
  gerenciarMqtt();
  if (client.connected()) client.loop();

  if (Serial.available()) {
    processarComando(Serial.readStringUntil('\n'));
  }

  processarFila(agora);

  // volta ao centro
  if (ladoAtual != 'C' && fimSegurar != 0 && agora >= fimSegurar) {
    ladoAtual = 'C';
    alvo = anguloDoLado('C');
  }

  // movimento suave
  if (agora - ultimoPasso >= 10) {

    ultimoPasso = agora;

    float passo = grausPorPasso();

    if (angulo < alvo) angulo = min(angulo + passo, alvo);
    else if (angulo > alvo) angulo = max(angulo - passo, alvo);

    escreverServo(angulo);
  }

  if (agora - ultimoEstado >= 1000) {
    ultimoEstado = agora;
    enviarEstado();
  }
}
