// キーボードとタッチ操作（スマホのスティックとボタンはステップ6で足す）
// 操作は「移動」と「シュート」の2つだけ

const KEYS = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  kick: ['Space'],
  reset: ['KeyR'],
};
const USED = new Set(Object.values(KEYS).flat());

const pressed = new Set();
let kickQueued = false;
let resetQueued = false;

window.addEventListener('keydown', (e) => {
  if (!USED.has(e.code)) return;
  e.preventDefault();
  pressed.add(e.code);
  if (e.repeat) return;
  if (KEYS.kick.includes(e.code)) kickQueued = true;
  if (KEYS.reset.includes(e.code)) resetQueued = true;
});

window.addEventListener('keyup', (e) => {
  pressed.delete(e.code);
});

// ほかのウィンドウに切り替えたときに押しっぱなしにならないようにする
window.addEventListener('blur', () => pressed.clear());

function isDown(name) {
  return KEYS[name].some((code) => pressed.has(code));
}

// 移動の向き。画面の上が奥（-z）、右が +x。長さは 0〜1
export function getMove() {
  let x = (isDown('right') ? 1 : 0) - (isDown('left') ? 1 : 0);
  let z = (isDown('down') ? 1 : 0) - (isDown('up') ? 1 : 0);
  const length = Math.hypot(x, z);
  if (length > 1) {
    x /= length;
    z /= length;
  }
  return { x, z };
}

// シュートが押されたら1回だけ true を返す
export function consumeKick() {
  const queued = kickQueued;
  kickQueued = false;
  return queued;
}

// 確認用：Rキーでボールと選手を最初の位置に戻す（ステップ3でキックオフ処理に置き換える）
export function consumeReset() {
  const queued = resetQueued;
  resetQueued = false;
  return queued;
}
