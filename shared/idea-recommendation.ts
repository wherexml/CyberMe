/** Display metadata only. Clicking prepares a draft; the model never supplies an executable action type. */
export function readIdeaRecommendation(value:unknown):{label:string;prompt:string}|undefined{
 const r=value as any;
 if(!r||typeof r.label!=='string'||typeof r.prompt!=='string')return;
 const label=r.label.trim(),prompt=r.prompt.trim();
 if(!label||label.length>40||/[\r\n]/.test(label)||!prompt||prompt.length>2000)return;
 if(['创建任务','处理这件事','Create a task','Create task','Take care of it'].includes(label))return;
 return {label,prompt};
}
export const ideaRecommendationInstruction='每条建议还须提供 recommendation：label 是一个具体下一步动作的短按钮名称（动词加对象，建议 6–16 字、最多 40 字，不用“创建任务”“处理这件事”），prompt 是点击后填入对话的完整用户请求（最多 2000 字），保留日期、对象、约束和预期产物；只根据已有建议概括，不添加新结论、权限、承诺或无依据的细节，不假装已执行。用户会编辑并发送后才执行。';
