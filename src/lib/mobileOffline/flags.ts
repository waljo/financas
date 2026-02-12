export function isMobileOfflineModeEnabled() {
  return (process.env.MOBILE_OFFLINE_MODE ?? "false").trim().toLowerCase() === "true";
}
