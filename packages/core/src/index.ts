import { z } from "zod";

const HttpUrlSchema = z.url().refine((value) => {
  const { protocol } = new URL(value);
  return protocol === "http:" || protocol === "https:";
}, "A URL deve usar HTTP ou HTTPS");

export const OpportunitySchema = z.object({
  title: z.string().trim().min(1),
  sourceName: z.string().trim().min(1),
  sourceUrl: HttpUrlSchema,
  officialUrl: HttpUrlSchema,
  discoveredAt: z.iso.datetime({ offset: true }),
  deadline: z.iso.date().nullable(),
  deadlineStatus: z.enum(["confirmed", "unconfirmed", "unknown"]),
});

export type Opportunity = z.infer<typeof OpportunitySchema>;
