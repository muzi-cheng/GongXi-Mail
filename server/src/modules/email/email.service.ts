import prisma from '../../lib/prisma.js';
import { encrypt, decrypt } from '../../lib/crypto.js';
import { AppError } from '../../plugins/error.js';
import { Prisma } from '@prisma/client';
import type {
    CreateEmailInput,
    UpdateEmailInput,
    ListEmailInput,
    ImportEmailInput,
    ListEmailTagsInput,
    CreateEmailTagInput,
    UpdateEmailTagInput,
    BatchAddEmailTagsInput,
    BatchDeleteEmailTagsInput,
} from './email.schema.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const AUTO_SEPARATOR_CANDIDATES = ['----', '|', ',', ';', '\t', ':'] as const;

type ParsedImportLine = {
    email: string;
    clientId: string;
    refreshToken: string;
    password?: string;
};

type TagAccountRecord = {
    id: number;
    tags: string[];
};

type EmailTagListRow = {
    id: number;
    name: string;
    description: string | null;
    createdAt: Date;
    emailCount: bigint | number;
};

type CountRow = {
    total: bigint | number;
};

const normalizeTags = (tags?: string[] | null): string[] =>
    Array.from(
        (tags ?? []).reduce((acc, tag) => {
            const normalizedTag = tag.trim();
            if (!normalizedTag) {
                return acc;
            }

            const key = normalizedTag.toLowerCase();
            if (!acc.has(key)) {
                acc.set(key, normalizedTag);
            }
            return acc;
        }, new Map<string, string>()).values()
    );

const normalizeSingleTagName = (tag: string): string => normalizeTags([tag])[0] || '';

const normalizeTagDescription = (description?: string | null): string | null => {
    if (typeof description !== 'string') {
        return null;
    }

    const normalized = description.trim();
    return normalized || null;
};

const toUniquePositiveIntArray = (values: Array<number | string>): number[] =>
    Array.from(
        new Set(
            values
                .map((value) => Number(value))
                .filter((value) => Number.isInteger(value) && value > 0)
        )
    );

const isSameStringArray = (a: string[], b: string[]): boolean =>
    a.length === b.length && a.every((value, index) => value === b[index]);

const ensureEmailTagMetadata = async (
    tx: Prisma.TransactionClient | typeof prisma,
    rawTags: string[]
): Promise<void> => {
    const tags = normalizeTags(rawTags);
    if (!tags.length) {
        return;
    }

    const existing = await tx.emailTag.findMany({
        where: { name: { in: tags } },
        select: { name: true },
    });
    const existingSet = new Set(existing.map((item) => item.name));
    const missing = tags.filter((tag) => !existingSet.has(tag));

    if (!missing.length) {
        return;
    }

    await tx.emailTag.createMany({
        data: missing.map((name) => ({ name })),
        skipDuplicates: true,
    });
};

const syncEmailTagMetadataFromAccounts = async (
    tx: Prisma.TransactionClient | typeof prisma
): Promise<void> => {
    const rows = await tx.$queryRaw<Array<{ name: string }>>`
        SELECT DISTINCT btrim(t.tag) AS name
        FROM "email_accounts" ea
        CROSS JOIN LATERAL unnest(ea."tags") AS t(tag)
        WHERE btrim(t.tag) <> ''
    `;

    await ensureEmailTagMetadata(
        tx,
        rows.map((row) => row.name)
    );
};

const updateAccountsTagsByTransform = async (
    tx: Prisma.TransactionClient,
    transform: (tag: string) => string | null
): Promise<number> => {
    const accounts = await tx.emailAccount.findMany({
        where: {
            tags: {
                isEmpty: false,
            },
        },
        select: {
            id: true,
            tags: true,
        },
    });

    const updates = accounts
        .map((account): TagAccountRecord | null => {
            const currentTags = normalizeTags(account.tags);
            const nextTags = normalizeTags(
                currentTags
                    .map((tag) => transform(tag))
                    .filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
            );

            if (isSameStringArray(currentTags, nextTags)) {
                return null;
            }

            return {
                id: account.id,
                tags: nextTags,
            };
        })
        .filter((item): item is TagAccountRecord => item !== null);

    if (!updates.length) {
        return 0;
    }

    await Promise.all(
        updates.map((item) =>
            tx.emailAccount.update({
                where: { id: item.id },
                data: { tags: item.tags },
            })
        )
    );

    return updates.length;
};

