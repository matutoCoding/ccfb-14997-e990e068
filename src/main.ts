import { h, mount } from './core/dom'
import { match, onRoute, parseHash, go, type Route } from './core/router'
import { Editor3D } from './three/editor3d'
import { registerSceneCleanup, runSceneCleanups } from './three/scene'
import './styles.css'
import './print.css'
import { renderListPage } from './pages/list'
import { renderSkeletonPage } from './pages/skeleton'
import { renderFabricPage } from './pages/fabric'
import { renderLightPage } from './pages/light'
import { renderPreviewPage } from './pages/preview'
import { renderCutlistPage } from './pages/cutlist'
import { seedSamples } from './samples/seed'

const app = document.querySelector<HTMLDivElement>('#app')!

const ROUTES: { pattern: string; render: (r: Route) => Promise<HTMLElement> | HTMLElement }[] = [
  { pattern: '/', render: () => renderListPage() },
  { pattern: '/group/:id/skeleton', render: (r) => renderSkeletonPage(r.params.id) },
  { pattern: '/group/:id/fabric', render: (r) => renderFabricPage(r.params.id) },
  { pattern: '/group/:id/light', render: (r) => renderLightPage(r.params.id) },
  { pattern: '/group/:id/preview', render: (r) => renderPreviewPage(r.params.id) },
  { pattern: '/group/:id/cutlist', render: (r) => renderCutlistPage(r.params.id) }
]

function topbar(active: string, groupId?: string): HTMLElement {
  const link = (path: string, label: string, key: string) =>
    h('a', {
      href: `#${path}`,
      class: active === key ? 'active' : ''
    }, label)

  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, '彩灯', h('span', { class: 'mark' }, '工坊')),
    h('nav', { class: 'nav' },
      link('/', '灯组列表', 'list'),
      ...(groupId ? [
        link(`/group/${groupId}/skeleton`, '骨架', 'skeleton'),
        link(`/group/${groupId}/fabric`, '蒙布', 'fabric'),
        link(`/group/${groupId}/light`, '灯光', 'light'),
        link(`/group/${groupId}/preview`, '夜景预览', 'preview'),
        link(`/group/${groupId}/cutlist`, '下料单', 'cutlist')
      ] : [])
    ),
    h('div', { class: 'spacer' }),
    h('span', { class: 'badge' }, '数据存于本地 IndexedDB')
  )
}

async function render(): Promise<void> {
  const route = parseHash()
  for (const r of ROUTES) {
    const params = match(r.pattern, route.path)
    if (params) {
      route.params = params
      // 路由切换先回收上一页的 WebGL 资源
      Editor3D.disposeAll()
      runSceneCleanups()
      const shell = h('div', { class: 'app-shell' })
      const key = r.pattern.split('/').filter(Boolean)[1] ?? 'list'
      const groupId = params.id
      shell.append(topbar(key, groupId))
      const page = h('div', { class: 'page' })
      shell.append(page)
      mount(app, shell)
      const content = await r.render(route)
      mount(page, content)
      return
    }
  }
  go('/')
}

onRoute(() => { void render() })
void seedSamples().then(() => void render())
