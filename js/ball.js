// ボールの動きと物理
import * as THREE from 'three';
import { FIELD, GOAL } from './field.js';

export const BALL_RADIUS = 0.35;

// ボールの動きの調整用の数値
const BALL = {
  gravity: 20,        // 重力（大きいほど早く落ちる）
  groundBounce: 0.5,  // 地面で跳ねる強さ（0〜1）
  wallBounce: 0.7,    // 板で跳ね返る強さ（0〜1）
  netBounce: 0.05,    // ネットで跳ね返る強さ（0〜1）
  goalFriction: 4,    // ゴールの中で転がるときの減速（ネットに絡んで止まる）
  rollFriction: 0.6,  // 転がるときの減速
  airDrag: 0.1,       // 空中での減速
};

export function createBall(scene) {
  const mesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(BALL_RADIUS, 3),
    new THREE.MeshLambertMaterial({ map: createBallTexture() })
  );
  mesh.castShadow = true;
  scene.add(mesh);
  return new Ball(mesh);
}

class Ball {
  constructor(mesh) {
    this.mesh = mesh;
    this.position = mesh.position;
    this.velocity = new THREE.Vector3();
    this.reset();
  }

  // 中央に止まった状態に戻す
  reset() {
    this.position.set(0, BALL_RADIUS, 0);
    this.velocity.set(0, 0, 0);
  }

  get onGround() {
    return this.position.y <= BALL_RADIUS + 0.01;
  }

  // 向き (dirX, dirZ) に speed の速さで蹴る。lift は上向きの速さ
  kick(dirX, dirZ, speed, lift) {
    const length = Math.hypot(dirX, dirZ) || 1;
    this.velocity.set((dirX / length) * speed, lift, (dirZ / length) * speed);
  }

  update(dt) {
    const p = this.position;
    const v = this.velocity;

    v.y -= BALL.gravity * dt;
    p.addScaledVector(v, dt);

    // 地面で跳ねる。弱い跳ねは止めて転がりに切り替える
    if (p.y < BALL_RADIUS) {
      p.y = BALL_RADIUS;
      if (v.y < 0) {
        v.y = -v.y * BALL.groundBounce;
        if (v.y < 1) v.y = 0;
      }
    }

    // 転がり・空中の減速
    const inGoal = Math.abs(p.x) > FIELD.length / 2;
    const drag = !this.onGround ? BALL.airDrag : inGoal ? BALL.goalFriction : BALL.rollFriction;
    const slow = Math.exp(-drag * dt);
    v.x *= slow;
    v.z *= slow;
    if (this.onGround && Math.hypot(v.x, v.z) < 0.05) {
      v.x = 0;
      v.z = 0;
    }

    this.collideWalls();
    this.roll(dt);
  }

  // ボール全体がゴールラインを越えたら、そのゴールの向き（右なら 1、左なら -1）を返す。入っていなければ 0
  // ゴールの口以外は板で跳ね返るので、ラインの外にあるボールは必ずゴールの中にある
  goalSide() {
    if (Math.abs(this.position.x) > FIELD.length / 2 + BALL_RADIUS) return Math.sign(this.position.x);
    return 0;
  }

  // 板とゴールネットで跳ね返る
  collideWalls() {
    const p = this.position;
    const v = this.velocity;
    const r = BALL_RADIUS;
    const halfL = FIELD.length / 2;
    const halfW = FIELD.width / 2;
    const goalHalf = GOAL.width / 2;

    bounce(p, v, 'z', -(halfW - r), halfW - r, BALL.wallBounce);

    if (Math.abs(p.x) <= halfL - r) return;

    const inGoalMouth = Math.abs(p.z) < goalHalf - r && p.y < GOAL.height - r;
    if (inGoalMouth) {
      // ゴールの中：奥・横・上のネットで止まる
      const back = halfL + GOAL.depth - r;
      bounce(p, v, 'x', -back, back, BALL.netBounce);
      bounce(p, v, 'z', -(goalHalf - r), goalHalf - r, BALL.netBounce);
      if (p.y > GOAL.height - r) {
        p.y = GOAL.height - r;
        v.y = -Math.abs(v.y) * BALL.netBounce;
      }
    } else {
      bounce(p, v, 'x', -(halfL - r), halfL - r, BALL.wallBounce);
    }
  }

  // 進んだ距離に合わせてボールを回転させ、転がって見えるようにする
  roll(dt) {
    const v = this.velocity;
    const speed = Math.hypot(v.x, v.z);
    if (speed < 0.01) return;
    const axis = new THREE.Vector3(v.z / speed, 0, -v.x / speed);
    this.mesh.rotateOnWorldAxis(axis, (speed * dt) / BALL_RADIUS);
  }
}

// axis 方向の位置を min〜max に収め、はみ出したら速さを反転させる
function bounce(p, v, axis, min, max, restitution) {
  if (p[axis] < min) {
    p[axis] = min;
    v[axis] = Math.abs(v[axis]) * restitution;
  } else if (p[axis] > max) {
    p[axis] = max;
    v[axis] = -Math.abs(v[axis]) * restitution;
  }
}

// 白地に黒い模様を散らしたサッカーボール風の模様
function createBallTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = '#222222';

  const spots = [
    [32, 20], [96, 20], [160, 20], [224, 20],
    [0, 64], [64, 64], [128, 64], [192, 64], [256, 64],
    [32, 108], [96, 108], [160, 108], [224, 108],
  ];
  for (const [x, y] of spots) {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      ctx.lineTo(x + Math.cos(a) * 13, y + Math.sin(a) * 11);
    }
    ctx.closePath();
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
