import org.nlogo.headless.HeadlessWorkspace;

import java.io.BufferedReader;
import java.io.BufferedOutputStream;
import java.io.BufferedWriter;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.awt.Color;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Base64;

public final class NetLogoCommandBridge {
  private static final String MODEL_SECTION_DELIMITER = "@#$#@#$#@";
  private static final String READY = "__NETLOGO_READY__";
  private static final String OK = "__NETLOGO_OK__";
  private static final String ERROR = "__NETLOGO_ERROR__";
  private static final String REPORT = "__NETLOGO_REPORT__";
  private static final String VIEW = "__NETLOGO_VIEW__";
  private static final String PLOT = "__NETLOGO_PLOT__";
  private static final String DRAWING_3D = "__NETLOGO_DRAWING_3D__";
  private static final int DRAWING_3D_BINARY_MAGIC = 0x4e4c4433; // NLD3
  private static final int DRAWING_3D_BINARY_VERSION = 2;
  private static final int DRAWING_3D_BINARY_RECORD_SIZE = 32;
  private static ByteBuffer view3DPatches = ByteBuffer.allocate(0);

  private NetLogoCommandBridge() {
  }

  public static void main(String[] args) {
    int modelPathIndex = 0;
    boolean threeD = false;
    if (args.length > 0 && "--3d".equals(args[0])) {
      threeD = true;
      modelPathIndex = 1;
    }

    if (args.length - modelPathIndex < 1 || args.length - modelPathIndex > 2) {
      System.err.println("Usage: NetLogoCommandBridge [--3d] <model-path> [command]");
      System.exit(64);
    }

    HeadlessWorkspace workspace = null;
    Path temporaryModelPath = null;
    try {
      PreparedModel preparedModel = prepareModelPath(args[modelPathIndex]);
      temporaryModelPath = preparedModel.temporaryPath;
      workspace = newWorkspace(threeD);
      workspace.open(preparedModel.modelPath.toString());

      if (args.length - modelPathIndex == 2) {
        workspace.command(args[modelPathIndex + 1]);
        System.out.println("OK");
      } else {
        runSession(workspace);
      }
    } catch (Throwable error) {
      error.printStackTrace(System.err);
      System.exit(1);
    } finally {
      if (workspace != null) {
        try {
          workspace.dispose();
        } catch (Throwable ignored) {
          // NetLogo is already shutting down; avoid masking the original error.
        }
      }
      if (temporaryModelPath != null) {
        try {
          Files.deleteIfExists(temporaryModelPath);
        } catch (Throwable ignored) {
          // Temporary normalized model copies should not mask the original error.
        }
      }
    }
  }

  private static HeadlessWorkspace newWorkspace(boolean threeD) throws Exception {
    if (!threeD) {
      return HeadlessWorkspace.newInstance();
    }

    try {
      Method newInstance = HeadlessWorkspace.class.getMethod("newInstance", boolean.class);
      return (HeadlessWorkspace) newInstance.invoke(null, true);
    } catch (NoSuchMethodException error) {
      throw new IllegalStateException("This NetLogo installation does not support 3D headless models.", error);
    }
  }

  private static PreparedModel prepareModelPath(String modelPathText) throws Exception {
    Path modelPath = Paths.get(modelPathText);
    String lowerName = modelPath.getFileName().toString().toLowerCase();
    if (!lowerName.endsWith(".nlogo") && !lowerName.endsWith(".nlogo3d")) {
      return new PreparedModel(modelPath, null);
    }

    String source = new String(Files.readAllBytes(modelPath), StandardCharsets.UTF_8);
    String normalized = normalizeClassicModelSeparators(source);
    if (source.equals(normalized)) {
      return new PreparedModel(modelPath, null);
    }

    Path temporaryPath = Files.createTempFile(
      "netlogo-headless-model-",
      lowerName.endsWith(".nlogo3d") ? ".nlogo3d" : ".nlogo"
    );
    Files.write(temporaryPath, normalized.getBytes(StandardCharsets.UTF_8));
    return new PreparedModel(temporaryPath, temporaryPath);
  }

