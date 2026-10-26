/* 合成演示数据：虚构项目「Atlas 3.2 发布评审」，人物与内容均为示例。 */
window.CM_DATA = {
  sources: {
    s1: { kind: '会议纪要', title: 'Atlas 3.2 评审预备会纪要', time: '10-22 16:40',
      excerpt: '回滚预案由平台组负责，具体负责人待定，周五前确认。' },
    s2: { kind: '清单', title: '发布检查清单 v4', time: '10-24 09:12',
      excerpt: '第 7 项「回滚负责人」：空。',
      next: { title: '发布检查清单 v5', time: '10-24 21:05',
        excerpt: '第 7 项「回滚负责人」：周屿（待本人确认）。' } },
    s3: { kind: '群消息', title: '林岚 · Atlas 项目群', time: '10-24 11:30',
      excerpt: '评审会改到周一 10:00，回滚预案需要过一遍。' },
    s4: { kind: '文档', title: '性能基线报告', time: '10-21 18:02',
      excerpt: '已覆盖 4/6 个场景；「批量导入」「冷启动」未见结果。' },
    s5: { kind: '日历', title: 'Atlas 3.2 发布评审', time: '10-27 10:00',
      excerpt: '议程：范围确认、回滚预案、性能基线。' }
  },

  memory: {
    summary: '你在负责 Atlas 3.2 的发布评审。偏好结论先行、只在需要你决定时打扰；对外消息由你本人发送。',
    updated: '10-24 21:40',
    items: [
      { kind: '你明确说过', text: '不要替我在项目群发消息。', source: '主对话 · 10-18' },
      { kind: '我学到的', text: '评审前一晚你会集中看一次材料。', source: '近三次评审的打开时间' },
      { kind: '项目背景', text: '回滚预案归平台组；性能基线由测试组维护。', source: '评审预备会纪要' }
    ]
  },

  initialMessages: [
    { id: 'm0', role: 'divider', text: '今天 21:40' },
    { id: 'm1', role: 'assistant',
      text: '晚上好。评审会提前到周一上午，我把需要你看的整理成 3 张卡片，其中 1 件今晚可以先放下。',
      actions: [{ act: 'go', arg: 'today', label: '打开今天' }] }
  ],

  seedTask: {
    id: 't0', title: '整理评审议程草稿', created: '10-23 20:15', origin: null,
    step: 5, basedOn: null, confirmed: 'n/a', posted: true, thread: [],
    staticResult: {
      summary: '议程草稿已整理为三段：范围确认、回滚预案、性能基线。',
      findings: [{ text: '议程与日历邀请一致。', source: 's5' }],
      unknown: '各议题时长：未找到约定。'
    }
  }
};
