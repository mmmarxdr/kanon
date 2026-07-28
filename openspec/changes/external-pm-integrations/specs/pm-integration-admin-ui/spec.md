# PM Integration Admin UI Specification

## Purpose

Provide owner configuration, personal credential connection, and truthful operational visibility.

## Requirements

### Requirement: PMAU-01 Configurable Connection Administration

The system MUST permit only an owner to create, configure, activate, pause, or disable a connection. The UI MUST let that owner select discovered project and status maps, explicitly confirm write maps, and choose permitted service fallback. Non-owners MUST NOT be presented with an actionable mutation control.

#### Scenario: Owner completes configuration
- GIVEN discovery, binding, maps, and credentials satisfy activation prerequisites
- WHEN the owner confirms configuration
- THEN the UI reports the active connection and its selected project

#### Scenario: Incomplete configuration
- GIVEN a required map, binding, or credential is missing
- WHEN activation is attempted
- THEN the UI reports the unmet prerequisite and keeps the connection inactive

### Requirement: PMAU-02 Personal Credential Connection

The UI MUST let a member connect or clear their own credential. Clearing MUST remove future eligibility for personal-authenticated writes without altering another member's credential or the optional service fallback.

#### Scenario: Member connects credential
- GIVEN an active connection
- WHEN a member submits a valid personal credential
- THEN subsequent user-originated writes by that member are eligible for personal authentication

#### Scenario: Member clears credential
- GIVEN a member has a connected credential
- WHEN the member clears it
- THEN that member becomes uncovered for personal sync and other credentials remain unchanged

### Requirement: PMAU-03 Defined Coverage and Operational State

The system MUST display separate metrics: assignee external-identity coverage is distinct assigned members in the selected connection/project divided into those with a bound external identity; initiating-actor outbound-authentication coverage is distinct actors of eligible outbound writes in the selected reporting period divided into those with a valid personal credential. It MUST expose each uncovered assignee's stable member identifier and display name, never credentials. It MUST define `connected` as a valid personal credential, `active` as lifecycle-active, `syncing` as active with timely polling and no blocking work, and `degraded` as active with failed/dead work, stale polling, uncovered assignees, or role-ceiling mismatches. Owners and admins MUST have read-only access to queryable dead letters, conflicts, last successful poll, oldest retry age, and role-ceiling mismatches; only owners MAY mutate connection state or requeue work.

#### Scenario: Coverage metrics are computed separately
- GIVEN ten distinct assigned members, seven with external identities, and five eligible initiating actors with four personal credentials
- WHEN an owner views coverage
- THEN it displays assignee identity coverage as 7 of 10 and actor authentication coverage as 4 of 5

#### Scenario: Admin identifies uncovered assignees
- GIVEN three assigned members lack external identities
- WHEN an admin views assignee coverage
- THEN the UI lists each member's stable identifier and display name without credential material

#### Scenario: Degraded state is actionable
- GIVEN an active connection has a dead letter or stale poll
- WHEN an owner views its status
- THEN it is marked degraded and exposes the affected record for controlled requeue or review

#### Scenario: Admin has read-only health access
- GIVEN an admin who is not an owner
- WHEN the admin views coverage or health
- THEN the system permits read-only access and rejects state mutation or requeue
