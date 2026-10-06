// web/app.js — Forge Office browser client bootstrap
window.addEventListener('DOMContentLoaded', () => {
  const game = new Game();
  window.forgeOfficeGame = game;
  game.init().catch((err) => {
    console.error('Failed to initialize Forge Office:', err);
  });
});
