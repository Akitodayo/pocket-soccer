// 起動とゲームループ
import { createScene } from './scene.js';
import { createField } from './field.js';
import { createBall } from './ball.js';

const container = document.getElementById('game');
const { renderer, scene, camera } = createScene(container);

createField(scene);
createBall(scene);

function loop() {
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
