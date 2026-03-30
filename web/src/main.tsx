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
          colorPrimary: '#4f46e5',
          colorSuccess: '#10b981',
          colorWarning: '#f59e0b',
          colorError: '#ef4444',
          colorInfo: '#3b82f6',
          borderRadius: 8,
          borderRadiusLG: 12,
          borderRadiusSM: 6,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
          fontSize: 14,
          colorBgContainer: '#ffffff',
          colorBgLayout: '#f1f5f9',
          boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
          boxShadowSecondary: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
        },
        components: {
          Layout: {
            siderBg: '#1e1b4b',
            triggerBg: '#312e81',
            headerBg: '#ffffff',
          },
          Menu: {
            darkItemBg: '#1e1b4b',
            darkSubMenuItemBg: '#16134a',
            darkItemSelectedBg: '#4f46e5',
            darkItemHoverBg: '#312e81',
            darkItemColor: '#c7d2fe',
            darkItemHoverColor: '#ffffff',
            darkItemSelectedColor: '#ffffff',
          },
          Table: {
            headerBg: '#f8fafc',
            headerColor: '#475569',
            rowHoverBg: '#f8fafc',
            borderColor: '#e2e8f0',
          },
          Card: {
            paddingLG: 24,
          },
          Button: {
            primaryShadow: '0 2px 4px rgba(79, 70, 229, 0.3)',
          },
          Input: {
            activeShadow: '0 0 0 2px rgba(79, 70, 229, 0.2)',
          },
        },
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>,
)
