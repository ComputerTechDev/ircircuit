
const CACHE = 'webirc-v18';
const PRECACHE = [
    '/',
    '/static/style.css',
    '/static/mobile.css',
    '/static/app.js',
    '/static/manifest.json',
    '/static/icon-192.png',
    '/static/icon-512.png',
];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', e => {

    const url = new URL(e.request.url);
    if (url.pathname.startsWith('/ws') || e.request.method !== 'GET') return;

    if (url.pathname.startsWith('/api/')) return;

    e.respondWith(
        fetch(e.request)
            .then(res => {
                if (res.ok) {
                    const clone = res.clone();
                    caches.open(CACHE).then(c => c.put(e.request, clone));
                }
                return res;
            })

            .catch(() => caches.match(e.request, { ignoreSearch: true }))
    );
});

self.addEventListener('push', e => {
    if (!e.data) return;

    try {
        const data = e.data.json();
        const options = {
            body: data.body || '',
            icon: '/static/icon-192.png',
            badge: '/static/icon-192.png',
            tag: data.tag || 'webirc-notification',
            data: {
                url: data.url || '/',
                channel: data.channel,
                network: data.network
            },
            requireInteraction: data.requireInteraction || false,
            vibrate: [200, 100, 200]
        };

        e.waitUntil(
            self.registration.showNotification(data.title || 'WebIRC', options)
        );
    } catch (err) {
        console.error('[SW] Push notification error:', err);
    }
});

self.addEventListener('notificationclick', e => {
    e.notification.close();

    const urlToOpen = e.notification.data?.url || '/';

    e.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(windowClients => {
                for (const client of windowClients) {
                    if (client.url === urlToOpen && 'focus' in client) {
                        return client.focus();
                    }
                }
                if (clients.openWindow) {
                    return clients.openWindow(urlToOpen);
                }
            })
    );
});
