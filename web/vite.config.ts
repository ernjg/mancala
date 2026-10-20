import { defineConfig } from "vite";

export default defineConfig({
    base: "/mancala/",  // served at ernjg.github.io/mancala
    // main.ts imports the engine from ../rules, which is outside this folder.
    server: { fs: { allow: [".."] } },
});
