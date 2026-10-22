// GitHub: https://github.com/brunoosz | LinkedIn: https://www.linkedin.com/in/brunocamperlingo/
#include <WiFi.h>
#include <PubSubClient.h>
#include <SPI.h>
#include <MFRC522.h>

// painel NFC

const char* ssid = "DarkCoders";
const char* password = "COLOQUE_A_SENHA_DO_WIFI";
const char* mqtt_server = "192.168.4.1";

WiFiClient espClient;
PubSubClient client(espClient);

const char* topic_leitura   = "nfc/leitura";               // UID
const char* topic_resultado = "nfc/resultado";             // resposta do site
const char* topic_status    = "nfc/status";                // online
const char* topic_emerg     = "esteira/estado_emergencia"; // estado da emergência
const char* topic_reiniciar = "nfc/reiniciar";
const char* topic_painel_botao = "painel/botao";           // botões
const char* topic_painel_resultado = "painel/resultado";   // resultado

// pinagem
#define RC522_SS   5         // chip select
#define RC522_SCK  18
#define RC522_MISO 19
#define RC522_MOSI 23
#define RC522_RST  4
#define PIN_BUZZER 25        // buzzer
#define PIN_LED_VERDE 26     // LED dos botões
#define PIN_LED_VERM 27      // LED da emergência
#define BTN_EMERGENCIA 32    // botões
#define BTN_MAIS 33
#define BTN_MENOS 14

// tipo de buzzer
#define BUZZER_PASSIVO false
const int TOM_HZ = 2700;

MFRC522 leitor(RC522_SS, RC522_RST);
bool leitorOK = false;

unsigned long ultimaTentativaWifi = 0;
bool wifiEstavaConectado = false;
unsigned long ultimaTentativaMqtt = 0;
unsigned long ultimoStatus = 0;

// buzzer
struct Passo { int ligadoMs; int desligadoMs; };
const int MAX_PASSOS = 8;
Passo seq[MAX_PASSOS];
int nPassos = 0, passoAtual = 0;
bool buzzerLigado = false;
unsigned long inicioPasso = 0;

void buzzerEscrever(bool ligar) {
  buzzerLigado = ligar;
#if BUZZER_PASSIVO
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWriteTone(PIN_BUZZER, ligar ? TOM_HZ : 0);
#else
  ledcWriteTone(0, ligar ? TOM_HZ : 0);
#endif
#else
  digitalWrite(PIN_BUZZER, ligar ? HIGH : LOW);
#endif
}

void tocar(const Passo* passos, int n) {
  nPassos = min(n, MAX_PASSOS);
  for (int i = 0; i < nPassos; i++) seq[i] = passos[i];
  passoAtual = 0;
  inicioPasso = millis();
  buzzerEscrever(nPassos > 0);
}

void bipAceito()      { Passo p[] = { {1000, 0} }; tocar(p, 1); }
void bipNegado()      { Passo p[] = { {120, 120}, {120, 120}, {120, 120} }; tocar(p, 3); }
void bipSemResposta() { Passo p[] = { {120, 150}, {120, 150} }; tocar(p, 2); }
void bipBloqueado()   { Passo p[] = { {80, 80}, {80, 80}, {80, 80}, {80, 80} }; tocar(p, 4); }
void bipCadastrado()  { Passo p[] = { {250, 150}, {250, 150} }; tocar(p, 2); }
void bipLeitura()     { Passo p[] = { {40, 0} }; tocar(p, 1); }       // leitura
void bipSemPermissao() { Passo p[] = { {200, 0} }; tocar(p, 1); }     // botão sem cartão

void atualizarBuzzer() {
  if (nPassos == 0) return;
  unsigned long dt = millis() - inicioPasso;
  Passo& p = seq[passoAtual];
  if (buzzerLigado && dt >= (unsigned long)p.ligadoMs) {
    buzzerEscrever(false);
    inicioPasso = millis();
    if (p.desligadoMs == 0) { passoAtual++; }
  }
  else if (!buzzerLigado && dt >= (unsigned long)p.desligadoMs) {
    passoAtual++;
    inicioPasso = millis();
    if (passoAtual < nPassos) buzzerEscrever(true);
  }
  if (passoAtual >= nPassos) { nPassos = 0; buzzerEscrever(false); }
}

// janela dos botões
const unsigned long JANELA_MS = 30000;      // tempo dos botões
unsigned long janelaAte = 0;
bool janelaAberta() { return millis() < janelaAte; }

// leitura
String ultimoUid = "";
unsigned long ultimaLeituraMs = 0;
String uidAguardando = "";
unsigned long aguardandoDesde = 0;
const unsigned long ESPERA_RESPOSTA_MS = 2500;

String uidParaTexto(uint8_t* uid, uint8_t tam) {
  String s = "";
  for (uint8_t i = 0; i < tam; i++) {
    if (uid[i] < 0x10) s += "0";
    s += String(uid[i], HEX);
  }
  s.toUpperCase();
  return s;
}

