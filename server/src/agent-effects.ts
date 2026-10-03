/** One classification shared by runtime evidence and chat restart/error recovery. */
// Only old persisted records lacking metadata need name-based migration compatibility.
const legacyWrites=new Set(['create_task','save_memory','preference_committed','set_inbox_source_rule','save_draft','generate_file']);
export function completedAgentWrites(run:any){
 return (run?.tools||[]).filter((t:any)=>t.effect==='write'&&((t.status==='succeeded'&&t.commitState!=='settled')||t.commitState==='unknown')||t.effect===undefined&&t.status==='succeeded'&&legacyWrites.has(t.name));
}
