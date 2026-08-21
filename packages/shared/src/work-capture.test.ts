import { describe, expect, it } from "vitest";
import {
  workCaptureCommandSchema,
  workCaptureOwnerCommandSchema,
  workCaptureOwnerKindSchema,
  workCaptureDeliveryStatusSchema,
  workCaptureEffectResponseSchema,
  workCaptureFenceSchema,
  workCaptureIntentSnapshotSchema,
  workCaptureHydrationIntentSchema,
  workCaptureHydrationPageSchema,
  workCaptureFailureNotificationPayloadSchema,
  workCaptureStateSchema,
} from "./work-capture.js";

const command = {
  commandId: "11111111-1111-4111-8111-111111111111",
  epoch: "22222222-2222-4222-8222-222222222222",
  leaseGeneration: 2,
} as const;
const ownerCommand = {
  ...command,
  ownerId: "66666666-6666-4666-8666-666666666666",
} as const;

describe("versioned work-capture contracts", () => {
  it("accepts every public state and delivery status", () => {
    for (const state of ["adopted", "capturing", "paused", "closing", "closed"]) {
      expect(workCaptureStateSchema.parse(state)).toBe(state);
    }
    expect(workCaptureDeliveryStatusSchema.parse("acknowledged")).toBe("acknowledged");
    expect(workCaptureDeliveryStatusSchema.parse("pending")).toBe("pending");
  });

  it("requires a UUID epoch and positive integer generation fence", () => {
    const fence = {
      epoch: command.epoch,
      leaseGeneration: command.leaseGeneration,
    };
    expect(workCaptureFenceSchema.parse(fence)).toEqual(fence);
    expect(
      workCaptureFenceSchema.safeParse({ epoch: command.epoch, leaseGeneration: 0 }).success
    ).toBe(false);
    expect(workCaptureFenceSchema.safeParse({ epoch: "epoch", leaseGeneration: 1 }).success).toBe(
      false
    );
    expect(
      workCaptureFenceSchema.safeParse({ ...fence, intentId: command.commandId }).success
    ).toBe(false);
  });

  it("accepts only a complete strict server-timed command", () => {
    expect(workCaptureCommandSchema.parse(command)).toEqual(command);
    expect(
      workCaptureCommandSchema.safeParse({ ...command, observedAt: new Date().toISOString() })
        .success
    ).toBe(false);
    expect(workCaptureCommandSchema.safeParse({ commandId: command.commandId }).success).toBe(
      false
    );
    expect(workCaptureCommandSchema.safeParse({ ...command, unexpected: true }).success).toBe(
      false
    );
  });

  it("keeps the owner-scoped v2 command distinct from the legacy v1 command", () => {
    expect(workCaptureOwnerCommandSchema.parse(ownerCommand)).toEqual(ownerCommand);
    expect(workCaptureOwnerCommandSchema.safeParse(command).success).toBe(false);
    expect(
      workCaptureOwnerCommandSchema.safeParse({ ...ownerCommand, ownerId: undefined }).success
    ).toBe(false);
    expect(workCaptureCommandSchema.safeParse(ownerCommand).success).toBe(false);
    expect(workCaptureOwnerKindSchema.options).toEqual(["web", "mcp", "implicit"]);
  });

  it("keeps snapshots strict and limited to the public fence and state", () => {
    const snapshot = { epoch: command.epoch, leaseGeneration: 2, state: "capturing" } as const;
    expect(workCaptureIntentSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(
      workCaptureIntentSnapshotSchema.safeParse({ ...snapshot, intentId: command.commandId })
        .success
    ).toBe(false);
    expect(
      workCaptureIntentSnapshotSchema.safeParse({ ...snapshot, effectRevision: 1 }).success
    ).toBe(false);
  });

  it("accepts acknowledged and pending responses without internal fields", () => {
    const response = {
      ok: true,
      commandId: command.commandId,
      deliveryStatus: "pending",
      captureIntent: {
        epoch: command.epoch,
        leaseGeneration: command.leaseGeneration,
        state: "closing",
      },
    } as const;
    expect(workCaptureEffectResponseSchema.parse(response)).toEqual(response);
    expect(
      workCaptureEffectResponseSchema.safeParse({ ...response, pendingEffectKind: "close" }).success
    ).toBe(false);
    expect(
      workCaptureEffectResponseSchema.safeParse({ ...response, captureIntent: null }).success
    ).toBe(true);
  });

  it("keeps hydration pages strict and free of internal intent fields", () => {
    const intent = {
      issueKey: "KAN-42",
      epoch: command.epoch,
      leaseGeneration: 2,
      state: "paused",
    } as const;
    const page = {
      principalId: "33333333-3333-4333-8333-333333333333",
      workspaceId: "44444444-4444-4444-8444-444444444444",
      intents: [intent],
      nextCursor: "55555555-5555-4555-8555-555555555555",
    } as const;

    expect(workCaptureHydrationIntentSchema.parse(intent)).toEqual(intent);
    expect(workCaptureHydrationPageSchema.parse(page)).toEqual(page);
    expect(
      workCaptureHydrationIntentSchema.safeParse({ ...intent, intentId: command.commandId }).success
    ).toBe(false);
    expect(
      workCaptureHydrationPageSchema.safeParse({ ...page, pendingEffectKind: "close" }).success
    ).toBe(false);
  });

  it("accepts only the fixed safe work-capture failure notification payload", () => {
    const payload = {
      issueKey: "KAN-243",
      stage: "effect_apply",
      code: "WORK_CAPTURE_RETRYABLE",
      message: "Work capture was delayed. Kanon retries automatically.",
      details: { retryable: true, effectKind: "activity" },
    } as const;

    expect(workCaptureFailureNotificationPayloadSchema.parse(payload)).toEqual(payload);
    for (const effectKind of ["activity", "release", "close"] as const) {
      expect(
        workCaptureFailureNotificationPayloadSchema.safeParse({
          ...payload,
          details: { retryable: true, effectKind },
        }).success
      ).toBe(true);
    }

    for (const unsafe of [
      { ...payload, episodeId: command.commandId },
      { ...payload, epoch: command.epoch },
      { ...payload, commandId: command.commandId },
      { ...payload, leaseGeneration: 2 },
      { ...payload, effectRevision: 7 },
      { ...payload, rawError: "KAN243_RAW_FAILURE_MARKER" },
      { ...payload, fence: { epoch: command.epoch, leaseGeneration: 2 } },
      { ...payload, message: "database exploded: KAN243_RAW_FAILURE_MARKER" },
      { ...payload, stage: "close" },
      { ...payload, code: "P0001" },
      { ...payload, details: { ...payload.details, internalId: command.commandId } },
      { ...payload, details: { retryable: false, effectKind: "activity" } },
      { ...payload, details: { retryable: true, effectKind: "write" } },
    ]) {
      expect(workCaptureFailureNotificationPayloadSchema.safeParse(unsafe).success).toBe(false);
    }
  });
});
