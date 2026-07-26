import { ImageResponse } from 'next/og'
import { getInvitePreview } from '../../../lib/api'

// The card that renders in a chat unfurl. Generated per-code so it shows the actual
// album name — which is the whole reason the invite has a web page. No album cover
// here: covers sit behind the authorized image redirect, and an OG image must be
// publicly fetchable, so this is a branded name card rather than a photo.
export const runtime = 'edge'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'photu album invite'

export default async function OpengraphImage({ params }: { params: { code: string } }) {
  const preview = await getInvitePreview(params.code)
  const albumTitle = preview?.valid ? preview.albumTitle : 'photu'

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#F7F6F3',
        color: '#1A1917',
      }}
    >
      <div style={{ fontSize: 40, opacity: 0.6, marginBottom: 24 }}>photu</div>
      <div style={{ fontSize: 30, opacity: 0.7 }}>You're invited to</div>
      <div
        style={{
          fontSize: 96,
          fontWeight: 600,
          marginTop: 8,
          maxWidth: 1000,
          textAlign: 'center',
          lineHeight: 1.05,
        }}
      >
        {albumTitle}
      </div>
    </div>,
    { ...size },
  )
}
