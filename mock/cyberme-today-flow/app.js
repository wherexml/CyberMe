(function () {
  'use strict';
  var D = window.CM_DATA;
  var KEY = 'cyberme-today-flow-v1';
  var STEPS = ['已创建', '读取 3 个来源', '比对负责人记录', '等你确认', '整理结果'];
  var DONE = 5;

  // ---------- 状态 ----------
  function fresh() {
    return {
      sourceChanged: false,
      c1Version: 2,
      c2Decision: null,
      messages: JSON.parse(JSON.stringify(D.initialMessages)),
      draft: '',
      ref: null,
      tasks: { t0: JSON.parse(JSON.stringify(D.seedTask)) },
      taskOrder: ['t0'],
      taskDrafts: {},
      openSources: {},
      highlight: [],
      seq: 10
    };
  }
  var state = load();
  state.pending = false;
  var mem = {}; // 当本地存储不可用时仍能演示
  function load() {
    try { var raw = localStorage.getItem(KEY); if (raw) return Object.assign(fresh(), JSON.parse(raw)); } catch (e) {}
    return fresh();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { mem.saved = false; }
  }
  function nid(p) { state.seq += 1; return p + state.seq; }

  // ---------- 工具 ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(id) { return document.getElementById(id); }
  function now() {
    var d = new Date(); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  function src(id) {
    var s = D.sources[id];
    if (id === 's2' && state.sourceChanged) return Object.assign({}, s, s.next);
    return s;
  }
  function listVersion() { return state.sourceChanged ? 'v5' : 'v4'; }

  // ---------- 决策卡 ----------
  function cards() {
    var c1;
    if (state.c1Version === 3) {
      c1 = { id: 'c1', v: 3, tag: '评审准备', tone: 'blue', status: 'pending',
        title: '清单已写周屿为回滚负责人，仍待本人确认',
        why: '清单 v5 第 7 项写了周屿，并标注「待本人确认」。评审在周一 10:00。',
        sources: ['s2', 's3', 's1'],
        boundary: '未找到周屿本人的确认记录。',
        primary: { act: 'create-task', label: '生成核对任务' } };
    } else {
      c1 = { id: 'c1', v: 2, tag: '评审准备', tone: 'blue',
        status: state.sourceChanged ? 'changed' : 'ok',
        title: '周一评审前，回滚负责人仍未确认',
        why: '评审会提前到周一 10:00，清单第 7 项仍为空。',
        sources: ['s3', 's2', 's1'],
        boundary: '只查了纪要、清单和项目群；线下约定无法看到。',
        primary: { act: 'create-task', label: '生成核对任务' } };
    }
    var c2 = { id: 'c2', v: 1, tag: '证据缺口', tone: 'amber',
      status: state.c2Decision ? 'ok' : 'pending',
      title: '性能基线有 2 个场景未找到结果',
      why: '报告中未找到「批量导入」「冷启动」的数据；这不代表测试没有做。',
      sources: ['s4'],
      boundary: '没有访问测试组的原始记录。',
      decision: state.c2Decision };
    var c3 = { id: 'c3', v: 1, tag: '今晚不决定', tone: 'quiet', status: 'ok',
      title: '发布说明文案可以周二再定',
      why: '评审议程不含文案；截图周二才提供。',
      sources: ['s5'], boundary: '' };
    return [c1, c2, c3];
  }
  function card(id) { return cards().filter(function (c) { return c.id === id; })[0]; }

  function refInfo(ref) {
    if (!ref) return null;
    if (ref.type === 'card') {
      var c = card(ref.id);
      var stale = !c || c.v !== ref.v || c.status === 'changed';
      return { label: ref.title, meta: '卡片 · v' + ref.v, stale: stale };
    }
    var t = state.tasks[ref.id];
    var st = t && taskStale(t);
    return { label: ref.title, meta: '任务结果 · 清单 ' + ref.basedOn, stale: !t || st || t.basedOn !== ref.basedOn };
  }

  // ---------- 任务 ----------
  function taskStale(t) { return t.basedOn === 'v4' && state.sourceChanged; }
  function taskStatus(t) {
    if (t.step >= DONE) return taskStale(t) ? { k: 'warn', label: '基于旧来源' } : { k: 'done', label: '已完成' };
    if (taskStale(t)) return { k: 'warn', label: '来源已变化' };
    if (t.step === 3) return { k: 'wait', label: '等你确认' };
    if (t.step === 0) return { k: 'idle', label: '未开始' };
    return { k: 'run', label: '进行中' };
  }
  var QUESTIONS = {
    v4: { q: '纪要和清单都没有具名负责人。结果里怎么写？',
      a: ['写为「未找到记录」', '写为「平台组负责，人选未定」'] },
    v5: { q: '清单 v5 写了周屿，但标注待本人确认。结果里怎么写？',
      a: ['写为「候选：周屿，待确认」', '暂不写人名'] }
  };
  function taskResult(t) {
    if (t.staticResult) return t.staticResult;
    if (t.basedOn === 'v5') {
      return {
        summary: t.confirmed === 1 ? '清单已暂定周屿，但还没有他本人的确认。'
          : '回滚负责人有暂定人选，尚待本人确认。',
        findings: [
          { text: '清单 v5 第 7 项：周屿（待本人确认）。', source: 's2' },
          { text: '纪要只写到「平台组负责」。', source: 's1' },
          { text: '项目群未出现确认消息。', source: 's3' }
        ],
        unknown: '周屿是否已同意：未找到记录。',
        next: '评审前请周屿本人确认，或由平台组负责人回复。'
      };
    }
    return {
      summary: t.confirmed === 1 ? '目前没有找到已确认的回滚负责人。'
        : '回滚预案归平台组，具体负责人尚未确定。',
      findings: [
        { text: '纪要（10-22）只写到「平台组负责」，没有具名。', source: 's1' },
        { text: '清单 v4 第 7 项为空。', source: 's2' },
        { text: '项目群提到评审改期，未提人选。', source: 's3' }
      ],
      unknown: '是否有线下口头约定：未找到记录。',
      next: '周一评审前请平台组负责人确认人选，再更新清单。'
    };
  }

  function createTask() {
    if (state.tasks.t1) { go('task/t1'); return; }
    var c = card('c1');
    var originMsg = null;
    for (var i = state.messages.length - 1; i >= 0; i--) {
      if (state.messages[i].role === 'user') { originMsg = state.messages[i].id; break; }
    }
    state.tasks.t1 = { id: 't1', title: '核对回滚负责人', created: now(),
      origin: { msg: originMsg, card: 'c1', v: c.v }, step: 0, basedOn: listVersion(),
      confirmed: null, posted: false, thread: [] };
    state.taskOrder.unshift('t1');
    pushMsg({ role: 'assistant', kind: 'task', taskId: 't1',
      text: '已创建任务「核对回滚负责人」。它只读取来源、整理结果，不会替你发消息。',
      actions: [{ act: 'go', arg: 'task/t1', label: '打开任务' }] });
    if (!originMsg) state.tasks.t1.origin.msg = state.messages[state.messages.length - 1].id;
    go('task/t1');
  }
  function advance(id) {
    var t = state.tasks[id];
    if (!t || t.step >= DONE || t.step === 3 || taskStale(t)) return;
    t.step += 1;
    if (t.step >= DONE) postResult(t);
    save(); render();
  }
  function confirmTask(id, choice) {
    var t = state.tasks[id];
    if (!t || t.step !== 3 || taskStale(t)) return;
    t.confirmed = choice; t.step = 4;
    save(); render();
  }
  function rerun(id) {
    var t = state.tasks[id];
    t.basedOn = listVersion(); t.step = 1; t.confirmed = null; t.posted = false;
    t.thread.push({ role: 'note', text: '已按清单 ' + t.basedOn + ' 重新开始核对。' });
    save(); render();
  }
  function postResult(t) {
    if (t.posted) return;
    t.posted = true;
    var r = taskResult(t);
    var m = pushMsg({ role: 'assistant', kind: 'result', taskId: t.id,
      text: '「' + t.title + '」有结果了：' + r.summary,
      meta: '基于清单 ' + t.basedOn,
      actions: [{ act: 'go', arg: 'task/' + t.id, label: '查看结果' }] });
    t.resultMsg = m.id;
  }
  function backToChat(id) {
    var t = state.tasks[id];
    state.highlight = [t.origin && t.origin.msg, t.resultMsg].filter(Boolean);
    if (t.step >= DONE) state.ref = { type: 'task', id: t.id, title: t.title, basedOn: t.basedOn };
    save(); render();
    var el = document.querySelector('[data-mid="' + (t.resultMsg || (t.origin && t.origin.msg)) + '"]');
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    $('draft').focus();
  }

  // ---------- 对话 ----------
  function pushMsg(m) { m.id = nid('m'); m.time = now(); state.messages.push(m); return m; }
  function reply(text, ref) {
    var info = refInfo(ref);
    if (ref && info.stale) {
      return { text: '这条引用依据的清单在 21:05 更新了，我先不按旧版本回答。可以在卡片上「按新版本更新」，或重新核对任务后再问。',
        actions: [{ act: 'go', arg: ref.type === 'card' ? 'card/' + ref.id : 'task/' + ref.id, label: '去更新' }] };
    }
    if (!ref) {
      if (/这个|这件|那个|它/.test(text)) {
        return { text: '现在有 3 张卡片，我不确定你指哪一张。可以在卡片上点「带入对话」，我会按它当前的证据回答。',
          actions: [{ act: 'go', arg: 'today', label: '看卡片' }] };
      }
      return { text: '收到，已记在这段对话里。需要针对某件事时，从卡片或任务带入会更准确。' };
    }
    if (ref.type === 'task') {
      var r = taskResult(state.tasks[ref.id]);
      return { text: '按这次核对（清单 ' + ref.basedOn + '）：' + r.summary + ' 建议下一步：' + r.next + ' 需要的话我可以起草给平台组的消息，由你确认后发送。' };
    }
    if (ref.id === 'c1') {
      var has = !!state.tasks.t1;
      var base = state.c1Version === 3
        ? '清单 v5 写了周屿，但标注待本人确认；纪要和项目群里都没有他同意的记录。'
        : '纪要写回滚归平台组，但没有具名；清单 v4 第 7 项是空的，项目群也没提人选。';
      return { text: base + ' 我可以建一个核对任务：比对这三处来源，整理结论和待确认项。不会代你发消息。',
        actions: [{ act: has ? 'go' : 'create-task', arg: has ? 'task/t1' : '', label: has ? '打开已有任务' : '创建核对任务' }] };
    }
    if (ref.id === 'c2') {
      return { text: '报告只覆盖 4/6 个场景，「批量导入」「冷启动」未找到结果。可能是没跑，也可能结果在别处；评审前是否补齐，需要你决定。',
        actions: [{ act: 'go', arg: 'card/c2', label: '去决定' }] };
    }
    return { text: '文案不在周一议程里，周二拿到截图后再定也不影响评审。' };
  }
  function send() {
    var text = $('draft').value.trim();
    if (!text) return;
    var ref = state.ref;
    var info = refInfo(ref);
    pushMsg({ role: 'user', text: text, ref: ref ? { label: info.label, meta: info.meta } : null });
    var r = reply(text, ref);
    state.draft = ''; state.ref = null; state.highlight = [];
    state.pending = true;
    save(); render();
    setTimeout(function () {
      state.pending = false;
      pushMsg({ role: 'assistant', text: r.text, actions: r.actions });
      save(); render();
    }, 650);
  }

  // ---------- 渲染 ----------
  function actionBtns(actions, cls) {
    return (actions || []).map(function (a) {
      return '<button type="button" class="' + (cls || 'link') + '" data-act="' + esc(a.act) + '" data-arg="' + esc(a.arg || '') + '">' + esc(a.label) + '</button>';
    }).join('');
  }
  function renderMessages() {
    var html = state.messages.map(function (m) {
      if (m.role === 'divider') return '<div class="divider">' + esc(m.text) + '</div>';
      var hl = state.highlight.indexOf(m.id) >= 0 ? ' hl' : '';
      if (m.role === 'user') {
        return '<div class="msg user' + hl + '" data-mid="' + m.id + '">' +
          (m.ref ? '<div class="msg-ref">↳ ' + esc(m.ref.label) + ' <span>' + esc(m.ref.meta) + '</span></div>' : '') +
          '<div class="bubble">' + esc(m.text) + '</div></div>';
      }
      var extra = '';
      if (m.kind === 'result') {
        var t = state.tasks[m.taskId];
        var stale = t && (t.basedOn !== m.meta.slice(-2) || taskStale(t));
        extra = '<div class="msg-meta">' + esc(m.meta) + (stale ? ' · <span class="warn-text">已过期</span>' : '') + '</div>';
      }
      return '<div class="msg ai' + hl + (m.kind ? ' ' + m.kind : '') + '" data-mid="' + m.id + '">' +
        '<div class="text">' + esc(m.text) + '</div>' + extra +
        (m.actions ? '<div class="msg-actions">' + actionBtns(m.actions) + '</div>' : '') + '</div>';
    }).join('');
    if (state.pending) html += '<div class="msg ai typing"><span></span><span></span><span></span></div>';
    var box = $('messages');
    var atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    box.innerHTML = html;
    if (atBottom || state.pending || !state.highlight.length) box.scrollTop = box.scrollHeight;
  }
  function renderRef() {
    var info = refInfo(state.ref);
    $('ref-slot').innerHTML = info
      ? '<div class="ref-chip' + (info.stale ? ' stale' : '') + '"><span class="ref-arrow">↳</span>' +
        '<span class="ref-label">' + esc(info.label) + '</span><span class="ref-meta">' + esc(info.meta) +
        (info.stale ? ' · 来源已变化' : '') + '</span>' +
        '<button type="button" class="ref-x" data-act="clear-ref" aria-label="移除引用">×</button></div>'
      : '';
    var d = $('draft');
    if (d.value !== state.draft) d.value = state.draft;
    $('send').disabled = !state.draft.trim() || !!state.pending;
  }

  function statusLine(c) {
    if (c.status === 'changed') {
      return '<p class="notice warn"><i></i>清单在 21:05 更新，这条判断需按新版本核对。' +
        '<button type="button" class="link" data-act="c1-update">按新版本更新</button></p>';
    }
    if (c.status === 'pending' && c.id === 'c1') return '<p class="notice wait"><i></i>待本人确认</p>';
    if (c.status === 'pending') return '<p class="notice wait"><i></i>待你决定是否评审前补齐</p>';
    if (c.decision) return '<p class="notice ok"><i></i>已决定：' + esc(c.decision) + '</p>';
    return '';
  }
  function cardActions(c, detail) {
    if (c.id === 'c3') return '<button type="button" class="link" data-act="ref-card" data-arg="c3">带入对话</button>';
    var out = '';
    if (c.id === 'c2' && !c.decision) {
      out += '<button type="button" class="btn primary" data-act="c2" data-arg="评审前补齐">评审前补齐</button>' +
        '<button type="button" class="btn" data-act="c2" data-arg="评审时说明缺口">评审时说明</button>';
    } else if (c.primary && c.status !== 'changed') {
      var exists = c.id === 'c1' && state.tasks.t1;
      out += '<button type="button" class="btn primary" data-act="' + (exists ? 'go' : c.primary.act) + '" data-arg="' + (exists ? 'task/t1' : '') + '">' + (exists ? '打开任务' : esc(c.primary.label)) + '</button>';
    }
    if (c.status !== 'changed') out += '<button type="button" class="link" data-act="ref-card" data-arg="' + c.id + '">带入对话</button>';
    if (!detail) out += '<a class="link quiet" href="#card/' + c.id + '">来源 ' + c.sources.length + '</a>';
    return out;
  }
  function viewToday() {
    var cs = cards();
    var main = cs.filter(function (c) { return c.tone !== 'quiet'; });
    var later = cs.filter(function (c) { return c.tone === 'quiet'; });
    function cardHtml(c) {
      return '<article class="card ' + c.tone + (c.status === 'changed' ? ' is-changed' : '') + '">' +
        '<div class="tag">' + esc(c.tag) + '</div>' +
        '<h3><a href="#card/' + c.id + '">' + esc(c.title) + '</a></h3>' +
        '<p class="why">' + esc(c.why) + '</p>' + statusLine(c) +
        '<div class="actions">' + cardActions(c) + '</div></article>';
    }
    return '<div class="today"><header class="view-head"><h2>今晚</h2><p>周六 10 月 24 日 · 更新于 21:40</p></header>' +
      main.map(cardHtml).join('') +
      '<div class="section-label">可以先放下</div>' + later.map(cardHtml).join('') + '</div>';
  }
  function viewCard(id) {
    var c = card(id);
    if (!c) return viewToday();
    var rows = c.sources.map(function (sid) {
      var s = src(sid), open = state.openSources[id + sid];
      var changed = sid === 's2' && state.sourceChanged;
      return '<li class="src' + (open ? ' open' : '') + '">' +
        '<button type="button" class="src-row" data-act="toggle-src" data-arg="' + id + sid + '" aria-expanded="' + !!open + '">' +
        '<span class="src-kind">' + esc(s.kind) + '</span><span class="src-title">' + esc(s.title) +
        (changed ? ' <em class="new">已更新</em>' : '') + '</span><span class="src-time">' + esc(s.time) + '</span></button>' +
        (open ? '<blockquote>' + esc(s.excerpt) + '</blockquote>' : '') + '</li>';
    }).join('');
    return '<div class="detail"><a class="back" href="#today">← 今天</a>' +
      '<div class="tag ' + c.tone + '">' + esc(c.tag) + ' · v' + c.v + '</div>' +
      '<h2>' + esc(c.title) + '</h2><p class="why lg">' + esc(c.why) + '</p>' + statusLine(c) +
      '<div class="section-label">依据</div><ul class="srcs">' + rows + '</ul>' +
      (c.boundary ? '<p class="boundary">未覆盖：' + esc(c.boundary) + '</p>' : '') +
      '<div class="actions">' + cardActions(c, true) + '</div></div>';
  }
  function viewTasks() {
    var rows = state.taskOrder.map(function (id) {
      var t = state.tasks[id], s = taskStatus(t);
      return '<a class="task-row" href="#task/' + id + '"><span class="dot ' + s.k + '"></span>' +
        '<span class="task-title">' + esc(t.title) + '</span><span class="pill ' + s.k + '">' + s.label + '</span>' +
        '<span class="task-time">' + esc(t.created) + '</span></a>';
    }).join('');
    return '<div class="tasks"><header class="view-head"><h2>任务</h2><p>从对话和卡片建立的专项工作</p></header>' +
      '<div class="task-list">' + rows + '</div></div>';
  }
  function viewTask(id) {
    var t = state.tasks[id];
    if (!t) return viewTasks();
    var s = taskStatus(t), stale = taskStale(t);
    var steps = STEPS.map(function (label, i) {
      var cls = i < t.step ? 'done' : i === t.step && t.step < DONE ? 'now' : '';
      if (i === 3 && t.step === 3) cls = 'now wait';
      return '<li class="' + cls + '">' + esc(label) + '</li>';
    }).join('');
    var body = '';
    if (stale) {
      body += '<p class="notice warn"><i></i>清单已更新到 v5，这次核对基于 v4' + (t.step >= DONE ? '，结果可能已过期。' : '，暂停推进。') +
        '<button type="button" class="link" data-act="rerun" data-arg="' + id + '">按新版本重新核对</button></p>';
    }
    if (t.step === 3 && !stale) {
      var q = QUESTIONS[t.basedOn];
      body += '<div class="ask"><div class="ask-q">' + esc(q.q) + '</div><div class="actions">' +
        '<button type="button" class="btn primary" data-act="confirm" data-arg="' + id + '|1">' + esc(q.a[0]) + '</button>' +
        '<button type="button" class="btn" data-act="confirm" data-arg="' + id + '|2">' + esc(q.a[1]) + '</button>' +
        '<span class="hint">不选择时任务保持等待</span></div></div>';
    }
    if (t.step >= DONE) {
      var r = taskResult(t);
      body += '<div class="result' + (stale ? ' faded' : '') + '"><div class="section-label">结果' + (t.basedOn ? ' · 基于清单 ' + t.basedOn : '') + '</div>' +
        '<p class="result-sum">' + esc(r.summary) + '</p><ul class="findings">' +
        r.findings.map(function (f) {
          return '<li>' + esc(f.text) + ' <a class="cite" href="#card/' + ({ s4: 'c2', s5: 'c3' }[f.source] || 'c1') + '" title="' + esc(src(f.source).title) + '">' + esc(src(f.source).kind) + '</a></li>';
        }).join('') + '</ul>' +
        '<p class="boundary">未确认：' + esc(r.unknown) + '</p>' +
        (r.next ? '<p class="next">下一步：' + esc(r.next) + '</p>' : '') + '</div>';
    } else if (t.step < 3 || t.step === 4) {
      body += '<p class="quiet-line">' + (t.step === 0 ? '尚未开始。' : '正在' + STEPS[t.step] + '…') + '</p>';
    }
    var thread = t.thread.map(function (m) {
      return '<div class="t-msg ' + m.role + '">' + esc(m.text) + '</div>';
    }).join('');
    var canAdvance = t.step < DONE && t.step !== 3 && !stale && !t.staticResult;
    return '<div class="task-detail"><a class="back" href="#tasks">← 任务</a>' +
      '<div class="task-top"><h2>' + esc(t.title) + '</h2><span class="pill ' + s.k + '">' + s.label + '</span></div>' +
      '<p class="task-origin">' + (t.origin ? '来自主对话 · 卡片「回滚负责人」v' + t.origin.v + ' · ' + esc(t.created) : '创建于 ' + esc(t.created)) +
      (t.origin ? ' <button type="button" class="link" data-act="back-chat" data-arg="' + id + '">回到对话</button>' : '') + '</p>' +
      '<ol class="steps">' + steps + '</ol>' + body + thread +
      (t.staticResult ? '' : '<div class="demo-bar"><span>演示控制</span><button type="button" class="btn small" data-act="advance" data-arg="' + id + '"' + (canAdvance ? '' : ' disabled') + '>推进一步</button></div>') +
      '<form class="t-composer" data-task="' + id + '"><textarea rows="1" data-task-draft="' + id + '" placeholder="在这个任务里补充要求" aria-label="任务输入">' +
      esc(state.taskDrafts[id] || '') + '</textarea><button type="submit" class="send" aria-label="发送">↑</button></form></div>';
  }
  function viewMemory() {
    var m = D.memory;
    return '<div class="memory"><header class="view-head"><h2>我对你的了解</h2><p>更新于 ' + esc(m.updated) + '</p></header>' +
      '<p class="mem-sum">' + esc(m.summary) + '</p><ul class="mem-list">' +
      m.items.map(function (i) {
        return '<li><span class="mem-kind">' + esc(i.kind) + '</span><span class="mem-text">' + esc(i.text) + '</span><span class="mem-src">' + esc(i.source) + '</span></li>';
      }).join('') + '</ul></div>';
  }

  function route() { return (location.hash || '#today').slice(1); }
  function go(r) { if (route() === r) render(); else location.hash = r; }
  function render() {
    var r = route(), parts = r.split('/');
    var tab = parts[0] === 'card' ? 'today' : parts[0] === 'task' ? 'tasks' : parts[0];
    if (['today', 'tasks', 'memory'].indexOf(tab) < 0) { tab = 'today'; parts = ['today']; }
    Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (a) {
      if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    var html = parts[0] === 'card' ? viewCard(parts[1]) : parts[0] === 'task' ? viewTask(parts[1])
      : tab === 'tasks' ? viewTasks() : tab === 'memory' ? viewMemory() : viewToday();
    var view = $('view');
    var keepScroll = view.dataset.route === r ? view.scrollTop : 0;
    var focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.taskDraft : null;
    view.innerHTML = html; view.dataset.route = r; view.scrollTop = keepScroll;
    if (focused) { var ta = view.querySelector('[data-task-draft="' + focused + '"]'); if (ta) { ta.focus(); ta.selectionStart = ta.value.length; } }
    $('demo-source-change').checked = state.sourceChanged;
    renderMessages(); renderRef();
  }

  // ---------- 事件 ----------
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    var a = b.dataset.act, arg = b.dataset.arg;
    if (a === 'go') go(arg);
    else if (a === 'create-task') createTask();
    else if (a === 'ref-card') {
      var c = card(arg);
      state.ref = { type: 'card', id: c.id, v: c.v, title: c.title };
      save(); render(); $('draft').focus();
    } else if (a === 'clear-ref') { state.ref = null; save(); render(); $('draft').focus(); }
    else if (a === 'toggle-src') { state.openSources[arg] = !state.openSources[arg]; save(); render(); }
    else if (a === 'c1-update') { state.c1Version = 3; save(); render(); }
    else if (a === 'c2') { state.c2Decision = arg; save(); render(); }
    else if (a === 'advance') advance(arg);
    else if (a === 'confirm') { var p = arg.split('|'); confirmTask(p[0], +p[1]); }
    else if (a === 'rerun') rerun(arg);
    else if (a === 'back-chat') backToChat(arg);
  });
  $('draft').addEventListener('input', function (e) {
    state.draft = e.target.value; save(); $('send').disabled = !state.draft.trim() || !!state.pending;
  });
  $('draft').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  $('composer').addEventListener('submit', function (e) { e.preventDefault(); send(); });
  document.addEventListener('input', function (e) {
    var id = e.target.dataset && e.target.dataset.taskDraft;
    if (id) { state.taskDrafts[id] = e.target.value; save(); }
  });
  document.addEventListener('submit', function (e) {
    var f = e.target.closest('.t-composer');
    if (!f) return;
    e.preventDefault();
    var id = f.dataset.task, text = (state.taskDrafts[id] || '').trim();
    if (!text) return;
    var t = state.tasks[id];
    t.thread.push({ role: 'user', text: text });
    t.thread.push({ role: 'ai', text: t.step >= DONE ? '已记下，会作为补充附在结果后；需要重新核对时再纳入。' : '已记下，会在接下来的步骤里一并考虑。' });
    state.taskDrafts[id] = '';
    save(); render();
  });
  $('demo-source-change').addEventListener('change', function (e) {
    state.sourceChanged = e.target.checked;
    if (!state.sourceChanged && state.c1Version === 3) state.c1Version = 2;
    save(); render();
  });
  $('demo-reset').addEventListener('click', function () {
    if (!confirm('恢复初始演示数据？草稿和任务进度会清除。')) return;
    state = fresh(); save(); location.hash = 'today'; render();
  });
  window.addEventListener('hashchange', function () { state.highlight = []; render(); });

  // ---------- 缩放 ----------
  function fit() {
    var s = Math.min(1, (window.innerWidth - 32) / 1000, (window.innerHeight - 36 - 32) / 700);
    $('window').style.transform = 'scale(' + Math.max(s, 0.3) + ')';
  }
  window.addEventListener('resize', fit);
  fit();
  render();
})();
