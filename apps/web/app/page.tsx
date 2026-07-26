/**
 * The marketing home is a later milestone. For now this is a deliberate stub so `/`
 * resolves — the web app exists at this point to serve invite landings (/a/<code>) and
 * the app-association files, not to sell the product.
 */
export default function Home() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        textAlign: 'center',
        padding: 24,
      }}
    >
      <span style={{ fontFamily: 'var(--font-serif)', fontSize: 40, color: 'var(--ink)' }}>
        photu
      </span>
      <p style={{ margin: 0, color: 'var(--ink-soft)', fontSize: 16, maxWidth: 420 }}>
        Shared albums at original quality. You only see the photos you appear in.
      </p>
    </main>
  )
}
