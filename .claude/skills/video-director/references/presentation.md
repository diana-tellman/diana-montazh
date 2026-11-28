# Презентация PPTX (режим C — дополнительно, только по просьбе)

1. Вопросы (2–3): для чего (выступление / отправить файлом), сколько слайдов (≈ 1 слайд на 1 минуту речи или 6–10), формат 16:9 ⭐ / 9:16.
2. **План по слайдам** (это раскадровка для презентации): номер, макет, заголовок, текст/пункты, картинка, заметки спикера. Покажи списком в чате, предложи «Презентацияны жасау» / «Слайдты өзгерту». Правка «3-слайдты өзгерт» → меняешь только его, номера остальных не трогаешь, если не просили.
3. После одобрения запиши `projects/<id>/storyboard/presentation.json` (или `incoming/<имя>/presentation.json`) по схеме `src/present/deck.ts`:
   ```json
   { "title": "…", "format": "16:9", "theme": { "bg": "#F4F1EE", "text": "#141414", "accent": "#9B1C40", "accent2": "#F4A6C0", "font": "Arial" },
     "slides": [
       { "layout": "title", "title": "…", "subtitle": "…" },
       { "layout": "bullets", "title": "…", "bullets": ["…", "…"], "notes": "что сказать" },
       { "layout": "image", "title": "…", "bullets": ["…"], "image": "photo.jpg" },
       { "layout": "compare", "title": "…", "left": { "title": "А", "points": ["…"] }, "right": { "title": "Б", "points": ["…"] } },
       { "layout": "number", "value": "87%", "title": "…" },
       { "layout": "steps", "title": "…", "bullets": ["…", "…", "…"] },
       { "layout": "quote", "title": "…" },
       { "layout": "end", "title": "…", "subtitle": "призыв" } ] }
   ```
   Текст — только из материалов и слов пользователя. ≤ 5 пунктов и ≤ 45 слов на слайд. Шрифт Arial — открывается на iPhone (Keynote, PowerPoint, Google Slides) с казахскими буквами.
4. `npm run pptx -- <presentation.json>` → проверки: файл открывается (LibreOffice), число слайдов, размер, весь текст на месте; `*-preview.jpg` — **посмотри сам**.
5. Отправь `.pptx` (SendUserFile) + превью. Как открыть: «Файлды аш → Бөлісу → Keynote / PowerPoint». Цвета/шрифт поменять — правка `theme` и повторный `pptx`.
