// Product naming and navigation live here so every production page uses the
// same vocabulary. No example project, preview asset or completion is implied.
export const studioConfig = Object.freeze({
  name: 'AI 短剧',
  brand: 'AI DRAMA STUDIO',
  layoutLabel: '创作工作台',
  steps: [
    { id: 'story', label: '故事', href: '/' },
    { id: 'script', label: '剧本', href: '/creative.html?stage=script' },
    { id: 'storyboard', label: '分镜', href: '/creative.html?stage=storyboard' },
    { id: 'images', label: '画面', href: '/images.html' },
    { id: 'video', label: '视频', href: '/canvas-video.html' },
    { id: 'finishing', label: '配音剪辑', href: '/timeline.html?view=finishing' },
    { id: 'export', label: '导出', href: '/timeline.html?view=export' },
  ],
  resources: [
    { id: 'entities', label: '角色与场景', icon: 'people' },
    { id: 'style', label: '风格库', icon: 'image' },
    { id: 'budget', label: '预算', icon: 'database' },
    { id: 'settings', label: '设置', icon: 'settings' },
  ],
});
