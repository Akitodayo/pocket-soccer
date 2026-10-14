// 起動とゲームループ
import { createScene, updateCamera, updateTitleCamera } from './scene.js';
import { createField, FIELD } from './field.js';
import { createBall } from './ball.js';
import { Player, PLAYER, separatePlayers } from './player.js';
import { CPU, createKeeper, aimAwayFromKeeper, updateFieldCpu, updateKeeper, keeperCatch } from './cpu.js';
import { getMove, consumeKick, consumePause, clearInput } from './input.js';
import { showScreen, setRecord, setResult, onButton } from './screens.js';
import { loadRecord, addResult } from './storage.js';

// 試合の調整用の数値
const MATCH = {
  length: 180,      // 試合時間（秒）
  goalPause: 2.2,   // 得点してからキックオフまでの時間（秒）
  goalBanner: 1.0,  // 「GOAL!」を表示する時間（秒）
  endPause: 2.0,    // 試合終了から結果画面までの時間（秒）
  hurryTime: 10,    // 残りこの秒数からタイマーを赤くする
};

// 動作の軽さ：この間隔（秒）ごとに平均のコマ時間を調べ、遅ければ描画解像度を下げる
const PERFORMANCE = { checkEvery: 2, slowFrame: 1 / 45 };

// 確認用：URL の末尾に ?time=20 を付けると試合時間を20秒にできる。?debug を付けると中の状態を window.game で読める
const params = new URLSearchParams(location.search);
const matchLength = Number(params.get('time')) || MATCH.length;

const container = document.getElementById('game');
const { renderer, scene, camera, lowerResolution } = createScene(container);

createField(scene);
const ball = createBall(scene);

// 自分のチーム（青）は右へ、相手（赤）は左へ攻める
const blue = new Player(scene, { color: 0x2f6fe0, x: -5, z: 0, attackDir: 1, controlled: true });
const red = new Player(scene, { color: 0xd8403a, x: 5, z: 0, attackDir: -1, speed: PLAYER.speed * CPU.speedRate });
const blueKeeper = createKeeper(scene, { color: 0x1d3f8a, attackDir: 1 });
const redKeeper = createKeeper(scene, { color: 0x8c201c, attackDir: -1 });
const players = [blue, red, blueKeeper, redKeeper];

// 右のゴール（x>0）に入れば青の得点、左なら赤の得点
const TEAM_BY_GOAL = { 1: 'blue', '-1': 'red' };

const hud = {
  blue: document.getElementById('score-blue'),
  red: document.getElementById('score-red'),
  timer: document.getElementById('timer'),
  banner: document.getElementById('banner'),
};

const app = {
  mode: 'title', // title（タイトル）/ match（試合）/ result（結果）
  paused: false,
};

const match = {
  phase: 'playing', // playing（試合中）/ goal（得点後の演出）/ finished（試合終了）
  timeLeft: matchLength,
  score: { blue: 0, red: 0 },
  phaseTimer: 0,
  goalSide: 0,
  cpuWait: 0,
};

// ---- 画面の切り替え ----

function goToTitle() {
  app.mode = 'title';
  setPaused(false);
  container.classList.remove('in-match');
  hud.banner.hidden = true;
  kickoff('blue');
  setRecord(loadRecord());
  showScreen('title');
}

function startMatch() {
  app.mode = 'match';
  setPaused(false);
  container.classList.add('in-match');
  showScreen(null);
  match.timeLeft = matchLength;
  match.score.blue = 0;
  match.score.red = 0;
  hud.banner.hidden = true;
  kickoff('blue');
  updateCamera(camera, cameraTarget(), blue.attackDir, 0, true);
  updateHud();
}

function showResult(result) {
  app.mode = 'result';
  container.classList.remove('in-match');
  hud.banner.hidden = true;
  setResult(match.score, result);
  showScreen('result');
}

function setPaused(paused) {
  app.paused = paused;
  container.classList.toggle('paused', paused);
  clearInput();
  if (app.mode === 'match') showScreen(paused ? 'pause' : null);
}

onButton('start-button', startMatch);
onButton('again-button', startMatch);
onButton('title-button', goToTitle);
onButton('resume-button', () => setPaused(false));
onButton('quit-button', goToTitle);

// 画面を切り替えたら自動で一時停止する（スマホで別のアプリを開いたときなど）
function autoPause() {
  if (app.mode === 'match' && match.phase !== 'finished' && !app.paused) setPaused(true);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) autoPause();
});

// スマホを縦向きにしたら（横向きの案内が出ている間）も一時停止する
const portrait = window.matchMedia('(orientation: portrait) and (pointer: coarse)');
portrait.addEventListener('change', () => {
  if (portrait.matches) autoPause();
});

// ---- 試合の進行 ----

// ボールを中央に置き、kickingTeam の選手がボールのすぐ後ろから始める
function kickoff(kickingTeam) {
  ball.reset();
  blue.reset(kickingTeam === 'blue');
  red.reset(kickingTeam === 'red');
  blueKeeper.reset();
  redKeeper.reset();
  match.phase = 'playing';
  // 相手（青）のキックオフのときは、CPU は少し待ってから動き出す
  match.cpuWait = kickingTeam === 'blue' ? CPU.kickoffWait : 0;
}