  private static String normalizeClassicModelSeparators(String source) {
    StringBuilder normalized = new StringBuilder(source.length() + 16);
    int position = 0;
    while (true) {
      int delimiterIndex = source.indexOf(MODEL_SECTION_DELIMITER, position);
      if (delimiterIndex < 0) {
        normalized.append(source.substring(position));
        return normalized.toString();
      }

      normalized.append(source, position, delimiterIndex);
      if (delimiterIndex > 0) {
        char previous = source.charAt(delimiterIndex - 1);
        if (previous != '\n' && previous != '\r') {
          normalized.append('\n');
        }
      }
      normalized.append(MODEL_SECTION_DELIMITER);
      position = delimiterIndex + MODEL_SECTION_DELIMITER.length();
    }
  }

  private static final class PreparedModel {
    private final Path modelPath;
    private final Path temporaryPath;

    private PreparedModel(Path modelPath, Path temporaryPath) {
      this.modelPath = modelPath;
      this.temporaryPath = temporaryPath;
    }
  }

  private static void runSession(HeadlessWorkspace workspace) throws Exception {
    System.out.println(READY);
    System.out.flush();

    BufferedReader reader = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
    String line;
    while ((line = reader.readLine()) != null) {
      try {
        if (line.startsWith("REPORT ")) {
          String reporter = decodePayload(line.substring("REPORT ".length()));
          Object value = workspace.report(reporter);
          System.out.println(REPORT + encodePayload(String.valueOf(value)));
        } else if (line.startsWith("EXPORT_VIEW ")) {
          String path = decodePayload(line.substring("EXPORT_VIEW ".length()));
          byte[] bytes = exportView(workspace, path);
          System.out.println(VIEW + Base64.getEncoder().encodeToString(bytes));
        } else if (line.startsWith("EXPORT_PLOT ")) {
          String[] parts = line.substring("EXPORT_PLOT ".length()).split(" ", 2);
          if (parts.length != 2) {
            throw new IllegalArgumentException("EXPORT_PLOT requires plot name and path payloads");
          }
          String plotName = decodePayload(parts[0]);
          String path = decodePayload(parts[1]);
          byte[] bytes = exportPlot(workspace, plotName, path);
          System.out.println(PLOT + Base64.getEncoder().encodeToString(bytes));
        } else if (line.startsWith("EXPORT_PLOT_BINARY ")) {
          String[] parts = line.substring("EXPORT_PLOT_BINARY ".length()).split(" ", 2);
          if (parts.length != 2) {
            throw new IllegalArgumentException("EXPORT_PLOT_BINARY requires plot name and path payloads");
          }
          exportPlotBinary(workspace, decodePayload(parts[0]), decodePayload(parts[1]));
          System.out.println(OK);
        } else if (line.startsWith("EXPORT_REPORT ")) {
          String[] parts = line.substring("EXPORT_REPORT ".length()).split(" ", 2);
          if (parts.length != 2) {
            throw new IllegalArgumentException("EXPORT_REPORT requires reporter and path payloads");
          }
          String reporter = decodePayload(parts[0]);
          String path = decodePayload(parts[1]);
          exportReport(workspace, reporter, path);
          System.out.println(OK);
        } else if ("DRAWING_3D".equals(line)) {
          System.out.println(DRAWING_3D + encodePayload(exportDrawing3D(workspace)));
        } else if (line.startsWith("EXPORT_VIEW_3D ")) {
          String path = decodePayload(line.substring("EXPORT_VIEW_3D ".length()));
          exportView3D(workspace, path);
          System.out.println(OK);
        } else if (line.startsWith("EXPORT_DRAWING_3D_BINARY ")) {
          String path = decodePayload(line.substring("EXPORT_DRAWING_3D_BINARY ".length()));
          exportDrawing3DBinary(workspace, path);
          System.out.println(OK);
        } else if (line.startsWith("EXPORT_DRAWING_3D ")) {
          String[] parts = line.substring("EXPORT_DRAWING_3D ".length()).split(" ", 2);
          String path = decodePayload(parts[0]);
          int maxLines = parts.length > 1 ? parsePositiveInt(parts[1], Integer.MAX_VALUE) : Integer.MAX_VALUE;
          exportDrawing3D(workspace, path, maxLines);
          System.out.println(OK);
        } else {
          String command = line.startsWith("COMMAND ")
            ? decodePayload(line.substring("COMMAND ".length()))
            : decodePayload(line);
          workspace.command(command);
          System.out.println(OK);
        }
      } catch (Throwable error) {
        System.out.println(ERROR + encodeStackTrace(error));
      }
      System.out.flush();
    }
  }

