import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * Testes de ponta a ponta. Cada execução sobe um backend descartável (AWS simulada em memória,
 * ver backend/e2e_server.py) e um Vite apontando para ele, então não dependem do Docker nem do .env.
 */
const API_PORT = 8020;
const WEB_PORT = 5175;
const backendDir = path.resolve(import.meta.dirname, "../backend");

function python(): string {
  if (process.env.E2E_PYTHON) return process.env.E2E_PYTHON;
  const venv = ["Scripts/python.exe", "bin/python"].map((p) => path.join(backendDir, ".venv", p)).find((p) => existsSync(p));
  return venv ?? "python";
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1, // os testes compartilham o mesmo backend
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    locale: "pt-BR",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `"${python()}" e2e_server.py`,
      cwd: backendDir,
      env: { E2E_API_PORT: String(API_PORT) },
      url: `http://127.0.0.1:${API_PORT}/api/site`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      env: { VITE_API_TARGET: `http://127.0.0.1:${API_PORT}` },
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
