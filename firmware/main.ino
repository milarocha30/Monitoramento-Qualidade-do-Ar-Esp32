#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Wire.h>
#include "Adafruit_SGP30.h"

const char* ssid = "iPhone de Mila";
const char* password = "bomdia23";

const char* writeAPIKey = "NTU3RFPU4516AJ7Z";
const char* serverName = "https://api.thingspeak.com/update";
const unsigned long INTERVALO_ENVIO = 20000;
unsigned long ultimoEnvio = 0;

#define MQ135_PIN 34
const int SDA_PIN = 21;
const int SCL_PIN = 22;

const int LED_VERDE = 25;
const int LED_AMARELO = 27;
const int LED_VERMELHO = 26;

const float DIVISOR = 1.0;
const int AMOSTRAS = 20;
const unsigned long CALIBRACAO_S = 30;
const int PRINT_A_CADA = 2;

const int NIVEL_AMARELO = 2;
const int NIVEL_VERMELHO = 3;

const float LIM_MQ135[4] = { 0.05, 0.10, 0.20, 0.35 };
const float LIM_TVOC[4] = { 65, 220, 660, 2200 };
const float LIM_ECO2[4] = { 600, 1000, 1500, 2500 };

const char* NOMES[] = { "EXCELENTE", "BOA", "MODERADA", "RUIM", "MUITO RUIM" };

Adafruit_SGP30 sgp;
float baseline = 0;
float suavizado = 0;
unsigned long ultimoCiclo = 0;
int ciclo = 0;
int geralAnterior = -1;

void conectarWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.println("\nConectando ao Wi-Fi...");
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < 20000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("Wi-Fi conectado com sucesso!");
  } else {
    Serial.println("ERRO: Nao foi possivel conectar ao Wi-Fi.");
  }
}

void enviarThingSpeak(float delta, int geral) {
  if (WiFi.status() != WL_CONNECTED) conectarWiFi();
  if (WiFi.status() != WL_CONNECTED) return;

  int alerta = (geral >= NIVEL_AMARELO) ? 1 : 0;
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;

  if (!http.begin(client, serverName)) return;

  http.setTimeout(8000);
  http.addHeader("Content-Type", "application/x-www-form-urlencoded");

  String dados = "api_key=" + String(writeAPIKey);
  dados += "&field1=" + String(sgp.eCO2);
  dados += "&field2=" + String(sgp.TVOC);
  dados += "&field3=" + String(delta, 3);
  dados += "&field4=" + String(alerta);
  dados += "&field5=" + String(geral);

  int codigoHTTP = http.POST(dados);
  String resposta = http.getString();
  resposta.trim();

  if (codigoHTTP == 200 && resposta.toInt() > 0) {
    Serial.println("DADOS ENVIADOS COM SUCESSO!");
  } else {
    Serial.println("ERRO AO ENVIAR DADOS!");
  }
  http.end();
}

float lerTensao() {
  long soma = 0;
  for (int i = 0; i < AMOSTRAS; i++) {
    soma += analogReadMilliVolts(MQ135_PIN);
    delay(5);
  }
  return (soma / (float)AMOSTRAS) / 1000.0 * DIVISOR;
}

int nivel(float valor, const float* lim) {
  for (int i = 0; i < 4; i++) {
    if (valor < lim[i]) return i;
  }
  return 4;
}

void atualizarLeds(int geral) {
  digitalWrite(LED_VERDE, geral < NIVEL_AMARELO ? HIGH : LOW);
  digitalWrite(LED_AMARELO, (geral >= NIVEL_AMARELO && geral < NIVEL_VERMELHO) ? HIGH : LOW);
  digitalWrite(LED_VERMELHO, geral >= NIVEL_VERMELHO ? HIGH : LOW);
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  pinMode(LED_VERDE, OUTPUT);
  pinMode(LED_AMARELO, OUTPUT);
  pinMode(LED_VERMELHO, OUTPUT);
  digitalWrite(LED_VERDE, LOW);
  digitalWrite(LED_AMARELO, LOW);
  digitalWrite(LED_VERMELHO, LOW);

  analogReadResolution(12);
  analogSetPinAttenuation(MQ135_PIN, ADC_11db);
  Wire.begin(SDA_PIN, SCL_PIN);

  if (!sgp.begin()) {
    while (true) {
      digitalWrite(LED_VERMELHO, !digitalRead(LED_VERMELHO));
      delay(200);
    }
  }

  float soma = 0;
  int n = 0;
  for (int s = CALIBRACAO_S; s > 0; s--) {
    int fase = s % 3;
    digitalWrite(LED_VERDE, fase == 0 ? HIGH : LOW);
    digitalWrite(LED_AMARELO, fase == 1 ? HIGH : LOW);
    digitalWrite(LED_VERMELHO, fase == 2 ? HIGH : LOW);
    sgp.IAQmeasure();
    soma += lerTensao();
    n++;
    delay(900);
  }
  baseline = soma / n;
  suavizado = baseline;

  conectarWiFi();
  atualizarLeds(0);
  ultimoEnvio = millis();
}

void loop() {
  if (millis() - ultimoCiclo < 1000) return;
  ultimoCiclo = millis();
  ciclo++;

  if (!sgp.IAQmeasure()) return;

  float v = lerTensao();
  suavizado = 0.3 * v + 0.7 * suavizado;
  float delta = suavizado - baseline;
  if (delta < 0) delta = 0;

  int nT = nivel(sgp.TVOC, LIM_TVOC);
  int nC = nivel(sgp.eCO2, LIM_ECO2);
  int nM = nivel(delta, LIM_MQ135);
  int geral = max(nT, max(nC, nM));

  atualizarLeds(geral);

  if (millis() - ultimoEnvio >= INTERVALO_ENVIO) {
    ultimoEnvio = millis();
    enviarThingSpeak(delta, geral);
  }
}
