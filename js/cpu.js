// CPUの判断（相手のフィールド選手と、両チームのキーパー）
import { FIELD, GOAL } from './field.js';
import { Player, PLAYER } from './player.js';

// CPUの強さの調整用の数値。ここを変えれば強さを調整できる
export const CPU = {
  speedRate: 0.8,         // フィールド選手の速さ（あなたの選手を1としたとき）
  shootDistance: 12,      // 相手ゴールまでこの距離に入ったらシュートする
  shootDelay: 0.4,        // ボールを持ってからシュートできるまでの時間（秒）
  kickoffWait: 1.5,       // 相手のキックオフのとき、動き出すまで待つ時間（秒）
  chaseLead: 0.25,        // 転がるボールを追うとき、何秒先の位置を目指すか
  keeperSpeedRate: 0.65,  // キーパーの速さ（あなたの選手を1としたとき）
  keeperDiveSpeed: 8,     // シュートに飛びつくときの速さ
  keeperReach: 1.3,       // キーパーの手が届く距離
  keeperCatchHeight: 2.3, // キーパーの手が届く高さ
  shotSpeed: 12,          // この速さより速いボールを「シュート」とみなす
  saveChanceNear: 0.35,   // ゴールのすぐ近くから撃たれたシュートを止める確率（0〜1）
  saveChanceFar: 0.85,    // saveFarDistance 以上離れたところからのシュートを止める確率（0〜1）
  saveFarDistance: 12,    // この距離より遠いシュートは saveChanceFar で止める
  keeperHoldTime: 0.7,    // キーパーがボールを持ってから蹴り出すまでの時間（秒）
  clearSpeed: 15,         // キーパーの蹴り出しの速さ
  clearLift: 7,           // キーパーの蹴り出しの浮き上がり
  aimSpread: 0.5,         // シュートの狙いのばらつき
};

// キーパーを作る。attackDir はそのチームが攻める向き（守るゴールはその反対側）
export function createKeeper(scene, { color, attackDir }) {
  const lineX = -attackDir * FIELD.length / 2;
  const nearX = lineX + attackDir * 0.6;
  const farX = lineX + attackDir * (FIELD.goalAreaDepth + 1.2);
  const halfZ = FIELD.goalAreaWidth / 2;
  return new Player(scene, {
    color,
    attackDir,
    keeper: true,
    x: lineX + attackDir * 1.0,
    z: 0,
    speed: PLAYER.speed * CPU.keeperSpeedRate,
    bounds: { minX: Math.min(nearX, farX), maxX: Math.max(nearX, farX), minZ: -halfZ, maxZ: halfZ },
  });
}

// シュートの狙い：相手キーパーがいない側のゴールの隅を狙う（自分の選手のシュートにも使う）
export function aimAwayFromKeeper(keeper) {
  const z = keeper.position.z;
  const side = z > 0.2 ? -1 : z < -0.2 ? 1 : Math.random() < 0.5 ? -1 : 1;
  return side * GOAL.width * 0.3 + (Math.random() - 0.5) * CPU.aimSpread;
}

// target へ向かう移動の向き（長さ 0〜1）。slowRadius より近づいたらゆっくりにする
function moveToward(player, target, slowRadius = 1.0) {
  const dx = target.x - player.position.x;
  const dz = target.z - player.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.15) return { x: 0, z: 0 };
  const scale = Math.min(1, dist / slowRadius) / dist;
  return { x: dx * scale, z: dz * scale };
}

