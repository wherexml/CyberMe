// Verify a release archive with the production extractor before publication.
package main

import (
	"context"
	"fmt"
	"opstwin-advance/native/mygo/internal/updatefeed"
	"os"
)

func main() {
	if len(os.Args) != 3 {
		panic("archive and fresh destination required")
	}
	if err := updatefeed.Extract(context.Background(), os.Args[1], os.Args[2]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
