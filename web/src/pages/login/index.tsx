import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, Card, Typography, message, Modal, Space } from 'antd';
import { UserOutlined, LockOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { authApi } from '../../api';
import { useAuthStore } from '../../stores/authStore';
import { getErrorMessage } from '../../utils/error';

const { Title, Text } = Typography;

interface LoginForm {
    username: string;
    password: string;
}

const LoginPage: React.FC = () => {
    const navigate = useNavigate();
    const { setAuth } = useAuthStore();
    const [loading, setLoading] = useState(false);
    const [otpModalVisible, setOtpModalVisible] = useState(false);
    const [otpLoading, setOtpLoading] = useState(false);
    const [otpCode, setOtpCode] = useState('');
    const [pendingCredentials, setPendingCredentials] = useState<{ username: string; password: string } | null>(null);

    const finishLogin = (result: { token: string; admin: { id: number; username: string; email?: string; role: 'SUPER_ADMIN' | 'ADMIN'; twoFactorEnabled?: boolean } }) => {
        setAuth(result.token, result.admin);
        message.success('登录成功');
        navigate('/');
    };

    const handleSubmit = async (values: LoginForm) => {
        setLoading(true);
        try {
            const response = await authApi.login(values.username, values.password);
            if (response.code === 200) {
                finishLogin(response.data as { token: string; admin: { id: number; username: string; email?: string; role: 'SUPER_ADMIN' | 'ADMIN'; twoFactorEnabled?: boolean } });
            }
        } catch (err: unknown) {
            const errCode = String((err as { code?: unknown })?.code || '').toUpperCase();
            if (errCode === 'INVALID_OTP') {
                setPendingCredentials({ username: values.username, password: values.password });
                setOtpCode('');
                setOtpModalVisible(true);
                message.info('该账号已启用二次验证，请输入 6 位验证码');
            } else {
                message.error(getErrorMessage(err, '登录失败'));
            }
        } finally {
            setLoading(false);
        }
    };

    const handleOtpConfirm = async () => {
        if (!pendingCredentials) {
            return;
        }
        const otp = otpCode.trim();
        if (!/^\d{6}$/.test(otp)) {
            message.error('请输入 6 位验证码');
            return;
        }

        setOtpLoading(true);
        try {
            const response = await authApi.login(pendingCredentials.username, pendingCredentials.password, otp);
            if (response.code === 200) {
                setOtpModalVisible(false);
                setPendingCredentials(null);
                setOtpCode('');
                finishLogin(response.data as { token: string; admin: { id: number; username: string; email?: string; role: 'SUPER_ADMIN' | 'ADMIN'; twoFactorEnabled?: boolean } });
            }
        } catch (err: unknown) {
            const errCode = String((err as { code?: unknown })?.code || '').toUpperCase();
            if (errCode === 'INVALID_OTP') {
                message.error('验证码错误，请重试');
            } else {
                message.error(getErrorMessage(err, '验证失败'));
            }
        } finally {
            setOtpLoading(false);
        }
    };

    return (
        <div className="login-page">
            <div className="login-page__panel">
                <section className="login-page__hero">
                    <div>
                        <span className="login-page__eyebrow">轻量 · 简洁 · 高效</span>
                        <h1 className="login-page__title">GongXi Mail</h1>
                        <p className="login-page__description">
                            统一管理邮箱、API Key 与系统日志。全新简约 UI，支持桌面与手机端流畅使用。
                        </p>
                    </div>

                    <div className="login-page__features">
                        <div className="login-page__feature">
                            <div className="login-page__feature-title">移动端友好</div>
                            <div className="login-page__feature-text">菜单与核心操作在手机上可直接完成。</div>
                        </div>
                        <div className="login-page__feature">
                            <div className="login-page__feature-title">统一操作流</div>
                            <div className="login-page__feature-text">邮箱、分组、标签和 API 管理全部集中化。</div>
                        </div>
                        <div className="login-page__feature">
                            <div className="login-page__feature-title">安全增强</div>
                            <div className="login-page__feature-text">支持 2FA 校验与敏感信息保护。</div>
                        </div>
                        <div className="login-page__feature">
                            <div className="login-page__feature-title">实时可观测</div>
                            <div className="login-page__feature-text">看板、操作日志、系统日志统一可视化。</div>
                        </div>
                    </div>
                </section>

                <Card className="login-card" bordered={false}>
                    <div className="login-card__header">
                        <Title level={3} className="login-card__title">
                            登录控制台
                        </Title>
                        <Text className="login-card__subtitle">请输入管理员账号信息</Text>
                    </div>

                    <Form
                        name="login"
                        onFinish={handleSubmit}
                        size="large"
                        layout="vertical"
                    >
                        <Form.Item
                            name="username"
                            label="用户名"
                            rules={[{ required: true, message: '请输入用户名' }]}
                        >
                            <Input
                                prefix={<UserOutlined />}
                                placeholder="请输入用户名"
                                autoComplete="username"
                            />
                        </Form.Item>

                        <Form.Item
                            name="password"
                            label="密码"
                            rules={[{ required: true, message: '请输入密码' }]}
                        >
                            <Input.Password
                                prefix={<LockOutlined />}
                                placeholder="请输入密码"
                                autoComplete="current-password"
                            />
                        </Form.Item>

                        <Form.Item style={{ marginTop: -6, marginBottom: 16 }}>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                                若账号已启用 2FA，登录后会继续弹窗输入 6 位验证码
                            </Text>
                        </Form.Item>

                        <Form.Item style={{ marginBottom: 0 }}>
                            <Button
                                type="primary"
                                htmlType="submit"
                                loading={loading}
                                block
                            >
                                登录
                            </Button>
                        </Form.Item>
                    </Form>
                </Card>
            </div>
            
            <Modal
                title="二次验证"
                open={otpModalVisible}
                onOk={handleOtpConfirm}
                onCancel={() => {
                    setOtpModalVisible(false);
                    setPendingCredentials(null);
                    setOtpCode('');
                }}
                okText="验证并登录"
                cancelText="取消"
                confirmLoading={otpLoading}
                destroyOnClose
            >
                <Space direction="vertical" style={{ width: '100%' }}>
                    <Text type="secondary">请输入验证器中的 6 位动态码</Text>
                    <Input
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        prefix={<SafetyCertificateOutlined />}
                        maxLength={6}
                        placeholder="6 位验证码"
                    />
                </Space>
            </Modal>
        </div>
    );
};

export default LoginPage;