// 相手のフィールド選手：ボールを取りに行き、奪ったら相手ゴールへ運んでシュートする
export function updateFieldCpu(dt, me, ball, opponentKeeper) {
  const goalX = me.attackDir * FIELD.length / 2;
  let target;

  if (me.hasBall(ball)) {
    me.holdTime += dt;
    const toGoal = Math.abs(goalX - me.position.x);
    if (toGoal < CPU.shootDistance && me.holdTime > CPU.shootDelay) {
      me.tryKick(ball, aimAwayFromKeeper(opponentKeeper));
    }
    // ゴールへ向かいながら、少しずつ中央へ寄る
    target = { x: goalX, z: me.position.z * 0.6 };
  } else {
    me.holdTime = 0;
    if (ball.owner && ball.owner.keeper) {
      // キーパーが持っているときは、中央付近で待つ
      target = { x: -me.attackDir * 2, z: ball.position.z * 0.3 };
    } else {
      // ボールの少し先を目指し、攻める向きの反対側から回り込む
      target = {
        x: ball.position.x + ball.velocity.x * CPU.chaseLead - me.attackDir * 0.5,
        z: ball.position.z + ball.velocity.z * CPU.chaseLead,
      };
    }
  }
  me.update(dt, moveToward(me, target));
}

// キーパー：ゴール前の決まった範囲で、ボールに合わせて左右に動く。ボールを取ったら前へ蹴り出す
export function updateKeeper(dt, keeper, ball) {
  const lineX = -keeper.attackDir * FIELD.length / 2;
  const out = keeper.attackDir;
  let target;

  if (keeper.hasBall(ball)) {
    keeper.holdTime += dt;
    target = keeper.position;
    if (keeper.holdTime > CPU.keeperHoldTime) {
      keeper.kickToward(ball, out, (Math.random() - 0.5) * 0.8, CPU.clearSpeed, CPU.clearLift);
    }
  } else {
    keeper.holdTime = 0;
    const ballDepth = (ball.position.x - lineX) * out; // ボールが自分のゴールラインからどれだけ前にあるか
    const towardGoal = -ball.velocity.x * out;           // ボールが自分のゴールへ向かう速さ
    const zLimit = GOAL.width / 2;
    if (!ball.owner && towardGoal > CPU.shotSpeed && ballDepth > 0) {
      // シュートが飛んできたら、ボールが自分の前を通る位置を予測して飛びつく
      const time = Math.max(0, (ball.position.x - keeper.position.x) * out) / towardGoal;
      const z = ball.position.z + ball.velocity.z * time;
      keeper.update(dt, moveToward(keeper, { x: keeper.position.x, z: Math.max(-zLimit, Math.min(zLimit, z)) }, 0.2), {
        speed: CPU.keeperDiveSpeed,
        instant: true,
      });
      return;
    }
    const inBox = !ball.owner
      && ballDepth < FIELD.goalAreaDepth + 1.2
      && Math.abs(ball.position.z) < FIELD.goalAreaWidth / 2;
    if (inBox) {
      // ゴール前のこぼれ球は取りに行く
      target = ball.position;
    } else {
      const standLimit = zLimit - 0.4;
      target = {
        x: lineX + out * (ballDepth < 12 ? 1.6 : 1.0),
        z: Math.max(-standLimit, Math.min(standLimit, ball.position.z * 0.5)),
      };
    }
  }
  keeper.update(dt, moveToward(keeper, target));
}

// シュートを止める確率。ゴールラインから近いところで撃たれたシュートほど止めにくい
function saveChance(keeper, ball) {
  const lineX = -keeper.attackDir * FIELD.length / 2;
  const distance = Math.abs(ball.shotFromX - lineX);
  const rate = Math.min(1, distance / CPU.saveFarDistance);
  return CPU.saveChanceNear + (CPU.saveChanceFar - CPU.saveChanceNear) * rate;
}

// キーパーがボールをつかむ。速いシュートは saveChance の確率でしか止められない
export function keeperCatch(dt, keeper, ball) {
  let allowed = true;
  if (!ball.owner && ball.speed > CPU.shotSpeed) {
    if (keeper.judgedShot !== ball.shotId && keeper.distanceTo(ball.position) < CPU.keeperReach) {
      keeper.judgedShot = ball.shotId;
      keeper.saveOk = Math.random() < saveChance(keeper, ball);
    }
    if (keeper.judgedShot === ball.shotId && !keeper.saveOk) allowed = false;
  }
  keeper.keepBall(ball, dt, { range: CPU.keeperReach, maxHeight: CPU.keeperCatchHeight, allowed });
}
