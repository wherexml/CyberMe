# 生成协议

按上面的编辑流程完成后，只输出一个 JSON 对象，不要代码块以外的文字：
{"version":"{{VERSION}}","relation":"<关系>","blocks":[<块>，通常 1 个，必要时 2 个，最多 3 个],"omitted":["可选：来源要求但未画出的内容，每项≤30字，最多3项"]}

relation 必须是以下之一：comparison mapping before-after annotated-document boundary dependencies gated-sequence artifacts claims alternatives schedule stances quote values
第一个块必须承载这个关系：comparison→compare；mapping→mapping；before-after→beforeAfter；annotated-document→document 或 matrix；boundary→boundary；dependencies→dependencies；gated-sequence→sequence；artifacts→artifacts；claims→claims；alternatives→alternatives；schedule→schedule；stances→stances；quote→quote；values→values。

Datum（每个显示值）={"text":"显示文字","status":"<状态>","qualifier":"可选限定词","who":"可选说话人（仅当资料明确绑定这段摘录时）","basis":[{"ref":"I|E0|E1…","quote":"该引用中逐字连续的片段"}]}
status 只能取以下值（含义见上文“状态的含义”）：fact（来源记录的陈述或状态）| quote（原话：text 必须逐字照抄 basis 中的原文，含否定词和限定词）| claim（转述或未核验说法）| estimate（估计或口头数字）| proposal（建议或计划；I 中编号建议部分只能是 proposal/pending/not-provided）| pending（明确待确认）| not-provided（来源没说）。
来源没有的信息写成 {"text":"来源未提供","status":"not-provided","basis":[]}（text 只能是 未提供/来源未提供/未说明/待提供/未记录，不带数字、who、qualifier），不要为空缺编造依据。
来源列出的列、栏、维度要全部画出，或写进 omitted。标签、名称、表头里不要写数字或日期，除非原样出现在来源中，且资料说明了它的角色。

每个块都必须有 "type"，取值和字段如下（括号内为长度上限或数量）：
- {"type":"values","items":[{"label"(12),"value":Datum(14字，数字/代码/短标识),"unit"?}](1-3),"focus":序号或null}
- {"type":"compare","subjects":[{"name"(12),"icon"?,"tone"?}](2-4),"dimensions":[{"name"(10),"cells":[Datum(24)，每个 subject 一个]}](1-6),"highlight":"differences"|"none"}
- {"type":"mapping","from":{"name"(12)},"to":{"name"(12)},"rows":[{"role"?(8),"source":Datum(24),"target":Datum(24),"match":"same"|"changed"|"gap"|"unknown"|"corresponds"}](1-6)}（same=两侧已知且文字相同；changed=确有变化或差异；gap=一侧缺失；unknown=不知道对应什么；corresponds=资料明确写出的中性对应关系，不表示差异）
- {"type":"beforeAfter","caption"(16，含“示意”),"before":{"label"(8),"marks":[{"kind":"heading"|"text"|"rule"|"block"|"field"|"input"|"chip","emphasis"?,"removed"?}](2-7),"note":Datum(24)},"after":同上,"later"?:[Datum]}（只用于版式变化；日期、数量、业务变化用 compare/values/schedule）
- {"type":"document","kind":"chat"|"minutes"|"task"|"file"|"contract","source"(16),"lines":[Datum(90，status 为 quote 或 fact，逐字照抄)](1-4),"marks"?:[{"target":"行内逐字片段","note"(24),"status"}](0-3)}
- {"type":"boundary","label"(12),"condition"?:Datum,"inside":[Datum(24)](1-4),"outside"?:[Datum(24)](0-3)}（真实范围或权限约束）
- {"type":"dependencies","nodes":[{"id":"小写字母数字≤6","label":Datum(20)}](2-7),"edges":[{"from":"前提id","to":"id","kind":"requires"|"feeds"}](1-8)}（每条边都要有资料中的明确前提关系）
- {"type":"sequence","steps":[{"label":Datum(24),"gate"?:Datum(30)}](2-5)}
- {"type":"artifacts","groups":[{"name"(12),"items":[Datum(24)](1-4)}](1-3)}
- {"type":"claims","items":[{"claim":Datum(40，status 只能 claim|estimate|quote),"missing"?:["≤10字"](0-3，写在条目上，不写进 Datum),"use"?:Datum}](1-3)}
- {"type":"alternatives","items":[{"label":Datum(16),"detail"?:Datum(30)}](2-3),"selection":null}
- {"type":"schedule","events":[{"at":Datum(16，按原文写的时间，或 pending/not-provided),"what":Datum(30，保留阶段与计划/已发生的区别)}](1-4)}
- {"type":"stances","actors":[{"name"(8),"quote":Datum(40，quote|claim),"lean":"positive"|"skeptical"|"neutral"|"unknown","leanBasis":[basis，lean 不是 unknown 时必填]}](2-4)}
- {"type":"quote","line":Datum(70，status=quote，逐字照抄)}
- {"type":"matrix","columns":["≤6字"](1-4),"rows":[{"label":Datum(20),"cells":[{"state":"confirmed"|"failed"|"pending"|"not-run"|"not-provided"|"proposed","basis":[写明该状态的依据；not-provided 可省略]}]}](1-6)}
- {"type":"note","line":Datum(40)}（最多一个）

icon 可选值：{{ICONS}}；tone 可选值：neutral blue teal purple amber。可见文字总计不超过 280 字。
不要在输出里写“已复核”“已核对”之类的自我认证字段；复核由另一次独立检查完成。

最小合法示例（虚构内容，只示意结构）：{"version":"{{VERSION}}","relation":"comparison","blocks":[{"type":"compare","subjects":[{"name":"公告"},{"name":"群消息"}],"highlight":"differences","dimensions":[{"name":"闭馆","cells":[{"text":"18点","status":"fact","basis":[{"ref":"E0","quote":"开到18点"}]},{"text":"16点","status":"claim","basis":[{"ref":"E1","quote":"说开到16点"}]}]}]}]}