void lerCartao() {
  if (!leitorOK) return;
  if (uidAguardando.length() > 0) return;                 // esperando o site

  // cartão novo
  if (!leitor.PICC_IsNewCardPresent()) return;
  if (!leitor.PICC_ReadCardSerial()) return;

  uint8_t uid[10]; uint8_t tam = leitor.uid.size;
  for (uint8_t k = 0; k < tam && k < 10; k++) uid[k] = leitor.uid.uidByte[k];
  leitor.PICC_HaltA();
  leitor.PCD_StopCrypto1();

  String texto = uidParaTexto(uid, tam);
  unsigned long agora = millis();

  // cartão repetido
  if (texto == ultimoUid && agora - ultimaLeituraMs < 2000) { ultimaLeituraMs = agora; return; }
  ultimoUid = texto; ultimaLeituraMs = agora;

  Serial.print(">>> CARTAO LIDO: ");
  Serial.println(texto);
  bipLeitura();

  if (!client.connected()) {
    Serial.println(">>> Sem conexao com o site: nada foi liberado.");
    bipSemResposta();
    return;
  }

  client.publish(topic_leitura, texto.c_str());
  uidAguardando = texto;
  aguardandoDesde = agora;
}

void tratarResultado(const String& r) {
  uidAguardando = "";
  Serial.print(">>> Resposta do site: ");
  Serial.println(r);
  if (r == "liberado" || r == "ok") { bipAceito(); janelaAte = millis() + JANELA_MS; }
  else if (r == "cadastrado")        bipCadastrado();
  else if (r == "bloqueado")         bipBloqueado();
  else                               bipNegado();
}

void verificarTimeout() {
  if (uidAguardando.length() > 0 && millis() - aguardandoDesde > ESPERA_RESPOSTA_MS) {
    Serial.println(">>> O site nao respondeu a tempo: nada foi liberado.");
    uidAguardando = "";
    bipSemResposta();
  }
}

// botões do painel

struct Botao {
  int pino;
  const char* nome;
  unsigned long msMinimo;
  bool armado;
  bool baixo;
  unsigned long inicio;
  bool disparado;
  bool alto;
  unsigned long altoDesde;
};

Botao botoes[3] = {
  { BTN_EMERGENCIA, "emergencia", 120, false, false, 0, false, false, 0 },
  { BTN_MAIS,       "mais",        50, false, false, 0, false, false, 0 },
  { BTN_MENOS,      "menos",       50, false, false, 0, false, false, 0 }
};

const unsigned long BOTOES_APOS_LIGAR_MS = 3000;
const unsigned long BOTAO_SOLTO_PARA_ARMAR_MS = 1000;
unsigned long ultimaAmostraBotoes = 0;
bool avisouBotaoPreso = false;

void botaoApertado(const char* nome, unsigned long duracaoMs) {

  Serial.print(">>> BOTAO: ");
  Serial.print(nome);
  Serial.print(" (apertado ha ");
  Serial.print(duracaoMs);
  Serial.println(" ms)");

  if (String(nome) == "emergencia") {
    if (client.connected()) { bipLeitura(); client.publish(topic_painel_botao, "emergencia"); }
    else bipSemResposta();
    return;
  }

  if (!janelaAberta()) {
    Serial.println(">>> BOTAO bloqueado: passe o cartao de Dono ou Adm primeiro.");
    bipSemPermissao();
    return;
  }

  if (!client.connected()) { bipSemResposta(); return; }

  bipLeitura();
  client.publish(topic_painel_botao, nome);
}

