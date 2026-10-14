// 起動とゲームループ
import { createScene, updateCamera, updateTitleCamera } from './scene.js';
import { createField, FIELD } from './field.js';
import { createBall } from './ball.js';
import { Player, PLAYER, separatePlayers } from './player.js';
import { CPU, createKeeper, aimAwayFromKeeper, choosePassTarget, updateTeam, keeperCatch } from './cpu.js';
import { getMove, consumeKick, consumePass, isPassHeld, consumePause, clearInput } from './input.js';
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

// 1チームのフィールド選手の人数（キーパーを除く）。3対3 なので、フィールド選手2人＋キーパー1人
const FIELD_PLAYERS = 2;

// 操作中の選手より、この距離以上ボールに近い味方がいたら、操作する選手を切り替える（行ったり来たりしないように）
const SWITCH_MARGIN = 1.5;

// 動作の軽さ：この間隔（秒）ごとに平均のコマ時間を調べ、遅ければ描画解像度を下げる
const PERFORMANCE = { checkEvery: 2, slowFrame: 1 / 45 };

// 確認用：URL の末尾に ?time=20 を付けると試合時間を20秒にできる。?debug を付けると中の状態を window.game で読める
const params = new URLSearchParams(location.search);
const matchLength = Number(params.get('time')) || MATCH.length;

const container = document.getElementById('game');
const { renderer, scene, camera, lowerResolution } = createScene(container);

createField(scene);
const ball = createBall(scene);

// チームの色（架空のチーム。色だけで区別する）。キーパーは同じチームの濃い色に、大きな白い手袋
const KITS = {
  blue: {
    player: { body: 0x3d7ff0, hands: 0xffffff },
    keeper: { body: 0x1f418f, hands: 0xf4f4f4 },
    numbers: [10, 7, 9],
  },
  red: {
    player: { body: 0xe24b44, hands: 0xffffff },
    keeper: { body: 0x8c201c, hands: 0xf4f4f4 },
    numbers: [9, 11, 8],
  },
};

// チーム：フィールド選手は自分の陣地に左右へ並べる。options は選手ごとの設定（速さなど）
function createTeam(attackDir, kits, lookOffset, options) {
  const players = [];
  for (let i = 0; i < FIELD_PLAYERS; i++) {
    const z = (i - (FIELD_PLAYERS - 1) / 2) * 6;
    players.push(new Player(scene, {
      kit: kits.player,
      number: kits.numbers[i % kits.numbers.length],
      look: lookOffset + i,
      x: -attackDir * 6,
      z,
      attackDir,
      ...options,
    }));
  }
  const keeper = createKeeper(scene, { kit: kits.keeper, attackDir, look: lookOffset + FIELD_PLAYERS });
  return { attackDir, players, keeper, chaser: null };
}

// 自分のチーム（青）は右へ、相手（赤）は左へ攻める
const blueTeam = createTeam(1, KITS.blue, 0, { marker: true });
const redTeam = createTeam(-1, KITS.red, 2, { speed: PLAYER.speed * CPU.speedRate });
const fieldPlayers = [...blueTeam.players, ...redTeam.players];
const players = [...fieldPlayers, blueTeam.keeper, redTeam.keeper];

// いま操作している選手（青のフィールド選手のだれか）
let controlled = blueTeam.players[0];

function setControlled(player) {
  if (player === controlled) return;
  controlled.setControlled(false);
  controlled = player;
  controlled.setControlled(true);
}

// 操作する選手を自動で切り替える。ボールを持っている選手、パスの受け手、ボールにいちばん近い選手の順に選ぶ
function updateControl() {
  const team = blueTeam.players;
  if (team.includes(ball.owner)) return setControlled(ball.owner);
  if (team.includes(ball.passTarget)) return setControlled(ball.passTarget);
  if (ball.owner === controlled) return;
  let nearest = controlled;
  for (const p of team) {
    if (p.distanceTo(ball.position) < nearest.distanceTo(ball.position)) nearest = p;
  }
  if (nearest.distanceTo(ball.position) < controlled.distanceTo(ball.position) - SWITCH_MARGIN) setControlled(nearest);
}

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
  updateCamera(camera, cameraTarget(), blueTeam.attackDir, 0, true);
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

// ---- 試合の進行 ----

