# Reliability & Scale Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the Vibe Hackathon Platform reliable and performant at 200+ concurrent instances for enterprise hackathons.

**Architecture:** EFS-based snapshots for recovery, two-tier locking (admin + participant), SQLite for concurrent DB access, batched AWS API calls, and an automated stress test script.

**Tech Stack:** SQLite (better-sqlite3), react-window, AWS EFS, ECS Exec

---

## 1. EFS Snapshots & Instance Recovery

### Snapshot Storage

Each instance ECS task definition mounts a shared EFS volume at `/mnt/snapshots/{instanceId}/`. Snapshots contain only the project directory (`/home/workspace/project/`), excluding `node_modules/`, `.git/`, and `dist/`.

### Auto-Snapshot

A background interval inside the vibe/cline/continue containers runs every 10 minutes:

```bash
tar czf /mnt/snapshots/${INSTANCE_ID}/snapshot-$(date +%Y%m%dT%H%M%S).tar.gz \
  --exclude='node_modules' --exclude='.git' --exclude='dist' \
  -C /home/workspace project
```

Keep the last 5 snapshots per instance. Prune older ones after each new snapshot.

### Manual Snapshot

New dashboard API endpoint: `POST /api/instances/:id/snapshot`
- Uses ECS Exec to trigger a snapshot inside the running container
- Returns the snapshot filename and timestamp

### Restore

New dashboard API endpoint: `POST /api/instances/:id/restore`
- Takes a `snapshotFile` parameter
- Uses ECS Exec to extract the tar over the project directory
- Vite auto-detects file changes and reloads

### Clone & Swap

New dashboard API endpoint: `POST /api/instances/:id/clone`
1. Spin up a fresh instance with the same `ai_extension`
2. Copy latest snapshot from `/mnt/snapshots/{oldId}/` to `/mnt/snapshots/{newId}/`
3. New instance extracts the snapshot on startup
4. Re-assign participant to the new instance
5. Stop and clean up the old instance

### Cleanup

When an instance is deleted, the dashboard deletes `/mnt/snapshots/{instanceId}/` entirely. No orphaned snapshots.

**EFS cost estimate:** ~5 GB max for 200 instances × 5 snapshots each → ~$1.50/month.

---

## 2. Instance Locking

### Admin Lock

- New `admin_locked: boolean` field on the Instance model (default: `false`)
- When locked: Stop, Delete, and bulk "Stop All" / "Delete All" skip that instance
- Admin must explicitly unlock before managing the instance
- New endpoints: `POST /api/instances/:id/lock`, `POST /api/instances/:id/unlock`
- Bulk actions: `POST /api/instances/lock-all`, `POST /api/instances/unlock-all`
- UI: Lock icon on instance card, disabled action buttons when locked

### Participant Lock ("Pencils Down")

- New `participant_locked: boolean` field on the Instance model (default: `false`)
- When locked:
  - Vibe instances: agent rejects new messages, file write/edit tools return error
  - Cline/Continue instances: a lock file is written that the entrypoint checks
  - Vite dev server keeps running so judges can still view the preview
- Participant sees a banner: "Submissions are locked. Your project has been frozen for judging."
- New endpoints: `POST /api/instances/:id/freeze`, `POST /api/instances/:id/unfreeze`
- Bulk actions: `POST /api/instances/freeze-all`, `POST /api/instances/unfreeze-all`

### Lock State Propagation

The dashboard pushes lock state to running containers via:
1. Vibe instances: new `/api/lock-status` endpoint on the instance server, polled by the agent loop
2. Cline/Continue instances: ECS Exec to write/remove a lock file that the entrypoint watches

---

## 3. Database Migration (JSON → SQLite)

### Why

The current JSON file database (`db.json`) does synchronous full-file reads/writes. At 200+ instances with concurrent status polling, this causes:
- Write contention (data loss on concurrent writes)
- Slow reads as file grows
- No query capability

### Migration

- Replace `db/database.ts` with SQLite using `better-sqlite3` (synchronous, no async overhead)
- Same EFS mount point (`/mnt/efs/data/`)
- Schema mirrors current Instance and Participant models
- Migration script to convert existing `db.json` → SQLite on first startup
- All existing `getInstanceById`, `updateInstance`, etc. functions keep the same API

---

## 4. Dashboard UI at Scale

### Virtualized Instance List

- Use `react-window` for the instance list to handle 200+ rows without lag
- Only render visible rows, recycle DOM elements on scroll

### Batched Status Polling

Current: GET `/api/instances` calls `getTaskStatus()` once per running instance (N AWS API calls).

New: Use ECS `DescribeTasks` which accepts up to 100 task ARNs per call. Batch all running instance task ARNs into 1-2 API calls instead of 200.

### Filtering & Search

- Filter by status (running, stopped, provisioning)
- Filter by extension type (vibe, cline, continue)
- Search by participant name or instance ID
- Pagination: 50 instances per page

---

## 5. Stress Test Script

### Usage

```bash
npm run stress-test -- --count=50 --extension=vibe --teardown
npm run stress-test -- --count=200 --extension=vibe --no-teardown  # keep instances for inspection
```

### What It Measures

| Metric | Target |
|--------|--------|
| Time to spin up N instances | < 5 min for 100, < 10 min for 200 |
| Health check pass rate | > 98% |
| ALB rule creation success | 100% |
| Dashboard API response time (GET /instances) | < 2s at 200 instances |
| Bedrock concurrent chat (simulated) | Measure throttle rate |

### Phases

1. **Provision**: Spin up `--count` instances in batches of 20 (avoid ECS rate limits)
2. **Wait**: Poll until all instances are healthy or timeout (10 min)
3. **Report**: Print success/failure counts, timing stats, any errors
4. **Chat Load** (optional `--chat`): Send a test message to each instance, measure response times
5. **Teardown**: Stop and delete all test instances (unless `--no-teardown`)

### AWS Limits to Pre-Check

The script verifies these before starting:
- ECS Fargate task quota (need 200+ available)
- ALB rules per listener (default 100 — need increase)
- ECS service task count
- Bedrock model invocation limits

### Output

```
=== Stress Test Results ===
Instances requested:  200
Successfully started: 198
Failed to start:      2
Time to all healthy:  7m 23s
Avg time per instance: 2.2s
ALB rules created:    198/198
Health check pass:    196/198 (99%)
Errors:
  - vibe-vb-x8k2q: ECS task failed to start (resource limit)
  - vibe-vb-a9m3r: ALB rule creation timeout
===========================
```

---

## Implementation Order

1. SQLite migration (foundation for everything else)
2. Admin lock + participant lock (quick win, high value for hackathon day)
3. EFS snapshots + restore + clone
4. Batched status polling + UI virtualization
5. Stress test script