const renameTagAcrossAccounts = async (
    tx: Prisma.TransactionClient,
    fromTag: string,
    toTag: string
): Promise<number> => {
    const fromTagLower = fromTag.trim().toLowerCase();

    if (!fromTagLower) {
        return 0;
    }

    return updateAccountsTagsByTransform(tx, (tag) => {
        const normalized = tag.trim();
        if (normalized.toLowerCase() === fromTagLower) {
            return toTag;
        }

        return normalized;
    });
};

const removeTagsAcrossAccounts = async (
    tx: Prisma.TransactionClient,
    tagsToRemove: string[]
): Promise<number> => {
    const removeSet = new Set(normalizeTags(tagsToRemove).map((tag) => tag.toLowerCase()));

    if (!removeSet.size) {
        return 0;
    }

    return updateAccountsTagsByTransform(tx, (tag) => {
        const normalized = tag.trim();
        if (!normalized) {
            return null;
        }

        if (removeSet.has(normalized.toLowerCase())) {
            return null;
        }

        return normalized;
    });
};

const normalizeImportText = (content: string): string =>
    content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

const shouldSkipImportLine = (line: string): boolean => {
    if (!line) return true;
    if (/^#{1,6}\s*/.test(line)) return true;
    const compact = line.replace(/\s+/g, '');
    if (/^[-=_*|]{3,}$/.test(compact)) return true;
    if (!line.includes('@')) return true;
    return false;
};

const sanitizeImportLines = (content: string): string[] => {
    const normalized = normalizeImportText(content);
    return normalized
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => !shouldSkipImportLine(line));
};

const parseImportLineBySeparator = (line: string, separator: string): ParsedImportLine | null => {
    const parts = line
        .split(separator)
        .map((part) => part.trim());

    let email = '';
    let clientId = '';
    let refreshToken = '';
    let password: string | undefined;

    if (parts.length >= 5) {
        // email----clientId----uuid----info----refreshToken
        email = parts[0] || '';
        clientId = parts[1] || '';
        refreshToken = parts[4] || '';
    } else if (parts.length === 4) {
        // email----password----clientId----refreshToken
        email = parts[0] || '';
        password = parts[1] || '';
        clientId = parts[2] || '';
        refreshToken = parts[3] || '';
    } else if (parts.length === 3) {
        // email----clientId----refreshToken
        email = parts[0] || '';
        clientId = parts[1] || '';
        refreshToken = parts[2] || '';
    }

    if (!EMAIL_REGEX.test(email) || !clientId || !refreshToken) {
        return null;
    }

    return {
        email,
        clientId,
        refreshToken,
        password: password || undefined,
    };
};

const detectSeparator = (lines: string[], fallbackSeparator: string): string => {
    const candidates = [...AUTO_SEPARATOR_CANDIDATES];

    let bestSeparator = '';
    let bestScore = 0;

    for (const candidate of candidates) {
        let score = 0;
        for (const line of lines) {
            if (parseImportLineBySeparator(line, candidate)) {
                score += 1;
            }
        }

        if (score > bestScore) {
            bestScore = score;
            bestSeparator = candidate;
        }
    }

    return bestScore > 0 ? bestSeparator : fallbackSeparator;
};

