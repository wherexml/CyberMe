// Prisma enum shim for the local Mock only. Values match the pinned upstream.
export const DraftReplyConfidence = {
  ALL_EMAILS: 'ALL_EMAILS',
  STANDARD: 'STANDARD',
  HIGH_CONFIDENCE: 'HIGH_CONFIDENCE',
} as const;
export type DraftReplyConfidence = typeof DraftReplyConfidence[keyof typeof DraftReplyConfidence];
