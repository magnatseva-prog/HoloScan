# HoloScan

Android-приложение в духе HoloDex: сканируешь карточку Pokémon TCG и сразу видишь цену. Интерфейс на 7 языках (по умолчанию English), карты на 14 языках TCGdex.

## Как устроено

- **Веб-приложение в обёртке Capacitor.** Код в `www/`, без сборщика: обычные ES-модули.
- **База карт и цен из [TCGdex](https://tcgdex.dev).** Цены TCGplayer (USD) и Cardmarket (EUR). Списки карт кэшируются в IndexedDB на неделю.
- **Распознавание работает офлайн** (`www/js/recognize.js`):
  1. `findCard` находит карту на кадре и выравнивает наклон.
  2. **Нейросеть** MobileNetV2 (`www/js/embed.js`, ONNX Runtime) превращает фото в вектор. Отдельно считается вектор всей карты и вектор рисунка. Векторы устойчивы к бликам, свету и протекторам. Затем фото сравнивается со всеми ~25 тыс. карт из `www/data/emb.bin`.
  3. tesseract.js читает название, номер вида `039/198` и HP. Названия ищутся на всех языках сразу (`www/data/names.json`). Совпавшие название, номер и HP (`www/data/hp.json`) добавляют кандидату очки.
  4. Если уверенности мало, скан помечается «Проверь»: он не тратит лимит и не попадает в коллекцию сам.
- **Коллекция** хранится в `localStorage`. После входа через Google она синхронизируется через Firestore (`www/js/sync.js`).
- **Коллекция:**
  - график стоимости — один снимок в день, `store.snapshot`;
  - лидеры изменений за 7 дней (история цены каждой карты);
  - папки и список желаний с целевой ценой.
  Код в `www/js/views.js`. Раз в сутки цены обновляются при открытии приложения, тогда же проверяются оповещения (`www/js/prices.js`, плагин local-notifications).
- **Сеты:** прогресс сбора и стоимость недостающих карт. **Запечатанные товары:** `www/data/sealed.json` из tcgcsv.com (TCGplayer). Свежие цены в приложении запрашиваются нативно через CapacitorHttp, потому что tcgcsv не разрешает запросы из браузера.
- **Обучение** при первом запуске — `www/js/tutorial.js`. Повторить его можно в настройках, кнопка «How to scan».

## Обновить базы (когда выйдут новые сеты)

```bash
python tools/build_embed.py
```

```bash
python tools/build_meta.py
```

```bash
python tools/build_sealed.py
```

`build_embed.py` докачивает только новые карты (нужны `onnxruntime`, `onnx`, `pillow`, `numpy`). Если вектора для новой карты ещё нет, приложение посчитает его само по миниатюре.

## Проверка точности

Тестовые карты лежат в `tools/testset`. Скопируй папку в `www/test`, открой приложение в браузере и выполни в консоли:

```js
await import('/test/bench.js').then((m) => m.run({ harsh: true }))
```

Режим `harsh` берёт «жёсткие» снимки из `tools/testset/harsh`: блик, топлоадер, перспектива, JPEG. Перед сборкой APK папку `www/test` удали.

## Собрать APK

Нужны JDK 17 и Android SDK (у нас: `C:\Program Files\Microsoft\jdk-17.0.21.21-hotspot` и `C:\Android\sdk`).

```bash
npx cap sync android
```

```bash
cd android && JAVA_HOME="/c/Program Files/Microsoft/jdk-17.0.21.21-hotspot" ./gradlew.bat assembleDebug
```

Готовый файл: `android/app/build/outputs/apk/debug/app-debug.apk`.

## Проверка в браузере

```bash
python -m http.server 5317 --directory www
```

Камера в браузере на компьютере может быть недоступна. Тогда загружай фото кнопкой галереи.
