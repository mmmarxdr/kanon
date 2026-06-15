/**
 * Forecast module public API — KAN-102.
 *
 * Exports the two main entry-points:
 *   - registerForecastListener: wire to the event bus at app startup (Phase 8)
 *   - rebuildProjectForecast:   internal job / direct call (Phase 7)
 */
export { registerForecastListener } from "./listener.js";
export { rebuildProjectForecast } from "./service.js";
