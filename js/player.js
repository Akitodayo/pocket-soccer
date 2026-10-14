// 選手（操作・CPU共通）
import * as THREE from 'three';
import { FIELD } from './field.js';
import { BALL_RADIUS } from './ball.js';

// 選手の動きの調整用の数値
export const PLAYER = {
  speed: 7,             // 走る速さ
  accel: 30,            // 走り出し・止まるときの素早さ
  turnSpeed: 12,        // 向きを変える素早さ
  radius: 0.4,          // 体の太さ（当たり判定にも使う）
  controlRange: 1.0,    // この距離までボールに近づくと自動でキープする
  dribbleDistance: 0.7,  // キープ中のボールと体の距離
  dribbleSide: 0.35,    // キープ中のボールを右足側にずらす量（後ろのカメラから隠れないように）
  kickSpeed: 24,        // シュートの速さ（一定）
  kickLift: 4,          // シュートの浮き上がり
  kickCooldown: 0.4,    // 蹴った直後にボールを拾わない時間（秒）
  kickoffDistance: 0.9, // キックオフのときにボールの後ろに立つ距離（すぐキープできる近さ）
  stealDelay: 0.7,      // 相手がボールを持ってからこの秒数たつと、触れて奪える
  stealLock: 1.0,       // 奪われた側がボールに触れない時間（秒）
  pressStealDelay: 0.15, // プレス中は、相手がボールを持ってからこの秒数で奪える
  shotAimWidth: 3.5,    // 方向を真横に倒して撃ったときに狙う、ゴールの中央からの横の距離（ポストは 3）
  shotSpread: 0.5,      // 方向つきシュートのばらつき（ゴールライン上での最大のずれ）
  passBaseSpeed: 6,     // パスの速さ（基本）
  passSpeedPerMeter: 0.7, // 味方が遠いほど、1mにつきこれだけ強く蹴る
  passMinSpeed: 8,      // パスの速さの下限
  passMaxSpeed: 18,     // パスの速さの上限
  passLift: 0.8,        // パスの浮き上がり（ほぼ地をはうパス）
  passLead: 0.35,       // 走っている味方の、何秒先の位置へパスするか
};

export class Player {
  // attackDir: 攻めるゴールの向き（1 なら右、-1 なら左）
  // speed: 走る速さ。bounds: 動ける範囲 { minX, maxX, minZ, maxZ }（省略するとピッチ全体）
  // keeper: キーパーなら true（キーパーが持ったボールは奪えない）
  // marker: true なら「操作中」の印（足元の黄色い輪と頭の上の三角）を付けられる
  // kit: ユニフォームの色 { shirt, shorts, socks, gloves }、number: 背番号、look: 肌と髪の色の番号
  constructor(scene, { kit, number = 0, look = 0, x, z, attackDir, marker = false, speed = PLAYER.speed, bounds = null, keeper = false }) {
    this.home = new THREE.Vector3(x, 0, z);
    this.attackDir = attackDir;
    this.speed = speed;
    this.keeper = keeper;
    const maxX = FIELD.length / 2 - PLAYER.radius;
    const maxZ = FIELD.width / 2 - PLAYER.radius;
    this.bounds = bounds ?? { minX: -maxX, maxX, minZ: -maxZ, maxZ };
    this.velocity = new THREE.Vector3();

    this.model = createPlayerModel(kit, number, look, keeper);
    this.mesh = this.model.root;
    this.runPhase = Math.random() * Math.PI * 2;
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
    // CPU が使う記憶（cpu.js）
    this.holdTime = 0;
    this.judgedShot = -1;
    this.saveOk = false;
  }

