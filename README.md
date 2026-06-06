# omp-agent-template

Agentic starter kit for [Oh My Pi](https://github.com/oh-my-pi) projects.

Clone this repo to bootstrap a new project with a pre-configured agent team, development protocol, and skill definitions.

## What's included

| File | Purpose |
|---|---|
| `AGENTS.md` | Agent registry — roles, traits, protocols for Elon, DrPe, HR, LeadDev, ReqGuru, Validator, DocWorm |
| `PROTO.md` | Five-phase development protocol: REQUEST → GRILL → SPEC → DEVELOP+VALIDATE → DONE |
| `.agents/skills/` | Per-agent skill definitions loaded by the harness |

## Usage

```bash
git clone https://github.com/YOU/omp-agent-template.git my-project
cd my-project
rm -rf .git && git init
# Start building — Elon is ready to route your first request
```

## The team

- **Elon** — orchestrator, routes all work
- **DrPe** — research, web/API lookups
- **HR** — hires new specialist agents
- **LeadDev** — ships production-grade code
- **ReqGuru** — grills requirements until fully resolved
- **Validator** — audits implementation against spec
- **DocWorm** — maintains README.md and project documentation
