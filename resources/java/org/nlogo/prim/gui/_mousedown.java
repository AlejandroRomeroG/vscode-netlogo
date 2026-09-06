package org.nlogo.prim.gui;

// Process-local adapter: NetLogo 6.4's reporter otherwise hard-codes false for
// non-GUI workspaces. Keep the native reporter name, type and model source.
public final class _mousedown extends org.nlogo.nvm.Reporter {
  public Boolean report(org.nlogo.nvm.Context context) {
    local.netlogo.ViewMouse mouse = local.netlogo.ViewMouse.get(workspace);
    return mouse == null ? workspace.mouseDown() : mouse.snapshot().down;
  }
}
