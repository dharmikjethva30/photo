import { PALETTE_ORDER, PALETTES, type PaletteKey } from '@photu/tokens'
import {
  Button,
  Chip,
  ChipDot,
  Icon,
  Screen,
  SectionLabel,
  Text,
  usePalette,
} from '@photu/ui-native'
import { useRouter } from 'expo-router'
import { Pressable, View } from 'react-native'

/**
 * Palette matrix — a DEV screen.
 *
 * The cheapest way to catch contrast problems across all 11 palettes on a real
 * display. Two known traps it makes visible:
 *
 *   - `ash` and `porcelain` set accent === ink, so the active-tab pill and the
 *     primary button become indistinguishable. No component may assume they differ.
 *   - `accentSoft` is a real tint in the warm palettes but a low-alpha ink overlay
 *     in the dark and monochrome ones, so text placed on it needs a paired
 *     foreground rather than an assumed `ink`.
 */

/** One album row, rendered in a specific palette rather than the active one. */
function Card({ paletteKey }: { paletteKey: PaletteKey }) {
  const p = PALETTES[paletteKey]
  const collapsed = p.accent.toUpperCase() === p.ink.toUpperCase()

  return (
    <View
      style={{
        backgroundColor: p.bg,
        borderRadius: 14,
        padding: 16,
        gap: 12,
        borderWidth: 1,
        borderColor: p.line,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text color={p.inkMuted} variant="sectionLabel">
          {p.name}
          {p.isDark ? ' · dark' : ''}
        </Text>
        {collapsed && (
          <Text color={p.danger} variant="monoMeta">
            accent = ink
          </Text>
        )}
      </View>

      {/* An album row, the densest real composition in the app. */}
      <View
        style={{
          flexDirection: 'row',
          gap: 12,
          alignItems: 'center',
          backgroundColor: p.surface,
          borderRadius: 14,
          padding: 10,
          borderWidth: 1,
          borderColor: p.line,
        }}
      >
        <View style={{ width: 48, height: 48, borderRadius: 8, backgroundColor: p.surfaceAlt }} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text color={p.ink} numberOfLines={1} variant="titleRow">
            Lisbon, March
          </Text>
          <Text color={p.inkMuted} variant="meta">
            5 members
          </Text>
        </View>
        <View
          style={{
            height: 26,
            paddingHorizontal: 10,
            borderRadius: 26,
            backgroundColor: p.accent,
            justifyContent: 'center',
          }}
        >
          <Text color={p.accentInk} variant="chip">
            Add
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Text on accentSoft — the pairing most likely to fail. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            backgroundColor: p.accentSoft,
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: 999,
          }}
        >
          <Text color={p.accent} variant="chip">
            Face-privacy
          </Text>
        </View>
        {/* The active tab pill: ink fill. In ash/porcelain this matches the Add
            pill above exactly, which is the collapse being flagged. */}
        <View
          style={{
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 999,
            backgroundColor: p.ink,
          }}
        >
          <Text color={p.bg} variant="label">
            Albums
          </Text>
        </View>
        <Text color={p.inkSoft} variant="caption">
          inkSoft
        </Text>
        <Text color={p.inkMuted} variant="caption">
          inkMuted
        </Text>
      </View>

      <View
        style={{ flexDirection: 'row', gap: 2, height: 22, borderRadius: 4, overflow: 'hidden' }}
      >
        {/* Keyed by token NAME rather than by colour or index: several palettes
            repeat a value (sage has success === accent), so a colour key would
            collide, and an index key trips the lint rule for good reason. */}
        {(
          [
            ['bg', p.bg],
            ['surface', p.surface],
            ['surfaceAlt', p.surfaceAlt],
            ['ink', p.ink],
            ['accent', p.accent],
            ['accentSoft', p.accentSoft],
            ['danger', p.danger],
            ['success', p.success],
          ] as const
        ).map(([name, c]) => (
          <View key={name} style={{ flex: 1, backgroundColor: c }} />
        ))}
      </View>
    </View>
  )
}

export default function PaletteMatrix() {
  const { paletteKey, setPalette, theme } = usePalette()
  const router = useRouter()

  return (
    <Screen padded scroll>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16 }}>
        <Button
          accessibilityLabel="Back"
          kind="ghost"
          leading={<Icon color={theme.ink} name="chevron-left" size={18} />}
          onPress={() => router.back()}
          size="sm"
        />
        <Text variant="titleLg">Palettes</Text>
      </View>

      <View style={{ gap: 10, marginBottom: 24 }}>
        <SectionLabel>Active palette · applies to the whole app</SectionLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {PALETTE_ORDER.map(k => (
            <Pressable key={k} onPress={() => setPalette(k)}>
              <Chip
                leading={k === paletteKey ? <ChipDot color={theme.success} /> : undefined}
                tone={k === paletteKey ? 'ink' : 'neutral'}
              >
                {PALETTES[k].name}
              </Chip>
            </Pressable>
          ))}
        </View>
        <Text color={theme.inkSoft} variant="caption">
          {PALETTES[paletteKey].hint}
        </Text>
      </View>

      <View style={{ gap: 12 }}>
        {PALETTE_ORDER.map(k => (
          <Card key={k} paletteKey={k} />
        ))}
      </View>
    </Screen>
  )
}
