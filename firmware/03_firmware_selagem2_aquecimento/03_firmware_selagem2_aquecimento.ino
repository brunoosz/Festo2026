// GitHub: https://github.com/brunoosz | LinkedIn: https://www.linkedin.com/in/brunocamperlingo/
// SELAGEM 2 - AQUECIMENTO  (v3: barra quente 150 W + SSR-25DA + GY-906)
// Mesma logica e MESMOS topicos MQTT da versao anterior (o site continua funcionando sem mudar nada).
// Novidades: PID proprio (sem biblioteca PID), AUTOTUNE, calibracao da leitura e protecoes de seguranca.
#include <WiFi.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <Adafruit_MLX90614.h>
#include <Preferences.h>
#include <math.h>

// rede
const char* ssid = "DarkCoders";
const char* password = "COLOQUE_A_SENHA_DO_WIFI";
const char* mqtt_server = "192.168.4.1";

WiFiClient espClient;
PubSubClient client(espClient);
Preferences prefs;

// topicos que ja existiam
const char* topic_dados           = "selagem2/dados";
const char* topic_set_temperatura = "selagem2/set_temperatura";
const char* topic_ativar          = "selagem2/ativar";
const char* topic_emergencia      = "selagem2/emergencia";
const char* topic_status          = "selagem2/status_conexao";
const char* topic_reiniciar       = "selagem2/reiniciar";
// topicos novos (opcionais)
const char* topic_autotune        = "selagem2/autotune";            // "1" ou "150,100" (alvo,potencia%) inicia | "0" cancela
const char* topic_pid             = "selagem2/pid";                 // "kp,ki,kd" ou "padrao"
const char* topic_calibrar        = "selagem2/calibrar";            // "cal1:100" | "cal2:170" | "offset:5" | "ganho:1.1" | "zerar"
const char* topic_manual          = "selagem2/manual";              // "40" (potencia %) ou "off"
const char* topic_autotune_res    = "selagem2/autotune_resultado";

// sensor IR GY-906 (MLX90614) e SSR
const int PIN_SDA = 21;
const int PIN_SCL = 22;
Adafruit_MLX90614 sensor = Adafruit_MLX90614();
bool sensorEncontrado = false;
const int SSR_PIN = 25;

// >>>NUCLEO (sem Arduino: este mesmo trecho foi testado no computador com um modelo termico da barra quente)
#define AL_NENHUM 0
#define AL_SENSOR 1
#define AL_SOBRETEMP 2
#define AL_SEM_AQUEC 3
#define AL_SENSOR_QUENTE 4

const unsigned long JANELA_MS = 2000;            // o SSR-25DA liga so na passagem por zero: controle por TEMPO (nunca PWM rapido)
const double TEMP_MAX_ALVO = 250.0;              // maior alvo aceito
const double TEMP_AVISO = 260.0;                 // so avisa
const double TEMP_CORTE = 270.0;                 // corta tudo
const double SOBRE_ACIMA_ALVO = 25.0;            // passou do alvo por tanto, por mais de SOBRE_TEMPO_MS: corta
const unsigned long SOBRE_TEMPO_MS = 8000;
const unsigned long SEM_AQUEC_MS = 45000UL;      // potencia alta por 45 s e a temperatura quase nao sobe: corta
const double SEM_AQUEC_SUBIDA = 5.0;
const unsigned long SENSOR_TIMEOUT_MS = 3000;    // sem leitura valida por 3 s: corta
const double SENSOR_QUENTE_AVISO = 80.0;         // o corpo do GY-906 nao pode esquentar demais
const double SENSOR_QUENTE_CORTE = 95.0;

double Kp = 4.0, Ki = 0.04, Kd = 40.0;           // padrao conservador; use AUTOTUNE para achar os valores da sua barra
double calOffset = 0.0, calGanho = 1.0;
double temperaturaBruta = 0, temperaturaAtual = 0, temperaturaAmbiente = 0;
double setpoint = 0, potencia = 0, taxaSubida = 0;
bool habilitado = false;
int alarme = AL_NENHUM;
bool modoManual = false;
double potenciaManual = 0;
unsigned long inicioJanela = 0;
bool ganhosNovos = false;                        // o programa principal salva na memoria quando vira true

// ---- leitura filtrada ----
static double _tf = 0, _tPrev = 0, _dTdt = 0;
static bool _tfOk = false;
static unsigned long _tUlt = 0, _tValida = 0;
static int _saltos = 0;

