const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { bridgeSourcePaths } = require("../../out/javaBridge");
const { installationFromHome, detectNetLogoInstallations } = require("../../out/netlogoInstallation");

const installation = process.env.NETLOGO_HOME ? installationFromHome(process.env.NETLOGO_HOME)
  : detectNetLogoInstallations(process.platform === "darwin" ? ["/Applications"] : undefined)[0];

function compileMouseBridge() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "netlogo-mouse-test-"));
  const result = spawnSync("javac", ["-cp", installation.classPath.join(path.delimiter), "-d", directory,
    ...bridgeSourcePaths(path.resolve(__dirname, "../../resources/java"))], { encoding: "utf8", timeout: 30000 });
  if (result.status !== 0) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw new Error(result.error?.message || result.stderr);
  }
  return directory;
}

async function openMouseBridge(directory, model) {
  const child = spawn("java", [...installation.jvmArgs, "-cp", [directory, ...installation.classPath].join(path.delimiter),
    "NetLogoCommandBridge", model], { stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "", stderr = "", pending;
  const observers = new Set(), output = [];
  const request = (expected, send) => new Promise((resolve, reject) => {
    if (pending) throw new Error("Only one native command may be pending");
    const timer = setTimeout(() => { pending = undefined; reject(new Error("Timed out waiting for " + expected + ": " + stderr)); }, 30000);
    pending = { expected, resolve: value => { clearTimeout(timer); pending = undefined; resolve(value); },
      reject: error => { clearTimeout(timer); pending = undefined; reject(error); } };
    send?.();
  });
  child.stderr.on("data", chunk => { stderr += chunk; });
  child.on("error", error => pending?.reject(error));
  child.on("exit", code => pending?.reject(new Error("Bridge exited: " + code + " " + stderr)));
  child.stdout.on("data", chunk => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const index = buffer.indexOf("\n"), line = buffer.slice(0, index).trimEnd();
      buffer = buffer.slice(index + 1);
      output.push(line);
      for (const observer of observers) observer(line);
      if (line.startsWith("__NETLOGO_ERROR__") || line.startsWith("__NETLOGO_MOUSE_ERROR__")) {
        const error = new Error(Buffer.from(line.slice(line.indexOf("__", 2) + 2), "base64").toString());
        if (pending) pending.reject(error);
        else output.push("UNHANDLED: " + error.message);
      } else if (pending && line.startsWith(pending.expected)) {
        pending.resolve(line.slice(pending.expected.length));
      }
    }
  });
  const close = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise(resolve => {
      const timer = setTimeout(() => child.kill(), 3000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
      child.stdin.end();
    });
  };
  try {
    await request("__NETLOGO_READY__");
  } catch (error) {
    await close();
    throw error;
  }
  return {
    child, output, observers,
    command: text => request("__NETLOGO_OK__", () => child.stdin.write("COMMAND " + Buffer.from(text).toString("base64") + "\n")),
    report: async text => Buffer.from(await request("__NETLOGO_REPORT__", () => child.stdin.write("REPORT " + Buffer.from(text).toString("base64") + "\n")), "base64").toString(),
    view: () => request("__NETLOGO_VIEW__", () => child.stdin.write("EXPORT_VIEW " + Buffer.from(path.join(directory, "view.png")).toString("base64") + "\n")),
    mouse: (inside, down, u, v) => child.stdin.write(`MOUSE ${inside ? 1 : 0} ${down ? 1 : 0} ${u} ${v}\n`),
    close
  };
}

module.exports = { installation, compileMouseBridge, openMouseBridge };
