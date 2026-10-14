// 戦績の保存（このブラウザの中だけに保存する。名前などの個人情報は保存しない）

const KEY = 'pocket-soccer-record';

// 通算の勝ち・負け・引き分けの数を読み込む。読めないときはすべて0
export function loadRecord() {
  const empty = { win: 0, lose: 0, draw: 0 };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (!saved) return empty;
    return {
      win: Number(saved.win) || 0,
      lose: Number(saved.lose) || 0,
      draw: Number(saved.draw) || 0,
    };
  } catch {
    return empty;
  }
}

// result（'win' / 'lose' / 'draw'）を1つ足して保存し、新しい戦績を返す
export function addResult(result) {
  const record = loadRecord();
  record[result] += 1;
  try {
    localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    // 保存できない設定のブラウザでも、試合はそのまま続けられるようにする
  }
  return record;
}