void ctlEntrada(double bruta, unsigned long agora) {          // chamar so com leitura valida
  temperaturaBruta = bruta;
  double t = bruta * calGanho + calOffset;
  if (!_tfOk) { _tf = t; _tPrev = t; _tfOk = true; _dTdt = 0; }
  else {
    if (fabs(t - _tf) > 40.0 && _saltos < 3) { _saltos++; return; }   // ignora salto absurdo (ate 3 leituras)
    _saltos = 0;
    double dt = (agora - _tUlt) / 1000.0; if (dt < 0.05) dt = 0.05;
    _tf += 0.35 * (t - _tf);
    double d = (_tf - _tPrev) / dt; _dTdt += 0.25 * (d - _dTdt); _tPrev = _tf;
  }
  temperaturaAtual = _tf; taxaSubida = _dTdt; _tUlt = agora; _tValida = agora;
}
void ctlAmbiente(double amb) { temperaturaAmbiente = amb; }
bool ctlTemLeitura() { return _tfOk; }

// ---- calibracao (corrige a leitura do infravermelho na barra) ----
static double _calRaw1 = 0, _calReal1 = 0; static bool _calTem1 = false;
void ctlCalZerar() { calOffset = 0.0; calGanho = 1.0; _calTem1 = false; ganhosNovos = true; }
void ctlCal1(double real) { _calRaw1 = temperaturaBruta; _calReal1 = real; _calTem1 = true; calOffset = real - temperaturaBruta * calGanho; ganhosNovos = true; }
bool ctlCal2(double real) {
  if (!_calTem1 || fabs(temperaturaBruta - _calRaw1) < 15.0) return false;
  calGanho = (real - _calReal1) / (temperaturaBruta - _calRaw1);
  calOffset = _calReal1 - calGanho * _calRaw1; ganhosNovos = true; return true;
}

// ---- autotune (rele): descobre os ganhos do PID da propria barra ----
int atEstado = 0;                                // 0 parado | 1 rodando | 2 concluido | 3 abortado
double atSP = 0, atHi = 100, atLo = 0, atHist = 1.0, atKu = 0, atPu = 0;
const char* atMotivo = "";
static bool _atAlto = true;
static unsigned long _atInicio = 0, _atUltAlta = 0;
static int _atCiclos = 0, _atN = 0;
static double _atExtremo = 0, _atPico = 0, _atVale = 0, _atPer[6], _atAmp[6];

static void _atAbortar(const char* motivo) { atEstado = 3; atMotivo = motivo; habilitado = false; potencia = 0; }
static bool _atConsistente() {
  if (_atN >= 4) return true;
  if (_atN < 2) return false;
  double p1 = _atPer[_atN - 1], p0 = _atPer[_atN - 2], a1 = _atAmp[_atN - 1], a0 = _atAmp[_atN - 2];
  return fabs(p1 - p0) / p1 < 0.15 && fabs(a1 - a0) / a1 < 0.20;
}
static void _atFinalizar() {
  int n = _atN < 3 ? _atN : 3; double per = 0, amp = 0;
  for (int i = _atN - n; i < _atN; i++) { per += _atPer[i]; amp += _atAmp[i]; }
  per /= n; amp /= n; if (amp < 0.2) amp = 0.2;
  double d = (atHi - atLo) / 2.0; atKu = 4.0 * d / (3.14159265 * amp); atPu = per;
  double kp = atKu / 2.2, ti = 2.2 * per, td = per / 6.3;              // Tyreus-Luyben: bom para aquecedor lento (quase sem ultrapassar)
  double ki = kp / ti, kd = kp * td;
  if (kp < 0.5) kp = 0.5; if (kp > 40.0) kp = 40.0;
  if (ki < 0.001) ki = 0.001; if (ki > 2.0) ki = 2.0;
  if (kd < 0.0) kd = 0.0; if (kd > 800.0) kd = 800.0;
  Kp = kp; Ki = ki; Kd = kd; ganhosNovos = true; atEstado = 2; atMotivo = "ok";
}
void ctlAutotuneIniciar(double sp, double hi, unsigned long agora) {
  if (sp < 40.0) sp = 40.0; if (sp > TEMP_MAX_ALVO - 10.0) sp = TEMP_MAX_ALVO - 10.0;
  if (hi < 30.0) hi = 30.0; if (hi > 100.0) hi = 100.0;
  atSP = sp; atHi = hi; atLo = 0.0; atEstado = 1; atMotivo = ""; _atAlto = true; _atInicio = agora; _atUltAlta = 0;
  _atCiclos = 0; _atN = 0; _atExtremo = temperaturaAtual; _atPico = temperaturaAtual; _atVale = temperaturaAtual;
  setpoint = sp; alarme = AL_NENHUM; modoManual = false; habilitado = true; inicioJanela = agora;
}
void ctlAutotuneParar() { if (atEstado == 1) _atAbortar("cancelado"); }
static double _autotune(unsigned long agora) {
  double t = temperaturaAtual;
  if (t > atSP + 35.0) { _atAbortar("passou muito do alvo (reduza a potencia do teste)"); return 0; }
  if (agora - _atInicio > 2400000UL) { _atAbortar("demorou mais de 40 min"); return 0; }
  if (_atAlto) {
    if (t < _atExtremo) _atExtremo = t;
    if (t > atSP + atHist) { _atVale = _atExtremo; _atExtremo = t; _atAlto = false; return atLo; }
    return atHi;
  }
  if (t > _atExtremo) _atExtremo = t;
  if (t < atSP - atHist) {
    _atPico = _atExtremo; _atExtremo = t; _atAlto = true; _atCiclos++;
    if (_atUltAlta != 0 && _atCiclos >= 2) {
      if (_atN < 6) { _atPer[_atN] = (agora - _atUltAlta) / 1000.0; _atAmp[_atN] = (_atPico - _atVale) / 2.0; _atN++; }
      if (_atConsistente()) { _atFinalizar(); _atUltAlta = agora; return 0; }
    }
    _atUltAlta = agora; return atHi;
  }
  return atLo;
}

