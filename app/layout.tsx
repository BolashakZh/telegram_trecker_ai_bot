import Script from 'next/script'
import './globals.css'

export const metadata = { title: 'Трекер привычек' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <head>
        {/* beforeInteractive гарантирует, что скрипт выполнится до гидратации
            страницы — иначе порядок с бандлом не определён, и первый же
            запрос к API уходит с пустым initData. */}
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      </head>
      <body>{children}</body>
    </html>
  )
}
