// Revisión automática del código: npm run lint. Avisa de variables sin uso, nombres mal escritos y errores comunes.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'css/', '.hallmark/', 'pedidos/'] },
  js.configs.recommended,
  // Servidor y pruebas (Node.js, módulos).
  {
    files: ['**/*.mjs'],
    languageOptions: { sourceType: 'module', globals: globals.node }
  },
  // Páginas del sitio: módulos del navegador (import/export entre los archivos de js/).
  {
    files: ['js/**/*.js'],
    languageOptions: { sourceType: 'module', globals: globals.browser }
  },
  {
    rules: {
      'no-unused-vars': ['error', { caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  }
];
