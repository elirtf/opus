import { useState } from 'react'
import { Menu } from 'lucide-react'
import Sidebar from './Sidebar'

export default function Layout({ children }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  return (
    <div className="flex h-[100dvh] md:h-screen bg-gray-950 overflow-hidden">
      {mobileNavOpen && (
        <button
          type="button"
          className="md:hidden fixed inset-0 z-40 bg-black/60"
          aria-label="Close menu"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <Sidebar
        mobileOpen={mobileNavOpen}
        onNavigate={() => setMobileNavOpen(false)}
      />
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <header
          className="md:hidden shrink-0 flex items-center gap-2 min-h-12 px-3 border-b border-gray-800 bg-gray-950 z-30"
          style={{ paddingTop: 'max(0px, env(safe-area-inset-top))' }}
        >
          <button
            type="button"
            className="min-h-[44px] min-w-[44px] -ml-2 flex items-center justify-center rounded-lg text-gray-300 hover:bg-gray-800"
            aria-label="Open menu"
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu className="w-5 h-5" strokeWidth={1.75} />
          </button>
          <span className="font-semibold text-white tracking-wide">Opus NVR</span>
        </header>
        <main
          className="flex-1 flex flex-col overflow-auto min-h-0"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {children}
        </main>
      </div>
    </div>
  )
}
