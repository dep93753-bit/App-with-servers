/* ===================== Game launcher ===================== */
/* ---- THE GAMES LIST: to add a game, copy games/_template.html and add ONE line here ---- */
const GAMES = [
  { id: 'battleship', name: 'Battleship',     icon: 'bxs-ship',   color: '#2F65C8', file: 'games/battleship.html' },
  { id: 'bubble',     name: 'Bubble Shooter', icon: 'bxs-circle', color: '#7c3aed', file: 'games/bubble.html' },
  { id: 'asteroids',  name: 'Asteroids',      icon: 'bxs-planet', color: '#0d9488', file: 'games/asteroids.html' },
  { id: 'tetris',     name: 'Tetris',         icon: 'bxs-extension', color: '#e11d48', file: 'games/tetris.html' },
  { id: 'blockblast', name: 'Block Blast',    icon: 'bxs-cube',   color: '#ea580c', file: 'games/blockblast.html' },
  { id: 'connect4',   name: 'Connect 4',      icon: 'bxs-grid-alt', color: '#f59e0b', file: 'games/connect4.html' },
  { id: 'match3',     name: 'Match 3',        icon: 'bxs-diamond', color: '#db2777', file: 'games/match3.html' },
];
const GAME_DESC = { battleship: 'Sink the enemy fleet', bubble: 'Match and pop bubbles', asteroids: 'Blast the space rocks', tetris: 'Stack blocks, clear lines', blockblast: 'Pop same-color groups', connect4: 'Drop discs to connect four', match3: 'Swap tiles to match 3' };
const gameBtns = (attr, id) => `<button class="playbtn browse" data-browse="${id}"><i class='bx bxs-joystick'></i> Browse games</button>`;
function openGamePicker(quizId) {
  openModal(`<h3>Pick a game</h3><p class="sub">Every game uses the same questions.</p>
    <div class="gpick">${GAMES.map(g => `<button class="gcard" data-g="${g.id}"><span class="gic" style="background:${g.color}"><i class='bx ${g.icon}'></i></span><b>${g.name}</b><small>${GAME_DESC[g.id] || ''}</small></button>`).join('')}</div>
    <div class="foot"><button class="btn ghost" data-x>Cancel</button></div>`);
  $('#modal [data-x]').onclick = closeModal;
  $('#modal').querySelectorAll('[data-g]').forEach(b => b.onclick = () => { closeModal(); openGame(b.dataset.g, qsets.find(x => x.id === quizId) || null); });
}
document.addEventListener('click', e => { const b = e.target.closest('[data-browse]'); if (b) openGamePicker(b.dataset.browse); });

function openGame(type, qs) {
  const frame = $('#battleFrame');
  const qs_ = (qs && Array.isArray(qs.questions) && qs.questions.length) ? qs : { id: 'preset', title: 'Preset Quiz', questions: PRESET_QUESTIONS };
  frame.onload = () => {
    // hand the questions to the game once its page has loaded
    frame.contentWindow.postMessage({ type: 'loadQuiz', questions: qs_.questions, quizId: qs_.id }, '*');
  };
  frame.src = (GAMES.find(g => g.id === type) || GAMES[0]).file;
  $('#battleWrap').classList.add('show');
