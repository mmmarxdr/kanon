export function evaluatePolicy(input: any) {
  return {
    confidence: "high",
    rules: ["rule-1"],
    provenance: "policy-v1",
    sla: "24h",
    urgency: "high",
    severity: "critical"
  };
}
