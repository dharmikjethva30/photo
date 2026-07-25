import { textStyles } from '@photu/tokens'
import {
  Avatar,
  AvatarStack,
  BlurTargetView,
  Button,
  Chip,
  ChipDot,
  Glass,
  Icon,
  Screen,
  SectionLabel,
  Text,
  useTheme,
} from '@photu/ui-native'
import { ICON_NAMES } from '@photu/ui-spec'
import { useRouter } from 'expo-router'
import { useRef } from 'react'
import { StyleSheet, View } from 'react-native'

/**
 * Component gallery — a DEV screen, not product UI.
 *
 * Its purpose is to render every primitive on a real device so type rendering,
 * Android letter-spacing, blur, and icon geometry can be checked against the
 * design before any screen depends on them. The people here are placeholders for
 * an avatar-colour demo, not stand-ins for API data.
 */

const DEMO_PEOPLE = [
  { userId: 'u_dev', name: 'Dev Patel' },
  { userId: 'u_maya', name: 'Maya Shah' },
  { userId: 'u_sam', name: 'Sam Reid' },
  { userId: 'u_priya', name: 'Priya Nair' },
  { userId: 'u_leo', name: 'Leo Adams' },
]

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 12, marginBottom: 32 }}>
      <SectionLabel>{title}</SectionLabel>
      {children}
    </View>
  )
}

export default function Gallery() {
  const t = useTheme()
  const router = useRouter()
  // Android blur needs an explicit target view; see useGlass.
  const blurTarget = useRef<View>(null)

  return (
    <Screen padded scroll>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16 }}>
        <Button
          accessibilityLabel="Back"
          kind="ghost"
          leading={<Icon color={t.ink} name="chevron-left" size={18} />}
          onPress={() => router.back()}
          size="sm"
        />
        <Text variant="titleLg">Components</Text>
      </View>

      <Row title="Type scale">
        <View style={{ gap: 6 }}>
          {(
            [
              'display',
              'titleXl',
              'titleLg',
              'title',
              'titleSm',
              'titleRow',
              'editorial',
              'body',
              'bodyStrong',
              'caption',
              'chip',
              'meta',
              'monoMeta',
            ] as const
          ).map(v => (
            <View key={v} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
              <Text color={t.inkMuted} style={{ width: 92 }} variant="monoMeta">
                {v}
              </Text>
              <Text numberOfLines={1} style={{ flex: 1 }} variant={v}>
                Lisbon, March {textStyles[v].fontSize}
              </Text>
            </View>
          ))}
        </View>
      </Row>

      <Row title="Buttons">
        <View style={{ gap: 10 }}>
          {(['primary', 'accent', 'secondary', 'outline', 'ghost', 'danger'] as const).map(k => (
            <Button full key={k} kind={k}>
              {k}
            </Button>
          ))}
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Button size="sm">sm</Button>
            <Button size="md">md</Button>
            <Button size="lg">lg</Button>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Button kind="primary" leading={<Icon color={t.bg} name="plus" size={18} />} size="md">
              New album
            </Button>
            <Button disabled kind="outline" size="md">
              disabled
            </Button>
            <Button kind="accent" loading size="md">
              loading
            </Button>
          </View>
        </View>
      </Row>

      <Row title="Chips">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Chip leading={<ChipDot color={t.success} />}>4 days left</Chip>
          <Chip leading={<ChipDot color={t.danger} />} tone="danger">
            Locks in 1d
          </Chip>
          <Chip leading={<ChipDot color={t.inkMuted} />}>Locked · Keepsake</Chip>
          <Chip leading={<Icon color={t.accent} name="face" size={13} />} tone="accent">
            Face-privacy
          </Chip>
          <Chip tone="ink">All</Chip>
          <Chip tone="glass">Maya · 14:22</Chip>
        </View>
      </Row>

      <Row title="Avatars">
        <View style={{ gap: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {DEMO_PEOPLE.map(p => (
              <Avatar key={p.userId} name={p.name} size={36} userId={p.userId} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 20 }}>
            <AvatarStack members={DEMO_PEOPLE} size={22} totalCount={5} />
            <AvatarStack members={DEMO_PEOPLE} size={28} totalCount={30} />
            <Avatar name="Dev Patel" ring size={32} userId="u_dev" />
          </View>
        </View>
      </Row>

      <Row title={`Icons · ${ICON_NAMES.length}`}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 18 }}>
          {ICON_NAMES.map(n => (
            <View key={n} style={{ alignItems: 'center', width: 56, gap: 4 }}>
              <Icon color={t.ink} name={n} size={22} />
              <Text color={t.inkMuted} numberOfLines={1} variant="monoMeta">
                {n}
              </Text>
            </View>
          ))}
        </View>
      </Row>

      <Row title="Glass (blur over content)">
        {/* Android can only blur a designated target, so the content behind the
            island is wrapped in BlurTargetView and its ref handed to Glass. This
            is the same wiring the album feed will need for the tab island.
            Without it the island silently renders flat — which is exactly the
            bug this section exists to catch. */}
        <View style={{ borderRadius: t.radii.md, overflow: 'hidden' }}>
          <BlurTargetView ref={blurTarget}>
            <View style={{ height: 120, flexDirection: 'row' }}>
              {['#296898', '#C7692C', '#376139', '#9B5E62'].map(c => (
                <View key={c} style={{ flex: 1, backgroundColor: c }} />
              ))}
            </View>
          </BlurTargetView>
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Glass
                blurTarget={blurTarget}
                borderRadius={999}
                intensity="island"
                style={{ paddingHorizontal: 18, paddingVertical: 12 }}
              >
                <Text variant="label">Frosted island</Text>
              </Glass>
            </View>
          </View>
        </View>
      </Row>

      <Row title="Surfaces">
        <View style={{ gap: 8 }}>
          {(
            [
              ['bg', t.bg],
              ['surface', t.surface],
              ['surfaceAlt', t.surfaceAlt],
              ['accent', t.accent],
              ['accentSoft', t.accentSoft],
              ['danger', t.danger],
              ['success', t.success],
            ] as const
          ).map(([name, value]) => (
            <View key={name} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View
                style={{
                  width: 44,
                  height: 28,
                  borderRadius: t.radii.sm,
                  backgroundColor: value,
                  borderWidth: 1,
                  borderColor: t.line,
                }}
              />
              <Text variant="bodySm">{name}</Text>
              <Text color={t.inkMuted} variant="monoMeta">
                {value}
              </Text>
            </View>
          ))}
        </View>
      </Row>
    </Screen>
  )
}
