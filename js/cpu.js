// CPUの判断（自動で動く選手とキーパー）
// チームは { attackDir, players（フィールド選手の配列）, keeper } の形で扱う
import { FIELD, GOAL } from './field.js';
import { Player, PLAYER } from './player.js';

// CPUの強さの調整用の数値。ここを変えれば強さを調整できる
export const CPU = {
  speedRate: 0.8,         // 相手のフィールド選手の速さ（あなたの選手を1としたとき）
  shootDistance: 13,      // 相手ゴールまでこの距離に入ったらシュートする
  shootDelay: 0.6,        // ボールを持ってからシュートできるまでの時間（秒）
  kickoffWait: 0.5,       // 相手のキックオフのとき、動き出すまで待つ時間（秒）
  chaseLead: 0.25,        // 転がるボールを追うとき、何秒先の位置を目指すか
  chaserMargin: 1.5,      // ボールを追う役を交代するのは、ほかの選手がこの距離以上近くなったとき
  passDelay: 0.5,         // ボールを持ってからパスできるまでの時間（秒）
  pressureRange: 2.5,     // 相手がこの距離より近いと「寄せられている」とみなしてパスを考える
  openRange: 3.5,         // 相手がこの距離より遠くにいる味方を「フリー」とみなす
  supportAhead: 6,        // 味方がボールを持っているとき、どれだけ前へ走るか
  supportLane: 4.5,       // 味方がボールを持っているとき、ボールからどれだけ横に開くか
  coverDepth: 2.5,        // 相手がボールを持っているとき、ボールからゴール側へ最低どれだけ離れて構えるか
  coverRate: 0.35,        // ボールからゴールまでの距離のうち、どれだけゴール側に下がって構えるか
  tackleDistance: 15,     // ボールを持った相手がゴールからこの距離まで迫ったら、構えるのをやめて奪いに行く
  keeperSpeedRate: 0.65,  // キーパーの速さ（あなたの選手を1としたとき）
  keeperDiveSpeed: 7,     // シュートに飛びつくときの速さ
  keeperReach: 1.2,       // キーパーの手が届く距離
  keeperCatchHeight: 2.3, // キーパーの手が届く高さ
  shotSpeed: 12,          // この速さより速いボールを「シュート」とみなす
  saveChanceNear: 0.3,    // ゴールのすぐ近くから撃たれたシュートを止める確率（0〜1）
  saveChanceFar: 0.8,     // saveFarDistance 以上離れたところからのシュートを止める確率（0〜1）
  saveFarDistance: 12,    // この距離より遠いシュートは saveChanceFar で止める
  keeperHoldTime: 0.7,    // キーパーがボールを持ってから味方へパスするまでの最短の時間（秒）
  keeperMaxHold: 2.5,     // 相手が近くにいても、この時間（秒）たったらパスする
  keeperClearRange: 5,    // 相手がこの距離より近くにいる間は、パスを待つ
  passLift: 8,            // キーパーのパスの浮き上がり（相手の頭を越える浮き球）
  passHeight: 1.2,        // キーパーがパスを放す高さ
  passTime: 1.3,          // キーパーのパスが味方に届くまでのおおよその時間（秒）
  passMinSpeed: 6,        // キーパーのパスの速さの下限
  passMaxSpeed: 20,       // キーパーのパスの速さの上限
  receiveDepth: 8,        // 味方キーパーがボールを持ったとき、自分のゴールからどれだけ前でパスを待つか
  aimSpread: 0.5,         // シュートの狙いのばらつき
};

const STOP = { x: 0, z: 0 };

