// Content labels are presentation metadata, never action types or authorization.
export function categoryLabel(value:unknown):string|undefined {
 if(typeof value!=='string')return;
 const text=value.normalize('NFKC').trim().replace(/\s+/g,' ');
 if(text.length<2||text.length>24||!/[\p{L}]/u.test(text)||!/^[\p{L}\p{N} &·-]+$/u.test(text))return;
 if(/^(规律|例行|灵感|洞察|其他|综合|未分类|待分类|专注|人脉|建议|pattern|routine|insight|idea|other|general|uncategorized|productivity|automation|communication)$/i.test(text))return;
 return text;
}
export const ideaCategoryInstruction='为每条建议生成 categoryLabel 内容分类：通常 2–6 个中文字，英文最多 24 字符，简短名词短语，概括可容纳多条建议的主题领域，而不是这条建议的具体步骤。根据实际内容自由命名，不从固定四类中选择；不要使用规律、例行、洞察、其他等空泛标签，不用人名、项目名或一句话标题当分类。优先复用已有主题；同一领域的不同步骤、人物、项目必须合并，只有跨领域的新主题才新增。例如设计修改可归设计反馈，交付验收可归项目验收；示例不是限定列表。分类与优先级、状态、执行动作无关。';
