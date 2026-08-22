import glsl from "vite-plugin-glsl";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [glsl()],
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
