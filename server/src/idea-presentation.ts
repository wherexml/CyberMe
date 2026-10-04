// Historical generated Ideas are data for the application, not a chat protocol.
export function readableIdeaReply(content: string): string {
  try {
    const raw = content.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.ideas) || !parsed.ideas.length || parsed.ideas.some((v:any) => typeof v?.title !== 'string' || typeof v?.description !== 'string')) return content;
    return parsed.ideas.map((v:any,i:number) => `### ${i+1}. ${v.title}\n\n${v.description}`).join('\n\n');
  } catch { return content; }
}
