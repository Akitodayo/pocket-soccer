// ピッチとゴールの3Dモデル
import * as THREE from 'three';

// ピッチの大きさ（単位はおおよそメートル）。x方向が縦（ゴール間）、z方向が横幅
export const FIELD = {
  length: 40,
  width: 26,
  lineWidth: 0.15,
  centerCircleRadius: 4,
  penaltyDepth: 6,
  penaltyWidth: 14,
  goalAreaDepth: 2.4,
  goalAreaWidth: 9,
};

export const GOAL = {
  width: 6,
  height: 2.2,
  depth: 1.6,
  postRadius: 0.08,
};

const LINE_Y = 0.01;

export function createField(scene) {
  const group = new THREE.Group();
  group.add(createGround());
  group.add(createPitch());
  group.add(createLines());
  group.add(createBoards());
  group.add(createGoal(-1));
  group.add(createGoal(1));
  scene.add(group);
  return group;
}

// ピッチの外側の地面
function createGround() {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(160, 120),
    new THREE.MeshLambertMaterial({ color: 0x3f7a35 })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.01;
  mesh.receiveShadow = true;
  return mesh;
}

// 芝目の縞模様が入ったピッチ
function createPitch() {
  const margin = 3;
  const w = FIELD.length + margin * 2;
  const h = FIELD.width + margin * 2;

  const stripes = 12;
  const canvas = document.createElement('canvas');
  canvas.width = stripes * 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#4fa046' : '#5bb052';
    ctx.fillRect(i * 16, 0, 16, 16);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshLambertMaterial({ map: texture })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}

// 白線（外枠・センターライン・センターサークル・ペナルティエリア・ゴールエリア）
function createLines() {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const lw = FIELD.lineWidth;
  const halfL = FIELD.length / 2;

  // 長方形の線を1本置く（x, z は中心、sx, sz は大きさ）
  function addStrip(x, z, sx, sz) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, LINE_Y, z);
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // 枠線（中心がx, z、大きさがw, h の長方形）
  function addBox(x, z, w, h) {
    addStrip(x, z - h / 2, w + lw, lw);
    addStrip(x, z + h / 2, w + lw, lw);
    addStrip(x - w / 2, z, lw, h + lw);
    addStrip(x + w / 2, z, lw, h + lw);
  }

  // 外枠とセンターライン
  addBox(0, 0, FIELD.length, FIELD.width);
  addStrip(0, 0, lw, FIELD.width);

  // センターサークルとセンターマーク
  const circle = new THREE.Mesh(
    new THREE.RingGeometry(FIELD.centerCircleRadius - lw / 2, FIELD.centerCircleRadius + lw / 2, 64),
    material
  );
  circle.rotation.x = -Math.PI / 2;
  circle.position.y = LINE_Y;
  group.add(circle);

  const spot = new THREE.Mesh(new THREE.CircleGeometry(0.2, 16), material);
  spot.rotation.x = -Math.PI / 2;
  spot.position.y = LINE_Y;
  group.add(spot);

  // 左右のペナルティエリアとゴールエリア
  for (const side of [-1, 1]) {
    const lineX = side * halfL;
    addBox(lineX - side * FIELD.penaltyDepth / 2, 0, FIELD.penaltyDepth, FIELD.penaltyWidth);
    addBox(lineX - side * FIELD.goalAreaDepth / 2, 0, FIELD.goalAreaDepth, FIELD.goalAreaWidth);
  }

  return group;
}

