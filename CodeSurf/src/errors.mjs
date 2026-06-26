// Stable error codes for CodeSurf, mirroring Contex's CONTEXT_* convention.
// Surfaced to the UI as { code, message } so the renderer can branch on code,
// never on message text.

export class CodeSurfError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'CodeSurfError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
  toJSON() {
    return { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) };
  }
}

export const Codes = {
  BAD_REQUEST: 'CODESURF_BAD_REQUEST',
  NOT_FOUND: 'CODESURF_NOT_FOUND',
  REPO_INVALID: 'CODESURF_REPO_INVALID',
  WORKSPACE_LOCKED: 'CODESURF_WORKSPACE_LOCKED',
  LAYOUT_CORRUPT: 'CODESURF_LAYOUT_CORRUPT',
};

export function badRequest(message, details) {
  return new CodeSurfError(Codes.BAD_REQUEST, message, details);
}
export function notFound(message, details) {
  return new CodeSurfError(Codes.NOT_FOUND, message, details);
}
