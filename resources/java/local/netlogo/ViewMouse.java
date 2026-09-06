package local.netlogo;

import java.awt.event.MouseEvent;
import javax.swing.JComponent;
import org.nlogo.headless.HeadlessWorkspace;
import org.nlogo.nvm.Workspace;
import org.nlogo.window.ViewMouseHandler;

/** Input for the bridge workspace only; no window or native model is modified. */
public final class ViewMouse {
  private final HeadlessWorkspace workspace;
  private final JComponent surface = new JComponent() { };
  private final ViewMouseHandler handler;
  private volatile Snapshot snapshot = new Snapshot(false, false, 0, 0);
  private double u, v;
  private boolean inside, down;

  public ViewMouse(HeadlessWorkspace workspace) {
    this.workspace = workspace;
    handler = new ViewMouseHandler(surface, workspace.world(), workspace);
    workspace.addComponent(ViewMouse.class, this);
  }

  public static ViewMouse get(Workspace workspace) {
    scala.Option<ViewMouse> component = workspace.getComponent(ViewMouse.class);
    return component.isDefined() ? component.get() : null;
  }

  public Snapshot snapshot() { return snapshot; }

  public synchronized void update(String payload) {
    String[] values = payload.trim().split("\\s+");
    if (values.length != 4 || !values[0].matches("[01]") || !values[1].matches("[01]")) {
      throw new IllegalArgumentException("Mouse input requires inside, down, u and v.");
    }
    double nextU = Double.parseDouble(values[2]), nextV = Double.parseDouble(values[3]);
    if (!Double.isFinite(nextU) || !Double.isFinite(nextV)
        || nextU < 0 || nextU >= 1 || nextV < 0 || nextV >= 1) {
      throw new IllegalArgumentException("Mouse coordinates must be finite image fractions in [0, 1).");
    }
    inside = "1".equals(values[0]);
    down = inside && "1".equals(values[1]);
    u = nextU;
    v = nextV;
    refresh();
  }

  public synchronized void refresh() {
    // Reuse NetLogo's own pixel/world translation, topology, follow offsets,
    // boundary behavior and small-patch rounding rather than duplicating them.
    int width = Math.max(1, (int) Math.round(workspace.viewWidth() * workspace.patchSize()));
    int height = Math.max(1, (int) Math.round(workspace.viewHeight() * workspace.patchSize()));
    surface.setSize(width, height);
    MouseEvent event = new MouseEvent(surface, MouseEvent.MOUSE_MOVED, 0, 0,
      inside ? (int) (u * width) : -1, inside ? (int) (v * height) : -1, 0, false);
    if (inside) handler.mouseMoved(event);
    else handler.mouseExited(event);
    handler.mouseDown(down && handler.mouseInside());
    snapshot = new Snapshot(handler.mouseInside(), handler.mouseDown(), handler.mouseXCor(), handler.mouseYCor());
  }

  public static final class Snapshot {
    public final boolean inside, down;
    public final double x, y;
    private Snapshot(boolean inside, boolean down, double x, double y) {
      this.inside = inside; this.down = down; this.x = x; this.y = y;
    }
  }
}
