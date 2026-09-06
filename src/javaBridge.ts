import * as path from "path";

// Explicitly compile the four process-local mouse reporters ahead of the native
// jar on the bridge classpath. This never changes an installed NetLogo jar.
export function bridgeSourcePaths(sourceDir: string): string[] {
  return [
    "NetLogoCommandBridge.java",
    "local/netlogo/ViewMouse.java",
    ...["_mousedown", "_mouseinside", "_mousexcor", "_mouseycor"].map(name => `org/nlogo/prim/gui/${name}.java`)
  ].map(file => path.join(sourceDir, file));
}
