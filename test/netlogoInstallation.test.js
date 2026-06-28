const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildJvmArgs,
  detectNetLogoInstallations,
  findNativeNetLogoApp,
  installationFromHome,
  resolveNetLogoClassPath
} = require("../out/netlogoInstallation");

test("finds NetLogo.jar in a macOS app bundle", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "netlogo-install-"));
  try {
    const appDir = path.join(tempDir, "NetLogo 7.0.0.app");
    const javaDir = path.join(appDir, "Contents", "Java");
    fs.mkdirSync(javaDir, { recursive: true });
    fs.writeFileSync(path.join(javaDir, "NetLogo.jar"), "");

    const installation = installationFromHome(appDir);
    assert.equal(installation.home, appDir);
    assert.equal(installation.jarPath, path.join(javaDir, "NetLogo.jar"));
    assert.equal(installation.classPath[0], path.join(javaDir, "NetLogo.jar"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("detects nested NetLogo installations from a search root", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "netlogo-detect-"));
  try {
    const appDir = path.join(tempDir, "NetLogo 6.4.0", "NetLogo 6.4.0.app", "Contents", "Java");
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, "NetLogo.jar"), "");

    const installations = detectNetLogoInstallations([tempDir]);
    assert.equal(installations.length, 1);
    assert.match(installations[0].home, /NetLogo 6\.4\.0\.app$/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("finds NetLogo 6 app jar distributions", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "netlogo-app-jar-"));
  try {
    const home = path.join(tempDir, "NetLogo 6.4.0");
    fs.mkdirSync(path.join(home, "app"), { recursive: true });
    fs.mkdirSync(path.join(home, "extensions"));
    fs.mkdirSync(path.join(home, "models"));
    fs.writeFileSync(path.join(home, "app", "netlogo-6.4.0.jar"), "");
    fs.writeFileSync(path.join(home, "app", "netlogo-mac-app.jar"), "");

    const installation = installationFromHome(home);
    assert.equal(installation.home, home);
    assert.equal(installation.jarPath, path.join(home, "app", "netlogo-6.4.0.jar"));
    assert.equal(installation.classPath[0], path.join(home, "app", "netlogo-6.4.0.jar"));
    assert.ok(installation.classPath.includes(path.join(home, "app", "*")));
    assert.ok(installation.jvmArgs.includes(`-Dnetlogo.extensions.dir=${path.join(home, "extensions")}`));
    assert.ok(installation.jvmArgs.includes(`-Dnetlogo.models.dir=${path.join(home, "models")}`));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("finds the native NetLogo app near jar-based installations", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "netlogo-native-app-"));
  try {
    const home = path.join(tempDir, "NetLogo 6.4.0");
    const appBundle = path.join(home, "NetLogo 6.4.0.app");
    const app3DBundle = path.join(home, "NetLogo 3D 6.4.0.app");
    fs.mkdirSync(path.join(home, "app"), { recursive: true });
    fs.mkdirSync(appBundle, { recursive: true });
    fs.mkdirSync(app3DBundle, { recursive: true });
    fs.writeFileSync(path.join(home, "app", "netlogo-6.4.0.jar"), "");

    const installation = installationFromHome(home);
    assert.equal(installation.home, home);
    assert.equal(findNativeNetLogoApp(installation.home), appBundle);
    assert.equal(findNativeNetLogoApp(appBundle), appBundle);
    assert.equal(findNativeNetLogoApp(installation.home, { threeD: true }), app3DBundle);
    assert.equal(findNativeNetLogoApp(appBundle, { threeD: true }), app3DBundle);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("prefers explicit classpath over home and autodetection", () => {
  const resolved = resolveNetLogoClassPath({
    configuredClassPath: ["/custom/NetLogo.jar", "/custom/lib/*"],
    home: "/missing",
    autoDetect: false
  });

  assert.deepEqual(resolved.classPath, ["/custom/NetLogo.jar", "/custom/lib/*"]);
  assert.equal(resolved.jarPath, "/custom/NetLogo.jar");
  assert.deepEqual(resolved.jvmArgs, []);
});

test("resolves classpath from configured home", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "netlogo-home-"));
  try {
    fs.writeFileSync(path.join(tempDir, "NetLogo.jar"), "");
    fs.mkdirSync(path.join(tempDir, "lib"));

    const resolved = resolveNetLogoClassPath({
      home: tempDir,
      autoDetect: false
    });

    assert.equal(resolved.jarPath, path.join(tempDir, "NetLogo.jar"));
    assert.ok(resolved.classPath.includes(path.join(tempDir, "lib", "*")));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("builds JVM args expected by modern NetLogo launchers", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "netlogo-jvm-args-"));
  try {
    fs.mkdirSync(path.join(tempDir, "app"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "extensions"));
    fs.mkdirSync(path.join(tempDir, "models"));
    const jarPath = path.join(tempDir, "app", "netlogo-6.4.0.jar");
    fs.writeFileSync(jarPath, "");

    const args = buildJvmArgs(jarPath);
    assert.ok(args.includes("-Dfile.encoding=UTF-8"));
    assert.ok(args.includes("-Djava.awt.headless=true"));
    assert.ok(args.includes(`-Dnetlogo.extensions.dir=${path.join(tempDir, "extensions")}`));
    assert.ok(args.includes(`-Dnetlogo.models.dir=${path.join(tempDir, "models")}`));
    assert.ok(args.includes("--add-exports=java.base/java.lang=ALL-UNNAMED"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
