import { DEFAULT_PALETTE } from '@photu/tokens'
import { ThemeProvider, usePalette } from '@photu/ui-native'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'

/**
 * Root layout: providers only, no UI.
 *
 * GestureHandlerRootView must be the OUTERMOST component or gestures silently do
 * nothing on Android — the failure is a non-responsive screen with no error.
 */
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider initialPalette={DEFAULT_PALETTE}>
          <ThemedStatusBar />
          <Stack screenOptions={{ headerShown: false }} />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

/**
 * The status bar's content colour follows the palette rather than the OS theme:
 * `ink` and `walnut` are dark palettes, and dark status-bar text on them would be
 * unreadable. This is one of the few genuinely platform-aware bits of chrome.
 */
function ThemedStatusBar() {
  const { theme } = usePalette()
  return <StatusBar style={theme.isDark ? 'light' : 'dark'} />
}
