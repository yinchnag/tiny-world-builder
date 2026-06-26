// Stable id helpers — zero-dependency, node:crypto only.
import { randomUUID } from 'node:crypto';

/** A workspace id: `ws_` + uuid (no dashes), URL/path safe. */
export function workspaceId() {
  return 'ws_' + randomUUID().replace(/-/g, '');
}

/** A tile id: `tile_` + uuid. Mirrors the CARD_ID convention agents see. */
export function tileId() {
  return 'tile_' + randomUUID().replace(/-/g, '');
}

/** A link id derived from its endpoints + direction so it is deterministic. */
export function linkId() {
  return 'link_' + randomUUID().replace(/-/g, '');
}
