/* quiz-modal.js — shared by Battleship, Bubble Shooter and Asteroids.
   1) Receives the questions from the app (postMessage {type:'loadQuiz', questions, quizId}).
   2) Injects the popup's CSS.
   3) Provides makeQuizModal(): the "out of ammo — answer a question" popup. */

var QUESTIONS = [];
var QUIZ_ID = 'preset';

window.addEventListener('message', function (e) {
  if (e.source !== window.parent) return;
  var d = e.data;
  if (!d || d.type !== 'loadQuiz') return;
  QUESTIONS = Array.isArray(d.questions) ? d.questions : [];
  QUIZ_ID = d.quizId || 'preset';
});

(function () {
  var style = document.createElement('style');
  style.textContent = "\n.quiz-overlay{position:fixed;inset:0;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px}\n.quiz-box{background:#1a1a2e;border:3px solid #fff;border-radius:16px;padding:24px;max-width:640px;width:100%;color:#fff;font-family:\"Outfit\",sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.6);max-height:92vh;overflow-y:auto}\n.quiz-box h3{margin:0 0 6px;font-size:1.3rem;text-align:center;font-weight:800}\n.quiz-box .sub{opacity:.85;font-size:.9rem;margin-bottom:16px;text-align:center}\n.quiz-box .sub b{color:#f0c14b}\n.quiz-box .qtext{font-size:1.25rem;font-weight:800;margin-bottom:20px;line-height:1.35;text-align:center;padding:18px;background:#fff;color:#1a1a2e;border-radius:12px;word-break:break-word}\n.quiz-box .opts{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px}\n.quiz-box .opt{display:flex;align-items:center;gap:12px;padding:16px 18px;border-radius:10px;border:none;color:#fff;font-family:inherit;text-align:left;font-size:1rem;font-weight:700;cursor:pointer;box-shadow:0 4px 0 rgba(0,0,0,.35);transition:transform .08s;min-height:64px}\n.quiz-box .opt:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 6px 0 rgba(0,0,0,.35)}\n.quiz-box .opt .shape{width:28px;height:28px;flex:none;display:flex;align-items:center;justify-content:center}\n.quiz-box .opt .shape svg{width:100%;height:100%;display:block}\n.quiz-box .opt .opttext{flex:1;line-height:1.3}\n.quiz-box .opt[data-opt=\"0\"]{background:#e21b3c}\n.quiz-box .opt[data-opt=\"1\"]{background:#1368ce}\n.quiz-box .opt[data-opt=\"2\"]{background:#d89e00}\n.quiz-box .opt[data-opt=\"3\"]{background:#26890c}\n.quiz-box .opt.correct{outline:4px solid #fff;outline-offset:3px}\n.quiz-box .opt.wrong{opacity:.4}\n.quiz-box .quiz-foot{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:.9rem;padding-top:10px;flex-wrap:wrap}\n.quiz-box .quiz-foot>span:first-child{flex:1;min-width:180px}\n.quiz-box .btn{padding:10px 22px;border:none;border-radius:8px;background:#fff;color:#1a1a2e;font-family:inherit;font-weight:800;cursor:pointer;font-size:.95rem}\n@media(max-width:560px){.quiz-box .opts{grid-template-columns:1fr}.quiz-box .qtext{font-size:1.05rem}.quiz-box{padding:18px}}\n.ammo-badge{padding:6px 12px;border-radius:20px;background:rgba(240,193,75,.18);border:1px solid rgba(240,193,75,.5);color:#f0c14b;font-size:.9rem;font-weight:700}\n.ammo-badge.low{background:rgba(214,69,69,.18);border-color:rgba(214,69,69,.6);color:#ff8a8a}\n";
  document.head.appendChild(style);
})();

