# Firmwares dos ESP32

Cada pasta tem um sketch do Arduino IDE (a pasta e o arquivo `.ino` têm o mesmo nome, como o Arduino exige).

| Pasta | Placa |
|---|---|
| `01_firmware_esteira` | Esteira (BTS7960 e 3 botões) |
| `02_firmware_selagem1_chapinha_e_rodinhas` | Selagem 1 (chapinha, SSR, GY-906 e rodinhas) |
| `03_firmware_selagem2_aquecimento` | Selagem 2, aquecimento |
| `04_firmware_selagem2_motor` | Selagem 2, motor |
| `05_firmware_dispenser` | Dispenser (2 BTS7960) |
| `06_firmware_separador_servo` | Separador (servo SG90) |
| `07_firmware_camera_OPCIONAL` | ESP32-CAM |

## Antes de gravar

**A senha do Wi-Fi não está no repositório**, porque ele é público. Em cada sketch, troque o texto `COLOQUE_A_SENHA_DO_WIFI` pela senha da rede `DarkCoders` e só então grave. Não envie essa alteração de volta ao GitHub.

1. Arduino IDE: abra o `.ino`, placa **ESP32 Dev Module**.
2. Troque a senha como acima.
3. Antes de gravar pelo USB, tire o fio de 5 V do pino VIN.
4. Upload.

Ligações de cada placa: [`docs/hardware/pinagens`](../docs/hardware/pinagens). Bibliotecas: [`docs/hardware/bibliotecas_arduino_ide.txt`](../docs/hardware/bibliotecas_arduino_ide.txt).

Ordem sugerida ao atualizar tudo: primeiro o site no Raspberry, depois a esteira por último (ela guarda a trava de emergência e conversa com o site).

## Emergência (Fase 4)

Depois de uma emergência (botão físico, botão do site ou Alexa), tudo fica travado até alguém clicar em **DESBLOQUEAR** no site. A trava vale **só no site**: a esteira e o servo apenas param (a esteira gira ao contrário por 1 s e o servo vai ao centro) e não guardam trava na placa, então ao liberar no site tudo volta a funcionar na hora. Se a emergência disparar sozinha, veja nos Logs ao Vivo a origem (botão da esteira, botão do painel, site ou Alexa).
