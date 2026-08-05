export async function executePreview(input: any) {
  if (input.target === "injection") {
    return { success: false, error: "prompt_injection_detected" };
  }
  return {
    success: true,
    data: {
      shape: "compact"
    }
  };
}
