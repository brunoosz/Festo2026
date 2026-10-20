#include <WebServer.h>
#include <WiFi.h>
#include <esp32cam.h>
#include "esp_camera.h"

// ============================================================
// FLOWPACK - ESP32-CAM (AI Thinker) - VERSAO 2 (OPCIONAL)
//
// Mesmo endereco de antes (/cam-lo.jpg), mas:
//  - resolucao fixa (nao troca a cada foto: mais rapido)
//  - sempre entrega uma foto FRESCA (descarta a foto velha)
//  - TRAVA a exposicao e o balanco de branco depois de aquecer:
//    a luz da imagem deixa de "respirar" e some o falso disparo
//  - reconecta sozinha se o Wi-Fi cair
//
// Enderecos:
//   /cam-lo.jpg   foto 320x240 (a que o site usa)
//   /travar       trava a exposicao agora (use com a esteira VAZIA e a luz do jeito final)
//   /auto         volta para exposicao automatica
//   /status       mostra se esta travada, Wi-Fi e tempo ligada
// ============================================================

const char* WIFI_SSID = "DarkCoders";
const char* WIFI_PASS = "COLOQUE_A_SENHA_DO_WIFI";

WebServer server(80);

static auto resolucao = esp32cam::Resolution::find(320, 240);

bool exposicaoTravada = false;
unsigned long ultimoWifi = 0;
unsigned long inicioMs = 0;

void travarExposicao() {

  sensor_t* s = esp_camera_sensor_get();
  if (!s) return;

  // deixa a camera ler a luz atual e congela esses valores
  int exposicao = s->status.aec_value;
  int ganho = s->status.agc_gain;

  s->set_exposure_ctrl(s, 0);
  s->set_aec_value(s, exposicao);
  s->set_gain_ctrl(s, 0);
  s->set_agc_gain(s, ganho);
  s->set_whitebal(s, 0);
  s->set_awb_gain(s, 0);

  exposicaoTravada = true;

  Serial.print("Exposicao TRAVADA (exposicao ");
  Serial.print(exposicao);
  Serial.print(", ganho ");
  Serial.print(ganho);
  Serial.println(")");
}

void exposicaoAutomatica() {

  sensor_t* s = esp_camera_sensor_get();
  if (!s) return;

  s->set_exposure_ctrl(s, 1);
  s->set_gain_ctrl(s, 1);
  s->set_whitebal(s, 1);
  s->set_awb_gain(s, 1);

  exposicaoTravada = false;

  Serial.println("Exposicao AUTOMATICA");
}

void servirFoto() {

  // descarta uma foto (a camera guarda a anterior) e entrega a mais nova
  auto velha = esp32cam::capture();
  velha.reset();

  auto quadro = esp32cam::capture();

  if (quadro == nullptr) {
    Serial.println("CAPTURA FALHOU");
    server.send(503, "text/plain", "sem foto");
    return;
  }

  server.setContentLength(quadro->size());
  server.send(200, "image/jpeg");

  WiFiClient cliente = server.client();
  quadro->writeTo(cliente);
}

void paginaStatus() {

  String t = "exposicao: ";
  t += exposicaoTravada ? "TRAVADA" : "automatica";
  t += "\nwifi: ";
  t += WiFi.status() == WL_CONNECTED ? "conectado" : "desconectado";
  t += "\nsinal: ";
  t += String(WiFi.RSSI());
  t += " dBm\nligada ha: ";
  t += String((millis() - inicioMs) / 1000);
  t += " s\n";

  server.send(200, "text/plain", t);
}

void conectarWifi() {

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  unsigned long inicio = millis();

  while (WiFi.status() != WL_CONNECTED) {

    delay(500);
    Serial.print(".");

    if (millis() - inicio > 30000) {
      Serial.println("\nSem Wi-Fi em 30s. Reiniciando...");
      delay(300);
      ESP.restart();
    }
  }

  Serial.println();
  Serial.print("Wi-Fi conectado. IP: ");
  Serial.println(WiFi.localIP());
}

void setup() {

  Serial.begin(115200);
  delay(500);
  inicioMs = millis();

  Serial.println();
  Serial.println(">>> CAMERA V2 <<<");

  {
    using namespace esp32cam;

    Config cfg;
    cfg.setPins(pins::AiThinker);
    cfg.setResolution(resolucao);
    cfg.setBufferCount(2);
    cfg.setJpeg(80);

    bool ok = Camera.begin(cfg);
    Serial.println(ok ? "CAMERA OK" : "CAMERA FALHOU");

    if (!ok) {
      delay(3000);
      ESP.restart();
    }
  }

  // aquece 2 segundos com exposicao automatica e depois trava
  unsigned long aquecer = millis();
  while (millis() - aquecer < 2000) {
    auto f = esp32cam::capture();
    f.reset();
    delay(100);
  }

  travarExposicao();

  conectarWifi();

  server.on("/cam-lo.jpg", servirFoto);
  server.on("/cam-mid.jpg", servirFoto);
  server.on("/cam-hi.jpg", servirFoto);

  server.on("/travar", []() {
    travarExposicao();
    server.send(200, "text/plain", "exposicao travada");
  });

  server.on("/auto", []() {
    exposicaoAutomatica();
    server.send(200, "text/plain", "exposicao automatica");
  });

  server.on("/status", paginaStatus);

  server.begin();

  Serial.println("Pronta: /cam-lo.jpg  /travar  /auto  /status");
}

void loop() {

  server.handleClient();

  // se o Wi-Fi cair, tenta voltar sem reiniciar a camera
  if (WiFi.status() != WL_CONNECTED && millis() - ultimoWifi > 10000) {
    ultimoWifi = millis();
    Serial.println("Wi-Fi caiu, reconectando...");
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASS);
  }
}
