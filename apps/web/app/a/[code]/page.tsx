import type { Metadata } from 'next'
import { getInvitePreview } from '../../../lib/api'
import { OpenInApp } from './open-in-app'

type Params = { code: string }

/**
 * OG metadata is the POINT of this page existing on the web: a photu.app/a/<code> link
 * pasted into WhatsApp or iMessage unfurls into a card with the album's name, which is
 * what makes an invite feel like an invite. The card art is generated per-code by
 * opengraph-image.tsx.
 */
export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { code } = await params
  const preview = await getInvitePreview(code)
  const title = preview?.valid ? `Join "${preview.albumTitle}" on photu` : 'photu invite'
  const description = preview?.valid
    ? "You've been invited to add and see photos at original quality."
    : 'Shared albums at original quality.'
  return {
    title,
    description,
    openGraph: { title, description, type: 'website' },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function InviteLandingPage({ params }: { params: Promise<Params> }) {
  const { code } = await params
  const preview = await getInvitePreview(code)

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        textAlign: 'center',
        gap: 20,
      }}
    >
      <Wordmark />

      {preview === null && (
        <Card>
          <Title>This invite link is not valid</Title>
          <Body>Ask whoever shared it to send you a fresh link.</Body>
        </Card>
      )}

      {preview && !preview.valid && (
        <Card>
          <Title>This invite is no longer active</Title>
          <Body>{invalidCopy(preview.invalidReason)}</Body>
        </Card>
      )}

      {preview?.valid && (
        <Card>
          <p style={{ margin: 0, color: 'var(--ink-soft)', fontSize: 15 }}>
            You've been invited to
          </p>
          <h1
            style={{
              margin: '6px 0 0',
              fontFamily: 'var(--font-serif)',
              fontSize: 34,
              lineHeight: 1.1,
              color: 'var(--ink)',
            }}
          >
            {preview.albumTitle}
          </h1>
          <Body>Add and see photos at original quality — nothing is compressed.</Body>
          <OpenInApp code={preview.code} />
        </Card>
      )}
    </main>
  )
}

function invalidCopy(reason?: string): string {
  switch (reason) {
    case 'expired':
      return 'This invite link has expired.'
    case 'full':
      return 'This invite link has reached its limit of joins.'
    case 'revoked':
      return 'This invite link was turned off by the album owner.'
    default:
      return 'This invite link can no longer be used.'
  }
}

function Wordmark() {
  return (
    <span style={{ fontFamily: 'var(--font-serif)', fontSize: 26, color: 'var(--ink)' }}>
      photu
    </span>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: '100%',
        maxWidth: 420,
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 20,
        padding: 28,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {children}
    </div>
  )
}

function Title({ children }: { children: React.ReactNode }) {
  return (
    <h1
      style={{
        margin: 0,
        fontFamily: 'var(--font-serif)',
        fontSize: 24,
        color: 'var(--ink)',
      }}
    >
      {children}
    </h1>
  )
}

function Body({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: '8px 0 0', color: 'var(--ink-soft)', fontSize: 15, lineHeight: 1.5 }}>
      {children}
    </p>
  )
}
