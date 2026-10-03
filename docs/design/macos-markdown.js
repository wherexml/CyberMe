(() => {
  const ALLOWED = new Set([
    'P', 'BR', 'STRONG', 'EM', 'DEL', 'S', 'CODE', 'PRE', 'BLOCKQUOTE',
    'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR',
    'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'A',
  ]);
  const REMOVE = 'script,iframe,object,embed,style,link,form,input,button,svg,math,img';
  const HREF_OK = /^(https?:\/\/|mailto:)/i;

  function wrap(el, className) {
    const wrapEl = el.ownerDocument.createElement('div');
    wrapEl.className = className;
    wrapEl.tabIndex = 0;
    el.replaceWith(wrapEl);
    wrapEl.append(el);
  }

  function sanitize(root) {
    root.querySelectorAll(REMOVE).forEach((n) => n.remove());
    root.querySelectorAll('*').forEach((n) => {
      if (!ALLOWED.has(n.tagName)) {
        n.replaceWith(...n.childNodes);
        return;
      }
      [...n.attributes].forEach((a) => {
        if (!(n.tagName === 'A' && a.name === 'href') && !(n.tagName === 'OL' && a.name === 'start')) {
          n.removeAttribute(a.name);
        }
      });
      if (n.tagName === 'A') {
        const href = n.getAttribute('href') || '';
        if (!HREF_OK.test(href)) n.removeAttribute('href');
        n.setAttribute('target', '_blank');
        n.setAttribute('rel', 'noopener noreferrer');
      }
    });
    root.querySelectorAll('table').forEach((table) => wrap(table, 'md-table-scroll'));
    root.querySelectorAll('pre').forEach((pre) => wrap(pre, 'md-code-scroll'));
  }

  function render(parent, text) {
    const source = text == null ? '' : String(text);
    try {
      if (!window.marked || typeof window.marked.parse !== 'function') {
        throw new Error('marked missing');
      }
      const html = window.marked.parse(source.replace(/\r\n?/g, '\n'), {
        async: false,
        breaks: true,
        gfm: true,
      });
      // Template contents stay inert while untrusted markup is filtered.
      const parsed = document.createElement('template');
      parsed.innerHTML = String(html);
      sanitize(parsed.content);
      parent.replaceChildren();
      const live = parent.ownerDocument || document;
      for (const node of [...parsed.content.childNodes]) {
        parent.append(live.importNode(node, true));
      }
      parent.classList.add('md');
      parent.classList.remove('md-plain');
    } catch (err) {
      parent.textContent = source;
      parent.classList.add('md-plain');
      parent.classList.remove('md');
    }
  }

  window.OpsTwinsMarkdown = { render };
})();
