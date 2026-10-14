// ボールの動きと物理（物理はステップ2で作る）
import * as THREE from 'three';

export const BALL_RADIUS = 0.35;

export function createBall(scene) {
  const mesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(BALL_RADIUS, 3),
    new THREE.MeshLambertMaterial({ map: createBallTexture() })
  );
  mesh.position.set(0, BALL_RADIUS, 0);
  mesh.castShadow = true;
  scene.add(mesh);
  return { mesh };
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
