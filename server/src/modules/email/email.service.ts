import prisma from '../../lib/prisma.js';
import { encrypt, decrypt } from '../../lib/crypto.js';
import { AppError } from '../../plugins/error.js';
import type { Prisma } from '@prisma/client';
import type { CreateEmailInput, UpdateEmailInput, ListEmailInput, ImportEmailInput } from './email.schema.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const AUTO_SEPARATOR_CANDIDATES = ['----', '|', ',', ';', '\t', ':'] as const;

type ParsedImportLine = {
    email: string;
    clientId: string;
    refreshToken: string;
    password?: string;
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
        const { page, pageSize, status, keyword, groupId, groupName } = input;
        const skip = (page - 1) * pageSize;

        const where: Prisma.EmailAccountWhereInput = {};
        if (status) where.status = status;
        if (keyword) {
            where.email = { contains: keyword };
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
     * 获取邮箱详情
     */
    async getById(id: number, includeSecrets = false) {
        const email = await prisma.emailAccount.findUnique({
            where: { id },
            select: {
                id: true,
                email: true,
                clientId: true,
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
        const { email, clientId, refreshToken, password, groupId } = input;

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
                refreshToken: encryptedToken,
                password: encryptedPassword,
                groupId: groupId || null,
            },
            select: {
                id: true,
                email: true,
                clientId: true,
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

        const { refreshToken, password, ...rest } = input;
        const updateData: Prisma.EmailAccountUpdateInput = { ...rest };

        // 加密 sensitive data
        if (refreshToken) {
            updateData.refreshToken = encrypt(refreshToken);
        }
        if (password) {
            updateData.password = encrypt(password);
        }

        const account = await prisma.emailAccount.update({
            where: { id },
            data: updateData,
            select: {
                id: true,
                email: true,
                clientId: true,
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
