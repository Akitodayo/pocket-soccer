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
  dribbleDistance: 0.85, // キープ中のボールと体の距離
  dribbleSide: 0.35,    // キープ中のボールを右足側にずらす量（後ろのカメラから隠れないように）
  kickSpeed: 24,        // シュートの速さ（一定）
  kickLift: 4,          // シュートの浮き上がり
  kickCooldown: 0.4,    // 蹴った直後にボールを拾わない時間（秒）
  kickoffDistance: 0.9, // キックオフのときにボールの後ろに立つ距離（すぐキープできる近さ）
  stealDelay: 0.7,      // 相手がボールを持ってからこの秒数たつと、触れて奪える
  stealLock: 1.0,       // 奪われた側がボールに触れない時間（秒）
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
  constructor(scene, { color, x, z, attackDir, marker = false, speed = PLAYER.speed, bounds = null, keeper = false }) {
    this.home = new THREE.Vector3(x, 0, z);
    this.attackDir = attackDir;
    this.speed = speed;
    this.keeper = keeper;
    const maxX = FIELD.length / 2 - PLAYER.radius;
    const maxZ = FIELD.width / 2 - PLAYER.radius;
    this.bounds = bounds ?? { minX: -maxX, maxX, minZ: -maxZ, maxZ };
    this.velocity = new THREE.Vector3();

    this.mesh = createPlayerMesh(color);
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
    return true;
  }

  // シュート：ボールが足元にあれば、相手ゴールの aimZ（ゴールの横方向の位置）を狙って一定の強さで蹴る
  tryKick(ball, aimZ = 0) {
    if (!this.canKick(ball)) return false;

    const goalX = this.attackDir * FIELD.length / 2;
    this.kickToward(ball, goalX - ball.position.x, aimZ - ball.position.z, PLAYER.kickSpeed, PLAYER.kickLift);
    return true;
  }

  // 向き (dirX, dirZ) へ蹴る（キーパーのクリアにも使う）
  kickToward(ball, dirX, dirZ, speed, lift) {
    ball.kick(dirX, dirZ, speed, lift);
    this.kickTimer = PLAYER.kickCooldown;
  }

  // ドリブル：近くのボールを体の正面にキープする。相手が持っているボールは、少したつと触れて奪える
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
      } else if (owner.attackDir !== this.attackDir && !owner.keeper && ball.ownerTimer > PLAYER.stealDelay) {
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

// 円柱の体と球の頭でできた選手
function createPlayerMesh(color) {
  const group = new THREE.Group();
  const bodyHeight = 1.0;

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(PLAYER.radius * 0.85, PLAYER.radius, bodyHeight, 16),
    new THREE.MeshLambertMaterial({ color })
  );
  body.position.y = bodyHeight / 2;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.27, 16, 12),
    new THREE.MeshLambertMaterial({ color: 0xf1c8a0 })
  );
  head.position.y = bodyHeight + 0.3;
  head.castShadow = true;
  group.add(head);

  // 正面がわかるように胸に白い印を付ける
  const badge = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 0.25, 0.05),
    new THREE.MeshLambertMaterial({ color: 0xffffff })
  );
  badge.position.set(0, bodyHeight * 0.65, PLAYER.radius * 0.9);
  group.add(badge);

  return group;
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
