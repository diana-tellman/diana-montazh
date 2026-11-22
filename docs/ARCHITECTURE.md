# DIANA MOBILE MOTION STUDIO — Architecture (PHASE 1 + PHASE 2)

Статус: архитектура одобрена; дополнение «Аудио-режимы» — 2026-11-22. PHASE 3 (Core Video Engine) реализована.
Дата аудита: 2026-11-22.

---

## PHASE 1 — Environment Audit (фактические результаты)

### Репозиторий
- `diana-tellman/diana-montazh`, одна ветка с одним коммитом, единственный файл `README.md` (15 байт).
- Ни одного Skill, конфигурации, кода, workflow.

### Облачный контейнер Claude Code (то, где работает сессия с iPhone)
| Компонент | Найдено | Вывод |
|---|---|---|
| Node.js / npm | 22.23 / 10.9 | Подходит для Remotion 4 |
| pnpm / bun | есть | Используем npm (проще для учеников) |
| FFmpeg / FFprobe | 6.1.1 (libx264, aac, zscale, tonemap, loudnorm, ebur128) | Хватает для proxy, HDR→SDR, нормализации звука |
| Chromium | предустановлен (`/opt/pw-browsers`) | Remotion может рендерить прямо в сессии |
| Python | 3.13 | Для анализа лиц / транскрипции |
| CPU / RAM / GPU | 4 ядра / 15 ГБ / **GPU нет** | Рендер на CPU; тяжёлые ML-эффекты — медленно |
| npm registry, PyPI | доступны | Зависимости ставятся |
| huggingface.co | **заблокирован** сетевой политикой | Модели Whisper здесь не скачать без разрешения хоста |
| storage.googleapis.com (MediaPipe модели) | доступен | Детекция лиц возможна в сессии |
| fonts.gstatic / github.com raw | частично закрыты | Шрифты берём из npm (`@fontsource/*`) и кладём в репо |

### Проверка казахских символов (Ә Ғ Қ Ң Ө Ұ Ү Һ І + строчные), начертание 700
| Шрифт | Результат |
|---|---|
| **Manrope** | ❌ нет Ә Ғ Қ Ң Ұ (и строчных) — **исключён** |
| **Onest** | ✅ полный |
| **Inter** | ✅ полный |
| Montserrat | ✅ полный |
| Noto Sans | ✅ полный (резерв/fallback) |

**Решение:** Onest — заголовки (Hero, Section, CTA, Numeric); Inter — субтитры, подписи, мелкий текст. Noto Sans — технический fallback. Все — SIL OFL, файлы хранятся в репозитории.

### Актуальные версии (npm, на дату аудита)
- `remotion` / `@remotion/cli` / `@remotion/renderer` / `@remotion/captions` / `@remotion/layout-utils` — **4.0.545** (одна версия для всех пакетов, жёсткий pin).
- `react` / `react-dom` — 19.x (peer `>=16.8`).
- `typescript` — **5.9.3** (TS 7.0 вышел недавно; для стабильности берём 5.9, переход — после проверки).
- `zod` — версия, которую требует Remotion 4.0.545 (проверяется при установке в PHASE 3).
- `faster-whisper` 1.2.1, `mediapipe` 1.2.3 (PyPI).

---

## PHASE 2 — Архитектура

### 1. Общая схема

```
iPhone (Claude app)
   │  видео / текст / команды
   ▼
Claude Code cloud session ──► .claude/skills/* (оркестрация, правила)
   │
   ▼
CLI-скрипты проекта  (npm run …)  ← единственная «точка входа» для Skills
   │
   ├─ ingest   : ffprobe → proxy.mp4 (H.264, SDR bt709, CFR) + audio.wav
   ├─ analyze  : транскрипция | импорт SRT · детекция лиц (MediaPipe) · кадры для визуального анализа Claude
   ├─ plan     : storyboard.json (zod-схема, версия, sha256)
   ├─ preview  : Remotion renderStill на РЕАЛЬНЫХ кадрах → contact-sheet.png + storyboard.html
   ├─ approve  : approval.json (хэш утверждённой версии)
   ├─ render   : Remotion renderMedia → ffmpeg post (loudnorm, faststart) → final-video.mp4
   ├─ cover    : Remotion renderStill → cover.png (+ grid-вариант 3:4 / 1:1)
   └─ qc       : автоматические проверки → quality-report.json + .html
   │
   ▼
Доставка: SendUserFile в Claude app (основной) · GitHub Release (резерв)
```

