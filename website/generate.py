"""Render the public CyberMe landing pages from one template."""
from html import escape
from pathlib import Path
from string import Template
import shutil

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
PAGES = {
    "zh-Hans": {
        "file": "index.html", "title": "CyberMe · 你的个人 AI 助手",
        "description": "CyberMe 是 macOS 上的个人 AI 助手。在同一个工作台查看洞察、跟进任务、整理记忆。",
        "headline": ["你的个人", "AI 助手。"], "lede": "看见消息里的重点，在对话里把事情往前推进。",
        "nav": ["功能", "隐私", "常见问题"], "menu": "菜单", "language": "语言", "skip": "跳到正文",
        "preview": "查看产品", "access": "私有测试", "example": "产品预览", "today": "今天",
        "sections": ["对话", "洞察", "任务", "记忆"], "settings": "设置", "overview": "工作台",
        "prompt": "帮我整理一下今天要跟进的事。",
        "reply": "今天有两件事值得跟进：先确认发布稿的评审时间，再把设计反馈汇总到项目记录。",
        "composer": "问 CyberMe",
        "features": [
            ["把事情交给对话。", "提问、整理信息，或直接交办一件事。"],
            ["从消息中看见重点。", "把需要决定的事与值得了解的信息放在眼前。"],
            ["继续跟进手上的事。", "看到接下来要做什么，也能回看进展。"],
            ["把上下文留在记忆里。", "保存偏好和项目资料，下次接着聊。"],
        ],
        "rows": [
            [["发布计划", "周五前确认评审时间"], ["设计反馈", "已整理三条修改建议"], ["下周安排", "准备周会提纲"]],
            [["发布稿等待评审", "需要确认周五的评审时间"], ["设计反馈已汇总", "三个问题可在下一轮一起处理"], ["周会有新议题", "下周优先讨论发布准备"]],
            [["确认评审时间", "今天"], ["汇总设计反馈", "进行中"], ["准备周会提纲", "本周"]],
            [["写作偏好", "结论在前，保留原始出处"], ["发布资料", "评审、发布与回顾"], ["项目笔记", "产品方向与已确认事项"]],
        ],
        "privacy_title": "隐私与数据",
        "privacy": [["连接由你决定", "按需授权飞书或 Gmail 等连接，可在设置中撤销。"], ["本机保存工作区", "工作区保存在你的 Mac 上。调用在线模型时，相关内容由所选模型服务处理。"]],
        "faq": [["在哪个平台上使用？", "CyberMe 是一款 macOS 桌面应用。"], ["可以公开下载吗？", "目前仅向私有测试用户分发。"], ["必须连接其他应用吗？", "不用。可直接开始对话，需要时再配置连接。"]],
        "access_title": "CyberMe for Mac", "access_note": "目前仅向私有测试用户分发。", "top": "返回顶部",
    },
    "zh-Hant": {
        "file": "zh-hant.html", "title": "CyberMe · 你的個人 AI 助手",
        "description": "CyberMe 是 macOS 上的個人 AI 助手。在同一個工作台查看洞察、追蹤任務、整理記憶。",
        "headline": ["你的個人", "AI 助手。"], "lede": "看見訊息裡的重點，在對話裡把事情往前推進。",
        "nav": ["功能", "隱私", "常見問題"], "menu": "選單", "language": "語言", "skip": "跳到正文",
        "preview": "查看產品", "access": "私人測試", "example": "產品預覽", "today": "今天",
        "sections": ["對話", "洞察", "任務", "記憶"], "settings": "設定", "overview": "工作台",
        "prompt": "幫我整理一下今天要追蹤的事。",
        "reply": "今天有兩件事值得追蹤：先確認發布稿的審閱時間，再把設計意見彙整到專案記錄。",
        "composer": "問 CyberMe",
        "features": [
            ["把事情交給對話。", "提問、整理資訊，或直接交辦一件事。"],
            ["從訊息中看見重點。", "把需要決定的事與值得了解的資訊放在眼前。"],
            ["繼續追蹤手上的事。", "看到接下來要做什麼，也能回顧進度。"],
            ["把脈絡留在記憶裡。", "儲存偏好和專案資料，下次接著聊。"],
        ],
        "rows": [
            [["發布計畫", "週五前確認審閱時間"], ["設計意見", "已整理三項修改建議"], ["下週安排", "準備週會大綱"]],
            [["發布稿等待審閱", "需要確認週五的審閱時間"], ["設計意見已彙整", "三個問題可在下一輪一起處理"], ["週會有新議題", "下週優先討論發布準備"]],
            [["確認審閱時間", "今天"], ["彙整設計意見", "進行中"], ["準備週會大綱", "本週"]],
            [["寫作偏好", "結論在前，保留原始出處"], ["發布資料", "審閱、發布與回顧"], ["專案筆記", "產品方向與已確認事項"]],
        ],
        "privacy_title": "隱私與資料",
        "privacy": [["連線由你決定", "依需要授權飛書或 Gmail 等連線，可在設定中撤銷。"], ["工作區存在本機", "工作區保存在你的 Mac 上。呼叫線上模型時，相關內容由所選模型服務處理。"]],
        "faq": [["可以在哪個平台使用？", "CyberMe 是一款 macOS 桌面應用程式。"], ["可以公開下載嗎？", "目前僅向私人測試使用者發放。"], ["必須連線其他應用程式嗎？", "不用。可直接開始對話，需要時再設定連線。"]],
        "access_title": "CyberMe for Mac", "access_note": "目前僅向私人測試使用者發放。", "top": "返回頂部",
    },
    "en": {
        "file": "en.html", "title": "CyberMe · Your personal AI assistant",
        "description": "CyberMe is your personal AI assistant for macOS. Chat, review insights, follow up on tasks, and keep useful context in memory.",
        "headline": ["Your personal", "AI assistant."], "lede": "Find what matters in your messages and move work forward in conversation.",
        "nav": ["Features", "Privacy", "FAQ"], "menu": "Menu", "language": "Language", "skip": "Skip to content",
        "preview": "Explore CyberMe", "access": "Private beta", "example": "Product preview", "today": "Today",
        "sections": ["Chat", "Insights", "Tasks", "Memory"], "settings": "Settings", "overview": "Workspace",
        "prompt": "What should I follow up on today?",
        "reply": "Two things need your attention: confirm the release review time, then add the design feedback to the project notes.",
        "composer": "Ask CyberMe",
        "features": [
            ["Start with a conversation.", "Ask a question, organize information, or hand off a task."],
            ["See what needs attention.", "Spot decisions you need to make and updates worth reading."],
            ["Follow through on tasks.", "See what comes next and check where things stand."],
            ["Keep useful context.", "Save preferences and project notes so you can pick up where you left off."],
        ],
        "rows": [
            [["Release plan", "Confirm the review time by Friday"], ["Design feedback", "Three changes to review"], ["Next week", "Prepare the team meeting outline"]],
            [["Release copy is ready to review", "Confirm the time for Friday"], ["Design feedback is ready", "Three items for the next review"], ["New team meeting topic", "Discuss release readiness next week"]],
            [["Confirm review time", "Today"], ["Summarize design feedback", "In progress"], ["Draft team meeting outline", "This week"]],
            [["Writing preferences", "Lead with the answer and keep sources"], ["Release notes", "Review, launch, and retrospective"], ["Project notes", "Product direction and decisions"]],
        ],
        "privacy_title": "Privacy and data",
        "privacy": [["Choose what you connect", "Authorize services like Feishu or Gmail when you need them. Revoke access in Settings."], ["Your workspace stays on your Mac", "When you use an online model, its provider processes the relevant content."]],
        "faq": [["Which platform does CyberMe support?", "CyberMe is a desktop app for macOS."], ["Can I download it publicly?", "CyberMe is currently distributed through a private beta."], ["Do I need to connect other apps?", "No. You can start chatting and set up connections as needed."]],
        "access_title": "CyberMe for Mac", "access_note": "Currently available through a private beta.", "top": "Back to top",
    },
}

