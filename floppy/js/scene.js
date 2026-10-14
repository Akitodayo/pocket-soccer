// 3D空間・カメラ・光・影
import * as THREE from 'three';

export const ASPECT = 16 / 9;

// カメラの調整用の数値
const CAMERA = {
  fov: 55,         // 映す範囲の広さ（角度）
  back: 8,         // 選手からどれだけ後ろに置くか
  height: 6.5,     // 地面からの高さ
  lookAhead: 5,    // 選手のどれだけ前を見るか
  lookHeight: 0.8, // 見る点の高さ
  follow: 6,       // 追いかける素早さ
};

// カメラを選手の後ろに付ける。attackDir（1 なら右のゴール）の方向を向く
// snap が true なら、なめらかに追わずにすぐその位置へ移す
export function updateCamera(camera, target, attackDir, dt, snap = false) {
  const goalX = target.x - attackDir * CAMERA.back;
  const t = snap ? 1 : 1 - Math.exp(-CAMERA.follow * dt);
  camera.position.x += (goalX - camera.position.x) * t;
  camera.position.z += (target.z - camera.position.z) * t;
  camera.position.y = CAMERA.height;
  camera.lookAt(camera.position.x + attackDir * (CAMERA.back + CAMERA.lookAhead), CAMERA.lookHeight, camera.position.z);
}

// 必殺技の演出：その選手だけを近くから、まわりを回り込みながら映す（アニメの見せ場のカット）
// distance はカメラまでの距離、height はカメラの高さ（選手の足元から）
export function updateCloseUpCamera(camera, center, angle, dt, distance = 3.6, height = 1.2) {
  const t = 1 - Math.exp(-8 * dt);
  camera.position.x += (center.x + Math.sin(angle) * distance - camera.position.x) * t;
  camera.position.y += (center.y + height - camera.position.y) * t;
  camera.position.z += (center.z + Math.cos(angle) * distance - camera.position.z) * t;
  camera.lookAt(center.x, center.y + 0.8, center.z);
}

// タイトル画面では、ピッチの上をゆっくり回りながら映す
export function updateTitleCamera(camera, seconds) {
  const angle = seconds * 0.08;
  camera.position.set(Math.sin(angle) * 30, 15, Math.cos(angle) * 30);
  camera.lookAt(0, 0, 0);
}

// 描画解像度の段階（画面の細かさ）。重い端末では順に下げる
const MIN_PIXEL_RATIO = 0.75;

export function createScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  let pixelRatio = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fd3f0);
  scene.fog = new THREE.Fog(0x9fd3f0, 60, 120);

  // 選手の少し後ろから、相手ゴールの方向を映す（位置は updateCamera で毎コマ動かす）
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, ASPECT, 0.3, 200);

  // 空と地面の照り返しで全体を明るくする
  const hemi = new THREE.HemisphereLight(0xffffff, 0x4a7a3a, 0.9);
  scene.add(hemi);

  // 太陽光。影はボールと選手だけが落とす（castShadow はそれぞれで設定）
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(-12, 30, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 18;
  sun.shadow.camera.bottom = -18;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 80;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  // 画面枠（#game）の大きさに合わせて描画サイズを変える
  function resize() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  // 動きが重いときに描画解像度を1段下げる。もう下げられなければ false を返す
  function lowerResolution() {
    if (pixelRatio <= MIN_PIXEL_RATIO) return false;
    pixelRatio = Math.max(MIN_PIXEL_RATIO, pixelRatio - 0.25);
    renderer.setPixelRatio(pixelRatio);
    resize();
    return true;
  }

  return { renderer, scene, camera, lowerResolution };
}