  // move: { x, z } の向き（長さ 0〜1）
  // speed: この1コマだけ走る速さを変える。instant: true なら加速を待たずにすぐその速さで動く（キーパーの飛びつき）
  update(dt, move, { speed = this.speed, instant = false } = {}) {
    this.kickTimer = Math.max(0, this.kickTimer - dt);
    this.lockTimer = Math.max(0, this.lockTimer - dt);

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

  // 走る速さに合わせて脚と腕を動かす。蹴った直後は蹴る動きを見せる
  animate(dt) {
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.runPhase += (speed / MODEL.stride) * Math.PI * 2 * dt;
    this.kickAnim = Math.max(0, this.kickAnim - dt);
    const kick = this.kickAnim > 0 ? 1 - this.kickAnim / MODEL.kickTime : -1;
    poseModel(this.model, this.runPhase, Math.min(1, speed / 6), kick);
  }

  clampToBounds() {
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

  // ボールを持っている（または足元に転がっている）なら蹴れる
  canKick(ball) {
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
    if (!this.canKick(ball)) return false;

    const goalX = this.attackDir * FIELD.length / 2;
    this.kickToward(ball, goalX - ball.position.x, aimZ - ball.position.z, PLAYER.kickSpeed, PLAYER.kickLift);
    return true;
  }

  // 方向つきシュート：向き (dirX, dirZ) へ、シュートの強さでそのまま蹴る（枠に入るとは限らない）
  shootToward(ball, dirX, dirZ) {
    if (!this.canKick(ball)) return false;
    this.kickToward(ball, dirX, dirZ, PLAYER.kickSpeed, PLAYER.kickLift);
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
    const able = allowed && this.kickTimer <= 0 && this.lockTimer <= 0 && ball.position.y < maxHeight;

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
    if (allowed && !ball.owner && ball.position.y < 1 && dist < minDist && dist > 0.0001) {
      const nx = (ball.position.x - this.position.x) / dist;
      const nz = (ball.position.z - this.position.z) / dist;
      ball.position.x = this.position.x + nx * minDist;
      ball.position.z = this.position.z + nz * minDist;
    }
  }
}

// 選手どうしが重ならないように押し離す
export function separatePlayers(players) {
  const minDist = PLAYER.radius * 2;
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i].position;
      const b = players[j].position;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= minDist || dist < 0.0001) continue;
      const push = (minDist - dist) / 2;
      a.x -= (dx / dist) * push;
      a.z -= (dz / dist) * push;
      b.x += (dx / dist) * push;
      b.z += (dz / dist) * push;
      players[i].clampToBounds();
      players[j].clampToBounds();
    }
  }
}

// ---- 人型の3Dモデル ----
// 足の裏が y=0。体の正面は +z、右手側は -x

const MODEL = {
  hipHeight: 0.9,     // 股関節の高さ
  thighLength: 0.42,  // 太ももの長さ
  shinLength: 0.42,   // すねの長さ
  stride: 3.2,        // 脚の動きが1周するあいだに進む距離（走りの歩幅の目安）
  kickTime: 0.28,     // 蹴る動きの長さ（秒）
};

// ユニフォームの色と、選手ごとの肌・髪の色の候補
const SKINS = [0xf1c8a0, 0xe0ac7e, 0xc68e5e, 0xf5d3b3];
const HAIRS = [0x1d1a17, 0x3b2a1e, 0x5a3b22, 0x2a2420];

const materials = new Map();
function material(color) {
  if (!materials.has(color)) materials.set(color, new THREE.MeshLambertMaterial({ color }));
  return materials.get(color);
}