Принцип: **Skills не содержат логику рендера** — они вызывают скрипты и читают их JSON-вывод. Вся логика — в TypeScript и тестируется.

### 2. Структура репозитория

```
.
├─ CLAUDE.md                     # общие правила системы (storyboard-first, запреты)
├─ README.md  STUDENT-GUIDE.md  COMMANDS.md  TROUBLESHOOTING.md   # на казахском
├─ .claude/
│  ├─ settings.json              # только проектные разрешения, без секретов
│  └─ skills/
│     ├─ video-director/         # оркестратор: этапы, статус-машина, кто что делает
│     ├─ storyboard-builder/     # storyboard.json + превью + правки по командам
│     ├─ smart-layout/           # форматы, safe zones, face-зоны, кадрирование
│     ├─ kinetic-typography/     # выбор/параметры текстовых анимаций
│     ├─ motion-graphics/        # графика, переходы, видеоэффекты
│     ├─ smart-captions/         # транскрипция/импорт, разбиение, подсветка слова
│     ├─ color-sound/            # грейдинг, SFX, громкость
│     ├─ cover-generator/        # обложка (только после рендера)
│     └─ render-quality-control/ # финальный рендер + QC + доставка
├─ src/
│  ├─ Root.tsx                   # регистрация композиций (9:16, 16:9, 4:5, 1:1, Cover, StoryboardFrame)
│  ├─ compositions/              # MainVideo, StoryboardFrame, Cover
│  ├─ schema/                    # zod: storyboard, captions, faces, approval, brand
│  ├─ design/                    # tokens.ts, typography.ts, brand overrides
│  ├─ layout/                    # formats.ts, safeZones.ts, faceGuard.ts, placement.ts, crop.ts
│  ├─ motion/
│  │  ├─ text/                   # FallingText, WordPop, SpringReveal, MaskReveal, SlideReveal,
│  │  │                          # StaggeredWords, HighlightSweep, AnimatedUnderline, OutlineTrace,
│  │  │                          # ScaleEmphasis, SplitText, Counter
│  │  ├─ graphics/               # FloatingCards, AnimatedIcon, ArrowDraw, ProgressBar,
│  │  │                          # ComparisonCards, BarChart/LineChart, CalloutLabel, Timeline,
│  │  │                          # Diagram, ScreenFrame
│  │  ├─ effects/                # MotionBlur, DropShadow, SoftGlow, BackgroundBlur, SplitScreen,
│  │  │                          # SmoothPush, CleanWipe, FilmGrain (seeded)
│  │  └─ common/                 # общий контракт пропсов, easing-пресеты
│  ├─ captions/                  # SmartCaptions, разбиение на строки, active-word
│  ├─ overlays/                  # SafeZoneOverlay, FaceZoneOverlay (только для превью)
│  └─ fonts/                     # загрузка локальных woff2
├─ scripts/                      # CLI (tsx): ingest, analyze, plan, preview, approve, render, cover, qc, deliver
├─ analysis/                     # python: faces.py (MediaPipe), transcribe.py (faster-whisper)
├─ config/
│  ├─ safe-zones/*.json          # reels, stories, feed, shorts, tiktok (настраиваемые)
│  ├─ formats.json  brand.default.json  grading.default.json  sfx.json
├─ public/
│  ├─ fonts/                     # Onest, Inter, Noto Sans (OFL + лицензии)
│  └─ sfx/                       # собственные синтезированные звуки (без чужих лицензий)
├─ examples/                     # синтетический тестовый ролик + пример storyboard
├─ tests/                        # vitest: схемы, layout, safe zones, face guard, approval-gate
├─ projects/                     # РАБОЧИЕ ДАННЫЕ — в .gitignore (видео учеников не коммитятся)
│  └─ <project-id>/ input/ work/ storyboard/ output/
└─ .github/workflows/
   ├─ ci.yml                     # typecheck + тесты + smoke-рендер синтетики
   ├─ transcribe.yml             # (опц.) транскрипция на runner'е с интернетом
   └─ render.yml                 # (опц.) рендер в Actions → Release
```

