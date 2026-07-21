import { defineConfig } from '@playwright/test';

/**
 * E2E a nivel API (sin browser) — usa el fixture `request` de Playwright
 * para ejercitar los 4 flujos exigidos por el plan original directamente
 * contra los endpoints HTTP, igual que las verificaciones manuales por curl
 * hechas durante el desarrollo de cada fase, pero ahora repetibles en CI.
 *
 * `workers: 1` + `fullyParallel: false` a propósito: los tests mutan datos
 * reales del tenant demo (crean pedidos, cobran, asignan repartidores) — no
 * son seguros para correr en paralelo entre sí sin pisarse.
 */
export default defineConfig({
  testDir: './test/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    // OJO: la barra final es obligatoria — Playwright resuelve rutas
    // relativas contra baseURL con las reglas de WHATWG URL, y sin el "/"
    // final el último segmento ("api") se trata como archivo y se descarta.
    baseURL: process.env.E2E_API_BASE_URL ?? 'http://localhost:3001/api/',
    extraHTTPHeaders: { 'Content-Type': 'application/json' },
  },
});
