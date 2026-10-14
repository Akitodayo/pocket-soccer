// 起動とゲームループ
import { createScene, updateCamera } from './scene.js';
import { createField, FIELD } from './field.js';
import { createBall } from './ball.js';
import { Player } from './player.js';
import { getMove, consumeKick, consumePause, consumeRestart, clearQueued } from './input.js';

// 試合の調整用の数値
const MATCH = {
  length: 180,      // 試合時間（秒）
  goalPause: 2.2,   // 得点してからキックオフまでの時間（秒）
  goalBanner: 1.0,  // 「GOAL!」を表示する時間（秒）
  hurryTime: 10,    // 残りこの秒数からタイマーを赤くする
};

// 確認用：URL の末尾に ?time=20 を付けると試合時間を20秒にできる
const matchLength = Number(new URLSearchParams(location.search).get('time')) || MATCH.length;

const container = document.getElementById('game');
const { renderer, scene, camera } = createScene(container);

createField(scene);
const ball = createBall(scene);
const player = new Player(scene, { color: 0x2f6fe0, x: -5, z: 0, attackDir: 1, controlled: true });

// 右のゴール（x>0）に入れば青の得点、左なら赤の得点
const TEAM_BY_GOAL = { 1: 'blue', '-1': 'red' };

const hud = {
  blue: document.getElementById('score-blue'),
  red: document.getElementById('score-red'),
  timer: document.getElementById('timer'),
  banner: document.getElementById('goal-banner'),
  message: document.getElementById('message'),
};

const match = {
  phase: 'playing', // playing（試合中）/ goal（得点後の演出）/ finished（試合終了）
  paused: false,
  timeLeft: matchLength,
  score: { blue: 0, red: 0 },
  phaseTimer: 0,
  goalSide: 0,
};

// 画面から見た向きを、ピッチ上の向きに直す。カメラは攻める方向を向いているので、
// 画面の奥が攻める方向（x）、画面の右がそこから右手（z）になる
function toFieldMove({ right, forward }) {
  return { x: forward * player.attackDir, z: right * player.attackDir };
}

function startMatch() {
  match.phase = 'playing';
  match.paused = false;
  match.timeLeft = matchLength;
  match.score.blue = 0;
  match.score.red = 0;
  hud.banner.hidden = true;
  hud.message.hidden = true;
  kickoff('blue');
  updateCamera(camera, player.position, player.attackDir, 0, true);
  updateHud();
}

// ボールを中央に置き、kickingTeam がボールのすぐ後ろから始める
function kickoff(kickingTeam) {
  ball.reset();
  player.reset(kickingTeam === 'blue');
  match.phase = 'playing';
}

function onGoal(side) {
  const team = TEAM_BY_GOAL[side];
  match.score[team] += 1;
  match.phase = 'goal';
  match.phaseTimer = MATCH.goalPause;
  match.goalSide = side;
  hud.banner.hidden = false;
  updateHud();
}

function finishMatch() {
  match.phase = 'finished';
  match.timeLeft = 0;
  const { blue, red } = match.score;
  const result = blue > red ? '勝ち！' : blue < red ? '負け…' : '引き分け';
  showMessage(`<strong>試合終了　${blue} - ${red}　${result}</strong>Rキーでもう一度`);
  updateHud();
}

function togglePause() {
  if (match.phase === 'finished') return;
  match.paused = !match.paused;
  clearQueued();
  if (match.paused) showMessage('<strong>一時停止中</strong>Escキーで再開');
  else hud.message.hidden = true;
}

function showMessage(html) {
  hud.message.innerHTML = html;
  hud.message.hidden = false;
}

function updateHud() {
  hud.blue.textContent = match.score.blue;
  hud.red.textContent = match.score.red;
  const seconds = Math.ceil(match.timeLeft);
  hud.timer.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  hud.timer.classList.toggle('hurry', seconds <= MATCH.hurryTime);
}

// 1コマ分、試合を進める
function step(dt) {
  if (match.phase === 'playing') {
    player.update(dt, toFieldMove(getMove()));
    if (consumeKick()) player.tryKick(ball);
    ball.update(dt);
    player.keepBall(ball, dt);

    const side = ball.goalSide();
    if (side !== 0) {
      onGoal(side);
    } else {
      match.timeLeft -= dt;
      if (match.timeLeft <= 0) finishMatch();
    }
  } else if (match.phase === 'goal') {
    // 得点後は操作を止め、ボールだけネットの中で動かす
    player.update(dt, { x: 0, z: 0 });
    ball.update(dt);
    consumeKick();

    match.phaseTimer -= dt;
    if (match.phaseTimer < MATCH.goalPause - MATCH.goalBanner) hud.banner.hidden = true;
    if (match.phaseTimer <= 0) {
      // 失点した側のキックオフで再開する
      kickoff(match.goalSide === 1 ? 'red' : 'blue');
    }
  }
  updateHud();
}

// カメラが追う点。攻めているゴールに入ったときは、少しゴールに寄る
function cameraTarget() {
  if (match.phase === 'goal' && match.goalSide === player.attackDir) {
    return { x: player.attackDir * (FIELD.length / 2 - 4), z: ball.position.z * 0.5 };
  }
  return player.position;
}

// 画面を切り替えたら自動で一時停止する（スマホで別のアプリを開いたときなど）
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !match.paused) togglePause();
});

startMatch();
let last = performance.now();

function loop(now) {
  // 処理落ちしてもボールがすり抜けないよう、1コマの時間に上限を付ける
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;

  if (consumeRestart()) startMatch();
  if (consumePause()) togglePause();
  if (!match.paused && match.phase !== 'finished') {
    step(dt);
    updateCamera(camera, cameraTarget(), player.attackDir, dt);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
