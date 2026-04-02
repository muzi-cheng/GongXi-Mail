import React from 'react';
import type { CSSProperties } from 'react';
import { Card, Typography } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface StatCardProps {
    title: string;
    value: number | string;
    icon?: React.ReactNode;
    iconBgColor?: string;
    trend?: number; // 百分比变化，正数为上升，负数为下降
    trendLabel?: string;
    suffix?: string;
    loading?: boolean;
}

const StatCard: React.FC<StatCardProps> = ({
    title,
    value,
    icon,
    iconBgColor = '#1890ff',
    trend,
    trendLabel,
    suffix,
    loading = false,
}) => {
    const renderTrend = () => {
        if (trend === undefined) return null;

        const isUp = trend >= 0;
        const Icon = isUp ? ArrowUpOutlined : ArrowDownOutlined;
        const trendClassName = isUp ? 'stat-card__trend stat-card__trend--up' : 'stat-card__trend stat-card__trend--down';

        return (
            <div className={trendClassName}>
                <Icon className="stat-card__trend-icon" />
                <Text className="stat-card__trend-value">
                    {Math.abs(trend)}%
                </Text>
                {trendLabel && (
                    <Text className="stat-card__trend-label">
                        {trendLabel}
                    </Text>
                )}
            </div>
        );
    };

    return (
        <Card
            className="stat-card"
            bordered={false}
            loading={loading}
        >
            <div className="stat-card__content">
                <div>
                    <Text className="stat-card__title">{title}</Text>
                    <div className="stat-card__value">
                        {value}
                        {suffix && <span className="stat-card__suffix">{suffix}</span>}
                    </div>
                    {renderTrend()}
                </div>
                {icon && (
                    <div
                        className="stat-card__icon"
                        style={{ '--stat-card-icon-bg': iconBgColor } as CSSProperties}
                    >
                        {icon}
                    </div>
                )}
            </div>
        </Card>
    );
};

export default StatCard;
