# Reviewer Notes

This directory is a small tracked note cache for Codex's recoverability.

Purpose:

- preserve durable review and implementation workflow guidance
- keep follow-up topics close to the repo
- avoid scattering process notes across scratch files and old plans

Usage rules:

- keep notes short and factual
- prefer durable process guidance over point-in-time status snapshots
- keep feature-specific plans and handoff prompts in dedicated worktrees while they are active
- keep only durable reminders and follow-up topics in `.reviewer/`

## Standard Process

### 1. Worktree-first workflow

- use `main` as the stable base
- create a dedicated worktree for each substantial feature, spec import, or review track
- keep imported source specs, test plans, handoff prompts, and implementation notes inside that worktree while the effort is active
- avoid doing substantial feature work directly on `main`

### 2. Spec import and scoping

- before creating a new worktree, fetch `origin`, switch to
  `main`, and fast-forward local `main` to `origin/main`
- create the worktree from that updated `main` tip, not from a
  stale local branch state
- if reusing an existing worktree, sync its base first and
  rebase or recreate the worktree before starting new work

- when external or draft specs drive the work, import them into the feature worktree first
- keep imported source docs separate from derived implementation plans
- distinguish clearly between:
  - runtime/package API support
  - compiler/authored syntax support
  - speculative/provisional surface

### 3. Planning workflow

- iterate on concise implementation plans until they are decision-complete
- review plans with verdict-style prompts that remove ambiguity instead of expanding scope
- keep plans narrow when fixing PR follow-ups; do not restart the whole feature for a small correction
- prefer implementation-ready plans over long exploratory notes

### 4. Implementation handoff

- hand implementation agents one bounded prompt at a time
- if the agent reports a blocker, verify whether it is real before changing scope
- if a blocker is only partial, issue a corrective prompt that narrows the remaining work rather than reopening completed phases
- keep temporary handoff docs in the worktree, not here

### 5. PR review workflow

- review the live PR head, not just local `main`
- findings come first; summaries are secondary
- when a correction is needed, give a prompt that is:
  - narrow
  - mechanical
  - grounded in the current diff
  - backed by a concrete missing test or semantic mismatch
- if no blocking findings remain, say so explicitly and note any residual risk such as pending CI

### 6. Documentation and spec hygiene

- update README, spec, and changeset text when the public surface changes
- keep examples honest about what is:
  - package/runtime API
  - protocol/wire support
  - compiler-supported workflow syntax
- do not let release notes or examples imply authored workflow support if the compiler does not actually support it yet

### 7. Cleanup workflow

- remove disposable worktrees after the task or PR cycle is complete
- verify worktree state before deletion
- by default, remove worktree directories without deleting named branches unless explicitly requested
- use `git worktree prune` after forced removals so Git's registry matches the filesystem

## Follow-Up Topics

- [effectionx-process-epipe-topic.md](/Users/tarasmankovski/Repositories/cowboyd/tisyn/.reviewer/effectionx-process-epipe-topic.md)
- [remote-execution-error-api-topic.md](/Users/tarasmankovski/Repositories/cowboyd/tisyn/.reviewer/remote-execution-error-api-topic.md)
- [protocol-adapter-tests-topic.md](/Users/tarasmankovski/Repositories/cowboyd/tisyn/.reviewer/protocol-adapter-tests-topic.md)
- [transport-future-phases.md](/Users/tarasmankovski/Repositories/cowboyd/tisyn/.reviewer/transport-future-phases.md)
- [ui-embedded-agent-topic.md](/Users/tarasmankovski/Repositories/cowboyd/tisyn/.reviewer/ui-embedded-agent-topic.md)
- [sse-post-transport-topic.md](/Users/tarasmankovski/Repositories/cowboyd/tisyn/.reviewer/sse-post-transport-topic.md)
- [compiler-while-case-a-bindings-topic.md](/Users/tarasmankovski/Repositories/cowboyd/tisyn/.reviewer/compiler-while-case-a-bindings-topic.md)
- [multi-agent-chat-spec-alignment-topic.md](/Users/tarasmankovski/Repositories/cowboyd/tisyn/.reviewer/multi-agent-chat-spec-alignment-topic.md)
- [multi-agent-chat-workflow-boundary-topic.md](/Users/tarasmankovski/Repositories/cowboyd/tisyn/.reviewer/multi-agent-chat-workflow-boundary-topic.md)

## Update Rule

- keep this file process-oriented, not status-oriented
- add durable follow-up topics as separate files instead of overloading this document
- if the workflow changes materially, update the relevant section here instead of appending a dated log
