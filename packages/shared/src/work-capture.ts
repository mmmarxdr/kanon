import { z } from "zod";

export const workCaptureStateSchema = z.enum([
  "adopted",
  "capturing",
  "paused",
  "closing",
  "closed",
]);

const workCaptureFenceFields = {
  epoch: z.string().uuid(),
  leaseGeneration: z.number().int().positive(),
} as const;

export const workCaptureFenceSchema = z.object(workCaptureFenceFields).strict();

export const workCaptureCommandSchema = z
  .object({
    commandId: z.string().uuid(),
    ...workCaptureFenceFields,
  })
  .strict();

export const workCaptureIntentSnapshotSchema = z
  .object({
    ...workCaptureFenceFields,
    state: workCaptureStateSchema,
  })
  .strict();

export const workCaptureDeliveryStatusSchema = z.enum(["acknowledged", "pending"]);

export const workCaptureFailureNotificationPayloadSchema = z
  .object({
    issueKey: z.string().min(1),
    stage: z.literal("effect_apply"),
    code: z.literal("WORK_CAPTURE_RETRYABLE"),
    message: z.literal("Work capture was delayed. Kanon retries automatically."),
    details: z
      .object({
        retryable: z.literal(true),
        effectKind: z.enum(["activity", "release", "close"]),
      })
      .strict(),
  })
  .strict();

export const workCaptureEffectResponseSchema = z
  .object({
    ok: z.literal(true),
    commandId: z.string().uuid(),
    deliveryStatus: workCaptureDeliveryStatusSchema,
    captureIntent: workCaptureIntentSnapshotSchema.nullable(),
  })
  .strict();

export const workCaptureHydrationIntentSchema = z
  .object({
    issueKey: z.string().min(1),
    ...workCaptureFenceFields,
    state: z.enum(["adopted", "capturing", "paused", "closing"]),
  })
  .strict();

export const workCaptureHydrationPageSchema = z
  .object({
    principalId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    intents: z.array(workCaptureHydrationIntentSchema),
    nextCursor: z.string().uuid().nullable(),
  })
  .strict();

export type WorkCaptureState = z.infer<typeof workCaptureStateSchema>;
export type WorkCaptureFence = z.infer<typeof workCaptureFenceSchema>;
export type WorkCaptureCommand = z.infer<typeof workCaptureCommandSchema>;
export type WorkCaptureIntentSnapshot = z.infer<typeof workCaptureIntentSnapshotSchema>;
export type WorkCaptureDeliveryStatus = z.infer<typeof workCaptureDeliveryStatusSchema>;
export type WorkCaptureFailureNotificationPayload = z.infer<
  typeof workCaptureFailureNotificationPayloadSchema
>;
export type WorkCaptureEffectResponse = z.infer<typeof workCaptureEffectResponseSchema>;
export type WorkCaptureHydrationIntent = z.infer<typeof workCaptureHydrationIntentSchema>;
export type WorkCaptureHydrationPage = z.infer<typeof workCaptureHydrationPageSchema>;
