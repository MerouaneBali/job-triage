import { z } from "zod";

const tagged = z.object({
  item: z.string(),
  tag: z.enum(["match", "partial_match", "gap", "unknown"]),
  evidence: z.string().optional().nullable(),
});

export const evaluateSchema = z.object({
  jobId: z.string(),
  decision: z.enum(["apply", "maybe", "skip"]),
  fitScore: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  eligibility: z.object({
    status: z.enum(["pass", "fail", "unknown"]),
    locationNotes: z.string(),
    internationalHiring: z.enum(["likely", "unlikely", "unknown"]),
  }),
  employmentType: z.string().nullable(),
  compensation: z.string().nullable(),
  strengths: z.array(tagged),
  gaps: z.array(tagged),
  partialMatches: z.array(tagged),
  unknowns: z.array(z.string()),
  recommendation: z.string(),
});

export const generateSchema = z.object({
  jobId: z.string(),
  strategy: z.string(),
  coverLetter: z.string().nullable(),
  outreachMessage: z.string().nullable(),
  questionsToAsk: z.array(z.string()),
  cvTailoringSuggestions: z.array(z.string()),
});

export const EVALUATE_TOOL = {
  name: "record_job_evaluation",
  description: "Record structured job evaluation against the candidate profile.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      jobId: { type: "string" },
      decision: { type: "string", enum: ["apply", "maybe", "skip"] },
      // Bounds enforced by Zod after the call — strict tools disallow min/max.
      fitScore: { type: "number" },
      confidence: { type: "number" },
      eligibility: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", enum: ["pass", "fail", "unknown"] },
          locationNotes: { type: "string" },
          internationalHiring: {
            type: "string",
            enum: ["likely", "unlikely", "unknown"],
          },
        },
        required: ["status", "locationNotes", "internationalHiring"],
      },
      employmentType: { type: ["string", "null"] },
      compensation: { type: ["string", "null"] },
      strengths: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            item: { type: "string" },
            tag: {
              type: "string",
              enum: ["match", "partial_match", "gap", "unknown"],
            },
            evidence: { type: ["string", "null"] },
          },
          required: ["item", "tag"],
        },
      },
      gaps: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            item: { type: "string" },
            tag: {
              type: "string",
              enum: ["match", "partial_match", "gap", "unknown"],
            },
            evidence: { type: ["string", "null"] },
          },
          required: ["item", "tag"],
        },
      },
      partialMatches: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            item: { type: "string" },
            tag: {
              type: "string",
              enum: ["match", "partial_match", "gap", "unknown"],
            },
            evidence: { type: ["string", "null"] },
          },
          required: ["item", "tag"],
        },
      },
      unknowns: { type: "array", items: { type: "string" } },
      recommendation: { type: "string" },
    },
    required: [
      "jobId",
      "decision",
      "fitScore",
      "confidence",
      "eligibility",
      "employmentType",
      "compensation",
      "strengths",
      "gaps",
      "partialMatches",
      "unknowns",
      "recommendation",
    ],
  },
};

export const GENERATE_TOOL = {
  name: "record_application_materials",
  description:
    "Record grounded application materials for a job (no invented facts).",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      jobId: { type: "string" },
      strategy: { type: "string" },
      coverLetter: { type: ["string", "null"] },
      outreachMessage: { type: ["string", "null"] },
      questionsToAsk: { type: "array", items: { type: "string" } },
      cvTailoringSuggestions: { type: "array", items: { type: "string" } },
    },
    required: [
      "jobId",
      "strategy",
      "coverLetter",
      "outreachMessage",
      "questionsToAsk",
      "cvTailoringSuggestions",
    ],
  },
};
