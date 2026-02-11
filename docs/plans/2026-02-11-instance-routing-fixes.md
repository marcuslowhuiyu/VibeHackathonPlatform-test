# Instance Routing Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix white screen on Vibe/Vibe Pro instances and broken routing on Cline/Continue instances when accessed through CloudFront → ALB path-based routing.

**Architecture:** All instances are served behind a shared ALB with path-based routing (`/i/{instanceId}/*`). The ALB forwards the full path to containers on port 8080. Each container must handle the subpath prefix correctly. Vibe needs relative asset URLs; Cline/Continue need OpenVSCode Server's `--serverBasePath` flag.

**Tech Stack:** Vite (client build), Express (vibe server), OpenVSCode Server (cline/continue), AWS ALB, CloudFront

---

### Task 1: Fix Vibe/Vibe Pro white screen — set relative base in Vite config

**Files:**
- Modify: `vibe-instance/client/vite.config.ts:5`

**Step 1: Apply the fix**

Change `vite.config.ts` to add `base: './'`:

```typescript
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
      },
    },
  },
});
```

This changes built asset references from absolute (`/assets/main.js`) to relative (`./assets/main.js`). When the browser is at `/i/{instanceId}/`, it resolves `./assets/main.js` to `/i/{instanceId}/assets/main.js`, which matches the ALB path rule and reaches the container.

**Step 2: Verify the fix locally**

Run:
```bash
cd vibe-instance/client && npm install && npm run build
```

Then inspect `vibe-instance/client/dist/index.html` and confirm asset paths start with `./` not `/`:
- Expected: `<script type="module" src="./assets/index-xxxxx.js">`
- NOT: `<script type="module" src="/assets/index-xxxxx.js">`

**Step 3: Commit**

```bash
git add vibe-instance/client/vite.config.ts
git commit -m "fix(vibe): set relative base path in Vite config to fix white screen

Assets were built with absolute paths (base: '/'), causing 404s when
served behind ALB path-based routing at /i/{instanceId}/. Changing to
relative paths (base: './') ensures assets resolve correctly at any
subpath depth."
```

---

### Task 2: Fix Cline instance — add --serverBasePath to entrypoint

**Files:**
- Modify: `cline-instance/entrypoint.sh:134-138`

**Step 1: Apply the fix**

Change the OpenVSCode Server launch command to include `--serverBasePath`:

```bash
# Determine base path for ALB routing
SERVER_BASE_PATH=""
if [ -n "$INSTANCE_ID" ]; then
    SERVER_BASE_PATH="/i/${INSTANCE_ID}"
    echo "  Server base path: ${SERVER_BASE_PATH}"
fi

exec /home/.openvscode-server/bin/openvscode-server \
    --host 0.0.0.0 \
    --port 8080 \
    --without-connection-token \
    --default-folder /home/workspace \
    ${SERVER_BASE_PATH:+--serverBasePath "$SERVER_BASE_PATH"}
```

The `${SERVER_BASE_PATH:+...}` syntax only adds the flag when `SERVER_BASE_PATH` is non-empty, so it's backward-compatible if `INSTANCE_ID` is not set.

**Step 2: Commit**

```bash
git add cline-instance/entrypoint.sh
git commit -m "fix(cline): add --serverBasePath for ALB path-based routing

OpenVSCode Server was receiving requests at /i/{instanceId}/ but didn't
know about the path prefix, causing broken routing through CloudFront/ALB.
The --serverBasePath flag tells it to handle the subpath correctly."
```

---

### Task 3: Fix Continue instance — add --serverBasePath to entrypoint

**Files:**
- Modify: `continue-instance/entrypoint.sh:165-169`

**Step 1: Apply the fix**

Same change as Cline. Replace the server launch block:

```bash
# Determine base path for ALB routing
SERVER_BASE_PATH=""
if [ -n "$INSTANCE_ID" ]; then
    SERVER_BASE_PATH="/i/${INSTANCE_ID}"
    echo "  Server base path: ${SERVER_BASE_PATH}"
fi

exec /home/.openvscode-server/bin/openvscode-server \
    --host 0.0.0.0 \
    --port 8080 \
    --without-connection-token \
    --default-folder /home/workspace \
    ${SERVER_BASE_PATH:+--serverBasePath "$SERVER_BASE_PATH"}
```

**Step 2: Commit**

```bash
git add continue-instance/entrypoint.sh
git commit -m "fix(continue): add --serverBasePath for ALB path-based routing

Same fix as cline-instance. OpenVSCode Server needs --serverBasePath to
correctly handle requests arriving at /i/{instanceId}/ through the
shared ALB."
```

---

### Task 4: Verify all fixes together

**Step 1: Verify vibe client build output**

```bash
cd vibe-instance/client && npm run build
```

Check `dist/index.html` has relative asset paths (`./assets/...`).

**Step 2: Verify entrypoint scripts are valid**

```bash
bash -n cline-instance/entrypoint.sh
bash -n continue-instance/entrypoint.sh
```

Both should exit with code 0 (no syntax errors).

**Step 3: Final commit (if any cleanup needed)**

Only if adjustments were needed from verification.
