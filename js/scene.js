// 3D空間・カメラ・光・影
import * as THREE from 'three';

export const ASPECT = 16 / 9;

export function createScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fd3f0);
  scene.fog = new THREE.Fog(0x9fd3f0, 60, 120);

  // テレビ中継のように、手前のサイドライン側の斜め上から全体を映す
  const camera = new THREE.PerspectiveCamera(40, ASPECT, 0.5, 200);
  camera.position.set(0, 27, 37);
  camera.lookAt(0, 0, 0.5);

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

  return { renderer, scene, camera };
}
