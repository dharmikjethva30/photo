package httpapi

import "runtime/debug"

// debugStack exists as a tiny indirection so Recoverer stays readable and the
// runtime/debug import does not pull into the middleware file's surface.
func debugStack() []byte { return debug.Stack() }
