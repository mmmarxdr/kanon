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
| sdd-explore | Update issue description with exploration summary |
| sdd-spec | Transition issue to in_progress; enrich with spec link |
| sdd-apply | Update issue with apply-progress artifact reference |
| sdd-verify | Transition to review; note verify report result |
| sdd-archive | Transition to done; link archive report |

## deferred_items Processing

Deferred-item capture: see roadmap.md (SDD Phase: deferred_items Processing section).

## ROADMAP Injection

Before launching any SDD sub-agent, the orchestrator SHOULD:
1. kanon_list_roadmap({ projectKey, format: compact, limit: 10 }) → surface relevant prior art
2. Include top roadmap items in the sub-agent prompt as context under ## Roadmap Context
3. This prevents re-inventing work that was already deferred with context
