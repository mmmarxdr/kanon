import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("application domain-event outbox lifecycle", () => {
  it("starts recovery after listeners register and stops it during app shutdown", async () => {
    const appSource = await readFile(
      fileURLToPath(new URL("../../app.ts", import.meta.url)),
      "utf8"
    );

    const listenerRegistration = appSource.indexOf("registerTransitionListener(");
    const recoveryStart = appSource.indexOf("startDomainEventOutboxRecovery(");
    const recoveryStop = appSource.indexOf("outboxRecovery.stop()");
    const transitionUnsubscribe = appSource.indexOf("unsubscribeTransitionListener();");
    const forecastUnsubscribe = appSource.indexOf("unsubscribeForecast();");
    const notificationUnsubscribe = appSource.indexOf("unsubscribeNotifications();");

    expect(listenerRegistration).toBeGreaterThan(-1);
    expect(recoveryStart).toBeGreaterThan(listenerRegistration);
    expect(recoveryStop).toBeGreaterThan(recoveryStart);
    expect(appSource.slice(recoveryStart - 300, recoveryStart)).toContain('app.addHook("onReady"');
    expect(appSource.slice(recoveryStop - 300, recoveryStop)).toContain('app.addHook("onClose"');
    expect(recoveryStop).toBeLessThan(transitionUnsubscribe);
    expect(recoveryStop).toBeLessThan(forecastUnsubscribe);
    expect(recoveryStop).toBeLessThan(notificationUnsubscribe);
  });
});
