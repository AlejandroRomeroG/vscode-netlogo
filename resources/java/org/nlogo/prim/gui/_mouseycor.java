package org.nlogo.prim.gui;

public final class _mouseycor extends org.nlogo.nvm.Reporter {
  public Double report(org.nlogo.nvm.Context context) {
    local.netlogo.ViewMouse mouse = local.netlogo.ViewMouse.get(workspace);
    return mouse == null ? workspace.mouseYCor() : mouse.snapshot().y;
  }
}