// キーパーを作る。attackDir はそのチームが攻める向き（守るゴールはその反対側）
export function createKeeper(scene, { kit, attackDir, look = 0 }) {
  const lineX = -attackDir * FIELD.length / 2;
  const nearX = lineX + attackDir * 0.6;
  const farX = lineX + attackDir * (FIELD.goalAreaDepth + 1.2);
  const halfZ = FIELD.goalAreaWidth / 2;
  return new Player(scene, {
    kit,
    number: 1,
    look,
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
  if (dist < 0.15) return STOP;
  const scale = Math.min(1, dist / slowRadius) / dist;
  return { x: dx * scale, z: dz * scale };
}

// ---- チーム全体 ----

function belongsTo(player, team) {
  return !!player && (player === team.keeper || team.players.includes(player));
}

function nearestTo(players, point, except = null) {
  let best = null;
  let bestDist = Infinity;
  for (const p of players) {
    if (p === except) continue;
    const d = p.distanceTo(point);
    if (d < bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}

// 相手のフィールド選手のうち、いちばん近い選手までの距離（その選手がどれだけフリーか）
function openness(player, opponents) {
  let min = Infinity;
  for (const o of opponents.players) min = Math.min(min, player.distanceTo(o.position));
  return min;
}

// ボールを追う役を決める。ボールを持っている選手がいればその選手。交代は chaserMargin 以上近い選手が出たときだけ
function pickChaser(team, ball) {
  if (belongsTo(ball.owner, team) && !ball.owner.keeper) return (team.chaser = ball.owner);
  if (ball.passTarget && team.players.includes(ball.passTarget)) return (team.chaser = ball.passTarget);
  const nearest = nearestTo(team.players, ball.position);
  const current = team.chaser;
  if (!current || !team.players.includes(current)
    || nearest.distanceTo(ball.position) < current.distanceTo(ball.position) - CPU.chaserMargin) {
    team.chaser = nearest;
  }
  return team.chaser;
}

// チームの自動で動く選手（controlled 以外）とキーパーを動かす。
// controlled がいるチーム（あなたのチーム）は、ほかの選手が全員サポート役になる。wait が true ならフィールド選手は止まって待つ
export function updateTeam(dt, team, ball, opponents, { controlled = null, wait = false } = {}) {
  const chaser = controlled ? null : pickChaser(team, ball);
  for (const p of team.players) {
    if (p === controlled) continue;
    if (wait) p.update(dt, STOP);
    else if (p === chaser) updateAttacker(dt, p, ball, team, opponents);
    else updateSupport(dt, p, ball, team, opponents);
  }
  updateKeeper(dt, team.keeper, ball, team, opponents);
}

// ---- フィールド選手 ----

// ボールを追う役：ボールを取りに行き、持ったら相手ゴールへ運ぶ。寄せられたらフリーの味方へパス、近づいたらシュート
function updateAttacker(dt, me, ball, team, opponents) {
  const goalX = me.attackDir * FIELD.length / 2;
  let target;

  if (me.hasBall(ball)) {
    me.holdTime += dt;
    const toGoal = Math.abs(goalX - me.position.x);
    const nearestOpponent = nearestTo(opponents.players, me.position);
    const pressured = nearestOpponent && me.distanceTo(nearestOpponent.position) < CPU.pressureRange;

    if (toGoal < CPU.shootDistance && me.holdTime > CPU.shootDelay) {
      me.tryKick(ball, aimAwayFromKeeper(opponents.keeper));
    } else if (pressured && me.holdTime > CPU.passDelay) {
      const mate = findOpenMate(me, team, opponents);
      if (mate) me.passTo(ball, mate);
    }

    // ゴールへ向かいながら中央へ寄る。正面に相手がいれば横へよける
    let z = me.position.z * 0.6;
    if (nearestOpponent) {
      const ahead = (nearestOpponent.position.x - me.position.x) * me.attackDir;
      if (ahead > 0 && ahead < 4 && Math.abs(nearestOpponent.position.z - me.position.z) < 2) {
        z = me.position.z + (me.position.z >= nearestOpponent.position.z ? 3 : -3);
      }
    }
    target = { x: goalX, z };
  } else {
    me.holdTime = 0;
    if (ball.owner && ball.owner.keeper) {
      target = supportSpot(me, ball, team, opponents);
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

// フリーで、あまり後ろにいない味方を探す。いなければ null
function findOpenMate(me, team, opponents) {
  let best = null;
  let bestScore = -Infinity;
  for (const mate of team.players) {
    if (mate === me) continue;
    const open = openness(mate, opponents);
    const forward = (mate.position.x - me.position.x) * me.attackDir;
    if (open < CPU.openRange || forward < -4) continue;
    const score = open + forward * 0.5;
    if (score > bestScore) {
      best = mate;
      bestScore = score;
    }
  }
  return best;
}

// サポート役：パスの受け手ならボールへ走る。それ以外は、味方が持っていれば前の空いた場所へ、
// 相手が持っていればボールと自分のゴールの間に下がって構える
function updateSupport(dt, me, ball, team, opponents) {
  let target;
  if (ball.passTarget === me) {
    target = { x: ball.position.x + ball.velocity.x * 0.3, z: ball.position.z + ball.velocity.z * 0.3 };
  } else {
    target = supportSpot(me, ball, team, opponents);
  }
  me.update(dt, moveToward(me, target));
}

// サポート役が立つ場所
function supportSpot(me, ball, team, opponents) {
  const d = me.attackDir;
  const halfL = FIELD.length / 2;
  const ownGoal = { x: -d * halfL, z: 0 };
  const lane = Math.sign(me.home.z) || 1; // 最初の位置が左右どちらか
  const owner = ball.owner;

  if (belongsTo(owner, team)) {
    if (owner.keeper) {
      // 味方キーパーが持っている：自分の陣地の、パスを受けやすい場所で待つ
      return { x: ownGoal.x + d * CPU.receiveDepth, z: lane * CPU.supportLane };
    }
    // 味方が持っている：ボールより前の、反対側のレーンへ走る
    const side = Math.abs(owner.position.z - lane * CPU.supportLane) < 3 ? -lane : lane;
    const limit = halfL - 4;
    const x = Math.max(-limit, Math.min(limit, owner.position.x + d * CPU.supportAhead));
    return { x, z: owner.position.z * 0.3 + side * CPU.supportLane };
  }

  if (belongsTo(owner, opponents)) {
    if (owner.keeper) {
      // 相手キーパーが持っている：自分の陣地へ戻る
      return { x: -d * 4, z: lane * CPU.supportLane };
    }
    // 相手が持っている：ボールと自分のゴールの間に下がって構え、ドリブルとシュートのコースをふさぐ。
    // ボールが遠いほど深く下がる（追い抜かれないように先回りする）
    const toGoalX = ownGoal.x - owner.position.x;
    const toGoalZ = ownGoal.z - owner.position.z;
    const len = Math.hypot(toGoalX, toGoalZ) || 1;
    // ゴールに迫られたら、ボールに寄せて奪いに行く
    if (len < CPU.tackleDistance) return ball.position;
    const gap = Math.max(0, Math.min(len - 1.5, Math.max(CPU.coverDepth, len * CPU.coverRate)));
    return { x: owner.position.x + (toGoalX / len) * gap, z: owner.position.z + (toGoalZ / len) * gap };
  }

  // だれも持っていない：ボールより少し後ろの、自分のレーンで待つ
  return { x: ball.position.x - d * 4, z: lane * CPU.supportLane };
}

// あなたの選手のパス：入力の向き（なければ体の向き）にいちばん近い方向の味方を選ぶ。
// キーパーへのバックパスは、はっきりキーパーの方向を向いているときだけ
export function choosePassTarget(passer, team, dir) {
  let dx = dir.x;
  let dz = dir.z;
  if (Math.hypot(dx, dz) < 0.1) {
    dx = Math.sin(passer.facing);
    dz = Math.cos(passer.facing);
  }
  const len = Math.hypot(dx, dz);
  dx /= len;
  dz /= len;

  let best = null;
  let bestScore = Infinity;
  for (const mate of [...team.players, team.keeper]) {
    if (mate === passer) continue;
    const vx = mate.position.x - passer.position.x;
    const vz = mate.position.z - passer.position.z;
    const dist = Math.hypot(vx, vz) || 1;
    const angle = Math.acos(Math.max(-1, Math.min(1, (vx * dx + vz * dz) / dist)));
    if (mate.keeper && angle > 0.8) continue;
    const score = angle + dist * 0.01;
    if (score < bestScore) {
      best = mate;
      bestScore = score;
    }
  }
  return best;
}

// ---- キーパー ----

// キーパー：ゴール前の決まった範囲で、ボールに合わせて左右に動く。
// ボールを取ったら、相手が離れるのを少し待ってから、いちばんフリーな味方へ浮き球のパスを出す
function updateKeeper(dt, keeper, ball, team, opponents) {
  const lineX = -keeper.attackDir * FIELD.length / 2;
  const out = keeper.attackDir;
  let target;

  if (keeper.hasBall(ball)) {
    keeper.holdTime += dt;
    target = keeper.position;
    const opponentNear = openness(keeper, opponents) < CPU.keeperClearRange;
    const ready = keeper.holdTime > CPU.keeperHoldTime && (!opponentNear || keeper.holdTime > CPU.keeperMaxHold);
    if (ready) keeperPass(keeper, ball, team, opponents);
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

// いちばんフリーな味方の少し先へ、距離に合わせた強さで浮き球のパスを出す
function keeperPass(keeper, ball, team, opponents) {
  let mate = team.players[0];
  for (const p of team.players) {
    if (openness(p, opponents) > openness(mate, opponents)) mate = p;
  }
  const targetX = mate.position.x + mate.velocity.x * PLAYER.passLead;
  const targetZ = mate.position.z + mate.velocity.z * PLAYER.passLead;
  const dx = targetX - ball.position.x;
  const dz = targetZ - ball.position.z;
  const distance = Math.hypot(dx, dz);
  const speed = Math.max(CPU.passMinSpeed, Math.min(CPU.passMaxSpeed, distance / CPU.passTime));
  // 手から投げる高さで放す（すぐ近くの相手に足で取られないように）
  ball.position.y = Math.max(ball.position.y, CPU.passHeight);
  ball.pass(dx, dz, speed, CPU.passLift, mate);
  keeper.kickTimer = PLAYER.kickCooldown;
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
  // 味方からのバックパス（自分が受け手）はシュート扱いせず、必ず受ける
  if (!ball.owner && ball.speed > CPU.shotSpeed && ball.passTarget !== keeper) {
    if (keeper.judgedShot !== ball.shotId && keeper.distanceTo(ball.position) < CPU.keeperReach) {
      keeper.judgedShot = ball.shotId;
      keeper.saveOk = Math.random() < saveChance(keeper, ball);
    }
    if (keeper.judgedShot === ball.shotId && !keeper.saveOk) allowed = false;
  }
  keeper.keepBall(ball, dt, { range: CPU.keeperReach, maxHeight: CPU.keeperCatchHeight, allowed });
}
