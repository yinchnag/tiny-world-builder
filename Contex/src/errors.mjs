// -------- error codes --------
// Canonical Contex error codes (see MCP_API.md section 6). A ContexError carries
// a stable `code` so the server can map it onto a JSON-RPC / MCP tool error
// without leaking internal details.

export const ErrorCodes = {
  AUTH_REQUIRED: 'CONTEXT_AUTH_REQUIRED',
  SCOPE_DENIED: 'CONTEXT_SCOPE_DENIED',
  TILE_NOT_FOUND: 'CONTEXT_TILE_NOT_FOUND',
  PEER_NOT_LINKED: 'CONTEXT_PEER_NOT_LINKED',
  VERSION_CONFLICT: 'CONTEXT_VERSION_CONFLICT',
  FILE_CONFLICT: 'CONTEXT_FILE_CONFLICT',
  OBJECTIVE_STALE: 'CONTEXT_OBJECTIVE_STALE',
  CANVAS_OFFLINE: 'CONTEXT_CANVAS_OFFLINE',
  COMMAND_REJECTED: 'CONTEXT_COMMAND_REJECTED',
  RATE_LIMITED: 'CONTEXT_RATE_LIMITED',
  INVALID_TRANSITION: 'CONTEXT_INVALID_TRANSITION',
  // local additions (not in the historical table, but needed for a real impl)
  BAD_REQUEST: 'CONTEXT_BAD_REQUEST',
  WORKSPACE_NOT_FOUND: 'CONTEXT_WORKSPACE_NOT_FOUND',
};

export class ContexError extends Error {
  constructor(code, message, details = null) {
    super(message || code);
    this.name = 'ContexError';
    this.code = code;
    this.details = details;
  }
}

// Convenience factories for the codes used most often.
export const err = {
  badRequest: (m, d) => new ContexError(ErrorCodes.BAD_REQUEST, m, d),
  authRequired: (m = 'Missing or invalid token') => new ContexError(ErrorCodes.AUTH_REQUIRED, m),
  scopeDenied: (m = 'Token lacks required scope') => new ContexError(ErrorCodes.SCOPE_DENIED, m),
  tileNotFound: (id) => new ContexError(ErrorCodes.TILE_NOT_FOUND, `Unknown tile: ${id}`, { tile_id: id }),
  workspaceNotFound: (id) => new ContexError(ErrorCodes.WORKSPACE_NOT_FOUND, `Unknown workspace: ${id}`, { workspace_id: id }),
  peerNotLinked: (a, b) => new ContexError(ErrorCodes.PEER_NOT_LINKED, `Tiles not linked: ${a} -> ${b}`, { from: a, to: b }),
  versionConflict: (expected, actual) =>
    new ContexError(ErrorCodes.VERSION_CONFLICT, `Expected version ${expected} but current is ${actual}`, { expected, actual }),
  invalidTransition: (from, to) =>
    new ContexError(ErrorCodes.INVALID_TRANSITION, `Illegal tile status transition: ${from} -> ${to}`, { from, to }),
};
