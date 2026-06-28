# Ideas

Stored ideas/suggestions for the Elon protocol. One block per idea, newest
appended at the end. Human-editable; lifecycle governed by the `status` field
on each block. Writes are owned by DocWorm (Elon commits via `[PROTO]`).

Status values:
- `parked` — captured, awaiting decision. Surfaced by reminder matching on related turns.
- `promoted` — promoted into a fresh `.app/REQ.md` to launch the FULL workflow. Block is kept for audit (`promoted_to`, `promoted_at`).
- `rejected` — decided not to pursue. Block is kept; may be re-opened later by setting `status: parked`.
- `superseded` — replaced by another idea; points to the replacement via `superseded_by`.

```idea
id: IDEA-001
created: 2026-06-28T00:00:00Z
source: /idea
title: Hire an additional team agent role
tags: agents, team, hiring, expansion
status: parked

hire another agent
```

```idea
id: IDEA-002
created: 2026-06-28T00:00:00Z
source: /idea
title: Add debug agent role to the team pipeline
tags: agents, debugging, tooling, team-expansion
status: parked

hire debug agent
```
