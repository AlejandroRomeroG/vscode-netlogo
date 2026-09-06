package org.nlogo.prim.gui;

public final class _mousexcor extends org.nlogo.nvm.Reporter {
  public Double report(org.nlogo.nvm.Context context) {
    local.netlogo.ViewMouse mouse = local.netlogo.ViewMouse.get(workspace);
    return mouse == null ? workspace.mouseXCor() : mouse.snapshot().x;
  }
}