ICONS = {
    "chat": '<path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l1.5-3.1A7.5 7.5 0 1 1 20 11.5Z"/>',
    "insights": '<path d="M12 2.8 14.4 9.6 21.2 12l-6.8 2.4-2.4 6.8-2.4-6.8L2.8 12l6.8-2.4z"/>',
    "tasks": '<rect x="4.5" y="4.5" width="15" height="15" rx="4"/><path d="m8.5 12 2.4 2.4 4.7-4.7"/>',
    "memory": '<path d="M12 6a6 6 0 0 0-7-1.5v13A6 6 0 0 1 12 19a6 6 0 0 1 7-1.5v-13A6 6 0 0 0 12 6zm0 0v13"/>',
    "settings": '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3m0 13v3m9.5-9.5h-3m-13 0h-3m16.2-6.7-2.1 2.1m-9.2 9.2-2.1 2.1m13.4 0-2.1-2.1m-9.2-9.2-2.1-2.1"/>',
    "lock": '<rect x="5" y="10" width="14" height="10" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v2"/>',
    "mac": '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
    "arrow": '<path d="M12 5v14m-5-5 5 5 5-5"/>',
    "send": '<path d="M12 19V5m-5 5 5-5 5 5"/>',
}
KINDS = ("chat", "insights", "tasks", "memory")