### 3. Компоненты (реальный код, не описания)

**Единый контракт пропсов анимации:** `duration, delay, easing, position, size, color, intensity, scale` (+ специфичные). Все анимации — функции от `useCurrentFrame()`; случайность только через `random(seed)` Remotion → детерминизм при покадровом рендере.

**Layout engine (`src/layout`)** — чистые функции, тестируемые без рендера:
- `formats.ts` — 9:16 1080×1920, 16:9 1920×1080, 4:5 1080×1350, 1:1 1080×1080; масштаб типографики и отступов от короткой стороны.
- `safeZones.ts` — загружает пресет, отдаёт запретные прямоугольники (в долях кадра, не пикселях).
- `faceGuard.ts` — по треку лиц строит запретную зону на интервал сцены (объединение боксов + запас на лоб/подбородок + будущие кадры в окне сцены).
- `placement.ts` — выбирает слот для текста: кандидаты (top/center/lower-third/side) → отсечение safe/face-зон → подбор размера `fitText` с минимумом читаемости → перенос строк → если не помещается — **конфликт возвращается в сториборд с предложением другого layout**, а не тихое уменьшение.
- `crop.ts` — reframing: сохранение пропорций, якорь на лицо, ограничение скорости/скачков масштаба; если вертикаль не заполняется — layout «размытый фон + вписанное видео» или split.

**Typography:** Hero Title, Section Title, Subtitle, Kinetic Caption, Highlight Word, Numeric Callout, CTA — токены размера/межстрочного (1.0–1.15)/трекинга, задаются относительно формата.

