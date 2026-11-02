import { z } from "zod";
import { MAX_CAPTION_LENGTH, MAX_IMAGES } from "@/lib/constants";

const isoDate = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date/time");

export const mediaPathsSchema = z
  .array(z.string().min(1).max(500))
  .max(MAX_IMAGES, `A post can contain at most ${MAX_IMAGES} images`);

export const destinationIdsSchema = z
  .array(z.string().uuid())
  .max(50, "A post can target at most 50 destinations");

export const createPostSchema = z.object({
  caption: z.string().max(MAX_CAPTION_LENGTH).default(""),
  hashtags: z.string().max(1000).default(""),
  scheduledAt: isoDate.nullable().optional(),
  status: z.enum(["draft", "scheduled"]).default("draft"),
  mediaPaths: mediaPathsSchema.default([]),
  destinationIds: destinationIdsSchema.default([]),
});

export const updatePostSchema = z.object({
  caption: z.string().max(MAX_CAPTION_LENGTH).optional(),
  hashtags: z.string().max(1000).optional(),
  scheduledAt: isoDate.nullable().optional(),
  status: z.enum(["draft", "scheduled", "cancelled"]).optional(),
  mediaPaths: mediaPathsSchema.optional(),
  destinationIds: destinationIdsSchema.optional(),
});

export const settingsSchema = z.object({
  telegramEnabled: z.boolean().optional(),
  telegramChatId: z
    .union([
      z.literal(""),
      z.string().trim().regex(/^-?\d{5,25}$/, "Enter a numeric Telegram chat ID"),
    ])
    .optional(),
  mediaRetentionHours: z.number().int().min(1).max(720).optional(),
});

export const manualPublishedSchema = z.object({
  permalink: z
    .string()
    .trim()
    .max(500)
    .optional()
    .refine(
      (value) =>
        !value ||
        /^https:\/\/(www\.)?linkedin\.com\/(feed\/update|posts)\//.test(value),
      "Enter a LinkedIn post URL",
    ),
  destinationId: z.string().uuid().optional(),
});

export const manualDestinationSchema = z.object({
  authorUrn: z
    .string()
    .trim()
    .regex(
      /^urn:li:(organization|person):\d+$/,
      "Enter a LinkedIn author URN such as urn:li:organization:1234567",
    ),
  name: z.string().trim().max(120).optional(),
});

export const destinationToggleSchema = z.object({
  isEnabled: z.boolean(),
});

export function zodMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid request";
}
