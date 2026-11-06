// Calendar days in the machine's own timezone: at 07:30 in Singapore the UTC date is still yesterday.
export const localDay=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export const nextLocalDay=(d:Date)=>{const next=new Date(d);next.setDate(next.getDate()+1);return localDay(next)};
