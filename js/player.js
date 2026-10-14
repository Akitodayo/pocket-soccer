// 選手（操作・CPU共通）
import * as THREE from 'three';
import { FIELD, GOAL } from './field.js';
import { BALL_RADIUS } from './ball.js';

// 選手の動きの調整用の数値
export const PLAYER = {
  speed: 7,             // 走る速さ
  accel: 30,            // 走り出し・止まるときの素早さ
  turnSpeed: 12,        // 向きを変える素早さ
  radius: 0.4,          // 体の太さ（当たり判定にも使う）
  controlRange: 1.0,    // この距離までボールに近づくと自動でキープする
  dribbleDistance: 0.7,  // キープ中のボールと体の距離
  dribbleSide: 0.45,    // キープ中のボールを右足側にずらす量（後ろのカメラから隠れないように）
  kickSpeed: 24,        // シュートの速さ（一定）
  kickLift: 4,          // シュートの浮き上がり
  kickCooldown: 0.4,    // 蹴った直後にボールを拾わない時間（秒）
  kickoffDistance: 0.9, // キックオフのときにボールの後ろに立つ距離（すぐキープできる近さ）
  stealDelay: 0.7,      // 相手がボールを持ってからこの秒数たつと、触れて奪える
  stealLock: 1.0,       // 奪われた側がボールに触れない時間（秒）
  pressStealDelay: 0.15, // プレス中は、相手がボールを持ってからこの秒数で奪える
  passBaseSpeed: 6,     // パスの速さ（基本）
  passSpeedPerMeter: 0.7, // 味方が遠いほど、1mにつきこれだけ強く蹴る
  passMinSpeed: 8,      // パスの速さの下限
  passMaxSpeed: 18,     // パスの速さの上限
  passLift: 0.8,        // パスの浮き上がり（ほぼ地をはうパス）
  passLead: 0.35,       // 走っている味方の、何秒先の位置へパスするか
  knockSpeed: 6.5,      // 選手どうしがこの速さ以上でぶつかると、両方その場にへたれる
  downTime: 1.2,        // へたれてから起き上がるまでの時間（秒）
  getUpGrace: 1.5,      // 起き上がってからしばらくは、ぶつかってもへたれない（秒）
  blastMinSpeed: 10,    // この速さ以上のシュートが当たると吹っ飛ぶ
  blastPower: 9,        // 吹っ飛ぶ横の速さ
  blastLift: 6,         // 吹っ飛ぶ上向きの速さ
  flyGravity: 20,       // 吹っ飛んでいるときの重力
  fireHitRange: 0.3,    // 炎トルネードのボールは、体からこれだけ離れていても巻き込む
  fireFlightTime: 0.9,  // 炎トルネードに巻き込まれてから、ゴールに落ちるまでの時間（秒）
};

// ---- 必殺技の抽選 ----
// 両チームのプレーを合わせた回数に対して決まった割合になるよう、技ごとに両チームで共有する
// 「size 枚のうち hits 枚が当たり」のくじ袋から、その場面のたびに1枚引く（空になったら作り直す）
class SpecialBag {
  constructor(size, hits) {
    this.size = size;
    this.hits = hits;
    this.cards = [];
  }

