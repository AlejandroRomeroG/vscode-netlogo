const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..");

test("NetLogo completion provider includes common snippets and primitives", () => {
  const source = fs.readFileSync(path.join(root, "src", "netlogoCompletions.ts"), "utf8");

  assert.match(source, /export function createNetLogoCompletionProvider/);
  assert.match(source, /label: "to procedure"/);
  assert.match(source, /to \$\{1:name\}\\n  \$\{0\}\\nend/);
  assert.match(source, /label: "to-report reporter"/);
  assert.match(source, /ask \$\{1:agentset\} \[/);
  assert.match(source, /ifelse \$\{1:condition\} \[/);
  assert.match(source, /globals \[/);
  assert.match(source, /turtles-own \[/);
  assert.match(source, /patches-own \[/);
  assert.match(source, /const keywordCompletions = \[/);
  assert.match(source, /"to-report"/);
  assert.match(source, /"patches-own"/);
  assert.match(source, /const primitiveCompletions = \[/);
  assert.match(source, /"clear-all"/);
  assert.match(source, /"create-turtles"/);
  assert.match(source, /"reset-ticks"/);
  assert.match(source, /new vscode\.SnippetString/);
  assert.match(source, /analyzeNetLogoLocalCompletions/);
  assert.match(source, /function localCompletionItems\(document: vscode\.TextDocument\): vscode\.CompletionItem\[\]/);
  assert.match(source, /parseNetLogoModel\(document\.getText\(\), document\.fileName\)/);
  assert.match(source, /function localCompletionItem\(completion: LocalCompletion, index: number\): vscode\.CompletionItem/);
  assert.match(source, /function completionItemKind\(completion: LocalCompletion\): vscode\.CompletionItemKind/);
  assert.match(source, /NetLogo \$\{completion\.kind\}/);
  assert.match(source, /vscode\.CompletionItemKind\.Variable/);
  assert.match(source, /vscode\.CompletionItemKind\.Class/);
});

test("NetLogo completion provider avoids comments and strings", () => {
  const source = fs.readFileSync(path.join(root, "src", "netlogoCompletions.ts"), "utf8");

  assert.match(source, /function isInsideCommentOrString\(line: string, character: number\): boolean/);
  assert.match(source, /if \(current === ";" && !inString\) \{[\s\S]*?return true;/);
  assert.match(source, /return inString;/);
  assert.match(source, /if \(isInsideCommentOrString\(document\.lineAt\(position\.line\)\.text, position\.character\)\) \{[\s\S]*?return \[\];/);
});