**Brand/Color:** `tokens.ts` (Graphite #141414, Burgundy #6B1732, Soft White #F7F5F2, White #FFFFFF). Пользовательские цвета → `brand` в storyboard.json, имеют приоритет; валидатор запрещает цвета вне палитры сценария и проверяет контраст (WCAG ≥ 4.5 для мелкого, ≥ 3 для крупного текста).

**Captions:** формат `@remotion/captions` (слово + ms). Источники: faster-whisper (word timestamps) или импорт SRT/VTT/JSON/текст+таймкоды. Языки kk/ru/en. Активное слово подсвечивается; блоки ≤ 2 строк; позиция проходит через `placement.ts`.

**Color grading:** один `grading` на ролик + override на сцену; реализация — ffmpeg-фильтры на proxy (eq/colorbalance/curves, мягко) + анализ средней яркости/баланса по сценам (signalstats) для выравнивания соседних кадров. Ограничения: без агрессивного sharpen/saturation; skin-tone не трогаем выборочно.

**HDR iPhone:** HEVC HLG / Dolby Vision 10-bit → `zscale + tonemap` → H.264 8-bit bt709 proxy. Chromium в Linux ненадёжно декодирует HEVC — поэтому proxy обязателен.

**Sound:** собственные SFX, синтезированные скриптом (whoosh, pop, click, impact, swipe, tick, riser, transition) → никаких сторонних лицензий. Правило плотности: не чаще 1 SFX на ~1.5 с, только на смысловые события. Финал: `loudnorm` −14 LUFS, true peak ≤ −1 dBTP, проверка клиппинга.

**Advanced subject effects** (Background Removal, Subject Masking, White Outline, Text Behind Subject, Object Tracking, Advanced Glow): **расширения**. На CPU без GPU MediaPipe Selfie Segmentation даёт маски, но медленно (оценка: минуты на 30 с видео) и с неровным краем. План: реализовать Text Behind Subject + White Outline через MediaPipe-маску как **экспериментальный** модуль после основной системы, с явной пометкой в документации. Object Tracking — только трек лица (MediaPipe); общий трекинг объектов — не реализуем, пока нет проверенного инструмента.

### 4. Зависимости

| Слой | Пакет | Лицензия / стоимость |
|---|---|---|
| Рендер | remotion, @remotion/cli, renderer, captions, layout-utils, media-utils, shapes, paths, noise | Remotion License (см. «Расходы») |
| UI | react, react-dom 19 | MIT |
| Схемы | zod | MIT |
| Скрипты | tsx, typescript 5.9 | MIT / Apache-2.0 |
| Тесты | vitest | MIT |
| Видео | ffmpeg/ffprobe (системные) | LGPL/GPL, бесплатно |
| Лица | mediapipe (Python, CPU) | Apache-2.0 |
| Речь | faster-whisper (CPU int8) | MIT; модели Whisper — MIT |
| Шрифты | Onest, Inter, Noto Sans | SIL OFL |

Сторонние Skills и скрипты из интернета **не устанавливаются**. Все Skills пишутся в этом репо.

### 5. Ограничения мобильной среды (честно)

1. **Нет live-превью Remotion Studio** на телефоне → превью только как PNG-кадры, contact sheet, HTML и (по желанию) черновой MP4 480p.
2. **Контейнер временный** — неподтверждённые файлы теряются после простоя. Результаты сразу доставляются; storyboard.json/approval коммитятся в ветку проекта (без видео).
3. **Нет GPU** — рендер 60 с 1080×1920@30 оценочно 3–10 мин; ML-эффекты медленные.
4. **Сеть сессии ограничена** — huggingface.co закрыт ⇒ Whisper в сессии не работает, пока владелец окружения не разрешит хост (бесплатно, через настройки окружения), либо транскрипция идёт в GitHub Actions, либо импорт готовых субтитров.
5. **Визуальный анализ** — Claude видит только извлечённые ключевые кадры (изображения), не видеопоток. В отчётах это указывается явно.
6. **Размер загрузок** — iPhone-видео тяжёлые (1 мин 4K HEVC ≈ 300–400 МБ). Нужен экспорт 1080p перед загрузкой.

### 6. Механизм загрузки видео (нужна проверка в PHASE 3)

| Вариант | Как | Плюсы | Минусы |
|---|---|---|---|
| **A. Вложение в Claude app** | прикрепить файл к сообщению | проще всего | поддержка видео-вложений и лимит размера **не подтверждены** — проверим реальным файлом |
| **B. GitHub Release (приватный репо ученика)** | Safari → Releases → draft → прикрепить MP4/MOV (до 2 ГБ) | большие файлы, не попадает в git-историю | нужна проверка скачивания из сессии через авторизованный доступ |
| **C. Прямая ссылка** | iCloud/Drive публичная ссылка → `curl` | без GitHub | хост может быть закрыт сетью; ссылки iCloud не всегда прямые |
| D. Коммит в git | Safari «Upload files» | — | лимит 25 МБ в вебе, засоряет историю — **не рекомендуется** |

Предложение: основной A (если подтвердится), резерв B. Видео никогда не коммитятся (`projects/` в `.gitignore`).

### 7. Формат визуального сториборда

- `projects/<id>/storyboard/storyboard.json` — источник истины для рендера: `version`, `format`, `platformPreset`, `brand`, `fonts`, `grading`, `scenes[]` {`id, start, end, frameDescription, onScreenText, textStyle, size, position, colors, enter, exit, graphics[], transition, sfx, subjectZone, safeZoneCheck`}.
- `frames/scene-XX.png` — **реальный кадр видео** (середина сцены) + настоящая композиция текста/графики, отрендеренная тем же Remotion-кодом, что и финал (кадр в момент полной видимости), + полупрозрачный оверлей safe zones и face-зон.
- `contact-sheet.png` — все сцены сеткой (ffmpeg tile) для быстрого просмотра на iPhone.
- `storyboard.html` — самодостаточная мобильная страница: карточка на сцену (кадр, таймкод, текст, шрифт, цвета, анимации, SFX, статус проверок), сверху — формат, стиль, длительность, номер версии.
- Если исходного видео нет (только текст/сценарий) — кадры строятся на нейтральном фоне из палитры с пометкой «без исходного кадра».

### 8. Подтверждение сториборда

- Статус-машина проекта: `ingested → analyzed → storyboard_draft → approved → rendered → cover_done → qc_passed → delivered`.
- Команды на естественном языке («Измени сцену 3», «Увеличь заголовок», «Сделай текст красным и белым», «Убери анимацию», «Перемести текст ниже») → Skill `storyboard-builder` меняет storyboard.json → `version++` → перегенерация только затронутых кадров → показ.
- «Одобряю» → `npm run approve` записывает `approval.json {version, sha256, approvedAt}`.
- **Жёсткий гейт в коде:** `render` вычисляет sha256 текущего storyboard.json и отказывается работать, если он не совпадает с approval.json. Любая существенная правка после одобрения автоматически снимает одобрение. Есть тест на это.

### 9. Способ рендеринга

- **Основной: в самой облачной сессии** (Chromium + ffmpeg уже есть, бесплатно в рамках подписки Claude).
- Пайплайн: proxy → Remotion `renderMedia` (h264, CRF ~18, yuv420p, 30 fps или исходный CFR) → ffmpeg: аудиомикс + loudnorm + `+faststart` + метка bt709 → `final-video.mp4`.
- **Резерв: GitHub Actions** `render.yml` (для длинных роликов): вход — storyboard.json + видео из Release; выход — Release-asset.
- Remotion Lambda / облачные платные рендеры — **не используются**.

### 10. Получение MP4 и обложки на iPhone

1. **SendUserFile** — файл появляется карточкой в Claude app → открыть → «Сохранить видео» в Фото. (Лимит размера проверяется в PHASE 8; если превышен — вариант 2.)
2. **GitHub Release** проекта — прямая ссылка, открывается в Safari, сохраняется в Фото/Файлы.
3. GitHub Actions artifact (zip, нужен вход) — запасной.

Система говорит «файл готов» только после проверки, что файл существует, прошёл ffprobe и реально отправлен/загружен.

### 11. Возможные расходы

| Пункт | Стоимость |
|---|---|
| FFmpeg, MediaPipe, Whisper, шрифты, SFX | 0 |
| Рендер в сессии | 0 сверх подписки Claude |
| GitHub Actions | публичный репо — бесплатно; приватный Free — 2000 мин/мес бесплатно |
| GitHub Releases | бесплатно |
| **Подписка Claude** | каждому ученику нужна своя подписка с Claude Code (их расход, не ваш) |
| **Remotion License** | бесплатно для физлиц и компаний до 3 сотрудников; компаниям крупнее нужна платная Company License. Если курс продаёт организация >3 человек или ученики — компании, это нужно учесть. **Решение за вами.** |

Платные API (OpenAI, ElevenLabs, облачный рендер, генерация лиц) — не подключаются.

### 12. План тестирования

- **Unit (vitest):** zod-схемы; форматы и масштаб; safe zones (текст не пересекает запретные зоны во всех 5 пресетах × 4 формата); faceGuard (движущееся лицо → текст не в будущей позиции); placement (конфликт → предложение layout, а не текст < минимума); approval-gate (изменённый storyboard блокирует render); валидатор цветов/контраста; покрытие глифов шрифтов для всех текстов сториборда (включая казахские буквы).
- **Детерминизм:** рендер одного кадра дважды → побайтовое/пиксельное сравнение.
- **Smoke (CI):** синтетическое видео (ffmpeg testsrc + синтетический голос-тон + тестовый «лицо»-кадр) → полный цикл ingest → storyboard → approve → render 5 с → cover → qc.
- **Визуальные проверки:** тестовые макеты UI-оверлеев (обобщённые, без чужих логотипов) поверх кадров; contact sheet для ручного просмотра.
- **QC-отчёт:** авто — ffprobe (кодек, разрешение, fps, длительность, faststart), ebur128/astats (LUFS, true peak, клиппинг), bbox текста ∩ safe/face зон, выход текста за кадр, глифы, единство шрифтов/цветов (по storyboard), синхрон субтитров (слова в границах сцен), сверка с утверждённой версией; ручное — плавность анимаций, цвет, общее впечатление (явно помечено «требует просмотра»).
- **E2E (PHASE 12):** реальный короткий ролик с iPhone (вертикальный, HDR) от загрузки до получения файлов на телефоне.

---

## Дополнение: три аудио-режима (одобрено владельцем)

Все режимы идут по одному процессу: **ANALYSIS → STORYBOARD → APPROVAL → RENDER → COVER → DELIVERY.**

| | MODE 1 — EXPERT VIDEO | MODE 2 — TEXT TO VIDEO | MODE 3 — AUDIO TO VIDEO |
|---|---|---|---|
| Вход | своё видео с речью | текст / сценарий | своя аудиозапись без видео |
| Голос | **оригинальный**, только корректирующая обработка | TTS-диктор **или** загруженная готовая озвучка | **оригинальный** |
| Субтитры | распознавание речи (или импорт) | из текста сценария + тайминг озвучки | распознавание речи (или импорт) |
| Синхронизация | по таймкодам слов речи | по сегментам озвучки | по таймкодам слов речи |
| Статусы | … approved → rendered … | … approved → **voiced** → rendered … | … approved → rendered … |

**Выбор режима** — `src/core/modes.ts` (`detectMode`): по запросу (kk/ru/en) и типу материала. Если есть своя запись, но упомянут «диктор/озвучка», или видео без речи — система **спрашивает**, сохранить ли оригинальный голос.

**Правила голоса — проверяются в коде (`src/voice/tts.ts`) и тестами:**
1. В MODE 1/3 замена голоса синтетическим — только с явным согласием (`voiceReplacementConsent`).
2. Финальная TTS-озвучка создаётся **только после одобрения сториборда** (до одобрения — черновое превью для тайминга).
3. Клонирование голоса не поддерживается вообще: ни один провайдер не принимает образец голоса.
4. Улучшение голоса — только корректирующее: срез гула, лёгкое шумоподавление, де-эссер, мягкая компрессия, EBU R128 (−16 LUFS для голоса, true peak ≤ −1.5 dBTP). Без изменения высоты тона, форманты, без генеративного «восстановления».

**TTS-провайдеры (платные не обязательны):**
| Провайдер | Языки | Качество | Где работает | Статус |
|---|---|---|---|---|
| Загруженная готовая озвучка | любые | оригинал | везде | ✅ реализовано |
| Piper (open source, стоковые голоса: kk_KZ issai/iseke/raya, ru_RU irina/denis/dmitri/ruslan, en_US/en_GB) | kk, ru, en | нормальное | нужна загрузка моделей с huggingface.co | ⚠️ код готов, **в этой сессии недоступно**: владелец отклонил открытие huggingface.co → путь через GitHub Actions (PHASE 8/11). Лицензия каждого голоса читается из MODEL_CARD при загрузке |
| eSpeak NG | kk, ru, en | роботизированное, **черновое** | офлайн, в сессии | ✅ реализовано; в финал — только с явного согласия |
| edge-tts и подобные неофициальные API | — | — | — | ❌ не используются (неофициальный доступ к чужому сервису) |

Тайминг слов для TTS сейчас **оценочный** (пропорционально длине слов, помечен `estimated`); точный — после выравнивания Whisper, когда он будет доступен.

**Распознавание речи:** faster-whisper тоже требует huggingface.co → в сессии недоступно; варианты — GitHub Actions или импорт готовых субтитров (SRT/VTT/текст с таймкодами).

**Загрузка видео:** в окружении уже разрешён Google Drive (`drive.google.com`, `drive.usercontent.google.com`) — это рабочий вариант C для больших файлов с iPhone.

## Открытые вопросы к владельцу
1. Как вы будете загружать видео: проверить вложение в Claude app (A) или сразу строить на GitHub Releases (B)?
2. ~~huggingface.co~~ — отклонено; транскрипция и Piper → GitHub Actions / импорт.
3. Remotion License: вы физлицо / компания ≤ 3 человек? Как это объяснить ученикам?
4. Шрифты: Onest (заголовки) + Inter (текст) — подтверждаете? (Manrope не поддерживает казахский.)
