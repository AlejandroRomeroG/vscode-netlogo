const fs = require("node:fs");
const { bridgeSourcePaths } = require("../out/javaBridge");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  detectNetLogoInstallations,
  installationFromHome
} = require("../out/netlogoInstallation");

const root = path.join(__dirname, "..");
const installation = process.env.NETLOGO_HOME
  ? installationFromHome(process.env.NETLOGO_HOME)
  : detectNetLogoInstallations(process.platform === "darwin" ? ["/Applications"] : undefined)[0];
const modelPath = installation && path.join(
  installation.home, "models", "IABM Textbook", "chapter 4", "Wolf Sheep Simple 5.nlogo"
);

test("2D view exports preserve native patch colors and RGBA rendering without pixel changes", {
  skip: modelPath && fs.existsSync(modelPath) ? false : "No local Wolf Sheep Simple 5 sample model detected"
}, () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "netlogo-view2d-integration-"));
  try {
    const sourcePath = path.join(tempDir, "View2DColorCheck.java");
    fs.writeFileSync(sourcePath, colorCheckSource);
    const compile = spawnSync("javac", [
      "-cp", installation.classPath.join(path.delimiter),
      "-d", tempDir,
      ...bridgeSourcePaths(path.join(root, "resources", "java")),
      sourcePath
    ], { encoding: "utf8", timeout: 60000 });
    assert.equal(compile.status, 0, compile.error?.message || compile.stderr || compile.stdout);

    const run = spawnSync("java", [
      ...installation.jvmArgs,
      "-Djava.awt.headless=true",
      "-cp", [tempDir, ...installation.classPath].join(path.delimiter),
      "View2DColorCheck", modelPath, path.join(tempDir, "view.png")
    ], { encoding: "utf8", timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(run.status, 0, run.error?.message || run.stderr || run.stdout);
    assert.match(run.stdout, /PATCH_COLORS checked=1225 mismatches=0/);
    assert.match(run.stdout, /PNG_ROUNDTRIP pixels=207025 mismatches=0/);
    assert.match(run.stdout, /BRIDGE_PATCHES pixels=207025 mismatches=0/);
    assert.match(run.stdout, /BRIDGE_RGBA pixels=207025 mismatches=0/);
    assert.equal(fs.existsSync(path.join(tempDir, "view.png")), false,
      "the bridge removes its temporary export after reading it");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// Keep the native reference in a separate headless process. Comparing exported pixels
// to the native renderer avoids inventing palette or alpha-compositing formulas here.
const colorCheckSource = `
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.lang.reflect.Method;
import javax.imageio.ImageIO;
import org.nlogo.headless.HeadlessWorkspace;

public class View2DColorCheck {
  public static void main(String[] args) throws Exception {
    HeadlessWorkspace workspace = HeadlessWorkspace.newInstance();
    try {
      workspace.open(args[0]);
      workspace.command("random-seed 24680 setup ask turtles [ hide-turtle ]");
      BufferedImage reference = workspace.exportView();
      require(reference.getColorModel().getColorSpace().isCS_sRGB(), "native image is not sRGB");
      require(reference.getWidth() == 455 && reference.getHeight() == 455,
        "unexpected sample model view dimensions");

      int checked = 0;
      double patchSize = workspace.world().patchSize();
      int minX = workspace.world().minPxcor();
      int maxY = workspace.world().maxPycor();
      for (int y = workspace.world().minPycor(); y <= maxY; y++) {
        for (int x = minX; x <= workspace.world().maxPxcor(); x++) {
          int expected = org.nlogo.api.Color.getColor(workspace.world().getPatchAt(x, y).pcolor()).getRGB();
          int pixelX = (int) Math.floor((x - minX + 0.5) * patchSize);
          int pixelY = (int) Math.floor((maxY - y + 0.5) * patchSize);
          require(reference.getRGB(pixelX, pixelY) == expected,
            "native patch color mismatch at " + x + "," + y);
          checked++;
        }
      }
      System.out.println("PATCH_COLORS checked=" + checked + " mismatches=0");

      ByteArrayOutputStream png = new ByteArrayOutputStream();
      require(ImageIO.write(reference, "png", png), "PNG writer unavailable");
      BufferedImage decoded = ImageIO.read(new ByteArrayInputStream(png.toByteArray()));
      comparePixels(reference, decoded, "PNG_ROUNDTRIP");

      Method export = NetLogoCommandBridge.class.getDeclaredMethod(
        "exportView", HeadlessWorkspace.class, String.class);
      export.setAccessible(true);
      byte[] bytes = (byte[]) export.invoke(null, workspace, args[1]);
      comparePixels(reference, ImageIO.read(new ByteArrayInputStream(bytes)), "BRIDGE_PATCHES");

      // Exercise the native transparency renderer over an RGB patch background,
      // including fully transparent, partially transparent, and opaque turtles.
      workspace.command("clear-turtles ask patches [ set pcolor [9 40 80] ]");
      BufferedImage background = workspace.exportView();
      workspace.command("create-turtles 4 [ "
        + "setxy (-6 + who * 4) 0 set shape \\\"circle\\\" set size 3 "
        + "set color (list 231 84 29 (item who [0 64 128 255])) ]");
      BufferedImage rgbaReference = workspace.exportView();
      require(hasDifferentPixel(background, rgbaReference), "RGBA scene did not render turtles");
      int row = (int) Math.floor((maxY + 0.5) * patchSize);
      int backgroundRgb = background.getRGB(0, 0);
      int opaqueRgb = rgbaReference.getRGB((int) Math.floor((6 - minX + 0.5) * patchSize), row);
      for (int turtle = 0; turtle < 4; turtle++) {
        int column = (int) Math.floor((-6 + turtle * 4 - minX + 0.5) * patchSize);
        int rgb = rgbaReference.getRGB(column, row);
        if (turtle == 0) {
          require(rgb == backgroundRgb, "fully transparent turtle changed the background");
        } else if (turtle < 3) {
          require(rgb != backgroundRgb && rgb != opaqueRgb,
            "partially transparent turtle did not blend with the background");
        }
      }
      bytes = (byte[]) export.invoke(null, workspace, args[1]);
      comparePixels(rgbaReference, ImageIO.read(new ByteArrayInputStream(bytes)), "BRIDGE_RGBA");
    } finally {
      workspace.dispose();
    }
  }

  private static void comparePixels(BufferedImage expected, BufferedImage actual, String label) {
    require(actual != null, label + " is not a readable PNG");
    require(expected.getWidth() == actual.getWidth() && expected.getHeight() == actual.getHeight(),
      label + " dimensions changed");
    for (int y = 0; y < expected.getHeight(); y++) {
      for (int x = 0; x < expected.getWidth(); x++) {
        require(expected.getRGB(x, y) == actual.getRGB(x, y), label + " pixel mismatch at " + x + "," + y);
      }
    }
    System.out.println(label + " pixels=" + expected.getWidth() * expected.getHeight() + " mismatches=0");
  }

  private static boolean hasDifferentPixel(BufferedImage left, BufferedImage right) {
    for (int y = 0; y < left.getHeight(); y++) {
      for (int x = 0; x < left.getWidth(); x++) {
        if (left.getRGB(x, y) != right.getRGB(x, y)) return true;
      }
    }
    return false;
  }

  private static void require(boolean condition, String message) {
    if (!condition) throw new AssertionError(message);
  }
}
`;
