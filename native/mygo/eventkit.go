package main

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"time"
)

// The server re-executes this signed binary with this flag for on-demand reads.
// The mode handles status and reads only; it never requests OS permission or starts UI.
const eventKitReadFlag = "--cyberme-eventkit-read"
const eventKitMaxRange = 32 * 24 * time.Hour

type eventKitRequest struct {
	Op    string `json:"op"`
	Start string `json:"start"`
	End   string `json:"end"`
	List  string `json:"list"`
	Limit int    `json:"limit"`
}

func eventKitFailure(code string) []byte {
	raw, _ := json.Marshal(map[string]any{"ok": false, "code": code})
	return raw
}
func eventKitDispatch(input []byte) []byte {
	var q eventKitRequest
	if json.Unmarshal(input, &q) != nil {
		return eventKitFailure("apple_invalid_request")
	}
	if q.Op == "status" {
		return eventKitStatus()
	}
	if q.Limit < 1 || q.Limit > 50 {
		return eventKitFailure("apple_invalid_request")
	}
	switch q.Op {
	case "events":
		start, startErr := time.Parse(time.RFC3339, q.Start)
		end, endErr := time.Parse(time.RFC3339, q.End)
		if startErr != nil || endErr != nil || !end.After(start) || end.Sub(start) > eventKitMaxRange {
			return eventKitFailure("apple_invalid_request")
		}
		return eventKitEvents(float64(start.Unix()), float64(end.Unix()), q.Limit)
	case "reminders":
		if len(q.List) > 400 {
			return eventKitFailure("apple_invalid_request")
		}
		return eventKitReminders(q.List, q.Limit)
	}
	return eventKitFailure("apple_invalid_request")
}

// Runs before any app startup: no window, single-instance lock, runtime launch or state path.
func maybeRunEventKitRead() {
	if len(os.Args) != 2 || os.Args[1] != eventKitReadFlag {
		return
	}
	input, err := io.ReadAll(io.LimitReader(os.Stdin, 4096))
	output := eventKitFailure("apple_invalid_request")
	if err == nil {
		output = eventKitDispatch(input)
	}
	_, _ = os.Stdout.Write(output)
	os.Exit(0)
}

// AppleAccess is the only path that may show the OS permission prompt: an explicit Settings click.
type AppleAccess struct{}

func (a *AppleAccess) Status() (map[string]any, error) {
	var result map[string]any
	err := json.Unmarshal(eventKitStatus(), &result)
	return result, err
}
func (a *AppleAccess) Authorize(kind string) (map[string]any, error) {
	if kind != "calendar" && kind != "reminders" {
		return nil, errors.New("invalid_apple_kind")
	}
	var result map[string]any
	err := json.Unmarshal(eventKitAuthorize(kind == "reminders"), &result)
	return result, err
}
