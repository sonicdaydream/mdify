// pages/index.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import { saveAs } from "file-saver";
import { draftBlocksFromText, textToMarkdown } from "../components/heuristics";
import { buildMarkdown, Block } from "../lib/ai";

type Mode = 'rule' | 'ai_on_demand' | 'ai_auto';

export default function Home() {
  const [input, setInput] = useState<string>("");
  const [md, setMd] = useState<string>("");
  const [filename, setFilename] = useState<string>("converted.md");
  const [mode, setMode] = useState<Mode>('ai_on_demand');  // デフォルト: AI手動
  const [provider, setProvider] = useState<'openai'|'gemini'>('openai');
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // 自動処理（rule or ai_auto）
  useEffect(() => {
    const t = setTimeout(async () => {
      const ruleMd = textToMarkdown(input);
      if (!input.trim()) { setMd(""); return; }
      if (mode === 'rule') { setMd(ruleMd); return; }

      if (mode === 'ai_auto') {
        setLoading(true);
        try {
          const blocks = draftBlocksFromText(input);
          const r = await fetch('/api/refine', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blocks, provider })
          });
          const data = await r.json();
      if (data?.meta) { console.log('AI meta:', data.meta); }
          const refined: Block[] = data.blocks || blocks;
          setMd(buildMarkdown(refined));
        } catch {
          setMd(ruleMd);
        } finally {
          setLoading(false);
        }
      } else {
        // ai_on_demand: 自動ではルール結果のみ
        setMd(ruleMd);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [input, mode, provider]);

  const html = useMemo(() => {
    marked.setOptions({ breaks: true });
    return marked.parse(md || "");
  }, [md]);

  const onDownload = () => {
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    saveAs(blob, filename);
  };

  const onFile = async (f: File) => {
    const text = await f.text();
    setInput(text);
    const base = f.name.replace(/\.[^.]+$/, "") || "converted";
    setFilename(base + ".md");
  };

  const sample = `やること
掃除
洗濯
買い物
連絡`;

  async function improveWithAI() {
    setLoading(true);
    try {
      const blocks = draftBlocksFromText(input);
      const r = await fetch('/api/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks, provider })
      });
      const data = await r.json();
      if (data?.meta) { console.log('AI meta:', data.meta); }
      const refined: Block[] = data.blocks || blocks;
      setMd(buildMarkdown(refined));
    } catch {
      // 失敗時はルール結果を保持
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
        <header className="md:col-span-2">
          <h1 className="text-2xl font-bold text-blue-600">
            Text → Markdown 変換（ルール / AI手動 / AI自動）
          </h1>
          <p className="text-gray-600 mt-1 text-sm">
            まずは高速なルール整形で表示。必要に応じてAIで「見出し/箇条書き/段落」を文脈判定して精度アップできます。
          </p>
        </header>

        {/* 入力 */}
        <section className="bg-white rounded-xl shadow p-4 flex flex-col">
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <button
              className="px-3 py-1.5 rounded bg-gray-800 text-white text-sm"
              onClick={() => { setInput(sample); setFilename('sample.md'); }}
            >
              サンプル貼り付け
            </button>

            <input
              ref={fileRef}
              type="file"
              accept=".txt"
              className="hidden"
              onChange={(e) => e.target.files && onFile(e.target.files[0])}
            />
            <button
              className="px-3 py-1.5 rounded bg-gray-200 text-sm"
              onClick={() => fileRef.current?.click()}
            >
              .txt を読み込む
            </button>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <label className="text-sm flex items-center gap-1">
                <input type="radio" name="mode" checked={mode==='rule'} onChange={()=>setMode('rule')} /> ルール
              </label>
              <label className="text-sm flex items-center gap-1">
                <input type="radio" name="mode" checked={mode==='ai_on_demand'} onChange={()=>setMode('ai_on_demand')} /> AI手動
              </label>
              <label className="text-sm flex items-center gap-1">
                <input type="radio" name="mode" checked={mode==='ai_auto'} onChange={()=>setMode('ai_auto')} /> AI自動
              </label>

              <select
                className="border rounded p-1.5 text-sm"
                value={provider}
                onChange={e=>setProvider(e.target.value as any)}
                disabled={mode==='rule'}
              >
                <option value="openai">OpenAI</option>
                <option value="gemini">Gemini</option>
              </select>
            </div>
          </div>

          <textarea
            className="flex-1 w-full border rounded p-3 text-sm font-mono outline-none"
            placeholder="ここにテキストを貼り付け"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />

          <div className="mt-3 flex items-center gap-2">
            <input
              className="border rounded p-2 text-sm w-60"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
            />
            <button
              className="px-3 py-2 rounded bg-green-600 text-white text-sm disabled:bg-gray-300"
              onClick={onDownload}
              disabled={!md}
            >
              .md をダウンロード
            </button>
            {mode==='ai_on_demand' && (
              <button
                className="px-3 py-2 rounded bg-blue-600 text-white text-sm"
                onClick={improveWithAI}
              >
                AIで改善する
              </button>
            )}
            {loading && <span className="text-xs text-gray-500">AI処理中...</span>}
          </div>
          <p className="text-xs text-gray-500 mt-2">
            {mode==='rule'
              ? "※ すべてブラウザ内で処理され、サーバーには送信されません。"
              : "※ AI実行時のみ、構造化ブロックをAPIに送信します（本文は保存しません）。"}
          </p>
        </section>

        {/* プレビュー */}
        <section className="bg-white rounded-xl shadow p-4">
          <h2 className="text-sm font-semibold text-gray-600 mb-2">Markdown プレビュー</h2>
          <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: html as string }} />
          <h2 className="text-sm font-semibold text-gray-600 mt-6 mb-2">Markdown テキスト</h2>
          <pre className="bg-gray-900 text-gray-100 p-3 rounded overflow-auto text-xs"><code>{md}</code></pre>
        </section>
      </div>
    </div>
  );
}