  reset() {
    this.cards = Array.from({ length: this.size }, (_, i) => i < this.hits);
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  draw() {
    if (this.cards.length === 0) this.reset();
    return this.cards.pop();
  }
}

export const SPECIAL_BAGS = {
  tornado: new SpecialBag(50, 3),  // 炎トルネード：シュート50本に3本（6%）
  godhand: new SpecialBag(25, 2),  // 神ハンド：キーパーが枠へのシュートを受ける25回に2回（8%）
};

// くじ袋をすべて作り直す（試合開始のときに呼ぶ）
export function resetSpecialBags() {
  for (const bag of Object.values(SPECIAL_BAGS)) bag.reset();
}

// 必殺技を始めるときに呼ぶ関数（main.js で演出を始める。始められたら true を返す）
let specialListener = () => false;
export function onSpecial(listener) {
  specialListener = listener;
}

// type の必殺技のくじを引き、当たったら演出を始める。actor は技を出す選手
export function requestSpecial(type, actor) {
  const bag = SPECIAL_BAGS[type];
  if (!bag.draw()) return false;
  if (specialListener(type, actor)) return true;
  bag.cards.push(true); // 演出を始められなかったら、当たりを袋に戻す
  return false;
}

// 選手がぶつかった・吹っ飛ばされたときに呼ぶ関数（main.js で効果音を鳴らす）
let hurtListener = () => {};
export function onPlayerHurt(listener) {
  hurtListener = listener;
}

export class Player {
  // attackDir: 攻めるゴールの向き（1 なら右、-1 なら左）
  // speed: 走る速さ。bounds: 動ける範囲 { minX, maxX, minZ, maxZ }（省略するとピッチ全体）
  // keeper: キーパーなら true（キーパーが持ったボールは奪えない）
  // marker: true なら「操作中」の印（足元の黄色い輪と頭の上の三角）を付けられる
  // kit: 色 { body }
  constructor(scene, { kit, x, z, attackDir, marker = false, speed = PLAYER.speed, bounds = null, keeper = false }) {
    this.home = new THREE.Vector3(x, 0, z);
    this.attackDir = attackDir;
    this.speed = speed;
    this.keeper = keeper;
    const maxX = FIELD.length / 2 - PLAYER.radius;
    const maxZ = FIELD.width / 2 - PLAYER.radius;
    this.bounds = bounds ?? { minX: -maxX, maxX, minZ: -maxZ, maxZ };
    this.velocity = new THREE.Vector3();

    this.model = createPlayerModel(kit, keeper);
    this.mesh = this.model.root;
    this.runPhase = Math.random() * Math.PI * 2;
    this.idleTime = Math.random() * 10;
    this.kickAnim = 0;
    this.marker = marker ? createMarker(this.mesh) : null;
    this.position = this.mesh.position;
    scene.add(this.mesh);
    this.reset();
  }

  // キックオフの位置に戻す。kickingOff が true ならボールのすぐ後ろ、false なら最初の位置
  reset(kickingOff = false) {
    this.position.copy(this.home);
    if (kickingOff) this.position.set(-this.attackDir * PLAYER.kickoffDistance, 0, 0);
    this.velocity.set(0, 0, 0);
    this.facing = this.attackDir > 0 ? Math.PI / 2 : -Math.PI / 2;
    this.mesh.rotation.y = this.facing;
    this.kickTimer = 0;
    this.lockTimer = 0;
    this.kickAnim = 0;
    this.pressing = false; // プレス中（相手から素早く奪える）
    // ふにゃふにゃの状態：normal（ふつう）/ flying（吹っ飛び中）/ down（へたれている）
    this.state = 'normal';
    this.stateTimer = 0;
    this.grace = 0;
    this.vy = 0;
    this.fall = 0;
    this.spin = 0;
    this.free = false; // true の間は、動ける範囲の外（ゴールの中）にいてもよい
    this.model.body.rotation.set(0, 0, 0);
    // CPU が使う記憶（cpu.js）
    this.holdTime = 0;
    this.judgedShot = -1;
    this.saveOk = false;
    this.godHandShot = -1;
  }

  // move: { x, z } の向き（長さ 0〜1）
  // speed: この1コマだけ走る速さを変える。instant: true なら加速を待たずにすぐその速さで動く（キーパーの飛びつき）
  update(dt, move, { speed = this.speed, instant = false } = {}) {
    this.kickTimer = Math.max(0, this.kickTimer - dt);
    this.lockTimer = Math.max(0, this.lockTimer - dt);
    this.grace = Math.max(0, this.grace - dt);

    // へたれている・吹っ飛んでいる間は、操作もCPUの判断も受け付けない
    if (this.state !== 'normal') {
      this.updateFallen(dt);
      this.animate(dt);
      return;
    }

    // 目標の速さに少しずつ近づける
    const t = instant ? 1 : 1 - Math.exp(-PLAYER.accel * dt / PLAYER.speed);
    this.velocity.x += (move.x * speed - this.velocity.x) * t;
    this.velocity.z += (move.z * speed - this.velocity.z) * t;
    this.position.addScaledVector(this.velocity, dt);
    this.clampToBounds();

    // 進む方向へ体を向ける
    if (Math.hypot(move.x, move.z) > 0.1) {
      const target = Math.atan2(move.x, move.z);
      let diff = target - this.facing;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.facing += diff * (1 - Math.exp(-PLAYER.turnSpeed * dt));
      this.mesh.rotation.y = this.facing;
    }
    this.animate(dt);
  }

