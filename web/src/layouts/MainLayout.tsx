import React, { useEffect, useMemo, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
    Layout,
    Menu,
    Avatar,
    Dropdown,
    Button,
    Drawer,
    Grid,
} from 'antd';
import type { MenuProps } from 'antd';
import {
    DashboardOutlined,
    UserOutlined,
    KeyOutlined,
    MailOutlined,
    SettingOutlined,
    LogoutOutlined,
    MenuFoldOutlined,
    MenuUnfoldOutlined,
    MenuOutlined,
    FileTextOutlined,
    HistoryOutlined,
    FileSearchOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../stores/authStore';
import { authApi } from '../api';
import { getAdminRoleLabel, isSuperAdmin } from '../utils/auth';

const { Header, Sider, Content } = Layout;

const DESKTOP_SIDER_WIDTH = 248;
const DESKTOP_SIDER_COLLAPSED_WIDTH = 96;

interface AppMenuRouteItem {
    key: string;
    icon: React.ReactNode;
    label: string;
    title: string;
    section: 'overview' | 'mail' | 'system';
    superAdmin?: boolean;
}

const menuRouteConfig: AppMenuRouteItem[] = [
    { key: '/dashboard', icon: <DashboardOutlined />, label: '数据概览', title: '数据概览', section: 'overview' },
    { key: '/operation-logs', icon: <HistoryOutlined />, label: '操作日志', title: '操作日志', section: 'overview' },
    { key: '/system-logs', icon: <FileSearchOutlined />, label: '系统日志', title: '系统日志', section: 'overview' },
    { key: '/emails', icon: <MailOutlined />, label: '邮箱管理', title: '邮箱管理', section: 'mail' },
    { key: '/api-keys', icon: <KeyOutlined />, label: 'API Key', title: 'API Key 管理', section: 'mail' },
    { key: '/api-docs', icon: <FileTextOutlined />, label: 'API 文档', title: 'API 文档', section: 'mail' },
    { key: '/settings', icon: <SettingOutlined />, label: '系统设置', title: '系统设置', section: 'system' },
    { key: '/admins', icon: <UserOutlined />, label: '管理员', title: '管理员管理', section: 'system', superAdmin: true },
];

const menuSectionConfig: Array<{
    key: AppMenuRouteItem['section'];
    label: string;
}> = [
    { key: 'overview', label: '概览与日志' },
    { key: 'mail', label: '邮箱与接口' },
    { key: 'system', label: '系统管理' },
];

const MainLayout: React.FC = () => {
    const [collapsed, setCollapsed] = useState(false);
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const screens = Grid.useBreakpoint();
    const isMobile = !screens.lg;
    const navigate = useNavigate();
    const location = useLocation();
    const { admin, clearAuth } = useAuthStore();

    useEffect(() => {
        if (!isMobile) {
            setMobileNavOpen(false);
        }
    }, [isMobile]);

    const hasSuperAdminPermission = isSuperAdmin(admin?.role);
    const displayName = admin?.username?.trim() || 'Admin';
    const avatarText = displayName.charAt(0).toUpperCase();
    const roleLabel = getAdminRoleLabel(admin?.role);
    const mainLayoutClassName = [
        'app-main',
        isMobile ? 'app-main--mobile' : '',
        !isMobile && collapsed ? 'app-main--collapsed' : '',
    ]
        .filter(Boolean)
        .join(' ');

    const availableRoutes = useMemo(
        () => menuRouteConfig.filter((item) => !item.superAdmin || hasSuperAdminPermission),
        [hasSuperAdminPermission]
    );

    const groupedMenuItems: MenuProps['items'] = useMemo(
        () =>
            menuSectionConfig
                .map((section) => {
                    const children = availableRoutes
                        .filter((item) => item.section === section.key)
                        .map((item) => ({
                            key: item.key,
                            icon: item.icon,
                            label: item.label,
                        }));

                    if (children.length === 0) {
                        return null;
                    }

                    return {
                        type: 'group' as const,
                        key: `group-${section.key}`,
                        label: section.label,
                        children,
                    };
                })
                .filter(Boolean),
        [availableRoutes]
    );

    const collapsedMenuItems: MenuProps['items'] = useMemo(
        () =>
            availableRoutes.map((item) => ({
                key: item.key,
                icon: item.icon,
                label: item.label,
                title: item.label,
            })),
        [availableRoutes]
    );

    const handleLogout = async () => {
        try {
            await authApi.logout();
        } catch {
            // ignore
        }
        clearAuth();
        navigate('/login');
    };

    const handleNavigate = (path: string) => {
        navigate(path);
        if (isMobile) {
            setMobileNavOpen(false);
        }
    };

    const userMenuItems: MenuProps['items'] = [
        {
            key: 'profile',
            icon: <UserOutlined />,
            label: '个人设置',
            onClick: () => navigate('/settings'),
        },
        { type: 'divider' },
        {
            key: 'logout',
            icon: <LogoutOutlined />,
            label: '退出登录',
            danger: true,
            onClick: handleLogout,
        },
    ];

    const currentMenu = availableRoutes.find(
        (item) => location.pathname === item.key || location.pathname.startsWith(`${item.key}/`)
    );
    const pageTitle = currentMenu?.title || '管理后台';
    const selectedKeys = currentMenu ? [currentMenu.key] : [];
    const menuItems = !isMobile && collapsed ? collapsedMenuItems : groupedMenuItems;

    const renderLogo = (compact: boolean, onClick?: () => void) => {
        const clickable = typeof onClick === 'function';

        return (
            <div
                className={[
                    'app-logo',
                    clickable ? 'app-logo--clickable' : '',
                ].filter(Boolean).join(' ')}
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                onClick={onClick}
                onKeyDown={clickable ? (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onClick?.();
                    }
                } : undefined}
            >
                <div className="app-logo__inner">
                    <div className="app-logo__badge">O</div>
                    {!compact && (
                        <div className="app-logo__text">
                            <div className="app-logo__title">Outlook</div>
                            <div className="app-logo__subtitle">邮箱管理控制台</div>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const menuNode = (
        <Menu
            className="app-menu"
            theme="light"
            mode="inline"
            inlineCollapsed={!isMobile && collapsed}
            selectedKeys={selectedKeys}
            items={menuItems}
            onClick={({ key }) => handleNavigate(String(key))}
        />
    );

    return (
        <Layout className="app-shell">
            {!isMobile && (
                <Sider
                    className="app-sider"
                    trigger={null}
                    collapsible
                    collapsed={collapsed}
                    theme="light"
                    width={DESKTOP_SIDER_WIDTH}
                    collapsedWidth={DESKTOP_SIDER_COLLAPSED_WIDTH}
                >
                    {renderLogo(collapsed)}
                    {menuNode}
                    <div className="app-sider__footer">
                        简约模式 · 响应式布局
                        <br />
                        Outlook Console
                    </div>
                </Sider>
            )}

            <Layout className={mainLayoutClassName}>
                <Header className="app-header">
                    <div className="app-header__left">
                        <Button
                            type="text"
                            className="app-header__trigger"
                            icon={isMobile ? <MenuOutlined /> : collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                            onClick={() => {
                                if (isMobile) {
                                    setMobileNavOpen(true);
                                } else {
                                    setCollapsed((prev) => !prev);
                                }
                            }}
                        />

                        <div className="app-header__titles">
                            <span className="app-header__title">Outlook Console</span>
                            <span className="app-header__meta">
                                当前模块：{pageTitle}
                            </span>
                        </div>
                    </div>

                    <div className="app-header__right">
                        <Dropdown menu={{ items: userMenuItems }} placement="bottomRight" trigger={["click"]}>
                            <div className="app-user-trigger" role="button" tabIndex={0}>
                                <Avatar size="small" className="app-user-avatar">
                                    {avatarText}
                                </Avatar>
                                <div className="app-user-trigger__meta">
                                    <span className="app-user-trigger__name">{displayName}</span>
                                    <span className="app-user-trigger__role">{roleLabel}</span>
                                </div>
                            </div>
                        </Dropdown>
                    </div>
                </Header>

                <div className="app-content-shell">
                    <Content className="app-content">
                        <Outlet />
                    </Content>
                </div>
            </Layout>

            <Drawer
                className="app-mobile-drawer"
                title={renderLogo(false, () => setMobileNavOpen(false))}
                closable={false}
                placement="left"
                width={288}
                open={mobileNavOpen}
                onClose={() => setMobileNavOpen(false)}
            >
                {menuNode}
                <div className="app-sider__footer">
                    简约模式 · 移动端已适配
                    <br />
                    Outlook Console
                </div>
            </Drawer>
        </Layout>
    );
};

export default MainLayout;
