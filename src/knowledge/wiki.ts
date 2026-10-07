// L2 知识供给层（wiki 模式）：知识库量级小且稳定，直接整库拉取注入 LLM 上下文；
// 证据流水（持续增长）未来才走 pgvector 检索，分界线是数据增长率。
// 红线：本层只供给"依据"，验收判定永远由 src/verifier.ts 的确定性代码执行。
// SQL 不出现在本文件——读取一律走 persistence.selectKnowledgeChunks（参数绑定收口）。
import { persistenceEnabled, selectKnowledgeChunks } from "../data/persistence.js";

export type KnowledgeChunk = Awaited<ReturnType<typeof selectKnowledgeChunks>>[number];

/** 拉取知识块；concepts 给定时按概念标签预过滤。未启用持久化时返回空数组。 */
export async function loadKnowledgeChunks(concepts?: string[]): Promise<KnowledgeChunk[]> {
  if (!persistenceEnabled()) return [];
  return selectKnowledgeChunks(concepts);
}

// pgvector 缓行的触发条件：知识库 >50 块或注入 >15k token 时再立项查询向量化。
// 届时先修 db-design/04-vector-layer.sql:8 的模型名注释（写的 gte-small，
// 实际 embed-knowledge.mjs 用的是 Xenova/multilingual-e5-small，模型不一致会致相似度失真），
// 跑 embed 回填，再接库里已建好的 match_knowledge RPC + HNSW 索引。
const MAX_INJECT_CHUNKS = 8;

/**
 * 按与问题的相关度挑选知识块：keywords/concepts/title 三项子串命中计分（3/2/1）。
 * 一个都没命中时回退全量——行为不劣于整库注入，且数字守卫的 allowed 集合
 * 只随注入块缩小，不会因过滤而漏放编造数字。纯函数，无 I/O。
 */
export function selectRelevantChunks(chunks: KnowledgeChunk[], question: string, limit = MAX_INJECT_CHUNKS): KnowledgeChunk[] {
  if (chunks.length <= limit) return chunks;
  const scored = chunks.map((chunk, index) => {
    let score = 0;
    for (const keyword of chunk.keywords ?? []) {
      if (question.includes(keyword)) { score += 3; break; }
    }
    for (const concept of chunk.concepts ?? []) {
      if (question.includes(concept)) { score += 2; break; }
    }
    if (question.includes(chunk.title)) score += 1;
    return { chunk, score, index };
  });
  const matched = scored.filter((item) => item.score > 0);
  if (matched.length === 0) return chunks.slice(0, limit);
  matched.sort((a, b) => b.score - a.score || a.index - b.index);
  return matched.slice(0, limit).map((item) => item.chunk);
}

/** 问答链路入口：整库拉取后按相关度裁剪。持久化未启用返回空数组。 */
export async function loadKnowledgeForQuestion(question: string): Promise<KnowledgeChunk[]> {
  const chunks = await loadKnowledgeChunks();
  return selectRelevantChunks(chunks, question);
}

/** 组装 LLM 上下文的"知识附录"，每块带 K 编号与回链引用。 */
export function buildWikiAppendix(chunks: KnowledgeChunk[]): string {
  return chunks
    .map((chunk, index) => "【K" + (index + 1) + "】" + chunk.title + "（来源: " + chunk.sourceTable + "#" + chunk.sourceId + "）\n" + chunk.chunkText)
    .join("\n\n");
}