// ---- PID ----
static double _integral = 0, _ultSaida = 0;
static unsigned long _ultCalc = 0, _sobreIni = 0, _semAqIni = 0, _manualIni = 0, _manualDur = 120000UL;
static double _semAqT0 = 0;

static double _pid(unsigned long agora) {
  if (_ultCalc != 0 && (agora - _ultCalc) < 450) return _ultSaida;
  double dt = (agora - _ultCalc) / 1000.0; if (_ultCalc == 0 || dt > 5.0 || dt < 0.01) dt = 0.5;
  _ultCalc = agora;
  if (setpoint < 1.0) { _integral = 0; _ultSaida = 0; return 0; }
  double erro = setpoint - temperaturaAtual;
  double P = Kp * erro, D = -Kd * taxaSubida, u = P + _integral + D;
  if (fabs(erro) < 25.0) {                                           // so integra perto do alvo e sem saturar
    bool saturando = (u >= 100.0 && erro > 0) || (u <= 0.0 && erro < 0);
    if (!saturando) _integral += Ki * erro * dt;
  }
  if (_integral > 100.0) _integral = 100.0;
  if (_integral < 0.0) _integral = 0.0;
  u = P + _integral + D;
  if (u > 100.0) u = 100.0;
  if (u < 0.0) u = 0.0;
  _ultSaida = u; return u;
}
static void _disparar(int a) { alarme = a; habilitado = false; modoManual = false; potencia = 0; _integral = 0; _ultSaida = 0; if (atEstado == 1) { atEstado = 3; atMotivo = "protecao disparou"; } }

void ctlHabilitar(bool ligar, unsigned long agora) {
  if (ligar) { alarme = AL_NENHUM; _integral = 0; _ultCalc = 0; _ultSaida = 0; _sobreIni = 0; _semAqIni = 0; inicioJanela = agora; habilitado = true; if (atEstado == 3) atEstado = 0; }
  else { habilitado = false; modoManual = false; potencia = 0; _integral = 0; _ultSaida = 0; if (atEstado == 1) _atAbortar("desligado"); }
}
void ctlManual(double pct, unsigned long agora, unsigned long duracaoMs) {      // teste em malha aberta (potencia fixa); as protecoes continuam valendo
  if (pct < 0) pct = 0; if (pct > 100) pct = 100;
  modoManual = pct > 0; potenciaManual = pct; _manualIni = agora; _manualDur = duracaoMs; inicioJanela = agora;
}
void ctlGanhosPadrao() { Kp = 4.0; Ki = 0.04; Kd = 40.0; ganhosNovos = true; }