// 何度も使う形は1つだけ作って使い回す（動作を軽く保つため）
const GEOMETRY = {
  shorts: new THREE.CylinderGeometry(0.095, 0.085, 0.2, 10),
  thigh: new THREE.CylinderGeometry(0.07, 0.06, 0.26, 10),
  knee: new THREE.CylinderGeometry(0.058, 0.055, 0.12, 10),
  sock: new THREE.CylinderGeometry(0.055, 0.045, 0.3, 10),
  shoe: new THREE.BoxGeometry(0.11, 0.08, 0.25),
  hips: new THREE.BoxGeometry(0.3, 0.16, 0.2),
  shirt: new THREE.CylinderGeometry(0.21, 0.17, 0.52, 14),
  neck: new THREE.CylinderGeometry(0.05, 0.055, 0.1, 10),
  head: new THREE.SphereGeometry(0.115, 16, 12),
  hair: new THREE.SphereGeometry(0.122, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
  sleeve: new THREE.CylinderGeometry(0.06, 0.055, 0.15, 10),
  upperArm: new THREE.CylinderGeometry(0.047, 0.043, 0.15, 8),
  forearm: new THREE.CylinderGeometry(0.042, 0.036, 0.25, 8),
  hand: new THREE.SphereGeometry(0.048, 10, 8),
  glove: new THREE.SphereGeometry(0.068, 10, 8),
  number: new THREE.PlaneGeometry(0.2, 0.2),
};

function part(geometry, color, x, y, z, shadow = false) {
  const mesh = new THREE.Mesh(geometry, material(color));
  mesh.position.set(x, y, z);
  mesh.castShadow = shadow;
  return mesh;
}

// 背番号の絵（白い数字を透明な板に描く）
const numberTextures = new Map();
function numberTexture(number) {
  if (!numberTextures.has(number)) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 52px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(number), 32, 35);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    numberTextures.set(number, texture);
  }
  return numberTextures.get(number);
}

// 人型の選手を作る。kit はユニフォームの色 { shirt, shorts, socks, gloves }、look は肌と髪の番号
function createPlayerModel(kit, number, look, keeper) {
  const skin = SKINS[look % SKINS.length];
  const hair = HAIRS[(look * 3 + 1) % HAIRS.length];
  const root = new THREE.Group();

  // 上下に揺れる部分（腰から上と脚）
  const body = new THREE.Group();
  root.add(body);

  const hips = new THREE.Group();
  hips.position.y = MODEL.hipHeight;
  body.add(hips);
  hips.add(part(GEOMETRY.hips, kit.shorts, 0, 0.02, 0, true));

  // 脚：股関節 → 太もも → ひざ → すね → スパイク。side は 1 が左、-1 が右
  const legs = {};
  for (const side of [1, -1]) {
    const thigh = new THREE.Group();
    thigh.position.set(side * 0.1, -0.04, 0);
    hips.add(thigh);
    thigh.add(part(GEOMETRY.shorts, kit.shorts, 0, -0.08, 0, true));
    thigh.add(part(GEOMETRY.thigh, skin, 0, -0.27, 0, true));

    const shin = new THREE.Group();
    shin.position.y = -MODEL.thighLength;
    thigh.add(shin);
    shin.add(part(GEOMETRY.knee, skin, 0, -0.05, 0, true));
    shin.add(part(GEOMETRY.sock, kit.socks, 0, -0.24, 0, true));
    shin.add(part(GEOMETRY.shoe, 0x1b1b1b, 0, -0.4, 0.05, true));
    legs[side > 0 ? 'left' : 'right'] = { thigh, shin };
  }

  // 胴：腰の上で前に傾けられるようにする
  const torso = new THREE.Group();
  torso.position.y = MODEL.hipHeight + 0.06;
  body.add(torso);
  const shirt = part(GEOMETRY.shirt, kit.shirt, 0, 0.26, 0, true);
  shirt.scale.z = 0.62;
  torso.add(shirt);
  torso.add(part(GEOMETRY.neck, skin, 0, 0.56, 0));

  const head = new THREE.Group();
  head.position.y = 0.7;
  torso.add(head);
  const face = part(GEOMETRY.head, skin, 0, 0, 0, true);
  face.scale.y = 1.12;
  head.add(face);
  const hairMesh = part(GEOMETRY.hair, hair, 0, 0.025, -0.012);
  hairMesh.scale.y = 1.05;
  head.add(hairMesh);

  // 背番号
  const back = new THREE.Mesh(
    GEOMETRY.number,
    new THREE.MeshBasicMaterial({ map: numberTexture(number), transparent: true })
  );
  back.position.set(0, 0.3, -0.125);
  back.rotation.y = Math.PI;
  torso.add(back);

  // 腕：肩 → 上腕 → ひじ → 前腕 → 手（キーパーは手袋）
  const arms = {};
  for (const side of [1, -1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.235, 0.47, 0);
    torso.add(shoulder);
    shoulder.add(part(GEOMETRY.sleeve, kit.shirt, 0, -0.06, 0, true));
    shoulder.add(part(GEOMETRY.upperArm, skin, 0, -0.2, 0, true));

    const elbow = new THREE.Group();
    elbow.position.y = -0.27;
    shoulder.add(elbow);
    elbow.add(part(GEOMETRY.forearm, skin, 0, -0.12, 0, true));
    elbow.add(part(keeper ? GEOMETRY.glove : GEOMETRY.hand, keeper ? kit.gloves : skin, 0, -0.27, 0));
    arms[side > 0 ? 'left' : 'right'] = { shoulder, elbow };
  }

  return { root, body, torso, legs, arms, keeper };
}