void lerBotoes() {

  unsigned long agora = millis();

  if (agora - ultimaAmostraBotoes < 5) return;
  ultimaAmostraBotoes = agora;

  bool aposLigar = agora > BOTOES_APOS_LIGAR_MS;

  for (int i = 0; i < 3; i++) {

    Botao& b = botoes[i];

    if (digitalRead(b.pino) == HIGH) {
      if (!b.alto) { b.alto = true; b.altoDesde = agora; }
      b.baixo = false;
      b.disparado = false;
      if (!b.armado && agora - b.altoDesde >= BOTAO_SOLTO_PARA_ARMAR_MS) b.armado = true;
      continue;
    }

    b.alto = false;

    if (!b.baixo) { b.baixo = true; b.inicio = agora; }

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

// site
bool emergenciaAtiva = false;

void callbackMqtt(char* topic, byte* payload, unsigned int length) {
  String m;
  for (unsigned int i = 0; i < length; i++) m += (char)payload[i];
  m.trim();
  String t = String(topic);
  if (t == topic_resultado) tratarResultado(m);
  else if (t == topic_painel_resultado) {
    if (m == "ok") janelaAte = millis() + JANELA_MS;                        // renova o tempo
    else { janelaAte = 0; bipSemPermissao(); }                              // sem permissão
  }
  else if (t == topic_emerg) { emergenciaAtiva = (m == "ativa"); if (emergenciaAtiva) janelaAte = 0; }
  else if (t == topic_reiniciar) { Serial.println("Reiniciando..."); delay(200); ESP.restart(); }
}

void gerenciarWifi() {
  bool ok = (WiFi.status() == WL_CONNECTED);
  if (ok && !wifiEstavaConectado) { Serial.print(">>> WiFi conectado! IP: "); Serial.println(WiFi.localIP()); wifiEstavaConectado = true; return; }
  if (!ok && wifiEstavaConectado) { Serial.println(">>> WiFi caiu. Tentando reconectar..."); wifiEstavaConectado = false; }
  if (ok) return;
  if (millis() - ultimaTentativaWifi >= 10000) { ultimaTentativaWifi = millis(); WiFi.mode(WIFI_STA); WiFi.begin(ssid, password); }
}

void gerenciarMqtt() {
  if (WiFi.status() != WL_CONNECTED || client.connected()) return;
  if (millis() - ultimaTentativaMqtt < 5000) return;
  ultimaTentativaMqtt = millis();
  Serial.print(">>> Conectando ao site... ");
  if (client.connect("ESP32_NFC", topic_status, 0, true, "offline")) {
    Serial.println("CONECTADO!");
    client.subscribe(topic_resultado);
    client.subscribe(topic_painel_resultado);
    client.subscribe(topic_emerg);
    client.subscribe(topic_reiniciar);
    client.publish(topic_status, "online", true);
  }
  else { Serial.print("falha (codigo "); Serial.print(client.state()); Serial.println(")"); }
}

// serial
void processarComando(String c) {
  c.trim(); c.toUpperCase();
  if (c == "STATUS") {
    Serial.println();
    Serial.print("Leitor RC522: "); Serial.println(leitorOK ? "OK" : "NAO ENCONTRADO");
    Serial.print("Site: "); Serial.println(client.connected() ? "CONECTADO" : "DESCONECTADO");
    Serial.print("Emergencia: "); Serial.println(emergenciaAtiva ? "ATIVA" : "liberada");
    Serial.print("Botoes MAIS/MENOS: "); Serial.println(janelaAberta() ? "LIBERADOS (cartao passado)" : "bloqueados (passe o cartao)");
    Serial.print("Botoes (1 = solto): emergencia "); Serial.print(digitalRead(BTN_EMERGENCIA)); Serial.print(" | mais "); Serial.print(digitalRead(BTN_MAIS)); Serial.print(" | menos "); Serial.println(digitalRead(BTN_MENOS));
    Serial.print("Ultimo cartao: "); Serial.println(ultimoUid.length() ? ultimoUid : String("nenhum"));
  }
  else if (c == "BIP") { bipAceito(); }
  else if (c == "UID") { Serial.println(ultimoUid.length() ? ultimoUid : String("nenhum")); }
  else if (c == "AJUDA") { Serial.println("STATUS  BIP  UID  AJUDA"); }
  else if (c.length()) { Serial.println("Comando desconhecido. Digite AJUDA."); }
}

// setup e loop
void setup() {
  Serial.begin(115200);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED_VERDE, OUTPUT);
  pinMode(PIN_LED_VERM, OUTPUT);
  pinMode(BTN_EMERGENCIA, INPUT_PULLUP);
  pinMode(BTN_MAIS, INPUT_PULLUP);
  pinMode(BTN_MENOS, INPUT_PULLUP);
#if BUZZER_PASSIVO
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(PIN_BUZZER, TOM_HZ, 8);
#else
  ledcSetup(0, TOM_HZ, 8);
  ledcAttachPin(PIN_BUZZER, 0);
#endif
#endif
  buzzerEscrever(false);

  Serial.println();
  Serial.println("==============================");
  Serial.println("FLOWPACK - LEITOR NFC");
  Serial.println("==============================");

  SPI.begin(RC522_SCK, RC522_MISO, RC522_MOSI, RC522_SS);
  leitor.PCD_Init();
  byte versao = leitor.PCD_ReadRegister(MFRC522::VersionReg);
  if (versao != 0x00 && versao != 0xFF) {
    leitorOK = true;
    Serial.print("RC522 OK (versao 0x");
    Serial.print(String(versao, HEX));
    Serial.println("). Aproxime um cartao.");
  }
  else {
    Serial.println("ERRO: RC522 NAO ENCONTRADO. Confira os 7 fios: SDA 5, SCK 18, MOSI 23, MISO 19, RST 4, 3.3V e GND (NUNCA 5V).");
    bipSemResposta();
  }

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

  if (Serial.available()) processarComando(Serial.readStringUntil('\n'));

  lerCartao();
  lerBotoes();
  verificarTimeout();
  atualizarBuzzer();

  digitalWrite(PIN_LED_VERM, emergenciaAtiva ? HIGH : LOW);
  digitalWrite(PIN_LED_VERDE, janelaAberta() ? HIGH : LOW);

  if (millis() - ultimoStatus >= 5000) {
    ultimoStatus = millis();
    if (client.connected()) client.publish(topic_status, "online", true);
  }
}