double ctlCalcular(unsigned long agora) {
  if (modoManual && (agora - _manualIni) > _manualDur) { modoManual = false; potencia = 0; }
  if (!habilitado && !modoManual) { potencia = 0; _integral = 0; _semAqIni = 0; _sobreIni = 0; return 0; }
  // protecoes: valem sempre (malha fechada, autotune e manual)
  if (!_tfOk || (agora - _tValida) > SENSOR_TIMEOUT_MS) { _disparar(AL_SENSOR); return 0; }
  if (temperaturaAmbiente >= SENSOR_QUENTE_CORTE) { _disparar(AL_SENSOR_QUENTE); return 0; }
  if (temperaturaAtual >= TEMP_CORTE) { _disparar(AL_SOBRETEMP); return 0; }
  if (!modoManual && atEstado != 1 && temperaturaAtual > setpoint + SOBRE_ACIMA_ALVO) {
    if (_sobreIni == 0) _sobreIni = agora; else if (agora - _sobreIni > SOBRE_TEMPO_MS) { _disparar(AL_SOBRETEMP); return 0; }
  } else _sobreIni = 0;
  double saida = modoManual ? potenciaManual : (atEstado == 1 ? _autotune(agora) : _pid(agora));
  if (!habilitado && !modoManual) { potencia = 0; return 0; }
  double alvo = atEstado == 1 ? atSP : setpoint;
  if (!modoManual && saida > 90.0 && temperaturaAtual < alvo - 10.0) {      // aquecendo a toda e a temperatura nao sobe: sensor mal posicionado ou resistencia/SSR com defeito
    if (_semAqIni == 0) { _semAqIni = agora; _semAqT0 = temperaturaAtual; }
    else if (agora - _semAqIni > SEM_AQUEC_MS) {
      if (temperaturaAtual - _semAqT0 < SEM_AQUEC_SUBIDA) { _disparar(AL_SEM_AQUEC); return 0; }
      _semAqIni = agora; _semAqT0 = temperaturaAtual;
    }
  } else _semAqIni = 0;
  potencia = saida; return saida;
}
bool ctlSSR(unsigned long agora) {                // true = ligar o SSR agora (janela de 2 s: tempo ligado = potencia %)
  if (!habilitado && !modoManual) return false;
  if (agora - inicioJanela >= JANELA_MS) inicioJanela = agora;
  unsigned long ligado = (unsigned long)(potencia * (double)JANELA_MS / 100.0 + 0.5);
  return (agora - inicioJanela) < ligado;
}
// <<<NUCLEO

// temporizadores
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
unsigned long testeSsrAte = 0;
int contadorAmbiente = 0;
int alarmeAnterior = AL_NENHUM;
int autotuneAnterior = 0;
bool ssrLigado = false;

// textos de estado
String nomeAlarme() {
  if (alarme == AL_SENSOR) return "erro_sensor";
  if (alarme == AL_SOBRETEMP) return "sobretemperatura";
  if (alarme == AL_SEM_AQUEC) return "sem_aquecimento";
  if (alarme == AL_SENSOR_QUENTE) return "sensor_quente";
  if (temperaturaAmbiente >= SENSOR_QUENTE_AVISO) return "sensor_quente_aviso";
  if (temperaturaAtual >= TEMP_AVISO) return "temperatura_alta";
  return "ok";
}
String nomeAutotune() {
  if (atEstado == 1) return "rodando";
  if (atEstado == 2) return "ok";
  if (atEstado == 3) return "abortado";
  return "parado";
}

// memoria (Preferences)
void salvarConfig() {
  prefs.begin("sel2aq", false);
  prefs.putDouble("kp", Kp); prefs.putDouble("ki", Ki); prefs.putDouble("kd", Kd);
  prefs.putDouble("off", calOffset); prefs.putDouble("gan", calGanho);
  prefs.end();
  ganhosNovos = false;
  Serial.println(">>> Configuracao (PID e calibracao) salva na memoria do ESP32.");
}
void carregarConfig() {
  prefs.begin("sel2aq", true);
  Kp = prefs.getDouble("kp", Kp); Ki = prefs.getDouble("ki", Ki); Kd = prefs.getDouble("kd", Kd);
  calOffset = prefs.getDouble("off", 0.0); calGanho = prefs.getDouble("gan", 1.0);
  prefs.end();
  if (calGanho < 0.2 || calGanho > 5.0) calGanho = 1.0;
}

