import { z } from 'zod';

const emailTagsSchema = z.array(z.string().trim().min(1).max(50)).max(50);
const requiredEmailTagsSchema = emailTagsSchema.min(1);
const emailTagNameSchema = z.string().trim().min(1).max(50);
const emailTagDescriptionSchema = z.string().trim().max(255);

export const createEmailSchema = z.object({
    email: z.string().email(),
    clientId: z.string().min(1),
    refreshToken: z.string().min(1),
    password: z.string().optional(),
    groupId: z.coerce.number().int().positive().optional(),
    tags: emailTagsSchema.optional(),
});

export const updateEmailSchema = z.object({
    email: z.string().email().optional(),
    clientId: z.string().min(1).optional(),
    refreshToken: z.string().min(1).optional(),
    password: z.string().optional(),
    status: z.enum(['ACTIVE', 'ERROR', 'DISABLED']).optional(),
    groupId: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
    tags: emailTagsSchema.optional(),
});

export const listEmailSchema = z.object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(10),
    status: z.enum(['ACTIVE', 'ERROR', 'DISABLED']).optional(),
    keyword: z.string().optional(),
    tagKeyword: z.string().optional(),
    groupId: z.coerce.number().int().positive().optional(),
    groupName: z.string().optional(),
});

export const listEmailTagsSchema = z.object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(10),
    keyword: z.string().optional(),
});

export const createEmailTagSchema = z.object({
    name: emailTagNameSchema,
    description: emailTagDescriptionSchema.optional(),
});

export const updateEmailTagSchema = z.object({
    name: emailTagNameSchema.optional(),
    description: z.union([emailTagDescriptionSchema, z.literal(''), z.null()]).optional(),
});

export const batchAddEmailTagsSchema = z.object({
    emailIds: z.array(z.coerce.number().int().positive()).min(1),
    tags: requiredEmailTagsSchema,
});

export const batchDeleteEmailTagsSchema = z.object({
    ids: z.array(z.coerce.number().int().positive()).min(1),
});

export const importEmailSchema = z.object({
    content: z.string().min(1),
    separator: z.string().default('----'),
    groupId: z.coerce.number().int().positive().optional(),
});

export type CreateEmailInput = z.infer<typeof createEmailSchema>;
export type UpdateEmailInput = z.infer<typeof updateEmailSchema>;
export type ListEmailInput = z.infer<typeof listEmailSchema>;
export type ListEmailTagsInput = z.infer<typeof listEmailTagsSchema>;
export type CreateEmailTagInput = z.infer<typeof createEmailTagSchema>;
export type UpdateEmailTagInput = z.infer<typeof updateEmailTagSchema>;
export type BatchAddEmailTagsInput = z.infer<typeof batchAddEmailTagsSchema>;
export type BatchDeleteEmailTagsInput = z.infer<typeof batchDeleteEmailTagsSchema>;
export type ImportEmailInput = z.infer<typeof importEmailSchema>;
