// 极简 hash 路由：#/ 与 #/group/:id/skeleton 这类路径

export interface Route {
  path: string
  params: Record<string, string>
  query: Record<string, string>
}

type Handler = (route: Route) => void

const handlers = new Set<Handler>()

export function parseHash(): Route {
  const raw = location.hash.slice(1) || '/'
  const [pathPart, queryPart] = raw.split('?')
  const query: Record<string, string> = {}
  if (queryPart) {
    for (const pair of queryPart.split('&')) {
      const [k, v = ''] = pair.split('=')
      query[decodeURIComponent(k)] = decodeURIComponent(v)
    }
  }
  return { path: pathPart || '/', params: {}, query }
}

export function go(path: string): void {
  location.hash = path
}

export function onRoute(handler: Handler): void {
  handlers.add(handler)
}

// 模式注册：pattern 形如 /group/:id/skeleton，返回匹配函数
export function match(pattern: string, path: string): Record<string, string> | null {
  const ps = pattern.split('/').filter(Boolean)
  const xs = path.split('/').filter(Boolean)
  if (ps.length !== xs.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < ps.length; i++) {
    if (ps[i].startsWith(':')) params[ps[i].slice(1)] = decodeURIComponent(xs[i])
    else if (ps[i] !== xs[i]) return null
  }
  return params
}

window.addEventListener('hashchange', () => {
  const route = parseHash()
  for (const h of handlers) h(route)
})