// publicacoes
void publicarDados() {
  if (!client.connected()) return;
  String payload = "{";
  payload += "\"temperatura\":" + String(temperaturaAtual, 1) + ",";
  payload += "\"setpoint\":" + String(setpoint, 1) + ",";
  payload += "\"potencia\":" + String(potencia, 1) + ",";
  payload += "\"habilitado\":" + String(habilitado ? "true" : "false") + ",";
  payload += "\"seguranca\":\"" + nomeAlarme() + "\",";
  payload += "\"autotune\":\"" + nomeAutotune() + "\",";
  payload += "\"bruta\":" + String(temperaturaBruta, 1) + ",";
  payload += "\"ambiente\":" + String(temperaturaAmbiente, 1) + ",";
  payload += "\"kp\":" + String(Kp, 3) + ",\"ki\":" + String(Ki, 4) + ",\"kd\":" + String(Kd, 2) + ",";
  payload += "\"manual\":" + String(modoManual ? "true" : "false");
  payload += "}";
  client.publish(topic_dados, payload.c_str());
}
void publicarResultadoAutotune() {
  if (!client.connected()) return;
  String p = "{\"estado\":\"" + nomeAutotune() + "\",\"motivo\":\"" + String(atMotivo) + "\",\"ku\":" + String(atKu, 2) + ",\"pu\":" + String(atPu, 1);
  p += ",\"kp\":" + String(Kp, 3) + ",\"ki\":" + String(Ki, 4) + ",\"kd\":" + String(Kd, 2) + "}";
  client.publish(topic_autotune_res, p.c_str());
}

// acoes
void definirSetpoint(double valor, const String& origem) {
  if (valor < 0) valor = 0;
  if (valor > TEMP_MAX_ALVO) valor = TEMP_MAX_ALVO;
  setpoint = valor;
  Serial.print(">>> TEMPERATURA ALVO ("); Serial.print(origem); Serial.print("): ");
  Serial.print(setpoint); Serial.println(" C");
  publicarDados();
}
void definirHabilitado(bool ligar, const String& origem) {
  ctlHabilitar(ligar, millis());
  if (!ligar) digitalWrite(SSR_PIN, LOW);
  Serial.print(">>> AQUECIMENTO "); Serial.print(ligar ? "LIGADO" : "DESLIGADO");
  Serial.print(" ("); Serial.print(origem); Serial.println(")");
  publicarDados();
}
void acionarEmergencia(const String& origem) {
  ctlAutotuneParar();
  definirHabilitado(false, origem);
  testeSsrAte = 0;
  digitalWrite(SSR_PIN, LOW);
  Serial.print(">>> EMERGENCIA ("); Serial.print(origem); Serial.println("): aquecimento desligado");
}
void iniciarAutotune(double sp, double hi, const String& origem) {
  if (!sensorEncontrado || !ctlTemLeitura()) { Serial.println(">>> AUTOTUNE nao iniciou: sem leitura do sensor GY-906."); return; }
  ctlAutotuneIniciar(sp, hi, millis());
  Serial.print(">>> AUTOTUNE iniciado ("); Serial.print(origem); Serial.print("): alvo "); Serial.print(atSP, 0);
  Serial.print(" C, potencia do teste "); Serial.print(atHi, 0); Serial.println("%. Leva alguns minutos; nao mexa na barra.");
  publicarDados();
}
void aplicarPid(double kp, double ki, double kd, const String& origem) {
  if (kp < 0 || ki < 0 || kd < 0 || kp > 100 || ki > 5 || kd > 1000) { Serial.println(">>> PID fora do limite (kp 0-100, ki 0-5, kd 0-1000)."); return; }
  Kp = kp; Ki = ki; Kd = kd; ganhosNovos = true;
  Serial.print(">>> PID ("); Serial.print(origem); Serial.print("): Kp="); Serial.print(Kp, 3); Serial.print(" Ki="); Serial.print(Ki, 4); Serial.print(" Kd="); Serial.println(Kd, 2);
}
void tratarCalibracao(String c, const String& origem) {      // c ja em minusculas, ex.: cal1:100
  c.trim();
  int dp = c.indexOf(':');
  String chave = dp > 0 ? c.substring(0, dp) : c;
  double valor = dp > 0 ? c.substring(dp + 1).toDouble() : 0.0;
  if (chave == "zerar") { ctlCalZerar(); Serial.println(">>> CALIBRACAO zerada (offset 0, ganho 1)."); }
  else if (chave == "cal1") {
    if (!ctlTemLeitura()) { Serial.println(">>> CAL1: sem leitura do sensor."); return; }
    ctlCal1(valor); Serial.print(">>> CAL1: leitura bruta "); Serial.print(temperaturaBruta, 1); Serial.print(" = real "); Serial.print(valor, 1);
    Serial.print(" -> offset "); Serial.println(calOffset, 2);
  } else if (chave == "cal2") {
    if (ctlCal2(valor)) { Serial.print(">>> CAL2: ganho "); Serial.print(calGanho, 4); Serial.print(" offset "); Serial.println(calOffset, 2); }
    else Serial.println(">>> CAL2: faca antes o CAL1 e espere a temperatura mudar pelo menos 15 C.");
  } else if (chave == "offset") { calOffset = valor; ganhosNovos = true; Serial.print(">>> OFFSET = "); Serial.println(calOffset, 2); }
  else if (chave == "ganho") { if (valor >= 0.2 && valor <= 5.0) { calGanho = valor; ganhosNovos = true; Serial.print(">>> GANHO = "); Serial.println(calGanho, 4); } else Serial.println(">>> GANHO deve estar entre 0.2 e 5."); }
  else Serial.println(">>> Calibracao: use cal1:<real>, cal2:<real>, offset:<x>, ganho:<x> ou zerar.");
  (void)origem;
}

