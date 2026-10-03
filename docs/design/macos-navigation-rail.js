/* Tooltip lives in the top layer so scrolling the rail cannot clip it. */
(() => {
  const rail = document.querySelector('.muse-rail');
  if (!rail) return;
  const tooltip = document.createElement('div');
  tooltip.id = 'rail-tooltip';
  tooltip.className = 'rail-tooltip';
  tooltip.role = 'tooltip';
  tooltip.hidden = true;
  if (typeof tooltip.showPopover === 'function') tooltip.setAttribute('popover', 'manual');
  document.body.append(tooltip);
  let owner = null, timer = null;
  const hide = () => {
    clearTimeout(timer);
    owner?.removeAttribute('aria-describedby');
    owner = null;
    if (tooltip.hasAttribute('popover') && tooltip.matches(':popover-open')) tooltip.hidePopover();
    tooltip.hidden = true;
  };
  const show = button => {
    hide();
    if (!button.isConnected) return;
    owner = button;
    tooltip.textContent = button.dataset.tooltip;
    button.setAttribute('aria-describedby', tooltip.id);
    tooltip.hidden = false;
    if (tooltip.hasAttribute('popover')) tooltip.showPopover();
    const anchor = button.getBoundingClientRect(), size = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, Math.min(anchor.right + 12, innerWidth - size.width - 8))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(anchor.top + (anchor.height - size.height) / 2, innerHeight - size.height - 8))}px`;
  };
  rail.querySelectorAll('button[data-page]').forEach(button => {
    button.addEventListener('pointerenter', () => {
      hide();
      timer = setTimeout(() => show(button), 250);
    });
    button.addEventListener('pointerleave', hide);
    button.addEventListener('focus', () => show(button));
    button.addEventListener('blur', hide);
    button.addEventListener('click', hide);
  });
  document.addEventListener('keydown', event => {if (event.key === 'Escape') hide();});
  document.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
})();
