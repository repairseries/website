export function logAssignment(info: Record<string, unknown>) {
  console.info("[partner-assign]", {
    at: new Date().toISOString(),
    ...info,
  });
}

export function logAssignmentFailure(info: Record<string, unknown>) {
  console.warn("[partner-assign-fail]", {
    at: new Date().toISOString(),
    ...info,
  });
}
