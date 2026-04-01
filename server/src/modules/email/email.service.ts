import prisma from '../../lib/prisma.js';
import { encrypt, decrypt } from '../../lib/crypto.js';
import { AppError } from '../../plugins/error.js';
import type { Prisma } from '@prisma/client';
import type {
    CreateEmailInput,
    UpdateEmailInput,
    ListEmailInput,
    ImportEmailInput,
    ListEmailTagsInput,
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

const normalizeTags = (tags?: string[] | null): string[] =>
    Array.from(
        new Set(
            (tags ?? [])
                .map((tag) => tag.trim())
                .filter(Boolean)
        )
    );

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
        const normalizedKeyword = keyword?.trim();
        const pattern = normalizedKeyword ? `%${normalizedKeyword}%` : undefined;

        let rows: Array<{ tag: string; emailCount: bigint | number }> = [];
        let totalRows: Array<{ total: bigint | number }> = [];

        if (pattern) {
            [rows, totalRows] = await Promise.all([
                prisma.$queryRaw<Array<{ tag: string; emailCount: bigint | number }>>`
                    SELECT
                        src.tag,
                        COUNT(DISTINCT src."emailId")::bigint AS "emailCount"
                    FROM (
                        SELECT ea."id" AS "emailId", btrim(t.tag) AS tag
                        FROM "email_accounts" ea
                        CROSS JOIN LATERAL unnest(ea."tags") AS t(tag)
                    ) src
                    WHERE src.tag <> ''
                      AND src.tag ILIKE ${pattern}
                    GROUP BY src.tag
                    ORDER BY "emailCount" DESC, src.tag ASC
                    OFFSET ${skip}
                    LIMIT ${pageSize}
                `,
                prisma.$queryRaw<Array<{ total: bigint | number }>>`
                    SELECT COUNT(*)::bigint AS total
                    FROM (
                        SELECT DISTINCT btrim(t.tag) AS tag
                        FROM "email_accounts" ea
                        CROSS JOIN LATERAL unnest(ea."tags") AS t(tag)
                        WHERE btrim(t.tag) <> ''
                          AND btrim(t.tag) ILIKE ${pattern}
                    ) distinct_tags
                `,
            ]);
        } else {
            [rows, totalRows] = await Promise.all([
                prisma.$queryRaw<Array<{ tag: string; emailCount: bigint | number }>>`
                    SELECT
                        src.tag,
                        COUNT(DISTINCT src."emailId")::bigint AS "emailCount"
                    FROM (
                        SELECT ea."id" AS "emailId", btrim(t.tag) AS tag
                        FROM "email_accounts" ea
                        CROSS JOIN LATERAL unnest(ea."tags") AS t(tag)
                    ) src
                    WHERE src.tag <> ''
                    GROUP BY src.tag
                    ORDER BY "emailCount" DESC, src.tag ASC
                    OFFSET ${skip}
                    LIMIT ${pageSize}
                `,
                prisma.$queryRaw<Array<{ total: bigint | number }>>`
                    SELECT COUNT(*)::bigint AS total
                    FROM (
                        SELECT DISTINCT btrim(t.tag) AS tag
                        FROM "email_accounts" ea
                        CROSS JOIN LATERAL unnest(ea."tags") AS t(tag)
                        WHERE btrim(t.tag) <> ''
                    ) distinct_tags
                `,
            ]);
        }

        return {
            list: rows.map((row) => ({
                tag: row.tag,
                emailCount: Number(row.emailCount),
            })),
            total: Number(totalRows[0]?.total ?? 0),
            page,
            pageSize,
        };
    },

    /**
     * 标签管理：批量为指定邮箱添加标签
     */
    async batchAddTags(input: BatchAddEmailTagsInput) {
        const emailIds = Array.from(
            new Set(
                input.emailIds
                    .map((id) => Number(id))
                    .filter((id) => Number.isInteger(id) && id > 0)
            )
        );
        const tagsToAdd = normalizeTags(input.tags);

        if (!emailIds.length || !tagsToAdd.length) {
            return { updated: 0 };
        }

        const accounts = await prisma.emailAccount.findMany({
            where: { id: { in: emailIds } },
            select: {
                id: true,
                tags: true,
            },
        });

        if (!accounts.length) {
            return { updated: 0 };
        }

        await prisma.$transaction(
            accounts.map((account) =>
                prisma.emailAccount.update({
                    where: { id: account.id },
                    data: {
                        tags: normalizeTags([...(account.tags || []), ...tagsToAdd]),
                    },
                })
            )
        );

        return { updated: accounts.length };
    },

    /**
     * 标签管理：批量删除标签（全局）
     */
    async batchDeleteTags(input: BatchDeleteEmailTagsInput) {
        const tagsToDelete = normalizeTags(input.tags);
        if (!tagsToDelete.length) {
            return { updated: 0 };
        }

        const normalizedDeleteSet = new Set(tagsToDelete.map((tag) => tag.toLowerCase()));

        const accounts = await prisma.emailAccount.findMany({
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
            .map((account) => {
                const filteredTags = account.tags.filter((tag) => {
                    const normalized = tag.trim().toLowerCase();
                    return normalized && !normalizedDeleteSet.has(normalized);
                });

                if (filteredTags.length === account.tags.length) {
                    return null;
                }

                return {
                    id: account.id,
                    tags: normalizeTags(filteredTags),
                };
            })
            .filter((item): item is { id: number; tags: string[] } => item !== null);

        if (!updates.length) {
            return { updated: 0 };
        }

        await prisma.$transaction(
            updates.map((item) =>
                prisma.emailAccount.update({
                    where: { id: item.id },
                    data: { tags: item.tags },
                })
            )
        );

        return { updated: updates.length };
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

        const account = await prisma.emailAccount.create({
            data: {
                email,
                clientId,
                tags: normalizeTags(tags),
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

        const account = await prisma.emailAccount.update({
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
