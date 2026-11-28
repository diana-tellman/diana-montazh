/**
 * npm run voice-script -- <script.txt> --lang kk|ru|en [--title "…"] [--target 30]
 *
 * The user needs to record narration (animation / explainer without their own audio):
 * lays out the script Claude wrote for reading on the phone (voice-script.md, numbered blocks, timing,
 * recording instructions), estimates duration and compares with the target length.
 * Send voice-script.md + the text in chat, then ASK the user to record and send the audio.
 * The same script.txt is later passed to `npm run new -- … --script script.txt` (captions = exact text).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { countWords, scriptBlocks, scriptMarkdown, wordsFor, type Lang } from "../src/script/voiceScript";
import { main, out, parseArgs, str } from "./_cli";

main(async () => {
  const { pos, opt } = parseArgs();
  const file = resolve(pos[0] ?? "");
  const text = readFileSync(file, "utf8");
  const lang = (str(opt.lang) ?? "kk") as Lang;
  const title = str(opt.title) ?? basename(file, extname(file));
  const blocks = scriptBlocks(text, lang);
  const seconds = blocks.at(-1)?.to ?? 0;
  const md = join(dirname(file), "voice-script.md");
  writeFileSync(md, scriptMarkdown(title, text, lang));
  const target = str(opt.target) ? Number(opt.target) : null;
  out({
    file: md, words: countWords(text), seconds, blocks: blocks.length,
    target, fits: target ? Math.abs(seconds - target) <= Math.max(3, target * 0.15) : null,
    advice: target && Math.abs(seconds - target) > Math.max(3, target * 0.15) ? `Для ${target} с нужно ≈ ${wordsFor(target, lang)} слов — сократите/дополните текст.` : null,
  });
});
