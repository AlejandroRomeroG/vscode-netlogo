const Module = require("node:module");
const test = require("node:test");
const assert = require("node:assert/strict");

const originalLoad = Module._load;
Module._load = function loadWithVscodeMock(request, parent, isMain) {
  if (request === "vscode") {
    return {
      QuickPickItemKind: {
        Separator: -1
      },
      window: {}
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};

const {
  COMMON_NETLOGO_COMMANDS,
  buildNetLogoCommandPicks,
  clearNetLogoCommandHistory,
  normalizeNetLogoCommandHistory
} = require("../out/commandPrompt");
Module._load = originalLoad;

test("normalizes NetLogo command history for command prompts", () => {
  assert.deepEqual(normalizeNetLogoCommandHistory([
    " setup ",
    "",
    "go",
    "setup",
    42,
    "reset-perspective",
    "go",
    "ask turtles [ fd 1 ]",
    "clear-all",
    "tick",
    "display",
    "print count turtles",
    "extra command"
  ]), [
    "setup",
    "go",
    "reset-perspective",
    "ask turtles [ fd 1 ]",
    "clear-all",
    "tick",
    "display",
    "print count turtles"
  ]);
});

test("builds command picks from recent and common NetLogo commands", () => {
  const picks = buildNetLogoCommandPicks(["go", "setup", "ask turtles [ fd 1 ]"]);

  assert.equal(picks[0].action, "new");
  assert.equal(picks[1].label, "Recent");
  assert.equal(picks[1].kind, -1);
  assert.equal(picks[2].label, "go");
  assert.equal(picks[2].description, "Most recent");
  assert.equal(picks[3].label, "setup");
  assert.equal(picks[3].description, "Recent");
  assert.equal(picks[4].label, "ask turtles [ fd 1 ]");
  assert.equal(picks[4].description, "Recent");
  assert.ok(picks.some(pick => pick.label === "Common" && pick.kind === -1));
  assert.ok(picks.some(pick => pick.label === "reset-ticks" && pick.description === "Common"));
  assert.ok(!picks.some((pick, index) => index > 2 && pick.label === "go"));
  assert.deepEqual(COMMON_NETLOGO_COMMANDS.slice(0, 2), ["setup", "go"]);
});

test("clears command history and legacy command storage", async () => {
  const updates = [];
  const context = {
    globalState: {
      async update(key, value) {
        updates.push([key, value]);
      }
    }
  };

  await clearNetLogoCommandHistory(context);

  assert.deepEqual(updates, [
    ["netlogo.commandHistory", undefined],
    ["netlogo.lastCommand", undefined]
  ]);
});
