import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ProjectSchema, type Mode, type Project } from "./project";

export const ROOT = resolve(import.meta.dirname, "../..");
export const PROJECTS_DIR = join(ROOT, "projects");
export const MODELS_DIR = join(ROOT, "models");

export type ProjectPaths = {
  root: string;
  file: string;
  input: string;
  work: string;
  storyboard: string;
  output: string;
};

export function pathsFor(id: string): ProjectPaths {
  const root = join(PROJECTS_DIR, id);
  return {
    root,
    file: join(root, "project.json"),
    input: join(root, "input"),
    work: join(root, "work"),
    storyboard: join(root, "storyboard"),
    output: join(root, "output"),
  };
}

export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "project";
}

export function createProject(opts: { id: string; mode: Mode; language: Project["language"]; styleRequest?: string; now?: Date }): Project {
  const p = pathsFor(opts.id);
  if (existsSync(p.file)) throw new Error(`Проект ${opts.id} уже существует`);
  for (const d of [p.input, p.work, p.storyboard, p.output]) mkdirSync(d, { recursive: true });
  const at = (opts.now ?? new Date()).toISOString();
  const project: Project = {
    schemaVersion: 2,
    id: opts.id,
    createdAt: at,
    updatedAt: at,
    mode: opts.mode,
    status: "created",
    language: opts.language,
    styleRequest: opts.styleRequest ?? "",
    assets: [],
    voiceAssetId: null,
    scriptFile: null,
    history: [{ at, status: "created", note: `Создан проект, режим ${opts.mode}` }],
  };
  saveProject(project);
  return project;
}

export function loadProject(id: string): Project {
  const p = pathsFor(id);
  if (!existsSync(p.file)) throw new Error(`Проект ${id} не найден (${p.file})`);
  return ProjectSchema.parse(JSON.parse(readFileSync(p.file, "utf8")));
}

/** Atomic write, validated by the schema. */
export function saveProject(project: Project): void {
  const valid = ProjectSchema.parse(project);
  const p = pathsFor(valid.id);
  mkdirSync(p.root, { recursive: true });
  const tmp = p.file + ".tmp";
  writeFileSync(tmp, JSON.stringify(valid, null, 2) + "\n");
  renameSync(tmp, p.file);
}
