const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeNetLogoLocalCompletions } = require("../out/modelCompletions");

test("NetLogo local completions include procedures and reporters", () => {
  const source = [
    "globals [ ticks-seen ]",
    "",
    "to setup",
    "  clear-all",
    "end",
    "",
    "to-report flock-size [ turtle-id ]",
    "  report count turtles",
    "end"
  ].join("\n");

  assert.deepEqual(analyzeNetLogoLocalCompletions(source), [
    { name: "setup", kind: "procedure", signature: "to setup" },
    { name: "flock-size", kind: "reporter", signature: "to-report flock-size [ turtle-id ]" },
    { name: "ticks-seen", kind: "global", signature: "globals [ ticks-seen ]" }
  ]);
});

test("NetLogo local completions ignore duplicate definitions case-insensitively", () => {
  const source = [
    "to setup",
    "end",
    "",
    "to SETUP",
    "end"
  ].join("\n");

  assert.deepEqual(analyzeNetLogoLocalCompletions(source), [
    { name: "setup", kind: "procedure", signature: "to setup" }
  ]);
});

test("NetLogo local completions include owned variables from multiline declarations", () => {
  const source = [
    "turtles-own [",
    "  flockmates",
    "  nearest-neighbor",
    "]",
    "patches-own [ chemical food ]",
    "links-own [ strength ]"
  ].join("\n");

  assert.deepEqual(analyzeNetLogoLocalCompletions(source), [
    { name: "flockmates", kind: "turtle variable", signature: "turtles-own [ flockmates nearest-neighbor ]" },
    { name: "nearest-neighbor", kind: "turtle variable", signature: "turtles-own [ flockmates nearest-neighbor ]" },
    { name: "chemical", kind: "patch variable", signature: "patches-own [ chemical food ]" },
    { name: "food", kind: "patch variable", signature: "patches-own [ chemical food ]" },
    { name: "strength", kind: "link variable", signature: "links-own [ strength ]" }
  ]);
});

test("NetLogo local completions include plural and singular breed names", () => {
  const source = [
    "breed [ wolves wolf ]",
    "directed-link-breed [ roads road ]",
    "undirected-link-breed [ friendships friendship ]"
  ].join("\n");

  assert.deepEqual(analyzeNetLogoLocalCompletions(source), [
    { name: "wolves", kind: "breed", signature: "breed [ wolves wolf ]" },
    { name: "wolf", kind: "breed", signature: "breed [ wolves wolf ]" },
    { name: "roads", kind: "breed", signature: "directed-link-breed [ roads road ]" },
    { name: "road", kind: "breed", signature: "directed-link-breed [ roads road ]" },
    { name: "friendships", kind: "breed", signature: "undirected-link-breed [ friendships friendship ]" },
    { name: "friendship", kind: "breed", signature: "undirected-link-breed [ friendships friendship ]" }
  ]);
});

test("NetLogo local completions ignore comments and duplicate declared names", () => {
  const source = [
    "globals [ energy ; hidden",
    "  speed",
    "]",
    "turtles-own [ ENERGY altitude ]"
  ].join("\n");

  assert.deepEqual(analyzeNetLogoLocalCompletions(source), [
    { name: "energy", kind: "global", signature: "globals [ energy speed ]" },
    { name: "speed", kind: "global", signature: "globals [ energy speed ]" },
    { name: "altitude", kind: "turtle variable", signature: "turtles-own [ ENERGY altitude ]" }
  ]);
});
