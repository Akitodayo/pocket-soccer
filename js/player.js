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
  dribbleDistance: 0.85, // キープ中のボールと体の距離
  dribbleSide: 0.35,    // キープ中のボールを右足側にずらす量（後ろのカメラから隠れないように）
  kickSpeed: 24,        // シュートの速さ（一定）
  kickLift: 4,          // シュートの浮き上がり
  kickCooldown: 0.4,    // 蹴った直後にボールを拾わない時間（秒）
};

export class Player {
  // attackDir: 攻めるゴールの向き（1 なら右、-1 なら左）
  constructor(scene, { color, x, z, attackDir, controlled = false }) {
    this.home = new THREE.Vector3(x, 0, z);
    this.attackDir = attackDir;
    this.velocity = new THREE.Vector3();
    this.facing = attackDir > 0 ? Math.PI / 2 : -Math.PI / 2;
    this.hasBall = false;
    this.kickTimer = 0;

    this.mesh = createPlayerMesh(color, controlled);
    this.position = this.mesh.position;
    scene.add(this.mesh);
    this.reset();
  }

  // 最初の位置に戻す
  reset() {
    this.position.copy(this.home);
    this.velocity.set(0, 0, 0);
    this.facing = this.attackDir > 0 ? Math.PI / 2 : -Math.PI / 2;
    this.mesh.rotation.y = this.facing;
    this.hasBall = false;
    this.kickTimer = 0;
  }

  // move: { x, z } の向き（長さ 0〜1）
  update(dt, move) {
    this.kickTimer = Math.max(0, this.kickTimer - dt);

    // 目標の速さに少しずつ近づける
    const t = 1 - Math.exp(-PLAYER.accel * dt / PLAYER.speed);
    this.velocity.x += (move.x * PLAYER.speed - this.velocity.x) * t;
    this.velocity.z += (move.z * PLAYER.speed - this.velocity.z) * t;
    this.position.addScaledVector(this.velocity, dt);

    // ピッチの白線の内側に収める
    const maxX = FIELD.length / 2 - PLAYER.radius;
    const maxZ = FIELD.width / 2 - PLAYER.radius;
    this.position.x = THREE.MathUtils.clamp(this.position.x, -maxX, maxX);
    this.position.z = THREE.MathUtils.clamp(this.position.z, -maxZ, maxZ);

    // 入力した方向へ体を向ける
    if (Math.hypot(move.x, move.z) > 0.1) {
      const target = Math.atan2(move.x, move.z);
      let diff = target - this.facing;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.facing += diff * (1 - Math.exp(-PLAYER.turnSpeed * dt));
      this.mesh.rotation.y = this.facing;
    }
  }

  distanceTo(ball) {
    return Math.hypot(ball.position.x - this.position.x, ball.position.z - this.position.z);
  }

  // シュート：ボールが足元にあれば、相手ゴールの方向へ一定の強さで蹴る
  tryKick(ball) {
    if (this.kickTimer > 0) return false;
    if (!this.hasBall && !(this.distanceTo(ball) < PLAYER.controlRange && ball.position.y < 1)) return false;

    const goalX = this.attackDir * FIELD.length / 2;
    const aimZ = THREE.MathUtils.clamp(ball.position.z * 0.3, -GOAL.width * 0.3, GOAL.width * 0.3);
    ball.kick(goalX - ball.position.x, aimZ - ball.position.z, PLAYER.kickSpeed, PLAYER.kickLift);

    this.hasBall = false;
    this.kickTimer = PLAYER.kickCooldown;
    return true;
  }

  // ドリブル：近くの低いボールを体の正面にキープする
  keepBall(ball, dt) {
    const dist = this.distanceTo(ball);
    const low = ball.position.y < 1;

    if (this.kickTimer > 0 || !low) {
      this.hasBall = false;
    } else if (dist < PLAYER.controlRange) {
      this.hasBall = true;
    } else if (dist > PLAYER.controlRange * 1.6) {
      this.hasBall = false;
    }

    if (this.hasBall) {
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

    // キープしていないときは、体に当たったボールを押し出す
    const minDist = PLAYER.radius + BALL_RADIUS;
    if (low && dist < minDist && dist > 0.0001) {
      const nx = (ball.position.x - this.position.x) / dist;
      const nz = (ball.position.z - this.position.z) / dist;
      ball.position.x = this.position.x + nx * minDist;
      ball.position.z = this.position.z + nz * minDist;
    }
  }
}

// 円柱の体と球の頭でできた選手。操作中の選手は足元に黄色い輪を付ける
function createPlayerMesh(color, controlled) {
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

  if (controlled) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(PLAYER.radius + 0.12, PLAYER.radius + 0.25, 32),
      new THREE.MeshBasicMaterial({ color: 0xffe14a })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    group.add(ring);
  }
  return group;
}
