import './style.css';
import { Game } from './core/Game.js';

const game = new Game(document.getElementById('app'));

// Exposed for debugging in the browser console.
window.game = game;
