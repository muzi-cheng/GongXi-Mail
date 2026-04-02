import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Table,
    Button,
    Space,
    Modal,
    Form,
    Input,
    Select,
    message,
    Popconfirm,
    Tag,
    Typography,
    Card,
    Tooltip,
    InputNumber,
    Progress,
    Statistic,
    Row,
    Col,
    Badge,
    Divider,
    DatePicker,
    Checkbox,
    Spin,
    Empty,
    Grid,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
    PlusOutlined,
    EditOutlined,
    DeleteOutlined,
    ReloadOutlined,
    DatabaseOutlined,
    ThunderboltOutlined,
    SearchOutlined,
} from '@ant-design/icons';
import { apiKeyApi, groupApi, emailApi } from '../../api';
import { PageHeader } from '../../components';
import { getErrorMessage } from '../../utils/error';
import { requestData } from '../../utils/request';
import { LOG_ACTION_OPTIONS } from '../../constants/logActions';
import dayjs from 'dayjs';
import './index.css';

const { Text, Paragraph } = Typography;

interface EmailGroup {
    id: number;
    name: string;
    description: string | null;
    emailCount: number;
}

interface ApiKey {
    id: number;
    name: string;
    keyPrefix: string;
    rateLimit: number;
    status: 'ACTIVE' | 'DISABLED';
    expiresAt: string | null;
    lastUsedAt: string | null;
    usageCount: number;
    createdAt: string;
    createdByName: string;
}

interface ApiKeyDetail extends ApiKey {
    permissions?: Record<string, boolean> | null;
    allowedGroupIds?: number[] | null;
    allowedEmailIds?: number[] | null;
}

interface EmailOptionItem {
    id: number;
    email: string;
    groupId: number | null;
    group: { id: number; name: string } | null;
}

interface PoolStats {
    total: number;
    used: number;
    remaining: number;
}

interface PoolEmailItem {
    id: number;
    email: string;
    used: boolean;
    groupId: number | null;
    groupName: string | null;
}

interface ApiKeyListResult {
    list: ApiKey[];
    total: number;
}

const API_KEY_TABLE_STICKY_OFFSET = 56;

