import { defineConfig } from "vite";

export default defineConfig({
    // main.ts imports the engine from ../rules, which is outside this folder.
    server: { fs: { allow: [".."] } },
});
