//go:build darwin && cgo

package main

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework Foundation -framework EventKit
#include <stdlib.h>
char *cyberme_eventkit_status(void);
char *cyberme_eventkit_authorize(int reminders);
char *cyberme_eventkit_events(double start, double end, int limit);
char *cyberme_eventkit_reminders(const char *list, int limit);
*/
import "C"
import "unsafe"

func eventKitTake(value *C.char) []byte {
	defer C.free(unsafe.Pointer(value))
	return []byte(C.GoString(value))
}
func eventKitStatus() []byte { return eventKitTake(C.cyberme_eventkit_status()) }
func eventKitAuthorize(reminders bool) []byte {
	flag := C.int(0)
	if reminders {
		flag = 1
	}
	return eventKitTake(C.cyberme_eventkit_authorize(flag))
}
func eventKitEvents(start, end float64, limit int) []byte {
	return eventKitTake(C.cyberme_eventkit_events(C.double(start), C.double(end), C.int(limit)))
}
func eventKitReminders(list string, limit int) []byte {
	value := C.CString(list)
	defer C.free(unsafe.Pointer(value))
	return eventKitTake(C.cyberme_eventkit_reminders(value, C.int(limit)))
}
