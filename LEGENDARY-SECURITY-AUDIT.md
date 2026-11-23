# Legendary backend security audit

Reviewed the local `../legendary` working tree on `feat/hosted-bank-collaboration` at `cd5863c`, including uncommitted changes. The audit covers single-venue and hosted modes. Live deployment and proxy configuration were outside scope.

Hold public deployment until the Socket.IO crash and authorization paths, premature answer disclosure, and archive handling are fixed.

## What can happen in normal use

| Finding | When it can happen |
| --- | --- |
| Answers and live submissions reach participants early | Happens during ordinary play. The server delivers the data even when the UI keeps it hidden. |
| Match events reach another room | Ordinary host controls can trigger this when multiple rooms are active. |
| Shipped admin credentials remain usable | A stock single-venue install exposes them whenever the server is reachable. |
| A stale socket retains privileges | A game socket can remain connected through account recovery or session expiry. |
| Malformed handshake crashes the process | The stock client sends a string token or omits it. This requires malformed input from a custom or broken client. |
| Viewers use host controls | The stock viewer UI does not send these controls. The backend accepts them from a viewer connection. |
| Imported media executes on the app origin | Requires an archive containing active content and a signed-in user opening the imported file as a document. |
| Archive import exhausts resources | A legitimate but unusually large or highly compressed archive can trigger it. |

## High severity

1. **Unauthenticated Socket.IO input can crash the process.** The handshake passes an unvalidated token to the session hash. A truthy value of the wrong type throws before authentication completes, and the middleware lets the exception escape. A separate obstacle handler indexes room state without validating the input. Validate handshake and event payloads at ingress and handle exceptions at the socket boundary. [Handshake](../legendary/src/sockets/index.ts#L72) · [Session lookup](../legendary/src/services/session.store.ts#L67) · [Obstacle controls](../legendary/src/sockets/vcnv.handlers.ts#L90)
2. **Viewers can control matches, and some game events cross room boundaries.** Role checks are missing on match start, clock pause, obstacle reveal, and Speed Round answer clearing. Match start and Warm-up question handlers broadcast across the default namespace. Enforce roles per event and route all game broadcasts through the room channel. [Match controls](../legendary/src/sockets/common.handlers.ts#L11) · [Warm-up broadcasts](../legendary/src/sockets/kd.handlers.ts#L46) · [Speed Round controls](../legendary/src/sockets/tt.handlers.ts#L108)
3. **Round responses expose answers before reveal.** HTTP strips Warm-up questions for non-admins but returns full data for the other rounds. In single-venue mode, those reads are anonymous. Socket.IO also sends full round state and live player submissions to the room. Define role- and phase-specific responses for both transports. [HTTP reads](../legendary/src/http/match.routes.ts#L147) · [Round broadcasts](../legendary/src/http/match.routes.ts#L61) · [Live submissions](../legendary/src/sockets/tt.handlers.ts#L51)
4. **Imported media can execute on the application origin.** A room admin can import archive files that bypass the upload extension allowlist. Public room media uses an extension-derived content type. If a signed-in user opens imported active content, it could read Legion bearer tokens from local storage. Validate media bytes and types on every import path and serve untrusted content from a separate origin. [Archive import](../legendary/src/services/legion-file.service.ts#L185) · [Media serving](../legendary/src/http/media.routes.ts#L275) · [Account token storage](src/app/host/host-login-dialog.component.ts#L53)
5. **Archive imports can exhaust memory or stall every room.** Uploads are buffered and decompressed synchronously. The media total is checked after each entry expands, and the editor JSON is outside that total. A self-registered host can reach the room import path. Bound decompressed bytes per entry and per archive, cap concurrent imports, and move decompression off the main thread. [Upload handling](../legendary/src/http/match.routes.ts#L232) · [Archive parser](../legendary/src/services/legion-file.service.ts#L362)
6. **Reachable single-venue installs accept shipped admin credentials.** Single-venue mode is the default. Startup warns about shipped secrets and still binds on all interfaces. Bind to loopback by default and require custom secrets before enabling network access. [Defaults](../legendary/src/config.ts#L83) · [Startup](../legendary/src/index.ts#L35) · [Listener](../legendary/src/index.ts#L74)

## Medium severity

- **Session revocation is incomplete.** Game sockets retain their handshake identity after expiration or account recovery. Concurrent recovery requests can both pass the one-time-code check before hashing completes. An old-password login already in flight can issue a session after recovery. Invalidate game sockets on expiry or revocation and use an atomic credential version check for login and recovery. [Socket lifecycle](../legendary/src/sockets/index.ts#L72) · [Credential storage](../legendary/src/services/account.store.ts#L149) · [Recovery route](../legendary/src/http/account.routes.ts#L121)
- **Server branding authority depends on username registration order.** A public signup can claim an unregistered allowlisted username and gain server-wide branding access. Provision operator accounts separately and authorize by stable account ID. [Signup](../legendary/src/http/account.routes.ts#L71) · [Branding authorization](../legendary/src/http/media.routes.ts#L61)
- **Anonymous lobby connections bypass the per-IP socket cap.** The lobby path returns before connection accounting. Count lobby connections and bound transport admission. [Connection accounting](../legendary/src/sockets/index.ts#L64)
- **Runtime data can be committed accidentally.** Account, session, and bank data were already present as untracked files. Hosted room metadata is also eligible for staging and contains cleartext room secrets. Ignore runtime paths while preserving fixtures and restrict data directory permissions. [Ignore rules](../legendary/.gitignore) · [Room persistence](../legendary/src/rooms/room.registry.ts#L155)

## Verification

All 11 existing checks passed against an isolated build, including both restart checks after a rerun outside the Windows sandbox. Both production-only and full `npm audit` reported zero advisories. Findings are based on tracing the application source. The backend was unchanged.