  // 走る速さに合わせて脚と腕を動かす。蹴った直後は蹴る動き、倒れているときはへたれた形にする
  animate(dt) {
    const speed = this.state === 'normal' ? Math.hypot(this.velocity.x, this.velocity.z) : 0;
    this.runPhase += (speed / MODEL.stride) * Math.PI * 2 * dt;
    this.kickAnim = Math.max(0, this.kickAnim - dt);
    this.idleTime += dt;
    // へたれるときはすばやく、起き上がるときはゆっくり形を戻す
    const target = this.state === 'normal' ? 0 : 1;
    const rate = target > this.fall ? 12 : 4;
    this.fall += (target - this.fall) * (1 - Math.exp(-rate * dt));
    const kick = this.kickAnim > 0 ? 1 - this.kickAnim / MODEL.kickTime : -1;
    poseModel(this.model, this.runPhase, Math.min(1, speed / 6), kick, this.idleTime, this.fall, this.spin);
  }

  get isUp() {
    return this.state === 'normal';
  }

  // その場にへたれる（ボールを持っていたら手放す）
  knockDown(ball) {
    if (ball.owner === this) ball.owner = null;
    this.state = 'down';
    this.stateTimer = PLAYER.downTime;
    this.velocity.multiplyScalar(0.2);
  }

  // ボールが当たって吹っ飛ぶ。(dirX, dirZ) は飛ばされる向き
  blast(ball, dirX, dirZ) {
    if (ball.owner === this) ball.owner = null;
    this.state = 'flying';
    this.velocity.set(dirX * PLAYER.blastPower, 0, dirZ * PLAYER.blastPower);
    this.vy = PLAYER.blastLift;
    this.spin = 0;
    hurtListener('blast');
  }

  // 炎トルネードに巻き込まれて、target（ゴールの中）まで大きな弧を描いて吹っ飛ぶ
  blastToGoal(ball, target) {
    if (ball.owner === this) ball.owner = null;
    const time = PLAYER.fireFlightTime;
    this.state = 'flying';
    this.free = true;
    this.velocity.set((target.x - this.position.x) / time, 0, (target.z - this.position.z) / time);
    this.vy = (PLAYER.flyGravity * time) / 2;
    this.spin = 0;
    hurtListener('blast');
  }

  // 吹っ飛び・へたれの動き。地面に落ちたらへたれ、時間がたつと起き上がる
  updateFallen(dt) {
    if (this.state === 'flying') {
      this.position.addScaledVector(this.velocity, dt);
      this.position.y += this.vy * dt;
      this.vy -= PLAYER.flyGravity * dt;
      this.spin += 9 * dt;
      if (this.position.y <= 0) {
        this.position.y = 0;
        this.velocity.multiplyScalar(0.35);
        this.state = 'down';
        this.stateTimer = PLAYER.downTime;
      }
    } else {
      // へたれたまま少し滑って止まる
      this.velocity.multiplyScalar(Math.exp(-6 * dt));
      this.position.addScaledVector(this.velocity, dt);
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) {
        this.state = 'normal';
        this.grace = PLAYER.getUpGrace;
        this.spin = 0;
        this.velocity.set(0, 0, 0);
        this.free = false; // ゴールの中から起き上がったら、動ける範囲に戻る
      }
    }
    this.clampToBounds();
  }

  clampToBounds() {
    if (this.free) return;
    const b = this.bounds;
    this.position.x = THREE.MathUtils.clamp(this.position.x, b.minX, b.maxX);
    this.position.z = THREE.MathUtils.clamp(this.position.z, b.minZ, b.maxZ);
  }

  distanceTo(point) {
    return Math.hypot(point.x - this.position.x, point.z - this.position.z);
  }

  hasBall(ball) {
    return ball.owner === this;
  }