  private static String encodeStackTrace(Throwable error) {
    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    try {
      PrintStream printer = new PrintStream(bytes, true, StandardCharsets.UTF_8.name());
      error.printStackTrace(printer);
      printer.flush();
      return Base64.getEncoder().encodeToString(bytes.toByteArray());
    } catch (Exception ignored) {
      return Base64.getEncoder().encodeToString(error.toString().getBytes(StandardCharsets.UTF_8));
    }
  }

  private static String decodePayload(String encoded) {
    return new String(Base64.getDecoder().decode(encoded), StandardCharsets.UTF_8);
  }

  private static String encodePayload(String value) {
    return Base64.getEncoder().encodeToString(value.getBytes(StandardCharsets.UTF_8));
  }

  private static int parsePositiveInt(String value, int fallback) {
    try {
      int parsed = Integer.parseInt(value.trim());
      return parsed > 0 ? parsed : fallback;
    } catch (Exception ignored) {
      return fallback;
    }
  }

  private static byte[] exportView(HeadlessWorkspace workspace, String path) throws Throwable {
    Path exportPath = Paths.get(path);
    try {
      try {
        Method exportView = workspace.getClass().getMethod("exportView", String.class);
        exportView.invoke(workspace, path);
      } catch (NoSuchMethodException ignored) {
        workspace.command("export-view " + quoteNetLogoString(path));
      }

      return Files.readAllBytes(exportPath);
    } finally {
      try {
        Files.deleteIfExists(exportPath);
      } catch (Throwable ignored) {
        // Export files are temporary; a failed cleanup should not hide the real result.
      }
    }
  }

  private static byte[] exportPlot(HeadlessWorkspace workspace, String plotName, String path) throws Throwable {
    Path exportPath = Paths.get(path);
    try {
      workspace.command("export-plot " + quoteNetLogoString(plotName) + " " + quoteNetLogoString(path));
      return Files.readAllBytes(exportPath);
    } finally {
      try {
        Files.deleteIfExists(exportPath);
      } catch (Throwable ignored) {
        // Export files are temporary; a failed cleanup should not hide the real result.
      }
    }
  }

  private static void exportPlotBinary(HeadlessWorkspace workspace, String plotName, String path) throws Exception {
    org.nlogo.api.PlotInterface plot = workspace.getPlot(plotName);
    if (plot == null) {
      throw new IllegalArgumentException("No such plot: " + plotName);
    }
    org.nlogo.api.PlotState state = plot.state();
    scala.collection.Seq<org.nlogo.api.PlotPenInterface> pens = plot.pens();
    // NLP1 v1, big endian. Full native history is retained, including pen-up points
    // and per-point ARGB. Reading the plot API does not execute reporters, select
    // another plot/pen, consume RNG state, or change the simulation.
    // The caller reads and removes this file, including after a failed export.
    try (DataOutputStream output = new DataOutputStream(new BufferedOutputStream(Files.newOutputStream(Paths.get(path))))) {
      output.writeInt(0x4e4c5031);
      output.writeInt(1);
      writePlotString(output, plot.name());
      output.writeDouble(state.xMin());
      output.writeDouble(state.xMax());
      output.writeDouble(state.yMin());
      output.writeDouble(state.yMax());
      output.writeBoolean(state.autoPlotOn());
      output.writeBoolean(plot.legendIsOpen());
      String currentPen = plot.currentPenByName();
      writePlotString(output, currentPen == null ? "" : currentPen);
      output.writeInt(pens.size());
      scala.collection.Iterator<org.nlogo.api.PlotPenInterface> penIterator = pens.iterator();
      while (penIterator.hasNext()) {
        org.nlogo.api.PlotPenInterface pen = penIterator.next();
        org.nlogo.core.PlotPenState penState = pen.state();
        scala.collection.Seq<org.nlogo.api.PlotPointInterface> points = pen.points();
        writePlotString(output, pen.name());
        output.writeBoolean(penState.isDown());
        output.writeInt(penState.mode());
        output.writeDouble(penState.interval());
        output.writeInt(penState.color());
        output.writeDouble(penState.x());
        output.writeBoolean(penState.hidden());
        output.writeBoolean(plotPenInLegend(pen));
        output.writeInt(points.size());
        scala.collection.Iterator<org.nlogo.api.PlotPointInterface> pointIterator = points.iterator();
        while (pointIterator.hasNext()) {
          org.nlogo.api.PlotPointInterface point = pointIterator.next();
          output.writeDouble(point.x());
          output.writeDouble(point.y());
          output.writeInt(point.color());
          output.writeBoolean(point.isDown());
        }
      }
    }
  }

