import org.nlogo.headless.HeadlessWorkspace;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
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

  private static String quoteNetLogoString(String value) {
    return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
  }
}
