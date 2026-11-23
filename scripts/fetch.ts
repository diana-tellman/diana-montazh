/**
 * npm run fetch -- <url> [--out <dir>]
 * Downloads a large file the user shared by link (Google Drive share link or any direct https URL)
 * into incoming/ (git-ignored). Prints the local path.
 */
import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ROOT } from "../src/core/store";
import { main, out, parseArgs, str } from "./_cli";

function driveDirect(url: string): string | null {
  const m = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=download&)?id=)([\w-]{20,})/);
  return m ? `https://drive.usercontent.google.com/download?id=${m[1]}&export=download&confirm=t` : null;
}

main(async () => {
  const { pos, opt } = parseArgs();
  const url = pos[0];
  if (!url || !/^https:\/\//.test(url)) throw new Error("Нужна https-ссылка.");
  const direct = driveDirect(url) ?? url;
  const res = await fetch(direct, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Не удалось скачать (HTTP ${res.status}). Проверьте, что доступ по ссылке открыт «всем, у кого есть ссылка». Если хост закрыт сетью окружения — загрузите файл в сообщение.`);
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("text/html")) throw new Error("По ссылке открылась веб-страница, а не файл. Откройте доступ к файлу по ссылке (Google Drive: «Все, у кого есть ссылка»).");
  const cd = res.headers.get("content-disposition") ?? "";
  const name = (cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)?.[1] ?? `download-${Date.now()}`).replace(/[^\w.\-]+/g, "_");
  const dir = str(opt.out) ?? join(ROOT, "incoming");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, decodeURIComponent(name));
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(file));
  out({ file });
});
