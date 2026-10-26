/* Concise support pages are real product content, not design diagnostics. */
(() => {
 const D=window.OpsTwinsDesktop;
 D.renderSupport=ctx=>{if(!['help','legal','about','devices'].includes(ctx.setting))return false;const root=ctx.root,n=ctx.node,b=ctx.btn;root.replaceChildren();root.classList.add('ss-content');const section=(title,text)=>{const s=n('section','v17-settings-section');s.append(n('h2','',title));if(text)s.append(n('p','',text));root.append(s);return s};
 if(ctx.setting==='help'){root.append(n('h1','','使用帮助'));const links=n('div','v17-help-shortcuts');for(const[label,page]of [['处理收件箱','inbox'],['设置模型','settings/models'],['管理记忆','settings/identity']])links.append(b(label,()=>window.dispatchEvent(new CustomEvent('desktop-navigate',{detail:'/'+page}))));root.append(links);const faq=section('常见问题');for(const[q,a]of [['如何把原文带入对话？','选中消息或资料文字后点击“添加到对话”，也可以按 ⌘L，再写下问题一起发送。'],['如何处理收件箱？','查看原始消息，修改回复草稿，需要展开讨论时添加到对话；完成后标记完成，暂不关注时忽略。'],['如何管理会话和记忆？','在对话顶部展开会话并新建侧会话；“记忆”查看会话摘要、自动记忆和来源，长期文档在身份与记忆中编辑。'],['结果未确认怎么办？','保留原请求，先查看已有记录。部分完成时核对已执行的操作，避免重复执行。']]){const d=n('details','v17-faq');d.append(n('summary','',q),n('p','',a));faq.append(d)}}
 if(ctx.setting==='legal'){root.append(n('h1','','隐私与数据'));section('本机保存','工作区数据和未发送草稿保存在本机。连接凭据仅由服务端或原生 CLI 管理。');section('模型与引用','发送问题时，当前会话与所选引用提交到配置的模型。引用资料不扩大执行授权。');section('文件与外部操作','知识文件夹路径配置不代表已读取或索引文件。外部操作遵循连接权限、审批和自主权限。')}
 if(ctx.setting==='devices'){root.append(n('h1','','设备'));section('此设备',D.native?'此 Mac':'浏览器工作区');section('数据与同步').append(n('p','','本机工作区'),n('p','','跨设备同步未启用'))}
 if(ctx.setting==='about'){root.append(n('h1','',D.translate('关于 OpsTwins')));section('OpsTwins','macOS').append(...(window.OPSTWINS_APP_VERSION?[n('p','',D.translate('版本')+' '+window.OPSTWINS_APP_VERSION)]:[]));}
 return true;
 };
})();
