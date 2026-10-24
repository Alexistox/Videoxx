#!/bin/sh
# regenerate videoxx-source/src from the bundles (keeps the hand-written scaffolding)
set -e
S="/c/Users/lehoa/AppData/Local/Temp/claude/C--Users-lehoa-Claude-Code-app-lost-sourcecode/47529fde-d198-4f60-b502-5e6960e86c1d/scratchpad"
P="/c/Users/lehoa/Claude Code/app-lost sourcecode/videoxx-source"
find "$P/src/main" -name '*.js' -not -path '*/addons/*' -delete
find "$P/src/renderer/src" \( -name '*.js' -o -name '*.jsx' \) -delete
cd "$S/tools"
node mkcfg.cjs "C:/Users/lehoa/Claude Code/app-lost sourcecode/videoxx-source"
node gen.mjs ../c-main.json
node gen.mjs ../c-ren.json
M="$P/src/renderer/src/main.jsx"
printf 'import "@fontsource/inter/400.css";\nimport "@fontsource/inter/500.css";\nimport "@fontsource/inter/600.css";\nimport "@fontsource/inter/700.css";\nimport "@fontsource/inter/800.css";\nimport "./styles.css";\n' | cat - "$M" > "$M.tmp" && mv "$M.tmp" "$M"
find "$P/src" -type d -empty -delete
