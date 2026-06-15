-- KAN-102 PR1: IssueForecast (PPM L2 derived forecast plane)
-- Additive only: new table + FK + index. No drops, no alters, no enum surgery.

-- ── 1. issue_forecasts table ─────────────────────────────────────────────────
CREATE TABLE "issue_forecasts" (
    "issueId"       UUID            NOT NULL,
    "forecast_start" TIMESTAMP(3),
    "forecast_end"   TIMESTAMP(3),
    "slip_days"      INTEGER         NOT NULL DEFAULT 0,
    "critical"       BOOLEAN         NOT NULL DEFAULT false,
    "float_days"     INTEGER,
    "inputs_hash"    TEXT,
    "computed_at"    TIMESTAMP(3)    NOT NULL,

    CONSTRAINT "issue_forecasts_pkey" PRIMARY KEY ("issueId")
);

-- FK: issue_forecasts.issueId → issues.id (CASCADE delete — forecast is a derived view, dies with the issue)
ALTER TABLE "issue_forecasts"
    ADD CONSTRAINT "issue_forecasts_issueId_fkey"
    FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Index: critical is filtered/queried directly
CREATE INDEX "issue_forecasts_critical_idx" ON "issue_forecasts"("critical");
