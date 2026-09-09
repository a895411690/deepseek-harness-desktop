// ESLint 扁平配置：基于 @antfu/eslint-config 预设
// 项目为 React + TypeScript + Vite 应用，显式开启 React 支持
// （React 插件依赖 @eslint-react/eslint-plugin 与 eslint-plugin-react-refresh）
import antfu from '@antfu/eslint-config'

export default antfu({
  react: true,
  ignores: [
    'AGENTS.*',
    'docs',
    // 审查/同步记录报告：内容含 TS 示例代码块，作为文档不做样式 lint
    // （markdown 示例会触发 antfu 逐行风格规则，与可读性目标冲突）。
    'REVIEW-*.md',
  ],
}, {
  // 插件包是库包而非应用壳：client 侧文件按 host/client 双面设计，
  // 同一文件常同时导出组件与工具函数，react-refresh 的“只导出组件”约束
  // 不适用于库包，故仅在 packages 下关闭该规则。
  files: ['packages/**/*.{ts,tsx,jsx,mts,cts}'],
  rules: {
    'react-refresh/only-export-components': 'off',
  },
})
