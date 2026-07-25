import { Redirect } from 'expo-router'
import { useIsSignedIn } from '../src/auth/session'

/**
 * The entry point decides where to land. Session restoration has already finished
 * by the time this renders (see the root layout), so there is no flash.
 */
export default function Index() {
  const signedIn = useIsSignedIn()
  return <Redirect href={signedIn ? '/(app)/library' : '/(auth)/sign-in'} />
}
