-- KAN-152 (ADR-0008 decision #3): explicit re-baseline admin op audit action.
-- Add the `baseline_set` value to the ActivityAction enum so re-baseline writes
-- a typed ActivityLog row (who, when, previous baselineStart/End in details).
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'baseline_set';
