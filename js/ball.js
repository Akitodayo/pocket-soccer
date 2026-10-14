// ボールの動きと物理
import * as THREE from 'three';
import { FIELD, GOAL } from './field.js';

export const BALL_RADIUS = 0.28;

// パスがこの時間（秒）たってもだれにも届かなければ、受け手を忘れる
const PASS_TIMEOUT = 2.5;

// ボールの動きの調整用の数値
const BALL = {
  gravity: 20,        // 重力（大きいほど早く落ちる）
  groundBounce: 0.5,  // 地面で跳ねる強さ（0〜1）
  wallBounce: 0.7,    // 板で跳ね返る強さ（0〜1）
  netBounce: 0.05,    // ネットで跳ね返る強さ（0〜1）
  goalFriction: 4,    // ゴールの中での減速（ネットに絡んで止まる）
  rollFriction: 0.6,  // 転がるときの減速
  airDrag: 0.1,       // 空中での減速
};

// 炎トルネードのボールの見た目
const FIRE = {
  burnOutSpeed: 8,   // ボールがこの速さより遅くなったら炎が消える
  sparks: 96,        // 炎の粒の数（使い回す）
  sparksPerFrame: 3, // 1コマに出す炎の粒の数
  sparkLife: 0.35,   // 炎の粒が消えるまでの時間（秒）
};

export function createBall(scene) {
  const mesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(BALL_RADIUS, 3),
    new THREE.MeshLambertMaterial({ map: createBallTexture() })
  );
  mesh.castShadow = true;
  scene.add(mesh);
  return new Ball(mesh, new FireTrail(scene));
}

// 炎トルネードのボールの尾：丸い粒をボールの後ろに出し、オレンジから赤へ変えながら消す
class FireTrail {
  constructor(scene) {
    const texture = createGlowTexture();
    this.sparks = [];
    for (let i = 0; i < FIRE.sparks; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texture,
        color: 0xffb000,
        transparent: true,
        depthWrite: false,
      }));
      sprite.visible = false;
      scene.add(sprite);
      this.sparks.push({ sprite, life: 0, vx: 0, vy: 0, vz: 0 });
    }
    this.next = 0;
    this.yellow = new THREE.Color(0xffb000);
    this.red = new THREE.Color(0xd41a00);
  }

  update(dt, position, burning, big = false) {
    if (burning) {
      const count = big ? FIRE.sparksPerFrame * 2 : FIRE.sparksPerFrame;
      const spread = big ? 0.6 : 0.25;
      for (let i = 0; i < count; i++) {
        const spark = this.sparks[this.next];
        this.next = (this.next + 1) % this.sparks.length;
        spark.life = FIRE.sparkLife;
        spark.big = big;
        spark.sprite.visible = true;
        spark.sprite.position.set(
          position.x + (Math.random() - 0.5) * spread,
          position.y + (Math.random() - 0.5) * spread,
          position.z + (Math.random() - 0.5) * spread
        );
        spark.vx = (Math.random() - 0.5) * 0.8;
        spark.vy = 0.8 + Math.random() * 1.2;
        spark.vz = (Math.random() - 0.5) * 0.8;
      }
    }
    for (const spark of this.sparks) {
      if (spark.life <= 0) continue;
      spark.life -= dt;
      if (spark.life <= 0) {
        spark.sprite.visible = false;
        continue;
      }
      const t = 1 - spark.life / FIRE.sparkLife; // 0（出たて）→ 1（消える）
      spark.sprite.position.x += spark.vx * dt;
      spark.sprite.position.y += spark.vy * dt;
      spark.sprite.position.z += spark.vz * dt;
      spark.sprite.scale.setScalar((0.55 + t * 0.6) * (spark.big ? 1.8 : 1));
      spark.sprite.material.color.copy(this.yellow).lerp(this.red, t);
      spark.sprite.material.opacity = 0.9 * (1 - t);
    }
  }
}

// 中心が明るく、外側が透明な丸
function createGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

class Ball {
  constructor(mesh, trail) {
    this.mesh = mesh;
    this.trail = trail;
    this.position = mesh.position;
    this.velocity = new THREE.Vector3();
    this.owner = null;    // いまボールをキープしている選手（いなければ null）
    this.ownerTimer = 0;  // いまの選手がキープしてからの時間（秒）
    this.shotId = 0;      // 蹴るたびに1増える番号（キーパーが同じシュートを2回判定しないため）
    this.shotFromX = 0;   // 最後に蹴った位置（キーパーが止める確率に使う）
    this.passTarget = null; // パスの受け手（受け手はボールへ走り、青チームなら操作もその選手に切り替わる）
    this.passTimer = 0;     // パスを出してからの時間（秒）
    this.kickoffTeam = null; // キックオフしたチームの向き。蹴り出すまで（またはセンターサークルを出るまで）相手は奪えない
    this.isShot = false;     // シュートとして蹴られたボール（当たった選手は吹っ飛ぶ）
    this.isFire = false;     // 燃えているボール（炎トルネード。触れた選手をゴールまで吹っ飛ばす。キーパーも止められない）
    this.isTornado = false;  // 必殺技「炎トルネード」のボール（重力を受けずにまっすぐ飛び、ゴールを吹っ飛ばす）
    this.lastKicker = null;  // 最後にシュートした選手（自分のシュートでは吹っ飛ばない）
    this.reset();
  }