function showBanner(text, small = false) {
  hud.banner.textContent = text;
  hud.banner.classList.toggle('small', small);
  hud.banner.hidden = false;
}

function onGoal(side) {
  match.score[TEAM_BY_GOAL[side]] += 1;
  match.phase = 'goal';
  match.phaseTimer = MATCH.goalPause;
  match.goalSide = side;
  showBanner('GOAL!');
  updateHud();
}

function finishMatch() {
  match.phase = 'finished';
  match.phaseTimer = MATCH.endPause;
  match.timeLeft = 0;
  const { blue: b, red: r } = match.score;
  match.result = b > r ? 'win' : b < r ? 'lose' : 'draw';
  addResult(match.result);
  showBanner('試合終了', true);
  updateHud();
}

function updateHud() {
  hud.blue.textContent = match.score.blue;
  hud.red.textContent = match.score.red;
  const seconds = Math.ceil(match.timeLeft);
  hud.timer.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  hud.timer.classList.toggle('hurry', seconds <= MATCH.hurryTime);
}

// 画面から見た向きを、ピッチ上の向きに直す。カメラは攻める方向を向いているので、
// 画面の奥が攻める方向（x）、画面の右がそこから右手（z）になる
function toFieldMove({ right, forward }) {
  return { x: forward * blue.attackDir, z: right * blue.attackDir };
}

const STOP = { x: 0, z: 0 };

// 1コマ分、試合を進める
function step(dt) {
  if (match.phase === 'playing') {
    blue.update(dt, toFieldMove(getMove()));
    if (consumeKick()) blue.tryKick(ball, aimAwayFromKeeper(redKeeper));
    match.cpuWait = Math.max(0, match.cpuWait - dt);
    if (match.cpuWait > 0) red.update(dt, STOP);
    else updateFieldCpu(dt, red, ball, blueKeeper);
    updateKeeper(dt, blueKeeper, ball);
    updateKeeper(dt, redKeeper, ball);
    separatePlayers(players);

    ball.update(dt);
    keeperCatch(dt, blueKeeper, ball);
    keeperCatch(dt, redKeeper, ball);
    blue.keepBall(ball, dt);
    red.keepBall(ball, dt);

    const side = ball.goalSide();
    if (side !== 0) {
      onGoal(side);
    } else {
      match.timeLeft -= dt;
      if (match.timeLeft <= 0) finishMatch();
    }
  } else {
    // 得点後と試合終了後は操作を止め、ボールだけ動かす
    for (const player of players) player.update(dt, STOP);
    ball.update(dt);
    consumeKick();

    match.phaseTimer -= dt;
    if (match.phase === 'goal') {
      if (match.phaseTimer < MATCH.goalPause - MATCH.goalBanner) hud.banner.hidden = true;
      // 失点した側のキックオフで再開する
      if (match.phaseTimer <= 0) kickoff(match.goalSide === 1 ? 'red' : 'blue');
    } else if (match.phaseTimer <= 0) {
      showResult(match.result);
    }
  }
  updateHud();
}

// カメラが追う点。ふだんは自分の選手の後ろだが、ボールが自分より後ろ（自陣側）にあるときは
// ボールも映るようにさらに下がる。自分が攻めるゴールに入ったときは、少しゴールに寄る
function cameraTarget() {
  const dir = blue.attackDir;
  if (match.phase === 'goal' && match.goalSide === dir) {
    return { x: dir * (FIELD.length / 2 - 4), z: ball.position.z * 0.5 };
  }
  const x = Math.max(-FIELD.length / 2 + 3, Math.min(blue.position.x * dir, ball.position.x * dir - 2)) * dir;
  return { x, z: blue.position.z * 0.6 + ball.position.z * 0.4 };
}

// ---- 動作の軽さ ----

const perf = { time: 0, frames: 0 };

function watchPerformance(frameTime) {
  if (frameTime > 0.25) return; // 画面を切り替えた直後などの長い空白は数えない
  perf.time += frameTime;
  perf.frames += 1;
  if (perf.time < PERFORMANCE.checkEvery) return;
  if (perf.time / perf.frames > PERFORMANCE.slowFrame) lowerResolution();
  perf.time = 0;
  perf.frames = 0;
}

if (params.has('debug')) {
  // advance(秒) で、画面の描画を待たずに試合を早送りできる
  const advance = (seconds) => {
    for (let t = 0; t < seconds && app.mode === 'match'; t += 1 / 60) {
      if (!app.paused) step(1 / 60);
    }
  };
  window.game = { ball, blue, red, blueKeeper, redKeeper, match, app, advance, startMatch };
}

// ---- ゲームループ ----

goToTitle();
let last = performance.now();

function loop(now) {
  const frameTime = (now - last) / 1000;
  last = now;
  // 処理落ちしてもボールがすり抜けないよう、1コマの時間に上限を付ける
  const dt = Math.min(frameTime, 1 / 30);

  if (app.mode === 'title') {
    updateTitleCamera(camera, now / 1000);
  } else if (app.mode === 'match') {
    if (consumePause() && match.phase !== 'finished') setPaused(!app.paused);
    if (!app.paused) {
      step(dt);
      updateCamera(camera, cameraTarget(), blue.attackDir, dt);
    }
  }
  watchPerformance(frameTime);

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
