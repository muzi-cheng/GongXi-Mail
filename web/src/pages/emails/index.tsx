import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Table,
    Card,
    Button,
    Space,
    Pagination,
    Modal,
    Form,
    Input,
    Select,
    message,
    Popconfirm,
    Tag,
    Typography,
    Upload,
    Tooltip,
    List,
    Tabs,
    Spin,
    Checkbox,
    Grid,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
    PlusOutlined,
    EditOutlined,
    DeleteOutlined,
    UploadOutlined,
    DownloadOutlined,
    InboxOutlined,
    SearchOutlined,
    MailOutlined,
    GroupOutlined,
    SyncOutlined,
    EyeOutlined,
    EyeInvisibleOutlined,
} from '@ant-design/icons';
import { emailApi, groupApi } from '../../api';
import { PageHeader } from '../../components';
import { getErrorMessage } from '../../utils/error';
import { requestData } from '../../utils/request';
import dayjs from 'dayjs';
import './index.css';

const { Text } = Typography;
const { TextArea } = Input;
const { Dragger } = Upload;
const MAIL_FETCH_STRATEGY_OPTIONS = [
    { value: 'GRAPH_FIRST', label: 'Graph 优先（失败回退 IMAP）' },
    { value: 'IMAP_FIRST', label: 'IMAP 优先（失败回退 Graph）' },
    { value: 'GRAPH_ONLY', label: '仅 Graph' },
    { value: 'IMAP_ONLY', label: '仅 IMAP' },
] as const;

type MailFetchStrategy = (typeof MAIL_FETCH_STRATEGY_OPTIONS)[number]['value'];

const MAIL_FETCH_STRATEGY_LABELS: Record<MailFetchStrategy, string> = {
    GRAPH_FIRST: 'Graph 优先',
    IMAP_FIRST: 'IMAP 优先',
    GRAPH_ONLY: '仅 Graph',
    IMAP_ONLY: '仅 IMAP',
};

interface EmailGroup {
    id: number;
    name: string;
    description: string | null;
    fetchStrategy: MailFetchStrategy;
    emailCount: number;
    createdAt: string;
    updatedAt: string;
}

interface EmailAccount {
    id: number;
    email: string;
    hasPassword: boolean;
    clientId: string;
    tags: string[];
    status: 'ACTIVE' | 'ERROR' | 'DISABLED';
    groupId: number | null;
    group: { id: number; name: string } | null;
    lastCheckAt: string | null;
    tokenRefreshedAt: string | null;
    errorMessage: string | null;
    createdAt: string;
}

interface EmailListResult {
    list: EmailAccount[];
    total: number;
}

interface EmailTagItem {
    id: number;
    name: string;
    description: string | null;
    createdAt: string;
    emailCount: number;
}

interface EmailTagListResult {
    list: EmailTagItem[];
    total: number;
}

interface MailItem {
    id: string;
    from: string;
    subject: string;
    text: string;
    html: string;
    date: string;
}

interface EmailDetailsResult extends EmailAccount {
    refreshToken: string;
}

const EMAIL_COLUMN_WIDTH = 240;
const PASSWORD_MASK = '****************';
const EMAIL_TABLE_STICKY_OFFSET = 56;

const renderMutedPlaceholder = (value: string = '-') => <Text type="secondary">{value}</Text>;

const normalizeTagValues = (value: unknown): string[] => {
    if (!Array.isArray(value)) {
        return [];
    }

    const seen = new Set<string>();

    return value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => {
            if (!item) {
                return false;
            }

            const normalizedKey = item.toLowerCase();
            if (seen.has(normalizedKey)) {
                return false;
            }

            seen.add(normalizedKey);
            return true;
        });
};

const normalizeLineValues = (value: string): string[] => {
    const seen = new Set<string>();

    return value
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter((item) => {
            if (!item) {
                return false;
            }

            const normalizedKey = item.toLowerCase();
            if (seen.has(normalizedKey)) {
                return false;
            }

            seen.add(normalizedKey);
            return true;
        });
};

const fallbackCopyText = (value: string): boolean => {
    if (typeof document === 'undefined') {
        return false;
    }

    const textArea = document.createElement('textarea');
    textArea.value = value;
    textArea.setAttribute('readonly', 'true');
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    textArea.style.pointerEvents = 'none';

    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
        return document.execCommand('copy');
    } catch {
        return false;
    } finally {
        document.body.removeChild(textArea);
    }
};

