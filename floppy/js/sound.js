// 効果音とBGM（音声ファイルは使わず、ブラウザの中で音を合成する）
// ブラウザは、画面に触れる・キーを押すまで音を出せないので、最初の操作で音の準備をしてBGMを流し始める

const SOUND = {
  volume: 0.5,       // 効果音の音量（0〜1）
  minInterval: 0.12, // 同じ効果音を続けて鳴らすときの最短の間隔（秒）
};

// BGM：明るいポップス。弾むベースとドラム、裏拍のキラッとした和音に、覚えやすい8小節のメロディを乗せる
const BGM = {
  volume: 0.2,      // BGMの音量（0〜1）
  tempo: 116,       // 1分あたりの拍の数
  lookAhead: 0.3,   // 何秒先までの音を予約しておくか
  echoTime: 0.26,   // やまびこ（ディレイ）の間隔（秒）
  echoAmount: 0.25, // やまびこの残り具合（0〜1）
};

// 8小節でひと回りする和音（ド→ソ→ラ→ファ を2回）。bass は低い音、chord は和音（MIDIの音の番号。60 が真ん中のド）
const CHORDS = [
  { bass: 36, chord: [60, 64, 67] }, // C
  { bass: 31, chord: [59, 62, 67] }, // G
  { bass: 33, chord: [60, 64, 69] }, // Am
  { bass: 29, chord: [60, 65, 69] }, // F
];

// メロディ（8分音符ごと。null は休み＝前の音をのばす）
const MELODY = [
  76, 76, 79, null, 76, 74, 72, null, // C
  74, null, 71, 74, 79, null, 74, null, // G
  72, 76, 81, null, 79, 76, 72, null, // Am
  69, 72, 77, 76, 74, null, 72, null, // F
  76, 79, 84, null, 83, 79, 76, null, // C
  74, 79, 83, null, 81, 79, 74, null, // G
  72, 76, 81, 79, 76, null, 72, 74, // Am
  72, null, null, null, null, null, null, null, // F
];

const PREF_KEY = 'pocket-soccer-sound';

let ctx = null;
let master = null;
let sfxBus = null;
let bgmBus = null;
let echoIn = null;
let lastUoh = -Infinity;
let muted = loadMuted();
const bgm = { started: false, nextTime: 0, step: 0 };
let noise = null; // ドラム用の雑音（1回だけ作って使い回す）

function loadMuted() {
  try {
    return localStorage.getItem(PREF_KEY) === 'off';
  } catch {
    return false;
  }
}

function unlock() {
  if (!ctx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);

    sfxBus = ctx.createGain();
    sfxBus.gain.value = SOUND.volume;
    sfxBus.connect(master);

    bgmBus = ctx.createGain();
    bgmBus.gain.value = BGM.volume;
    bgmBus.connect(master);

    // やまびこ：少し遅れて、高い音を丸めながら繰り返す
    echoIn = ctx.createDelay(1);
    echoIn.delayTime.value = BGM.echoTime;
    const feedback = ctx.createGain();
    feedback.gain.value = BGM.echoAmount;
    const soften = ctx.createBiquadFilter();
    soften.type = 'lowpass';
    soften.frequency.value = 2400;
    echoIn.connect(soften);
    soften.connect(feedback);
    feedback.connect(echoIn);
    soften.connect(bgmBus);
  }
  if (ctx.state === 'suspended' && !document.hidden) ctx.resume();
  startBgm();
}
// iPhone などでは指を離したときやボタンを押したときでないと音を出せないことがあるので、それらでも準備する
for (const type of ['pointerdown', 'touchend', 'click', 'keydown']) window.addEventListener(type, unlock);

// 別のアプリやタブに切り替えたら音を止め、戻ったら再開する
document.addEventListener('visibilitychange', () => {
  if (!ctx) return;
  if (document.hidden) ctx.suspend();
  else ctx.resume();
});

// 音のオン・オフ（BGMと効果音の両方）。設定はこのブラウザに覚えておく
export function isMuted() {
  return muted;
}

export function setMuted(value) {
  muted = value;
  try {
    localStorage.setItem(PREF_KEY, muted ? 'off' : 'on');
  } catch {
    // 保存できなくても、今回の間はオン・オフが効く
  }
  if (master) master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.05);
}

// ---- BGM ----

function midiToHz(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

// 1つの音を予約する。attack で立ち上がり、length のあいだ鳴らして、release で消える
function tone(note, start, length, { type = 'sine', gain = 0.1, attack = 0.02, release = 0.4, to = bgmBus, cutoff = 0 } = {}) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = midiToHz(note);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(gain, start + attack);
  env.gain.setValueAtTime(gain, start + Math.max(attack, length));
  env.gain.exponentialRampToValueAtTime(0.0001, start + length + release);
  let out = osc;
  if (cutoff) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    osc.connect(filter);
    out = filter;
  }
  out.connect(env);
  if (Array.isArray(to)) for (const node of to) env.connect(node);
  else env.connect(to);
  osc.start(start);
  osc.stop(start + length + release + 0.05);
}

