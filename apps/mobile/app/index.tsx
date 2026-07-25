import { Button, Screen, Text } from '@photu/ui-native'
import { Link } from 'expo-router'
import { View } from 'react-native'

/**
 * Temporary landing screen.
 *
 * The real routes — (auth), (tabs), album/[albumId] — land with the API slice in
 * M1.10. Until the backend endpoints exist there is deliberately nothing here
 * that resembles the product: a library screen showing invented albums would be
 * exactly the mocked data the walking skeleton exists to avoid.
 *
 * What IS worth verifying on a device right now is that the design system renders
 * correctly, which is what the gallery below is for.
 */
export default function Index() {
  return (
    <Screen padded>
      <View style={{ flex: 1, justifyContent: 'center', gap: 24 }}>
        <View style={{ gap: 8 }}>
          <Text variant="display">photu</Text>
          <Text color="#454A52" variant="body">
            Design system verification build. Product screens arrive with the API slice — nothing
            here is mock data.
          </Text>
        </View>

        <View style={{ gap: 10 }}>
          <Link asChild href="/_dev/gallery">
            <Button full kind="primary">
              Component gallery
            </Button>
          </Link>
          <Link asChild href="/_dev/palettes">
            <Button full kind="outline">
              Palette matrix
            </Button>
          </Link>
        </View>
      </View>
    </Screen>
  )
}
