import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Hosts permitidos al servir el front detrás de un dominio (dev y preview).
// El punto inicial habilita el dominio y todos sus subdominios:
// ".medplum.com.ar" cubre "recepcion.medplum.com.ar".
const ALLOWED_HOSTS = ['.segundaopinionmedica.org', '.medplum.com.ar', 'localhost', '127.0.0.1'];

export default defineConfig({
  plugins: [react()],

  // Exponemos al navegador SOLO variables con estos prefijos (convención Medplum:
  // MEDPLUM_BASE_URL, GOOGLE_CLIENT_ID, RECAPTCHA_SITE_KEY, etc.).
  // ⚠️ SEGURIDAD: nunca pongas secretos en app/.env. Con el prefijo MEDPLUM_, una
  // variable como MEDPLUM_CLIENT_SECRET quedaría embebida en el bundle del cliente.
  // Los secretos van solo en el .env de la raíz (seed/bots), que NO se carga acá.
  envPrefix: ['MEDPLUM_', 'GOOGLE_', 'RECAPTCHA_'],

  // Alias `@som` -> ../src para reutilizar la lógica pura del backend (semáforo,
  // tipos, catálogo). `fs.allow: ['..']` permite importar desde la raíz del repo.
  resolve: {
    alias: {
      '@som': fileURLToPath(new URL('../src', import.meta.url)),
    },
  },

  server: {
    port: 5173,
    host: true,
    allowedHosts: ALLOWED_HOSTS,
    fs: { allow: ['..'] },
  },

  preview: {
    port: 5173,
    host: true,
    allowedHosts: ALLOWED_HOSTS,
  },
});