// leitura do sensor
void lerSensor() {
  if (!sensorEncontrado && sensor.begin()) {
    sensorEncontrado = true;
    Serial.println(">>> Sensor GY-906 encontrado.");
  }
  if (!sensorEncontrado) return;                 // sem sensor: a protecao corta o aquecimento em 3 s
  double leitura = sensor.readObjectTempC();
  if (isnan(leitura) || leitura < -70 || leitura > 380) return;
  ctlEntrada(leitura, millis());
  if (++contadorAmbiente >= 4) {
    contadorAmbiente = 0;
    double amb = sensor.readAmbientTempC();
    if (!isnan(amb)) ctlAmbiente(amb);
  }
}

// controle do SSR
void controlarAquecimento() {
  unsigned long agora = millis();
  ctlCalcular(agora);
  bool ligar = ctlSSR(agora);
  if (testeSsrAte != 0) { if (agora < testeSsrAte) ligar = true; else testeSsrAte = 0; }
  ssrLigado = ligar;
  digitalWrite(SSR_PIN, ligar ? HIGH : LOW);
  if (alarme != alarmeAnterior) {
    alarmeAnterior = alarme;
    if (alarme != AL_NENHUM) {
      Serial.print(">>> ALARME: "); Serial.print(nomeAlarme());
      Serial.println(" - aquecimento DESLIGADO por seguranca. Resolva a causa e envie LIGAR de novo.");
    }
    publicarDados();
  }
  if (atEstado != autotuneAnterior) {
    autotuneAnterior = atEstado;
    if (atEstado == 2) {
      Serial.println(">>> AUTOTUNE CONCLUIDO!");
      Serial.print("    Ku="); Serial.print(atKu, 2); Serial.print("  Pu="); Serial.print(atPu, 1); Serial.println(" s");
      Serial.print("    Kp="); Serial.print(Kp, 3); Serial.print("  Ki="); Serial.print(Ki, 4); Serial.print("  Kd="); Serial.println(Kd, 2);
      Serial.println("    Ganhos salvos; o aquecimento continua no alvo com o PID novo.");
    } else if (atEstado == 3) { Serial.print(">>> AUTOTUNE ABORTADO: "); Serial.println(atMotivo); }
    publicarResultadoAutotune(); publicarDados();
  }
  if (ganhosNovos) salvarConfig();
}