const ApiKeysPage: React.FC = () => {
    const screens = Grid.useBreakpoint();
    const isMobile = !screens.md;
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<ApiKey[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [modalVisible, setModalVisible] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [newKeyModalVisible, setNewKeyModalVisible] = useState(false);
    const [newKey, setNewKey] = useState('');
    const [poolModalVisible, setPoolModalVisible] = useState(false);
    const [poolStats, setPoolStats] = useState<PoolStats | null>(null);
    const [poolLoading, setPoolLoading] = useState(false);
    const [currentApiKey, setCurrentApiKey] = useState<ApiKey | null>(null);
    const [emailList, setEmailList] = useState<PoolEmailItem[]>([]);
    const [selectedEmails, setSelectedEmails] = useState<number[]>([]);
    const [emailKeyword, setEmailKeyword] = useState('');
    const [emailModalVisible, setEmailModalVisible] = useState(false);
    const [emailLoading, setEmailLoading] = useState(false);
    const [savingEmails, setSavingEmails] = useState(false);
    const [apiKeyDetailLoading, setApiKeyDetailLoading] = useState(false);
    const [groups, setGroups] = useState<EmailGroup[]>([]);
    const [allEmailOptions, setAllEmailOptions] = useState<EmailOptionItem[]>([]);
    const [poolGroupName, setPoolGroupName] = useState<string | undefined>(undefined);
    const [emailGroupId, setEmailGroupId] = useState<number | undefined>(undefined);
    const [allowedEmailKeyword, setAllowedEmailKeyword] = useState('');
    const latestListRequestIdRef = useRef(0);
    const [form] = Form.useForm();
    const selectedAllowedGroupIds = Form.useWatch('allowedGroupIds', form) as number[] | undefined;
    const selectedAllowedEmailIds = Form.useWatch('allowedEmailIds', form) as number[] | undefined;

    const modalWidths = useMemo(
        () => ({
            form: screens.xl ? 760 : screens.lg ? 700 : screens.sm ? 620 : 'calc(100vw - 16px)',
            keyResult: screens.sm ? 540 : 'calc(100vw - 16px)',
            pool: screens.lg ? 600 : screens.sm ? 520 : 'calc(100vw - 16px)',
            emailPool: screens.xl ? 760 : screens.lg ? 700 : screens.sm ? 620 : 'calc(100vw - 16px)',
        }),
        [screens.lg, screens.md, screens.sm, screens.xl]
    );

    const responsiveModalBodyStyle = useMemo(
        () => ({ padding: screens.sm ? '16px 24px' : 14 }),
        [screens.sm]
    );

    const permissionActionOptions = useMemo(
        () =>
            LOG_ACTION_OPTIONS.map((item) => ({
                value: item.value,
                label: item.label,
            })),
        []
    );
    const allPermissionActions = useMemo(
        () => permissionActionOptions.map((item) => item.value),
        [permissionActionOptions]
    );

    const extractUsedEmailIds = useCallback(
        (emails: PoolEmailItem[]) => emails.filter((item) => item.used).map((item) => item.id),
        []
    );

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

    const fetchAllEmailOptions = useCallback(async () => {
        const result = await requestData<{ list: EmailOptionItem[]; total: number }>(
            () => emailApi.getList<EmailOptionItem>({ page: 1, pageSize: 1000, status: 'ACTIVE' }),
            '获取邮箱选项失败',
            { silent: true }
        );
        if (result) {
            setAllEmailOptions(result.list);
        }
    }, []);

    const fetchData = useCallback(async () => {
        const currentRequestId = ++latestListRequestIdRef.current;
        setLoading(true);
        const result = await requestData<ApiKeyListResult>(
            () => apiKeyApi.getList({ page, pageSize }),
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
    }, [page, pageSize]);

    useEffect(() => {
        fetchGroups();
    }, [fetchGroups]);

    useEffect(() => {
        fetchAllEmailOptions();
    }, [fetchAllEmailOptions]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleCreate = () => {
        setEditingId(null);
        setApiKeyDetailLoading(false);
        setAllowedEmailKeyword('');
        form.resetFields();
        form.setFieldsValue({
            permissions: allPermissionActions,
            allowedGroupIds: [],
            allowedEmailIds: [],
        });
        setModalVisible(true);
    };

    const handleEdit = useCallback(async (record: ApiKey) => {
        setEditingId(record.id);
        setApiKeyDetailLoading(true);
        setAllowedEmailKeyword('');
        form.setFieldsValue({
            name: record.name,
            rateLimit: record.rateLimit,
            status: record.status,
            expiresAt: record.expiresAt ? dayjs(record.expiresAt) : null,
            permissions: allPermissionActions,
        });
        setModalVisible(true);
        try {
            const detail = await requestData<ApiKeyDetail>(
                () => apiKeyApi.getById(record.id),
                '获取 API Key 详情失败'
            );
            if (detail) {
                const selectedPermissions = detail.permissions
                    ? Object.entries(detail.permissions)
                        .filter(([, allowed]) => allowed)
                        .map(([permission]) => permission.replace(/-/g, '_'))
                    : allPermissionActions;
                form.setFieldsValue({
                    name: detail.name,
                    rateLimit: detail.rateLimit,
                    status: detail.status,
                    expiresAt: detail.expiresAt ? dayjs(detail.expiresAt) : null,
                    permissions: selectedPermissions.length > 0 ? selectedPermissions : allPermissionActions,
                    allowedGroupIds: detail.allowedGroupIds || [],
                    allowedEmailIds: detail.allowedEmailIds || [],
                });
            }
        } finally {
            setApiKeyDetailLoading(false);
        }
    }, [allPermissionActions, form]);

    const handleDelete = useCallback(async (id: number) => {
        try {
            const res = await apiKeyApi.delete(id);
            if (res.code === 200) {
                message.success('删除成功');
                fetchData();
            } else {
                message.error(res.message);
            }
        } catch (err: unknown) {
            message.error(getErrorMessage(err, '删除失败'));
        }
    }, [fetchData]);

    const handleSubmit = async () => {
        try {
            const values = await form.validateFields();
            const selectedPermissions = Array.isArray(values.permissions)
                ? values.permissions as string[]
                : [];
            const allowedGroupIds = Array.isArray(values.allowedGroupIds)
                ? Array.from(new Set(values.allowedGroupIds.map((item: unknown) => Number(item)).filter((item: number) => Number.isInteger(item) && item > 0)))
                : [];
            const allowedEmailIds = Array.isArray(values.allowedEmailIds)
                ? Array.from(new Set(values.allowedEmailIds.map((item: unknown) => Number(item)).filter((item: number) => Number.isInteger(item) && item > 0)))
                : [];
            const permissions = selectedPermissions.reduce<Record<string, boolean>>((acc, action) => {
                acc[action] = true;
                return acc;
            }, {});

            if (editingId) {
                const submitData = {
                    ...values,
                    expiresAt: values.expiresAt ? values.expiresAt.toISOString() : null,
                    permissions,
                    allowedGroupIds,
                    allowedEmailIds,
                };
                const res = await apiKeyApi.update(editingId, submitData);
                if (res.code === 200) {
                    message.success('更新成功');
                    setModalVisible(false);
                    fetchData();
                } else {
                    message.error(res.message);
                }
            } else {
                const submitData = {
                    ...values,
                    expiresAt: values.expiresAt ? values.expiresAt.toISOString() : undefined,
                    permissions,
                    allowedGroupIds,
                    allowedEmailIds,
                };
                const res = await apiKeyApi.create(submitData);
                if (res.code === 200) {
                    setModalVisible(false);
                    setNewKey(res.data.key);
                    setNewKeyModalVisible(true);
                    fetchData();
                } else {
                    message.error(res.message);
                }
            }
        } catch (err: unknown) {
            message.error(getErrorMessage(err, '保存失败'));
        }
    };

    const handleViewPool = useCallback(async (record: ApiKey) => {
        setCurrentApiKey(record);
        setPoolGroupName(undefined);
        setPoolModalVisible(true);
        setPoolLoading(true);
        try {
            const res = await apiKeyApi.getUsage(record.id);
            if (res.code === 200) {
                setPoolStats(res.data);
            }
        } catch {
            message.error('获取邮箱池数据失败');
        } finally {
            setPoolLoading(false);
        }
    }, []);

    const handlePoolGroupChange = async (groupName: string | undefined) => {
        setPoolGroupName(groupName);
        if (!currentApiKey) return;
        setPoolLoading(true);
        try {
            const res = await apiKeyApi.getUsage(currentApiKey.id, groupName);
            if (res.code === 200) {
                setPoolStats(res.data);
            }
        } catch {
            message.error('获取邮箱池数据失败');
        } finally {
            setPoolLoading(false);
        }
    };

    const handleResetPool = async () => {
        if (!currentApiKey) return;
        try {
            const res = await apiKeyApi.resetPool(currentApiKey.id, poolGroupName);
            if (res.code === 200) {
                message.success('邮箱池已重置');
                // 刷新统计
                const statsRes = await apiKeyApi.getUsage(currentApiKey.id, poolGroupName);
                if (statsRes.code === 200) {
                    setPoolStats(statsRes.data);
                }
            } else {
                message.error(res.message || '重置失败');
            }
        } catch {
            message.error('重置失败');
        }
    };

    // 打开邮箱管理弹窗
    const handleManageEmails = useCallback(async (record: ApiKey) => {
        setCurrentApiKey(record);
        setEmailGroupId(undefined);
        setEmailModalVisible(true);
        setEmailLoading(true);
        try {
            const res = await apiKeyApi.getPoolEmails<PoolEmailItem>(record.id);
            if (res.code === 200) {
                const emails = res.data;
                setEmailList(emails);
                setSelectedEmails(extractUsedEmailIds(emails));
                setEmailKeyword('');
            }
        } catch {
            message.error('获取邮箱列表失败');
        } finally {
            setEmailLoading(false);
        }
    }, [extractUsedEmailIds]);

    const handleEmailGroupChange = useCallback(async (groupId: number | undefined) => {
        setEmailGroupId(groupId);
        if (!currentApiKey) return;
        setEmailLoading(true);
        try {
            const res = await apiKeyApi.getPoolEmails<PoolEmailItem>(currentApiKey.id, groupId);
            if (res.code === 200) {
                const emails = res.data;
                setEmailList(emails);
                setSelectedEmails(extractUsedEmailIds(emails));
                setEmailKeyword('');
            }
        } catch {
            message.error('获取邮箱列表失败');
        } finally {
            setEmailLoading(false);
        }
    }, [currentApiKey, extractUsedEmailIds]);

    // 保存邮箱选择
    const handleSaveEmails = async () => {
        if (!currentApiKey) return;
        setSavingEmails(true);
        try {
            const res = await apiKeyApi.updatePoolEmails(currentApiKey.id, selectedEmails, emailGroupId);
            if (res.code === 200) {
                message.success(`已保存，共 ${res.data.count} 个邮箱`);
                setEmailModalVisible(false);
                // 刷新统计
                const statsRes = await apiKeyApi.getUsage(currentApiKey.id);
                if (statsRes.code === 200) {
                    setPoolStats(statsRes.data);
                }
            } else {
                message.error(res.message || '保存失败');
            }
        } catch {
            message.error('保存失败');
        } finally {
            setSavingEmails(false);
        }
    };

    const columns: ColumnsType<ApiKey> = useMemo(() => [
        {
            title: '名称',
            dataIndex: 'name',
            key: 'name',
            width: screens.md ? 220 : 180,
            render: (name: string, record: ApiKey) => (
                <div className="api-keys-page__name-cell">
                    <Space size={[8, 4]} wrap className="api-keys-page__name-title">
                        <Text strong>{name}</Text>
                        {record.status === 'DISABLED' && <Badge status="error" />}
                    </Space>
                    {!screens.md && (
                        <Text code className="api-keys-page__name-prefix">
                            {record.keyPrefix}...
                        </Text>
                    )}
                </div>
            ),
        },
        {
            title: 'Key 前缀',
            dataIndex: 'keyPrefix',
            key: 'keyPrefix',
            width: 128,
            responsive: ['md'],
            render: (text: string) => <Text code className="api-keys-page__key-prefix">{text}...</Text>,
        },
        {
            title: '速率限制',
            dataIndex: 'rateLimit',
            key: 'rateLimit',
            width: screens.sm ? 108 : 92,
            render: (val: number) => <Tag color="blue">{val}/分钟</Tag>,
        },
        {
            title: '状态',
            dataIndex: 'status',
            key: 'status',
            width: 80,
            render: (status: ApiKey['status']) => (
                <Tag color={status === 'ACTIVE' ? 'green' : 'red'}>
                    {status === 'ACTIVE' ? '启用' : '禁用'}
                </Tag>
            ),
        },
        {
            title: '使用次数',
            dataIndex: 'usageCount',
            key: 'usageCount',
            width: 100,
            responsive: ['lg'],
            render: (val: number) => <Text type="secondary">{val?.toLocaleString() || 0}</Text>,
        },
        {
            title: '过期时间',
            dataIndex: 'expiresAt',
            key: 'expiresAt',
            width: 120,
            responsive: ['lg'],
            render: (val: string | null) => {
                if (!val) return <Text type="secondary">永不过期</Text>;
                const isExpired = dayjs(val).isBefore(dayjs());
                return (
                    <Text type={isExpired ? 'danger' : undefined}>
                        {dayjs(val).format('YYYY-MM-DD')}
                    </Text>
                );
            },
        },
        {
            title: '最后使用',
            dataIndex: 'lastUsedAt',
            key: 'lastUsedAt',
            width: 124,
            responsive: ['xl'],
            render: (val: string | null) => val ? dayjs(val).format('MM-DD HH:mm') : <Text type="secondary">从未使用</Text>,
        },
        {
            title: '操作',
            key: 'action',
            width: screens.sm ? 180 : 132,
            render: (_: unknown, record: ApiKey) => (
                <Space size={isMobile ? [4, 4] : 'small'} wrap>
                    <Tooltip title="邮箱池">
                        <Button
                            type="text"
                            icon={<DatabaseOutlined />}
                            onClick={() => handleViewPool(record)}
                        />
                    </Tooltip>
                    <Tooltip title="管理邮箱">
                        <Button
                            type="text"
                            icon={<ThunderboltOutlined />}
                            onClick={() => handleManageEmails(record)}
                        />
                    </Tooltip>
                    <Tooltip title="编辑">
                        <Button
                            type="text"
                            icon={<EditOutlined />}
                            onClick={() => handleEdit(record)}
                        />
                    </Tooltip>
                    <Tooltip title="删除">
                        <Popconfirm
                            title="确定要删除此 API Key 吗？"
                            onConfirm={() => handleDelete(record.id)}
                        >
                            <Button type="text" danger icon={<DeleteOutlined />} />
                        </Popconfirm>
                    </Tooltip>
                </Space>
            ),
        },
    ], [handleDelete, handleEdit, handleManageEmails, handleViewPool, isMobile, screens.md, screens.sm]);

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

    const apiKeyTableScroll = useMemo(
        () => (isMobile ? { x: 720 } : { x: 'max-content', y: 560 }),
        [isMobile]
    );

    const poolGroupOptions = useMemo(
        () =>
            groups.map((group: EmailGroup) => ({
                value: group.name,
                label: `${group.name} (${group.emailCount})`,
            })),
        [groups]
    );

    const emailGroupOptions = useMemo(
        () =>
            groups.map((group: EmailGroup) => ({
                value: group.id,
                label: group.name,
            })),
        [groups]
    );

    const hasAllowedGroupFilter = Array.isArray(selectedAllowedGroupIds) && selectedAllowedGroupIds.length > 0;

    const scopedAllowedEmails = useMemo(() => {
        const selectedGroupSet = new Set(
            Array.isArray(selectedAllowedGroupIds)
                ? selectedAllowedGroupIds.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0)
                : []
        );

        return selectedGroupSet.size > 0
            ? allEmailOptions.filter((item) => item.groupId !== null && selectedGroupSet.has(item.groupId))
            : allEmailOptions;
    }, [allEmailOptions, selectedAllowedGroupIds]);

    const filteredAllowedEmails = useMemo(() => {
        const keyword = allowedEmailKeyword.trim().toLowerCase();
        if (!keyword) {
            return scopedAllowedEmails;
        }

        return scopedAllowedEmails.filter((item) => {
            const emailText = item.email.toLowerCase();
            const groupText = item.group?.name?.toLowerCase() || '';
            return emailText.includes(keyword) || groupText.includes(keyword);
        });
    }, [allowedEmailKeyword, scopedAllowedEmails]);

    const filteredAllowedEmailIdSet = useMemo(
        () => new Set(filteredAllowedEmails.map((item) => item.id)),
        [filteredAllowedEmails]
    );

    const selectedAllowedInFilteredCount = useMemo(
        () => (selectedAllowedEmailIds || []).filter((id) => filteredAllowedEmailIdSet.has(id)).length,
        [filteredAllowedEmailIdSet, selectedAllowedEmailIds]
    );

    useEffect(() => {
        const currentValue = form.getFieldValue('allowedEmailIds');
        const selected = Array.isArray(currentValue) ? currentValue : [];
        if (selected.length === 0) {
            return;
        }

        const allowedSet = new Set(scopedAllowedEmails.map((item) => item.id));
        const nextSelected = selected.filter((item: number) => allowedSet.has(item));
        if (nextSelected.length !== selected.length) {
            form.setFieldValue('allowedEmailIds', nextSelected);
        }
    }, [form, scopedAllowedEmails]);

    const filteredEmailList = useMemo(() => {
        const keyword = emailKeyword.trim().toLowerCase();
        if (!keyword) {
            return emailList;
        }

        return emailList.filter((item) => {
            const emailText = item.email.toLowerCase();
            const groupText = item.groupName?.toLowerCase() || '';
            return emailText.includes(keyword) || groupText.includes(keyword);
        });
    }, [emailKeyword, emailList]);

    const filteredEmailIdSet = useMemo(
        () => new Set(filteredEmailList.map((item) => item.id)),
        [filteredEmailList]
    );

    const selectedInFilteredCount = useMemo(
        () => selectedEmails.filter((id) => filteredEmailIdSet.has(id)).length,
        [filteredEmailIdSet, selectedEmails]
    );

    return (
        <div className="page-stack api-keys-page">
            <PageHeader
                title="API Key 管理"
                subtitle="统一管理访问密钥、接口权限与邮箱池分配规则。"
            />

            <div className="page-toolbar api-keys-page__toolbar">
                <div className="page-toolbar__group">
                    <Text type="secondary" className="api-keys-page__toolbar-summary">当前共 {total} 个 API Key</Text>
                </div>
                <div className="page-toolbar__group">
                    <Button icon={<ReloadOutlined />} onClick={fetchData}>
                        刷新
                    </Button>
                    <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
                        创建 API Key
                    </Button>
                </div>
            </div>

            <Card bordered={false} className="page-card page-card--table api-keys-page__table-card">
                <Table
                    className="api-keys-page__table"
                    columns={columns}
                    dataSource={data}
                    rowKey="id"
                    size={isMobile ? 'small' : 'middle'}
                    loading={loading}
                    pagination={tablePagination}
                    virtual={!isMobile}
                    scroll={apiKeyTableScroll}
                    tableLayout={isMobile ? 'auto' : 'fixed'}
                    sticky={isMobile ? false : { offsetHeader: API_KEY_TABLE_STICKY_OFFSET }}
                />
            </Card>

            {/* 创建/编辑弹窗 */}
            <Modal
                title={editingId ? '编辑 API Key' : '创建 API Key'}
                open={modalVisible}
                onOk={handleSubmit}
                onCancel={() => {
                    setAllowedEmailKeyword('');
                    setModalVisible(false);
                }}
                destroyOnClose
                width={modalWidths.form}
                styles={{ body: responsiveModalBodyStyle }}
            >
                <Spin spinning={apiKeyDetailLoading}>
                <Form form={form} layout="vertical">
                    <Form.Item
                        name="name"
                        label="名称"
                        rules={[{ required: true, message: '请输入名称' }]}
                    >
                        <Input placeholder="例如：生产环境、测试环境" />
                    </Form.Item>
                    <Form.Item
                        name="rateLimit"
                        label="速率限制（每分钟请求数）"
                        initialValue={60}
                    >
                        <InputNumber min={1} max={10000} className="api-keys-page__modal-control" />
                    </Form.Item>
                    <Form.Item
                        name="expiresAt"
                        label="过期时间（可选）"
                    >
                        <DatePicker
                            className="api-keys-page__modal-control"
                            placeholder="不设置则永不过期"
                            disabledDate={(current) => current && current < dayjs().startOf('day')}
                        />
                    </Form.Item>
                    {editingId && (
                        <Form.Item
                            name="status"
                            label="状态"
                        >
                            <Select>
                                <Select.Option value="ACTIVE">启用</Select.Option>
                                <Select.Option value="DISABLED">禁用</Select.Option>
                            </Select>
                        </Form.Item>
                    )}
                    <Form.Item
                        name="permissions"
                        label="可调用接口权限"
                        rules={[{ required: true, type: 'array', min: 1, message: '至少选择一个权限' }]}
                    >
                        <Checkbox.Group
                            options={permissionActionOptions}
                            className="api-keys-page__permissions"
                        />
                    </Form.Item>
                    <Form.Item
                        name="allowedGroupIds"
                        label="可用分组（可选）"
                        tooltip="不选择表示不限制分组"
                    >
                        <Select
                            className="api-keys-page__modal-control"
                            mode="multiple"
                            allowClear
                            placeholder="默认：全部分组"
                            options={emailGroupOptions}
                            optionFilterProp="label"
                            maxTagCount={isMobile ? 1 : 'responsive'}
                            notFoundContent="暂无分组，留空表示全部邮箱"
                        />
                    </Form.Item>
                    <Form.Item
                        label="可用邮箱（可选）"
                        tooltip="不选择表示使用分组范围内全部邮箱"
                    >
                        <div className="api-keys-page__modal-stack">
                            <Input
                                className="api-keys-page__modal-control"
                                allowClear
                                value={allowedEmailKeyword}
                                onChange={(event) => setAllowedEmailKeyword(event.target.value)}
                                prefix={<SearchOutlined />}
                                placeholder="搜索邮箱或分组"
                            />
                            <div className="api-keys-page__selection-toolbar">
                                <Space wrap size={[8, 8]} className="api-keys-page__selection-actions">
                                    <Button
                                        size="small"
                                        disabled={filteredAllowedEmails.length === 0}
                                        onClick={() => {
                                            const merged = new Set((selectedAllowedEmailIds || []).map((item) => Number(item)));
                                            filteredAllowedEmails.forEach((item) => merged.add(item.id));
                                            form.setFieldValue('allowedEmailIds', Array.from(merged));
                                        }}
                                    >
                                        全选当前结果
                                    </Button>
                                    <Button
                                        size="small"
                                        disabled={(selectedAllowedEmailIds || []).length === 0}
                                        onClick={() => {
                                            form.setFieldValue(
                                                'allowedEmailIds',
                                                (selectedAllowedEmailIds || []).filter((id) => !filteredAllowedEmailIdSet.has(id))
                                            );
                                        }}
                                    >
                                        清空当前结果
                                    </Button>
                                </Space>
                                <div className="api-keys-page__selection-summary">
                                    <Text type="secondary">
                                        当前可选邮箱：{scopedAllowedEmails.length}
                                    </Text>
                                    <Text type="secondary">
                                        已选择 {selectedAllowedEmailIds?.length || 0}
                                        {`（当前结果 ${selectedAllowedInFilteredCount} / ${filteredAllowedEmails.length}）`}
                                    </Text>
                                </div>
                            </div>
                            <Form.Item name="allowedEmailIds" noStyle>
                                <Checkbox.Group className="api-keys-page__checkbox-group">
                                    <div className="api-keys-page__selection-box">
                                        {filteredAllowedEmails.length > 0 ? (
                                            <Row gutter={[0, 8]}>
                                                {filteredAllowedEmails.map((item) => (
                                                    <Col span={24} key={item.id}>
                                                        <Checkbox value={item.id} className="api-keys-page__option-checkbox">
                                                            <span className="api-keys-page__option-content">
                                                                <span className="api-keys-page__option-label">{item.email}</span>
                                                                <Tag color={item.group ? 'blue' : 'default'} className="api-keys-page__option-tag">
                                                                    {item.group?.name || '未分组'}
                                                                </Tag>
                                                            </span>
                                                        </Checkbox>
                                                    </Col>
                                                ))}
                                            </Row>
                                        ) : (
                                            <Empty
                                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                                description={
                                                    hasAllowedGroupFilter
                                                        ? '所选分组下暂无启用邮箱'
                                                        : allowedEmailKeyword.trim()
                                                            ? '没有匹配的邮箱'
                                                            : '暂无启用邮箱'
                                                }
                                            />
                                        )}
                                    </div>
                                </Checkbox.Group>
                            </Form.Item>
                            <Text type="secondary">
                                留空表示使用{hasAllowedGroupFilter ? '所选分组' : '全部分组'}范围内全部邮箱
                            </Text>
                        </div>
                    </Form.Item>
                </Form>
                </Spin>
            </Modal>

            {/* 新建 Key 显示弹窗 */}
            <Modal
                title="API Key 已创建"
                open={newKeyModalVisible}
                onOk={() => setNewKeyModalVisible(false)}
                onCancel={() => setNewKeyModalVisible(false)}
                destroyOnClose
                width={modalWidths.keyResult}
                styles={{ body: responsiveModalBodyStyle }}
                footer={[
                    <Button key="close" onClick={() => setNewKeyModalVisible(false)}>
                        关闭
                    </Button>,
                ]}
            >
                <Card bordered={false} className="page-card api-keys-page__new-key-card">
                    <Text type="warning" className="api-keys-page__new-key-warning">
                        ⚠️ 请立即复制并妥善保存此 API Key，它不会再次显示！
                    </Text>
                    <Paragraph
                        copyable={{
                            text: newKey,
                            onCopy: () => message.success('已复制'),
                        }}
                        code
                        className="api-keys-page__new-key-value"
                    >
                        {newKey}
                    </Paragraph>
                </Card>
            </Modal>

            {/* 邮箱池弹窗 */}
            {poolModalVisible && (
                <Modal
                    title={
                        <Space>
                            <DatabaseOutlined />
                            <span>邮箱池管理 - {currentApiKey?.name}</span>
                        </Space>
                    }
                    open={poolModalVisible}
                    onCancel={() => setPoolModalVisible(false)}
                    footer={null}
                    destroyOnClose
                    width={modalWidths.pool}
                    styles={{ body: responsiveModalBodyStyle }}
                >
                    {poolLoading ? (
                        <div className="api-keys-page__loading-state">加载中...</div>
                    ) : poolStats ? (
                        <div className="page-stack api-keys-page__pool-stack">
                            <div className="page-filter-row api-keys-page__pool-filter">
                                <div className="page-filter-row__group">
                                <Text type="secondary">按分组筛选：</Text>
                                <Select
                                    allowClear
                                    placeholder="全部分组"
                                    className="api-keys-page__filter-control"
                                    value={poolGroupName}
                                    options={poolGroupOptions}
                                    onChange={(val: string | undefined) => handlePoolGroupChange(val)}
                                />
                                </div>
                            </div>
                            <Row gutter={[12, 12]}>
                                <Col xs={24} sm={8}>
                                    <div className="api-keys-page__stat api-keys-page__stat--blue">
                                        <Statistic
                                            title="总邮箱数"
                                            value={poolStats.total}
                                        />
                                    </div>
                                </Col>
                                <Col xs={24} sm={8}>
                                    <div className="api-keys-page__stat api-keys-page__stat--orange">
                                        <Statistic
                                            title="已使用"
                                            value={poolStats.used}
                                        />
                                    </div>
                                </Col>
                                <Col xs={24} sm={8}>
                                    <div className={`api-keys-page__stat ${poolStats.remaining > 0 ? 'api-keys-page__stat--green' : 'api-keys-page__stat--red'}`}>
                                        <Statistic
                                            title="剩余可用"
                                            value={poolStats.remaining}
                                        />
                                    </div>
                                </Col>
                            </Row>
                            <div className="api-keys-page__progress-block">
                                <Text type="secondary" className="api-keys-page__progress-title">
                                    使用进度
                                </Text>
                                <Progress
                                    percent={poolStats.total > 0 ? Math.round((poolStats.used / poolStats.total) * 100) : 0}
                                    status={poolStats.remaining === 0 ? 'exception' : 'active'}
                                    strokeColor={{
                                        '0%': '#108ee9',
                                        '100%': '#87d068',
                                    }}
                                />
                            </div>

                            <Divider />

                            <div className="api-keys-page__reset-block">
                                <Text type="secondary" className="api-keys-page__reset-note">
                                    重置后，此 API Key 可重新使用所有邮箱
                                </Text>
                                <Popconfirm
                                    title="确定要重置邮箱池吗？"
                                    description={poolGroupName ? `仅重置分组 "${poolGroupName}" 的使用记录` : '重置后该 API Key 可重新使用所有邮箱'}
                                    onConfirm={handleResetPool}
                                >
                                    <Button
                                        type="primary"
                                        danger
                                        icon={<ThunderboltOutlined />}
                                    >
                                        重置邮箱池
                                    </Button>
                                </Popconfirm>
                            </div>
                        </div>
                    ) : (
                        <div className="api-keys-page__empty-state">
                            暂无数据
                        </div>
                    )}
                </Modal>
            )}

            {/* 邮箱管理弹窗 */}
            {emailModalVisible && (
                <Modal
                    title={
                        <Space>
                            <ThunderboltOutlined />
                            <span>管理邮箱 - {currentApiKey?.name}</span>
                        </Space>
                    }
                    open={emailModalVisible}
                    onCancel={() => setEmailModalVisible(false)}
                    onOk={handleSaveEmails}
                    okText="保存"
                    cancelText="取消"
                    confirmLoading={savingEmails}
                    destroyOnClose
                    width={modalWidths.emailPool}
                    styles={{ body: responsiveModalBodyStyle }}
                >
                    {emailLoading ? (
                        <div className="api-keys-page__loading-state">
                            <Spin />
                        </div>
                    ) : (
                        <div className="page-stack api-keys-page__email-modal-stack">
                            <div className="page-filter-row api-keys-page__pool-filter">
                                <div className="page-filter-row__group">
                                    <Text type="secondary">按分组筛选：</Text>
                                    <Select
                                        allowClear
                                        placeholder="全部分组"
                                        className="api-keys-page__filter-control"
                                        value={emailGroupId}
                                        options={emailGroupOptions}
                                        onChange={(val: number | undefined) => handleEmailGroupChange(val)}
                                    />
                                </div>
                            </div>
                            <Input
                                className="api-keys-page__modal-control"
                                allowClear
                                value={emailKeyword}
                                onChange={(event) => setEmailKeyword(event.target.value)}
                                prefix={<SearchOutlined />}
                                placeholder="搜索邮箱或分组"
                            />
                            <Text type="secondary" className="api-keys-page__selection-hint">
                                勾选的邮箱表示该 API Key 已使用过（不会再自动分配）
                            </Text>
                            <div className="api-keys-page__selection-toolbar">
                                <Space wrap size={[8, 8]} className="api-keys-page__selection-actions">
                                    <Button
                                        size="small"
                                        onClick={() => {
                                            setSelectedEmails((prev) => Array.from(new Set([
                                                ...prev,
                                                ...filteredEmailList.map((item) => item.id),
                                            ])));
                                        }}
                                    >
                                        全选当前筛选
                                    </Button>
                                    <Button
                                        size="small"
                                        onClick={() => {
                                            setSelectedEmails((prev) => prev.filter((id) => !filteredEmailIdSet.has(id)));
                                        }}
                                    >
                                        清空当前筛选
                                    </Button>
                                </Space>
                                <div className="api-keys-page__selection-summary">
                                    <Text type="secondary">
                                        已选择 {selectedEmails.length} / {emailList.length}
                                        {`（当前筛选 ${selectedInFilteredCount} / ${filteredEmailList.length}）`}
                                    </Text>
                                </div>
                            </div>
                            <div className="api-keys-page__selection-box api-keys-page__selection-box--lg">
                                {filteredEmailList.length > 0 ? (
                                    <Checkbox.Group
                                        value={selectedEmails}
                                        onChange={(vals) => setSelectedEmails(vals as number[])}
                                        className="api-keys-page__checkbox-group"
                                    >
                                        <Row>
                                            {filteredEmailList.map((email: { id: number; email: string; used: boolean; groupId: number | null; groupName: string | null }) => (
                                                <Col xs={24} sm={12} key={email.id} className="api-keys-page__email-col">
                                                    <Checkbox value={email.id} className="api-keys-page__option-checkbox">
                                                        <span className="api-keys-page__option-content">
                                                            <span className="api-keys-page__option-label">{email.email}</span>
                                                            {email.groupName && (
                                                                <Tag color="blue" className="api-keys-page__option-tag">{email.groupName}</Tag>
                                                            )}
                                                        </span>
                                                    </Checkbox>
                                                </Col>
                                            ))}
                                        </Row>
                                    </Checkbox.Group>
                                ) : (
                                    <Empty
                                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                                        description={
                                            emailGroupId
                                                ? '当前分组下暂无邮箱'
                                                : emailKeyword.trim()
                                                    ? '没有匹配的邮箱'
                                                    : '暂无可管理邮箱'
                                        }
                                    />
                                )}
                            </div>
                        </div>
                    )}
                </Modal>
            )}
        </div>
    );
};

export default ApiKeysPage;
