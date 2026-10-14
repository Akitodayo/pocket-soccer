// 演出（必殺技の炎の竜巻・神ハンドの巨大な手）
import * as THREE from 'three';

const TORNADO = {
  flames: 42,    // 炎の粒の数
  height: 3.2,   // 竜巻の高さ
  radius: 1.1,   // 竜巻の下のほうの半径（上へ行くほど少し広がる）
  turnSpeed: 9,  // 回る速さ
  riseSpeed: 1.6, // 粒が上っていく速さ
};

// 選手のまわりを、炎の粒がらせんを描いて回りながら上っていく
export class FireTornado {
  constructor(scene) {
    const texture = createFlameTexture();
    this.flames = [];
    for (let i = 0; i < TORNADO.flames; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
      sprite.visible = false;
      scene.add(sprite);
      // 粒ごとに、らせんのどこから始めるかをずらす
      this.flames.push({ sprite, offset: i / TORNADO.flames, angle: Math.random() * Math.PI * 2 });
    }
    this.time = 0;
    this.strength = 0; // 0（消えている）〜 1（全開）
    this.orange = new THREE.Color(0xffb000);
    this.red = new THREE.Color(0xd41a00);
  }

  // center のまわりに竜巻を出す。active が false なら、すっと消える
  update(dt, center, active) {
    this.time += dt;
    const target = active ? 1 : 0;
    this.strength += (target - this.strength) * (1 - Math.exp(-(active ? 6 : 10) * dt));
    const visible = this.strength > 0.02;

    for (const flame of this.flames) {
      flame.sprite.visible = visible;
      if (!visible) continue;
      // 0（足元）→ 1（てっぺん）をくり返しながら上っていく
      const t = (flame.offset + this.time * TORNADO.riseSpeed * 0.4) % 1;
      const angle = flame.angle + this.time * TORNADO.turnSpeed + t * Math.PI * 4;
      const radius = TORNADO.radius * (0.7 + t * 0.6) * this.strength;
      flame.sprite.position.set(
        center.x + Math.cos(angle) * radius,
        center.y + t * TORNADO.height,
        center.z + Math.sin(angle) * radius
      );
      flame.sprite.scale.setScalar((0.6 - t * 0.25) * this.strength + 0.08);
      flame.sprite.material.color.copy(this.orange).lerp(this.red, t);
      flame.sprite.material.opacity = 0.85 * this.strength * (1 - t * 0.6);
    }
  }
}

// 神ハンド：キーパーの前に、光る巨大な金色の手が現れる（手のひらを相手のほうへ向ける）
export class GodHand {
  constructor(scene) {
    const material = new THREE.MeshBasicMaterial({ color: 0xffd75a, transparent: true, opacity: 0.85, depthWrite: false });
    this.material = material;
    this.group = new THREE.Group();

    // 手のひら・4本の指・親指（手のひらは +z を向く）
    const palm = new THREE.Mesh(new THREE.CapsuleGeometry(0.62, 0.5, 6, 16), material);
    palm.scale.set(1, 1, 0.38);
    this.group.add(palm);
    const fingerGeometry = new THREE.CapsuleGeometry(0.15, 0.62, 6, 10);
    [-0.45, -0.15, 0.15, 0.45].forEach((x, i) => {
      const finger = new THREE.Mesh(fingerGeometry, material);
      finger.position.set(x, 1.05 + (i === 1 || i === 2 ? 0.12 : 0), 0);
      this.group.add(finger);
    });
    const thumb = new THREE.Mesh(fingerGeometry, material);
    thumb.position.set(-0.78, 0.15, 0.05);
    thumb.rotation.z = 0.9;
    this.group.add(thumb);

    // まわりの光
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: createFlameTexture(),
      color: 0xffe08a,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    this.glow.scale.setScalar(4.5);
    this.group.add(this.glow);

    this.group.visible = false;
    scene.add(this.group);
    this.time = 0;
    this.strength = 0;
  }

  // position に、yaw の向き（手のひらが向く方角）で手を出す。active が false なら消える
  update(dt, position, yaw, active) {
    this.time += dt;
    const target = active ? 1 : 0;
    this.strength += (target - this.strength) * (1 - Math.exp(-(active ? 9 : 6) * dt));
    this.group.visible = this.strength > 0.02;
    if (!this.group.visible) return;
    // 出るときは少し大きくなりすぎてから戻る（ぽよん）
    const pop = active ? 1 + Math.sin(Math.min(1, this.strength) * Math.PI) * 0.25 : 1;
    this.group.scale.setScalar(1.25 * this.strength * pop);
    this.group.position.copy(position);
    this.group.rotation.set(0, yaw, 0);
    this.material.opacity = 0.85 * this.strength;
    this.glow.material.opacity = (0.55 + Math.sin(this.time * 12) * 0.15) * this.strength;
  }
}

// 中心が明るく、外側が透明な丸
function createFlameTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}