// ドラム用の雑音（0.5秒ぶん）
function noiseBuffer() {
  if (!noise) {
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noise;
}

// バスドラム：低い音を一気に下げる
function kick(time) {
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(150, time);
  osc.frequency.exponentialRampToValueAtTime(45, time + 0.12);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.55, time);
  env.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
  osc.connect(env);
  env.connect(bgmBus);
  osc.start(time);
  osc.stop(time + 0.2);
}

// スネアとハイハット：雑音を、高い音だけ通して短く鳴らす
function hiss(time, { cutoff, length, gain }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer();
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = cutoff;
  const env = ctx.createGain();
  env.gain.setValueAtTime(gain, time);
  env.gain.exponentialRampToValueAtTime(0.0001, time + length);
  src.connect(filter);
  filter.connect(env);
  env.connect(bgmBus);
  src.start(time);
  src.stop(time + length + 0.02);
}

// 8分音符1つぶんの音を予約する（1小節は8分音符8つ）
function scheduleStep(step, time) {
  const eighth = 60 / BGM.tempo / 2;
  const { bass, chord } = CHORDS[Math.floor(step / 8) % CHORDS.length];
  const inBar = step % 8;

  // ドラム：1・3拍目にバスドラム、2・4拍目にスネア、8分ごとにハイハット（裏拍を少し強く）
  if (inBar === 0 || inBar === 4) kick(time);
  if (inBar === 2 || inBar === 6) hiss(time, { cutoff: 1800, length: 0.14, gain: 0.22 });
  hiss(time, { cutoff: 7000, length: 0.04, gain: inBar % 2 ? 0.08 : 0.045 });

  // ベース：ド・ド・(1オクターブ上)・ド… と弾む
  const bassNote = inBar % 4 === 2 ? bass + 12 : bass;
  tone(bassNote, time, eighth * 0.7, { type: 'triangle', gain: 0.22, attack: 0.005, release: 0.08 });

  // 裏拍のキラッとした和音
  if (inBar % 2 === 1) {
    for (const note of chord) {
      tone(note + 12, time, eighth * 0.35, { type: 'square', gain: 0.018, attack: 0.005, release: 0.12, cutoff: 2600 });
    }
  }

  // メロディ：次が休みなら長めにのばす
  const index = step % MELODY.length;
  const note = MELODY[index];
  if (note !== null) {
    const next = MELODY[(index + 1) % MELODY.length];
    const length = next === null ? eighth * 1.7 : eighth * 0.8;
    tone(note, time, length, { type: 'square', gain: 0.05, attack: 0.01, release: 0.15, cutoff: 3000, to: [bgmBus, echoIn] });
  }
}

// 少し先までの音を予約し続ける（画面の描画とは別に、0.1秒ごとに確かめる）
function startBgm() {
  if (bgm.started || !ctx) return;
  bgm.started = true;
  bgm.nextTime = ctx.currentTime + 0.1;
  setInterval(() => {
    if (ctx.state !== 'running') return;
    const eighth = 60 / BGM.tempo / 2;
    // 止まっていた間の遅れは取り戻さず、今から続きを鳴らす
    if (bgm.nextTime < ctx.currentTime) bgm.nextTime = ctx.currentTime + 0.05;
    while (bgm.nextTime < ctx.currentTime + BGM.lookAhead) {
      scheduleStep(bgm.step, bgm.nextTime);
      bgm.nextTime += eighth;
      bgm.step += 1;
    }
  }, 100);
}

// 「うおっ」：声の高さを下げながら、口の形を「う」から「お」へ変える。pitch で声の高さを変える（1 が基準）
export function playUoh(pitch = 1) {
  if (!ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  if (now - lastUoh < SOUND.minInterval) return;
  lastUoh = now;
  const duration = 0.38;

  // 声帯の音（のこぎり波）。少し上がってから下がる
  const voice = ctx.createOscillator();
  voice.type = 'sawtooth';
  voice.frequency.setValueAtTime(230 * pitch, now);
  voice.frequency.linearRampToValueAtTime(290 * pitch, now + 0.06);
  voice.frequency.exponentialRampToValueAtTime(150 * pitch, now + duration);

  // 口の形（母音）を作る2つの響き。「う」→「お」
  const formant1 = ctx.createBiquadFilter();
  formant1.type = 'bandpass';
  formant1.Q.value = 6;
  formant1.frequency.setValueAtTime(330, now);
  formant1.frequency.linearRampToValueAtTime(520, now + 0.14);
  const formant2 = ctx.createBiquadFilter();
  formant2.type = 'bandpass';
  formant2.Q.value = 8;
  formant2.frequency.setValueAtTime(820, now);
  formant2.frequency.linearRampToValueAtTime(900, now + 0.14);

  const level2 = ctx.createGain();
  level2.gain.value = 0.5;

  // 音量：すっと出て、最後に消える
  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0.0001, now);
  envelope.gain.exponentialRampToValueAtTime(1.6, now + 0.03);
  envelope.gain.setValueAtTime(1.6, now + duration * 0.55);
  envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  voice.connect(formant1);
  voice.connect(formant2);
  formant2.connect(level2);
  formant1.connect(envelope);
  level2.connect(envelope);
  envelope.connect(sfxBus);

  voice.start(now);
  voice.stop(now + duration + 0.02);
}
