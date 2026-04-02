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
        cssVar: {
          key: 'gongxi-mail',
        },
        hashed: false,
        token: {
          colorPrimary: '#2563eb',
          colorSuccess: '#16a34a',
          colorWarning: '#d97706',
          colorError: '#dc2626',
          colorInfo: '#2563eb',
          borderRadius: 10,
          borderRadiusLG: 16,
          borderRadiusSM: 8,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
          fontSize: 14,
          colorBgContainer: '#ffffff',
          colorBgLayout: '#f5f7fb',
          colorBorder: '#d9e2ec',
          colorText: '#0f172a',
          colorTextSecondary: '#5b6b7f',
          boxShadow: '0 8px 20px rgba(15, 23, 42, 0.06)',
          boxShadowSecondary: '0 14px 32px rgba(15, 23, 42, 0.08)',
          wireframe: false,
        },
        components: {
          Layout: {
            siderBg: '#ffffff',
            triggerBg: '#ffffff',
            headerBg: '#ffffff',
          },
          Menu: {
            itemHeight: 42,
            itemBorderRadius: 10,
            itemBg: 'transparent',
            itemColor: '#42526b',
            itemHoverColor: '#0f172a',
            itemHoverBg: '#f1f5f9',
            itemSelectedColor: '#0f172a',
            itemSelectedBg: '#e8f0ff',
          },
          Table: {
            headerBg: '#f8fafc',
            headerColor: '#42526b',
            rowHoverBg: '#f8fafc',
            borderColor: '#d9e2ec',
          },
          Card: {
            headerBg: 'transparent',
            paddingLG: 18,
          },
          Button: {
            primaryShadow: 'none',
          },
          Input: {
            activeShadow: '0 0 0 3px rgba(37, 99, 235, 0.14)',
          },
          Select: {
            optionSelectedBg: '#edf3ff',
          },
          Tabs: {
            inkBarColor: '#2563eb',
          },
          Modal: {
            borderRadiusLG: 20,
          },
          Drawer: {
            colorBgElevated: '#ffffff',
          },
        },
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>,
)
