import type { Mode, Project, Status } from "./project";

/** Forward order of the pipeline. Identical for all modes: the voice is always the user's own recording. */
const ORDER: Status[] = ["created", "ingested", "analyzed", "storyboard_draft", "approved", "rendered", "cover_done", "qc_passed", "delivered"];
const FLOW: Record<Mode, Status[]> = { "expert-video": ORDER, "voice-over-visuals": ORDER };

export function flowFor(mode: Mode): readonly Status[] {
  return FLOW[mode];
}

export class TransitionError extends Error {}

export function canTransition(mode: Mode, from: Status, to: Status): boolean {
  const flow = FLOW[mode];
  const i = flow.indexOf(from);
  const j = flow.indexOf(to);
  if (i < 0 || j < 0) return false;
  if (j === i + 1) return true;
  // Editing the storyboard is allowed from any later state and always
  // drops the project back to an unapproved draft.
  if (to === "storyboard_draft" && i >= flow.indexOf("storyboard_draft")) return true;
  // Re-running analysis is allowed before approval.
  if (to === "analyzed" && i <= flow.indexOf("storyboard_draft")) return true;
  return false;
}

export function transition(project: Project, to: Status, note: string, now = new Date()): Project {
  if (!canTransition(project.mode, project.status, to)) {
    throw new TransitionError(
      `Переход ${project.status} → ${to} запрещён для режима ${project.mode}. ` +
        `Порядок: ${FLOW[project.mode].join(" → ")}`,
    );
  }
  const at = now.toISOString();
  return { ...project, status: to, updatedAt: at, history: [...project.history, { at, status: to, note }] };
}

/** Index helper: has the project reached (or passed) a given status? */
export function hasReached(project: Project, status: Status): boolean {
  const flow = FLOW[project.mode];
  return flow.indexOf(project.status) >= flow.indexOf(status);
}
