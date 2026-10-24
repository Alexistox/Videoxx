import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { cpSync } from "node:fs";

// the addons (videoxx-auth, -connectors, ...) are loaded with require() at runtime from next to out/main/index.js
const copyAddons = () => ({ name: "copy-addons", closeBundle() { cpSync("src/main/addons", "out/main", { recursive: true }); } });

export default defineConfig({
  // one main file, like the shipped build (several modules are both imported and import()-ed)
  main: { plugins: [externalizeDepsPlugin(), copyAddons()], build: { rollupOptions: { output: { inlineDynamicImports: true } } } },
  preload: { plugins: [externalizeDepsPlugin()] },
  // assets stay files (the shipped build never inlined them as data: URIs)
  renderer: { plugins: [react()], build: { assetsInlineLimit: 0 } },
});
