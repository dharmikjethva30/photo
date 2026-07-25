import { DEFAULT_PALETTE } from '@photu/tokens'
import { ThemeProvider, usePalette } from '@photu/ui-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ApiError } from '../src/api/errors'
import { restoreSession } from '../src/auth/session'
import { UploadQueueProvider } from '../src/upload/UploadQueueProvider'

/**
 * Root layout: providers only, no UI.
 *
 * GestureHandlerRootView must be the OUTERMOST component or gestures silently do
 * nothing on Android — the failure is a non-responsive screen with no error.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        // Never retry an auth or "not found" failure: the client already refreshes
        // once on a 401, so a retry here just burns requests and can look like a
        // replay attack to the server's refresh-reuse detection.
        if (error instanceof ApiError) {
          if (error.isUnauthorized || error.status === 404) return false
          if (error.isNetwork) return failureCount < 2
        }
        return failureCount < 1
      },
    },
  },
})

export default function RootLayout() {
  // Gate rendering until SecureStore has been read, so the router does not flash
  // sign-in at a user who is already signed in.
  const [ready, setReady] = useState(false)

  useEffect(() => {
    restoreSession().finally(() => setReady(true))
  }, [])

  if (!ready) return null

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider initialPalette={DEFAULT_PALETTE}>
            {/* Mounted above the navigator so the queue keeps draining across screen
                changes — leaving the upload modal must not stop the upload. */}
            <UploadQueueProvider>
              <ThemedStatusBar />
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(app)" />
                <Stack.Screen name="(auth)" />
                {/* Modals present over the album they were opened from, which is what
                    makes both of the prototype's stack-surgery behaviours reduce to
                    router.dismissAll(). See the plan's navigation notes. */}
                <Stack.Screen name="(modals)" options={{ presentation: 'modal' }} />
              </Stack>
            </UploadQueueProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

/**
 * The status bar follows the PALETTE, not the OS theme: `ink` and `walnut` are dark
 * palettes and dark status-bar text on them would be unreadable.
 */
function ThemedStatusBar() {
  const { theme } = usePalette()
  return <StatusBar style={theme.isDark ? 'light' : 'dark'} />
}
