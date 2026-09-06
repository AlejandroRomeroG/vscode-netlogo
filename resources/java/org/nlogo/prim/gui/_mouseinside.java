package org.nlogo.prim.gui;

public final class _mouseinside extends org.nlogo.nvm.Reporter {
  public Boolean report(org.nlogo.nvm.Context context) {
    local.netlogo.ViewMouse mouse = local.netlogo.ViewMouse.get(workspace);
    return mouse == null ? workspace.mouseInside() : mouse.snapshot().inside;
  }
}
