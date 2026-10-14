// 起動とゲームループ
import * as THREE from 'three';
import { createScene, updateCamera, updateCloseUpCamera, updateTitleCamera } from './scene.js';
import { createField, FIELD, blowUpGoal, restoreGoals, updateGoals } from './field.js';
import { createBall, BALL_RADIUS } from './ball.js';
import { Player, PLAYER, separatePlayers, checkBallHits, onPlayerHurt, onSpecial, resetSpecialBags } from './player.js';
import { FireTornado, GodHand } from './effects.js';
import { playUoh, isMuted, setMuted } from './sound.js';
import { CPU, createKeeper, choosePassTarget, updateTeam, keeperCatch } from './cpu.js';
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

// 必殺技「炎トルネード」の演出
const SPECIAL = {
  duration: 1.5,    // 浮き上がってから蹴るまでの時間（秒）
  riseTime: 0.7,    // 浮き上がるのにかける時間（秒）
  height: 2.4,      // 浮き上がる高さ
  spinSpeed: 16,    // 浮いている間に回る速さ
  shotSpeed: 36,    // シュートの速さ
  goalExtra: 1.2,   // ゴールが吹っ飛んだときに、キックオフまでのばす時間（秒）
  restoreAt: 0.7,   // キックオフのこの秒数前から、ゴールを直し始める
  slowRate: 0.15,   // スローモーションの速さ（ふつうを1としたとき）
  handForward: 1.1, // 神ハンドの手を、キーパーのどれだけ前に出すか
  catchHold: 0.6,   // 神ハンドで止めてから、スローモーションを終えるまでの時間（秒）
  godHandMax: 3,    // 神ハンドの演出の最長の時間（秒）
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
const tornado = new FireTornado(scene);
const godHand = new GodHand(scene);
const specialFx = document.getElementById('special-fx');
const specialName = document.getElementById('special-name');

// チームの色。あなたのチーム（コード上は blue）は白、相手（コード上は red）は黒。
// キーパーは見分けやすいよう、白チームは薄い灰色、黒チームは濃い灰色
const KITS = {
  blue: { player: { body: 0xf2f2f2 }, keeper: { body: 0xb4b4b4 } },
  red: { player: { body: 0x2b2b2b }, keeper: { body: 0x5c5c5c } },
};

// チーム：フィールド選手は自分の陣地に左右へ並べる。options は選手ごとの設定（速さなど）
function createTeam(attackDir, kits, options) {
  const players = [];
  for (let i = 0; i < FIELD_PLAYERS; i++) {
    const z = (i - (FIELD_PLAYERS - 1) / 2) * 6;
    players.push(new Player(scene, { kit: kits.player, x: -attackDir * 6, z, attackDir, ...options }));
  }
  const keeper = createKeeper(scene, { kit: kits.keeper, attackDir });
  return { attackDir, players, keeper, chaser: null };
}

// 自分のチーム（青）は右へ、相手（赤）は左へ攻める
const blueTeam = createTeam(1, KITS.blue, { marker: true });
const redTeam = createTeam(-1, KITS.red, { speed: PLAYER.speed * CPU.speedRate });
const fieldPlayers = [...blueTeam.players, ...redTeam.players];
const players = [...fieldPlayers, blueTeam.keeper, redTeam.keeper];

// 選手がぶつかった・吹っ飛ばされたら「うおっ」（毎回少し声の高さを変える）
onPlayerHurt(() => playUoh(0.85 + Math.random() * 0.4));

// いま操作している選手（青のフィールド選手のだれか）
let controlled = blueTeam.players[0];

function setControlled(player) {
  if (player === controlled) return;
  controlled.setControlled(false);
  controlled = player;
  controlled.setControlled(true);
}

// 操作する選手を自動で切り替える。ボールを持っている選手、パスの受け手、ボールにいちばん近い選手の順に選ぶ。
// へたれている選手には切り替えず、操作中の選手がへたれたら、立っている味方にすぐ切り替える
function updateControl() {
  const team = blueTeam.players;
  if (team.includes(ball.owner)) return setControlled(ball.owner);
  if (team.includes(ball.passTarget) && ball.passTarget.isUp) return setControlled(ball.passTarget);
  const up = team.filter((p) => p.isUp);
  if (up.length === 0) return;
  let nearest = up[0];
  for (const p of up) {
    if (p.distanceTo(ball.position) < nearest.distanceTo(ball.position)) nearest = p;
  }
  if (!controlled.isUp) return setControlled(nearest);
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
  special: null,      // 必殺技の演出中なら { shooter, time, angle }
  goalBroken: false,  // ゴールが吹っ飛んでいるか
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
  resetSpecialBags();
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

// 音のオン・オフ
const soundButton = document.getElementById('sound-button');
function updateSoundButton() {
  soundButton.classList.toggle('muted', isMuted());
  soundButton.setAttribute('aria-pressed', String(!isMuted()));
}
soundButton.addEventListener('click', () => {
  setMuted(!isMuted());
  updateSoundButton();
  // 押したあとも選ばれたままだと、スペースキー（シュート）でボタンが反応してしまうので外す
  soundButton.blur();
});
updateSoundButton();

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
  for (const [team, name] of [[blueTeam, 'blue'], [redTeam, 'red']]) {
    team.players.forEach((p, i) => p.reset(kickingTeam === name && i === 0));
    team.keeper.reset();
    team.chaser = null;
  }
  controlled.setControlled(false);
  controlled = blueTeam.players[0];
  controlled.setControlled(true);
  match.phase = 'playing';
  match.special = null;
  match.goalBroken = false;
  specialFx.classList.remove('active');
  specialName.hidden = true;
  restoreGoals(true);
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
  // 必殺技が決まったら、ゴールが吹っ飛ぶ（少しして直る）
  if (ball.isTornado) {
    blowUpGoal(side);
    match.goalBroken = true;
    match.phaseTimer += SPECIAL.goalExtra;
  }
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

// シュート：足元の矢印（体の向き）の方向へ、まっすぐ蹴る。ゴールを狙うには、体をゴールに向けてから撃つ
function shoot() {
  return controlled.shootToward(ball, Math.sin(controlled.facing), Math.cos(controlled.facing));
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

// ---- 必殺技（炎トルネード・神ハンド） ----
// どれも、まわりがスローモーションになり、カメラが技を出す選手に寄って、技の名前を大きく出す

const SPECIAL_NAMES = { tornado: '炎トルネード', godhand: '神ハンド' };

// 必殺技のくじに当たったら呼ばれる。type は技、actor は技を出す選手
onSpecial((type, actor) => {
  if (match.phase !== 'playing' || match.special) return false;
  // カメラ：炎トルネードは近くから回り込み、神ハンドは手とボールが入るよう前から少し引いて映す
  const s = { type, actor, time: 0, angle: actor.facing + 0.8, spin: 1.2, distance: 3.6, height: 1.2, done: false, endTimer: 0 };
  if (type === 'godhand') {
    // 手を出す位置：キーパーの少し前の、シュートが通るところ
    const out = actor.attackDir;
    s.handX = actor.position.x + out * SPECIAL.handForward;
    const time = Math.abs(ball.position.x - s.handX) / Math.max(1, Math.abs(ball.velocity.x));
    const zLimit = 2.6;
    s.handZ = Math.max(-zLimit, Math.min(zLimit, ball.position.z + ball.velocity.z * time));
    actor.facing = out > 0 ? Math.PI / 2 : -Math.PI / 2;
    s.angle = actor.facing + 0.45;
    s.spin = 0.25;
    s.distance = 7;
    s.height = 2.2;
  }
  match.special = s;
  match.phase = 'special';
  specialFx.classList.add('active');
  specialName.textContent = SPECIAL_NAMES[type];
  specialName.dataset.type = type;
  specialName.hidden = false;
  controlled.setControlled(false); // 見せ場のカットに「操作中」の印が映らないように
  return true;
});

// スローモーションを終えて、試合に戻る
function endSpecial() {
  match.special = null;
  match.phase = 'playing';
  specialFx.classList.remove('active');
  specialName.hidden = true;
  controlled.setControlled(true);
}

// 技を出していない選手は、いまの向きと速さのままスローモーションで動き続ける
function slowMotion(dt, except) {
  const slow = dt * SPECIAL.slowRate;
  for (const p of players) {
    if (except.includes(p)) continue;
    const speed = Math.hypot(p.velocity.x, p.velocity.z);
    const move = speed > 0.1 ? { x: p.velocity.x / p.speed, z: p.velocity.z / p.speed } : STOP;
    p.update(slow, move);
  }
  return slow;
}

function stepSpecial(dt) {
  const s = match.special;
  s.time += dt;
  if (s.type === 'tornado') stepTornado(dt, s);
  else stepGodHand(dt, s);
}

// 炎トルネード：炎の竜巻をまとって回りながら浮き上がり、空中からゴールへ蹴り込む
function stepTornado(dt, s) {
  const shooter = s.actor;
  slowMotion(dt, [shooter]);

  const rise = Math.min(1, s.time / SPECIAL.riseTime);
  shooter.position.y = SPECIAL.height * (1 - (1 - rise) * (1 - rise));
  // 速く回り、蹴る直前にゴールのほうを向く
  const spin = Math.max(0, 1 - s.time / (SPECIAL.duration - 0.3));
  const toGoal = shooter.attackDir > 0 ? Math.PI / 2 : -Math.PI / 2;
  shooter.facing = toGoal;
  shooter.mesh.rotation.y = toGoal + s.time * SPECIAL.spinSpeed * spin;
  if (s.time > SPECIAL.duration - 0.28 && shooter.kickAnim <= 0) shooter.kickAnim = 0.28;
  shooter.animate(dt);

  // ボールは足元で燃えている
  ball.owner = shooter;
  ball.velocity.set(0, 0, 0);
  ball.position.set(
    shooter.position.x + Math.sin(shooter.facing) * 0.6,
    shooter.position.y + 0.3,
    shooter.position.z + Math.cos(shooter.facing) * 0.6
  );
  ball.isFire = true;
  ball.isTornado = true;
  ball.updateEffects(dt);

  if (s.time >= SPECIAL.duration) releaseTornado(shooter);
}

// 空中から、相手ゴールの真ん中へまっすぐ蹴り込む。蹴った選手は落ちてへたれる
function releaseTornado(shooter) {
  const target = { x: shooter.attackDir * (FIELD.length / 2 + 0.8), y: 1.0, z: 0 };
  const dx = target.x - ball.position.x;
  const dy = target.y - ball.position.y;
  const dz = target.z - ball.position.z;
  const dist = Math.hypot(dx, dy, dz);
  const horizontal = Math.hypot(dx, dz);
  ball.kick(dx, dz, SPECIAL.shotSpeed * horizontal / dist, SPECIAL.shotSpeed * dy / dist);
  ball.markShot(shooter, true);
  ball.isTornado = true;
  shooter.kickTimer = PLAYER.kickCooldown;
  shooter.state = 'flying';
  shooter.velocity.set(0, 0, 0);
  shooter.vy = 0;
  endSpecial();
}

// 神ハンド：キーパーの前に巨大な手が現れ、スローモーションで迫るシュートを受け止める（炎トルネードも止める）
function stepGodHand(dt, s) {
  const keeper = s.actor;
  const slow = slowMotion(dt, [keeper]);

  // キーパーはシュートの通り道へすばやく寄り、右手を高く掲げる
  keeper.position.z += (s.handZ - keeper.position.z) * (1 - Math.exp(-8 * dt));
  keeper.mesh.rotation.y = keeper.facing;
  keeper.animate(dt);
  keeper.model.arms.right.rotation.set(-2.7, 0, -0.2);

  if (!s.done) {
    ball.update(slow);
    // 手のところまで来たら、ぴたりと止めてキャッチする
    if ((ball.position.x - s.handX) * keeper.attackDir <= BALL_RADIUS) {
      ball.position.set(s.handX, Math.max(BALL_RADIUS, Math.min(1.6, ball.position.y)), s.handZ);
      ball.setOwner(keeper);
      keeper.holdTime = 0;
      s.done = true;
      s.endTimer = SPECIAL.catchHold;
    }
    // 万一ボールが来なければ、そのまま終える
    if (s.time > SPECIAL.godHandMax) endSpecial();
  } else {
    ball.updateEffects(dt);
    s.endTimer -= dt;
    if (s.endTimer <= 0) endSpecial();
  }
}

// 必殺技の見た目（炎の竜巻・巨大な手）。演出が終わったら、すっと消える
const effectState = { tornadoAt: null, handAt: new THREE.Vector3(), handYaw: 0 };
function updateSpecialEffects(dt) {
  const s = match.special;
  if (s && s.type === 'tornado') effectState.tornadoAt = s.actor.position;
  tornado.update(dt, effectState.tornadoAt ?? ball.position, !!s && s.type === 'tornado');

  if (s && s.type === 'godhand') {
    effectState.handAt.set(s.handX, 1.3, s.handZ);
    effectState.handYaw = s.actor.facing;
  }
  godHand.update(dt, effectState.handAt, effectState.handYaw, !!s && s.type === 'godhand');
}

// 1コマ分、試合を進める
function step(dt) {
  if (match.phase === 'playing') {
    updateControl();
    for (const p of blueTeam.players) p.setAimVisible(p === controlled && ball.owner === p);
    const move = toFieldMove(getMove());
    // 守備中にパスボタンを押し続けるとプレス
    const pressing = isPassHeld() && !blueHasBall();
    for (const p of blueTeam.players) p.pressing = false;
    controlled.pressing = pressing;
    controlled.update(dt, pressing ? pressMove() : autoReceive(move));
    if (consumeKick()) shoot();
    if (consumePass()) {
      const mate = choosePassTarget(controlled, blueTeam, move);
      if (mate) controlled.passTo(ball, mate);
    }
    updateTeam(dt, blueTeam, ball, redTeam, { controlled });
    updateTeam(dt, redTeam, ball, blueTeam);
    separatePlayers(players, ball);

    ball.update(dt);
    checkBallHits(ball, players);
    keeperCatch(dt, blueTeam.keeper, ball);
    keeperCatch(dt, redTeam.keeper, ball);
    // こぼれ球は、ボールに近い選手から順に触れる
    fieldPlayers.sort((a, b) => a.distanceTo(ball.position) - b.distanceTo(ball.position));
    for (const p of fieldPlayers) {
      if (match.phase !== 'playing') break; // 必殺技が始まったら、ほかの選手は触れない
      p.keepBall(ball, dt);
    }

    const side = match.phase === 'playing' ? ball.goalSide() : 0;
    if (match.phase !== 'playing') {
      // 必殺技の演出が始まった
    } else if (side !== 0) {
      onGoal(side);
    } else {
      match.timeLeft -= dt;
      if (match.timeLeft <= 0) finishMatch();
    }
  } else if (match.phase === 'special') {
    stepSpecial(dt);
    consumeKick();
    consumePass();
  } else {
    // 得点後と試合終了後は操作を止め、ボールだけ動かす
    for (const player of players) player.update(dt, STOP);
    ball.update(dt);
    consumeKick();
    consumePass();

    match.phaseTimer -= dt;
    if (match.phase === 'goal') {
      if (match.phaseTimer < MATCH.goalPause - MATCH.goalBanner) hud.banner.hidden = true;
      // 吹っ飛んだゴールは、キックオフの少し前に元の位置へ飛んで戻る
      if (match.goalBroken && match.phaseTimer < SPECIAL.restoreAt) {
        restoreGoals();
        match.goalBroken = false;
      }
      // 失点した側のキックオフで再開する
      if (match.phaseTimer <= 0) kickoff(match.goalSide === 1 ? 'red' : 'blue');
    } else if (match.phaseTimer <= 0) {
      showResult(match.result);
    }
  }
  updateSpecialEffects(dt);
  updateGoals(dt);
  updateHud();
}

// カメラが追う点。ふだんは自分の選手の後ろだが、ボールが自分より後ろ（自陣側）にあるときは
// ボールも映るようにさらに下がる。自分が攻めるゴールに入ったときは、少しゴールに寄る
function cameraTarget() {
  const dir = blueTeam.attackDir;
  if (match.phase === 'goal' && match.goalSide === dir) {
    return { x: dir * (FIELD.length / 2 - 4), z: ball.position.z * 0.5 };
  }
  // 自分の必殺技のボールは、ボールを追いかける
  if (ball.isTornado && Math.sign(ball.velocity.x) === dir) {
    return { x: ball.position.x - dir, z: ball.position.z };
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
      if (match.special) {
        const s = match.special;
        updateCloseUpCamera(camera, s.actor.position, s.angle + s.time * s.spin, dt, s.distance, s.height);
      } else {
        updateCamera(camera, cameraTarget(), blueTeam.attackDir, dt);
      }
    }
  }
  watchPerformance(frameTime);

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
