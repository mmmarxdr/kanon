# PM Integration Core Specification

## Purpose

Define provider-neutral contracts, mapping, and protected credentials for opt-in PM integrations. KAN-180 encryption and KAN-181 base schema are existing prerequisites.

## Requirements

### Requirement: PMIC-01 Canonical Model and Ports

The system MUST expose provider-neutral canonical issue, project, cycle, user, and mapping values without provider-specific leakage. `PmProviderAdapter` MUST contain only outbound mutation and provider-discovery operations; inbound polling MUST be exposed only through a separate `InboundSource` port.

#### Scenario: Canonical outbound mapping
- GIVEN a Kanon issue with mapped assignee, estimate, dates, progress, and status
- WHEN it is prepared for a provider write
- THEN the canonical value contains every mapped field and no Redmine-specific type

#### Scenario: Inbound port separation
- GIVEN a sync engine needs remote changes
- WHEN it requests a poll
- THEN it uses `InboundSource` and MUST NOT call a pull method on `PmProviderAdapter`

### Requirement: PMIC-02 Explicit Status and Field Maps

The system MUST persist a read map from remote status to Kanon state and a separately owner-confirmed write map from Kanon state to remote status. Activation MUST require one deterministic writable remote status for every writable Kanon state; the write map MUST NOT be inferred by inversion. Canonical optional fields MUST distinguish absent/no-change from explicit `null`/clear, which MUST clear the corresponding remote field only where that field is mapped and writable.

#### Scenario: Confirmed directional maps activate
- GIVEN discovered remote statuses and complete owner-confirmed read and write maps
- WHEN the owner activates the connection
- THEN inbound uses remote→Kanon and outbound uses Kanon→remote deterministically

#### Scenario: Incomplete or ambiguous map blocks activation
- GIVEN a writable Kanon state lacks exactly one remote target
- WHEN activation is requested
- THEN activation is rejected and no worker is started

### Requirement: PMIC-03 Credential Confidentiality

The system MUST encrypt stored PM credentials at rest with AES-256-GCM using the configured integration encryption key and MUST NOT persist plaintext tokens.

#### Scenario: Credential persistence
- GIVEN a member submits an API token
- WHEN the credential is stored
- THEN persisted credential material is ciphertext rather than the submitted token

#### Scenario: Missing encryption prerequisite
- GIVEN encryption cannot be performed with the configured key
- WHEN credential storage is requested
- THEN the request fails without persisting usable plaintext or a partial credential
