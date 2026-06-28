# CodeSurf Phase 7 — Objective, Skill, and Context Controls

Date: 2026-06-27

Phase 7 connects a visible CodeSurf Tile to Contex's recovered context-control
surface. CodeSurf remains the canvas/UI layer; Contex remains the authoritative
coordination backend.

## Implemented in this increment

### Backend API proxy

CodeSurf now exposes loopback-only REST endpoints that directly proxy existing
Contex MCP tools:

| CodeSurf endpoint | Contex tool | Purpose |
|---|---|---|
| `GET /api/contex/context/:tileId` | `get_context` | Load the Tile's objective, skills, and attachments. |
| `POST /api/contex/context/:tileId/objective` | `set_objective` | Save versioned objective markdown for a Tile. |
| `POST /api/contex/context/:tileId/skills` | `set_skill` | Enable/disable one skill key for a Tile. |
| `POST /api/contex/context/:tileId/attachments` | `add_context_attachment` | Attach a file/url/resource/note reference to a Tile. |
| `POST /api/contex/context/:tileId/reload` | `reload_objective` | Acknowledge that the active worker should reload its objective. |

When CodeSurf is running without `--contex`, these endpoints return
`503 CODESURF_NO_CONTEX`. The browser uses that as a friendly degradation path:
the local canvas stays usable, but context editing is unavailable.

### Tile context panel

Every Tile header now has an "Objective and Context" button. It opens a modal
panel with:

- objective markdown editor;
- refresh/save/reload controls;
- skill list and skill enable/disable form;
- attachment list and attachment add form;
- explicit offline messaging when Contex is not started.

The panel does not poll Contex during normal canvas rendering. It only loads
context when the user opens or refreshes it, which keeps canvas-only mode quiet.

### Notification handling

The existing Contex SSE stream now recognizes `objective_reload_required`
notifications. CodeSurf flashes the affected Tile and updates the status line so
the human can see which Tile needs attention.

### Tests

Added coverage:

- no-Contex context endpoint returns `503`;
- Phase 7 context endpoints call the expected Contex tool names and arguments;
- browser smoke verifies:
  - each Tile has an accessible Context button;
  - the panel opens from the Tile header;
  - offline mode clearly says Contex is not started and local canvas still works;
  - Escape closes the panel.

## Still pending from the historical Phase 7 plan

This increment creates the operational bridge, but it is not the full historical
Phase 7 surface yet.

Pending work:

1. Skill discovery
   - merge repo-level, user-level, and Contex-provided skill catalogs;
   - mark duplicate skill names and show which source wins;
   - expose missing/untrusted skill source warnings in the panel.

2. Objective version history
   - show previous objective versions;
   - compare two versions;
   - restore or fork a previous version.

3. Runtime worker reload UX
   - show which active agent/terminal has acknowledged the new objective;
   - distinguish "objective saved" from "worker reloaded";
   - add per-Tile reload pending badge.

4. Virtual historical-file preview
   - use Contex virtual resources to preview historical source/docs without
     requiring files to be present in the CodeSurf repo;
   - add a read-only preview Tile or side panel.

5. Trust and safety checks
   - detect untrusted repository skill paths;
   - require explicit enablement before an agent consumes untrusted instructions;
   - test missing skill source and duplicate skill behavior.

## Design boundary

CodeSurf should not become the context authority. It should:

- display and edit context through Contex;
- keep local layout/position/link state in its own workspace store;
- mirror canvas links into Contex peer links;
- avoid exposing Contex tokens to the browser or saved layout files.