def icon(kind):
    return f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICONS[kind]}</svg>'


def rows(values, kind):
    return "".join(
        f'<li><span class="row-icon">{icon(kind)}</span><div><strong>{escape(name)}</strong><span>{escape(note)}</span></div></li>'
        for name, note in values
    )


def chat(copy):
    return f'''<div class="app-chat">
      <div class="app-chat-head"><img src="/assets/logo.svg" alt="" width="25" height="25"><strong>CyberMe</strong></div>
      <div class="thread"><span class="app-today">{escape(copy["today"])}</span><p class="bubble">{escape(copy["prompt"])}</p><p class="answer">{escape(copy["reply"])}</p></div>
      <div class="composer">{escape(copy["composer"])}<span>{icon("send")}</span></div>
    </div>'''


def window(copy):
    sections = [escape(label) for label in copy["sections"]]
    side = 1
    tabs = "".join(f'<span class="app-tab{" current" if i == side else ""}">{icon(KINDS[i])}{sections[i]}</span>' for i in range(1, 4))
    tabs += f'<span class="app-tab">{icon("settings")}{escape(copy["settings"])}</span>'
    return f'''<div class="app-window overview">
      <div class="app-top"><span class="traffic" aria-hidden="true"><i></i><i></i><i></i></span><span>{escape(copy["overview"])}</span><span class="example">{escape(copy["example"])}</span></div>
      <div class="app-main">
        {chat(copy)}
        <div class="app-side">
          <div class="app-tabs">{tabs}</div>
          <ul class="demo-rows">{rows(copy["rows"][side], KINDS[side])}</ul>
        </div>
      </div>
    </div>'''


def render(language, source):
    copy = PAGES[language]
    parts = {k: escape(v) for k, v in copy.items() if isinstance(v, str)}
    locale_labels = {"en": ("EN", "English"), "zh-Hans": ("简", "简体中文"), "zh-Hant": ("繁", "繁體中文")}
    path_for = {"zh-Hans": "/", "zh-Hant": "/zh-hant", "en": "/en"}
    current = ' aria-current="page"'
    parts.update(
        lang=language, nav_features=escape(copy["nav"][0]), faq_title=escape(copy["nav"][2]),
        links="".join(f'<a href="#{id}">{escape(label)}</a>' for id, label in zip(("features", "privacy", "faq"), copy["nav"])),
        locales="".join(f'<a href="{path_for[lang]}" lang="{lang}" hreflang="{lang}" aria-label="{label}"{current if lang == language else ""}>{short}</a>' for lang, (short, label) in locale_labels.items()),
        alternates="\n".join(f'<link rel="alternate" hreflang="{lang}" href="{path}">' for lang, path in [*path_for.items(), ("x-default", "/")]),
        headline1=escape(copy["headline"][0]), headline2=escape(copy["headline"][1]),
        preview_window=window(copy),
        features="".join(
            f'<article class="feature-panel"><div class="feature-copy"><h2>{escape(title)}</h2><p>{escape(note)}</p></div>'
            + (f'<div class="scene scene-chat">{chat(copy)}</div>' if i == 0 else f'<div class="scene scene-{KINDS[i]}"><div class="scene-card"><span class="scene-mark">{icon(KINDS[i])}</span><h3>{escape(copy["sections"][i])}</h3><ul class="demo-rows">{rows(copy["rows"][i], KINDS[i])}</ul></div></div>')
            + '</article>'
            for i, (title, note) in enumerate(copy["features"])
        ),
        privacy_cards="".join(f'<article>{icon(kind)}<h3>{escape(title)}</h3><p>{escape(note)}</p></article>' for kind, (title, note) in zip(("lock", "mac"), copy["privacy"])),
        questions="".join(f'<details><summary>{escape(question)}</summary><p>{escape(answer)}</p></details>' for question, answer in copy["faq"]),
        down=icon("arrow"),
    )
    return source.substitute(parts)


def main():
    source = Template((ROOT / "page.html").read_text(encoding="utf-8"))
    (PUBLIC / "assets").mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT.parent / "native/mygo/brand/cyberme.svg", PUBLIC / "assets/logo.svg")
    for language, copy in PAGES.items():
        (PUBLIC / copy["file"]).write_text(render(language, source), encoding="utf-8")


if __name__ == "__main__":
    main()
