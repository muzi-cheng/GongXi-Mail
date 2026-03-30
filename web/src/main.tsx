import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#0f172a',
          colorSuccess: '#16a34a',
          colorWarning: '#d97706',
          colorError: '#dc2626',
          colorInfo: '#2563eb',
          borderRadius: 8,
          borderRadiusLG: 10,
          borderRadiusSM: 6,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
          fontSize: 14,
          colorBgContainer: '#ffffff',
          colorBgLayout: '#f8fafc',
          colorBorder: '#e2e8f0',
          colorText: '#0f172a',
          colorTextSecondary: '#475569',
          boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
          boxShadowSecondary: '0 8px 24px rgba(15, 23, 42, 0.08)',
        },
        components: {
          Layout: {
            siderBg: '#ffffff',
            triggerBg: '#ffffff',
            headerBg: '#ffffff',
          },
          Menu: {
            itemBorderRadius: 8,
            itemBg: '#ffffff',
            itemColor: '#334155',
            itemHoverColor: '#0f172a',
            itemHoverBg: '#f8fafc',
            itemSelectedColor: '#0f172a',
            itemSelectedBg: '#f1f5f9',
          },
          Table: {
            headerBg: '#f8fafc',
            headerColor: '#334155',
            rowHoverBg: '#f8fafc',
            borderColor: '#e2e8f0',
          },
          Card: {
            paddingLG: 24,
          },
          Button: {
            primaryShadow: '0 1px 2px rgba(15, 23, 42, 0.24)',
          },
          Input: {
            activeShadow: '0 0 0 2px rgba(15, 23, 42, 0.12)',
          },
        },
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>,
)
