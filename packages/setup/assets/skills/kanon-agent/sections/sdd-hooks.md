# SDD Orchestrator Hooks

## Overview

When running SDD phases in the kanon project, the orchestrator MUST integrate Kanon issue tracking with each phase transition.

## State Transitions per Phase

| Phase completes | Issue action |
|-----------------|-------------|
| sdd-explore | Update issue description with exploration summary |
| sdd-spec | Transition issue to in_progress; enrich with spec link |
| sdd-apply | Update issue with apply-progress artifact reference |
| sdd-verify | Transition to review; note verify report result |
| sdd-archive | Transition to done; link archive report |

## deferred_items Processing

When a phase returns `deferred_items` in its result envelope:
1. For each deferred item: kanon_create_roadmap_item({ projectKey, title: "[Area] Verb phrase", horizon: "later", description })
2. Reference the roadmap item key in the apply-progress or verify-report artifact
3. Do not add deferred items to the current cycle's scope

## ROADMAP Injection

Before launching any SDD sub-agent, the orchestrator SHOULD:
1. kanon_list_roadmap({ projectKey, format: compact, limit: 10 }) → surface relevant prior art
2. Include top roadmap items in the sub-agent prompt as context under ## Roadmap Context
3. This prevents re-inventing work that was already deferred with context
