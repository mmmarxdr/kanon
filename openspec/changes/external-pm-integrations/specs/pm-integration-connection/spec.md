# PM Integration Connection Specification

## Purpose

Define secure owner-managed connection lifecycle behavior.

## Requirements

### Requirement: PMCN-01 Owner-Controlled Draft and Binding

The system MUST permit only an `owner` to create or configure a connection. A new connection MUST be `draft`; its owner MUST select an existing discovered Redmine project. Remote project creation MUST be a separate owner action, never a creation side effect.

#### Scenario: Owner creates a draft
- GIVEN an authenticated owner and a valid connection request
- WHEN the owner creates a connection
- THEN the system persists one draft connection

#### Scenario: Owner binds discovered project
- GIVEN an owner has authenticated discovery results
- WHEN the owner selects an existing remote project
- THEN the draft records that binding without creating a remote project

#### Scenario: Non-owner creation is rejected
- GIVEN an authenticated admin who is not an owner
- WHEN the admin creates a connection
- THEN the system returns HTTP 403 and persists no connection

### Requirement: PMCN-02 Safe Lifecycle and Bootstrap

The system MUST support draft, active, paused, and disabled states. Activation MUST require an SSRF-safe endpoint, project binding, confirmed maps, and credentials. Bootstrap MUST atomically link an owner/admin credential for discovery and inbound operations; it MUST NOT authorize outbound fallback until owner-enabled. Paused or disabled connections MUST stop polling, retries, and dispatch while preserving audit/history; reactivation MUST revalidate prerequisites.

#### Scenario: Atomic activation bootstrap
- GIVEN a valid draft and initial credential
- WHEN bootstrap commits and activation is requested
- THEN all required records exist together and workers start only after active state is committed

#### Scenario: Bootstrap credential is not fallback by default
- GIVEN bootstrap linked an owner/admin credential for discovery
- WHEN a user-originated outbound write lacks the actor credential
- THEN the linked credential is not used unless an owner enabled fallback

#### Scenario: Bootstrap failure rolls back
- GIVEN credential linkage fails during bootstrap
- WHEN the transaction is rolled back
- THEN no partial connection or credential linkage remains

#### Scenario: Disabled connection gates workers
- GIVEN an owner disables an active connection
- WHEN disablement completes
- THEN no new poll, retry, or outbound request is dispatched

### Requirement: PMCN-03 SSRF-Safe Remote Requests

The system MUST allow HTTPS endpoints by default and reject URL credentials, non-HTTP(S), IPv4/IPv6 loopback, private, link-local, unspecified, broadcast, ULA, and metadata targets. Public HTTP MAY be allowed only by explicit deployment opt-in with an owner-visible warning. Redirects MUST be disabled or every hop MUST be fully revalidated without forwarding credentials across origin or scheme changes. Every request and redirect target MUST be DNS-resolved and connect-time pinned to a vetted address.

#### Scenario: Safe public HTTPS request
- GIVEN a public HTTPS endpoint whose resolved and pinned address is public
- WHEN validation and a provider request run
- THEN the request proceeds using the vetted address

#### Scenario: Rebinding or unsafe redirect is blocked
- GIVEN a validated endpoint rebinds to a private address or redirects unsafely
- WHEN a request resolves or follows the redirect
- THEN it is blocked before credential disclosure and the failure is auditable

#### Scenario: Unsafe connection creation persists nothing
- GIVEN an owner supplies a private, credential-bearing, or non-HTTPS URL without HTTP opt-in
- WHEN connection creation is validated
- THEN no connection or credential is persisted and no credential is disclosed

### Requirement: PMCN-04 Credential Rotation and Audit

The system MUST provide a re-encryption operation that detects every undecryptable credential, writes no silent skips, and can safely rerun.

#### Scenario: Rotation succeeds
- GIVEN credentials decrypt with the old key
- WHEN re-encryption completes with a new key
- THEN each credential decrypts with the new key

#### Scenario: Rotation detects failure
- GIVEN one credential cannot decrypt
- WHEN detection or rotation runs
- THEN it is reported and MUST NOT be silently treated as migrated
