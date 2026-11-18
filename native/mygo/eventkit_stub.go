//go:build !(darwin && cgo)

package main

// Builds without the native adapter report unsupported; they never claim access.
func eventKitStatus() []byte                              { return eventKitFailure("apple_unsupported") }
func eventKitAuthorize(bool) []byte                       { return eventKitFailure("apple_unsupported") }
func eventKitEvents(float64, float64, int) []byte         { return eventKitFailure("apple_unsupported") }
func eventKitReminders(string, int) []byte                { return eventKitFailure("apple_unsupported") }
