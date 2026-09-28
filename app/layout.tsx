import type { Metadata, Viewport } from 'next';
import '@fontsource/silkscreen/400.css';
import '@fontsource/silkscreen/700.css';
import '@fontsource-variable/inter/index.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Comic Shelf',
  robots: { index: false, follow: false },
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Comic Shelf', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = { themeColor: '#2447a8', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
