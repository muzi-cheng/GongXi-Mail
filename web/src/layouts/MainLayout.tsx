import React, { useEffect, useMemo, useState } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import {
    Layout,
    Menu,
    Avatar,
    Dropdown,
    Breadcrumb,
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

const menuConfig = [
    { key: '/dashboard', icon: <DashboardOutlined />, label: '数据概览', title: '数据概览' },
    { key: '/emails', icon: <MailOutlined />, label: '邮箱管理', title: '邮箱管理' },
    { key: '/api-keys', icon: <KeyOutlined />, label: 'API Key', title: 'API Key 管理' },
    { key: '/api-docs', icon: <FileTextOutlined />, label: 'API 文档', title: 'API 文档' },
    { key: '/operation-logs', icon: <HistoryOutlined />, label: '操作日志', title: '操作日志' },
    { key: '/system-logs', icon: <FileSearchOutlined />, label: '系统日志', title: '系统日志' },
    { key: '/admins', icon: <UserOutlined />, label: '管理员', title: '管理员管理', superAdmin: true },
    { key: '/settings', icon: <SettingOutlined />, label: '系统设置', title: '系统设置' },
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

    const menuItems: MenuProps['items'] = useMemo(
        () =>
            menuConfig
                .filter((item) => !item.superAdmin || hasSuperAdminPermission)
                .map((item) => ({
                    key: item.key,
                    icon: item.icon,
                    label: item.label,
                })),
        [hasSuperAdminPermission]
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

    const currentMenu = menuConfig.find(
        (item) => location.pathname === item.key || location.pathname.startsWith(`${item.key}/`)
    );
    const pageTitle = currentMenu?.title || '管理后台';
    const selectedKeys = currentMenu ? [currentMenu.key] : [];

    const renderLogo = (compact: boolean) => (
        <div className="app-logo">
            <div className="app-logo__inner">
                <div className="app-logo__badge">GX</div>
                {!compact && (
                    <div className="app-logo__text">
                        <div className="app-logo__title">GongXi Mail</div>
                        <div className="app-logo__subtitle">邮箱管理控制台</div>
                    </div>
                )}
            </div>
        </div>
    );

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
                        GongXi Mail Console
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
                            <span className="app-header__title">{pageTitle}</span>
                            <span className="app-header__meta">
                                <Breadcrumb
                                    className="app-breadcrumb"
                                    items={[
                                        { title: <Link to="/dashboard">首页</Link> },
                                        { title: pageTitle },
                                    ]}
                                />
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
                title={renderLogo(false)}
                placement="left"
                width={288}
                open={mobileNavOpen}
                onClose={() => setMobileNavOpen(false)}
            >
                {menuNode}
                <div className="app-sider__footer">简约模式 · 移动端已适配</div>
            </Drawer>
        </Layout>
    );
};

export default MainLayout;
