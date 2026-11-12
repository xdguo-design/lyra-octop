import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [vue()],
  build: {
    outDir:
      mode === "octop"
        ? fileURLToPath(
            new URL(
              "../../../src/octop/dashboard/patient-appointment",
              import.meta.url,
            ),
          )
        : fileURLToPath(new URL("./dist", import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
  },
  resolve: { alias: { "@": `${root}src` } },
}));
