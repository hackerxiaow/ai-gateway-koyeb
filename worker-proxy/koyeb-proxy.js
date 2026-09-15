export default {
  async fetch(request) {
    const url = new URL(request.url)
    url.hostname = 'ai-gateway-koyeb-hackerxiaow-890a81fd.koyeb.app'
    url.protocol = 'https:'
    url.port = ''

    const headers = new Headers(request.headers)
    headers.set('Host', 'ai-gateway-koyeb-hackerxiaow-890a81fd.koyeb.app')

    const init = {
      method: request.method,
      headers,
      redirect: 'manual'
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body
    }

    return fetch(url.toString(), init)
  }
}
