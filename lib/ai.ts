export type BlockType = 'heading'|'bullet'|'paragraph'|'code';
export type Block = { type: BlockType; text: string; lang?: string };

export function buildMarkdown(blocks: Block[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.type === 'heading') {
      const title = b.text.trim().replace(/^#{1,6}\s+/, '');
      out.push(`## ${title}`);
    } else if (b.type === 'bullet') {
      const lines = b.text.split(/\n+/).map(s=>s.trim()).filter(Boolean);
      for (const l of lines) out.push(`- ${l}`);
    } else if (b.type === 'code') {
      const lang = (b.lang||'').trim();
      out.push('```' + lang);
      out.push(b.text);
      out.push('```');
    } else {
      out.push(b.text.trim() + "\n");
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

export function sanitizeBlocks(arr: any): Block[] {
  if (!Array.isArray(arr)) return [];
  const out: Block[] = [];
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue;
    const type = ['heading','bullet','paragraph','code'].includes(it.type) ? it.type : 'paragraph';
    const text = typeof it.text === 'string' ? it.text : '';
    const lang = typeof it.lang === 'string' ? it.lang : undefined;
    out.push({ type: type as BlockType, text, lang });
  }
  return out;
}