  private static boolean plotPenInLegend(org.nlogo.api.PlotPenInterface pen) throws Exception {
    try {
      // Both NetLogo 6.4 implementations expose this getter, but the shared
      // PlotPenInterface does not. If absent, retain the pen's legend entry.
      return (Boolean) pen.getClass().getMethod("inLegend").invoke(pen);
    } catch (NoSuchMethodException missingLegendMetadata) {
      return true;
    }
  }

  private static void writePlotString(DataOutputStream output, String value) throws Exception {
    writeView3DString(output, value);
  }

  private static void exportReport(HeadlessWorkspace workspace, String reporter, String path) throws Throwable {
    Path exportPath = Paths.get(path);
    try (BufferedWriter writer = Files.newBufferedWriter(exportPath, StandardCharsets.UTF_8)) {
      Object value = workspace.report(reporter);
      writer.append(String.valueOf(value));
    }
  }

  private static void exportView3D(HeadlessWorkspace workspace, String path) throws Exception {
    org.nlogo.api.World3D world = (org.nlogo.api.World3D) workspace.world();
    int[] nativeColors = world.patchColors();
    int requiredBytes = Math.multiplyExact(nativeColors.length, 24);
    if (view3DPatches.capacity() < requiredBytes || view3DPatches.capacity() > Math.max(65536L, requiredBytes * 4L)) {
      view3DPatches = ByteBuffer.allocate(requiredBytes);
    }
    view3DPatches.clear();
    int patchCount = 0;
    for (int id = 0; id < nativeColors.length; id += 1) {
      org.nlogo.api.Patch3D patch = (org.nlogo.api.Patch3D) world.getPatch(id);
      Object value = patch.pcolor();
      double numeric = value instanceof Number ? ((Number) value).doubleValue() : Double.NaN;
      // Numeric black is invisible in 3D, but RGB black is not. NetLogo caches
      // numeric RGB values; RGB lists still need Color.getColor to preserve alpha.
      int argb = value instanceof Number ? (numeric == 0.0 ? 0 : nativeColors[id])
        : org.nlogo.api.Color.getColor(value).getRGB();
      if ((argb >>> 24) == 0) {
        continue;
      }
      view3DPatches.putInt(patch.pxcor()).putInt(patch.pycor()).putInt(patch.pzcor());
      view3DPatches.putDouble(numeric).putInt(argb);
      patchCount += 1;
    }

    // NLV3 v1, big endian: bounds (6 int32), observer (3 float64), counts (3 int32),
    // variable-length turtle/link records, then patches (xyz int32, color float64, ARGB).
    // Native iteration is stable and does not shuffle agentsets or consume the model RNG.
    try (DataOutputStream output = new DataOutputStream(new BufferedOutputStream(Files.newOutputStream(Paths.get(path))))) {
      output.writeInt(0x4e4c5633);
      output.writeInt(1);
      output.writeInt(world.minPxcor());
      output.writeInt(world.maxPxcor());
      output.writeInt(world.minPycor());
      output.writeInt(world.maxPycor());
      output.writeInt(world.minPzcor());
      output.writeInt(world.maxPzcor());
      output.writeDouble(world.observer().oxcor());
      output.writeDouble(world.observer().oycor());
      output.writeDouble(world.observer().ozcor());
      output.writeInt(world.turtles().count());
      output.writeInt(world.links().count());
      output.writeInt(patchCount);

      for (org.nlogo.api.Agent agent : world.turtles().agents()) {
        org.nlogo.api.Turtle3D turtle = (org.nlogo.api.Turtle3D) agent;
        output.writeDouble(turtle.id());
        output.writeDouble(turtle.xcor());
        output.writeDouble(turtle.ycor());
        output.writeDouble(turtle.zcor());
        output.writeDouble(turtle.heading());
        output.writeDouble(turtle.pitch());
        output.writeDouble(turtle.roll());
        output.writeDouble(turtle.size());
        writeView3DColor(output, turtle.color(), turtle.alpha());
        output.writeBoolean(turtle.hidden());
        writeView3DString(output, turtle.shape());
        writeView3DString(output, turtle.labelString());
        writeView3DColor(output, turtle.labelColor(), org.nlogo.api.Color.getColor(turtle.labelColor()).getAlpha());
        writeView3DString(output, ((org.nlogo.agent.Turtle) turtle).penMode());
        output.writeDouble(turtle.lineThickness());
      }
      for (org.nlogo.api.Agent agent : world.links().agents()) {
        org.nlogo.api.Link link = (org.nlogo.api.Link) agent;
        output.writeDouble(link.end1().id());
        output.writeDouble(link.end2().id());
        writeView3DColor(output, link.color(), link.alpha());
        output.writeDouble(link.lineThickness());
        output.writeBoolean(link.isDirectedLink());
        output.writeBoolean(link.hidden());
        writeView3DString(output, link.shape());
        writeView3DString(output, link.labelString());
        writeView3DColor(output, link.labelColor(), org.nlogo.api.Color.getColor(link.labelColor()).getAlpha());
      }
      output.write(view3DPatches.array(), 0, view3DPatches.position());
    }
  }

