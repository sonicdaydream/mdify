// pages/api/refine.ts
import type { NextApiRequest, NextApiResponse } from 'next';

// ---- 受け取り用の最低限型（importに依存しない）----
type Block = { type: 'heading'|'bullet'|'paragraph'|'code'; text: string; lang?: string };

// ---- ハンドラ ----
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 受け取ったボディのキーを必ず出す（ここで止まってないか確認）
  console.log('[refine] body keys =', Object.keys(req.body || {}));

  // 受け取り（blocks or raw）
  const provider = (req.body?.provider || process.env.LLM_PROVIDER || 'openai') as 'openai'|'gemini';
  const model = req.body?.model || (provider === 'openai'
    ? (process.env.OPENAI_MODEL || 'gpt-4o-mini')
    : (process.env.GEMINI_MODEL || 'gemini-1.5-flash'));

  // rawText / text / blocks の順で拾う
  const raw: string | null =
    (typeof req.body?.rawText === 'string' && req.body.rawText.trim()) ? req.body.rawText :
    (typeof req.body?.text === 'string'    && req.body.text.trim())    ? req.body.text    :
    null;

  const inBlocks: Block[] = Array.isArray(req.body?.blocks) ? req.body.blocks : [];

  console.log('[refine] provider =', provider, 'model =', model, 'hasRaw =', !!raw, 'blocks =', inBlocks.length);

  // プロンプト生成
  const prompt = raw ? buildPromptFromRaw(raw) : buildPromptFromBlocks(inBlocks);

  // 呼び出し
  let refined: Block[] = [];
  let from: 'ai'|'fallback' = 'fallback';

  try {
    if (provider === 'openai') {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('OPENAI_API_KEY missing');

      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'Return JSON ONLY: either an array or {"blocks":[...]} (no prose).' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.2,
          max_tokens: 1200
        })
      });

      let data: any = null;
      try { data = await r.json(); } catch (e) {
        console.error('[refine] openai json parse error (HTTP', r.status, '):', e);
      }
      const content: string = data?.choices?.[0]?.message?.content || '';
      console.log('[refine] raw(openai): status=', r.status, 'len=', content?.length || 0);

      if (!r.ok) {
        console.error('[refine] openai HTTP error:', r.status, data?.error || data);
      } else if (!content) {
        console.error('[refine] openai empty content. full payload (trimmed)=', JSON.stringify(data)?.slice(0, 800));
      } else {
        refined = safeParseBlocks(content);
      }
    } else {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('GEMINI_API_KEY missing');

      const r = await fetch(`https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2 }
        })
      });
      let data: any = null;
      try { data = await r.json(); } catch (e) {
        console.error('[refine] gemini json parse error (HTTP', r.status, '):', e);
      }
      const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      console.log('[refine] raw(gemini): status=', r.status, 'len=', text?.length || 0);

      if (!r.ok) {
        console.error('[refine] gemini HTTP error:', r.status, data);
      } else if (!text) {
        console.error('[refine] gemini empty content. full payload (trimmed)=', JSON.stringify(data)?.slice(0, 800));
      } else {
        refined = safeParseBlocks(text);
      }
    }
  } catch (e: any) {
    console.error('[refine] error:', e?.message || e);
  }

  if (refined?.length) from = 'ai';
  console.log('[refine] parsedBlocks =', refined?.length || 0, 'from =', from);

  // フォールバックは「受け取った blocks をそのまま返す」
  const out = refined?.length ? refined : sanitizeBlocks(inBlocks);
  return res.status(200).json({ blocks: out, meta: { provider, model, from, mode: raw ? 'raw' : 'blocks' } });
}

// ---- sanitize（最低限。余計な型エラー回避）----
function sanitizeBlocks(arr: any): Block[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((it) => ({
    type: (['heading','bullet','paragraph','code'].includes(it?.type) ? it.type : 'paragraph') as Block['type'],
    text: (typeof it?.text === 'string' ? it.text : ''),
    lang: (typeof it?.lang === 'string' ? it.lang : undefined),
  }));
}

// ---- プロンプト（raw / blocks）----
function buildPromptFromRaw(raw: string) {
  // ▼ここで不可視文字(U+FEFF: ゼロ幅ノーブレークスペース)を除去
  const cleanedRaw = (raw || '').replace(/\uFEFF/g, '');

  return `次の生テキストを "heading"|"bullet"|"paragraph"|"code" の配列(JSONのみ)にしてください。
厳守:
- 最初の非空行は heading。
- 以降、16文字以内・句点終わりでなく・URLなし → bullet。
- 読点・括弧を含む短文は paragraph。
- code は lang 指定可。
- 「見出し: 説明」「Heading: text」のように **ラベル＋コロン＋本文** になっている行は、必ず **bullet** として扱い、出力テキストは「- **ラベル**: 本文」にする（日本語「：」/英語「:」どちらも対象）。

入力例:
Markdownの基本的な書き方:
見出し:# ## ### などで、見出しのレベルを表します。
リスト:* や 1. などで、箇条書きリストを作成します。

期待する出力(JSON配列):
[
  {"type":"heading","text":"Markdownの基本的な書き方"},
  {"type":"bullet","text":"**見出し**: # ## ### などで、見出しのレベルを表します。"},
  {"type":"bullet","text":"**リスト**: * や 1. などで、箇条書きリストを作成します。"}
]

テキスト:
${cleanedRaw}
出力(JSON配列のみ):`;
}


function buildPromptFromBlocks(blocks: Block[]) {
  return `次のブロック配列を最適化してJSON配列のみ返してください（"heading"|"bullet"|"paragraph"|"code"）。
厳守:
- 最初の非空は heading。
- 16文字以内かつ句点終わりでなくURLなし → bullet。
- 読点・括弧を含む短文は paragraph。
- code の lang 指定可。
- 「見出し: 説明」「Heading: text」のように **ラベル＋コロン＋本文** になっている行は、必ず **bullet** として扱い、出力テキストは「- **ラベル**: 本文」にする（日本語「：」/英語「:」どちらも対象）。

入力例:
Markdownの基本的な書き方:
見出し:# ## ### などで、見出しのレベルを表します。
リスト:* や 1. などで、箇条書きリストを作成します。

期待する出力(JSON配列):
[
  {"type":"heading","text":"Markdownの基本的な書き方"},
  {"type":"bullet","text":"**見出し**: # ## ### などで、見出しのレベルを表します。"},
  {"type":"bullet","text":"**リスト**: * や 1. などで、箇条書きリストを作成します。"}
]

入力:
${JSON.stringify(blocks, null, 2)}
出力(JSON配列のみ):`;
}


// ---- パーサ（```json フェンスや {"blocks":…} / […] どちらも許可）----
function safeParseBlocks(text: string): Block[] {
  try {
    if (!text) return [];
    const stripped = text.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```$/, '').trim();
    if (stripped.startsWith('{')) {
      const obj = JSON.parse(stripped);
      if (Array.isArray(obj?.blocks)) return sanitizeBlocks(obj.blocks);
    }
    const m = stripped.match(/\[[\s\S]*\]/);
    const json = m ? m[0] : stripped;
    const arr = JSON.parse(json);
    return sanitizeBlocks(arr);
  } catch (e) {
    console.error('[refine] parse error:', (e as any)?.message || e);
    return [];
  }
}
