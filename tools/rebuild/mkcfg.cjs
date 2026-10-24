const fs = require("fs");
const S = "C:/Users/lehoa/AppData/Local/Temp/claude/C--Users-lehoa-Claude-Code-app-lost-sourcecode/47529fde-d198-4f60-b502-5e6960e86c1d/scratchpad";
const O = "C:/Users/lehoa/Claude Code/app-lost sourcecode/Videoxx-src/out";
const outRoot = process.argv[2] || S + "/gen";
const check = process.argv[3] === "check";
for (const [k, b, f, root] of [["main", O + "/main/index.js", 24, "src/main"], ["ren", O + "/renderer/assets/index-B0c_tFBy.js", 14239, "src/renderer/src"]])
  fs.writeFileSync(S + "/c-" + k + ".json", JSON.stringify({ kind: k, bundle: b, firstLine: f, outRoot, srcRoot: root, report: S + "/r-" + k + ".json", modules: JSON.parse(fs.readFileSync(S + "/an/" + k + "-modules.json")), checkOnly: check, lucideRange: k === "ren" ? [15253, 18193] : null }));
