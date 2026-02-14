# PRD: Monarch Bridge — Dockerized Edition

## Problem Statement

The current Monarch Bridge running on the host machine suffers from persistent **Cloudflare 525 SSL handshake errors** when connecting to `app.monarchmoney.com`. Despite browser-mimicry headers and custom TLS context, Cloudflare's bot detection flags the connection based on the host's residential/datacenter IP fingerprint and TLS stack characteristics. Routing traffic through a mobile carrier IP (via Tailscale exit node on Jesten's phone) reliably bypasses this detection. Running the bridge inside Docker provides the network isolation needed to transparently route *only* Monarch traffic through Tailscale without affecting the host's networking.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Host (WSL2 / Linux)                                         │
│                                                             │
│  Magnus calls:                                              │
│    monarch-bridge <command> [args]                           │
│         │                                                   │
│         ▼                                                   │
│  ┌─────────────────────────────────────────────┐            │
│  │ monarch-bridge wrapper script (host)        │            │
│  │  1. Reads OP_SERVICE_ACCOUNT_TOKEN from env │            │
│  │  2. Runs: docker exec monarch-bridge        │            │
│  │     python3 monarch_bridge.py <cmd> [args]  │            │
│  └──────────────┬──────────────────────────────┘            │
│                 │ docker exec                               │
│  ┌──────────────▼──────────────────────────────┐            │
│  │ Docker Container: monarch-bridge             │           │
│  │                                              │           │
│  │  ┌──────────────────────────────────┐        │           │
│  │  │ Tailscale (userspace networking) │        │           │
│  │  │ Exit Node: Jesten's Phone        │        │           │
│  │  │ (mobile carrier IP)              │        │           │
│  │  └──────────────┬───────────────────┘        │           │
│  │                 │ all traffic routed via TS   │           │
│  │  ┌──────────────▼───────────────────┐        │           │
│  │  │ monarch_bridge.py               │         │           │
│  │  │ + op CLI (injected token)       │         │           │
│  │  │ + monarchmoney library          │         │           │
│  │  └─────────────────────────────────┘         │           │
│  └──────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────┘
```

## Core Requirements

### 1. Docker Container

- **Base Image:** `python:3.12-slim` (minimal footprint).
- **Long-Running:** The container runs as a persistent daemon (`docker run -d --restart=unless-stopped`). Magnus invokes commands via `docker exec`, avoiding cold-start latency from `docker run` per invocation.
- **Container Name:** `monarch-bridge` (deterministic, no random suffixes).
- **No Host Network:** The container MUST NOT use `--network=host`. It uses its own isolated network namespace so Tailscale controls all egress.

### 2. Tailscale Integration (Cloudflare Bypass)

- **Purpose:** Route all container traffic through a Tailscale exit node running on Jesten's phone (mobile carrier IP). Cloudflare does not flag mobile carrier IPs with the same aggressive bot detection as residential/datacenter IPs.
- **Tailscale Mode:** Run `tailscaled` in **userspace networking mode** (`--tun=userspace-networking`) inside the container. This avoids requiring `--cap-add=NET_ADMIN` or `/dev/net/tun` device access.
- **Auth:** Use a Tailscale auth key (pre-authorized, ephemeral, tagged `tag:monarch-bridge`) stored in 1Password. Injected at container start via `OP_SERVICE_ACCOUNT_TOKEN` → `op read`.
- **Exit Node:** `tailscale up --exit-node=<phone-node-name> --exit-node-allow-lan-access=false --accept-routes`.
- **Health Check:** The container entrypoint should verify Tailscale is connected and the exit node is active before accepting commands. Expose a simple health marker (e.g., `/tmp/ts-healthy` file) that the wrapper script can check.
- **Fallback:** If the exit node (phone) is offline, the bridge should fail loudly with a clear error rather than silently falling back to the container's default route.

### 3. Security

- **Read-Only Enforcement:** Unchanged from v1. The Python CLI exposes ONLY getter methods. No write/update/delete operations.
- **1Password Credentials:**
  - The `OP_SERVICE_ACCOUNT_TOKEN` is passed into the container as an environment variable at `docker run` time.
  - The `op` CLI is installed in the Docker image.
  - At command execution time, `monarch_bridge.py` calls `op read` to fetch Monarch credentials from the `Magnus Agent Vault`, exactly as it does today.
  - **No credentials are baked into the image.** The image contains only code and dependencies.
- **Tailscale Auth Key:** Stored in 1Password (`Magnus Agent Vault/Tailscale Monarch Bridge/auth-key`). Retrieved by the host wrapper script via `op read` and passed to the container at start.
- **Session File:** The `.session` file (Monarch auth cache) lives inside the container's filesystem. It is ephemeral — lost on container recreation, which is acceptable (re-auth is automatic).
- **Image Scanning:** The Dockerfile should produce a minimal image. No unnecessary packages. Consider a multi-stage build if build-time deps differ from runtime.
- **Container Capabilities:** Minimal. No `--privileged`, no `--cap-add=NET_ADMIN`. Userspace Tailscale avoids kernel requirements.

### 4. Host Interface (Wrapper Script)

Magnus calls a single wrapper script on the host that abstracts all Docker complexity:

```bash
# Usage (identical to current CLI interface):
monarch-bridge accounts
monarch-bridge transactions --limit 10 --search "Amazon"
monarch-bridge net-worth
```

**Wrapper Responsibilities:**
1. Verify the `monarch-bridge` container is running and healthy (Tailscale connected).
2. If not running, start it (pull image if needed, inject secrets).
3. Execute `docker exec monarch-bridge python3 /app/monarch_bridge.py <args>` and pass stdout/stderr through.
4. Return the same exit code as the inner command.

**Wrapper Location:** `skills/monarch-bridge/monarch-bridge.sh` (symlinked or aliased into PATH).

### 5. Efficiency & Output

- **Token-Dense Output:** Unchanged from v1. All output is compact, formatted for LLM consumption (no verbose banners, no progress bars).
- **Cold Start:** With a persistent container, there is no Docker cold-start penalty. First `tailscale up` after container creation takes ~3-5s; subsequent commands are instant.
- **Session Caching:** Monarch session caching (`.session` file) continues to work inside the container, minimizing re-auth round-trips.

## File Layout

```
skills/monarch-bridge/
├── PRD.md                  # Original PRD (v1, host-native)
├── PRD-docker.md           # This document (v2, dockerized)
├── SKILL.md                # Agent-facing skill docs (update post-implementation)
├── monarch_bridge.py       # Core CLI tool (unchanged, copied into image)
├── requirements.txt        # Python deps (unchanged)
├── Dockerfile              # Container image definition
├── docker-compose.yml      # Optional: declarative container config
├── entrypoint.sh           # Container entrypoint (starts tailscaled, waits for health, then idles)
├── monarch-bridge.sh       # Host wrapper script (Magnus calls this)
└── .env.example            # Documents required env vars (no real secrets)
```

## Implementation Plan

### Phase 1: Container Foundation
1. Write `Dockerfile` — install Python deps, `op` CLI, `tailscale`/`tailscaled` binaries.
2. Write `entrypoint.sh` — starts `tailscaled` in userspace mode, runs `tailscale up` with exit node, writes health marker.
3. Test container builds and Tailscale connectivity.

### Phase 2: Host Integration
1. Write `monarch-bridge.sh` — wrapper that manages container lifecycle and proxies commands.
2. Test end-to-end: `monarch-bridge.sh net-worth` from host returns data via Tailscale exit node.
3. Update `SKILL.md` with new usage instructions pointing to the wrapper.

### Phase 3: Hardening
1. Verify no credentials leak into image layers (`docker history`, `docker inspect`).
2. Add container health check (`HEALTHCHECK` in Dockerfile or wrapper-level check).
3. Test failure modes: exit node offline, `op` token expired, Monarch session stale.
4. Test container restart recovery (does Tailscale reconnect automatically?).

## Success Criteria

- [ ] `monarch-bridge net-worth` returns data when Jesten's phone is acting as Tailscale exit node.
- [ ] Same command fails with a clear error when the exit node is unreachable (no silent fallback).
- [ ] `docker inspect monarch-bridge` shows no secrets in environment or image layers (token passed at runtime only).
- [ ] Container restarts cleanly after `docker restart monarch-bridge`.
- [ ] All five existing commands (`accounts`, `account-details`, `transactions`, `categories`, `net-worth`) work identically through the wrapper.
- [ ] The Cloudflare 525 error is eliminated.

## Open Questions

1. **Tailscale Auth Key Rotation:** Ephemeral keys expire. Should the wrapper script handle re-provisioning, or should we use a reusable (non-ephemeral) key with the `tag:monarch-bridge` ACL?
2. **Phone Availability:** Jesten's phone may be off or lose connectivity. Should we add a secondary exit node (e.g., a cloud VPS with a clean residential IP) as a fallback?
3. **Container Updates:** When `monarch_bridge.py` changes, should we rebuild the image or volume-mount the script from the host for faster iteration during development?
