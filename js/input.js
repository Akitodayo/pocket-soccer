// キーボードとタッチ操作（スマホのスティックとボタンはステップ6で足す）
// 操作は「移動」と「シュート」の2つだけ

const KEYS = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  kick: ['Space'],
  pause: ['Escape'],
  restart: ['KeyR'],
};
const USED = new Set(Object.values(KEYS).flat());

const pressed = new Set();
const queued = { kick: false, pause: false, restart: false };

window.addEventListener('keydown', (e) => {
  if (!USED.has(e.code)) return;
  e.preventDefault();
  pressed.add(e.code);
  if (e.repeat) return;
  for (const name of Object.keys(queued)) {
    if (KEYS[name].includes(e.code)) queued[name] = true;
  }
});

window.addEventListener('keyup', (e) => {
  pressed.delete(e.code);
});

// ほかのウィンドウに切り替えたときに押しっぱなしにならないようにする
window.addEventListener('blur', () => pressed.clear());

function isDown(name) {
  return KEYS[name].some((code) => pressed.has(code));
}

// 押されたら1回だけ true を返す
function consume(name) {
  const value = queued[name];
  queued[name] = false;
  return value;
}

// 画面から見た移動の向き。forward は画面の奥（前）、right は画面の右。長さは 0〜1
export function getMove() {
  let right = (isDown('right') ? 1 : 0) - (isDown('left') ? 1 : 0);
  let forward = (isDown('up') ? 1 : 0) - (isDown('down') ? 1 : 0);
  const length = Math.hypot(right, forward);
  if (length > 1) {
    right /= length;
    forward /= length;
  }
  return { right, forward };
}

// シュート
export const consumeKick = () => consume('kick');

// 一時停止・再開（Escキー）
export const consumePause = () => consume('pause');

// 確認用：Rキーで試合を最初からやり直す（ステップ5でタイトル・結果画面に置き換える）
export const consumeRestart = () => consume('restart');

// 一時停止中などに、たまっていた入力を捨てる
export function clearQueued() {
  for (const name of Object.keys(queued)) queued[name] = false;
}
