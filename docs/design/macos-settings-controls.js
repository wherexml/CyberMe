/* Settings popup selectors. Native select retains form validation and value semantics. */
(() => {
  'use strict';
  let active = null, sequence = 0;
  const close = (restore = false) => active?.close(restore);
  function select(node, value, options, onchange, label) {
    if (typeof HTMLElement.prototype.showPopover !== 'function') {
      const fallback = node('select', 'ss-input'); fallback.setAttribute('aria-label', label || '选择');
      for (const [key, name, disabled] of options) {
        const option = node('option', '', name); option.value = key; option.disabled = !!disabled; fallback.append(option);
      }
      fallback.value = String(value ?? ''); fallback.onchange = () => onchange(fallback.value);
      return fallback;
    }
    const wrap = node('div', 'ss-select'), native = node('select', 'ss-select-native');
    const trigger = node('button', 'ss-select-trigger'), text = node('span', 'ss-select-value');
    trigger.id = 'ss-select-trigger-' + (++sequence);
    const error = node('span', 'ss-control-error');
    native.tabIndex = -1; native.setAttribute('aria-hidden', 'true');
    native.setAttribute('aria-label', label || '选择');
    trigger.type = 'button'; trigger.setAttribute('aria-label', label || '选择');
    trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false');
    const arrow = node('span', 'ss-select-arrow'); arrow.setAttribute('aria-hidden', 'true');
    trigger.append(text, arrow); error.hidden = true; error.setAttribute('role', 'alert');
    for (const [key, name, disabled] of options) {
      const option = node('option', '', name); option.value = key; option.disabled = !!disabled;
      native.append(option);
    }
    native.value = String(value ?? '');
    function sync() {
      text.textContent = native.selectedOptions[0]?.textContent || '请选择';
      trigger.disabled = native.disabled; wrap.classList.toggle('disabled', native.disabled);
    }
    native.onchange = () => { error.hidden = true; sync(); onchange(native.value); };
    native.oninvalid = event => {
      event.preventDefault(); error.textContent = native.validationMessage; error.hidden = false;
      trigger.focus({preventScroll: true});
    };
    Object.defineProperties(wrap, {
      value: {get: () => native.value, set: v => { native.value = v; sync(); }},
      disabled: {get: () => native.disabled, set: v => { native.disabled = !!v; sync(); if (active?.trigger === trigger) close(); }},
      required: {get: () => native.required, set: v => { native.required = !!v; }}
    });
    wrap.setCustomValidity = message => { native.setCustomValidity(message); error.hidden = !message; error.textContent = message; };
    wrap.reportValidity = () => native.reportValidity();
    wrap.append(native, trigger, error); sync();
    function open(direction) {
      if (native.disabled || !trigger.isConnected) return;
      close();
      const menu = node('div', 'ss-select-menu'); menu.id = 'ss-select-menu-' + (++sequence);
      menu.setAttribute('popover', 'manual'); menu.setAttribute('role', 'listbox');
      menu.setAttribute('aria-label', label || '选择'); menu.tabIndex = -1;
      const list = [...native.options], enabled = list.map((o, i) => o.disabled ? -1 : i).filter(i => i >= 0);
      let cursor = enabled.includes(native.selectedIndex) ? native.selectedIndex : enabled[0];
      const items = list.map((option, index) => {
        const item = node('div', 'ss-select-option'); item.id = menu.id + '-' + index;
        item.setAttribute('role', 'option'); item.setAttribute('aria-selected', String(index === native.selectedIndex));
        item.setAttribute('aria-disabled', String(option.disabled));
        const tick = node('span', 'ss-select-tick', index === native.selectedIndex ? '✓' : '');
        tick.setAttribute('aria-hidden', 'true'); item.append(tick, node('span', '', option.textContent));
        item.onclick = () => choose(index);
        item.onpointermove = () => { if (!option.disabled) { cursor = index; highlight(); } };
        menu.append(item); return item;
      });
      const events = new AbortController();
      const cleanup = restore => {
        if (active?.menu !== menu) return;
        active = null; events.abort();
        if (menu.matches(':popover-open')) menu.hidePopover();
        menu.remove(); trigger.setAttribute('aria-expanded', 'false'); trigger.removeAttribute('aria-controls');
        if (restore && trigger.isConnected) trigger.focus({preventScroll: true});
      };
      active = {menu, trigger, close: cleanup};
      function highlight() {
        items.forEach((item, index) => item.classList.toggle('highlighted', index === cursor));
        if (items[cursor]) { menu.setAttribute('aria-activedescendant', items[cursor].id); items[cursor].scrollIntoView({block: 'nearest'}); }
      }
      function choose(index) {
        if (!list[index] || list[index].disabled) return;
        const changed = native.selectedIndex !== index; native.selectedIndex = index;
        cleanup(true); sync(); if (changed) native.dispatchEvent(new Event('change', {bubbles: true}));
      }
      (trigger.closest('dialog') || document.body).append(menu);
      trigger.setAttribute('aria-expanded', 'true'); trigger.setAttribute('aria-controls', menu.id);
      menu.showPopover();
      const rect = trigger.getBoundingClientRect(), gap = 5, inset = 8;
      const width = Math.min(Math.max(rect.width, 204), innerWidth - inset * 2);
      const below = innerHeight - rect.bottom - inset - gap, above = rect.top - inset - gap;
      const desired = Math.min(list.length * 34 + 10, 300), down = below >= desired || below >= above;
      menu.style.width = width + 'px'; menu.style.maxHeight = Math.max(36, Math.min(desired, down ? below : above)) + 'px';
      menu.style.left = Math.min(Math.max(inset, rect.right - width), innerWidth - width - inset) + 'px';
      menu.style.top = (down ? rect.bottom + gap : Math.max(inset, rect.top - gap - menu.getBoundingClientRect().height)) + 'px';
      menu.focus({preventScroll: true}); highlight();
      if (direction === 'last' && enabled.length) { cursor = enabled.at(-1); highlight(); }
      menu.onkeydown = event => {
        if (event.isComposing) return;
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          if (!enabled.length) return;
          const current = enabled.indexOf(cursor), step = event.key === 'ArrowUp' ? -1 : 1;
          cursor = event.key === 'Home' ? enabled[0] : event.key === 'End' ? enabled.at(-1) : enabled[(current + step + enabled.length) % enabled.length]; highlight();
        } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(cursor); }
        else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cleanup(true); }
        else if (event.key === 'Tab') { cleanup(true); }
        else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
          const found = enabled.find(i => list[i].textContent.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()));
          if (found != null) { cursor = found; highlight(); }
        }
      };
      document.addEventListener('pointerdown', event => {
        if (!menu.contains(event.target) && !wrap.contains(event.target)) cleanup(false);
      }, {capture: true, signal: events.signal});
      document.addEventListener('scroll', event => { if (!menu.contains(event.target)) cleanup(false); }, {capture: true, signal: events.signal});
      window.addEventListener('resize', () => cleanup(false), {signal: events.signal});
      const owner = trigger.closest('dialog');
      owner?.addEventListener('close', () => cleanup(false), {signal: events.signal});
      owner?.addEventListener('cancel', event => { event.preventDefault(); cleanup(true); }, {signal: events.signal});
    }
    trigger.onclick = () => active?.trigger === trigger ? close(true) : open();
    trigger.onkeydown = event => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); open(event.key === 'End' ? 'last' : undefined); }
    };
    return wrap;
  }
  window.OpsTwinsSettingsControls = {select, close};
})();
