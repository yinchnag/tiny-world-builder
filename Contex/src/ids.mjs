// -------- id helpers --------
import { randomUUID } from 'node:crypto';

// Generated entity ids carry a short type prefix so they're legible in logs and
// audit rows. Tile ids are NOT generated here — clients supply their own
// `tile_id` (historically `tile-<ms>`, sourced from CARD_ID).
export function newId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

export const newWorkspaceId = () => newId('ws');
export const newMessageId = () => newId('msg');
export const newTodoId = () => newId('todo');
export const newTaskId = () => newId('task');
export const newLinkId = () => newId('link');
export const newClaimId = () => newId('claim');
export const newObjectiveId = () => newId('obj');
export const newSkillId = () => newId('skill');
export const newAttachmentId = () => newId('att');
