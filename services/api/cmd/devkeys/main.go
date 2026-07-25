// Command devkeys prints an Ed25519 signing key for local development, so a
// developer never needs to source a real one to run the app.
//
// Invoked by `task keys:dev`, which writes it into .env (gitignored).
package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/dharmikjethva30/photo/services/api/internal/auth"
)

func main() {
	pemStr, err := auth.GenerateDevKeyPEM()
	if err != nil {
		fmt.Fprintf(os.Stderr, "fatal: %v\n", err)
		os.Exit(1)
	}
	// Printed as a single line with literal \n escapes, so it survives being stored
	// in a dotenv file. The API's config decodes it back.
	fmt.Println(strings.ReplaceAll(strings.TrimSpace(pemStr), "\n", `\n`))
}
