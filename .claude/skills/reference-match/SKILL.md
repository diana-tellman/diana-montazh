---
name: reference-match
description: Монтаж «как в референсе». Используй, когда пользователь присылает вместе со своими материалами чужой/образцовый ролик («осындай болсын», «как в этом видео», «референс», «вот пример») — повторить схему текста, анимации, цвета, темпа, звуков, но с его материалом и голосом.
---

# Reference Match

Цель — повторить **схему** референса (стиль субтитров, анимацию, цвет, темп, приёмы), а не копировать его содержание. Голос, лицо и смысл — только пользователя.

## Шаги
1. Проект как обычно (`npm run new …` с материалами пользователя, БЕЗ референса).
2. `npm run reference -- <id> <референс.mp4>` — автоматически:
   - **цвет** → 3D LUT `work/reference/grade.cube` (перенос статистики Lab, кожа сохраняется естественной);
   - **темп** → склейки в секунду → энергия камеры;
   - громкость; лист кадров `work/reference/frames.jpg`.
3. **Посмотри `frames.jpg` (Read)** и заполни `storyboard/reference-style.json` по тому, что реально видно. Неуверен — оставь `null` (останется значение по умолчанию):
   - `font`: modern-sans | neutral-sans | geometric-bold | serif | condensed | rounded | rounded-bold | elegant | tight-display | soft-geometric | editorial-serif | script (все с казахскими буквами);
   - `weight` 400–900, `uppercase`, `size`: small | medium | large;
   - `textColor`, `accentColor`, `onAccent` (HEX);
   - `position`: bottom | middle | top | auto; `wordsPerPhrase` 1–6;
   - `activeWord`: pill | color | scale | underline; `upcoming`: dim | hidden | visible; `backdrop`: shadow | glass | none; `animation`: pop | rise | fade | slide;
   - `behindText`, `icons`, `progressBar`, `sfx` (true/false), `layout`: auto | full | circle | split;
   - `grade` (true/false), `gradeStrength` 0.5–1.0; `notes` — что ещё заметил.
   Звук референса ты не слышишь — про звуковые эффекты ставь `null`, если пользователь не сказал.
4. `npm run plan -- <id> --reference [явные пожелания]` — **явные слова пользователя важнее референса**:
   «шрифт с засечками» → `--font serif`; «жёлтый акцент» → `--accent yellow`; «текст белый» → `--text white`; «мельче/крупнее» → `--size small|large`; «капсом/без капса» → `--upper|--lower`; «без анимации за головой» → `--no-behind`; формат, layout, иконки — как обычно.
5. `npm run storyboard -- <id>` → покажи пользователю сториборд, скажи, что взято из референса (стиль, цвет, темп), что — по его словам, и что определить нельзя (точный шрифт референса может отличаться — подбирается ближайший с казахскими буквами).
5б. **Приёмы монтажа референса** (окна, разделённый экран, полноэкранные схемы, плашки, частота): перенеси их в `storyboard/directions.json` на моменты речи пользователя с тем же смыслом (skill `editorial-motion`), а не на те же секунды. Если в референсе этих приёмов нет — `--no-semantic`.
6. Дальше обычный процесс: аниматик → одобрение → рендер → обложка → QC.

`--no-reference` возвращает стиль без референса.