// ピッチを囲む低い板。ボールはここで跳ね返る（ゴールの口だけ開いている）
function createBoards() {
  const group = new THREE.Group();
  const material = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
  const height = 0.4;
  const thick = 0.2;
  const halfL = FIELD.length / 2;
  const halfW = FIELD.width / 2;
  const offset = FIELD.lineWidth / 2 + thick / 2;

  function addBoard(x, z, sx, sz) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, height, sz), material);
    mesh.position.set(x, height / 2, z);
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // 手前と奥のサイド
  const sideLength = FIELD.length + (offset + thick / 2) * 2;
  addBoard(0, -(halfW + offset), sideLength, thick);
  addBoard(0, halfW + offset, sideLength, thick);

  // 左右のゴールの両脇
  const gapHalf = GOAL.width / 2 + GOAL.postRadius;
  const endLength = halfW - gapHalf;
  for (const side of [-1, 1]) {
    for (const zSign of [-1, 1]) {
      addBoard(side * (halfL + offset), zSign * (gapHalf + endLength / 2), thick, endLength);
    }
  }
  return group;
}

// ゴール（白い枠＋ネット）。side は -1 が左、1 が右
function createGoal(side) {
  const group = new THREE.Group();
  const { width, height, depth, postRadius } = GOAL;
  const halfWidth = width / 2;

  const frameMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const postGeometry = new THREE.CylinderGeometry(postRadius, postRadius, height, 12);

  // 2本のゴールポスト
  for (const z of [-halfWidth, halfWidth]) {
    const post = new THREE.Mesh(postGeometry, frameMaterial);
    post.position.set(0, height / 2, z);
    group.add(post);
  }

  // クロスバー
  const bar = new THREE.Mesh(
    new THREE.CylinderGeometry(postRadius, postRadius, width + postRadius * 2, 12),
    frameMaterial
  );
  bar.rotation.x = Math.PI / 2;
  bar.position.set(0, height, 0);
  group.add(bar);

  // 奥側の支え（細い枠）
  const backMaterial = new THREE.MeshLambertMaterial({ color: 0xdddddd });
  const thin = postRadius * 0.5;
  for (const z of [-halfWidth, halfWidth]) {
    const backPost = new THREE.Mesh(new THREE.CylinderGeometry(thin, thin, height, 8), backMaterial);
    backPost.position.set(depth, height / 2, z);
    group.add(backPost);

    const topBar = new THREE.Mesh(new THREE.CylinderGeometry(thin, thin, depth, 8), backMaterial);
    topBar.rotation.z = Math.PI / 2;
    topBar.position.set(depth / 2, height, z);
    group.add(topBar);
  }
  const backBar = new THREE.Mesh(new THREE.CylinderGeometry(thin, thin, width, 8), backMaterial);
  backBar.rotation.x = Math.PI / 2;
  backBar.position.set(depth, height, 0);
  group.add(backBar);

  // ネット（奥・上・左右）
  group.add(createNet(depth, height, width));

  // 左ゴールは左向き、右ゴールは右向きに置く（開いている側がピッチ中央を向く）
  group.position.x = side * FIELD.length / 2;
  if (side < 0) group.rotation.y = Math.PI;
  return group;
}

// 網目を線で描いたネット。ゴールライン（x=0）から奥（x=depth）に向かって張る
function createNet(depth, height, width) {
  const step = 0.3;
  const halfWidth = width / 2;
  const points = [];

  function line(ax, ay, az, bx, by, bz) {
    points.push(ax, ay, az, bx, by, bz);
  }

  // 奥の面（x=depth）
  for (let z = -halfWidth; z <= halfWidth + 1e-6; z += step) line(depth, 0, z, depth, height, z);
  for (let y = 0; y <= height + 1e-6; y += step) line(depth, y, -halfWidth, depth, y, halfWidth);

  // 上の面（y=height）
  for (let z = -halfWidth; z <= halfWidth + 1e-6; z += step) line(0, height, z, depth, height, z);
  for (let x = 0; x <= depth + 1e-6; x += step) line(x, height, -halfWidth, x, height, halfWidth);

  // 左右の面（z=±halfWidth）
  for (const z of [-halfWidth, halfWidth]) {
    for (let x = 0; x <= depth + 1e-6; x += step) line(x, 0, z, x, height, z);
    for (let y = 0; y <= height + 1e-6; y += step) line(0, y, z, depth, y, z);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const material = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });
  return new THREE.LineSegments(geometry, material);
}