// ボールを中央に置き、kickingTeam の選手がボールのすぐ後ろから始める
function kickoff(kickingTeam) {
  ball.reset();
  for (const [team, name] of [[blueTeam, 'blue'], [redTeam, 'red']]) {
    team.players.forEach((p, i) => p.reset(kickingTeam === name && i === 0));
    team.keeper.reset();
    team.chaser = null;
  }
  controlled.setControlled(false);
  controlled = blueTeam.players[0];
  controlled.setControlled(true);
  match.phase = 'playing';
  // 蹴り出すまで、相手はボールを奪えない
  ball.kickoffTeam = (kickingTeam === 'blue' ? blueTeam : redTeam).attackDir;
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
  return { x: forward * blueTeam.attackDir, z: right * blueTeam.attackDir };
}

// 青チームがボールを持っているか
function blueHasBall() {
  return !!ball.owner && ball.owner.attackDir === blueTeam.attackDir;
}

// プレス：ボール（の少し先）へ全力で寄せる
function pressMove() {
  const dx = ball.position.x + ball.velocity.x * 0.2 - controlled.position.x;
  const dz = ball.position.z + ball.velocity.z * 0.2 - controlled.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.3) return STOP;
  return { x: dx / dist, z: dz / dist };
}

// シュート：方向を倒していなければ、キーパーのいない側を自動で狙う。
// 倒していれば、その向きに飛ばす（真上＝ゴールの中央、斜め＝隅のあたり、真横＝ポストの外。少しばらつく）。
// 後ろへ倒していれば、その向きにそのまま蹴る
function shoot(move) {
  const len = Math.hypot(move.x, move.z);
  if (len < 0.1) return controlled.tryKick(ball, aimAwayFromKeeper(redTeam.keeper));
  const dir = blueTeam.attackDir;
  if (move.x * dir < -0.3 * len) return controlled.shootToward(ball, move.x, move.z);
  const goalX = dir * FIELD.length / 2;
  const aimZ = move.z * PLAYER.shotAimWidth + (Math.random() * 2 - 1) * PLAYER.shotSpread;
  return controlled.shootToward(ball, goalX - ball.position.x, aimZ - ball.position.z);
}

// パスの受け手になった選手は、スティックを倒していなければ自動でボールへ走る
function autoReceive(move) {
  if (ball.passTarget !== controlled || Math.hypot(move.x, move.z) > 0.1) return move;
  const dx = ball.position.x + ball.velocity.x * 0.3 - controlled.position.x;
  const dz = ball.position.z + ball.velocity.z * 0.3 - controlled.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.3) return STOP;
  return { x: dx / dist, z: dz / dist };
}

const STOP = { x: 0, z: 0 };

// 1コマ分、試合を進める
function step(dt) {
  if (match.phase === 'playing') {
    updateControl();
    const move = toFieldMove(getMove());
    // 守備中にパスボタンを押し続けるとプレス
    const pressing = isPassHeld() && !blueHasBall();
    for (const p of blueTeam.players) p.pressing = false;
    controlled.pressing = pressing;
    controlled.update(dt, pressing ? pressMove() : autoReceive(move));
    if (consumeKick()) shoot(move);
    if (consumePass()) {
      const mate = choosePassTarget(controlled, blueTeam, move);
      if (mate) controlled.passTo(ball, mate);
    }
    updateTeam(dt, blueTeam, ball, redTeam, { controlled });
    updateTeam(dt, redTeam, ball, blueTeam);
    separatePlayers(players);

    ball.update(dt);
    keeperCatch(dt, blueTeam.keeper, ball);
    keeperCatch(dt, redTeam.keeper, ball);
    // こぼれ球は、ボールに近い選手から順に触れる
    fieldPlayers.sort((a, b) => a.distanceTo(ball.position) - b.distanceTo(ball.position));
    for (const p of fieldPlayers) p.keepBall(ball, dt);

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
    consumePass();

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
  const dir = blueTeam.attackDir;
  if (match.phase === 'goal' && match.goalSide === dir) {
    return { x: dir * (FIELD.length / 2 - 4), z: ball.position.z * 0.5 };
  }
  const me = controlled.position;
  const x = Math.max(-FIELD.length / 2 + 3, Math.min(me.x * dir, ball.position.x * dir - 2)) * dir;
  return { x, z: me.z * 0.6 + ball.position.z * 0.4 };
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
  window.game = {
    ball, blueTeam, redTeam, match, app, advance, startMatch,
    get controlled() {
      return controlled;
    },
  };
}

// ---- ゲームループ ----

goToTitle();
window.__gameReady = true; // 読み込めたことを index.html に知らせる（読み込めないときの案内を出さない）
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
      updateCamera(camera, cameraTarget(), blueTeam.attackDir, dt);
    }
  }
  watchPerformance(frameTime);

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