// 走る・蹴る・構える動きを付ける。phase は走りの進み具合、amount は走りの強さ（0〜1）、kick は蹴る動きの進み具合（0〜1、蹴っていなければ -1）
function poseModel(model, phase, amount, kick) {
  const { body, torso, legs, arms } = model;
  const s = Math.sin(phase);
  const c = Math.cos(phase);

  // 脚：左右交互に前後へ振り、後ろへ振るときにひざを曲げる（正の回転で後ろ、負の回転で前）
  legs.left.thigh.rotation.x = -s * 0.75 * amount;
  legs.right.thigh.rotation.x = s * 0.75 * amount;
  legs.left.shin.rotation.x = (0.15 + 1.0 * Math.max(0, -c)) * amount;
  legs.right.shin.rotation.x = (0.15 + 1.0 * Math.max(0, c)) * amount;

  // 腕：脚と反対に振り、ひじを曲げる
  arms.left.shoulder.rotation.set(s * 0.6 * amount, 0, 0.08);
  arms.right.shoulder.rotation.set(-s * 0.6 * amount, 0, -0.08);
  arms.left.elbow.rotation.x = -(0.35 + 0.9 * amount);
  arms.right.elbow.rotation.x = -(0.35 + 0.9 * amount);

  // 体：走るほど前に傾き、一歩ごとに上下に揺れる
  torso.rotation.x = 0.06 + 0.16 * amount;
  body.position.y = Math.abs(s) * 0.05 * amount;

  // キーパーは、止まっているときは腰を落として腕を前に構える
  if (model.keeper) {
    const ready = 1 - amount;
    for (const side of ['left', 'right']) {
      legs[side].thigh.rotation.x -= 0.35 * ready;
      legs[side].shin.rotation.x += 0.7 * ready;
      arms[side].shoulder.rotation.x -= 0.7 * ready;
    }
    arms.left.shoulder.rotation.z += 0.35 * ready;
    arms.right.shoulder.rotation.z -= 0.35 * ready;
    body.position.y -= 0.08 * ready;
  }

  // 蹴る：右脚を後ろへ引いてから前へ振り抜き、左腕でバランスを取る
  if (kick >= 0) {
    const back = 0.35;
    const swing = kick < back ? 0.7 * (kick / back) : 0.7 - 2.0 * ((kick - back) / (1 - back));
    legs.right.thigh.rotation.x = swing;
    legs.right.shin.rotation.x = kick < back ? 1.3 * (kick / back) : 1.3 * (1 - (kick - back) / (1 - back));
    legs.left.thigh.rotation.x = 0.1;
    legs.left.shin.rotation.x = 0.2;
    arms.left.shoulder.rotation.set(-0.5, 0, 0.7);
    arms.right.shoulder.rotation.set(0.4, 0, -0.4);
    torso.rotation.x = 0.05 - 0.15 * Math.sin(kick * Math.PI);
  }
}

// 「操作中」の印：足元の黄色い輪と、頭の上の下向きの三角（遠くからでもわかるように）
function createMarker(parent) {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color: 0xffe14a });

  const ring = new THREE.Mesh(new THREE.RingGeometry(PLAYER.radius + 0.12, PLAYER.radius + 0.25, 32), material);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  group.add(ring);

  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 4), material);
  arrow.rotation.x = Math.PI;
  arrow.position.y = 2.1;
  group.add(arrow);

  group.visible = false;
  parent.add(group);
  return group;
}
