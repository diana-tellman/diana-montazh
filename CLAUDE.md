# DIANA MOBILE MOTION STUDIO — правила для Claude

Storyboard-first видеомонтаж (Remotion + ffmpeg + MediaPipe + Whisper) для учеников, работающих только с iPhone через Claude Code.
Архитектура: `docs/ARCHITECTURE.md`. Весь процесс ведёт **один** skill **video-director** (`.claude/skills/video-director/SKILL.md` + `references/`). Приоритет: экспертное видео → анимационный ролик → презентация PPTX (дополнительно).

## Пользователь
- Ученик без компьютера. Говори на его языке (по умолчанию — **казахский**), коротко, без технических деталей, если не спросят.
- Ученик делает только: **материалы или идея → ответы на 2–3 вопроса → смотрит раскадровку → «Монтажды бастау» / «Кадрды өзгерту» → получает MP4 и обложку.** Всё остальное (установка, модели, команды) — делаешь ты.
- Перед монтажом прочитай `менің-талғамым.md`; новые устойчивые предпочтения дописывай туда.
- До раскадровки всегда сам задай 2–3 важных вопроса одним сообщением (варианты + твоя рекомендация), не спрашивая очевидное из материалов.

## Процесс (обязательный)
ANALYSIS → QUESTIONS → (REFERENCE) → STORYBOARD → FRAME EDITS → APPROVAL → RENDER → COVER → QUALITY CONTROL → DELIVERY.
- **Финальный рендер — только после явного одобрения актуальной версии сториборда.** Код это проверяет (хэш); не обходить.
- Любая правка после одобрения → новый сториборд → новое одобрение.
- Обложка — только после успешного рендера. «Готово» — только после QC и реальной отправки файлов (SendUserFile).
- Сам смотри изображения (contact-sheet, qc-frames, cover) перед отправкой. Не выдавай непроверенное за готовое.

## Откуда стиль (правило)
- **Содержание** (речь, текст субтитров, лицо, кадры) — всегда из материалов пользователя.
- **Стиль монтажа**: прислан референс → схема референса (`references/reference.md`); референса нет → текстовые пожелания пользователя; нет и их → `менің-талғамым.md`, затем пресет `brand`.
- Явные слова пользователя всегда важнее референса. Референс из прошлого проекта не переносится в новый.

## Монтаж по смыслу (`references/meaning-to-frame.md`)
- Кадр решает смысл речи: эмоция → весь кадр + наезд; пример → спикер в окне; сравнение → экран на два; процесс → спикер уходит, полноэкранная схема под голос; главная мысль → плашка; призыв → кнопка.
- Автоматика (`src/plan/director.ts`) ищет маркеры kk/ru/en; Claude обязан проверить `work/beats.json` по смыслу. Подписи карточек — только слова спикера.
- Каждый элемент и звук появляется в момент произнесения своего слова. Музыка всегда ниже голоса (дакинг).
- Только аудио → каждое предложение получает карточку (полноценное объясняющее видео). Эксперт в кадре → постеры, плашки, стеклянные виджеты, схемы, субтитры 1–3 слова.

## Голос
- Только собственный голос пользователя (речь из его видео или запись MP3/M4A/WAV). **Никакого TTS, синтеза, клонирования, замены.**
- Голоса нет → Claude пишет текст для записи (`npm run voice-script`), отправляет его и просит прислать аудио.
- Обработка голоса — только корректирующая; тембр не меняется.

## Распознавание речи
- Локально: Whisper large-v3-turbo + Silero VAD (sherpa-onnx), модели скачиваются сами и проверяются по SHA-256.
- Казахский распознаётся хуже — проси текст сценария; если он есть, субтитры = точный текст сценария, время — из записи.
- Время фраз измерено, время слов — оценка. Так и говори.

## Рендер
- Тяжёлые пиксельные операции (размытие фона, HDR→SDR) — заранее через ffmpeg. CSS `blur()` на полноэкранном видео не использовать.
- Один и тот же код кадрирования (`src/layout/frame.ts`) используется для проверки сториборда и для рендера.