  // 「操作中」の印を出す・消す
  setControlled(on) {
    if (this.marker) this.marker.visible = on;
  }

  // シュートの狙いの点線を出す・消す（ボールを持っているときに出す）
  setAimVisible(on) {
    if (this.marker) this.marker.userData.aim.visible = on;
  }

  // ボールを持っている（または足元に転がっている）なら蹴れる
  canKick(ball) {
    if (!this.isUp) return false;
    const loose = !ball.owner && this.distanceTo(ball.position) < PLAYER.controlRange && ball.position.y < 1;
    return this.kickTimer <= 0 && (this.hasBall(ball) || loose);
  }

  // receiver（味方）へ、走っている少し先を狙ってパスする
  passTo(ball, receiver) {
    if (!this.canKick(ball)) return false;
    const targetX = receiver.position.x + receiver.velocity.x * PLAYER.passLead;
    const targetZ = receiver.position.z + receiver.velocity.z * PLAYER.passLead;
    const dx = targetX - ball.position.x;
    const dz = targetZ - ball.position.z;
    const distance = Math.hypot(dx, dz);
    const speed = THREE.MathUtils.clamp(PLAYER.passBaseSpeed + distance * PLAYER.passSpeedPerMeter, PLAYER.passMinSpeed, PLAYER.passMaxSpeed);
    ball.pass(dx, dz, speed, PLAYER.passLift, receiver);
    this.kickTimer = PLAYER.kickCooldown;
    this.kickAnim = MODEL.kickTime;
    return true;
  }

  // シュート：ボールが足元にあれば、相手ゴールの aimZ（ゴールの横方向の位置）を狙って一定の強さで蹴る
  tryKick(ball, aimZ = 0) {
    const goalX = this.attackDir * FIELD.length / 2;
    return this.shootToward(ball, goalX - ball.position.x, aimZ - ball.position.z);
  }

  // 方向つきシュート：向き (dirX, dirZ) へ、シュートの強さでそのまま蹴る（枠に入るとは限らない）
  // くじに当たると必殺技「炎トルネード」になる（演出のあと空中から蹴る）
  shootToward(ball, dirX, dirZ) {
    if (!this.canKick(ball)) return false;
    if (requestSpecial('tornado', this)) return true;
    this.kickToward(ball, dirX, dirZ, PLAYER.kickSpeed, PLAYER.kickLift);
    ball.markShot(this);
    return true;
  }

  // 向き (dirX, dirZ) へ蹴る（キーパーのクリアにも使う）
  kickToward(ball, dirX, dirZ, speed, lift) {
    ball.kick(dirX, dirZ, speed, lift);
    this.kickTimer = PLAYER.kickCooldown;
    this.kickAnim = MODEL.kickTime;
  }

  // ドリブル：近くのボールを体の正面にキープする。相手が持っているボールは、少したつと触れて奪える（プレス中はすぐ奪える）
  // range: ボールに届く距離、maxHeight: 届く高さ、allowed: false ならボールに触れない（キーパーがシュートを止めそこねたとき）
  keepBall(ball, dt, { range = PLAYER.controlRange, maxHeight = 1, allowed = true } = {}) {
    const dist = this.distanceTo(ball.position);
    // 強いシュートは、フィールド選手には止められない（当たると吹っ飛ぶ。checkBallHits）
    const blasting = !this.keeper && ball.isShot && ball.speed >= PLAYER.blastMinSpeed;
    const able = allowed && this.isUp && !blasting && this.kickTimer <= 0 && this.lockTimer <= 0
      && ball.position.y < maxHeight && !ball.protectedFrom(this);

    if (this.hasBall(ball)) {
      if (!able || dist > range * 1.6) ball.owner = null;
    } else if (able && dist < range) {
      const owner = ball.owner;
      if (!owner) {
        ball.setOwner(this);
      } else if (owner.attackDir !== this.attackDir && !owner.keeper
        && ball.ownerTimer > (this.pressing ? PLAYER.pressStealDelay : PLAYER.stealDelay)) {
        owner.lockTimer = PLAYER.stealLock;
        ball.setOwner(this);
      }
    }

    if (this.hasBall(ball)) {
      // 正面 (sin, cos) と右手側 (-cos, sin) を組み合わせた位置
      const fx = Math.sin(this.facing);
      const fz = Math.cos(this.facing);
      const targetX = this.position.x + fx * PLAYER.dribbleDistance - fz * PLAYER.dribbleSide;
      const targetZ = this.position.z + fz * PLAYER.dribbleDistance + fx * PLAYER.dribbleSide;
      const t = 1 - Math.exp(-15 * dt);
      ball.position.x += (targetX - ball.position.x) * t;
      ball.position.z += (targetZ - ball.position.z) * t;
      ball.velocity.x = this.velocity.x;
      ball.velocity.z = this.velocity.z;
      ball.collideWalls();
      return;
    }

    // だれも持っていないボールが体に当たったら押し出す
    const minDist = PLAYER.radius + BALL_RADIUS;
    if (allowed && this.isUp && !blasting && !ball.owner && ball.position.y < 1 && dist < minDist && dist > 0.0001) {
      const nx = (ball.position.x - this.position.x) / dist;
      const nz = (ball.position.z - this.position.z) / dist;
      ball.position.x = this.position.x + nx * minDist;
      ball.position.z = this.position.z + nz * minDist;
    }
  }
}