export const emailService = {
    /**
     * 获取邮箱列表
     */
    async list(input: ListEmailInput) {
        const { page, pageSize, status, keyword, tagKeyword, groupId, groupName } = input;
        const skip = (page - 1) * pageSize;

        const where: Prisma.EmailAccountWhereInput = {};
        if (status) where.status = status;
        if (keyword) {
            where.email = { contains: keyword };
        }
        const normalizedTagKeyword = tagKeyword?.trim();
        if (normalizedTagKeyword) {
            const pattern = `%${normalizedTagKeyword}%`;
            const matchedRows = await prisma.$queryRaw<Array<{ id: number }>>`
                SELECT DISTINCT ea."id" AS id
                FROM "email_accounts" ea
                CROSS JOIN LATERAL unnest(ea."tags") AS t(tag)
                WHERE btrim(t.tag) <> ''
                  AND t.tag ILIKE ${pattern}
            `;

            const matchedIds = matchedRows
                .map((row) => Number(row.id))
                .filter((id) => Number.isFinite(id));

            if (!matchedIds.length) {
                return { list: [], total: 0, page, pageSize };
            }

            where.id = { in: matchedIds };
        }
        if (groupId) {
            where.groupId = groupId;
        } else if (groupName) {
            where.group = { name: groupName };
        }

        const [list, total] = await Promise.all([
            prisma.emailAccount.findMany({
                where,
                select: {
                    id: true,
                    email: true,
                    clientId: true,
                    tags: true,
                    password: true,
                    status: true,
                    groupId: true,
                    group: { select: { id: true, name: true, fetchStrategy: true } },
                    lastCheckAt: true,
                    tokenRefreshedAt: true,
                    errorMessage: true,
                    createdAt: true,
                },
                skip,
                take: pageSize,
                orderBy: { id: 'desc' },
            }),
            prisma.emailAccount.count({ where }),
        ]);

        const normalizedList = list.map((item) => ({
            id: item.id,
            email: item.email,
            clientId: item.clientId,
            tags: item.tags,
            hasPassword: !!item.password,
            status: item.status,
            groupId: item.groupId,
            group: item.group,
            lastCheckAt: item.lastCheckAt,
            tokenRefreshedAt: item.tokenRefreshedAt,
            errorMessage: item.errorMessage,
            createdAt: item.createdAt,
        }));

        return { list: normalizedList, total, page, pageSize };
    },

    /**
     * 标签管理：聚合查询标签列表
     */
    async listTags(input: ListEmailTagsInput) {
        const { page, pageSize, keyword } = input;
        const skip = (page - 1) * pageSize;
        await syncEmailTagMetadataFromAccounts(prisma);

        const normalizedKeyword = keyword?.trim();
        const pattern = normalizedKeyword ? `%${normalizedKeyword}%` : null;
        const whereClause = pattern
            ? Prisma.sql`WHERE t."name" ILIKE ${pattern} OR COALESCE(t."description", '') ILIKE ${pattern}`
            : Prisma.empty;

        const [rows, totalRows] = await Promise.all([
            prisma.$queryRaw<EmailTagListRow[]>`
                SELECT
                    t."id" AS id,
                    t."name" AS name,
                    t."description" AS description,
                    t."created_at" AS "createdAt",
                    COALESCE(stats."emailCount", 0)::bigint AS "emailCount"
                FROM "email_tags" t
                LEFT JOIN (
                    SELECT
                        lower(btrim(tt.tag)) AS "tagKey",
                        COUNT(DISTINCT ea."id")::bigint AS "emailCount"
                    FROM "email_accounts" ea
                    CROSS JOIN LATERAL unnest(ea."tags") AS tt(tag)
                    WHERE btrim(tt.tag) <> ''
                    GROUP BY lower(btrim(tt.tag))
                ) stats ON lower(t."name") = stats."tagKey"
                ${whereClause}
                ORDER BY t."created_at" DESC, t."id" DESC
                OFFSET ${skip}
                LIMIT ${pageSize}
            `,
            prisma.$queryRaw<CountRow[]>`
                SELECT COUNT(*)::bigint AS total
                FROM "email_tags" t
                ${whereClause}
            `,
        ]);

        return {
            list: rows.map((row) => ({
                id: Number(row.id),
                name: row.name,
                description: row.description,
                createdAt: row.createdAt,
                emailCount: Number(row.emailCount),
            })),
            total: Number(totalRows[0]?.total ?? 0),
            page,
            pageSize,
        };
    },

    /**
     * 标签管理：创建标签
     */
    async createTag(input: CreateEmailTagInput) {
        const name = normalizeSingleTagName(input.name);
        if (!name) {
            throw new AppError('INVALID_TAG_NAME', 'Tag name is required', 400);
        }

        const existing = await prisma.emailTag.findFirst({
            where: {
                name: {
                    equals: name,
                    mode: 'insensitive',
                },
            },
            select: { id: true },
        });

        if (existing) {
            throw new AppError('TAG_EXISTS', 'Tag name already exists', 409);
        }

        const tag = await prisma.emailTag.create({
            data: {
                name,
                description: normalizeTagDescription(input.description),
            },
        });

        return {
            ...tag,
            emailCount: 0,
        };
    },

    /**
     * 标签管理：更新标签
     */
    async updateTag(id: number, input: UpdateEmailTagInput) {
        const existingTag = await prisma.emailTag.findUnique({
            where: { id },
        });

        if (!existingTag) {
            throw new AppError('TAG_NOT_FOUND', 'Tag not found', 404);
        }

        const nextName = input.name !== undefined ? normalizeSingleTagName(input.name) : existingTag.name;
        if (!nextName) {
            throw new AppError('INVALID_TAG_NAME', 'Tag name is required', 400);
        }

        const nextDescription = input.description !== undefined
            ? normalizeTagDescription(input.description)
            : existingTag.description;

        if (nextName.toLowerCase() !== existingTag.name.toLowerCase()) {
            const duplicate = await prisma.emailTag.findFirst({
                where: {
                    id: { not: id },
                    name: {
                        equals: nextName,
                        mode: 'insensitive',
                    },
                },
                select: { id: true },
            });

            if (duplicate) {
                throw new AppError('TAG_EXISTS', 'Tag name already exists', 409);
            }
        }

        const result = await prisma.$transaction(async (tx) => {
            const tag = await tx.emailTag.update({
                where: { id },
                data: {
                    name: nextName,
                    description: nextDescription,
                },
            });

            if (nextName !== existingTag.name) {
                await renameTagAcrossAccounts(tx, existingTag.name, nextName);
            }

            const countRows = await tx.$queryRaw<Array<{ emailCount: bigint | number }>>`
                SELECT COUNT(DISTINCT ea."id")::bigint AS "emailCount"
                FROM "email_accounts" ea
                WHERE EXISTS (
                    SELECT 1
                    FROM unnest(ea."tags") AS t(tag)
                    WHERE btrim(t.tag) <> ''
                      AND lower(btrim(t.tag)) = lower(${nextName})
                )
            `;

            return {
                tag,
                emailCount: Number(countRows[0]?.emailCount ?? 0),
            };
        });

        return {
            ...result.tag,
            emailCount: result.emailCount,
        };
    },

    /**
     * 标签管理：删除标签
     */
    async deleteTag(id: number) {
        const existingTag = await prisma.emailTag.findUnique({
            where: { id },
            select: {
                id: true,
                name: true,
            },
        });

        if (!existingTag) {
            throw new AppError('TAG_NOT_FOUND', 'Tag not found', 404);
        }

        const result = await prisma.$transaction(async (tx) => {
            const updated = await removeTagsAcrossAccounts(tx, [existingTag.name]);
            await tx.emailTag.delete({ where: { id } });
            return { updated };
        });

        return {
            success: true,
            updated: result.updated,
        };
    },

    /**
     * 标签管理：批量为指定邮箱添加标签
     */
    async batchAddTags(input: BatchAddEmailTagsInput) {
        const emailIds = toUniquePositiveIntArray(input.emailIds);
        const tagsToAdd = normalizeTags(input.tags);

        if (!emailIds.length || !tagsToAdd.length) {
            return { updated: 0 };
        }

        return prisma.$transaction(async (tx) => {
            await ensureEmailTagMetadata(tx, tagsToAdd);

            const accounts = await tx.emailAccount.findMany({
                where: { id: { in: emailIds } },
                select: {
                    id: true,
                    tags: true,
                },
            });

            if (!accounts.length) {
                return { updated: 0 };
            }

            const updates = accounts
                .map((account): TagAccountRecord | null => {
                    const currentTags = normalizeTags(account.tags);
                    const nextTags = normalizeTags([...currentTags, ...tagsToAdd]);

                    if (isSameStringArray(currentTags, nextTags)) {
                        return null;
                    }

                    return {
                        id: account.id,
                        tags: nextTags,
                    };
                })
                .filter((item): item is TagAccountRecord => item !== null);

            if (!updates.length) {
                return { updated: 0 };
            }

            await Promise.all(
                updates.map((item) =>
                    tx.emailAccount.update({
                        where: { id: item.id },
                        data: { tags: item.tags },
                    })
                )
            );

            return { updated: updates.length };
        });
    },

    /**
     * 标签管理：批量删除标签（全局）
     */
    async batchDeleteTags(input: BatchDeleteEmailTagsInput) {
        const ids = toUniquePositiveIntArray(input.ids);
        if (!ids.length) {
            return { deleted: 0, updated: 0 };
        }

        return prisma.$transaction(async (tx) => {
            const tags = await tx.emailTag.findMany({
                where: {
                    id: { in: ids },
                },
                select: {
                    id: true,
                    name: true,
                },
            });

            if (!tags.length) {
                return { deleted: 0, updated: 0 };
            }

            const updated = await removeTagsAcrossAccounts(
                tx,
                tags.map((tag) => tag.name)
            );

            const deleteResult = await tx.emailTag.deleteMany({
                where: {
                    id: {
                        in: tags.map((tag) => tag.id),
                    },
                },
            });

            return {
                deleted: deleteResult.count,
                updated,
            };
        });
    },

    /**
     * 获取邮箱详情
     */
    async getById(id: number, includeSecrets = false) {
        const email = await prisma.emailAccount.findUnique({
            where: { id },
            select: {
                id: true,
                email: true,
                clientId: true,
                tags: true,
                refreshToken: !!includeSecrets,
                status: true,
                groupId: true,
                group: { select: { id: true, name: true, fetchStrategy: true } },
                lastCheckAt: true,
                tokenRefreshedAt: true,
                errorMessage: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        if (!email) {
            throw new AppError('NOT_FOUND', 'Email account not found', 404);
        }

        // 解密敏感信息
        if (includeSecrets) {
            return {
                ...email,
                refreshToken: email.refreshToken ? decrypt(email.refreshToken) : email.refreshToken,
            };
        }

        return email;
    },

    /**
     * 按需查看单条邮箱密码（避免列表明文下发）
     */
    async getPasswordById(id: number) {
        const email = await prisma.emailAccount.findUnique({
            where: { id },
            select: {
                id: true,
                email: true,
                password: true,
            },
        });

        if (!email) {
            throw new AppError('NOT_FOUND', 'Email account not found', 404);
        }

        return {
            id: email.id,
            email: email.email,
            password: email.password ? decrypt(email.password) : null,
        };
    },

    /**
     * 根据邮箱地址获取（用于外部 API）
     */
    async getByEmail(emailAddress: string) {
        const email = await prisma.emailAccount.findUnique({
            where: { email: emailAddress },
            select: {
                id: true,
                email: true,
                clientId: true,
                tags: true,
                refreshToken: true,
                password: true,
                status: true,
                groupId: true,
                group: {
                    select: {
                        fetchStrategy: true,
                    },
                },
            },
        });

        if (!email) {
            return null;
        }

        // 解密
        return {
            ...email,
            refreshToken: decrypt(email.refreshToken),
            password: email.password ? decrypt(email.password) : undefined,
            fetchStrategy: email.group?.fetchStrategy || 'GRAPH_FIRST',
        };
    },

    /**
     * 创建邮箱账户
     */
    async create(input: CreateEmailInput) {
        const { email, clientId, refreshToken, password, groupId, tags } = input;

        const exists = await prisma.emailAccount.findUnique({ where: { email } });
        if (exists) {
            throw new AppError('DUPLICATE_EMAIL', 'Email already exists', 400);
        }

        const encryptedToken = encrypt(refreshToken);
        const encryptedPassword = password ? encrypt(password) : null;
        const normalizedTags = normalizeTags(tags);

        const account = await prisma.$transaction(async (tx) => {
            if (normalizedTags.length) {
                await ensureEmailTagMetadata(tx, normalizedTags);
            }

            return tx.emailAccount.create({
                data: {
                    email,
                    clientId,
                    tags: normalizedTags,
                    refreshToken: encryptedToken,
                    password: encryptedPassword,
                    groupId: groupId || null,
                },
                select: {
                    id: true,
                    email: true,
                    clientId: true,
                    tags: true,
                    status: true,
                    groupId: true,
                    createdAt: true,
                },
            });
        });

        return account;
    },

    /**
     * 更新邮箱账户
     */
    async update(id: number, input: UpdateEmailInput) {
        const exists = await prisma.emailAccount.findUnique({ where: { id } });
        if (!exists) {
            throw new AppError('NOT_FOUND', 'Email account not found', 404);
        }

        const { refreshToken, password, tags, ...rest } = input;
        const updateData: Prisma.EmailAccountUncheckedUpdateInput = { ...rest };

        // 加密 sensitive data
        if (refreshToken) {
            updateData.refreshToken = encrypt(refreshToken);
        }
        if (password) {
            updateData.password = encrypt(password);
        }
        if (tags !== undefined) {
            updateData.tags = normalizeTags(tags);
        }

        const account = await prisma.$transaction(async (tx) => {
            if (Array.isArray(updateData.tags) && updateData.tags.length) {
                await ensureEmailTagMetadata(tx, updateData.tags);
            }

            return tx.emailAccount.update({
                where: { id },
                data: updateData,
                select: {
                    id: true,
                    email: true,
                    clientId: true,
                    tags: true,
                    status: true,
                    updatedAt: true,
                },
            });
        });

        return account;
    },

    /**
     * 更新邮箱状态
     */
    async updateStatus(id: number, status: 'ACTIVE' | 'ERROR' | 'DISABLED', errorMessage?: string | null) {
        await prisma.emailAccount.update({
            where: { id },
            data: {
                status,
                errorMessage: errorMessage || null,
                lastCheckAt: new Date(),
            },
        });
    },

    /**
     * 仅更新时间，不改动邮箱状态
     */
    async touchLastCheckAt(id: number) {
        await prisma.emailAccount.update({
            where: { id },
            data: {
                lastCheckAt: new Date(),
            },
        });
    },

    /**
     * 删除邮箱账户
     */
    async delete(id: number) {
        const exists = await prisma.emailAccount.findUnique({ where: { id } });
        if (!exists) {
            throw new AppError('NOT_FOUND', 'Email account not found', 404);
        }

        await prisma.emailAccount.delete({ where: { id } });
        return { success: true };
    },

    /**
     * 批量删除
     */
    async batchDelete(ids: number[]) {
        await prisma.emailAccount.deleteMany({
            where: { id: { in: ids } },
        });
        return { deleted: ids.length };
    },

    /**
     * 批量导入
     */
    async import(input: ImportEmailInput) {
        const { content, separator, groupId } = input;
        const lines = sanitizeImportLines(content);

        if (!lines.length) {
            throw new AppError('INVALID_IMPORT_CONTENT', 'No valid email rows found after cleanup', 400);
        }

        const effectiveSeparator = detectSeparator(lines, separator);

        if (groupId !== undefined) {
            const group = await prisma.emailGroup.findUnique({ where: { id: groupId } });
            if (!group) {
                throw new AppError('GROUP_NOT_FOUND', 'Email group not found', 404);
            }
        }

        let success = 0;
        let failed = 0;
        const errors: string[] = [];

        for (const line of lines) {
            try {
                const parsed = parseImportLineBySeparator(line, effectiveSeparator);
                if (!parsed) {
                    throw new Error('Invalid format');
                }

                const { email, clientId, refreshToken, password } = parsed;
                const encryptedRefreshToken = encrypt(refreshToken);

                const data: Prisma.EmailAccountUncheckedUpdateInput = {
                    clientId,
                    refreshToken: encryptedRefreshToken,
                    status: 'ACTIVE',
                };
                if (password) data.password = encrypt(password);
                if (groupId !== undefined) data.groupId = groupId;

                // 检查是否存在
                const exists = await prisma.emailAccount.findUnique({ where: { email } });
                if (exists) {
                    // 更新
                    await prisma.emailAccount.update({
                        where: { email },
                        data,
                    });
                } else {
                    // 创建
                    const createData: Prisma.EmailAccountUncheckedCreateInput = {
                        email,
                        clientId,
                        refreshToken: encryptedRefreshToken,
                        status: 'ACTIVE',
                    };
                    if (password) {
                        createData.password = encrypt(password);
                    }
                    if (groupId !== undefined) {
                        createData.groupId = groupId;
                    }
                    await prisma.emailAccount.create({
                        data: createData,
                    });
                }
                success++;
            } catch (err) {
                failed++;
                errors.push(`Line "${line.substring(0, 30)}...": ${(err as Error).message}`);
            }
        }

        if (success > 0) {
            await syncEmailTagMetadataFromAccounts(prisma);
        }

        return { success, failed, errors };
    },

    /**
     * 导出
     */
    async export(ids?: number[], separator = '----', groupId?: number, includePassword = false) {
        const where: Prisma.EmailAccountWhereInput = {};
        if (ids?.length) {
            where.id = { in: ids };
        }
        if (groupId !== undefined) {
            where.groupId = groupId;
        }

        const accounts = await prisma.emailAccount.findMany({
            where,
            select: {
                email: true,
                clientId: true,
                refreshToken: true,
                password: includePassword,
            },
        });

        const lines = accounts.map((acc: { email: string; clientId: string; refreshToken: string; password?: string | null }) => {
            const token = decrypt(acc.refreshToken);
            if (includePassword) {
                const pwd = acc.password ? decrypt(acc.password) : '';
                return `${acc.email}${separator}${pwd}${separator}${acc.clientId}${separator}${token}`;
            }
            return `${acc.email}${separator}${acc.clientId}${separator}${token}`;
        });

        return lines.join('\n');
    },

    /**
     * 获取统计
     */
    async getStats() {
        const [total, active, error] = await Promise.all([
            prisma.emailAccount.count(),
            prisma.emailAccount.count({ where: { status: 'ACTIVE' } }),
            prisma.emailAccount.count({ where: { status: 'ERROR' } }),
        ]);

        return { total, active, error };
    },
};