  private static void writeView3DString(DataOutputStream output, String value) throws Exception {
    byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
    output.writeInt(bytes.length);
    output.write(bytes);
  }

  private static void writeView3DColor(DataOutputStream output, Object value, int alpha) throws Exception {
    output.writeDouble(value instanceof Number ? ((Number) value).doubleValue() : Double.NaN);
    output.writeInt((org.nlogo.api.Color.getColor(value).getRGB() & 0x00ffffff) | (alpha << 24));
  }

  private static String exportDrawing3D(HeadlessWorkspace workspace) throws Throwable {
    Object world = workspace.world();
    Method getDrawing = world.getClass().getMethod("getDrawing");
    Object drawing = getDrawing.invoke(world);
    if (!(drawing instanceof org.nlogo.api.Drawing3D)) {
      return "";
    }

    StringBuilder output = new StringBuilder();
    for (org.nlogo.api.DrawingLine3D line : ((org.nlogo.api.Drawing3D) drawing).lines()) {
      Color color = org.nlogo.api.Color.getColor(line.color());
      output
        .append(line.x0()).append('|')
        .append(line.y0()).append('|')
        .append(line.z0()).append('|')
        .append(line.x1()).append('|')
        .append(line.y1()).append('|')
        .append(line.z1()).append('|')
        .append(line.width()).append('|')
        .append(String.valueOf(line.color())).append('|')
        .append(color.getRed()).append('|')
        .append(color.getGreen()).append('|')
        .append(color.getBlue()).append('|')
        .append(line.heading()).append('|')
        .append(line.pitch()).append('|')
        .append(line.length()).append('\n');
    }
    return output.toString();
  }

