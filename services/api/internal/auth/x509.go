package auth

import (
	"crypto"
	"crypto/x509"
)

// Thin wrappers so token.go reads at one level of abstraction and the x509
// import does not appear alongside the token logic.

func x509ParsePKCS8(der []byte) (crypto.PrivateKey, error) {
	return x509.ParsePKCS8PrivateKey(der)
}

func x509MarshalPKCS8(key crypto.PrivateKey) ([]byte, error) {
	return x509.MarshalPKCS8PrivateKey(key)
}
