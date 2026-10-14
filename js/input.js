// キーボードとタッチ操作
// 操作は「移動」と「シュート」の2つだけ（ほかに一時停止）
//   PC   ：矢印キー / WASD で移動、スペースでシュート、Esc で一時停止
//   スマホ：画面の左半分に触れるとスティックが出る、右下のボタンでシュート、右上のボタンで一時停止

const KEYS = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  kick: ['Space'],
  pause: ['Escape'],
};
const USED = new Set(Object.values(KEYS).flat());

const pressed = new Set();
const queued = { kick: false, pause: false };

window.addEventListener('keydown', (e) => {
  if (!USED.has(e.code)) return;
  // ボタンにフォーカスがあるときのスペースは、ボタンを押す操作として残す
  if (e.code === 'Space' && e.target instanceof HTMLButtonElement) return;
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

// ---- タッチ操作 ----

const game = document.getElementById('game');
const zone = document.getElementById('stick-zone');
const stick = document.getElementById('stick');
const knob = document.getElementById('stick-knob');
const kickButton = document.getElementById('kick-button');
const pauseButton = document.getElementById('pause-button');

const STICK_RADIUS = 0.11; // スティックが動く半径（画面の高さに対する割合）
const DEAD_ZONE = 0.15;    // この割合より小さい指の動きは無視する

const touch = { id: null, originX: 0, originY: 0, right: 0, forward: 0 };

// タッチできる端末なら、画面にスティックとボタンを出す
function enableTouch() {
  game.classList.add('touch');
}
if (window.matchMedia('(pointer: coarse)').matches) enableTouch();
window.addEventListener('touchstart', enableTouch, { once: true, passive: true });

zone.addEventListener('pointerdown', (e) => {
  if (touch.id !== null) return;
  e.preventDefault();
  touch.id = e.pointerId;
  try {
    zone.setPointerCapture(e.pointerId);
  } catch {
    // 指を画面の外へ動かしたときに追えなくなるだけなので、失敗しても続ける
  }
  touch.originX = e.clientX;
  touch.originY = e.clientY;
  const rect = game.getBoundingClientRect();
  stick.classList.add('active');
  stick.style.left = `${e.clientX - rect.left}px`;
  stick.style.top = `${e.clientY - rect.top}px`;
  moveStick(e);
});

zone.addEventListener('pointermove', (e) => {
  if (e.pointerId === touch.id) moveStick(e);
});

for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  zone.addEventListener(type, (e) => {
    if (e.pointerId === touch.id) releaseStick();
  });
}

function moveStick(e) {
  const radius = game.clientHeight * STICK_RADIUS;
  let dx = e.clientX - touch.originX;
  let dy = e.clientY - touch.originY;
  const length = Math.hypot(dx, dy);
  if (length > radius) {
    dx *= radius / length;
    dy *= radius / length;
  }
  knob.style.transform = `translate(${dx}px, ${dy}px)`;
  const strong = length > radius * DEAD_ZONE;
  touch.right = strong ? dx / radius : 0;
  touch.forward = strong ? -dy / radius : 0;
}

function releaseStick() {
  touch.id = null;
  touch.right = 0;
  touch.forward = 0;
  stick.classList.remove('active');
  stick.style.left = '';
  stick.style.top = '';
  knob.style.transform = '';
}

// 押した瞬間に反応させる（click だと指を離すまで遅れるため）
function pressButton(button, name) {
  button.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    queued[name] = true;
    button.classList.add('pressed');
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
    button.addEventListener(type, () => button.classList.remove('pressed'));
  }
}
pressButton(kickButton, 'kick');
pressButton(pauseButton, 'pause');

// ---- ゲームから使う関数 ----

// 押されたら1回だけ true を返す
function consume(name) {
  const value = queued[name];
  queued[name] = false;
  return value;
}

// 画面から見た移動の向き。forward は画面の奥（前）、right は画面の右。長さは 0〜1
export function getMove() {
  let right;
  let forward;
  if (touch.id !== null) {
    right = touch.right;
    forward = touch.forward;
  } else {
    right = (isDown('right') ? 1 : 0) - (isDown('left') ? 1 : 0);
    forward = (isDown('up') ? 1 : 0) - (isDown('down') ? 1 : 0);
  }
  const length = Math.hypot(right, forward);
  if (length > 1) {
    right /= length;
    forward /= length;
  }
  return { right, forward };
}

// シュート
export const consumeKick = () => consume('kick');

// 一時停止・再開
export const consumePause = () => consume('pause');

// 画面を切り替えたときなどに、たまっていた入力と指の状態を捨てる
export function clearInput() {
  for (const name of Object.keys(queued)) queued[name] = false;
  pressed.clear();
  releaseStick();
}
