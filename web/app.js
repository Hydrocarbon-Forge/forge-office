// web/app.js — Forge Office browser client bootstrap
window.addEventListener('DOMContentLoaded', () => {
  const game = new Game();
  window.game = game;
  window.forgeOfficeGame = game;
  game.init().catch((err) => {
    console.error('Failed to initialize Forge Office:', err);
  });
});
