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
  dribbleSide: 0.45,    // キープ中のボールを右足側にずらす量（後ろのカメラから隠れないように）
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
  // kit: 色 { body, hands }、number: 背番号、look: 顔つきの番号
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
    this.idleTime += dt;
    const kick = this.kickAnim > 0 ? 1 - this.kickAnim / MODEL.kickTime : -1;
    poseModel(this.model, this.runPhase, Math.min(1, speed / 6), kick, this.idleTime);
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
    const able = allowed && this.kickTimer <= 0 && this.lockTimer <= 0 && ball.position.y < maxHeight
      && !ball.protectedFrom(this);

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

// ---- キャラクターの3Dモデル ----
// 頭と体がひとつながりの、丸くてやわらかい形。足の裏が y=0、体の正面は +z、右手側は -x

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
  eye: new THREE.SphereGeometry(0.075, 14, 10),
  pupil: new THREE.SphereGeometry(0.04, 10, 8),
  shine: new THREE.SphereGeometry(0.014, 6, 4),
  smile: new THREE.TorusGeometry(0.06, 0.013, 6, 16, Math.PI),
  cheek: new THREE.CircleGeometry(0.045, 14),
  number: new THREE.PlaneGeometry(0.26, 0.26),
};

const CHEEK_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xff8a9a, transparent: true, opacity: 0.55 });

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
    ctx.font = 'bold 50px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(number), 32, 35);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    numberTextures.set(number, texture);
  }
  return numberTextures.get(number);
}

// キャラクターを作る。kit は色 { body, hands }、look は顔つきの番号（目の大きさが少し変わる）
function createPlayerModel(kit, number, look, keeper) {
  const root = new THREE.Group();

  // 腰から上（上下に弾む・左右に揺れる）
  const body = new THREE.Group();
  body.position.y = MODEL.hipHeight;
  root.add(body);

  // 伸び縮みする胴。足元を中心に縮むよう、メッシュを上にずらして入れる
  const trunk = new THREE.Group();
  body.add(trunk);
  trunk.add(part(GEOMETRY.trunk, kit.body, 0, 0.6, 0, true));

  // 顔：大きな目（白目・黒目・光）、にっこり口、ほっぺ
  const eyeScale = 1 + (look % 3) * 0.08;
  for (const side of [1, -1]) {
    const eye = part(GEOMETRY.eye, 0xffffff, side * 0.115, 1.0, 0.27);
    eye.scale.setScalar(eyeScale);
    trunk.add(eye);
    trunk.add(part(GEOMETRY.pupil, 0x1d1d24, side * 0.11, 1.0, 0.335));
    trunk.add(part(GEOMETRY.shine, 0xffffff, side * 0.1 + 0.012, 1.018, 0.372));
    const cheek = new THREE.Mesh(GEOMETRY.cheek, CHEEK_MATERIAL);
    cheek.position.set(side * 0.2, 0.88, 0.255);
    cheek.rotation.y = side * 0.62;
    trunk.add(cheek);
  }
  const smile = part(GEOMETRY.smile, 0x5a2a2a, 0, 0.9, 0.315);
  smile.rotation.z = Math.PI;
  trunk.add(smile);

  // 背番号
  const back = new THREE.Mesh(
    GEOMETRY.number,
    new THREE.MeshBasicMaterial({ map: numberTexture(number), transparent: true })
  );
  back.position.set(0, 0.62, -0.335);
  back.rotation.y = Math.PI;
  trunk.add(back);

  // 腕：肩から垂れる丸い腕と、丸い手（キーパーは大きな手袋）
  const arms = {};
  for (const side of [1, -1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.3, 0.72, 0);
    trunk.add(shoulder);
    shoulder.add(part(GEOMETRY.arm, kit.body, 0, -0.17, 0, true));
    shoulder.add(part(keeper ? GEOMETRY.glove : GEOMETRY.hand, kit.hands, 0, -0.36, 0, true));
    arms[side > 0 ? 'left' : 'right'] = shoulder;
  }

  // 脚：胴の下から出る、短い丸い脚
  const legs = {};
  for (const side of [1, -1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.15, 0.08, 0);
    body.add(leg);
    leg.add(part(GEOMETRY.leg, kit.body, 0, -0.17, 0.02, true));
    legs[side > 0 ? 'left' : 'right'] = leg;
  }

  return { root, body, trunk, legs, arms, keeper };
}

// ふにゃふにゃした動きを付ける。phase は走りの進み具合、amount は走りの強さ（0〜1）、
// kick は蹴る動きの進み具合（0〜1、蹴っていなければ -1）、time は呼吸の揺れに使う時間
function poseModel(model, phase, amount, kick, time) {
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

  trunk.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
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
  arrow.position.y = 1.95;
  group.add(arrow);

  group.visible = false;
  parent.add(group);
  return group;
}
