import React from 'react';
import { Link } from 'react-router-dom';
import { Typography, Breadcrumb, Space } from 'antd';

const { Title, Text } = Typography;

interface PageHeaderProps {
    title: string;
    subtitle?: string;
    breadcrumb?: Array<{ title: string; path?: string }>;
    extra?: React.ReactNode;
}

const PageHeader: React.FC<PageHeaderProps> = ({
    title,
    subtitle,
    breadcrumb,
    extra,
}) => {
    return (
        <div className="page-header page-header--compact">
            {breadcrumb && breadcrumb.length > 0 && (
                <Breadcrumb
                    className="page-header__breadcrumb"
                    items={breadcrumb.map((item) => ({
                        title: item.path ? <Link to={item.path}>{item.title}</Link> : item.title,
                    }))}
                />
            )}
            <div className="page-header__main">
                <div className="page-header__titles">
                    <Title level={4} className="page-header__title">{title}</Title>
                    {subtitle && <Text className="page-header__subtitle">{subtitle}</Text>}
                </div>
                {extra && <Space size={[8, 8]} className="page-header__extra">{extra}</Space>}
            </div>
        </div>
    );
};

export default PageHeader;