// monitor serial
void mostrarAjuda() {
  Serial.println();
  Serial.println("==================================================");
  Serial.println("COMANDOS - SELAGEM 2 AQUECIMENTO v3 (MONITOR SERIAL):");
  Serial.println("  LIGAR / DESLIGAR   - liga/desliga o aquecimento (ON/OFF tambem)");
  Serial.println("  TEMP <0-250>       - temperatura alvo, ex: TEMP 150");
  Serial.println("  EMERGENCIA         - desliga o aquecimento");
  Serial.println("  AUTOTUNE [alvo] [pot%] - descobre o PID da sua barra (ex: AUTOTUNE 150)  | AUTOTUNE PARAR");
  Serial.println("  PID kp ki kd       - define o PID na mao  | PID PADRAO");
  Serial.println("  CAL1 <real>        - leitura = temperatura real medida com outro termometro");
  Serial.println("  CAL2 <real>        - 2o ponto (outra temperatura, +15 C ou mais)  | CALZERAR");
  Serial.println("  OFFSET <x> / GANHO <x> - ajuste manual da leitura");
  Serial.println("  MANUAL <pot%>      - potencia fixa por 2 min (teste) | MANUAL OFF");
  Serial.println("  TESTE SSR          - liga o SSR por 3 s");
  Serial.println("  STATUS / REINICIAR / AJUDA");
  Serial.println("==================================================");
  Serial.println();
}
void mostrarStatus() {
  Serial.println();
  Serial.println("--------- STATUS SELAGEM 2 AQUECIMENTO v3 ---------");
  Serial.print("Sensor GY-906:  "); Serial.println(sensorEncontrado ? "OK" : "NAO ENCONTRADO");
  Serial.print("Temperatura:    "); Serial.print(temperaturaAtual, 1); Serial.print(" C  (bruta "); Serial.print(temperaturaBruta, 1); Serial.println(")");
  Serial.print("Corpo do sensor:"); Serial.print(temperaturaAmbiente, 1); Serial.println(" C");
  Serial.print("Alvo:           "); Serial.print(setpoint, 1); Serial.println(" C");
  Serial.print("Aquecimento:    "); Serial.println(habilitado ? "LIGADO" : "DESLIGADO");
  Serial.print("Potencia:       "); Serial.print(potencia, 1); Serial.print(" %   SSR: "); Serial.println(ssrLigado ? "LIGADO" : "desligado");
  Serial.print("PID:            Kp="); Serial.print(Kp, 3); Serial.print(" Ki="); Serial.print(Ki, 4); Serial.print(" Kd="); Serial.println(Kd, 2);
  Serial.print("Calibracao:     offset "); Serial.print(calOffset, 2); Serial.print("  ganho "); Serial.println(calGanho, 4);
  Serial.print("Autotune:       "); Serial.println(nomeAutotune());
  Serial.print("Seguranca:      "); Serial.println(nomeAlarme());
  Serial.print("WiFi:           "); Serial.println(WiFi.status() == WL_CONNECTED ? "CONECTADO" : "DESCONECTADO");
  Serial.print("Site (MQTT):    "); Serial.println(client.connected() ? "CONECTADO" : "DESCONECTADO");
  Serial.println("---------------------------------------------------");
  Serial.println();
}
void processarSerial() {
  if (!Serial.available()) return;
  String linha = Serial.readStringUntil('\n');
  linha.trim();
  if (linha.length() == 0) return;
  String cmd = linha;
  cmd.toUpperCase();
  String arg = "";
  int esp = linha.indexOf(' ');
  if (esp > 0) { arg = linha.substring(esp + 1); arg.trim(); }

  if (cmd == "LIGAR" || cmd == "ON") definirHabilitado(true, "SERIAL");
  else if (cmd == "DESLIGAR" || cmd == "OFF") definirHabilitado(false, "SERIAL");
  else if (cmd.startsWith("TEMP")) {
    if (arg.length() == 0) Serial.println(">>> Use: TEMP <0-250>, ex: TEMP 150");
    else definirSetpoint(arg.toDouble(), "SERIAL");
  } else if (cmd == "EMERGENCIA") acionarEmergencia("SERIAL");
  else if (cmd.startsWith("AUTOTUNE")) {
    String a = arg; a.toUpperCase();
    if (a == "PARAR" || a == "0") { ctlAutotuneParar(); Serial.println(">>> AUTOTUNE cancelado."); }
    else {
      double sp = setpoint >= 40 ? setpoint : 150, hi = 100;
      if (arg.length() > 0) { sp = arg.toDouble(); int e2 = arg.indexOf(' '); if (e2 > 0) hi = arg.substring(e2 + 1).toDouble(); }
      iniciarAutotune(sp, hi, "SERIAL");
    }
  } else if (cmd.startsWith("PID")) {
    String a = arg; a.toUpperCase();
    if (a == "PADRAO") { ctlGanhosPadrao(); Serial.println(">>> PID padrao restaurado."); }
    else {
      int e1 = arg.indexOf(' '); int e2 = e1 > 0 ? arg.indexOf(' ', e1 + 1) : -1;
      if (e1 > 0 && e2 > 0) aplicarPid(arg.substring(0, e1).toDouble(), arg.substring(e1 + 1, e2).toDouble(), arg.substring(e2 + 1).toDouble(), "SERIAL");
      else Serial.println(">>> Use: PID <kp> <ki> <kd>   ex: PID 8 0.15 40   |   PID PADRAO");
    }
  } else if (cmd.startsWith("CAL1")) tratarCalibracao("cal1:" + arg, "SERIAL");
  else if (cmd.startsWith("CAL2")) tratarCalibracao("cal2:" + arg, "SERIAL");
  else if (cmd == "CALZERAR") tratarCalibracao("zerar", "SERIAL");
  else if (cmd.startsWith("OFFSET")) tratarCalibracao("offset:" + arg, "SERIAL");
  else if (cmd.startsWith("GANHO")) tratarCalibracao("ganho:" + arg, "SERIAL");
  else if (cmd.startsWith("MANUAL")) {
    String a = arg; a.toUpperCase();
    if (a == "OFF" || a == "0" || arg.length() == 0) { ctlManual(0, millis(), 0); Serial.println(">>> MANUAL desligado."); }
    else { ctlManual(arg.toDouble(), millis(), 120000UL); Serial.print(">>> MANUAL "); Serial.print(potenciaManual, 0); Serial.println("% por 2 min (as protecoes continuam valendo)."); }
  } else if (cmd == "TESTE SSR") {
    testeSsrAte = millis() + 3000;
    Serial.println(">>> TESTE SSR: ligado por 3 s (o LED do SSR deve acender e a barra esquentar um pouco).");
  } else if (cmd == "REINICIAR") {
    Serial.println(">>> REINICIANDO...");
    digitalWrite(SSR_PIN, LOW);
    delay(200);
    ESP.restart();
  } else if (cmd == "STATUS") mostrarStatus();
  else if (cmd == "AJUDA" || cmd == "HELP") mostrarAjuda();
  else { Serial.print(">>> Comando desconhecido: \""); Serial.print(linha); Serial.println("\". Digite AJUDA."); }
}