  // 中央に止まった状態に戻す
  reset() {
    this.position.set(0, BALL_RADIUS, 0);
    this.velocity.set(0, 0, 0);
    this.owner = null;
    this.ownerTimer = 0;
    this.prevX = 0;
    this.passTarget = null;
    this.kickoffTeam = null;
    this.isShot = false;
    this.isFire = false;
    this.isTornado = false;
  }

  // シュートとして蹴られたことを覚える（kick のあとに呼ぶ）
  markShot(kicker, fire = false) {
    this.isShot = true;
    this.isFire = fire;
    this.lastKicker = kicker;
  }

  // キックオフの間、ほかのチームはこのボールに触れない
  protectedFrom(player) {
    return this.kickoffTeam !== null && player.attackDir !== this.kickoffTeam;
  }

  // 地面と平行な方向の速さ
  get speed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  // player がボールをキープし始める
  setOwner(player) {
    this.owner = player;
    this.ownerTimer = 0;
    this.passTarget = null;
    this.isShot = false;
    this.isFire = false;
    this.isTornado = false;
  }

  // パスとして蹴る（kick のあとに受け手を覚える）
  pass(dirX, dirZ, speed, lift, receiver) {
    this.kick(dirX, dirZ, speed, lift);
    this.passTarget = receiver;
    this.passTimer = 0;
  }

  get onGround() {
    return this.position.y <= BALL_RADIUS + 0.01;
  }

  // 向き (dirX, dirZ) に speed の速さで蹴る。lift は上向きの速さ
  kick(dirX, dirZ, speed, lift) {
    const length = Math.hypot(dirX, dirZ) || 1;
    this.velocity.set((dirX / length) * speed, lift, (dirZ / length) * speed);
    this.owner = null;
    this.shotId += 1;
    this.shotFromX = this.position.x;
    this.passTarget = null;
    this.kickoffTeam = null;
    this.isShot = false;
    this.isFire = false;
    this.isTornado = false;
  }

  update(dt) {
    const p = this.position;
    const v = this.velocity;
    this.ownerTimer += dt;
    this.passTimer += dt;
    if (this.passTarget && this.passTimer > PASS_TIMEOUT) this.passTarget = null;
    // 蹴り出さずにセンターサークルの外へ運んだら、キックオフの守りは終わり
    if (this.kickoffTeam !== null && Math.hypot(p.x, p.z) > FIELD.centerCircleRadius) this.kickoffTeam = null;
    this.prevX = p.x; // 動く前の位置（ゴールの中にいたかの判定に使う）

    if (!this.isTornado) v.y -= BALL.gravity * dt;
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
    // ゴールの中では、空中でもネットに勢いを吸われてすぐ止まる
    const drag = inGoal ? BALL.goalFriction : !this.onGround ? BALL.airDrag : BALL.rollFriction;
    const slow = Math.exp(-drag * dt);
    v.x *= slow;
    v.z *= slow;
    if (this.onGround && Math.hypot(v.x, v.z) < 0.05) {
      v.x = 0;
      v.z = 0;
    }

    this.collideWalls();
    this.roll(dt);

    // 炎：遅くなったら消える
    if (this.isFire && this.speed < FIRE.burnOutSpeed) {
      this.isFire = false;
      this.isTornado = false;
    }
    this.updateEffects(dt);
  }

  // 燃えている間はボールが光り、炎の尾を引く（炎トルネードは尾が太い）
  updateEffects(dt) {
    this.mesh.material.emissive.setHex(this.isFire ? 0xff5a00 : 0x000000);
    this.trail.update(dt, this.position, this.isFire, this.isTornado);
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

    // 前のコマでボールの中心がゴールラインを越えていれば、もうゴールの中（口からしか入れないため）。
    // そうでなければ、ゴールの口に入っているときだけ通す
    const insideGoal = Math.abs(this.prevX) > halfL;
    const inGoalMouth = Math.abs(p.z) <= goalHalf - r && p.y <= GOAL.height - r;
    if (insideGoal || inGoalMouth) {
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