  private static void exportDrawing3D(HeadlessWorkspace workspace, String path, int maxLines) throws Throwable {
    Object world = workspace.world();
    Method getDrawing = world.getClass().getMethod("getDrawing");
    Object drawing = getDrawing.invoke(world);
    Path exportPath = Paths.get(path);
    try (BufferedWriter writer = Files.newBufferedWriter(exportPath, StandardCharsets.UTF_8)) {
      if (!(drawing instanceof org.nlogo.api.Drawing3D)) {
        writer.append("# count=0\n");
        return;
      }

      org.nlogo.api.Drawing3D drawing3D = (org.nlogo.api.Drawing3D) drawing;
      int totalCount = 0;
      for (org.nlogo.api.DrawingLine3D ignored : drawing3D.lines()) {
        totalCount += 1;
      }

      writer.append("# count=").append(String.valueOf(totalCount)).append('\n');
      if (totalCount == 0) {
        return;
      }

      int stride = totalCount > maxLines ? (int) Math.ceil(totalCount / (double) maxLines) : 1;
      int index = 0;
      int written = 0;
      for (org.nlogo.api.DrawingLine3D line : drawing3D.lines()) {
        if (stride == 1 || index % stride == 0) {
          writeDrawingLine3D(writer, line);
          written += 1;
          if (written >= maxLines) {
            break;
          }
        }
        index += 1;
      }
    }
  }

  private static void writeDrawingLine3D(BufferedWriter writer, org.nlogo.api.DrawingLine3D line) throws Throwable {
    Color color = org.nlogo.api.Color.getColor(line.color());
    writer
      .append(String.valueOf(line.x0())).append('|')
      .append(String.valueOf(line.y0())).append('|')
      .append(String.valueOf(line.z0())).append('|')
      .append(String.valueOf(line.x1())).append('|')
      .append(String.valueOf(line.y1())).append('|')
      .append(String.valueOf(line.z1())).append('|')
      .append(String.valueOf(line.width())).append('|')
      .append(String.valueOf(line.color())).append('|')
      .append(String.valueOf(color.getRed())).append('|')
      .append(String.valueOf(color.getGreen())).append('|')
      .append(String.valueOf(color.getBlue())).append('|')
      .append(String.valueOf(line.heading())).append('|')
      .append(String.valueOf(line.pitch())).append('|')
      .append(String.valueOf(line.length())).append('\n');
  }

  private static void exportDrawing3DBinary(HeadlessWorkspace workspace, String path) throws Throwable {
    Object world = workspace.world();
    Method getDrawing = world.getClass().getMethod("getDrawing");
    Object drawing = getDrawing.invoke(world);
    Path exportPath = Paths.get(path);

    org.nlogo.api.Drawing3D drawing3D = drawing instanceof org.nlogo.api.Drawing3D
      ? (org.nlogo.api.Drawing3D) drawing
      : null;
    Drawing3DBinaryStats stats = drawing3D == null
      ? new Drawing3DBinaryStats(0, 0)
      : drawing3DBinaryStats(drawing3D);

    // NLD3 v2: magic, version, original line count, compacted record count, record size,
    // then big-endian records containing 7 float32 values (xyz endpoints + width) and ARGB.
    try (DataOutputStream output = new DataOutputStream(new BufferedOutputStream(Files.newOutputStream(exportPath)))) {
      output.writeInt(DRAWING_3D_BINARY_MAGIC);
      output.writeInt(DRAWING_3D_BINARY_VERSION);
      output.writeInt(stats.originalCount);
      output.writeInt(stats.recordCount);
      output.writeInt(DRAWING_3D_BINARY_RECORD_SIZE);
      if (drawing3D == null) {
        return;
      }

      Drawing3DBinaryRecord pending = null;
      for (org.nlogo.api.DrawingLine3D line : drawing3D.lines()) {
        Drawing3DBinaryRecord next = Drawing3DBinaryRecord.from(line);
        if (pending != null && pending.merge(next)) {
          continue;
        }
        if (pending != null) {
          pending.write(output);
        }
        pending = next;
      }
      if (pending != null) {
        pending.write(output);
      }
    }
  }