// mensagens do site
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
  if (topico == topic_autotune) {
    if (mensagem == "0" || mensagem == "parar") { ctlAutotuneParar(); }
    else {
      double sp = setpoint >= 40 ? setpoint : 150, hi = 100;
      int v = mensagem.indexOf(',');
      if (v > 0) { sp = mensagem.substring(0, v).toDouble(); hi = mensagem.substring(v + 1).toDouble(); }
      else if (mensagem.length() > 1) sp = mensagem.toDouble();
      iniciarAutotune(sp, hi, "SITE");
    }
  }
  if (topico == topic_pid) {
    if (mensagem == "padrao") ctlGanhosPadrao();
    else {
      int v1 = mensagem.indexOf(','); int v2 = v1 > 0 ? mensagem.indexOf(',', v1 + 1) : -1;
      if (v1 > 0 && v2 > 0) aplicarPid(mensagem.substring(0, v1).toDouble(), mensagem.substring(v1 + 1, v2).toDouble(), mensagem.substring(v2 + 1).toDouble(), "SITE");
    }
  }
  if (topico == topic_calibrar) { String m = mensagem; m.toLowerCase(); tratarCalibracao(m, "SITE"); }
  if (topico == topic_manual) {
    if (mensagem == "off" || mensagem == "0") ctlManual(0, millis(), 0);
    else ctlManual(mensagem.toDouble(), millis(), 120000UL);
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
    Serial.println(">>> WiFi caiu! Continua controlando a temperatura sozinho. Tentando reconectar...");
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
    client.subscribe(topic_autotune);
    client.subscribe(topic_pid);
    client.subscribe(topic_calibrar);
    client.subscribe(topic_manual);
    client.publish(topic_status, "online", true);
    publicarDados();
  } else {
    Serial.print("Falha (codigo "); Serial.print(client.state());
    Serial.println("). Tentando de novo em breve...");
  }
}

// setup e loop
void setup() {
  Serial.begin(115200);
  Serial.println();
  Serial.println("===========================================");
  Serial.println("SELAGEM 2 - AQUECIMENTO v3 (barra quente 150 W)");
  Serial.println("===========================================");

  pinMode(SSR_PIN, OUTPUT);
  digitalWrite(SSR_PIN, LOW);
  carregarConfig();

  Wire.begin(PIN_SDA, PIN_SCL);
  if (sensor.begin()) {
    sensorEncontrado = true;
    Serial.println(">>> Sensor GY-906 encontrado.");
  } else {
    Serial.println(">>> AVISO: sensor GY-906 nao encontrado (confira VIN, GND, SDA 21, SCL 22). O aquecimento nao liga sem ele.");
  }
  Serial.print(">>> PID salvo: Kp="); Serial.print(Kp, 3); Serial.print(" Ki="); Serial.print(Ki, 4); Serial.print(" Kd="); Serial.println(Kd, 2);
  Serial.println(">>> Primeira vez com a barra nova? Faca a CALIBRACAO e o AUTOTUNE (veja o guia) antes de usar com plastico.");
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
    if (atEstado == 1) Serial.print(" [AUTOTUNE]");
    if (modoManual) Serial.print(" [MANUAL]");
    Serial.print(" | Aviso: "); Serial.print(nomeAlarme());
    Serial.print(" | Site: "); Serial.println(client.connected() ? "OK" : "OFF");
  }
}
