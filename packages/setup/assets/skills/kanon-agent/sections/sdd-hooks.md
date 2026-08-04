---
name: sdd-hooks
description: SDD orchestrator hooks for Kanon issue tracking across phase transitions and deferred_items.
---

# SDD Orchestrator Hooks

## Overview

When running SDD phases in the kanon project, the orchestrator MUST integrate Kanon issue tracking with each phase transition.

## State Transitions per Phase

<!-- Audience: orchestrator (kanon-agent) — ships via setup package -->
| Phase completes | Issue action |
|-----------------|-------------|
| sdd-explore | Add a PM-facing outcome summary: problem, evidence, options |
| sdd-spec | Transition to in_progress; summarize accepted behavior |
| sdd-apply | Summarize implemented behavior and material decisions |
| sdd-verify | Transition to review; summarize verification and residual risk |
| sdd-archive | Transition to done; summarize final outcome |

Use a repository-relative design reference only when it helps the reader. Never publish worktree,
temporary branch, absolute path, agent/model/session, memory, harness, or command metadata.

## deferred_items Processing

Deferred-item capture: see roadmap.md (SDD Phase: deferred_items Processing section).

## ROADMAP Injection

Before launching any SDD sub-agent, the orchestrator SHOULD:
1. kanon_list_roadmap({ projectKey, format: compact, limit: 10 }) → surface relevant prior art
2. Include top roadmap items in the sub-agent prompt as context under ## Roadmap Context
3. This prevents re-inventing work that was already deferred with context