  private static Drawing3DBinaryStats drawing3DBinaryStats(org.nlogo.api.Drawing3D drawing3D) throws Throwable {
    int originalCount = 0;
    int recordCount = 0;
    Drawing3DBinaryRecord pending = null;
    for (org.nlogo.api.DrawingLine3D line : drawing3D.lines()) {
      originalCount += 1;
      Drawing3DBinaryRecord next = Drawing3DBinaryRecord.from(line);
      if (pending != null && pending.merge(next)) {
        continue;
      }
      recordCount += 1;
      pending = next;
    }
    return new Drawing3DBinaryStats(originalCount, recordCount);
  }

  private static final class Drawing3DBinaryStats {
    private final int originalCount;
    private final int recordCount;

    private Drawing3DBinaryStats(int originalCount, int recordCount) {
      this.originalCount = originalCount;
      this.recordCount = recordCount;
    }
  }

  private static final class Drawing3DBinaryRecord {
    private static final double POSITION_EPSILON = 1.0e-9;
    private static final double DIRECTION_EPSILON = 1.0e-9;

    private final double x0;
    private final double y0;
    private final double z0;
    private double x1;
    private double y1;
    private double z1;
    private final double width;
    private final int argb;

    private Drawing3DBinaryRecord(
      double x0,
      double y0,
      double z0,
      double x1,
      double y1,
      double z1,
      double width,
      int argb
    ) {
      this.x0 = x0;
      this.y0 = y0;
      this.z0 = z0;
      this.x1 = x1;
      this.y1 = y1;
      this.z1 = z1;
      this.width = width;
      this.argb = argb;
    }

    private static Drawing3DBinaryRecord from(org.nlogo.api.DrawingLine3D line) throws Throwable {
      Color color = org.nlogo.api.Color.getColor(line.color());
      int argb = (color.getAlpha() << 24) | (color.getRed() << 16) | (color.getGreen() << 8) | color.getBlue();
      return new Drawing3DBinaryRecord(
        line.x0(), line.y0(), line.z0(),
        line.x1(), line.y1(), line.z1(),
        line.width(), argb
      );
    }

    private boolean merge(Drawing3DBinaryRecord next) {
      if (((argb >>> 24) & 0xff) != 255 || argb != next.argb || Double.compare(width, next.width) != 0
        || !near(x1, next.x0) || !near(y1, next.y0) || !near(z1, next.z0)) {
        return false;
      }

      double dx1 = x1 - x0;
      double dy1 = y1 - y0;
      double dz1 = z1 - z0;
      double dx2 = next.x1 - next.x0;
      double dy2 = next.y1 - next.y0;
      double dz2 = next.z1 - next.z0;
      double length1 = Math.sqrt(dx1 * dx1 + dy1 * dy1 + dz1 * dz1);
      double length2 = Math.sqrt(dx2 * dx2 + dy2 * dy2 + dz2 * dz2);
      if (length1 <= POSITION_EPSILON || length2 <= POSITION_EPSILON) {
        return false;
      }

      double crossX = dy1 * dz2 - dz1 * dy2;
      double crossY = dz1 * dx2 - dx1 * dz2;
      double crossZ = dx1 * dy2 - dy1 * dx2;
      double crossLength = Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ);
      double dot = dx1 * dx2 + dy1 * dy2 + dz1 * dz2;
      if (dot <= 0 || crossLength > DIRECTION_EPSILON * length1 * length2) {
        return false;
      }

      x1 = next.x1;
      y1 = next.y1;
      z1 = next.z1;
      return true;
    }

    private void write(DataOutputStream output) throws Exception {
      output.writeFloat((float) x0);
      output.writeFloat((float) y0);
      output.writeFloat((float) z0);
      output.writeFloat((float) x1);
      output.writeFloat((float) y1);
      output.writeFloat((float) z1);
      output.writeFloat((float) width);
      output.writeInt(argb);
    }

    private static boolean near(double left, double right) {
      return Math.abs(left - right) <= POSITION_EPSILON;
    }
  }

  private static String quoteNetLogoString(String value) {
    return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
  }
}
