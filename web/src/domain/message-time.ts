// Reuse the existing browser implementation of WeSync HistoryMessageTime.
import '../../../docs/design/macos-message-time.js';
type Stamp = string | number | Date | null | undefined;
type MessageTime = {parse(value:Stamp):Date|null;showsSeparator(value:Stamp,preceding:Stamp):boolean;label(value:Stamp,clock?:Stamp):string;listLabel(value:Stamp,clock?:Stamp):string};
export const messageTime=(window as unknown as {OpsTwinsMessageTime:MessageTime}).OpsTwinsMessageTime;
