/* Matches the read-only GreenBubbles HistoryMessageTime contract. */
(() => {
  function parse(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) return null;
    let input = value;
    if (typeof value === 'number' || /^\d{10,13}$/.test(value)) {
      const number = Number(value);
      input = Math.abs(number) < 1e11 ? number * 1000 : number;
    }
    const date = new Date(input);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function showsSeparator(value, preceding) {
    const date = parse(value), previous = parse(preceding);
    if (!date) return false;
    return !previous || !sameDay(date, previous) || date.getTime() - previous.getTime() >= 15 * 60 * 1000;
  }
  function label(value, clock = new Date()) {
    const date = parse(value), now = parse(clock);
    if (!date || !now) return '';
    const hm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    if (sameDay(date, today)) return hm;
    if (sameDay(date, yesterday)) return `昨天 ${hm}`;
    const monday = new Date(today); monday.setDate(today.getDate() - (today.getDay() + 6) % 7);
    if (date < today && date >= monday) return `星期${['日', '一', '二', '三', '四', '五', '六'][date.getDay()]} ${hm}`;
    const prefix = date.getFullYear() === now.getFullYear() ? '' : `${date.getFullYear()} 年 `;
    return `${prefix}${date.getMonth() + 1} 月 ${date.getDate()} 日 ${hm}`;
  }
  function listLabel(value, clock = new Date()) {
    const date = parse(value), now = parse(clock);
    if (!date || !now) return '';
    const hm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    if (sameDay(date, today)) return hm;
    if (sameDay(date, yesterday)) return `昨天 ${hm}`;
    const monday = new Date(today); monday.setDate(today.getDate() - (today.getDay() + 6) % 7);
    if (date < today && date >= monday) return `星期${['日', '一', '二', '三', '四', '五', '六'][date.getDay()]}`;
    return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
  }
  window.OpsTwinsMessageTime = Object.freeze({parse, showsSeparator, label, listLabel});
})();