const EmailsPage: React.FC = () => {
    const screens = Grid.useBreakpoint();
    const isMobile = !screens.md;
    const useHorizontalScroll = !screens.xl;

    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<EmailAccount[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
    const [modalVisible, setModalVisible] = useState(false);
    const [importModalVisible, setImportModalVisible] = useState(false);
    const [exportModalVisible, setExportModalVisible] = useState(false);
    const [exportIncludePassword, setExportIncludePassword] = useState(false);
    const [mailModalVisible, setMailModalVisible] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [keyword, setKeyword] = useState('');
    const [debouncedKeyword, setDebouncedKeyword] = useState('');
    const [tagKeyword, setTagKeyword] = useState('');
    const [debouncedTagKeyword, setDebouncedTagKeyword] = useState('');
    const [filterGroupId, setFilterGroupId] = useState<number | undefined>(undefined);
    const [importContent, setImportContent] = useState('');
    const [separator, setSeparator] = useState('----');
    const [importGroupId, setImportGroupId] = useState<number | undefined>(undefined);
    const [mailList, setMailList] = useState<MailItem[]>([]);
    const [mailLoading, setMailLoading] = useState(false);
    const [currentEmail, setCurrentEmail] = useState<string>('');
    const [currentEmailId, setCurrentEmailId] = useState<number | null>(null);
    const [currentMailbox, setCurrentMailbox] = useState<string>('INBOX');
    const [emailDetailVisible, setEmailDetailVisible] = useState(false);
    const [emailDetailContent, setEmailDetailContent] = useState<string>('');
    const [emailDetailSubject, setEmailDetailSubject] = useState<string>('');
    const [emailEditLoading, setEmailEditLoading] = useState(false);
    const [form] = Form.useForm();

    // Group-related state
    const [groups, setGroups] = useState<EmailGroup[]>([]);
    const [groupModalVisible, setGroupModalVisible] = useState(false);
    const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
    const [groupForm] = Form.useForm();
    const [assignGroupModalVisible, setAssignGroupModalVisible] = useState(false);
    const [assignTargetGroupId, setAssignTargetGroupId] = useState<number | undefined>(undefined);
    const [refreshingTokenIds, setRefreshingTokenIds] = useState<Set<number>>(new Set());
    const [visiblePasswordIds, setVisiblePasswordIds] = useState<Set<number>>(new Set());
    const [passwordById, setPasswordById] = useState<Record<number, string | null>>({});
    const [passwordLoadingIds, setPasswordLoadingIds] = useState<Set<number>>(new Set());
    const [batchRefreshing, setBatchRefreshing] = useState(false);
    const [activeTab, setActiveTab] = useState<'emails' | 'tags' | 'groups'>('emails');
    const [groupKeyword, setGroupKeyword] = useState('');
    const [debouncedGroupKeyword, setDebouncedGroupKeyword] = useState('');
    const [groupPage, setGroupPage] = useState(1);
    const [groupPageSize, setGroupPageSize] = useState(20);
    const [groupItems, setGroupItems] = useState<EmailGroup[]>([]);
    const [groupListLoading, setGroupListLoading] = useState(false);
    const [tagItems, setTagItems] = useState<EmailTagItem[]>([]);
    const [tagTotal, setTagTotal] = useState(0);
    const [tagPage, setTagPage] = useState(1);
    const [tagPageSize, setTagPageSize] = useState(20);
    const [tagListLoading, setTagListLoading] = useState(false);
    const [tagManageKeyword, setTagManageKeyword] = useState('');
    const [debouncedTagManageKeyword, setDebouncedTagManageKeyword] = useState('');
    const [selectedGroupRowKeys, setSelectedGroupRowKeys] = useState<React.Key[]>([]);
    const [selectedTagRowKeys, setSelectedTagRowKeys] = useState<React.Key[]>([]);
    const [tagModalVisible, setTagModalVisible] = useState(false);
    const [editingTagId, setEditingTagId] = useState<number | null>(null);
    const [tagSubmitting, setTagSubmitting] = useState(false);
    const [tagForm] = Form.useForm();
    const [batchDeleteTagLoading, setBatchDeleteTagLoading] = useState(false);
    const [batchDeleteGroupLoading, setBatchDeleteGroupLoading] = useState(false);
    const [groupSubmitting, setGroupSubmitting] = useState(false);
    const latestListRequestIdRef = useRef(0);
    const latestTagListRequestIdRef = useRef(0);
    const latestGroupListRequestIdRef = useRef(0);

    const toOptionalNumber = (value: unknown): number | undefined => {
        if (value === undefined || value === null || value === '') {
            return undefined;
        }
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    };

    const fetchGroups = useCallback(async () => {
        const result = await requestData<EmailGroup[]>(
            () => groupApi.getList(),
            '获取分组失败',
            { silent: true }
        );
        if (result) {
            setGroups(result);
        }
    }, []);

    const fetchData = useCallback(async () => {
        const currentRequestId = ++latestListRequestIdRef.current;
        setLoading(true);
        const params: { page: number; pageSize: number; keyword: string; tagKeyword?: string; groupId?: number } = {
            page,
            pageSize,
            keyword: debouncedKeyword,
        };
        if (debouncedTagKeyword) params.tagKeyword = debouncedTagKeyword;
        if (filterGroupId !== undefined) params.groupId = filterGroupId;

        const result = await requestData<EmailListResult>(
            () => emailApi.getList(params),
            '获取数据失败'
        );
        if (currentRequestId !== latestListRequestIdRef.current) {
            return;
        }
        if (result) {
            setData(result.list);
            setTotal(result.total);
        }
        setLoading(false);
    }, [debouncedKeyword, debouncedTagKeyword, filterGroupId, page, pageSize]);

    const fetchTagData = useCallback(async () => {
        const currentRequestId = ++latestTagListRequestIdRef.current;
        setTagListLoading(true);

        const params: { page: number; pageSize: number; keyword?: string } = {
            page: tagPage,
            pageSize: tagPageSize,
        };
        if (debouncedTagManageKeyword) {
            params.keyword = debouncedTagManageKeyword;
        }

        const result = await requestData<EmailTagListResult>(
            () => emailApi.getTagList(params),
            '获取标签列表失败'
        );

        if (currentRequestId !== latestTagListRequestIdRef.current) {
            return;
        }

        if (result) {
            setTagItems(result.list || []);
            setTagTotal(result.total || 0);
        }

        setTagListLoading(false);
    }, [debouncedTagManageKeyword, tagPage, tagPageSize]);

    const fetchGroupData = useCallback(async () => {
        const currentRequestId = ++latestGroupListRequestIdRef.current;
        setGroupListLoading(true);

        const params = debouncedGroupKeyword
            ? { keyword: debouncedGroupKeyword }
            : undefined;

        const result = await requestData<EmailGroup[]>(
            () => groupApi.getList(params),
            '获取分组列表失败',
            { silent: true }
        );

        if (currentRequestId !== latestGroupListRequestIdRef.current) {
            return;
        }

        if (result) {
            setGroupItems(result);
        }

        setGroupListLoading(false);
    }, [debouncedGroupKeyword]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void fetchGroups();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [fetchGroups]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setDebouncedKeyword(keyword.trim());
        }, 300);
        return () => window.clearTimeout(timer);
    }, [keyword]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setDebouncedTagKeyword(tagKeyword.trim());
        }, 300);
        return () => window.clearTimeout(timer);
    }, [tagKeyword]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setDebouncedTagManageKeyword(tagManageKeyword.trim());
        }, 300);
        return () => window.clearTimeout(timer);
    }, [tagManageKeyword]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setDebouncedGroupKeyword(groupKeyword.trim());
        }, 300);
        return () => window.clearTimeout(timer);
    }, [groupKeyword]);

    useEffect(() => {
        setPage(1);
    }, [debouncedKeyword, debouncedTagKeyword]);

    useEffect(() => {
        setTagPage(1);
    }, [debouncedTagManageKeyword]);

    useEffect(() => {
        setGroupPage(1);
    }, [debouncedGroupKeyword]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void fetchData();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [fetchData]);

    useEffect(() => {
        if (activeTab !== 'tags') {
            return;
        }

        const timer = window.setTimeout(() => {
            void fetchTagData();
        }, 0);

        return () => window.clearTimeout(timer);
    }, [activeTab, fetchTagData]);

    useEffect(() => {
        if (activeTab !== 'groups') {
            return;
        }

        const timer = window.setTimeout(() => {
            void fetchGroupData();
        }, 0);

        return () => window.clearTimeout(timer);
    }, [activeTab, fetchGroupData, groups]);

    const handleCreate = () => {
        setEditingId(null);
        setEmailEditLoading(false);
        form.resetFields();
        form.setFieldsValue({ status: 'ACTIVE', tags: [] });
        setModalVisible(true);
    };

    const handleEdit = useCallback(async (record: EmailAccount) => {
        setEditingId(record.id);
        setEmailEditLoading(true);
        form.resetFields();
        setModalVisible(true);
        try {
            const res = await emailApi.getById<EmailDetailsResult>(record.id, true);
            if (res.code === 200) {
                const details = res.data;
                form.setFieldsValue({
                    email: details.email,
                    clientId: details.clientId,
                    refreshToken: details.refreshToken,
                    status: details.status,
                    groupId: details.groupId,
                    tags: details.tags || [],
                });
            }
        } catch {
            message.error('获取详情失败');
        } finally {
            setEmailEditLoading(false);
        }
    }, [form]);

    const handleDelete = useCallback(async (id: number) => {
        try {
            const res = await emailApi.delete(id);
            if (res.code === 200) {
                message.success('删除成功');
                fetchData();
                fetchGroups();
            } else {
                message.error(res.message);
            }
        } catch (err: unknown) {
            message.error(getErrorMessage(err, '删除失败'));
        }
    }, [fetchData, fetchGroups]);

    const handleBatchDelete = async () => {
        if (selectedRowKeys.length === 0) {
            message.warning('请选择要删除的邮箱');
            return;
        }

        try {
            const res = await emailApi.batchDelete(selectedRowKeys as number[]);
            if (res.code === 200) {
                message.success(`成功删除 ${res.data.deleted} 个邮箱`);
                setSelectedRowKeys([]);
                fetchData();
                fetchGroups();
            } else {
                message.error(res.message);
            }
        } catch (err: unknown) {
            message.error(getErrorMessage(err, '删除失败'));
        }
    };

    const handleSubmit = async () => {
        try {
            const values = await form.validateFields();
            const normalizedGroupId =
                values.groupId === null ? null : toOptionalNumber(values.groupId);
            const normalizedTags = normalizeTagValues(values.tags);

            if (editingId) {
                const submitData = {
                    ...values,
                    tags: normalizedTags,
                    groupId: normalizedGroupId ?? null,
                };
                const res = await emailApi.update(editingId, submitData);
                if (res.code === 200) {
                    message.success('更新成功');
                    setModalVisible(false);
                    fetchData();
                    fetchGroups();
                } else {
                    message.error(res.message);
                }
            } else {
                const submitData = {
                    ...values,
                    tags: normalizedTags,
                    groupId: toOptionalNumber(values.groupId),
                };
                const res = await emailApi.create(submitData);
                if (res.code === 200) {
                    message.success('创建成功');
                    setModalVisible(false);
                    fetchData();
                    fetchGroups();
                } else {
                    message.error(res.message);
                }
            }
        } catch (err: unknown) {
            message.error(getErrorMessage(err, '保存失败'));
        }
    };

    const handleImport = async () => {
        if (!importContent.trim()) {
            message.warning('请输入或粘贴邮箱数据');
            return;
        }

        try {
            const res = await emailApi.import(
                importContent,
                separator,
                toOptionalNumber(importGroupId)
            );
            if (res.code === 200) {
                message.success(res.message);
                setImportModalVisible(false);
                setImportContent('');
                setImportGroupId(undefined);
                fetchData();
                fetchGroups();
            } else {
                message.error(res.message);
            }
        } catch (err: unknown) {
            message.error(getErrorMessage(err, '导入失败'));
        }
    };

    const handleExport = async () => {
        setExportModalVisible(true);
    };

    const handleConfirmExport = async () => {
        try {
            const ids = selectedRowKeys.length > 0 ? selectedRowKeys as number[] : undefined;
            const groupId = ids ? undefined : toOptionalNumber(filterGroupId);
            const res = await emailApi.export(ids, separator, groupId, exportIncludePassword);
            if (res.code !== 200) {
                message.error(res.message || '导出失败');
                return;
            }
            const content = res.data?.content || '';

            const blob = new Blob([content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'email_accounts.txt';
            a.click();
            URL.revokeObjectURL(url);

            setExportModalVisible(false);
            setExportIncludePassword(false);
            message.success('导出成功');
        } catch (err: unknown) {
            message.error(getErrorMessage(err, '导出失败'));
        }
    };

    const loadMails = useCallback(async (emailId: number, mailbox: string, showSuccessToast: boolean = false) => {
        setMailLoading(true);
        const result = await requestData<{ messages: MailItem[] }>(
            () => emailApi.viewMails(emailId, mailbox),
            '获取邮件失败'
        );
        if (result) {
            setMailList(result.messages || []);
            fetchData();
            if (showSuccessToast) {
                message.success('刷新成功');
            }
        }
        setMailLoading(false);
    }, [fetchData]);

    const handleViewMails = useCallback(async (record: EmailAccount, mailbox: string) => {
        setCurrentEmail(record.email);
        setCurrentEmailId(record.id);
        setCurrentMailbox(mailbox);
        setMailModalVisible(true);
        await loadMails(record.id, mailbox);
    }, [loadMails]);

    const handleRefreshMails = async () => {
        if (!currentEmailId) return;
        await loadMails(currentEmailId, currentMailbox, true);
    };

    const handleClearMailbox = async () => {
        if (!currentEmailId) return;
        try {
            const res = await emailApi.clearMailbox(currentEmailId, currentMailbox);
            if (res.code === 200) {
                message.success(`已清空 ${res.data?.deletedCount || 0} 封邮件`);
                setMailList([]);
                fetchData();
            } else {
                message.error(res.message || '清空失败');
            }
        } catch (err: unknown) {
            message.error(getErrorMessage(err, '清空失败'));
        }
    };

    // ========================================
    // Token refresh handlers
    // ========================================
    const handleRefreshToken = useCallback(async (record: EmailAccount) => {
        setRefreshingTokenIds(prev => new Set(prev).add(record.id));
        try {
            const res = await emailApi.refreshSingleToken(record.id);
            if (res.code === 200 && res.data?.success) {
                message.success(`${record.email} Token 刷新成功`);
                fetchData();
            } else {
                message.error(res.data?.message || 'Token 刷新失败');
            }
        } catch (err: unknown) {
            message.error(getErrorMessage(err, 'Token 刷新失败'));
        } finally {
            setRefreshingTokenIds(prev => {
                const next = new Set(prev);
                next.delete(record.id);
                return next;
            });
        }
    }, [fetchData]);

    const handleBatchRefreshTokens = async () => {
        setBatchRefreshing(true);
        try {
            const res = await emailApi.refreshTokens(filterGroupId);
            if (res.code === 200) {
                message.success('批量 Token 刷新任务已启动，请稍后刷新页面查看结果');
            } else {
                message.error(res.message || '启动失败');
            }
        } catch (err: unknown) {
            message.error(getErrorMessage(err, '启动失败'));
        } finally {
            setBatchRefreshing(false);
        }
    };

    const handleTogglePassword = useCallback(async (record: EmailAccount) => {
        if (!record.hasPassword) {
            return;
        }

        const id = record.id;
        const isVisible = visiblePasswordIds.has(id);

        if (isVisible) {
            setVisiblePasswordIds((prev) => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
            return;
        }

        if (Object.prototype.hasOwnProperty.call(passwordById, id)) {
            setVisiblePasswordIds((prev) => new Set(prev).add(id));
            return;
        }

        setPasswordLoadingIds((prev) => new Set(prev).add(id));
        try {
            const res = await emailApi.getPasswordById(id);
            if (res.code === 200) {
                setPasswordById((prev) => ({
                    ...prev,
                    [id]: res.data?.password ?? null,
                }));
                setVisiblePasswordIds((prev) => new Set(prev).add(id));
            } else {
                message.error(res.message || '获取密码失败');
            }
        } catch (err: unknown) {
            message.error(getErrorMessage(err, '获取密码失败'));
        } finally {
            setPasswordLoadingIds((prev) => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        }
    }, [passwordById, visiblePasswordIds]);

    const handleCopyEmail = useCallback(async (email: string) => {
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(email);
            } else if (!fallbackCopyText(email)) {
                throw new Error('Clipboard API unavailable');
            }

            message.success('邮箱已复制');
        } catch {
            if (fallbackCopyText(email)) {
                message.success('邮箱已复制');
                return;
            }

            message.error('复制失败，请手动复制');
        }
    }, []);

    const handleViewEmailDetail = (record: MailItem) => {
        setEmailDetailSubject(record.subject || '无主题');
        setEmailDetailContent(record.html || record.text || '无内容');
        setEmailDetailVisible(true);
    };

    // ========================================
    // Group CRUD handlers
    // ========================================
    const handleCreateGroup = () => {
        setEditingGroupId(null);
        groupForm.resetFields();
        groupForm.setFieldsValue({
            namesText: '',
            description: '',
            fetchStrategy: 'GRAPH_FIRST',
        });
        setGroupModalVisible(true);
    };

    const handleEditGroup = useCallback((group: EmailGroup) => {
        setEditingGroupId(group.id);
        groupForm.resetFields();
        groupForm.setFieldsValue({
            name: group.name,
            description: group.description,
            fetchStrategy: group.fetchStrategy,
        });
        setGroupModalVisible(true);
    }, [groupForm]);

    const handleDeleteGroup = useCallback(async (id: number) => {
        try {
            const res = await groupApi.delete(id);
            if (res.code === 200) {
                message.success('分组已删除');
                fetchGroups();
                fetchData();
            }
        } catch (err: unknown) {
            message.error(getErrorMessage(err, '删除失败'));
        }
    }, [fetchData, fetchGroups]);

    const handleGroupSubmit = async () => {
        setGroupSubmitting(true);
        try {
            const values = await groupForm.validateFields();
            if (editingGroupId) {
                const res = await groupApi.update(editingGroupId, {
                    name: values.name,
                    description: values.description,
                    fetchStrategy: values.fetchStrategy,
                });
                if (res.code === 200) {
                    message.success('分组已更新');
                    setGroupModalVisible(false);
                    setSelectedGroupRowKeys([]);
                    fetchGroups();
                    fetchData();
                }
            } else {
                const groupNames = normalizeLineValues(values.namesText || '');
                if (groupNames.length === 0) {
                    message.warning('请至少输入一个分组名称');
                    return;
                }

                const createRequests = groupNames.map((name) =>
                    groupApi.create({
                        name,
                        description: values.description,
                        fetchStrategy: values.fetchStrategy,
                    })
                );

                const results = await Promise.allSettled(createRequests);
                let successCount = 0;
                let failedCount = 0;

                for (const result of results) {
                    if (result.status === 'fulfilled' && result.value.code === 200) {
                        successCount += 1;
                    } else {
                        failedCount += 1;
                    }
                }

                if (successCount > 0) {
                    message.success(`成功创建 ${successCount} 个分组`);
                    setGroupModalVisible(false);
                    setSelectedGroupRowKeys([]);
                    fetchGroups();
                    fetchData();
                }

                if (failedCount > 0) {
                    message.warning(`${failedCount} 个分组创建失败（可能名称重复）`);
                }
            }
        } catch (err: unknown) {
            message.error(getErrorMessage(err, '分组保存失败'));
        } finally {
            setGroupSubmitting(false);
        }
    };

    const handleBatchDeleteGroups = async () => {
        const groupIds = selectedGroupRowKeys
            .map((key) => Number(key))
            .filter((id) => Number.isInteger(id) && id > 0);

        if (groupIds.length === 0) {
            message.warning('请先选择分组');
            return;
        }

        setBatchDeleteGroupLoading(true);
        try {
            const results = await Promise.allSettled(groupIds.map((id) => groupApi.delete(id)));

            let successCount = 0;
            let failedCount = 0;

            for (const result of results) {
                if (result.status === 'fulfilled' && result.value.code === 200) {
                    successCount += 1;
                } else {
                    failedCount += 1;
                }
            }

            if (successCount > 0) {
                message.success(`成功删除 ${successCount} 个分组`);
            }
            if (failedCount > 0) {
                message.warning(`${failedCount} 个分组删除失败`);
            }

            setSelectedGroupRowKeys([]);
            fetchGroups();
            fetchData();
        } catch (err: unknown) {
            message.error(getErrorMessage(err, '批量删除分组失败'));
        } finally {
            setBatchDeleteGroupLoading(false);
        }
    };

    const handleBatchAssignGroup = async () => {
        if (selectedRowKeys.length === 0) {
            message.warning('请先选择邮箱');
            return;
        }
        if (!assignTargetGroupId) {
            message.warning('请选择目标分组');
            return;
        }
        try {
            const res = await groupApi.assignEmails(assignTargetGroupId, selectedRowKeys as number[]);
            if (res.code === 200) {
                message.success(`已将 ${res.data.count} 个邮箱分配到分组`);
                setAssignGroupModalVisible(false);
                setAssignTargetGroupId(undefined);
                setSelectedRowKeys([]);
                fetchData();
                fetchGroups();
            }
        } catch (err: unknown) {
            message.error(getErrorMessage(err, '分配失败'));
        }
    };

    const handleBatchRemoveGroup = async () => {
        if (selectedRowKeys.length === 0) {
            message.warning('请先选择邮箱');
            return;
        }
        // Find the groupIds of selected emails, remove from each group
        const selectedEmails = data.filter((e: EmailAccount) => selectedRowKeys.includes(e.id));
        const groupIds = [...new Set(selectedEmails.map((e: EmailAccount) => e.groupId).filter(Boolean))] as number[];

        try {
            for (const gid of groupIds) {
                const emailIds = selectedEmails.filter((e: EmailAccount) => e.groupId === gid).map((e: EmailAccount) => e.id);
                await groupApi.removeEmails(gid, emailIds);
            }
            message.success('已将选中邮箱移出分组');
            setSelectedRowKeys([]);
            fetchData();
            fetchGroups();
        } catch (err: unknown) {
            message.error(getErrorMessage(err, '移出失败'));
        }
    };

    const handleCreateTag = () => {
        setEditingTagId(null);
        tagForm.resetFields();
        tagForm.setFieldsValue({
            namesText: '',
            description: '',
        });
        setTagModalVisible(true);
    };

    const handleEditTag = useCallback((tag: EmailTagItem) => {
        setEditingTagId(tag.id);
        tagForm.resetFields();
        tagForm.setFieldsValue({
            name: tag.name,
            description: tag.description || '',
        });
        setTagModalVisible(true);
    }, [tagForm]);

    const handleDeleteTag = useCallback(async (id: number) => {
        try {
            const res = await emailApi.deleteTag(id);
            if (res.code === 200) {
                message.success(`标签已删除，影响 ${res.data?.updated || 0} 个邮箱`);
                setSelectedTagRowKeys((prev) => prev.filter((key) => Number(key) !== id));
                fetchData();
                fetchTagData();
            }
        } catch (err: unknown) {
            message.error(getErrorMessage(err, '删除标签失败'));
        }
    }, [fetchData, fetchTagData]);

    const handleTagSubmit = async () => {
        setTagSubmitting(true);
        try {
            const values = await tagForm.validateFields();

            if (editingTagId) {
                const res = await emailApi.updateTag(editingTagId, {
                    name: values.name,
                    description: values.description,
                });
                if (res.code === 200) {
                    message.success('标签已更新');
                    setTagModalVisible(false);
                    fetchData();
                    fetchTagData();
                }
                return;
            }

            const tagNames = normalizeLineValues(values.namesText || '');
            if (tagNames.length === 0) {
                message.warning('请至少输入一个标签名称');
                return;
            }

            const createRequests = tagNames.map((name) =>
                emailApi.createTag({
                    name,
                    description: values.description,
                })
            );

            const results = await Promise.allSettled(createRequests);
            let successCount = 0;
            let failedCount = 0;

            for (const result of results) {
                if (result.status === 'fulfilled' && result.value.code === 200) {
                    successCount += 1;
                } else {
                    failedCount += 1;
                }
            }

            if (successCount > 0) {
                message.success(`成功创建 ${successCount} 个标签`);
                setTagModalVisible(false);
                fetchData();
                fetchTagData();
            }

            if (failedCount > 0) {
                message.warning(`${failedCount} 个标签创建失败（可能名称重复）`);
            }
        } catch (err: unknown) {
            message.error(getErrorMessage(err, '标签保存失败'));
        } finally {
            setTagSubmitting(false);
        }
    };

    const handleBatchDeleteTags = async () => {
        const ids = selectedTagRowKeys
            .map((key) => Number(key))
            .filter((id) => Number.isInteger(id) && id > 0);
        if (ids.length === 0) {
            message.warning('请先选择标签');
            return;
        }

        setBatchDeleteTagLoading(true);
        try {
            const res = await emailApi.batchDeleteTags(ids);
            if (res.code === 200) {
                message.success(`成功删除 ${res.data.deleted} 个标签，影响 ${res.data.updated} 个邮箱`);
                setSelectedTagRowKeys([]);
                fetchData();
                fetchTagData();
            } else {
                message.error(res.message || '批量删除标签失败');
            }
        } catch (err: unknown) {
            message.error(getErrorMessage(err, '批量删除标签失败'));
        } finally {
            setBatchDeleteTagLoading(false);
        }
    };

    // ========================================
    // Email table columns
    // ========================================
    const columns: ColumnsType<EmailAccount> = useMemo(() => [
        {
            title: '邮箱',
            dataIndex: 'email',
            key: 'email',
            width: screens.sm ? EMAIL_COLUMN_WIDTH : 220,
            className: 'emails-table__email-column',
            render: (email: string) => (
                <button
                    type="button"
                    className="emails-table__email-button"
                    onClick={(event) => {
                        event.stopPropagation();
                        void handleCopyEmail(email);
                    }}
                >
                    <span className="emails-table__email-text">{email}</span>
                </button>
            ),
        },
        {
            title: '密码',
            dataIndex: 'hasPassword',
            key: 'password',
            width: screens.sm ? 156 : 128,
            responsive: ['sm'],
            render: (hasPassword: boolean, record: EmailAccount) => {
                if (!hasPassword) {
                    return renderMutedPlaceholder();
                }

                const visible = visiblePasswordIds.has(record.id);
                const loadingPwd = passwordLoadingIds.has(record.id);
                const password = passwordById[record.id] ?? null;
                const displayValue = visible ? (password || PASSWORD_MASK) : PASSWORD_MASK;
                return (
                    <Space size={4}>
                        <Text code className="emails-table__password-text">
                            {displayValue}
                        </Text>
                        <Tooltip title={visible ? '隐藏密码' : '显示密码'}>
                            <Button
                                type="text"
                                size="small"
                                loading={loadingPwd}
                                icon={visible ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                                onClick={() => void handleTogglePassword(record)}
                            />
                        </Tooltip>
                    </Space>
                );
            },
        },
        {
            title: '标签',
            dataIndex: 'tags',
            key: 'tags',
            width: 220,
            responsive: ['lg'],
            render: (tags: string[] | undefined) => {
                const normalizedTags = tags || [];

                if (normalizedTags.length === 0) {
                    return renderMutedPlaceholder();
                }

                return (
                    <Space size={[0, 4]} wrap>
                        {normalizedTags.map((tag) => (
                            <Tag key={tag} color="geekblue" className="emails-table__tag">
                                {tag}
                            </Tag>
                        ))}
                    </Space>
                );
            },
        },
        {
            title: '分组',
            dataIndex: 'group',
            key: 'group',
            width: 96,
            responsive: ['lg'],
            render: (group: EmailAccount['group']) =>
                group ? <Tag color="blue">{group.name}</Tag> : renderMutedPlaceholder('未分组'),
        },
        {
            title: '状态',
            dataIndex: 'status',
            key: 'status',
            width: 84,
            render: (status: string) => {
                const colors: Record<string, string> = {
                    ACTIVE: 'green',
                    ERROR: 'red',
                    DISABLED: 'default',
                };
                const labels: Record<string, string> = {
                    ACTIVE: '正常',
                    ERROR: '异常',
                    DISABLED: '禁用',
                };
                return <Tag color={colors[status]}>{labels[status]}</Tag>;
            },
        },
        {
            title: '最后检查',
            dataIndex: 'lastCheckAt',
            key: 'lastCheckAt',
            width: 112,
            responsive: ['xl'],
            render: (val: string | null) => (val ? dayjs(val).format('MM-DD HH:mm') : renderMutedPlaceholder()),
        },
        {
            title: 'Token 刷新',
            dataIndex: 'tokenRefreshedAt',
            key: 'tokenRefreshedAt',
            width: 112,
            responsive: ['xxl'],
            render: (val: string | null) => (val ? dayjs(val).format('MM-DD HH:mm') : renderMutedPlaceholder()),
        },
        {
            title: '创建时间',
            dataIndex: 'createdAt',
            key: 'createdAt',
            width: 112,
            responsive: ['xxl'],
            render: (val: string) => dayjs(val).format('MM-DD HH:mm'),
        },
        {
            title: '操作',
            key: 'action',
            width: screens.sm ? 176 : 148,
            render: (_: unknown, record: EmailAccount) => (
                <Space size={isMobile ? [4, 4] : 'small'} wrap>
                    <Tooltip title="刷新 Token">
                        <Button
                            type="text"
                            className="emails-table__action-btn"
                            icon={<SyncOutlined spin={refreshingTokenIds.has(record.id)} />}
                            onClick={() => handleRefreshToken(record)}
                            disabled={refreshingTokenIds.has(record.id) || record.status === 'DISABLED'}
                        />
                    </Tooltip>
                    <Tooltip title="收件箱">
                        <Button
                            type="text"
                            className="emails-table__action-btn"
                            icon={<MailOutlined />}
                            onClick={() => handleViewMails(record, 'INBOX')}
                        />
                    </Tooltip>
                    <Tooltip title="垃圾箱">
                        <Button
                            type="text"
                            className="emails-table__action-btn"
                            icon={<DeleteOutlined className="emails-table__junk-icon" />}
                            onClick={() => handleViewMails(record, 'Junk')}
                        />
                    </Tooltip>
                    <Tooltip title="编辑">
                        <Button
                            type="text"
                            className="emails-table__action-btn"
                            icon={<EditOutlined />}
                            onClick={() => handleEdit(record)}
                        />
                    </Tooltip>
                    <Tooltip title="删除邮箱">
                        <Popconfirm
                            title="确定要删除此邮箱吗？"
                            description={`删除后无法恢复：${record.email}`}
                            okText="删除"
                            cancelText="取消"
                            okButtonProps={{ danger: true }}
                            onConfirm={() => handleDelete(record.id)}
                        >
                            <Button
                                type="text"
                                danger
                                className="emails-table__action-btn emails-table__action-btn--danger"
                                icon={<DeleteOutlined />}
                            />
                        </Popconfirm>
                    </Tooltip>
                </Space>
            ),
        },
    ], [handleCopyEmail, handleDelete, handleEdit, handleRefreshToken, handleTogglePassword, handleViewMails, isMobile, passwordById, passwordLoadingIds, refreshingTokenIds, screens.sm, visiblePasswordIds]);

    const rowSelection = useMemo(
        () => ({
            selectedRowKeys,
            onChange: setSelectedRowKeys,
        }),
        [selectedRowKeys]
    );

    const tagRowSelection = useMemo(
        () => ({
            selectedRowKeys: selectedTagRowKeys,
            onChange: (keys: React.Key[]) => setSelectedTagRowKeys(keys),
        }),
        [selectedTagRowKeys]
    );

    const groupRowSelection = useMemo(
        () => ({
            selectedRowKeys: selectedGroupRowKeys,
            onChange: (keys: React.Key[]) => setSelectedGroupRowKeys(keys),
        }),
        [selectedGroupRowKeys]
    );

    const tablePagination = useMemo(
        () => ({
            current: page,
            pageSize,
            total,
            simple: isMobile,
            showLessItems: isMobile,
            showSizeChanger: !isMobile,
            showQuickJumper: !isMobile,
            showTotal: isMobile ? undefined : (count: number) => `共 ${count} 条`,
            onChange: (currentPage: number, currentPageSize: number) => {
                setPage(currentPage);
                setPageSize(currentPageSize);
            },
        }),
        [isMobile, page, pageSize, total]
    );

    const emailTableScroll = useMemo(
        () => (isMobile ? { x: 620 } : { x: 'max-content' }),
        [isMobile]
    );

    const pagedGroups = useMemo(() => {
        const start = (groupPage - 1) * groupPageSize;
        return groupItems.slice(start, start + groupPageSize);
    }, [groupItems, groupPage, groupPageSize]);

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(groupItems.length / groupPageSize));
        if (groupPage > maxPage) {
            setGroupPage(maxPage);
        }
    }, [groupItems.length, groupPage, groupPageSize]);

    useEffect(() => {
        const validGroupIds = new Set(groupItems.map((group) => group.id));
        setSelectedGroupRowKeys((prev) => prev.filter((key) => validGroupIds.has(Number(key))));
    }, [groupItems]);

    useEffect(() => {
        const validTagIds = new Set(tagItems.map((tag) => tag.id));
        setSelectedTagRowKeys((prev) => prev.filter((key) => validTagIds.has(Number(key))));
    }, [tagItems]);

    const emailDetailSrcDoc = useMemo(
        () => `
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <meta charset="utf-8">
                            <style>
                                body { 
                                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                                    font-size: 14px;
                                    line-height: 1.6;
                                    color: #333;
                                    margin: 0;
                                    padding: 16px;
                                    background: #fafafa;
                                }
                                img { max-width: 100%; height: auto; }
                                a { color: #1890ff; }
                            </style>
                        </head>
                        <body>${emailDetailContent}</body>
                        </html>
                    `,
        [emailDetailContent]
    );

    const modalWidths = useMemo(
        () => ({
            emailForm: screens.lg ? 600 : screens.sm ? 560 : 'calc(100vw - 16px)',
            import: screens.xl ? 700 : screens.md ? 640 : screens.sm ? 560 : 'calc(100vw - 16px)',
            mailList: screens.xl ? 1000 : screens.lg ? 880 : screens.sm ? 720 : 'calc(100vw - 16px)',
            mailDetail: screens.xl ? 900 : screens.lg ? 820 : screens.sm ? 720 : 'calc(100vw - 16px)',
            compact: screens.sm ? 460 : 'calc(100vw - 16px)',
            assign: screens.sm ? 400 : 'calc(100vw - 16px)',
        }),
        [screens.lg, screens.md, screens.sm, screens.xl]
    );

    const responsiveModalBodyStyle = useMemo(
        () => ({ padding: screens.sm ? '16px 24px' : 14 }),
        [screens.sm]
    );

    const groupFilterOptions = useMemo(
        () =>
            groups.map((group: EmailGroup) => ({
                value: group.id,
                label: `${group.name} (${group.emailCount})`,
            })),
        [groups]
    );

    const groupOptions = useMemo(
        () =>
            groups.map((group: EmailGroup) => ({
                value: group.id,
                label: group.name,
            })),
        [groups]
    );

    // ========================================
    // Group table columns
    // ========================================
    const groupColumns: ColumnsType<EmailGroup> = useMemo(() => [
        {
            title: '分组名称',
            dataIndex: 'name',
            key: 'name',
            width: 120,
            className: 'email-groups-table__name-column',
            render: (name: string) => <Tag color="blue" className="email-groups-table__name-tag">{name}</Tag>,
        },
        {
            title: '描述',
            dataIndex: 'description',
            key: 'description',
            render: (val: string | null) => val || '-',
        },
        {
            title: '拉取策略',
            dataIndex: 'fetchStrategy',
            key: 'fetchStrategy',
            width: 190,
            render: (value: MailFetchStrategy) => <Tag color="purple">{MAIL_FETCH_STRATEGY_LABELS[value]}</Tag>,
        },
        {
            title: '邮箱数',
            dataIndex: 'emailCount',
            key: 'emailCount',
            width: 100,
        },
        {
            title: '创建时间',
            dataIndex: 'createdAt',
            key: 'createdAt',
            width: 180,
            render: (val: string) => dayjs(val).format('YYYY-MM-DD HH:mm'),
        },
        {
            title: '操作',
            key: 'action',
            width: 160,
            render: (_: unknown, record: EmailGroup) => (
                <Space>
                    <Button
                        type="text"
                        icon={<EditOutlined />}
                        onClick={() => handleEditGroup(record)}
                    />
                    <Popconfirm
                        title="删除分组后，组内邮箱将变为「未分组」。确认？"
                        onConfirm={() => handleDeleteGroup(record.id)}
                    >
                        <Button type="text" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                </Space>
            ),
        },
    ], [handleDeleteGroup, handleEditGroup]);

    const tagColumns: ColumnsType<EmailTagItem> = useMemo(() => [
        {
            title: '标签名称',
            dataIndex: 'name',
            key: 'name',
            width: 120,
            className: 'email-tags-table__name-column',
            render: (name: string) => <Tag color="geekblue" className="email-tags-table__name-tag">{name}</Tag>,
        },
        {
            title: '描述',
            dataIndex: 'description',
            key: 'description',
            render: (description: string | null) => description || '-',
        },
        {
            title: '邮箱数',
            dataIndex: 'emailCount',
            key: 'emailCount',
            width: 100,
        },
        {
            title: '创建时间',
            dataIndex: 'createdAt',
            key: 'createdAt',
            width: 180,
            render: (val: string) => dayjs(val).format('YYYY-MM-DD HH:mm'),
        },
        {
            title: '操作',
            key: 'action',
            width: 140,
            render: (_: unknown, record: EmailTagItem) => (
                <Space>
                    <Button
                        type="text"
                        icon={<EditOutlined />}
                        onClick={() => handleEditTag(record)}
                    />
                    <Popconfirm
                        title="删除标签后会从所有邮箱中移除，确认？"
                        onConfirm={() => handleDeleteTag(record.id)}
                    >
                        <Button type="text" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                </Space>
            ),
        },
    ], [handleDeleteTag, handleEditTag]);

    // ========================================
    // Render
    // ========================================
    const selectedCount = selectedRowKeys.length;
    const hasSelection = selectedCount > 0;
    const selectedTagCount = selectedTagRowKeys.length;
    const hasTagSelection = selectedTagCount > 0;
    const selectedGroupCount = selectedGroupRowKeys.length;
    const hasGroupSelection = selectedGroupCount > 0;

    return (
        <div className="page-stack emails-page">
            <PageHeader
                title="邮箱管理"
                subtitle="统一管理邮箱账号、标签与分组，兼顾桌面与手机端的操作体验。"
            />
            <Tabs
                className="emails-page__tabs"
                activeKey={activeTab}
                onChange={(key) => setActiveTab(key as 'emails' | 'tags' | 'groups')}
                animated={false}
                destroyInactiveTabPane
                items={[
                    {
                        key: 'emails',
                        label: '邮箱列表',
                        children: (
                            <div className="page-stack emails-page__panel">
                                <div className="page-toolbar emails-page__toolbar">
                                    <div className="page-toolbar__group">
                                        <Button
                                            icon={<SyncOutlined spin={batchRefreshing} />}
                                            onClick={handleBatchRefreshTokens}
                                            loading={batchRefreshing}
                                        >
                                            刷新全部 Token
                                        </Button>
                                        <Button icon={<UploadOutlined />} onClick={() => setImportModalVisible(true)}>
                                            导入
                                        </Button>
                                        <Button icon={<DownloadOutlined />} onClick={handleExport}>
                                            导出
                                        </Button>
                                    </div>
                                    <div className="page-toolbar__group">
                                        <Button
                                            className="emails-page__toolbar-neutral"
                                            icon={<GroupOutlined />}
                                            onClick={() => setAssignGroupModalVisible(true)}
                                            disabled={!hasSelection}
                                        >
                                            分配分组 ({selectedCount})
                                        </Button>
                                        <Button
                                            className="emails-page__toolbar-neutral"
                                            onClick={handleBatchRemoveGroup}
                                            disabled={!hasSelection}
                                        >
                                            移出分组 ({selectedCount})
                                        </Button>
                                        <Popconfirm
                                            title={`确定要删除选中的 ${selectedCount} 个邮箱吗？`}
                                            description="删除后不可恢复，请谨慎操作。"
                                            okText="删除"
                                            cancelText="取消"
                                            okButtonProps={{ danger: true }}
                                            onConfirm={handleBatchDelete}
                                            disabled={!hasSelection}
                                        >
                                            <Button danger className="emails-page__toolbar-neutral" disabled={!hasSelection}>
                                                批量删除 ({selectedCount})
                                            </Button>
                                        </Popconfirm>
                                        <Button
                                            type="primary"
                                            className="emails-page__toolbar-primary"
                                            icon={<PlusOutlined />}
                                            onClick={handleCreate}
                                        >
                                            添加邮箱
                                        </Button>
                                    </div>
                                </div>

                                <div className="page-filter-row emails-page__filters">
                                    <div className="page-filter-row__group">
                                        <Input
                                            className="emails-page__filter-control"
                                            placeholder="搜索邮箱"
                                            prefix={<SearchOutlined />}
                                            value={keyword}
                                            onChange={(e) => setKeyword(e.target.value)}
                                            allowClear
                                        />
                                        <Input
                                            className="emails-page__filter-control"
                                            placeholder="按标签搜索（子串）"
                                            prefix={<SearchOutlined />}
                                            value={tagKeyword}
                                            onChange={(e) => setTagKeyword(e.target.value)}
                                            allowClear
                                        />
                                        <Select
                                            className="emails-page__filter-control emails-page__filter-control--sm"
                                            placeholder="按分组筛选"
                                            allowClear
                                            value={filterGroupId}
                                            options={groupFilterOptions}
                                            onChange={(val: number | string | undefined) => {
                                                setFilterGroupId(toOptionalNumber(val));
                                                setPage(1);
                                            }}
                                        />
                                    </div>
                                    <div className="page-filter-row__group emails-page__pagination-group">
                                        <Pagination
                                            current={tablePagination.current}
                                            pageSize={tablePagination.pageSize}
                                            total={tablePagination.total}
                                            simple={tablePagination.simple}
                                            showLessItems={tablePagination.showLessItems}
                                            showSizeChanger={tablePagination.showSizeChanger}
                                            showQuickJumper={tablePagination.showQuickJumper}
                                            showTotal={tablePagination.showTotal}
                                            onChange={tablePagination.onChange}
                                        />
                                    </div>
                                </div>

                                <Card bordered={false} className="page-card page-card--table emails-page__table-card">
                                    <Table
                                        className="emails-table"
                                        columns={columns}
                                        dataSource={data}
                                        rowKey="id"
                                        size={isMobile ? 'small' : 'middle'}
                                        loading={loading}
                                        rowSelection={rowSelection}
                                        pagination={false}
                                        scroll={emailTableScroll}
                                        tableLayout={isMobile ? 'auto' : 'fixed'}
                                        sticky={isMobile ? false : { offsetHeader: EMAIL_TABLE_STICKY_OFFSET }}
                                    />
                                </Card>
                            </div>
                        ),
                    },
                    {
                        key: 'tags',
                        label: '邮箱标签',
                        children: (
                            <div className="page-stack emails-page__panel">
                                <div className="page-toolbar emails-page__toolbar">
                                    <div className="page-toolbar__group">
                                        {hasTagSelection ? (
                                            <Popconfirm
                                                title={`确定要删除选中的 ${selectedTagCount} 个标签吗？`}
                                                onConfirm={handleBatchDeleteTags}
                                            >
                                                <Button danger loading={batchDeleteTagLoading}>
                                                    批量删除 ({selectedTagCount})
                                                </Button>
                                            </Popconfirm>
                                        ) : (
                                            <Button danger disabled>
                                                批量删除 (0)
                                            </Button>
                                        )}
                                    </div>
                                    <div className="page-toolbar__group">
                                        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateTag}>
                                            创建标签
                                        </Button>
                                    </div>
                                </div>

                                <div className="page-filter-row emails-page__filters">
                                    <div className="page-filter-row__group">
                                        <Input
                                            className="emails-page__filter-control"
                                            placeholder="搜索标签（支持子串）"
                                            prefix={<SearchOutlined />}
                                            value={tagManageKeyword}
                                            onChange={(e) => setTagManageKeyword(e.target.value)}
                                            allowClear
                                        />
                                    </div>
                                    <div className="page-filter-row__group emails-page__pagination-group">
                                        <Pagination
                                            current={tagPage}
                                            pageSize={tagPageSize}
                                            total={tagTotal}
                                            simple={isMobile}
                                            showLessItems={isMobile}
                                            showSizeChanger={!isMobile}
                                            showTotal={isMobile ? undefined : (count: number) => `共 ${count} 条`}
                                            onChange={(currentPage: number, currentPageSize: number) => {
                                                setTagPage(currentPage);
                                                setTagPageSize(currentPageSize);
                                            }}
                                        />
                                    </div>
                                </div>

                                <Card bordered={false} className="page-card page-card--table emails-page__table-card">
                                    <Table
                                        className="email-tags-table"
                                        columns={tagColumns}
                                        dataSource={tagItems}
                                        rowKey="id"
                                        size={isMobile ? 'small' : 'middle'}
                                        loading={tagListLoading}
                                        rowSelection={tagRowSelection}
                                        pagination={false}
                                        scroll={useHorizontalScroll ? { x: 760 } : undefined}
                                    />
                                </Card>
                            </div>
                        ),
                    },
                    {
                        key: 'groups',
                        label: '邮箱分组',
                        children: (
                            <div className="page-stack emails-page__panel">
                                <div className="page-toolbar emails-page__toolbar">
                                    <div className="page-toolbar__group">
                                        {hasGroupSelection ? (
                                            <Popconfirm
                                                title={`确定要删除选中的 ${selectedGroupCount} 个分组吗？`}
                                                onConfirm={handleBatchDeleteGroups}
                                            >
                                                <Button danger loading={batchDeleteGroupLoading}>
                                                    批量删除 ({selectedGroupCount})
                                                </Button>
                                            </Popconfirm>
                                        ) : (
                                            <Button danger disabled>
                                                批量删除 (0)
                                            </Button>
                                        )}
                                    </div>
                                    <div className="page-toolbar__group">
                                        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateGroup}>
                                            创建分组
                                        </Button>
                                    </div>
                                </div>

                                <div className="page-filter-row emails-page__filters">
                                    <div className="page-filter-row__group">
                                        <Input
                                            className="emails-page__filter-control"
                                            placeholder="搜索分组名称/描述"
                                            prefix={<SearchOutlined />}
                                            value={groupKeyword}
                                            onChange={(e) => setGroupKeyword(e.target.value)}
                                            allowClear
                                        />
                                    </div>
                                    <div className="page-filter-row__group emails-page__pagination-group">
                                        <Pagination
                                            current={groupPage}
                                            pageSize={groupPageSize}
                                            total={groupItems.length}
                                            simple={isMobile}
                                            showLessItems={isMobile}
                                            showSizeChanger={!isMobile}
                                            showTotal={isMobile ? undefined : (count: number) => `共 ${count} 条`}
                                            onChange={(currentPage: number, currentPageSize: number) => {
                                                setGroupPage(currentPage);
                                                setGroupPageSize(currentPageSize);
                                            }}
                                        />
                                    </div>
                                </div>

                                <Card bordered={false} className="page-card page-card--table emails-page__table-card">
                                    <Table
                                        className="email-groups-table"
                                        columns={groupColumns}
                                        dataSource={pagedGroups}
                                        rowKey="id"
                                        size={isMobile ? 'small' : 'middle'}
                                        loading={groupListLoading}
                                        rowSelection={groupRowSelection}
                                        pagination={false}
                                        scroll={useHorizontalScroll ? { x: 760 } : undefined}
                                    />
                                </Card>
                            </div>
                        ),
                    },
                ]}
            />

            {/* 添加/编辑邮箱 Modal */}
            <Modal
                title={editingId ? '编辑邮箱' : '添加邮箱'}
                open={modalVisible}
                onOk={handleSubmit}
                onCancel={() => setModalVisible(false)}
                destroyOnClose
                width={modalWidths.emailForm}
                styles={{ body: responsiveModalBodyStyle }}
            >
                <Spin spinning={emailEditLoading}>
                    <Form form={form} layout="vertical">
                    <Form.Item name="email" label="邮箱地址" rules={[{ required: true, message: '请输入邮箱地址' }, { type: 'email', message: '请输入有效的邮箱地址' }]}>
                        <Input placeholder="example@outlook.com" />
                    </Form.Item>
                    <Form.Item name="password" label="密码">
                        <Input.Password placeholder="可选" />
                    </Form.Item>

                    <Form.Item
                        name="clientId"
                        label="客户端 ID"
                        rules={[{ required: true, message: '请输入客户端 ID' }]}
                    >
                        <Input placeholder="Azure AD 应用程序 ID" />
                    </Form.Item>
                    <Form.Item name="tags" label="标签">
                        <Select
                            mode="tags"
                            allowClear
                            tokenSeparators={[',', '，', ';', '；']}
                            placeholder="可输入多个标签，按回车确认"
                        />
                    </Form.Item>
                    <Form.Item
                        name="refreshToken"
                        label="刷新令牌"
                        rules={[{ required: !editingId, message: '请输入刷新令牌' }]}
                    >
                        <TextArea rows={4} placeholder="OAuth2 Refresh Token" />
                    </Form.Item>
                    <Form.Item name="groupId" label="所属分组">
                        <Select placeholder="可选：选择分组" allowClear options={groupOptions} />
                    </Form.Item>
                    <Form.Item name="status" label="状态" initialValue="ACTIVE">
                        <Select>
                            <Select.Option value="ACTIVE">正常</Select.Option>
                            <Select.Option value="DISABLED">禁用</Select.Option>
                        </Select>
                    </Form.Item>
                    </Form>
                </Spin>
            </Modal>

            {/* 批量导入 Modal */}
            <Modal
                title="批量导入邮箱"
                open={importModalVisible}
                onOk={handleImport}
                onCancel={() => setImportModalVisible(false)}
                destroyOnClose
                width={modalWidths.import}
                styles={{ body: responsiveModalBodyStyle }}
            >
                <Space direction="vertical" className="emails-page__modal-stack" size="middle">
                    <div>
                        <Text type="secondary">
                            上传文件或粘贴内容。系统会自动清洗空白/说明行并自动识别分隔符（识别失败时回退到你填写的分隔符）。
                            <br />
                            支持以下格式（每行一条）：
                            <br />
                            1) 邮箱{separator}客户端ID{separator}刷新令牌
                            <br />
                            2) 邮箱{separator}密码{separator}客户端ID{separator}刷新令牌
                            <br />
                            3) 兼容历史 5 列格式（将自动识别并导入）
                        </Text>
                    </div>
                    <Input
                        className="emails-page__modal-control emails-page__modal-control--sm"
                        addonBefore="分隔符"
                        value={separator}
                        onChange={(e) => setSeparator(e.target.value)}
                    />
                    <Select
                        className="emails-page__modal-control emails-page__modal-control--md"
                        placeholder="导入到分组（可选）"
                        allowClear
                        value={importGroupId}
                        options={groupOptions}
                        onChange={(value: number | string | undefined) => setImportGroupId(toOptionalNumber(value))}
                    />
                    <Dragger
                        beforeUpload={(file) => {
                            const reader = new FileReader();
                            reader.onload = (e) => {
                                const fileContent = e.target?.result as string;
                                if (fileContent) {
                                    const normalized = fileContent.replace(/\r\n/g, '\n').trim();
                                    const lines = normalized ? normalized.split('\n').filter((line: string) => line.trim()) : [];
                                    setImportContent(normalized);
                                    message.success(`文件读取成功，共 ${lines.length} 行`);
                                }
                            };
                            reader.readAsText(file);
                            return false;
                        }}
                        showUploadList={false}
                        maxCount={1}
                        accept=".txt,.csv"
                    >
                        <p className="ant-upload-drag-icon">
                            <InboxOutlined />
                        </p>
                        <p className="ant-upload-text">点击或拖拽文件到此区域</p>
                        <p className="ant-upload-hint">支持 .txt 或 .csv 文件</p>
                    </Dragger>
                    <TextArea
                        className="emails-page__modal-control"
                        rows={12}
                        value={importContent}
                        onChange={(e) => setImportContent(e.target.value)}
                        placeholder={`example@outlook.com${separator}client_id${separator}refresh_token\nexample2@outlook.com${separator}password${separator}client_id${separator}refresh_token`}
                    />
                </Space>
            </Modal>

            {/* 导出选项 Modal */}
            <Modal
                title="导出邮箱"
                open={exportModalVisible}
                onOk={handleConfirmExport}
                onCancel={() => {
                    setExportModalVisible(false);
                    setExportIncludePassword(false);
                }}
                okText="开始导出"
                cancelText="取消"
                destroyOnClose
                width={modalWidths.compact}
                styles={{ body: responsiveModalBodyStyle }}
            >
                <Space direction="vertical" size="middle" className="emails-page__modal-stack">
                    <Text type="secondary">
                        默认导出格式：邮箱{separator}客户端ID{separator}刷新令牌
                        <br />
                        勾选后导出格式：邮箱{separator}密码{separator}客户端ID{separator}刷新令牌
                    </Text>
                    <Checkbox
                        checked={exportIncludePassword}
                        onChange={(e) => setExportIncludePassword(e.target.checked)}
                    >
                        包含密码（敏感信息，默认不勾选）
                    </Checkbox>
                </Space>
            </Modal>

            {/* 邮件列表 Modal */}
            {mailModalVisible && (
                <Modal
                    title={`${currentEmail} 的${currentMailbox === 'INBOX' ? '收件箱' : '垃圾箱'}`}
                    open={mailModalVisible}
                    onCancel={() => setMailModalVisible(false)}
                    footer={null}
                    destroyOnClose
                    width={modalWidths.mailList}
                    styles={{ body: responsiveModalBodyStyle }}
                >
                    <div className="emails-page__mail-toolbar">
                        <Button type="primary" onClick={handleRefreshMails} loading={mailLoading}>
                            收取新邮件
                        </Button>
                        <Popconfirm
                            title={`确定要清空${currentMailbox === 'INBOX' ? '收件箱' : '垃圾箱'}的所有邮件吗？`}
                            onConfirm={handleClearMailbox}
                        >
                            <Button danger>清空</Button>
                        </Popconfirm>
                        <span className="emails-page__mail-count">
                            共 {mailList.length} 封邮件
                        </span>
                    </div>
                    <List
                        className="emails-page__mail-list"
                        loading={mailLoading}
                        dataSource={mailList}
                        itemLayout="horizontal"
                        pagination={{
                            pageSize: 10,
                            simple: isMobile,
                            showLessItems: isMobile,
                            showSizeChanger: !isMobile,
                            showQuickJumper: !isMobile,
                            showTotal: isMobile ? undefined : (total: number) => `共 ${total} 条`,
                        }}
                        renderItem={(item: MailItem) => (
                            <List.Item
                                key={item.id}
                                actions={[
                                    <Button
                                        type="primary"
                                        size="small"
                                        onClick={() => handleViewEmailDetail(item)}
                                    >
                                        查看
                                    </Button>,
                                ]}
                            >
                                <List.Item.Meta
                                    title={
                                        <Typography.Text ellipsis className="emails-page__mail-subject">
                                            {item.subject || '(无主题)'}
                                        </Typography.Text>
                                    }
                                    description={
                                        <div className="emails-page__mail-meta">
                                            <span className="emails-page__mail-from">{item.from || '未知发件人'}</span>
                                            <span className="emails-page__mail-date">
                                                {item.date ? dayjs(item.date).format('YYYY-MM-DD HH:mm') : '-'}
                                            </span>
                                        </div>
                                    }
                                />
                            </List.Item>
                        )}
                    />
                </Modal>
            )}

            {/* 邮件详情 Modal */}
            {emailDetailVisible && (
                <Modal
                    title={emailDetailSubject}
                    open={emailDetailVisible}
                    onCancel={() => setEmailDetailVisible(false)}
                    footer={null}
                    destroyOnClose
                    width={modalWidths.mailDetail}
                    styles={{ body: responsiveModalBodyStyle }}
                >
                    <iframe
                        className="emails-page__iframe"
                        title="email-content"
                        sandbox="allow-same-origin"
                        srcDoc={emailDetailSrcDoc}
                    />
                </Modal>
            )}

            {/* 创建/编辑分组 Modal */}
            <Modal
                title={editingGroupId ? '编辑分组' : '创建分组'}
                open={groupModalVisible}
                onOk={handleGroupSubmit}
                onCancel={() => setGroupModalVisible(false)}
                confirmLoading={groupSubmitting}
                okText={editingGroupId ? '保存' : '创建'}
                destroyOnClose
                width={modalWidths.compact}
                styles={{ body: responsiveModalBodyStyle }}
            >
                <Form form={groupForm} layout="vertical">
                    {editingGroupId ? (
                        <Form.Item name="name" label="分组名称" rules={[{ required: true, message: '请输入分组名称' }]}>
                            <Input placeholder="例如：aws、discord" />
                        </Form.Item>
                    ) : (
                        <Form.Item
                            name="namesText"
                            label="分组名称"
                            rules={[{ required: true, message: '请至少输入一个分组名称' }]}
                            extra="支持一次创建多个分组：每行一个名称，自动去重并忽略空行"
                        >
                            <TextArea
                                rows={6}
                                placeholder={'例如：\naws\ndiscord\ntelegram'}
                            />
                        </Form.Item>
                    )}
                    <Form.Item name="description" label="描述">
                        <Input placeholder="可选描述" />
                    </Form.Item>
                    <Form.Item
                        name="fetchStrategy"
                        label="邮件拉取策略"
                        rules={[{ required: true, message: '请选择拉取策略' }]}
                    >
                        <Select options={MAIL_FETCH_STRATEGY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))} />
                    </Form.Item>
                </Form>
            </Modal>

            {/* 创建/编辑标签 Modal */}
            <Modal
                title={editingTagId ? '编辑标签' : '创建标签'}
                open={tagModalVisible}
                onOk={handleTagSubmit}
                onCancel={() => setTagModalVisible(false)}
                confirmLoading={tagSubmitting}
                okText={editingTagId ? '保存' : '创建'}
                destroyOnClose
                width={modalWidths.compact}
                styles={{ body: responsiveModalBodyStyle }}
            >
                <Form form={tagForm} layout="vertical">
                    {editingTagId ? (
                        <Form.Item name="name" label="标签名称" rules={[{ required: true, message: '请输入标签名称' }]}>
                            <Input placeholder="例如：aws、discord" />
                        </Form.Item>
                    ) : (
                        <Form.Item
                            name="namesText"
                            label="标签名称"
                            rules={[{ required: true, message: '请至少输入一个标签名称' }]}
                            extra="支持一次创建多个标签：每行一个名称，自动去重并忽略空行"
                        >
                            <TextArea
                                rows={6}
                                placeholder={'例如：\naws\ndiscord\ntelegram'}
                            />
                        </Form.Item>
                    )}
                    <Form.Item name="description" label="描述">
                        <Input placeholder="可选描述" />
                    </Form.Item>
                </Form>
            </Modal>

            {/* 批量分配分组 Modal */}
            <Modal
                title="分配邮箱到分组"
                open={assignGroupModalVisible}
                onOk={handleBatchAssignGroup}
                onCancel={() => setAssignGroupModalVisible(false)}
                destroyOnClose
                width={modalWidths.assign}
                styles={{ body: responsiveModalBodyStyle }}
            >
                <p className="emails-page__assign-note">已选择 {selectedRowKeys.length} 个邮箱</p>
                <Select
                    className="emails-page__modal-control"
                    placeholder="选择目标分组"
                    value={assignTargetGroupId}
                    options={groupOptions}
                    onChange={setAssignTargetGroupId}
                />
            </Modal>
        </div>
    );
};

export default EmailsPage;
