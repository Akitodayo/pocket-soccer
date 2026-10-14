// 起動とゲームループ
import { createScene } from './scene.js';
import { createField } from './field.js';
import { createBall } from './ball.js';
import { Player } from './player.js';
import { getMove, consumeKick, consumeReset } from './input.js';

const container = document.getElementById('game');
const { renderer, scene, camera } = createScene(container);

createField(scene);
const ball = createBall(scene);
const player = new Player(scene, { color: 0x2f6fe0, x: -3, z: 0, attackDir: 1, controlled: true });

let last = performance.now();

function loop(now) {
  // 処理落ちしてもボールがすり抜けないよう、1コマの時間に上限を付ける
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;

  if (consumeReset()) {
    ball.reset();
    player.reset();
  }

  player.update(dt, getMove());
  if (consumeKick()) player.tryKick(ball);
  ball.update(dt);
  player.keepBall(ball, dt);

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