## Данные и безопасность
- `projects/`, `incoming/`, `models/`, `out/` — **никогда не коммитить** (видео учеников, модели).
- Не использовать личные секреты, глобальные Skills, непроверенные сторонние скрипты, платные сервисы без согласия.
- Не выдавать себе разрешения в `.claude/settings.json`. Перед разрушительными изменениями — резервная ветка.

## Команды (выполняет Claude)
| Шаг | Команда |
|---|---|
| зависимости | SessionStart-хук ставит сам; иначе `npm ci`. Всё заранее (Python-среда, модели): `npm run setup` (его вызывает скрипт облачной среды `setup/cloud-environment.sh`) |
| исследование видео | `npm run study -- <видео> [--transcript …]` → `study.md`, `shots.jpg`, `timeline.png` (планы, движение, звук, паузы, музыка, удары) |
| разбор монтажа по дорожкам | `npm run showcase -- breakdown <id>` → `breakdown.md`, `breakdown-tracks.png` |
| файл по ссылке | `npm run fetch -- <url>` |
| проект | `npm run new -- --name <имя> --lang kk|ru|en [--script <txt>] [--voice <файл>] <файлы…>` (код 3 = задать вопрос) |
| план | `npm run plan -- <id> [--style …] [--text …] [--accent …] [--format …] [--platform …] [--position …] [--no-behind] [--no-sfx] [--no-progress] [--energy 0-2] [--layout auto|full|circle|split] [--no-icons] [--no-semantic] [--music <файл>|--no-music]` (стили: brand, minimal, kinetic, glass, lime, editorial, bordeaux; `--accent2` — второй акцент) (сам вызовет transcribe и analyze) |
| референс | `npm run reference -- <id> <образец.mp4>` → посмотреть `work/reference/frames.jpg`, заполнить `storyboard/reference-style.json` → `npm run plan -- <id> --reference [--font …] [--size …] [--upper|--lower]` (`references/reference.md`; слова пользователя важнее референса) |
| смысл → кадр | прочитать `work/beats.json`; при необходимости `storyboard/directions.json` → снова `plan` (`references/meaning-to-frame.md`) |
| текст для записи голоса | `npm run voice-script -- <script.txt> --lang kk [--target 30]` → отправить `voice-script.md` + текст, попросить запись |
| сториборд | `npm run storyboard -- <id>` → отправить `contact-sheet.jpg`, `storyboard.html`, `shotlist.md` (кадры: время, экран, речь, текст, изменения, переход) |
| правка кадра N | `npm run scene -- <id> <N>` → элементы кадра и пути в `storyboard.json` → правка → `npm run storyboard -- <id>` |
| аниматик | `npm run animatic -- <id>` → отправить `storyboard/animatic.mp4` (движение + звук, 540p, до одобрения) |
| одобрение | `npm run approve -- <id>` (только после слов пользователя) |
| рендер | `npm run render -- <id> [--max-mb 90]` |
| showcase (Premium Editorial, подробный бриф) | `npm run showcase -- frames|storyboard|animatic|approve|render <id>` по `storyboard/showcase.json` (`references/editorial-style.md`) |
| фон с фото (rembg) | `npm run cutout -- <фото|видео> [--t сек]` → RGBA PNG + превью |
| графика без спикера (HyperFrames) | `npm run hf -- new <папка>` → `snapshot` → одобрение → `render` (без TTS и платных функций HeyGen; `references/tools.md`) |
| презентация (доп.) | `npm run pptx -- <presentation.json>` → посмотреть `*-preview.jpg`, отправить `.pptx` |
| обложка | `npm run cover -- <id> --title "… *акцент*" [--word …] [--tag …] [--t …]` |
| контроль | `npm run qc -- <id>` → посмотреть `output/qc-frames.jpg` |
| прочее | `npm run status -- <id>`, `npm run transcribe -- <id> [--import srt]`, `npm run analyze -- <id>`, `npm run doctor`, `npm test`, `npm run typecheck`, `npm run smoke`, `npm run bench` |
