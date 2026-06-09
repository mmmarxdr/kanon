# notification-realtime Specification

## Purpose

Live propagation of notification lifecycle events over the existing workspace SSE channel. When a notification is created or marked as read, domain events are emitted so connected web clients can invalidate their query cache without polling.

## Requirements

### Requirement: Emit notification.created on notification creation

The system MUST emit a `notification.created` domain event after every successful notification DB write — both single-row inserts and batch inserts — without blocking or rolling back the write if emission fails.

#### Scenario: Single notification created

- GIVEN a workspace member triggers an action that produces one notification (mention or assignment)
- WHEN the notification row is persisted to the database
- THEN a `notification.created` event is emitted on the workspace event bus
- AND the emitted payload contains only the workspaceId (bare envelope)

#### Scenario: Batch notifications created

- GIVEN a subscribed-activity or batch-transitioned action produces multiple notification rows via a bulk insert
- WHEN the batch write completes successfully
- THEN a `notification.created` event is emitted for the batch
- AND emission does not block or roll back the batch write

### Requirement: Bare-payload privacy contract

The system MUST NOT include recipient identity or notification content in any emitted SSE payload. Every notification domain event payload MUST contain only the workspaceId.

#### Scenario: Payload contains no identifying information

- GIVEN a `notification.created` or `notification.marked_read` event is about to be emitted
- WHEN the event payload is constructed
- THEN the payload MUST NOT contain recipientId, userId, memberId, or any notification content field
- AND the payload MUST contain workspaceId as its only data field

### Requirement: Emission isolation (D3)

The system MUST NOT surface event-bus errors to the caller. A failure in event emission MUST NOT cause the originating DB write to appear to fail or be rolled back.

#### Scenario: Emit throws, mutation still succeeds

- GIVEN an event bus that throws an error on emit
- WHEN a notification is created or marked as read
- THEN the database write resolves successfully
- AND no error is propagated to the caller or HTTP response

### Requirement: Emit notification.marked_read on read state changes

The system MUST emit a `notification.marked_read` domain event after a notification is successfully marked as read — both single-notification and bulk-read-all operations.

#### Scenario: Single notification marked read

- GIVEN a notification exists and is currently unread
- WHEN a client marks that notification as read via the single-mark-read endpoint
- THEN a `notification.marked_read` event is emitted with a bare workspaceId payload

#### Scenario: Bulk mark-all-read emits exactly one event

- GIVEN one or more unread notifications exist for a workspace member
- WHEN the client calls the bulk-mark-all-read endpoint
- THEN exactly ONE `notification.marked_read` event is emitted after the transaction completes
- AND the event is NOT emitted once per notification row

### Requirement: DomainEventType registry extended

The `DomainEventType` union MUST include `notification.created` and `notification.marked_read` as valid values. No other event type or alias is valid for notification lifecycle events.

#### Scenario: Both event types are registered

- GIVEN the event-bus type registry
- WHEN `notification.created` and `notification.marked_read` are used as event types
- THEN both values are accepted by the type system without error
- AND neither `notification.read` nor any other alias is a valid substitute

### Requirement: Web listener name alignment

The web layer MUST listen for `notification.marked_read` (not `notification.read`) and `notification.created`, and MUST invalidate `notificationKeys.list(workspaceId)` on receipt of either event.

#### Scenario: Web listener uses canonical event names [web-side / manual concern — not a packages/api vitest scenario]

- GIVEN the workspace SSE connection is active in the browser
- WHEN a `notification.created` or `notification.marked_read` event arrives
- THEN the web client invalidates `notificationKeys.list(workspaceId)`
- AND the event name string matched MUST be exactly `notification.marked_read` (not `notification.read`) — a name mismatch silently breaks live-update with no runtime error
