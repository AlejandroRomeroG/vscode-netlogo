const Module = require("node:module");
const test = require("node:test");
const assert = require("node:assert/strict");

const originalLoad = Module._load;
Module._load = function loadWithVscodeMock(request, parent, isMain) {
  if (request === "vscode") {
    return {
      ProgressLocation: { Notification: 15 },
      Uri: {
        joinPath() {
          return { fsPath: "" };
        }
      },
      window: {},
      workspace: {}
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};

const { parseNetLogoDelimitedList } = require("../out/runner");
Module._load = originalLoad;

test("parses NetLogo 3D string lists with quoted entries", () => {
  assert.deepEqual(parseNetLogoDelimitedList("[\"0|1|2|3|15|90|0|1|default||9.9\" \"1|4|5|6|55|180|0|2|circle|leader|15\"]"), [
    "0|1|2|3|15|90|0|1|default||9.9",
    "1|4|5|6|55|180|0|2|circle|leader|15"
  ]);
});

test("parses legacy comma-separated 3D list entries", () => {
  assert.deepEqual(parseNetLogoDelimitedList("[0|1|2|3, 1|4|5|6, 2|7|8|9]"), [
    "0|1|2|3",
    "1|4|5|6",
    "2|7|8|9"
  ]);
});