// 選手どうしが重ならないように押し離す。勢いよくぶつかったら、両方その場にへたれる
export function separatePlayers(players, ball) {
  const minDist = PLAYER.radius * 2;
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i];
      const b = players[j];
      if (!a.isUp || !b.isUp) continue;
      const dx = b.position.x - a.position.x;
      const dz = b.position.z - a.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= minDist || dist < 0.0001) continue;

      const hit = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.z - b.velocity.z);
      if (hit > PLAYER.knockSpeed && a.grace <= 0 && b.grace <= 0) {
        a.knockDown(ball);
        b.knockDown(ball);
        hurtListener('collide');
      }

      const push = (minDist - dist) / 2;
      a.position.x -= (dx / dist) * push;
      a.position.z -= (dz / dist) * push;
      b.position.x += (dx / dist) * push;
      b.position.z += (dz / dist) * push;
      a.clampToBounds();
      b.clampToBounds();
    }
  }
}

// 強いシュートが選手に当たったら、その選手は吹っ飛び、ボールは跳ね返る（蹴った本人とキーパーは除く）。
// 炎トルネードのボールは、触れた選手もキーパーもゴールまで吹っ飛ばし、ボールはそのまま進む
export function checkBallHits(ball, players) {
  if (ball.isFire) {
    const dir = Math.sign(ball.velocity.x) || 1;
    const zLimit = GOAL.width / 2 - 0.6;
    const target = {
      x: dir * (FIELD.length / 2 + GOAL.depth * 0.55),
      z: Math.max(-zLimit, Math.min(zLimit, ball.position.z)),
    };
    for (const p of players) {
      if (!p.isUp || p === ball.lastKicker || ball.position.y > 2) continue;
      if (p.distanceTo(ball.position) < PLAYER.radius + BALL_RADIUS + PLAYER.fireHitRange) p.blastToGoal(ball, target);
    }
    return;
  }
  if (!ball.isShot || ball.speed < PLAYER.blastMinSpeed || ball.position.y > 1.5) return;
  for (const p of players) {
    if (p.keeper || !p.isUp || p === ball.lastKicker) continue;
    if (p.distanceTo(ball.position) > PLAYER.radius + BALL_RADIUS) continue;
    const speed = ball.speed;
    p.blast(ball, ball.velocity.x / speed, ball.velocity.z / speed);
    ball.velocity.x *= -0.35;
    ball.velocity.z *= -0.35;
    ball.velocity.y = Math.max(ball.velocity.y, 2);
    ball.isShot = false;
    return;
  }
}

// ---- キャラクターの3Dモデル ----
// 頭と体がひとつながりの、丸くてやわらかい形（顔などの細かいパーツはなし）。足の裏が y=0、体の正面は +z、右手側は -x

