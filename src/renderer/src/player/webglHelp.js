export const WEBGL_FAIL = /WebGL context|WebGL is not (supported|available)|could not create a WebGL|webgl.*(unavailable|disabled)/i;
export function webglAdvice(software, mac = typeof process !== "undefined" && process.platform === "darwin") {
  if (software)
    return `Your computer could not start the 3D preview, even with software graphics. ${mac ? "Update macOS" : "Update Windows and your graphics driver"}, restart the computer, then open the app again.`;
  return "Your computer's graphics could not start the 3D preview. Switch to software graphics (slower, but works on unsupported graphics): Settings > System > Graphics > Software, then restart the app.";
}
