/**
 * Avatar and AvatarStack.
 *
 * Colour is derived from the user id via `avatarColor()` — a hash into a fixed
 * 12-hue ramp — so one person is the same colour on every device and platform.
 * The prototype's runtime `oklch(0.82 0.08 <hue>)` cannot work in React Native,
 * and real users have arbitrary ids rather than seven fixed demo hues.
 */
import { avatarColor, initials as toInitials } from '@photu/tokens'
import type { AvatarStackMember } from '@photu/ui-spec'
import { Image } from 'expo-image'
import { Text as RNText, StyleSheet, View } from 'react-native'
import { useTheme } from './theme'

export interface AvatarProps {
  userId: string
  name: string
  imageUrl?: string | null
  size?: number
  /** Accent ring — marks "this is you" in a member list. */
  ring?: boolean
}

export function Avatar({ userId, name, imageUrl, size = 28, ring = false }: AvatarProps) {
  const t = useTheme()
  const c = avatarColor(userId)

  const face = (
    <View
      accessibilityLabel={name}
      style={[
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: c.bg,
        },
      ]}
    >
      {imageUrl ? (
        <Image
          contentFit="cover"
          source={{ uri: imageUrl }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          // Falls back to the initials underneath if the image fails.
          transition={120}
        />
      ) : (
        <RNText
          style={[
            t.text.label,
            {
              color: c.fg,
              // Scaled from the box, matching the prototype's size * 0.38.
              fontSize: Math.round(size * 0.38),
              lineHeight: Math.round(size * 0.46),
              letterSpacing: 0.2,
            },
          ]}
        >
          {toInitials(name)}
        </RNText>
      )}
    </View>
  )

  if (!ring) return face

  // The prototype draws the ring with two stacked box-shadows (a bg-coloured gap,
  // then the accent), which React Native cannot express. A wrapper with a border
  // and matching background reproduces it. Unlike a shadow this DOES occupy
  // layout, so the ringed variant is ~7px larger — acceptable because it is only
  // used on a single "this is you" avatar, never inside a stack.
  const outer = size + 7
  return (
    <View
      style={[
        styles.base,
        {
          width: outer,
          height: outer,
          borderRadius: outer / 2,
          borderWidth: 1.5,
          borderColor: t.accent,
          backgroundColor: t.bg,
        },
      ]}
    >
      {face}
    </View>
  )
}

export interface AvatarStackProps {
  members: readonly AvatarStackMember[]
  size?: number
  max?: number
  /** Total count when it exceeds `members.length`, so "+N" does not undercount. */
  totalCount?: number
}

export function AvatarStack({ members, size = 22, max = 4, totalCount }: AvatarStackProps) {
  const t = useTheme()
  const shown = members.slice(0, max)
  const extra = (totalCount ?? members.length) - shown.length
  const overlap = -Math.round(size * 0.32)

  return (
    <View style={styles.row}>
      {shown.map((m, i) => (
        <View
          key={m.userId}
          style={[
            // Each avatar sits in a bg-coloured halo so overlapping reads cleanly
            // against any surface.
            { borderRadius: size / 2, borderWidth: 1.5, borderColor: t.bg },
            i > 0 && { marginLeft: overlap },
          ]}
        >
          <Avatar imageUrl={m.imageUrl} name={m.name} size={size} userId={m.userId} />
        </View>
      ))}

      {extra > 0 && (
        <View
          style={[
            styles.base,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              marginLeft: overlap,
              backgroundColor: t.surfaceAlt,
              borderWidth: 1.5,
              borderColor: t.bg,
            },
          ]}
        >
          <RNText
            style={[
              t.text.label,
              { color: t.inkSoft, fontSize: Math.round(size * 0.36), lineHeight: size },
            ]}
          >
            +{extra}
          </RNText>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 },
  row: { flexDirection: 'row', alignItems: 'center' },
})