const MODEL = {
  hipHeight: 0.3,  // 脚の付け根の高さ
  stride: 2.6,     // 脚の動きが1周するあいだに進む距離（走りの歩幅の目安）
  kickTime: 0.28,  // 蹴る動きの長さ（秒）
};

const materials = new Map();
function material(color) {
  if (!materials.has(color)) materials.set(color, new THREE.MeshLambertMaterial({ color }));
  return materials.get(color);
}

// 何度も使う形は1つだけ作って使い回す（動作を軽く保つため）
const GEOMETRY = {
  trunk: new THREE.CapsuleGeometry(0.33, 0.6, 8, 20),
  leg: new THREE.CapsuleGeometry(0.12, 0.14, 6, 12),
  arm: new THREE.CapsuleGeometry(0.085, 0.24, 6, 10),
  hand: new THREE.SphereGeometry(0.1, 12, 10),
  glove: new THREE.SphereGeometry(0.14, 12, 10),
};

function part(geometry, color, x, y, z) {
  const mesh = new THREE.Mesh(geometry, material(color));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

// キャラクターを作る。kit は色 { body }。キーパーは手が大きい
function createPlayerModel(kit, keeper) {
  const root = new THREE.Group();

  // 腰から上（上下に弾む・左右に揺れる・吹っ飛ぶと回る）
  const body = new THREE.Group();
  body.position.y = MODEL.hipHeight;
  root.add(body);

  // 伸び縮みする胴。足元を中心に縮むよう、メッシュを上にずらして入れる
  const trunk = new THREE.Group();
  body.add(trunk);
  trunk.add(part(GEOMETRY.trunk, kit.body, 0, 0.6, 0));

  // 腕：肩から垂れる丸い腕と、丸い手（キーパーは大きな手）
  const arms = {};
  for (const side of [1, -1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.3, 0.72, 0);
    trunk.add(shoulder);
    shoulder.add(part(GEOMETRY.arm, kit.body, 0, -0.17, 0));
    shoulder.add(part(keeper ? GEOMETRY.glove : GEOMETRY.hand, kit.body, 0, -0.36, 0));
    arms[side > 0 ? 'left' : 'right'] = shoulder;
  }

  // 脚：胴の下から出る、短い丸い脚
  const legs = {};
  for (const side of [1, -1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.15, 0.08, 0);
    body.add(leg);
    leg.add(part(GEOMETRY.leg, kit.body, 0, -0.17, 0.02));
    legs[side > 0 ? 'left' : 'right'] = leg;
  }

  return { root, body, trunk, legs, arms, keeper };
}

// ふにゃふにゃした動きを付ける。phase は走りの進み具合、amount は走りの強さ（0〜1）、
// kick は蹴る動きの進み具合（0〜1、蹴っていなければ -1）、time は呼吸の揺れに使う時間、
// fall はへたれ具合（0〜1）、spin は吹っ飛んでいるときの回転
function poseModel(model, phase, amount, kick, time, fall, spin) {
  const { body, trunk, legs, arms } = model;
  const s = Math.sin(phase);
  const idle = 1 - amount;

  // 脚：左右交互に前後へ振る（正の回転で後ろ、負の回転で前）
  legs.left.rotation.x = -s * 0.9 * amount;
  legs.right.rotation.x = s * 0.9 * amount;

  // 腕：脚と反対に振り、少し遅れてふにゃっと外へ揺れる
  const flop = Math.sin(phase * 2 + 1) * 0.15 * amount;
  arms.left.rotation.set(s * 0.9 * amount, 0, 0.25 + 0.3 * amount + flop + Math.sin(time * 2) * 0.04 * idle);
  arms.right.rotation.set(-s * 0.9 * amount, 0, -(0.25 + 0.3 * amount + flop + Math.sin(time * 2) * 0.04 * idle));

  // 体：前に傾き、左右によちよち揺れ、一歩ごとに弾む
  body.rotation.set(0.16 * amount, 0, s * 0.09 * amount);
  body.position.y = MODEL.hipHeight + Math.abs(s) * 0.07 * amount;

  // ぷにぷに伸び縮み（止まっているときは、ゆっくり呼吸するように）
  let squash = 1 + Math.sin(phase * 2) * 0.07 * amount + Math.sin(time * 3) * 0.025 * idle;

  // キーパーは、止まっているときは少しかがんで両腕を広げて構える
  if (model.keeper) {
    arms.left.rotation.z += 0.9 * idle;
    arms.right.rotation.z -= 0.9 * idle;
    arms.left.rotation.x -= 0.4 * idle;
    arms.right.rotation.x -= 0.4 * idle;
    squash -= 0.06 * idle;
  }

  // 蹴る：右脚を後ろへ引いてから大きく振り抜き、体をのけぞらせて両腕を上げる
  if (kick >= 0) {
    const back = 0.35;
    legs.right.rotation.x = kick < back ? 0.8 * (kick / back) : 0.8 - 2.2 * ((kick - back) / (1 - back));
    legs.left.rotation.x = 0.15;
    const lift = Math.sin(kick * Math.PI);
    arms.left.rotation.set(-0.3, 0, 0.6 + 0.8 * lift);
    arms.right.rotation.set(-0.3, 0, -(0.6 + 0.8 * lift));
    body.rotation.x = -0.22 * lift;
    squash = 1 + 0.08 * lift;
  }

  // へたれる：上下にぺしゃんとつぶれて横に広がり、手足を投げ出す。起き上がりかけはぷるぷる震える
  if (fall > 0.001) {
    const wobble = Math.sin(time * 22) * 0.08 * fall * (1 - fall) * 4;
    squash = squash * (1 - fall) + (0.42 + wobble) * fall;
    legs.left.rotation.x = legs.left.rotation.x * (1 - fall) - 1.3 * fall;
    legs.right.rotation.x = legs.right.rotation.x * (1 - fall) - 1.3 * fall;
    arms.left.rotation.z = arms.left.rotation.z * (1 - fall) + 1.5 * fall;
    arms.right.rotation.z = arms.right.rotation.z * (1 - fall) - 1.5 * fall;
    body.position.y = body.position.y * (1 - fall) + 0.08 * fall;
  }

  // 吹っ飛んでいる間はくるくる回る
  if (spin > 0) body.rotation.x = -spin;

  trunk.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
}

// 「操作中」の印：足元の黄色い輪と進行方向の矢印、頭の上の下向きの三角（遠くからでもわかるように）
function createMarker(parent) {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color: 0xffe14a });

  const ring = new THREE.Mesh(new THREE.RingGeometry(PLAYER.radius + 0.12, PLAYER.radius + 0.25, 32), material);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  group.add(ring);

  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 4), material);
  arrow.rotation.x = Math.PI;
  arrow.position.y = 1.95;
  group.add(arrow);

  // 足元の進行方向の矢印（体の正面 +z を指す。シュートはこの向きに飛ぶ）
  const shape = new THREE.Shape();
  shape.moveTo(-0.1, 0.65);
  shape.lineTo(0.1, 0.65);
  shape.lineTo(0.1, 1.35);
  shape.lineTo(0.32, 1.35);
  shape.lineTo(0, 1.9);
  shape.lineTo(-0.32, 1.35);
  shape.lineTo(-0.1, 1.35);
  shape.closePath();
  const pointer = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ color: 0xffe14a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
  );
  pointer.rotation.x = Math.PI / 2; // 平らに寝かせ、形の上向き（y）を体の正面（+z）へ
  pointer.position.y = 0.03;
  group.add(pointer);

  // ボールを持っているときだけ出す、シュートの狙いの点線（矢印の先へ、だんだん薄くなる）
  const aim = new THREE.Group();
  const dash = new THREE.PlaneGeometry(0.12, 0.45);
  for (let i = 0; i < 7; i++) {
    const piece = new THREE.Mesh(dash, new THREE.MeshBasicMaterial({
      color: 0xffe14a,
      transparent: true,
      opacity: 0.75 * (1 - i / 7),
      side: THREE.DoubleSide,
      depthWrite: false,
    }));
    piece.rotation.x = Math.PI / 2;
    piece.position.set(0, 0.03, 2.3 + i * 0.75);
    aim.add(piece);
  }
  aim.visible = false;
  group.add(aim);
  group.userData.aim = aim;

  group.visible = false;
  parent.add(group);
  return group;
}
