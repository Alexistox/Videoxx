let exportAsked = null;
export function requestExportDialog(projectId) {
  exportAsked = projectId;
  window.dispatchEvent(new CustomEvent("cz-open-export", { detail: projectId }));
}
export function takeExportRequest(projectId) {
  if (!projectId || exportAsked !== projectId) return false;
  exportAsked = null;
  return true;
}
