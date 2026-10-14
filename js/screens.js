// タイトル・結果・一時停止の画面

const screens = {
  title: document.getElementById('title-screen'),
  result: document.getElementById('result-screen'),
  pause: document.getElementById('pause-screen'),
};

const RESULT_LABEL = { win: '勝ち！', lose: '負け…', draw: '引き分け' };

// name の画面だけを表示する。null ならすべて隠す
export function showScreen(name) {
  for (const [key, element] of Object.entries(screens)) {
    element.hidden = key !== name;
  }
}

export function setRecord({ win, lose, draw }) {
  document.getElementById('record-win').textContent = win;
  document.getElementById('record-lose').textContent = lose;
  document.getElementById('record-draw').textContent = draw;
}

export function setResult({ blue, red }, result) {
  document.getElementById('final-blue').textContent = blue;
  document.getElementById('final-red').textContent = red;
  const label = document.getElementById('result-label');
  label.textContent = RESULT_LABEL[result];
  label.dataset.result = result;
}

// ボタンが押されたら handler を呼ぶ
export function onButton(id, handler) {
  document.getElementById(id).addEventListener('click', handler);
}

// Enterキーで、表示中の画面の主なボタンを押す
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
  const visible = Object.values(screens).find((element) => !element.hidden);
  const button = visible?.querySelector('.btn-primary');
  if (button) {
    e.preventDefault();
    button.click();
  }
});
