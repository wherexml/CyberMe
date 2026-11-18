(() => {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const menu = document.querySelector('.mobile-menu');
  menu.addEventListener('click', (event) => {
    if (event.target.closest('a')) menu.open = false;
  });
  document.addEventListener('click', (event) => {
    if (!menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu.open) {
      menu.open = false;
      menu.querySelector('summary').focus();
    }
  });
  matchMedia('(max-width: 760px)').addEventListener('change', () => { menu.open = false; });
  document.querySelectorAll('.locales a').forEach((link) => {
    link.addEventListener('click', () => { link.hash = location.hash; });
  });

  const section = document.querySelector('.features');
  const pin = section.querySelector('.features-pin');
  const indicators = [...section.querySelectorAll('.progress i')];
  const desktop = matchMedia('(min-width: 900px) and (min-height: 670px) and (prefers-reduced-motion: no-preference)');
  let scrollFrame = 0;
  function paintPan() {
    scrollFrame = 0;
    if (!desktop.matches) return;
    const span = section.offsetHeight - pin.offsetHeight;
    const progress = Math.min(1, Math.max(0, -section.getBoundingClientRect().top / span));
    const slide = progress * (indicators.length - 1);
    pin.style.setProperty('--offset', (-slide * pin.clientWidth) + 'px');
    indicators.forEach((marker, i) => marker.classList.toggle('active', i === Math.round(slide)));
  }
  function schedulePan() {
    if (desktop.matches && !scrollFrame) scrollFrame = requestAnimationFrame(paintPan);
  }
  function mode() {
    document.documentElement.classList.toggle('has-pan', desktop.matches);
    schedulePan();
  }
  desktop.addEventListener('change', mode);
  addEventListener('scroll', schedulePan, { passive: true });
  addEventListener('resize', schedulePan);
  mode();

  const fields = [...document.querySelectorAll('.field')].map((canvas, i) => ({
    canvas, ctx: canvas.getContext('2d'), density: i === 0 ? 1 : .62, visible: false, pointer: .5, pulse: 0
  })).filter((field) => field.ctx);
  if (!fields.length) return;
  let animation = 0;

  function draw(field, time) {
    const { ctx, width, height, density, pointer } = field;
    ctx.clearRect(0, 0, width, height);
    const count = Math.round(Math.max(44, Math.min(144, width / 12)) * density);
    const t = motion.matches ? 0 : time;
    for (let i = 0; i < count; i++) {
      const ratio = (i + .5) / count;
      const x = ratio * width;
      const phase = i * 2.399963;
      const wave = .5 + .5 * Math.sin(phase + t * (.0006 + (i % 7) * .00016));
      const wave2 = .5 + .5 * Math.cos(i * .26 - t * .0009);
      const bump = field.pulse * Math.exp(-Math.pow((ratio - pointer) * 8, 2));
      const weight = Math.min(1, .06 + .79 * wave * wave2 + .62 * bump);
      const length = (16 + Math.min(height * .29, 249) * weight) * density;
      const y = height * .5 - length / 2;
      const opacity = .10 + .45 * weight;
      ctx.beginPath();
      if (i % 5 === 2 || i % 5 === 4) {
        ctx.fillStyle = 'rgba(150,130,255,' + opacity + ')';
        for (let j = 0; j <= 8; j++) {
          ctx.moveTo(x + 1, y + length * j / 8);
          ctx.arc(x, y + length * j / 8, .78 + weight * .32, 0, Math.PI * 2);
        }
        ctx.fill();
      } else {
        ctx.strokeStyle = 'rgba(105,229,247,' + opacity + ')';
        ctx.moveTo(Math.round(x) + .5, y);
        ctx.lineTo(Math.round(x) + .5, y + length);
        ctx.stroke();
      }
    }
    field.pulse *= .95;
  }
  function resize() {
    fields.forEach((field) => {
      const { width, height } = field.canvas.getBoundingClientRect();
      const scale = Math.min(devicePixelRatio || 1, 2);
      field.width = width;
      field.height = height;
      field.canvas.width = Math.round(width * scale);
      field.canvas.height = Math.round(height * scale);
      field.ctx.setTransform(scale, 0, 0, scale, 0, 0);
      draw(field, 0);
    });
  }
  function frame(time) {
    animation = 0;
    if (motion.matches || document.hidden) return;
    fields.forEach((field) => { if (field.visible) draw(field, time); });
    schedule();
  }
  function schedule() {
    if (!animation && !motion.matches && !document.hidden && fields.some((f) => f.visible)) {
      animation = requestAnimationFrame(frame);
    }
  }
  resize();
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => { fields.find((f) => f.canvas === entry.target).visible = entry.isIntersecting; });
    schedule();
  });
  fields.forEach((field) => observer.observe(field.canvas));
  document.querySelector('.hero').addEventListener('pointermove', (event) => {
    if (motion.matches) return;
    const field = fields[0];
    field.pointer = (event.clientX - field.canvas.getBoundingClientRect().left) / field.width;
    field.pulse = 1;
  }, { passive: true });
  addEventListener('resize', resize);
  document.addEventListener('visibilitychange', schedule);
  motion.addEventListener('change', () => {
    fields.forEach((field) => { field.pulse = 0; draw(field, 0); });
    schedule();
  });
})();
