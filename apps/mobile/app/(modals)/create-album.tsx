import { type OccasionKey, occasionColor } from '@photu/tokens'
import { Button, Icon, Screen, SectionLabel, Text, useTheme } from '@photu/ui-native'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { ApiError } from '../../src/api/errors'
import { useCreateAlbum, useMe } from '../../src/api/hooks'
import type { AlbumTemplate, PrivacyMode } from '../../src/api/types'

/** Occasion templates and their window lengths, matching the Go service. */
const TEMPLATES: { key: AlbumTemplate; label: string; hint: string }[] = [
  { key: 'trip', label: 'Trip', hint: '30-day window' },
  { key: 'wedding', label: 'Wedding', hint: '14-day window' },
  { key: 'dinner', label: 'Dinner', hint: '3-day window' },
  { key: 'birthday', label: 'Birthday', hint: '7-day window' },
  { key: 'family', label: 'Family', hint: '60-day window' },
  { key: 'other', label: 'Other', hint: '30-day window' },
]

const PRIVACY: { key: PrivacyMode; label: string; hint: string }[] = [
  { key: 'face', label: 'Face-privacy', hint: 'Members only see photos they appear in' },
  { key: 'open', label: 'Open', hint: 'All members see every photo' },
  { key: 'private', label: 'Private', hint: 'You approve each photo first' },
]

/** From the prototype's `ScreenCreateAlbum`. */
export default function CreateAlbum() {
  const t = useTheme()
  const router = useRouter()
  const me = useMe()
  const create = useCreateAlbum()

  const [title, setTitle] = useState('')
  const [template, setTemplate] = useState<AlbumTemplate>('trip')
  const [privacyMode, setPrivacyMode] = useState<PrivacyMode>('face')

  const err = create.error instanceof ApiError ? create.error : null
  const paywalled = err?.isOutOfFreeAlbums ?? false

  const submit = () => {
    const trimmed = title.trim()
    if (!trimmed) return
    create.mutate(
      { title: trimmed, template, privacyMode },
      {
        onSuccess: album => {
          // Replace rather than push, so Back from the album lands on the library
          // instead of re-opening this form.
          router.dismissAll()
          router.push(`/(app)/album/${album.id}`)
        },
      },
    )
  }

  return (
    <Screen padded scroll>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingVertical: 12,
        }}
      >
        <Text variant="titleLg">New album</Text>
        <Pressable accessibilityLabel="Close" hitSlop={12} onPress={() => router.back()}>
          <Icon color={t.ink} name="x" size={20} />
        </Pressable>
      </View>

      {me.data && (
        <Text color={t.inkMuted} style={{ marginBottom: 20 }} variant="meta">
          {me.data.freeAlbumsUsed} of {me.data.freeAlbumsTotal} free albums used
        </Text>
      )}

      {/* Paywall. Server-enforced: this appears only because the API returned 402,
          never because the client counted. */}
      {paywalled && (
        <View
          style={{
            backgroundColor: t.accentSoft,
            borderRadius: t.radii.md,
            padding: 16,
            marginBottom: 20,
            gap: 6,
          }}
        >
          <Text color={t.accent} variant="bodySmStrong">
            Your fourth album
          </Text>
          <Text color={t.inkSoft} variant="caption">
            {err?.problem?.detail}
          </Text>
          <Text color={t.inkMuted} variant="metaSm">
            In-app purchase lands in a later milestone, so this is where it stops for now.
          </Text>
        </View>
      )}

      <SectionLabel>What's the occasion?</SectionLabel>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
        {TEMPLATES.map(tpl => {
          const selected = template === tpl.key
          return (
            <Pressable
              key={tpl.key}
              onPress={() => setTemplate(tpl.key)}
              style={{
                width: '47%',
                minHeight: 96,
                borderRadius: t.radii.md,
                padding: 16,
                justifyContent: 'space-between',
                overflow: 'hidden',
                backgroundColor: selected ? t.ink : t.surface,
                borderWidth: 1,
                borderColor: selected ? t.ink : t.line,
              }}
            >
              {/* The decorative blob from the prototype's occasion cards. */}
              <View
                style={{
                  position: 'absolute',
                  top: -10,
                  right: -10,
                  width: 60,
                  height: 60,
                  borderRadius: 30,
                  backgroundColor: occasionColor[tpl.key as OccasionKey],
                  opacity: selected ? 0.4 : 0.55,
                }}
              />
              <Text color={selected ? t.bg : t.ink} variant="titleSm">
                {tpl.label}
              </Text>
              <Text color={selected ? t.bg : t.inkMuted} variant="metaSm">
                {tpl.hint}
              </Text>
            </Pressable>
          )
        })}
      </View>

      <View style={{ marginTop: 28, gap: 8 }}>
        <SectionLabel>Album name</SectionLabel>
        <View
          style={{
            backgroundColor: t.surface,
            borderColor: err?.fieldErrors.title ? t.danger : t.line,
            borderWidth: 1,
            borderRadius: t.radii.md,
            paddingHorizontal: 16,
            minHeight: 52,
            justifyContent: 'center',
          }}
        >
          <TextInput
            autoCapitalize="sentences"
            onChangeText={setTitle}
            onSubmitEditing={submit}
            placeholder="Lisbon, March"
            placeholderTextColor={t.inkMuted}
            returnKeyType="done"
            style={[t.text.fieldValue, { color: t.ink, paddingVertical: 12 }]}
            value={title}
          />
        </View>
      </View>

      <View style={{ marginTop: 24, gap: 10 }}>
        <SectionLabel>Privacy mode</SectionLabel>
        {PRIVACY.map(p => {
          const selected = privacyMode === p.key
          return (
            <Pressable
              key={p.key}
              onPress={() => setPrivacyMode(p.key)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                backgroundColor: t.surface,
                borderRadius: t.radii.md,
                borderWidth: 1,
                borderColor: selected ? t.accent : t.line,
                padding: 14,
              }}
            >
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  borderWidth: 2,
                  borderColor: selected ? t.accent : t.lineStrong,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {selected && (
                  <View
                    style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.accent }}
                  />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="bodySmStrong">{p.label}</Text>
                <Text color={t.inkMuted} variant="metaSm">
                  {p.hint}
                </Text>
              </View>
            </Pressable>
          )
        })}
      </View>

      {err && !paywalled && (
        <Text color={t.danger} style={{ marginTop: 16 }} variant="caption">
          {err.message}
        </Text>
      )}

      <Button
        disabled={!title.trim() || paywalled}
        full
        kind="primary"
        loading={create.isPending}
        onPress={submit}
        size="lg"
        style={{ marginTop: 28 }}
      >
        Create album
      </Button>
    </Screen>
  )
}
