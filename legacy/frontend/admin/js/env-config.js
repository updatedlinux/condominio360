// Admin Frontend Configuration
// Este archivo es SOBRESCRITO por el servidor (app.ts o admin_server.ts) con ADMIN_API_URL/API_BASE_URL.
// Si se sirve estático (sin override), admin-config.js usa window.location.origin + '/api' como fallback.
window.AdminConfigEnv = window.AdminConfigEnv || { API_URL: "" };
