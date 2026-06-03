import type { MetadataRoute } from 'next';

/**
 * PWA manifest (Next 16 app/manifest.ts convention). Makes the app
 * installable to a phone home screen and launch standalone (no browser
 * chrome). Icons reuse the existing company logo.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ระบบจัดการคลังสินค้า Pioneer',
    short_name: 'Pioneer คลัง',
    description:
      'ระบบจัดการคลังสินค้าและเบิกจ่ายพัสดุ — Pioneer Engineering International',
    start_url: '/home',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    lang: 'th',
    background_color: '#ffffff',
    theme_color: '#0A0A0A',
    icons: [
      { src: '/logo.jpg', sizes: '192x192', type: 'image/jpeg' },
      { src: '/logo.jpg', sizes: '512x512', type: 'image/jpeg' },
      { src: '/logo.jpg', sizes: 'any', type: 'image/jpeg' },
    ],
  };
}
