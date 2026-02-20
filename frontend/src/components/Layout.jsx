import Sidebar from './Sidebar'

export default function Layout({ children }) {
  return (
    <div className="flex h-screen bg-gray-950 overflow-hidden">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-auto">
        {children}
      </main>
    </div>
  )
}