import type { Metadata, Viewport } from 'next';
import { plusJakarta } from './fonts';
import './globals.css';
import '../styles/fountainhead/fountainhead.css';
import './beacon.css';

// Document shell ONLY. All chrome lives in the route groups — app/(staff)/layout.tsx carries
// the desk's sidebar shell; app/(family)/ carries the parent face (QM-D34: one item, two
// faces — a parent must never see the staff nav, and a route group is how the two faces share
// one app without sharing a header).
const NO_FLASH = `try{var t=localStorage.getItem('fh-theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export const metadata: Metadata = {
  title: 'Front Desk — Request System',
  description: 'Proof of concept. Synthetic data only.',
};

export const viewport: Viewport = {
  themeColor: '#005BAA',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={plusJakarta.variable}
      data-theme="light"
      data-density="comfortable"
      data-profile="product"
    >
      <body className="bg-background text-foreground font-body antialiased">
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
        {children}
      </body>
    </html>
  );
}
