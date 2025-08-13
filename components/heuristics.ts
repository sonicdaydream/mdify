// 見出しにしたくない“誘導語”を弾く
const HEADING_STOP_RE = /(こちら|ここ|詳細はこちら|詳しくはこちら)$/;

// components/heuristics.ts
import type { Block } from '../lib/ai';

function autoLink(s: string) {
  return s.replace(
    /(https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+)/g,
    '[$1]($1)'
  );
}

// --- 調整しやすい設定 ---
const SETTINGS = {
  shortLen: 16,              // 短文しきい値
  preferHeadingColon: true,  // 行末の「:」「：」を見出し扱いに寄せる
};

const isBulletLine = (s: string) => /^\s*(?:[-*・●○]|\d+[.)])\s+/.test(s);

const isUrl = (s: string) => /(https?:\/\/)/.test(s);

const looksLikeShort = (s: string) => {
  const t = s.trim();
  if (HEADING_STOP_RE.test(t)) return false;
  if (/[。．!?！？]$/.test(t)) return false;    // 句点で終わる→段落
  if (/[、（）()]/.test(t)) return false;       // 読点/括弧含む短文→段落
  return t.length <= SETTINGS.shortLen;
};

// 見出しっぽさの推定（1つだけ！）
const isLikelyHeading = (s: string, next: string | null) => {
  const t = s.trim();
  if (!t) return false;
  if (HEADING_STOP_RE.test(t)) return false; // 👈 追加
  if (/^#{1,6}\s+/.test(t)) return true; // 既に # がある

  const endsWithColon = /[:：]$/.test(t);
  if (SETTINGS.preferHeadingColon && endsWithColon) return true;

  const len = Array.from(t).length; // ESの互換性OK（絵文字などのサロゲートペアも安全）
  const endsWithPunct = /[。．!?！？]$/.test(t);
  const hasHints = endsWithColon || /^【.+】$/.test(t);
  const selfLooksHeading = hasHints || (len <= 20 && !endsWithPunct);
  if (!selfLooksHeading) return false;

  // 次行が空行/箇条書きなどでも許容
  if (next !== null) return true;
  return true;
};

export function draftBlocksFromText(raw: string): Block[] {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let firstHeadingAssigned = false;
  let lastWasHeading = false; // ← 見出し直後かどうかを覚える

  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i];
    const next = i + 1 < lines.length ? lines[i + 1] : null;
    const trimmed = cur.trim();

    // [MDIFY PATCH] 「ラベル: 本文」行 → 箇条書き化（日本語/英語コロン対応）
    const labelColon = trimmed.match(/^(.{1,30})[:：]\s*(.+)$/);
    if (labelColon) {
      const label = labelColon[1].trim();
      const value = labelColon[2].trim();
      blocks.push({ type: 'bullet', text: `**${label}**: ${value}` });
      // lastWasHeading がスコープに無いプロジェクトの場合は次の行は削除してOK
      if (typeof lastWasHeading !== 'undefined') { lastWasHeading = false; }
      continue; // ← ここは for 文の“中”なので OK
    }

    if (trimmed === "") {
      blocks.push({ type: 'paragraph', text: '' });
      lastWasHeading = false;
      continue;
    }

    // 「例：○○のコード」→ 次の空行までコードブロック扱い
    const codeLabel = trimmed.match(/^例：(.+?)のコード/);
    if (codeLabel) {
      const langRaw = codeLabel[1].toLowerCase();
      const lang =
        /js|javascript/.test(langRaw) ? 'javascript' :
        /ts|typescript/.test(langRaw) ? 'typescript' :
        /py|python/.test(langRaw) ? 'python' : '';
      const code: string[] = [];
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== '') { code.push(lines[j]); j++; }
      blocks.push({ type: 'code', lang, text: code.join("\n") });
      i = j - 1;
      lastWasHeading = false;
      continue;
    }

    // 明示的な箇条書き
    if (isBulletLine(cur)) {
      let s = cur;
      s = s.replace(/^\s*(?:[-*・●○])\s+/, '- ');
      s = s.replace(/^\s*(\d+)[.)]\s+/, (_m, d) => `${d}. `);
      s = autoLink(s);
      blocks.push({ type: 'bullet', text: s.replace(/^[-\d.\s]+/, '') });
      lastWasHeading = false;
      continue;
    }

    // 先頭の非空行は必ず見出し
    if (!firstHeadingAssigned) {
      const title = trimmed
        .replace(/^#{1,6}\s+/, '')
        .replace(/[：:]+\s*$/, '')
        .replace(/^【(.+)】$/, '$1')
        .trim();
      blocks.push({ type: 'heading', text: title });
      firstHeadingAssigned = true;
      lastWasHeading = true;               // ← 見出し直後フラグON
      continue;
    }

    // 👇 ここが質問の「どこに書く？」その1
    // 見出しの直後：短い非URL行が「1行だけ」なら段落にする
    if (lastWasHeading && looksLikeShort(trimmed) && !isUrl(trimmed)) {
      const nextLine = (i + 1 < lines.length) ? lines[i + 1].trim() : "";
      const nextIsAlsoShort = nextLine && looksLikeShort(nextLine) && !isUrl(nextLine);
      if (!nextIsAlsoShort) {
        blocks.push({ type: 'paragraph', text: trimmed });
        lastWasHeading = false;            // ← 見出し直後扱いを解除
        continue;
      }
      // もし次も短文なら、この後の「短文は箇条書き」でまとめる
    }

    // 見出しっぽい（誘導語や末尾コロンなどの判定は isLikelyHeading 内）
    if (isLikelyHeading(cur, next)) {
      const title = cur
        .replace(/^#{1,6}\s+/, '')
        .replace(/[：:]+\s*$/, '')
        .replace(/^【(.+)】$/, '$1')
        .trim();
      blocks.push({ type: 'heading', text: title });
      lastWasHeading = true;               // ← 見出し直後フラグON
      continue;
    }

    // 👇 ここが質問の「どこに書く？」その2（通常の短文→箇条書き）
    if (looksLikeShort(trimmed) && !isUrl(trimmed)) {
      blocks.push({ type: 'bullet', text: trimmed });
      lastWasHeading = false;
      continue;
    }

    // それ以外は段落（連続行をまとめる）
    const group: string[] = [cur];
    let j = i + 1;
    while (j < lines.length) {
      const s = lines[j];
      const n = j + 1 < lines.length ? lines[j + 1] : null;
      if (s.trim() === '' || isBulletLine(s) || isLikelyHeading(s, n)) break;
      group.push(s); j++;
    }
    const joined = autoLink(group.join("\n"));
    blocks.push({ type: 'paragraph', text: joined });
    i = j - 1;
    lastWasHeading = false;
  }
  return blocks;
}


export function textToMarkdown(raw: string): string {
  const blocks = draftBlocksFromText(raw);
  const out: string[] = [];
  for (const b of blocks) {
    if (b.type === 'heading') out.push('## ' + b.text.trim());
    else if (b.type === 'bullet') out.push('- ' + b.text.trim());
    else if (b.type === 'code') { out.push('```' + (b.lang || '')); out.push(b.text); out.push('```'); }
    else out.push(b.text.trim() + "\n");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}
