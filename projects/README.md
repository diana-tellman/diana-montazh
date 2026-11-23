# projects/

Әр жоба осы жерде `projects/<id>/` папкасында жасалады. Бұл папканың ішіндегі видео, аудио және рендер файлдары **git-ке жүктелмейді** (`.gitignore`).

```
projects/<id>/
  project.json      # режим, статус, бастапқы файл туралы мәлімет
  input/            # бастапқы видео / аудио / мәтін
  work/             # proxy.mp4, voice.wav, voiceover.wav, талдау нәтижелері
  storyboard/       # storyboard.json, кадрлар, storyboard.html, approval.json
  output/           # final-video.mp4, cover.png, quality-report
```