function escHtml(s){return String(s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function makeQuizModal(opts) {
  var SHAPES=['<svg viewBox="0 0 24 24"><polygon points="12,2 22,20 2,20" fill="#fff"/></svg>','<svg viewBox="0 0 24 24"><polygon points="12,2 22,12 12,22 2,12" fill="#fff"/></svg>','<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#fff"/></svg>','<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" fill="#fff"/></svg>'];
  return function openQuiz(onDone) {
    if (opts.isOpen()) return;
    if (!QUESTIONS || !QUESTIONS.length) { opts.setAmmo(opts.getAmmo() + opts.gainCorrect); opts.onUpdate(); if (typeof onDone === 'function') onDone(); return; }
    opts.setOpen(true);
    var idx = opts.getIdx(); var q = QUESTIONS[idx % QUESTIONS.length]; var qIdx = idx % QUESTIONS.length; opts.setIdx(idx + 1);
    var ov = document.createElement('div'); ov.className = 'quiz-overlay'; ov.id = 'quizOverlay';
    var box = document.createElement('div'); box.className = 'quiz-box';
    var letters = ['A','B','C','D']; var optHtml = '';
    for (var i = 0; i < 4; i++) optHtml += '<button type="button" class="opt" data-opt="' + i + '"><span class="shape">' + SHAPES[i] + '</span><span class="opttext">' + letters[i] + '. ' + escHtml(q.options[i] || '') + '</span></button>';
    box.innerHTML = '<h3>Out of ammo — reload!</h3><p class="sub">Correct = <b>+' + opts.gainCorrect + '</b> ammo &nbsp;·&nbsp; Wrong = +' + opts.gainWrong + '</p><div class="qtext">' + escHtml(q.question) + '</div><div class="opts">' + optHtml + '</div><div class="quiz-foot"><span id="qFeedback"></span><span id="qNextWrap"></span></div>';
    var optsEl = box.querySelector('.opts');
    Array.prototype.forEach.call(optsEl.children, function(b, i) {
      b.addEventListener('click', function() {
        if (b.disabled) return;
        var correct = q.correct; var ok = i === correct;
        if (ok) b.classList.add('correct'); else { b.classList.add('wrong'); optsEl.children[correct].classList.add('correct'); }
        Array.prototype.forEach.call(optsEl.children, function(x) { x.disabled = true; });
        var gain = ok ? opts.gainCorrect : opts.gainWrong; opts.setAmmo(opts.getAmmo() + gain); opts.onUpdate();
        if (typeof opts.onAnswer === 'function') opts.onAnswer(qIdx, ok);
        document.getElementById('qFeedback').innerHTML = (ok ? '<b style="color:#7dd87d">✓ Correct!</b> ' : '<b style="color:#ff8a8a">✗ Nope.</b> ') + '<b style="color:#f0c14b">+' + gain + ' ammo</b>' + (q.explanation ? ' <span style="opacity:.8">· ' + escHtml(q.explanation) + '</span>' : '');
        var nw = document.getElementById('qNextWrap');
        var nb = document.createElement('button'); nb.type = 'button'; nb.className = 'btn'; nb.textContent = 'Continue';
        nb.addEventListener('click', function() { ov.remove(); opts.setOpen(false); if (typeof onDone === 'function') onDone(); });
        nw.appendChild(nb);
      });
    });
    ov.appendChild(box); document.body.appendChild(ov);
  };
}


/* ===== GameKit — shared "moves run out → answer a question → get more" plumbing =====
   Used by Tetris, Block Blast, Match-3, Checkers and Connect 4. Each game gives it: id, starting ammo, ammo per right/wrong
   answer, how many wrong answers lose the game, and three callbacks (onUpdate, getScore, restart). */
(function () {
  var st = document.createElement('style');
  st.textContent = '.kit-end{position:fixed;inset:0;background:rgba(2,6,23,.82);display:flex;align-items:center;justify-content:center;z-index:9000;color:#f1f5f9;text-align:center;font-family:"Outfit",system-ui,sans-serif}.kit-end h2{font-size:2rem;margin-bottom:6px}.kit-end p{margin-bottom:14px;color:#94a3b8}';
  document.head.appendChild(st);
})();
function GameKit(o) {
  var k = { ammo: o.ammo, wrong: 0, answers: [], over: false }, idx = 0, open = false;
  if (window.parent === window && !QUESTIONS.length)        // opened on its own for testing
    QUESTIONS = [{ question: '2 + 2 = ?', options: ['3', '4', '5', '6'], correct: 1, explanation: '' },
                 { question: 'Capital of France?', options: ['Rome', 'Paris', 'Madrid', 'Berlin'], correct: 1, explanation: '' }];
  var openQuiz = makeQuizModal({
    isOpen: function () { return open; }, setOpen: function (v) { open = v; },
    getAmmo: function () { return k.ammo; }, setAmmo: function (v) { k.ammo = v; },
    getIdx: function () { return idx; }, setIdx: function (v) { idx = v; },
    gainCorrect: o.gainCorrect, gainWrong: o.gainWrong, onUpdate: o.onUpdate,
    onAnswer: function (q, c) { k.answers.push({ qIdx: q, correct: c }); if (!c) k.wrong++; }
  });
  k.ask = function (cb) {                                   // out of ammo: show a question, then carry on (or lose)
    openQuiz(function () { o.onUpdate(); if (k.wrong >= o.maxWrong) k.end(false); else if (cb) cb(); });
  };
  k.end = function (won) {                                  // game over: show result + tell the app
    if (k.over) return; k.over = true;
    var d = document.createElement('div'); d.className = 'kit-end';
    d.innerHTML = '<div><h2>' + (won ? '🎉 You win!' : 'Game over') + '</h2><p>Score ' + o.getScore() + '</p><button class="btn">Play again</button></div>';
    d.querySelector('button').onclick = function () { d.remove(); k.over = false; k.ammo = o.ammo; k.wrong = 0; k.answers = []; idx = 0; o.restart(); };
    document.body.appendChild(d);
    try { window.parent.postMessage({ type: 'gameEnd', game: o.id, quizId: QUIZ_ID, won: won, score: o.getScore(), answers: k.answers }, '*'); } catch (e) {}
  };
  return k;
}
